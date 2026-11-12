export const MONEY_BANK_KNOCKOUT_RATES = [1, 2, 3, 4, 5] as const;
export const MONEY_BANK_KNOCKOUT_QUOTE_WINDOW = 200;
export const MONEY_BANK_KNOCKOUT_MIN_TRAINING_WINDOWS = 20;
export const MONEY_BANK_KNOCKOUT_MIN_HOLDOUT_WINDOWS = 5;

export type MoneyBankKnockoutEstimate = {
  training_windows: number;
  training_knockouts: number;
  holdout_windows: number;
  observed_knockouts: number;
  estimated_knockouts: number | null;
  estimate_lower_count: number | null;
  estimate_upper_count: number | null;
  estimated_knockout_rate: number | null;
  observed_knockout_rate: number | null;
  holdout_gap_percentage_points: number | null;
  status: "ready" | "insufficient_evidence";
};

function knockoutOutcomes(
  quotes: readonly number[],
  barrier: number,
  durationTicks: number,
): boolean[] {
  const stride = durationTicks + 1;
  const outcomes: boolean[] = [];

  for (let start = 0; start + durationTicks < quotes.length; start += stride) {
    const entryQuote = quotes[start]!;
    if (!Number.isFinite(entryQuote) || entryQuote <= 0) continue;
    let knockedOut = false;
    let validWindow = true;
    for (let tick = start + 1; tick <= start + durationTicks; tick += 1) {
      const quote = quotes[tick]!;
      if (!Number.isFinite(quote) || quote <= 0) {
        validWindow = false;
        break;
      }
      if (Math.abs(quote - entryQuote) >= barrier) {
        knockedOut = true;
        break;
      }
    }
    if (validWindow) outcomes.push(knockedOut);
  }

  return outcomes;
}

function wilsonInterval(successes: number, trials: number) {
  if (trials <= 0) return null;
  const z = 1.959963984540054;
  const observedRate = successes / trials;
  const zSquared = z * z;
  const denominator = 1 + zSquared / trials;
  const center = (observedRate + zSquared / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt(
    (observedRate * (1 - observedRate) + zSquared / (4 * trials)) / trials,
  )) / denominator;

  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

/**
 * Uses the earlier 70% of a live quote window to estimate knockout frequency,
 * then checks it against later, non-overlapping contract-length windows.
 */
export function estimateMoneyBankKnockouts(
  input: {
    quotes: readonly number[];
    barrier: number;
    durationTicks: number;
  },
  minimums: {
    trainingWindows?: number;
    holdoutWindows?: number;
  } = {},
): MoneyBankKnockoutEstimate {
  if (!Number.isFinite(input.barrier) || input.barrier <= 0) {
    throw new RangeError("A positive finite Accumulator barrier is required.");
  }
  if (!Number.isInteger(input.durationTicks) || input.durationTicks < 1 || input.durationTicks > 30) {
    throw new RangeError("Accumulator sample duration must be from 1 to 30 ticks.");
  }
  const durationTicks = Math.floor(input.durationTicks);
  const quotes = input.quotes;
  const splitIndex = Math.floor(quotes.length * 0.7);
  const training = knockoutOutcomes(quotes.slice(0, splitIndex), input.barrier, durationTicks);
  const holdout = knockoutOutcomes(quotes.slice(splitIndex), input.barrier, durationTicks);
  const trainingKnockouts = training.filter(Boolean).length;
  const observedKnockouts = holdout.filter(Boolean).length;
  const estimatedRate = training.length ? trainingKnockouts / training.length : null;
  const observedRate = holdout.length ? observedKnockouts / holdout.length : null;
  const interval = wilsonInterval(trainingKnockouts, training.length);
  const enoughEvidence = training.length >= (
    minimums.trainingWindows ?? MONEY_BANK_KNOCKOUT_MIN_TRAINING_WINDOWS
  ) && holdout.length >= (
    minimums.holdoutWindows ?? MONEY_BANK_KNOCKOUT_MIN_HOLDOUT_WINDOWS
  );
  const estimatedKnockouts = enoughEvidence && estimatedRate != null
    ? estimatedRate * holdout.length
    : null;

  return {
    training_windows: training.length,
    training_knockouts: trainingKnockouts,
    holdout_windows: holdout.length,
    observed_knockouts: observedKnockouts,
    estimated_knockouts: estimatedKnockouts,
    estimate_lower_count: enoughEvidence && interval ? interval.lower * holdout.length : null,
    estimate_upper_count: enoughEvidence && interval ? interval.upper * holdout.length : null,
    estimated_knockout_rate: enoughEvidence ? estimatedRate : null,
    observed_knockout_rate: observedRate,
    holdout_gap_percentage_points: enoughEvidence && estimatedRate != null && observedRate != null
      ? (observedRate - estimatedRate) * 100
      : null,
    status: enoughEvidence ? "ready" : "insufficient_evidence",
  };
}
