export type MoneyBankKnockoutRow = {
  symbol: string;
  growth_rate?: number | null;
  duration?: number | null;
  duration_unit?: string | null;
  tick_passed?: number | null;
  status: string;
};

export type MoneyBankKnockoutTickFrequency = {
  ticks: number;
  count: number;
  percentageOfKnockouts: number;
};

export type MoneyBankRateStats = {
  growthRate: number;
  trackedRuns: number;
  knockouts: number;
  completed: number;
  longestTicks: number | null;
  averageTicks: number | null;
  shortestTicks: number | null;
  liveTicks: number | null;
  topKnockoutTicks: MoneyBankKnockoutTickFrequency[];
};

export type MoneyBankOutcomeSummary = {
  trackedRuns: number;
  knockouts: number;
  completed: number;
  longestTicks: number | null;
  averageTicks: number | null;
  shortestTicks: number | null;
};

export type MoneyBankExitTickStats = {
  ticks: number;
  trackedRuns: number;
  knockouts: number;
  completed: number;
  winRate: number | null;
  band: "no-data" | "red" | "yellow" | "green";
};

export type MoneyBankStatsRate = number | "all";

export const MONEY_BANK_EXIT_TICK_MINIMUM_SAMPLES = 20;
export const MONEY_BANK_STATS_TICK_LIMIT = 20;

function growthRatePercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  const percent = value > 0 && value <= 0.05 ? value * 100 : value;
  const rounded = Math.round(percent);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

function matchesRate(row: MoneyBankKnockoutRow, rate: MoneyBankStatsRate) {
  return rate === "all" || growthRatePercent(row.growth_rate) === rate;
}

function settledOutcome(row: MoneyBankKnockoutRow) {
  const status = row.status.trim().toLowerCase();
  const ticks = row.tick_passed;
  if (
    (status !== "lost" && status !== "won")
    || !Number.isSafeInteger(ticks)
    || (ticks ?? 0) < 1
  ) {
    return null;
  }
  return { status, ticks: ticks as number };
}

function liveOutcome(row: MoneyBankKnockoutRow) {
  const status = row.status.trim().toLowerCase();
  const ticks = row.tick_passed;
  if (
    !["open", "pending", "active"].includes(status)
    || !Number.isSafeInteger(ticks)
    || (ticks ?? 0) < 1
  ) {
    return null;
  }
  return { status: "active", ticks: ticks as number };
}

