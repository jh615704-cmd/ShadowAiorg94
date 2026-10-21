import { Activity, BookOpen, Medal, Play, Radar, RefreshCw, Square, Zap } from "lucide-react";
import type { KeyboardEvent } from "react";
import "./matches-analysis-panel.css";

export type MatchesMarketType = "volatility" | "jumps";
export type MatchesDigitStat = { digit: number; count: number; rate: number };
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
  topDigits: MatchesDigitStat[];
  selectedDigit: number;
  onSelectedDigitChange: (value: number) => void;
  duration: MatchesDuration;
  onDurationChange: (value: MatchesDuration) => void;
  stake: number;
  onStakeChange: (value: number) => void;
  aiEnabled: boolean;
  onAiEnabledChange: (value: boolean) => void;
  aiDigits: MatchesAiDigits;
  onAiDigitsChange: (value: MatchesAiDigits) => void;
  isRunning: boolean;
  isPlacing: boolean;
  disabled: boolean;
  tradeSlotBlocked: boolean;
  statusMessage: string;
  onManualTrade: () => void;
  onTradeDigit: (digit: number) => void;
  onStartMatches: () => void;
  onStopMatches: () => void;
  onRescan: () => void;
  onOpenGuide: () => void;
}

const durations: readonly MatchesDuration[] = [1, 2, 3, 4, 5];
const aiBatchSizes: readonly MatchesAiDigits[] = [1, 2, 3];

