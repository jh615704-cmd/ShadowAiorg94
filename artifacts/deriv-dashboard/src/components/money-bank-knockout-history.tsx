import { useEffect, useState } from "react";
import type { DerivHistoryRow } from "./deriv-history";
import {
  MONEY_BANK_MIN_RECOMMENDATION_SAMPLE,
  summarizeMoneyBankKnockoutStats,
} from "../lib/money-bank-knockout-stats";

type Props = {
  rows: readonly DerivHistoryRow[];
  symbol: string;
  growthRate: number;
  stake: number;
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

export function MoneyBankKnockoutHistory({ rows, symbol, growthRate, stake, currency, connected }: Props) {
  const [selectedRate, setSelectedRate] = useState(growthRate);
  useEffect(() => setSelectedRate(growthRate), [growthRate]);

  const rateStats = summarizeMoneyBankKnockoutStats(rows, symbol, rates);
  const active = rateStats.find((item) => item.growthRate === selectedRate) ?? rateStats[0];
  const totalKnockouts = rateStats.reduce((total, item) => total + item.knockouts, 0);
  const totalRuns = rateStats.reduce((total, item) => total + item.trackedRuns, 0);

  return (
    <section className="money-bank-card money-bank-knockout-card" aria-label="Money Bank knockout statistics">
      <div className="money-bank-card-head money-bank-knockout-head">
        <div>
          <small>STATS</small>
          <h3>Knockout History</h3>
          <p>{totalKnockouts} knockouts · {totalRuns} runs tracked</p>
        </div>
        <span className={`money-bank-knockout-live ${connected ? "is-live" : ""}`}>
          <i /> {connected ? "LIVE" : "OFFLINE"}
        </span>
      </div>

      <div className="money-bank-knockout-rates" role="group" aria-label="Select growth rate for knockout history">
        {rateStats.map((item) => (
          <button
            key={item.growthRate}
            type="button"
            className={selectedRate === item.growthRate ? "active" : ""}
            onClick={() => setSelectedRate(item.growthRate)}
            aria-pressed={selectedRate === item.growthRate}
          >
            <strong>{item.growthRate}%</strong>
            <small>{item.knockouts} KO · {item.trackedRuns} runs</small>
          </button>
        ))}
      </div>

      {active && (
        <>
          <div className="money-bank-knockout-summary">
            <div><small>KNOCKOUTS</small><b>{active.knockouts}</b></div>
            <div><small>COMPLETED</small><b>{active.completed}</b></div>
            <div><small>LONGEST</small><b>{formatTicks(active.longestTicks)}</b></div>
            <div><small>AVERAGE</small><b>{formatAverageTicks(active.averageTicks)}</b></div>
            <div><small>SHORTEST</small><b>{formatTicks(active.shortestTicks)}</b></div>
          </div>

          {active.liveTicks != null && (
            <p className="money-bank-knockout-current" role="status">
              Current run: {active.liveTicks} tick{active.liveTicks === 1 ? "" : "s"} passed.
            </p>
          )}

          <div className="money-bank-knockout-exit-head">
            <div>
              <h4>{active.growthRate}% exit points</h4>
              <span>BASE stake {money(stake, currency)}</span>
            </div>
            <small>{active.trackedRuns} actual settled runs</small>
          </div>

          {active.exitOptions.length ? (
            <div className="money-bank-knockout-options">
              {[0, 1].map((index) => {
                const option = active.exitOptions[index];
                return (
                  <article className="money-bank-knockout-option" key={index}>
                    <small>OPTION {index + 1} · {index === 0 ? "EARLIER" : "LATER"}</small>
                    {option ? (
                      <>
                        <strong>{formatTicks(option.ticks)}</strong>
                        <b>{option.noKnockoutPercentage.toFixed(1)}%</b>
                        <span>No-knockout rate in sample</span>
                        <em className={option.isRecommended ? "meets-threshold" : ""}>
                          {option.noKnockoutPercentage >= 50
                            ? option.sampleCount >= MONEY_BANK_MIN_RECOMMENDATION_SAMPLE
                              ? "≥50% · sample threshold met"
                              : "≥50% · small sample"
                            : "Below 50% in sample"}
                        </em>
                      </>
                    ) : (
                      <span className="money-bank-knockout-unavailable">
                        More distinct Deriv knockout ticks are needed.
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="money-bank-knockout-empty">
              {active.trackedRuns
                ? "No Deriv-reported knockouts for this rate yet; exit ticks need actual knockout samples."
                : `No settled ${active.growthRate}% outcomes recorded for this market yet.`}
            </div>
          )}
        </>
      )}

      <p className="money-bank-knockout-note">
        Based only on Deriv-reported outcomes for this market and growth rate. The percentage is historical, not a forecast or win rate. Stake changes exposure, not the observed tick timing.
      </p>
    </section>
  );
}
