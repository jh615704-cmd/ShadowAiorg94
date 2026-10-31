import { useState } from "react";
import { Activity, ChevronDown, Download, Play, RefreshCw, ShieldCheck, Square, TrendingUp } from "lucide-react";
import type { MoneyBankKnockoutScannerResponse } from "@workspace/api-client-react";
import {
  calculateRecoveryLadder,
  estimateAccumulatorReturnRate,
  type MoneyBankLadderLevel,
  type MoneyBankStrategy,
} from "../lib/money-bank-math";
import { MoneyBankMarketChart } from "./money-bank-market-chart";
import DerivHistory, { type DerivHistoryRow } from "./deriv-history";
import "./money-bank-panel.css";

export { calculateRecoveryLadder };
export type { MoneyBankLadderLevel, MoneyBankStrategy } from "../lib/money-bank-math";

export type MoneyBankStartConfig = {
  symbol: string;
  growthRate: number;
  takeProfitTicks: number;
  autoKnockout: boolean;
  knockoutsBeforeTrade: number;
  strategy: MoneyBankStrategy;
  budget: number;
  manualBase: number;
  ladder: MoneyBankLadderLevel[];
  reinvestProfit: boolean;
  reinvestPercent: number;
  profitTarget: number | null;
  lossLimit: number | null;
};

export type MoneyBankMarketSignal = {
  symbol: string;
  sample_count: number;
  tick_epoch?: number;
  quote?: number | null;
  recent_quotes?: number[];
  tick_sequence?: number;
  rise_percentage?: number;
  fall_percentage?: number;
};

export type MoneyBankTrade = DerivHistoryRow & {
  account_type: string;
  current_value: number;
};

export type MoneyBankObservedSetup = {
  symbol: string;
  growthRate: number;
  takeProfitTicks: number;
  score: number;
  sampleCount: number;
  observedBalance: number;
  estimatedLosses: number;
};

export type MoneyBankJdyDecision = MoneyBankObservedSetup & {
  safe: boolean;
  holdReason: string | null;
  stake: number;
  predictedWinRate: number;
  estimatedLossStreak: number;
  suggestedSymbol: string | null;
  suggestedGrowthRate: number | null;
  suggestedTakeProfitTicks: number | null;
  suggestedStake: number | null;
};

type MoneyBankPanelProps = {
  isConnected: boolean;
  tradeSlotBlocked: boolean;
  running: boolean;
  starting?: boolean;
  symbol: string;
  markets: readonly (readonly [string, string])[];
  onSymbolChange: (symbol: string) => void;
  accountBalance?: number;
  currency?: string;
  quote?: number | null;
  marketSignal?: MoneyBankMarketSignal;
  growthRate: number;
  onGrowthRateChange: (value: number) => void;
  takeProfitTicks: number;
  onTakeProfitTicksChange: (value: number) => void;
  autoKnockout: boolean;
  knockoutsBeforeTrade: number;
  autoKnockoutScan: MoneyBankKnockoutScannerResponse | null;
  onAutoKnockoutChange: (enabled: boolean) => void;
  onKnockoutsBeforeTradeChange: (value: number) => void;
  strategy: MoneyBankStrategy;
  onStrategyChange: (strategy: MoneyBankStrategy) => void;
  budget: number;
  onBudgetChange: (value: number) => void;
  manualBase: number;
  onManualBaseChange: (value: number) => void;
  reinvestProfit: boolean;
  onReinvestProfitChange: (value: boolean) => void;
  reinvestPercent: number;
  onReinvestPercentChange: (value: number) => void;
  profitTarget: number | null;
  onProfitTargetChange: (value: number | null) => void;
  lossLimit: number | null;
  onLossLimitChange: (value: number | null) => void;
  closing?: boolean;
  recentTrades: readonly MoneyBankTrade[];
  sessionRows: readonly MoneyBankTrade[];
  lastSettledProfit: number | null;
  onStart: (config: MoneyBankStartConfig) => void;
  onStop: () => void;
};

export const MONEY_BANK_AUTO_SYMBOLS = ["1HZ10V", "1HZ15V", "1HZ25V", "1HZ30V", "1HZ50V", "1HZ75V", "1HZ90V", "1HZ100V"] as const;
const GROWTH_RATES = [1, 2, 3, 4, 5];

