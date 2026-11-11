import { useEffect, useMemo, useState } from "react";
import {
  getGetMoneyBankKnockoutStatisticsQueryKey,
  useGetMoneyBankKnockoutStatistics,
  type MoneyBankKnockoutStatistics,
} from "@workspace/api-client-react";

type Props = {
  accountId?: string | null;
  amount: number;
  connected: boolean;
  duration: number;
  symbol: string;
};

function formatWindowTime(epoch: number | null) {
  if (epoch == null) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(epoch * 1000));
}

function formatCount(value: number | null) {
  return value == null ? "—" : value.toFixed(1);
}

function formatGap(value: number | null) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
}

export function MoneyBankKnockoutStats({
  accountId,
  amount,
  connected,
  duration,
  symbol,
}: Props) {
  const params = useMemo(() => ({
    symbol,
    amount: Math.max(1, amount),
    duration,
  }), [amount, duration, symbol]);
  const queryKey = useMemo(
    () => [...getGetMoneyBankKnockoutStatisticsQueryKey(params), accountId ?? "no-selected-account"],
    [accountId, params],
  );
  const queryEnabled = connected && Boolean(accountId) && amount >= 1;
  const query = useGetMoneyBankKnockoutStatistics(params, {
    query: {
      queryKey,
      enabled: queryEnabled,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!query.data) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [query.data?.captured_at_epoch]);

  const data = query.data;
  const nowEpoch = Math.floor(now / 1_000);
  const snapshotAge = data ? Math.max(0, nowEpoch - data.captured_at_epoch) : null;
  const liveTickAge = data?.window_end_epoch == null
    ? null
    : Math.max(0, nowEpoch - data.window_end_epoch);
  const dataIsStale = Boolean(data && (
    query.isError
    || data.freshness !== "fresh"
    || liveTickAge == null
    || liveTickAge > 5
    || snapshotAge == null
    || snapshotAge > 65
  ));
  const readyRates = data?.rates.filter((rate) => (
    rate.status === "ready"
    && rate.estimated_knockouts != null
    && rate.estimate_lower_count != null
    && rate.estimate_upper_count != null
  )) ?? [];
  const withinModelRange = readyRates.filter((rate) => (
    rate.observed_knockouts >= rate.estimate_lower_count!
    && rate.observed_knockouts <= rate.estimate_upper_count!
  )).length;

  const freshnessMessage = !connected
    ? "Connect Deriv to collect live quotes."
    : !accountId
      ? "Select a Deriv account to request current rate barriers."
      : amount < 1
        ? "Set an Accumulator stake of at least $1."
        : dataIsStale
          ? `Stale sample · latest quote ${liveTickAge == null ? "unavailable" : `${liveTickAge}s old`}`
          : data?.freshness === "waiting_for_quote"
            ? "Waiting for live quotes from this market."
            : data
              ? `${data.quote_count} recent quotes · latest tick ${liveTickAge ?? "—"}s ago`
              : query.isPending
                ? "Loading current Deriv barriers…"
                : "Statistics are not available.";

  const unavailableRate = (rate: MoneyBankKnockoutStatistics["rates"][number]) => (
    rate.status === "barrier_unavailable"
    || rate.status === "waiting_for_quote"
    || rate.status === "stale_data"
  );

  return (
    <section className="money-bank-knockout-stats" aria-label="Money Bank knockout statistics">
      <div className="money-bank-knockout-stats-head">
        <div>
          <small>LIVE-MARKET SAMPLE</small>
          <h4>Knockout estimates</h4>
        </div>
        <span className={`money-bank-knockout-freshness ${dataIsStale ? "stale" : ""}`} role="status" aria-live="polite">
          <i aria-hidden="true" />
          {freshnessMessage}
        </span>
      </div>

      {data && (
        <p className="money-bank-knockout-window">
          {symbol} · {duration} ticks · sample window {formatWindowTime(data.window_start_epoch)}–{formatWindowTime(data.window_end_epoch)}
          {snapshotAge != null && ` · updated ${snapshotAge}s ago`}
        </p>
      )}

      {query.isError && !data && queryEnabled && (
        <p className="money-bank-knockout-message" role="alert">
          Current knockout statistics could not be refreshed. No trade was sent.
        </p>
      )}

      {data && (
        <>
          <div className="money-bank-knockout-table-wrap">
            <table className="money-bank-knockout-table">
              <thead>
                <tr>
                  <th scope="col">Sample</th>
                  {data.rates.map((rate) => (
                    <th scope="col" key={rate.growth_rate}>{rate.growth_rate}%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Observed knockouts</th>
                  {data.rates.map((rate) => (
                    <td key={rate.growth_rate}>
                      {unavailableRate(rate) ? "—" : `${rate.observed_knockouts} / ${rate.holdout_windows}`}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Estimated in holdout</th>
                  {data.rates.map((rate) => (
                    <td key={rate.growth_rate}>
                      {rate.status === "ready"
                        ? `${formatCount(rate.estimated_knockouts)} / ${rate.holdout_windows}`
                        : rate.status === "insufficient_evidence"
                          ? "Need samples"
                          : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">95% model range</th>
                  {data.rates.map((rate) => (
                    <td key={rate.growth_rate}>
                      {rate.status === "ready"
                        ? `${formatCount(rate.estimate_lower_count)}–${formatCount(rate.estimate_upper_count)}`
                        : rate.status === "insufficient_evidence"
                          ? "Need samples"
                          : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Holdout gap</th>
                  {data.rates.map((rate) => (
                    <td key={rate.growth_rate}>
                      {rate.status === "ready"
                        ? formatGap(rate.holdout_gap_percentage_points)
                        : rate.status === "insufficient_evidence"
                          ? "Need samples"
                          : "—"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="money-bank-knockout-rate-statuses" aria-label="Growth rate evidence details">
            {data.rates.filter((rate) => rate.status !== "ready").map((rate) => (
              <span key={rate.growth_rate}>
                <b>{rate.growth_rate}%</b> {rate.message ?? "Evidence is incomplete."}
                {rate.status === "insufficient_evidence" && (
                  <small>{rate.training_windows} training · {rate.holdout_windows} holdout windows</small>
                )}
              </span>
            ))}
          </div>

          {readyRates.length > 0 && (
            <p className="money-bank-knockout-range-check">
              Holdout range check: {withinModelRange}/{readyRates.length} observed counts fell inside the model range.
            </p>
          )}
        </>
      )}

      {!data && queryEnabled && query.isPending && (
        <p className="money-bank-knockout-message">Collecting a fresh quote sample for 1%–5%.</p>
      )}

      <p className="money-bank-knockout-disclaimer">
        Uses each current Deriv barrier with earlier live quotes for the estimate and later non-overlapping windows for the check. The 95% Wilson interval describes model uncertainty, not 95% accuracy or a future guarantee. These are quote replays, not actual contracts.
      </p>
    </section>
  );
}
