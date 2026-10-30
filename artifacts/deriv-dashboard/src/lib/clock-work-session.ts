import {
  isDerivHistoryOpen,
  uniqueDerivHistoryRows,
  type DerivHistoryRow,
} from "./deriv-history.ts";

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

export function getClockWorkNextStake(
  rows: readonly DerivHistoryRow[],
  runContractIds: ReadonlySet<string>,
  baseStake: number,
  lossMultiplier: number,
): number | null {
  if (
    !Number.isFinite(baseStake)
    || baseStake < 1
    || !Number.isFinite(lossMultiplier)
    || lossMultiplier < 1
  ) return null;

  const rowsByContractId = new Map(
    uniqueDerivHistoryRows(rows).map((row) => [row.contract_id, row]),
  );
  let nextStake = Math.round((baseStake + Number.EPSILON) * 100) / 100;

  for (const contractId of runContractIds) {
    const row = rowsByContractId.get(contractId);
    if (!row || isDerivHistoryOpen(row.status) || !Number.isFinite(row.profit)) return null;

    if (row.profit < 0) {
      nextStake = Math.round((nextStake * lossMultiplier + Number.EPSILON) * 100) / 100;
      if (!Number.isFinite(nextStake) || nextStake < 1) return null;
    } else {
      nextStake = Math.round((baseStake + Number.EPSILON) * 100) / 100;
    }
  }

  return nextStake;
}
