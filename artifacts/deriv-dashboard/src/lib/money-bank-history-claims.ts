export type MoneyBankHistoryClaimsStorage = Pick<Storage, "getItem" | "setItem">;

const MAX_SAVED_MONEY_BANK_CONTRACT_IDS = 500;

export function moneyBankHistoryClaimsKey(accountId: string) {
  return `money-bank-history-contracts:v1:${encodeURIComponent(accountId)}`;
}

export function mergeMoneyBankHistoryClaims(
  savedIds: readonly string[],
  confirmedIds: readonly string[],
) {
  return [...new Set([...savedIds, ...confirmedIds].filter((id) => id.trim()))]
    .slice(-MAX_SAVED_MONEY_BANK_CONTRACT_IDS);
}

export function readMoneyBankHistoryClaims(
  storage: MoneyBankHistoryClaimsStorage | null,
  accountId: string | null | undefined,
) {
  if (!storage || !accountId) return [];

  try {
    const stored = storage.getItem(moneyBankHistoryClaimsKey(accountId));
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((id): id is string => typeof id === "string" && Boolean(id.trim()));
    return mergeMoneyBankHistoryClaims([], ids);
  } catch {
    return [];
  }
}

export function saveMoneyBankHistoryClaims(
  storage: MoneyBankHistoryClaimsStorage | null,
  accountId: string | null | undefined,
  confirmedIds: readonly string[],
) {
  const existingIds = readMoneyBankHistoryClaims(storage, accountId);
  const ids = mergeMoneyBankHistoryClaims(existingIds, confirmedIds);
  if (!storage || !accountId) return ids;

  try {
    storage.setItem(moneyBankHistoryClaimsKey(accountId), JSON.stringify(ids));
  } catch {
    // Keep the confirmed IDs in memory even if browser storage is unavailable.
  }

  return ids;
}
