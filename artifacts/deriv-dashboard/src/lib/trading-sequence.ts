export type DigitDirection = "DIGITOVER" | "DIGITUNDER";

export type DigitStreak = {
  digit: number;
  over: number;
  under: number;
};

export type MarketSignal = {
  symbol: string;
  quote: number | null;
  sample_count: number;
  digit_streaks: DigitStreak[];
  digit_outcomes?: DigitOutcome[];
};

export type DigitOutcome = {
  digit: number;
  over_percentage: number;
  under_percentage: number;
};

export type BestEdgeSignal = {
  symbol: string;
  direction: "DIGITOVER" | "DIGITUNDER" | "DUAL";
  digit: number;
  score: number;
  sampleCount: number;
};

export type BestEdgeDirectionSignal = Omit<BestEdgeSignal, "direction"> & {
  direction: "DIGITOVER" | "DIGITUNDER";
};

export type EdgeDurationHistorySample = {
  symbol: string;
  contract_type: string;
  barrier: number | null;
  duration: number | null;
  status: string;
  profit: number;
};

export type EdgeDurationAvailabilitySetup = {
  amount: number;
  contract_type: DigitDirection;
  barrier: number;
  symbol: string;
};

export function createEdgeDurationAvailabilitySetup(
  candidate: { direction: DigitDirection; digit: number; symbol: string },
  amount: number,
): EdgeDurationAvailabilitySetup {
  return {
    amount,
    contract_type: candidate.direction,
    barrier: candidate.digit,
    symbol: candidate.symbol,
  };
}

export type BestDigitSignal = {
  symbol: string;
  direction: DigitDirection;
  digit: number;
  streak: number;
  sampleCount: number;
};

export type SettledTrade = {
  contract_id: string;
  status: string;
  profit: number;
  buy_time?: number | null;
};

export function rankDigitsByDistribution(counts: ReadonlyArray<number>): number[] {
  return Array.from({ length: 10 }, (_, digit) => ({
    digit,
    count: Number.isFinite(counts[digit]) ? counts[digit] : 0,
  }))
    .sort((left, right) => right.count - left.count || left.digit - right.digit)
    .map(({ digit }) => digit);
}

export function rankDigitsForDiffers(
  counts: ReadonlyArray<number>,
  absentStreaks: ReadonlyArray<number> = [],
): number[] {
  return Array.from({ length: 10 }, (_, digit) => ({
    digit,
    count: Number.isFinite(counts[digit]) ? counts[digit] : 0,
    absentStreak: Number.isFinite(absentStreaks[digit]) ? absentStreaks[digit] : 0,
  }))
    .sort(
      (left, right) =>
        left.count - right.count ||
        right.absentStreak - left.absentStreak ||
        left.digit - right.digit,
    )
    .map(({ digit }) => digit);
}

export function digitForTick(
  tickDuration: number,
  rankedDigits: ReadonlyArray<number>,
  fallbackDigit: number,
): number {
  const position = Math.min(6, Math.max(1, Math.trunc(tickDuration))) - 1;
  return rankedDigits[position] ?? fallbackDigit;
}

export function nextStakeAfterSettlement(
  profit: number,
  amount: number,
  normalStake: number,
  multiplier: number,
) {
  if (profit < 0) {
    return Number((amount * Math.max(1, multiplier)).toFixed(2));
  }
  return normalStake;
}

/**
 * Derives the next stake from only this feature's retained, settled history.
 * Wins leave an escalated stake unchanged; removing local history resets the
 * result to the configured base stake.
 */
export function nextStakeFromLossHistory(
  rows: readonly SettledTrade[],
  baseStake: number,
  multiplier: number,
) {
  if (!Number.isFinite(baseStake) || baseStake <= 0) return 0;
  const safeMultiplier = Number.isFinite(multiplier) ? Math.max(1, multiplier) : 1;
  let nextStake = Number(baseStake.toFixed(2));
  const settledRows = rows
    .filter((trade) => trade.status !== "open" && Number.isFinite(trade.profit))
    .slice()
    .sort((left, right) => (left.buy_time ?? 0) - (right.buy_time ?? 0));

  for (const trade of settledRows) {
    if (trade.profit < 0) nextStake = Number((nextStake * safeMultiplier).toFixed(2));
  }
  return nextStake;
}

