import { Bot, Clock3, Pause, Play } from "lucide-react";
import {
  CLOCK_WORK_AUTO_BEST_MARKET_VALUE,
  CLOCK_WORK_AI_MIN_WIN_RATE,
  CLOCK_WORK_AI_MIN_SAMPLE_COUNT,
  type ClockWorkAutoBestMarket,
} from "../lib/clock-work-logic";
import { getLossLimitRunwayMessage } from "../lib/loss-runway";
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
  takeProfit: number;
  onTakeProfitChange: (value: number) => void;
  lossLimit: number;
  onLossLimitChange: (value: number) => void;
  sessionPnl: number;
  running: boolean;
  busy: boolean;
  disabled: boolean;
  aiControlAvailable: boolean;
  tradeControlAvailable: boolean;
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
  takeProfit,
  onTakeProfitChange,
  lossLimit,
  onLossLimitChange,
  sessionPnl,
  running,
  busy,
  disabled,
  aiControlAvailable,
  tradeControlAvailable,
  aiStatus,
  statusMessage,
  currency,
  onStart,
  onStop,
}: ClockWorkPanelProps) {
  const startDisabled = disabled || busy || !tradeControlAvailable;

  return (
    <section className={`cw-panel ${enabled ? "cw-live" : ""}`} data-testid="clock-work-panel" data-feature-scope="clock-work">
      <header className="cw-header">
        <div className="cw-brand-mark"><Clock3 size={18} /></div>
        <div className="cw-heading">
          <span className="cw-kicker"><i /> LIVE MARKET WORKBENCH</span>
          <h2>Clock Work</h2>
          <p>Higher or Lower contracts · 5 ticks</p>
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
                <small>No eligible market is ready yet.</small>
              </aside>
            )}
          </label>

          <div className="cw-duration" data-testid="clock-work-fixed-duration">
            <span>TRADE DURATION</span>
            <strong>5 ticks</strong>
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
          <p className="cw-risk-note" role="note" data-testid="clock-work-loss-warning">
            {getLossLimitRunwayMessage({
              balance: null,
              baseStake: stake,
              nextStake: stake,
              stakeMode: "multiply",
              multiplier: lossMultiplier,
              takeProfit,
              lossLimit,
              sessionPnl,
            }, currency)}
          </p>
        </section>

        <section className={`cw-ai-card ${aiEnabled ? "is-enabled" : ""}`}>
          <div className="cw-ai-heading" data-feature-action="clock-work/ai-clock">
            <div className="cw-ai-title">
              <span className="cw-ai-icon"><Bot size={18} /></span>
              <span><b>Ai Clock</b></span>
            </div>
            <Toggle checked={aiEnabled} onChange={onAiEnabledChange} disabled={!aiEnabled && (!aiControlAvailable || disabled)} />
          </div>
          <div className="cw-ai-rate-rule" data-testid="clock-work-ai-rate-rule">
            <span>FIXED ENTRY FILTER</span>
            <strong>At least {CLOCK_WORK_AI_MIN_WIN_RATE}% observed · {CLOCK_WORK_AI_MIN_SAMPLE_COUNT} complete samples</strong>
          </div>
          <div className={`cw-ai-status ${running ? "is-running" : ""}`} role="status" aria-live="polite" data-testid="clock-ai-status">
            <i aria-hidden="true" />
            <span>{statusMessage || aiStatus}</span>
          </div>
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
