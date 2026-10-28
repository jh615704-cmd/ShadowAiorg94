export type EdgeStakeStrategy = "flat" | "martingale";

export type EdgeWipeoutLimit =
  | "account-balance"
  | "session-loss-limit"
  | "both-limits"
  | "profit-target-reached"
  | "session-loss-limit-reached"
  | "balance-unavailable"
  | "invalid-input"
  | "calculation-cap";

export type EdgeWipeoutEstimate = {
  losses: number | null;
  limit: EdgeWipeoutLimit;
};

export type EdgeObservedOdds = {
  winPercent: number;
  lossPercent: number;
  sampleCount: number;
};

export type EdgeSettledTradeOddsRow = {
  account_id?: string;
  contract_type: string;
  symbol: string;
  barrier: number | null;
  duration: number | null;
  duration_unit: string | null;
  status: string;
  profit: number;
};

export const EDGE_WIPEOUT_MIN_SAMPLE_COUNT = 20;

const MAX_ESTIMATED_LOSSES = 10_000;
const OPEN_TRADE_STATUSES = new Set(["open", "pending", "active"]);

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function clampEdgeMultiplier(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.min(10, Math.max(1, value)) * 10) / 10;
}

export function estimateEdgeWipeout(input: {
  balance: number | null | undefined;
  baseStake: number;
  currentStake: number;
  strategy: EdgeStakeStrategy;
  multiplier: number;
  takeProfit: number;
  stopLoss: number;
  sessionPnl: number;
}): EdgeWipeoutEstimate {
  const {
    balance,
    baseStake,
    currentStake,
    strategy,
    multiplier,
    takeProfit,
    stopLoss,
    sessionPnl,
  } = input;

  if (
    !Number.isFinite(baseStake)
    || baseStake < 0.35
    || !Number.isFinite(currentStake)
    || currentStake < 0.35
    || !Number.isFinite(multiplier)
    || multiplier < 1
    || multiplier > 10
    || !Number.isFinite(takeProfit)
    || takeProfit <= 0
    || !Number.isFinite(stopLoss)
    || stopLoss <= 0
    || !Number.isFinite(sessionPnl)
    || (strategy !== "flat" && strategy !== "martingale")
  ) {
    return { losses: null, limit: "invalid-input" };
  }

  if (!Number.isFinite(balance) || (balance ?? 0) <= 0) {
    return { losses: null, limit: "balance-unavailable" };
  }

  if (sessionPnl >= takeProfit) {
    return { losses: 0, limit: "profit-target-reached" };
  }

  if (sessionPnl <= -stopLoss) {
    return { losses: 0, limit: "session-loss-limit-reached" };
  }

  let remainingBalance = roundMoney(balance ?? 0);
  let remainingLossRoom = roundMoney(stopLoss + sessionPnl);
  let nextStake = roundMoney(strategy === "martingale" ? currentStake : baseStake);
  let losses = 0;

  if (remainingBalance <= 0) {
    return { losses: 0, limit: "balance-unavailable" };
  }

  for (; losses < MAX_ESTIMATED_LOSSES; losses += 1) {
    if (nextStake > remainingBalance) {
      return { losses, limit: "account-balance" };
    }

    remainingBalance = roundMoney(remainingBalance - nextStake);
    remainingLossRoom = roundMoney(remainingLossRoom - nextStake);

    const balanceReached = remainingBalance <= 0;
    const lossLimitReached = remainingLossRoom <= 0;
    if (balanceReached && lossLimitReached) {
      return { losses: losses + 1, limit: "both-limits" };
    }
    if (balanceReached) {
      return { losses: losses + 1, limit: "account-balance" };
    }
    if (lossLimitReached) {
      return { losses: losses + 1, limit: "session-loss-limit" };
    }

    const followingStake =
      strategy === "martingale"
        ? roundMoney(nextStake * multiplier)
        : roundMoney(baseStake);
    if (!Number.isFinite(followingStake) || followingStake <= 0) {
      return { losses: losses + 1, limit: "account-balance" };
    }
    nextStake = followingStake;
  }

  return { losses: MAX_ESTIMATED_LOSSES, limit: "calculation-cap" };
}

export function getEdgeObservedOdds(input: {
  marketSignals: readonly {
    symbol: string;
    sample_count: number;
    digit_outcomes?: readonly {
      digit: number;
      over_percentage: number;
      under_percentage: number;
    }[];
  }[];
  symbol: string;
  digit: number;
  direction: "DIGITOVER" | "DIGITUNDER";
}): EdgeObservedOdds | null {
  const signal = input.marketSignals.find(
    (candidate) => candidate.symbol === input.symbol,
  );
  if (
    !signal
    || !Number.isInteger(signal.sample_count)
    || signal.sample_count < EDGE_WIPEOUT_MIN_SAMPLE_COUNT
  ) {
    return null;
  }

  const outcome = signal.digit_outcomes?.find(
    (candidate) => candidate.digit === input.digit,
  );
  if (!outcome) return null;

  const winPercent = Number(
    input.direction === "DIGITOVER"
      ? outcome.over_percentage
      : outcome.under_percentage,
  );
  if (!Number.isFinite(winPercent) || winPercent < 0 || winPercent > 100) {
    return null;
  }

  return {
    winPercent,
    lossPercent: 100 - winPercent,
    sampleCount: signal.sample_count,
  };
}

function settledMatchingEdgeTrades(input: {
  trades: readonly EdgeSettledTradeOddsRow[];
  accountId?: string | null;
  symbol: string;
  digit: number;
  direction: "DIGITOVER" | "DIGITUNDER";
  duration: number;
}) {
  return input.trades.filter((trade) => (
    (!input.accountId || trade.account_id === input.accountId)
    && trade.symbol === input.symbol
    && trade.contract_type === input.direction
    && trade.barrier === input.digit
    && trade.duration === input.duration
    && trade.duration_unit === "t"
    && !OPEN_TRADE_STATUSES.has(trade.status.trim().toLowerCase())
    && Number.isFinite(trade.profit)
    && trade.profit !== 0
  ));
}

export function getEdgeHistoricalSampleCount(input: {
  trades: readonly EdgeSettledTradeOddsRow[];
  accountId?: string | null;
  symbol: string;
  digit: number;
  direction: "DIGITOVER" | "DIGITUNDER";
  duration: number;
}): number {
  return settledMatchingEdgeTrades(input).length;
}

export function getEdgeObservedContractOdds(input: {
  trades: readonly EdgeSettledTradeOddsRow[];
  accountId?: string | null;
  symbol: string;
  digit: number;
  direction: "DIGITOVER" | "DIGITUNDER";
  duration: number;
}): EdgeObservedOdds | null {
  const trades = settledMatchingEdgeTrades(input);
  if (trades.length < EDGE_WIPEOUT_MIN_SAMPLE_COUNT) return null;

  const wins = trades.filter((trade) => trade.profit > 0).length;
  const losses = trades.filter((trade) => trade.profit < 0).length;
  const sampleCount = wins + losses;
  if (sampleCount < EDGE_WIPEOUT_MIN_SAMPLE_COUNT) return null;

  const winPercent = (wins / sampleCount) * 100;
  return {
    winPercent,
    lossPercent: 100 - winPercent,
    sampleCount,
  };
}
