import { Medal, Target } from "lucide-react";
import "./_group.css";
import "./_trade-x-panel-reference.css";
import "./_matches-top3-style.css";

const rankedDigits = [
  { digit: 7, rate: 24.2, count: 8, selected: true },
  { digit: 2, rate: 18.2, count: 6, selected: false },
  { digit: 9, rate: 15.2, count: 5, selected: false },
];

export default function MatchesTop3Style() {
  return (
    <main className="trade-x-reference-frame">
      <div className="tx-panel matches-top3-preview">
        <section className="tx-safe-panel tx-section">
          <div className="tx-section-heading tx-safe-heading">
            <div>
              <span className="tx-index">03</span>
              <div>
                <h3><Target size={16} aria-hidden="true" />Top 3 observed digits</h3>
                <p>Ranked by live tick frequency</p>
              </div>
            </div>
            <span className="matches-observed-tag">OBSERVED</span>
          </div>
          <div className="tx-ranking-list">
            {rankedDigits.map((item, index) => (
              <div
                className={`tx-rank-row tx-rank-safe ${item.selected ? "tx-rank-row-selected" : ""}`}
                key={item.digit}
                aria-label={`Rank ${index + 1}, digit ${item.digit}`}
              >
                <button type="button" className="tx-rank-select" aria-pressed={item.selected}>
                  <span className={`tx-rank-medal medal-${index + 1}`} aria-hidden="true">
                    <Medal size={18} />
                  </span>
                  <span className="tx-rank-digit">{item.digit}</span>
                </button>
                <span className="tx-rank-metrics">
                  <b>{item.rate.toFixed(1)}%</b>
                  <small>{item.count} sample hits</small>
                </span>
                <button type="button" className="tx-tap-trade">TAP TO TRADE</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
