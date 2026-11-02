export type DerivHistoryRow = {
  contract_id: string;
  account_id: string;
  contract_type: string;
  symbol: string;
  account_type: string;
  currency?: string;
  barrier: number | null;
  duration: number | null;
  duration_unit: string | null;
  growth_rate?: number | null;
  tick_passed?: number | null;
  buy_price: number;
  current_value: number;
  payout: number;
  profit: number;
  status: string;
  buy_time?: number | null;
  sell_time?: number | null;
};

export type DerivHistoryDetail = {
  label: string;
  value: string;
};

export type DerivHistoryRowView = {
  symbol: string;
  account: string;
  accountId: string;
  contract: string;
  barrier: string | null;
  outcome: string;
  outcomeClass: "open" | "loss" | "win" | "even";
  resultLabel: string;
  profit: string;
  profitClass: "negative" | "positive";
  details: DerivHistoryDetail[];
};

export function historyRowsForAccount<T extends Pick<DerivHistoryRow, "account_id">>(
  rows: readonly T[],
  accountId: string | null | undefined,
): T[] {
  if (!accountId) return [];
  return rows.filter((row) => row.account_id === accountId);
}

export function isDerivHistoryOpen(status: string): boolean {
  return ["open", "pending", "active"].includes(status.trim().toLowerCase());
}

export type DerivWinLossSummary = {
  wins: number;
  losses: number;
  sampleSize: number;
  winRate: number;
};

export function summarizeDerivWinLoss(
  rows: readonly Pick<DerivHistoryRow, "status" | "profit">[],
): DerivWinLossSummary {
  const settled = rows.filter((row) =>
    !isDerivHistoryOpen(row.status) && Number.isFinite(row.profit),
  );
  const wins = settled.filter((row) => row.profit > 0).length;
  const losses = settled.filter((row) => row.profit < 0).length;
  const sampleSize = wins + losses;
  return {
    wins,
    losses,
    sampleSize,
    winRate: sampleSize ? (wins / sampleSize) * 100 : 0,
  };
}

export function shouldShowFeatureHistoryWhenStopped(
  enabled: boolean,
  ownedRows: readonly Pick<DerivHistoryRow, "status">[],
  pendingAcknowledgements: ReadonlySet<string>,
): boolean {
  return enabled
    || pendingAcknowledgements.size > 0
    || ownedRows.some((row) => isDerivHistoryOpen(row.status));
}

export function removeSettledHistoryAcknowledgements(
  pendingAcknowledgements: ReadonlySet<string>,
  rows: readonly Pick<DerivHistoryRow, "contract_id" | "status">[],
): Set<string> {
  const settledIds = new Set(
    rows
      .filter((row) => !isDerivHistoryOpen(row.status))
      .map((row) => String(row.contract_id)),
  );
  return new Set([...pendingAcknowledgements].filter((contractId) => !settledIds.has(contractId)));
}

export function claimConfirmedDerivContractIds(
  target: Set<string>,
  contractIds: readonly string[],
): void {
  for (const contractId of contractIds) {
    if (contractId) target.add(contractId);
  }
}

export type DerivHistoryFeature =
  | "edge"
  | "trade-x"
  | "digit-flip"
  | "bulk-trader"
  | "cash-grab"
  | "clock-work"
  | "jackpot"
  | "money-bank";

export function claimDerivHistoryFeatureContractIds(
  owners: Map<string, DerivHistoryFeature>,
  accountId: string | null | undefined,
  feature: DerivHistoryFeature,
  target: Set<string>,
  contractIds: readonly string[],
): void {
  if (!accountId) return;

  for (const contractId of contractIds) {
    if (!contractId) continue;
    const key = JSON.stringify([accountId, contractId]);
    const owner = owners.get(key);
    if (owner && owner !== feature) continue;
    owners.set(key, feature);
    target.add(contractId);
  }
}

export type DerivHistorySessionSummary = {
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  staked: number;
};

