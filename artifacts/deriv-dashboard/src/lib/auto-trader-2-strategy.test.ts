import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseAutoTrader2Candidate,
  updateAutoTrader2LossState,
  updateAutoTrader2Recovery,
  type AutoTrader2LossState,
} from "./auto-trader-2-strategy.ts";

const signal = (symbol: string, digits: number[], overrides: Record<string, unknown> = {}) => ({
  symbol,
  sample_count: digits.length,
  recent_digits: digits,
  recent_quotes: Array.from({ length: digits.length + 1 }, (_, index) => 100 + index),
  rise_percentage: 50,
  fall_percentage: 50,
  ...overrides,
});

test("AI 2 waits until there is enough recent sample and observed edge", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_10", Array(19).fill(1))],
    family: "even-odd",
    preferredType: "DIGITEVEN",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: false,
  });
  assert.equal(candidate, null);
});

test("AI 2 ranks the strongest even/odd observation for the selected market", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_10", [...Array(17).fill(2), ...Array(4).fill(1)])],
    family: "even-odd",
    preferredType: "DIGITEVEN",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: false,
  });
  assert.equal(candidate?.contractType, "DIGITEVEN");
  assert.equal(candidate?.observedRate, 80);
});

test("Auto-select compares candidates across markets while manual selection stays scoped", () => {
  const signals = [
    signal("R_10", [...Array(13).fill(1), ...Array(8).fill(2)]),
    signal("R_25", [...Array(19).fill(2), ...Array(2).fill(1)]),
  ];
  const selected = chooseAutoTrader2Candidate({
    signals,
    family: "even-odd",
    preferredType: "DIGITEVEN",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: true,
  });
  assert.equal(selected?.symbol, "R_25");

  const manual = chooseAutoTrader2Candidate({
    signals,
    family: "even-odd",
    preferredType: "DIGITEVEN",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: false,
  });
  assert.equal(manual?.symbol, "R_10");
});

test("Differs chooses a barrier with a sufficiently low observed frequency", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_75", [1, 0, 0, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9])],
    family: "differs",
    preferredType: "DIGITDIFF",
    barrier: 7,
    selectedMarket: "R_75",
    autoSelect: false,
  });
  assert.equal(candidate?.contractType, "DIGITDIFF");
  assert.equal(candidate?.barrier, 1);
});

test("Recovery candidates exclude Differs and consider Rise/Fall and Even/Odd", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_50", [...Array(12).fill(4), ...Array(9).fill(3)], {
      rise_percentage: 70,
      fall_percentage: 30,
    })],
    family: "recovery",
    preferredType: "DIGITDIFF",
    barrier: 3,
    selectedMarket: "R_50",
    autoSelect: false,
  });
  assert.equal(candidate?.contractType, "CALL");
});

test("AI 2 pauses a direction after a third loss and retains the pause for the session", () => {
  let state: AutoTrader2LossState = { lossStreaks: {}, pausedContractTypes: [] };
  for (let loss = 0; loss < 3; loss += 1) {
    state = updateAutoTrader2LossState({
      state,
      contractType: "CALL",
      settledProfit: -1,
    });
  }
  assert.equal(state.lossStreaks.CALL, 3);
  assert.deepEqual(state.pausedContractTypes, ["CALL"]);
  assert.deepEqual(updateAutoTrader2LossState({
    state: { lossStreaks: { PUT: 2 }, pausedContractTypes: [] },
    contractType: "PUT",
    settledProfit: 0,
  }), { lossStreaks: { PUT: 2 }, pausedContractTypes: [] });

  const afterWin = updateAutoTrader2LossState({
    state,
    contractType: "PUT",
    settledProfit: 1,
  });
  assert.deepEqual(afterWin.pausedContractTypes, ["CALL"]);
  assert.equal(afterWin.lossStreaks.PUT, 0);
});

