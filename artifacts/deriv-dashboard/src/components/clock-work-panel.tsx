import { Bot, Clock3, Pause, Play } from "lucide-react";
import "./clock-work-panel.css";

export interface ClockWorkPanelProps {
  enabled: boolean;
  symbol: string;
  markets: { value: string; label: string }[];
  onSymbolChange: (value: string) => void;
  stake: number;
  onStakeChange: (value: number) => void;
  aiEnabled: boolean;
  onAiEnabledChange: (value: boolean) => void;
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
  stake,
  onStakeChange,
  aiEnabled,
  onAiEnabledChange,
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
          <p>One AI-selected Higher or Lower entry</p>
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
              {markets.map((market) => <option key={market.value} value={market.value}>{market.label}</option>)}
            </select>
          </label>

          <div className="cw-duration" aria-label="Contract duration">
            <span>DURATION</span>
            <strong>5 Ticks</strong>
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
        </div>

        <section className={`cw-ai-card ${aiEnabled ? "is-enabled" : ""}`}>
          <div className="cw-ai-heading">
            <div className="cw-ai-title">
              <span className="cw-ai-icon"><Bot size={18} /></span>
              <span><b>Ai Clock</b><small>Chooses the direction and barrier</small></span>
            </div>
            <Toggle checked={aiEnabled} onChange={onAiEnabledChange} disabled={disabled && !aiEnabled} />
          </div>
          <div className={`cw-ai-status ${running ? "is-running" : ""}`} role="status" aria-live="polite" data-testid="clock-ai-status">
            <i aria-hidden="true" />
            <span>{statusMessage || aiStatus}</span>
          </div>
          <p className="cw-ai-note">Ai Clock checks recent price outcomes and waits when no setup qualifies. Past results do not guarantee future outcomes.</p>
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
