import assert from "node:assert/strict";
import test from "node:test";
import {
  MONEY_BANK_STATS_TICK_LIMIT,
  summarizeMoneyBankExitTicks,
  summarizeMoneyBankKnockoutStats,
  summarizeMoneyBankOutcomeStats,
} from "./money-bank-knockout-stats.ts";

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

test("selected-rate summary includes active live progress without mixing rates", () => {
  const rows = [
    { symbol: "1HZ90V", growth_rate: 0.01, tick_passed: 6, status: "open" },
    { symbol: "1HZ90V", growth_rate: 0.01, tick_passed: 4, status: "lost" },
    { symbol: "1HZ90V", growth_rate: 0.02, tick_passed: 2, status: "active" },
  ];

  const onePercent = summarizeMoneyBankOutcomeStats(rows, "1HZ90V", 1, 20);
  const twoPercent = summarizeMoneyBankOutcomeStats(rows, "1HZ90V", 2, 20);

  assert.deepEqual(onePercent, {
    trackedRuns: 2,
    knockouts: 1,
    completed: 0,
    longestTicks: 6,
    averageTicks: 5,
    shortestTicks: 4,
  });
  assert.deepEqual(twoPercent, {
    trackedRuns: 1,
    knockouts: 0,
    completed: 0,
    longestTicks: 2,
    averageTicks: 2,
    shortestTicks: 2,
  });
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

test("Money Bank stats group actual settled results by market, rate, and exact duration", () => {
  const rows = [
    ...Array.from({ length: 20 }, () => ({
      symbol: "1HZ30V",
      growth_rate: 0.01,
      duration: 2,
      duration_unit: "t",
      tick_passed: 1,
      status: "lost",
    })),
    ...Array.from({ length: 20 }, () => ({
      symbol: "1HZ30V",
      growth_rate: 0.02,
      duration: 2,
      duration_unit: "t",
      tick_passed: 2,
      status: "won",
    })),
    {
      symbol: "1HZ90V",
      growth_rate: 0.01,
      duration: 2,
      duration_unit: "t",
      tick_passed: 2,
      status: "won",
    },
  ];

  const [onePercent, twoPercent, threePercent] = [
    summarizeMoneyBankExitTicks(rows, "1HZ30V", 1, 2),
    summarizeMoneyBankExitTicks(rows, "1HZ30V", 2, 2),
    summarizeMoneyBankExitTicks(rows, "1HZ30V", 3, 2),
  ];
  assert.equal(onePercent[0].band, "no-data");
  assert.equal(onePercent[1].band, "red");
  assert.equal(onePercent[1].winRate, 0);
  assert.equal(twoPercent[1].band, "green");
  assert.equal(twoPercent[1].winRate, 100);
  assert.equal(threePercent[0].band, "no-data");

  const allRates = summarizeMoneyBankExitTicks(rows, "1HZ30V", "all", 2);
  assert.equal(allRates[1].trackedRuns, 40);
  assert.equal(allRates[1].knockouts, 20);
  assert.equal(allRates[1].completed, 20);
  assert.equal(allRates[1].winRate, 50);
  assert.equal(allRates[1].band, "yellow");

  const summary = summarizeMoneyBankOutcomeStats(rows, "1HZ30V", "all", 2);
  assert.equal(summary.trackedRuns, 40);
  assert.equal(summary.knockouts, 20);
  assert.equal(summary.completed, 20);
  assert.equal(summary.longestTicks, 2);
  assert.equal(summary.averageTicks, 1.5);
  assert.equal(summary.shortestTicks, 1);
});

test("Money Bank keeps undersampled exit ticks neutral and caps the grid at 30", () => {
  const rows = [
    { symbol: "1HZ90V", growth_rate: 0.04, duration: 1, tick_passed: 1, status: "won" },
  ];
  const ticks = summarizeMoneyBankExitTicks(rows, "1HZ90V", "all", 90);

  assert.equal(ticks.length, 30);
  assert.equal(ticks[0].band, "yellow");
  assert.equal(ticks[1].band, "no-data");
});

test("Money Bank stats limit the historical tick grid to ticks 1 through 20", () => {
  const ticks = summarizeMoneyBankExitTicks(
    [{ symbol: "1HZ90V", growth_rate: 0.01, duration: 21, tick_passed: 21, status: "lost" }],
    "1HZ90V",
    1,
    MONEY_BANK_STATS_TICK_LIMIT,
  );

  assert.equal(MONEY_BANK_STATS_TICK_LIMIT, 20);
  assert.equal(ticks.length, 20);
  assert.equal(ticks[0].ticks, 1);
  assert.equal(ticks[19].ticks, 20);
  assert.equal(ticks[19].trackedRuns, 0);
});
