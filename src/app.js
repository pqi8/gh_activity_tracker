import {
  fetchRepositoryActivity,
  GitHubActivityError,
  parseRepositorySlug,
  summarizeSeries
} from "./githubActivity.js";

const form = document.querySelector("[data-repo-form]");
const ownerInput = document.querySelector("[data-owner]");
const repoInput = document.querySelector("[data-repo]");
const pasteInput = document.querySelector("[data-paste]");
const submitButton = document.querySelector("[data-submit]");
const statusEl = document.querySelector("[data-status]");
const statsEl = document.querySelector("[data-stats]");
const chartEl = document.querySelector("[data-chart]");
const heatmapEl = document.querySelector("[data-heatmap]");
const tableBodyEl = document.querySelector("[data-table-body]");
const repoTitleEl = document.querySelector("[data-repo-title]");
const repoMetaEl = document.querySelector("[data-repo-meta]");
const downloadButton = document.querySelector("[data-download]");

let currentActivity = null;
let activeController = null;

function formatNumber(value, options = {}) {
  return new Intl.NumberFormat(undefined, options).format(value);
}

function formatDate(day) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${day}T00:00:00.000Z`));
}

function setStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Loading" : "Track";
}

function restoreFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const owner = params.get("owner");
  const repo = params.get("repo");

  if (owner) ownerInput.value = owner;
  if (repo) repoInput.value = repo;

  if (owner && repo) {
    void loadActivity(owner, repo);
  }
}

function updateUrl(owner, repo) {
  const params = new URLSearchParams({ owner, repo });
  window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
}

function readInputs() {
  const pasted = parseRepositorySlug(pasteInput.value);

  if (pasted) {
    ownerInput.value = pasted.owner;
    repoInput.value = pasted.repo;
    pasteInput.value = "";
  }

  return {
    owner: ownerInput.value.trim(),
    repo: repoInput.value.trim()
  };
}

function renderStats(activity) {
  const { summary, metadata, startDay, endDay, rateLimit } = activity;
  const resetLabel = rateLimit?.resetAt
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(rateLimit.resetAt)
    : "Unknown";
  const items = [
    ["Commits", formatNumber(summary.totalCommits)],
    ["Active days", formatNumber(summary.activeDays)],
    ["Tracked days", formatNumber(summary.daysTracked)],
    ["Avg / day", formatNumber(summary.averagePerDay, { maximumFractionDigits: 2 })],
    ["Busiest day", summary.busiestDay.count ? `${formatDate(summary.busiestDay.day)} · ${summary.busiestDay.count}` : "None"],
    ["Rate left", rateLimit?.remaining ?? "Unknown"]
  ];

  repoTitleEl.textContent = `${activity.owner}/${activity.repo}`;
  repoMetaEl.textContent = `${metadata.visibility} · ${formatDate(startDay)} to ${formatDate(endDay)} · resets ${resetLabel}`;
  statsEl.replaceChildren(
    ...items.map(([label, value]) => {
      const card = document.createElement("article");
      const labelEl = document.createElement("span");
      const valueEl = document.createElement("strong");

      labelEl.textContent = label;
      valueEl.textContent = value;
      card.append(labelEl, valueEl);

      return card;
    })
  );
}

function getIntensity(count, max) {
  if (count === 0 || max === 0) return 0;
  if (count / max >= 0.75) return 4;
  if (count / max >= 0.45) return 3;
  if (count / max >= 0.2) return 2;
  return 1;
}

function renderChart(series) {
  const max = Math.max(1, ...series.map((item) => item.count));
  const bars = series.map((item) => {
    const bar = document.createElement("div");
    const height = Math.max(4, (item.count / max) * 180);

    bar.className = "bar";
    bar.style.height = `${height}px`;
    bar.dataset.count = String(item.count);
    bar.title = `${formatDate(item.day)}: ${item.count} commits`;
    bar.setAttribute("aria-label", bar.title);

    return bar;
  });

  chartEl.style.setProperty("--day-count", String(series.length));
  chartEl.replaceChildren(...bars);
}

function buildHeatmapWeeks(series) {
  const weeks = [];
  let currentWeek = [];
  const firstDay = new Date(`${series[0].day}T00:00:00.000Z`).getUTCDay();

  for (let i = 0; i < firstDay; i += 1) {
    currentWeek.push(null);
  }

  for (const item of series) {
    currentWeek.push(item);

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  if (currentWeek.length) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  return weeks;
}

function renderHeatmap(series) {
  const max = Math.max(1, ...series.map((item) => item.count));
  const weeks = buildHeatmapWeeks(series);

  heatmapEl.replaceChildren(
    ...weeks.map((week) => {
      const column = document.createElement("div");
      column.className = "heat-week";

      column.replaceChildren(
        ...week.map((item) => {
          const cell = document.createElement("span");

          cell.className = "heat-day";

          if (item) {
            cell.dataset.level = String(getIntensity(item.count, max));
            cell.title = `${formatDate(item.day)}: ${item.count} commits`;
            cell.setAttribute("aria-label", cell.title);
          } else {
            cell.dataset.level = "empty";
            cell.setAttribute("aria-hidden", "true");
          }

          return cell;
        })
      );

      return column;
    })
  );
}

function renderTable(series) {
  const rows = [...series]
    .reverse()
    .map((item) => {
      const row = document.createElement("tr");
      const dayCell = document.createElement("td");
      const countCell = document.createElement("td");

      dayCell.textContent = formatDate(item.day);
      countCell.textContent = formatNumber(item.count);
      row.append(dayCell, countCell);

      return row;
    });

  tableBodyEl.replaceChildren(...rows);
}

function toCsv(activity) {
  const rows = [["repository", `${activity.owner}/${activity.repo}`], ["start_day", activity.startDay], ["end_day", activity.endDay], [], ["day", "commits"]];

  for (const item of activity.series) {
    rows.push([item.day, item.count]);
  }

  return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
}

function renderActivity(activity) {
  currentActivity = activity;
  renderStats(activity);
  renderChart(activity.series);
  renderHeatmap(activity.series);
  renderTable(activity.series);
  downloadButton.disabled = false;
}

async function loadActivity(owner, repo) {
  if (!owner || !repo) {
    setStatus("Enter an owner and repository.", "warning");
    return;
  }

  activeController?.abort();
  activeController = new AbortController();
  setLoading(true);
  setStatus("Fetching repository metadata.", "neutral");
  downloadButton.disabled = true;
  updateUrl(owner, repo);

  try {
    const activity = await fetchRepositoryActivity({
      owner,
      repo,
      signal: activeController.signal,
      onProgress: ({ page, commitsFetched, rateLimit }) => {
        const remaining = rateLimit?.remaining ?? "unknown";
        setStatus(`Fetched ${formatNumber(commitsFetched)} commits across ${formatNumber(page)} pages · ${remaining} API calls left.`, "neutral");
      }
    });

    renderActivity(activity);
    const freshSummary = summarizeSeries(activity.series);
    setStatus(`Loaded ${formatNumber(freshSummary.totalCommits)} commits across ${formatNumber(freshSummary.daysTracked)} UTC days.`, "success");
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    const reset = error instanceof GitHubActivityError && error.rateLimit?.resetAt
      ? ` Resets at ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(error.rateLimit.resetAt)}.`
      : "";

    setStatus(`${error.message}${reset}`, "danger");
  } finally {
    setLoading(false);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const { owner, repo } = readInputs();
  void loadActivity(owner, repo);
});

downloadButton.addEventListener("click", () => {
  if (!currentActivity) {
    return;
  }

  const blob = new Blob([toCsv(currentActivity)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `${currentActivity.owner}-${currentActivity.repo}-commit-activity.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
});

restoreFromUrl();
