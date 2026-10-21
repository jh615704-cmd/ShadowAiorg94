export const MATCHES_MINIMUM_STAKE = 0.35;
export const MATCHES_MINIMUM_SAMPLE_SIZE = 100;
export const MATCHES_HISTORY_LIMIT = 120;
export const MATCHES_AUTO_MINIMUM_OBSERVED_RATE = 10;

export type MatchesDigitStat = {
  digit: number;
  count: number;
  rate: number;
};

export function rankObservedMatchDigits(digits: readonly number[]): MatchesDigitStat[] {
  const validDigits = digits.filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
  const counts = Array.from({ length: 10 }, (_, digit) => ({
    digit,
    count: validDigits.filter((observed) => observed === digit).length,
    lastSeen: validDigits.lastIndexOf(digit),
  }));

  return counts
    .sort((left, right) =>
      right.count - left.count
      || right.lastSeen - left.lastSeen
      || left.digit - right.digit,
    )
    .map(({ digit, count }) => ({
      digit,
      count,
      rate: validDigits.length ? (count / validDigits.length) * 100 : 0,
    }));
}

export function chooseObservedMatchDigits(
  ranked: readonly MatchesDigitStat[],
  count: 1 | 2 | 3,
): number[] {
  return ranked
    .filter((item) => Number.isInteger(item.digit) && item.digit >= 0 && item.digit <= 9)
    .filter((item) => Number.isFinite(item.rate) && item.rate > MATCHES_AUTO_MINIMUM_OBSERVED_RATE)
    .slice(0, count)
    .map((item) => item.digit);
}

