import { Activity, BookOpen, Loader2, Play, Square } from "lucide-react";
import DerivHistory, { type DerivHistoryRow } from "./deriv-history";
import "./auto-trader-2-panel.css";

export interface AutoTrader2PanelProps {
  contractFamily: "differs" | "rise-fall" | "even-odd";
  onContractFamilyChange: (family: "differs" | "rise-fall" | "even-odd") => void;
  contractType: "DIGITDIFF" | "CALL" | "PUT" | "DIGITEVEN" | "DIGITODD";
  onContractTypeChange: (contractType: "DIGITDIFF" | "CALL" | "PUT" | "DIGITEVEN" | "DIGITODD") => void;
  barrier: number;
  onBarrierChange: (barrier: number) => void;
  stake: number;
  onStakeChange: (stake: number) => void;
  nextStake: number;
  duration: number;
  onDurationChange: (duration: number) => void;
  takeProfit: number;
  onTakeProfitChange: (amount: number) => void;
  lossLimit: number;
  onLossLimitChange: (amount: number) => void;
  stakeMode: "flat" | "multiply";
  onStakeModeChange: (mode: "flat" | "multiply") => void;
  multiplier: number;
  onMultiplierChange: (multiplier: number) => void;
  aiEnabled: boolean;
  onAiEnabledChange: (enabled: boolean) => void;
  aiStatus: "off" | "working" | "waiting" | "paused";
  running: boolean;
  stopping: boolean;
  connected: boolean;
  tradeUpdatesConnected: boolean;
  tradeSlotBlocked: boolean;
  sessionNeedsReview: boolean;
  isPlacingTrade: boolean;
  selectedMarket: string;
  selectedMarketLabel: string;
  marketOptions: { value: string; label: string }[];
  onMarketChange: (symbol: string) => void;
  autoSelect: boolean;
  onAutoSelectChange: (enabled: boolean) => void;
  aiDecision: string;
  observedSampleCount: number;
  currency: string;
  sessionPnl: number;
  sessionTradeCount: number;
  recentTrades: DerivHistoryRow[];
  sessionRows: DerivHistoryRow[];
  clearArmed: boolean;
  historyFading: boolean;
  clearingHistory: boolean;
  onStart: () => void;
  onStop: () => void;
  onClearHistory: () => void;
  onOpenGuide: () => void;
}

const familyOptions = [
  { value: "differs", label: "Differs", detail: "Last digit differs" },
  { value: "rise-fall", label: "Rise / Fall", detail: "Direction at expiry" },
  { value: "even-odd", label: "Even / Odd", detail: "Last digit parity" },
] as const;

function amount(value: number, currency: string) {
  return `${currency} ${value.toFixed(2)}`;
}

