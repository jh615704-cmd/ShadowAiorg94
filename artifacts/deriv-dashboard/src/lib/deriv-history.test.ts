import assert from "node:assert/strict";
import test from "node:test";
import {
  createDerivHistoryRowView,
  claimConfirmedDerivContractIds,
  formatSignedDerivProfit,
  isDerivHistoryOpen,
  summarizeDerivHistorySession,
  type DerivHistoryRow,
} from "./deriv-history.ts";

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

test("history treats pending and active contracts as unsettled and excludes their provisional P/L", () => {
  const summary = summarizeDerivHistorySession([
    row({ contract_id: "won", profit: 1, status: "won" }),
    row({ contract_id: "pending", profit: 0.75, status: "pending" }),
    row({ contract_id: "active", profit: -0.25, status: "active" }),
  ]);
  assert.equal(isDerivHistoryOpen(" OPEN "), true);
  assert.equal(isDerivHistoryOpen("Pending"), true);
  assert.equal(isDerivHistoryOpen("active"), true);
  assert.equal(isDerivHistoryOpen("sold"), false);
  assert.deepEqual(
    { pnl: summary.pnl, trades: summary.trades, wins: summary.wins, losses: summary.losses, winRate: summary.winRate },
    { pnl: 1, trades: 3, wins: 1, losses: 0, winRate: 100 },
  );
});

test("history summary deduplicates contract rows and prefers complete settled Deriv results", () => {
  const won = row({ contract_id: "same", profit: 1, status: "won" });
  const summary = summarizeDerivHistorySession([won, { ...won, profit: -9 }], -9, 1);
  assert.deepEqual(
    { pnl: summary.pnl, trades: summary.trades, wins: summary.wins, losses: summary.losses },
    { pnl: 1, trades: 1, wins: 1, losses: 0 },
  );
});

test("feature ownership claims only exact Deriv-confirmed contract ids", () => {
  const edge = new Set(["older"]);
  const cashGrab = new Set<string>();
  claimConfirmedDerivContractIds(edge, ["edge-contract"]);
  claimConfirmedDerivContractIds(cashGrab, ["cash-grab-contract"]);
  assert.deepEqual([...edge].sort(), ["edge-contract", "older"]);
  assert.deepEqual([...cashGrab], ["cash-grab-contract"]);
});

test("closed zero-profit contracts are not labeled as wins", () => {
  assert.equal(createDerivHistoryRowView(row({ profit: 0, status: "closed" })).outcome, "BREAKEVEN");
});

test("USD history profits put the sign before the US$ currency marker", () => {
  assert.equal(createDerivHistoryRowView(row({ profit: 2.5 }), "USD").profit, "+US$2.50");
  assert.equal(createDerivHistoryRowView(row({ profit: -0.35 }), "USD").profit, "-US$0.35");
});

test("signed daily profit includes the signed currency amount before its outcome label", () => {
  assert.equal(formatSignedDerivProfit(2.5, "USD"), "+US$2.50");
  assert.equal(formatSignedDerivProfit(-0.35, "USD"), "-US$0.35");
  assert.equal(formatSignedDerivProfit(0, "USD"), "+US$0.00");
  assert.equal(formatSignedDerivProfit(2.5, "EUR"), "+EUR 2.50");
});
