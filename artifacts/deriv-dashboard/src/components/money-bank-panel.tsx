import { useState } from "react";
import { ChevronDown, Download, Info, Play, RefreshCw, ShieldCheck, Square, TrendingUp } from "lucide-react";
import {
  calculateRecoveryLadder,
  estimateAccumulatorReturnRate,
  type MoneyBankLadderLevel,
  type MoneyBankStrategy,
} from "../lib/money-bank-math";
import DerivHistory, { type DerivHistoryRow } from "./deriv-history";
import "./money-bank-panel.css";

export { calculateRecoveryLadder };
export type { MoneyBankLadderLevel, MoneyBankStrategy } from "../lib/money-bank-math";

export type MoneyBankStartConfig = {
  symbol: string;
  growthRate: number;
  takeProfitTicks: number;
  autoKnockout: boolean;
  strategy: MoneyBankStrategy;
  ladder: MoneyBankLadderLevel[];
  reinvestProfit: boolean;
  reinvestPercent: number;
  profitTarget: number | null;
  lossLimit: number | null;
};

export type MoneyBankMarketSignal = {
  symbol: string;
  sample_count: number;
  quote?: number | null;
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
  symbol: string;
  markets: readonly (readonly [string, string])[];
  onSymbolChange: (symbol: string) => void;
  accountBalance?: number;
  currency?: string;
  quote?: number | null;
  growthRate: number;
  onGrowthRateChange: (value: number) => void;
  takeProfitTicks: number;
  onTakeProfitTicksChange: (value: number) => void;
  autoKnockout: boolean;
  autoKnockoutCountdown: number | null;
  onAutoKnockoutChange: (enabled: boolean) => void;
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

const GROWTH_RATES = [1, 2, 3, 4, 5];
export const MONEY_BANK_AUTO_SYMBOLS = ["1HZ10V", "1HZ15V", "1HZ25V", "1HZ30V", "1HZ50V", "1HZ75V", "1HZ90V", "1HZ100V"] as const;

const ACCUMULATOR_MIN_STAKE = 1;
const roundCents = (value: number) => Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));

const money = (value: number, currency = "USD") =>
  `${currency === "USD" ? "$" : `${currency} `}${value.toFixed(2)}`;

