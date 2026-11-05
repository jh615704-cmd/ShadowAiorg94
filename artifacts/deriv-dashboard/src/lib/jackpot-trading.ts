export type JackpotMarketGroup = "bear" | "bull" | "volatility" | "jump";
export type JackpotRiseFallSide = "CALL" | "PUT" | "AUTO";
export type JackpotEvenOddSide = "DIGITEVEN" | "DIGITODD" | "AUTO";

export interface JackpotMarketSignal {
  symbol: string;
  group: JackpotMarketGroup;
  tickSequence?: number;
  tickEpoch: number;
  risePercentage: number | null;
  fallPercentage: number | null;
  evenPercentage: number | null;
  oddPercentage: number | null;
  sampleCount: number;
}

export type JackpotContractType = "CALL" | "PUT" | "DIGITEVEN" | "DIGITODD";

export interface JackpotResolvedPair {
  riseFallType: Exclude<JackpotRiseFallSide, "AUTO">;
  evenOddType: Exclude<JackpotEvenOddSide, "AUTO">;
  riseFallRate: number | null;
  evenOddRate: number | null;
}

export interface JackpotResolvedSelection {
  contractTypes: JackpotContractType[];
  rates: Array<number | null>;
}

export interface JackpotBestMarket {
  symbol: string;
  sampleCount: number;
  tickSequence: number;
  contractType: JackpotContractType;
  observedRate: number;
  score: number;
}

export interface JackpotBestBatch {
  symbol: string;
  sampleCount: number;
  tickSequence: number;
  contractTypes: JackpotContractType[];
  observedRate: number;
  score: number;
}

export const JACKPOT_MIN_AUTO_SAMPLES = 50;
export const JACKPOT_MIN_AUTO_OBSERVED_RATE = 68;
export const JACKPOT_MAX_SIGNAL_AGE_SECONDS = 30;

function hasFreshMarketSample(
  signal: JackpotMarketSignal,
  nowEpoch = Math.floor(Date.now() / 1000),
) {
  return Number.isFinite(signal.tickEpoch)
    && signal.tickEpoch > 0
    && signal.tickEpoch <= nowEpoch + 5
    && nowEpoch - signal.tickEpoch <= JACKPOT_MAX_SIGNAL_AGE_SECONDS;
}

