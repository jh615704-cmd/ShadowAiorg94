import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, BookOpen, Check,
  ChevronLeft, ChevronRight, CircleHelp, Clock3,
  Pause, Play, Radar, RefreshCw, Settings2, ShieldAlert, Signal, Trash2, X,
} from "lucide-react";
import {
  getGetAccessSessionQueryKey,
  getGetAdminFeatureSettingsQueryKey,
  getGetDerivAccountsQueryKey,
  getGetDerivHistoryQueryKey,
  getGetDerivStatusQueryKey,
  getGetDerivTokenStatusQueryKey,
  useBulkBuyDerivContracts,
  useGetAccessSession,
  useGetAdminFeatureSettings,
  useGetDerivAccounts,
  useGetDerivHistory,
  useGetDerivStatus,
  useGetDerivTokenStatus,
} from "@workspace/api-client-react";
import type { DerivHistoryItem } from "@workspace/api-client-react";
import { mergeDerivTradeUpdate } from "@/lib/deriv-trade-feed";
import { collectAutoTraderTickChanges, getAutoTraderOppositeDigitGroup, type AutoTraderMarketTickSignal } from "@/lib/auto-trader-ticks";
import { chooseAutoMagicCandidate, type AutoMagicSignal } from "@/lib/auto-magic-strategy";
import { AppShell } from "@/components/layout/app-shell";
import { DerivAccountSwitcher } from "@/components/deriv-account-switcher";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAccountBalance } from "@/lib/account-balance";
import { formatSignedDerivProfit, getDerivOpenLiveProfit, isDerivHistoryOpen, summarizeDerivWinLoss, uniqueDerivHistoryRows } from "@/lib/deriv-history";
import { validateAutoTraderBatch } from "@/lib/trade-entry-guards";
import "./auto-trader.css";

type MarketGroup = "regular" | "jump" | "one-sec";
type Market = { symbol: string; name: string; group: MarketGroup };

const markets: Market[] = [
  { symbol: "R_10", name: "Volatility 10", group: "regular" },
  { symbol: "R_25", name: "Volatility 25", group: "regular" },
  { symbol: "R_50", name: "Volatility 50", group: "regular" },
  { symbol: "R_75", name: "Volatility 75", group: "regular" },
  { symbol: "R_100", name: "Volatility 100", group: "regular" },
  { symbol: "JD10", name: "Jump 10", group: "jump" },
  { symbol: "JD25", name: "Jump 25", group: "jump" },
  { symbol: "JD50", name: "Jump 50", group: "jump" },
  { symbol: "JD75", name: "Jump 75", group: "jump" },
  { symbol: "JD100", name: "Jump 100", group: "jump" },
  { symbol: "1HZ10V", name: "Volatility 10 · 1s", group: "one-sec" },
  { symbol: "1HZ25V", name: "Volatility 25 · 1s", group: "one-sec" },
  { symbol: "1HZ50V", name: "Volatility 50 · 1s", group: "one-sec" },
  { symbol: "1HZ75V", name: "Volatility 75 · 1s", group: "one-sec" },
  { symbol: "1HZ100V", name: "Volatility 100 · 1s", group: "one-sec" },
];

const groupLabels: Record<MarketGroup, string> = {
  regular: "REGULAR VOLATILITY",
  jump: "JUMP INDICES",
  "one-sec": "VOLATILITY 1S",
};
const filterOptions: Array<[FilterKey, string, number]> = [
  ["all", "All markets", markets.length],
  ["regular", "Volatility", markets.filter((market) => market.group === "regular").length],
  ["jump", "Jump", markets.filter((market) => market.group === "jump").length],
  ["one-sec", "Volatility 1s", markets.filter((market) => market.group === "one-sec").length],
];
const storagePrefix = "deriv-auto-trader-contracts:";
const guideCopy = [
  ["Auto Trader overview", "This workspace shows live last-digit counts for supported Deriv markets and lets you place manual Digit Differs orders or use Auto Magic.", "Auto Magic can send one selected 3×/6× batch after you enable it and press Go Live. Press Rescan after settlement for another scan. Historical samples do not guarantee future results."],
  ["Confirm your account", "Check the account name, account type, connection, and balance in the header before using the controls.", "A real account uses real funds. Demo trading is recommended while you learn."],
  ["Start and rescan", "Go Live counts new market ticks. Rescan resets the counts to a fresh live baseline while keeping your selected market filter and visible market list in place.", "Stop pauses the scan; it does not cancel contracts already accepted by Deriv."],
  ["Filter the market list", "Use All Markets, Volatility, Jump, or Volatility 1s to narrow the instruments shown. Each market keeps its own count during a scan.", "Rescanning does not change the selected filter."],
  ["Read the live digit advisory", "The advisory highlights digits in the opposite half from the latest observed digit on that market. You can still review and select any digit manually.", "It describes a recent observation only; it does not predict the next digit or guarantee a win."],
  ["Read digit counts", "Each count is the number of times a final digit appeared since this scan began. Counts increase only when new Deriv ticks arrive.", "A low or zero count is not evidence that a digit is due to appear."],
  ["Place a Digit Differs order", "Choose a barrier digit and press 3× or 6× to request that many separate contracts using the stake and duration in Settings.", "Orders are sent only after you press a trade button. Each contract can settle differently."],
  ["Manage stake and duration", "Stake is per contract. Tick 0 is the entry spot; a 1-tick contract settles on the next price update, and 2–5 tick contracts settle on their matching numbered update.", "A 6× order requests six times the per-contract stake. Take-profit and stop-loss are reference targets, not automatic close instructions."],
  ["Review history", "Today's trades and daily totals include only contracts placed from this page on the selected account.", "Clear removes them from this account-scoped view only. Deriv's account history is not deleted."],
  ["Verify outcomes", "Deriv settles each Digit Differs contract at expiry. It wins only if the final digit differs from its barrier.", "If an order response is uncertain, check Deriv history before retrying it."],
] as const;

type LocalContract = {
  id: string;
  placedAt: number;
  batchId?: string;
  batchIndex?: number;
  batchCount?: number;
};
type FilterKey = "all" | MarketGroup;
type Frequencies = Record<string, number[]>;
type TickMap = Record<string, number>;
type AutoMagicStatus = "off" | "ready" | "waiting" | "settings" | "placing" | "settling" | "rescan" | "review";
type TradePlacementOutcome =
  | { kind: "accepted"; contractIds: string[] }
  | { kind: "not-sent" }
  | { kind: "uncertain"; contractIds: string[] };

