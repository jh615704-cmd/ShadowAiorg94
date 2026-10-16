export type ClockWorkDirection = "HIGHER" | "LOWER";
export type ClockWorkBarrierMode = "offset" | "absolute";

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
    return { sampleCount, higherPercent: null, lowerPercent: null, prediction: null, leanStrength: null } as const;
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

export function getClockWorkRecentMoves(quotes: readonly number[], limit = 20) {
  const moves: Array<{ direction: "H" | "L"; quote: number }> = [];
  const start = Math.max(0, quotes.length - limit - 1);
  for (let index = start + 1; index < quotes.length; index += 1) {
    const previous = quotes[index - 1];
    const current = quotes[index];
    if (!Number.isFinite(previous) || !Number.isFinite(current) || current === previous) continue;
    moves.push({ direction: current > previous ? "H" : "L", quote: current });
  }
  return moves.slice(-limit);
}

export function getClockWorkPushDirection(quotes: readonly number[], ticks = 5): ClockWorkDirection | null {
  if (quotes.length < ticks + 1) return null;
  const recent = quotes.slice(-(ticks + 1));
  let direction: ClockWorkDirection | null = null;
  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1];
    const current = recent[index];
    if (!Number.isFinite(previous) || !Number.isFinite(current) || current === previous) return null;
    const nextDirection = current > previous ? "HIGHER" : "LOWER";
    if (direction && direction !== nextDirection) return null;
    direction = nextDirection;
  }
  return direction;
}

export function getClockWorkFourSequence(lead: ClockWorkDirection | null) {
  const first = lead ?? "HIGHER";
  const second = first === "HIGHER" ? "LOWER" : "HIGHER";
  return [first, second, first, second] as const;
}
