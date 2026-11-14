import { useEffect, useMemo, useState } from "react";
import type {
  MatrixChartTick,
  MatrixDirection,
  MatrixDuration,
  MatrixMarketOption,
  MatrixMarketSignal,
} from "../components/matrix-panel";

export const MATRIX_MARKETS: MatrixMarketOption[] = [
  { symbol: "BOOM300", label: "Boom 300", family: "Boom", bias: "up" },
  { symbol: "BOOM500", label: "Boom 500", family: "Boom", bias: "up" },
  { symbol: "BOOM600", label: "Boom 600", family: "Boom", bias: "up" },
  { symbol: "BOOM900", label: "Boom 900", family: "Boom", bias: "up" },
  { symbol: "BOOM1000", label: "Boom 1000", family: "Boom", bias: "up" },
  { symbol: "CRASH300", label: "Crash 300", family: "Crash", bias: "down" },
  { symbol: "CRASH500", label: "Crash 500", family: "Crash", bias: "down" },
  { symbol: "CRASH600", label: "Crash 600", family: "Crash", bias: "down" },
  { symbol: "CRASH900", label: "Crash 900", family: "Crash", bias: "down" },
  { symbol: "CRASH1000", label: "Crash 1000", family: "Crash", bias: "down" },
  { symbol: "RDBULL", label: "Bull Market", family: "Bull", bias: "up" },
  { symbol: "RDBEAR", label: "Bear Market", family: "Bear", bias: "down" },
];

type MarketTickPayload = {
  symbol: string;
  tick_sequence?: number;
  tick_epoch?: number;
  quote?: number | null;
  recent_quotes?: Array<{ quote: number; epoch: number; sequence: number }>;
};

export type MatrixScannerRecommendation = {
  symbol: string;
  direction: MatrixDirection;
  duration: MatrixDuration;
  percentage: number;
  sampleCount: number;
};

const durationWindows: Array<{ duration: MatrixDuration; ticks?: number; seconds?: number }> = [
  { duration: "10t", ticks: 10 },
  { duration: "20t", ticks: 20 },
  { duration: "1m", seconds: 60 },
  { duration: "3m", seconds: 180 },
  { duration: "5m", seconds: 300 },
  { duration: "10m", seconds: 600 },
  { duration: "30m", seconds: 1_800 },
  { duration: "1h", seconds: 3_600 },
];

function cleanTicks(raw: unknown): MatrixChartTick[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Map<number, MatrixChartTick>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { quote?: unknown; epoch?: unknown; sequence?: unknown };
    const quote = Number(item.quote);
    const epoch = Number(item.epoch);
    const sequence = Number(item.sequence);
    if (
      !Number.isFinite(quote)
      || quote <= 0
      || !Number.isFinite(epoch)
      || !Number.isInteger(sequence)
      || sequence < 0
    ) continue;
    unique.set(sequence, { quote, epoch, sequence });
  }
  return [...unique.values()].sort((left, right) => left.sequence - right.sequence).slice(-240);
}

function updateTicks(current: MatrixChartTick[], payload: MarketTickPayload): MatrixChartTick[] {
  const fromSnapshot = cleanTicks(payload.recent_quotes);
  const existing = new Map(current.map((tick) => [tick.sequence, tick]));
  for (const tick of fromSnapshot) existing.set(tick.sequence, tick);
  const quote = Number(payload.quote);
  const sequence = Number(payload.tick_sequence);
  const epoch = Number(payload.tick_epoch);
  if (Number.isFinite(quote) && quote > 0 && Number.isInteger(sequence) && Number.isFinite(epoch)) {
    existing.set(sequence, { quote, epoch, sequence });
  }
  return [...existing.values()].sort((left, right) => left.sequence - right.sequence).slice(-240);
}

function directionalEvidence(ticks: MatrixChartTick[]) {
  const changes = ticks.slice(1).map((tick, index) => tick.quote - ticks[index].quote);
  const moving = changes.filter((change) => change !== 0);
  const rises = moving.filter((change) => change > 0).length;
  return {
    sampleCount: moving.length,
    risePercentage: moving.length ? (rises / moving.length) * 100 : null,
  };
}

