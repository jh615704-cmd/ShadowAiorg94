import { getCashGrabLimitReached } from "./cash-grab-limits.ts";

export interface CashGrabConfigForValidation {
  contractFamily: string;
  direction: string;
  symbol: string;
  stake: number;
  duration: number;
  stakeMode: string;
  multiplier: number;
  takeProfit: number;
  lossLimit: number;
}

export function getCashGrabStartConfigError(
  config: CashGrabConfigForValidation,
  supportedSymbols: readonly string[],
): string | null {
  if (config.contractFamily !== "rise-fall") return "Cash Grab supports Rise/Fall contracts only.";
  if (config.direction !== "CALL" && config.direction !== "PUT") return "Choose Rise or Fall before starting Cash Grab.";
  if (!supportedSymbols.includes(config.symbol)) return "Choose a supported Cash Grab market.";
  if (!Number.isFinite(config.stake) || config.stake < 0.35) return "Set a Cash Grab stake of at least 0.35.";
  if (!Number.isInteger(config.duration) || config.duration < 1 || config.duration > 5) {
    return "Choose a Cash Grab duration from 1 to 5 ticks.";
  }
  if (config.stakeMode !== "flat" && config.stakeMode !== "multiply") return "Choose a valid Cash Grab stake mode.";
  if (!Number.isFinite(config.multiplier) || config.multiplier < 0.01) return "Set a finite Cash Grab multiplier of at least 0.01.";
  if (!Number.isFinite(config.takeProfit) || config.takeProfit < 0) return "Cash Grab take-profit must be zero or greater.";
  if (!Number.isFinite(config.lossLimit) || config.lossLimit < 0) return "Cash Grab loss limit must be zero or greater.";
  return null;
}

export type CashGrabEntryBlockReason =
  | "connection-unavailable"
  | "account-unavailable"
  | "account-unbound"
  | "account-changed"
  | "market-unsupported"
  | "stake-invalid"
  | "balance-unavailable"
  | "insufficient-balance"
  | "contract-status-unavailable"
  | "contract-open"
  | "take-profit-limit-reached"
  | "loss-limit-reached"
  | "session-pnl-invalid"
  | null;

export interface CashGrabEntryPreflight {
  connectionReady: boolean;
  selectedAccountId: string | null;
  sessionAccountId: string | null;
  symbol: string;
  supportedSymbols: readonly string[];
  stake: number;
  balance: number | null | undefined;
  activeContractCount: number | null | undefined;
  sessionPnl: number;
  takeProfit: number;
  lossLimit: number;
}

export function getCashGrabEntryBlockReason(
  input: CashGrabEntryPreflight,
): CashGrabEntryBlockReason {
  if (!input.connectionReady) return "connection-unavailable";
  if (!input.selectedAccountId) return "account-unavailable";
  if (!input.sessionAccountId) return "account-unbound";
  if (input.selectedAccountId !== input.sessionAccountId) return "account-changed";
  if (!input.supportedSymbols.includes(input.symbol)) return "market-unsupported";
  if (!Number.isFinite(input.stake) || input.stake < 0.35) return "stake-invalid";
  if (typeof input.balance !== "number" || !Number.isFinite(input.balance) || input.balance < 0) {
    return "balance-unavailable";
  }
  if (input.stake > input.balance) return "insufficient-balance";
  if (
    typeof input.activeContractCount !== "number"
    || !Number.isInteger(input.activeContractCount)
    || input.activeContractCount < 0
  ) {
    return "contract-status-unavailable";
  }
  if (input.activeContractCount > 0) return "contract-open";

  try {
    const limitReached = getCashGrabLimitReached(input.sessionPnl, input.takeProfit, input.lossLimit);
    if (limitReached === "take-profit") return "take-profit-limit-reached";
    if (limitReached === "loss-limit") return "loss-limit-reached";
  } catch {
    return "session-pnl-invalid";
  }
  return null;
}