export function nextStakeFromSettlementSequence(
  rows: readonly SettledTrade[],
  baseStake: number,
  multiplier: number,
) {
  if (!Number.isFinite(baseStake) || baseStake <= 0) return 0;
  const safeMultiplier = Number.isFinite(multiplier) ? Math.max(1, multiplier) : 1;
  const normalStake = Number(baseStake.toFixed(2));
  let nextStake = normalStake;
  const settledRows = rows
    .filter((trade) => trade.status !== "open" && Number.isFinite(trade.profit))
    .slice()
    .sort((left, right) => (left.buy_time ?? 0) - (right.buy_time ?? 0));

  for (const trade of settledRows) {
    const followingStake = nextStakeAfterSettlement(
      trade.profit,
      nextStake,
      normalStake,
      safeMultiplier,
    );
    if (!Number.isFinite(followingStake) || followingStake <= 0) return 0;
    nextStake = followingStake;
  }
  return nextStake;
}

export function findNewlySettledTrade(
  rows: SettledTrade[],
  knownIds: ReadonlySet<string>,
) {
  return rows.find((trade) => !knownIds.has(trade.contract_id) && trade.status !== "open") ?? null;
}

function candidatesFromSignal(signal: MarketSignal): BestDigitSignal[] {
  return signal.digit_streaks.flatMap((item) => [
    {
      symbol: signal.symbol,
      direction: "DIGITOVER" as const,
      digit: item.digit,
      streak: item.over,
      sampleCount: signal.sample_count,
    },
    {
      symbol: signal.symbol,
      direction: "DIGITUNDER" as const,
      digit: item.digit,
      streak: item.under,
      sampleCount: signal.sample_count,
    },
  ]);
}

function bySignalStrength(left: BestDigitSignal, right: BestDigitSignal) {
  return (right.streak * 3 + Math.min(right.sampleCount, 100) / 100)
    - (left.streak * 3 + Math.min(left.sampleCount, 100) / 100);
}

export function chooseBestDigitSignal(
  signals: MarketSignal[],
  fallback: MarketSignal | null,
) {
  const candidates = signals
    .filter((signal) => signal.sample_count >= 5 && signal.quote != null)
    .flatMap(candidatesFromSignal)
    .sort(bySignalStrength);
  if (candidates[0]) return candidates[0];

  if (!fallback) return null;
  return candidatesFromSignal(fallback).sort((left, right) => right.streak - left.streak)[0] ?? null;
}

export function chooseBestEdgeSignal(
  signals: MarketSignal[],
  minimumScore: number,
): BestEdgeSignal | null {
  const candidates = signals.flatMap((signal) => {
    if (signal.sample_count < 20 || signal.quote == null || !signal.digit_outcomes?.length) return [];
    return signal.digit_outcomes.flatMap((outcome) => {
      // Barrier 0 for Over and barrier 9 for Under are tautological
      // candidates, not useful evidence for a live scanner.
      if (outcome.digit <= 0 || outcome.digit >= 9) return [];
      const over = Number(outcome.over_percentage);
      const under = Number(outcome.under_percentage);
      if (!Number.isFinite(over) || !Number.isFinite(under)) return [];
      const dualCoverage = Math.min(100, over + under);
      const direction = dualCoverage >= minimumScore && over >= 10 && under >= 10
        ? "DUAL" as const
        : over >= under
          ? "DIGITOVER" as const
          : "DIGITUNDER" as const;
      const score = direction === "DUAL" ? dualCoverage : Math.max(over, under);
      return score >= minimumScore
        ? [{ symbol: signal.symbol, direction, digit: outcome.digit, score, sampleCount: signal.sample_count }]
        : [];
    });
  });
  return candidates.sort(
    (left, right) => right.score - left.score
      || right.sampleCount - left.sampleCount
      || Number(right.direction === "DUAL") - Number(left.direction === "DUAL")
      || left.digit - right.digit,
  )[0] ?? null;
}

