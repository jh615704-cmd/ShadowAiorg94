import { Activity, BookOpen, Check, Play, Radar, RefreshCw, Square, Target, Zap } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import "./matches-analysis-panel.css";

export type MatchesMarketType = "volatility" | "jumps";
export type MatchesMarketOption = { value: string; label: string; marketType: MatchesMarketType };
export type MatchesDuration = 1 | 2 | 3 | 4 | 5;
export type MatchesAiDigits = 1 | 2 | 3;

export interface MatchesAnalysisPanelProps {
  marketType: MatchesMarketType;
  markets: MatchesMarketOption[];
  symbol: string;
  onMarketTypeChange: (value: MatchesMarketType) => void;
  onSymbolChange: (value: string) => void;
  digitHistory: number[];
  tickCount: number;
  marketSelectedDigits: number[];
  selectedDigits: number[];
  onSelectedDigitsChange: (values: number[]) => void;
  duration: MatchesDuration;
  onDurationChange: (value: MatchesDuration) => void;
  stake: number;
  onStakeChange: (value: number) => void;
  aiDigits: MatchesAiDigits;
  aiDigitsConfirmed: boolean;
  onAiDigitsChange: (value: MatchesAiDigits) => void;
  isRunning: boolean;
  isPlacing: boolean;
  disabled: boolean;
  tradeSlotBlocked: boolean;
  statusMessage: string;
  onStartMatches: () => void;
  onStopMatches: () => void;
  onRescan: () => void;
  onOpenGuide: () => void;
  /** AI Auto market-selection state. */
  autoMarketSelection?: boolean;
  onAutoMarketSelectionChange?: (enabled: boolean) => void;
  /** A · Auto selects market-ranked digits; Manual uses selectedDigits. */
  autoDigitMode?: boolean;
  onAutoDigitModeChange?: (enabled: boolean) => void;
  lossLimit?: number;
  onLossLimitChange?: (amount: number) => void;
  profitTarget?: number;
  onProfitTargetChange?: (amount: number) => void;
  sessionPnl?: number;
  currency?: string;
}

const durations: readonly MatchesDuration[] = [1, 2, 3, 4, 5];
const digitBatchSizes: readonly MatchesAiDigits[] = [1, 2, 3];

function amount(value: number, currency: string) {
  return `${currency} ${Math.abs(value).toFixed(2)}`;
}