export function uniqueDerivHistoryRows<T extends Pick<DerivHistoryRow, "account_id" | "contract_id" | "status" | "buy_time" | "sell_time">>(
  rows: readonly T[],
): T[] {
  const uniqueRows = new Map<string, T>();

  for (const row of rows) {
    const key = JSON.stringify([row.account_id, row.contract_id]);
    const previous = uniqueRows.get(key);
    if (!previous) {
      uniqueRows.set(key, row);
      continue;
    }

    const previousIsOpen = isDerivHistoryOpen(previous.status);
    const nextIsOpen = isDerivHistoryOpen(row.status);
    const previousUpdatedAt = Math.max(previous.buy_time ?? 0, previous.sell_time ?? 0);
    const nextUpdatedAt = Math.max(row.buy_time ?? 0, row.sell_time ?? 0);
    if (
      (previousIsOpen && !nextIsOpen)
      || (previousIsOpen === nextIsOpen && nextUpdatedAt >= previousUpdatedAt)
    ) {
      uniqueRows.set(key, row);
    }
  }

  return Array.from(uniqueRows.values());
}

export function summarizeDerivHistorySession(
  rows: readonly DerivHistoryRow[],
  sessionPnl?: number,
  sessionTradeCount?: number,
): DerivHistorySessionSummary {
  const uniqueRows = uniqueDerivHistoryRows(rows);
  const settled = uniqueRows.filter((row) => !isDerivHistoryOpen(row.status));
  const outcomes = summarizeDerivWinLoss(settled);
  const allTradesHaveSettledRows = sessionTradeCount == null
    ? uniqueRows.length > 0 && settled.length === uniqueRows.length
    : settled.length >= sessionTradeCount;
  const realizedRowsPnl = settled.reduce((total, row) => total + row.profit, 0);
  return {
    pnl: allTradesHaveSettledRows ? realizedRowsPnl : sessionPnl ?? realizedRowsPnl,
    trades: Math.max(uniqueRows.length, sessionTradeCount ?? 0),
    wins: outcomes.wins,
    losses: outcomes.losses,
    winRate: outcomes.winRate,
    staked: Math.round(uniqueRows.reduce((total, row) => total + Math.max(0, row.buy_price), 0) * 100) / 100,
  };
}

function money(amount: number, currency?: string) {
  return currency === "USD"
    ? `US$${amount.toFixed(2)}`
    : `${currency ? `${currency} ` : ""}${amount.toFixed(2)}`;
}

export function formatSignedDerivProfit(amount: number, currency?: string) {
  return `${amount < 0 ? "-" : "+"}${money(Math.abs(amount), currency)}`;
}

export function getDerivOpenLiveProfit(currentValue: number, buyPrice: number): number | null {
  if (!Number.isFinite(currentValue) || !Number.isFinite(buyPrice)) return null;
  return Math.round((currentValue - buyPrice) * 100) / 100;
}

function timeLabel(epoch?: number | null) {
  if (epoch == null || !Number.isFinite(epoch)) return "—";
  const date = new Date(epoch * 1000);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
}

export function createDerivHistoryRowView(
  row: DerivHistoryRow,
  currency?: string,
): DerivHistoryRowView {
  const rowCurrency = row.currency ?? currency;
  const isOpen = isDerivHistoryOpen(row.status);
  const barrier = row.barrier == null
    ? null
    : `${row.contract_type.startsWith("DIGIT") ? "digit" : "barrier"} ${row.barrier}`;

  return {
    symbol: row.symbol,
    account: row.account_type.toUpperCase(),
    accountId: row.account_id,
    contract: row.contract_type.replace("DIGIT", ""),
    barrier,
    outcome: isOpen ? "OPEN" : row.profit > 0 ? "WON" : row.profit < 0 ? "LOST" : "BREAKEVEN",
    outcomeClass: isOpen ? "open" : row.profit < 0 ? "loss" : row.profit > 0 ? "win" : "even",
    resultLabel: isOpen ? "LIVE P/L" : "NET P/L",
    profit: formatSignedDerivProfit(row.profit, rowCurrency),
    profitClass: row.profit < 0 ? "negative" : "positive",
    details: [
      { label: "OPENED", value: timeLabel(row.buy_time) },
      { label: "SETTLED", value: timeLabel(row.sell_time) },
      { label: "STAKE", value: money(row.buy_price, rowCurrency) },
      { label: isOpen ? "CURRENT VALUE" : "AMOUNT RETURNED", value: money(row.current_value, rowCurrency) },
      { label: "FULL PAYOUT", value: money(row.payout, rowCurrency) },
      { label: "STATUS", value: row.status },
    ],
  };
}