export default function MatchesAnalysisPanel({
  marketType,
  markets,
  symbol,
  onMarketTypeChange,
  onSymbolChange,
  digitHistory,
  tickCount,
  topDigits,
  selectedDigit,
  onSelectedDigitChange,
  duration,
  onDurationChange,
  stake,
  onStakeChange,
  aiEnabled,
  onAiEnabledChange,
  aiDigits,
  onAiDigitsChange,
  isRunning,
  isPlacing,
  disabled,
  tradeSlotBlocked,
  statusMessage,
  onManualTrade,
  onTradeDigit,
  onStartMatches,
  onStopMatches,
  onRescan,
  onOpenGuide,
}: MatchesAnalysisPanelProps) {
  const activeMarkets = markets.filter((market) => market.marketType === marketType);
  const counts = Array.from({ length: 10 }, (_, digit) =>
    digitHistory.reduce((total, observed) => total + (observed === digit ? 1 : 0), 0),
  );
  const maxCount = Math.max(1, ...counts);
  const rankedDigits = [...topDigits]
    .filter((item) => item.digit >= 0 && item.digit <= 9)
    .sort((a, b) => b.rate - a.rate || b.count - a.count)
    .slice(0, 3);
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
      onSelectedDigitChange(digit);
    }
  };

  return (
    <section className={`ma-panel ${isRunning ? "ma-is-running" : ""}`} data-testid="matches-analysis-panel">
      <header className="ma-header">
        <div className="ma-heading">
          <div className="ma-mark" aria-hidden="true"><Radar size={18} /></div>
          <div>
            <span className="ma-eyebrow"><i /> LIVE DIGIT WORKBENCH</span>
            <h2 data-testid="text-matches-title">Matches Analysis</h2>
            <p>Observed digit frequency · live tick context</p>
          </div>
        </div>
        <div className={`ma-state ${isRunning ? "ma-state-live" : ""}`} data-testid="status-matches-state">
          <i />{isRunning ? "RUNNING" : "READY"}
        </div>
        <button type="button" className="ma-guide-button" onClick={onOpenGuide} data-testid="button-matches-guide">
          <BookOpen size={14} /> <span>Guide</span>
        </button>
      </header>

      <div className="ma-status-strip" data-testid="status-matches-market">
        <span className={`ma-led ${tickCount > 0 ? "ma-led-live" : ""}`} />
        <span>{tickCount > 0 ? "OBSERVING" : "WAITING FOR TICKS"}</span>
        <span className="ma-divider" />
        <strong>{symbol || "No market selected"}</strong>
        <span className="ma-spacer" />
        <span data-testid="value-matches-tick-count">{tickCount.toLocaleString()} ticks</span>
      </div>

      <div className="ma-body">
        <section className="ma-setup ma-surface" aria-labelledby="ma-setup-title">
          <div className="ma-section-heading">
            <div><span className="ma-index">01</span><div><h3 id="ma-setup-title">Market setup</h3><p>Instrument, duration and stake</p></div></div>
            <Activity size={17} aria-hidden="true" />
          </div>
          <div className="ma-setup-grid">
            <div className="ma-field ma-family-field">
              <span className="ma-field-label">MARKET FAMILY</span>
              <div className="ma-segments" role="group" aria-label="Market family">
                {(["volatility", "jumps"] as const).map((type) => (
                  <button key={type} type="button" className={marketType === type ? "selected" : ""}
                    aria-pressed={marketType === type} onClick={() => setMarketFamily(type)} disabled={disabled}
                    data-testid={`button-matches-market-type-${type}`}>
                    {type === "volatility" ? "Volatility" : "Jumps"}
                  </button>
                ))}
              </div>
            </div>
            <label className="ma-field">
              <span className="ma-field-label">MARKET SYMBOL</span>
              <select value={symbol} onChange={(event) => onSymbolChange(event.target.value)} disabled={disabled}
                aria-label="Selected market" data-testid="select-matches-market">
                {activeMarkets.map((market) => <option value={market.value} key={market.value}>{market.label} · {market.value}</option>)}
                {!activeMarkets.length && <option value="">No markets available</option>}
              </select>
            </label>
            <label className="ma-field ma-stake-field">
              <span className="ma-field-label">STAKE <b>MIN 0.35</b></span>
              <span className="ma-input-prefix"><span>$</span>
                <input type="number" min="0.35" step="0.01" value={stake}
                  onChange={(event) => onStakeChange(Math.max(0.35, Number(event.target.value) || 0.35))}
                  disabled={disabled} aria-label="Stake amount" data-testid="input-matches-stake" />
              </span>
            </label>
          </div>
        </section>

        <div className="ma-analysis-grid">
          <section className="ma-radar-card ma-surface" aria-labelledby="ma-radar-title">
            <div className="ma-section-heading ma-radar-heading">
              <div><span className="ma-index">02</span><div><h3 id="ma-radar-title">Digit radar</h3><p>Observed share in current sample</p></div></div>
              <button type="button" className="ma-icon-button" onClick={onRescan} disabled={disabled}
                aria-label="Rescan observed digit history" data-testid="button-matches-rescan"><RefreshCw size={15} /></button>
            </div>
            <div className="ma-radar-readout">
              <span><small>SAMPLE</small><b data-testid="value-matches-sample-count">{tickCount.toLocaleString()}</b><small>ticks</small></span>
              <span className="ma-radar-readout-divider" />
              <span><small>SELECTED DIGIT</small><b data-testid="value-matches-selected-digit">{selectedDigit}</b></span>
              <span className="ma-spacer" />
              <span className="ma-radar-live"><i />{tickCount ? "LIVE SAMPLE" : "NO SAMPLE"}</span>
            </div>
            <div className="ma-radar-wrap">
              {tickCount > 0 && digitHistory.length > 0 ? (
                <svg className="ma-radar" viewBox="0 0 300 278" role="group" aria-label={`Observed digit frequency radar for ${symbol}`}>
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
                    const isLeading = rankedDigits.some((item) => item.digit === digit);
                    const isSelected = selectedDigit === digit;
                    return <g key={digit}>
                      <circle cx={value.x} cy={value.y} r={isLeading ? 3.4 : 2.4} className={`ma-radar-point ${isLeading ? "is-leading" : ""}`} />
                      <g className={`ma-radar-label ${isSelected ? "is-selected" : ""} ${isLeading ? "is-leading" : ""}`}
                        role="button" tabIndex={disabled ? -1 : 0} aria-pressed={isSelected} aria-disabled={disabled}
                        aria-label={`Select digit ${digit}, observed ${counts[digit]} times`}
                        onClick={() => { if (!disabled) onSelectedDigitChange(digit); }}
                        onKeyDown={(event) => { if (!disabled) handleDigitKeyDown(event, digit); }}
                        data-testid={`button-matches-radar-digit-${digit}`}>
                        <circle cx={label.x} cy={label.y} r="12" />
                        <text x={label.x} y={label.y + 3.7}>{digit}</text>
                      </g>
                    </g>;
                  })}
                  <circle cx="150" cy="139" r="2" className="ma-radar-center" />
                </svg>
              ) : (
                <div className="ma-radar-empty">
                  <Radar size={27} aria-hidden="true" />
                  <b>Collecting observed ticks</b>
                  <span>Digit frequency appears when the sample contains observations.</span>
                </div>
              )}
            </div>
            <div className="ma-radar-legend"><span><i className="ma-legend-area" />Observed frequency</span><span><i className="ma-legend-leading" />Leading observed digits</span></div>
            <p className="ma-radar-note">Historical frequency is descriptive only; it does not predict the next tick.</p>
          </section>

           <section className="ma-observed-card ma-surface" aria-labelledby="ma-observed-title">
            <div className="ma-section-heading">
               <div><span className="ma-index">03</span><div><h3 id="ma-observed-title">Top 3 settled win rates</h3><p>Same market and selected duration</p></div></div>
               <span className="ma-observed-tag">SETTLED</span>
            </div>
             <div className="ma-ranking-list">
               {rankedDigits.length ? rankedDigits.map((item, index) => (
                  <div className="ma-ranked-item" key={item.digit} data-testid={`matches-top-digit-${item.digit}`}>
                    <div className={`ma-rank-card ${selectedDigit === item.digit ? "is-selected" : ""}`}>
                      <button type="button"
                      className="ma-rank-select"
                     onClick={() => onSelectedDigitChange(item.digit)} disabled={disabled}
                     aria-pressed={selectedDigit === item.digit}
                     aria-label={`Select observed digit ${item.digit}`}>
                        <span className={`ma-rank-medal medal-${index + 1}`} aria-hidden="true"><Medal size={17} /></span>
                        <span className="ma-rank-digit">{item.digit}</span>
                      </button>
                      <span className="ma-rank-stats">
                        <b data-testid={`value-matches-settled-win-rate-${item.digit}`}>{item.rate.toFixed(1)}%</b>
                        <small>{item.count} settled</small>
                      </span>
                      <button type="button" className="ma-tap-trade" onClick={() => onTradeDigit(item.digit)}
                        disabled={actionDisabled} data-testid={`button-matches-tap-${item.digit}`}>TAP TO TRADE</button>
                    </div>
                 </div>
               )) : <div className="ma-ranking-empty" data-testid="empty-matches-top-digits">No duration-matched settled outcomes yet.</div>}
            </div>
            <div className="ma-frequency-disclaimer" data-testid="text-matches-frequency-disclaimer">
               Only settled Digit Match outcomes for this market and duration are ranked. Past results do not predict future trades.
            </div>
          </section>
        </div>

        <section className="ma-execution ma-surface" aria-labelledby="ma-execution-title">
          <div className="ma-section-heading">
            <div><span className="ma-index">04</span><div><h3 id="ma-execution-title">Execution rail</h3><p>Set contract length, then choose manual or automated Matches.</p></div></div>
            <Zap size={17} aria-hidden="true" />
          </div>
          <div className="ma-execution-controls">
            <div className="ma-duration">
              <span className="ma-field-label">DURATION / TICKS</span>
              <div className="ma-duration-list" role="group" aria-label="Matches duration">
                {durations.map((value) => <button key={value} type="button"
                  className={duration === value ? "selected" : ""} aria-pressed={duration === value}
                  onClick={() => onDurationChange(value)} disabled={disabled}
                  data-testid={`button-matches-duration-${value}`}>
                  <b>{value}</b><span>{value === 1 ? "tick" : "ticks"}</span>
                </button>)}
              </div>
              <small className="ma-duration-note">Entry is Tick 0; settlement is evaluated on the selected numbered tick.</small>
            </div>
            <div className={`ma-ai-controls ${aiEnabled ? "is-enabled" : ""}`}>
              <div className="ma-ai-head">
                <div><span className="ma-ai-mark"><Zap size={13} /></span><span><b>AI Matches</b><small>Automated digit batches</small></span></div>
                <label className="ma-switch-control" aria-label="Flip Switch">
                  <span className="ma-switch-state">{aiEnabled ? "ON" : "OFF"}</span>
                  <span className="ma-switch">
                    <input type="checkbox" role="switch" checked={aiEnabled}
                      onChange={(event) => onAiEnabledChange(event.target.checked)}
                      disabled={disabled} aria-label="Flip Switch" data-testid="button-matches-ai-toggle" />
                    <i />
                  </span>
                </label>
              </div>
              <div className="ma-batch-row">
                <span className="ma-field-label">TOP DIGITS / TRADE</span>
                <div className="ma-batch-options" role="group" aria-label="AI Matches batch size">
                  {aiBatchSizes.map((value) => <button key={value} type="button"
                    className={aiDigits === value ? "selected" : ""} aria-pressed={aiDigits === value}
                    onClick={() => onAiDigitsChange(value)} disabled={disabled || isRunning}
                    data-testid={`button-matches-ai-digits-${value}`}>{value}</button>)}
                </div>
              </div>
              <p className="ma-ai-note">Automation waits for settled results at the selected duration. Stop is available at any time.</p>
            </div>
          </div>
          <div className="ma-action-row">
            <button type="button" className="ma-manual-button" onClick={onManualTrade}
              disabled={actionDisabled} data-testid="button-matches-manual-trade">
              <span className="ma-action-icon"><Activity size={16} /></span>
              <span><b>{isPlacing ? "Submitting trade…" : "Manual Matches trade"}</b><small>Digit {selectedDigit} · {duration} {duration === 1 ? "tick" : "ticks"} · ${stake.toFixed(2)}</small></span>
            </button>
            {!isRunning ? (
              <button type="button" className="ma-start-button" onClick={onStartMatches}
                disabled={disabled || tradeSlotBlocked} data-testid="button-matches-start">
                <Play size={16} fill="currentColor" /><span><b>Start Matches</b><small>{aiEnabled ? `${aiDigits} digit${aiDigits === 1 ? "" : "s"} per batch` : "Automation is " + (aiEnabled ? "on" : "off")}</small></span>
              </button>
            ) : (
              <button type="button" className="ma-stop-button" onClick={onStopMatches}
                data-testid="button-matches-stop">
                <Square size={15} fill="currentColor" /><span><b>Stop Matches</b><small>Stop new automated entries</small></span>
              </button>
            )}
          </div>
          {tradeSlotBlocked && <p className="ma-slot-warning" role="status" data-testid="status-matches-trade-slot">Trade slot is occupied. Wait for the active contract to clear before submitting another.</p>}
          {statusMessage && <p className="ma-status-message" role="status" aria-live="polite" data-testid="status-matches-message">{statusMessage}</p>}
          <p className="ma-risk-note" data-testid="text-matches-risk-note">Trading synthetic indices involves risk. Observed patterns and past tick frequency do not guarantee future outcomes.</p>
        </section>
      </div>
    </section>
  );
}
