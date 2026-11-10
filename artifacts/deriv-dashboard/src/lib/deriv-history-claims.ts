import type { DerivHistoryFeature } from "./deriv-history";

export const DERIV_HISTORY_FEATURES = [
  "edge",
  "trade-x",
  "digit-flip",
  "bulk-trader",
  "cash-grab",
  "clock-work",
  "jackpot",
  "money-bank",
  "speedbot",
] as const satisfies readonly DerivHistoryFeature[];

export type DerivHistoryClaims = Record<DerivHistoryFeature, string[]>;
export type DerivHistoryClaimsStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_PREFIX = "deriv-feature-history-claims:";
const MAX_SAVED_IDS_PER_FEATURE = 250;

function emptyClaims(): DerivHistoryClaims {
  return {
    edge: [],
    "trade-x": [],
    "digit-flip": [],
    "bulk-trader": [],
    "cash-grab": [],
    "clock-work": [],
    jackpot: [],
    "money-bank": [],
    speedbot: [],
  };
}

function accountStorageKey(accountId: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(accountId)}`;
}

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.trim().length > 0))]
    .slice(-MAX_SAVED_IDS_PER_FEATURE);
}

export function readDerivHistoryClaims(
  storage: DerivHistoryClaimsStorage | null,
  accountId: string | null | undefined,
): DerivHistoryClaims {
  const claims = emptyClaims();
  if (!storage || !accountId) return claims;

  try {
    const raw = storage.getItem(accountStorageKey(String(accountId)));
    if (!raw) return claims;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return claims;
    const storedClaims = (parsed as { claims?: unknown }).claims;
    if (!storedClaims || typeof storedClaims !== "object" || Array.isArray(storedClaims)) return claims;

    for (const feature of DERIV_HISTORY_FEATURES) {
      claims[feature] = cleanIds((storedClaims as Record<string, unknown>)[feature]);
    }
    return claims;
  } catch {
    return claims;
  }
}

function writeClaims(
  storage: DerivHistoryClaimsStorage | null,
  accountId: string | null | undefined,
  claims: DerivHistoryClaims,
) {
  if (!storage || !accountId) return;
  try {
    storage.setItem(
      accountStorageKey(String(accountId)),
      JSON.stringify({ version: 1, accountId: String(accountId), claims }),
    );
  } catch {
    // History remains available in memory if browser storage is unavailable.
  }
}

export function addDerivHistoryClaims(
  storage: DerivHistoryClaimsStorage | null,
  accountId: string | null | undefined,
  feature: DerivHistoryFeature,
  contractIds: readonly string[],
): string[] {
  const claims = readDerivHistoryClaims(storage, accountId);
  claims[feature] = cleanIds([...claims[feature], ...contractIds]);
  writeClaims(storage, accountId, claims);
  return claims[feature];
}

export function removeDerivHistoryClaims(
  storage: DerivHistoryClaimsStorage | null,
  accountId: string | null | undefined,
  feature: DerivHistoryFeature,
  contractIds: readonly string[],
): string[] {
  const claims = readDerivHistoryClaims(storage, accountId);
  const removed = new Set(contractIds);
  claims[feature] = claims[feature].filter((id) => !removed.has(id));
  writeClaims(storage, accountId, claims);
  return claims[feature];
}
