import assert from "node:assert/strict";
import test from "node:test";
import { simulateAccumulatorQuoteWindows } from "./money-bank-simulation.ts";

test("Accumulator simulation replays each entry against the absolute knockout barrier", () => {
  const result = simulateAccumulatorQuoteWindows([100, 101, 102, 101, 100], 2, 3);

  assert.deepEqual(result, [
    { ticks: 1, sample_count: 4, knockouts: 0, survivors: 4, survival_rate: 100 },
    { ticks: 2, sample_count: 3, knockouts: 2, survivors: 1, survival_rate: 33.3 },
    { ticks: 3, sample_count: 2, knockouts: 1, survivors: 1, survival_rate: 50 },
  ]);
});

test("Accumulator simulation leaves horizons without enough quotes empty", () => {
  const result = simulateAccumulatorQuoteWindows([10, 11, 12], 1, 4);

  assert.deepEqual(result, [
    { ticks: 1, sample_count: 2, knockouts: 2, survivors: 0, survival_rate: 0 },
    { ticks: 2, sample_count: 1, knockouts: 1, survivors: 0, survival_rate: 0 },
    { ticks: 3, sample_count: 0, knockouts: 0, survivors: 0, survival_rate: null },
    { ticks: 4, sample_count: 0, knockouts: 0, survivors: 0, survival_rate: null },
  ]);
});

test("Accumulator simulation rejects invalid barriers without inventing outcomes", () => {
  const result = simulateAccumulatorQuoteWindows([10, 11, 12], 0, 2);

  assert.deepEqual(result, [
    { ticks: 1, sample_count: 0, knockouts: 0, survivors: 0, survival_rate: null },
    { ticks: 2, sample_count: 0, knockouts: 0, survivors: 0, survival_rate: null },
  ]);
});
