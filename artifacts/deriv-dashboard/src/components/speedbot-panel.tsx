import { Activity, Play, Square } from "lucide-react";
import DerivHistory from "./deriv-history";
import type { DerivHistoryRow } from "../lib/deriv-history";
import "./speedbot-panel.css";

export type SpeedbotMarketOption = {
  value: string;
  label: string;
};

type SpeedbotPanelProps = {
  symbol: string;
  symbols: readonly SpeedbotMarketOption[];
  duration: number;
  stake: number;
  takeProfit: number;
  lossLimit: number;
  currency: string;
  running: boolean;
  busy: boolean;
  waitingForSettlement: boolean;
  blocked: boolean;
  status: string;
  quote?: number | null;
  lastDigit?: number | null;
  onSymbolChange: (value: string) => void;
  onDurationChange: (value: number) => void;
  onStakeChange: (value: number) => void;
  onTakeProfitChange: (value: number) => void;
  onLossLimitChange: (value: number) => void;
  onRunStop: () => void;
  historyRows: readonly DerivHistoryRow[];
  sessionRows: readonly DerivHistoryRow[];
  clearArmed: boolean;
  historyFading: boolean;
  onClearHistory: () => void;
};

export default function SpeedbotPanel({
  symbol,
  symbols,
  duration,
  stake,
  takeProfit,
  lossLimit,
  currency,
  running,
  busy,
  waitingForSettlement,
  blocked,
  status,
  quote = null,
  lastDigit = null,
  onSymbolChange,
  onDurationChange,
  onStakeChange,
  onTakeProfitChange,
  onLossLimitChange,
  onRunStop,
  historyRows,
  sessionRows,
  clearArmed,
  historyFading,
  onClearHistory,
}: SpeedbotPanelProps) {
  const controlsDisabled = running || busy;

  return (
    <section className="speedbot-panel xt-bottom-feature" data-testid="speedbot-panel">
      <header className="speedbot-header">
        <div className="speedbot-title">
          <span className="speedbot-mark"><Activity size={18} /></span>
          <span><b>Speedbot</b><small>Single-contract Digit Differs automation</small></span>
        </div>
        <button
          type="button"
          className={`speedbot-run-button${running ? " is-running" : ""}`}
          data-feature-action={`speedbot/${running ? "stop" : "start"}`}
          onClick={onRunStop}
          disabled={busy || blocked}
          aria-label={running ? "Stop Speedbot" : "Start Speedbot"}
        >
          {running ? <Square size={15} /> : <Play size={15} />}
          {busy ? "Sending…" : running ? "Stop Speedbot" : "Start Speedbot"}
        </button>
      </header>

      <div className={`speedbot-status${waitingForSettlement ? " is-waiting" : ""}`} role="status" aria-live="polite">
        <span className="speedbot-status-dot" />
        <span>{status}</span>
      </div>

      <div className="speedbot-settings">
        <label>
          <span>Market</span>
          <select
            data-feature-action="speedbot/market"
            value={symbol}
            onChange={(event) => onSymbolChange(event.target.value)}
            disabled={controlsDisabled}
          >
            {symbols.map((market) => <option key={market.value} value={market.value}>{market.label}</option>)}
          </select>
        </label>
        <label>
          <span>Stake per trade</span>
          <input
            data-feature-action="speedbot/stake"
            type="number"
            min="0.35"
            step="0.01"
            value={stake}
            onChange={(event) => onStakeChange(Number(event.target.value))}
            disabled={controlsDisabled}
          />
        </label>
        <label>
          <span>Duration</span>
          <select
            data-feature-action="speedbot/duration"
            value={duration}
            onChange={(event) => onDurationChange(Number(event.target.value))}
            disabled={controlsDisabled}
          >
            {[1, 2, 3, 4, 5].map((ticks) => <option key={ticks} value={ticks}>{ticks} {ticks === 1 ? "tick" : "ticks"}</option>)}
          </select>
        </label>
        <label>
          <span>Take-profit limit</span>
          <input
            data-feature-action="speedbot/take-profit"
            type="number"
            min="0"
            step="0.01"
            value={takeProfit}
            onChange={(event) => onTakeProfitChange(Number(event.target.value))}
            disabled={controlsDisabled}
          />
        </label>
        <label>
          <span>Session loss limit</span>
          <input
            data-feature-action="speedbot/loss-limit"
            type="number"
            min="0"
            step="0.01"
            value={lossLimit}
            onChange={(event) => onLossLimitChange(Number(event.target.value))}
            disabled={controlsDisabled}
          />
        </label>
      </div>

      <div className="speedbot-live-readout">
        <span><small>LIVE QUOTE</small><b>{quote == null ? "—" : quote.toFixed(2)}</b></span>
        <span><small>LAST DIGIT</small><b>{lastDigit == null ? "—" : lastDigit}</b></span>
        <span><small>ORDER FLOW</small><b>One at a time</b></span>
        <span><small>CURRENCY</small><b>{currency}</b></span>
      </div>
      <p className="speedbot-disclaimer">Historical market samples are not a guarantee of future results. Stop prevents new entries; accepted contracts still settle through Deriv.</p>

      <DerivHistory
        className="speedbot-history"
        title="Speedbot History"
        strategy="Digit Differs"
        rows={historyRows}
        sessionRows={sessionRows}
        currency={currency}
        clearArmed={clearArmed}
        fading={historyFading}
        onClear={onClearHistory}
      />
    </section>
  );
}
