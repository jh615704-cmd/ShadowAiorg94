import assert from "node:assert/strict";
import test from "node:test";
import {
  createDerivHistoryRowView,
  claimConfirmedDerivContractIds,
  claimDerivHistoryFeatureContractIds,
  formatSignedDerivProfit,
  isDerivHistoryOpen,
  removeSettledHistoryAcknowledgements,
  shouldShowFeatureHistoryWhenStopped,
  summarizeDerivHistorySession,
  uniqueDerivHistoryRows,
  type DerivHistoryFeature,
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
  duration: 1,
  duration_unit: "t",
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

test("history contract ownership stays exclusive per feature and Deriv account", () => {
  const owners = new Map<string, DerivHistoryFeature>();
  const edgeIds = new Set<string>();
  const tradeXIds = new Set<string>();
  const otherAccountIds = new Set<string>();

  claimDerivHistoryFeatureContractIds(owners, "account-1", "edge", edgeIds, ["contract-1"]);
  claimDerivHistoryFeatureContractIds(owners, "account-1", "trade-x", tradeXIds, ["contract-1"]);
  claimDerivHistoryFeatureContractIds(owners, "account-2", "trade-x", otherAccountIds, ["contract-1"]);

  assert.deepEqual([...edgeIds], ["contract-1"]);
  assert.deepEqual([...tradeXIds], []);
  assert.deepEqual([...otherAccountIds], ["contract-1"]);
});

test("DigitFlip history claims only its acknowledged parity contract for the selected account", () => {
  const owners = new Map<string, DerivHistoryFeature>();
  const digitFlipIds = new Set<string>();
  const cashGrabIds = new Set<string>();

  claimDerivHistoryFeatureContractIds(owners, "account-1", "digit-flip", digitFlipIds, ["even-contract"]);
  claimDerivHistoryFeatureContractIds(owners, "account-1", "cash-grab", cashGrabIds, ["even-contract"]);

  assert.deepEqual([...digitFlipIds], ["even-contract"]);
  assert.deepEqual([...cashGrabIds], []);
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

test("stopped feature history hides settled rows but remains for open or not-yet-reconciled acknowledged contracts", () => {
  const settledRows = [row({ status: "won" })];
  const openRows = [row({ status: "open" })];

  assert.equal(shouldShowFeatureHistoryWhenStopped(false, settledRows, new Set()), false);
  assert.equal(shouldShowFeatureHistoryWhenStopped(false, openRows, new Set()), true);
  assert.equal(shouldShowFeatureHistoryWhenStopped(false, [], new Set(["acknowledged-contract"])), true);
  assert.equal(shouldShowFeatureHistoryWhenStopped(true, [], new Set()), true);
});

test("acknowledged history stays visible until a settled row is actually observed", () => {
  const remaining = removeSettledHistoryAcknowledgements(
    new Set(["open-contract", "settled-contract", "not-yet-listed"]),
    [
      row({ contract_id: "open-contract", status: "active" }),
      row({ contract_id: "settled-contract", status: "won" }),
    ],
  );

  assert.deepEqual([...remaining].sort(), ["not-yet-listed", "open-contract"]);
});

test("history summary deduplicates contract rows and prefers complete settled Deriv results", () => {
  const won = row({ contract_id: "same", profit: 1, status: "won" });
  const summary = summarizeDerivHistorySession([won, { ...won }], -9, 1);
  assert.deepEqual(
    { pnl: summary.pnl, trades: summary.trades, wins: summary.wins, losses: summary.losses },
    { pnl: 1, trades: 1, wins: 1, losses: 0 },
  );
});

test("visible history deduplicates by account and contract while keeping the newest settled row", () => {
  const oldOpen = row({ contract_id: "same", status: "open", buy_time: 10 });
  const settled = row({ contract_id: "same", status: "won", profit: 1, buy_time: 10, sell_time: 12 });
  const otherAccount = row({ contract_id: "same", account_id: "account-2", status: "lost", profit: -1 });
  const uniqueRows = uniqueDerivHistoryRows([oldOpen, settled, otherAccount]);

  assert.equal(uniqueRows.length, 2);
  assert.equal(uniqueRows[0].status, "won");
  assert.equal(uniqueRows[1].account_id, "account-2");
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

test("history rows label net profit and show the amount returned after settlement", () => {
  const won = createDerivHistoryRowView(row({
    buy_price: 2,
    current_value: 4,
    payout: 4,
    profit: 2,
    status: "closed",
  }));
  assert.equal(won.resultLabel, "NET P/L");
  assert.equal(won.profit, "+US$2.00");
  assert.equal(won.details.find((detail) => detail.label === "AMOUNT RETURNED")?.value, "US$4.00");

  const open = createDerivHistoryRowView(row({ status: "open", current_value: 1.25 }));
  assert.equal(open.resultLabel, "LIVE P/L");
  assert.equal(open.details.find((detail) => detail.label === "CURRENT VALUE")?.value, "US$1.25");
});

test("signed daily profit includes the signed currency amount before its outcome label", () => {
  assert.equal(formatSignedDerivProfit(2.5, "USD"), "+US$2.50");
  assert.equal(formatSignedDerivProfit(-0.35, "USD"), "-US$0.35");
  assert.equal(formatSignedDerivProfit(0, "USD"), "+US$0.00");
  assert.equal(formatSignedDerivProfit(2.5, "EUR"), "+EUR 2.50");
});
