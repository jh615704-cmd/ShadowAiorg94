export type CashGrabDirection = "CALL" | "PUT";
export type CashGrabDuration = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface CashGrabBulkBuyInput {
  amount: number;
  duration: CashGrabDuration;
  direction: CashGrabDirection;
  symbol: string;
  count: number;
}

export function buildCashGrabBulkBuyPayload(input: CashGrabBulkBuyInput) {
  if (input.direction !== "CALL" && input.direction !== "PUT") {
    throw new Error("Cash Grab supports Rise/Fall contracts only.");
  }
  if (!Number.isFinite(input.amount) || input.amount < 0.35) {
    throw new RangeError("Cash Grab stake must be finite and at least 0.35.");
  }
  if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 10) {
    throw new RangeError("Cash Grab duration must be a whole number from 1 to 10 ticks.");
  }
  if (input.count !== 1) {
    throw new RangeError("Cash Grab places one contract at a time.");
  }
  if (!input.symbol.trim()) {
    throw new Error("Cash Grab requires a market symbol.");
  }

  return {
    amount: input.amount,
    duration: input.duration,
    duration_unit: "t" as const,
    contract_type: input.direction,
    symbol: input.symbol,
    count: input.count,
  };
}