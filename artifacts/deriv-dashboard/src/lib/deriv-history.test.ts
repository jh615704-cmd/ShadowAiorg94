import assert from "node:assert/strict";
import test from "node:test";
import { createDerivHistoryRowView, summarizeDerivHistorySession, type DerivHistoryRow } from "./deriv-history.ts";

const row = (overrides: Partial<DerivHistoryRow>): DerivHistoryRow => ({
  contract_id: "contract-1",
  account_id: "account-1",
  contract_type: "DIGITDIFF",
  symbol: "R_75",
  account_type: "demo",
  currency: "USD",
  barrier: 5,
  buy_price: 1,
  current_value: 0,
  payout: 0,
  profit: 0,
  status: "won",
  ...overrides,
});

test("session summary totals wins, losses, open stakes, and realized profit", () => {
  const summary = summarizeDerivHistorySession([
    row({ contract_id: "win", buy_price: 2, profit: 1.25, status: "won" }),
    row({ contract_id: "loss", buy_price: 1.5, profit: -1.5, status: "lost" }),
    row({ contract_id: "open", buy_price: 0.4, profit: 0, status: "open" }),
    row({ contract_id: "even", buy_price: 0.2, profit: 0, status: "sold" }),
  ]);

  assert.deepEqual(summary, {
    pnl: -0.25,
    trades: 4,
    wins: 1,
    losses: 1,
    winRate: 50,
    staked: 4.1,
  });
});

test("session summary accepts the feature's live P/L and trade count", () => {
  assert.deepEqual(
    summarizeDerivHistorySession(
      [row({ buy_price: 2, profit: 1, status: "won" })],
      -3.5,
      2,
    ),
    { pnl: -3.5, trades: 2, wins: 1, losses: 0, winRate: 100, staked: 2 },
  );
});

test("USD history profits put the sign before the US$ currency marker", () => {
  assert.equal(createDerivHistoryRowView(row({ profit: 2.5 }), "USD").profit, "+US$2.50");
  assert.equal(createDerivHistoryRowView(row({ profit: -0.35 }), "USD").profit, "-US$0.35");
});
