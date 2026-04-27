import test from "node:test";
import assert from "node:assert/strict";
import {
  addUtcDays,
  buildDaySeries,
  countCommitsByDay,
  getDisplayStartDay,
  parseNextLink,
  parseRepositorySlug,
  summarizeSeries,
  toUtcDayKey
} from "../src/githubActivity.js";

test("parseRepositorySlug accepts slugs and GitHub URLs", () => {
  assert.deepEqual(parseRepositorySlug("pqi8/gh_activity_tracker"), {
    owner: "pqi8",
    repo: "gh_activity_tracker"
  });
  assert.deepEqual(parseRepositorySlug("https://github.com/openai/openai-node.git"), {
    owner: "openai",
    repo: "openai-node"
  });
  assert.equal(parseRepositorySlug("not-a-slug"), null);
});

test("UTC day helpers are stable across date inputs", () => {
  assert.equal(toUtcDayKey("2026-04-27T23:55:00.000Z"), "2026-04-27");
  assert.equal(addUtcDays("2026-04-27", -89), "2026-01-28");
});

test("display start always uses a 90-day UTC window", () => {
  const now = new Date("2026-04-27T12:00:00.000Z");

  assert.equal(getDisplayStartDay(now), "2026-01-28");
});

test("buildDaySeries returns an inclusive range", () => {
  assert.deepEqual(buildDaySeries("2026-04-25", "2026-04-27"), [
    { day: "2026-04-25", count: 0 },
    { day: "2026-04-26", count: 0 },
    { day: "2026-04-27", count: 0 }
  ]);
});

test("countCommitsByDay fills zero days and uses committer dates", () => {
  const commits = [
    { commit: { committer: { date: "2026-04-25T02:00:00.000Z" } } },
    { commit: { committer: { date: "2026-04-25T20:00:00.000Z" } } },
    { commit: { author: { date: "2026-04-27T10:00:00.000Z" } } },
    { commit: { committer: { date: "2026-05-01T00:00:00.000Z" } } }
  ];

  assert.deepEqual(countCommitsByDay(commits, "2026-04-25", "2026-04-27"), [
    { day: "2026-04-25", count: 2 },
    { day: "2026-04-26", count: 0 },
    { day: "2026-04-27", count: 1 }
  ]);
});

test("summarizeSeries reports totals and busiest day", () => {
  assert.deepEqual(
    summarizeSeries([
      { day: "2026-04-25", count: 2 },
      { day: "2026-04-26", count: 0 },
      { day: "2026-04-27", count: 4 }
    ]),
    {
      totalCommits: 6,
      activeDays: 2,
      daysTracked: 3,
      averagePerDay: 2,
      busiestDay: { day: "2026-04-27", count: 4 }
    }
  );
});

test("parseNextLink finds pagination URLs", () => {
  const header = '<https://api.github.com/repositories/1/commits?page=2>; rel="next", <https://api.github.com/repositories/1/commits?page=4>; rel="last"';

  assert.equal(parseNextLink(header), "https://api.github.com/repositories/1/commits?page=2");
  assert.equal(parseNextLink(null), null);
});
