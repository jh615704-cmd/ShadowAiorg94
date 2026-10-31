import assert from "node:assert/strict";
import test from "node:test";
import { buildBulkTraderOrderData, type BulkTraderContractType } from "./bulk-trader-order.ts";

test("Bulk Trader sends the exact selected duration for every digit type and order size", () => {
  const contractTypes: readonly BulkTraderContractType[] = ["DIGITOVER", "DIGITUNDER", "DIGITDIFF"];

  for (const contractType of contractTypes) {
    for (const duration of [1, 2, 3, 4, 5]) {
      for (const count of [1, 3]) {
        const order = buildBulkTraderOrderData({
          amount: 0.35,
          duration,
          contractType,
          barrier: 4,
          symbol: "R_75",
          count,
        });

        assert.deepEqual(order, {
          access_feature: "bulk-trader",
          amount: 0.35,
          duration,
          duration_unit: "t",
          contract_type: contractType,
          barrier: 4,
          symbol: "R_75",
          count,
        });
      }
    }
  }
});
