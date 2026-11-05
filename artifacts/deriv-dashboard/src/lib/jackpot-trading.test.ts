import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJackpotContractTypes,
  chooseJackpotBestBatch,
  chooseJackpotBestMarket,
  getJackpotNextStake,
  getJackpotStopReason,
  jackpotAutoSelectionMeetsRateThreshold,
  jackpotSelectionMeetsEntryThreshold,
  resolveJackpotPair,
  resolveJackpotSelection,
  type JackpotMarketSignal,
} from "./jackpot-trading.ts";

const signal = (values: Partial<JackpotMarketSignal> = {}): JackpotMarketSignal => ({
  symbol: "R_75",
  group: "volatility",
  tickSequence: 10,
  tickEpoch: Math.floor(Date.now() / 1000),
  risePercentage: 60,
  fallPercentage: 40,
  evenPercentage: 55,
  oddPercentage: 45,
  sampleCount: 60,
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
  assert.equal(resolveJackpotPair(signal({ sampleCount: 5 }), "AUTO", "AUTO"), null);
});

test("AUTO selection rejects stale history while manual sides remain selectable", () => {
  const stale = signal({ tickEpoch: 1 });

  assert.equal(resolveJackpotPair(stale, "AUTO", "AUTO"), null);
  assert.deepEqual(resolveJackpotPair(stale, "CALL", "DIGITEVEN"), {
    riseFallType: "CALL",
    evenOddType: "DIGITEVEN",
    riseFallRate: 60,
    evenOddRate: 55,
  });
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

test("every Jackpot batch size produces exactly the selected number of contracts", () => {
  const selection = resolveJackpotSelection(signal(), "AUTO", "AUTO", true, false);
  assert.ok(selection);
  for (let count = 1; count <= 20; count += 1) {
    assert.equal(buildJackpotContractTypes(selection, count).length, count);
  }
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
      signal({ symbol: "R_25", risePercentage: 70, evenPercentage: 65 }),
      signal({ symbol: "R_50", risePercentage: 65, evenPercentage: 69 }),
      signal({ symbol: "R_10", risePercentage: 80, evenPercentage: 90, sampleCount: 5 }),
    ],
    "volatility",
    "AUTO",
    "AUTO",
    true,
    true,
    null,
  );
  assert.equal(selected?.symbol, "R_25");
  assert.equal(selected?.contractType, "CALL");
  assert.equal(selected?.observedRate, 70);
});

test("Auto Best accepts 58 percent and rejects rates below the threshold", () => {
  const selected = chooseJackpotBestMarket(
    [signal({ risePercentage: 58, fallPercentage: 42, sampleCount: 6 })],
    "volatility",
    "AUTO",
    "AUTO",
    true,
    false,
  );
  assert.equal(selected?.observedRate, 58);
  assert.equal(
    chooseJackpotBestMarket(
      [signal({ risePercentage: 57.9, fallPercentage: 42.1, sampleCount: 6 })],
      "volatility",
      "AUTO",
      "AUTO",
      true,
      false,
    ),
    null,
  );
});

test("Auto side place selection needs six samples and at least 58 percent", () => {
  const atThreshold = resolveJackpotSelection(
    signal({ risePercentage: 58, fallPercentage: 42, sampleCount: 6 }),
    "AUTO",
    "DIGITEVEN",
    true,
    false,
  );
  const belowThreshold = resolveJackpotSelection(
    signal({ risePercentage: 57.9, fallPercentage: 42.1, sampleCount: 6 }),
    "AUTO",
    "DIGITEVEN",
    true,
    false,
  );
  const undersampled = resolveJackpotSelection(
    signal({ risePercentage: 100, fallPercentage: 0, sampleCount: 5 }),
    "AUTO",
    "DIGITEVEN",
    true,
    false,
  );

  assert.equal(jackpotAutoSelectionMeetsRateThreshold(atThreshold, "AUTO", "DIGITEVEN", true, false), true);
  assert.equal(jackpotAutoSelectionMeetsRateThreshold(belowThreshold, "AUTO", "DIGITEVEN", true, false), false);
  assert.equal(jackpotAutoSelectionMeetsRateThreshold(undersampled, "AUTO", "DIGITEVEN", true, false), false);
});

