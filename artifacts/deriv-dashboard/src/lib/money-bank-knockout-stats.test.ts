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
  assert.deepEqual(onePercent.exitOptions.map((option) => option.ticks), [3, 7]);
  assert.equal(onePercent.exitOptions[0]?.noKnockoutPercentage, 100);
  assert.equal(onePercent.exitOptions[1]?.noKnockoutPercentage, 66.7);
  assert.equal(onePercent.exitOptions[0]?.isRecommended, false);
  assert.equal(twoPercent.trackedRuns, 1);
  assert.equal(twoPercent.exitOptions.length, 0);
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

test("recommendations require both a 50 percent observed rate and ten outcomes", () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, index) => ({
      symbol: "1HZ30V",
      growth_rate: 0.04,
      tick_passed: index + 4,
      status: "lost",
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      symbol: "1HZ30V",
      growth_rate: 0.04,
      tick_passed: index + 8,
      status: "won",
    })),
  ];

  const [stats] = summarizeMoneyBankKnockoutStats(rows, "1HZ30V", [4]);

  assert.equal(stats.trackedRuns, 10);
  assert.equal(stats.exitOptions.length, 2);
  assert.equal(stats.exitOptions.every((option) => option.noKnockoutPercentage >= 50), true);
  assert.equal(stats.exitOptions.every((option) => option.isRecommended), true);
});
