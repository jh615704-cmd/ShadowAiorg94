import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import {
  useGetMoneyBankKnockoutBarriers,
  type MoneyBankKnockoutBarriersResponse,
} from "@workspace/api-client-react";
import {
  advanceMoneyBankKnockoutEvaluation,
  appendMoneyBankKnockoutForecast,
  estimateMoneyBankKnockoutTicks,
  MONEY_BANK_KNOCKOUT_GROWTH_RATES,
  MONEY_BANK_LIVE_KNOCKOUT_LIMIT,
  MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES,
  startMoneyBankKnockoutEvaluation,
  type MoneyBankKnockoutEvaluation,
  type MoneyBankKnockoutForecast,
} from "../lib/money-bank-live-knockouts";
import "./money-bank-live-knockouts.css";

type Props = {
  connected: boolean;
  isDemoAccount: boolean;
  demoAccountId?: string | null;
  symbol: string;
  marketLabel: string;
  growthRate: number;
  quote?: number | null;
  recentQuotes?: readonly number[];
  tickSequence?: number;
};

const RATE_OPTIONS = MONEY_BANK_KNOCKOUT_GROWTH_RATES;
type GrowthRate = typeof RATE_OPTIONS[number];
type BarrierResponseRate = MoneyBankKnockoutBarriersResponse["rates"][number];
type RateRecord<T> = Record<GrowthRate, T>;

function isGrowthRate(value: number): value is GrowthRate {
  return RATE_OPTIONS.some((rate) => rate === value);
}

function emptyRateRecord<T>(createValue: () => T): RateRecord<T> {
  return Object.fromEntries(RATE_OPTIONS.map((rate) => [rate, createValue()])) as RateRecord<T>;
}

function evaluationReasonLabel(reason: MoneyBankKnockoutEvaluation["reason"]): string {
  switch (reason) {
    case "sparse-quotes":
      return `Not scored: fewer than ${MONEY_BANK_KNOCKOUT_FORECAST_MIN_QUOTES} usable quotes.`;
    case "flat-movement":
      return "Not scored: recent quote movement is flat.";
    case "barrier-already-crossed":
      return "Not scored: the barrier was already crossed at test start.";
    case "tick-gap":
      return "Not scored: ticks were missing, so the hit count is unknown.";
    case "feed-restarted":
      return "Not scored: the demo feed restarted before the barrier hit.";
    case "invalid-model-input":
      return "Not scored: a valid barrier and forecast were unavailable.";
    default:
      return "Not scored.";
  }
}

function evaluationResultLabel(evaluation: MoneyBankKnockoutEvaluation): string {
  if (evaluation.status === "hit" && evaluation.actualTicks != null && evaluation.estimateTicks != null) {
    const difference = evaluation.actualTicks - evaluation.estimateTicks;
    const comparison = difference === 0
      ? "matched"
      : difference < 0
        ? `${Math.abs(difference)} ${Math.abs(difference) === 1 ? "tick" : "ticks"} early`
        : `${difference} ${difference === 1 ? "tick" : "ticks"} late`;
    return `Barrier hit in ${evaluation.actualTicks} ticks · ${comparison}`;
  }
  if (evaluation.status === "watching") {
    const observedTicks = evaluation.lastSequence - evaluation.startSequence;
    return `${observedTicks} ${observedTicks === 1 ? "tick" : "ticks"} observed · waiting for a barrier hit`;
  }
  return evaluationReasonLabel(evaluation.reason);
}

