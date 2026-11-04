import assert from "node:assert/strict";
import test from "node:test";
import {
  addDerivHistoryClaims,
  readDerivHistoryClaims,
  removeDerivHistoryClaims,
} from "./deriv-history-claims.ts";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test("feature history claims persist by Deriv account without inferring ownership", () => {
  const storage = createMemoryStorage();

  addDerivHistoryClaims(storage, "CR1001", "jackpot", ["jackpot-1"]);
  addDerivHistoryClaims(storage, "CR1001", "bulk-trader", ["bulk-1"]);
  addDerivHistoryClaims(storage, "CR1001", "jackpot", ["jackpot-2", "jackpot-1"]);

  assert.deepEqual(readDerivHistoryClaims(storage, "CR1001").jackpot, ["jackpot-1", "jackpot-2"]);
  assert.deepEqual(readDerivHistoryClaims(storage, "CR1001")["bulk-trader"], ["bulk-1"]);
  assert.deepEqual(readDerivHistoryClaims(storage, "CR2002").jackpot, []);
});

test("clearing settled feature claims preserves unrelated feature claims", () => {
  const storage = createMemoryStorage();
  addDerivHistoryClaims(storage, "CR1001", "jackpot", ["settled", "open"]);
  addDerivHistoryClaims(storage, "CR1001", "cash-grab", ["cash-1"]);

  removeDerivHistoryClaims(storage, "CR1001", "jackpot", ["settled"]);

  assert.deepEqual(readDerivHistoryClaims(storage, "CR1001").jackpot, ["open"]);
  assert.deepEqual(readDerivHistoryClaims(storage, "CR1001")["cash-grab"], ["cash-1"]);
});

test("malformed feature history storage does not block rendering", () => {
  const storage = createMemoryStorage();
  storage.values.set("deriv-feature-history-claims:CR1001", "{");

  assert.deepEqual(readDerivHistoryClaims(storage, "CR1001").jackpot, []);
  assert.deepEqual(addDerivHistoryClaims(storage, "CR1001", "jackpot", ["contract-1"]), ["contract-1"]);
});
