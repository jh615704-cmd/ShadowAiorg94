import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJackpotContractTypes,
  chooseJackpotBestBatch,
  chooseJackpotBestMarket,
  getJackpotNextStake,
  getJackpotStopReason,
  resolveJackpotPair,
  resolveJackpotSelection,
  type JackpotMarketSignal,
} from "./jackpot-trading.ts";

const signal = (values: Partial<JackpotMarketSignal> = {}): JackpotMarketSignal => ({
  symbol: "R_75",
  group: "volatility",
  tickSequence: 10,
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

test("resolves only the enabled Jackpot contract family", () => {
  assert.deepEqual(
    resolveJackpotSelection(signal(), "AUTO", "DIGITODD", true, false),
    { contractTypes: ["CALL"], rates: [60] },
  );
  assert.equal(resolveJackpotSelection(signal(), "AUTO", "AUTO", false, false), null);
});

test("allocates the selected count across enabled families with no extra orders", () => {
  const selection = resolveJackpotSelection(signal(), "CALL", "DIGITEVEN", true, true);
  assert.ok(selection);
  assert.deepEqual(buildJackpotContractTypes(selection, 5), [
    "CALL",
    "DIGITEVEN",
    "CALL",
    "DIGITEVEN",
    "CALL",
  ]);
  assert.deepEqual(buildJackpotContractTypes(selection, 1), ["CALL"]);
  assert.deepEqual(buildJackpotContractTypes(selection, 21), []);
});

test("supports a 20-contract AUTO batch with only one enabled family", () => {
  const selection = resolveJackpotSelection(signal(), "AUTO", "AUTO", false, true);
  assert.ok(selection);
  assert.deepEqual(selection.contractTypes, ["DIGITEVEN"]);
  assert.deepEqual(buildJackpotContractTypes(selection, 20), Array(20).fill("DIGITEVEN"));
});

test("AI market ranking requires a live sample above its observed-rate threshold", () => {
  const selected = chooseJackpotBestMarket(
    [
      signal({ symbol: "R_25", risePercentage: 56, evenPercentage: 52 }),
      signal({ symbol: "R_50", risePercentage: 55, evenPercentage: 59 }),
      signal({ symbol: "R_10", risePercentage: 80, evenPercentage: 90, sampleCount: 19 }),
    ],
    "volatility",
    "AUTO",
    "AUTO",
    true,
    true,
    null,
    55,
  );
  assert.equal(selected?.symbol, "R_50");
  assert.equal(selected?.contractType, "DIGITEVEN");
  assert.equal(selected?.observedRate, 59);
});

test("AI bulk selection splits the total across qualifying enabled families only", () => {
  const selected = chooseJackpotBestBatch(
    [signal({ risePercentage: 60, evenPercentage: 57 })],
    "volatility",
    "AUTO",
    "AUTO",
    true,
    true,
    5,
    "R_75",
    55,
  );
  assert.deepEqual(selected?.contractTypes, ["CALL", "DIGITEVEN", "CALL", "DIGITEVEN", "CALL"]);
  assert.equal(selected?.observedRate, 58.5);

  const oneSideQualifies = chooseJackpotBestBatch(
    [signal({ risePercentage: 62, evenPercentage: 55 })],
    "volatility",
    "AUTO",
    "AUTO",
    true,
    true,
    3,
    "R_75",
    55,
  );
  assert.deepEqual(oneSideQualifies?.contractTypes, ["CALL", "CALL", "CALL"]);
});

test("Auto Best ranks only the selected market group and sample-backed sides", () => {
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
