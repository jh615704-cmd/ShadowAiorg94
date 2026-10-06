import { useMemo, useState } from "react";
import { ChevronDown, Pause, Play, ShieldAlert } from "lucide-react";
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
  isReal: boolean;
  liveConfirmed: boolean;
  onLiveConfirm: (value: boolean) => void;
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
  overThreeSniper: boolean;
  bestPairAnalyzer: boolean;
  autoSelectBest: boolean;
  scannerMessage?: string | null;
  onAiScan: () => Promise<string>;
  canTrade: boolean;
  onStart: () => void | Promise<void>;
  onStop: () => void;
  onReset: () => void;
  onOverThreeSniperChange: (value: boolean) => void;
  onBestPairAnalyzerChange: (value: boolean) => void;
  onAutoSelectBestChange: (value: boolean) => void;
  canViewHistory: boolean;
  recentTrades: readonly EdgeTradeRow[];
  historyFading: boolean;
  clearTradesArmed: boolean;
  onClearHistory: () => void | Promise<void>;
};

const EDGE_PERCENTAGE_SCAN_FLOOR = 90;
const EDGE_MIN_MARKET_SAMPLE = 20;

function chooseBestOverThreeSignal(signals: MarketSignal[]): BestEdgeSignal | null {
  const candidates = signals
    .filter((signal) => signal.sample_count >= EDGE_MIN_MARKET_SAMPLE && signal.quote != null)
    .map((signal) => {
      const outcome = signal.digit_outcomes?.find((item) => item.digit === 3);
      return outcome ? { signal, score: Number(outcome.over_percentage) } : null;
    })
    .filter((candidate): candidate is { signal: MarketSignal; score: number } => candidate !== null && Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score || right.signal.sample_count - left.signal.sample_count);
  const best = candidates[0];
  return best ? {
    symbol: best.signal.symbol,
    direction: "DIGITOVER",
    digit: 3,
    score: best.score,
    sampleCount: best.signal.sample_count,
  } : null;
}

function chooseBestAnalyzerSignal(signals: MarketSignal[]): BestEdgeSignal | null {
  const candidates = signals
    .filter((signal) => signal.sample_count >= EDGE_MIN_MARKET_SAMPLE && signal.quote != null)
    .flatMap((signal) => (signal.digit_outcomes ?? []).filter((outcome) => outcome.digit > 0 && outcome.digit < 9).flatMap((outcome) => {
    const over = Number(outcome.over_percentage);
    const under = Number(outcome.under_percentage);
    if (!Number.isFinite(over) || !Number.isFinite(under)) return [];
    return [
      { symbol: signal.symbol, direction: "DIGITOVER" as const, digit: outcome.digit, score: over, sampleCount: signal.sample_count },
      { symbol: signal.symbol, direction: "DIGITUNDER" as const, digit: outcome.digit, score: under, sampleCount: signal.sample_count },
    ];
    }));
  return candidates.sort((left, right) => right.score - left.score || right.sampleCount - left.sampleCount || left.digit - right.digit)[0] ?? null;
}

function EdgeToggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (value: boolean) => void; disabled: boolean; label: string }) {
  return (
    <label className="edge-toggle-control" aria-label={label}>
      <span className="edge-toggle-state">{checked ? "ON" : "OFF"}</span>
      <span className="edge-toggle">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
        <i />
      </span>
    </label>
  );
}