const ACCUMULATOR_MIN_STAKE = 1;
const roundCents = (value: number) => Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));

const money = (value: number, currency = "USD") =>
  `${currency === "USD" ? "$" : `${currency} `}${value.toFixed(2)}`;

export function MoneyBankPanel({
  isConnected,
  tradeSlotBlocked,
  running,
  starting = false,
  symbol,
  markets,
  onSymbolChange,
  accountBalance,
  currency = "USD",
  quote,
  marketSignal,
  growthRate,
  onGrowthRateChange,
  takeProfitTicks,
  onTakeProfitTicksChange,
  autoKnockout,
  knockoutsBeforeTrade,
  autoKnockoutScan,
  onAutoKnockoutChange,
  onKnockoutsBeforeTradeChange,
  strategy,
  onStrategyChange,
  budget,
  onBudgetChange,
  manualBase,
  onManualBaseChange,
  reinvestProfit,
  onReinvestProfitChange,
  reinvestPercent,
  onReinvestPercentChange,
  profitTarget,
  onProfitTargetChange,
  lossLimit,
  onLossLimitChange,
  closing = false,
  recentTrades,
  sessionRows,
  lastSettledProfit,
  onStart,
  onStop,
}: MoneyBankPanelProps) {
  const controlsDisabled = running || starting;
  const ladder = calculateRecoveryLadder({
    strategy,
    budget,
    manualBase,
    growthRate,
    takeProfitTicks,
  });
  const estimatedReturn = estimateAccumulatorReturnRate(growthRate, takeProfitTicks) * 100;
  const recoveryStart = Math.max(5, Math.round(takeProfitTicks * 0.16));
  const selectedMarket = markets.find(([market]) => market === symbol)?.[1] ?? symbol;
  const totalCycleRisk = ladder.at(-1)?.cumulative ?? 0;
  const selectedStake = ladder[0]?.stake ?? 0;
  const projectedProfit = ladder[0]?.profit ?? 0;
  const profitBasis = lastSettledProfit != null && lastSettledProfit > 0 ? lastSettledProfit : projectedProfit;
  const reinvestedProfit = roundCents(profitBasis * reinvestPercent / 100);
  const retainedProfit = roundCents(Math.max(0, profitBasis - reinvestedProfit));
  const requiredKnockouts = autoKnockoutScan?.required_knockouts ?? knockoutsBeforeTrade;
  const qualifiedKnockouts = autoKnockoutScan?.qualified_knockouts ?? 0;
  const knockoutReady = autoKnockoutScan?.ready_to_trade === true;
  const [historyHidden, setHistoryHidden] = useState<Set<string>>(new Set());
  const [historyClearArmed, setHistoryClearArmed] = useState(false);
  const [historyFading, setHistoryFading] = useState(false);
  const visibleTrades = recentTrades.filter((trade) => !historyHidden.has(trade.contract_id));
  const visibleSessionRows = sessionRows.filter((trade) => !historyHidden.has(trade.contract_id));

  const submitStart = () => {
    if (starting || closing) return;
    if (running) {
      onStop();
      return;
    }
    if (tradeSlotBlocked) return;
    onStart({
      symbol,
      growthRate,
      takeProfitTicks,
      autoKnockout,
      knockoutsBeforeTrade,
      strategy,
      budget,
      manualBase,
      ladder,
      reinvestProfit,
      reinvestPercent,
      profitTarget,
      lossLimit,
    });
  };

  const downloadHistory = () => {
    const header = ["contract_id", "contract_type", "symbol", "account_type", "barrier", "buy_price", "current_value", "payout", "profit", "status", "buy_time", "sell_time"];
    const rows = visibleTrades.map((trade) => [
      trade.contract_id,
      trade.contract_type,
      trade.symbol,
      trade.account_type,
      trade.barrier ?? "",
      trade.buy_price.toFixed(2),
      trade.current_value.toFixed(2),
      trade.payout == null ? "" : trade.payout.toFixed(2),
      trade.profit.toFixed(2),
      trade.status,
      trade.buy_time ?? "",
      trade.sell_time ?? "",
    ]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `money-bank-trades-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearHistory = () => {
    if (!historyClearArmed) {
      setHistoryClearArmed(true);
      window.setTimeout(() => setHistoryClearArmed(false), 3000);
      return;
    }
    setHistoryFading(true);
    window.setTimeout(() => {
      setHistoryHidden((current) => new Set([
        ...current,
        ...recentTrades.map((trade) => trade.contract_id),
        ...sessionRows.map((trade) => trade.contract_id),
      ]));
      setHistoryFading(false);
      setHistoryClearArmed(false);
    }, 350);
  };

  return (
    <section className="money-bank-panel" aria-label="Money Bank Accumulator">
      <header className="money-bank-header">
        <div className="money-bank-brand">
          <div className="money-bank-mark"><TrendingUp size={18} /></div>
          <div>
            <div className="money-bank-title-row">
              <h2>Money Bank</h2>
              <span>Accumulator</span>
            </div>
            <p>Accumulator contracts with configurable risk controls</p>
          </div>
        </div>
        <div className={`money-bank-live-state ${running ? "running" : ""}`}>
          <i />
          {running ? "BOT ACTIVE" : "READY"}
        </div>
      </header>

      <div className="money-bank-body">
        <MoneyBankMarketChart
          symbol={symbol}
          marketName={selectedMarket}
          connected={isConnected}
          quote={quote}
          quotes={marketSignal?.recent_quotes ?? []}
          tickSequence={marketSignal?.tick_sequence}
        />
        <div className="money-bank-main">
          <section className="money-bank-card money-bank-market-card">
            <div className="money-bank-card-head">
              <div>
                <small>MARKET</small>
                <h3>Choose a Volatility pair</h3>
              </div>
              <span className="money-bank-filter-badge">VOLATILITY ONLY</span>
            </div>
            <label className="money-bank-select-wrap">
              <span>{selectedMarket}</span>
              <ChevronDown size={16} />
              <select
                value={symbol}
                onChange={(event) => onSymbolChange(event.target.value)}
                disabled={controlsDisabled || !isConnected}
                aria-label="Select a Volatility market"
              >
                {markets.map(([market, label]) => (
                  <option key={market} value={market}>{label}</option>
                ))}
              </select>
            </label>
            <div className="money-bank-market-meta">
              <span><i /> {isConnected ? "Live market available" : "Connect Deriv to stream quotes"}</span>
            </div>
            <div className="money-bank-toggle-list money-bank-market-toggle">
              <label>
                <span><b>Auto Knockout</b>{autoKnockout && <small>{knockoutReady ? "Sample complete" : "Waiting for knockouts"}</small>}</span>
                <input type="checkbox" checked={autoKnockout} onChange={(event) => onAutoKnockoutChange(event.target.checked)} disabled={controlsDisabled} aria-label="Toggle Money Bank Auto Knockout" />
                <i />
              </label>
            </div>
            {autoKnockout && (
              <div className="money-bank-knockout-scan" role="status" aria-live="polite">
                <div className="money-bank-knockout-heading">
                  <b>{knockoutReady ? "Knockout sample complete" : `Waiting for knockouts ${qualifiedKnockouts}/${requiredKnockouts}`}</b>
                  <span>Scanner cycle: {qualifiedKnockouts}/{requiredKnockouts} knockouts counted</span>
                </div>
                <p>
                  {autoKnockoutScan?.phase === "waiting_for_market"
                    ? `Re-confirming the selected ${selectedMarket} market before scanning.`
                    : autoKnockoutScan?.phase === "waiting_for_quote"
                      ? `Waiting for a fresh live ${selectedMarket} quote.`
                      : autoKnockoutScan?.phase === "waiting_for_knockout"
                        ? qualifiedKnockouts > 0
                          ? `${qualifiedKnockouts} of ${requiredKnockouts} knockouts counted. Watching for the next live move.`
                          : `Watching live ${selectedMarket} ticks for scanner knockouts.`
                      : autoKnockoutScan?.phase === "ready"
                            ? "Knockout sample complete. Money Bank AI is reviewing the selected market, percentage, stake, and Take Ticks before entry."
                            : running
                              ? `Watching live ${selectedMarket} ticks for scanner knockouts.`
                              : "Start Accumulator to begin checking live scanner knockouts."}
                </p>
                <div className="money-bank-knockout-settings">
                  <label htmlFor="money-bank-knockouts-before-trade">Qualified knockouts required</label>
                  <input
                    id="money-bank-knockouts-before-trade"
                    aria-label="Qualified knockouts required"
                    type="number"
                    min={1}
                    max={20}
                    step={1}
                    value={knockoutsBeforeTrade}
                    onChange={(event) => onKnockoutsBeforeTradeChange(Math.min(20, Math.max(1, Number(event.target.value) || 1)))}
                    disabled={controlsDisabled}
                  />
                </div>
                <small className="money-bank-knockout-footnote">
                  A knockout counts as soon as price reaches the proposal barrier. The scanner re-arms for another move; Take Ticks applies only to the actual Accumulator trade.
                </small>
                <small className="money-bank-knockout-footnote">
                  At the target, Money Bank AI reviews the selected market, percentage, stake, and Take Ticks before entry. Manual losses do not count; this does not guarantee a win.
                </small>
              </div>
            )}
          </section>

          <section className="money-bank-card">
            <div className="money-bank-card-head">
              <div>
                <small>ACCUMULATOR SETTINGS</small>
                <h3>Growth rate</h3>
              </div>
              <strong className="money-bank-value-chip">{growthRate}%</strong>
            </div>
            <div className="money-bank-rate-grid">
              {GROWTH_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  className={growthRate === rate ? "active" : ""}
                  onClick={() => onGrowthRateChange(rate)}
                  disabled={controlsDisabled}
                >
                  {rate}%
                </button>
              ))}
            </div>
          </section>

          <section className="money-bank-card money-bank-ticks-card">
            <div className="money-bank-card-head">
              <div>
                <small>TAKE PROFIT</small>
                <h3>Contract ticks</h3>
              </div>
              <div className="money-bank-ticks-box">{takeProfitTicks}</div>
            </div>
            <input
              className="money-bank-range"
              type="range"
               min="5"
              max="50"
              step="1"
              value={takeProfitTicks}
              onChange={(event) => onTakeProfitTicksChange(Number(event.target.value))}
              disabled={controlsDisabled}
              aria-label="Take Profit ticks"
            />
            <div className="money-bank-tick-quick" role="group" aria-label="Quick Accumulator tick targets">
              {[5, 6].map((ticks) => (
                <button
                  type="button"
                  key={ticks}
                  className={takeProfitTicks === ticks ? "active" : ""}
                  onClick={() => onTakeProfitTicksChange(ticks)}
                  disabled={controlsDisabled}
                  aria-pressed={takeProfitTicks === ticks}
                >
                  {ticks} ticks
                </button>
              ))}
            </div>
            <div className="money-bank-range-track-label">Take profit target updates the return and every recovery level.</div>
          </section>

          <section className="money-bank-card money-bank-strategy-card">
            <div className="money-bank-card-head">
              <div>
                <small>BASE STRATEGY</small>
                <h3>How should BASE be set?</h3>
              </div>
              <ShieldCheck size={18} />
            </div>
            <div className="money-bank-segmented">
              <button type="button" className={strategy === "budget" ? "active" : ""} onClick={() => onStrategyChange("budget")} disabled={controlsDisabled}>
                <b>Auto (Budget)</b><small>Keep the cycle inside budget</small>
              </button>
              <button type="button" className={strategy === "manual" ? "active" : ""} onClick={() => onStrategyChange("manual")} disabled={controlsDisabled}>
                <b>Manual base</b><small>Choose BASE yourself</small>
              </button>
            </div>
            <div className="money-bank-input-grid">
              <label>
                <span>{strategy === "budget" ? "Budget" : "Manual BASE"}</span>
                <div className="money-bank-input-wrap">
                  <b>$</b>
                  <input
                    type="number"
                     min={ACCUMULATOR_MIN_STAKE}
                    step="0.01"
                    value={strategy === "budget" ? budget : manualBase}
                     onChange={(event) => (strategy === "budget" ? onBudgetChange : onManualBaseChange)(Math.max(ACCUMULATOR_MIN_STAKE, Number(event.target.value) || ACCUMULATOR_MIN_STAKE))}
                     disabled={controlsDisabled}
                  />
                </div>
              </label>
              <div className="money-bank-calculated-base">
                <span>Calculated BASE</span>
                <strong>{money(selectedStake, currency)}</strong>
              </div>
            </div>
          </section>
        </div>

        <aside className="money-bank-side">
          <section className="money-bank-return-card">
            <div className="money-bank-return-top">
              <span>THEORETICAL CONTRACT RETURN</span>
              <span className="money-bank-return-icon"><TrendingUp size={16} /></span>
            </div>
            <strong>+{estimatedReturn.toFixed(1)}%</strong>
            <p>Contract estimate · {recoveryStart}–{takeProfitTicks} ticks @ {growthRate}%</p>
          </section>

          <section className="money-bank-card money-bank-ladder-card">
            <div className="money-bank-card-head">
              <div>
                <small>RECOVERY LADDER</small>
               <h3>BASE → {ladder.at(-1)?.name ?? "—"}</h3>
              </div>
              <span className="money-bank-risk-pill">{money(totalCycleRisk, currency)} cycle</span>
            </div>
            <div className="money-bank-ladder">
              {ladder.map((level, index) => (
                <div className={`money-bank-level ${index === 0 ? "base" : ""}`} key={level.name}>
                  <span><b>{level.name}</b>{index === 0 ? "First stake" : `After ${index} loss${index === 1 ? "" : "es"}`}</span>
                  <strong>{money(level.stake, currency)}</strong>
                  <small>theoretical +{money(level.profit, currency)}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="money-bank-card money-bank-risk-card">
            <div className="money-bank-card-head">
              <div>
                <small>RISK & SESSION</small>
                <h3>Protect the session</h3>
              </div>
              <span className="money-bank-account-balance">{accountBalance != null ? money(accountBalance, currency) : "—"}</span>
            </div>
             <div className="money-bank-risk-grid">
               <label><span>Profit Target ($)</span><div className="money-bank-input-wrap"><b>$</b><input type="number" min="0" step="1" placeholder="Optional" value={profitTarget ?? ""} onChange={(event) => onProfitTargetChange(event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0))} disabled={controlsDisabled} /></div></label>
               <label><span>Loss Limit ($)</span><div className="money-bank-input-wrap"><b>$</b><input type="number" min="0" step="1" placeholder="Optional" value={lossLimit ?? ""} onChange={(event) => onLossLimitChange(event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0))} disabled={controlsDisabled} /></div></label>
            </div>
            <div className="money-bank-toggle-list">
                 <label><span><b>Reinvest profit</b></span><input type="checkbox" checked={reinvestProfit} onChange={(event) => onReinvestProfitChange(event.target.checked)} disabled={controlsDisabled} /><i /></label>
                {reinvestProfit && (
                  <div className="money-bank-reinvest-details">
                    <label><span>Profit to reinvest</span><select value={reinvestPercent} onChange={(event) => onReinvestPercentChange(Number(event.target.value))} disabled={controlsDisabled}>{[10, 25, 45, 50, 65, 75, 85, 95, 100].map((percent) => <option key={percent} value={percent}>{percent}%</option>)}</select></label>
                    <div><span><small>REINVESTED</small><b>{money(reinvestedProfit, currency)}</b></span><span><small>LEFT BACK</small><b>{money(retainedProfit, currency)}</b></span></div>
                  </div>
                )}
            </div>
          </section>

        </aside>
      </div>

      <div className="money-bank-actions">
        <button type="button" className={`money-bank-start ${running ? "stop" : ""}`} onClick={submitStart} disabled={!isConnected || starting || closing || (!running && tradeSlotBlocked)}>
          {closing ? <><RefreshCw size={15} className="money-bank-spin" /> Closing contracts…</> : starting ? <><RefreshCw size={15} className="money-bank-spin" /> Preparing Accumulator…</> : running ? <><Square size={15} /> Stop Accumulator</> : <><Play size={15} /> Start Accumulator</>}
        </button>
      </div>

      <DerivHistory
          title="Money Bank History"
          strategy="Money Bank Strategy"
          rows={visibleTrades}
          sessionRows={visibleSessionRows}
          currency={currency}
          clearArmed={historyClearArmed}
          fading={historyFading}
          onClear={clearHistory}
          actions={<button type="button" onClick={downloadHistory} disabled={!visibleTrades.length}><Download size={13} />Download</button>}
        />
    </section>
  );
}