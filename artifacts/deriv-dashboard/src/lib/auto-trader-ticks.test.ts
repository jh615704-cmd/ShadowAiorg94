import assert from "node:assert/strict";
import test from "node:test";
import { collectAutoTraderTickChanges, getAutoTraderOppositeDigitGroup } from "./auto-trader-ticks.ts";

test("Auto Trader counts each pushed live tick once", () => {
  const seenTicks = { R_10: 20 };
  const baselineTicks = { R_10: 20 };
  const signal = { symbol: "R_10", tick_sequence: 21, recent_digits: [4, 9], tick_epoch: 1 };

  const first = collectAutoTraderTickChanges([signal], seenTicks, baselineTicks);
  const duplicate = collectAutoTraderTickChanges([signal], seenTicks, baselineTicks);

  assert.deepEqual(first.arrivals, [{ symbol: "R_10", digit: 9 }]);
  assert.equal(first.progress.R_10, 1);
  assert.deepEqual(duplicate.arrivals, []);
  assert.equal(duplicate.progress.R_10, 1);
});

test("Auto Trader reconstructs missed ticks from the latest Deriv snapshot", () => {
  const seenTicks = { R_10: 21 };
  const baselineTicks = { R_10: 20 };
  const changes = collectAutoTraderTickChanges([{
    symbol: "R_10",
    tick_sequence: 23,
    recent_digits: [4, 9, 2],
    tick_epoch: 3,
  }], seenTicks, baselineTicks);

  assert.deepEqual(changes.arrivals, [
    { symbol: "R_10", digit: 9 },
    { symbol: "R_10", digit: 2 },
  ]);
  assert.equal(changes.progress.R_10, 3);
});

test("Auto Trader resets its baseline when the Deriv runtime sequence restarts", () => {
  const seenTicks = { R_10: 50 };
  const baselineTicks = { R_10: 40 };
  const changes = collectAutoTraderTickChanges([{
    symbol: "R_10",
    tick_sequence: 1,
    recent_digits: [7],
    tick_epoch: 1,
  }], seenTicks, baselineTicks);

  assert.deepEqual(changes.arrivals, [{ symbol: "R_10", digit: 7 }]);
  assert.equal(changes.progress.R_10, 1);
  assert.equal(seenTicks.R_10, 1);
  assert.equal(baselineTicks.R_10, 0);
});

test("opposite-half advisory switches groups from the latest digit", () => {
  assert.deepEqual(getAutoTraderOppositeDigitGroup(0), {
    minDigit: 5,
    maxDigit: 9,
    label: "5–9",
  });
  assert.deepEqual(getAutoTraderOppositeDigitGroup(4), {
    minDigit: 5,
    maxDigit: 9,
    label: "5–9",
  });
  assert.deepEqual(getAutoTraderOppositeDigitGroup(5), {
    minDigit: 0,
    maxDigit: 4,
    label: "0–4",
  });
  assert.deepEqual(getAutoTraderOppositeDigitGroup(9), {
    minDigit: 0,
    maxDigit: 4,
    label: "0–4",
  });
  assert.equal(getAutoTraderOppositeDigitGroup(null), null);
  assert.equal(getAutoTraderOppositeDigitGroup(10), null);
});
