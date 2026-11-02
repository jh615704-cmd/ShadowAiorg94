import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import {
  useGetMoneyBankKnockoutBarriers,
  type MoneyBankKnockoutBarriersResponse,
} from "@workspace/api-client-react";
import {
  appendMoneyBankKnockouts,
  MONEY_BANK_LIVE_KNOCKOUT_LIMIT,
  type MoneyBankLiveKnockoutPrice,
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

function displayQuote(value: number) {
  return value.toFixed(2);
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
  const [hitQuotes, setHitQuotes] = useState<RateRecord<MoneyBankLiveKnockoutPrice[]>>(
    () => emptyRateRecord(() => []),
  );
  const [latestHitSequence, setLatestHitSequence] = useState<RateRecord<number | null>>(
    () => emptyRateRecord(() => null),
  );
  const [barrierLoading, setBarrierLoading] = useState(false);
  const [barrierRefreshFailed, setBarrierRefreshFailed] = useState(false);

  const mutation = useGetMoneyBankKnockoutBarriers();
  const requestBarriersRef = useRef(mutation.mutateAsync);
  requestBarriersRef.current = mutation.mutateAsync;
  const barriersRef = useRef(barriers);
  const referencesRef = useRef<RateRecord<number | null>>(emptyRateRecord(() => null));
  const sequenceCursorsRef = useRef<RateRecord<number | null>>(emptyRateRecord(() => null));
  const hitQuotesRef = useRef(hitQuotes);
  const lastSymbolRef = useRef(symbol);

  useEffect(() => {
    if (lastSymbolRef.current === symbol) return;
    lastSymbolRef.current = symbol;
    const emptyQuotes = emptyRateRecord(() => [] as MoneyBankLiveKnockoutPrice[]);
    const noBarriers = emptyRateRecord(() => null as number | null);
    const noMessages = emptyRateRecord(() => null as string | null);
    hitQuotesRef.current = emptyQuotes;
    barriersRef.current = noBarriers;
    referencesRef.current = emptyRateRecord(() => null);
    sequenceCursorsRef.current = emptyRateRecord(() => null);
    setHitQuotes(emptyQuotes);
    setLatestHitSequence(emptyRateRecord(() => null));
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
        for (const rate of RATE_OPTIONS) {
          const previousBarrier = barriersRef.current[rate];
          const nextBarrier = nextBarriers[rate];
          const cursor = sequenceCursorsRef.current[rate];
          const feedRestarted = snapshotSequence != null && cursor != null && snapshotSequence < cursor;
          if (previousBarrier !== nextBarrier || feedRestarted || cursor == null) {
            referencesRef.current[rate] = snapshotQuote;
            sequenceCursorsRef.current[rate] = snapshotSequence;
            if (feedRestarted) {
              const nextHits = { ...hitQuotesRef.current, [rate]: [] };
              hitQuotesRef.current = nextHits;
              setHitQuotes(nextHits);
              setLatestHitSequence((current) => ({ ...current, [rate]: null }));
            }
          }
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

    const nextHits = { ...hitQuotesRef.current };
    const nextLatest = { ...latestHitSequence };
    let changed = false;
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
      const result = appendMoneyBankKnockouts({
        ticks: newTicks,
        barrier: barriersRef.current[rate],
        referenceQuote: referencesRef.current[rate],
        existingHits: nextHits[rate],
      });
      referencesRef.current[rate] = result.referenceQuote;
      sequenceCursorsRef.current[rate] = sequence;
      const latestSequence = result.hits.at(-1)?.sequence ?? null;
      const previousLatestSequence = nextHits[rate].at(-1)?.sequence ?? null;
      if (latestSequence !== previousLatestSequence) {
        nextLatest[rate] = latestSequence;
        changed = true;
      }
      nextHits[rate] = result.hits;
    }

    if (changed) {
      hitQuotesRef.current = nextHits;
      setHitQuotes(nextHits);
      setLatestHitSequence(nextLatest);
    }
  }, [barriers, connected, hitQuotes, latestHitSequence, quote, recentQuotes, tickSequence]);

  const selectedBarrier = barriers[selectedRate];
  const selectedMessage = barrierMessages[selectedRate];
  const selectedHits = hitQuotes[selectedRate];

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
            ? `BARRIER ±${displayQuote(selectedBarrier)}`
            : barrierLoading
              ? "LOADING BARRIER"
              : "BARRIER UNAVAILABLE"}
        </span>
      </div>

      <div className="mbkl-feed-labels" aria-hidden="true">
        <span>OLDEST HIT</span>
        <span>NEWEST HIT</span>
      </div>
      <ol className="mbkl-price-stream" aria-label={`${selectedRate}% latest knockout prices, oldest to newest`}>
        {Array.from({ length: MONEY_BANK_LIVE_KNOCKOUT_LIMIT }, (_, index) => {
          const hit = selectedHits[index];
          const isNewest = hit != null && hit.sequence === latestHitSequence[selectedRate];
          return (
            <li
              key={hit ? `${selectedRate}-${hit.sequence}` : `empty-${index}`}
              className={`${hit ? "has-price" : "is-empty"} ${isNewest ? "is-new" : ""}`}
              aria-label={hit ? `Knockout quote ${displayQuote(hit.quote)}` : "Waiting for a knockout quote"}
            >
              {hit ? displayQuote(hit.quote) : "···"}
            </li>
          );
        })}
      </ol>

      <p className="mbkl-status" role="status">
        {!connected
          ? "Connect Deriv to watch this market’s live quotes."
          : selectedBarrier == null
            ? selectedMessage ?? (barrierRefreshFailed ? "Could not refresh the current Deriv barrier." : "Waiting for a current barrier.")
            : selectedHits.length
              ? "Only live prices that crossed this barrier are shown. New hits replace the oldest price."
              : "Waiting for the first live price to cross this barrier."}
      </p>
      <p className="mbkl-note">
        Read-only market monitor · The reference resets after each hit; these are not contract outcomes.
      </p>
    </section>
  );
}
