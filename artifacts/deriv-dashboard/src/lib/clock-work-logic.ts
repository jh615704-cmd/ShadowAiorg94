export type ClockWorkDirection = "HIGHER" | "LOWER";

export const CLOCK_WORK_AI_MIN_WIN_RATE = 70;
export const CLOCK_WORK_AI_MIN_WIN_RATE_OPTIONS = [55, 65, 70] as const;
export type ClockWorkAiMinimumWinRate = typeof CLOCK_WORK_AI_MIN_WIN_RATE_OPTIONS[number];
export const CLOCK_WORK_AI_MIN_SAMPLE_COUNT = 1;
export const CLOCK_WORK_AUTO_BEST_MARKET_MIN_SAMPLE_COUNT = 15;
export const CLOCK_WORK_AUTO_BEST_MARKET_VALUE = "__clock_work_auto_best_market__";
export const CLOCK_WORK_AI_REQUIRED_CONFIRMATIONS = 1;
export const CLOCK_WORK_DURATION_OPTIONS = [1, 2, 3, 4, 5] as const;
export type ClockWorkDurationTicks = typeof CLOCK_WORK_DURATION_OPTIONS[number];
export const CLOCK_WORK_DEFAULT_DURATION_TICKS = 5;
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

export interface ClockWorkMarketSignal {
  symbol: string;
  recent_quotes: readonly number[];
  tick_epoch: number;
}

export interface ClockWorkAutoBestMarket {
  symbol: string;
  candidate: ClockWorkAiCandidate;
  stabilityScore: number;
  duration: ClockWorkDurationTicks;
}

export interface ClockWorkAiConfirmationState {
  candidateKey: string | null;
  lastTickId: string | null;
  count: number;
}

export type ClockWorkLimitReached = "take-profit" | "loss-limit" | "invalid";

export function createClockWorkAiConfirmationState(lastTickId: string | null = null): ClockWorkAiConfirmationState {
  return { candidateKey: null, lastTickId, count: 0 };
}

export function getClockWorkAiCandidateKey(candidate: ClockWorkAiCandidate | null): string | null {
  return candidate ? `${candidate.direction}:${candidate.barrier}` : null;
}

function getClockWorkTickEpoch(tickId: string | null): number | null {
  if (!tickId) return null;
  const epoch = Number(tickId.split(":", 1)[0]);
  return Number.isFinite(epoch) ? epoch : null;
}

export function updateClockWorkAiConfirmation(
  current: ClockWorkAiConfirmationState,
  candidate: ClockWorkAiCandidate | null,
  tickId: string | null,
): ClockWorkAiConfirmationState {
  const candidateKey = getClockWorkAiCandidateKey(candidate);
  if (!candidateKey) {
    const lastTickId = tickId ?? current.lastTickId;
    if (current.candidateKey === null && current.count === 0 && current.lastTickId === lastTickId) return current;
    return { candidateKey: null, lastTickId, count: 0 };
  }
  if (!tickId) return current;
  if (tickId === current.lastTickId) {
    return current.candidateKey === candidateKey
      ? current
      : { candidateKey, lastTickId: tickId, count: 0 };
  }

  const previousEpoch = getClockWorkTickEpoch(current.lastTickId);
  const currentEpoch = getClockWorkTickEpoch(tickId);
  const tickGapTooLarge = previousEpoch != null
    && currentEpoch != null
    && (currentEpoch < previousEpoch || currentEpoch - previousEpoch > 60);
  const isSameSetup = current.candidateKey === candidateKey && !tickGapTooLarge;
  return {
    candidateKey,
    lastTickId: tickId,
    count: isSameSetup ? current.count + 1 : 1,
  };
}

export function getClockWorkLimitReached(
  sessionPnl: number,
  takeProfit: number,
  lossLimit: number,
): ClockWorkLimitReached | null {
  if (
    !Number.isFinite(sessionPnl)
    || !Number.isFinite(takeProfit)
    || !Number.isFinite(lossLimit)
    || takeProfit < 0
    || lossLimit < 0
  ) {
    return "invalid";
  }
  if (takeProfit > 0 && sessionPnl >= takeProfit) return "take-profit";
  if (lossLimit > 0 && sessionPnl <= -lossLimit) return "loss-limit";
  return null;
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
 * Choose the best historical Higher/Lower setup for the selected expiry duration.
 * Evaluation uses only the newest non-overlapping expiry windows; it returns
 * no candidate until the sample floor and selected entry threshold are met.
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
  const duration = Math.floor(options.duration ?? CLOCK_WORK_DEFAULT_DURATION_TICKS);
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

function getClockWorkStabilityScore(candidate: ClockWorkAiCandidate) {
  const sampleCount = candidate.sampleCount;
  const observedRate = candidate.observedRate / 100;
  const zScore = 1.96;
  const zSquared = zScore ** 2;
  const denominator = 1 + zSquared / sampleCount;
  const center = observedRate + zSquared / (2 * sampleCount);
  const margin = zScore * Math.sqrt(
    (observedRate * (1 - observedRate) + zSquared / (4 * sampleCount)) / sampleCount,
  );
  return Math.max(0, ((center - margin) / denominator) * 100);
}

export function chooseClockWorkAutoBestMarket(
  signals: readonly ClockWorkMarketSignal[],
  eligibleSymbols: readonly string[],
  options: {
    duration?: ClockWorkDurationTicks;
    minimumWinRate?: number;
    minimumSamples?: number;
    maxTickAgeSeconds?: number;
    nowEpoch?: number;
  } = {},
): ClockWorkAutoBestMarket | null {
  const minimumSamples = Math.floor(
    options.minimumSamples ?? CLOCK_WORK_AUTO_BEST_MARKET_MIN_SAMPLE_COUNT,
  );
  const duration = options.duration ?? CLOCK_WORK_DEFAULT_DURATION_TICKS;
  const maxTickAgeSeconds = options.maxTickAgeSeconds ?? 30;
  const nowEpoch = options.nowEpoch ?? Math.floor(Date.now() / 1000);
  if (
    minimumSamples < 1
    || !Number.isFinite(minimumSamples)
    || !CLOCK_WORK_DURATION_OPTIONS.includes(duration)
    || !Number.isFinite(maxTickAgeSeconds)
    || maxTickAgeSeconds <= 0
    || !Number.isFinite(nowEpoch)
  ) return null;

  const eligible = new Set(eligibleSymbols);
  const candidates = signals.flatMap((signal) => {
    if (
      !eligible.has(signal.symbol)
      || !Array.isArray(signal.recent_quotes)
      || !Number.isFinite(signal.tick_epoch)
      || signal.tick_epoch <= 0
    ) {
      return [];
    }
    const tickAgeSeconds = nowEpoch - signal.tick_epoch;
    if (tickAgeSeconds < -5 || tickAgeSeconds > maxTickAgeSeconds) return [];

    const candidate = chooseClockWorkAiCandidate(signal.recent_quotes, {
      duration,
      minimumWinRate: options.minimumWinRate,
      minimumSamples,
    });
    return candidate
      ? [{
        symbol: signal.symbol,
        candidate,
        stabilityScore: getClockWorkStabilityScore(candidate),
        duration,
      }]
      : [];
  });

  candidates.sort((left, right) =>
    right.stabilityScore - left.stabilityScore
    || right.candidate.observedRate - left.candidate.observedRate
    || right.candidate.sampleCount - left.candidate.sampleCount
    || left.symbol.localeCompare(right.symbol),
  );
  return candidates[0] ?? null;
}
