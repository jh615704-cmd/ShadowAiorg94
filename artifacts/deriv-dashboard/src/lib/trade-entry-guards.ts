type SharedEntryInput = {
  stake: number;
  balance: number | null | undefined;
  symbol: string;
  supportedSymbols: readonly string[];
};

export function isConfirmedUnavailableDurationRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { status?: unknown; message?: unknown; data?: unknown };
  if (candidate.status !== 400) return false;

  const messages = [candidate.message];
  if (candidate.data && typeof candidate.data === "object") {
    const data = candidate.data as Record<string, unknown>;
    messages.push(data.message, data.error, data.error_description, data.detail);
  }
  return messages.some((message) =>
    typeof message === "string"
    && /offers?\s+no\s+return|not offered for (?:the )?(?:selected )?duration|trading is not offered|did not offer this (?:contract|setup)/i.test(message),
  );
}

export function isConfirmedNoContractRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; status?: unknown; data?: unknown; message?: unknown };
  if (candidate.name !== "ApiError" || typeof candidate.status !== "number") return false;
  if (
    candidate.status < 400
    || candidate.status >= 600
    || candidate.status === 401
    || candidate.status === 403
  ) {
    return false;
  }
  if (!candidate.data || typeof candidate.data !== "object") return false;
  const data = candidate.data as Record<string, unknown>;
  if (data.code === "AUTO_TRADER_2_PAUSED") return false;
  const messages = [candidate.message, data.error, data.message, data.detail];
  if (messages.some((message) => typeof message === "string" && /global trading protection/i.test(message))) {
    return false;
  }
  return data.trade_outcome === "not_sent" || data.trade_outcome === "rejected";
}

function validateStakeAndBalance(
  input: SharedEntryInput,
  count: number,
  minimumStake: number,
  feature: string,
): string | null {
  if (!Number.isFinite(input.stake) || input.stake < minimumStake) {
    return `${feature} stake must be at least ${minimumStake.toFixed(2)}.`;
  }
  const roundedStake = roundTradeStakeToCents(input.stake);
  if (!Number.isFinite(input.balance) || (input.balance ?? 0) <= 0) {
    return `${feature} is paused until the selected account balance is available.`;
  }
  if (roundedStake * count > (input.balance ?? 0)) {
    return `${feature} total stake exceeds the selected account balance.`;
  }
  if (!input.supportedSymbols.includes(input.symbol)) {
    return `${feature} market is not supported.`;
  }
  return null;
}

export function roundTradeStakeToCents(stake: number): number {
  return Number((Math.round((stake + Number.EPSILON) * 100) / 100).toFixed(2));
}

export function validateAutoTraderBatch(input: SharedEntryInput & {
  digit: number;
  duration: number;
  count: number;
}): string | null {
  if (!Number.isInteger(input.digit) || input.digit < 0 || input.digit > 9) {
    return "Auto Trader needs a Digit Differs barrier from 0 to 9.";
  }
  if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 5) {
    return "Auto Trader duration must be from 1 to 5 ticks.";
  }
  if (input.count !== 3 && input.count !== 6) {
    return "Auto Trader batch size must be 3 or 6 contracts.";
  }
  return validateStakeAndBalance(input, input.count, 0.01, "Auto Trader");
}

export function validateTradeXEntry(input: SharedEntryInput & {
  digit: number;
  duration: number;
  count: number;
}): string | null {
  if (!Number.isInteger(input.digit) || input.digit < 0 || input.digit > 9) {
    return "Trade X needs a Digit Differs barrier from 0 to 9.";
  }
  if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 5) {
    return "Trade X supports Digit Differs durations from 1 to 5 ticks.";
  }
  if (input.count !== 1) {
    return "Trade X sends one Digit Differs contract per action.";
  }
  return validateStakeAndBalance(input, input.count, 0.35, "Trade X");
}

export function validateBulkTraderEntry(input: SharedEntryInput & {
  contractType: "DIGITOVER" | "DIGITUNDER" | "DIGITDIFF";
  barrier: number;
  duration: number;
  count: number;
}): string | null {
  if (!Number.isInteger(input.barrier) || input.barrier < 0 || input.barrier > 9) {
    return "Bulk Trader needs a digit barrier from 0 to 9.";
  }
  if (input.contractType === "DIGITOVER" && input.barrier === 9) {
    return "Bulk Trader Over 9 has no winning digit. Choose a barrier from 0 to 8.";
  }
  if (input.contractType === "DIGITUNDER" && input.barrier === 0) {
    return "Bulk Trader Under 0 has no winning digit. Choose a barrier from 1 to 9.";
  }
  if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 5) {
    return "Bulk Trader supports digit-contract durations from 1 to 5 ticks.";
  }
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 6) {
    return "Bulk Trader batch size must be from 1 to 6 contracts.";
  }
  return validateStakeAndBalance(input, input.count, 0.35, "Bulk Trader");
}

export function validateEdgeEntry(input: SharedEntryInput & {
  contractType: "DIGITOVER" | "DIGITUNDER" | "DUAL";
  barrier: number;
  duration: number;
  count: number;
}): string | null {
  if (!Number.isInteger(input.barrier) || input.barrier < 0 || input.barrier > 9) {
    return "EDGE needs a digit barrier from 0 to 9.";
  }
  if (
    (input.contractType === "DIGITOVER" && input.barrier === 9)
    || (input.contractType === "DIGITUNDER" && input.barrier === 0)
    || (input.contractType === "DUAL" && (input.barrier === 0 || input.barrier === 9))
  ) {
    return "EDGE cannot use a barrier that leaves one selected contract with no possible winning digit.";
  }
  if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 5) {
    return "EDGE duration must be from 1 to 5 ticks.";
  }
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 2) {
    return "EDGE sends one contract per side, with at most two contracts in a dual entry.";
  }
  return validateStakeAndBalance(input, input.count, 0.35, "EDGE");
}