function suggestFromSignals(signals: MatrixMarketSignal[]): MatrixScannerRecommendation | null {
  let best: (MatrixScannerRecommendation & { score: number }) | null = null;
  const nowSeconds = Date.now() / 1000;
  for (const signal of signals) {
    const latestEpoch = signal.quotes.at(-1)?.epoch ?? nowSeconds;
    for (const window of durationWindows) {
      const ticks = window.ticks
        ? signal.quotes.slice(-window.ticks)
        : signal.quotes.filter((tick) => tick.epoch >= latestEpoch - (window.seconds ?? 60));
      const evidence = directionalEvidence(ticks);
      if (evidence.sampleCount < 8 || evidence.risePercentage == null) continue;
      const direction: MatrixDirection = evidence.risePercentage >= 50 ? "HIGHER" : "LOWER";
      const percentage = Math.max(evidence.risePercentage, 100 - evidence.risePercentage);
      const score = percentage + Math.min(evidence.sampleCount, 80) * 0.015;
      if (!best || score > best.score) {
        best = {
          symbol: signal.symbol,
          direction,
          duration: window.duration,
          percentage: Number(percentage.toFixed(1)),
          sampleCount: evidence.sampleCount,
          score,
        };
      }
    }
  }
  if (!best || best.percentage < 58) return null;
  const { score: _score, ...recommendation } = best;
  return recommendation;
}

export function useMatrixMarketFeed(enabled: boolean) {
  const [quotesBySymbol, setQuotesBySymbol] = useState<Record<string, MatrixChartTick[]>>({});
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Matrix is paused.");

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setStatus("Matrix is paused.");
      return;
    }

    let disposed = false;
    setQuotesBySymbol({});
    setConnected(false);
    setStatus("Connecting to the live market feed.");
    const source = new EventSource("/api/deriv/events?market_ticks=true", { withCredentials: true });
    const allowedSymbols = new Set(MATRIX_MARKETS.map((market) => market.symbol));

    const applyPayload = (payload: MarketTickPayload | MarketTickPayload[]) => {
      const updates = Array.isArray(payload) ? payload : [payload];
      setQuotesBySymbol((current) => {
        const next = { ...current };
        for (const update of updates) {
          if (!update || !allowedSymbols.has(update.symbol)) continue;
          next[update.symbol] = updateTicks(next[update.symbol] ?? [], update);
        }
        return next;
      });
      if (!disposed) setStatus("Live market data is updating. Scanner suggestions require fresh samples.");
    };

    const onSnapshot = (event: Event) => {
      try {
        applyPayload(JSON.parse((event as MessageEvent<string>).data) as MarketTickPayload[]);
      } catch {
        setStatus("The market feed sent invalid data. Waiting for a fresh snapshot.");
      }
    };
    const onTick = (event: Event) => {
      try {
        applyPayload(JSON.parse((event as MessageEvent<string>).data) as MarketTickPayload);
      } catch {
        setStatus("The market feed sent invalid data. Waiting for the next update.");
      }
    };
    source.addEventListener("open", () => {
      if (!disposed) {
        setConnected(true);
        setStatus("Live market feed connected.");
      }
    });
    source.addEventListener("market-tick-snapshot", onSnapshot);
    source.addEventListener("market-tick", onTick);
    source.addEventListener("error", () => {
      if (!disposed) {
        setConnected(false);
        setStatus("Market feed reconnecting. No scanner setup is sent automatically.");
      }
    });
    return () => {
      disposed = true;
      source.close();
    };
  }, [enabled]);

  const signals = useMemo(() => MATRIX_MARKETS.map((market) => {
    const quotes = quotesBySymbol[market.symbol] ?? [];
    const recentEvidence = directionalEvidence(quotes.slice(-21));
    return {
      symbol: market.symbol,
      quotes,
      percentage: recentEvidence.risePercentage == null ? null : Number(recentEvidence.risePercentage.toFixed(1)),
      sampleCount: recentEvidence.sampleCount,
    };
  }), [quotesBySymbol]);
  const recommendation = useMemo(() => suggestFromSignals(signals), [signals]);

  return { signals, connected, status, recommendation };
}
