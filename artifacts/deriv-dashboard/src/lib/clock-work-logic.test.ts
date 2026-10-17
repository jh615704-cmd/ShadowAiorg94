import assert from "node:assert/strict";
import test from "node:test";
import {
  appendClockWorkQuote,
  getClockWorkBarrierTickCounts,
  estimateClockWorkBarrierRates,
  getClockWorkAggressiveBudget,
  getClockWorkPushProgress,
} from "./clock-work-logic.ts";

test("Clock Work quote buffer resets by market and retains at most 900 fresh ticks", () => {
  let buffer = { symbol: "R_75", quotes: [1, 2], lastTickId: "2:2" };
  buffer = appendClockWorkQuote(buffer, "R_100", {
    symbol: "R_75",
    quote: 3,
    epoch: 3,
  });
  assert.deepEqual(buffer, { symbol: "R_100", quotes: [], lastTickId: null });

  for (let epoch = 1; epoch <= 901; epoch += 1) {
    buffer = appendClockWorkQuote(buffer, "R_100", {
      symbol: "R_100",
      quote: epoch,
      epoch,
    });
  }
  assert.equal(buffer.quotes.length, 900);
  assert.equal(buffer.quotes[0], 2);
  assert.equal(buffer.quotes.at(-1), 901);

  const unchanged = appendClockWorkQuote(buffer, "R_100", {
    symbol: "R_100",
    quote: 901,
    epoch: 901,
  });
  assert.equal(unchanged, buffer);
});

test("Clock Work barrier estimates expose per-side tick counts", () => {
  const rates = estimateClockWorkBarrierRates({
    quotes: [100, 101, 99, 102, 98],
    spot: 100,
    mode: "offset",
    higherOffset: 0.1,
    lowerOffset: -0.1,
    halfBarrier: false,
    duration: 1,
    minimumSamples: 1,
  });

  assert.equal(rates.sampleCount, 4);
  assert.equal(rates.higherCount, 2);
  assert.equal(rates.lowerCount, 2);
  assert.equal(rates.higherPercent, 50);
  assert.equal(rates.lowerPercent, 50);
});

test("Clock Work observed higher/lower percentages count session ticks outside anchored barriers", () => {
  const counts = getClockWorkBarrierTickCounts(
    [100, 101, 102, 103, 99, 97, Number.NaN],
    102,
    98,
  );
  assert.deepEqual(counts, {
    higherCount: 1,
    lowerCount: 1,
    totalCount: 2,
    higherPercent: 50,
    lowerPercent: 50,
  });
});

test("Clock Work push progress counts consecutive directional ticks", () => {
  assert.deepEqual(getClockWorkPushProgress([1, 2, 3, 4], 4), {
    direction: null,
    consecutiveTicks: 3,
  });
  assert.deepEqual(getClockWorkPushProgress([1, 2, 3, 4, 5], 4), {
    direction: "HIGHER",
    consecutiveTicks: 4,
  });
  assert.deepEqual(getClockWorkPushProgress([1, 2, 3, 2, 1, 0], 3), {
    direction: "LOWER",
    consecutiveTicks: 3,
  });
});

test("Clock Work aggressive stakes stay within the selected balance percentage", () => {
  const pair = getClockWorkAggressiveBudget(411.41, 5, 2);
  assert.deepEqual(pair, {
    budgetAmount: 20.57,
    eachContractAmount: 10.28,
    totalAmount: 20.56,
    eligible: true,
    stakes: [10.28, 10.28],
  });

  const four = getClockWorkAggressiveBudget(100, 25, 4);
  assert.equal(four?.budgetAmount, 25);
  assert.equal(four?.totalAmount, 25);
  assert.deepEqual(four?.stakes, [6.25, 6.25, 6.25, 6.25]);

  const belowMinimum = getClockWorkAggressiveBudget(10, 5, 2);
  assert.equal(belowMinimum?.eligible, false);
  assert.deepEqual(belowMinimum?.stakes, []);
});
