import { useState } from "react";
import {
  Activity,
  ChevronDown,
  Loader2,
  Play,
  Square,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { formatDerivQuote } from "../lib/format-deriv-quote";
import AiScannerAction from "./ai-scanner-action";
import DerivHistory, { type DerivHistoryRow } from "./deriv-history";
import "./cash-grab-panel.css";

export type CashGrabContractFamily = "rise-fall";
export type CashGrabDirection = "CALL" | "PUT";
export type CashGrabDuration = 1 | 2 | 3 | 4 | 5;
export type CashGrabAiStatus = "off" | "ready" | "watching" | "quiet" | "blocked";
export type CashGrabStakeMode = "flat" | "multiply";

export interface CashGrabSymbolOption {
  value: string;
  label: string;
}

export interface CashGrabMarketSignal {
  symbol: string;
  risePercentage: number;
  fallPercentage: number;
  sampleCount: number;
}

export type CashGrabTrade = DerivHistoryRow & { account_type: string };

export interface CashGrabStartConfig {
  contractFamily: "rise-fall";
  direction: CashGrabDirection;
  symbol: string;
  stake: number;
  duration: CashGrabDuration;
  stakeMode: CashGrabStakeMode;
  multiplier: number;
  takeProfit: number;
  lossLimit: number;
  autoSelectBest: boolean;
  autoSwitchSafestPair: boolean;
  autoDirection: boolean;
}

export interface CashGrabPanelProps {
  direction: CashGrabDirection;
  symbol: string;
  bestSymbol?: string | null;
  autoSelectBest: boolean;
  symbols: readonly CashGrabSymbolOption[];
  marketSignals: readonly CashGrabMarketSignal[];
  quote?: number | null;
  stake: number;
  duration: CashGrabDuration;
  stakeMode: CashGrabStakeMode;
  currency?: string;
  multiplier: number;
  takeProfit: number;
  lossLimit: number;
  sessionPnl: number;
  autoSwitchSafestPair: boolean;
  autoDirection: boolean;
  autoSwitchSafestPairStatus?: CashGrabAiStatus;
  autoSwitchSafestPairRecommendation?: {
    symbol: string;
    observedWinRate: number;
    sampleCount: number;
  } | null;
  running: boolean;
  starting?: boolean;
  scannerBusy?: boolean;
  stopping?: boolean;
  isConnected: boolean;
  tradeSlotBlocked: boolean;
  isPlacingTrade: boolean;
  recentTrades: readonly CashGrabTrade[];
  sessionRows: readonly CashGrabTrade[];
  clearArmed: boolean;
  historyFading: boolean;
  onDirectionChange: (direction: CashGrabDirection) => void;
  onSymbolChange: (symbol: string) => void;
  onAutoSelectBestChange: (enabled: boolean) => void;
  onAutoSwitchSafestPairChange: (enabled: boolean) => void;
  onAutoDirectionChange: (enabled: boolean) => void;
  onStakeChange: (stake: number) => void;
  onDurationChange: (duration: CashGrabDuration) => void;
  onStakeModeChange: (mode: CashGrabStakeMode) => void;
  onMultiplierChange: (multiplier: number) => void;
  onTakeProfitChange: (amount: number) => void;
  onLossLimitChange: (amount: number) => void;
  onAiScan: () => Promise<string>;
  onMoneyStart: (config: CashGrabStartConfig) => void;
  onMoneyStop: () => void;
  onClearHistory: () => void;
}

const minimumStake = 0.35;
const durations: readonly CashGrabDuration[] = [1, 2, 3, 4, 5];

const statusLabel = (status: CashGrabAiStatus = "off") => ({
  off: "OFF",
  ready: "READY",
  watching: "SCANNING",
  quiet: "WAITING",
  blocked: "PAUSED",
})[status];

export default function CashGrabPanel({
  direction,
  symbol,
  bestSymbol = null,
  autoSelectBest,
  symbols,
  marketSignals,
  quote = null,
  stake,
  duration,
  stakeMode,
  currency = "USD",
  multiplier,
  takeProfit,
  lossLimit,
  sessionPnl,
  autoSwitchSafestPair,
  autoDirection,
  autoSwitchSafestPairStatus = "off",
  autoSwitchSafestPairRecommendation = null,
  running,
  starting = false,
  scannerBusy = false,
  stopping = false,
  isConnected,
  tradeSlotBlocked,
  isPlacingTrade,
  recentTrades,
  sessionRows,
  clearArmed,
  historyFading,
  onDirectionChange,
  onSymbolChange,
  onAutoSelectBestChange,
  onAutoSwitchSafestPairChange,
  onAutoDirectionChange,
  onStakeChange,
  onDurationChange,
  onStakeModeChange,
  onMultiplierChange,
  onTakeProfitChange,
  onLossLimitChange,
  onAiScan,
  onMoneyStart,
  onMoneyStop,
  onClearHistory,
}: CashGrabPanelProps) {
  const [marketMenuOpen, setMarketMenuOpen] = useState(false);
  const interactionDisabled = running || starting || scannerBusy || isPlacingTrade;
  const canStart = isConnected && !starting && !scannerBusy && !tradeSlotBlocked && !isPlacingTrade && !stopping;
  const canRunScanner = isConnected && !running && !starting && !scannerBusy && !tradeSlotBlocked && !isPlacingTrade && !stopping && stake >= minimumStake;
  const selectedSymbol = symbols.find((item) => item.value === symbol);
  const selectedSignal = marketSignals.find((item) => item.symbol === symbol);
  const liveRate = selectedSignal
    ? direction === "CALL" ? selectedSignal.risePercentage : selectedSignal.fallPercentage
    : 0;
  const riseRate = selectedSignal?.risePercentage ?? 0;
  const fallRate = selectedSignal?.fallPercentage ?? 0;
  const rateTotal = riseRate + fallRate;
  const riseWidth = rateTotal > 0 ? riseRate / rateTotal * 100 : 50;
  const bestMarketLabel = symbols.find((item) => item.value === bestSymbol)?.label ?? bestSymbol;

  const submitStart = () => {
    if (!canStart) return;
    onMoneyStart({
      contractFamily: "rise-fall",
      direction,
      symbol,
      stake: Math.max(minimumStake, stake),
      duration,
      stakeMode,
      multiplier: Math.max(0.01, multiplier),
      takeProfit: Math.max(0, takeProfit),
      lossLimit: Math.max(0, lossLimit),
      autoSelectBest,
      autoSwitchSafestPair,
      autoDirection,
    });
  };

  const chooseSymbol = (nextSymbol: string) => {
    onAutoSelectBestChange(false);
    onSymbolChange(nextSymbol);
    setMarketMenuOpen(false);
  };

  return (
    <section className="df-panel cash-grab-df-panel" aria-label="Cash Grab Rise/Fall trading panel" data-testid="cash-grab-panel">
      <header className="df-card df-scanner">
        <div className="df-card-heading">
          <div className="df-title">
            <span className="df-spark"><Activity size={15} /></span>
            <b>Cash Grab · Rise/Fall</b>
            <span className="df-premium">CALL / PUT ONLY</span>
          </div>
          <span className="df-live"><i />{running ? "RUNNING" : isConnected ? "CONNECTED" : "OFFLINE"}</span>
        </div>
        <div className="df-rule" />
        <div className="df-best-signal">
          <div className={`df-best-parity ${direction === "CALL" ? "rise" : "fall"}`}>
            {direction === "CALL" ? "RISE" : "FALL"}
            <span>{direction === "CALL" ? "↗" : "↘"}</span>
          </div>
          <div className="df-best-copy">
            <span>Selected direction · {selectedSymbol?.value ?? symbol}</span>
            <p>
              Observed rate <strong>{liveRate.toFixed(1)}%</strong>
              <em>·</em>
              {selectedSignal?.sampleCount ?? 0} sampled moves
              {bestSymbol ? <><em>·</em>best pair <strong>{bestSymbol}</strong></> : null}
            </p>
          </div>
        </div>
      </header>

      <div className={`df-card df-toggle-card df-pair-card ${autoSwitchSafestPair ? "active" : ""}`}>
        <div className="df-toggle-copy">
          <span className="df-section-label">AUTO-SWITCH SAFEGUARD</span>
          {autoSwitchSafestPairRecommendation && (
            <p className="df-running-note">
              <i />
              {autoSwitchSafestPairRecommendation.symbol} · {autoSwitchSafestPairRecommendation.observedWinRate.toFixed(1)}% observed · {autoSwitchSafestPairRecommendation.sampleCount} sampled moves
            </p>
          )}
        </div>
        <label className="df-toggle-control">
          <span className="df-toggle-state">{statusLabel(autoSwitchSafestPairStatus)}</span>
          <span className="df-toggle">
            <input
              type="checkbox"
              checked={autoSwitchSafestPair}
              onChange={(event) => onAutoSwitchSafestPairChange(event.target.checked)}
              disabled={!isConnected || starting || scannerBusy || stopping}
              aria-label="Auto-switch Cash Grab to guarded Rise/Fall markets"
            />
            <i />
          </span>
        </label>
      </div>

      <div className={`df-card df-toggle-card df-direction-card ${autoDirection ? "active" : ""}`}>
        <div className="df-toggle-copy">
          <span className="df-section-label">AUTO DIRECTION</span>
        </div>
        <label className="df-toggle-control">
          <span className={`df-toggle-state${autoDirection ? " working" : ""}`}>{autoDirection ? "WORKING" : "OFF"}</span>
          <span className="df-toggle">
            <input
              type="checkbox"
              checked={autoDirection}
              onChange={(event) => onAutoDirectionChange(event.target.checked)}
              disabled={!isConnected || starting || scannerBusy || stopping}
              aria-label="Auto Direction for Cash Grab"
            />
            <i />
          </span>
        </label>
      </div>

      <section className={`df-card df-market-card ${marketMenuOpen ? "open" : ""}`}>
        <button
          type="button"
          className="df-market-trigger"
          onClick={() => setMarketMenuOpen((open) => !open)}
          disabled={!isConnected || interactionDisabled}
          aria-expanded={marketMenuOpen}
          aria-label="Select Cash Grab market"
        >
          <span className="df-market-icon">⌁</span>
          <span className="df-market-copy">
            <small>ACTIVE MARKET · {autoSelectBest ? "AUTO BEST" : "MANUAL"}</small>
            <b>{selectedSymbol?.label ?? symbol} · {symbol}</b>
          </span>
          <ChevronDown className="df-market-chevron" size={16} />
        </button>
        {marketMenuOpen && (
          <div className="df-market-menu" role="listbox" aria-label="Cash Grab markets">
            <button
              type="button"
              className={`df-market-option df-market-smart ${autoSelectBest ? "selected" : ""}`}
              onClick={() => { onAutoSelectBestChange(true); setMarketMenuOpen(false); }}
              disabled={!bestSymbol || autoSwitchSafestPair}
              aria-disabled={!bestSymbol || autoSwitchSafestPair}
            >
              <span><small>{autoSwitchSafestPair ? "AUTO-SWITCH ACTIVE" : "AUTO BEST"}</small><b>{bestMarketLabel ?? "Waiting for market samples"}</b></span>
              <strong>{autoSwitchSafestPair ? "ON" : bestSymbol ?? "—"}</strong>
            </button>
            {symbols.map((item) => {
              const signal = marketSignals.find((entry) => entry.symbol === item.value);
              const rate = direction === "CALL" ? signal?.risePercentage ?? 0 : signal?.fallPercentage ?? 0;
              return (
                <button
                  type="button"
                  key={item.value}
                  className={`df-market-option ${!autoSelectBest && symbol === item.value ? "selected" : ""}`}
                  onClick={() => chooseSymbol(item.value)}
                  role="option"
                  aria-selected={!autoSelectBest && symbol === item.value}
                >
                  <span><b>{item.label}</b><em>{item.value} · {signal?.sampleCount ?? 0} moves</em></span>
                  <strong>{rate.toFixed(1)}%</strong>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="df-card df-quote-card" aria-live="polite">
        <div className="df-quote-value">
          {quote == null ? "—" : formatDerivQuote(quote)}
          <small>{currency}</small>
        </div>
        <div className="df-quote-run">
          {isConnected ? `${selectedSymbol?.label ?? symbol} · live quote` : "Connect Deriv to receive a live quote"}
        </div>
      </section>

      <div className="df-card df-parity-toggle" role="group" aria-label="Choose Rise or Fall">
        <button
          type="button"
          className={`rise ${direction === "CALL" ? "selected" : ""}`}
          onClick={() => onDirectionChange("CALL")}
          disabled={interactionDisabled}
          aria-pressed={direction === "CALL"}
          data-testid="button-cash-grab-rise"
        >
          <TrendingUp size={16} /> Rise
        </button>
        <button
          type="button"
          className={`fall ${direction === "PUT" ? "selected" : ""}`}
          onClick={() => onDirectionChange("PUT")}
          disabled={interactionDisabled}
          aria-pressed={direction === "PUT"}
          data-testid="button-cash-grab-fall"
        >
          <TrendingDown size={16} /> Fall
        </button>
      </div>

      <section className="df-card df-parity-card">
        <span className="df-section-label">LIVE DIRECTION SAMPLE · {selectedSymbol?.value ?? symbol}</span>
        <div className="df-parity-track" aria-label={`Rise ${riseRate.toFixed(1)} percent, Fall ${fallRate.toFixed(1)} percent`}>
          <i className="rise" style={{ width: `${riseWidth}%` }} />
          <i className="fall" style={{ width: `${100 - riseWidth}%` }} />
        </div>
        <div className="df-parity-labels">
          <span>RISE <b>{riseRate.toFixed(1)}%</b></span>
          <span>FALL <b>{fallRate.toFixed(1)}%</b></span>
        </div>
      </section>

      <form className="df-card df-advanced-card" onSubmit={(event) => { event.preventDefault(); submitStart(); }}>
        <div className="df-advanced-head">
          <div><span className="df-section-label">RISE/FALL CONTRACT</span><h3>Trade setup</h3></div>
        </div>
        <div className="df-setup-grid">
          <label>
            <span>STAKE · MIN {minimumStake.toFixed(2)}</span>
            <input
              type="number"
              min={minimumStake}
              step="0.01"
              value={stake}
              onChange={(event) => onStakeChange(Math.max(minimumStake, Number(event.target.value) || minimumStake))}
              disabled={interactionDisabled}
              aria-label={`Cash Grab stake in ${currency}`}
              data-testid="input-cash-grab-stake"
            />
          </label>
          <label className="cash-grab-duration-field">
            <span>DURATION · TICKS</span>
            <div className="cash-grab-tick-options" role="group" aria-label="Cash Grab duration in ticks">
              {durations.map((ticks) => (
                <button
                  type="button"
                  key={ticks}
                  className={duration === ticks ? "active" : ""}
                  aria-pressed={duration === ticks}
                  onClick={() => onDurationChange(ticks)}
                  disabled={interactionDisabled}
                  data-testid={`cash-grab-duration-${ticks}`}
                >
                  {ticks}
                </button>
              ))}
            </div>
          </label>
          <label>
            <span>STAKE MODE</span>
            <select
              value={stakeMode}
              onChange={(event) => onStakeModeChange(event.target.value as CashGrabStakeMode)}
              disabled={interactionDisabled}
              aria-label="Cash Grab stake mode"
            >
              <option value="flat">Flat</option>
              <option value="multiply">Multiply after loss</option>
            </select>
          </label>
        </div>

        {stakeMode === "multiply" && (
          <label className="cash-grab-multiplier-field">
            <span>MULTIPLIER AFTER A LOSS</span>
            <input
              type="number"
              min="0.01"
              step="any"
              value={multiplier}
              onChange={(event) => onMultiplierChange(Math.max(0.01, Number(event.target.value) || 0.01))}
              disabled={interactionDisabled}
              aria-label="Cash Grab stake multiplier after a loss"
              data-testid="input-cash-grab-multiplier"
            />
            <small>Flat stake returns after a win. No maximum is set for the multiplier.</small>
          </label>
        )}

        <div className="cash-grab-limits" aria-label="Cash Grab session profit and loss limits">
          <label>
            <span>TAKE PROFIT · {currency}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={takeProfit}
              onChange={(event) => onTakeProfitChange(Math.max(0, Number(event.target.value) || 0))}
              disabled={interactionDisabled}
              aria-label={`Cash Grab take-profit threshold in ${currency}`}
              data-testid="input-cash-grab-take-profit"
            />
          </label>
          <label>
            <span>LOSS LIMIT · {currency}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={lossLimit}
              onChange={(event) => onLossLimitChange(Math.max(0, Number(event.target.value) || 0))}
              disabled={interactionDisabled}
              aria-label={`Cash Grab session loss limit in ${currency}`}
              data-testid="input-cash-grab-loss-limit"
            />
          </label>
          <output aria-live="polite">
            Settled session P/L: {sessionPnl > 0 ? "+" : ""}{sessionPnl.toFixed(2)} {currency}
          </output>
        </div>

        <div className="cash-grab-ai-scanner">
          <div><b>AI SCANNER</b></div>
          <AiScannerAction onScan={onAiScan} disabled={!canRunScanner} />
        </div>

        <div className="df-action-row">
          {running || stopping ? (
            <button type="button" className="df-stop" onClick={onMoneyStop} disabled={stopping} data-testid="button-cash-grab-stop">
              {stopping ? <Loader2 size={14} className="cash-grab-spin" /> : <Square size={13} fill="currentColor" />}
              {stopping ? "STOPPING…" : "STOP CASH GRAB"}
            </button>
          ) : (
            <button type="submit" className="df-run" disabled={!canStart} data-testid="button-cash-grab-start">
              {starting || isPlacingTrade ? <Loader2 size={14} className="cash-grab-spin" /> : <Play size={14} fill="currentColor" />}
              {starting ? "CHECKING…" : isPlacingTrade ? "PLACING…" : "START CASH GRAB"}
            </button>
          )}
        </div>
        {!isConnected && <p className="cash-grab-status-note">Connect Deriv to place a Rise/Fall contract.</p>}
        {tradeSlotBlocked && <p className="cash-grab-status-note" role="status">New entries stay paused until Deriv confirms that all open contracts have settled.</p>}
      </form>

      <div className="cash-grab-history df-card">
        <DerivHistory
          title="Cash Grab History"
          strategy="Cash Grab Rise/Fall"
          rows={recentTrades}
          sessionRows={sessionRows}
          currency={currency}
          sessionTradeCount={recentTrades.length}
          clearArmed={clearArmed}
          fading={historyFading}
          onClear={onClearHistory}
        />
      </div>
    </section>
  );
}