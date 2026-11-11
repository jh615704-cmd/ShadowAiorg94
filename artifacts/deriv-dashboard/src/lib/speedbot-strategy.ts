import {
  AUTO_MAGIC_MIN_OBSERVED_WIN_RATE,
  AUTO_MAGIC_MIN_SAMPLE,
  chooseAutoMagicCandidate,
  type AutoMagicCandidate,
  type AutoMagicSignal,
} from "./auto-magic-strategy.ts";
import {
  isDerivHistoryOpen,
  uniqueDerivHistoryRows,
  type DerivHistoryRow,
} from "./deriv-history.ts";

export const SPEEDBOT_MIN_EXPIRY_SAMPLES = AUTO_MAGIC_MIN_SAMPLE;
export const SPEEDBOT_MIN_OBSERVED_WIN_RATE = AUTO_MAGIC_MIN_OBSERVED_WIN_RATE;
export const SPEEDBOT_MIN_STAKE = 0.35;
export const SPEEDBOT_MAX_LOSS_MULTIPLIER = 10;

export function getSpeedbotNextStake(
  rows: readonly DerivHistoryRow[],
  accountId: string | null,
  runContractIds: ReadonlySet<string>,
  baseStake: number,
  lossMultiplier: number,
): number | null {
  if (
    !Number.isFinite(baseStake)
    || baseStake < SPEEDBOT_MIN_STAKE
    || !Number.isFinite(lossMultiplier)
    || lossMultiplier < 1
    || lossMultiplier > SPEEDBOT_MAX_LOSS_MULTIPLIER
  ) return null;

  let nextStake = Number((baseStake + Number.EPSILON).toFixed(2));
  if (runContractIds.size === 0) return nextStake;
  if (!accountId) return null;

  const rowsByContractId = new Map(
    uniqueDerivHistoryRows(rows)
      .filter((row) => String(row.account_id) === accountId)
      .map((row) => [String(row.contract_id), row]),
  );
  const runRows: DerivHistoryRow[] = [];

  for (const contractId of runContractIds) {
    const row = rowsByContractId.get(contractId);
    if (!row || isDerivHistoryOpen(row.status) || !Number.isFinite(row.profit)) return null;
    runRows.push(row);
  }

  runRows.sort((left, right) =>
    (left.buy_time ?? 0) - (right.buy_time ?? 0)
    || String(left.contract_id).localeCompare(String(right.contract_id)),
  );

  for (const row of runRows) {
    nextStake = row.profit < 0
      ? Number((nextStake * lossMultiplier + Number.EPSILON).toFixed(2))
      : Number((baseStake + Number.EPSILON).toFixed(2));
    if (!Number.isFinite(nextStake) || nextStake < SPEEDBOT_MIN_STAKE) return null;
  }

  return nextStake;
}

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
