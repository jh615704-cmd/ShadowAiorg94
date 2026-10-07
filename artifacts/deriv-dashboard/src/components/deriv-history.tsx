import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Activity, Trash2 } from "lucide-react";
import { createDerivHistoryRowView, summarizeDerivHistorySession, type DerivHistoryRow } from "../lib/deriv-history";
export type { DerivHistoryRow } from "../lib/deriv-history";

function money(amount: number, currency?: string) {
  return currency === "USD"
    ? `US$${amount.toFixed(2)}`
    : `${currency ? `${currency} ` : ""}${amount.toFixed(2)}`;
}

type Props = {
  title: string;
  strategy: string;
  className?: string;
  rows: readonly DerivHistoryRow[];
  sessionRows?: readonly DerivHistoryRow[];
  currency?: string;
  clearArmed?: boolean;
  fading?: boolean;
  onClear?: () => void;
  sessionPnl?: number;
  sessionTradeCount?: number;
  summaryMode?: "full" | "pnl-only" | "hidden";
  actions?: ReactNode;
};

export default function DerivHistory({ title, strategy, className, rows, sessionRows = rows, currency, clearArmed = false, fading = false, onClear, sessionPnl, sessionTradeCount, summaryMode = "full", actions }: Props) {
  const [filter, setFilter] = useState<"all" | "win" | "loss">("all");
  const summary = summarizeDerivHistorySession(sessionRows, sessionPnl, sessionTradeCount);
  const historyWins = rows.filter((row) => row.status.toLowerCase() !== "open" && row.profit > 0).length;
  const historyLosses = rows.filter((row) => row.status.toLowerCase() !== "open" && row.profit < 0).length;
  const visible = useMemo(() => rows.filter((row) => {
    if (filter === "win") return row.status.toLowerCase() !== "open" && row.profit > 0;
    if (filter === "loss") return row.status.toLowerCase() !== "open" && row.profit < 0;
    return true;
  }), [filter, rows]);

  return (
    <section className={`deriv-history ${className ?? ""} ${fading ? "is-fading" : ""}`} aria-label={`${title} Deriv history`}>
      <header className="deriv-history-head">
        <div className="deriv-history-title"><Activity size={18} /><span><b>This session</b><small>{title} · {strategy}</small></span></div>
        <div className="deriv-history-actions">
          {actions}
          {onClear && <button type="button" onClick={onClear} disabled={!rows.length || fading} aria-label={clearArmed ? `Tap again to clear ${title} session` : `Clear ${title} session`}><Trash2 size={15} />{clearArmed ? "Tap again" : "Clear session"}</button>}
        </div>
      </header>
      {summaryMode !== "hidden" && <div className={`deriv-history-session ${summaryMode === "pnl-only" ? "pnl-only" : ""}`}>
        <div className={`deriv-history-run ${summary.pnl < 0 ? "negative" : "positive"}`}>
          <small>MADE THIS RUN</small>
          <b>{summary.pnl < 0 ? "-" : "+"}{money(Math.abs(summary.pnl), currency)}</b>
        </div>
        {summaryMode === "full" && <div className="deriv-history-stat-grid">
          <div><small>TRADES</small><b>{summary.trades}</b></div>
          <div><small>WON / LOST</small><b><span className="positive">{summary.wins}</span><i> / </i><span className="negative">{summary.losses}</span></b></div>
          <div><small>WIN RATE</small><b>{summary.winRate.toFixed(1)}%</b></div>
          <div><small>STAKED</small><b>{money(summary.staked, currency)}</b></div>
        </div>}
      </div>}
      <nav className="deriv-history-filters" aria-label={`Filter ${title} history`}>
        {(["all", "win", "loss"] as const).map((value) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>{value === "all" ? `All (${rows.length})` : value === "win" ? `Wins (${historyWins})` : `Losses (${historyLosses})`}</button>)}
      </nav>
      <div className="deriv-history-list">
        {!visible.length ? <div className="deriv-history-empty">{rows.length ? "No contracts match this filter." : "Deriv contracts will appear here when this feature trades."}</div> : visible.map((row) => {
          const view = createDerivHistoryRowView(row, currency);
          return <article className="deriv-history-row" key={`${row.account_id}-${row.contract_id}`} data-testid={`deriv-history-${row.account_id}-${row.contract_id}`}>
            <div className="deriv-history-rowtop"><span className="deriv-history-feature">{strategy}</span><b className={`deriv-history-profit ${view.profitClass}`}>{view.profit}</b></div>
            <div className="deriv-history-market"><b>{view.symbol}</b><span className="deriv-history-account">{view.account}</span><small className="deriv-history-account-id">{view.accountId}</small><span className={`deriv-history-outcome ${view.outcomeClass}`}>{view.outcome}</span><strong>{view.contract}{view.barrier ? ` · ${view.barrier}` : ""}</strong></div>
            <div className="deriv-history-details">
              {view.details.map((detail) => <span key={detail.label}><small>{detail.label}</small><b>{detail.value}</b></span>)}
            </div>
          </article>;
        })}
      </div>
    </section>
  );
}