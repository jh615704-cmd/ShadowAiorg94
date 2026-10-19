import { useMemo, useState } from "react";
import {
  ChevronDown,
  CircleStop,
  Play,
  RefreshCw,
  RotateCcw,
  Zap,
} from "lucide-react";
import { formatDerivQuote } from "../lib/format-deriv-quote";
import AiScannerAction from "./ai-scanner-action";
import "./digit-flip-panel.css";

export type DigitFlipParity = "DIGITEVEN" | "DIGITODD";
export type DigitFlipMarketType = "auto" | "volatility" | "jumps";
export type DigitFlipDuration = 1 | 2 | 3 | 4 | 5 | 6;
export type DigitFlipStakeMode = "flat" | "martingale";

export type DigitFlipMarketSignal = {
  symbol: string;
  evenPercentage: number;
  oddPercentage: number;
  sampleCount: number;
};

export type DigitFlipPanelProps = {
  enabled: boolean;
  marketType: DigitFlipMarketType;
  symbol: string;
  symbols: readonly { value: string; label: string; marketType: DigitFlipMarketType }[];
  marketSignals: readonly DigitFlipMarketSignal[];
  quote?: number | null;
  lastDigit?: number | null;
  evenPercentage: number;
  oddPercentage: number;
  sampleCount: number;
  selectedParity: DigitFlipParity;
  duration: DigitFlipDuration;
  stake: number;
  stakeMode: DigitFlipStakeMode;
  multiplier: number;
  takeProfit: number;
  stopLoss: number;
  running: boolean;
  currentStake: number;
  assaultEnabled: boolean;
  magicEnabled: boolean;
  isPlacingTrade?: boolean;
  entryBlocked?: boolean;
  disabled?: boolean;
  onMarketTypeChange: (value: DigitFlipMarketType) => void;
  onSymbolChange: (value: string) => void;
  onParityChange: (value: DigitFlipParity) => void;
  onDurationChange: (value: DigitFlipDuration) => void;
  onStakeChange: (value: number) => void;
  onStakeModeChange: (value: DigitFlipStakeMode) => void;
  onMultiplierChange: (value: number) => void;
  onTakeProfitChange: (value: number) => void;
  onStopLossChange: (value: number) => void;
  onRunStop: () => void;
  onAiScan: () => Promise<string>;
  onReset: () => void;
  onRefreshSample: () => void;
  onAssaultChange: (value: boolean) => void;
  onMagicChange: (value: boolean) => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function PremiumPill() {
  return <span className="df-premium">PREMIUM</span>;
}

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <label className="df-toggle-control" aria-label={label}>
      <span className="df-toggle-state">{checked ? "ON" : "OFF"}</span>
      <span className="df-toggle">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        <i />
      </span>
    </label>
  );
}

