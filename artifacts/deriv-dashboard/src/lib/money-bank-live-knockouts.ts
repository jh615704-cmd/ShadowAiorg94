export const MONEY_BANK_LIVE_KNOCKOUT_LIMIT = 8;
export const MONEY_BANK_KNOCKOUT_GROWTH_RATES = [1, 2, 3, 4, 5] as const;

const DURATION_SAMPLE_LIMIT = 200;

export type MoneyBankKnockoutGrowthRate = typeof MONEY_BANK_KNOCKOUT_GROWTH_RATES[number];

export type MoneyBankKnockoutForecast = {
  ticksToKnockout: number;
  sequence: number;
};

export type MoneyBankKnockoutEvaluationReason =
  | "insufficient-duration-samples"
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
  ticksStayedIn: readonly number[];
  elapsedTicks: number;
};

type MoneyBankKnockoutEvaluationRateInput = {
  growthRate: MoneyBankKnockoutGrowthRate;
  barrier: number | null;
  referenceQuote: number | null;
  ticksStayedIn: readonly number[];
  elapsedTicks: number;
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

/**
 * Estimate remaining ticks from Deriv's per-rate historical durations between
 * Accumulator barriers. The estimate is empirical, informational, and not a
 * guarantee of a future market move.
 */
export function estimateMoneyBankKnockoutTicks({
  ticksStayedIn,
  elapsedTicks,
}: EstimateMoneyBankKnockoutTicksInput): number | null {
  if (!Number.isSafeInteger(elapsedTicks) || elapsedTicks < 0) return null;
  const samples = ticksStayedIn
    .filter((ticks) => Number.isSafeInteger(ticks) && ticks > 0)
    .slice(-DURATION_SAMPLE_LIMIT);
  if (!samples.length) return null;

  const averageDuration = samples.reduce((sum, ticks) => sum + ticks, 0) / samples.length;
  if (!Number.isFinite(averageDuration) || averageDuration <= 0) return null;

  return Math.max(1, Math.ceil(averageDuration) - elapsedTicks);
}

export function startMoneyBankKnockoutEvaluation({
  quotes,
  sequence,
  rates,
}: StartMoneyBankKnockoutEvaluationInput): MoneyBankKnockoutEvaluation[] {
  if (!Number.isSafeInteger(sequence) || sequence < 0) return [];

  return rates.map(({ growthRate, barrier, referenceQuote, ticksStayedIn, elapsedTicks }) => {
    const validQuotes = quotes.filter((quote) => Number.isFinite(quote) && quote > 0);
    const barrierIsValid = Number.isFinite(barrier) && barrier! > 0
      && Number.isFinite(referenceQuote) && referenceQuote! > 0;
    const estimateTicks = barrierIsValid
      ? estimateMoneyBankKnockoutTicks({ ticksStayedIn, elapsedTicks })
      : null;
    const currentQuote = validQuotes.at(-1);
    const alreadyAtBarrier = barrier != null
      && referenceQuote != null
      && currentQuote != null
      && Math.abs(currentQuote - referenceQuote) >= barrier;
    const reason = alreadyAtBarrier
      ? "barrier-already-crossed"
      : estimateTicks == null
        ? barrierIsValid ? "insufficient-duration-samples" : "invalid-model-input"
        : null;

    return {
      growthRate,
      estimateTicks: alreadyAtBarrier ? null : estimateTicks,
      startSequence: sequence,
      lastSequence: sequence,
      referenceQuote: Number.isFinite(referenceQuote) && referenceQuote! > 0 ? referenceQuote : null,
      barrier: Number.isFinite(barrier) && barrier! > 0 ? barrier : null,
      actualTicks: null,
      status: alreadyAtBarrier || estimateTicks == null ? "unscorable" : "watching",
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
