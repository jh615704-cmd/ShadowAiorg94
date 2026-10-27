export type MoneyBankKnockoutRow = {
  symbol: string;
  growth_rate?: number | null;
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

function growthRatePercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  const percent = value > 0 && value <= 0.05 ? value * 100 : value;
  const rounded = Math.round(percent);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
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
