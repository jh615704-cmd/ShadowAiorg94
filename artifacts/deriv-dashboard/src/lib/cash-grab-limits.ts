export type CashGrabLimitReached = "take-profit" | "loss-limit" | null;

export function getCashGrabLimitReached(
  sessionPnl: number,
  takeProfit: number,
  lossLimit: number,
): CashGrabLimitReached {
  if (!Number.isFinite(sessionPnl)) {
    throw new RangeError("Cash Grab session P/L must be finite.");
  }
  if (!Number.isFinite(takeProfit) || takeProfit < 0) {
    throw new RangeError("Cash Grab take-profit must be zero or greater.");
  }
  if (!Number.isFinite(lossLimit) || lossLimit < 0) {
    throw new RangeError("Cash Grab loss limit must be zero or greater.");
  }

  if (takeProfit > 0 && sessionPnl >= takeProfit) return "take-profit";
  if (lossLimit > 0 && sessionPnl <= -lossLimit) return "loss-limit";
  return null;
}
