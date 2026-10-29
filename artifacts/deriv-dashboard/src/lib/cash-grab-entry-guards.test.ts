import assert from "node:assert/strict";
import test from "node:test";
import {
  getCashGrabEntryBlockReason,
  getCashGrabStartConfigError,
  type CashGrabEntryPreflight,
} from "./cash-grab-entry-guards.ts";

const supportedSymbols = ["R_75", "JD25"];

const validConfig = {
  contractFamily: "rise-fall",
  direction: "CALL",
  symbol: "R_75",
  stake: 0.35,
  duration: 1,
  stakeMode: "flat",
  multiplier: 2,
  takeProfit: 1,
  lossLimit: 1,
};

const validEntry: CashGrabEntryPreflight = {
  connectionReady: true,
  selectedAccountId: "account-1",
  sessionAccountId: "account-1",
  symbol: "R_75",
  supportedSymbols,
  stake: 0.35,
  balance: 10,
  activeContractCount: 0,
  sessionPnl: 0,
  takeProfit: 1,
  lossLimit: 1,
};

test("Cash Grab accepts supported Rise/Fall setups and zero disables either limit", () => {
  assert.equal(getCashGrabStartConfigError(validConfig, supportedSymbols), null);
  assert.equal(
    getCashGrabStartConfigError({ ...validConfig, takeProfit: 0, lossLimit: 0 }, supportedSymbols),
    null,
  );
});

test("Cash Grab rejects invalid setup and limit values before starting", () => {
  assert.match(
    getCashGrabStartConfigError({ ...validConfig, symbol: "UNKNOWN" }, supportedSymbols) ?? "",
    /supported Cash Grab market/,
  );
  assert.match(
    getCashGrabStartConfigError({ ...validConfig, duration: 6 }, supportedSymbols) ?? "",
    /duration from 1 to 5/,
  );
  assert.match(
    getCashGrabStartConfigError({ ...validConfig, stake: Number.POSITIVE_INFINITY }, supportedSymbols) ?? "",
    /stake of at least 0\.35/,
  );
  assert.match(
    getCashGrabStartConfigError({ ...validConfig, multiplier: Number.NaN }, supportedSymbols) ?? "",
    /finite Cash Grab multiplier/,
  );
  assert.match(
    getCashGrabStartConfigError({ ...validConfig, lossLimit: -1 }, supportedSymbols) ?? "",
    /loss limit must be zero or greater/,
  );
});

test("Cash Grab entry preflight allows a fresh, affordable, single-slot entry", () => {
  assert.equal(getCashGrabEntryBlockReason(validEntry), null);
});

test("Cash Grab entry preflight blocks disconnected or changed-account sessions", () => {
  assert.equal(
    getCashGrabEntryBlockReason({ ...validEntry, connectionReady: false }),
    "connection-unavailable",
  );
  assert.equal(
    getCashGrabEntryBlockReason({ ...validEntry, selectedAccountId: "account-2" }),
    "account-changed",
  );
});

test("Cash Grab entry preflight fails closed for missing or insufficient balance", () => {
  assert.equal(getCashGrabEntryBlockReason({ ...validEntry, balance: undefined }), "balance-unavailable");
  assert.equal(getCashGrabEntryBlockReason({ ...validEntry, balance: 0.34 }), "insufficient-balance");
});

test("Cash Grab entry preflight requires confirmed zero active contracts", () => {
  assert.equal(
    getCashGrabEntryBlockReason({ ...validEntry, activeContractCount: undefined }),
    "contract-status-unavailable",
  );
  assert.equal(
    getCashGrabEntryBlockReason({ ...validEntry, activeContractCount: 1 }),
    "contract-open",
  );
});

test("Cash Grab entry preflight stops at settled session limits and allows zero limits", () => {
  assert.equal(
    getCashGrabEntryBlockReason({ ...validEntry, sessionPnl: 1 }),
    "take-profit-limit-reached",
  );
  assert.equal(
    getCashGrabEntryBlockReason({ ...validEntry, sessionPnl: -1 }),
    "loss-limit-reached",
  );
  assert.equal(
    getCashGrabEntryBlockReason({
      ...validEntry,
      sessionPnl: 100,
      takeProfit: 0,
      lossLimit: 0,
    }),
    null,
  );
});
