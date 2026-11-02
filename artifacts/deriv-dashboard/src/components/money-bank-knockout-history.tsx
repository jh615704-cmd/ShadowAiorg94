type ExitTick = {
  ticks: number;
  trackedRuns: number;
  knockouts: number;
  completed: number;
  winRate: number | null;
  band: "no-data" | "red" | "yellow" | "green";
};

type Props = {
  symbol: string;
  connected: boolean;
  liveTicks: number;
  onResetTicks: () => void;
  maxExitTicks: number;
  liveContractTicks: number | null;
  selectedRate: number | "all";
  onSelectedRateChange: (value: number | "all") => void;
  summary: {
    trackedRuns: number;
    knockouts: number;
    completed: number;
    longestTicks: number | null;
    averageTicks: number | null;
    shortestTicks: number | null;
  };
  exitTicks: ExitTick[];
};

const rateOptions = [1, 2, 3, 4, 5] as const;

function formatTicks(value: number | null) {
  return value == null ? "—" : value.toLocaleString();
}

export function MoneyBankKnockoutHistory({
  symbol,
  connected,
  liveTicks,
  onResetTicks,
  maxExitTicks,
  liveContractTicks,
  selectedRate,
  onSelectedRateChange,
  summary,
  exitTicks,
}: Props) {
  const hasLiveMarket = connected && liveTicks > 0;
  const visibleTicks = hasLiveMarket
    ? exitTicks.filter(
      (item) => item.trackedRuns > 0
        && Number.isInteger(item.ticks)
        && item.ticks >= 1
        && item.ticks <= maxExitTicks,
    )
    : [];
  const marketTickPosition = liveTicks > 0
    ? ((liveTicks - 1) % maxExitTicks) + 1
    : null;
  const currentLiveTick = selectedRate === "all"
    ? liveContractTicks != null && liveContractTicks >= 1 && liveContractTicks <= maxExitTicks
      ? liveContractTicks
      : marketTickPosition
    : liveContractTicks != null && liveContractTicks >= 1 && liveContractTicks <= maxExitTicks
      ? liveContractTicks
      : null;
  const validLiveTick = hasLiveMarket
    && Number.isInteger(currentLiveTick)
    && currentLiveTick! >= 1
    && currentLiveTick! <= maxExitTicks;
  const displayedTicks = visibleTicks.map((item) => (
    validLiveTick && item.ticks === currentLiveTick
      ? { ...item, band: "live" as const }
      : item
  ));
  const hasLiveTile = validLiveTick && !displayedTicks.some((item) => item.ticks === currentLiveTick);
  const rateLabel = selectedRate === "all" ? "All rates" : `${selectedRate}%`;
  const hasSummary = hasLiveMarket && summary.trackedRuns > 0;

  return (
    <section className="money-bank-knockout-card mbkh-panel" aria-label="Money Bank stats">
      <header className="mbkh-topbar">
        <div className="mbkh-title">Stats</div>
        <div className="mbkh-live-readout">
          <span className={`mbkh-live-state ${connected ? "is-live" : ""}`}>
            <i aria-hidden="true" />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
          <span className="mbkh-live-count" aria-label={`Live market tick count ${liveTicks}`}>
            {liveTicks.toLocaleString()} <small>market ticks</small>
          </span>
          <button
            className="mbkh-reset"
            type="button"
            onClick={onResetTicks}
            aria-label="Reset live tick count"
            title="Reset live tick count"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M16.2 6.3A6.9 6.9 0 1 0 17 10" />
              <path d="M16.1 2.8v3.8h-3.8" />
            </svg>
          </button>
        </div>
      </header>

      <div className="mbkh-history-head">
        <div className="mbkh-history-title">
          <h3>Knockout Stats</h3>
          <i aria-hidden="true" />
          <span>
            {!hasLiveMarket
              ? "Waiting for live market data"
              : summary.trackedRuns
                ? `${summary.knockouts.toLocaleString()} knockouts · ${summary.trackedRuns.toLocaleString()} runs`
                : `No ${rateLabel} runs for this market yet`}
          </span>
        </div>
        <div className="mbkh-market-meta">
          <span>{symbol}</span>
          <span>{rateLabel}</span>
        </div>
      </div>

      <div className="mbkh-filter-row">
        <div className="mbkh-rate-selector" role="group" aria-label="Filter live Money Bank stats by growth rate">
          <button
            type="button"
            className={selectedRate === "all" ? "is-selected" : ""}
            aria-pressed={selectedRate === "all"}
            onClick={() => onSelectedRateChange("all")}
          >
            All Rates
          </button>
          {rateOptions.map((rate) => (
            <button
              key={rate}
              type="button"
              className={selectedRate === rate ? "is-selected" : ""}
              aria-pressed={selectedRate === rate}
              onClick={() => onSelectedRateChange(rate)}
            >
              {rate}%
            </button>
          ))}
        </div>
      </div>

      <div className="mbkh-summary" aria-label={`${rateLabel} live market summary metrics`}>
        <div><small>KNOCKOUTS</small><strong>{hasSummary ? summary.knockouts.toLocaleString() : "—"}</strong></div>
        <div><small>COMPLETED</small><strong>{hasSummary ? summary.completed.toLocaleString() : "—"}</strong></div>
        <div><small>LONGEST</small><strong>{hasSummary ? formatTicks(summary.longestTicks) : "—"}</strong></div>
        <div><small>AVERAGE</small><strong>{hasSummary && summary.averageTicks != null ? summary.averageTicks.toFixed(1) : "—"}</strong></div>
        <div><small>SHORTEST</small><strong>{hasSummary ? formatTicks(summary.shortestTicks) : "—"}</strong></div>
      </div>

      <div className="mbkh-tick-grid" role="list" aria-label="Live market and selected-rate outcome ticks">
        {displayedTicks.map((item) => (
          <div
            className={`mbkh-tick mbkh-band-${item.band}`}
            key={item.ticks}
            role="listitem"
            title={item.band === "live"
              ? `${item.ticks} ticks · live market`
              : `${item.ticks} ticks · ${item.trackedRuns} tracked runs · ${item.knockouts} knockouts · ${item.completed} completed · ${item.winRate == null ? "win rate unavailable" : `${item.winRate}% observed win rate`}`}
            aria-label={item.band === "live"
              ? `${item.ticks} ticks, current live market tick`
              : `${item.ticks} ticks, ${item.band === "no-data" ? "no data" : `${item.band} historical band`}, ${item.trackedRuns} tracked runs`}
          >
            {item.ticks}
          </div>
        ))}
        {hasLiveTile && currentLiveTick != null && (
          <div
            className="mbkh-tick mbkh-band-live"
            role="listitem"
            aria-label={`${liveContractTicks == null ? "Current live market" : `${rateLabel} live contract`} at tick ${currentLiveTick}`}
          >
            {currentLiveTick}
          </div>
        )}
        {!hasLiveMarket && (
          <div className="mbkh-empty" role="listitem">
            {connected ? "Waiting for the first live market tick…" : "Connect Deriv to receive live market ticks."}
          </div>
        )}
        {hasLiveMarket && !displayedTicks.length && !hasLiveTile && (
          <div className="mbkh-empty" role="listitem">
            No tick outcomes recorded for {rateLabel}.
          </div>
        )}
      </div>

      <footer className="mbkh-footer">
        <div className="mbkh-legend" aria-label="Live and historical outcome legend">
          <span><i className="mbkh-band-red" />Red ≤30%</span>
          <span><i className="mbkh-band-yellow" />Yellow · limited / 31–89%</span>
          <span><i className="mbkh-band-green" />Green ≥90%</span>
          <span><i className="mbkh-band-live" />Live tick</span>
        </div>
        <p>Growth-rate filters isolate Money Bank runs for this market. Settled outcome colors use matching history; the live marker follows the current market tick.</p>
      </footer>
    </section>
  );
}
