import { getAutoTraderOppositeDigitGroup } from "./auto-trader-ticks.ts";

export const AUTO_MAGIC_MIN_SAMPLE = 50;
export const AUTO_MAGIC_MIN_OBSERVED_WIN_RATE = 68;

export type AutoMagicSignal = {
  symbol: string;
  sample_count: number;
  recent_digits: number[];
};

export type AutoMagicMarket = {
  symbol: string;
};

export type AutoMagicCandidate = {
  symbol: string;
  barrier: number;
  latestDigit: number;
  observedWinRate: number;
  sampleCount: number;
};

export function chooseAutoMagicCandidate(input: {
  signals: readonly AutoMagicSignal[];
  markets: readonly AutoMagicMarket[];
  latestDigits: Readonly<Record<string, number>>;
  scanFrequencies: Readonly<Record<string, readonly number[]>>;
  duration: number;
  minimumSample?: number;
  minimumObservedWinRate?: number;
}): AutoMagicCandidate | null {
  if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 5) return null;

  const minimumSample = input.minimumSample ?? AUTO_MAGIC_MIN_SAMPLE;
  const minimumObservedWinRate = input.minimumObservedWinRate ?? AUTO_MAGIC_MIN_OBSERVED_WIN_RATE;
  if (
    !Number.isInteger(minimumSample)
    || minimumSample < 1
    || !Number.isFinite(minimumObservedWinRate)
    || minimumObservedWinRate < 0
    || minimumObservedWinRate >= 100
  ) {
    return null;
  }

  const marketOrder = new Map(input.markets.map((market, index) => [market.symbol, index]));
  const candidates: Array<AutoMagicCandidate & { marketOrder: number }> = [];

  for (const signal of input.signals) {
    const order = marketOrder.get(signal.symbol);
    if (order == null || !Array.isArray(signal.recent_digits)) continue;

    const digits = signal.recent_digits.filter((digit) =>
      Number.isInteger(digit) && digit >= 0 && digit <= 9
    );
    const reportedSampleCount = Number.isInteger(signal.sample_count) && signal.sample_count >= 0
      ? signal.sample_count
      : digits.length;
    const digitSampleCount = Math.min(reportedSampleCount, digits.length);
    if (digitSampleCount <= input.duration) continue;

    const sampledDigits = digits.slice(-digitSampleCount);
    const expiryDigits = sampledDigits.slice(input.duration);
    const sampleCount = Math.min(digitSampleCount - input.duration, expiryDigits.length);
    if (sampleCount < minimumSample) continue;

    const latestDigit = input.latestDigits[signal.symbol] ?? sampledDigits.at(-1);
    if (!Number.isInteger(latestDigit) || latestDigit! < 0 || latestDigit! > 9) continue;
    const oppositeGroup = getAutoTraderOppositeDigitGroup(latestDigit);
    const scanCounts = input.scanFrequencies[signal.symbol];
    if (!oppositeGroup || !Array.isArray(scanCounts) || scanCounts.length < 10) continue;

    const outcomes = expiryDigits.slice(0, sampleCount);
    for (let barrier = oppositeGroup.minDigit; barrier <= oppositeGroup.maxDigit; barrier += 1) {
      if (scanCounts[barrier] !== 0) continue;
      const wins = outcomes.filter((digit) => digit !== barrier).length;
      const observedWinRate = (wins / sampleCount) * 100;
      if (observedWinRate <= minimumObservedWinRate) continue;
      candidates.push({
        symbol: signal.symbol,
        barrier,
        latestDigit,
        observedWinRate,
        sampleCount,
        marketOrder: order,
      });
    }
  }

  candidates.sort((left, right) =>
    right.observedWinRate - left.observedWinRate
    || right.sampleCount - left.sampleCount
    || left.marketOrder - right.marketOrder
    || left.barrier - right.barrier
  );
  const { marketOrder: _marketOrder, ...bestCandidate } = candidates[0] ?? {};
  return candidates.length ? bestCandidate as AutoMagicCandidate : null;
}
