export const AI_SCANNER_MIN_SAMPLE = 20;

export type AiScannerMarketSignal = {
  symbol: string;
  sample_count: number;
  digit_even_percentage: number;
  digit_odd_percentage: number;
  rise_percentage?: number | null;
  fall_percentage?: number | null;
  digit_outcomes?: Array<{
    digit: number;
    over_percentage: number;
    under_percentage: number;
  }>;
};

export type BulkScannerCandidate = {
  symbol: string;
  contractType: "DIGITOVER" | "DIGITUNDER" | "DIGITDIFF";
  barrier: number;
  observedRate: number;
  sampleCount: number;
};

export type ParityScannerCandidate = {
  symbol: string;
  parity: "DIGITEVEN" | "DIGITODD";
  observedRate: number;
  sampleCount: number;
};

export function isValidDigitFlipParityRates(even: number, odd: number): boolean {
  return Number.isFinite(even)
    && even >= 0
    && even <= 100
    && Number.isFinite(odd)
    && odd >= 0
    && odd <= 100;
}

export type TradeXScannerCandidate = {
  symbol: string;
  digit: number;
  observedRate: number;
  sampleCount: number;
};

export type CashGrabScannerCandidate = {
  symbol: string;
  contractType: "CALL" | "PUT";
  observedRate: number;
  sampleCount: number;
};

export function isValidObservedPercentage(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 0 && rate <= 100;
}

export function digitDiffersRateFromPercentages(overRate: number, underRate: number): number | null {
  if (!isValidObservedPercentage(overRate) || !isValidObservedPercentage(underRate)) return null;
  const rate = overRate + underRate;
  if (rate > 100.1) return null;
  return Math.min(100, rate);
}

function eligibleSignals(
  signals: readonly AiScannerMarketSignal[],
  symbols: readonly string[],
  minimumSample: number,
) {
  const allowedSymbols = new Set(symbols);
  return signals.filter((signal) =>
    allowedSymbols.has(signal.symbol)
    && Number.isFinite(signal.sample_count)
    && signal.sample_count >= minimumSample,
  );
}

function strongest<T extends { observedRate: number; sampleCount: number; symbol: string }>(
  candidates: T[],
): T | null {
  candidates.sort((left, right) =>
    right.observedRate - left.observedRate
    || right.sampleCount - left.sampleCount
    || left.symbol.localeCompare(right.symbol)
    || ("digit" in left && "digit" in right ? Number(left.digit) - Number(right.digit) : 0),
  );
  return candidates[0] ?? null;
}

export function chooseBulkScannerCandidate(
  signals: readonly AiScannerMarketSignal[],
  symbols: readonly string[],
  type: "over-under" | "differs",
  prediction: number,
  minimumSample = AI_SCANNER_MIN_SAMPLE,
): BulkScannerCandidate | null {
  if (!Number.isInteger(prediction) || prediction < 0 || prediction > 9) return null;
  const candidates: BulkScannerCandidate[] = [];

  for (const signal of eligibleSignals(signals, symbols, minimumSample)) {
    const outcome = signal.digit_outcomes?.find((item) => item.digit === prediction);
    if (!outcome) continue;
    const overRate = Number(outcome.over_percentage);
    const underRate = Number(outcome.under_percentage);
    if (!isValidObservedPercentage(overRate) || !isValidObservedPercentage(underRate)) continue;

    if (type === "differs") {
      const observedRate = digitDiffersRateFromPercentages(overRate, underRate);
      if (observedRate == null) continue;
      candidates.push({
        symbol: signal.symbol,
        contractType: "DIGITDIFF",
        barrier: prediction,
        observedRate,
        sampleCount: signal.sample_count,
      });
      continue;
    }

    if (prediction < 9) {
      candidates.push({
        symbol: signal.symbol,
        contractType: "DIGITOVER",
        barrier: prediction,
        observedRate: overRate,
        sampleCount: signal.sample_count,
      });
    }
    if (prediction > 0) {
      candidates.push({
        symbol: signal.symbol,
        contractType: "DIGITUNDER",
        barrier: prediction,
        observedRate: underRate,
        sampleCount: signal.sample_count,
      });
    }
  }

   return strongest(candidates);
 }

