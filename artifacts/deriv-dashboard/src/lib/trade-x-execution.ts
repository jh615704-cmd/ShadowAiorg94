import type { DerivHistoryRow } from "./deriv-history.ts";

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
    amount: Number((Math.round((input.stake + Number.EPSILON) * 100) / 100).toFixed(2)),
    duration: input.duration,
    duration_unit: "t",
    contract_type: "DIGITDIFF",
    barrier: input.digit,
    symbol: input.symbol,
    count: 1,
  };
}

export function buildTradeXPendingHistoryRow(input: {
  buy: {
    contract_id: string;
    buy_price: number;
    payout: number;
    start_time?: number | null;
  };
  account: { id: string; type: string; currency: string };
  symbol: string;
  digit: number;
  duration: number;
  nowEpoch: number;
}): DerivHistoryRow {
  return {
    contract_id: String(input.buy.contract_id),
    account_id: input.account.id,
    account_type: input.account.type,
    currency: input.account.currency,
    contract_type: "DIGITDIFF",
    barrier: input.digit,
    symbol: input.symbol,
    duration: input.duration,
    duration_unit: "t",
    buy_price: input.buy.buy_price,
    current_value: input.buy.buy_price,
    payout: input.buy.payout,
    profit: 0,
    status: "open",
    buy_time: input.buy.start_time ?? input.nowEpoch,
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
