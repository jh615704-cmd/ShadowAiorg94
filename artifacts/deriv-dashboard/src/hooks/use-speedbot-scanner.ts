import { useCallback, useEffect, useRef, useState } from "react";
import {
  collectAutoTraderTickChanges,
  type AutoTraderMarketTickSignal,
} from "@/lib/auto-trader-ticks";
import type { AutoMagicSignal, AutoMagicCandidate } from "@/lib/auto-magic-strategy";
import { chooseSpeedbotCandidate } from "@/lib/speedbot-strategy";

type Props = {
  running: boolean;
  symbol: string;
  duration: number;
  onCandidate: (candidate: AutoMagicCandidate) => void;
};

type ScannerSignal = AutoMagicSignal & { tick_sequence: number };

function validDigits(signal: AutoTraderMarketTickSignal): number[] {
  return Array.isArray(signal.recent_digits)
    ? signal.recent_digits.filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9)
    : [];
}

export function useSpeedbotScanner({ running, symbol, duration, onCandidate }: Props) {
  const [lastDigit, setLastDigit] = useState<number | null>(null);
  const [status, setStatus] = useState("Speedbot is stopped.");
  const onCandidateRef = useRef(onCandidate);
  onCandidateRef.current = onCandidate;
  const signalsRef = useRef(new Map<string, ScannerSignal>());
  const seenTicksRef = useRef<Record<string, number>>({});
  const baselineTicksRef = useRef<Record<string, number>>({});
  const frequenciesRef = useRef<Record<string, number[]>>({});

  const resetScan = useCallback(() => {
    for (const [marketSymbol, signal] of signalsRef.current) {
      seenTicksRef.current[marketSymbol] = signal.tick_sequence;
      baselineTicksRef.current[marketSymbol] = signal.tick_sequence;
      frequenciesRef.current[marketSymbol] = Array(10).fill(0);
    }
  }, []);

  useEffect(() => {
    if (!running) {
      setStatus("Speedbot is stopped.");
      return;
    }

    signalsRef.current.clear();
    seenTicksRef.current = {};
    baselineTicksRef.current = {};
    frequenciesRef.current = {};
    setLastDigit(null);
    setStatus("Connecting to the live market feed.");

    const source = new EventSource("/api/deriv/events?market_ticks=true", { withCredentials: true });

    const setSnapshot = (signals: AutoTraderMarketTickSignal[]) => {
      if (!Array.isArray(signals)) return;
      signalsRef.current.clear();
      seenTicksRef.current = {};
      baselineTicksRef.current = {};
      frequenciesRef.current = {};

      for (const signal of signals) {
        const digits = validDigits(signal);
        if (!digits.length || !Number.isInteger(signal.tick_sequence)) continue;
        const marketSignal: ScannerSignal = {
          symbol: signal.symbol,
          sample_count: digits.length,
          recent_digits: digits,
          tick_sequence: signal.tick_sequence,
        };
        signalsRef.current.set(signal.symbol, marketSignal);
        seenTicksRef.current[signal.symbol] = signal.tick_sequence;
        baselineTicksRef.current[signal.symbol] = signal.tick_sequence;
        frequenciesRef.current[signal.symbol] = Array(10).fill(0);
      }

      const selected = signalsRef.current.get(symbol);
      const latest = selected?.recent_digits.at(-1);
      setLastDigit(Number.isInteger(latest) ? latest! : null);
      setStatus(selected
        ? "Live feed connected. Waiting for a fresh market tick."
        : "Waiting for the selected market to appear in the live feed.");
    };

    const onSnapshot = (event: Event) => {
      try {
        const signals = JSON.parse((event as MessageEvent<string>).data) as AutoTraderMarketTickSignal[];
        setSnapshot(signals);
      } catch {
        setStatus("The live feed sent invalid market data. Waiting for a fresh snapshot.");
      }
    };

    const onTick = (event: Event) => {
      try {
        const signal = JSON.parse((event as MessageEvent<string>).data) as AutoTraderMarketTickSignal;
        if (!signal || typeof signal.symbol !== "string") return;
        const digits = validDigits(signal);
        if (!digits.length || !Number.isInteger(signal.tick_sequence)) return;

        const nextSignal: ScannerSignal = {
          symbol: signal.symbol,
          sample_count: digits.length,
          recent_digits: digits,
          tick_sequence: signal.tick_sequence,
        };
        signalsRef.current.set(signal.symbol, nextSignal);
        const { arrivals } = collectAutoTraderTickChanges(
          [signal],
          seenTicksRef.current,
          baselineTicksRef.current,
        );
        if (!arrivals.length || signal.symbol !== symbol) return;

        const latestDigit = digits.at(-1);
        if (!Number.isInteger(latestDigit)) return;
        setLastDigit(latestDigit!);
        const counts = frequenciesRef.current[symbol] ?? Array(10).fill(0);
        for (const arrival of arrivals) counts[arrival.digit] += 1;
        frequenciesRef.current[symbol] = counts;
        setStatus("Scanning fresh market data for a qualifying setup.");

        const candidate = chooseSpeedbotCandidate({
          signal: nextSignal,
          latestDigit: latestDigit!,
          scanFrequencies: counts,
          duration,
        });
        if (candidate) onCandidateRef.current(candidate);
      } catch {
        setStatus("The live feed sent invalid market data. Waiting for the next valid tick.");
      }
    };

    source.addEventListener("open", () => {
      setStatus("Live market feed connected. Waiting for a fresh market tick.");
    });
    source.addEventListener("market-tick-snapshot", onSnapshot);
    source.addEventListener("market-tick", onTick);
    source.addEventListener("error", () => {
      setStatus("Live market feed reconnecting. No new entries will be sent until it returns.");
    });

    return () => source.close();
  }, [duration, running, symbol]);

  return { lastDigit, status, resetScan, setStatus };
}
