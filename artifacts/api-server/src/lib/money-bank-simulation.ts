export type MoneyBankKnockoutSimulationCell = {
  ticks: number;
  sample_count: number;
  knockouts: number;
  survivors: number;
  survival_rate: number | null;
};

export function simulateAccumulatorQuoteWindows(
  inputQuotes: readonly number[],
  barrier: number,
  maxTicks = 20,
): MoneyBankKnockoutSimulationCell[] {
  const quotes = inputQuotes.filter((quote) => Number.isFinite(quote) && quote > 0);
  const boundedMaxTicks = Math.min(20, Math.max(1, Math.floor(maxTicks)));

  if (!Number.isFinite(barrier) || barrier <= 0) {
    return Array.from({ length: boundedMaxTicks }, (_, index) => ({
      ticks: index + 1,
      sample_count: 0,
      knockouts: 0,
      survivors: 0,
      survival_rate: null,
    }));
  }

  const firstKnockoutAt = Array.from({ length: Math.max(0, quotes.length - 1) }, (_, startIndex) => {
    const limit = Math.min(boundedMaxTicks, quotes.length - startIndex - 1);
    for (let offset = 1; offset <= limit; offset += 1) {
      if (Math.abs(quotes[startIndex + offset]! - quotes[startIndex]!) >= barrier) {
        return offset;
      }
    }
    return null;
  });

  return Array.from({ length: boundedMaxTicks }, (_, index) => {
    const ticks = index + 1;
    const eligible = firstKnockoutAt.slice(0, Math.max(0, quotes.length - ticks));
    const knockouts = eligible.filter((knockoutAt) => knockoutAt != null && knockoutAt <= ticks).length;
    const sampleCount = eligible.length;
    const survivors = sampleCount - knockouts;
    return {
      ticks,
      sample_count: sampleCount,
      knockouts,
      survivors,
      survival_rate: sampleCount
        ? Number(((survivors / sampleCount) * 100).toFixed(1))
        : null,
    };
  });
}