export default function DigitFlipPanel({
  enabled,
  marketType,
  symbol,
  symbols,
  marketSignals,
  quote = null,
  lastDigit = null,
  evenPercentage,
  oddPercentage,
  sampleCount,
  selectedParity,
  duration,
  stake,
  stakeMode,
  multiplier,
  takeProfit,
  stopLoss,
  running,
  currentStake,
  assaultEnabled,
  magicEnabled,
  isPlacingTrade = false,
  entryBlocked = false,
  disabled = false,
  onMarketTypeChange,
  onSymbolChange,
  onParityChange,
  onDurationChange,
  onStakeChange,
  onStakeModeChange,
  onMultiplierChange,
  onTakeProfitChange,
  onStopLossChange,
  onRunStop,
  onAiScan,
  onReset,
  onRefreshSample,
  onAssaultChange,
  onMagicChange,
}: DigitFlipPanelProps) {
  const [marketPickerOpen, setMarketPickerOpen] = useState(false);

  const activeSymbols = marketType === "auto"
    ? symbols
    : symbols.filter((option) => option.marketType === marketType);

  const rankedSignals = useMemo(() => {
    const bySymbol = new Map(marketSignals.map((signal) => [signal.symbol, signal]));
    return activeSymbols
      .map((option) => ({ option, signal: bySymbol.get(option.value) }))
      .sort((left, right) => {
        const leftRate = Math.max(left.signal?.evenPercentage ?? 0, left.signal?.oddPercentage ?? 0);
        const rightRate = Math.max(right.signal?.evenPercentage ?? 0, right.signal?.oddPercentage ?? 0);
        return rightRate - leftRate;
      })
      .slice(0, 4);
  }, [activeSymbols, marketSignals]);

  const bestSignal = useMemo(() => {
    const eligibleSignals = marketSignals.filter((signal) => activeSymbols.some((option) => option.value === signal.symbol));
    if (!eligibleSignals.length) return undefined;
    return eligibleSignals.reduce((best, candidate) => {
      const bestRate = Math.max(best.evenPercentage, best.oddPercentage);
      const candidateRate = Math.max(candidate.evenPercentage, candidate.oddPercentage);
      return candidateRate > bestRate ? candidate : best;
    });
  }, [activeSymbols, marketSignals]);

  const bestParity: DigitFlipParity = bestSignal && bestSignal.oddPercentage > bestSignal.evenPercentage
    ? "DIGITODD"
    : "DIGITEVEN";
  const bestRate = bestSignal
    ? Math.max(bestSignal.evenPercentage, bestSignal.oddPercentage)
    : Math.max(evenPercentage, oddPercentage);
  const lastParity = lastDigit == null ? null : lastDigit % 2 === 0 ? "Even" : "Odd";
  const currentQuote = quote == null ? "—" : formatDerivQuote(quote);
  const runText = lastParity ? `Run: ${lastParity.toLowerCase()} · latest tick: ${lastDigit}` : "Waiting for live digit sample";
  const displayedSymbol = marketType === "auto" ? bestSignal?.symbol ?? symbol : symbol;
  const marketLabel = symbols.find((option) => option.value === displayedSymbol)?.label ?? displayedSymbol;
  const bestLabel = symbols.find((option) => option.value === bestSignal?.symbol)?.label
    ?? marketLabel
    ?? "Volatility 100 Index";
  const renderMarketRate = (signal?: DigitFlipMarketSignal) => {
    if (!signal) return "—";
    const rate = selectedParity === "DIGITEVEN" ? signal.evenPercentage : signal.oddPercentage;
    return `${rate.toFixed(1)}%`;
  };

  return (
    <section className={`df-panel ${enabled ? "df-panel-active" : ""} ${disabled ? "df-panel-disabled" : ""}`} data-testid="digit-flip-panel">
      <section className="df-card df-scanner">
        <div className="df-card-heading">
          <div className="df-title">
            <span className="df-spark" aria-hidden="true"><Zap size={14} fill="currentColor" /></span>
            <b>Parity Scanner</b>
            <PremiumPill />
          </div>
          <span className="df-live"><i /> LIVE</span>
        </div>
        <div className="df-rule" />
        <div className="df-best-signal">
          <div className={`df-best-parity ${bestParity === "DIGITODD" ? "odd" : "even"}`}>
            {bestParity === "DIGITODD" ? "Odd" : "Even"} <span>{bestParity === "DIGITODD" ? "o" : "•"}</span>
          </div>
          <div className="df-best-copy">
            <span>BEST PARITY TO TRADE NOW</span>
            <p><strong>{bestRate.toFixed(1)}% score</strong><em>·</em> payout varies by quote <em>·</em> {bestLabel}</p>
          </div>
        </div>
      </section>

      <section className={`df-card df-market-card ${marketPickerOpen ? "open" : ""}`}>
        <button
          type="button"
          className="df-market-trigger"
          onClick={() => setMarketPickerOpen((value) => !value)}
          aria-expanded={marketPickerOpen}
          disabled={disabled}
        >
          <span className="df-market-icon" aria-hidden="true">▥</span>
          <span className="df-market-copy">
            <small>Market {marketType === "auto" ? "(auto-selected)" : "(manual)"}</small>
            <b>{marketLabel || "Volatility 100 Index"}</b>
          </span>
          <ChevronDown size={18} className="df-market-chevron" />
        </button>
        {marketPickerOpen && (
          <div className="df-market-menu">
            <button
              type="button"
              className={`df-market-option df-market-smart ${marketType === "auto" ? "selected" : ""}`}
              onClick={() => {
                onMarketTypeChange("auto");
                setMarketPickerOpen(false);
              }}
              disabled={disabled}
            >
              <span>ϟ Auto-select best (smart)</span>
              <b>✓</b>
            </button>
            {rankedSignals.map(({ option, signal }, index) => {
              const rate = selectedParity === "DIGITEVEN" ? signal?.evenPercentage ?? 50 : signal?.oddPercentage ?? 50;
              return (
                <button
                  type="button"
                   className={`df-market-option ${(marketType === "auto" ? displayedSymbol : symbol) === option.value ? "selected" : ""}`}
                  key={option.value}
                  onClick={() => {
                    onMarketTypeChange(option.marketType);
                    onSymbolChange(option.value);
                    setMarketPickerOpen(false);
                  }}
                  disabled={disabled}
                >
                  <span>
                    <b>{option.label}</b>
                    {index === 0 && <small>BEST</small>}
                    <em>recent {rate.toFixed(0)}% · payout varies by quote · 200 ticks</em>
                  </span>
                  <strong>{renderMarketRate(signal)}</strong>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="df-card df-toggle-card">
        <div className="df-toggle-copy">
          <div className="df-title"><span className="df-spark" aria-hidden="true"><Zap size={14} fill="currentColor" /></span><b>Flip Switch</b><PremiumPill /></div>
          {assaultEnabled && <p className="df-running-note"><i /> Reading live digits &amp; trading the leading parity…</p>}
        </div>
        <Switch checked={assaultEnabled} onChange={onAssaultChange} disabled={disabled} label="Flip Switch" />
      </section>

      <section className={`df-card df-toggle-card df-pair-card ${magicEnabled ? "active" : ""}`}>
        <div className="df-toggle-copy">
          <div className="df-title"><span className="df-spark" aria-hidden="true"><Zap size={14} fill="currentColor" /></span><b>Auto Switch Best Pair</b><PremiumPill /></div>
          {magicEnabled && <p className="df-running-note"><i /> Hunting the best pair between trades — never mid-trade…</p>}
        </div>
        <Switch checked={magicEnabled} onChange={onMagicChange} disabled={disabled} label="Auto Switch Best Pair" />
      </section>

      <section className="df-card df-quote-card">
        <div className="df-quote-value">{currentQuote} <small>{lastDigit == null ? "" : lastDigit}</small></div>
        <div className="df-quote-last">Last digit: <b className={lastParity === "Odd" ? "odd" : "even"}>{lastParity ?? "Waiting"} {lastParity ? (lastParity === "Odd" ? "o" : "•") : ""}</b></div>
        <div className="df-quote-run">{runText}</div>
      </section>

      <section className="df-card df-parity-toggle">
        <button
          type="button"
          className={selectedParity === "DIGITEVEN" ? "selected even" : "even"}
          onClick={() => onParityChange("DIGITEVEN")}
          disabled={disabled}
        >
          Even <span>•</span>
        </button>
        <button
          type="button"
          className={selectedParity === "DIGITODD" ? "selected odd" : "odd"}
          onClick={() => onParityChange("DIGITODD")}
          disabled={disabled}
        >
          Odd <span>o</span>
        </button>
      </section>

      <section className="df-card df-parity-card">
        <div className="df-section-label">Live parity — recent digits</div>
        <div className="df-parity-track" role="img" aria-label={`${evenPercentage.toFixed(0)} percent Even and ${oddPercentage.toFixed(0)} percent Odd`}>
          <i className="even" style={{ width: `${clamp(evenPercentage, 0, 100)}%` }} />
          <i className="odd" style={{ width: `${clamp(oddPercentage, 0, 100)}%` }} />
        </div>
        <div className="df-parity-labels">
          <span>• Even <b>{evenPercentage.toFixed(0)}%</b></span>
          <span>o Odd <b>{oddPercentage.toFixed(0)}%</b></span>
        </div>
      </section>

      <section className="df-card df-advanced-card">
        <div className="df-advanced-head">
          <div>
            <div className="df-section-label">Trade setup</div>
            <h3>Stake and session limits</h3>
          </div>
          <button type="button" className="df-refresh" onClick={onRefreshSample} disabled={disabled}><RefreshCw size={13} /> Refresh</button>
        </div>
        <div className="df-setup-grid">
          <label><span>STAKE</span><input type="number" min=".5" step=".01" value={stake} onChange={(event) => onStakeChange(Math.max(.5, Number(event.target.value) || .5))} disabled={disabled || running} /></label>
          <label className="df-duration-field">
            <span>DURATION / TICKS</span>
            <div className="df-duration-options" role="group" aria-label="DigitFlip duration">
              {[1, 2, 3, 4, 5, 6].map((tick) => (
                <button
                  type="button"
                  key={tick}
                  className={duration === tick ? "active" : ""}
                  onClick={() => onDurationChange(tick as DigitFlipDuration)}
                  disabled={disabled || running}
                  aria-pressed={duration === tick}
                  data-testid={`digit-flip-duration-${tick}`}
                >
                  {tick}<small>T</small>
                </button>
              ))}
            </div>
          </label>
          <label><span>STAKE MODE</span><select value={stakeMode} onChange={(event) => onStakeModeChange(event.target.value as DigitFlipStakeMode)} disabled={disabled || running}><option value="flat">Flat stake</option><option value="martingale">Martingale</option></select></label>
          <label><span>MULTIPLIER</span><input type="number" min="1" step=".1" value={multiplier} onChange={(event) => onMultiplierChange(Math.max(1, Number(event.target.value) || 1))} disabled={disabled || running || stakeMode === "flat"} /></label>
          <label><span>TAKE PROFIT</span><input type="number" min=".01" step=".01" value={takeProfit} onChange={(event) => onTakeProfitChange(Math.max(.01, Number(event.target.value) || .01))} disabled={disabled || running} /></label>
          <label><span>STOP LOSS</span><input type="number" min=".01" step=".01" value={stopLoss} onChange={(event) => onStopLossChange(Math.max(.01, Number(event.target.value) || .01))} disabled={disabled || running} /></label>
        </div>
        <AiScannerAction onScan={onAiScan} disabled={disabled || isPlacingTrade || running || entryBlocked} />
        <div className="df-action-row">
          <button type="button" className={running ? "df-stop" : "df-run"} onClick={onRunStop} disabled={disabled || isPlacingTrade || (!running && entryBlocked)}>{running ? <><CircleStop size={16} /> Stop DigitFlip</> : <><Play size={16} fill="currentColor" /> Run DigitFlip</>}</button>
          <button type="button" className="df-reset" onClick={onReset} disabled={disabled}><RotateCcw size={15} /> Reset</button>
        </div>
      </section>

    </section>
  );
}