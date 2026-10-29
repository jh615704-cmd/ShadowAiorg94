import assert from "node:assert/strict";
import test from "node:test";
import { getCashGrabSessionSettlements } from "./cash-grab-session.ts";

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
