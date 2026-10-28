import { isDerivHistoryOpen } from "./deriv-history.ts";

export type DigitFlipSettlementRecord = {
  contract_id: string | number;
  contract_type: string;
  status: string;
  buy_time?: number | null;
};

export function unprocessedDigitFlipSettlements<T extends DigitFlipSettlementRecord>(
  rows: readonly T[],
  claimedContractIds: ReadonlySet<string>,
  knownIds: ReadonlySet<string>,
  processedIds: ReadonlySet<string>,
): T[] {
  return rows
    .filter((trade) => {
      const contractId = String(trade.contract_id);
      return (
        (trade.contract_type === "DIGITEVEN" || trade.contract_type === "DIGITODD")
        && claimedContractIds.has(contractId)
        && !knownIds.has(contractId)
        && !processedIds.has(contractId)
        && !isDerivHistoryOpen(trade.status)
      );
    })
    .sort((left, right) => (left.buy_time ?? 0) - (right.buy_time ?? 0));
}
