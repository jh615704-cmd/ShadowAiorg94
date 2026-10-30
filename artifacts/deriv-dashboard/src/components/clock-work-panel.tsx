import { Bot, Clock3, Pause, Play } from "lucide-react";
import {
  CLOCK_WORK_AUTO_BEST_MARKET_VALUE,
  CLOCK_WORK_AI_MIN_WIN_RATE_OPTIONS,
  type ClockWorkAutoBestMarket,
  type ClockWorkAiMinimumWinRate,
} from "../lib/clock-work-logic";
import "./clock-work-panel.css";

export interface ClockWorkPanelProps {
  enabled: boolean;
  symbol: string;
  markets: { value: string; label: string }[];
  onSymbolChange: (value: string) => void;
  autoBestMode: boolean;
  autoBestSelection: ClockWorkAutoBestMarket | null;
  stake: number;
  onStakeChange: (value: number) => void;
  lossMultiplier: number;
  onLossMultiplierChange: (value: number) => void;
  aiEnabled: boolean;
  onAiEnabledChange: (value: boolean) => void;
  minimumWinRate: ClockWorkAiMinimumWinRate;
  onMinimumWinRateChange: (value: ClockWorkAiMinimumWinRate) => void;
  takeProfit: number;
  onTakeProfitChange: (value: number) => void;
  lossLimit: number;
  onLossLimitChange: (value: number) => void;
  running: boolean;
  busy: boolean;
  disabled: boolean;
  aiStatus: string;
  statusMessage: string | null;
  currency: string;
  onStart: () => void;
  onStop: () => void;
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="cw-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        aria-label="Ai Clock"
        data-testid="switch-ai-clock"
      />
      <span className="cw-toggle-track" aria-hidden="true"><i /></span>
      <span className="cw-toggle-value">{checked ? "ON" : "OFF"}</span>
    </label>
  );
}

