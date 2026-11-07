import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Activity, Trash2 } from "lucide-react";
import { createDerivHistoryRowView, isDerivHistoryOpen, summarizeDerivHistorySession, uniqueDerivHistoryRows, type DerivHistoryRow } from "../lib/deriv-history";
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
  const normalizedTitle = title.toLowerCase();
  const actionFeature = normalizedTitle.includes("digitflip") || normalizedTitle.includes("digit flip")
    ? "digit-flip"
    : normalizedTitle.includes("trade x")
      ? "trade-x"
      : normalizedTitle.includes("bulk trader")
        ? "bulk-trader"
        : normalizedTitle.includes("jackpot")
          ? "jackpot"
          : normalizedTitle.includes("clock work")
            ? "clock-work"
            : normalizedTitle.includes("cash grab")
              ? "cash-grab"
              : normalizedTitle.includes("money bank")
                ? "money-bank"
                : normalizedTitle.includes("auto trader 2")
                  ? "auto-trader-2"
                  : normalizedTitle.includes("edge")
                    ? "edge"
                    : null;
  const [filter, setFilter] = useState<"all" | "win" | "loss">("all");
  const listRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState<number>();
  const uniqueRows = useMemo(() => uniqueDerivHistoryRows(rows), [rows]);
  const uniqueSessionRows = useMemo(() => uniqueDerivHistoryRows(sessionRows), [sessionRows]);
  const summary = summarizeDerivHistorySession(uniqueSessionRows, sessionPnl, sessionTradeCount);
  const currentRunIds = useMemo(
    () => new Set(uniqueSessionRows.map((row) => `${row.account_id}:${row.contract_id}`)),
    [uniqueSessionRows],
  );
  const historyWins = uniqueRows.filter((row) => !isDerivHistoryOpen(row.status) && row.profit > 0).length;
  const historyLosses = uniqueRows.filter((row) => !isDerivHistoryOpen(row.status) && row.profit < 0).length;
  const visible = useMemo(() => uniqueRows.filter((row) => {
    if (filter === "win") return !isDerivHistoryOpen(row.status) && row.profit > 0;
    if (filter === "loss") return !isDerivHistoryOpen(row.status) && row.profit < 0;
    return true;
  }), [filter, uniqueRows]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const firstTrades = Array.from(list.querySelectorAll<HTMLElement>(".deriv-history-row")).slice(0, 2);
    if (!firstTrades.length) {
      setListHeight(undefined);
      return;
    }

    const measure = () => {
      const styles = window.getComputedStyle(list);
      const gap = Number.parseFloat(styles.rowGap) || 0;
      const padding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
      const cardsHeight = firstTrades.reduce((total, card) => total + card.getBoundingClientRect().height, 0);
      setListHeight(Math.ceil(cardsHeight + gap * (firstTrades.length - 1) + padding));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    firstTrades.forEach((card) => observer.observe(card));
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [visible]);

  return (
    <section className={`deriv-history ${className ?? ""} ${fading ? "is-fading" : ""}`} aria-label={`${title} Deriv history`}>
      <header className="deriv-history-head">
        <div className="deriv-history-title"><Activity size={18} /><span><b>Feature history</b><small>{title} · {strategy}</small></span></div>
        <div className="deriv-history-actions">
          {actions}
          {onClear && <button type="button" data-feature-action={actionFeature ? `${actionFeature}/history-clear` : undefined} onClick={onClear} disabled={(!uniqueRows.length && summary.trades === 0 && summary.pnl === 0) || fading} aria-label={clearArmed ? `Tap again to clear ${title} session` : `Clear ${title} session`}><Trash2 size={15} />{clearArmed ? "Tap again" : "Clear session"}</button>}
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
          <div><small>WIN RATE</small><b>{summary.winRate.toFixed(1)}%</b>{summary.wins + summary.losses > 0 && <small className="deriv-history-win-sample">n={summary.wins + summary.losses} settled</small>}</div>
          <div><small>STAKED</small><b>{money(summary.staked, currency)}</b></div>
        </div>}
      </div>}
      <nav className="deriv-history-filters" aria-label={`Filter ${title} history`}>
        {(["all", "win", "loss"] as const).map((value) => <button type="button" data-feature-action={actionFeature ? `${actionFeature}/history-filter-${value}` : undefined} key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>{value === "all" ? `All (${uniqueRows.length})` : value === "win" ? `Wins (${historyWins})` : `Losses (${historyLosses})`}</button>)}
      </nav>
      <div ref={listRef} className="deriv-history-list" style={listHeight == null ? undefined : { maxHeight: `${listHeight}px` }}>
        {!visible.length ? <div className="deriv-history-empty">{uniqueRows.length ? "No contracts match this filter." : "Deriv contracts will appear here when this feature trades."}</div> : visible.map((row) => {
          const view = createDerivHistoryRowView(row, currency);
          const isCurrentRun = currentRunIds.has(`${row.account_id}:${row.contract_id}`);
          return <article className={`deriv-history-row ${isCurrentRun ? "deriv-history-row-current" : "deriv-history-row-earlier"}`} key={`${row.account_id}-${row.contract_id}`} data-testid={`deriv-history-${row.account_id}-${row.contract_id}`}>
            <div className="deriv-history-rowtop"><span className="deriv-history-feature">{strategy}<small className="deriv-history-run-label">{isCurrentRun ? "CURRENT RUN" : "EARLIER RUN"}</small></span><div className="deriv-history-result"><small>{view.resultLabel}</small><b className={`deriv-history-profit ${view.profitClass}`}>{view.profit}</b></div></div>
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