export function chooseCashGrabDirectionalMarket(
  signals: readonly AiScannerMarketSignal[],
  symbols: readonly string[],
  direction: "CALL" | "PUT",
  minimumSample = AI_SCANNER_MIN_SAMPLE,
): string | null {
  const candidates = eligibleSignals(signals, symbols, minimumSample)
    .map((signal) => ({
      symbol: signal.symbol,
      observedRate: Number(direction === "CALL" ? signal.rise_percentage : signal.fall_percentage),
      sampleCount: signal.sample_count,
    }))
    .filter((candidate) =>
      Number.isInteger(candidate.sampleCount)
      && isValidObservedPercentage(candidate.observedRate)
      && candidate.observedRate >= 50,
    );
  return strongest(candidates)?.symbol ?? null;
}

export function chooseDigitFlipScannerCandidate(
  signals: readonly AiScannerMarketSignal[],
  symbols: readonly string[],
  minimumSample = AI_SCANNER_MIN_SAMPLE,
): ParityScannerCandidate | null {
  const candidates = eligibleSignals(signals, symbols, minimumSample)
    .filter((signal) => isValidDigitFlipParityRates(
      signal.digit_even_percentage,
      signal.digit_odd_percentage,
    ))
    .map((signal) => {
    const parity = signal.digit_even_percentage >= signal.digit_odd_percentage
      ? "DIGITEVEN" as const
      : "DIGITODD" as const;
    return {
      symbol: signal.symbol,
      parity,
      observedRate: Math.max(signal.digit_even_percentage, signal.digit_odd_percentage),
      sampleCount: signal.sample_count,
    };
  });

  return strongest(candidates);
}

export function chooseTradeXScannerCandidate(
  signals: readonly AiScannerMarketSignal[],
  symbols: readonly string[],
  minimumSample = AI_SCANNER_MIN_SAMPLE,
): TradeXScannerCandidate | null {
  const candidates: TradeXScannerCandidate[] = [];
  for (const signal of eligibleSignals(signals, symbols, minimumSample)) {
    for (const outcome of signal.digit_outcomes ?? []) {
      const overRate = Number(outcome.over_percentage);
      const underRate = Number(outcome.under_percentage);
      if (!Number.isFinite(overRate) || !Number.isFinite(underRate)) continue;
      candidates.push({
        symbol: signal.symbol,
        digit: outcome.digit,
        observedRate: overRate + underRate,
        sampleCount: signal.sample_count,
      });
    }
  }
  return strongest(candidates);
}

export function chooseCashGrabScannerCandidate(
  signals: readonly AiScannerMarketSignal[],
  symbols: readonly string[],
  minimumSample = AI_SCANNER_MIN_SAMPLE,
): CashGrabScannerCandidate | null {
  const candidates: CashGrabScannerCandidate[] = [];
  for (const signal of eligibleSignals(signals, symbols, minimumSample)) {
    const riseRate = Number(signal.rise_percentage);
    const fallRate = Number(signal.fall_percentage);
    if (!Number.isInteger(signal.sample_count)) continue;
    if (
      !Number.isFinite(riseRate)
      || !Number.isFinite(fallRate)
      || riseRate < 0
      || riseRate > 100
      || fallRate < 0
      || fallRate > 100
      || riseRate === fallRate
    ) continue;
    candidates.push({
      symbol: signal.symbol,
      contractType: riseRate > fallRate ? "CALL" : "PUT",
      observedRate: Math.max(riseRate, fallRate),
      sampleCount: signal.sample_count,
    });
  }
  return strongest(candidates);
}