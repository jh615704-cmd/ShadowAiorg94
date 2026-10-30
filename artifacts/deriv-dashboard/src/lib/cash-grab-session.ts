import { isDerivHistoryOpen, type DerivHistoryRow } from "./deriv-history.ts";

const cashGrabContractTypes = new Set(["CALL", "PUT"]);

export function getCashGrabSessionSettlements<T extends Pick<
  DerivHistoryRow,
  "contract_id" | "contract_type" | "status"
>>(
  rows: readonly T[],
  sessionContractIds: ReadonlySet<string>,
  processedSettlementIds: ReadonlySet<string>,
): T[] {
  return rows.filter((trade) =>
    sessionContractIds.has(trade.contract_id)
    && cashGrabContractTypes.has(trade.contract_type)
    && !isDerivHistoryOpen(trade.status)
    && !processedSettlementIds.has(trade.contract_id),
  );
}

export function shouldSweepCashGrabContractsOnStop(input: {
  activeContractCount: number;
  buyPending: boolean;
  sweepPending: boolean;
}) {
  if (!Number.isInteger(input.activeContractCount) || input.activeContractCount < 0) {
    return true;
  }
  return input.activeContractCount > 0 || input.buyPending || input.sweepPending;
}