export default function MatchesAnalysisPanel(props: MatchesAnalysisPanelProps) {
  const {
    marketType, markets, symbol, onMarketTypeChange, onSymbolChange,
    digitHistory, tickCount, marketSelectedDigits, selectedDigits, onSelectedDigitsChange,
    duration, onDurationChange, stake, onStakeChange, aiDigits, aiDigitsConfirmed,
    onAiDigitsChange, isRunning, isPlacing, disabled, tradeSlotBlocked,
    statusMessage, onStartMatches, onStopMatches, onRescan, onOpenGuide,
  } = props;
  const autoMarketSelection = props.autoMarketSelection ?? false;
  const changeAutoMarketSelection = props.onAutoMarketSelectionChange;
  const autoDigitMode = props.autoDigitMode ?? false;
  const changeAutoDigitMode = props.onAutoDigitModeChange;
  const currency = props.currency ?? "USD";
  const sessionPnl = props.sessionPnl ?? 0;
  const lossLimit = props.lossLimit ?? 0;
  const profitTarget = props.profitTarget ?? 0;
  const [dismissedStatusMessage, setDismissedStatusMessage] = useState<string | null>(null);
  const [isStatusMessageFading, setIsStatusMessageFading] = useState(false);
  const activeMarkets = markets.filter((market) => market.marketType === marketType);
  const counts = Array.from({ length: 10 }, (_, digit) =>
    digitHistory.reduce((total, observed) => total + (observed === digit ? 1 : 0), 0),
  );
  const maxCount = Math.max(1, ...counts);
  const observedSampleSize = counts.reduce((total, count) => total + count, 0);
  const hasObservedSample = observedSampleSize > 0;
  const autoSelectedDigits = marketSelectedDigits.filter((digit) => digit >= 0 && digit <= 9).slice(0, aiDigits);
  const mostFrequentDigits = counts
    .map((count, digit) => ({ digit, count }))
    .sort((a, b) => b.count - a.count || a.digit - b.digit)
    .slice(0, 3)
    .map((item) => item.digit);
  const actionDisabled = disabled || isPlacing || tradeSlotBlocked;
  const setMarketFamily = (next: MatchesMarketType) => {
    onMarketTypeChange(next);
    const nextMarket = markets.find((market) => market.marketType === next);
    if (nextMarket && !markets.some((market) => market.marketType === next && market.value === symbol)) {
      onSymbolChange(nextMarket.value);
    }
  };
  const pointForDigit = (digit: number, radius: number) => {
    const angle = (Math.PI * 2 * digit) / 10 - Math.PI / 2;
    return { x: 150 + Math.cos(angle) * radius, y: 139 + Math.sin(angle) * radius };
  };
  const radarPoints = counts.map((count, digit) => {
    const point = pointForDigit(digit, 25 + (count / maxCount) * 54);
    return `${point.x},${point.y}`;
  }).join(" ");
  const handleDigitKeyDown = (event: KeyboardEvent<SVGGElement>, digit: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!disabled && !autoDigitMode) toggleManualDigit(digit);
    }
  };
  const toggleManualDigit = (digit: number) => {
    if (selectedDigits.includes(digit)) {
      onSelectedDigitsChange(selectedDigits.filter((item) => item !== digit));
    } else if (selectedDigits.length < 3) {
      onSelectedDigitsChange([...selectedDigits, digit]);
    }
  };

  useEffect(() => {
    setDismissedStatusMessage(null);
    setIsStatusMessageFading(false);
    if (!statusMessage) return;

    const fadeTimer = window.setTimeout(() => setIsStatusMessageFading(true), 4_700);
    const dismissTimer = window.setTimeout(() => setDismissedStatusMessage(statusMessage), 5_000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [statusMessage]);

  const visibleStatusMessage = statusMessage && statusMessage !== dismissedStatusMessage
    ? statusMessage
    : null;

  return (
    <section className={`ma-panel ${isRunning ? "ma-is-running" : ""}`} data-testid="matches-analysis-panel">
      <header className="ma-header">
        <div className="ma-heading">
          <div className="ma-mark" aria-hidden="true"><Radar size={18} /></div>
          <div>
            <span className="ma-eyebrow"><i /> MATCHES WORKSPACE</span>
            <h2 data-testid="text-matches-title">Matches Analysis</h2>
            <p>Read the live sample. Choose how to act.</p>
          </div>
        </div>
        <div className={`ma-state ${isRunning ? "ma-state-live" : ""}`} data-testid="status-matches-state" role="status">
          <i />{isRunning ? "ANALYSIS RUNNING" : "READY"}
        </div>
        <button type="button" className="ma-guide-button" onClick={onOpenGuide} data-testid="button-matches-guide">
          <BookOpen size={14} aria-hidden="true" /> <span>Guide</span>
        </button>
      </header>

      <div className="ma-status-strip" data-testid="status-matches-market" aria-live="polite">
        <span className={`ma-led ${tickCount > 0 ? "ma-led-live" : ""}`} />
        <span>{tickCount > 0 ? "OBSERVING" : "WAITING FOR TICKS"}</span>
        <span className="ma-divider" aria-hidden="true" />
        <strong>{symbol || "No market selected"}</strong>
        <span className="ma-spacer" />
        <span data-testid="value-matches-tick-count">{tickCount.toLocaleString()} ticks</span>
      </div>

      <div className="ma-body">
        <section className="ma-setup ma-surface" aria-labelledby="ma-setup-title">
          <div className="ma-section-heading">
            <div><span className="ma-index">01</span><div><h3 id="ma-setup-title">Market selection</h3><p>Set the market family and entry context</p></div></div>
            <Activity size={17} aria-hidden="true" />
          </div>
          <div className="ma-setup-grid">
            <div className="ma-field ma-family-field">
              <span className="ma-field-label">MARKET FAMILY</span>
              <div className="ma-segments" role="group" aria-label="Market family">
                {(["volatility", "jumps"] as const).map((type) => (
                  <button key={type} type="button" className={marketType === type ? "selected" : ""}
                    aria-pressed={marketType === type} onClick={() => setMarketFamily(type)}
                    disabled={disabled || tradeSlotBlocked || autoMarketSelection}
                    data-testid={`button-matches-market-type-${type}`}>
                    {type === "volatility" ? "Volatility" : "Jumps"}
                  </button>
                ))}
              </div>
            </div>
            <label className="ma-field">
              <span className="ma-field-label">MARKET SYMBOL</span>
              <select value={symbol} onChange={(event) => onSymbolChange(event.target.value)}
                disabled={disabled || autoMarketSelection} aria-label="Selected market" data-testid="select-matches-market">
                {activeMarkets.map((market) => <option value={market.value} key={market.value}>{market.label} · {market.value}</option>)}
                {!activeMarkets.length && <option value="">No markets available</option>}
              </select>
            </label>
            <label className="ma-market-auto">
              <span className="ma-auto-copy"><b>AI Auto market selection</b><small>Choose a market using observed settled results.</small></span>
              <span className="ma-switch-control">
                <span className="ma-switch-state">{autoMarketSelection ? "ON" : "OFF"}</span>
                <span className="ma-switch">
                  <input type="checkbox" role="switch" checked={autoMarketSelection}
                    onChange={(event) => changeAutoMarketSelection?.(event.target.checked)}
                    disabled={disabled || !changeAutoMarketSelection}
                    aria-label="AI Auto market selection" data-testid="button-matches-auto-market" />
                  <i />
                </span>
              </span>
            </label>
          </div>
        </section>

        <div className="ma-analysis-grid">
          <section className="ma-radar-card ma-surface" aria-labelledby="ma-radar-title">
            <div className="ma-section-heading ma-radar-heading">
              <div><span className="ma-index">02</span><div><h3 id="ma-radar-title">Live digit radar</h3><p>Frequency shape across this observed sample</p></div></div>
              <button type="button" className="ma-icon-button" onClick={onRescan} disabled={disabled}
                aria-label="Rescan observed digit history" data-testid="button-matches-rescan"><RefreshCw size={15} /></button>
            </div>
            <div className="ma-radar-readout">
              <span><small>CURRENT SAMPLE</small><b data-testid="value-matches-sample-count">{tickCount.toLocaleString()}</b><small>ticks</small></span>
              <span className="ma-radar-readout-divider" aria-hidden="true" />
                <span><small>{autoDigitMode ? "A · AUTO COUNT" : "MANUAL DIGITS"}</small><b data-testid="value-matches-selected-digit">{autoDigitMode ? aiDigits : selectedDigits.length ? selectedDigits.join(", ") : "—"}</b></span>
              <span className="ma-spacer" />
              <span className={`ma-radar-live ${tickCount ? "" : "is-empty"}`}><i />{tickCount ? "LIVE SAMPLE" : "NO SAMPLE"}</span>
            </div>
            <div className="ma-radar-wrap">
              {tickCount > 0 && digitHistory.length > 0 ? (
                <svg className={`ma-radar ${autoDigitMode ? "is-auto" : "is-manual"}`} viewBox="0 0 300 278" role="group" aria-label={`Observed digit frequency radar for ${symbol}`}>
                  {[1, 2, 3, 4].map((ring) => <polygon key={ring} className="ma-radar-ring"
                    points={Array.from({ length: 10 }, (_, digit) => {
                      const point = pointForDigit(digit, ring * 17);
                      return `${point.x},${point.y}`;
                    }).join(" ")} />)}
                  {Array.from({ length: 10 }, (_, digit) => {
                    const outer = pointForDigit(digit, 70);
                    return <line key={`spoke-${digit}`} x1="150" y1="139" x2={outer.x} y2={outer.y} className="ma-radar-spoke" />;
                  })}
                  <polygon className="ma-radar-area" points={radarPoints} />
                  {Array.from({ length: 10 }, (_, digit) => {
                    const label = pointForDigit(digit, 103);
                    const value = pointForDigit(digit, 25 + (counts[digit] / maxCount) * 54);
                    const isLeading = mostFrequentDigits.includes(digit);
                    const isMarketSelected = autoDigitMode && autoSelectedDigits.includes(digit);
                    const isManualSelected = !autoDigitMode && selectedDigits.includes(digit);
                    return <g key={digit}>
                      <circle cx={value.x} cy={value.y} r={isLeading ? 3.6 : 2.5} className={`ma-radar-point ${isLeading ? "is-leading" : ""}`} />
                      <g className={`ma-radar-label ${isMarketSelected ? "is-market-selected" : ""} ${isManualSelected ? "is-manual-selected" : ""} ${isLeading ? "is-leading" : ""}`}
                        role="button" tabIndex={disabled || autoDigitMode ? -1 : 0} aria-pressed={isManualSelected}
                        aria-disabled={disabled || autoDigitMode}
                        aria-label={`Digit ${digit}, observed ${counts[digit]} times${isMarketSelected ? ", selected by A Auto from market observations" : ""}${isManualSelected ? ", manually selected" : ""}`}
                        onClick={() => { if (!disabled && !autoDigitMode) toggleManualDigit(digit); }}
                        onKeyDown={(event) => handleDigitKeyDown(event, digit)}
                        data-testid={`button-matches-radar-digit-${digit}`}>
                        <circle cx={label.x} cy={label.y} r="12" />
                        <text x={label.x} y={label.y + 3.7}>{digit}</text>
                      </g>
                    </g>;
                  })}
                  <circle cx="150" cy="139" r="2.5" className="ma-radar-center" />
                </svg>
              ) : (
                <div className="ma-radar-empty">
                  <Radar size={27} aria-hidden="true" />
                  <b>Waiting for a useful sample</b>
                  <span>Observed digit frequency appears here as ticks arrive.</span>
                </div>
              )}
            </div>
            <div className="ma-radar-legend">
                <span><i className="ma-legend-area" />Observed frequency</span>
              {autoDigitMode
                ? <span><i className="ma-legend-auto" />Market-selected A · Auto digits</span>
                : <span><i className="ma-legend-manual" />Manual selection</span>}
            </div>
            <p className="ma-radar-note">Historical observations describe this sample only. They are not predictions or promises of future results.</p>
          </section>

          <section className="ma-controls ma-surface" aria-labelledby="ma-digit-controls-title">
            <div className="ma-section-heading">
              <div><span className="ma-index">03</span><div><h3 id="ma-digit-controls-title">Digit controls</h3><p>Use market-selected digits or choose one yourself</p></div></div>
              <Target size={17} aria-hidden="true" />
            </div>
            <div className="ma-mode-block">
              <span className="ma-field-label">DIGIT MODE</span>
              <div className="ma-mode-options" role="group" aria-label="Digit mode">
                <button type="button" className={autoDigitMode ? "selected" : ""} aria-pressed={autoDigitMode}
                  onClick={() => changeAutoDigitMode?.(true)} disabled={disabled || !changeAutoDigitMode}
                  data-testid="button-matches-digit-mode-auto">A · Auto</button>
                <button type="button" className={!autoDigitMode ? "selected" : ""} aria-pressed={!autoDigitMode}
                  onClick={() => changeAutoDigitMode?.(false)} disabled={disabled || !changeAutoDigitMode}
                  data-testid="button-matches-digit-mode-manual">Manual</button>
              </div>
              <div className={`ma-auto-digit-count ${!autoDigitMode ? "is-inactive" : ""}`}>
                <div className="ma-field-label"><span>AUTO DIGITS PER ENTRY</span><small>{autoDigitMode ? "Observed ranking" : "Available in A · Auto"}</small></div>
                <div className="ma-count-options" role="group" aria-label="Number of automatic digits">
                  {digitBatchSizes.map((value) => <button key={value} type="button"
                    className={aiDigitsConfirmed && aiDigits === value ? "selected" : ""}
                    aria-pressed={aiDigitsConfirmed && aiDigits === value}
                    onClick={() => onAiDigitsChange(value)} disabled={disabled || isRunning || !autoDigitMode}
                    data-testid={`button-matches-ai-digits-${value}`}>{value}</button>)}
                </div>
              </div>
              {!autoDigitMode && (
                <div className="ma-manual-digits">
                  <div className="ma-field-label"><span>SELECT DIGITS</span><small>Up to 3 · 0–9</small></div>
                  <div className="ma-digit-grid" role="group" aria-label="Manual digit selection">
                    {Array.from({ length: 10 }, (_, digit) => (
                      <button key={digit} type="button" className={selectedDigits.includes(digit) ? "selected" : ""}
                        aria-pressed={selectedDigits.includes(digit)} onClick={() => toggleManualDigit(digit)}
                        disabled={disabled || isRunning} data-testid={`button-matches-digit-${digit}`}>{digit}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="ma-input-grid">
              <label className="ma-field">
                <span className="ma-field-label">STAKE <b>{currency}</b></span>
                <input type="number" min="0.35" step="0.01" value={stake}
                  onChange={(event) => onStakeChange(Math.max(0.35, Number(event.target.value) || 0.35))}
                  disabled={disabled || isRunning} aria-label={`Stake amount in ${currency}`} data-testid="input-matches-stake" />
              </label>
              <label className="ma-field">
                <span className="ma-field-label">DURATION <b>TICKS</b></span>
                <select value={duration} onChange={(event) => onDurationChange(Number(event.target.value) as MatchesDuration)}
                  disabled={disabled || isRunning} aria-label="Matches duration in ticks" data-testid="select-matches-duration">
                  {durations.map((value) => <option key={value} value={value}>{value} {value === 1 ? "tick" : "ticks"}</option>)}
                </select>
              </label>
              <label className="ma-field">
                <span className="ma-field-label">LOSS LIMIT <b>{currency}</b></span>
                <input type="number" min="0" step="0.01" value={lossLimit}
                  onChange={(event) => props.onLossLimitChange?.(Math.max(0, Number(event.target.value) || 0))}
                  disabled={disabled || isRunning || !props.onLossLimitChange} aria-label={`Session loss limit in ${currency}`} data-testid="input-matches-loss-limit" />
              </label>
              <label className="ma-field">
                <span className="ma-field-label">PROFIT TARGET <b>{currency}</b></span>
                <input type="number" min="0" step="0.01" value={profitTarget}
                  onChange={(event) => props.onProfitTargetChange?.(Math.max(0, Number(event.target.value) || 0))}
                  disabled={disabled || isRunning || !props.onProfitTargetChange} aria-label={`Session profit target in ${currency}`} data-testid="input-matches-profit-target" />
              </label>
            </div>
            <div className="ma-session-pnl" data-testid="value-matches-session-pnl" aria-live="polite">
              <span><small>LIVE SESSION P/L</small><b className={sessionPnl > 0 ? "is-positive" : sessionPnl < 0 ? "is-negative" : ""}>{sessionPnl < 0 ? "−" : ""}{amount(sessionPnl, currency)}</b></span>
              <span className="ma-pnl-context"><i />Updates as contracts settle</span>
            </div>
          </section>
        </div>

        <section className="ma-execution ma-surface" aria-labelledby="ma-execution-title">
          <div className="ma-section-heading">
            <div><span className="ma-index">04</span><div><h3 id="ma-execution-title">Analysis session</h3><p>Start the session when your market and entry rules are set.</p></div></div>
            <Zap size={17} aria-hidden="true" />
          </div>
          <div className="ma-execution-summary">
            <span><small>MARKET</small><b>{symbol || "Not selected"}</b></span>
            <span><small>ENTRY</small><b>{autoDigitMode ? `A · Auto · ${aiDigits} digit${aiDigits === 1 ? "" : "s"}` : `Manual ${selectedDigits.length ? selectedDigits.join(", ") : "no digits"}`}</b></span>
            <span><small>STAKE / DURATION</small><b>{currency} ${stake.toFixed(2)} · {duration} {duration === 1 ? "tick" : "ticks"}</b></span>
          </div>
          <button type="button" className={`ma-primary-button ${isRunning ? "is-stop" : ""}`}
            onClick={isRunning ? onStopMatches : onStartMatches}
            disabled={disabled || isPlacing || (!isRunning && tradeSlotBlocked)}
            aria-busy={isPlacing}
            aria-label={isRunning ? "Stop Matches Analysis" : "Start Matches Analysis"}
            data-testid={isRunning ? "button-matches-stop" : "button-matches-start"}>
            {isRunning ? <Square size={16} fill="currentColor" aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
            <span>{isPlacing ? "Preparing analysis…" : isRunning ? "Stop Matches Analysis" : "Start Matches Analysis"}</span>
            {!isRunning && <span className="ma-button-arrow" aria-hidden="true"><Check size={15} /></span>}
          </button>
          {tradeSlotBlocked && <p className="ma-slot-warning" role="status" data-testid="status-matches-trade-slot">An active contract is settling. Analysis can start when the trade slot is clear.</p>}
          {visibleStatusMessage && <p className="ma-status-message" role="status" aria-live="polite" data-testid="status-matches-message" style={{ opacity: isStatusMessageFading ? 0 : 1, transition: "opacity 300ms ease" }}>{visibleStatusMessage}</p>}
        </section>
      </div>
    </section>
  );
}
