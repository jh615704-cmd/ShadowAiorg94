import assert from "node:assert/strict";
import test from "node:test";
import {
  MATCHES_AUTO_MINIMUM_OBSERVED_RATE,
  chooseObservedMatchDigits,
  MATCHES_MINIMUM_SAMPLE_SIZE,
  MATCHES_MINIMUM_STAKE,
  rankObservedMatchDigits,
} from "./matches-analysis.ts";

test("Matches ranks observed digit frequencies and breaks ties by most recent occurrence", () => {
  const ranked = rankObservedMatchDigits([2, 7, 2, 4, 7, 2, 4, 7]);

  assert.deepEqual(ranked.slice(0, 3), [
    { digit: 7, count: 3, rate: 37.5 },
    { digit: 2, count: 3, rate: 37.5 },
    { digit: 4, count: 2, rate: 25 },
  ]);
});

test("Matches ignores invalid digits and safely returns empty-sample frequencies", () => {
  const ranked = rankObservedMatchDigits([0, -1, 10, 4.2, 9]);

  assert.equal(ranked[0].digit, 9);
  assert.equal(ranked[0].count, 1);
  assert.equal(ranked[0].rate, 50);
  assert.equal(rankObservedMatchDigits([]).every((item) => item.rate === 0), true);
});

test("Matches AI selection supports one, two, or all three ranked digits", () => {
  const ranked = rankObservedMatchDigits([5, 1, 5, 2, 1, 5, 2, 1]);

  assert.deepEqual(chooseObservedMatchDigits(ranked, 1), [1]);
  assert.deepEqual(chooseObservedMatchDigits(ranked, 2), [1, 5]);
  assert.deepEqual(chooseObservedMatchDigits(ranked, 3), [1, 5, 2]);
});

test("Matches AI only selects digits above the 10% observed-frequency baseline", () => {
  const ranked = [
    { digit: 4, count: 10, rate: 10 },
    { digit: 7, count: 13, rate: 13 },
    { digit: 2, count: 11, rate: 11 },
  ];

  assert.deepEqual(chooseObservedMatchDigits(ranked, 3), [7, 2]);
  assert.equal(MATCHES_AUTO_MINIMUM_OBSERVED_RATE, 10);
});

test("Matches exposes the requested minimum stake and stronger automatic sample floor", () => {
  assert.equal(MATCHES_MINIMUM_STAKE, 0.35);
  assert.equal(MATCHES_MINIMUM_SAMPLE_SIZE, 100);
});