function validRate(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function observedRate(value: number | null, sampleCount: number) {
  if (!validRate(value) || sampleCount < JACKPOT_MIN_AUTO_SAMPLES) return null;
  // Keep smaller samples closer to a neutral 50% reference.
  return (value * sampleCount + 50 * JACKPOT_MIN_AUTO_SAMPLES) / (sampleCount + JACKPOT_MIN_AUTO_SAMPLES);
}

export function resolveJackpotPair(
  signal: JackpotMarketSignal | null | undefined,
  riseFallSide: JackpotRiseFallSide,
  evenOddSide: JackpotEvenOddSide,
): JackpotResolvedPair | null {
  if (!signal) {
    if (riseFallSide === "AUTO" || evenOddSide === "AUTO") return null;
    return {
      riseFallType: riseFallSide,
      evenOddType: evenOddSide,
      riseFallRate: null,
      evenOddRate: null,
    };
  }
  const riseFallType = resolveDirection(signal, riseFallSide);
  const evenOddType = resolveParity(signal, evenOddSide);

  if (!riseFallType || !evenOddType) return null;
  return {
    riseFallType,
    evenOddType,
    riseFallRate: riseFallType === "CALL" ? signal.risePercentage : signal.fallPercentage,
    evenOddRate: evenOddType === "DIGITEVEN" ? signal.evenPercentage : signal.oddPercentage,
  };
}

function resolveDirection(
  signal: JackpotMarketSignal | null | undefined,
  side: JackpotRiseFallSide,
) {
  if (side !== "AUTO") return side;
  if (!signal || signal.sampleCount < JACKPOT_MIN_AUTO_SAMPLES || !hasFreshMarketSample(signal)) return null;
  const riseRate = observedRate(signal.risePercentage, signal.sampleCount);
  const fallRate = observedRate(signal.fallPercentage, signal.sampleCount);
  if (riseRate == null && fallRate == null) return null;
  return (riseRate ?? -1) >= (fallRate ?? -1) ? "CALL" : "PUT";
}

function resolveParity(
  signal: JackpotMarketSignal | null | undefined,
  side: JackpotEvenOddSide,
) {
  if (side !== "AUTO") return side;
  if (!signal || signal.sampleCount < JACKPOT_MIN_AUTO_SAMPLES || !hasFreshMarketSample(signal)) return null;
  const evenRate = observedRate(signal.evenPercentage, signal.sampleCount);
  const oddRate = observedRate(signal.oddPercentage, signal.sampleCount);
  if (evenRate == null && oddRate == null) return null;
  return (evenRate ?? -1) >= (oddRate ?? -1) ? "DIGITEVEN" : "DIGITODD";
}

export function resolveJackpotSelection(
  signal: JackpotMarketSignal | null | undefined,
  riseFallSide: JackpotRiseFallSide,
  evenOddSide: JackpotEvenOddSide,
  riseFallEnabled: boolean,
  evenOddEnabled: boolean,
): JackpotResolvedSelection | null {
  if (!riseFallEnabled && !evenOddEnabled) return null;
  const contractTypes: JackpotContractType[] = [];
  const rates: Array<number | null> = [];

  if (riseFallEnabled) {
    const direction = resolveDirection(signal, riseFallSide);
    if (!direction) return null;
    contractTypes.push(direction);
    rates.push(direction === "CALL" ? signal?.risePercentage ?? null : signal?.fallPercentage ?? null);
  }
  if (evenOddEnabled) {
    const parity = resolveParity(signal, evenOddSide);
    if (!parity) return null;
    contractTypes.push(parity);
    rates.push(parity === "DIGITEVEN" ? signal?.evenPercentage ?? null : signal?.oddPercentage ?? null);
  }
  return { contractTypes, rates };
}

export function buildJackpotContractTypes(
  selection: JackpotResolvedSelection,
  count: number,
): JackpotContractType[] {
  if (!Number.isInteger(count) || count < 1 || count > 20 || !selection.contractTypes.length) return [];
  const orderedTypes = selection.contractTypes
    .map((contractType, index) => ({ contractType, rate: selection.rates[index] ?? 50, index }))
    .sort((left, right) => right.rate - left.rate || left.index - right.index)
    .map(({ contractType }) => contractType);
  return Array.from({ length: count }, (_, index) => orderedTypes[index % orderedTypes.length]);
}

export function chooseJackpotBestMarket(
  signals: readonly JackpotMarketSignal[],
  group: JackpotMarketGroup,
  riseFallSide: JackpotRiseFallSide,
  evenOddSide: JackpotEvenOddSide,
  riseFallEnabled = true,
  evenOddEnabled = true,
  selectedSymbol?: string | null,
  minimumObservedRate = JACKPOT_MIN_AUTO_OBSERVED_RATE,
): JackpotBestMarket | null {
  if (!riseFallEnabled && !evenOddEnabled) return null;
  const candidates = signals.flatMap((signal) => {
    if (
      signal.group !== group
      || signal.sampleCount < JACKPOT_MIN_AUTO_SAMPLES
      || !hasFreshMarketSample(signal)
      || (selectedSymbol && signal.symbol !== selectedSymbol)
    ) return [];
    const selection = resolveJackpotSelection(
      signal,
      riseFallSide,
      evenOddSide,
      riseFallEnabled,
      evenOddEnabled,
    );
    if (!selection) return [];
    return selection.contractTypes.flatMap((contractType, index) => {
      const observedRate = selection.rates[index];
      if (observedRate == null || observedRate <= minimumObservedRate) return [];
      return [{
        symbol: signal.symbol,
        sampleCount: signal.sampleCount,
        tickSequence: signal.tickSequence ?? 0,
        contractType,
        observedRate,
        score: observedRate,
      }];
    });
  });

  return candidates.sort((left, right) =>
    right.score - left.score
    || right.sampleCount - left.sampleCount
    || left.symbol.localeCompare(right.symbol),
  )[0] ?? null;
}

export function chooseJackpotBestBatch(
  signals: readonly JackpotMarketSignal[],
  group: JackpotMarketGroup,
  riseFallSide: JackpotRiseFallSide,
  evenOddSide: JackpotEvenOddSide,
  riseFallEnabled: boolean,
  evenOddEnabled: boolean,
  count: number,
  selectedSymbol?: string | null,
  minimumObservedRate = JACKPOT_MIN_AUTO_OBSERVED_RATE,
): JackpotBestBatch | null {
  if (!Number.isInteger(count) || count < 1 || count > 20) return null;
  const candidates = signals.flatMap((signal) => {
    if (
      signal.group !== group
      || signal.sampleCount < JACKPOT_MIN_AUTO_SAMPLES
      || !hasFreshMarketSample(signal)
      || (selectedSymbol && signal.symbol !== selectedSymbol)
    ) return [];
    const selection = resolveJackpotSelection(
      signal,
      riseFallSide,
      evenOddSide,
      riseFallEnabled,
      evenOddEnabled,
    );
    if (!selection) return [];
    const qualifying = selection.contractTypes
      .map((contractType, index) => ({ contractType, rate: selection.rates[index] }))
      .filter((side): side is { contractType: JackpotContractType; rate: number } =>
        side.rate != null && side.rate > minimumObservedRate);
    if (!qualifying.length) return [];
    const qualifyingSelection: JackpotResolvedSelection = {
      contractTypes: qualifying.map((side) => side.contractType),
      rates: qualifying.map((side) => side.rate),
    };
    const averageRate = qualifying.reduce((total, side) => total + side.rate, 0) / qualifying.length;
    return [{
      symbol: signal.symbol,
      sampleCount: signal.sampleCount,
      tickSequence: signal.tickSequence ?? 0,
      contractTypes: buildJackpotContractTypes(qualifyingSelection, count),
      observedRate: averageRate,
      score: averageRate,
    }];
  });
  return candidates.sort((left, right) =>
    right.score - left.score
    || right.sampleCount - left.sampleCount
    || left.symbol.localeCompare(right.symbol),
  )[0] ?? null;
}

export function getJackpotStopReason(
  pnl: number,
  takeProfit: number,
  lossLimit: number,
) {
  if (takeProfit > 0 && pnl >= takeProfit) return "Take-profit limit reached.";
  if (lossLimit > 0 && pnl <= -lossLimit) return "Loss limit reached.";
  return null;
}

export function getJackpotNextStake(
  baseStake: number,
  currentStake: number,
  batchProfit: number,
  multiplyAfterLoss: boolean,
  multiplier: number,
) {
  const nextStake = multiplyAfterLoss && batchProfit < 0
    ? currentStake * multiplier
    : baseStake;
  return Math.round((nextStake + Number.EPSILON) * 100) / 100;
}
