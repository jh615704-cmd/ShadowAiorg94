import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import {
  useGetMoneyBankKnockoutBarriers,
  type MoneyBankKnockoutBarriersResponse,
} from "@workspace/api-client-react";
import {
  appendMoneyBankKnockoutForecast,
  estimateMoneyBankKnockoutTicks,
  MONEY_BANK_LIVE_KNOCKOUT_LIMIT,
  MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES,
  type MoneyBankKnockoutForecast,
} from "../lib/money-bank-live-knockouts";
import "./money-bank-live-knockouts.css";

const RATE_OPTIONS = [1, 2, 3, 4, 5] as const;
type GrowthRate = typeof RATE_OPTIONS[number];
type BarrierResponseRate = MoneyBankKnockoutBarriersResponse["rates"][number];
type RateRecord<T> = Record<GrowthRate, T>;

type Props = {
  connected: boolean;
  symbol: string;
  marketLabel: string;
  growthRate: number;
  quote?: number | null;
  recentQuotes?: readonly number[];
  tickSequence?: number;
};

function emptyRateRecord<T>(createValue: () => T): RateRecord<T> {
  return Object.fromEntries(RATE_OPTIONS.map((rate) => [rate, createValue()])) as RateRecord<T>;
}

function isGrowthRate(value: number): value is GrowthRate {
  return RATE_OPTIONS.some((rate) => rate === value);
}

