import { useMemo, useState } from "react";
import { ChevronDown, Pause, Play } from "lucide-react";
import { formatDerivQuote } from "../lib/format-deriv-quote";
import AiScannerAction from "./ai-scanner-action";
import {
  chooseBestEdgeSignal,
  type BestEdgeSignal,
  type MarketSignal,
} from "../lib/trading-sequence";
import DerivHistory, { type DerivHistoryRow } from "./deriv-history";
import "./edge-reference-panel.css";

type EdgeDirection = "DIGITOVER" | "DIGITUNDER";
type EdgeStrategy = "flat" | "martingale";

type EdgeTradeRow = DerivHistoryRow & { account_type: string };

type EdgeReferencePanelProps = {
  isConnected: boolean;
  running: boolean;
  sniperOverUnder: boolean;
  onSniperOverUnderChange: (enabled: boolean) => void;
  symbol: string;
  markets: readonly (readonly [string, string])[];
  onSymbolChange: (value: string) => void;
  currentAccount?: { currency?: string; balance?: number } | null;
  direction: EdgeDirection;
  onDirectionChange: (value: EdgeDirection) => void;
  barrier: number;
  onBarrierChange: (value: number) => void;
  duration: number;
  onDurationChange: (value: number) => void;
  stake: number;
  onStakeChange: (value: number) => void;
  strategy: EdgeStrategy;
  onStrategyChange: (value: EdgeStrategy) => void;
  martingale: number;
  onMartingaleChange: (value: number) => void;
  takeProfit: number;
  onTakeProfitChange: (value: number) => void;
  stopLoss: number;
  onStopLossChange: (value: number) => void;
  edgeRecommendation?: BestEdgeSignal | null;
  marketSignals: readonly MarketSignal[];
  analysis: { overPercent: number; underPercent: number };
  lastDigit?: number | null;
  quote?: number | null;
  payoutPercent?: number | null;
  nextStake: number;
  sessionPnl: number;
  sessionTrades: number;
  onAiScan: () => Promise<string>;
  canTrade: boolean;
  onStart: () => void | Promise<void>;
  onStop: () => void;
  onReset: () => void;
  canViewHistory: boolean;
  recentTrades: readonly EdgeTradeRow[];
  sessionRows: readonly EdgeTradeRow[];
  historyFading: boolean;
  clearTradesArmed: boolean;
  onClearHistory: () => void | Promise<void>;
};

const EDGE_PERCENTAGE_SCAN_FLOOR = 90;

