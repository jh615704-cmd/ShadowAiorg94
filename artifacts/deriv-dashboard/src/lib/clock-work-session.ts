import { isDerivHistoryOpen, type DerivHistoryRow } from "./deriv-history.ts";

type ClockWorkRunRow = Pick<DerivHistoryRow, "account_id" | "contract_id" | "profit" | "status">;

export function getClockWorkRunSummary<T extends ClockWorkRunRow>(
  rows: readonly T[],
  accountId: string | null,
  runContractIds: ReadonlySet<string>,
): { rows: T[]; pnl: number; hasUnsettled: boolean } {
  const runRows = accountId
    ? rows.filter((row) => String(row.account_id) === accountId && runContractIds.has(row.contract_id))
    : [];
  const settledRows = runRows.filter((row) => !isDerivHistoryOpen(row.status));
  const settledIds = new Set(settledRows.map((row) => row.contract_id));
  const pnl = settledRows.reduce((total, row) => total + Number(row.profit), 0);
  const hasUnsettled = Boolean(
    accountId && [...runContractIds].some((contractId) => !settledIds.has(contractId)),
  );

  return { rows: runRows, pnl, hasUnsettled };
}
