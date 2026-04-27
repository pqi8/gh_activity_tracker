const DAY_MS = 24 * 60 * 60 * 1000;
const GITHUB_API_BASE = "https://api.github.com";

export class GitHubActivityError extends Error {
  constructor(message, { status, rateLimit } = {}) {
    super(message);
    this.name = "GitHubActivityError";
    this.status = status;
    this.rateLimit = rateLimit;
  }
}

export function parseRepositorySlug(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");

  const [owner, repo] = normalized.split("/");

  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo: repo.replace(/[#?].*$/, "")
  };
}

export function toUtcDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }

  return date.toISOString().slice(0, 10);
}

export function parseUtcDayKey(dayKey) {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

export function addUtcDays(dayKey, days) {
  const date = parseUtcDayKey(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return toUtcDayKey(date);
}

export function getTrackingStartDay(createdAt, now = new Date()) {
  const today = toUtcDayKey(now);
  const ninetyDayStart = addUtcDays(today, -89);
  const createdDay = toUtcDayKey(createdAt);

  return createdDay < ninetyDayStart ? createdDay : ninetyDayStart;
}

export function buildDaySeries(startDay, endDay) {
  const days = [];
  let cursor = startDay;

  while (cursor <= endDay) {
    days.push({ day: cursor, count: 0 });
    cursor = addUtcDays(cursor, 1);
  }

  return days;
}

export function countCommitsByDay(commits, startDay, endDay) {
  const counts = new Map(buildDaySeries(startDay, endDay).map(({ day }) => [day, 0]));

  for (const item of commits) {
    const commitDate = item?.commit?.committer?.date || item?.commit?.author?.date;

    if (!commitDate) {
      continue;
    }

    const day = toUtcDayKey(commitDate);

    if (counts.has(day)) {
      counts.set(day, counts.get(day) + 1);
    }
  }

  return Array.from(counts, ([day, count]) => ({ day, count }));
}

export function summarizeSeries(series) {
  const totalCommits = series.reduce((total, item) => total + item.count, 0);
  const activeDays = series.filter((item) => item.count > 0).length;
  const busiestDay = series.reduce(
    (best, item) => (item.count > best.count ? item : best),
    { day: series[0]?.day ?? "", count: 0 }
  );

  return {
    totalCommits,
    activeDays,
    daysTracked: series.length,
    averagePerDay: series.length === 0 ? 0 : totalCommits / series.length,
    busiestDay
  };
}

export function parseNextLink(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  const links = linkHeader.split(",").map((part) => part.trim());
  const next = links.find((part) => part.endsWith('rel="next"'));
  const match = next?.match(/<([^>]+)>/);

  return match?.[1] ?? null;
}

function readRateLimit(response) {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");

  return {
    remaining: remaining === null ? null : Number(remaining),
    resetAt: reset === null ? null : new Date(Number(reset) * 1000)
  };
}

async function fetchGitHubJson(url, { signal } = {}) {
  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/vnd.github+json"
    }
  });
  const rateLimit = readRateLimit(response);

  if (response.status === 409) {
    return { data: [], response, rateLimit };
  }

  if (!response.ok) {
    let detail = "";

    try {
      const body = await response.json();
      detail = body?.message ? ` ${body.message}` : "";
    } catch {
      detail = "";
    }

    if (response.status === 403 && rateLimit.remaining === 0) {
      throw new GitHubActivityError(
        "GitHub's unauthenticated API rate limit was reached. Wait for the reset time and try again.",
        { status: response.status, rateLimit }
      );
    }

    if (response.status === 404) {
      throw new GitHubActivityError("Repository not found or not public.", {
        status: response.status,
        rateLimit
      });
    }

    throw new GitHubActivityError(`GitHub request failed.${detail}`, {
      status: response.status,
      rateLimit
    });
  }

  return {
    data: await response.json(),
    response,
    rateLimit
  };
}

export async function fetchRepositoryActivity({ owner, repo, now = new Date(), signal, onProgress }) {
  const metadataUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const { data: metadata } = await fetchGitHubJson(metadataUrl, { signal });
  const endDay = toUtcDayKey(now);
  const startDay = getTrackingStartDay(metadata.created_at, now);
  const since = `${startDay}T00:00:00.000Z`;
  const until = `${endDay}T23:59:59.999Z`;
  let nextUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=100&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`;
  let page = 0;
  const commits = [];
  let latestRateLimit = null;

  while (nextUrl) {
    page += 1;
    const { data, response, rateLimit } = await fetchGitHubJson(nextUrl, { signal });

    latestRateLimit = rateLimit;
    commits.push(...data);
    onProgress?.({
      page,
      commitsFetched: commits.length,
      rateLimit
    });
    nextUrl = parseNextLink(response.headers.get("link"));
  }

  const series = countCommitsByDay(commits, startDay, endDay);

  return {
    metadata,
    owner,
    repo,
    startDay,
    endDay,
    series,
    summary: summarizeSeries(series),
    rateLimit: latestRateLimit
  };
}
