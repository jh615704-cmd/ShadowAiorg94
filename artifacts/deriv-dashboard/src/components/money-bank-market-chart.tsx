type Props = {
  marketName: string;
  connected: boolean;
  quote?: number | null;
  quotes: readonly number[];
};

const plot = { left: 66, right: 790, top: 22, bottom: 214 };

export function MoneyBankMarketChart({ marketName, connected, quote, quotes }: Props) {
  const chartQuotes = quotes.filter(Number.isFinite).slice(-30);
  const first = chartQuotes[0];
  const latest = quote ?? chartQuotes.at(-1) ?? null;
  const change = first != null && latest != null ? latest - first : 0;
  const changePercent = first != null && first !== 0 ? (change / first) * 100 : 0;
  const trend = chartQuotes.length < 2 || Math.abs(changePercent) < 0.0001
    ? "flat"
    : change > 0 ? "rising" : "falling";
  const low = chartQuotes.length ? Math.min(...chartQuotes) : 0;
  const high = chartQuotes.length ? Math.max(...chartQuotes) : 1;
  const rawSpan = high - low;
  const span = rawSpan || Math.max(Math.abs(high) * 0.0001, 0.00001);
  const points = chartQuotes.map((value, index) => {
    const x = chartQuotes.length < 2
      ? plot.left
      : plot.left + (index / (chartQuotes.length - 1)) * (plot.right - plot.left);
    const y = plot.top + ((high - value) / span) * (plot.bottom - plot.top);
    return { x, y, value };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = points.length > 1
    ? `${linePath} L ${points.at(-1)!.x.toFixed(2)} ${plot.bottom} L ${points[0]!.x.toFixed(2)} ${plot.bottom} Z`
    : "";
  const formattedChange = `${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}%`;
  const colorClass = trend === "falling" ? "is-falling" : trend === "rising" ? "is-rising" : "is-flat";

  return (
    <section className={`money-bank-market-chart ${colorClass}`} aria-label={`${marketName} Above Market price chart`}>
      <div className="money-bank-market-chart-head">
        <div className="money-bank-market-chart-title">
          <span className="money-bank-chart-eyebrow"><i /> ABOVE MARKET</span>
          <h3>{marketName}</h3>
          <p>{connected ? `Recent ${chartQuotes.length || 30} ticks` : "Connect Deriv for live market data"}</p>
        </div>
        <div className="money-bank-market-quote">
          <strong>{latest == null ? "—" : latest.toFixed(2)}</strong>
          <span>{latest == null ? "Waiting for quote" : formattedChange}</span>
        </div>
      </div>

      {points.length > 0 ? (
        <div className="money-bank-chart-plot">
          <svg viewBox="0 0 800 250" role="img" aria-label={`${marketName} recent price movement ${trend}; ${formattedChange} across ${chartQuotes.length} ticks`}>
            <defs>
              <linearGradient id="money-bank-market-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" className="money-bank-chart-fill-start" />
                <stop offset="100%" className="money-bank-chart-fill-end" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((position) => {
              const y = plot.top + (plot.bottom - plot.top) * position;
              const value = high - rawSpan * position;
              return (
                <g key={position}>
                  <line x1={plot.left} x2={plot.right} y1={y} y2={y} className="money-bank-chart-gridline" />
                  <text x="4" y={y + 4} className="money-bank-chart-axis-label">{value.toFixed(2)}</text>
                </g>
              );
            })}
            {areaPath && <path d={areaPath} fill="url(#money-bank-market-fill)" className="money-bank-chart-area" />}
            {linePath && <path d={linePath} fill="none" className="money-bank-chart-line" />}
            {points.length > 0 && (
              <circle
                cx={points.at(-1)!.x}
                cy={points.at(-1)!.y}
                r="5"
                className="money-bank-chart-last-point"
              />
            )}
          </svg>
        </div>
      ) : (
        <div className="money-bank-chart-empty">
          <span><i /> Waiting for the first live tick…</span>
        </div>
      )}

      <div className="money-bank-chart-foot">
        <span><i /> Price</span>
        <span className="money-bank-chart-movement">
          {trend === "falling" ? "Recent movement is down" : trend === "rising" ? "Recent movement is up" : "Movement is flat"}
        </span>
        <small>Recent movement only—not a trade forecast.</small>
      </div>
    </section>
  );
}
