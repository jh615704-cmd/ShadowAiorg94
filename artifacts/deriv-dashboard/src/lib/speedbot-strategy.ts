import {
  AUTO_MAGIC_MIN_OBSERVED_WIN_RATE,
  AUTO_MAGIC_MIN_SAMPLE,
  chooseAutoMagicCandidate,
  type AutoMagicCandidate,
  type AutoMagicSignal,
} from "./auto-magic-strategy";

export const SPEEDBOT_MIN_EXPIRY_SAMPLES = AUTO_MAGIC_MIN_SAMPLE;
export const SPEEDBOT_MIN_OBSERVED_WIN_RATE = AUTO_MAGIC_MIN_OBSERVED_WIN_RATE;

export function getSpeedbotSessionStopReason(
  sessionPnl: number,
  takeProfit: number,
  lossLimit: number,
): "take-profit" | "loss-limit" | null {
  if (!Number.isFinite(sessionPnl)) return "loss-limit";
  if (Number.isFinite(takeProfit) && takeProfit > 0 && sessionPnl >= takeProfit) return "take-profit";
  if (Number.isFinite(lossLimit) && lossLimit > 0 && sessionPnl <= -lossLimit) return "loss-limit";
  return null;
}

export function chooseSpeedbotCandidate(input: {
  signal: AutoMagicSignal;
  latestDigit: number;
  scanFrequencies: readonly number[];
  duration: number;
}): AutoMagicCandidate | null {
  const { symbol } = input.signal;
  return chooseAutoMagicCandidate({
    signals: [input.signal],
    markets: [{ symbol }],
    latestDigits: { [symbol]: input.latestDigit },
    scanFrequencies: { [symbol]: input.scanFrequencies },
    duration: input.duration,
    minimumSample: SPEEDBOT_MIN_EXPIRY_SAMPLES,
    minimumObservedWinRate: SPEEDBOT_MIN_OBSERVED_WIN_RATE,
  });
}
