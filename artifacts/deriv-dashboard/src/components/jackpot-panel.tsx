import { Activity, BadgeHelp, CircleAlert, Layers3, ShieldCheck, Sparkles, Zap } from "lucide-react";
import DerivHistory, { type DerivHistoryRow } from "./deriv-history";
import "./jackpot-panel.css";

export type JackpotMarketGroup = "bear" | "bull" | "volatility" | "jump";
export type JackpotRiseFallSide = "CALL" | "PUT" | "AUTO";
export type JackpotEvenOddSide = "DIGITEVEN" | "DIGITODD" | "AUTO";
export type JackpotFeatureStatus = "ready" | "active" | "paused" | "error";

export interface JackpotMarketOption {
  value: string;
  label: string;
  group: JackpotMarketGroup;
}

export interface JackpotSignal {
  risePercentage: number | null;
  fallPercentage: number | null;
  evenPercentage: number | null;
  oddPercentage: number | null;
  sampleCount: number;
}

export interface JackpotPanelProps {
  isConnected: boolean;
  featureStatus: JackpotFeatureStatus;
  tradeSlotBlocked: boolean;
  marketGroup: JackpotMarketGroup;
  onMarketGroupChange: (group: JackpotMarketGroup) => void;
  symbol: string;
  autoBestMode: boolean;
  onSymbolChange: (symbol: string) => void;
  onAutoBestModeChange: (enabled: boolean) => void;
  markets: readonly JackpotMarketOption[];
  signal: JackpotSignal | null;
  riseFallSide: JackpotRiseFallSide;
  onRiseFallSideChange: (side: JackpotRiseFallSide) => void;
  riseFallEnabled: boolean;
  onRiseFallEnabledChange: (enabled: boolean) => void;
  evenOddSide: JackpotEvenOddSide;
  onEvenOddSideChange: (side: JackpotEvenOddSide) => void;
  evenOddEnabled: boolean;
  onEvenOddEnabledChange: (enabled: boolean) => void;
  stake: number;
  onStakeChange: (value: number) => void;
  contractCount: number;
  onContractCountChange: (value: number) => void;
  duration: number;
  onDurationChange: (value: number) => void;
  multiplyAfterLoss: boolean;
  onMultiplyAfterLossChange: (enabled: boolean) => void;
  multiplier: number;
  onMultiplierChange: (value: number) => void;
  takeProfit: number;
  onTakeProfitChange: (value: number) => void;
  lossLimit: number;
  onLossLimitChange: (value: number) => void;
  aiEnabled: boolean;
  onAiEnabledChange: (enabled: boolean) => void;
  aiStatus: string;
  batchStatus: string;
  batchLoading: boolean;
  canPlaceBatch: boolean;
  disabledReason?: string;
  onPlaceBatch: () => void;
  historyReviewRequired: boolean;
  historyCheckLoading: boolean;
  onRefreshOrderStatus: () => void;
  historyRows: readonly DerivHistoryRow[];
  currentRunRows: readonly DerivHistoryRow[];
  clearArmed?: boolean;
  historyFading?: boolean;
  onClearHistory: () => void;
  currency?: string;
}

