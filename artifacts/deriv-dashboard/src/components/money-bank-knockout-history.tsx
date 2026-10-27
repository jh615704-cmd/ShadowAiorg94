import type { DerivHistoryRow } from "./deriv-history";
import { summarizeMoneyBankKnockoutStats } from "../lib/money-bank-knockout-stats";

type Props = {
  rows: readonly DerivHistoryRow[];
  symbol: string;
  growthRate: number;
  stakesByRate: Readonly<Record<number, number>>;
  currency: string;
  connected: boolean;
};

const rates = [1, 2, 3, 4, 5] as const;

function money(value: number, currency: string) {
  return `${currency === "USD" ? "$" : `${currency} `}${value.toFixed(2)}`;
}

function formatTicks(value: number | null) {
  return value == null ? "—" : `${value} tick${value === 1 ? "" : "s"}`;
}

function formatAverageTicks(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)} ticks`;
}

export function MoneyBankKnockoutHistory({
  rows,
  symbol,
  growthRate,
  stakesByRate,
  currency,
  connected,
}: Props) {
  const rateStats = summarizeMoneyBankKnockoutStats(rows, symbol, rates);
  const active = rateStats.find((item) => item.growthRate === growthRate) ?? rateStats[0];
  const totalKnockouts = rateStats.reduce((total, item) => total + item.knockouts, 0);
  const totalRuns = rateStats.reduce((total, item) => total + item.trackedRuns, 0);

  return (
    <section className="money-bank-card money-bank-knockout-card" aria-label="Money Bank knockout statistics">
      <div className="money-bank-card-head money-bank-knockout-head">
        <div>
          <small>MONEY BANK STATS</small>
          <h3>Knockout History</h3>
          <p>
            {totalRuns
              ? `${totalKnockouts} knockouts · ${totalRuns} settled runs tracked for ${symbol}`
              : `No settled Money Bank runs recorded for ${symbol} yet.`}
          </p>
        </div>
        <span className={`money-bank-knockout-live ${connected ? "is-live" : ""}`}>
          <i /> {connected ? "LIVE" : "OFFLINE"}
        </span>
      </div>

      <div className="money-bank-knockout-rates" aria-label="Growth rate stakes and historical knockout counts">
        {rateStats.map((item) => (
          <div
            key={item.growthRate}
            className={`money-bank-knockout-rate-chip ${growthRate === item.growthRate ? "is-current" : ""}`}
            aria-current={growthRate === item.growthRate ? "true" : undefined}
          >
            <strong>{item.growthRate}%</strong>
            <span>{money(stakesByRate[item.growthRate] ?? 0, currency)} BASE</span>
            <small>{item.trackedRuns ? `${item.knockouts} KO · ${item.trackedRuns} runs` : "No history"}</small>
          </div>
        ))}
      </div>

      {active && (
        <>
          {active.trackedRuns ? (
            <div className="money-bank-knockout-summary" aria-label={`${active.growthRate}% settled run summary`}>
              <div><small>KNOCKOUTS</small><b>{active.knockouts}</b></div>
              <div><small>COMPLETED</small><b>{active.completed}</b></div>
              <div><small>LONGEST</small><b>{formatTicks(active.longestTicks)}</b></div>
              <div><small>AVERAGE</small><b>{formatAverageTicks(active.averageTicks)}</b></div>
              <div><small>SHORTEST</small><b>{formatTicks(active.shortestTicks)}</b></div>
            </div>
          ) : (
            <div className="money-bank-knockout-empty">
              No settled {active.growthRate}% Money Bank outcomes for {symbol} yet. Results appear after a Money Bank contract settles.
            </div>
          )}

          {active.liveTicks != null && (
            <p className="money-bank-knockout-current" role="status">
              Current run: {active.liveTicks} tick{active.liveTicks === 1 ? "" : "s"} passed.
            </p>
          )}

          <div className="money-bank-knockout-exit-head">
            <div>
              <h4>Possible exit ticks by growth rate</h4>
              <span>Current BASE stake: {money(stakesByRate[growthRate] ?? 0, currency)}</span>
            </div>
            <small>Historical Deriv outcomes · {symbol}</small>
          </div>

          <div className="money-bank-knockout-rate-history">
            {rateStats.map((item) => {
              const isCurrentRate = item.growthRate === growthRate;
              const rateStake = stakesByRate[item.growthRate] ?? 0;
              return (
                <article
                  className={`money-bank-knockout-rate-row ${isCurrentRate ? "is-current" : ""}`}
                  key={item.growthRate}
                  aria-label={`${item.growthRate}% growth historical exit ticks`}
                >
                  <header className="money-bank-knockout-rate-row-head">
                    <strong>{item.growthRate}% growth</strong>
                    <span>{money(rateStake, currency)} BASE stake</span>
                    <small>{item.trackedRuns ? `${item.knockouts} KO · ${item.trackedRuns} runs` : "No settled runs"}</small>
                  </header>

                  {item.topKnockoutTicks.length ? (
                    <div className="money-bank-knockout-options">
                      {item.topKnockoutTicks.map((tick, index) => {
                        return (
                          <div className="money-bank-knockout-option" key={tick.ticks}>
                            <small>RANK {index + 1}</small>
                            <strong>{formatTicks(tick.ticks)}</strong>
                            <b>{tick.percentageOfKnockouts.toFixed(1)}%</b>
                            <span>{tick.count} of {item.knockouts} settled knockouts</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="money-bank-knockout-empty">
                      {item.trackedRuns
                        ? "No settled knockout ticks recorded for this rate yet."
                        : `No settled ${item.growthRate}% outcomes recorded for this market yet.`}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

    </section>
  );
}
