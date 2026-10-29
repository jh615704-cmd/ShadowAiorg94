export type ClockWorkDirection = "HIGHER" | "LOWER";

export const CLOCK_WORK_AI_MIN_WIN_RATE = 70;
export const CLOCK_WORK_AI_MIN_SAMPLE_COUNT = 20;
export const CLOCK_WORK_AI_DURATION_TICKS = 5;
export const CLOCK_WORK_AI_BARRIER_OFFSETS = [0.05, 0.12, 0.25, 0.5] as const;
export const CLOCK_WORK_MAX_TICKS = 900;

export interface ClockWorkQuoteBuffer {
  symbol: string;
  quotes: number[];
  lastTickId: string | null;
}

export interface ClockWorkAiCandidate {
  direction: ClockWorkDirection;
  barrier: string;
  barrierOffset: number;
  observedRate: number;
  sampleCount: number;
}

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

/**
 * Choose the best historical five-tick Higher/Lower contract setup.
 * Evaluation uses only the newest non-overlapping expiry windows; it returns
 * no candidate until the sample floor and observed-rate threshold are met.
 */
export function chooseClockWorkAiCandidate(
  inputQuotes: readonly number[],
  options: {
    duration?: number;
    minimumWinRate?: number;
    minimumSamples?: number;
    barrierOffsets?: readonly number[];
  } = {},
): ClockWorkAiCandidate | null {
  const duration = Math.floor(options.duration ?? CLOCK_WORK_AI_DURATION_TICKS);
  const minimumWinRate = options.minimumWinRate ?? CLOCK_WORK_AI_MIN_WIN_RATE;
  const minimumSamples = Math.floor(options.minimumSamples ?? CLOCK_WORK_AI_MIN_SAMPLE_COUNT);
  const barriers = options.barrierOffsets ?? CLOCK_WORK_AI_BARRIER_OFFSETS;
  const quotes = inputQuotes.filter(Number.isFinite).slice(-CLOCK_WORK_MAX_TICKS);

  if (
    duration < 1
    || !Number.isFinite(minimumWinRate)
    || minimumWinRate < 0
    || minimumWinRate > 100
    || minimumSamples < 1
  ) {
    return null;
  }

  const outcomes: Array<{ start: number; expiry: number }> = [];
  for (let expiryIndex = quotes.length - 1; expiryIndex >= duration; expiryIndex -= duration) {
    outcomes.push({
      start: quotes[expiryIndex - duration],
      expiry: quotes[expiryIndex],
    });
  }
  if (outcomes.length < minimumSamples) return null;

  const candidates: ClockWorkAiCandidate[] = [];
  for (const barrierOffset of barriers) {
    if (!Number.isFinite(barrierOffset) || barrierOffset <= 0) continue;
    for (const direction of ["HIGHER", "LOWER"] as const) {
      const wins = outcomes.filter(({ start, expiry }) => direction === "HIGHER"
        ? expiry > start + barrierOffset
        : expiry < start - barrierOffset).length;
      const observedRate = (wins / outcomes.length) * 100;
      if (observedRate < minimumWinRate) continue;

      const signedBarrier = direction === "HIGHER" ? barrierOffset : -barrierOffset;
      candidates.push({
        direction,
        barrier: `${signedBarrier > 0 ? "+" : ""}${signedBarrier.toFixed(2)}`,
        barrierOffset,
        observedRate,
        sampleCount: outcomes.length,
      });
    }
  }

  candidates.sort((left, right) =>
    right.observedRate - left.observedRate
    || left.barrierOffset - right.barrierOffset
    || left.direction.localeCompare(right.direction),
  );
  return candidates[0] ?? null;
}