const marketGroups: { value: JackpotMarketGroup; label: string; mark: string }[] = [
  { value: "bear", label: "Bear", mark: "BEAR" },
  { value: "bull", label: "Bull", mark: "BULL" },
  { value: "volatility", label: "Volatility", mark: "VOL" },
  { value: "jump", label: "Jump", mark: "JUMP" },
];
const contractCounts = Array.from({ length: 20 }, (_, index) => index + 1);
const durations = [1, 2, 3, 4, 5] as const;
const percent = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(1)}%`;

export default function JackpotPanel({
  isConnected,
  featureStatus,
  tradeSlotBlocked,
  marketGroup,
  onMarketGroupChange,
  symbol,
  autoBestMode,
  onSymbolChange,
  onAutoBestModeChange,
  markets,
  signal,
  riseFallSide,
  onRiseFallSideChange,
  riseFallEnabled,
  onRiseFallEnabledChange,
  evenOddSide,
  onEvenOddSideChange,
  evenOddEnabled,
  onEvenOddEnabledChange,
  stake,
  onStakeChange,
  contractCount,
  onContractCountChange,
  duration,
  onDurationChange,
  multiplyAfterLoss,
  onMultiplyAfterLossChange,
  multiplier,
  onMultiplierChange,
  takeProfit,
  onTakeProfitChange,
  lossLimit,
  onLossLimitChange,
  aiEnabled,
  onAiEnabledChange,
  aiStatus,
  batchStatus,
  batchLoading,
  canPlaceBatch,
  disabledReason,
  onPlaceBatch,
  historyReviewRequired,
  historyCheckLoading,
  onRefreshOrderStatus,
  historyRows,
  currentRunRows,
  clearArmed = false,
  historyFading = false,
  onClearHistory,
  currency = "USD",
}: JackpotPanelProps) {
  const groupMarkets = markets.filter((market) => market.group === marketGroup);
  const selectedMarket = markets.find((market) => market.value === symbol);
  const isBlocked = !isConnected || tradeSlotBlocked;
  const statusText = !isConnected
    ? "CONNECT DERIV"
    : tradeSlotBlocked
      ? "TRADE SLOT BLOCKED"
      : aiEnabled
        ? "AI ACTIVE"
        : featureStatus === "active"
          ? "BATCH ACTIVE"
        : featureStatus === "paused"
          ? "PAUSED"
          : featureStatus === "error"
            ? "NEEDS ATTENTION"
            : "READY";

  return (
    <section className="jackpot-panel" aria-label="Jackpot trading feature" data-testid="jackpot-panel">
      <header className="jackpot-header">
        <div className="jackpot-brand">
          <span className="jackpot-mark" aria-hidden="true"><Zap size={18} /></span>
          <div>
            <div className="jackpot-title-line">
              <h2>Jackpot</h2>
               <span className="jackpot-contract-tag">BULK CONTRACTS</span>
            </div>
             <p>Choose Rise/Fall, Even/Odd, or both for a batch.</p>
          </div>
        </div>
        <div className={`jackpot-status ${featureStatus}`} role="status" aria-live="polite" data-testid="status-jackpot-feature">
          <i aria-hidden="true" />{batchLoading ? "PREPARING BATCH" : statusText}
        </div>
      </header>

      <div className="jackpot-content">
        <section className="jackpot-signal-card" aria-label="Live market sample context">
          <div className="jackpot-signal-top">
            <span className="jackpot-eyebrow"><Activity size={13} /> MARKET READOUT</span>
            <span className={`jackpot-connection ${isConnected ? "connected" : ""}`}>
              <i aria-hidden="true" />{isConnected ? "LIVE FEED" : "OFFLINE"}
            </span>
          </div>
          <div className="jackpot-signal-market">
            <div>
              <small>SELECTED MARKET</small>
              <strong>{selectedMarket?.label ?? symbol ?? "Choose a market"}</strong>
              <span>{autoBestMode ? "AUTO BEST" : "MANUAL"}{symbol ? ` · ${symbol}` : ""}</span>
            </div>
            <div className="jackpot-sample-count">
              <b>{signal?.sampleCount ?? 0}</b>
              <small>OBSERVED SAMPLES</small>
            </div>
          </div>
          {!signal || signal.sampleCount === 0 ? (
            <div className={`jackpot-signal-empty ${!isConnected ? "offline" : ""}`} role="status">
              <span className="jackpot-empty-bars" aria-hidden="true"><i /><i /><i /><i /></span>
              <span>{!isConnected ? "Connect Deriv to receive market samples." : "Waiting for enough market samples to show observed rates."}</span>
            </div>
          ) : (
            <>
              <div className="jackpot-rate-grid">
                <div className="jackpot-rate-item rise"><small>RISE</small><b>{percent(signal.risePercentage)}</b></div>
                <div className="jackpot-rate-item fall"><small>FALL</small><b>{percent(signal.fallPercentage)}</b></div>
                <div className="jackpot-rate-item even"><small>EVEN</small><b>{percent(signal.evenPercentage)}</b></div>
                <div className="jackpot-rate-item odd"><small>ODD</small><b>{percent(signal.oddPercentage)}</b></div>
              </div>
            </>
          )}
        </section>

        <aside className="jackpot-guide" aria-label="Jackpot feature guide">
          <div className="jackpot-guide-icon"><BadgeHelp size={17} /></div>
          <div>
            <span className="jackpot-eyebrow">QUICK GUIDE</span>
            <h3>Choose your contract sides.</h3>
            <p>Enable either or both side families. Set 1–20 total contracts, then choose duration and stake.</p>
            <div className="jackpot-guide-rule"><ShieldCheck size={13} /><span>Use session limits to define your stop points.</span></div>
          </div>
        </aside>

        <div className="jackpot-settings">
          <section className="jackpot-card jackpot-market-card">
            <div className="jackpot-card-heading">
              <div><span className="jackpot-eyebrow">01 / MARKET</span><h3>Choose the market family</h3></div>
              <span className="jackpot-market-count">{groupMarkets.length} available</span>
            </div>
            <div className="jackpot-group-grid" role="group" aria-label="Market group">
              {marketGroups.map((group) => (
                <button type="button" key={group.value} className={marketGroup === group.value ? "selected" : ""} onClick={() => onMarketGroupChange(group.value)} aria-pressed={marketGroup === group.value} data-testid={`button-jackpot-group-${group.value}`}>
                  <small>{group.mark}</small><b>{group.label}</b>
                </button>
              ))}
            </div>
            <label className="jackpot-field">
              <span>Market symbol</span>
              <select value={symbol} onChange={(event) => onSymbolChange(event.target.value)} disabled={!groupMarkets.length || autoBestMode} aria-label="Jackpot market symbol" data-testid="select-jackpot-symbol">
                {groupMarkets.length ? groupMarkets.map((market) => <option key={market.value} value={market.value}>{market.label} · {market.value}</option>) : <option value="">No markets in this group</option>}
              </select>
            </label>
            <label className="jackpot-switch-row">
              <span><b>Auto Best market</b><small>Use the currently selected best market.</small></span>
              <input type="checkbox" checked={autoBestMode} onChange={(event) => onAutoBestModeChange(event.target.checked)} aria-label="Enable Jackpot Auto Best market mode" data-testid="switch-jackpot-auto-best" />
              <i aria-hidden="true" />
            </label>
          </section>

          <section className="jackpot-card jackpot-contract-card">
            <div className="jackpot-card-heading">
              <div><span className="jackpot-eyebrow">02 / CONTRACT SIDES</span><h3>Choose each side</h3></div>
              <Layers3 size={17} aria-hidden="true" />
            </div>
            <div className="jackpot-side-control">
              <div className="jackpot-side-heading">
                <span className="jackpot-field-label">RISE / FALL</span>
                <label className="jackpot-inline-switch">
                  <span>{riseFallEnabled ? "On" : "Off"}</span>
                  <input type="checkbox" checked={riseFallEnabled} onChange={(event) => onRiseFallEnabledChange(event.target.checked)} aria-label="Enable Jackpot Rise/Fall contracts" data-testid="switch-jackpot-rise-fall" />
                  <i aria-hidden="true" />
                </label>
              </div>
              <div className="jackpot-segmented" role="group" aria-label="Rise or Fall contract side">
                {(["CALL", "PUT", "AUTO"] as const).map((side) => <button type="button" key={side} disabled={!riseFallEnabled} className={riseFallSide === side ? "selected" : ""} onClick={() => onRiseFallSideChange(side)} aria-pressed={riseFallSide === side} data-testid={`button-jackpot-direction-${side.toLowerCase()}`}>{side === "CALL" ? "Rise" : side === "PUT" ? "Fall" : "Auto"}</button>)}
              </div>
            </div>
            <div className="jackpot-side-control">
              <div className="jackpot-side-heading">
                <span className="jackpot-field-label">EVEN / ODD</span>
                <label className="jackpot-inline-switch">
                  <span>{evenOddEnabled ? "On" : "Off"}</span>
                  <input type="checkbox" checked={evenOddEnabled} onChange={(event) => onEvenOddEnabledChange(event.target.checked)} aria-label="Enable Jackpot Even/Odd contracts" data-testid="switch-jackpot-even-odd" />
                  <i aria-hidden="true" />
                </label>
              </div>
              <div className="jackpot-segmented" role="group" aria-label="Even or Odd contract side">
                {(["DIGITEVEN", "DIGITODD", "AUTO"] as const).map((side) => <button type="button" key={side} disabled={!evenOddEnabled} className={evenOddSide === side ? "selected" : ""} onClick={() => onEvenOddSideChange(side)} aria-pressed={evenOddSide === side} data-testid={`button-jackpot-parity-${side.toLowerCase()}`}>{side === "DIGITEVEN" ? "Even" : side === "DIGITODD" ? "Odd" : "Auto"}</button>)}
              </div>
            </div>
            <div className="jackpot-contract-note"><Sparkles size={14} /><span>With both families on, the total is split evenly; the stronger observed rate gets any extra contract.</span></div>
          </section>

          <section className="jackpot-card jackpot-batch-card">
            <div className="jackpot-card-heading">
              <div><span className="jackpot-eyebrow">03 / BATCH SETUP</span><h3>Build the run</h3></div>
              <span className="jackpot-pair-total"><b>{contractCount}</b> total contracts</span>
            </div>
            <label className="jackpot-field">
              <span>Stake per contract · {currency}</span>
              <input type="number" min="0.35" step="0.01" value={stake} onChange={(event) => onStakeChange(Number(event.target.value))} aria-label={`Jackpot stake per contract in ${currency}`} data-testid="input-jackpot-stake" />
            </label>
            <div className="jackpot-field-block">
              <span className="jackpot-field-label">Total contracts</span>
              <div className="jackpot-count-grid" role="group" aria-label="Number of Jackpot contracts">
                {contractCounts.map((count) => <button type="button" key={count} className={contractCount === count ? "selected" : ""} onClick={() => onContractCountChange(count)} aria-pressed={contractCount === count} aria-label={`${count} total contracts`} data-testid={`button-jackpot-count-${count}`}>{count}</button>)}
              </div>
              <small className="jackpot-helper">Choose 1–20 total orders. Place sends exactly this many together; Jackpot AI sends one batch of this size.</small>
            </div>
            <div className="jackpot-field-block">
              <span className="jackpot-field-label">Duration · ticks</span>
              <div className="jackpot-duration-grid" role="group" aria-label="Contract duration in ticks">
                {durations.map((ticks) => <button type="button" key={ticks} className={duration === ticks ? "selected" : ""} onClick={() => onDurationChange(ticks)} aria-pressed={duration === ticks} aria-label={`${ticks} ${ticks === 1 ? "tick" : "ticks"}`} data-testid={`button-jackpot-duration-${ticks}`}>{ticks}<small>{ticks === 1 ? "tick" : "ticks"}</small></button>)}
              </div>
            </div>
            <label className="jackpot-switch-row jackpot-multiply">
              <span><b>Multiply after loss</b><small>Increase the next batch stake after a loss.</small></span>
              <input type="checkbox" checked={multiplyAfterLoss} onChange={(event) => onMultiplyAfterLossChange(event.target.checked)} aria-label="Multiply Jackpot stake after a loss" data-testid="switch-jackpot-multiply" />
              <i aria-hidden="true" />
            </label>
            {multiplyAfterLoss && <label className="jackpot-field jackpot-multiplier-field"><span>Loss multiplier</span><span className="jackpot-number-suffix"><b>×</b><input type="number" min="1" step="0.1" value={multiplier} onChange={(event) => onMultiplierChange(Number(event.target.value))} aria-label="Jackpot multiplier after a loss" data-testid="input-jackpot-multiplier" /></span></label>}
          </section>

          <section className="jackpot-card jackpot-limits-card">
            <div className="jackpot-card-heading"><div><span className="jackpot-eyebrow">04 / SESSION GUARD</span><h3>Set your limits</h3></div><ShieldCheck size={17} aria-hidden="true" /></div>
            <div className="jackpot-limit-grid">
              <label className="jackpot-field"><span>Take profit · {currency}</span><input type="number" min="0" step="0.01" value={takeProfit} onChange={(event) => onTakeProfitChange(Number(event.target.value))} aria-label={`Jackpot session take-profit limit in ${currency}`} data-testid="input-jackpot-take-profit" /></label>
              <label className="jackpot-field"><span>Loss limit · {currency}</span><input type="number" min="0" step="0.01" value={lossLimit} onChange={(event) => onLossLimitChange(Number(event.target.value))} aria-label={`Jackpot session loss limit in ${currency}`} data-testid="input-jackpot-loss-limit" /></label>
            </div>
            <label className="jackpot-switch-row jackpot-ai-switch">
              <span><b>Jackpot AI</b><small>Scan for 5 seconds; choose enabled sides above a 55% observed rate with at least 20 samples. It switches off after one batch.</small></span>
              <input type="checkbox" checked={aiEnabled} onChange={(event) => onAiEnabledChange(event.target.checked)} aria-label="Enable Jackpot AI" data-testid="switch-jackpot-ai" />
              <i aria-hidden="true" />
            </label>
            <p className="jackpot-ai-status" role="status" aria-live="polite" data-testid="status-jackpot-ai">{aiStatus}</p>
            <small className="jackpot-helper">Jackpot AI retries temporary no-signal waits, then switches off after one acknowledged batch. Enable it again to scan another.</small>
          </section>
        </div>

        <section className={`jackpot-batch-state ${isBlocked ? "blocked" : ""}`} role="status" aria-live="polite" data-testid="status-jackpot-batch">
          <span className="jackpot-batch-icon">{isBlocked ? <CircleAlert size={16} /> : <Activity size={16} />}</span>
          <span className="jackpot-batch-copy"><b>{batchLoading ? "Preparing your batch" : !isConnected ? "Connect Deriv" : tradeSlotBlocked ? "Waiting for settlement confirmation" : featureStatus === "paused" ? "Jackpot is paused" : featureStatus === "error" ? "Jackpot needs attention" : batchStatus || "Batch standing by"}</b><small>{!isConnected ? "Connect Deriv before this feature can run." : tradeSlotBlocked ? "New batches unlock automatically when all open account contracts settle." : batchLoading ? "Batch status will update when preparation is complete." : "Select enabled sides, then place a batch."}</small></span>
           <span className="jackpot-batch-count">{contractCount} orders</span>
        </section>
        <div className="jackpot-place-row">
          <div className="jackpot-place-copy" aria-live="polite">
            {disabledReason && <span role="status">{disabledReason}</span>}
          </div>
          <button
            type="button"
            className="jackpot-place-button"
            onClick={onPlaceBatch}
            disabled={batchLoading || !canPlaceBatch}
             aria-label={`Place ${contractCount} Jackpot contracts`}
            aria-busy={batchLoading}
            data-testid="button-jackpot-place-batch"
          >
            <Zap size={16} aria-hidden="true" />
             Place {contractCount} contracts
          </button>
        </div>
        {historyReviewRequired && (
          <div className="jackpot-history-review" role="status">
            <span>Deriv is confirming the last Jackpot order. New batches stay paused until account status is refreshed.</span>
            <button
              type="button"
              onClick={onRefreshOrderStatus}
              disabled={historyCheckLoading}
              data-testid="button-jackpot-refresh-order-status"
            >
              {historyCheckLoading ? "Refreshing status…" : "Refresh order status"}
            </button>
          </div>
        )}
      </div>

      <div className="jackpot-history">
        <DerivHistory
          title="Jackpot History"
          strategy="Jackpot Bulk"
          rows={historyRows}
          sessionRows={currentRunRows}
          currency={currency}
          clearArmed={clearArmed}
          fading={historyFading}
          onClear={onClearHistory}
          sessionTradeCount={currentRunRows.length}
        />
      </div>
    </section>
  );
}
