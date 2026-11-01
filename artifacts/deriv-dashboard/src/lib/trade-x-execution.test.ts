import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireTradeXActionLock,
  buildTradeXPendingHistoryRow,
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

test("Trade X rounds its stake to the same cents checked against balance", () => {
  assert.equal(buildTradeXOrderData({
    stake: 0.355,
    duration: 1,
    digit: 4,
    symbol: "R_75",
  }).amount, 0.36);
});

test("Trade X shows an acknowledged buy immediately as an open history row", () => {
  assert.deepEqual(buildTradeXPendingHistoryRow({
    buy: {
      contract_id: "contract-42",
      buy_price: 1.25,
      payout: 2.13,
      start_time: 1_800_000_000,
    },
    account: { id: "demo-1", type: "demo", currency: "USD" },
    symbol: "R_75",
    digit: 4,
    duration: 2,
    nowEpoch: 1_800_000_010,
  }), {
    contract_id: "contract-42",
    account_id: "demo-1",
    account_type: "demo",
    currency: "USD",
    contract_type: "DIGITDIFF",
    barrier: 4,
    symbol: "R_75",
    duration: 2,
    duration_unit: "t",
    buy_price: 1.25,
    current_value: 1.25,
    payout: 2.13,
    profit: 0,
    status: "open",
    buy_time: 1_800_000_000,
  });
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
