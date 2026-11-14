import { useMemo, useState, type PointerEvent } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  CandlestickChart,
  Check,
  ChevronDown,
  CircleHelp,
  Crosshair,
  Minus,
  Radar,
  RotateCcw,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import DerivHistory, { type DerivHistoryRow } from "../components/deriv-history";
import "./matrix-panel.css";

export type MatrixDirection = "HIGHER" | "LOWER";
export type MatrixDuration = "10t" | "20t" | "1m" | "3m" | "5m" | "10m" | "30m" | "1h";
export type MatrixChartType = "line" | "candles";

export type MatrixMarketOption = {
  symbol: string;
  label: string;
  family: "Boom" | "Crash" | "Bull" | "Bear";
  bias: "up" | "down";
};

export type MatrixChartTick = { epoch: number; quote: number; sequence: number };
export type MatrixMarketSignal = {
  symbol: string;
  quotes: MatrixChartTick[];
  percentage: number | null;
  sampleCount: number;
};

export type MatrixOpenTradeView = {
  contractId: string;
  symbol: string;
  direction: MatrixDirection;
  stake: number;
  payout: number;
  profit: number;
  status: string;
  countdown: string;
  elapsed: string;
};

type MatrixPanelProps = {
  markets: MatrixMarketOption[];
  marketSignals: MatrixMarketSignal[];
  selectedSymbol: string;
  onSelectMarket: (symbol: string) => void;
  chartType: MatrixChartType;
  onChartTypeChange: (value: MatrixChartType) => void;
  direction: MatrixDirection;
  onDirectionChange: (value: MatrixDirection) => void;
  duration: MatrixDuration;
  onDurationChange: (value: MatrixDuration) => void;
  durationAvailability: {
    status: "checking" | "ready" | "error";
    supported: readonly MatrixDuration[];
    message?: string;
  };
  onRefreshDurations: () => void;
  stake: number;
  onStakeChange: (value: number) => void;
  tradeCount: number;
  onTradeCountChange: (value: number) => void;
  takeProfitPerTrade: number;
  onTakeProfitPerTradeChange: (value: number) => void;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  onSetChartLevel: (kind: "take-profit" | "stop-loss", price: number | null) => void;
  levelMode: "take-profit" | "stop-loss" | null;
  onLevelModeChange: (value: "take-profit" | "stop-loss" | null) => void;
  scannerEnabled: boolean;
  onScannerEnabledChange: (value: boolean) => void;
  scannerBusy: boolean;
  scannerStatus: string;
  scannerRecommendation: {
    symbol: string;
    direction: MatrixDirection;
    duration: MatrixDuration;
    percentage: number;
    sampleCount: number;
  } | null;
  connected: boolean;
  streamConnected?: boolean;
  accountLabel: string;
  currency: string;
  quote: number | null;
  tradeBusy: boolean;
  canTrade: boolean;
  statusMessage: string | null;
  onPlaceTrade: () => void;
  historyRows: readonly DerivHistoryRow[];
  sessionRows: readonly DerivHistoryRow[];
  openTrades: readonly MatrixOpenTradeView[];
  onClearHistory: () => void;
  clearArmed: boolean;
  historyFading: boolean;
};

const durations: MatrixDuration[] = ["10t", "20t", "1m", "3m", "5m", "10m", "30m", "1h"];
const money = (amount: number, currency: string) =>
  currency === "USD" ? `$${amount.toFixed(2)}` : `${currency} ${amount.toFixed(2)}`;
const priceFormat = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 });
const action = (name: string) => ({ "data-feature-scope": "matrix", "data-feature-action": `matrix/${name}` });

