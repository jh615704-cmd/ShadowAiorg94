import type { MoneyBankKnockoutSimulationResponse } from "@workspace/api-client-react";

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
  simulation: MoneyBankKnockoutSimulationResponse | null;
  simulationUnavailable: boolean;
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
  simulation,
  simulationUnavailable,
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
  const simulationRates = (simulation?.rates ?? []).filter((rate) =>
    selectedRate === "all" || rate.growth_rate === selectedRate,
  );

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

      <div className="mbkh-section-heading">
        <h4>Actual contract outcomes</h4>
        <span>Settled Deriv contracts only · exact duration and selected market/rate</span>
      </div>

      <div className="mbkh-tick-grid mbkh-actual-grid" role="list" aria-label="Actual settled contract outcomes by tick duration">
        {displayedTicks.map((item) => (
          <div
            className={`mbkh-tick mbkh-band-${item.band}`}
            key={item.ticks}
            role="listitem"
            title={item.band === "live"
              ? `${item.ticks} ticks · current live market tick · ${item.trackedRuns} actual settled contracts · ${item.completed} won · ${item.knockouts} knocked out`
              : `${item.ticks} ticks · ${item.trackedRuns} tracked runs · ${item.knockouts} knockouts · ${item.completed} completed · ${item.winRate == null ? "win rate unavailable" : `${item.winRate}% observed win rate`}`}
            aria-label={item.band === "live"
              ? `${item.ticks} ticks, live market marker, ${item.completed} actual wins, ${item.knockouts} actual knockouts`
              : `${item.ticks} ticks, ${item.winRate ?? "no"} percent actual win rate, ${item.completed} wins, ${item.knockouts} knockouts, sample ${item.trackedRuns}`}
          >
            <span className="mbkh-tick-number">{item.ticks}</span>
            <strong>{item.winRate == null ? "—" : `${item.winRate}%`}</strong>
            <small>{item.completed}W · {item.knockouts}K · n{item.trackedRuns}</small>
          </div>
        ))}
        {hasLiveTile && currentLiveTick != null && (
          <div
            className="mbkh-tick mbkh-band-live"
            role="listitem"
            aria-label={`${liveContractTicks == null ? "Current live market" : `${rateLabel} live contract`} at tick ${currentLiveTick}`}
          >
            <span className="mbkh-tick-number">{currentLiveTick}</span>
            <strong>LIVE</strong>
            <small>Market tick</small>
          </div>
        )}
        {!hasLiveMarket && (
          <div className="mbkh-empty" role="listitem">
            {connected ? "Waiting for the first live market tick…" : "Connect Deriv to receive live market ticks."}
          </div>
        )}
        {hasLiveMarket && !displayedTicks.length && !hasLiveTile && (
          <div className="mbkh-empty" role="listitem">
            No actual settled outcomes for {rateLabel}. Untraded rates stay empty here.
          </div>
        )}
      </div>

      <div className="mbkh-simulation">
        <div className="mbkh-section-heading">
          <h4>Hypothetical live-market replay</h4>
          <span>
            {simulation
              ? `${simulation.quote_count} recent quotes · tick ${simulation.tick_sequence}`
              : simulationUnavailable
                ? "Simulation unavailable"
                : connected
                  ? "Loading rate-specific barriers…"
                  : "Connect Deriv to start the replay"}
          </span>
        </div>
        {simulationUnavailable && (
          <div className="mbkh-simulation-message" role="status">
            Could not refresh the market replay. Actual outcomes above are unchanged.
          </div>
        )}
        {simulationRates.map((rate) => (
          <section className="mbkh-simulation-rate" key={rate.growth_rate} aria-label={`Hypothetical ${rate.growth_rate}% market replay`}>
            <div className="mbkh-simulation-rate-head">
              <strong>{rate.growth_rate}%</strong>
              <span>
                {rate.barrier != null
                  ? `Current knockout barrier ${rate.barrier}`
                  : rate.message ?? "Current barrier unavailable"}
              </span>
            </div>
            <div className="mbkh-tick-grid mbkh-simulation-grid" role="list" aria-label={`${rate.growth_rate}% simulated survival by tick duration`}>
              {rate.cells.map((item) => {
                const band = item.survival_rate == null
                  ? "no-data"
                  : item.survival_rate <= 30
                    ? "low"
                    : item.survival_rate >= 90
                      ? "high"
                      : "mid";
                return (
                  <div
                    className={`mbkh-sim-tick mbkh-sim-${band}`}
                    key={item.ticks}
                    role="listitem"
                    title={`${rate.growth_rate}% · ${item.ticks} ticks · ${item.sample_count} hypothetical entry windows · ${item.knockouts} simulated knockouts · ${item.survivors} survived · ${item.survival_rate == null ? "survival rate unavailable" : `${item.survival_rate}% simulated survival`}`}
                    aria-label={`${rate.growth_rate} percent, ${item.ticks} ticks, ${item.survival_rate == null ? "no simulated sample" : `${item.survival_rate} percent hypothetical survival`}, ${item.knockouts} simulated knockouts, sample ${item.sample_count}`}
                  >
                    <span className="mbkh-tick-number">{item.ticks}</span>
                    <strong>{item.survival_rate == null ? "—" : `${item.survival_rate}%`}</strong>
                    <small>{item.sample_count ? `${item.survivors}S · ${item.knockouts}K · n${item.sample_count}` : "Need quotes"}</small>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {simulation && !simulationRates.length && (
          <div className="mbkh-simulation-message">
            No simulation results are available for {rateLabel}.
          </div>
        )}
        <p className="mbkh-simulation-disclaimer">
          Replay uses overlapping starts in recent quotes and the current Deriv barrier for each rate. It is hypothetical market history, not real contracts, a forecast, or a guarantee.
        </p>
      </div>

      <footer className="mbkh-footer">
        <div className="mbkh-legend" aria-label="Actual and simulated outcome legends">
          <span><i className="mbkh-band-red" />Actual ≤30%</span>
          <span><i className="mbkh-band-yellow" />Actual limited / 31–89%</span>
          <span><i className="mbkh-band-green" />Actual ≥90%</span>
          <span><i className="mbkh-band-live" />Live market tick</span>
          <span><i className="mbkh-sim-legend" />Hypothetical replay</span>
        </div>
        <p>Actual outcome colors require at least 20 settled contracts at that exact duration. Replay colors are separate estimates from recent market movement.</p>
      </footer>
    </section>
  );
}
