export type BulkTraderContractType =
  | "DIGITOVER"
  | "DIGITUNDER"
  | "DIGITDIFF";

export function buildBulkTraderOrderData(input: {
  amount: number;
  duration: number;
  contractType: BulkTraderContractType;
  barrier: number;
  symbol: string;
  count: number;
}) {
  return {
    access_feature: "bulk-trader" as const,
    amount: input.amount,
    duration: input.duration,
    duration_unit: "t" as const,
    contract_type: input.contractType,
    barrier: input.barrier,
    symbol: input.symbol,
    count: input.count,
  };
}
