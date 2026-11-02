export type AutoTraderMarketTickSignal = {
  symbol: string;
  tick_sequence: number;
  recent_digits: number[];
  tick_epoch: number;
};

export type AutoTraderOppositeDigitGroup = {
  minDigit: 0 | 5;
  maxDigit: 4 | 9;
  label: "0–4" | "5–9";
};

export function getAutoTraderOppositeDigitGroup(
  lastDigit: number | null | undefined,
): AutoTraderOppositeDigitGroup | null {
  if (!Number.isInteger(lastDigit) || lastDigit! < 0 || lastDigit! > 9) return null;
  return lastDigit! <= 4
    ? { minDigit: 5, maxDigit: 9, label: "5–9" }
    : { minDigit: 0, maxDigit: 4, label: "0–4" };
}

export function collectAutoTraderTickChanges(
  signals: readonly AutoTraderMarketTickSignal[],
  seenTicks: Record<string, number>,
  baselineTicks: Record<string, number>,
) {
  const arrivals: Array<{ symbol: string; digit: number }> = [];
  const progress: Record<string, number> = {};

  for (const signal of signals) {
    if (!signal || (signal.tick_sequence === 0 && signal.recent_digits.length === 0)) continue;

    let previous = seenTicks[signal.symbol];
    if (previous == null || signal.tick_sequence < previous) {
      // A fresh server runtime can restart its sequence at zero. Start a new
      // baseline instead of leaving the scanner stuck until the old count wins.
      previous = signal.tick_sequence - 1;
      seenTicks[signal.symbol] = previous;
      baselineTicks[signal.symbol] = previous;
    }

    const firstSequence = signal.tick_sequence - signal.recent_digits.length + 1;
    if (signal.tick_sequence > previous) {
      for (let index = 0; index < signal.recent_digits.length; index += 1) {
        const sequence = firstSequence + index;
        if (sequence <= previous) continue;
        const digit = signal.recent_digits[index];
        if (digit >= 0 && digit <= 9) arrivals.push({ symbol: signal.symbol, digit });
      }
      seenTicks[signal.symbol] = signal.tick_sequence;
    }

    const baseline = baselineTicks[signal.symbol] ?? previous;
    progress[signal.symbol] = Math.max(0, signal.tick_sequence - baseline);
  }

  return { arrivals, progress };
}
