import { featureActionControlId } from "@workspace/api-zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pause, Play } from "lucide-react";
import { formatDerivQuote } from "../lib/format-deriv-quote";
import AiScannerAction from "./ai-scanner-action";
import {
  chooseBestEdgeSignal,
  type BestEdgeSignal,
  type MarketSignal,
} from "../lib/trading-sequence";
import {
  clampEdgeMultiplier,
  estimateEdgeWipeout,
} from "../lib/edge-risk";
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
  currentAccount?: { id?: string; currency?: string; balance?: number } | null;
  direction: EdgeDirection;
  onDirectionChange: (value: EdgeDirection) => void;
  barrier: number;
  onBarrierChange: (value: number) => void;
  duration: number;
  onDurationChange: (value: number) => void;
  supportedDurations: readonly number[] | null;
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

const EDGE_PERCENTAGE_SCAN_FLOOR = 50;

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
  supportedDurations,
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
  const [autoSelectBest, setAutoSelectBest] = useState(false);
  const autoSelectedSymbolRef = useRef<string | null>(null);
  const canRunAiScanner =
    isConnected &&
    !running &&
    Number.isInteger(duration) &&
    duration >= 1 &&
    duration <= 5 &&
    Number.isFinite(stake) &&
    stake >= 0.35 &&
    Number.isInteger(barrier) &&
    barrier >= 0 &&
    barrier <= 9;

  const liveSignals = marketSignals as MarketSignal[];
  const bestSignal = useMemo(
    () => chooseBestEdgeSignal(liveSignals, EDGE_PERCENTAGE_SCAN_FLOOR),
    [liveSignals],
  );
  const bestDirection =
    bestSignal?.direction === "DIGITUNDER" ? "Under" : "Over";
  const bestBarrier = bestSignal?.digit ?? barrier;
  const bestRate = bestSignal?.score ?? null;
  const bestMarket =
    markets.find(([value]) => value === (bestSignal?.symbol ?? symbol))?.[1] ??
    "Volatility 100 Index";
  const marketLabel =
    markets.find(([value]) => value === symbol)?.[1] ?? "Volatility 100 Index";
  const rankedMarkets = useMemo(() => {
    const signalMap = new Map(
      marketSignals.map((signal) => [signal.symbol, signal]),
    );
    return markets
      .map(([value, label]) => {
        const signal = signalMap.get(value);
        const outcomes =
          signal?.digit_outcomes?.filter(
            (outcome) => outcome.digit > 0 && outcome.digit < 9,
          ) ?? [];
        const score = signal
          ? Math.max(
              ...outcomes.flatMap((outcome) => [
                Number(outcome.over_percentage),
                Number(outcome.under_percentage),
              ]),
              0,
            )
          : 0;
        return { value, label, score, sampleCount: signal?.sample_count ?? 0 };
      })
      .sort(
        (left, right) =>
          right.score - left.score || left.label.localeCompare(right.label),
      );
  }, [marketSignals, markets]);
  const bestRankedMarket = rankedMarkets.find(
    (option) => option.sampleCount >= 20 && option.score > 0,
  );
  const bestRankedMarketRank = bestRankedMarket
    ? rankedMarkets.indexOf(bestRankedMarket) + 1
    : null;
  useEffect(() => {
    if (!autoSelectBest) {
      autoSelectedSymbolRef.current = null;
      return;
    }
    if (running || !bestRankedMarket || bestRankedMarket.value === symbol)
      return;
    if (autoSelectedSymbolRef.current === bestRankedMarket.value) return;
    autoSelectedSymbolRef.current = bestRankedMarket.value;
    onSymbolChange(bestRankedMarket.value);
  }, [autoSelectBest, bestRankedMarket, onSymbolChange, running, symbol]);
  const quoteText = quote == null ? "—" : formatDerivQuote(quote);
  const payoutText =
    payoutPercent == null || !Number.isFinite(payoutPercent)
      ? "waiting"
      : `${payoutPercent.toFixed(1)}%`;
  const currency = currentAccount?.currency ?? "USD";
  const wipeoutEstimate = estimateEdgeWipeout({
    balance: currentAccount?.balance,
    baseStake: stake,
    currentStake: nextStake,
    strategy,
    multiplier: martingale,
    takeProfit,
    stopLoss,
    sessionPnl,
  });

  const wipeoutMessage =
    wipeoutEstimate.limit === "profit-target-reached"
      ? "The profit threshold is already reached; EDGE should not send another contract."
      : wipeoutEstimate.limit === "session-loss-limit-reached"
        ? "The session loss threshold is already reached; EDGE should not send another contract."
        : wipeoutEstimate.limit === "balance-unavailable"
          ? "Sync a positive account balance to calculate the loss limit."
          : wipeoutEstimate.limit === "invalid-input"
            ? "Set a valid stake, multiplier, and session threshold to calculate the loss limit."
            : wipeoutEstimate.limit === "calculation-cap"
              ? `At least ${wipeoutEstimate.losses?.toLocaleString()} consecutive losses in this estimate.`
              : wipeoutEstimate.limit === "both-limits"
                ? `${wipeoutEstimate.losses} consecutive losses could reach both the account and session loss limits.`
                : wipeoutEstimate.limit === "session-loss-limit"
                  ? `${wipeoutEstimate.losses} consecutive losses could reach the session loss limit.`
                  : wipeoutEstimate.losses === 0
                    ? "The current stake exceeds the available balance; EDGE will not send it."
                    : `${wipeoutEstimate.losses} consecutive losses could leave too little balance for the next stake.`;

  return (
    <section className="edge-reference-layout" data-feature-scope="edge">
      <section className="edge-ref-card edge-ref-scanner">
        <div className="edge-ref-heading">
          <div className="edge-ref-title">
            <span className="edge-ref-spark" aria-hidden="true" />
            <b>Barrier Scanner</b>
            <span className="edge-ref-premium">PREMIUM</span>
          </div>
          <span className="edge-ref-live">
            <i /> LIVE
          </span>
        </div>
        <div className="edge-ref-rule" />
        <div className="edge-ref-best">
          <div className="edge-ref-best-barrier">
            {bestDirection} {bestBarrier}
          </div>
          <div className="edge-ref-best-copy">
            <span>BEST OBSERVED BARRIER RIGHT NOW</span>
            <p>
              <strong>
                {bestRate == null
                  ? "waiting"
                  : `${bestRate.toFixed(1)}% observed`}
              </strong>
              <em>·</em> payout {payoutText} <em>·</em> {bestMarket}
            </p>
          </div>
        </div>
      </section>

      <section
        className={`edge-ref-card edge-ref-market ${marketPickerOpen ? "open" : ""}`}
      >
        <button
          type="button"
          data-feature-action="edge/market-picker"
          className="edge-ref-market-trigger"
          onClick={() => setMarketPickerOpen((open) => !open)}
          aria-expanded={marketPickerOpen}
          disabled={!isConnected}
        >
          <span className="edge-ref-market-icon" aria-hidden="true" />
          <span className="edge-ref-market-copy">
            <small>Market ({autoSelectBest ? "auto" : "manual"})</small>
            <b>{marketLabel}</b>
          </span>
          <ChevronDown size={18} className="edge-ref-market-chevron" />
        </button>
        <label
          className={`edge-ref-auto-market${autoSelectBest ? " active" : ""}`}
        >
          <span>
            <b>Auto select best</b>
            <small>
              {bestRankedMarket
                ? `Rank #${bestRankedMarketRank} · ${bestRankedMarket.label}`
                : "Waiting for 20 live samples"}
            </small>
          </span>
          <input
            data-feature-action="edge/auto-select-best"
            type="checkbox"
            checked={autoSelectBest}
            onChange={(event) => {
              const enabled = event.target.checked;
              setAutoSelectBest(enabled);
              autoSelectedSymbolRef.current = null;
              if (
                enabled &&
                bestRankedMarket &&
                bestRankedMarket.value !== symbol
              ) {
                autoSelectedSymbolRef.current = bestRankedMarket.value;
                onSymbolChange(bestRankedMarket.value);
              }
            }}
            disabled={!isConnected || running || !bestRankedMarket}
            aria-label="Auto select the best-ranked EDGE market"
          />
        </label>
        <label
          className={`edge-sniper-toggle${sniperOverUnder ? " active" : ""}`}
        >
          <span className="edge-sniper-copy">
            <b>Sniper over/under</b>
          </span>
          <span className="edge-sniper-control">
            <span
              className={`edge-sniper-state${sniperOverUnder ? " working" : ""}`}
            >
              {sniperOverUnder ? "WORKING" : "OFF"}
            </span>
            <span className="edge-toggle">
              <input
                data-feature-action="edge/sniper-over-under"
                type="checkbox"
                checked={sniperOverUnder}
                onChange={(event) =>
                  onSniperOverUnderChange(event.target.checked)
                }
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
              <button
                type="button"
                data-feature-action={`edge/${featureActionControlId("market", option.value)}`}
                className={`edge-ref-market-option ${symbol === option.value ? "selected" : ""}`}
                key={option.value}
                onClick={() => {
                  setAutoSelectBest(false);
                  autoSelectedSymbolRef.current = null;
                  onSymbolChange(option.value);
                  setMarketPickerOpen(false);
                }}
                disabled={running}
              >
                <span>
                  <b>{option.label}</b>
                  {option.value === bestRankedMarket?.value && (
                    <small>BEST</small>
                  )}
                  <em>
                    observed{" "}
                    {option.score ? `${option.score.toFixed(0)}%` : "waiting"} ·{" "}
                    {option.value}
                  </em>
                </span>
                <strong>
                  {option.score ? `${option.score.toFixed(1)}%` : "—"}
                </strong>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="edge-ref-card edge-ref-quote">
        <strong>{quoteText}</strong>
        <span>
          Last digit: <b>{lastDigit == null ? "—" : lastDigit}</b>
        </span>
      </section>

      <div className="edge-ref-direction">
        <button
          className={direction === "DIGITOVER" ? "active over" : ""}
          data-feature-action="edge/direction-over"
          onClick={() => onDirectionChange("DIGITOVER")}
          disabled={running}
        >
          Over
        </button>
        <button
          className={direction === "DIGITUNDER" ? "active under" : ""}
          data-feature-action="edge/direction-under"
          onClick={() => onDirectionChange("DIGITUNDER")}
          disabled={running}
        >
          Under
        </button>
      </div>

      <section className="edge-ref-card edge-ref-digit-card">
        <span className="edge-ref-field-label">
          Last digit prediction · live market highlight
        </span>
        <div className="edge-ref-digit-picker">
          {Array.from({ length: 10 }, (_, digit) => {
            const isMarketDigit = lastDigit === digit;
            return (
              <button
                type="button"
                data-feature-action={`edge/digit-${digit}`}
                key={digit}
                className={`${barrier === digit ? "active " : ""}${isMarketDigit ? "market" : ""}`}
                onClick={() => onBarrierChange(digit)}
                disabled={running}
                aria-label={`Barrier digit ${digit}${isMarketDigit ? ", current market digit" : ""}`}
                title={isMarketDigit ? "Current market digit" : undefined}
              >
                {digit}
              </button>
            );
          })}
        </div>
      </section>

      <div className="edge-ref-duration-field">
        <span>Duration · ticks</span>
        <div
          className="edge-ref-duration-options"
          role="group"
          aria-label="EDGE duration in ticks"
        >
          {[1, 2, 3, 4, 5].map((ticks) => (
            <button
              type="button"
              key={ticks}
              className={duration === ticks ? "active" : ""}
              aria-pressed={duration === ticks}
              onClick={() => onDurationChange(ticks)}
              disabled={running || (supportedDurations !== null && !supportedDurations.includes(ticks))}
              data-testid={`edge-duration-${ticks}`}
            >
              {ticks}
            </button>
          ))}
        </div>
        {supportedDurations !== null && (
          <p className="edge-ref-duration-availability" role="status">
            {supportedDurations.length
              ? `Available from Deriv: ${supportedDurations.join(", ")} ticks`
              : "No tick durations are currently quoted for this setup"}
          </p>
        )}
      </div>
      <label className="edge-ref-input-card">
        <span>Initial stake</span>
        <div>
          <input
            type="number"
            min=".35"
            step=".01"
            value={stake}
            onChange={(event) =>
              onStakeChange(Math.max(0.35, Number(event.target.value) || 0.35))
            }
            disabled={running}
          />
          <b>{currency}</b>
        </div>
      </label>
      <section className="edge-ref-ai-scanner">
        <AiScannerAction
          feature="edge"
          onScan={onAiScan}
          disabled={!canRunAiScanner}
          actionLabel="AI Scanner"
          messageAutoDismissMs={3000}
        />
      </section>

      <section className="edge-ref-card edge-ref-setup">
        <h2>Strategy parameters</h2>
        <label>
          <span>Strategy</span>
          <div>
            <select
              value={strategy}
              onChange={(event) =>
                onStrategyChange(event.target.value as EdgeStrategy)
              }
              disabled={running}
            >
              <option value="martingale">Martingale</option>
              <option value="flat">Flat stake</option>
            </select>
            <ChevronDown size={16} />
          </div>
        </label>
        <label>
          <span>Stake multiplier</span>
          <div>
            <input
              type="number"
              min="1"
              max="10"
              step=".1"
              value={martingale}
              onChange={(event) =>
                onMartingaleChange(
                  clampEdgeMultiplier(Number(event.target.value)),
                )
              }
              disabled={running || strategy === "flat"}
            />
            <b>x</b>
          </div>
        </label>
      </section>

      <section className="edge-ref-card edge-ref-risk">
        <h2>Risk management</h2>
        <label>
          <span>Profit threshold</span>
          <div>
            <input
              type="number"
              min=".01"
              step=".01"
              value={takeProfit}
              onChange={(event) =>
                onTakeProfitChange(
                  Math.max(0.01, Number(event.target.value) || 0.01),
                )
              }
              disabled={running}
            />
            <b>{currency}</b>
          </div>
        </label>
        <label>
          <span>Loss threshold</span>
          <div>
            <input
              type="number"
              min=".01"
              step=".01"
              value={stopLoss}
              onChange={(event) =>
                onStopLossChange(
                  Math.max(0.01, Number(event.target.value) || 0.01),
                )
              }
              disabled={running}
            />
            <b>{currency}</b>
          </div>
        </label>
        <p className="edge-ref-callout danger edge-ref-wipeout">
          <b>Wipeout radar</b>
          <strong>{wipeoutMessage}</strong>
          <small>
            Each losing contract risks its full stake. Observed rates and past
            results do not predict the next outcome.
          </small>
        </p>
      </section>

      <section className="edge-ref-session">
        <div>
          <span>Current Stake</span>
          <b>
            {(strategy === "martingale" ? nextStake : stake).toFixed(2)}{" "}
            {currency}
          </b>
        </div>
        <div>
          <span>Session P/L</span>
          <b className={sessionPnl < 0 ? "loss" : ""}>
            {sessionPnl >= 0 ? "+" : ""}
            {sessionPnl.toFixed(2)} {currency}
          </b>
        </div>
        <div>
          <span>Trades</span>
          <b>{sessionTrades}</b>
        </div>
      </section>

      <div className="edge-ref-run-row">
        <button
          data-feature-action={running ? "edge/stop" : "edge/start"}
          className={`edge-ref-run ${running ? "running" : ""}`}
          onClick={() => void (running ? onStop() : onStart())}
          disabled={!isConnected || (!running && !canTrade)}
        >
          {running ? (
            <>
              <Pause size={16} fill="currentColor" /> Stop
            </>
          ) : (
            <>
              <Play size={15} fill="currentColor" /> Run
            </>
          )}
        </button>
        <button
          type="button"
          data-feature-action="edge/reset"
          className="edge-ref-session-reset"
          onClick={onReset}
          aria-label="Reset session P/L, trades, and stake to base"
          title="Reset session"
        >
          <span aria-hidden="true" />
        </button>
      </div>

      {canViewHistory && (
        <DerivHistory
          title="EDGE History"
          strategy="EDGE Strategy"
          rows={recentTrades}
          sessionRows={sessionRows}
          currency={currentAccount?.currency}
          sessionPnl={sessionPnl}
          sessionTradeCount={sessionTrades}
          fading={historyFading}
          clearArmed={clearTradesArmed}
          onClear={() => void onClearHistory()}
        />
      )}

      <section className="edge-ref-disclaimer">
        <b>TRADING RISK</b>
        <p>
          Options and CFDs are risky. You may lose some or all of your money;
          currency conversion can affect results.
        </p>
      </section>
    </section>
  );
}
