export const MONEY_BANK_LIVE_KNOCKOUT_LIMIT = 8;

export type MoneyBankLiveKnockoutPrice = {
  quote: number;
  sequence: number;
};

type AppendMoneyBankKnockoutsInput = {
  ticks: readonly MoneyBankLiveKnockoutPrice[];
  barrier: number | null;
  referenceQuote: number | null;
  existingHits: readonly MoneyBankLiveKnockoutPrice[];
};

export function appendMoneyBankKnockouts({
  ticks,
  barrier,
  referenceQuote,
  existingHits,
}: AppendMoneyBankKnockoutsInput) {
  let reference = Number.isFinite(referenceQuote) && referenceQuote! > 0
    ? referenceQuote!
    : null;
  const hits = existingHits
    .filter((item) => Number.isFinite(item.quote) && item.quote > 0 && Number.isSafeInteger(item.sequence))
    .slice(-MONEY_BANK_LIVE_KNOCKOUT_LIMIT);
  const canDetect = Number.isFinite(barrier) && barrier! > 0;

  for (const tick of ticks) {
    if (!Number.isFinite(tick.quote) || tick.quote <= 0 || !Number.isSafeInteger(tick.sequence)) continue;
    if (reference == null) {
      reference = tick.quote;
      continue;
    }
    if (!canDetect) {
      reference = tick.quote;
      continue;
    }
    if (Math.abs(tick.quote - reference) >= barrier!) {
      hits.push(tick);
      if (hits.length > MONEY_BANK_LIVE_KNOCKOUT_LIMIT) {
        hits.splice(0, hits.length - MONEY_BANK_LIVE_KNOCKOUT_LIMIT);
      }
      reference = tick.quote;
    }
  }

  return { referenceQuote: reference, hits };
}