const money = (amount: number | undefined, currency = "USD") =>
  amount == null || !Number.isFinite(amount)
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function AutoTraderContent() {
  const queryClient = useQueryClient();
  const access = useGetAccessSession({ query: { queryKey: getGetAccessSessionQueryKey(), retry: false } });
  const featureSettings = useGetAdminFeatureSettings({
    query: { queryKey: getGetAdminFeatureSettingsQueryKey(), retry: false, refetchInterval: 10_000 },
  });
  const isAdmin = access.data?.is_admin === true;
  const featureAvailable = featureSettings.data?.features.find((item) => item.feature === "auto-trader")?.mode === "available";
  const hasAutoTraderAccess = isAdmin || (access.data?.features.includes("auto-trader") === true && featureAvailable);
  const token = useGetDerivTokenStatus({ query: { queryKey: getGetDerivTokenStatusQueryKey(), retry: false, enabled: hasAutoTraderAccess } });
  const hasToken = token.data?.has_token === true;
  const [scanning, setScanning] = useState(false);
  const [scanResetPending, setScanResetPending] = useState(false);
  const scanRestartLockRef = useRef(false);
  const [autoMagicEnabled, setAutoMagicEnabled] = useState(false);
  const [autoMagicCount, setAutoMagicCount] = useState<3 | 6>(3);
  const [autoMagicStatus, setAutoMagicStatus] = useState<AutoMagicStatus>("off");
  const [autoMagicRunActive, setAutoMagicRunActive] = useState(false);
  const [autoMagicBatchIds, setAutoMagicBatchIds] = useState<string[]>([]);
  const autoMagicAttemptedRef = useRef(false);
  const [scannerSignals, setScannerSignals] = useState<AutoMagicSignal[]>([]);
  const accounts = useGetDerivAccounts({
    query: { queryKey: getGetDerivAccountsQueryKey(), enabled: hasAutoTraderAccess && hasToken, retry: false, refetchInterval: 10_000 },
  });
  const status = useGetDerivStatus(undefined, {
    query: {
      queryKey: getGetDerivStatusQueryKey(),
      enabled: hasAutoTraderAccess && hasToken,
      retry: false,
      refetchInterval: scanning ? 5_000 : false,
    },
  });
  const history = useGetDerivHistory(undefined, {
    query: { queryKey: getGetDerivHistoryQueryKey(), enabled: hasAutoTraderAccess && hasToken, retry: false, refetchInterval: false },
  });
  const bulkBuy = useBulkBuyDerivContracts();
  const batchSubmitLockRef = useRef(false);

  const [filter, setFilter] = useState<FilterKey>("all");
  const [stake, setStake] = useState("1.00");
  const [durationTicks, setDurationTicks] = useState("1");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guidePage, setGuidePage] = useState(0);
  const [takeProfit, setTakeProfit] = useState("10");
  const [stopLoss, setStopLoss] = useState("10");
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [messageFading, setMessageFading] = useState(false);
  const [historyClearArmed, setHistoryClearArmed] = useState(false);
  const [historyFading, setHistoryFading] = useState(false);
  const clearHistoryTimer = useRef<number | null>(null);
  const [frequencies, setFrequencies] = useState<Frequencies>({});
  const [marketTicks, setMarketTicks] = useState<TickMap>({});
  const [latestDigits, setLatestDigits] = useState<Record<string, number>>({});
  const seenTicks = useRef<TickMap>({});
  const baselineTicks = useRef<TickMap>({});
  const scanResetPendingRef = useRef(false);
  const account = status.data?.account ?? null;
  const accountId = account?.id ?? "";
  const currentSignals = status.data?.market_signals ?? [];

  const [localContracts, setLocalContracts] = useState<LocalContract[]>([]);
  const localContractsRef = useRef(localContracts);
  localContractsRef.current = localContracts;

  useEffect(() => {
    if (!hasAutoTraderAccess) {
      setScanning(false);
      setAutoMagicEnabled(false);
      setAutoMagicRunActive(false);
      setAutoMagicStatus("off");
    }
  }, [hasAutoTraderAccess]);

  useEffect(() => {
    if (!message) {
      setMessageFading(false);
      return;
    }
    setMessageFading(false);
    const fadeTimer = window.setTimeout(() => setMessageFading(true), 3_600);
    const removeTimer = window.setTimeout(() => {
      setMessage((current) => current === message ? null : current);
    }, 4_000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [message]);

  useEffect(() => {
    if (!accountId) {
      setLocalContracts([]);
      return;
    }
    try {
      const saved = localStorage.getItem(`${storagePrefix}${accountId}`);
      const parsed = saved ? JSON.parse(saved) as LocalContract[] : [];
      setLocalContracts(Array.isArray(parsed) ? parsed.filter((entry) => typeof entry?.id === "string" && Number.isFinite(entry.placedAt)) : []);
    } catch {
      setLocalContracts([]);
    }
  }, [accountId]);

  useEffect(() => {
    // A sequence cursor belongs to one active Deriv account only.
    setScanning(false);
    setHistoryClearArmed(false);
    if (clearHistoryTimer.current !== null) {
      window.clearTimeout(clearHistoryTimer.current);
      clearHistoryTimer.current = null;
    }
    setFrequencies({});
    setMarketTicks({});
    setLatestDigits({});
    setScannerSignals([]);
    seenTicks.current = {};
    baselineTicks.current = {};
    autoMagicAttemptedRef.current = false;
    setAutoMagicBatchIds([]);
    setAutoMagicEnabled(false);
    setAutoMagicRunActive(false);
    setAutoMagicStatus("off");
  }, [accountId]);

  useEffect(() => () => {
    if (clearHistoryTimer.current !== null) window.clearTimeout(clearHistoryTimer.current);
  }, []);

  useEffect(() => {
    if (!hasAutoTraderAccess || !hasToken || !accountId || !history.isFetched) return;

    const eventUrl = scanning
      ? "/api/deriv/events?market_ticks=true"
      : "/api/deriv/events";
    const source = new EventSource(eventUrl, { withCredentials: true });
    const applySignals = (signals: AutoTraderMarketTickSignal[]) => {
      if (!scanning || scanResetPendingRef.current || !Array.isArray(signals)) return;
      setScannerSignals((current) => {
        const next = new Map(current.map((signal) => [signal.symbol, signal]));
        for (const signal of signals) {
          const recentDigits = signal.recent_digits.filter((digit) =>
            Number.isInteger(digit) && digit >= 0 && digit <= 9
          );
          if (!recentDigits.length) continue;
          next.set(signal.symbol, {
            symbol: signal.symbol,
            sample_count: recentDigits.length,
            recent_digits: recentDigits,
          });
        }
        return [...next.values()];
      });
      setLatestDigits((current) => {
        let next = current;
        for (const signal of signals) {
          const latest = signal.recent_digits.at(-1);
          if (!Number.isInteger(latest) || latest! < 0 || latest! > 9 || current[signal.symbol] === latest) continue;
          if (next === current) next = { ...current };
          next[signal.symbol] = latest!;
        }
        return next;
      });
      const { arrivals, progress } = collectAutoTraderTickChanges(
        signals,
        seenTicks.current,
        baselineTicks.current,
      );
      if (arrivals.length) {
        setFrequencies((old) => {
          const next = { ...old };
          for (const arrival of arrivals) {
            const counts = [...(next[arrival.symbol] ?? Array(10).fill(0))];
            counts[arrival.digit] += 1;
            next[arrival.symbol] = counts;
          }
          return next;
        });
      }
      if (Object.keys(progress).length) {
        setMarketTicks((current) => ({ ...current, ...progress }));
      }
    };

    source.addEventListener("market-tick-snapshot", (event) => {
      try {
        applySignals(JSON.parse((event as MessageEvent<string>).data) as AutoTraderMarketTickSignal[]);
      } catch {
        // Ignore malformed tick snapshots; EventSource will reconnect with a fresh snapshot.
      }
    });
    source.addEventListener("market-tick", (event) => {
      try {
        applySignals([JSON.parse((event as MessageEvent<string>).data) as AutoTraderMarketTickSignal]);
      } catch {
        // Ignore malformed ticks and keep the stream open for later updates.
      }
    });
    source.addEventListener("history-snapshot", (event) => {
      try {
        const rows = JSON.parse((event as MessageEvent<string>).data) as DerivHistoryItem[];
        if (!Array.isArray(rows)) return;
        const trackedIds = new Set(localContractsRef.current.map((entry) => entry.id));
        queryClient.setQueryData<DerivHistoryItem[]>(
          getGetDerivHistoryQueryKey(),
          (current) => {
            const merged = new Map(
              rows
                .filter((row) => row.account_id === accountId)
                .map((row) => [row.contract_id, row]),
            );
            for (const row of current ?? []) {
              if (
                row.account_id === accountId
                && trackedIds.has(row.contract_id)
                && !merged.has(row.contract_id)
              ) {
                merged.set(row.contract_id, row);
              }
            }
            return [...merged.values()];
          },
        );
      } catch {
        // Keep the last known account-scoped history if a snapshot is malformed.
      }
    });
    source.addEventListener("trade-update", (event) => {
      try {
        const row = JSON.parse((event as MessageEvent<string>).data) as DerivHistoryItem;
        if (!row || row.account_id !== accountId || typeof row.contract_id !== "string") return;
        queryClient.setQueryData<DerivHistoryItem[]>(
          getGetDerivHistoryQueryKey(),
          (current) => mergeDerivTradeUpdate(current, row),
        );
      } catch {
        // Ignore malformed frames and keep the stream open for later updates.
      }
    });

    return () => source.close();
  }, [accountId, hasAutoTraderAccess, hasToken, history.isFetched, queryClient, scanning]);

  const startScan = async (isRescan = false) => {
    if (!hasAutoTraderAccess) return;
    if (!connected) {
      setMessage({ tone: "error", text: "Connect and select an authorized Deriv account before starting the scanner." });
      return;
    }
    if (autoMagicStatus === "settling") {
      setMessage({ tone: "info", text: "Wait for every accepted Auto Magic contract to settle before rescanning." });
      return;
    }
    if (autoMagicEnabled && autoMagicStatus === "review") {
      setMessage({ tone: "error", text: "Check Deriv history before Auto Magic can be armed again. No order was resent." });
      return;
    }
    if (scanRestartLockRef.current) return;
    scanRestartLockRef.current = true;
    scanResetPendingRef.current = true;
    setScanResetPending(true);
    setMessage(null);
    try {
      const result = await status.refetch();
      if (result.error || !result.data) {
        setMessage({
          tone: "error",
          text: result.error instanceof Error ? result.error.message : "Live Deriv status could not be refreshed.",
        });
        return;
      }
      const startingSignals = result.data.market_signals ?? [];
      setScannerSignals(startingSignals.map((signal) => ({
        symbol: signal.symbol,
        sample_count: signal.sample_count,
        recent_digits: signal.recent_digits,
      })));
      const baseline = Object.fromEntries(startingSignals.map((signal) => [signal.symbol, signal.tick_sequence]));
      const startingDigits = Object.fromEntries(
        startingSignals.flatMap((signal) => {
          const digit = signal.recent_digits.at(-1);
          return Number.isInteger(digit) && digit! >= 0 && digit! <= 9
            ? [[signal.symbol, digit!] as const]
            : [];
        }),
      );
      seenTicks.current = { ...baseline };
      baselineTicks.current = { ...baseline };
      setFrequencies(Object.fromEntries(markets.map((market) => [market.symbol, Array(10).fill(0)])));
      setMarketTicks(Object.fromEntries(markets.map((market) => [market.symbol, 0])));
      setLatestDigits(startingDigits);
      if (isRescan) {
        autoMagicAttemptedRef.current = false;
        setAutoMagicBatchIds([]);
      }
      const canArmAutoMagic = autoMagicEnabled && !autoMagicAttemptedRef.current;
      setAutoMagicRunActive(canArmAutoMagic);
      setAutoMagicStatus(autoMagicEnabled
        ? canArmAutoMagic ? "waiting" : "rescan"
        : "off");
      setScanning(true);
      setMessage({ tone: "info", text: "Scanner live. Counts begin with the next real tick observed from Deriv." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Live Deriv status could not be refreshed.",
      });
    } finally {
      scanRestartLockRef.current = false;
      scanResetPendingRef.current = false;
      setScanResetPending(false);
    }
  };

  const clearTodayTrades = async () => {
    if (!accountId) return;
    if (!historyClearArmed) {
      setHistoryClearArmed(true);
      setMessage({ tone: "info", text: "Tap the bin again to clear today's Auto Trader trades for this account." });
      if (clearHistoryTimer.current !== null) window.clearTimeout(clearHistoryTimer.current);
      clearHistoryTimer.current = window.setTimeout(() => {
        setHistoryClearArmed(false);
        clearHistoryTimer.current = null;
      }, 2500);
      return;
    }

    setHistoryClearArmed(false);
    if (clearHistoryTimer.current !== null) {
      window.clearTimeout(clearHistoryTimer.current);
      clearHistoryTimer.current = null;
    }
    setHistoryFading(true);
    await new Promise((resolve) => window.setTimeout(resolve, 260));
    setLocalContracts([]);
    setHistoryFading(false);
    try {
      localStorage.removeItem(`${storagePrefix}${accountId}`);
      setMessage({ tone: "success", text: "Auto Trader trades were cleared from this account-scoped view. Deriv's account history is unchanged." });
    } catch {
      setMessage({ tone: "error", text: "The trades were cleared from this view, but this browser could not save the change." });
    }
  };

  const filteredMarkets = useMemo(
    () => filter === "all" ? markets : markets.filter((market) => market.group === filter),
    [filter],
  );
  const signalBySymbol = useMemo(
    () => new Map(currentSignals.map((signal) => [signal.symbol, signal])),
    [currentSignals],
  );
  const todayIds = useMemo(() => new Set(
    localContracts.filter((contract) => contract.placedAt >= todayStart()).map((contract) => contract.id),
  ), [localContracts]);
  const todaysHistory = useMemo(() => {
    if (!accountId || !history.data) return [];
    return uniqueDerivHistoryRows((history.data as DerivHistoryItem[]).filter((item) =>
      item.account_id === accountId
      && todayIds.has(item.contract_id)
      && (item.buy_time == null || item.buy_time * 1000 >= todayStart()),
    ));
  }, [accountId, history.data, todayIds]);
  const settled = todaysHistory.filter((item) => !isDerivHistoryOpen(item.status));
  const outcomeSummary = summarizeDerivWinLoss(todaysHistory);
  const wins = outcomeSummary.wins;
  const losses = outcomeSummary.losses;
  const dailyProfit = settled.reduce((total, item) => total + item.profit, 0);
  const currency = account?.currency ?? status.data?.currency ?? "USD";
  const accountBalance = getAccountBalance(account);
  const localContractById = useMemo(
    () => new Map(localContracts.map((contract) => [contract.id, contract])),
    [localContracts],
  );
  const visibleContracts = todaysHistory
    .slice()
    .sort((a, b) => (b.buy_time ?? 0) - (a.buy_time ?? 0));
  const hasOpenTodayContract = todaysHistory.some((item) => isDerivHistoryOpen(item.status));
  const winRate = outcomeSummary.sampleSize > 0 ? `${outcomeSummary.winRate.toFixed(1)}%` : "—";
  const connected = Boolean(status.data?.connected && status.data?.authorized && hasToken);
  const scanActionsDisabled = !connected
    || scanResetPending
    || autoMagicStatus === "settling"
    || (autoMagicEnabled && autoMagicStatus === "review");
  const autoMagicStatusText = !autoMagicEnabled
    ? autoMagicStatus === "settling"
      ? "OFF · An accepted batch is still settling."
      : autoMagicStatus === "review"
        ? "OFF · Check Deriv history before rearming."
        : "OFF"
    : autoMagicStatus === "ready"
      ? scanning ? "Enabled · press Rescan to start a new scan." : "Enabled · press Go Live to start."
      : autoMagicStatus === "waiting"
        ? "Scanning live markets for a qualifying setup."
        : autoMagicStatus === "settings"
          ? "Review stake, duration, and available balance."
          : autoMagicStatus === "placing"
            ? "Sending one batch."
            : autoMagicStatus === "settling"
              ? "Waiting for every accepted contract to settle."
              : autoMagicStatus === "rescan"
                ? "Batch finished · press Rescan for another."
                : autoMagicStatus === "review"
                  ? "Check Deriv history · Auto Magic will not retry."
                  : "OFF";
  const handleAutoMagicToggle = (enabled: boolean) => {
    setAutoMagicEnabled(enabled);
    setAutoMagicRunActive(false);
    if (autoMagicStatus === "settling" || autoMagicStatus === "review") return;
    setAutoMagicStatus(enabled
      ? autoMagicAttemptedRef.current ? "rescan" : "ready"
      : "off");
  };

  useEffect(() => {
    if (!accountId || (!hasOpenTodayContract && autoMagicStatus !== "settling")) return;
    const timer = window.setInterval(() => {
      void queryClient.refetchQueries(
        { queryKey: getGetDerivHistoryQueryKey(), type: "active" },
        { cancelRefetch: false },
      );
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [accountId, autoMagicStatus, hasOpenTodayContract, queryClient]);

  useEffect(() => {
    if (!accountId || autoMagicStatus !== "settling" || autoMagicBatchIds.length === 0) return;
    const accountHistory = (history.data ?? []) as DerivHistoryItem[];
    const allSettled = autoMagicBatchIds.every((contractId) => {
      const row = accountHistory.find((item) =>
        item.account_id === accountId && String(item.contract_id) === contractId
      );
      return row !== undefined && !isDerivHistoryOpen(row.status);
    });
    if (allSettled) {
      setAutoMagicRunActive(false);
      setAutoMagicStatus("rescan");
    }
  }, [accountId, autoMagicBatchIds, autoMagicStatus, history.data]);

  const placeTrade = async (
    market: Market,
    digit: number,
    count: 1 | 3 | 6,
  ): Promise<TradePlacementOutcome> => {
    if (batchSubmitLockRef.current || bulkBuy.isPending) {
      setMessage({ tone: "info", text: "Auto Trader is already sending a batch. Wait for its result before sending another." });
      return { kind: "not-sent" };
    }
    if (!hasAutoTraderAccess) {
      setMessage({ tone: "error", text: "Auto Trader access is restricted. No order was sent." });
      return { kind: "not-sent" };
    }
    const amount = Number(stake);
    const duration = Number(durationTicks);
    if (!accountId || !connected) {
      setMessage({ tone: "error", text: "Connect and select a Deriv account before trading." });
      return { kind: "not-sent" };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage({ tone: "error", text: "Enter a valid stake greater than zero." });
      return { kind: "not-sent" };
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 5) {
      setMessage({ tone: "error", text: "Enter a whole-number duration from 1 to 5 ticks." });
      return { kind: "not-sent" };
    }
    const orderError = validateAutoTraderBatch({
      stake: amount,
      balance: accountBalance,
      symbol: market.symbol,
      supportedSymbols: markets.map((item) => item.symbol),
      digit,
      duration,
      count,
    });
    if (orderError) {
      setMessage({ tone: "error", text: orderError });
      return { kind: "not-sent" };
    }
    setMessage(null);
    batchSubmitLockRef.current = true;
    let result: Awaited<ReturnType<typeof bulkBuy.mutateAsync>>;
    try {
      result = await bulkBuy.mutateAsync({
        data: {
          access_feature: "auto-trader",
          amount,
          duration,
          duration_unit: "t",
          contract_type: "DIGITDIFF",
          barrier: digit,
          symbol: market.symbol,
          count,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "The order could not be placed.";
      setMessage({
        tone: "error",
        text: `${errorMessage} If Deriv's response was uncertain, check account history before resubmitting.`,
      });
      return { kind: "uncertain", contractIds: [] };
    } finally {
      batchSubmitLockRef.current = false;
    }

    if (!result.buys.length) {
      setMessage({ tone: result.ok ? "success" : "info", text: result.message });
      return { kind: "not-sent" };
    }
    const validBuys = result.buys.filter((buy) => {
      const contractId = String(buy.contract_id ?? "").trim();
      return contractId.length > 0 && contractId !== "undefined" && contractId !== "null";
    });
    const hasMissingContractIds = validBuys.length !== result.buys.length;
    const placedAt = Date.now();
    const batchId = validBuys.length > 1 ? `auto-trader-${placedAt}-${validBuys[0]?.contract_id ?? "batch"}` : undefined;
    const fresh = validBuys.map((buy, index) => ({
      id: String(buy.contract_id),
      placedAt,
      ...(batchId ? { batchId, batchIndex: index + 1, batchCount: validBuys.length } : {}),
    }));
    const updated = [...localContracts.filter((item) => !fresh.some((entry) => entry.id === item.id)), ...fresh];
    setLocalContracts(updated);
    let trackingNote = "";
    try {
      localStorage.setItem(`${storagePrefix}${accountId}`, JSON.stringify(updated));
    } catch {
      trackingNote = " The order was accepted, but this browser could not save its local daily-stat tracking; check Deriv history.";
    }
    setMessage({
      tone: hasMissingContractIds ? "error" : result.ok ? "success" : "info",
      text: hasMissingContractIds
        ? `Deriv accepted an order response without every contract ID. Check account history before resubmitting.${trackingNote}`
        : `${result.ok
          ? `${validBuys.length} contract${validBuys.length === 1 ? "" : "s"} accepted for ${market.name}, digit ${digit}, ${duration} tick${duration === 1 ? "" : "s"}. Separate contracts can settle differently.`
          : result.message}${trackingNote}`,
    });
    const refetchOptions = { cancelRefetch: false };
    void Promise.all([
      queryClient.refetchQueries({ queryKey: getGetDerivStatusQueryKey(), type: "active" }, refetchOptions),
      queryClient.refetchQueries({ queryKey: getGetDerivHistoryQueryKey(), type: "active" }, refetchOptions),
      queryClient.refetchQueries({ queryKey: getGetDerivAccountsQueryKey(), type: "active" }, refetchOptions),
    ]).catch((error: unknown) => {
      console.warn("Could not refresh Auto Trader data after an accepted order.", error);
    });
    window.setTimeout(() => {
      void queryClient.refetchQueries(
        { queryKey: getGetDerivHistoryQueryKey(), type: "active" },
        refetchOptions,
      ).catch((error: unknown) => {
        console.warn("Could not refresh Auto Trader trade status after two seconds.", error);
      });
    }, 2_000);
    if (hasMissingContractIds) {
      return { kind: "uncertain", contractIds: fresh.map((contract) => contract.id) };
    }
    return { kind: "accepted", contractIds: fresh.map((contract) => contract.id) };
  };

  useEffect(() => {
    if (
      !autoMagicEnabled
      || !autoMagicRunActive
      || !scanning
      || autoMagicAttemptedRef.current
      || !connected
      || !accountId
      || !hasAutoTraderAccess
    ) {
      return;
    }

    const duration = Number(durationTicks);
    const amount = Number(stake);
    const liveMarkets = filteredMarkets.filter((market) => (marketTicks[market.symbol] ?? 0) > 0);
    const candidate = chooseAutoMagicCandidate({
      signals: scannerSignals,
      markets: liveMarkets,
      latestDigits,
      scanFrequencies: frequencies,
      duration,
    });
    if (!candidate) {
      setAutoMagicStatus("waiting");
      return;
    }

    const market = liveMarkets.find((item) => item.symbol === candidate.symbol);
    if (!market) return;
    const orderError = validateAutoTraderBatch({
      stake: amount,
      balance: accountBalance,
      symbol: market.symbol,
      supportedSymbols: markets.map((item) => item.symbol),
      digit: candidate.barrier,
      duration,
      count: autoMagicCount,
    });
    if (orderError) {
      setAutoMagicStatus("settings");
      setMessage((current) => current?.text === `Auto Magic waiting: ${orderError}`
        ? current
        : { tone: "error", text: `Auto Magic waiting: ${orderError}` });
      return;
    }

    autoMagicAttemptedRef.current = true;
    setAutoMagicRunActive(false);
    setAutoMagicStatus("placing");
    void placeTrade(market, candidate.barrier, autoMagicCount)
      .then((outcome) => {
        if (outcome.kind === "accepted" && outcome.contractIds.length > 0) {
          setAutoMagicBatchIds(outcome.contractIds);
          setAutoMagicStatus("settling");
        } else if (outcome.kind === "uncertain") {
          setAutoMagicBatchIds(outcome.contractIds);
          setAutoMagicStatus("review");
          setMessage({
            tone: "error",
            text: "Auto Magic could not confirm the full order result. Check Deriv history; it will not resend this batch.",
          });
        } else if (outcome.kind === "accepted") {
          setAutoMagicStatus("review");
          setMessage({
            tone: "error",
            text: "Deriv accepted a batch without usable contract IDs. Check account history before taking further action.",
          });
        } else {
          setAutoMagicStatus("rescan");
        }
      })
      .catch((error: unknown) => {
        setAutoMagicStatus("review");
        setMessage({
          tone: "error",
          text: `${error instanceof Error ? error.message : "The batch result is uncertain."} Check Deriv history; Auto Magic will not resend this batch.`,
        });
      });
  }, [
    accountBalance,
    accountId,
    autoMagicCount,
    autoMagicEnabled,
    autoMagicRunActive,
    connected,
    durationTicks,
    filteredMarkets,
    frequencies,
    hasAutoTraderAccess,
    latestDigits,
    marketTicks,
    placeTrade,
    scanning,
    scannerSignals,
    stake,
  ]);

  const renderMarket = (market: Market) => {
    const signal = signalBySymbol.get(market.symbol);
    const digits = frequencies[market.symbol] ?? Array(10).fill(0);
    const ticks = marketTicks[market.symbol] ?? 0;
    const hasMarketTicksThisScan = digits.some((count) => count > 0);
    const latestDigit = latestDigits[market.symbol] ?? null;
    const oppositeGroup = getAutoTraderOppositeDigitGroup(latestDigit);
    return (
      <article
        key={market.symbol}
        className="at-market-card"
        data-testid={`card-market-${market.symbol}`}
      >
        <div className="at-market-heading">
          <span className="at-market-name">{market.name.replace("Volatility ", "V").replace(" · 1s", " 1s")}</span>
          <span className="at-market-tick-count">{ticks} {ticks === 1 ? "tick" : "ticks"}</span>
        </div>
        <div className="at-frequencies" aria-label={`Digit frequency and trade controls for ${market.name}`}>
          {digits.map((count, digit) => (
            <div className={`at-digit-column${oppositeGroup && digit >= oppositeGroup.minDigit && digit <= oppositeGroup.maxDigit ? " recommended" : ""}`} key={digit}>
              <span className="at-digit-label">{digit}</span>
              <span className={`at-digit-count${count === 0 ? " zero" : ""}`} aria-label={`${count} observations`}>{count}</span>
              <div className="at-digit-trades">
                <button type="button" disabled={!connected || !scanning || !signal || !hasMarketTicksThisScan || bulkBuy.isPending || autoMagicEnabled} onClick={() => void placeTrade(market, digit, 3)} aria-label={`Place three separate contracts on ${market.name}, digit ${digit}`} data-testid={`button-trade-3x-${market.symbol}-${digit}`}>3×</button>
                <button type="button" disabled={!connected || !scanning || !signal || !hasMarketTicksThisScan || bulkBuy.isPending || autoMagicEnabled} onClick={() => void placeTrade(market, digit, 6)} aria-label={`Place six separate contracts on ${market.name}, digit ${digit}`} data-testid={`button-trade-6x-${market.symbol}-${digit}`}>6×</button>
              </div>
            </div>
          ))}
        </div>
      </article>
    );
  };

  if (access.isLoading) {
    return (
      <AppShell title="AUTO TRADER">
        <main className="auto-trader-page">
          <div className="at-connection-note skeleton" aria-label="Loading workspace access" />
        </main>
      </AppShell>
    );
  }

  if (access.isError) {
    return (
      <AppShell title="AUTO TRADER">
        <main className="auto-trader-page">
          <div className="at-connection-note error" role="alert">
            <AlertCircle size={17} /><div><strong>Unable to confirm feature access</strong><span>Refresh the page or sign in again before using Auto Trader.</span></div>
          </div>
        </main>
      </AppShell>
    );
  }

  if (!hasAutoTraderAccess) {
    return (
      <AppShell title="AUTO TRADER">
        <main className="auto-trader-page">
          <section className="at-restricted-card" role="status" data-testid="status-auto-trader-restricted">
            <ShieldAlert size={20} />
            <div><strong>Restricted — admin access only</strong><span>Ask your administrator to grant Auto Trader access to this key.</span></div>
          </section>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell title="AUTO TRADER">
      <main className="auto-trader-page" data-feature-scope="auto-trader">
        <section className="at-heading">
          <div className="at-heading-copy">
            <div className="at-kicker"><span className="at-icon"><Radar size={18} /></span> DERIV SYNTHETIC INDICES <span className="at-kicker-line" /></div>
            <h1>Auto Trader</h1>
            <p>Trade X Advanced Analysis</p>
          </div>
          <div className="at-heading-actions">
            <DerivAccountSwitcher variant="cockpit" enabled={hasToken} />
          </div>
        </section>

        {access.isLoading && <div className="at-connection-note skeleton" aria-label="Loading workspace access" />}
        {!hasToken && !token.isLoading && (
          <div className="at-connection-note" role="status" data-testid="status-connect-deriv">
            <Signal size={17} /><div><strong>Deriv connection required</strong><span>Connect a Deriv account from the existing workspace settings to load live signals and place trades.</span></div>
          </div>
        )}
        {status.error && hasToken && (
          <div className="at-connection-note error" role="alert" data-testid="status-connection-error">
            <AlertCircle size={17} /><div><strong>Live status unavailable</strong><span>{status.error instanceof Error ? status.error.message : "Deriv status could not be loaded."}</span></div>
            <button type="button" onClick={() => void status.refetch()} data-testid="button-retry-status">Retry</button>
          </div>
        )}
        {accounts.error && hasToken && !status.error && (
          <div className="at-connection-note error" role="alert" data-testid="status-accounts-error">
            <AlertCircle size={17} /><div><strong>Account list unavailable</strong><span>{accounts.error instanceof Error ? accounts.error.message : "Deriv accounts could not be loaded."}</span></div>
            <button type="button" onClick={() => void accounts.refetch()} data-testid="button-retry-accounts">Retry</button>
          </div>
        )}

        <section className="at-summary" aria-label="Selected Deriv account">
          <div className="at-account-strip">
            <span className={`at-account-state ${account?.type === "real" ? "real" : ""}`} data-testid="status-account-type">
              <i /> {account?.type ? `${account.type.toUpperCase()} ACCOUNT` : "NO ACCOUNT"}
            </span>
            <span className="at-account-name">{account?.id ?? "Select a Deriv account"}</span>
            <span className="at-account-balance" data-testid="text-account-balance">{money(accountBalance, currency)}</span>
            <span className="at-connection-status"><i className={connected ? "connected" : ""} />{connected ? "CONNECTED" : "OFFLINE"}</span>
          </div>
        </section>

        <div className="at-workspace-grid">
          <aside className="at-order-column">
            <section className="at-order-panel" aria-label="Auto Trader settings">
              <div className="at-order-topline"><span><Settings2 size={14} /> ORDER SETTINGS</span><span className="at-contract-tag">DIGIT DIFFERS</span></div>
              <button type="button" className={`at-settings-toggle${settingsOpen ? " open" : ""}`} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)} data-testid="button-settings">
                <Settings2 size={15} /> Settings <span>{settingsOpen ? "HIDE" : "STAKE & RISK"}</span><ChevronRight size={15} />
              </button>
              {settingsOpen && (
                <div className="at-settings-fields" data-testid="panel-settings">
                  <label htmlFor="at-stake">Stake per contract<div className="at-stake-input"><span>{currency}</span><input id="at-stake" type="number" min="0.01" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} aria-label="Stake per contract" data-testid="input-stake" /></div></label>
                  <label htmlFor="at-duration-ticks">Duration (ticks)<div className="at-inline-input"><input id="at-duration-ticks" type="number" min="1" max="5" step="1" value={durationTicks} onChange={(event) => setDurationTicks(event.target.value)} aria-label="Duration in ticks" data-testid="input-duration-ticks" /><span>1–5</span></div><small className="at-duration-note">Tick 0 is entry; settlement is evaluated on the selected numbered tick.</small></label>
                  <label>Take profit target<div className="at-inline-input"><input type="number" min="0" step="0.01" value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} data-testid="input-take-profit" /><span>{currency}</span></div></label>
                  <label>Stop loss limit<div className="at-inline-input"><input type="number" min="0" step="0.01" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} data-testid="input-stop-loss" /><span>{currency}</span></div></label>
                  <div className="at-auto-magic-block" data-testid="panel-auto-magic">
                    <label className={`at-auto-magic-switch-row${autoMagicEnabled ? " enabled" : ""}`}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={autoMagicEnabled}
                        onChange={(event) => handleAutoMagicToggle(event.target.checked)}
                        disabled={!connected || bulkBuy.isPending}
                        aria-label="Auto Magic"
                        data-testid="switch-auto-magic"
                      />
                      <span className="at-auto-magic-switch-track" aria-hidden="true" />
                      <strong>Auto Magic</strong>
                      <b className="at-auto-magic-state">{autoMagicEnabled ? "ON" : "OFF"}</b>
                    </label>
                    <fieldset
                      className="at-auto-magic-batch"
                      disabled={autoMagicRunActive || autoMagicStatus === "placing" || autoMagicStatus === "settling"}
                    >
                      <legend>Contracts per batch</legend>
                      <label>
                        <input
                          type="radio"
                          name="auto-magic-count"
                          value="3"
                          checked={autoMagicCount === 3}
                          onChange={() => setAutoMagicCount(3)}
                          data-testid="radio-auto-magic-3x"
                        />
                        <span>3×</span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="auto-magic-count"
                          value="6"
                          checked={autoMagicCount === 6}
                          onChange={() => setAutoMagicCount(6)}
                          data-testid="radio-auto-magic-6x"
                        />
                        <span>6×</span>
                      </label>
                    </fieldset>
                    <p className="at-auto-magic-status" role="status" data-testid="status-auto-magic">{autoMagicStatusText}</p>
                  </div>
                  <div className="at-deferred-note"><ShieldAlert size={14} /> Take-profit and stop-loss are reference targets only.</div>
                </div>
              )}
              {message && <div className={`at-action-message ${message.tone}${messageFading ? " fading" : ""}`} role={message.tone === "error" ? "alert" : "status"} data-testid="status-trade-message">
                {message.tone === "error" ? <AlertCircle size={15} /> : <Check size={15} />}<span>{message.text}</span>
                <button type="button" aria-label="Dismiss message" onClick={() => setMessage(null)} data-testid="button-dismiss-message"><X size={13} /></button>
              </div>}
            </section>

            <section className="at-daily-panel" aria-labelledby="daily-stats-title" data-testid="panel-daily-statistics">
              <div className="at-history-heading">
                <div>
                  <div className="at-section-label">SELECTED ACCOUNT · TODAY</div>
                  <h2 id="daily-stats-title">Daily Statistics</h2>
                </div>
              </div>
              <div className="at-daily-stats">
                <div className="at-daily-stat" data-testid="stat-daily-balance"><span>BALANCE</span><strong>{money(accountBalance, currency)}</strong></div>
                <div className="at-daily-stat" data-testid="stat-daily-pnl"><span>P/L</span><strong className={dailyProfit >= 0 ? "positive" : "negative"} data-testid="text-daily-profit">{formatSignedDerivProfit(dailyProfit, currency)}</strong></div>
                <div className="at-daily-stat" data-testid="stat-daily-trades"><span>TRADES</span><strong>{todayIds.size}</strong></div>
                <div className="at-daily-stat" data-testid="stat-daily-wins"><span>WINS</span><strong>{wins}</strong></div>
                <div className="at-daily-stat" data-testid="stat-daily-losses"><span>LOSSES</span><strong>{losses}</strong></div>
                <div className="at-daily-stat" data-testid="stat-daily-win-rate"><span>WIN RATE</span><strong>{winRate}</strong><small data-testid="stat-daily-win-sample">n={outcomeSummary.sampleSize} settled</small></div>
              </div>
            </section>

            <section className="at-history-panel" aria-labelledby="history-title">
              <div className="at-history-heading">
                <div><div className="at-section-label">ACCOUNT-SCOPED</div><h2 id="history-title">Trading History <span>{visibleContracts.length}</span></h2></div>
                <button
                  type="button"
                  className={`at-history-icon${historyClearArmed ? " armed" : ""}`}
                  onClick={clearTodayTrades}
                  disabled={!accountId || history.isLoading || visibleContracts.length === 0}
                  aria-label={historyClearArmed ? "Tap again to clear today's Auto Trader trades" : "Clear today's Auto Trader trades"}
                  title={historyClearArmed ? "Tap again to clear today's Auto Trader trades" : "Clear today's Auto Trader trades"}
                  data-testid="button-clear-auto-trader-history"
                >
                  <Trash2 size={15} />{historyClearArmed && <span>Tap again</span>}
                </button>
              </div>
              <div className="at-history-list" data-testid="list-trade-history">
                {history.isLoading && <div className="at-history-state skeleton-line" aria-label="Loading trade history" />}
                {!history.isLoading && visibleContracts.length === 0 && <div className="at-history-state" data-testid="empty-trade-history">No Auto Trader contracts today.<small>Trades from other features are excluded.</small></div>}
                {visibleContracts.map((trade) => {
                  const metadata = localContractById.get(String(trade.contract_id));
                  const open = isDerivHistoryOpen(trade.status);
                  const resultLabel = open ? "OPEN" : trade.profit > 0 ? "WON" : trade.profit < 0 ? "LOST" : "CLOSED";
                  const liveProfit = getDerivOpenLiveProfit(trade.current_value, trade.buy_price);
                  const liveResult = liveProfit == null ? "even" : liveProfit > 0 ? "positive" : liveProfit < 0 ? "negative" : "even";
                  const resultPillClass = open
                    ? `open ${liveResult}`
                    : trade.profit > 0
                      ? "won"
                      : trade.profit < 0
                        ? "lost"
                        : "";
                  const livePositionLabel = liveProfit == null
                    ? "not available"
                    : liveResult === "positive"
                      ? "above"
                      : liveResult === "negative"
                        ? "below"
                        : "at";
                  const marketLabel = (markets.find((market) => market.symbol === trade.symbol)?.name ?? trade.symbol)
                    .replace("Volatility ", "V")
                    .replace(" · 1s", " 1s");
                  return (
                    <div className={`at-history-row${historyFading ? " fading" : ""}`} key={trade.contract_id} data-testid={`row-trade-${trade.contract_id}`}>
                      <span
                        className={`at-result-pill ${resultPillClass}`}
                        aria-label={open
                          ? `Open, live value is ${livePositionLabel} the entry price; final result is not settled`
                          : resultLabel}
                        title={open ? "Live direction only; Deriv has not settled this contract." : undefined}
                      >
                        {resultLabel}
                      </span>
                      <span className="at-history-market">
                        <span className="at-history-meta">
                          <code>{trade.contract_id}</code>
                          {metadata?.batchCount && metadata.batchCount > 1 && (
                            <span className="at-batch-tag">Multi Differ ({metadata.batchIndex ?? 1}/{metadata.batchCount})</span>
                          )}
                        </span>
                        <strong>DIFFERS {trade.barrier ?? "—"} on {marketLabel}</strong>
                      </span>
                      <span className="at-history-numbers">
                        <strong className={`at-history-profit${open ? liveResult === "positive" ? " positive" : liveResult === "negative" ? " negative" : "" : trade.profit > 0 ? " positive" : trade.profit < 0 ? " negative" : ""}`}>
                          {open
                            ? liveProfit == null || liveProfit === 0 ? "Open" : `Live ${formatSignedDerivProfit(liveProfit, trade.currency)}`
                            : formatSignedDerivProfit(trade.profit, trade.currency)}
                        </strong>
                        <small>{money(trade.buy_price, trade.currency)}</small>
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </aside>

          <section className="at-scanner-panel" aria-labelledby="scanner-title">
            <header className="at-panel-header">
              <div>
                <div className="at-section-label"><span className="at-live-indicator" /> MARKET INTELLIGENCE</div>
                <h2 id="scanner-title">Differ Search <span>{markets.length} MARKETS</span></h2>
                <p>Live last-digit distribution · Deriv market signals</p>
              </div>
              <div className="at-scan-actions">
                <button type="button" className="at-guide-button" onClick={() => { setGuidePage(0); setGuideOpen(true); }} data-testid="button-open-guide">
                  <BookOpen size={15} /> Guide
                </button>
                <button type="button" className="at-icon-button" onClick={() => void startScan(true)} disabled={scanActionsDisabled} aria-label="Rescan markets" data-testid="button-rescan"><RefreshCw size={15} className={scanResetPending ? "at-spin" : ""} /> Rescan</button>
                {scanning ? (
                  <button type="button" className="at-stop-button" onClick={() => {
                    setScanning(false);
                    setAutoMagicRunActive(false);
                    if (autoMagicEnabled && !autoMagicAttemptedRef.current) setAutoMagicStatus("ready");
                    setMessage(null);
                  }} data-testid="button-stop-scan"><Pause size={14} /> Stop</button>
                ) : (
                  <button type="button" className="at-live-button" onClick={() => void startScan(false)} disabled={scanActionsDisabled} data-testid="button-go-live"><Play size={14} /> Go Live</button>
                )}
              </div>
            </header>

            <div className="at-filterbar" role="tablist" aria-label="Filter markets">
              {filterOptions.map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  className={filter === key ? "selected" : ""}
                  onClick={() => setFilter(key)}
                  data-testid={`button-filter-${key}`}
                >{label}<span>{count}</span></button>
              ))}
            </div>

            <div className="at-scan-status" data-testid="status-scanner">
              <span className={scanning ? "is-live" : ""}><i />{scanning ? "SCANNING LIVE MARKETS" : "SCAN PAUSED"}</span>
              <span>{filteredMarkets.length} instruments in view</span>
              <span className="at-source-note">No simulated feed</span>
            </div>

            {!scanning && (
              <div className="at-empty-overlay" data-testid="empty-market-signals">
                <Signal size={22} />
                <strong>{connected ? "Scanner is paused" : "Awaiting a Deriv connection"}</strong>
                <span>{connected ? `Select Go Live to reveal the ${markets.length} live markets and begin counting real ticks.` : "Connect and select an authorized Deriv account before starting a live scan."}</span>
              </div>
            )}
            {scanning && filteredMarkets.length > 0 && (
              <div className="at-market-list">
                {filter === "all" ? (
                  (["regular", "jump", "one-sec"] as MarketGroup[]).map((group) => (
                    <section className="at-market-group" key={group} aria-label={groupLabels[group]}>
                      <div className="at-group-heading"><span>{groupLabels[group]}</span><b>{markets.filter((market) => market.group === group).length} symbols</b></div>
                      <div className="at-market-grid">{markets.filter((market) => market.group === group).map(renderMarket)}</div>
                    </section>
                  ))
                ) : <div className="at-market-grid">{filteredMarkets.map(renderMarket)}</div>}
              </div>
            )}
            {hasToken && !status.isLoading && currentSignals.length === 0 && !status.error && (
              <div className="at-empty-inline" data-testid="empty-live-quotes"><Clock3 size={16} /> Waiting for actual Deriv ticks. No sample data is shown.</div>
            )}
          </section>
        </div>

        <section className="at-footnote">
          <CircleHelp size={14} /><span>Signals are descriptive only. Digit frequency cannot predict a future tick or guarantee a contract outcome.</span>
          <span className="at-source-badge">LIVE DERIV DATA</span>
        </section>

        <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
          <DialogContent className="at-guide-dialog" data-testid="dialog-auto-trader-guide">
            <DialogHeader>
              <div className="at-guide-overline"><BookOpen size={14} /> FIELD GUIDE <span>{String(guidePage + 1).padStart(2, "0")} / {String(guideCopy.length).padStart(2, "0")}</span></div>
              <DialogTitle>{guideCopy[guidePage][0]}</DialogTitle>
              <DialogDescription>{guideCopy[guidePage][1]}</DialogDescription>
            </DialogHeader>
            <div className="at-guide-caution"><ShieldAlert size={16} /><span>{guideCopy[guidePage][2]}</span></div>
            <div className="at-guide-progress"><span style={{ transform: `scaleX(${(guidePage + 1) / guideCopy.length})` }} /></div>
            <div className="at-guide-controls">
              <button type="button" onClick={() => setGuidePage((page) => Math.max(0, page - 1))} disabled={guidePage === 0} data-testid="button-guide-previous"><ChevronLeft size={16} /> Previous</button>
              <button type="button" onClick={() => guidePage === guideCopy.length - 1 ? setGuideOpen(false) : setGuidePage((page) => page + 1)} data-testid="button-guide-next">
                {guidePage === guideCopy.length - 1 ? "Finish" : "Next"} <ChevronRight size={16} />
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </AppShell>
  );
}

export default function AutoTraderPage() {
  return <AutoTraderContent />;
}
