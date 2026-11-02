import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMoneyBankKnockouts,
  MONEY_BANK_LIVE_KNOCKOUT_LIMIT,
} from "./money-bank-live-knockouts.ts";

test("live knockout prices require a barrier move and reset the reference after each hit", () => {
  const result = appendMoneyBankKnockouts({
    ticks: [
      { quote: 104, sequence: 1 },
      { quote: 105, sequence: 2 },
      { quote: 109, sequence: 3 },
      { quote: 110, sequence: 4 },
    ],
    barrier: 5,
    referenceQuote: 100,
    existingHits: [],
  });

  assert.deepEqual(result.hits, [
    { quote: 105, sequence: 2 },
    { quote: 110, sequence: 4 },
  ]);
  assert.equal(result.referenceQuote, 110);
});

test("live knockouts roll forward to the newest eight prices", () => {
  const result = appendMoneyBankKnockouts({
    ticks: [{ quote: 109, sequence: 9 }],
    barrier: 1,
    referenceQuote: 108,
    existingHits: Array.from({ length: 8 }, (_, index) => ({
      quote: index + 1,
      sequence: index + 1,
    })),
  });

  assert.equal(result.hits.length, MONEY_BANK_LIVE_KNOCKOUT_LIMIT);
  assert.deepEqual(result.hits.map((hit) => hit.quote), [2, 3, 4, 5, 6, 7, 8, 109]);
});

test("live knockouts use the absolute quote move for both directions", () => {
  const result = appendMoneyBankKnockouts({
    ticks: [{ quote: 95, sequence: 1 }],
    barrier: 5,
    referenceQuote: 100,
    existingHits: [],
  });

  assert.deepEqual(result.hits, [{ quote: 95, sequence: 1 }]);
});

test("live quotes do not create knockout hits while the barrier is unavailable", () => {
  const result = appendMoneyBankKnockouts({
    ticks: [{ quote: 100, sequence: 1 }, { quote: 120, sequence: 2 }],
    barrier: null,
    referenceQuote: null,
    existingHits: [],
  });

  assert.deepEqual(result.hits, []);
  assert.equal(result.referenceQuote, 120);
});
