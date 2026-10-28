import assert from "node:assert/strict";
import test from "node:test";
import {
  clampEdgeMultiplier,
  estimateEdgeWipeout,
  getEdgeHistoricalSampleCount,
  getEdgeObservedContractOdds,
  getEdgeObservedOdds,
} from "./edge-risk.ts";

test("EDGE estimates consecutive losses until its session loss limit", () => {
  assert.deepEqual(
    estimateEdgeWipeout({
      balance: 100,
      baseStake: 1,
      currentStake: 1,
      strategy: "martingale",
      multiplier: 2,
      takeProfit: 10,
      stopLoss: 10,
      sessionPnl: 0,
    }),
    { losses: 4, limit: "session-loss-limit" },
  );
});

test("EDGE limits the loss count by account funds and does not overstate depletion", () => {
  assert.deepEqual(
    estimateEdgeWipeout({
      balance: 100,
      baseStake: 1,
      currentStake: 1,
      strategy: "martingale",
      multiplier: 2,
      takeProfit: 200,
      stopLoss: 200,
      sessionPnl: 0,
    }),
    { losses: 6, limit: "account-balance" },
  );
});

test("EDGE flat-stake estimate responds to current P/L and both thresholds", () => {
  const estimate = estimateEdgeWipeout({
    balance: 100,
    baseStake: 5,
    currentStake: 20,
    strategy: "flat",
    multiplier: 2,
    takeProfit: 30,
    stopLoss: 10,
    sessionPnl: 5,
  });
  assert.deepEqual(estimate, { losses: 3, limit: "session-loss-limit" });
});

test("EDGE reports an already-reached session target before estimating entries", () => {
  assert.deepEqual(
    estimateEdgeWipeout({
      balance: 100,
      baseStake: 1,
      currentStake: 1,
      strategy: "martingale",
      multiplier: 2,
      takeProfit: 10,
      stopLoss: 10,
      sessionPnl: 10,
    }),
    { losses: 0, limit: "profit-target-reached" },
  );
  assert.deepEqual(
    estimateEdgeWipeout({
      balance: 100,
      baseStake: 1,
      currentStake: 1,
      strategy: "martingale",
      multiplier: 2,
      takeProfit: 10,
      stopLoss: 10,
      sessionPnl: -10,
    }),
    { losses: 0, limit: "session-loss-limit-reached" },
  );
});

test("EDGE rejects unavailable balances and invalid Martingale settings", () => {
  assert.equal(
    estimateEdgeWipeout({
      balance: null,
      baseStake: 1,
      currentStake: 1,
      strategy: "flat",
      multiplier: 1,
      takeProfit: 10,
      stopLoss: 10,
      sessionPnl: 0,
    }).limit,
    "balance-unavailable",
  );
  assert.equal(clampEdgeMultiplier(Number.NaN), 1);
  assert.equal(clampEdgeMultiplier(0.5), 1);
  assert.equal(clampEdgeMultiplier(13), 10);
  assert.equal(clampEdgeMultiplier(2.34), 2.3);
});

test("EDGE observed odds follow the selected market, digit, and direction", () => {
  const marketSignals = [
    {
      symbol: "R_75",
      sample_count: 120,
      digit_outcomes: [
        { digit: 4, over_percentage: 51.5, under_percentage: 38.2 },
      ],
    },
  ];

  assert.deepEqual(
    getEdgeObservedOdds({
      marketSignals,
      symbol: "R_75",
      digit: 4,
      direction: "DIGITUNDER",
    }),
    { winPercent: 38.2, lossPercent: 61.8, sampleCount: 120 },
  );
  assert.equal(
    getEdgeObservedOdds({
      marketSignals,
      symbol: "R_75",
      digit: 3,
      direction: "DIGITOVER",
    }),
    null,
  );
  assert.equal(
    getEdgeObservedOdds({
      marketSignals: [{ ...marketSignals[0], sample_count: 19 }],
      symbol: "R_75",
      digit: 4,
      direction: "DIGITOVER",
    }),
    null,
  );
});

test("EDGE contract history odds match the selected market, side, digit, and expiry", () => {
  const trades = Array.from({ length: 20 }, (_, index) => ({
    account_id: "demo-1",
    contract_type: "DIGITUNDER",
    symbol: "R_75",
    barrier: 4,
    duration: 3,
    duration_unit: "t",
    status: "won",
    profit: index < 15 ? 1 : -1,
  }));

  const filter = {
    trades,
    accountId: "demo-1",
    symbol: "R_75",
    digit: 4,
    direction: "DIGITUNDER" as const,
    duration: 3,
  };
  assert.equal(getEdgeHistoricalSampleCount(filter), 20);
  assert.deepEqual(getEdgeObservedContractOdds(filter), {
    winPercent: 75,
    lossPercent: 25,
    sampleCount: 20,
  });
  assert.equal(
    getEdgeHistoricalSampleCount({ ...filter, duration: 1 }),
    0,
  );
  assert.equal(
    getEdgeHistoricalSampleCount({ ...filter, accountId: "real-1" }),
    0,
  );
});
