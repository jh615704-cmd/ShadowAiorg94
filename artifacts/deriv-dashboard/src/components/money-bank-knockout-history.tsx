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
  growthRate: number;
  selectedRate: number | "all";
  onSelectedRateChange: (value: number | "all") => void;
  rateStats: Array<{
    growthRate: number;
    trackedRuns: number;
    knockouts: number;
    completed: number;
  }>;
  summary: {
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

function rateCaption(item: Props["rateStats"][number]) {
  return item.trackedRuns
    ? `${item.knockouts} KO · ${item.trackedRuns} runs`
    : "No history";
}

export function MoneyBankKnockoutHistory({
  symbol,
  connected,
  liveTicks,
  onResetTicks,
  maxExitTicks,
  growthRate,
  selectedRate,
  onSelectedRateChange,
  rateStats,
  summary,
  exitTicks,
}: Props) {
  const visibleTicks = exitTicks.filter(
    (item) => Number.isInteger(item.ticks) && item.ticks >= 1 && item.ticks <= maxExitTicks,
  );
  const validLiveTick =
    Number.isInteger(liveTicks) && liveTicks >= 1 && liveTicks <= maxExitTicks;
  const hasLiveTile = validLiveTick && !visibleTicks.some((item) => item.ticks === liveTicks);
  const trackedRuns = rateStats.reduce((total, item) => total + item.trackedRuns, 0);
  const knockouts = rateStats.reduce((total, item) => total + item.knockouts, 0);

  return (
    <section className="money-bank-knockout-card mbkh-panel" aria-label="Money Bank stats">
      <header className="mbkh-topbar">
        <div className="mbkh-title">Stats</div>
        <div className="mbkh-live-readout">
          <span className={`mbkh-live-state ${connected ? "is-live" : ""}`}>
            <i aria-hidden="true" />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
          <span className="mbkh-live-count" aria-label={`Current tick count ${liveTicks}`}>
            {liveTicks.toLocaleString()} <small>ticks</small>
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
          <h3>Knockout History</h3>
          <i aria-hidden="true" />
          <span>
            {knockouts.toLocaleString()} knockouts · {trackedRuns.toLocaleString()} runs tracked
          </span>
        </div>
        <div className="mbkh-market-meta">
          <span>{symbol}</span>
          <span>Rate {growthRate}%</span>
        </div>
      </div>

      <div className="mbkh-rate-chips" aria-label="Historical rate summaries">
        {rateOptions.map((rate) => {
          const item = rateStats.find((stat) => stat.growthRate === rate);
          return (
            <div
              key={rate}
              className={`mbkh-rate-chip ${growthRate === rate ? "is-current" : ""}`}
              aria-label={item
                ? `${rate}% growth: ${rateCaption(item)}, ${item.completed} completed`
                : `${rate}% growth: no history`}
            >
              <strong>{rate}%</strong>
              {item
                ? <span>{item.knockouts}<small> / {item.trackedRuns}</small></span>
                : <span className="mbkh-rate-empty">—</span>}
            </div>
          );
        })}
      </div>

      <div className="mbkh-filter-row">
        <div className="mbkh-rate-selector" role="group" aria-label="Filter historical outcomes by growth rate">
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
        <div className="mbkh-max-ticks">
          Max ticks: <strong>{maxExitTicks.toLocaleString()}</strong>
        </div>
      </div>

      <p className="mbkh-run-status" role="status">
        <span>Exit ticks shown: <strong>1–{maxExitTicks.toLocaleString()}</strong></span>
        <span className="mbkh-status-separator" aria-hidden="true">|</span>
        <span>Showing {selectedRate === "all" ? "all rates" : `${selectedRate}% rate`} · Historical outcomes for {symbol}</span>
      </p>

      <div className="mbkh-summary" aria-label="Historical summary metrics">
        <div><small>KNOCKOUTS</small><strong>{summary.knockouts.toLocaleString()}</strong></div>
        <div><small>COMPLETED</small><strong>{summary.completed.toLocaleString()}</strong></div>
        <div><small>LONGEST</small><strong>{formatTicks(summary.longestTicks)}</strong></div>
        <div><small>AVERAGE</small><strong>{summary.averageTicks == null ? "—" : summary.averageTicks.toFixed(1)}</strong></div>
        <div><small>SHORTEST</small><strong>{formatTicks(summary.shortestTicks)}</strong></div>
      </div>

      <div className="mbkh-tick-grid" role="list" aria-label="Historical observed exit ticks">
        {visibleTicks.map((item) => (
          <div
            className={`mbkh-tick mbkh-band-${item.band}`}
            key={item.ticks}
            role="listitem"
            title={`${item.ticks} ticks · ${item.trackedRuns} tracked runs · ${item.knockouts} knockouts · ${item.completed} completed · ${item.winRate == null ? "win rate unavailable" : `${item.winRate}% observed win rate`}`}
            aria-label={`${item.ticks} ticks, ${item.band === "no-data" ? "no data" : `${item.band} historical band`}, ${item.trackedRuns} tracked runs`}
          >
            {item.ticks}
          </div>
        ))}
        {hasLiveTile && (
          <div
            className="mbkh-tick mbkh-band-live"
            role="listitem"
            aria-label={`Current live run at ${liveTicks} ticks`}
          >
            {liveTicks}
          </div>
        )}
        {!visibleTicks.length && !hasLiveTile && (
          <div className="mbkh-empty" role="listitem">
            No historical exit ticks recorded for this selection.
          </div>
        )}
      </div>

      <footer className="mbkh-footer">
        <div className="mbkh-legend" aria-label="Historical outcome band legend">
          <span><i className="mbkh-band-red" />Red ≤30%</span>
          <span><i className="mbkh-band-yellow" />Yellow · limited / 31–89%</span>
          <span><i className="mbkh-band-green" />Green ≥90%</span>
          <span><i className="mbkh-band-no-data" />No data</span>
          <span><i className="mbkh-band-live" />Live</span>
        </div>
        <p>Red and green require 20+ settled contracts at that exact duration. Colors describe past outcomes only, not future results.</p>
      </footer>
    </section>
  );
}
