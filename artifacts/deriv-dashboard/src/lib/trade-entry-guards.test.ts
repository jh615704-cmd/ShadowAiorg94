import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmedNoContractRetryMessage,
  isConfirmedNoContractRejection,
  isConfirmedUnavailableDurationRejection,
  roundTradeStakeToCents,
  unavailableDurationRetryMessage,
  validateAutoTraderBatch,
  validateBulkTraderEntry,
  validateEdgeEntry,
  validateTradeXEntry,
} from "./trade-entry-guards.ts";

const symbols = ["R_10", "JD10"];

test("only an explicit unavailable-duration 400 is safe for automatic retry", () => {
  assert.equal(isConfirmedUnavailableDurationRejection({
    status: 400,
    message: "Deriv did not offer this contract for the selected duration.",
    data: { error: "This contract offers no return." },
  }), true);
  assert.equal(isConfirmedUnavailableDurationRejection({
    status: 500,
    message: "Trading is not offered for this duration.",
  }), false);
  assert.equal(isConfirmedUnavailableDurationRejection({
    status: 400,
    message: "The trade could not be confirmed.",
    data: { error: "Account history is temporarily unavailable." },
  }), false);
  assert.equal(isConfirmedUnavailableDurationRejection(new Error("Trading is not offered for this duration.")), false);
  assert.equal(
    unavailableDurationRetryMessage("Auto Trader 2.0"),
    "Trading is not offered for this duration. No contract was accepted. Auto Trader 2.0 remains active and will check again.",
  );
});

test("only explicit API rejections with no accepted contract are safe to retry", () => {
  assert.equal(isConfirmedNoContractRejection({
    name: "ApiError",
    status: 400,
    data: { trade_outcome: "not_sent" },
  }), true);
  assert.equal(isConfirmedNoContractRejection({
    name: "ApiError",
    status: 429,
    data: { trade_outcome: "rejected" },
  }), true);
  assert.equal(isConfirmedNoContractRejection({
    name: "ApiError",
    status: 409,
    data: { trade_outcome: "uncertain" },
  }), false);
  assert.equal(isConfirmedNoContractRejection({
    name: "ApiError",
    status: 403,
    data: { trade_outcome: "not_sent" },
  }), false);
  assert.equal(isConfirmedNoContractRejection({
    name: "ApiError",
    status: 409,
    data: { code: "AUTO_TRADER_2_PAUSED", trade_outcome: "not_sent" },
  }), false);
  assert.equal(isConfirmedNoContractRejection({
    name: "ResponseParseError",
    status: 400,
    data: { trade_outcome: "not_sent" },
  }), false);
  assert.equal(
    confirmedNoContractRetryMessage("EDGE"),
    "EDGE received a confirmed rejection. No contract was accepted. It remains active and will check again.",
  );
});

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
  assert.equal(validateTradeXEntry({ ...base, stake: 0.355, balance: 0.36, duration: 1 }), null);
  assert.match(String(validateTradeXEntry({ ...base, stake: Number.NaN, duration: 1 })), /stake must be at least/);
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

test("Bulk Trader validates and sends the same cent-rounded stake", () => {
  const amount = roundTradeStakeToCents(0.355);

  assert.equal(amount, 0.36);
  assert.equal(validateBulkTraderEntry({
    stake: amount,
    balance: 2.16,
    symbol: "R_10",
    supportedSymbols: symbols,
    contractType: "DIGITDIFF",
    barrier: 5,
    duration: 1,
    count: 6,
  }), null);
  assert.match(String(validateBulkTraderEntry({
    stake: amount,
    balance: 2.15,
    symbol: "R_10",
    supportedSymbols: symbols,
    contractType: "DIGITDIFF",
    barrier: 5,
    duration: 1,
    count: 6,
  })), /total stake exceeds/);
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
