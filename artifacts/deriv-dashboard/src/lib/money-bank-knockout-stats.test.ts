import assert from "node:assert/strict";
import test from "node:test";
import { summarizeMoneyBankKnockoutStats } from "./money-bank-knockout-stats.ts";

test("Money Bank stats use actual Deriv outcomes and tick_passed by market and growth rate", () => {
  const rows = [
    { symbol: "1HZ10V", growth_rate: 0.01, tick_passed: 4, status: "lost" },
    { symbol: "1HZ10V", growth_rate: 0.01, tick_passed: 8, status: "lost" },
    { symbol: "1HZ10V", growth_rate: 0.01, tick_passed: 6, status: "won" },
    { symbol: "1HZ10V", growth_rate: 0.01, tick_passed: 11, status: "sold" },
    { symbol: "1HZ25V", growth_rate: 0.01, tick_passed: 100, status: "lost" },
    { symbol: "1HZ10V", growth_rate: 0.02, tick_passed: 3, status: "lost" },
  ];

  const [onePercent, twoPercent] = summarizeMoneyBankKnockoutStats(rows, "1HZ10V");

  assert.equal(onePercent.trackedRuns, 3);
  assert.equal(onePercent.knockouts, 2);
  assert.equal(onePercent.completed, 1);
  assert.equal(onePercent.longestTicks, 8);
  assert.equal(onePercent.shortestTicks, 4);
  assert.equal(onePercent.averageTicks, 6);
  assert.deepEqual(onePercent.topKnockoutTicks, [
    { ticks: 4, count: 1, percentageOfKnockouts: 50 },
    { ticks: 8, count: 1, percentageOfKnockouts: 50 },
  ]);
  assert.equal(twoPercent.trackedRuns, 1);
  assert.deepEqual(twoPercent.topKnockoutTicks, [
    { ticks: 3, count: 1, percentageOfKnockouts: 100 },
  ]);
});

test("Money Bank live tick count is separate from settled outcome statistics", () => {
  const [stats] = summarizeMoneyBankKnockoutStats([
    { symbol: "1HZ90V", growth_rate: 0.03, tick_passed: 5, status: "open" },
    { symbol: "1HZ90V", growth_rate: 0.03, tick_passed: 9, status: "active" },
  ], "1HZ90V", [3]);

  assert.equal(stats.liveTicks, 9);
  assert.equal(stats.trackedRuns, 0);
  assert.equal(stats.knockouts, 0);
});

test("top five knockout ticks are ranked by frequency with stable tie ordering", () => {
  const rows = [
    ...Array.from({ length: 3 }, () => ({
      symbol: "1HZ30V",
      growth_rate: 0.04,
      tick_passed: 7,
      status: "lost",
    })),
    ...[2, 4, 5, 6, 8, 9].map((tick_passed) => ({
      symbol: "1HZ30V",
      growth_rate: 0.04,
      tick_passed,
      status: "lost",
    })),
    { symbol: "1HZ30V", growth_rate: 0.04, tick_passed: 10, status: "won" },
  ];

  const [stats] = summarizeMoneyBankKnockoutStats(rows, "1HZ30V", [4]);

  assert.equal(stats.trackedRuns, 10);
  assert.deepEqual(stats.topKnockoutTicks, [
    { ticks: 7, count: 3, percentageOfKnockouts: 33.3 },
    { ticks: 2, count: 1, percentageOfKnockouts: 11.1 },
    { ticks: 4, count: 1, percentageOfKnockouts: 11.1 },
    { ticks: 5, count: 1, percentageOfKnockouts: 11.1 },
    { ticks: 6, count: 1, percentageOfKnockouts: 11.1 },
  ]);
});