export default function EdgeReferencePanel({
  isConnected,
  running,
  isReal,
  liveConfirmed,
  onLiveConfirm,
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
  overThreeSniper,
  bestPairAnalyzer,
  autoSelectBest,
  scannerMessage = null,
  onAiScan,
  canTrade,
  onStart,
  onStop,
  onReset,
  onOverThreeSniperChange,
  onBestPairAnalyzerChange,
  onAutoSelectBestChange,
  canViewHistory,
  recentTrades,
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
  const liveAutomationSignal = useMemo(
    () => overThreeSniper
      ? chooseBestOverThreeSignal(liveSignals)
      : bestPairAnalyzer || autoSelectBest
        ? chooseBestAnalyzerSignal(liveSignals)
        : null,
    [autoSelectBest, bestPairAnalyzer, liveSignals, overThreeSniper],
  );
  const bestSignal = useMemo(
    () => liveAutomationSignal ?? chooseBestEdgeSignal(liveSignals, EDGE_PERCENTAGE_SCAN_FLOOR),
    [liveAutomationSignal, liveSignals],
  );
  const bestDirection = bestSignal?.direction === "DIGITUNDER" ? "Under" : "Over";
  const bestBarrier = bestSignal?.digit ?? barrier;
  const bestRate = bestSignal?.score ?? null;
  const bestMarket = markets.find(([value]) => value === (bestSignal?.symbol ?? symbol))?.[1] ?? "Volatility 100 Index";
  const autoMarketEnabled = autoSelectBest || overThreeSniper || bestPairAnalyzer;
  const displayedSymbol = autoMarketEnabled ? (bestSignal?.symbol ?? symbol) : symbol;
  const marketLabel = markets.find(([value]) => value === displayedSymbol)?.[1] ?? "Volatility 100 Index";
  const rankedMarkets = useMemo(() => {
    const signalMap = new Map(marketSignals.map((signal) => [signal.symbol, signal]));
    return markets.map(([value, label]) => {
      const signal = signalMap.get(value);
      const outcomes = signal?.digit_outcomes?.filter((outcome) => outcome.digit > 0 && outcome.digit < 9) ?? [];
      const score = signal
          ? overThreeSniper
          ? Number(outcomes.find((outcome) => outcome.digit === 3)?.over_percentage ?? 0)
          : Math.max(...outcomes.flatMap((outcome) => [
            Number(outcome.over_percentage),
            Number(outcome.under_percentage),
          ]), 0)
        : 0;
      return { value, label, score };
    }).sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
  }, [autoSelectBest, bestPairAnalyzer, marketSignals, markets, overThreeSniper]);
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
          <span className="edge-ref-market-copy"><small>Market {autoMarketEnabled ? "(auto-selected)" : "(manual)"}</small><b>{marketLabel}</b></span>
          <ChevronDown size={18} className="edge-ref-market-chevron" />
        </button>
        <p>{marketPickerOpen ? "Choose a market or let the scanner pick the strongest pair." : "Choose Over or Under — the best-performing pair is picked automatically."}</p>
        {marketPickerOpen && (
          <div className="edge-ref-market-menu">
             <button type="button" className={`edge-ref-market-option edge-ref-market-smart ${autoMarketEnabled ? "selected" : ""}`} onClick={() => { onAutoSelectBestChange(!autoMarketEnabled); setMarketPickerOpen(false); }}>
              <span>ϟ Auto-select best (smart)<em>{autoMarketEnabled ? "tap to use manual market" : "tap to follow the live best pair"}</em></span><b>{autoMarketEnabled ? "✓" : ""}</b>
            </button>
            {rankedMarkets.map((option, index) => (
              <button type="button" className={`edge-ref-market-option ${!autoMarketEnabled && symbol === option.value ? "selected" : ""}`} key={option.value} onClick={() => { if (autoMarketEnabled) return; onSymbolChange(option.value); setMarketPickerOpen(false); }} disabled={running || autoMarketEnabled}>
                <span><b>{option.label}</b>{index === 0 && <small>BEST</small>}<em>observed {option.score ? `${option.score.toFixed(0)}%` : "waiting"} · {option.value}</em></span>
                <strong>{option.score ? `${option.score.toFixed(1)}%` : "—"}</strong>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="edge-ref-feature-list">
         <div className={`edge-ref-feature ${overThreeSniper ? "active" : ""}`}>
          <div className="edge-ref-feature-main"><span><i aria-hidden="true" /> Over 3 Best Pair</span><EdgeToggle checked={overThreeSniper} onChange={onOverThreeSniperChange} disabled={false} label="Over 3 Best Pair" /></div>
          {overThreeSniper && <small className="edge-ref-feature-status">{scannerMessage ?? "Hunting all Volatility and Jump pairs for the best observed Over 3 signal…"}</small>}
        </div>
        <div className={`edge-ref-feature ${bestPairAnalyzer ? "active" : ""}`}>
          <div className="edge-ref-feature-main"><span><i aria-hidden="true" /> Best Pair Analyzer</span><EdgeToggle checked={bestPairAnalyzer} onChange={onBestPairAnalyzerChange} disabled={false} label="Best Pair Analyzer" /></div>
          {bestPairAnalyzer && <small className="edge-ref-feature-status">{scannerMessage ?? "Hunting all Volatility and Jump pairs for the best observed Over or Under digit…"}</small>}
        </div>
      </div>

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

      <label className="edge-ref-input-card"><span>Duration</span><div><input type="number" min="1" max="6" step="1" value={duration} onChange={(event) => onDurationChange(Math.min(6, Math.max(1, Math.trunc(Number(event.target.value) || 1))))} disabled={running} /><b>ticks</b></div></label>
      <label className="edge-ref-input-card"><span>Initial stake</span><div><input type="number" min=".35" step=".01" value={stake} onChange={(event) => onStakeChange(Math.max(.35, Number(event.target.value) || .35))} disabled={running} /><b>{currency}</b></div></label>
      <section className="edge-ref-ai-scanner">
        <div><b>AI SCANNER</b><small>Ranks Over vs Under for this market and selected digit using at least 20 live samples. It only changes the direction; it never opens a trade.</small></div>
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

      {isReal && <label className="xt-live-warning"><ShieldAlert size={18} /><input type="checkbox" checked={liveConfirmed} onChange={(event) => onLiveConfirm(event.target.checked)} /><span><b>Live funds confirmation</b>I understand EDGE will place real-money contracts.</span></label>}

      <section className="edge-ref-session"><div><span>Current Stake</span><b>${(strategy === "martingale" ? nextStake : stake).toFixed(2)}</b></div><div><span>Session P/L</span><b className={sessionPnl < 0 ? "loss" : ""}>{sessionPnl >= 0 ? "+" : ""}{sessionPnl.toFixed(2)}</b></div><div><span>Trades</span><b>{sessionTrades}</b></div><p>Runtime stop</p></section>

      <div className="edge-ref-run-row"><button className={`edge-ref-run ${running ? "running" : ""}`} onClick={() => void (running ? onStop() : onStart())} disabled={!isConnected || (!running && !canTrade)}>{running ? <><Pause size={16} fill="currentColor" /> Stop</> : <><Play size={15} fill="currentColor" /> Run</>}</button><button type="button" className="edge-ref-session-reset" onClick={onReset} aria-label="Reset session P/L, trades, and stake to base" title="Reset session"><span aria-hidden="true" /></button></div>

      {canViewHistory && <DerivHistory title="EDGE History" strategy="EDGE Strategy" rows={recentTrades} currency={currentAccount?.currency} fading={historyFading} clearArmed={clearTradesArmed} onClear={() => void onClearHistory()} />}

      <section className="edge-ref-disclaimer"><b>RISK DISCLAIMER</b><p>Deriv offers complex derivatives, such as options and contracts for difference (“CFDs”). These products may not be suitable for all clients, and trading them puts you at risk. Please make sure that you understand the following risks before trading Deriv products: a) you may lose some or all of the money you invest in the trade, b) if your trade involves currency conversion, exchange rates will affect your profit or loss.</p></section>
    </section>
  );
}