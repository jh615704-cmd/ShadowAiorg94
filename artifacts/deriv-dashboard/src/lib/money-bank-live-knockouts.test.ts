import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceMoneyBankKnockoutEvaluation,
  appendMoneyBankKnockoutForecast,
  estimateMoneyBankKnockoutTicks,
  MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES,
  MONEY_BANK_LIVE_KNOCKOUT_LIMIT,
  startMoneyBankKnockoutEvaluation,
} from "./money-bank-live-knockouts.ts";

const steadyQuotes = Array.from({ length: MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES }, (_, index) => 100 + index);

test("estimates ticks to a rate-specific barrier from recent live movement", () => {
  const estimate = estimateMoneyBankKnockoutTicks({
    quotes: steadyQuotes,
    barrier: 3,
    referenceQuote: 111,
  });

  assert.equal(estimate, 9);
});

test("estimates fewer ticks when the current quote is closer to the barrier", () => {
  const estimate = estimateMoneyBankKnockoutTicks({
    quotes: steadyQuotes,
    barrier: 3,
    referenceQuote: 109,
  });

  assert.equal(estimate, 5);
});

test("returns no estimate without enough live movement or a valid barrier", () => {
  assert.equal(estimateMoneyBankKnockoutTicks({
    quotes: steadyQuotes.slice(0, MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES - 1),
    barrier: 3,
    referenceQuote: 111,
  }), null);
  assert.equal(estimateMoneyBankKnockoutTicks({
    quotes: steadyQuotes,
    barrier: null,
    referenceQuote: 111,
  }), null);
  assert.equal(estimateMoneyBankKnockoutTicks({
    quotes: Array(MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES).fill(100),
    barrier: 3,
    referenceQuote: 100,
  }), null);
});

test("demo evaluation records the first later barrier hit independently for each rate", () => {
  const evaluation = startMoneyBankKnockoutEvaluation({
    quotes: steadyQuotes,
    sequence: 12,
    rates: [
      { growthRate: 1, barrier: 3, referenceQuote: 111 },
      { growthRate: 2, barrier: 5, referenceQuote: 111 },
    ],
  });
  const oneTickLater = advanceMoneyBankKnockoutEvaluation(evaluation, {
    quote: 113,
    sequence: 13,
  });
  const twoTicksLater = advanceMoneyBankKnockoutEvaluation(oneTickLater, {
    quote: 114,
    sequence: 14,
  });

  assert.equal(twoTicksLater[0]?.status, "hit");
  assert.equal(twoTicksLater[0]?.actualTicks, 2);
  assert.equal(twoTicksLater[0]?.estimateTicks, 9);
  assert.equal(twoTicksLater[1]?.status, "watching");
  assert.equal(twoTicksLater[1]?.actualTicks, null);
});

test("evaluation marks sparse or flat quote history as unscorable", () => {
  const sparse = startMoneyBankKnockoutEvaluation({
    quotes: steadyQuotes.slice(0, MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES - 1),
    sequence: 4,
    rates: [{ growthRate: 1, barrier: 3, referenceQuote: 111 }],
  });
  const flat = startMoneyBankKnockoutEvaluation({
    quotes: Array(MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES).fill(100),
    sequence: 4,
    rates: [{ growthRate: 1, barrier: 3, referenceQuote: 100 }],
  });

  assert.deepEqual(
    [sparse[0]?.status, sparse[0]?.reason],
    ["unscorable", "sparse-quotes"],
  );
  assert.deepEqual(
    [flat[0]?.status, flat[0]?.reason],
    ["unscorable", "flat-movement"],
  );
});

test("evaluation rejects a barrier that was already crossed before the test starts", () => {
  const evaluation = startMoneyBankKnockoutEvaluation({
    quotes: steadyQuotes,
    sequence: 4,
    rates: [{ growthRate: 1, barrier: 3, referenceQuote: 108 }],
  });

  assert.equal(evaluation[0]?.status, "unscorable");
  assert.equal(evaluation[0]?.reason, "barrier-already-crossed");
});

test("evaluation refuses to score a barrier crossing after a tick sequence gap", () => {
  const evaluation = startMoneyBankKnockoutEvaluation({
    quotes: steadyQuotes,
    sequence: 12,
    rates: [{ growthRate: 1, barrier: 3, referenceQuote: 111 }],
  });
  const afterGap = advanceMoneyBankKnockoutEvaluation(evaluation, {
    quote: 120,
    sequence: 14,
  });

  assert.equal(afterGap[0]?.status, "unscorable");
  assert.equal(afterGap[0]?.reason, "tick-gap");
  assert.equal(afterGap[0]?.actualTicks, null);
});

test("evaluation marks a restarted tick feed as unscorable", () => {
  const evaluation = startMoneyBankKnockoutEvaluation({
    quotes: steadyQuotes,
    sequence: 12,
    rates: [{ growthRate: 1, barrier: 3, referenceQuote: 111 }],
  });
  const afterRestart = advanceMoneyBankKnockoutEvaluation(evaluation, {
    quote: 100,
    sequence: 1,
  });

  assert.equal(afterRestart[0]?.status, "unscorable");
  assert.equal(afterRestart[0]?.reason, "feed-restarted");
});

test("returns a one-tick estimate if the barrier is already reached", () => {
  assert.equal(estimateMoneyBankKnockoutTicks({
    quotes: steadyQuotes,
    barrier: 3,
    referenceQuote: 108,
  }), 1);
});

test("forecast history keeps only the newest eight estimates", () => {
  const existing = Array.from({ length: MONEY_BANK_LIVE_KNOCKOUT_LIMIT }, (_, index) => ({
    ticksToKnockout: index + 10,
    sequence: index + 1,
  }));
  const next = appendMoneyBankKnockoutForecast(existing, {
    ticksToKnockout: 5,
    sequence: 9,
  });

  assert.equal(next.length, MONEY_BANK_LIVE_KNOCKOUT_LIMIT);
  assert.deepEqual(next.map((forecast) => forecast.ticksToKnockout), [11, 12, 13, 14, 15, 16, 17, 5]);
});
