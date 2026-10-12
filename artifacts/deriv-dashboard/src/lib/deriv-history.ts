export type DerivHistoryRow = {
  contract_id: string;
  account_id: string;
  contract_type: string;
  symbol: string;
  account_type: string;
  currency?: string;
  barrier: number | null;
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

export function claimConfirmedDerivContractIds(
  target: Set<string>,
  contractIds: readonly string[],
): void {
  for (const contractId of contractIds) {
    if (contractId) target.add(contractId);
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

export function summarizeDerivHistorySession(
  rows: readonly DerivHistoryRow[],
  sessionPnl?: number,
  sessionTradeCount?: number,
): DerivHistorySessionSummary {
  const uniqueRows = [...new Map(rows.map((row) => [`${row.account_id}:${row.contract_id}`, row])).values()];
  const settled = uniqueRows.filter((row) => !isDerivHistoryOpen(row.status));
  const wins = settled.filter((row) => row.profit > 0).length;
  const losses = settled.filter((row) => row.profit < 0).length;
  const allTradesHaveSettledRows = sessionTradeCount == null
    ? uniqueRows.length > 0 && settled.length === uniqueRows.length
    : settled.length >= sessionTradeCount;
  const realizedRowsPnl = settled.reduce((total, row) => total + row.profit, 0);
  return {
    pnl: allTradesHaveSettledRows ? realizedRowsPnl : sessionPnl ?? realizedRowsPnl,
    trades: Math.max(uniqueRows.length, sessionTradeCount ?? 0),
    wins,
    losses,
    winRate: wins + losses ? (wins / (wins + losses)) * 100 : 0,
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
    profit: formatSignedDerivProfit(row.profit, rowCurrency),
    profitClass: row.profit < 0 ? "negative" : "positive",
    details: [
      { label: "OPENED", value: timeLabel(row.buy_time) },
      { label: "SETTLED", value: timeLabel(row.sell_time) },
      { label: "STAKE", value: money(row.buy_price, rowCurrency) },
      { label: "CURRENT VALUE", value: money(row.current_value, rowCurrency) },
      { label: "FULL PAYOUT", value: money(row.payout, rowCurrency) },
      { label: "STATUS", value: row.status },
    ],
  };
}