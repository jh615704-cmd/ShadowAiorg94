import assert from "node:assert/strict";
import test from "node:test";
import {
  getCashGrabSessionSettlements,
  shouldSweepCashGrabContractsOnStop,
} from "./cash-grab-session.ts";

const historyRows = [
  { contract_id: "run-open", contract_type: "CALL", status: "open" },
  { contract_id: "run-settled", contract_type: "PUT", status: "won" },
  { contract_id: "external-settled", contract_type: "CALL", status: "lost" },
  { contract_id: "other-feature", contract_type: "DIGITEVEN", status: "won" },
  { contract_id: "already-processed", contract_type: "CALL", status: "lost" },
];

test("Cash Grab session settlements include only settled, acknowledged run contracts", () => {
  const sessionContractIds = new Set(["run-open", "run-settled", "already-processed"]);
  const processedSettlementIds = new Set(["already-processed"]);

  assert.deepEqual(
    getCashGrabSessionSettlements(historyRows, sessionContractIds, processedSettlementIds),
    [{ contract_id: "run-settled", contract_type: "PUT", status: "won" }],
  );
});

test("Cash Grab skips a contract-close sweep after a clean session-limit stop", () => {
  assert.equal(
    shouldSweepCashGrabContractsOnStop({
      activeContractCount: 0,
      buyPending: false,
      sweepPending: false,
    }),
    false,
  );
});

test("Cash Grab keeps the close sweep for active or unconfirmed work", () => {
  for (const input of [
    { activeContractCount: 1, buyPending: false, sweepPending: false },
    { activeContractCount: 0, buyPending: true, sweepPending: false },
    { activeContractCount: 0, buyPending: false, sweepPending: true },
    { activeContractCount: -1, buyPending: false, sweepPending: false },
  ]) {
    assert.equal(shouldSweepCashGrabContractsOnStop(input), true);
  }
});
