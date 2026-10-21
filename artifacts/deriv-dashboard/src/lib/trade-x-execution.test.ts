import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireTradeXActionLock,
  buildTradeXOrderData,
  releaseTradeXActionLock,
} from "./trade-x-execution.ts";

test("Trade X preserves every selected 1–5 tick duration in the Deriv order", () => {
  for (const duration of [1, 2, 3, 4, 5]) {
    assert.deepEqual(buildTradeXOrderData({
      stake: 0.75,
      duration,
      digit: 4,
      symbol: "R_75",
    }), {
      access_feature: "trade-x",
      amount: 0.75,
      duration,
      duration_unit: "t",
      contract_type: "DIGITDIFF",
      barrier: 4,
      symbol: "R_75",
      count: 1,
    });
  }
});

test("Trade X cannot acquire a second local action or overlap another shared buy", () => {
  const lock = { current: false };
  assert.equal(acquireTradeXActionLock(lock, false), "acquired");
  assert.equal(acquireTradeXActionLock(lock, false), "already-sending");
  assert.equal(lock.current, true);

  releaseTradeXActionLock(lock);
  assert.equal(acquireTradeXActionLock(lock, true), "shared-buy-pending");
  assert.equal(lock.current, false);
  assert.equal(acquireTradeXActionLock(lock, false), "acquired");
});
