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
  evenOddSide: JackpotEvenOddSide;
  onEvenOddSideChange: (side: JackpotEvenOddSide) => void;
  stake: number;
  onStakeChange: (value: number) => void;
  pairCount: number;
  onPairCountChange: (value: number) => void;
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
  batchStatus: string;
  batchLoading: boolean;
  canPlaceBatch: boolean;
  disabledReason?: string;
  onPlaceBatch: () => void;
  historyReviewRequired: boolean;
  onConfirmHistoryReviewed: () => void;
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
const pairCounts = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
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
  evenOddSide,
  onEvenOddSideChange,
  stake,
  onStakeChange,
  pairCount,
  onPairCountChange,
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
  batchStatus,
  batchLoading,
  canPlaceBatch,
  disabledReason,
  onPlaceBatch,
  historyReviewRequired,
  onConfirmHistoryReviewed,
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
              <span className="jackpot-contract-tag">DUAL PAIR</span>
            </div>
            <p>One Rise/Fall contract paired with one Even/Odd contract.</p>
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
              <div className="jackpot-pair-rate-grid" aria-label="Observed rates for each possible dual pair">
                {[
                  ["Rise + Even", signal.risePercentage, signal.evenPercentage],
                  ["Rise + Odd", signal.risePercentage, signal.oddPercentage],
                  ["Fall + Even", signal.fallPercentage, signal.evenPercentage],
                  ["Fall + Odd", signal.fallPercentage, signal.oddPercentage],
                ].map(([label, directionRate, parityRate]) => (
                  <div className="jackpot-pair-rate" key={label}>
                    <b>{label}</b>
                    <span>{percent(directionRate as number | null)} <i>·</i> {percent(parityRate as number | null)}</span>
                  </div>
                ))}
              </div>
              <small className="jackpot-pair-rate-note">Each pair shows its two observed side rates, not a combined win probability.</small>
            </>
          )}
          <p className="jackpot-disclaimer">Percentages describe observed sample context only; they do not predict or guarantee outcomes.</p>
        </section>

        <aside className="jackpot-guide" aria-label="Jackpot feature guide">
          <div className="jackpot-guide-icon"><BadgeHelp size={17} /></div>
          <div>
            <span className="jackpot-eyebrow">QUICK GUIDE</span>
            <h3>Two contracts. One pair.</h3>
            <p>Each selected pair contains one Rise/Fall contract and one Even/Odd contract. Set 1–9 complete pairs, then choose duration and stake.</p>
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
              <span className="jackpot-field-label">RISE / FALL</span>
              <div className="jackpot-segmented" role="group" aria-label="Rise or Fall contract side">
                {(["CALL", "PUT", "AUTO"] as const).map((side) => <button type="button" key={side} className={riseFallSide === side ? "selected" : ""} onClick={() => onRiseFallSideChange(side)} aria-pressed={riseFallSide === side} data-testid={`button-jackpot-direction-${side.toLowerCase()}`}>{side === "CALL" ? "Rise" : side === "PUT" ? "Fall" : "Auto"}</button>)}
              </div>
            </div>
            <div className="jackpot-side-control">
              <span className="jackpot-field-label">EVEN / ODD</span>
              <div className="jackpot-segmented" role="group" aria-label="Even or Odd contract side">
                {(["DIGITEVEN", "DIGITODD", "AUTO"] as const).map((side) => <button type="button" key={side} className={evenOddSide === side ? "selected" : ""} onClick={() => onEvenOddSideChange(side)} aria-pressed={evenOddSide === side} data-testid={`button-jackpot-parity-${side.toLowerCase()}`}>{side === "DIGITEVEN" ? "Even" : side === "DIGITODD" ? "Odd" : "Auto"}</button>)}
              </div>
            </div>
            <div className="jackpot-contract-note"><Sparkles size={14} /><span>Auto leaves side selection to the feature configuration.</span></div>
          </section>

          <section className="jackpot-card jackpot-batch-card">
            <div className="jackpot-card-heading">
              <div><span className="jackpot-eyebrow">03 / BATCH SETUP</span><h3>Build the run</h3></div>
              <span className="jackpot-pair-total"><b>{pairCount}</b> pairs <i>·</i> {pairCount * 2} contracts</span>
            </div>
            <label className="jackpot-field">
              <span>Stake per contract · {currency}</span>
              <input type="number" min="0.35" step="0.01" value={stake} onChange={(event) => onStakeChange(Number(event.target.value))} aria-label={`Jackpot stake per contract in ${currency}`} data-testid="input-jackpot-stake" />
            </label>
            <div className="jackpot-field-block">
              <span className="jackpot-field-label">Complete dual pairs</span>
              <div className="jackpot-count-grid" role="group" aria-label="Number of complete dual pairs">
                {pairCounts.map((count) => <button type="button" key={count} className={pairCount === count ? "selected" : ""} onClick={() => onPairCountChange(count)} aria-pressed={pairCount === count} aria-label={`${count} complete dual ${count === 1 ? "pair" : "pairs"}, ${count * 2} contracts`} data-testid={`button-jackpot-pairs-${count}`}>{count}</button>)}
              </div>
              <small className="jackpot-helper">A complete pair means two contracts: one Rise/Fall and one Even/Odd.</small>
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
            <p className="jackpot-limit-note"><CircleAlert size={13} />Limits are session thresholds, not a guarantee against losses.</p>
          </section>
        </div>

        <section className={`jackpot-batch-state ${isBlocked ? "blocked" : ""}`} role="status" aria-live="polite" data-testid="status-jackpot-batch">
          <span className="jackpot-batch-icon">{isBlocked ? <CircleAlert size={16} /> : <Activity size={16} />}</span>
          <span className="jackpot-batch-copy"><b>{batchLoading ? "Preparing your batch" : isBlocked ? "New batch unavailable" : batchStatus || "Batch standing by"}</b><small>{!isConnected ? "Connect Deriv before this feature can run." : tradeSlotBlocked ? "Wait for open contracts to settle before starting another batch." : batchLoading ? "Batch status will update when preparation is complete." : "Jackpot is configured here; execution remains controlled by the dashboard."}</small></span>
          <span className="jackpot-batch-count">{pairCount} × 2</span>
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
            aria-label={`Place ${pairCount} pairs`}
            aria-busy={batchLoading}
            data-testid="button-jackpot-place-batch"
          >
            <Zap size={16} aria-hidden="true" />
            Place {pairCount} pairs
          </button>
        </div>
        {historyReviewRequired && (
          <div className="jackpot-history-review" role="alert">
            <span>Order confirmation was unclear. Check Deriv account history before continuing.</span>
            <button type="button" onClick={onConfirmHistoryReviewed} data-testid="button-jackpot-history-reviewed">
              I checked Deriv history
            </button>
          </div>
        )}
      </div>

      <div className="jackpot-history">
        <DerivHistory
          title="Jackpot History"
          strategy="Jackpot Dual Pair"
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