export default function AutoTrader2Panel({
  contractFamily,
  onContractFamilyChange,
  contractType,
  onContractTypeChange,
  barrier,
  onBarrierChange,
  stake,
  onStakeChange,
  nextStake,
  duration,
  onDurationChange,
  takeProfit,
  onTakeProfitChange,
  lossLimit,
  onLossLimitChange,
  stakeMode,
  onStakeModeChange,
  multiplier,
  onMultiplierChange,
  aiEnabled,
  onAiEnabledChange,
  aiStatus,
  running,
  stopping,
  connected,
  tradeUpdatesConnected,
  tradeSlotBlocked,
  sessionNeedsReview,
  isPlacingTrade,
  selectedMarket,
  selectedMarketLabel,
  marketOptions,
  onMarketChange,
  autoSelect,
  onAutoSelectChange,
  aiDecision,
  observedSampleCount,
  currency,
  sessionPnl,
  sessionTradeCount,
  recentTrades,
  sessionRows,
  clearArmed,
  historyFading,
  clearingHistory,
  onStart,
  onStop,
  onClearHistory,
  onOpenGuide,
}: AutoTrader2PanelProps) {
  const controlsLocked = running || stopping || isPlacingTrade || clearingHistory;
  const canStart = connected && tradeUpdatesConnected && !tradeSlotBlocked && !sessionNeedsReview && !controlsLocked && stake > 0;
  const aiLabel = !aiEnabled
    ? "OFF"
    : aiStatus === "waiting"
      ? "WAITING"
      : aiStatus === "paused"
        ? "PAUSED"
        : "WORKING";

  return (
    <section className="at2-panel" aria-label="Auto Trader 2.0 trading panel" data-testid="auto-trader-2-panel">
      <header className="at2-header">
        <div className="at2-heading">
          <span className="at2-mark"><Activity size={15} aria-hidden="true" /></span>
          <div>
            <span className="at2-eyebrow">DERIV · AUTOMATED TRADING</span>
            <h2>Auto Trader <span>2.0</span></h2>
          </div>
        </div>
        <span className={`at2-connection ${connected ? "is-connected" : ""}`} role="status">
          <i aria-hidden="true" />{connected ? "CONNECTED" : "OFFLINE"}
        </span>
        <button type="button" className="at2-guide-button" onClick={onOpenGuide} aria-label="Open Auto Trader 2.0 guide" data-testid="at2-open-guide">
          <BookOpen size={13} aria-hidden="true" /> Guide
        </button>
      </header>

      <div className="at2-market-context" aria-live="polite">
        <div className="at2-context-caption">CURRENT SELECTION</div>
        <div className="at2-context-main">
          <strong>{selectedMarketLabel || "No market selected"}</strong>
          <span>{selectedMarket || "—"}</span>
        </div>
        <div className="at2-context-meta">
          <span><b>{Math.max(0, observedSampleCount)}</b> observed samples</span>
          <span className="at2-context-divider" aria-hidden="true" />
          <span>{autoSelect ? "AUTO-SELECT ON" : "MANUAL MARKET"}</span>
        </div>
        <label className="at2-market-select">
          <span className="at2-context-caption">MANUAL MARKET</span>
          <select
            value={selectedMarket}
            onChange={(event) => onMarketChange(event.target.value)}
            disabled={autoSelect || controlsLocked}
            aria-label="Select market manually"
            data-testid="at2-market-select"
          >
            {marketOptions.map((market) => (
              <option value={market.value} key={market.value}>{market.label} · {market.value}</option>
            ))}
          </select>
        </label>
        {aiDecision && <p className="at2-decision">{aiDecision}</p>}
      </div>

      <div className="at2-strategy-block">
        <div className="at2-field-heading">
          <label className="at2-label" id="at2-contract-label">CONTRACT FAMILY</label>
          <span className="at2-field-note">Choose the contract to configure</span>
        </div>
        <div className="at2-family-options" role="group" aria-labelledby="at2-contract-label">
          {familyOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`at2-family-option ${contractFamily === option.value ? "selected" : ""}`}
              aria-pressed={contractFamily === option.value}
              onClick={() => onContractFamilyChange(option.value)}
              disabled={controlsLocked}
              data-testid={`at2-contract-${option.value}`}
            >
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
        <div className="at2-contract-detail">
          {contractFamily === "rise-fall" && (
            <div className="at2-direction-options" role="group" aria-label="Choose Rise or Fall">
              {(["CALL", "PUT"] as const).map((type) => (
                <button
                  type="button"
                  key={type}
                  className={contractType === type ? "selected" : ""}
                  aria-pressed={contractType === type}
                  onClick={() => onContractTypeChange(type)}
                  disabled={controlsLocked}
                  data-testid={`at2-contract-type-${type.toLowerCase()}`}
                >{type === "CALL" ? "Rise" : "Fall"}</button>
              ))}
            </div>
          )}
          {contractFamily === "even-odd" && (
            <div className="at2-direction-options" role="group" aria-label="Choose Even or Odd">
              {(["DIGITEVEN", "DIGITODD"] as const).map((type) => (
                <button
                  type="button"
                  key={type}
                  className={contractType === type ? "selected" : ""}
                  aria-pressed={contractType === type}
                  onClick={() => onContractTypeChange(type)}
                  disabled={controlsLocked}
                  data-testid={`at2-contract-type-${type.toLowerCase()}`}
                >{type === "DIGITEVEN" ? "Even" : "Odd"}</button>
              ))}
            </div>
          )}
          {contractFamily === "differs" && (
            <label className="at2-field at2-barrier-field">
              <span className="at2-label">DIFFERS DIGIT <i>· 0–9</i></span>
              <input
                type="number"
                min="0"
                max="9"
                step="1"
                value={barrier}
                onChange={(event) => onBarrierChange(Math.min(9, Math.max(0, Math.floor(Number(event.target.value) || 0))))}
                disabled={controlsLocked}
                aria-label="Differs barrier digit from zero to nine"
                data-testid="at2-barrier"
              />
            </label>
          )}
        </div>
      </div>

      <div className="at2-controls-grid">
        <label className="at2-field">
          <span className="at2-label">STAKE <i>· {currency}</i></span>
          <input
            type="number"
            min="0.35"
            step="0.01"
            value={stake}
            onChange={(event) => onStakeChange(Math.max(0, Number(event.target.value) || 0))}
            disabled={controlsLocked}
            aria-label={`Stake in ${currency}`}
            data-testid="at2-stake"
          />
        </label>
        <label className="at2-field">
          <span className="at2-label">DURATION <i>· TICKS</i></span>
          <input
            type="number"
            min="1"
            max="5"
            step="1"
            value={duration}
            onChange={(event) => onDurationChange(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
            disabled={controlsLocked}
            aria-label="Contract duration in ticks"
            data-testid="at2-duration"
          />
        </label>
        <label className="at2-field">
          <span className="at2-label">TAKE PROFIT <i>· {currency}</i></span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={takeProfit}
            onChange={(event) => onTakeProfitChange(Math.max(0, Number(event.target.value) || 0))}
            disabled={controlsLocked}
            aria-label={`Session take-profit limit in ${currency}`}
            data-testid="at2-take-profit"
          />
        </label>
        <label className="at2-field">
          <span className="at2-label">LOSS LIMIT <i>· {currency}</i></span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={lossLimit}
            onChange={(event) => onLossLimitChange(Math.max(0, Number(event.target.value) || 0))}
            disabled={controlsLocked}
            aria-label={`Session loss limit in ${currency}`}
            data-testid="at2-loss-limit"
          />
        </label>
      </div>

      <section className="at2-stake-plan" aria-label="Stake progression">
        <div className="at2-field-heading">
          <span className="at2-label">STAKE PLAN</span>
          <span className="at2-field-note">Next entry · {amount(nextStake, currency)}</span>
        </div>
        <div className="at2-mode-switch" role="group" aria-label="Stake mode">
          <button type="button" className={stakeMode === "flat" ? "active" : ""} onClick={() => onStakeModeChange("flat")} aria-pressed={stakeMode === "flat"} disabled={controlsLocked} data-testid="at2-mode-flat">Flat</button>
          <button type="button" className={stakeMode === "multiply" ? "active" : ""} onClick={() => onStakeModeChange("multiply")} aria-pressed={stakeMode === "multiply"} disabled={controlsLocked} data-testid="at2-mode-multiply">Multiply after loss</button>
        </div>
        {stakeMode === "multiply" && (
          <label className="at2-field at2-multiplier-field">
            <span className="at2-label">LOSS MULTIPLIER</span>
            <input
              type="number"
              min="1"
              max="10"
              step="any"
              value={multiplier}
              onChange={(event) => onMultiplierChange(Math.max(0.01, Number(event.target.value) || 0.01))}
              disabled={controlsLocked}
              aria-label="Stake multiplier after a loss"
              data-testid="at2-multiplier"
            />
            <small>Multiplier applies after a loss. Exposure can rise quickly; a win does not guarantee recovery.</small>
          </label>
        )}
      </section>

      <section className="at2-assist-block" aria-label="Market selection and AI 2 options">
        <label className={`at2-check-row ${autoSelect ? "checked" : ""}`}>
          <input
            type="checkbox"
            checked={autoSelect}
            onChange={(event) => onAutoSelectChange(event.target.checked)}
            disabled={!connected || controlsLocked}
            aria-label="Automatically select a market"
            data-testid="at2-auto-select"
          />
          <span className="at2-checkmark" aria-hidden="true" />
          <span className="at2-check-copy"><strong>Auto-select market</strong><small>With AI 2, picks the strongest eligible market for your selected family.</small></span>
          <b className="at2-status-tag">{autoSelect ? "ON" : "OFF"}</b>
        </label>
        <label className={`at2-check-row at2-ai-row ${aiEnabled ? "checked" : ""}`}>
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(event) => onAiEnabledChange(event.target.checked)}
            disabled={!connected || controlsLocked}
            aria-label="Enable AI 2 observed-data filtering"
            data-testid="at2-ai-enabled"
          />
          <span className="at2-checkmark" aria-hidden="true" />
          <span className="at2-check-copy"><strong>AI 2 <small>OBSERVED-DATA FILTER</small></strong><small>Uses stronger evidence, switches to the paired opposite after a loss, and pauses repeated losers.</small></span>
          <b className={`at2-status-tag ${aiEnabled && aiLabel === "WORKING" ? "working" : ""}`} data-testid="at2-ai-status">{aiLabel}</b>
        </label>
        <p className="at2-truth-note">AI 2 does not predict contract outcomes or guarantee results. Observed samples are historical context, not a promise of future performance.</p>
      </section>

      <div className="at2-action-zone">
        {running || stopping ? (
          <button type="button" className="at2-action-button stop" onClick={onStop} disabled={stopping} data-testid="at2-stop">
            {stopping ? <Loader2 size={15} className="at2-spin" aria-hidden="true" /> : <Square size={13} fill="currentColor" aria-hidden="true" />}
            {stopping ? "STOPPING…" : "STOP AUTO TRADER 2.0"}
          </button>
        ) : (
          <button type="button" className="at2-action-button start" onClick={onStart} disabled={!canStart} data-testid="at2-start">
            {isPlacingTrade ? <Loader2 size={15} className="at2-spin" aria-hidden="true" /> : <Play size={14} fill="currentColor" aria-hidden="true" />}
            {isPlacingTrade ? "PLACING…" : "START AUTO TRADER 2.0"}
          </button>
        )}
        {!connected && <p className="at2-action-note" role="status">Connect to Deriv before starting this trading mode.</p>}
        {connected && !tradeUpdatesConnected && <p className="at2-action-note" role="status">Live trade updates are reconnecting. Wait before starting Auto Trader 2.0.</p>}
        {tradeSlotBlocked && <p className="at2-action-note" role="status">New entries are paused while an open contract is settling.</p>}
        {sessionNeedsReview && <p className="at2-action-note" role="status">Review the saved recovery session before starting or resuming automation.</p>}
        {connected && !tradeSlotBlocked && stake <= 0 && <p className="at2-action-note" role="status">Enter a stake greater than zero to start.</p>}
      </div>

      <div className="at2-history">
        <DerivHistory
          title="Auto Trader 2.0 History"
          strategy="Auto Trader 2.0"
          rows={recentTrades}
          sessionRows={sessionRows}
          currency={currency}
          currentStake={nextStake}
          sessionPnl={sessionPnl}
          sessionTradeCount={sessionTradeCount}
          clearArmed={clearArmed}
          fading={historyFading || clearingHistory}
          onClear={onClearHistory}
        />
      </div>
    </section>
  );
}
