import { Activity, ChartNoAxesCombined, Clock3, Minus, Plus, Zap } from "lucide-react";
import type { ClockWorkChartZone } from "../lib/clock-work-logic";
import "./clock-work-panel.css";

export interface ClockWorkOption {
  value: number;
  label: string;
  selected: boolean;
}

export interface ClockWorkMove {
  direction: "H" | "L" | "=";
  quote: number;
}

export interface ClockWorkQuote {
  payout: number;
  ask_price: number;
  spot: number;
}

export interface ClockWorkPanelProps {
  enabled: boolean;
  symbol: string;
  markets: { value: string; label: string }[];
  onSymbolChange: (value: string) => void;
  duration: 5;
  quote: number | null;
  quoteHistory: number[];
  quoteUpdatedAt: string;
  tradeSlotBlocked: boolean;
  barrierMode: "offset" | "absolute";
  onBarrierModeChange: (value: "offset" | "absolute") => void;
  halfBarrier: boolean;
  onHalfBarrierChange: (value: boolean) => void;
  higherBarrierLabel: string;
  lowerBarrierLabel: string;
  higherBarrierOffset: number;
  lowerBarrierOffset: number;
  barrierAnchor: number | null;
  onResetBarrierAnchor: () => void;
  higherBarrierOptions: ClockWorkOption[];
  lowerBarrierOptions: ClockWorkOption[];
  onHigherBarrierChange: (value: number) => void;
  onLowerBarrierChange: (value: number) => void;
  higherStake: number;
  lowerStake: number;
  h1Stake: number;
  l1Stake: number;
  l2Stake: number;
  h2Stake: number;
  onHigherStakeChange: (value: number) => void;
  onLowerStakeChange: (value: number) => void;
  onH1StakeChange: (value: number) => void;
  onL1StakeChange: (value: number) => void;
  onL2StakeChange: (value: number) => void;
  onH2StakeChange: (value: number) => void;
  higherPercent: number | null;
  lowerPercent: number | null;
  higherTicks: number;
  lowerTicks: number;
  recentMoves: ClockWorkMove[];
  prediction: "HIGHER" | "LOWER" | null;
  leanStrength: number | null;
  busy: boolean;
  disabled: boolean;
  statusMessage: string | null;
  higherQuote: ClockWorkQuote | null;
  lowerQuote: ClockWorkQuote | null;
  allFourQuote: ClockWorkQuote | null;
  onPlaceHigher: () => void;
  onPlaceLower: () => void;
  onPlacePair: () => void;
  onPlaceAllFour: () => void;
  autoMode: "pair" | "auto" | "all4" | null;
  onAutoModeChange: (value: "pair" | "auto" | "all4" | null) => void;
  minLean: number | null;
  onMinLeanChange: (value: number | null) => void;
  autoEnabled: boolean;
  onAutoEnabledChange: (value: boolean) => void;
  aggressiveEnabled: boolean;
  onAggressiveEnabledChange: (value: boolean) => void;
  aggressiveBalancePercent: number;
  onAggressiveBalancePercentChange: (value: number) => void;
  aggressiveMinWinRate: number;
  aggressivePushProgress: number;
  aggressiveRounds: number;
  aggressiveStakeLabel: string;
  accountBalance: number | null;
  currency: string;
  aggressiveUsingBalance: number | null;
  aggressiveEachSide: number | null;
  autoStatus: string;
}

const money = (value: number | null, currency: string) =>
  value == null || !Number.isFinite(value) ? "Quote unavailable" : `${currency} ${value.toFixed(2)}`;

function quoteDetail(quote: ClockWorkQuote | null, currency: string) {
  if (!quote || !Number.isFinite(quote.payout) || !Number.isFinite(quote.ask_price)) return "Quote unavailable";
  return `Payout ${money(quote.payout, currency)} · profit ${money(quote.payout - quote.ask_price, currency)}`;
}

function StakeInput({ label, value, onChange, disabled, id }: {
  label: string; value: number; onChange: (value: number) => void; disabled: boolean; id: string;
}) {
  return <label className="cw-stake-field" htmlFor={id}>
    <span>{label}</span>
    <span className="cw-stake-input"><i>$</i><input id={id} type="number" min="1" step="0.01" value={value} disabled={disabled} onChange={(event) => onChange(Math.max(1, Number(event.target.value) || 1))} /></span>
  </label>;
}

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (value: boolean) => void; disabled: boolean; label: string }) {
  return <label className="cw-toggle" aria-label={label}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span className="cw-toggle-track"><i /></span><span className="cw-toggle-label">{checked ? "ON" : "OFF"}</span>
  </label>;
}

