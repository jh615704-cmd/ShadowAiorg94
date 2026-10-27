export type ClockWorkDirection = "HIGHER" | "LOWER";
export type ClockWorkBarrierMode = "offset" | "absolute";
export type ClockWorkChartZone = "higher" | "between" | "lower";
export const CLOCK_WORK_AGGRESSIVE_MIN_WIN_RATE = 50;

export function meetsClockWorkMinimumWinRate(
  winRate: number | null | undefined,
  minimum = CLOCK_WORK_AGGRESSIVE_MIN_WIN_RATE,
) {
  return winRate != null
    && Number.isFinite(winRate)
    && Number.isFinite(minimum)
    && winRate >= minimum;
}

export interface ClockWorkQuoteBuffer {
  symbol: string;
  quotes: number[];
  lastTickId: string | null;
}

export const CLOCK_WORK_MAX_TICKS = 900;

export function appendClockWorkQuote(
  current: ClockWorkQuoteBuffer,
  selectedSymbol: string,
  tick: { symbol: string; quote: number; epoch: number } | null | undefined,
  maxTicks = CLOCK_WORK_MAX_TICKS,
): ClockWorkQuoteBuffer {
  const limit = Math.max(1, Math.floor(maxTicks));
  const buffer = current.symbol === selectedSymbol
    ? current
    : { symbol: selectedSymbol, quotes: [], lastTickId: null };
  if (
    !tick
    || tick.symbol !== selectedSymbol
    || !Number.isFinite(tick.quote)
    || !Number.isFinite(tick.epoch)
  ) {
    return buffer;
  }

  const tickId = `${tick.epoch}:${tick.quote}`;
  if (buffer.lastTickId === tickId) return buffer;
  return {
    symbol: selectedSymbol,
    quotes: [...buffer.quotes, tick.quote].slice(-limit),
    lastTickId: tickId,
  };
}

export function effectiveClockWorkOffset(offset: number, halfBarrier: boolean) {
  return halfBarrier ? offset / 2 : offset;
}

export function formatClockWorkBarrier(
  mode: ClockWorkBarrierMode,
  spot: number | null,
  offset: number,
  halfBarrier: boolean,
) {
  const effectiveOffset = effectiveClockWorkOffset(offset, halfBarrier);
  if (mode === "offset") {
    return `${effectiveOffset > 0 ? "+" : ""}${effectiveOffset.toFixed(2)}`;
  }
  if (spot == null || !Number.isFinite(spot)) return null;
  const absoluteBarrier = Number((spot + effectiveOffset).toFixed(6));
  if (absoluteBarrier <= 0) return null;
  return absoluteBarrier.toFixed(6).replace(/\.?0+$/, "");
}

export function estimateClockWorkBarrierRates({
  quotes,
  spot,
  mode,
  higherOffset,
  lowerOffset,
  halfBarrier,
  duration = 5,
  minimumSamples = 5,
}: {
  quotes: readonly number[];
  spot: number | null;
  mode: ClockWorkBarrierMode;
  higherOffset: number;
  lowerOffset: number;
  halfBarrier: boolean;
  duration?: number;
  minimumSamples?: number;
}) {
  const cleanQuotes = quotes.filter(Number.isFinite);
  const higherOffsetValue = effectiveClockWorkOffset(higherOffset, halfBarrier);
  const lowerOffsetValue = effectiveClockWorkOffset(lowerOffset, halfBarrier);
  const absoluteHigher = spot == null ? null : spot + higherOffsetValue;
  const absoluteLower = spot == null ? null : spot + lowerOffsetValue;
  let sampleCount = 0;
  let higherWins = 0;
  let lowerWins = 0;

  for (let index = 0; index + duration < cleanQuotes.length; index += 1) {
    const start = cleanQuotes[index];
    const expiry = cleanQuotes[index + duration];
    const higherBarrier = mode === "absolute" ? absoluteHigher : start + higherOffsetValue;
    const lowerBarrier = mode === "absolute" ? absoluteLower : start + lowerOffsetValue;
    if (higherBarrier == null || lowerBarrier == null) continue;
    sampleCount += 1;
    if (expiry > higherBarrier) higherWins += 1;
    if (expiry < lowerBarrier) lowerWins += 1;
  }

  if (sampleCount < minimumSamples) {
    return {
      sampleCount,
      higherCount: higherWins,
      lowerCount: lowerWins,
      higherPercent: null,
      lowerPercent: null,
      prediction: null,
      leanStrength: null,
    } as const;
  }
  const higherPercent = (higherWins / sampleCount) * 100;
  const lowerPercent = (lowerWins / sampleCount) * 100;
  const prediction = higherPercent > lowerPercent
    ? "HIGHER"
    : lowerPercent > higherPercent
      ? "LOWER"
      : null;
  return {
    sampleCount,
    higherCount: higherWins,
    lowerCount: lowerWins,
    higherPercent,
    lowerPercent,
    prediction,
    leanStrength: prediction === "HIGHER"
      ? higherPercent
      : prediction === "LOWER"
        ? lowerPercent
        : Math.max(higherPercent, lowerPercent),
  } as const;
}