export function MoneyBankPanel({
  isConnected,
  tradeSlotBlocked,
  running,
  symbol,
  markets,
  onSymbolChange,
  accountBalance,
  currency = "USD",
  quote,
  growthRate,
  onGrowthRateChange,
  takeProfitTicks,
  onTakeProfitTicksChange,
  autoKnockout,
  autoKnockoutCountdown,
  onAutoKnockoutChange,
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
  const [historyHidden, setHistoryHidden] = useState<Set<string>>(new Set());
  const [historyClearArmed, setHistoryClearArmed] = useState(false);
  const [historyFading, setHistoryFading] = useState(false);
  const visibleTrades = recentTrades.filter((trade) => !historyHidden.has(trade.contract_id));
  const visibleSessionRows = sessionRows.filter((trade) => !historyHidden.has(trade.contract_id));

  const submitStart = () => {
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
      strategy,
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
                disabled={running || !isConnected}
                aria-label="Select a Volatility market"
              >
                {markets.map(([market, label]) => (
                  <option key={market} value={market}>{label}</option>
                ))}
              </select>
            </label>
            <div className="money-bank-market-meta">
              <span><i /> {isConnected ? "Live market available" : "Connect Deriv to stream quotes"}</span>
              {quote != null && <strong>{quote.toFixed(2)}</strong>}
            </div>
            <div className="money-bank-toggle-list money-bank-market-toggle">
              <label>
                <span><b>Auto Knockout</b>{autoKnockout && <small>{autoKnockoutCountdown == null ? "Ready" : "Scanning"}</small>}</span>
                <input type="checkbox" checked={autoKnockout} onChange={(event) => onAutoKnockoutChange(event.target.checked)} disabled={running} aria-label="Toggle Money Bank Auto Knockout" />
                <i />
              </label>
            </div>
            {autoKnockout && autoKnockoutCountdown != null && (
              <div className="money-bank-knockout-scan" role="status" aria-live="polite">
                <ShieldCheck size={15} />
                <span>
                  {autoKnockoutCountdown > 0
                    ? `Checking ${growthRate}% growth · ${takeProfitTicks} exit ticks · ${selectedMarket}: ${autoKnockoutCountdown}s`
                    : "Rechecking the latest quote and exit ticks before entry…"}
                </span>
                <div
                  className="money-bank-knockout-progress"
                  role="progressbar"
                  aria-label="Auto Knockout scan progress"
                  aria-valuemin={0}
                  aria-valuemax={10}
                  aria-valuenow={10 - autoKnockoutCountdown}
                >
                  <i />
                </div>
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
                  disabled={running}
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
              disabled={running}
              aria-label="Take Profit ticks"
            />
            <div className="money-bank-tick-quick" role="group" aria-label="Quick Accumulator tick targets">
              {[5, 6].map((ticks) => (
                <button
                  type="button"
                  key={ticks}
                  className={takeProfitTicks === ticks ? "active" : ""}
                  onClick={() => onTakeProfitTicksChange(ticks)}
                  disabled={running}
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
              <button type="button" className={strategy === "budget" ? "active" : ""} onClick={() => onStrategyChange("budget")} disabled={running}>
                <b>Auto (Budget)</b><small>Keep the cycle inside budget</small>
              </button>
              <button type="button" className={strategy === "manual" ? "active" : ""} onClick={() => onStrategyChange("manual")} disabled={running}>
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
                    disabled={running}
                  />
                </div>
              </label>
              <div className="money-bank-calculated-base">
                <span>Calculated BASE</span>
                <strong>{money(selectedStake, currency)}</strong>
              </div>
            </div>
             <p className="money-bank-helper"><Info size={14} /> BASE is the first stake. Accumulator contracts require at least {money(ACCUMULATOR_MIN_STAKE, currency)}. Auto Budget caps planned stakes at the entered amount; Manual BASE is not capped by a budget. Losses can exhaust the budget, and recovery is not guaranteed.</p>
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
             <p className="money-bank-helper"><Info size={14} /> Auto Budget includes only levels affordable within its cap. A loss at the last planned level stops the run; a win resets to BASE unless Reinvest Profit is enabled.</p>
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
               <label><span>Profit Target ($)</span><div className="money-bank-input-wrap"><b>$</b><input type="number" min="0" step="1" placeholder="Optional" value={profitTarget ?? ""} onChange={(event) => onProfitTargetChange(event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0))} disabled={running} /></div></label>
               <label><span>Loss Limit ($)</span><div className="money-bank-input-wrap"><b>$</b><input type="number" min="0" step="1" placeholder="Optional" value={lossLimit ?? ""} onChange={(event) => onLossLimitChange(event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0))} disabled={running} /></div></label>
            </div>
            <div className="money-bank-toggle-list">
                 <label><span><b>Reinvest profit</b></span><input type="checkbox" checked={reinvestProfit} onChange={(event) => onReinvestProfitChange(event.target.checked)} disabled={running} /><i /></label>
                {reinvestProfit && (
                  <div className="money-bank-reinvest-details">
                    <label><span>Profit to reinvest</span><select value={reinvestPercent} onChange={(event) => onReinvestPercentChange(Number(event.target.value))} disabled={running}>{[10, 25, 45, 50, 65, 75, 85, 95, 100].map((percent) => <option key={percent} value={percent}>{percent}%</option>)}</select></label>
                    <div><span><small>REINVESTED</small><b>{money(reinvestedProfit, currency)}</b></span><span><small>LEFT BACK</small><b>{money(retainedProfit, currency)}</b></span></div>
                  </div>
                )}
            </div>
          </section>

        </aside>
      </div>

      <div className="money-bank-actions">
        <button type="button" className={`money-bank-start ${running ? "stop" : ""}`} onClick={submitStart} disabled={!isConnected || (!running && tradeSlotBlocked)}>
          {closing ? <><RefreshCw size={15} className="money-bank-spin" /> Closing contracts…</> : running ? <><Square size={15} /> Stop Accumulator</> : <><Play size={15} /> Start Accumulator</>}
        </button>
      </div>

      <DerivHistory
          title="Money Bank History"
          strategy="Money Bank Strategy"
          rows={visibleTrades}
          sessionRows={visibleSessionRows}
          currency={currency}
          currentStake={selectedStake}
          clearArmed={historyClearArmed}
          fading={historyFading}
          onClear={clearHistory}
          actions={<button type="button" onClick={downloadHistory} disabled={!visibleTrades.length}><Download size={13} />Download</button>}
        />
    </section>
  );
}