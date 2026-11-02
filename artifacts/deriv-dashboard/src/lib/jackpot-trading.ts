export type JackpotMarketGroup = "bear" | "bull" | "volatility" | "jump";
export type JackpotRiseFallSide = "CALL" | "PUT" | "AUTO";
export type JackpotEvenOddSide = "DIGITEVEN" | "DIGITODD" | "AUTO";

export interface JackpotMarketSignal {
  symbol: string;
  group: JackpotMarketGroup;
  risePercentage: number | null;
  fallPercentage: number | null;
  evenPercentage: number | null;
  oddPercentage: number | null;
  sampleCount: number;
}

export interface JackpotResolvedPair {
  riseFallType: Exclude<JackpotRiseFallSide, "AUTO">;
  evenOddType: Exclude<JackpotEvenOddSide, "AUTO">;
  riseFallRate: number | null;
  evenOddRate: number | null;
}

export interface JackpotBestMarket extends JackpotResolvedPair {
  symbol: string;
  sampleCount: number;
  score: number;
}

export const JACKPOT_MIN_AUTO_SAMPLES = 20;

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
  const riseRate = observedRate(signal.risePercentage, signal.sampleCount);
  const fallRate = observedRate(signal.fallPercentage, signal.sampleCount);
  const evenRate = observedRate(signal.evenPercentage, signal.sampleCount);
  const oddRate = observedRate(signal.oddPercentage, signal.sampleCount);

  const riseFallType = riseFallSide === "AUTO"
    ? riseRate == null && fallRate == null
      ? null
      : (riseRate ?? -1) >= (fallRate ?? -1) ? "CALL" : "PUT"
    : riseFallSide;
  const evenOddType = evenOddSide === "AUTO"
    ? evenRate == null && oddRate == null
      ? null
      : (evenRate ?? -1) >= (oddRate ?? -1) ? "DIGITEVEN" : "DIGITODD"
    : evenOddSide;

  if (!riseFallType || !evenOddType) return null;
  return {
    riseFallType,
    evenOddType,
    riseFallRate: riseFallType === "CALL" ? signal.risePercentage : signal.fallPercentage,
    evenOddRate: evenOddType === "DIGITEVEN" ? signal.evenPercentage : signal.oddPercentage,
  };
}

export function chooseJackpotBestMarket(
  signals: readonly JackpotMarketSignal[],
  group: JackpotMarketGroup,
  riseFallSide: JackpotRiseFallSide,
  evenOddSide: JackpotEvenOddSide,
): JackpotBestMarket | null {
  const candidates = signals.flatMap((signal) => {
    if (signal.group !== group || signal.sampleCount < JACKPOT_MIN_AUTO_SAMPLES) return [];
    const pair = resolveJackpotPair(signal, riseFallSide, evenOddSide);
    if (!pair) return [];
    const riseFallRate = pair.riseFallType === "CALL"
      ? observedRate(signal.risePercentage, signal.sampleCount)
      : observedRate(signal.fallPercentage, signal.sampleCount);
    const evenOddRate = pair.evenOddType === "DIGITEVEN"
      ? observedRate(signal.evenPercentage, signal.sampleCount)
      : observedRate(signal.oddPercentage, signal.sampleCount);
    if (riseFallRate == null || evenOddRate == null) return [];
    return [{
      ...pair,
      symbol: signal.symbol,
      sampleCount: signal.sampleCount,
      score: (riseFallRate + evenOddRate) / 2,
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
