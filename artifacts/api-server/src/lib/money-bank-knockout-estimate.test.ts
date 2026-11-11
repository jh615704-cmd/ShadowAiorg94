import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateMoneyBankKnockouts } from "./money-bank-knockout-estimate.ts";

test("estimates from earlier windows and measures later observed knockouts", () => {
  const quotes = Array.from({ length: 200 }, (_, index) =>
    index < 140 || index % 2 === 0 ? 75.5 : 75.5001,
  );
  const result = estimateMoneyBankKnockouts({
    quotes,
    barrier: 0.00005,
    durationTicks: 5,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.training_windows, 23);
  assert.equal(result.training_knockouts, 0);
  assert.equal(result.holdout_windows, 10);
  assert.equal(result.observed_knockouts, 10);
  assert.equal(result.estimated_knockouts, 0);
  assert.equal(result.holdout_gap_percentage_points, 100);
  assert.ok(result.estimate_lower_count != null && result.estimate_upper_count != null);
  assert.ok(result.estimate_upper_count! < result.observed_knockouts);
});

test("requires enough non-overlapping training and holdout windows", () => {
  const result = estimateMoneyBankKnockouts({
    quotes: Array.from({ length: 200 }, (_, index) => 75.5 + index * 0.00001),
    barrier: 0.00005,
    durationTicks: 20,
  });

  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.estimated_knockouts, null);
  assert.equal(result.estimate_lower_count, null);
  assert.equal(result.estimate_upper_count, null);
  assert.equal(result.holdout_gap_percentage_points, null);
});

test("does not invent a rate when there are no valid quote windows", () => {
  const result = estimateMoneyBankKnockouts({
    quotes: [Number.NaN, 0, -1, Infinity],
    barrier: 0.00005,
    durationTicks: 5,
  });

  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.training_windows, 0);
  assert.equal(result.holdout_windows, 0);
  assert.equal(result.observed_knockout_rate, null);
  assert.equal(result.estimated_knockout_rate, null);
});

test("rejects missing barriers and invalid sample durations", () => {
  assert.throws(
    () => estimateMoneyBankKnockouts({ quotes: [75.5, 75.6], barrier: 0, durationTicks: 1 }),
    /positive finite Accumulator barrier/,
  );
  assert.throws(
    () => estimateMoneyBankKnockouts({ quotes: [75.5, 75.6], barrier: 0.1, durationTicks: 0 }),
    /duration must be from 1 to 30/,
  );
});
