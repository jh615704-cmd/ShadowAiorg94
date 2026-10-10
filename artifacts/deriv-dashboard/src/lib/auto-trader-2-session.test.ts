import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAutoTrader2SavedSession,
  reconcileAutoTrader2SavedSession,
  requiresAutoTrader2SessionReview,
  type AutoTrader2SavedSession,
} from "./auto-trader-2-session.ts";

const session = (overrides: Partial<AutoTrader2SavedSession> = {}): AutoTrader2SavedSession => ({
  version: 3,
  accountId: "VRTC123",
  phase: "ready",
  config: {
    family: "differs",
    contractType: "DIGITDIFF",
    barrier: 2,
    stake: 1,
    duration: 1,
    takeProfit: 10,
    lossLimit: 10,
    stakeMode: "flat",
    multiplier: 2,
    aiEnabled: true,
    autoSelect: true,
    selectedMarket: "R_10",
  },
  contractIds: [],
  sessionPnl: 0,
  currentStake: 1,
  recoveryTargetPnl: null,
  lossStreaks: {},
  pausedContractTypes: [],
  forcedNextType: null,
  pendingContractId: null,
  pendingContractType: null,
  pendingStake: null,
  updatedAt: 1,
  ...overrides,
});

const clearOpenContracts = {
  accountId: "VRTC123",
  ready: true,
  activeCount: 0,
};

test("saved automation state is scoped to the selected Deriv account", () => {
  const saved = session();
  assert.deepEqual(
    parseAutoTrader2SavedSession(JSON.stringify(saved), "VRTC123"),
    saved,
  );
  assert.equal(parseAutoTrader2SavedSession(JSON.stringify(saved), "CR123"), null);
});

test("legacy AI 2 recovery checkpoints migrate without losing their account scope", () => {
  const current = session();
  const {
    lossStreaks: _lossStreaks,
    pausedContractTypes: _pausedContractTypes,
    forcedNextType: _forcedNextType,
    ...legacy
  } = current;
  const parsed = parseAutoTrader2SavedSession(
    JSON.stringify({ ...legacy, version: 1 }),
    "VRTC123",
  );
  assert.deepEqual(parsed, current);
});

test("version-two checkpoints migrate with no forced direction", () => {
  const current = session();
  const { forcedNextType: _forcedNextType, ...versionTwo } = current;
  assert.deepEqual(parseAutoTrader2SavedSession(
    JSON.stringify({ ...versionTwo, version: 2 }),
    "VRTC123",
  ), current);
});

test("version-three checkpoints preserve the forced opposite direction", () => {
  const saved = session({ forcedNextType: "PUT" });
  assert.deepEqual(
    parseAutoTrader2SavedSession(JSON.stringify(saved), "VRTC123"),
    saved,
  );
});

test("a clean or completed stop does not require a manual clear before starting again", () => {
  assert.equal(requiresAutoTrader2SessionReview(session()), false);
  assert.equal(requiresAutoTrader2SessionReview(session({ phase: "completed" })), false);
  assert.equal(requiresAutoTrader2SessionReview(session({ phase: "awaiting-settlement" })), true);
  assert.equal(requiresAutoTrader2SessionReview(session({ phase: "placing" })), true);
  assert.equal(requiresAutoTrader2SessionReview(session({ phase: "manual-review" })), true);
  assert.equal(requiresAutoTrader2SessionReview(null), false);
});

test("a reload while an order is being submitted requires manual history review", () => {
  const assessment = reconcileAutoTrader2SavedSession({
    session: session({ phase: "placing" }),
    history: [],
    openContracts: clearOpenContracts,
  });
  assert.equal(assessment.kind, "uncertain");
});

test("a reload never resumes while Deriv reports an open contract", () => {
  const assessment = reconcileAutoTrader2SavedSession({
    session: session(),
    history: [],
    openContracts: { ...clearOpenContracts, activeCount: 1 },
  });
  assert.equal(assessment.kind, "waiting");
});

test("a settled Differs loss is reconciled into recovery before a session can resume", () => {
  const saved = session({
    phase: "awaiting-settlement",
    contractIds: ["c1", "c2"],
    sessionPnl: 5,
    pendingContractId: "c2",
    pendingContractType: "DIGITDIFF",
    pendingStake: 1,
  });
  const assessment = reconcileAutoTrader2SavedSession({
    session: saved,
    history: [
      { account_id: "VRTC123", contract_id: "c1", profit: 5, status: "won" },
      { account_id: "VRTC123", contract_id: "c2", profit: -1, status: "lost" },
    ],
    openContracts: clearOpenContracts,
  });
  assert.equal(assessment.kind, "ready");
  if (assessment.kind !== "ready") return;
  assert.equal(assessment.session.sessionPnl, 4);
  assert.equal(assessment.session.recoveryTargetPnl, 5);
  assert.equal(assessment.session.phase, "ready");
  assert.equal(assessment.session.pendingContractId, null);
  assert.equal(assessment.session.lossStreaks.DIGITDIFF, 1);
  assert.equal(assessment.session.forcedNextType, null);
});

test("a settled Rise loss persists Fall as the required next side", () => {
  const saved = session({
    phase: "awaiting-settlement",
    contractIds: ["c1"],
    sessionPnl: 0,
    pendingContractId: "c1",
    pendingContractType: "CALL",
    pendingStake: 1,
  });
  const assessment = reconcileAutoTrader2SavedSession({
    session: saved,
    history: [{ account_id: "VRTC123", contract_id: "c1", profit: -1, status: "lost" }],
    openContracts: clearOpenContracts,
  });
  assert.equal(assessment.kind, "ready");
  if (assessment.kind !== "ready") return;
  assert.equal(assessment.session.forcedNextType, "PUT");
});

test("a third settled loss pauses that contract type before a saved session resumes", () => {
  const saved = session({
    phase: "awaiting-settlement",
    contractIds: ["call-loss"],
    lossStreaks: { CALL: 2 },
    pendingContractId: "call-loss",
    pendingContractType: "CALL",
    pendingStake: 1,
  });
  const assessment = reconcileAutoTrader2SavedSession({
    session: saved,
    history: [{ account_id: "VRTC123", contract_id: "call-loss", profit: -1, status: "lost" }],
    openContracts: clearOpenContracts,
  });
  assert.equal(assessment.kind, "ready");
  if (assessment.kind !== "ready") return;
  assert.equal(assessment.session.lossStreaks.CALL, 3);
  assert.deepEqual(assessment.session.pausedContractTypes, ["CALL"]);
});

test("an unsettled or missing contract cannot be treated as a safe resume", () => {
  const saved = session({
    phase: "awaiting-settlement",
    contractIds: ["c1"],
    pendingContractId: "c1",
    pendingContractType: "DIGITDIFF",
    pendingStake: 1,
  });
  assert.equal(reconcileAutoTrader2SavedSession({
    session: saved,
    history: [{ account_id: "VRTC123", contract_id: "c1", profit: 0, status: "open" }],
    openContracts: clearOpenContracts,
  }).kind, "waiting");
  assert.equal(reconcileAutoTrader2SavedSession({
    session: saved,
    history: [],
    openContracts: clearOpenContracts,
  }).kind, "uncertain");
});
