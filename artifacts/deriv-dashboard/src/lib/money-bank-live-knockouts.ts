export const MONEY_BANK_LIVE_KNOCKOUT_LIMIT = 8;
export const MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES = 12;

const FORECAST_WINDOW_SIZE = 41;

export type MoneyBankKnockoutForecast = {
  ticksToKnockout: number;
  sequence: number;
};

type EstimateMoneyBankKnockoutTicksInput = {
  quotes: readonly number[];
  barrier: number | null;
  referenceQuote: number | null;
};

/**
 * Estimate how many ticks remain before a rate-specific barrier is reached.
 * The estimate uses recent live quote movement as a simple first-passage
 * model; it is informational and is not a guarantee of a future market move.
 */
export function estimateMoneyBankKnockoutTicks({
  quotes,
  barrier,
  referenceQuote,
}: EstimateMoneyBankKnockoutTicksInput): number | null {
  if (!Number.isFinite(barrier) || barrier! <= 0) return null;
  if (!Number.isFinite(referenceQuote) || referenceQuote! <= 0) return null;

  const window = quotes
    .filter((quote) => Number.isFinite(quote) && quote > 0)
    .slice(-FORECAST_WINDOW_SIZE);
  if (window.length < MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES) return null;

  const squaredMoves = window.slice(1).map((quote, index) => {
    const move = quote - window[index]!;
    return move * move;
  });
  const meanSquaredMove = squaredMoves.reduce((sum, move) => sum + move, 0) / squaredMoves.length;
  if (!Number.isFinite(meanSquaredMove) || meanSquaredMove <= Number.EPSILON) return null;

  const currentQuote = window.at(-1)!;
  const barrierDistance = Math.abs(currentQuote - referenceQuote!);
  const remainingVariance = barrier! ** 2 - barrierDistance ** 2;
  if (!Number.isFinite(remainingVariance)) return null;
  if (remainingVariance <= 0) return 1;

  const estimate = Math.ceil(remainingVariance / meanSquaredMove);
  return Number.isSafeInteger(estimate) && estimate > 0 ? estimate : null;
}

export function appendMoneyBankKnockoutForecast(
  existingForecasts: readonly MoneyBankKnockoutForecast[],
  forecast: MoneyBankKnockoutForecast,
): MoneyBankKnockoutForecast[] {
  const validForecasts = existingForecasts
    .filter((item) => Number.isSafeInteger(item.ticksToKnockout)
      && item.ticksToKnockout > 0
      && Number.isSafeInteger(item.sequence))
    .slice(-MONEY_BANK_LIVE_KNOCKOUT_LIMIT);

  if (!Number.isSafeInteger(forecast.ticksToKnockout)
    || forecast.ticksToKnockout <= 0
    || !Number.isSafeInteger(forecast.sequence)) {
    return [...validForecasts];
  }

  return [...validForecasts, forecast].slice(-MONEY_BANK_LIVE_KNOCKOUT_LIMIT);
}