export function MoneyBankLiveKnockouts({
  connected,
  isDemoAccount,
  demoAccountId,
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
  const [knockoutEvaluation, setKnockoutEvaluation] = useState<MoneyBankKnockoutEvaluation[]>([]);
  const [knockoutEvaluationScope, setKnockoutEvaluationScope] = useState<string | null>(null);
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
  const knockoutEvaluationRef = useRef(knockoutEvaluation);
  const evaluationScope = isDemoAccount ? `${symbol}:${demoAccountId ?? "demo-account"}` : null;
  const lastEvaluationScopeRef = useRef(evaluationScope);

  const resetKnockoutEvaluation = () => {
    knockoutEvaluationRef.current = [];
    setKnockoutEvaluation([]);
    setKnockoutEvaluationScope(null);
  };

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
    resetKnockoutEvaluation();
    setSelectedRate(isGrowthRate(growthRate) ? growthRate : 1);
  }, [growthRate, symbol]);

  useEffect(() => {
    if (lastEvaluationScopeRef.current === evaluationScope) return;
    lastEvaluationScopeRef.current = evaluationScope;
    resetKnockoutEvaluation();
  }, [evaluationScope]);

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
    let nextEvaluation = knockoutEvaluationRef.current;
    let evaluationChanged = false;
    const evaluationSequencesHandled = new Set<number>();
    const observeEvaluationTick = (tickSequence: number, tickQuote: number) => {
      if (evaluationSequencesHandled.has(tickSequence)) return;
      evaluationSequencesHandled.add(tickSequence);
      const updated = advanceMoneyBankKnockoutEvaluation(nextEvaluation, {
        quote: tickQuote,
        sequence: tickSequence,
      });
      if (updated.some((evaluation, index) => evaluation !== nextEvaluation[index])) {
        nextEvaluation = updated;
        evaluationChanged = true;
      }
    };
    if (RATE_OPTIONS.some((rate) => {
      const cursor = sequenceCursorsRef.current[rate];
      return cursor != null && sequence < cursor;
    })) {
      observeEvaluationTick(sequence, latestQuote!);
    }
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
        observeEvaluationTick(sequence, latestQuote!);
        referencesRef.current[rate] = latestQuote!;
        sequenceCursorsRef.current[rate] = sequence;
        continue;
      }

      const unseenQuotes = nextQuotes.slice(-unseenCount);
      if (unseenQuotes.length !== unseenCount) {
        observeEvaluationTick(sequence, latestQuote!);
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
        observeEvaluationTick(tick.sequence, tick.quote);
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
    if (evaluationChanged) {
      knockoutEvaluationRef.current = nextEvaluation;
      setKnockoutEvaluation(nextEvaluation);
    }
  }, [barriers, connected, quote, recentQuotes, tickSequence]);

  const latestQuote = Number.isFinite(quote) && quote! > 0 ? quote! : recentQuotes.at(-1);
  const canStartEvaluation = isDemoAccount
    && connected
    && Number.isSafeInteger(tickSequence)
    && tickSequence! >= 0
    && Number.isFinite(latestQuote)
    && latestQuote! > 0
    && RATE_OPTIONS.some((rate) => barriers[rate] != null);

  const startDemoEvaluation = () => {
    if (!canStartEvaluation) return;
    const sequence = tickSequence!;
    const quoteAtStart = latestQuote!;
    for (const rate of RATE_OPTIONS) {
      if (sequenceCursorsRef.current[rate] == null) {
        sequenceCursorsRef.current[rate] = sequence;
      }
      if (referencesRef.current[rate] == null) {
        referencesRef.current[rate] = quoteAtStart;
      }
    }
    const quotes = recentQuotes
      .filter((item) => Number.isFinite(item) && item > 0)
      .slice(-41);
    if (quotes.at(-1) !== quoteAtStart) {
      quotes.push(quoteAtStart);
      quotes.splice(0, Math.max(0, quotes.length - 41));
    }
    const nextEvaluation = startMoneyBankKnockoutEvaluation({
      quotes,
      sequence,
      rates: RATE_OPTIONS.map((rate) => ({
        growthRate: rate,
        barrier: barriers[rate],
        referenceQuote: referencesRef.current[rate] ?? quoteAtStart,
      })),
    });
    knockoutEvaluationRef.current = nextEvaluation;
    setKnockoutEvaluation(nextEvaluation);
    setKnockoutEvaluationScope(evaluationScope);
  };

  const clearDemoEvaluation = () => resetKnockoutEvaluation();

  const selectedBarrier = barriers[selectedRate];
  const selectedMessage = barrierMessages[selectedRate];
  const selectedForecasts = forecastHistory[selectedRate];
  const visibleEvaluation = isDemoAccount && knockoutEvaluationScope === evaluationScope
    ? knockoutEvaluation
    : [];

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
      <section className="mbkl-evaluation" aria-label="Demo forecast evaluation" data-testid="panel-knockout-evaluation">
        <div className="mbkl-evaluation-heading">
          <div>
            <h4>Forecast check</h4>
            <span>DEMO-ONLY TEST · NO ORDERS</span>
          </div>
          <div className="mbkl-evaluation-actions">
            <button
              type="button"
              onClick={startDemoEvaluation}
              disabled={!canStartEvaluation}
              data-testid="button-start-knockout-evaluation"
            >
              {visibleEvaluation.length ? "Restart test" : "Start test"}
            </button>
            {visibleEvaluation.length > 0 && (
              <button
                type="button"
                className="mbkl-clear-evaluation"
                onClick={clearDemoEvaluation}
                data-testid="button-clear-knockout-evaluation"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <p className="mbkl-evaluation-description">
          Captures one estimate per growth rate, then counts later demo ticks until that rate’s barrier is crossed. Sparse or flat starts are not scored; gather more quotes or movement, then restart.
        </p>
        {!isDemoAccount ? (
          <p className="mbkl-evaluation-guard" data-testid="status-knockout-evaluation-guard">
            Select a demo account to evaluate. Real-account ticks are never recorded in this test.
          </p>
        ) : !connected ? (
          <p className="mbkl-evaluation-guard" data-testid="status-knockout-evaluation-guard">
            Connect a demo account to start a read-only evaluation.
          </p>
        ) : null}
        {visibleEvaluation.length > 0 && (
          <ol className="mbkl-evaluation-results" aria-label="Demo forecast results by growth rate">
            {visibleEvaluation.map((evaluation) => (
              <li
                key={evaluation.growthRate}
                data-testid={`row-knockout-evaluation-${evaluation.growthRate}`}
              >
                <strong>{evaluation.growthRate}%</strong>
                <span>
                  Estimate: {evaluation.estimateTicks == null ? "not available" : `${evaluation.estimateTicks} ticks`}
                </span>
                <span className={evaluation.status === "hit" ? "is-scored" : ""}>
                  {evaluationResultLabel(evaluation)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
