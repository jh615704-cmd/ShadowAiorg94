export type TradeXActionLock = { current: boolean };

export type TradeXOrderData = {
  access_feature: "trade-x";
  amount: number;
  duration: number;
  duration_unit: "t";
  contract_type: "DIGITDIFF";
  barrier: number;
  symbol: string;
  count: 1;
};

export function buildTradeXOrderData(input: {
  stake: number;
  duration: number;
  digit: number;
  symbol: string;
}): TradeXOrderData {
  return {
    access_feature: "trade-x",
    amount: input.stake,
    duration: input.duration,
    duration_unit: "t",
    contract_type: "DIGITDIFF",
    barrier: input.digit,
    symbol: input.symbol,
    count: 1,
  };
}

export type TradeXLockResult = "acquired" | "already-sending" | "shared-buy-pending";

export function acquireTradeXActionLock(
  lock: TradeXActionLock,
  sharedBuyPending: boolean,
): TradeXLockResult {
  if (lock.current) return "already-sending";
  if (sharedBuyPending) return "shared-buy-pending";
  lock.current = true;
  return "acquired";
}

export function releaseTradeXActionLock(lock: TradeXActionLock) {
  lock.current = false;
}
