import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceMoneyBankKnockoutEvaluation,
  appendMoneyBankKnockoutForecast,
  estimateMoneyBankKnockoutTicks,
  MONEY_BANK_LIVE_KNOCKOUT_LIMIT,
  normalizeMoneyBankKnockoutSamples,
  startMoneyBankKnockoutEvaluation,
} from "./money-bank-live-knockouts.ts";

test("keeps all valid recent knockout-duration samples", () => {
  const samples = normalizeMoneyBankKnockoutSamples([1, 5, 56, 567, 0, -2, 2.5, 9]);

  assert.deepEqual(samples, [1, 5, 56, 567, 9]);
});

test("limits knockout-duration history to the newest 200 samples", () => {
  const samples = Array.from({ length: 205 }, (_, index) => index + 1);

  assert.deepEqual(normalizeMoneyBankKnockoutSamples(samples), samples.slice(-200));
});

test("estimates remaining ticks from each rate's knockout-duration samples", () => {
  assert.equal(estimateMoneyBankKnockoutTicks({
    ticksStayedIn: [5, 56, 567],
    elapsedTicks: 0,
  }), 210);
  assert.equal(estimateMoneyBankKnockoutTicks({
    ticksStayedIn: [5, 56, 567],
    elapsedTicks: 10,
  }), 200);
});

test("returns no estimate for missing samples or invalid elapsed ticks", () => {
  assert.equal(estimateMoneyBankKnockoutTicks({ ticksStayedIn: [], elapsedTicks: 0 }), null);
  assert.equal(estimateMoneyBankKnockoutTicks({ ticksStayedIn: [0, -1], elapsedTicks: 0 }), null);
  assert.equal(estimateMoneyBankKnockoutTicks({ ticksStayedIn: [5, 56], elapsedTicks: -1 }), null);
});

test("demo evaluation uses independent barriers and historical samples by growth rate", () => {
  const evaluation = startMoneyBankKnockoutEvaluation({
    quotes: [100, 100.5, 101],
    sequence: 10,
    rates: [
      {
        growthRate: 1,
        barrier: 3,
        referenceQuote: 101,
        ticksStayedIn: [5, 15, 25],
        elapsedTicks: 0,
      },
      {
        growthRate: 2,
        barrier: 5,
        referenceQuote: 101,
        ticksStayedIn: [10, 20, 30],
        elapsedTicks: 0,
      },
    ],
  });
  const oneTickLater = advanceMoneyBankKnockoutEvaluation(evaluation, {
    quote: 103,
    sequence: 11,
  });
  const twoTicksLater = advanceMoneyBankKnockoutEvaluation(oneTickLater, {
    quote: 104,
    sequence: 12,
  });

  assert.equal(twoTicksLater[0]?.status, "hit");
  assert.equal(twoTicksLater[0]?.actualTicks, 2);
  assert.equal(twoTicksLater[0]?.estimateTicks, 15);
  assert.equal(twoTicksLater[1]?.status, "watching");
  assert.equal(twoTicksLater[1]?.actualTicks, null);
});

test("marks a barrier already crossed at test start as unscorable", () => {
  const evaluation = startMoneyBankKnockoutEvaluation({
    quotes: [100, 101, 102],
    sequence: 4,
    rates: [{
      growthRate: 1,
      barrier: 2,
      referenceQuote: 100,
      ticksStayedIn: [5, 10],
      elapsedTicks: 0,
    }],
  });

  assert.equal(evaluation[0]?.status, "unscorable");
  assert.equal(evaluation[0]?.reason, "barrier-already-crossed");
});

test("does not score demo evaluation across a missing tick", () => {
  const evaluation = startMoneyBankKnockoutEvaluation({
    quotes: [100],
    sequence: 12,
    rates: [{
      growthRate: 1,
      barrier: 3,
      referenceQuote: 100,
      ticksStayedIn: [5, 10],
      elapsedTicks: 0,
    }],
  });
  const afterGap = advanceMoneyBankKnockoutEvaluation(evaluation, {
    quote: 104,
    sequence: 14,
  });

  assert.equal(afterGap[0]?.status, "unscorable");
  assert.equal(afterGap[0]?.reason, "tick-gap");
  assert.equal(afterGap[0]?.actualTicks, null);
});

test("marks a restarted tick feed as unscorable", () => {
  const evaluation = startMoneyBankKnockoutEvaluation({
    quotes: [100],
    sequence: 12,
    rates: [{
      growthRate: 1,
      barrier: 3,
      referenceQuote: 100,
      ticksStayedIn: [5, 10],
      elapsedTicks: 0,
    }],
  });
  const afterRestart = advanceMoneyBankKnockoutEvaluation(evaluation, {
    quote: 101,
    sequence: 1,
  });

  assert.equal(afterRestart[0]?.status, "unscorable");
  assert.equal(afterRestart[0]?.reason, "feed-restarted");
});

test("forecast history retains the newest eight estimates", () => {
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