export default function ClockWorkPanel({
  enabled,
  symbol,
  markets,
  onSymbolChange,
  autoBestMode,
  autoBestSelection,
  stake,
  onStakeChange,
  lossMultiplier,
  onLossMultiplierChange,
  aiEnabled,
  onAiEnabledChange,
  minimumWinRate,
  onMinimumWinRateChange,
  takeProfit,
  onTakeProfitChange,
  lossLimit,
  onLossLimitChange,
  running,
  busy,
  disabled,
  aiStatus,
  statusMessage,
  currency,
  onStart,
  onStop,
}: ClockWorkPanelProps) {
  const startDisabled = disabled || busy || !aiEnabled;

  return (
    <section className={`cw-panel ${enabled ? "cw-live" : ""}`} data-testid="clock-work-panel">
      <header className="cw-header">
        <div className="cw-brand-mark"><Clock3 size={18} /></div>
        <div className="cw-heading">
          <span className="cw-kicker"><i /> LIVE MARKET WORKBENCH</span>
          <h2>Clock Work</h2>
          <p>One AI-selected Higher or Lower entry · 5-tick contracts</p>
        </div>
        <span className={`cw-live-chip ${enabled ? "is-live" : ""}`}><i />{enabled ? "LIVE" : "READY"}</span>
      </header>

      <div className="cw-content">
        <div className="cw-controls">
          <label className="cw-control" htmlFor="cw-market">
            <span>MARKET</span>
            <select
              id="cw-market"
              value={symbol}
              onChange={(event) => onSymbolChange(event.target.value)}
              disabled={disabled || running}
              data-testid="select-clock-market"
            >
              <option value={CLOCK_WORK_AUTO_BEST_MARKET_VALUE}>Auto best market</option>
              {markets.map((market) => <option key={market.value} value={market.value}>{market.label}</option>)}
            </select>
            {autoBestSelection?.symbol === symbol && (
              <aside className="cw-market-recommendation" data-testid="clock-work-auto-best-market">
                <span>AUTO BEST SELECTED</span>
                <strong>{markets.find((market) => market.value === symbol)?.label ?? symbol}</strong>
                <small>
                  {symbol} · {autoBestSelection.candidate.direction} {autoBestSelection.candidate.barrier}
                  {" · "}{autoBestSelection.candidate.sampleCount} five-tick samples
                </small>
              </aside>
            )}
            {autoBestMode && !autoBestSelection && (
              <aside className="cw-market-recommendation is-pending" data-testid="clock-work-auto-best-pending">
                <span>NO AUTO BEST MARKET YET</span>
                <small>No market currently meets the {minimumWinRate}% threshold with 15 fresh five-tick samples.</small>
              </aside>
            )}
          </label>

          <div className="cw-duration" data-testid="clock-work-fixed-duration">
            <span>TRADE DURATION</span>
            <strong>5 ticks</strong>
            <small>Every Clock Work contract uses five ticks.</small>
          </div>

          <label className="cw-stake" htmlFor="cw-stake">
            <span>STAKE PER ENTRY</span>
            <span className="cw-stake-input">
              <i>{currency}</i>
              <input
                id="cw-stake"
                type="number"
                min="1"
                step="0.01"
                value={stake}
                onChange={(event) => onStakeChange(Math.max(1, Number(event.target.value) || 1))}
                disabled={disabled || running || busy}
                data-testid="input-clock-stake"
              />
            </span>
          </label>

          <label className="cw-stake cw-loss-multiplier" htmlFor="cw-loss-multiplier">
            <span>MULTIPLIER AFTER LOSS</span>
            <span className="cw-stake-input">
              <i>×</i>
              <input
                id="cw-loss-multiplier"
                type="number"
                min="1"
                step="any"
                value={lossMultiplier}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  onLossMultiplierChange(Number.isFinite(value) ? Math.max(1, value) : 1);
                }}
                disabled={disabled || running || busy}
                aria-label="Clock Work multiplier after a loss"
                title="A settled loss multiplies the next stake; a win resets it to the base stake."
                data-testid="input-clock-loss-multiplier"
              />
            </span>
          </label>
        </div>

        <section className="cw-risk-card" aria-label="Clock Work profit and loss limits">
          <div className="cw-risk-heading">
            <span>SESSION PROFIT &amp; LOSS</span>
            <small>0 disables a limit</small>
          </div>
          <div className="cw-risk-inputs">
            <label>
              <span>TAKE PROFIT · {currency}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={takeProfit}
                onChange={(event) => {
                  const amount = Number(event.target.value);
                  onTakeProfitChange(Number.isFinite(amount) ? Math.max(0, amount) : 0);
                }}
                disabled={running || busy}
                aria-label={`Clock Work take-profit limit in ${currency}`}
                data-testid="input-clock-take-profit"
              />
            </label>
            <label>
              <span>LOSS LIMIT · {currency}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={lossLimit}
                onChange={(event) => {
                  const amount = Number(event.target.value);
                  onLossLimitChange(Number.isFinite(amount) ? Math.max(0, amount) : 0);
                }}
                disabled={running || busy}
                aria-label={`Clock Work session loss limit in ${currency}`}
                data-testid="input-clock-loss-limit"
              />
            </label>
          </div>
        </section>

        <section className={`cw-ai-card ${aiEnabled ? "is-enabled" : ""}`}>
          <div className="cw-ai-heading">
            <div className="cw-ai-title">
              <span className="cw-ai-icon"><Bot size={18} /></span>
              <span><b>Ai Clock</b><small>Chooses the direction and barrier</small></span>
            </div>
            <Toggle checked={aiEnabled} onChange={onAiEnabledChange} disabled={disabled && !aiEnabled} />
          </div>
          <label className="cw-ai-threshold" htmlFor="cw-ai-minimum-rate">
            <span>MINIMUM WIN RATE</span>
            <select
              id="cw-ai-minimum-rate"
              value={minimumWinRate}
              onChange={(event) => onMinimumWinRateChange(Number(event.target.value) as ClockWorkAiMinimumWinRate)}
              aria-label="Ai Clock minimum win-rate threshold"
              data-testid="select-ai-clock-rate"
            >
              {CLOCK_WORK_AI_MIN_WIN_RATE_OPTIONS.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
            </select>
          </label>
          <div className={`cw-ai-status ${running ? "is-running" : ""}`} role="status" aria-live="polite" data-testid="clock-ai-status">
            <i aria-hidden="true" />
            <span>{statusMessage || aiStatus}</span>
          </div>
          <p className="cw-ai-note">
            Manual selection uses one completed five-tick sample. Auto Best needs at least 15 fresh five-tick samples to choose a market. One fresh quote confirms each new entry after a setup qualifies. Past results do not guarantee future outcomes.
          </p>
        </section>

        <button
          type="button"
          className={`cw-run-button ${running ? "is-running" : ""}`}
          onClick={running ? onStop : onStart}
          disabled={running ? false : startDisabled}
          data-testid={running ? "button-clock-stop" : "button-clock-start"}
        >
          {running
            ? <><Pause size={17} fill="currentColor" />STOP CLOCK WORK</>
            : <><Play size={17} fill="currentColor" />{busy ? "SENDING…" : "START CLOCK WORK"}</>}
        </button>
      </div>
    </section>
  );
}
