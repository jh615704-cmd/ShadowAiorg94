import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMoneyBankKnockoutForecast,
  estimateMoneyBankKnockoutTicks,
  MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES,
  MONEY_BANK_LIVE_KNOCKOUT_LIMIT,
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