export function MoneyBankLiveKnockouts({
  connected,
  symbol,
  marketLabel,
  growthRate,
  quote,
  recentQuotes = [],
  tickSequence,
}: Props) {
  const [selectedRate, setSelectedRate] = useState<GrowthRate>(
    isGrowthRate(growthRate) ? growthRate : 1,
  );
  const [barriers, setBarriers] = useState<RateRecord<number | null>>(
    () => emptyRateRecord(() => null),
  );
  const [barrierMessages, setBarrierMessages] = useState<RateRecord<string | null>>(
    () => emptyRateRecord(() => null),
  );
  const [forecastHistory, setForecastHistory] = useState<RateRecord<MoneyBankKnockoutForecast[]>>(
    () => emptyRateRecord(() => []),
  );
  const [barrierLoading, setBarrierLoading] = useState(false);
  const [barrierRefreshFailed, setBarrierRefreshFailed] = useState(false);

  const mutation = useGetMoneyBankKnockoutBarriers();
  const requestBarriersRef = useRef(mutation.mutateAsync);
  requestBarriersRef.current = mutation.mutateAsync;
  const barriersRef = useRef(barriers);
  const referencesRef = useRef<RateRecord<number | null>>(emptyRateRecord(() => null));
  const sequenceCursorsRef = useRef<RateRecord<number | null>>(emptyRateRecord(() => null));
  const forecastHistoryRef = useRef(forecastHistory);
  const lastSymbolRef = useRef(symbol);

  useEffect(() => {
    if (lastSymbolRef.current === symbol) return;
    lastSymbolRef.current = symbol;
    const emptyForecasts = emptyRateRecord(() => [] as MoneyBankKnockoutForecast[]);
    const noBarriers = emptyRateRecord(() => null as number | null);
    const noMessages = emptyRateRecord(() => null as string | null);
    forecastHistoryRef.current = emptyForecasts;
    barriersRef.current = noBarriers;
    referencesRef.current = emptyRateRecord(() => null);
    sequenceCursorsRef.current = emptyRateRecord(() => null);
    setForecastHistory(emptyForecasts);
    setBarriers(noBarriers);
    setBarrierMessages(noMessages);
    setBarrierRefreshFailed(false);
    setSelectedRate(isGrowthRate(growthRate) ? growthRate : 1);
  }, [growthRate, symbol]);

  useEffect(() => {
    if (!connected) {
      const noBarriers = emptyRateRecord(() => null as number | null);
      barriersRef.current = noBarriers;
      setBarriers(noBarriers);
      referencesRef.current = emptyRateRecord(() => null);
      sequenceCursorsRef.current = emptyRateRecord(() => null);
      setBarrierLoading(false);
      return;
    }

    let active = true;
    let inFlight = false;

    const refreshBarriers = async () => {
      if (inFlight) return;
      inFlight = true;
      if (RATE_OPTIONS.every((rate) => barriersRef.current[rate] == null)) {
        setBarrierLoading(true);
      }
      try {
        const response = await requestBarriersRef.current({ data: { symbol } });
        if (!active) return;

        const nextBarriers = emptyRateRecord(() => null as number | null);
        const nextMessages = emptyRateRecord(() => null as string | null);
        for (const result of response.rates as readonly BarrierResponseRate[]) {
          if (!isGrowthRate(result.growth_rate)) continue;
          nextBarriers[result.growth_rate] = result.barrier;
          nextMessages[result.growth_rate] = result.message;
        }

        const snapshotSequence = Number.isSafeInteger(response.tick_sequence)
          ? response.tick_sequence
          : null;
        const snapshotQuote = Number.isFinite(response.quote) && response.quote! > 0
          ? response.quote!
          : null;
        const nextForecastHistory = { ...forecastHistoryRef.current };
        let forecastsReset = false;
        for (const rate of RATE_OPTIONS) {
          const previousBarrier = barriersRef.current[rate];
          const nextBarrier = nextBarriers[rate];
          const cursor = sequenceCursorsRef.current[rate];
          const feedRestarted = snapshotSequence != null && cursor != null && snapshotSequence < cursor;
          if (previousBarrier !== nextBarrier || feedRestarted || cursor == null) {
            referencesRef.current[rate] = snapshotQuote;
            sequenceCursorsRef.current[rate] = snapshotSequence;
            if (previousBarrier !== nextBarrier || feedRestarted) {
              nextForecastHistory[rate] = [];
              forecastsReset = true;
            }
          }
        }

        if (forecastsReset) {
          forecastHistoryRef.current = nextForecastHistory;
          setForecastHistory(nextForecastHistory);
        }
        barriersRef.current = nextBarriers;
        setBarriers(nextBarriers);
        setBarrierMessages(nextMessages);
        setBarrierRefreshFailed(false);
      } catch {
        if (active) {
          const noBarriers = emptyRateRecord(() => null as number | null);
          barriersRef.current = noBarriers;
          setBarriers(noBarriers);
          setBarrierRefreshFailed(true);
        }
      } finally {
        inFlight = false;
        if (active) setBarrierLoading(false);
      }
    };

    void refreshBarriers();
    const interval = window.setInterval(() => void refreshBarriers(), 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [connected, symbol]);

  useEffect(() => {
    if (!connected || !Number.isSafeInteger(tickSequence) || tickSequence! < 0) return;
    const sequence = tickSequence!;
    const fallbackQuote = recentQuotes.at(-1);
    const latestQuote = Number.isFinite(quote) && quote! > 0 ? quote! : fallbackQuote;
    if (!Number.isFinite(latestQuote) || latestQuote! <= 0) return;

    const nextForecastHistory = { ...forecastHistoryRef.current };
    let forecastsChanged = false;
    const nextQuotes = recentQuotes;

    for (const rate of RATE_OPTIONS) {
      const cursor = sequenceCursorsRef.current[rate];
      if (cursor == null) {
        referencesRef.current[rate] = latestQuote!;
        sequenceCursorsRef.current[rate] = sequence;
        continue;
      }
      if (sequence <= cursor) continue;

      const unseenCount = sequence - cursor;
      if (unseenCount > nextQuotes.length) {
        referencesRef.current[rate] = latestQuote!;
        sequenceCursorsRef.current[rate] = sequence;
        continue;
      }

      const unseenQuotes = nextQuotes.slice(-unseenCount);
      if (unseenQuotes.length !== unseenCount) {
        referencesRef.current[rate] = latestQuote!;
        sequenceCursorsRef.current[rate] = sequence;
        continue;
      }
      const newTicks = unseenQuotes.map((newQuote, index) => ({
        quote: newQuote,
        sequence: cursor + index + 1,
      }));
      let quoteWindow = nextQuotes.slice(0, -unseenCount);
      const barrier = barriersRef.current[rate];
      for (const tick of newTicks) {
        quoteWindow = [...quoteWindow, tick.quote].slice(-41);
        let referenceQuote = referencesRef.current[rate];
        if (referenceQuote == null) {
          referenceQuote = tick.quote;
        } else if (barrier != null && Math.abs(tick.quote - referenceQuote) >= barrier) {
          referenceQuote = tick.quote;
        }
        referencesRef.current[rate] = referenceQuote;

        const estimate = estimateMoneyBankKnockoutTicks({
          quotes: quoteWindow,
          barrier,
          referenceQuote,
        });
        if (estimate != null) {
          nextForecastHistory[rate] = appendMoneyBankKnockoutForecast(
            nextForecastHistory[rate],
            { ticksToKnockout: estimate, sequence: tick.sequence },
          );
          forecastsChanged = true;
        }
      }
      sequenceCursorsRef.current[rate] = sequence;
    }

    if (forecastsChanged) {
      forecastHistoryRef.current = nextForecastHistory;
      setForecastHistory(nextForecastHistory);
    }
  }, [barriers, connected, quote, recentQuotes, tickSequence]);

  const selectedBarrier = barriers[selectedRate];
  const selectedMessage = barrierMessages[selectedRate];
  const selectedForecasts = forecastHistory[selectedRate];

  return (
    <section className="money-bank-live-knockouts" aria-label="Live Knockouts">
      <header className="mbkl-header">
        <div className="mbkl-heading">
          <span className={`mbkl-icon ${connected ? "is-live" : ""}`}><Activity size={17} aria-hidden="true" /></span>
          <div>
            <h3>Live Knockouts</h3>
            <p>{marketLabel} <span>·</span> {symbol}</p>
          </div>
        </div>
        <span className={`mbkl-live-pill ${connected ? "is-live" : ""}`}>
          <i aria-hidden="true" />{connected ? "LIVE FEED" : "OFFLINE"}
        </span>
      </header>

      <div className="mbkl-rate-row">
        <span className="mbkl-rate-label">GROWTH RATE</span>
        <div className="mbkl-rates" role="group" aria-label="Choose Money Bank growth rate">
          {RATE_OPTIONS.map((rate) => (
            <button
              key={rate}
              type="button"
              className={selectedRate === rate ? "is-selected" : ""}
              aria-pressed={selectedRate === rate}
              onClick={() => setSelectedRate(rate)}
            >
              {rate}%
            </button>
          ))}
        </div>
        <span className="mbkl-barrier">
          {selectedBarrier != null
            ? "LIVE MODEL"
            : barrierLoading
              ? "CALCULATING"
              : "MODEL UNAVAILABLE"}
        </span>
      </div>

      <div className="mbkl-feed-labels" aria-hidden="true">
        <span>OLDER ESTIMATES</span>
        <span>LATEST ESTIMATE</span>
      </div>
      <ol className="mbkl-price-stream" aria-label={`${selectedRate}% estimated ticks until knockout, oldest to newest`}>
        {Array.from({ length: MONEY_BANK_LIVE_KNOCKOUT_LIMIT }, (_, index) => {
          const forecast = selectedForecasts[index];
          const isNewest = forecast != null && forecast.sequence === selectedForecasts.at(-1)?.sequence;
          return (
            <li
              key={forecast ? `${selectedRate}-${forecast.sequence}` : `empty-${index}`}
              className={`${forecast ? "has-price" : "is-empty"} ${isNewest ? "is-new" : ""}`}
              aria-label={forecast ? `Estimated knockout in ${forecast.ticksToKnockout} ticks` : "Waiting for a knockout estimate"}
            >
              {forecast ? String(forecast.ticksToKnockout) : "···"}
            </li>
          );
        })}
      </ol>

      <p className="mbkl-status" role="status">
        {!connected
          ? "Connect Deriv to estimate knockout timing from this market’s live ticks."
          : selectedBarrier == null
            ? selectedMessage ?? (barrierRefreshFailed ? "Could not refresh the current Deriv barrier." : "Waiting for a current barrier.")
            : selectedForecasts.length
              ? "Each number estimates ticks until this rate’s barrier may be reached, based on recent live movement."
              : `Gathering at least ${MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES} live quotes to estimate knockout timing.`}
      </p>
      <p className="mbkl-note">
        Read-only estimate · Not a guaranteed timing or contract outcome; monitor live ticks.
      </p>
    </section>
  );
}
