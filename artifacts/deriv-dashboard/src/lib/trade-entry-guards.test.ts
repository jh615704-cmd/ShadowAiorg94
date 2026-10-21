import assert from "node:assert/strict";
import test from "node:test";
import {
  validateAutoTraderBatch,
  validateBulkTraderEntry,
  validateEdgeEntry,
  validateTradeXEntry,
} from "./trade-entry-guards.ts";

const symbols = ["R_10", "JD10"];

test("Auto Trader accepts only valid 3x or 6x Digit Differs batches within balance", () => {
  assert.equal(validateAutoTraderBatch({
    stake: 1,
    balance: 6,
    symbol: "R_10",
    supportedSymbols: symbols,
    digit: 0,
    duration: 5,
    count: 6,
  }), null);
  assert.match(String(validateAutoTraderBatch({
    stake: 1,
    balance: 5.99,
    symbol: "R_10",
    supportedSymbols: symbols,
    digit: 0,
    duration: 5,
    count: 6,
  })), /total stake exceeds/);
  assert.match(String(validateAutoTraderBatch({
    stake: 1,
    balance: 10,
    symbol: "R_10",
    supportedSymbols: symbols,
    digit: 10,
    duration: 1,
    count: 3,
  })), /barrier/);
});

test("Trade X requires one valid Digit Differs entry and rejects unsupported duration", () => {
  const base = {
    stake: 0.35,
    balance: 2,
    symbol: "R_10",
    supportedSymbols: symbols,
    digit: 4,
    count: 1,
  };
  for (const duration of [1, 2, 3, 4, 5]) {
    assert.equal(validateTradeXEntry({ ...base, duration }), null);
  }
  assert.match(String(validateTradeXEntry({ ...base, duration: 6 })), /1 to 5/);
  assert.match(String(validateTradeXEntry({ ...base, duration: 1, count: 2 })), /one Digit Differs/);
  assert.match(String(validateTradeXEntry({ ...base, stake: 0.355, balance: 0.35, duration: 1 })), /total stake exceeds/);
  assert.match(String(validateTradeXEntry({ ...base, symbol: "UNSUPPORTED", duration: 1 })), /market is not supported/);
});

test("Bulk Trader blocks unsupported six-tick digit batches and invalid Over/Under barriers", () => {
  const base = {
    stake: 0.35,
    balance: 5,
    symbol: "R_10",
    supportedSymbols: symbols,
    barrier: 5,
    duration: 5,
    count: 6,
  };
  assert.equal(validateBulkTraderEntry({ ...base, contractType: "DIGITDIFF" }), null);
  assert.match(String(validateBulkTraderEntry({ ...base, duration: 6, contractType: "DIGITDIFF" })), /1 to 5/);
  assert.match(String(validateBulkTraderEntry({ ...base, barrier: 9, contractType: "DIGITOVER" })), /no winning digit/);
  assert.match(String(validateBulkTraderEntry({ ...base, barrier: 0, contractType: "DIGITUNDER" })), /no winning digit/);
});

test("EDGE validates its selected side, dual barriers, duration, and full exposure", () => {
  const base = {
    stake: 1,
    balance: 2,
    symbol: "R_10",
    supportedSymbols: symbols,
    barrier: 5,
    duration: 5,
    count: 2,
  };
  assert.equal(validateEdgeEntry({ ...base, contractType: "DUAL" }), null);
  for (const duration of [1, 2, 3, 4, 5]) {
    assert.equal(validateEdgeEntry({ ...base, duration, count: 1, contractType: "DIGITOVER" }), null);
  }
  assert.match(String(validateEdgeEntry({ ...base, barrier: 9, contractType: "DUAL" })), /no possible winning digit/);
  assert.match(String(validateEdgeEntry({ ...base, duration: 6, count: 1, contractType: "DIGITOVER" })), /1 to 5/);
  assert.match(String(validateEdgeEntry({ ...base, balance: 1.99, contractType: "DUAL" })), /total stake exceeds/);
});
