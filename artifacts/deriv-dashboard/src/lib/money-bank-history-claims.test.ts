import assert from "node:assert/strict";
import test from "node:test";
import {
  moneyBankHistoryClaimsKey,
  readMoneyBankHistoryClaims,
  saveMoneyBankHistoryClaims,
} from "./money-bank-history-claims.ts";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test("Money Bank history claims persist and remain scoped to the Deriv account", () => {
  const storage = createMemoryStorage();

  saveMoneyBankHistoryClaims(storage, "CR1001", ["contract-1"]);
  saveMoneyBankHistoryClaims(storage, "CR1001", ["contract-2", "contract-1"]);

  assert.deepEqual(readMoneyBankHistoryClaims(storage, "CR1001"), ["contract-1", "contract-2"]);
  assert.deepEqual(readMoneyBankHistoryClaims(storage, "CR2002"), []);
});

test("malformed saved Money Bank claims are ignored without breaking history loading", () => {
  const storage = createMemoryStorage();
  storage.values.set(moneyBankHistoryClaimsKey("CR1001"), "{");

  assert.deepEqual(readMoneyBankHistoryClaims(storage, "CR1001"), []);
});