export function getClockWorkBarrierTickCounts(
  quotes: readonly number[],
  higherBarrier: number | null,
  lowerBarrier: number | null,
) {
  let higherCount = 0;
  let lowerCount = 0;
  if (
    higherBarrier != null
    && lowerBarrier != null
    && Number.isFinite(higherBarrier)
    && Number.isFinite(lowerBarrier)
  ) {
    for (const quote of quotes) {
      if (!Number.isFinite(quote)) continue;
      if (quote > higherBarrier) higherCount += 1;
      else if (quote < lowerBarrier) lowerCount += 1;
    }
  }
  const totalCount = higherCount + lowerCount;
  return {
    higherCount,
    lowerCount,
    totalCount,
    higherPercent: totalCount === 0 ? null : (higherCount / totalCount) * 100,
    lowerPercent: totalCount === 0 ? null : (lowerCount / totalCount) * 100,
  } as const;
}

export function getClockWorkChartZoneBand(
  zone: ClockWorkChartZone,
  higherY: number,
  lowerY: number,
  plotTop: number,
  plotBottom: number,
) {
  const clamp = (value: number) => Math.max(plotTop, Math.min(plotBottom, value));
  const highLine = clamp(higherY);
  const lowLine = clamp(lowerY);
  if (zone === "higher") {
    return { y: plotTop, height: Math.max(0, highLine - plotTop) };
  }
  if (zone === "between") {
    const y = Math.min(highLine, lowLine);
    return { y, height: Math.abs(lowLine - highLine) };
  }
  return { y: lowLine, height: Math.max(0, plotBottom - lowLine) };
}

export function getClockWorkRecentMoves(quotes: readonly number[], limit = 20) {
  const moves: Array<{ direction: "H" | "L" | "="; quote: number }> = [];
  const start = Math.max(0, quotes.length - limit - 1);
  for (let index = start + 1; index < quotes.length; index += 1) {
    const previous = quotes[index - 1];
    const current = quotes[index];
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
    moves.push({
      direction: current > previous ? "H" : current < previous ? "L" : "=",
      quote: current,
    });
  }
  return moves.slice(-limit);
}

export function getClockWorkPushDirection(quotes: readonly number[], ticks = 5): ClockWorkDirection | null {
  return getClockWorkPushProgress(quotes, ticks).direction;
}

export function getClockWorkPushProgress(
  quotes: readonly number[],
  ticks = 4,
): { direction: ClockWorkDirection | null; consecutiveTicks: number } {
  const target = Math.max(1, Math.floor(ticks));
  let direction: ClockWorkDirection | null = null;
  let consecutiveTicks = 0;
  for (let index = quotes.length - 1; index > 0 && consecutiveTicks < target; index -= 1) {
    const previous = quotes[index - 1];
    const current = quotes[index];
    if (!Number.isFinite(previous) || !Number.isFinite(current) || current === previous) break;
    const nextDirection = current > previous ? "HIGHER" : "LOWER";
    if (direction && direction !== nextDirection) break;
    direction ??= nextDirection;
    consecutiveTicks += 1;
  }
  return {
    direction: consecutiveTicks >= target ? direction : null,
    consecutiveTicks,
  };
}

export function getClockWorkAggressiveBudget(
  balance: number | null,
  balancePercent: number,
  contractCount: number,
) {
  const count = Math.floor(contractCount);
  if (
    balance == null
    || !Number.isFinite(balance)
    || balance <= 0
    || !Number.isFinite(balancePercent)
    || balancePercent <= 0
    || balancePercent > 100
    || count < 1
  ) {
    return null;
  }

  const balanceCents = Math.floor(balance * 100 + 1e-7);
  const budgetCents = Math.min(
    balanceCents,
    Math.floor(balance * balancePercent + 1e-7),
  );
  const perContractCents = Math.floor(budgetCents / count);
  const eligible = perContractCents >= 100;
  return {
    budgetAmount: budgetCents / 100,
    eachContractAmount: eligible ? perContractCents / 100 : null,
    totalAmount: eligible ? (perContractCents * count) / 100 : null,
    eligible,
    stakes: eligible ? Array.from({ length: count }, () => perContractCents / 100) : [],
  };
}

export function getClockWorkFourSequence(lead: ClockWorkDirection | null) {
  const first = lead ?? "HIGHER";
  const second = first === "HIGHER" ? "LOWER" : "HIGHER";
  return [first, second, first, second] as const;
}
