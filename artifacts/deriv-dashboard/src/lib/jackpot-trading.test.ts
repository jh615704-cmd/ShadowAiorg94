import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseJackpotBestMarket,
  getJackpotNextStake,
  getJackpotStopReason,
  resolveJackpotPair,
  type JackpotMarketSignal,
} from "./jackpot-trading.ts";

const signal = (values: Partial<JackpotMarketSignal> = {}): JackpotMarketSignal => ({
  symbol: "R_75",
  group: "volatility",
  risePercentage: 60,
  fallPercentage: 40,
  evenPercentage: 55,
  oddPercentage: 45,
  sampleCount: 40,
  ...values,
});

test("resolves each AUTO side independently using sampled rates", () => {
  assert.deepEqual(resolveJackpotPair(signal(), "AUTO", "AUTO"), {
    riseFallType: "CALL",
    evenOddType: "DIGITEVEN",
    riseFallRate: 60,
    evenOddRate: 55,
  });
});

test("does not choose AUTO sides without the minimum sample count", () => {
  assert.equal(resolveJackpotPair(signal({ sampleCount: 19 }), "AUTO", "AUTO"), null);
});

test("manual side choices remain available before a sample is collected", () => {
  assert.deepEqual(resolveJackpotPair(null, "PUT", "DIGITODD"), {
    riseFallType: "PUT",
    evenOddType: "DIGITODD",
    riseFallRate: null,
    evenOddRate: null,
  });
});

test("Auto Best ranks only the selected market group and sample-backed pairs", () => {
  const best = chooseJackpotBestMarket([
    signal({ symbol: "R_25", risePercentage: 59, evenPercentage: 55 }),
    signal({ symbol: "RDBULL", group: "bull", risePercentage: 100, evenPercentage: 100 }),
    signal({ symbol: "R_50", risePercentage: 65, evenPercentage: 60, sampleCount: 10 }),
  ], "volatility", "AUTO", "AUTO");
  assert.equal(best?.symbol, "R_25");
});

test("session limits stop additional orders once a configured threshold is reached", () => {
  assert.equal(getJackpotStopReason(5, 5, 10), "Take-profit limit reached.");
  assert.equal(getJackpotStopReason(-10, 5, 10), "Loss limit reached.");
  assert.equal(getJackpotStopReason(0, 5, 10), null);
});

test("loss multiplier applies to the next batch stake only after a net loss", () => {
  assert.equal(getJackpotNextStake(0.5, 0.5, -0.35, true, 2), 1);
  assert.equal(getJackpotNextStake(0.5, 1, 0.25, true, 2), 0.5);
  assert.equal(getJackpotNextStake(0.5, 0.5, -0.35, false, 2), 0.5);
});
