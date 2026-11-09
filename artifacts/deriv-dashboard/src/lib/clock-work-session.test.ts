import assert from "node:assert/strict";
import test from "node:test";
import { getClockWorkNextStake, getClockWorkRunSummary } from "./clock-work-session.ts";
import { getLossLimitRunwayMessage } from "./loss-runway.ts";

const row = (
  contract_id: string,
  account_id: string,
  status: string,
  profit: number,
) => ({ contract_id, account_id, status, profit });

test("Clock Work run P&L counts only settled acknowledged contracts for its account", () => {
  const summary = getClockWorkRunSummary([
    row("closed-run-trade", "account-1", "won", 2.35),
    row("open-run-trade", "account-1", "open", -8),
    row("closed-old-trade", "account-1", "lost", -4),
    row("same-id-other-account", "account-2", "won", 50),
  ], "account-1", new Set(["closed-run-trade", "open-run-trade", "missing-run-trade"]));

  assert.deepEqual(summary.rows.map((trade) => trade.contract_id), ["closed-run-trade", "open-run-trade"]);
  assert.equal(summary.pnl, 2.35, "Open mark-to-market profit and unrelated rows must not affect realized P&L.");
  assert.equal(summary.hasUnsettled, true, "A missing or open acknowledged result must block the next entry.");
});

test("Clock Work considers a run reconciled only after every acknowledged contract settles", () => {
  const summary = getClockWorkRunSummary([
    row("closed-run-trade", "account-1", "won", 1.5),
  ], "account-1", new Set(["closed-run-trade"]));

  assert.equal(summary.pnl, 1.5);
  assert.equal(summary.hasUnsettled, false);
});

test("clearing visible Clock Work history does not hide a settled run result from accounting", () => {
  const authoritativeHistory = [
    row("cleared-run-trade", "account-1", "won", 1.5),
  ];
  const visibleFeatureHistory: typeof authoritativeHistory = [];
  const summary = getClockWorkRunSummary(
    authoritativeHistory,
    "account-1",
    new Set(["cleared-run-trade"]),
  );

  assert.deepEqual(visibleFeatureHistory, [], "The clear action may hide the settled history row.");
  assert.deepEqual(summary.rows.map((trade) => trade.contract_id), ["cleared-run-trade"]);
  assert.equal(summary.pnl, 1.5);
  assert.equal(summary.hasUnsettled, false, "A hidden settled row must not block Clock Work controls.");
});

test("Clock Work run P&L is unavailable when a settled profit is invalid", () => {
  const summary = getClockWorkRunSummary([
    row("bad-run-trade", "account-1", "closed", Number.NaN),
  ], "account-1", new Set(["bad-run-trade"]));

  assert.equal(Number.isNaN(summary.pnl), true);
});

test("Clock Work multiplies after each settled loss and resets to base after a win", () => {
  const rows = [
    row("fourth", "account-1", "lost", -1),
    row("third", "account-1", "won", 1),
    row("second", "account-1", "lost", -1),
    row("first", "account-1", "lost", -1),
  ].map((trade) => ({
    ...trade,
    contract_type: "HIGHER",
    symbol: "R_75",
    account_type: "demo",
    barrier: 0,
    duration: 5,
    duration_unit: "t",
    buy_price: 1.25,
    current_value: 0,
    payout: 0,
    currency: "USD",
  }));

  assert.equal(
    getClockWorkNextStake(rows, new Set(["first", "second"]), 1.25, 1.5),
    2.82,
    "Consecutive settled losses compound the multiplier and round the next stake to cents.",
  );
  assert.equal(
    getClockWorkNextStake(rows, new Set(["first", "second", "third", "fourth"]), 1.25, 1.5),
    1.88,
    "Two losses multiply in sequence, then a win resets the base before the next loss.",
  );
});

test("Clock Work loss runway changes after a loss and resets stake progression after a win", () => {
  const trade = (
    contract_id: string,
    status: string,
    profit: number,
    buy_price: number,
  ) => ({
    contract_id,
    account_id: "account-1",
    status,
    profit,
    contract_type: "HIGHER",
    symbol: "R_75",
    account_type: "demo",
    barrier: 0,
    duration: 5,
    duration_unit: "t",
    buy_price,
    current_value: 0,
    payout: 0,
    currency: "USD",
  });
  const loss = trade("loss", "lost", -1, 1);
  const lossIds = new Set(["loss"]);
  const stakeAfterLoss = getClockWorkNextStake([loss], lossIds, 1, 2);
  assert.equal(stakeAfterLoss, 2);
  assert.equal(getLossLimitRunwayMessage({
    balance: null,
    baseStake: 1,
    nextStake: stakeAfterLoss!,
    stakeMode: "multiply",
    multiplier: 2,
    takeProfit: 0,
    lossLimit: 100,
    sessionPnl: -1,
  }, "USD"), "6 consecutive full-stake losses could reach the $100.00 session loss limit.");

  const win = trade("win", "won", 2, 2);
  const settledRows = [loss, win];
  const stakeAfterWin = getClockWorkNextStake(
    settledRows,
    new Set(["loss", "win"]),
    1,
    2,
  );
  assert.equal(stakeAfterWin, 1);
  assert.equal(getLossLimitRunwayMessage({
    balance: null,
    baseStake: 1,
    nextStake: stakeAfterWin!,
    stakeMode: "multiply",
    multiplier: 2,
    takeProfit: 0,
    lossLimit: 100,
    sessionPnl: settledRows.reduce((total, row) => total + row.profit, 0),
  }, "USD"), "7 consecutive full-stake losses could reach the $100.00 session loss limit.");
});

test("Clock Work does not calculate the next stake from missing, open, or invalid results", () => {
  const openTrade = {
    ...row("open", "account-1", "open", -5),
    contract_type: "HIGHER",
    symbol: "R_75",
    account_type: "demo",
    barrier: 0,
    duration: 5,
    duration_unit: "t",
    buy_price: 1,
    current_value: 0,
    payout: 0,
    currency: "USD",
  };

  assert.equal(getClockWorkNextStake([], new Set(), 1, 2), 1);
  assert.equal(getClockWorkNextStake([openTrade], new Set(["open"]), 1, 2), null);
  assert.equal(getClockWorkNextStake([], new Set(["missing"]), 1, 2), null);
  assert.equal(getClockWorkNextStake([], new Set(), 1, 0.5), null);
});