export default function ClockWorkPanel(props: ClockWorkPanelProps) {
  const {
    enabled, symbol, markets, onSymbolChange, duration, quote, quoteHistory,
    quoteUpdatedAt, tradeSlotBlocked,
    barrierMode, onBarrierModeChange, halfBarrier, onHalfBarrierChange, higherBarrierLabel,
    lowerBarrierLabel, higherBarrierOffset, lowerBarrierOffset, barrierAnchor, onResetBarrierAnchor,
    higherBarrierOptions, lowerBarrierOptions, onHigherBarrierChange,
    onLowerBarrierChange, higherStake, lowerStake, h1Stake, l1Stake, l2Stake, h2Stake,
    onHigherStakeChange, onLowerStakeChange, onH1StakeChange, onL1StakeChange, onL2StakeChange,
    onH2StakeChange, higherPercent, lowerPercent, higherTicks, lowerTicks,
    recentMoves, prediction, leanStrength,
    busy, disabled, statusMessage, higherQuote, lowerQuote, allFourQuote, onPlaceHigher,
    onPlaceLower, onPlacePair, onPlaceAllFour, autoMode, onAutoModeChange, minLean,
    onMinLeanChange, autoEnabled, onAutoEnabledChange, aggressiveEnabled,
    onAggressiveEnabledChange, aggressiveBalancePercent, onAggressiveBalancePercentChange,
    aggressiveMinWinRate,
    aggressivePushProgress, aggressiveRounds,
    aggressiveStakeLabel, accountBalance, currency, aggressiveUsingBalance, aggressiveEachSide,
    autoStatus,
  } = props;
  const chartValues = quoteHistory.filter(Number.isFinite).slice(-30);
  const halfScale = halfBarrier ? 0.5 : 1;
  const anchor = barrierAnchor ?? quote;
  const higherLevel = anchor == null ? null : anchor + higherBarrierOffset * halfScale;
  const lowerLevel = anchor == null ? null : anchor + lowerBarrierOffset * halfScale;
  const levels = [...chartValues, ...(quote == null ? [] : [quote]), ...(higherLevel == null ? [] : [higherLevel]), ...(lowerLevel == null ? [] : [lowerLevel])];
  const min = levels.length ? Math.min(...levels) : 0;
  const max = levels.length ? Math.max(...levels) : 1;
  const span = max - min || Math.max(Math.abs(max) * 0.001, 1);
  const plotLeft = 20;
  const plotRight = 97;
  const plotTop = 12;
  const plotBottom = 82;
  const point = (value: number, index: number, count: number) =>
    `${count < 2 ? 58 : plotLeft + index * (plotRight - plotLeft) / (count - 1)},${plotBottom - (value - min) / span * (plotBottom - plotTop)}`;
  const points = chartValues.map((value, index) => point(value, index, chartValues.length)).join(" ");
  const yFor = (value: number) => plotBottom - (value - min) / span * (plotBottom - plotTop);
  const fmt = (value: number | null) => value == null ? "—" : value.toFixed(2);
  const fmtPercent = (value: number | null) => value == null ? "—" : `${Math.round(value)}%`;
  const chartReady = chartValues.length >= 2;
  const freshStamp = quoteUpdatedAt ? Date.parse(quoteUpdatedAt) : NaN;
  const quoteStale = Number.isFinite(freshStamp) && Date.now() - freshStamp > 60_000;
  const quoteState = quote == null ? "Waiting for live quote" : quoteStale ? "Quote may be stale" : `Updated ${quoteUpdatedAt || "just now"}`;
  const actionsDisabled = disabled || busy || tradeSlotBlocked || !enabled || quote == null || quoteStale;
  const fourTotal = h1Stake + l1Stake + l2Stake + h2Stake;
  const chartZone = quote == null || higherLevel == null || lowerLevel == null
    ? null
    : quote > higherLevel
      ? "higher"
      : quote < lowerLevel
        ? "lower"
        : "between";
  const chartSignal = chartZone === "higher"
    ? `PRICE IS ABOVE YOUR HIGHER BARRIER (${fmt(higherLevel)})`
    : chartZone === "lower"
      ? `PRICE IS BELOW YOUR LOWER BARRIER (${fmt(lowerLevel)})`
      : chartZone === "between"
        ? "PRICE IS BETWEEN YOUR BARRIERS"
        : "WAITING FOR LIVE PRICE AND BARRIERS";
  const chartZoneLabel = (zone: ClockWorkChartZone) =>
    zone === "higher" ? "Above Higher" : zone === "between" ? "Between" : "Below Lower";
  const pairQuoteDetail = higherQuote && lowerQuote
    ? `Payout ${money(higherQuote.payout + lowerQuote.payout, currency)} · profit ${money((higherQuote.payout - higherQuote.ask_price) + (lowerQuote.payout - lowerQuote.ask_price), currency)}`
    : "Quote unavailable";
  const barrierOptionPad = (
    side: "higher" | "lower",
    options: ClockWorkOption[],
    value: number,
    change: (value: number) => void,
  ) => {
    const effectiveOffset = value * halfScale;
    const displayValue = barrierMode === "offset"
      ? `${effectiveOffset > 0 ? "+" : ""}${effectiveOffset.toFixed(2)}`
      : fmt(anchor == null ? null : anchor + effectiveOffset);
    const adjust = (delta: number) => {
      const nextValue = value + delta;
      change(side === "higher" ? Math.max(0.01, nextValue) : Math.min(-0.01, nextValue));
    };
    return <div className={`cw-barrier-card cw-${side}`}>
      <div className="cw-barrier-title"><b>{side === "higher" ? higherBarrierLabel || "↑ Higher barrier" : lowerBarrierLabel || "↓ Lower barrier"}</b><span>{side === "higher" ? fmt(higherLevel) : fmt(lowerLevel)}</span></div>
      <div className="cw-barrier-stepper" role="group" aria-label={`${side} barrier adjustment`}>
        <button type="button" onClick={() => adjust(-0.01)} disabled={disabled} aria-label={`Decrease ${side} barrier`}><Minus size={12} /></button>
        <output aria-live="polite">{displayValue}</output>
        <button type="button" onClick={() => adjust(0.01)} disabled={disabled} aria-label={`Increase ${side} barrier`}><Plus size={12} /></button>
      </div>
      <div className="cw-barrier-options" role="group" aria-label={`${side} barrier options`}>
        {options.map((option, index) => <button type="button" key={`${option.value}-${index}`} aria-pressed={option.selected} className={option.selected ? "selected" : ""} onClick={() => change(option.value)} disabled={disabled} data-testid={`button-clock-${side}-barrier-${index}`}>{option.label}</button>)}
      </div>
    </div>;
  };

  return <section className={`cw-panel ${enabled ? "cw-live" : ""}`} data-testid="clock-work-panel">
    <header className="cw-header">
      <div className="cw-brand-mark"><Clock3 size={18} /></div>
      <div className="cw-heading"><span className="cw-kicker"><i /> LIVE MARKET WORKBENCH</span><h2>Clock Work</h2><p>Hybrid Analysis</p></div>
      <span className={`cw-live-chip ${enabled ? "is-live" : ""}`}><i />{enabled ? "LIVE" : "READY"}</span>
    </header>
    <div className="cw-content">
      <section className="cw-setup cw-surface">
        <div className="cw-setup-top">
          <label className="cw-control"><span>MARKET</span><select value={symbol} onChange={(event) => onSymbolChange(event.target.value)} disabled={disabled} aria-label="Market" data-testid="select-clock-market">{markets.map((market) => <option key={market.value} value={market.value}>{market.label}</option>)}</select></label>
          <div className="cw-control cw-duration-control"><span>DURATION</span><div className="cw-duration-choice" role="group" aria-label="Clock Work duration">
            <button type="button" aria-pressed="true" className="selected" disabled data-testid="button-clock-duration-5">{duration} Ticks</button>
          </div></div>
        </div>
        <div className="cw-stakes">
          <StakeInput id="cw-higher-stake" label="↑ Higher Stake ($)" value={higherStake} onChange={onHigherStakeChange} disabled={disabled} />
          <StakeInput id="cw-lower-stake" label="↓ Lower Stake ($)" value={lowerStake} onChange={onLowerStakeChange} disabled={disabled} />
        </div>
        <div className="cw-barrier-controls">
          <div className="cw-control"><span>BARRIER TYPE</span><div className="cw-segments" role="group" aria-label="Barrier type">
            {(["offset", "absolute"] as const).map((mode) => <button key={mode} type="button" aria-pressed={barrierMode === mode} className={barrierMode === mode ? "selected" : ""} onClick={() => onBarrierModeChange(mode)} disabled={disabled}>{mode === "offset" ? "Offset" : "Absolute"}</button>)}
          </div></div>
          <div className="cw-half"><span>Half Barrier</span><Toggle checked={halfBarrier} onChange={onHalfBarrierChange} disabled={disabled} label="Half barrier" /></div>
        </div>
        <div className="cw-barrier-grid">
          {barrierOptionPad("higher", higherBarrierOptions, higherBarrierOffset, onHigherBarrierChange)}
          {barrierOptionPad("lower", lowerBarrierOptions, lowerBarrierOffset, onLowerBarrierChange)}
        </div>
      </section>

      <section className="cw-chart-card cw-surface">
        <div className="cw-card-heading"><div><ChartNoAxesCombined size={15} /><b>Price Chart</b><small>Last {chartValues.length} ticks</small></div><div className="cw-quote-readout"><b>{fmt(quote)}</b><small>{quoteState}</small></div></div>
        <div className="cw-barrier-anchor">
          <span>Barrier anchor: <b>{fmt(barrierAnchor ?? quote)}</b></span>
          <button type="button" onClick={onResetBarrierAnchor} disabled={quote == null}>Reset to current</button>
        </div>
        <div className={`cw-chart-signal ${chartZone ?? "waiting"}`} aria-live="polite"><i />{chartSignal}</div>
        <div className="cw-chart-area">
          {chartReady ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Price chart for ${symbol} showing ${chartValues.length} recent ticks, the current market zone, and selected barriers`}>
            <defs>
              <linearGradient id="clock-work-price-gradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#21c99a" stopOpacity=".24" />
                <stop offset="100%" stopColor="#21c99a" stopOpacity=".015" />
              </linearGradient>
            </defs>
            <polygon points={`${points} ${plotRight},${plotBottom} ${plotLeft},${plotBottom}`} className="cw-price-fill" />
            {[0, 1, 2, 3].map((index) => {
              const y = plotTop + index * (plotBottom - plotTop) / 3;
              const value = max - index * span / 3;
              return <g key={index}><line x1={plotLeft} x2={plotRight} y1={y} y2={y} className="cw-grid-line" /><text x="1" y={y + 1.5} className="cw-axis-label">{fmt(value)}</text></g>;
            })}
            <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotBottom} className="cw-axis-line" />
            <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} className="cw-axis-line" />
            {higherLevel != null && <><line x1={plotLeft} x2={plotRight} y1={yFor(higherLevel)} y2={yFor(higherLevel)} className="cw-higher-line" /><text x={plotLeft + 2} y={Math.max(8, yFor(higherLevel) - 2)} className="cw-higher-text">HIGHER {fmt(higherLevel)}</text></>}
            {lowerLevel != null && <><line x1={plotLeft} x2={plotRight} y1={yFor(lowerLevel)} y2={yFor(lowerLevel)} className="cw-lower-line" /><text x={plotRight - 1} y={Math.max(8, yFor(lowerLevel) - 2)} textAnchor="end" className="cw-lower-text">LOWER {fmt(lowerLevel)}</text></>}
            <polyline points={points} className="cw-price-line" />
            {chartValues.length > 0 && <circle cx={point(chartValues[chartValues.length - 1], chartValues.length - 1, chartValues.length).split(",")[0]} cy={point(chartValues[chartValues.length - 1], chartValues.length - 1, chartValues.length).split(",")[1]} r="1.6" className="cw-chart-dot" />}
          </svg> : <div className="cw-chart-empty"><Activity size={17} /><b>Waiting for price history</b><span>Live ticks will draw here once at least two quotes arrive.</span></div>}
        </div>
        <div className="cw-chart-legend"><span><i className="cw-legend-price" />Price</span><span><i className="cw-legend-high" />Higher barrier</span><span><i className="cw-legend-low" />Lower barrier</span></div>
        <div className="cw-chart-zones" role="status" aria-label="Market position relative to your barriers">
          {(["higher", "between", "lower"] as const).map((zone) => <span
            key={zone}
            aria-current={chartZone === zone ? "true" : undefined}
            className={chartZone === zone ? "active" : ""}
            data-testid={`clock-chart-zone-${zone}`}
          >{chartZoneLabel(zone)}</span>)}
        </div>
      </section>

      <div className="cw-readouts">
        <div className="cw-percent cw-percent-high"><span>↑ Higher</span><b>{fmtPercent(higherPercent)}</b><small>{higherTicks} ticks</small></div>
        <div className="cw-percent cw-percent-low"><span>↓ Lower</span><b>{fmtPercent(lowerPercent)}</b><small>{lowerTicks} ticks</small></div>
      </div>
      <section className="cw-moves cw-surface"><div className="cw-label-row"><b>Recent Moves</b></div><div className="cw-move-list">{recentMoves.length ? recentMoves.map((move, index) => <span key={`${move.direction}-${index}`} className={move.direction === "H" ? "move-high" : move.direction === "L" ? "move-low" : "move-flat"} title={`${move.direction === "H" ? "Higher" : move.direction === "L" ? "Lower" : "Unchanged"} · ${move.quote}`}>{move.direction}</span>) : <p>No recent moves yet.</p>}</div></section>
      <section className={`cw-prediction ${prediction === "HIGHER" ? "prediction-high" : prediction === "LOWER" ? "prediction-low" : ""}`} aria-live="polite">
        <div className="cw-prediction-head"><div><span className="cw-section-kicker">OBSERVED LEAN</span><b>{prediction ?? "NOT ENOUGH DATA"}</b></div><strong>{leanStrength == null ? "—" : `${Math.round(leanStrength)}%`}<small> lean strength</small></strong></div>
        <div className="cw-lean-meter"><i style={{ width: `${Math.max(0, Math.min(100, leanStrength == null ? 0 : Math.round(leanStrength)))}%` }} /></div>
        <p>Recent price movement is descriptive, not a forecast or guarantee.</p>
      </section>
      {statusMessage && <p key={statusMessage} className="cw-status" role="status" aria-live="polite">{statusMessage}</p>}

      <div className="cw-trade-actions">
        <button type="button" className="cw-trade-button trade-high" onClick={onPlaceHigher} disabled={actionsDisabled} data-testid="button-clock-place-higher"><b>↑ HIGHER</b><small>{quoteDetail(higherQuote, currency)}</small><span>{busy ? "Sending…" : "Place Higher"}</span></button>
        <button type="button" className="cw-trade-button trade-low" onClick={onPlaceLower} disabled={actionsDisabled} data-testid="button-clock-place-lower"><b>↓ LOWER</b><small>{quoteDetail(lowerQuote, currency)}</small><span>{busy ? "Sending…" : "Place Lower"}</span></button>
        <button type="button" className="cw-pair-button" onClick={onPlacePair} disabled={actionsDisabled} data-testid="button-clock-place-pair"><b>↑ HIGHER &amp; LOWER</b><small>{pairQuoteDetail}</small><span>Combined stake {money(higherStake + lowerStake, currency)} · {duration} ticks each</span></button>
      </div>

      <section className={`cw-auto cw-surface ${autoEnabled ? "is-running" : ""}`}>
        <div className="cw-auto-head"><div><Zap size={15} /><b>Auto Trading</b>{autoEnabled && <span className="cw-active-badge">ACTIVE</span>}</div><Toggle checked={autoEnabled} onChange={onAutoEnabledChange} disabled={disabled} label="Enable auto trading" /></div>
        <div className="cw-auto-options">
          <div className="cw-choice-row" role="group" aria-label="Automatic order mode">
            {([{value:"pair",label:"H&L (2)"},{value:"auto",label:"A"},{value:"all4",label:"All (4)"}] as const).map((mode) => <button type="button" key={mode.value} aria-pressed={autoMode === mode.value} className={autoMode === mode.value ? "selected" : ""} onClick={() => onAutoModeChange(mode.value)} disabled={disabled}>{mode.label}</button>)}
          </div>
          <span className="cw-inline-label">Min lean</span>
          <div className="cw-choice-row cw-lean-choices" role="group" aria-label="Minimum lean strength">
            {[55,60,65,70,75].map((value) => <button type="button" key={value} aria-pressed={minLean === value} className={minLean === value ? "selected" : ""} onClick={() => onMinLeanChange(minLean === value ? null : value)} disabled={disabled}>{value}%</button>)}
          </div>
        </div>
        <div className="cw-auto-status"><i className={autoEnabled ? "status-on" : ""} /><span>{autoStatus || (autoEnabled ? "Automation enabled" : "Automation is off")}</span></div>
        <p className="cw-auto-note">Orders are submitted using the selected mode and minimum lean. Automation is explicit and can be stopped at any time.</p>
      </section>

      <section className={`cw-aggressive cw-surface ${aggressiveEnabled ? "is-running" : ""}`}>
        <div className="cw-auto-head"><div><Zap size={15} /><b>Aggressive Auto Trading</b><span className="cw-admin-badge">ADMIN</span>{aggressiveEnabled && <span className="cw-active-badge">ACTIVE</span>}</div><Toggle checked={aggressiveEnabled} onChange={onAggressiveEnabledChange} disabled={disabled} label="Enable aggressive auto trading" /></div>
        <div className="cw-aggressive-controls">
          <span className="cw-win-rate-threshold">Min win rate <b>{aggressiveMinWinRate}%</b></span>
          <span className="cw-inline-label">Balance %</span>
          <div className="cw-choice-row" role="group" aria-label="Aggressive balance percentage">{[5,10,25,50].map((value) => <button key={value} type="button" aria-pressed={aggressiveBalancePercent === value} className={aggressiveBalancePercent === value ? "selected" : ""} onClick={() => onAggressiveBalancePercentChange(value)} disabled={disabled}>{value}%</button>)}</div>
        </div>
        <div className="cw-balance-strip"><span>Balance <b>{money(accountBalance, currency)}</b></span><span>Using <b>{money(aggressiveUsingBalance, currency)}</b></span><span>{aggressiveStakeLabel} <b>{money(aggressiveEachSide, currency)}</b></span></div>
        <div className="cw-aggressive-status">
          <div className="cw-auto-status"><i className={aggressiveEnabled ? "status-on" : ""} /><span>{autoStatus || (aggressiveEnabled ? "Waiting for a 2-tick push." : "Aggressive automation is off.")}</span></div>
          <span className="cw-rounds">{aggressiveRounds} rounds</span>
        </div>
        <div className="cw-push-progress" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }} role="progressbar" aria-label="Consecutive tick push progress" aria-valuemin={0} aria-valuemax={2} aria-valuenow={Math.min(2, aggressivePushProgress)}>
          {Array.from({ length: 2 }, (_, index) => <i key={index} className={index < aggressivePushProgress ? "reached" : ""} />)}
        </div>
        <p className="cw-auto-note">Aggressive entries require at least {aggressiveMinWinRate}% observed win rate for the push direction. This historical threshold does not guarantee future results.</p>
      </section>

      <section className="cw-four cw-surface">
        <div className="cw-four-heading"><div><span>4T</span><b>All 4 Trades Stakes</b></div><small>H1 / L1 → L2 / H2</small></div>
        <div className="cw-four-grid">
          <StakeInput id="cw-h1-stake" label="H1 ($)" value={h1Stake} onChange={onH1StakeChange} disabled={disabled} />
          <StakeInput id="cw-l1-stake" label="L1 ($)" value={l1Stake} onChange={onL1StakeChange} disabled={disabled} />
          <StakeInput id="cw-l2-stake" label="L2 ($)" value={l2Stake} onChange={onL2StakeChange} disabled={disabled} />
          <StakeInput id="cw-h2-stake" label="H2 ($)" value={h2Stake} onChange={onH2StakeChange} disabled={disabled} />
        </div>
        <button type="button" className="cw-four-action" onClick={onPlaceAllFour} disabled={actionsDisabled} data-testid="button-clock-place-all-four"><b>↑↓ ALL 4 TRADES</b><small>{quoteDetail(allFourQuote, currency)}</small><span>Total stake {money(fourTotal, currency)}</span></button>
        <div className="cw-risk-note">The highest user-set stake is listed last. Batch trades are submitted together and settle independently; this cannot guarantee covering earlier losses.</div>
      </section>
    </div>
  </section>;
}