test("Jackpot manual and automatic entry sides need six fresh samples and at least 58 percent", () => {
  const qualifyingSignal = signal({
    risePercentage: 66.7,
    fallPercentage: 33.3,
    evenPercentage: 66.7,
    oddPercentage: 33.3,
    sampleCount: 6,
  });
  const qualifyingSelection = resolveJackpotSelection(
    qualifyingSignal,
    "CALL",
    "DIGITEVEN",
    true,
    true,
  );
  const weakManualSelection = resolveJackpotSelection(
    signal({ risePercentage: 50, fallPercentage: 50, sampleCount: 6 }),
    "CALL",
    "DIGITEVEN",
    true,
    false,
  );
  assert.equal(jackpotSelectionMeetsEntryThreshold(
    qualifyingSelection,
    qualifyingSignal,
    true,
    true,
  ), true);
  assert.equal(jackpotSelectionMeetsEntryThreshold(
    weakManualSelection,
    signal({ risePercentage: 50, fallPercentage: 50, sampleCount: 6 }),
    true,
    false,
  ), false);
  assert.equal(jackpotSelectionMeetsEntryThreshold(
    qualifyingSelection,
    signal({ ...qualifyingSignal, sampleCount: 5 }),
    true,
    true,
  ), false);
  assert.equal(jackpotSelectionMeetsEntryThreshold(
    qualifyingSelection,
    signal({ ...qualifyingSignal, tickEpoch: 1 }),
    true,
    true,
  ), false);
});

test("Auto Best and Jackpot AI reject stale cached market signals", () => {
  const stale = signal({
    tickEpoch: 1,
    risePercentage: 80,
    evenPercentage: 80,
  });

  assert.equal(
    chooseJackpotBestMarket([stale], "volatility", "AUTO", "AUTO"),
    null,
  );
  assert.equal(
    chooseJackpotBestBatch([stale], "volatility", "CALL", "DIGITEVEN", true, true, 2),
    null,
  );
});

test("AI bulk selection splits the total across qualifying enabled families only", () => {
  const selected = chooseJackpotBestBatch(
    [signal({ risePercentage: 75, evenPercentage: 72 })],
    "volatility",
    "AUTO",
    "AUTO",
    true,
    true,
    5,
    "R_75",
  );
  assert.deepEqual(selected?.contractTypes, ["CALL", "DIGITEVEN", "CALL", "DIGITEVEN", "CALL"]);
  assert.equal(selected?.observedRate, 73.5);

  const oneSideQualifies = chooseJackpotBestBatch(
    [signal({ risePercentage: 70, evenPercentage: 57.9 })],
    "volatility",
    "AUTO",
    "AUTO",
    true,
    true,
    3,
    "R_75",
  );
  assert.deepEqual(oneSideQualifies?.contractTypes, ["CALL", "CALL", "CALL"]);
});

test("Jackpot AI uses six samples and an observed rate of at least 58 percent", () => {
  const exactlyAtThreshold = chooseJackpotBestBatch(
    [signal({ risePercentage: 58, fallPercentage: 42, sampleCount: 6 })],
    "volatility",
    "AUTO",
    "AUTO",
    true,
    false,
    1,
    "R_75",
  );
  assert.equal(exactlyAtThreshold?.observedRate, 58);

  const belowThreshold = chooseJackpotBestBatch(
    [signal({ risePercentage: 57.9, fallPercentage: 42.1, sampleCount: 6 })],
    "volatility",
    "AUTO",
    "AUTO",
    true,
    false,
    1,
    "R_75",
  );
  assert.equal(belowThreshold, null);

  const undersampled = chooseJackpotBestBatch(
    [signal({ risePercentage: 90, fallPercentage: 10, sampleCount: 5 })],
    "volatility",
    "AUTO",
    "AUTO",
    true,
    false,
    1,
    "R_75",
  );
  assert.equal(undersampled, null);
});

test("Auto Best ranks only the selected market group and sample-backed sides", () => {
  const best = chooseJackpotBestMarket([
    signal({ symbol: "R_25", risePercentage: 72, evenPercentage: 65 }),
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