function getTopKnockoutTicks(knockoutTicks: number[]) {
  if (!knockoutTicks.length) return [];
  const counts = new Map<number, number>();
  for (const ticks of knockoutTicks) {
    counts.set(ticks, (counts.get(ticks) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([ticks, count]) => ({
      ticks,
      count,
      percentageOfKnockouts: Number(((count / knockoutTicks.length) * 100).toFixed(1)),
    }))
    .sort((left, right) => right.count - left.count || left.ticks - right.ticks)
    .slice(0, 5);
}

export function summarizeMoneyBankKnockoutStats(
  rows: readonly MoneyBankKnockoutRow[],
  symbol: string,
  growthRates: readonly number[] = [1, 2, 3, 4, 5],
): MoneyBankRateStats[] {
  return growthRates.map((growthRate) => {
    const matchingRows = rows.filter((row) =>
      row.symbol === symbol && growthRatePercent(row.growth_rate) === growthRate,
    );
    const liveTicks = matchingRows
      .filter((row) => ["open", "pending", "active"].includes(row.status.trim().toLowerCase()))
      .map((row) => row.tick_passed)
      .filter((ticks): ticks is number => Number.isSafeInteger(ticks) && ticks! >= 0)
      .reduce<number | null>((maximum, ticks) => maximum == null ? ticks : Math.max(maximum, ticks), null);

    const outcomes = matchingRows.flatMap((row) => {
      const status = row.status.trim().toLowerCase();
      const ticks = row.tick_passed;
      if ((status !== "lost" && status !== "won") || !Number.isSafeInteger(ticks) || (ticks ?? 0) < 1) {
        return [];
      }
      return [{ status, ticks: ticks as number }];
    });
    const knockoutTicks = outcomes
      .filter((outcome) => outcome.status === "lost")
      .map((outcome) => outcome.ticks);
    const tickDurations = outcomes.map((outcome) => outcome.ticks);
    const longestTicks = tickDurations.length ? Math.max(...tickDurations) : null;
    const shortestTicks = tickDurations.length ? Math.min(...tickDurations) : null;
    const averageTicks = tickDurations.length
      ? Number((tickDurations.reduce((total, ticks) => total + ticks, 0) / tickDurations.length).toFixed(1))
      : null;

    return {
      growthRate,
      trackedRuns: outcomes.length,
      knockouts: knockoutTicks.length,
      completed: outcomes.filter((outcome) => outcome.status === "won").length,
      longestTicks,
      averageTicks,
      shortestTicks,
      liveTicks,
      topKnockoutTicks: getTopKnockoutTicks(knockoutTicks),
    };
  });
}

export function summarizeMoneyBankOutcomeStats(
  rows: readonly MoneyBankKnockoutRow[],
  symbol: string,
  rate: MoneyBankStatsRate,
  maxTicks: number,
): MoneyBankOutcomeSummary {
  const boundedMax = Math.min(30, Math.max(1, Math.floor(maxTicks)));
  const outcomes = rows.flatMap((row) => {
    if (row.symbol !== symbol || !matchesRate(row, rate)) return [];
    const outcome = settledOutcome(row) ?? liveOutcome(row);
    return outcome && outcome.ticks <= boundedMax ? [outcome] : [];
  });
  const settledOutcomes = outcomes.filter((outcome) => outcome.status !== "active");
  const durations = outcomes.map((outcome) => outcome.ticks);
  return {
    trackedRuns: outcomes.length,
    knockouts: settledOutcomes.filter((outcome) => outcome.status === "lost").length,
    completed: settledOutcomes.filter((outcome) => outcome.status === "won").length,
    longestTicks: durations.length ? Math.max(...durations) : null,
    averageTicks: durations.length
      ? Number((durations.reduce((total, ticks) => total + ticks, 0) / durations.length).toFixed(1))
      : null,
    shortestTicks: durations.length ? Math.min(...durations) : null,
  };
}

/**
 * Summarize actual settled outcomes for contracts whose configured duration
 * exactly matches each target tick. This avoids treating longer contracts as
 * counterfactual results for shorter targets.
 */
export function summarizeMoneyBankExitTicks(
  rows: readonly MoneyBankKnockoutRow[],
  symbol: string,
  rate: MoneyBankStatsRate,
  maxTicks: number,
  minimumSamples = MONEY_BANK_EXIT_TICK_MINIMUM_SAMPLES,
): MoneyBankExitTickStats[] {
  const boundedMax = Math.min(30, Math.max(1, Math.floor(maxTicks)));
  const outcomes = rows.flatMap((row) => {
    if (
      row.symbol !== symbol
      || !matchesRate(row, rate)
      || (row.duration_unit != null && row.duration_unit !== "t")
      || !Number.isSafeInteger(row.duration)
      || (row.duration ?? 0) < 1
    ) {
      return [];
    }
    const outcome = settledOutcome(row);
    return outcome ? [{ ...outcome, duration: row.duration as number }] : [];
  });

  return Array.from({ length: boundedMax }, (_, index) => {
    const ticks = index + 1;
    const eligible = outcomes.filter((outcome) => outcome.duration === ticks);
    const completed = eligible.filter((outcome) => outcome.status === "won").length;
    const knockouts = eligible.filter((outcome) => outcome.status === "lost").length;
    const winRate = eligible.length ? Number(((completed / eligible.length) * 100).toFixed(1)) : null;
    const band: MoneyBankExitTickStats["band"] = eligible.length === 0
      ? "no-data"
      : eligible.length < minimumSamples
        ? "yellow"
        : winRate! <= 30
          ? "red"
          : winRate! >= 90
            ? "green"
            : "yellow";

    return {
      ticks,
      trackedRuns: eligible.length,
      knockouts,
      completed,
      winRate,
      band,
    };
  });
}
