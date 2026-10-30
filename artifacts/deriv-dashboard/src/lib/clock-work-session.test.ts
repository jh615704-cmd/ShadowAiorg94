import assert from "node:assert/strict";
import test from "node:test";
import { getClockWorkRunSummary } from "./clock-work-session.ts";

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

test("Clock Work run P&L is unavailable when a settled profit is invalid", () => {
  const summary = getClockWorkRunSummary([
    row("bad-run-trade", "account-1", "closed", Number.NaN),
  ], "account-1", new Set(["bad-run-trade"]));

  assert.equal(Number.isNaN(summary.pnl), true);
});