function smoothPath(points: readonly { x: number; y: number }[]) {
  if (points.length < 2) return "";
  let path = `M${points[0].x},${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[Math.min(points.length - 1, index + 2)];
    const firstControlX = current.x + (next.x - previous.x) / 6;
    const firstControlY = current.y + (next.y - previous.y) / 6;
    const secondControlX = next.x - (afterNext.x - current.x) / 6;
    const secondControlY = next.y - (afterNext.y - current.y) / 6;
    path += ` C${firstControlX},${firstControlY} ${secondControlX},${secondControlY} ${next.x},${next.y}`;
  }
  return path;
}

export function MatrixPanel(props: MatrixPanelProps) {
  const {
    markets, marketSignals, selectedSymbol, onSelectMarket, chartType, onChartTypeChange,
    direction, onDirectionChange, duration, onDurationChange, durationAvailability,
    onRefreshDurations, stake, onStakeChange,
    tradeCount, onTradeCountChange, takeProfitPerTrade, onTakeProfitPerTradeChange,
    takeProfitPrice, stopLossPrice, onSetChartLevel, levelMode, onLevelModeChange,
    scannerEnabled, onScannerEnabledChange, scannerBusy, scannerStatus, scannerRecommendation,
    connected, streamConnected = connected, accountLabel, currency, quote, tradeBusy, canTrade, statusMessage, onPlaceTrade,
    historyRows, sessionRows, openTrades, onClearHistory, clearArmed, historyFading,
  } = props;
  const [guideOpen, setGuideOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const signal = marketSignals.find((item) => item.symbol === selectedSymbol);
  const market = markets.find((item) => item.symbol === selectedSymbol);
  const ticks = useMemo(() => (signal?.quotes ?? []).slice(-60), [signal]);
  const chart = useMemo(() => {
    if (!ticks.length) return { path: "", points: [] as { x: number; y: number; quote: number }[], min: 0, max: 1 };
    const values = ticks.map((tick) => tick.quote);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max((max - min) * 0.18, Math.abs(max) * 0.000025, 0.00001);
    const low = min - pad;
    const high = max + pad;
    const points = ticks.map((tick, index) => ({
      x: 14 + index * (758 / Math.max(1, ticks.length - 1)),
      y: 22 + ((high - tick.quote) / (high - low)) * 256,
      quote: tick.quote,
    }));
    return { path: smoothPath(points), points, min: low, max: high };
  }, [ticks]);
  const latest = quote ?? ticks.at(-1)?.quote ?? null;
  const canSubmit = connected && canTrade && !tradeBusy && stake >= 1 && tradeCount >= 1;
  const candles = useMemo(() => {
    const groups: MatrixChartTick[][] = [];
    const groupSize = Math.max(1, Math.ceil(ticks.length / 30));
    for (let index = 0; index < ticks.length; index += groupSize) {
      groups.push(ticks.slice(index, index + groupSize));
    }
    const spacing = 760 / Math.max(1, groups.length);
    return groups.map((group, index) => ({
      x: 20 + (index + 0.5) * spacing,
      width: Math.min(22, spacing * 0.68),
      open: group[0].quote,
      close: group[group.length - 1].quote,
      high: Math.max(...group.map((tick) => tick.quote)),
      low: Math.min(...group.map((tick) => tick.quote)),
    }));
  }, [ticks]);

  const setLevelFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (!levelMode || !chart.points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * 800;
    const svgY = ((event.clientY - bounds.top) / bounds.height) * 300;
    if (svgX > 786 || svgY < 22 || svgY > 278) return;
    const price = chart.max - ((svgY - 22) / 256) * (chart.max - chart.min);
    onSetChartLevel(levelMode, Number(price.toPrecision(8)));
    onLevelModeChange(null);
  };

  const setRecommendation = () => {
    if (!scannerRecommendation) return;
    onSelectMarket(scannerRecommendation.symbol);
    onDirectionChange(scannerRecommendation.direction);
    onDurationChange(scannerRecommendation.duration);
  };

  return (
    <section className="matrix-panel" aria-label="Shadow Matrix trading panel" data-testid="matrix-panel" data-feature-scope="matrix">
      <header className="matrix-head">
        <div className="matrix-brand-lockup">
          <span className="matrix-brand-mark"><Activity size={19} /></span>
          <div>
            <div className="matrix-title-line"><h2>SHADOW <b>MATRIX</b></h2><span className="matrix-tag">LIVE TRADING</span></div>
            <p>Boom · Crash · Bull · Bear <i /> Synthetic markets</p>
          </div>
        </div>
        <div className={`matrix-connection ${connected ? "is-connected" : ""}`} data-testid="matrix-connection-status">
          <i />{connected ? "ACCOUNT CONNECTED" : "OFFLINE"}
          <span>{accountLabel || "No account"}</span>
        </div>
      </header>

      <div className="matrix-workspace">
        <main className="matrix-primary">
          <section className="matrix-chart-card">
            <div className="matrix-chart-top">
              <div className="matrix-symbol-wrap">
                <button type="button" className="matrix-symbol-trigger" {...action("market-picker")} data-testid="matrix-market-picker"
                  onClick={() => setMarketOpen((open) => !open)} disabled={!connected} aria-expanded={marketOpen}>
                  <span className={`matrix-family-mark ${(market?.family ?? "Bull").toLowerCase()}`}>{market?.family?.slice(0, 1) ?? "M"}</span>
                  <span><small>ACTIVE MARKET</small><b>{market?.label ?? selectedSymbol}</b><em>{selectedSymbol}</em></span>
                  <ChevronDown size={16} />
                </button>
                {marketOpen && <div className="matrix-market-menu" role="listbox" aria-label="Synthetic markets">
                  {markets.map((item) => {
                    const itemSignal = marketSignals.find((entry) => entry.symbol === item.symbol);
                    return <button key={item.symbol} type="button" role="option" aria-selected={selectedSymbol === item.symbol}
                      className={selectedSymbol === item.symbol ? "selected" : ""} {...action(`market-${item.symbol.toLowerCase()}`)}
                      data-testid={`matrix-market-${item.symbol}`} onClick={() => { onSelectMarket(item.symbol); setMarketOpen(false); }}>
                      <span className={`matrix-family-mark ${item.family.toLowerCase()}`}>{item.family.slice(0, 1)}</span><span><b>{item.label}</b><small>{item.symbol} · {item.family}</small></span>
                      <strong>{itemSignal?.percentage == null ? "—" : `${item.bias === "up" ? itemSignal.percentage.toFixed(1) : (100 - itemSignal.percentage).toFixed(1)}%`}</strong>
                    </button>;
                  })}
                </div>}
              </div>
              <div className="matrix-quote-block" aria-live="polite" data-testid="matrix-live-quote">
                <small>LIVE QUOTE</small><strong>{latest == null ? "—" : priceFormat(latest)}</strong><em>{currency}</em>
              </div>
              <div className="matrix-chart-switch" role="group" aria-label="Chart display">
                <button type="button" {...action("chart-line")} data-testid="matrix-chart-line" className={chartType === "line" ? "active" : ""}
                  aria-pressed={chartType === "line"} onClick={() => onChartTypeChange("line")}><Activity size={14} />Line</button>
                <button type="button" {...action("chart-candles")} data-testid="matrix-chart-candles" className={chartType === "candles" ? "active" : ""}
                  aria-pressed={chartType === "candles"} onClick={() => onChartTypeChange("candles")}><CandlestickChart size={14} />Candles</button>
              </div>
            </div>

            <div className="matrix-chart-plot-wrap">
              <div className="matrix-chart-canvas" data-testid="matrix-chart-area">
                <svg className={`matrix-chart-svg ${levelMode ? "placing-level" : ""}`} viewBox="0 0 800 300" preserveAspectRatio="none"
                  role="img" aria-label={`${market?.label ?? selectedSymbol} live ${chartType} chart`}
                  data-feature-scope="matrix" data-feature-action="matrix/chart-level-placement"
                  onPointerDown={setLevelFromPointer} onTouchStart={(event) => { if (levelMode) event.preventDefault(); }}>
                  <defs>
                    <linearGradient id="matrix-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#55d7bc" stopOpacity=".2" /><stop offset="100%" stopColor="#55d7bc" stopOpacity="0" /></linearGradient>
                    <linearGradient id="matrix-candle-up-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8af0be" /><stop offset="100%" stopColor="#38b985" /></linearGradient>
                    <linearGradient id="matrix-candle-down-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#ff9da7" /><stop offset="100%" stopColor="#dc5e72" /></linearGradient>
                  </defs>
                  {[0, 1, 2, 3, 4].map((line) => <line key={line} x1="0" x2="800" y1={20 + line * 65} y2={20 + line * 65} className="matrix-grid-line" />)}
                  {[0, 1, 2, 3, 4, 5].map((line) => <line key={`v${line}`} x1={line * 160} x2={line * 160} y1="0" y2="300" className="matrix-grid-line vertical" />)}
                  {chartType === "line" && chart.points.length > 1 && <>
                    <path d={`${chart.path} L${chart.points.at(-1)?.x},298 L${chart.points[0].x},298 Z`} fill="url(#matrix-chart-fill)" />
                    <path d={chart.path} className="matrix-line-glow" />
                    <path d={chart.path} className="matrix-line-path" />
                    <circle cx={chart.points.at(-1)?.x} cy={chart.points.at(-1)?.y} r="8" className="matrix-live-point-halo" />
                    <circle cx={chart.points.at(-1)?.x} cy={chart.points.at(-1)?.y} r="3.5" className="matrix-live-point" />
                  </>}
                  {chartType === "candles" && candles.map((candle, index) => {
                    const y = (value: number) => 22 + ((chart.max - value) / (chart.max - chart.min || 1)) * 256;
                    const rising = candle.close >= candle.open;
                    const bodyTop = Math.min(y(candle.open), y(candle.close));
                    return <g key={index} className={rising ? "matrix-candle-up" : "matrix-candle-down"}>
                      <line x1={candle.x} x2={candle.x} y1={y(candle.high)} y2={y(candle.low)} />
                      <rect x={candle.x - candle.width / 2} y={bodyTop} width={candle.width} height={Math.max(4, Math.abs(y(candle.close) - y(candle.open)))} rx="2" fill={rising ? "url(#matrix-candle-up-fill)" : "url(#matrix-candle-down-fill)"} />
                    </g>;
                  })}
                  {takeProfitPrice != null && chart.max > chart.min && <g className="matrix-level-tp">
                    <line x1="0" x2="800" y1={22 + ((chart.max - takeProfitPrice) / (chart.max - chart.min)) * 256} y2={22 + ((chart.max - takeProfitPrice) / (chart.max - chart.min)) * 256} />
                  </g>}
                  {stopLossPrice != null && chart.max > chart.min && <g className="matrix-level-sl">
                    <line x1="0" x2="800" y1={22 + ((chart.max - stopLossPrice) / (chart.max - chart.min)) * 256} y2={22 + ((chart.max - stopLossPrice) / (chart.max - chart.min)) * 256} />
                  </g>}
                  {chart.points.length < 2 && <text x="400" y="152" textAnchor="middle" className="matrix-chart-empty">{connected && streamConnected ? "Waiting for market ticks" : connected ? "Waiting for live stream" : "Connect Deriv for live prices"}</text>}
                </svg>
                <div className="matrix-price-axis" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((line) => {
                    const price = chart.max - (chart.max - chart.min) * (line / 4);
                    return <span key={line}>{chart.points.length ? priceFormat(price) : "—"}</span>;
                  })}
                </div>
                {levelMode && <div className="matrix-chart-instruction"><Crosshair size={14} />Tap chart to place {levelMode === "take-profit" ? "take-profit" : "stop-loss"} level <button type="button" {...action("level-cancel")} data-testid="matrix-level-cancel" onClick={() => onLevelModeChange(null)} aria-label="Cancel chart level placement"><X size={14} /></button></div>}
              </div>
              <div className="matrix-chart-footer"><span><i className={streamConnected ? "live" : ""} />{streamConnected ? "LIVE" : "PAUSED"}</span><span>{signal?.sampleCount ?? 0} ticks sampled</span><span>{ticks.at(-1)?.epoch ? new Date(ticks.at(-1)!.epoch * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</span></div>
            </div>

            <div className="matrix-level-tools">
              <div className="matrix-level-instruction"><Crosshair size={15} /><span><b>Chart levels</b><small>Choose a level, then tap the chart to place it.</small></span></div>
              <div className="matrix-level-buttons">
                <button type="button" className={`matrix-level-btn tp ${levelMode === "take-profit" ? "active" : ""}`} {...action("level-take-profit")} data-testid="matrix-level-take-profit"
                  aria-pressed={levelMode === "take-profit"} onClick={() => onLevelModeChange(levelMode === "take-profit" ? null : "take-profit")}><TrendingUp size={14} />TP {takeProfitPrice == null ? "—" : priceFormat(takeProfitPrice)}</button>
                {takeProfitPrice != null && <button type="button" className="matrix-level-clear" {...action("clear-take-profit")} data-testid="matrix-clear-take-profit" aria-label="Clear take-profit chart level" onClick={() => onSetChartLevel("take-profit", null)}><X size={13} /></button>}
                <button type="button" className={`matrix-level-btn sl ${levelMode === "stop-loss" ? "active" : ""}`} {...action("level-stop-loss")} data-testid="matrix-level-stop-loss"
                  aria-pressed={levelMode === "stop-loss"} onClick={() => onLevelModeChange(levelMode === "stop-loss" ? null : "stop-loss")}><ArrowDownRight size={14} />SL {stopLossPrice == null ? "—" : priceFormat(stopLossPrice)}</button>
                {stopLossPrice != null && <button type="button" className="matrix-level-clear" {...action("clear-stop-loss")} data-testid="matrix-clear-stop-loss" aria-label="Clear stop-loss chart level" onClick={() => onSetChartLevel("stop-loss", null)}><X size={13} /></button>}
              </div>
            </div>
          </section>

          <section className="matrix-signal-strip" aria-label="Market direction percentages">
            <div className="matrix-signal-heading"><span className="matrix-kicker">MARKET PRESSURE</span><small>{signal?.sampleCount ?? 0} sampled ticks</small></div>
            <div className="matrix-pressure-track" role="img" aria-label={`Higher ${signal?.percentage == null ? "not available" : signal.percentage.toFixed(1) + " percent"}; Lower ${signal?.percentage == null ? "not available" : (100 - signal.percentage).toFixed(1) + " percent"}`}>
              <i style={{ width: `${signal?.percentage == null ? 50 : Math.min(100, Math.max(0, signal.percentage))}%` }} />
            </div>
            <div className="matrix-pressure-labels"><span><ArrowUpRight size={14} />HIGHER <b>{signal?.percentage == null ? "—" : `${signal.percentage.toFixed(1)}%`}</b></span><span><ArrowDownRight size={14} />LOWER <b>{signal?.percentage == null ? "—" : `${(100 - signal.percentage).toFixed(1)}%`}</b></span></div>
          </section>

          <section className="matrix-scanner-card">
            <div className="matrix-scanner-copy"><span className="matrix-scanner-icon"><Radar size={17} /></span><div><b>AI SCANNER</b><small>{scannerBusy ? "Reviewing recent market evidence…" : scannerStatus || (scannerEnabled ? "Scanner is monitoring selected markets" : "Switch on for a market read")}</small></div></div>
            <label className="matrix-switch-control" data-feature-scope="matrix" data-feature-action="matrix/scanner-switch">
              <span>{scannerEnabled ? "ON" : "OFF"}</span><input type="checkbox" data-testid="matrix-scanner-toggle" checked={scannerEnabled} onChange={(event) => onScannerEnabledChange(event.target.checked)} aria-label="Enable Matrix AI Scanner" /><i />
            </label>
            {scannerRecommendation && <div className="matrix-recommendation" data-testid="matrix-scanner-recommendation">
              <span><small>RECENT READ</small><b>{scannerRecommendation.symbol} · {scannerRecommendation.direction} · {scannerRecommendation.duration}</b><em>{scannerRecommendation.percentage.toFixed(1)}% observed · {scannerRecommendation.sampleCount} samples</em></span>
              <button type="button" {...action("scanner-apply")} data-testid="matrix-scanner-apply" onClick={setRecommendation}>Use setup</button>
            </div>}
          </section>
        </main>

        <aside className="matrix-trade-card">
          <div className="matrix-trade-head"><div><span className="matrix-kicker">CONTRACT SETUP</span><h3>Place a trade</h3></div><span className="matrix-account-chip">{accountLabel || "ACCOUNT"}</span></div>
          <div className="matrix-direction-select" role="group" aria-label="Choose Higher or Lower">
            <button type="button" className={`higher ${direction === "HIGHER" ? "selected" : ""}`} {...action("direction-higher")} data-testid="matrix-direction-higher" onClick={() => onDirectionChange("HIGHER")} aria-pressed={direction === "HIGHER"}><ArrowUpRight size={18} /><span>HIGHER<small>Price rises</small></span>{direction === "HIGHER" && <Check size={15} />}</button>
            <button type="button" className={`lower ${direction === "LOWER" ? "selected" : ""}`} {...action("direction-lower")} data-testid="matrix-direction-lower" onClick={() => onDirectionChange("LOWER")} aria-pressed={direction === "LOWER"}><ArrowDownRight size={18} /><span>LOWER<small>Price falls</small></span>{direction === "LOWER" && <Check size={15} />}</button>
          </div>

          <div className="matrix-setup-fields">
            <fieldset className="matrix-duration-field"><legend>DURATION</legend><div className="matrix-duration-grid">
              {durations.map((item) => {
                const available = durationAvailability.status === "ready"
                  && durationAvailability.supported.includes(item);
                return <button
                  type="button"
                  key={item}
                  {...action(`duration-${item}`)}
                  data-testid={`matrix-duration-${item}`}
                  onClick={() => onDurationChange(item)}
                  className={`${duration === item ? "active" : ""}${available ? "" : " unavailable"}`}
                  aria-pressed={duration === item}
                  disabled={!available}
                  title={available ? undefined : "Deriv is not currently offering this duration for this setup."}
                >{item}</button>;
              })}
            </div>
              <div className={`matrix-duration-feedback ${durationAvailability.status === "error" ? "error" : ""}`} role="status" data-testid="matrix-duration-status">
                <span>{durationAvailability.status === "checking"
                  ? "Checking live offers for this market and direction…"
                  : durationAvailability.status === "error"
                    ? durationAvailability.message ?? "Could not check currently offered durations."
                    : durationAvailability.supported.length === 0
                      ? `No Matrix durations are currently offered for ${selectedSymbol} ${direction}.`
                      : durationAvailability.supported.includes(duration)
                        ? `Live Deriv offers checked for ${selectedSymbol} ${direction}.`
                        : `Deriv is not offering ${duration} for ${selectedSymbol} ${direction}. Choose an enabled duration.`}</span>
                {(durationAvailability.status === "error" || (durationAvailability.status === "ready" && durationAvailability.supported.length === 0)) && (
                  <button type="button" {...action("duration-refresh")} data-testid="matrix-duration-refresh" onClick={onRefreshDurations}>Refresh</button>
                )}
              </div>
            </fieldset>
            <div className="matrix-input-grid">
              <label><span>STAKE <small>MIN {money(1, currency)}</small></span><div className="matrix-money-input"><b>{currency === "USD" ? "$" : currency}</b><input type="number" min="1" step="0.01" value={stake} data-testid="matrix-stake-input" {...action("stake-input")} onChange={(event) => onStakeChange(Math.max(1, Number(event.target.value) || 1))} aria-label={`Stake in ${currency}`} /></div></label>
              <label><span>CONTRACTS <small>1–10</small></span><div className="matrix-count-input"><button type="button" {...action("trade-count-decrease")} data-testid="matrix-trade-count-decrease" onClick={() => onTradeCountChange(Math.max(1, tradeCount - 1))} aria-label="Decrease contract count" disabled={tradeCount <= 1}><Minus size={14} /></button><output data-testid="matrix-trade-count">{tradeCount}</output><button type="button" {...action("trade-count-increase")} data-testid="matrix-trade-count-increase" onClick={() => onTradeCountChange(Math.min(10, tradeCount + 1))} aria-label="Increase contract count" disabled={tradeCount >= 10}><span>+</span></button></div></label>
            </div>
            <label className="matrix-tp-amount"><span>TAKE-PROFIT PER TRADE <small>OPTIONAL</small></span><div className="matrix-money-input"><b>{currency === "USD" ? "$" : currency}</b><input type="number" min="0" step="0.01" value={takeProfitPerTrade} {...action("take-profit-per-trade")} data-testid="matrix-take-profit-input" onChange={(event) => onTakeProfitPerTradeChange(Math.max(0, Number(event.target.value) || 0))} aria-label={`Take-profit amount per trade in ${currency}`} /></div></label>
          </div>
          <div className="matrix-order-summary">
            <span><small>TOTAL STAKE</small><b data-testid="matrix-total-stake">{money(Math.max(1, stake) * Math.max(1, tradeCount), currency)}</b></span>
            <span><small>MARKET</small><b>{selectedSymbol}</b></span>
            <span><small>ACCOUNT</small><b>{accountLabel || "—"}</b></span>
          </div>
          <button type="button" className="matrix-place-trade" {...action("place-trade")} data-testid="matrix-place-trade" onClick={onPlaceTrade} disabled={!canSubmit}>
            {tradeBusy ? <><RotateCcw size={17} className="matrix-button-spin" />SUBMITTING…</> : <><span>PLACE TRADE</span><ArrowUpRight size={18} /></>}
            <small>{tradeBusy ? "Waiting for confirmation" : `${direction} · ${tradeCount} ${tradeCount === 1 ? "contract" : "contracts"} · ${money(stake, currency)} each`}</small>
          </button>
          <p className={`matrix-trade-note ${!connected || statusMessage ? "notice" : ""}`} role="status" data-testid="matrix-trade-status">
            {statusMessage || (!connected ? "Connect Deriv before placing a contract." : !canTrade ? "Trading is currently unavailable for this account." : "Contracts carry risk. Review stake and direction before submitting.")}
          </p>
          <div className="matrix-guide">
            <button type="button" {...action("guide-toggle")} data-testid="matrix-guide-toggle" onClick={() => setGuideOpen((open) => !open)} aria-expanded={guideOpen}><CircleHelp size={15} />Quick guide <ChevronDown size={14} className={guideOpen ? "turned" : ""} /></button>
            {guideOpen && <div className="matrix-guide-content"><BookOpen size={15} /><p><b>Higher / Lower</b> settles against the contract’s entry price at expiry. Choose duration and stake before submitting. Chart TP / SL lines are visual references only and do not change the contract outcome or automatically close it.</p></div>}
          </div>
        </aside>
      </div>

      {openTrades.length > 0 && <section className="matrix-open-contracts" aria-label="Open Matrix contracts">
        <div className="matrix-open-head"><div><span className="matrix-kicker">IN FLIGHT</span><h3>Open contracts <b>{openTrades.length}</b></h3></div><span><i />Updates from Deriv</span></div>
        <div className="matrix-open-list">{openTrades.map((trade) => <article className="matrix-open-row" key={trade.contractId} data-testid={`matrix-open-contract-${trade.contractId}`}>
          <div className="matrix-open-market"><span className={`matrix-open-direction ${trade.direction.toLowerCase()}`}>{trade.direction === "HIGHER" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}</span><span><b>{trade.symbol}</b><small>Contract {trade.contractId}</small></span></div>
          <span className="matrix-open-status"><i />{trade.status}</span>
          <span><small>STAKE</small><b>{money(trade.stake, currency)}</b></span>
          <span><small>PAYOUT</small><b>{money(trade.payout, currency)}</b></span>
          <span className={`matrix-open-pnl ${trade.profit >= 0 ? "positive" : "negative"}`}><small>LIVE P/L</small><b>{trade.profit > 0 ? "+" : ""}{money(trade.profit, currency)}</b></span>
          <span className="matrix-open-time"><small>TIME LEFT</small><b>{trade.countdown || "—"}</b><em>{trade.elapsed ? `${trade.elapsed} elapsed` : "elapsed —"}</em></span>
        </article>)}</div>
      </section>}

      <div className="matrix-history-wrap" data-feature-scope="matrix">
        <DerivHistory title="Matrix History" strategy="Higher / Lower" rows={historyRows} sessionRows={sessionRows} currency={currency}
          clearArmed={clearArmed} fading={historyFading}
          actions={<button type="button" {...action("history-clear")} data-testid="matrix-history-clear" onClick={onClearHistory}
            disabled={(!historyRows.length && !sessionRows.length) || historyFading}
            aria-label={clearArmed ? "Tap again to clear Matrix history" : "Clear Matrix history"}>
            <Trash2 size={14} />{clearArmed ? "Tap again" : "Clear session"}
          </button>} />
      </div>
    </section>
  );
}

export default MatrixPanel;