export function rankBestEdgeTradeSignals(
  signals: readonly MarketSignal[],
  minimumObservedRate = 50,
  minimumSampleCount = 20,
): BestEdgeDirectionSignal[] {
  if (
    !Number.isFinite(minimumObservedRate)
    || minimumObservedRate < 0
    || minimumObservedRate > 100
    || !Number.isInteger(minimumSampleCount)
    || minimumSampleCount < 1
  ) {
    return [];
  }

  const candidates: BestEdgeDirectionSignal[] = [];
  for (const signal of signals) {
    if (
      signal.quote == null
      || !Number.isInteger(signal.sample_count)
      || signal.sample_count < minimumSampleCount
    ) {
      continue;
    }

    for (const outcome of signal.digit_outcomes ?? []) {
      if (!Number.isInteger(outcome.digit) || outcome.digit < 0 || outcome.digit > 9) {
        continue;
      }
      const over = Number(outcome.over_percentage);
      const under = Number(outcome.under_percentage);
      if (![over, under].every((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100)) {
        continue;
      }
      if (over === under) continue;

      const direction = over > under ? "DIGITOVER" as const : "DIGITUNDER" as const;
      // These two combinations are tautological and do not provide a useful
      // observed signal for an Over/Under entry.
      if ((outcome.digit === 0 && direction === "DIGITOVER")
        || (outcome.digit === 9 && direction === "DIGITUNDER")) {
        continue;
      }

      const score = Math.max(over, under);
      if (score < minimumObservedRate) continue;
      candidates.push({
        symbol: signal.symbol,
        direction,
        digit: outcome.digit,
        score,
        sampleCount: signal.sample_count,
      });
    }
  }

  return candidates.sort(
    (left, right) => right.score - left.score
      || right.sampleCount - left.sampleCount
      || left.symbol.localeCompare(right.symbol)
      || left.digit - right.digit,
  );
}

export function chooseBestEdgeTradeSignal(
  signals: readonly MarketSignal[],
  minimumObservedRate = 50,
  minimumSampleCount = 20,
): BestEdgeDirectionSignal | null {
  return rankBestEdgeTradeSignals(signals, minimumObservedRate, minimumSampleCount)[0] ?? null;
}

export function chooseEdgeDurationByWinRate(
  rows: readonly EdgeDurationHistorySample[],
  symbol: string,
  direction: DigitDirection,
  barrier: number,
  supportedDurations: readonly number[],
  preferredDuration: number,
  minimumSamples = 20,
  minimumWinRate = 50,
): number | null {
  const availableDurations = [...new Set(supportedDurations)]
    .filter((duration) => Number.isInteger(duration) && duration >= 1 && duration <= 5)
    .sort((left, right) => left - right);
  if (!availableDurations.length) return null;
  if (
    !Number.isInteger(minimumSamples)
    || minimumSamples < 1
    || !Number.isFinite(minimumWinRate)
    || minimumWinRate < 0
    || minimumWinRate > 100
  ) {
    return availableDurations.includes(preferredDuration)
      ? preferredDuration
      : availableDurations[0];
  }

  const resultsByDuration = new Map<number, { wins: number; losses: number }>();
  for (const row of rows) {
    if (
      row.symbol !== symbol
      || row.contract_type !== direction
      || row.barrier !== barrier
      || row.duration == null
      || !availableDurations.includes(row.duration)
      || ["open", "pending", "active"].includes(row.status.trim().toLowerCase())
      || !Number.isFinite(row.profit)
      || row.profit === 0
    ) {
      continue;
    }

    const result = resultsByDuration.get(row.duration) ?? { wins: 0, losses: 0 };
    if (row.profit > 0) result.wins += 1;
    else result.losses += 1;
    resultsByDuration.set(row.duration, result);
  }

  const bestHistoricalDuration = availableDurations
    .map((duration) => {
      const result = resultsByDuration.get(duration) ?? { wins: 0, losses: 0 };
      const sampleCount = result.wins + result.losses;
      return {
        duration,
        sampleCount,
        winRate: sampleCount ? (result.wins / sampleCount) * 100 : 0,
      };
    })
    .filter((result) =>
      result.sampleCount >= minimumSamples
      && result.winRate >= minimumWinRate,
    )
    .sort((left, right) =>
      right.winRate - left.winRate
      || right.sampleCount - left.sampleCount
      || Number(right.duration === preferredDuration) - Number(left.duration === preferredDuration)
      || left.duration - right.duration,
    )[0];

  return bestHistoricalDuration?.duration
    ?? (availableDurations.includes(preferredDuration)
      ? preferredDuration
      : availableDurations[0]);
}

export function chooseBestEdgeDirectionForDigit(
  signals: readonly MarketSignal[],
  symbol: string,
  digit: number,
  minimumSampleCount = 20,
): BestEdgeDirectionSignal | null {
  if (!symbol || !Number.isInteger(digit) || digit < 0 || digit > 9) return null;
  if (!Number.isInteger(minimumSampleCount) || minimumSampleCount < 1) return null;

  const signal = signals.find((candidate) => candidate.symbol === symbol);
  if (!signal || signal.quote == null || signal.sample_count < minimumSampleCount) return null;

  const outcome = signal.digit_outcomes?.find((candidate) => candidate.digit === digit);
  if (!outcome) return null;
  const over = Number(outcome.over_percentage);
  const under = Number(outcome.under_percentage);
  if (![over, under].every((percentage) => Number.isFinite(percentage) && percentage >= 0 && percentage <= 100)) return null;
  if (over === under) return null;

  return {
    symbol,
    direction: over > under ? "DIGITOVER" : "DIGITUNDER",
    digit,
    score: Math.max(over, under),
    sampleCount: signal.sample_count,
  };
}

export type StopReason = "take-profit" | "stop-loss";

export function sessionStopReason(
  pnl: number,
  takeProfit: number,
  stopLoss: number,
): StopReason | null {
  if (pnl >= takeProfit) return "take-profit";
  if (pnl <= -stopLoss) return "stop-loss";
  return null;
}