export const MATCHES_MINIMUM_STAKE = 0.35;
export const MATCHES_HISTORY_LIMIT = 120;
export const MATCHES_MINIMUM_SETTLED_TRADES_PER_DIGIT = 5;
export const MATCHES_AUTO_MINIMUM_SETTLED_WIN_RATE = 50;

export type MatchesDigitStat = {
  digit: number;
  count: number;
  rate: number;
};

export type MatchesSettlementRow = {
  contract_id: string;
  account_id: string;
  contract_type: string;
  symbol: string;
  barrier: number | null;
  duration: number | null;
  duration_unit: string | null;
  status: string;
  buy_price?: number;
  buy_time?: number | null;
};

export type MatchesAttemptedOrder = {
  amount: number;
  duration: number;
  symbol: string;
  barrier: number;
};

export type MatchesMarketCandidate = {
  value: string;
};

export type MatchesMarketSignal = {
  symbol: string;
  digit: number;
  rate: number;
  count: number;
};

export function rankObservedMatchDigits(digits: readonly number[]): MatchesDigitStat[] {
  const sample = digits
    .slice(-MATCHES_HISTORY_LIMIT)
    .filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
  const counts = Array.from({ length: 10 }, (_, digit) => ({
    digit,
    count: 0,
    lastSeen: -1,
  }));

  sample.forEach((digit, index) => {
    counts[digit].count += 1;
    counts[digit].lastSeen = index;
  });

  return counts
    .map(({ digit, count }) => ({
      digit,
      count,
      rate: sample.length ? (count / sample.length) * 100 : 0,
    }))
    .sort((left, right) => {
      const countDifference = right.count - left.count;
      if (countDifference) return countDifference;
      const leftLastSeen = counts[left.digit].lastSeen;
      const rightLastSeen = counts[right.digit].lastSeen;
      return rightLastSeen - leftLastSeen || left.digit - right.digit;
    });
}

export function summarizeSettledMatchOutcomes(
  rows: readonly MatchesSettlementRow[],
  accountId: string | null | undefined,
  symbol: string,
  duration: number,
): MatchesDigitStat[] {
  if (!accountId || !symbol || !Number.isInteger(duration) || duration < 1) return [];

  const uniqueRows = new Map<string, MatchesSettlementRow>();
  for (const row of rows) {
    if (
      row.account_id === accountId
      && row.contract_type === "DIGITMATCH"
      && row.symbol === symbol
      && row.duration === duration
      && row.duration_unit === "t"
      && Number.isInteger(row.barrier)
      && row.barrier != null
      && row.barrier >= 0
      && row.barrier <= 9
    ) {
      uniqueRows.set(JSON.stringify([row.account_id, row.contract_id]), row);
    }
  }

  const results = Array.from({ length: 10 }, (_, digit) => ({ digit, wins: 0, losses: 0 }));
  for (const row of uniqueRows.values()) {
    const status = row.status.trim().toLowerCase();
    if (status !== "won" && status !== "lost") continue;
    const result = results[row.barrier as number];
    if (status === "won") result.wins += 1;
    else result.losses += 1;
  }

  return results
    .filter((result) => result.wins + result.losses > 0)
    .map(({ digit, wins, losses }) => ({
      digit,
      count: wins + losses,
      rate: (wins / (wins + losses)) * 100,
    }))
    .sort((left, right) => right.rate - left.rate || right.count - left.count || left.digit - right.digit);
}

export function rankSettledMatchOutcomes(
  rows: readonly MatchesSettlementRow[],
  accountId: string | null | undefined,
  symbol: string,
  duration: number,
): MatchesDigitStat[] {
  return summarizeSettledMatchOutcomes(rows, accountId, symbol, duration)
    .filter((result) => result.count >= MATCHES_MINIMUM_SETTLED_TRADES_PER_DIGIT);
}

export function chooseBestMatchesMarket(
  rows: readonly MatchesSettlementRow[],
  accountId: string | null | undefined,
  markets: readonly MatchesMarketCandidate[],
  duration: number,
  currentSymbol: string,
): MatchesMarketSignal | null {
  if (!accountId || !Number.isInteger(duration) || duration < 1) return null;

  const candidates = markets.flatMap((market) => {
    const ranked = rankSettledMatchOutcomes(rows, accountId, market.value, duration);
    const bestDigit = chooseQualifiedMatchesDigits(ranked, 1)[0];
    if (bestDigit === undefined) return [];

    const stat = ranked.find((item) => item.digit === bestDigit);
    if (!stat) return [];

    return [{
      symbol: market.value,
      digit: stat.digit,
      rate: stat.rate,
      count: stat.count,
    }];
  });

  return candidates.sort((left, right) =>
    right.rate - left.rate
    || right.count - left.count
    || Number(right.symbol === currentSymbol) - Number(left.symbol === currentSymbol)
    || left.symbol.localeCompare(right.symbol),
  )[0] ?? null;
}

export function findUnconfirmedMatchesRows(
  rows: readonly MatchesSettlementRow[],
  accountId: string,
  baselineContractIds: ReadonlySet<string>,
  attemptedOrders: readonly MatchesAttemptedOrder[],
  startedAtMs: number,
): MatchesSettlementRow[] {
  const earliestBuyTime = Math.floor(startedAtMs / 1000) - 3;
  return rows.filter((row) => {
    if (
      row.account_id !== accountId
      || row.contract_type !== "DIGITMATCH"
      || baselineContractIds.has(String(row.contract_id))
      || !Number.isInteger(row.barrier)
      || row.barrier == null
    ) return false;

    if (row.buy_time != null && row.buy_time < earliestBuyTime) return false;

    return attemptedOrders.some((order) => (
      row.symbol === order.symbol
      && row.duration === order.duration
      && row.duration_unit === "t"
      && row.barrier === order.barrier
      && Number.isFinite(row.buy_price)
      && Math.round((row.buy_price ?? 0) * 100) === Math.round(order.amount * 100)
    ));
  });
}

export function chooseQualifiedMatchesDigits(
  ranked: readonly MatchesDigitStat[],
  count: 1 | 2 | 3,
): number[] {
  return ranked
    .filter((item) => Number.isInteger(item.digit) && item.digit >= 0 && item.digit <= 9)
    .filter((item) => Number.isFinite(item.rate) && item.rate > MATCHES_AUTO_MINIMUM_SETTLED_WIN_RATE)
    .slice(0, count)
    .map((item) => item.digit);
}