test("AI 2 waits when the alternate direction is below its observed-rate threshold", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_10", Array(20).fill(2), { rise_percentage: 70, fall_percentage: 30 })],
    family: "rise-fall",
    preferredType: "CALL",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: false,
    excludedContractTypes: ["CALL"],
  });
  assert.equal(candidate, null);
});

test("Auto-select chooses the strongest eligible alternate direction and market", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [
      signal("R_10", Array(21).fill(2), {
        rise_percentage: 70,
        fall_percentage: 30,
        recent_quotes: Array.from({ length: 22 }, (_, index) => 100 + index),
      }),
      signal("R_25", Array(21).fill(2), {
        rise_percentage: 42,
        fall_percentage: 58,
        recent_quotes: Array.from({ length: 101 }, (_, index) =>
          index <= 58 ? 100 - index : 42 + index - 58,
        ),
      }),
    ],
    family: "rise-fall",
    preferredType: "CALL",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: true,
    excludedContractTypes: ["CALL"],
  });
  assert.equal(candidate?.contractType, "PUT");
  assert.equal(candidate?.symbol, "R_25");
  assert.equal(candidate?.observedRate, 58);
});

test("a weak even/odd alternative is not traded after its stronger parity is paused", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_50", [...Array(16).fill(2), ...Array(5).fill(1)])],
    family: "even-odd",
    preferredType: "DIGITEVEN",
    barrier: 0,
    selectedMarket: "R_50",
    autoSelect: false,
    excludedContractTypes: ["DIGITEVEN"],
  });
  assert.equal(candidate, null);
});

test("Rise/Fall scoring uses the selected multi-tick expiry outcome", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_10", Array(20).fill(2), {
      recent_quotes: [100, 101, 99, 98, 100, 97],
    })],
    family: "rise-fall",
    preferredType: "CALL",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: false,
    duration: 2,
    minimumSample: 3,
  });
  assert.equal(candidate?.contractType, "PUT");
  assert.equal(candidate?.observedRate, 75);
});

test("a Differs loss enters recovery even when earlier wins leave session P/L positive", () => {
  const recovery = updateAutoTrader2Recovery({
    state: { active: false, targetPnl: null },
    contractType: "DIGITDIFF",
    settledProfit: -1,
    pnlBefore: 5,
    pnlAfter: 4,
    aiEnabled: true,
  });

  assert.deepEqual(recovery, { active: true, targetPnl: 5 });
});

test("recovery stays active until P/L exceeds the pre-loss level", () => {
  const state = { active: true, targetPnl: 5 };
  assert.deepEqual(updateAutoTrader2Recovery({
    state,
    contractType: "CALL",
    settledProfit: 1,
    pnlBefore: 4,
    pnlAfter: 5,
    aiEnabled: true,
  }), { active: true, targetPnl: 5 });
  assert.deepEqual(updateAutoTrader2Recovery({
    state,
    contractType: "DIGITEVEN",
    settledProfit: 0.2,
    pnlBefore: 5,
    pnlAfter: 5.2,
    aiEnabled: true,
  }), { active: false, targetPnl: null });
});

test("a later Differs loss starts a new recovery target after recovery was cleared", () => {
  const recovery = updateAutoTrader2Recovery({
    state: { active: false, targetPnl: null },
    contractType: "DIGITDIFF",
    settledProfit: -0.5,
    pnlBefore: 2,
    pnlAfter: 1.5,
    aiEnabled: true,
  });
  assert.deepEqual(recovery, { active: true, targetPnl: 2 });
});

test("recovery is not started by a non-Differs loss or when AI 2 is off", () => {
  const initial = { active: false, targetPnl: null };
  assert.deepEqual(updateAutoTrader2Recovery({
    state: initial,
    contractType: "CALL",
    settledProfit: -1,
    pnlBefore: 0,
    pnlAfter: -1,
    aiEnabled: true,
  }), initial);
  assert.deepEqual(updateAutoTrader2Recovery({
    state: initial,
    contractType: "DIGITDIFF",
    settledProfit: -1,
    pnlBefore: 0,
    pnlAfter: -1,
    aiEnabled: false,
  }), initial);
});

