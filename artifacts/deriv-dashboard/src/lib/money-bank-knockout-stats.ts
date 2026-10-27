export type MoneyBankKnockoutRow = {
  symbol: string;
  growth_rate?: number | null;
  tick_passed?: number | null;
  status: string;
};

export type MoneyBankExitTickOption = {
  ticks: number;
  noKnockoutPercentage: number;
  sampleCount: number;
  isRecommended: boolean;
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
  exitOptions: MoneyBankExitTickOption[];
};

export const MONEY_BANK_MIN_RECOMMENDATION_SAMPLE = 10;

function growthRatePercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  const percent = value > 0 && value <= 0.05 ? value * 100 : value;
  const rounded = Math.round(percent);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

function percentile(values: number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

function getCandidateExitTicks(knockoutTicks: number[]) {
  if (knockoutTicks.length < 2) return [];

  const candidates = [
    Math.max(1, percentile(knockoutTicks, 0.25) - 1),
    Math.max(1, percentile(knockoutTicks, 0.75) - 1),
  ];
  const distinct = [...new Set(candidates)].sort((left, right) => left - right);
  if (distinct.length < 2) {
    const observedRange = [
      Math.max(1, Math.min(...knockoutTicks) - 1),
      Math.max(1, Math.max(...knockoutTicks) - 1),
    ];
    for (const tick of observedRange) {
      if (!distinct.includes(tick)) distinct.push(tick);
    }
  }
  return distinct.sort((left, right) => left - right).slice(0, 2);
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

    const exitOptions = getCandidateExitTicks(knockoutTicks).map((ticks) => {
      const noKnockoutCount = outcomes.filter((outcome) =>
        outcome.status === "won" || (outcome.status === "lost" && outcome.ticks > ticks),
      ).length;
      const noKnockoutPercentage = outcomes.length
        ? Number(((noKnockoutCount / outcomes.length) * 100).toFixed(1))
        : 0;
      return {
        ticks,
        noKnockoutPercentage,
        sampleCount: outcomes.length,
        isRecommended: outcomes.length >= MONEY_BANK_MIN_RECOMMENDATION_SAMPLE && noKnockoutPercentage >= 50,
      };
    });

    return {
      growthRate,
      trackedRuns: outcomes.length,
      knockouts: knockoutTicks.length,
      completed: outcomes.filter((outcome) => outcome.status === "won").length,
      longestTicks,
      averageTicks,
      shortestTicks,
      liveTicks,
      exitOptions,
    };
  });
}
