import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseAutoTrader2Candidate,
  chooseAutoTrader2ManualCandidate,
  getAutoTrader2OppositeType,
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

const quotesFromSteps = (count: number, steps: number[]) => {
  const quotes = [1_000];
  for (let index = 0; index < count; index += 1) {
    quotes.push(quotes[quotes.length - 1]! + steps[index % steps.length]!);
  }
  return quotes;
};

test("AI 2 rejects undersized samples and edges without confidence support", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_10", Array(50).fill(2))],
    family: "even-odd",
    preferredType: "DIGITEVEN",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: false,
  });
  assert.equal(candidate, null);

  const rawEdgeOnly = chooseAutoTrader2Candidate({
    signals: [signal("R_10", [0, ...Array(29).fill(2), ...Array(21).fill(1)])],
    family: "even-odd",
    preferredType: "DIGITEVEN",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: false,
  });
  assert.equal(rawEdgeOnly, null);
});

test("AI 2 ranks the strongest even/odd observation for the selected market", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_10", [0, ...Array(40).fill(2), ...Array(10).fill(1)])],
    family: "even-odd",
    preferredType: "DIGITEVEN",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: false,
  });
  assert.equal(candidate?.contractType, "DIGITEVEN");
  assert.equal(candidate?.observedRate, 80);
  assert.equal(candidate?.sampleCount, 50);
});

test("Auto-select compares candidates across markets while manual selection stays scoped", () => {
  const signals = [
    signal("R_10", [1, ...Array(40).fill(2), ...Array(10).fill(1)]),
    signal("R_25", [1, ...Array(90).fill(2), ...Array(10).fill(1)]),
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
  assert.equal(selected?.contractType, "DIGITEVEN");

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
    signals: [signal("R_75", [
      3,
      1, 1,
      ...Array.from({ length: 9 }, (_, index) => Array(index === 0 ? 10 : 11).fill(index === 0 ? 0 : index + 1)).flat(),
    ])],
    family: "differs",
    preferredType: "DIGITDIFF",
    barrier: 7,
    selectedMarket: "R_75",
    autoSelect: false,
  });
  assert.equal(candidate?.contractType, "DIGITDIFF");
  assert.equal(candidate?.barrier, 1);
  assert.equal(candidate?.sampleCount, 100);
});

test("Recovery candidates exclude Differs and consider Rise/Fall and Even/Odd", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_50", [3, ...Array(40).fill(4), ...Array(10).fill(3)], {
      rise_percentage: 70,
      fall_percentage: 30,
      recent_quotes: quotesFromSteps(51, [1]),
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
    signals: [signal("R_10", Array(51).fill(2), {
      rise_percentage: 70,
      fall_percentage: 30,
      recent_quotes: quotesFromSteps(50, [1]),
    })],
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
      signal("R_10", Array(51).fill(2), {
        recent_quotes: quotesFromSteps(50, [1]),
      }),
      signal("R_25", Array(101).fill(2), {
        recent_quotes: quotesFromSteps(100, [-1, -1, -1, 1]),
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
  assert.equal(candidate?.observedRate, 75);
});

test("a weak even/odd alternative is not traded after its stronger parity is paused", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_50", [1, ...Array(40).fill(2), ...Array(10).fill(1)])],
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
    signals: [signal("R_10", Array(51).fill(2), {
      recent_quotes: quotesFromSteps(51, [3, -4]),
    })],
    family: "rise-fall",
    preferredType: "CALL",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: false,
    duration: 2,
  });
  assert.equal(candidate?.contractType, "PUT");
  assert.equal(candidate?.observedRate, 100);
  assert.equal(candidate?.sampleCount, 50);
});

test("manual Auto selection chooses the higher observed Rise/Fall expiry rate", () => {
  const candidate = chooseAutoTrader2ManualCandidate({
    signals: [signal("R_10", Array(41).fill(2), {
      recent_quotes: quotesFromSteps(40, [1, 1, 1, -1]),
    })],
    family: "rise-fall",
    preferredType: "PUT",
    barrier: 0,
    autoContractType: true,
    selectedMarket: "R_10",
    autoSelect: false,
    duration: 1,
  });
  assert.equal(candidate?.contractType, "CALL");
  assert.equal(candidate?.observedRate, 75);
  assert.equal(candidate?.sampleCount, 40);
});

test("manual Auto selection chooses the higher observed Even/Odd expiry rate", () => {
  const candidate = chooseAutoTrader2ManualCandidate({
    signals: [signal("R_10", [1, ...Array(30).fill(2), ...Array(10).fill(1)])],
    family: "even-odd",
    preferredType: "DIGITODD",
    barrier: 0,
    autoContractType: true,
    selectedMarket: "R_10",
    autoSelect: false,
    duration: 1,
  });
  assert.equal(candidate?.contractType, "DIGITEVEN");
  assert.equal(candidate?.observedRate, 75);
});

test("manual Auto selection chooses the least frequent recent Differs digit", () => {
  const candidate = chooseAutoTrader2ManualCandidate({
    signals: [signal("R_10", [...Array(5).fill(0), ...Array(10).fill(1), ...Array(10).fill(2)])],
    family: "differs",
    preferredType: "DIGITDIFF",
    barrier: 1,
    autoContractType: true,
    selectedMarket: "R_10",
    autoSelect: false,
    duration: 1,
  });
  assert.equal(candidate?.barrier, 3);
  assert.equal(candidate?.observedRate, 100);
});

test("manual Auto selection waits for a sufficient sample instead of guessing", () => {
  const candidate = chooseAutoTrader2ManualCandidate({
    signals: [signal("R_10", [1, 2, 3])],
    family: "even-odd",
    preferredType: "DIGITEVEN",
    barrier: 0,
    autoContractType: true,
    selectedMarket: "R_10",
    autoSelect: false,
    duration: 1,
  });
  assert.equal(candidate, null);
});

test("a forced opposite direction takes priority over the preferred direction", () => {
  const candidate = chooseAutoTrader2Candidate({
    signals: [signal("R_10", Array(101).fill(2), {
      recent_quotes: quotesFromSteps(100, [-1, -1, -1, 1]),
    })],
    family: "rise-fall",
    preferredType: "CALL",
    barrier: 0,
    selectedMarket: "R_10",
    autoSelect: false,
    requiredContractType: "PUT",
  });
  assert.equal(candidate?.contractType, "PUT");
  assert.equal(candidate?.observedRate, 75);
});

test("paired contract families switch to the exact opposite type after a loss", () => {
  assert.equal(getAutoTrader2OppositeType("CALL"), "PUT");
  assert.equal(getAutoTrader2OppositeType("PUT"), "CALL");
  assert.equal(getAutoTrader2OppositeType("DIGITEVEN"), "DIGITODD");
  assert.equal(getAutoTrader2OppositeType("DIGITODD"), "DIGITEVEN");
  assert.equal(getAutoTrader2OppositeType("DIGITDIFF"), null);
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