export default function EdgeReferencePanel({
  isConnected,
  running,
  sniperOverUnder,
  onSniperOverUnderChange,
  symbol,
  markets,
  onSymbolChange,
  currentAccount,
  direction,
  onDirectionChange,
  barrier,
  onBarrierChange,
  duration,
  onDurationChange,
  stake,
  onStakeChange,
  strategy,
  onStrategyChange,
  martingale,
  onMartingaleChange,
  takeProfit,
  onTakeProfitChange,
  stopLoss,
  onStopLossChange,
  edgeRecommendation,
  marketSignals,
  analysis,
  lastDigit = null,
  quote = null,
  payoutPercent = null,
  nextStake,
  sessionPnl,
  sessionTrades,
  onAiScan,
  canTrade,
  onStart,
  onStop,
  onReset,
  canViewHistory,
  recentTrades,
  sessionRows,
  historyFading,
  clearTradesArmed,
  onClearHistory,
}: EdgeReferencePanelProps) {
  const [marketPickerOpen, setMarketPickerOpen] = useState(false);
  const [maxStake, setMaxStake] = useState("No limit");
  const canRunAiScanner = isConnected
    && !running
    && Number.isInteger(duration)
    && duration >= 1
    && duration <= 6
    && Number.isFinite(stake)
    && stake >= 0.35
    && Number.isInteger(barrier)
    && barrier >= 0
    && barrier <= 9;

  const liveSignals = marketSignals as MarketSignal[];
  const bestSignal = useMemo(
    () => chooseBestEdgeSignal(liveSignals, EDGE_PERCENTAGE_SCAN_FLOOR),
    [liveSignals],
  );
  const bestDirection = bestSignal?.direction === "DIGITUNDER" ? "Under" : "Over";
  const bestBarrier = bestSignal?.digit ?? barrier;
  const bestRate = bestSignal?.score ?? null;
  const bestMarket = markets.find(([value]) => value === (bestSignal?.symbol ?? symbol))?.[1] ?? "Volatility 100 Index";
  const marketLabel = markets.find(([value]) => value === symbol)?.[1] ?? "Volatility 100 Index";
  const rankedMarkets = useMemo(() => {
    const signalMap = new Map(marketSignals.map((signal) => [signal.symbol, signal]));
    return markets.map(([value, label]) => {
      const signal = signalMap.get(value);
      const outcomes = signal?.digit_outcomes?.filter((outcome) => outcome.digit > 0 && outcome.digit < 9) ?? [];
      const score = signal
        ? Math.max(...outcomes.flatMap((outcome) => [
            Number(outcome.over_percentage),
            Number(outcome.under_percentage),
          ]), 0)
        : 0;
      return { value, label, score };
    }).sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
  }, [marketSignals, markets]);
  const quoteText = quote == null ? "—" : formatDerivQuote(quote);
  const payoutText = payoutPercent == null || !Number.isFinite(payoutPercent) ? "waiting" : `${payoutPercent.toFixed(1)}%`;
  const currency = currentAccount?.currency ?? "USD";

  return (
    <section className="edge-reference-layout">
      <section className="edge-ref-card edge-ref-scanner">
        <div className="edge-ref-heading">
          <div className="edge-ref-title"><span className="edge-ref-spark" aria-hidden="true" /><b>Barrier Scanner</b><span className="edge-ref-premium">PREMIUM</span></div>
          <span className="edge-ref-live"><i /> LIVE</span>
        </div>
        <div className="edge-ref-rule" />
        <div className="edge-ref-best">
          <div className="edge-ref-best-barrier">{bestDirection} {bestBarrier}</div>
          <div className="edge-ref-best-copy"><span>BEST OBSERVED BARRIER RIGHT NOW</span><p><strong>{bestRate == null ? "waiting" : `${bestRate.toFixed(1)}% observed`}</strong><em>·</em> payout {payoutText} <em>·</em> {bestMarket}</p></div>
        </div>
      </section>

      <section className={`edge-ref-card edge-ref-market ${marketPickerOpen ? "open" : ""}`}>
        <button type="button" className="edge-ref-market-trigger" onClick={() => setMarketPickerOpen((open) => !open)} aria-expanded={marketPickerOpen} disabled={!isConnected}>
          <span className="edge-ref-market-icon" aria-hidden="true" />
          <span className="edge-ref-market-copy"><small>Market (manual)</small><b>{marketLabel}</b></span>
          <ChevronDown size={18} className="edge-ref-market-chevron" />
        </button>
        <label className={`edge-sniper-toggle${sniperOverUnder ? " active" : ""}`}>
          <span className="edge-sniper-copy">
            <b>Sniper over/under</b>
          </span>
          <span className="edge-sniper-control">
            <span className={`edge-sniper-state${sniperOverUnder ? " working" : ""}`}>{sniperOverUnder ? "WORKING" : "OFF"}</span>
            <span className="edge-toggle">
              <input
                type="checkbox"
                checked={sniperOverUnder}
                onChange={(event) => onSniperOverUnderChange(event.target.checked)}
                disabled={!isConnected || running}
                aria-label="Sniper over/under"
              />
              <i />
            </span>
          </span>
        </label>
        {marketPickerOpen && (
          <div className="edge-ref-market-menu">
            {rankedMarkets.map((option, index) => (
              <button type="button" className={`edge-ref-market-option ${symbol === option.value ? "selected" : ""}`} key={option.value} onClick={() => { onSymbolChange(option.value); setMarketPickerOpen(false); }} disabled={running}>
                <span><b>{option.label}</b>{index === 0 && <small>BEST</small>}<em>observed {option.score ? `${option.score.toFixed(0)}%` : "waiting"} · {option.value}</em></span>
                <strong>{option.score ? `${option.score.toFixed(1)}%` : "—"}</strong>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="edge-ref-card edge-ref-quote"><strong>{quoteText}</strong><span>Last digit: <b>{lastDigit == null ? "—" : lastDigit}</b></span></section>

      <div className="edge-ref-direction">
        <button className={direction === "DIGITOVER" ? "active over" : ""} onClick={() => onDirectionChange("DIGITOVER")} disabled={running}>Over</button>
        <button className={direction === "DIGITUNDER" ? "active under" : ""} onClick={() => onDirectionChange("DIGITUNDER")} disabled={running}>Under</button>
      </div>

      <section className="edge-ref-card edge-ref-digit-card">
        <span className="edge-ref-field-label">Last digit prediction · live market highlight</span>
        <div className="edge-ref-digit-picker">{Array.from({ length: 10 }, (_, digit) => {
          const isMarketDigit = lastDigit === digit;
          return <button type="button" key={digit} className={`${barrier === digit ? "active " : ""}${isMarketDigit ? "market" : ""}`} onClick={() => onBarrierChange(digit)} disabled={running} aria-label={`Barrier digit ${digit}${isMarketDigit ? ", current market digit" : ""}`} title={isMarketDigit ? "Current market digit" : undefined}>{digit}</button>;
        })}</div>
      </section>

      <div className="edge-ref-duration-field">
        <span>Duration · ticks</span>
        <div className="edge-ref-duration-options" role="group" aria-label="EDGE duration in ticks">
          {[1, 2, 3, 4, 5, 6].map((ticks) => (
            <button
              type="button"
              key={ticks}
              className={duration === ticks ? "active" : ""}
              aria-pressed={duration === ticks}
              onClick={() => onDurationChange(ticks)}
              disabled={running}
              data-testid={`edge-duration-${ticks}`}
            >
              {ticks}
            </button>
          ))}
        </div>
      </div>
      <label className="edge-ref-input-card"><span>Initial stake</span><div><input type="number" min=".35" step=".01" value={stake} onChange={(event) => onStakeChange(Math.max(.35, Number(event.target.value) || .35))} disabled={running} /><b>{currency}</b></div></label>
      <section className="edge-ref-ai-scanner">
        <div><b>AI SCANNER</b></div>
        <AiScannerAction onScan={onAiScan} disabled={!canRunAiScanner} />
      </section>

      <section className="edge-ref-card edge-ref-setup"><h2>Strategy parameters</h2>
        <label><span>Strategy</span><div><select value={strategy} onChange={(event) => onStrategyChange(event.target.value as EdgeStrategy)} disabled={running}><option value="martingale">Martingale</option><option value="flat">Flat stake</option></select><ChevronDown size={16} /></div></label>
        <label><span>Stake multiplier</span><div><input type="number" min="1" max="10" step=".1" value={martingale} onChange={(event) => onMartingaleChange(Number(event.target.value))} disabled={running || strategy === "flat"} /><b>x</b></div></label>
        <label><span>Max. stake</span><input value={maxStake} onChange={(event) => setMaxStake(event.target.value)} disabled={running} /></label>
        <p className="edge-ref-callout"><b>Balance guard</b> — no max stake needed. Built-in 50%-of-balance protection keeps the plan resilient through <b>22+</b> losses in a row.</p>
      </section>

      <section className="edge-ref-card edge-ref-risk"><h2>Risk management</h2>
        <label><span>Profit threshold</span><div><input type="number" min=".01" step=".01" value={takeProfit} onChange={(event) => onTakeProfitChange(Math.max(.01, Number(event.target.value) || .01))} disabled={running} /><b>USD</b></div></label>
        <label><span>Loss threshold</span><div><input type="number" min=".01" step=".01" value={stopLoss} onChange={(event) => onStopLossChange(Math.max(.01, Number(event.target.value) || .01))} disabled={running} /><b>USD</b></div></label>
        <p className="edge-ref-callout danger"><b>Wipeout radar</b> — <b>22</b> losses in a row would exhaust your balance.</p>
      </section>

      <section className="edge-ref-session"><div><span>Current Stake</span><b>${(strategy === "martingale" ? nextStake : stake).toFixed(2)}</b></div><div><span>Session P/L</span><b className={sessionPnl < 0 ? "loss" : ""}>{sessionPnl >= 0 ? "+" : ""}{sessionPnl.toFixed(2)}</b></div><div><span>Trades</span><b>{sessionTrades}</b></div><p>Runtime stop</p></section>

      <div className="edge-ref-run-row"><button className={`edge-ref-run ${running ? "running" : ""}`} onClick={() => void (running ? onStop() : onStart())} disabled={!isConnected || (!running && !canTrade)}>{running ? <><Pause size={16} fill="currentColor" /> Stop</> : <><Play size={15} fill="currentColor" /> Run</>}</button><button type="button" className="edge-ref-session-reset" onClick={onReset} aria-label="Reset session P/L, trades, and stake to base" title="Reset session"><span aria-hidden="true" /></button></div>

      {canViewHistory && <DerivHistory title="EDGE History" strategy="EDGE Strategy" rows={recentTrades} sessionRows={sessionRows} currency={currentAccount?.currency} sessionPnl={sessionPnl} sessionTradeCount={sessionTrades} fading={historyFading} clearArmed={clearTradesArmed} onClear={() => void onClearHistory()} />}

      <section className="edge-ref-disclaimer"><b>RISK DISCLAIMER</b><p>Deriv offers complex derivatives, such as options and contracts for difference (“CFDs”). These products may not be suitable for all clients, and trading them puts you at risk. Please make sure that you understand the following risks before trading Deriv products: a) you may lose some or all of the money you invest in the trade, b) if your trade involves currency conversion, exchange rates will affect your profit or loss.</p></section>
    </section>
  );
}