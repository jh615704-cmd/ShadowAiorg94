export type MoneyBankChartSession = {
  symbol: string;
  lastSequence: number | null;
  tickCount: number;
  quotes: number[];
};

const validSequence = (sequence: number | undefined) =>
  sequence != null && Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;

export function startMoneyBankChartSession(
  symbol: string,
  sequence?: number,
): MoneyBankChartSession {
  return {
    symbol,
    lastSequence: validSequence(sequence),
    tickCount: 0,
    quotes: [],
  };
}

export function advanceMoneyBankChartSession(
  session: MoneyBankChartSession,
  symbol: string,
  sequence: number | undefined,
  recentQuotes: readonly number[],
): MoneyBankChartSession {
  const currentSequence = validSequence(sequence);
  if (session.symbol !== symbol) return startMoneyBankChartSession(symbol, currentSequence ?? undefined);
  if (currentSequence == null) return session;
  if (session.lastSequence == null) {
    return { ...session, lastSequence: currentSequence };
  }
  if (currentSequence < session.lastSequence) {
    return startMoneyBankChartSession(symbol, currentSequence);
  }
  if (currentSequence === session.lastSequence) return session;

  const firstRetainedSequence = currentSequence - recentQuotes.length + 1;
  const firstNewSequence = session.lastSequence + 1;
  const firstNewIndex = Math.max(0, firstNewSequence - firstRetainedSequence);
  const newQuotes = recentQuotes
    .slice(firstNewIndex)
    .filter((quote) => Number.isFinite(quote));

  return {
    symbol,
    lastSequence: currentSequence,
    tickCount: session.tickCount + currentSequence - session.lastSequence,
    quotes: [...session.quotes, ...newQuotes].slice(-30),
  };
}
