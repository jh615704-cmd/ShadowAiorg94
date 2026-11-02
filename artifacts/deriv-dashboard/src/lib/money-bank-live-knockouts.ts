export const MONEY_BANK_LIVE_KNOCKOUT_LIMIT = 8;
export const MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES = 12;
export const MONEY_BANK_KNOCKOUT_GROWTH_RATES = [1, 2, 3, 4, 5] as const;

const FORECAST_WINDOW_SIZE = 41;

export type MoneyBankKnockoutGrowthRate = typeof MONEY_BANK_KNOCKOUT_GROWTH_RATES[number];

export type MoneyBankKnockoutForecast = {
  ticksToKnockout: number;
  sequence: number;
};

export type MoneyBankKnockoutEvaluationReason =
  | "sparse-quotes"
  | "flat-movement"
  | "invalid-model-input"
  | "barrier-already-crossed"
  | "tick-gap"
  | "feed-restarted";

export type MoneyBankKnockoutEvaluation = {
  growthRate: MoneyBankKnockoutGrowthRate;
  estimateTicks: number | null;
  startSequence: number;
  lastSequence: number;
  referenceQuote: number | null;
  barrier: number | null;
  actualTicks: number | null;
  status: "watching" | "hit" | "unscorable";
  reason: MoneyBankKnockoutEvaluationReason | null;
};

type EstimateMoneyBankKnockoutTicksInput = {
  quotes: readonly number[];
  barrier: number | null;
  referenceQuote: number | null;
};

type MoneyBankKnockoutEvaluationRateInput = {
  growthRate: MoneyBankKnockoutGrowthRate;
  barrier: number | null;
  referenceQuote: number | null;
};

type StartMoneyBankKnockoutEvaluationInput = {
  quotes: readonly number[];
  sequence: number;
  rates: readonly MoneyBankKnockoutEvaluationRateInput[];
};

type AdvanceMoneyBankKnockoutEvaluationInput = {
  quote: number;
  sequence: number;
};

function getForecastInputsIssue({
  quotes,
  barrier,
  referenceQuote,
}: EstimateMoneyBankKnockoutTicksInput): MoneyBankKnockoutEvaluationReason | null {
  if (!Number.isFinite(barrier) || barrier! <= 0
    || !Number.isFinite(referenceQuote) || referenceQuote! <= 0) {
    return "invalid-model-input";
  }

  const window = quotes
    .filter((quote) => Number.isFinite(quote) && quote > 0)
    .slice(-FORECAST_WINDOW_SIZE);
  if (window.length < MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES) return "sparse-quotes";

  const squaredMoves = window.slice(1).map((quote, index) => {
    const move = quote - window[index]!;
    return move * move;
  });
  const meanSquaredMove = squaredMoves.reduce((sum, move) => sum + move, 0) / squaredMoves.length;
  if (!Number.isFinite(meanSquaredMove)) return "invalid-model-input";
  if (meanSquaredMove <= Number.EPSILON) return "flat-movement";
  return null;
}

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
  if (getForecastInputsIssue({ quotes, barrier, referenceQuote }) != null) return null;

  const window = quotes
    .filter((quote) => Number.isFinite(quote) && quote > 0)
    .slice(-FORECAST_WINDOW_SIZE);

  const squaredMoves = window.slice(1).map((quote, index) => {
    const move = quote - window[index]!;
    return move * move;
  });
  const meanSquaredMove = squaredMoves.reduce((sum, move) => sum + move, 0) / squaredMoves.length;

  const currentQuote = window.at(-1)!;
  const barrierDistance = Math.abs(currentQuote - referenceQuote!);
  const remainingVariance = barrier! ** 2 - barrierDistance ** 2;
  if (!Number.isFinite(remainingVariance)) return null;
  if (remainingVariance <= 0) return 1;

  const estimate = Math.ceil(remainingVariance / meanSquaredMove);
  return Number.isSafeInteger(estimate) && estimate > 0 ? estimate : null;
}

export function startMoneyBankKnockoutEvaluation({
  quotes,
  sequence,
  rates,
}: StartMoneyBankKnockoutEvaluationInput): MoneyBankKnockoutEvaluation[] {
  if (!Number.isSafeInteger(sequence) || sequence < 0) return [];

  return rates.map(({ growthRate, barrier, referenceQuote }) => {
    const validQuotes = quotes.filter((quote) => Number.isFinite(quote) && quote > 0);
    const issue = getForecastInputsIssue({ quotes: validQuotes, barrier, referenceQuote });
    const currentQuote = validQuotes.at(-1);
    const alreadyAtBarrier = barrier != null
      && referenceQuote != null
      && currentQuote != null
      && Math.abs(currentQuote - referenceQuote) >= barrier;
    const startIssue = issue ?? (alreadyAtBarrier ? "barrier-already-crossed" : null);
    const estimateTicks = startIssue == null
      ? estimateMoneyBankKnockoutTicks({ quotes, barrier, referenceQuote })
      : null;
    const reason = startIssue ?? (estimateTicks == null ? "invalid-model-input" : null);

    return {
      growthRate,
      estimateTicks,
      startSequence: sequence,
      lastSequence: sequence,
      referenceQuote: Number.isFinite(referenceQuote) && referenceQuote! > 0 ? referenceQuote : null,
      barrier: Number.isFinite(barrier) && barrier! > 0 ? barrier : null,
      actualTicks: null,
      status: estimateTicks == null ? "unscorable" : "watching",
      reason,
    };
  });
}

export function advanceMoneyBankKnockoutEvaluation(
  evaluations: readonly MoneyBankKnockoutEvaluation[],
  { quote, sequence }: AdvanceMoneyBankKnockoutEvaluationInput,
): MoneyBankKnockoutEvaluation[] {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isFinite(quote) || quote <= 0) {
    return [...evaluations];
  }

  return evaluations.map((evaluation) => {
    if (evaluation.status !== "watching" || sequence === evaluation.lastSequence) return evaluation;

    if (sequence < evaluation.lastSequence) {
      return {
        ...evaluation,
        lastSequence: sequence,
        status: "unscorable",
        reason: "feed-restarted",
      };
    }

    if (sequence !== evaluation.lastSequence + 1) {
      return {
        ...evaluation,
        lastSequence: sequence,
        status: "unscorable",
        reason: "tick-gap",
      };
    }

    const actualTicks = sequence - evaluation.startSequence;
    const hitBarrier = evaluation.barrier != null
      && evaluation.referenceQuote != null
      && Math.abs(quote - evaluation.referenceQuote) >= evaluation.barrier;

    return {
      ...evaluation,
      lastSequence: sequence,
      actualTicks: hitBarrier ? actualTicks : null,
      status: hitBarrier ? "hit" : "watching",
    };
  });
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
