import { useEffect, useMemo, useRef, useState } from "react";
import {
  getGetAccessSessionQueryKey,
  getGetDerivAccountsQueryKey,
  getGetDerivHistoryQueryKey,
  getGetDerivStatusQueryKey,
  getGetDerivTokenStatusQueryKey,
  ApiTransportError,
  useBuyDerivContract,
  useGetAccessSession,
  useGetDerivAccounts,
  useGetDerivHistory,
  useGetDerivStatus,
  useGetDerivTokenStatus,
} from "@workspace/api-client-react";
import type { DerivBuyInput, DerivHistoryItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import AutoTrader2Panel from "@/components/auto-trader-2-panel";
import type { DerivHistoryRow } from "@/components/deriv-history";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAccountBalance } from "@/lib/account-balance";
import {
  parseAutoTrader2SavedSession,
  reconcileAutoTrader2SavedSession,
  requiresAutoTrader2SessionReview,
  type AutoTrader2RunConfig as RunConfig,
  type AutoTrader2SavedPhase,
  type AutoTrader2SavedSession,
} from "@/lib/auto-trader-2-session";
import {
  chooseAutoTrader2Candidate,
  getAutoTrader2OppositeType,
  updateAutoTrader2LossState,
  updateAutoTrader2Recovery,
  type AutoTrader2Candidate,
  type AutoTrader2ContractType,
  type AutoTrader2Family,
  type AutoTrader2Signal,
} from "@/lib/auto-trader-2-strategy";
import { mergeDerivTradeUpdate, waitForSettledDerivTrade } from "@/lib/deriv-trade-feed";
import "./auto-trader-2.css";

type Market = { value: string; label: string };
const markets: Market[] = [
  { value: "R_10", label: "Volatility 10" },
  { value: "R_25", label: "Volatility 25" },
  { value: "R_50", label: "Volatility 50" },
  { value: "R_75", label: "Volatility 75" },
  { value: "R_100", label: "Volatility 100" },
  { value: "JD10", label: "Jump 10" },
  { value: "JD25", label: "Jump 25" },
  { value: "JD50", label: "Jump 50" },
  { value: "JD75", label: "Jump 75" },
  { value: "JD100", label: "Jump 100" },
  { value: "1HZ10V", label: "Volatility 10 · 1s" },
  { value: "1HZ25V", label: "Volatility 25 · 1s" },
  { value: "1HZ50V", label: "Volatility 50 · 1s" },
  { value: "1HZ75V", label: "Volatility 75 · 1s" },
  { value: "1HZ100V", label: "Volatility 100 · 1s" },
];

const guideCopy = [
  ["Welcome to Auto Trader 2.0", "This is a separate automated-trading mode under Auto Trader. It lets you set trade size, session boundaries, contract family, market selection, and how the next stake changes after a loss.", "All contracts are settled by Deriv. Historical signals and automation do not guarantee a winning result."],
  ["Select the Deriv account", "The account selector in the page header shows which Deriv account the feature will use. Confirm the account type, ID, and balance before every session.", "Demo trading is recommended while you learn. Real-account orders use real funds and remain subject to server permissions."],
  ["Choose a contract family", "Choose Differs, Rise/Fall, or Even/Odd. With AI 2 on, it ranks the eligible direction or parity and market inside that family; with AI 2 off, your selected contract type is used.", "The contract result is decided at expiry. A recent pattern does not determine the next result."],
  ["Digit Differs", "Differs wins when the last digit at contract expiry is not the selected barrier digit. Choose a digit from 0 through 9 when using manual settings.", "A digit that appeared less often in a sample is not guaranteed to stay uncommon."],
  ["Rise and Fall", "Rise uses a CALL contract and Fall uses a PUT contract. The selected market movement at expiry determines which contract wins.", "Recent up/down movements are descriptive history only; they do not predict the next movement."],
  ["Even and Odd", "Even and Odd use the last digit at expiry. Choose the parity manually or let AI 2 compare the observed sample when it is enabled.", "A recent imbalance can change quickly and is not a promise of future parity."],
  ["Set your stake", "Stake is the amount requested for each individual contract. The account balance and the server's trading checks remain authoritative.", "The amount risked can be lost. Keep it within an amount you can afford to lose."],
  ["Set contract duration", "Duration is the number of ticks before contract expiry. Auto Trader 2.0 uses whole-tick durations from 1 through 5.", "A shorter contract resolves sooner but is not automatically safer or more profitable."],
  ["Take-profit limit", "Take Profit stops the automated loop before another entry once the settled session profit reaches this value. Enter zero to turn this stop off.", "This is a session stop, not a guaranteed payout. An already-open contract may settle after the loop stops."],
  ["Loss limit", "Loss Limit stops the loop before another entry once settled session losses reach the configured amount. Enter zero to turn this stop off.", "This does not cap the possible loss on an already-open contract or guarantee an exact maximum loss."],
  ["Flat stake mode", "Flat mode uses the configured stake for each entry. It makes the planned amount consistent from one contract to the next.", "Flat staking cannot prevent losses. Review the stake against the account balance before starting."],
  ["Multiply after loss", "Multiply after loss increases the next requested stake after a losing settlement by your configured multiplier. A win returns the next amount to the base stake.", "Multiplying can increase exposure quickly and does not guarantee recovery. The server still checks the selected account balance."],
  ["Auto-select market", "When enabled with AI 2, the feature compares qualifying live samples across supported markets and selects the strongest eligible market. Turn it off to keep the manually selected market.", "Auto-selection ranks observed data; it is not a forecast of future results."],
  ["AI 2 checkbox", "AI 2 uses a stricter evidence filter, chooses the strongest qualifying direction or parity, and switches to the paired opposite side after a loss. It analyzes fresh market data before the next entry; if the opposite side does not qualify, it waits. After three losses on one type, it pauses that type for the rest of the session.", "AI 2 is a rule-based filter of observed market data, not a source of guaranteed outcomes."],
  ["AI 2 sample threshold", "AI 2 requires a larger recent expiry sample and statistical support above the contract baseline. When the evidence is weak or inconsistent, it waits instead of placing a trade.", "Observed rates are historical context, not a promise of future contract results."],
  ["Differs loss response", "After any AI 2 Differs loss settles, recovery selection switches to qualifying Rise/Fall or Even/Odd candidates and can auto-select the strongest market. It remains in recovery until settled session P/L rises above the P/L level from just before that loss.", "Recovery does not guarantee a profit. If no qualifying setup is available, AI 2 waits without placing an order."],
  ["One open contract at a time", "The loop waits for Deriv history to show the active contract as settled before considering another entry. Other open contracts also block new entries.", "If settlement cannot be verified, the loop pauses instead of guessing or sending another order."],
  ["Reading Auto Trader 2.0 History", "History uses the same session summary and trade-row design as Cash Grab. It only includes contracts this feature recorded for the currently selected account.", "The history list is a dashboard view. Deriv remains the authoritative account record."],
  ["Clear this feature's history", "The two-step clear removes this browser's Auto Trader 2.0 rows and verified local run state. It resets this run's totals and next stake to the configured stake; Deriv account history is unchanged.", "A saved session with an unsettled or uncertain contract must be verified before it can be cleared. Clearing never closes or cancels a contract."],
  ["Declines, uncertain orders & reloads", "Deriv may decline unavailable contracts; Auto Trader 2.0 stops after a rejection and never retries an uncertain order. AI 2 saves account-scoped recovery state in this browser. After reload, verify Deriv history and open contracts before resuming; an order that may have been submitted is never resent.", "A saved checkpoint is not proof of settlement. If history, account identity, or open-contract status cannot be confirmed, keep the session paused and review Deriv directly."],
] as const;

type LocalContract = { id: string; placedAt: number };
type Runtime = {
  generation: number;
  active: boolean;
  stopRequested: boolean;
  contractIds: string[];
  config: RunConfig | null;
  currentStake: number;
  sessionPnl: number;
  recovery: boolean;
  recoveryTargetPnl: number | null;
  lossStreaks: Partial<Record<AutoTrader2ContractType, number>>;
  pausedContractTypes: AutoTrader2ContractType[];
  forcedNextType: AutoTrader2ContractType | null;
  pendingContractId: string | null;
  pendingContractType: AutoTrader2ContractType | null;
  pendingStake: number | null;
  settlementAbortController: AbortController | null;
  lastCandidate: AutoTrader2Candidate | null;
};

const storagePrefix = "deriv-auto-trader-2-contracts:";
const sessionStoragePrefix = "deriv-auto-trader-2-session:";
const minimumStake = 0.35;
const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const isSettled = (status: string) => !["open", "pending", "active"].includes(status.toLowerCase());
const derivHistoryQueryKey = getGetDerivHistoryQueryKey();

function amountLabel(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function AutoTrader2Content() {
  const queryClient = useQueryClient();
  const access = useGetAccessSession({ query: { queryKey: getGetAccessSessionQueryKey(), retry: false } });
  const hasAccess = access.data?.is_admin === true || access.data?.features.includes("auto-trader-2") === true;
  const token = useGetDerivTokenStatus({ query: { queryKey: getGetDerivTokenStatusQueryKey(), retry: false, enabled: hasAccess } });
  const hasToken = token.data?.has_token === true;
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);
  const [tradeUpdatesConnected, setTradeUpdatesConnected] = useState(false);
  const [family, setFamily] = useState<AutoTrader2Family>("differs");
  const [contractType, setContractType] = useState<AutoTrader2ContractType>("DIGITDIFF");
  const [barrier, setBarrier] = useState(0);
  const [stake, setStake] = useState(1);
  const [duration, setDuration] = useState(1);
  const [takeProfit, setTakeProfit] = useState(10);
  const [lossLimit, setLossLimit] = useState(10);
  const [stakeMode, setStakeMode] = useState<"flat" | "multiply">("flat");
  const [multiplier, setMultiplier] = useState(2);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [autoSelect, setAutoSelect] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState("R_10");
  const [nextStake, setNextStake] = useState(1);
  const [decision, setDecision] = useState("Choose a contract family and start a session.");
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guidePage, setGuidePage] = useState(0);
  const [localContracts, setLocalContracts] = useState<LocalContract[]>([]);
  const localContractsRef = useRef<LocalContract[]>([]);
  const [runContractIds, setRunContractIds] = useState<string[]>([]);
  const [clearArmed, setClearArmed] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [historyFading, setHistoryFading] = useState(false);
  const [sessionPnl, setSessionPnl] = useState(0);
  const [sessionTradeCount, setSessionTradeCount] = useState(0);
  const [savedSession, setSavedSession] = useState<AutoTrader2SavedSession | null>(null);
  const [savedSessionIssue, setSavedSessionIssue] = useState("");
  const [savedSessionNotice, setSavedSessionNotice] = useState("");
  const [sessionLoadComplete, setSessionLoadComplete] = useState(false);
  const [sessionLoadedForAccount, setSessionLoadedForAccount] = useState<string | null>(null);
  const [verifyingSavedSession, setVerifyingSavedSession] = useState(false);
  const [discardSessionArmed, setDiscardSessionArmed] = useState(false);
  const clearTimer = useRef<number | null>(null);
  const runRef = useRef<Runtime>({
    generation: 0,
    active: false,
    stopRequested: false,
    contractIds: [],
    config: null,
    currentStake: 1,
    sessionPnl: 0,
    recovery: false,
    recoveryTargetPnl: null,
    lossStreaks: {},
    pausedContractTypes: [],
    forcedNextType: null,
    pendingContractId: null,
    pendingContractType: null,
    pendingStake: null,
    settlementAbortController: null,
    lastCandidate: null,
  });
  const buyMutation = useBuyDerivContract();
  const buyRef = useRef(buyMutation);
  buyRef.current = buyMutation;

  const accounts = useGetDerivAccounts({
    query: { queryKey: getGetDerivAccountsQueryKey(), enabled: hasAccess && hasToken, retry: false, refetchInterval: hasAccess && hasToken ? 10_000 : false },
  });
  const status = useGetDerivStatus({
    query: {
      queryKey: getGetDerivStatusQueryKey(),
      enabled: hasAccess && hasToken,
      retry: false,
      refetchInterval: running || aiEnabled ? 1_000 : hasAccess && hasToken ? 4_000 : false,
    },
  });
  const history = useGetDerivHistory({
    query: { queryKey: derivHistoryQueryKey, enabled: hasAccess && hasToken, retry: false, refetchInterval: false },
  });
  const statusRef = useRef(status);
  statusRef.current = status;
  const historyRef = useRef(history);
  historyRef.current = history;

  const account = status.data?.account ?? null;
  const accountId = account?.id ?? "";
  const sessionLoadingForAccount = !sessionLoadComplete || (Boolean(accountId) && sessionLoadedForAccount !== accountId);
  const currency = account?.currency ?? "USD";
  const connected = Boolean(status.data?.connected && status.data?.authorized && hasToken);
  const tradeSlotBlocked = status.data?.open_contracts_ready !== true || (status.data?.active_contract_count ?? 0) > 0;
  const signals = (status.data?.market_signals ?? []) as AutoTrader2Signal[];
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const runIdSet = useMemo(() => new Set(runContractIds), [runContractIds]);
  const recentTrades = useMemo(() => {
    if (!accountId || !history.data) return [];
    const storedIds = new Set(localContracts.map((entry) => entry.id));
    return (history.data as DerivHistoryItem[])
      .filter((entry) => entry.account_id === accountId && storedIds.has(entry.contract_id))
      .sort((left, right) => (right.buy_time ?? 0) - (left.buy_time ?? 0)) as DerivHistoryRow[];
  }, [accountId, history.data, localContracts]);
  const runRows = useMemo(
    () => recentTrades.filter((entry) => runIdSet.has(entry.contract_id)),
    [recentTrades, runIdSet],
  );
  const selectedLabel = markets.find((market) => market.value === selectedMarket)?.label ?? selectedMarket;
  const selectedSignal = signals.find((signal) => signal.symbol === selectedMarket);
  const observedSampleCount = selectedSignal?.recent_digits?.length ?? 0;
  const aiStatus = !aiEnabled ? "off" : !running ? "paused" : decision.toLowerCase().includes("waiting") ? "waiting" : "working";
  localContractsRef.current = localContracts;

  useEffect(() => {
    setTradeUpdatesConnected(false);
    if (!hasAccess || !hasToken || !accountId || !history.isFetched) return;

    const source = new EventSource("/api/deriv/events", { withCredentials: true });
    source.onopen = () => setTradeUpdatesConnected(true);
    source.onerror = () => setTradeUpdatesConnected(false);
    source.addEventListener("history-snapshot", (event) => {
      try {
        const rows = JSON.parse((event as MessageEvent<string>).data) as DerivHistoryItem[];
        if (!Array.isArray(rows)) return;
        queryClient.setQueryData(
          derivHistoryQueryKey,
          rows.filter((row) => row.account_id === accountId),
        );
      } catch {
        // A malformed snapshot is ignored; EventSource will reconnect and send a fresh one.
      }
    });
    source.addEventListener("trade-update", (event) => {
      try {
        const row = JSON.parse((event as MessageEvent<string>).data) as DerivHistoryItem;
        if (!row || row.account_id !== accountId || typeof row.contract_id !== "string") return;
        queryClient.setQueryData<DerivHistoryItem[]>(
          derivHistoryQueryKey,
          (current) => mergeDerivTradeUpdate(current, row),
        );
      } catch {
        // Ignore malformed frames and keep the stream available for later updates.
      }
    });
    return () => {
      source.close();
    };
  }, [accountId, hasAccess, hasToken, history.isFetched, queryClient]);

  useEffect(() => {
    if (!message || message.tone === "error") return;
    const timer = window.setTimeout(() => {
      setMessage((current) => current === message ? null : current);
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    runRef.current.active = false;
    runRef.current.stopRequested = true;
    runRef.current.generation += 1;
    setRunning(false);
    setStopping(false);
    setIsPlacing(false);
    setClearArmed(false);
    setRunContractIds([]);
    setSessionPnl(0);
    setSessionTradeCount(0);
    setSavedSession(null);
    setSavedSessionIssue("");
    setSavedSessionNotice("");
    setSessionLoadComplete(false);
    setSessionLoadedForAccount(null);
    setDiscardSessionArmed(false);
    if (clearTimer.current !== null) {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    if (!accountId) {
      setLocalContracts([]);
      setSessionLoadedForAccount(null);
      setSessionLoadComplete(true);
      return;
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(`${storagePrefix}${accountId}`) ?? "[]") as LocalContract[];
      setLocalContracts(Array.isArray(parsed)
        ? parsed.filter((entry) => typeof entry?.id === "string" && Number.isFinite(entry.placedAt)).slice(-500)
        : []);
      const rawSession = localStorage.getItem(`${sessionStoragePrefix}${accountId}`);
      const restoredSession = parseAutoTrader2SavedSession(rawSession, accountId);
      setSavedSession(restoredSession);
      if (rawSession && !restoredSession) {
        setSavedSessionIssue("Saved Auto Trader 2.0 state could not be validated. Check Deriv history before clearing it or starting another automated session.");
      }
      if (restoredSession) {
        setRunContractIds(restoredSession.contractIds);
        setSessionPnl(restoredSession.sessionPnl);
        setSessionTradeCount(restoredSession.contractIds.length);
        setNextStake(restoredSession.currentStake);
        setFamily(restoredSession.config.family);
        setContractType(restoredSession.config.contractType);
        setBarrier(restoredSession.config.barrier);
        setStake(restoredSession.config.stake);
        setDuration(restoredSession.config.duration);
        setTakeProfit(restoredSession.config.takeProfit);
        setLossLimit(restoredSession.config.lossLimit);
        setStakeMode(restoredSession.config.stakeMode);
        setMultiplier(restoredSession.config.multiplier);
        setAiEnabled(restoredSession.config.aiEnabled);
        setAutoSelect(restoredSession.config.autoSelect);
        setSelectedMarket(restoredSession.config.selectedMarket);
        setSavedSessionNotice(
          restoredSession.phase === "placing" || restoredSession.phase === "manual-review"
            ? "The last order may have been submitted before the page reloaded. Check Deriv history and open contracts; no order will be resent."
            : restoredSession.phase === "awaiting-settlement"
              ? "A saved contract still needs a fresh Deriv settlement check before this session can resume."
              : restoredSession.phase === "completed"
                ? "This AI 2 session is stopped. Starting again begins a new run; Deriv history remains unchanged."
                : "A saved AI 2 session was found. Verify its Deriv history and open-contract status before resuming.",
        );
      }
    } catch {
      setLocalContracts([]);
      setSavedSessionIssue("This browser could not read Auto Trader 2.0's saved state. No automated order will be sent until the saved session is reviewed.");
    } finally {
      setSessionLoadedForAccount(accountId);
      setSessionLoadComplete(true);
    }
  }, [accountId]);

  useEffect(() => () => {
    runRef.current.active = false;
    runRef.current.stopRequested = true;
    runRef.current.settlementAbortController?.abort();
    runRef.current.generation += 1;
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
  }, []);

  useEffect(() => {
    if (savedSession) {
      setSessionPnl(savedSession.sessionPnl);
      setSessionTradeCount(savedSession.contractIds.length);
      return;
    }
    setSessionTradeCount(runContractIds.length);
    setSessionPnl(Number(runRows.filter((entry) => isSettled(entry.status))
      .reduce((total, entry) => total + Number(entry.profit || 0), 0).toFixed(2)));
  }, [runContractIds, runRows, savedSession]);

  const persistContract = (contractId: string) => {
    if (!accountId) return false;
    const next = [...localContractsRef.current.filter((entry) => entry.id !== contractId), { id: contractId, placedAt: Date.now() }].slice(-500);
    localContractsRef.current = next;
    setLocalContracts(next);
    try {
      localStorage.setItem(`${storagePrefix}${accountId}`, JSON.stringify(next));
      return true;
    } catch {
      setMessage({ tone: "info", text: "Deriv accepted the contract, but this browser could not save its local history link. Check Deriv history." });
      return false;
    }
  };

  const currentConfig = (): RunConfig => ({
    family,
    contractType,
    barrier,
    stake,
    duration,
    takeProfit,
    lossLimit,
    stakeMode,
    multiplier,
    aiEnabled,
    autoSelect,
    selectedMarket,
  });

  const persistRunState = (phase: AutoTrader2SavedPhase, config = runRef.current.config) => {
    if (!config?.aiEnabled) return true;
    if (!accountId) return false;
    const isTerminalOrReady = phase === "ready" || phase === "completed";
    const snapshot: AutoTrader2SavedSession = {
      version: 3,
      accountId,
      phase,
      config,
      contractIds: [...runRef.current.contractIds],
      sessionPnl: Number(runRef.current.sessionPnl.toFixed(2)),
      currentStake: Number(runRef.current.currentStake.toFixed(2)),
      recoveryTargetPnl: runRef.current.recoveryTargetPnl,
      lossStreaks: { ...runRef.current.lossStreaks },
      pausedContractTypes: [...runRef.current.pausedContractTypes],
      forcedNextType: runRef.current.forcedNextType,
      pendingContractId: isTerminalOrReady ? null : runRef.current.pendingContractId,
      pendingContractType: isTerminalOrReady ? null : runRef.current.pendingContractType,
      pendingStake: isTerminalOrReady ? null : runRef.current.pendingStake,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(`${sessionStoragePrefix}${accountId}`, JSON.stringify(snapshot));
      return true;
    } catch {
      setMessage({
        tone: "error",
        text: "Auto Trader 2.0 could not save its recovery checkpoint. It will not send another order until browser storage is available.",
      });
      return false;
    }
  };

  const readStoredSession = (forAccount = accountId) => {
    if (!forAccount) return null;
    try {
      return parseAutoTrader2SavedSession(
        localStorage.getItem(`${sessionStoragePrefix}${forAccount}`),
        forAccount,
      );
    } catch {
      return null;
    }
  };

  const persistReconciledSession = (session: AutoTrader2SavedSession) => {
    try {
      localStorage.setItem(`${sessionStoragePrefix}${session.accountId}`, JSON.stringify(session));
      return true;
    } catch {
      setMessage({
        tone: "error",
        text: "The verified Deriv result could not be saved to browser storage. Keep this session paused and check Deriv history before restarting.",
      });
      return false;
    }
  };

  const discardSavedSession = () => {
    if (!accountId) return;
    if (!discardSessionArmed) {
      setDiscardSessionArmed(true);
      setSavedSessionNotice("Check the Deriv account history first. Click again to clear only this browser's saved AI 2 recovery state; this will not cancel or delete Deriv contracts.");
      return;
    }
    try {
      localStorage.removeItem(`${sessionStoragePrefix}${accountId}`);
      setSavedSession(null);
      setSavedSessionIssue("");
      setSavedSessionNotice("Saved local recovery state cleared. Deriv contracts and account history were not changed.");
      setDiscardSessionArmed(false);
    } catch {
      setSavedSessionNotice("Browser storage could not clear this recovery state. The session remains blocked.");
    }
  };

  const chooseCandidate = (
    config: RunConfig,
    recovery: boolean,
    currentSignals: readonly AutoTrader2Signal[] = signalsRef.current,
  ) => chooseAutoTrader2Candidate({
    signals: currentSignals,
    family: recovery ? "recovery" : config.family,
    preferredType: config.contractType,
    barrier: config.barrier,
    selectedMarket: config.selectedMarket,
    autoSelect: config.autoSelect,
    duration: config.duration,
    excludedContractTypes: runRef.current.pausedContractTypes,
    requiredContractType: runRef.current.forcedNextType,
  });

  const finishLoop = (generation: number, finalMessage?: { tone: "error" | "success" | "info"; text: string }) => {
    if (runRef.current.generation !== generation) return;
    runRef.current.active = false;
    runRef.current.stopRequested = true;
    runRef.current.settlementAbortController?.abort();
    setRunning(false);
    setStopping(false);
    setIsPlacing(false);
    if (finalMessage) setMessage(finalMessage);
    if (runRef.current.config?.aiEnabled) {
      const saved = readStoredSession();
      if (saved) {
        setSavedSession(saved);
        setSavedSessionNotice(
          saved.phase === "placing" || saved.phase === "manual-review"
            ? "The last order may have been submitted. Check Deriv history and open contracts before deciding what to do; Auto Trader 2.0 will not resend it."
            : saved.phase === "awaiting-settlement"
              ? "The accepted contract has not been confirmed as settled. Verify it against Deriv history before resuming."
              : saved.phase === "completed"
                ? "This AI 2 session is stopped. Starting again begins a new run; Deriv history remains unchanged."
                : "The saved AI 2 session is paused. Verify its Deriv history and open-contract status before resuming.",
        );
      }
    }
  };

  const start = async () => {
    if (runRef.current.active || !connected || !tradeUpdatesConnected || !accountId || tradeSlotBlocked) return;
    if (sessionLoadingForAccount) {
      setMessage({ tone: "info", text: "Auto Trader 2.0 is still checking this account's saved recovery state. No order was sent." });
      return;
    }
    if (savedSessionIssue) {
      setMessage({ tone: "error", text: savedSessionIssue });
      return;
    }
    if (savedSession) {
      if (savedSession.phase === "ready") {
        await verifyAndResumeSavedSession();
        return;
      }
      if (savedSession.phase === "completed") {
        try {
          localStorage.removeItem(`${sessionStoragePrefix}${accountId}`);
          setSavedSession(null);
          setSavedSessionNotice("");
        } catch {
          setMessage({ tone: "error", text: "The completed local checkpoint could not be replaced. Deriv history remains unchanged." });
          return;
        }
      } else {
        setMessage({ tone: "info", text: "This session has an unsettled or uncertain contract. Verify it in Deriv before resuming; no order will be retried." });
        return;
      }
    }
    if (!Number.isFinite(stake) || stake < minimumStake) {
      setMessage({ tone: "error", text: `Enter a stake of at least ${minimumStake.toFixed(2)} ${currency}.` });
      return;
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 5) {
      setMessage({ tone: "error", text: "Choose a whole-tick duration from 1 to 5." });
      return;
    }
    if (stakeMode === "multiply" && (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 10)) {
      setMessage({ tone: "error", text: "Choose a loss multiplier from 1 to 10." });
      return;
    }

    const config = currentConfig();
    const generation = runRef.current.generation + 1;
    runRef.current = {
      generation,
      active: true,
      stopRequested: false,
      contractIds: [],
      config,
      currentStake: config.stake,
      sessionPnl: 0,
      recovery: false,
      recoveryTargetPnl: null,
      lossStreaks: {},
      pausedContractTypes: [],
      forcedNextType: null,
      pendingContractId: null,
      pendingContractType: null,
      pendingStake: null,
      settlementAbortController: null,
      lastCandidate: null,
    };
    setRunContractIds([]);
    setSessionPnl(0);
    setSessionTradeCount(0);
    setNextStake(config.stake);
    setRunning(true);
    setStopping(false);
    setMessage(null);
    setDecision(config.aiEnabled ? "AI 2 is working. Waiting for an eligible live sample." : "Manual setup ready. One contract will be sent.");

    if (!persistRunState("ready", config)) {
      finishLoop(generation, {
        tone: "error",
        text: "Auto Trader 2.0 could not save a recovery checkpoint, so it stopped before sending an order.",
      });
      return;
    }

    if (!config.aiEnabled) {
      let candidate: AutoTrader2Candidate | null = null;
      if (config.autoSelect) {
        const matchingSignals = signalsRef.current
          .filter((signal) => signal.sample_count >= 20 && signal.recent_digits.length >= 20)
          .map((signal): AutoTrader2Candidate => {
            const digits = signal.recent_digits;
            const sampleCount = Math.min(signal.sample_count, digits.length);
            let observedRate = 0;
            if (config.contractType === "DIGITDIFF") {
              observedRate = ((sampleCount - digits.filter((digit) => digit === config.barrier).length) / sampleCount) * 100;
            } else if (config.contractType === "CALL") {
              observedRate = Number(signal.rise_percentage ?? 0);
            } else if (config.contractType === "PUT") {
              observedRate = Number(signal.fall_percentage ?? 0);
            } else {
              const evenRate = digits.filter((digit) => digit % 2 === 0).length / sampleCount * 100;
              observedRate = config.contractType === "DIGITEVEN" ? evenRate : 100 - evenRate;
            }
            return {
              symbol: signal.symbol,
              contractType: config.contractType,
              ...(config.contractType === "DIGITDIFF" ? { barrier: config.barrier } : {}),
              observedRate,
              sampleCount,
              edgeOverBaseline: observedRate - (config.contractType === "DIGITDIFF" ? 90 : 50),
            };
          })
          .filter((candidate) => Number.isFinite(candidate.observedRate));
        candidate = matchingSignals
          .filter((option) => config.autoSelect || option.symbol === config.selectedMarket)
          .sort((left, right) => right.observedRate - left.observedRate || right.sampleCount - left.sampleCount)[0] ?? null;
        if (!candidate) {
          finishLoop(generation, { tone: "info", text: "No eligible live sample is available for auto-select yet. Start again after more market data arrives." });
          setDecision("Waiting for an eligible live sample.");
          return;
        }
      }
      await runTrades(generation, config, candidate, false);
      return;
    }
    await runTrades(generation, config, null, true);
  };

  const runTrades = async (
    generation: number,
    config: RunConfig,
    firstCandidate: AutoTrader2Candidate | null,
    continuous: boolean,
  ) => {
    let first = true;
    let loopCandidate = firstCandidate;
    while (runRef.current.active && runRef.current.generation === generation) {
      let slotReady = false;
      let latestSignals: readonly AutoTrader2Signal[] = signalsRef.current;
      for (let attempt = 0; attempt < 10 && runRef.current.active && runRef.current.generation === generation; attempt += 1) {
        try {
          const refreshedStatus = await statusRef.current.refetch();
          const currentStatus = refreshedStatus.data;
          if (
            currentStatus?.connected === true
            && currentStatus.authorized === true
            && currentStatus.account?.id === accountId
            && currentStatus.open_contracts_ready === true
            && (currentStatus.active_contract_count ?? 0) === 0
          ) {
            slotReady = true;
            latestSignals = (currentStatus.market_signals ?? []) as AutoTrader2Signal[];
            break;
          }
        } catch {
          finishLoop(generation, {
            tone: "error",
            text: "Deriv could not confirm the open-contract check. Auto Trader 2.0 stopped without sending another order.",
          });
          return;
        }
        setDecision("Waiting for Deriv to confirm there are no open contracts.");
        await delay(1_000);
      }
      if (!slotReady) {
        finishLoop(generation, { tone: "info", text: "Deriv has not confirmed the trade slot is clear. No new order was sent." });
        return;
      }

      const inRecovery = runRef.current.recovery;
      if (continuous && (!first || !loopCandidate)) {
        loopCandidate = chooseCandidate(config, inRecovery, latestSignals);
        if (!loopCandidate) {
          const pausedTypes = runRef.current.pausedContractTypes
            .map((type) => type.replace("DIGIT", ""))
            .join(", ");
          setDecision(pausedTypes
            ? `Waiting for a qualifying alternate sample · AI 2 paused ${pausedTypes} after three losses; no new order sent.`
            : inRecovery
              ? "Waiting for a qualifying Rise/Fall or Even/Odd recovery sample; no new order sent."
              : "Waiting for a fresh sample that meets the entry filter.");
          await delay(1_000);
          continue;
        }
      }
      if (loopCandidate && loopCandidate.contractType === runRef.current.forcedNextType) {
        runRef.current.forcedNextType = null;
      }

      const candidate = loopCandidate;
      const selectedType = candidate?.contractType ?? config.contractType;
      const symbol = candidate?.symbol ?? config.selectedMarket;
      const selectedBarrier = selectedType === "DIGITDIFF" ? candidate?.barrier ?? config.barrier : undefined;
      const orderStake = Number(runRef.current.currentStake.toFixed(2));
      const order: DerivBuyInput = {
        amount: orderStake,
        duration: config.duration,
        duration_unit: "t",
        contract_type: selectedType,
        ...(selectedBarrier == null ? {} : { barrier: selectedBarrier }),
        symbol,
      };

      runRef.current.lastCandidate = candidate;
      setDecision(continuous
        ? inRecovery
          ? `Recovery selection · ${selectedType.replace("DIGIT", "")} · ${symbol} · ${candidate?.observedRate.toFixed(1) ?? "—"}% observed`
          : `AI 2 selected ${selectedType.replace("DIGIT", "")}${selectedBarrier == null ? "" : ` ${selectedBarrier}`} · ${symbol} · ${candidate?.observedRate.toFixed(1) ?? "—"}% observed`
        : `Sending ${selectedType.replace("DIGIT", "")} on ${symbol}.`);
      runRef.current.pendingContractId = null;
      runRef.current.pendingContractType = selectedType;
      runRef.current.pendingStake = orderStake;
      if (config.aiEnabled && !persistRunState("placing", config)) {
        finishLoop(generation, {
          tone: "error",
          text: "Auto Trader 2.0 could not save the pre-order checkpoint. It stopped before sending this order.",
        });
        return;
      }
      setIsPlacing(true);
      let contractId = "";
      try {
        const result = await buyRef.current.mutateAsync({ data: order });
        contractId = String(result.buy?.contract_id ?? "");
        if (!contractId) {
          if (config.aiEnabled) persistRunState("manual-review", config);
          finishLoop(generation, {
            tone: "error",
            text: "Deriv returned an order response without a contract ID. New entries are paused; verify Deriv history before taking any further action.",
          });
          return;
        }
        runRef.current.contractIds = [...runRef.current.contractIds, contractId];
        runRef.current.pendingContractId = contractId;
        setRunContractIds([...runRef.current.contractIds]);
        const historySaved = persistContract(contractId);
        if (config.aiEnabled && !persistRunState("awaiting-settlement", config)) {
          finishLoop(generation, {
            tone: "error",
            text: "Deriv accepted the contract, but its recovery checkpoint could not be saved. Auto Trader 2.0 stopped; check Deriv history and do not resubmit.",
          });
          return;
        }
        if (!historySaved) {
          finishLoop(generation, {
            tone: "error",
            text: "Deriv accepted the contract, but the local history link could not be saved. Auto Trader 2.0 stopped; check Deriv history and do not resubmit.",
          });
          return;
        }
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetDerivStatusQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetDerivAccountsQueryKey() }),
        ]).catch((error: unknown) => console.warn("Could not refresh Auto Trader 2.0 data after an accepted order.", error));
      } catch (error) {
        const uncertain = error instanceof ApiTransportError && error.tradeOutcomeUncertain;
        if (config.aiEnabled) persistRunState("manual-review", config);
        finishLoop(generation, {
          tone: "error",
          text: uncertain
            ? `${error.message} Auto Trader 2.0 stopped and will not resend this order.`
            : error instanceof Error
              ? `${error.message} Auto Trader 2.0 stopped and did not retry the order.`
              : "The order could not be confirmed. Auto Trader 2.0 stopped and did not retry. Check Deriv history before taking any further action.",
        });
        return;
      } finally {
        if (runRef.current.generation === generation) setIsPlacing(false);
      }

      if (!contractId || runRef.current.generation !== generation) return;
      if (!runRef.current.active) {
        const saved = readStoredSession();
        if (saved) {
          setSavedSession(saved);
          setSavedSessionNotice(
            "Deriv accepted this contract before the stop completed. It remains active with Deriv; verify settlement before starting again.",
          );
        }
        return;
      }
      let settledRow: DerivHistoryItem | null = null;
      const settlementController = new AbortController();
      runRef.current.settlementAbortController = settlementController;
      settledRow = await waitForSettledDerivTrade({
        accountId,
        contractId,
        getRows: () => queryClient.getQueryData<DerivHistoryItem[]>(derivHistoryQueryKey),
        subscribe: (listener) => queryClient.getQueryCache().subscribe((event) => {
          if (event.query.queryKey[0] === derivHistoryQueryKey[0]) listener();
        }),
        isSettled,
        signal: settlementController.signal,
        timeoutMs: 135_000,
      });
      if (runRef.current.settlementAbortController === settlementController) {
        runRef.current.settlementAbortController = null;
      }
      if (!runRef.current.active || runRef.current.generation !== generation) return;
      if (!settledRow) {
        finishLoop(generation, {
          tone: "info",
          text: "Deriv has not confirmed settlement yet. Auto Trader 2.0 paused without sending another order; check the account history before restarting.",
        });
        setDecision("Paused · waiting for settlement confirmation.");
        return;
      }

      const settledProfit = Number(settledRow.profit);
      if (!Number.isFinite(settledProfit)) {
        if (config.aiEnabled) persistRunState("manual-review", config);
        finishLoop(generation, {
          tone: "error",
          text: "Deriv history returned an invalid settled profit. Auto Trader 2.0 stopped without sending another order.",
        });
        return;
      }
      const pnlBefore = runRef.current.sessionPnl;
      runRef.current.sessionPnl = Number((pnlBefore + settledProfit).toFixed(2));
      setSessionPnl(runRef.current.sessionPnl);
      setSessionTradeCount(runRef.current.contractIds.length);

      const recovery = updateAutoTrader2Recovery({
        state: {
          active: runRef.current.recovery,
          targetPnl: runRef.current.recoveryTargetPnl,
        },
        contractType: selectedType,
        settledProfit,
        pnlBefore,
        pnlAfter: runRef.current.sessionPnl,
        aiEnabled: config.aiEnabled,
      });
      const lossState = updateAutoTrader2LossState({
        state: {
          lossStreaks: runRef.current.lossStreaks,
          pausedContractTypes: runRef.current.pausedContractTypes,
        },
        contractType: selectedType,
        settledProfit,
      });
      runRef.current.lossStreaks = lossState.lossStreaks;
      runRef.current.pausedContractTypes = lossState.pausedContractTypes;
      runRef.current.recovery = recovery.active;
      runRef.current.recoveryTargetPnl = recovery.targetPnl;
      runRef.current.forcedNextType = config.aiEnabled && settledProfit < 0
        ? getAutoTrader2OppositeType(selectedType)
        : null;
      runRef.current.pendingContractId = null;
      runRef.current.pendingContractType = null;
      runRef.current.pendingStake = null;

      if (settledProfit < 0 && config.stakeMode === "multiply") {
        runRef.current.currentStake = Number((runRef.current.currentStake * config.multiplier).toFixed(2));
      } else {
        runRef.current.currentStake = config.stake;
      }
      setNextStake(runRef.current.currentStake);

      const hitTakeProfit = config.takeProfit > 0 && runRef.current.sessionPnl >= config.takeProfit;
      const hitLossLimit = config.lossLimit > 0 && runRef.current.sessionPnl <= -config.lossLimit;
      if (hitTakeProfit || hitLossLimit) {
        if (config.aiEnabled) persistRunState("completed", config);
        const resultLabel = hitTakeProfit ? "Take-profit limit reached" : "Loss limit reached";
        finishLoop(generation, { tone: "info", text: `${resultLabel}. No further entry was sent.` });
        setDecision(`${resultLabel} · automation stopped.`);
        return;
      }

      if (config.aiEnabled && !persistRunState("ready", config)) {
        finishLoop(generation, {
          tone: "error",
          text: "The settled result was verified, but the recovery checkpoint could not be saved. Auto Trader 2.0 stopped before another order.",
        });
        return;
      }

      if (!continuous) {
        finishLoop(generation, {
          tone: "success",
          text: `${selectedType.replace("DIGIT", "")} contract settled. Auto Trader 2.0 sent one manual order and stopped.`,
        });
        setDecision("Manual order settled. Start again when ready.");
        return;
      }
      first = false;
      loopCandidate = null;
      if (config.aiEnabled && settledProfit < 0) {
        setDecision("AI 2 is analyzing the next eligible side and market.");
        await delay(3_000);
      } else {
        setDecision(runRef.current.recovery
          ? `WORKING · recovery selection stays active until session P/L is above ${amountLabel(runRef.current.recoveryTargetPnl ?? 0, currency)}.`
          : "WORKING · checking recent market evidence.");
        await delay(300);
      }
    }
  };

  const verifyAndResumeSavedSession = async () => {
    if (!savedSession || !accountId || verifyingSavedSession) return;
    if (savedSession.phase === "placing" || savedSession.phase === "manual-review" || savedSession.phase === "completed") {
      setSavedSessionNotice("This saved state cannot be resumed automatically. Check Deriv history manually; no order will be resent.");
      return;
    }
    setVerifyingSavedSession(true);
    setSavedSessionNotice("Checking the selected account, open contracts, and saved contract IDs against Deriv.");
    try {
      const [statusResult, historyResult] = await Promise.all([
        statusRef.current.refetch(),
        historyRef.current.refetch(),
      ]);
      const history = (historyResult.data as DerivHistoryItem[] | undefined) ?? [];
      const assessment = reconcileAutoTrader2SavedSession({
        session: savedSession,
        history,
        openContracts: {
          accountId: statusResult.data?.account?.id ?? null,
          ready: statusResult.data?.open_contracts_ready === true,
          activeCount: statusResult.data?.active_contract_count ?? 0,
        },
      });
      if (assessment.kind === "waiting" || assessment.kind === "uncertain") {
        setSavedSession(assessment.session);
        setSavedSessionNotice(assessment.reason);
        setMessage({
          tone: assessment.kind === "uncertain" ? "error" : "info",
          text: `${assessment.reason} No order was sent.`,
        });
        return;
      }
      if (assessment.kind === "completed") {
        if (!persistReconciledSession(assessment.session)) return;
        setSavedSession(assessment.session);
        setSavedSessionNotice("The saved session reached its configured stop limit. Dismiss its local checkpoint before starting a new run.");
        setMessage({ tone: "info", text: "Deriv history confirmed the saved stop condition. No new order was sent." });
        return;
      }

      const session = assessment.session;
      if (!persistReconciledSession(session)) return;
      const uniqueIds = [...new Set([...localContractsRef.current.map((entry) => entry.id), ...session.contractIds])];
      const historyLinks = uniqueIds.slice(-500).map((id) =>
        localContractsRef.current.find((entry) => entry.id === id) ?? { id, placedAt: Date.now() },
      );
      try {
        localStorage.setItem(`${storagePrefix}${accountId}`, JSON.stringify(historyLinks));
      } catch {
        setSavedSessionNotice("Deriv verified the session, but the local history index could not be saved. Keep it paused and check browser storage before resuming.");
        setMessage({ tone: "error", text: "No order was sent because the local history index could not be saved." });
        return;
      }

      const generation = runRef.current.generation + 1;
      const config = session.config;
      runRef.current = {
        generation,
        active: true,
        stopRequested: false,
        contractIds: [...session.contractIds],
        config,
        currentStake: session.currentStake,
        sessionPnl: session.sessionPnl,
        recovery: session.recoveryTargetPnl !== null,
        recoveryTargetPnl: session.recoveryTargetPnl,
        lossStreaks: { ...session.lossStreaks },
        pausedContractTypes: [...session.pausedContractTypes],
        forcedNextType: session.forcedNextType,
        pendingContractId: null,
        pendingContractType: null,
        pendingStake: null,
        settlementAbortController: null,
        lastCandidate: null,
      };
      localContractsRef.current = historyLinks;
      setLocalContracts(historyLinks);
      setRunContractIds([...session.contractIds]);
      setSessionPnl(session.sessionPnl);
      setSessionTradeCount(session.contractIds.length);
      setNextStake(session.currentStake);
      setFamily(config.family);
      setContractType(config.contractType);
      setBarrier(config.barrier);
      setStake(config.stake);
      setDuration(config.duration);
      setTakeProfit(config.takeProfit);
      setLossLimit(config.lossLimit);
      setStakeMode(config.stakeMode);
      setMultiplier(config.multiplier);
      setAiEnabled(config.aiEnabled);
      setAutoSelect(config.autoSelect);
      setSelectedMarket(config.selectedMarket);
      setSavedSession(null);
      setSavedSessionNotice("");
      setSavedSessionIssue("");
      setDiscardSessionArmed(false);
      setRunning(true);
      setStopping(false);
      setMessage({ tone: "success", text: "Deriv history and open-contract status were verified. The saved session resumed without resending its last contract." });
      setDecision("AI 2 resumed from the verified checkpoint.");
      void runTrades(generation, config, null, true);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Deriv could not verify the saved session.";
      setSavedSessionNotice(`${text} No order was sent.`);
      setMessage({ tone: "error", text: `${text} The saved session remains paused; no order was sent.` });
    } finally {
      setVerifyingSavedSession(false);
    }
  };

  const stop = () => {
    if (!runRef.current.active) return;
    const orderPending = runRef.current.pendingContractId !== null
      || runRef.current.pendingContractType !== null
      || isPlacing;
    setStopping(true);
    runRef.current.stopRequested = true;
    runRef.current.active = false;
    runRef.current.settlementAbortController?.abort();
    setRunning(false);
    setStopping(false);
    setIsPlacing(orderPending);
    setDecision("Stopped · any open contract remains with Deriv and may still settle.");
    setMessage({ tone: "info", text: "Auto Trader 2.0 stopped. Any accepted open contract remains active at Deriv and may still settle." });
    let saved = readStoredSession();
    if (!orderPending && runRef.current.config?.aiEnabled) {
      persistRunState("completed");
      saved = readStoredSession();
    }
    if (saved) {
      setSavedSession(saved);
      setSavedSessionNotice(
        saved.phase === "completed"
          ? "Auto Trader 2.0 is stopped. Starting again begins a new run; Deriv history is unchanged."
          : saved.phase === "awaiting-settlement"
          ? "The stopped session has a contract awaiting settlement. Verify Deriv history before resuming."
          : saved.phase === "placing" || saved.phase === "manual-review"
            ? "The last order may have been submitted. Check Deriv history and open contracts; no order will be resent."
            : "This saved session needs a fresh Deriv check before it can resume.",
      );
    }
  };

  const clearHistory = async () => {
    if (!accountId || running || runRef.current.active || clearingHistory) return;
    if (!clearArmed) {
      setClearArmed(true);
      setMessage(null);
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => {
        setClearArmed(false);
        clearTimer.current = null;
      }, 2_500);
      return;
    }
    setClearArmed(false);
    if (clearTimer.current !== null) {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    setClearingHistory(true);
    if (
      sessionLoadingForAccount
      || sessionLoadedForAccount !== accountId
      || savedSessionIssue
      || requiresAutoTrader2SessionReview(savedSession)
      || runRef.current.pendingContractId !== null
    ) {
      setMessage({
        tone: "info",
        text: "Verify or review the saved Auto Trader 2.0 session before clearing its run totals. No Deriv contracts or account history were changed.",
      });
      setClearingHistory(false);
      return;
    }
    try {
      const refreshedStatus = await statusRef.current.refetch();
      const currentStatus = refreshedStatus.data;
      if (
        refreshedStatus.isError
        || currentStatus?.connected !== true
        || currentStatus.authorized !== true
        || currentStatus.account?.id !== accountId
        || currentStatus.open_contracts_ready !== true
        || (currentStatus.active_contract_count ?? 0) > 0
      ) {
        setMessage({
          tone: "info",
          text: "Auto Trader 2.0 can reset its run totals only after Deriv confirms this account is connected and has no open contract. No contract was closed or cancelled.",
        });
        return;
      }
      const historyKey = `${storagePrefix}${accountId}`;
      const sessionKey = `${sessionStoragePrefix}${accountId}`;
      const previousHistory = localStorage.getItem(historyKey);
      const previousSession = localStorage.getItem(sessionKey);
      try {
        localStorage.removeItem(sessionKey);
        localStorage.removeItem(historyKey);
      } catch (error) {
        try {
          if (previousHistory !== null) localStorage.setItem(historyKey, previousHistory);
          if (previousSession !== null) localStorage.setItem(sessionKey, previousSession);
        } catch {
          setMessage({
            tone: "error",
            text: "Browser storage could not finish clearing Auto Trader 2.0. Refresh and verify the local session; Deriv history was not changed.",
          });
          return;
        }
        throw error;
      }

      localContractsRef.current = [];
      setLocalContracts([]);
      setRunContractIds([]);
      setSessionPnl(0);
      setSessionTradeCount(0);
      setNextStake(stake);
      runRef.current.active = false;
      runRef.current.contractIds = [];
      runRef.current.config = null;
      runRef.current.currentStake = stake;
      runRef.current.sessionPnl = 0;
      runRef.current.recovery = false;
      runRef.current.recoveryTargetPnl = null;
      runRef.current.lossStreaks = {};
      runRef.current.pausedContractTypes = [];
      runRef.current.forcedNextType = null;
      runRef.current.pendingContractId = null;
      runRef.current.pendingContractType = null;
      runRef.current.pendingStake = null;
      runRef.current.lastCandidate = null;
      setSavedSession(null);
      setSavedSessionIssue("");
      setSavedSessionNotice("");
      setDiscardSessionArmed(false);
      setHistoryFading(true);
      window.setTimeout(() => setHistoryFading(false), 320);
      setDecision("");
      setMessage(null);
    } catch {
      setMessage({
        tone: "error",
        text: "The local history and run state could not be cleared. Auto Trader 2.0 left its totals and stake unchanged; Deriv account history was not changed.",
      });
      return;
    } finally {
      setClearingHistory(false);
    }
  };

  const chooseFamily = (nextFamily: AutoTrader2Family) => {
    setFamily(nextFamily);
    setContractType(nextFamily === "differs" ? "DIGITDIFF" : nextFamily === "rise-fall" ? "CALL" : "DIGITEVEN");
  };

  if (access.isLoading) {
    return <AppShell title="AUTO TRADER 2.0"><main className="auto-trader-2-page"><div className="at2-page-loading" aria-label="Loading Auto Trader 2.0" /></main></AppShell>;
  }
  if (access.isError) {
    return <AppShell title="AUTO TRADER 2.0"><main className="auto-trader-2-page"><div className="at2-page-notice error" role="alert"><AlertCircle size={16} />Unable to confirm feature access. Refresh or sign in again before using this feature.</div></main></AppShell>;
  }
  if (!hasAccess) {
    return <AppShell title="AUTO TRADER 2.0"><main className="auto-trader-2-page"><div className="at2-page-notice error" role="status"><ShieldAlert size={16} />Auto Trader 2.0 access is required for this feature.</div></main></AppShell>;
  }

  return (
    <AppShell title="AUTO TRADER 2.0">
      <main className="auto-trader-2-page">
        <section className="at2-page-heading">
          <div>
            <div className="at2-page-kicker"><span /> AUTO TRADER / AUTOMATION</div>
            <h1>Auto Trader <strong>2.0</strong></h1>
            <p>A separate trading mode with its own controls, session limits, and history.</p>
          </div>
        </section>
        {!hasToken && !token.isLoading && <div className="at2-page-notice" role="status"><AlertCircle size={16} />Select and connect a Deriv account in the existing connection settings before trading.</div>}
        {status.error && hasToken && <div className="at2-page-notice error" role="alert"><AlertCircle size={16} />Live Deriv status is unavailable. <button type="button" onClick={() => void status.refetch()}>Retry</button></div>}
        {accounts.error && hasToken && !status.error && <div className="at2-page-notice error" role="alert"><AlertCircle size={16} />The account list is unavailable. <button type="button" onClick={() => void accounts.refetch()}>Retry</button></div>}
        {message && <div className={`at2-page-message ${message.tone}`} role={message.tone === "error" ? "alert" : "status"} data-testid="at2-message">
          {message.tone === "error" ? <AlertCircle size={15} /> : <Check size={15} />}
          <span>{message.text}</span>
          {message.tone === "error" && <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message">×</button>}
        </div>}
        <section className="at2-account-strip" aria-label="Selected Deriv account">
          <span className={account?.type === "real" ? "real" : ""}>{account?.type ? `${account.type.toUpperCase()} ACCOUNT` : "NO ACCOUNT"}</span>
          <strong>{account?.id ?? "Select an account"}</strong>
          <b>{account && getAccountBalance(account) != null ? amountLabel(getAccountBalance(account)!, currency) : "—"}</b>
          <i className={connected ? "connected" : ""}>{connected ? "CONNECTED" : "OFFLINE"}</i>
        </section>

        {(savedSession || savedSessionIssue || sessionLoadingForAccount) && <section className="at2-session-recovery" role={savedSessionIssue ? "alert" : "status"} aria-label="Saved Auto Trader 2.0 session">
          <div className="at2-session-recovery-copy">
            <strong>{sessionLoadingForAccount ? "CHECKING SAVED SESSION" : savedSessionIssue ? "RECOVERY CHECK NEEDED" : savedSession?.phase === "completed" ? "SESSION STOPPED" : "SAVED AI 2 SESSION"}</strong>
            <p>{sessionLoadingForAccount ? "Checking account-scoped browser state before enabling new trades." : savedSessionIssue || savedSessionNotice || "Verify this account's Deriv history and open-contract status before resuming."}</p>
            {savedSession && <small>
              {savedSession.contractIds.length} saved contract{savedSession.contractIds.length === 1 ? "" : "s"} · session P/L {amountLabel(savedSession.sessionPnl, currency)}
              {savedSession.recoveryTargetPnl !== null ? ` · Differs recovery target ${amountLabel(savedSession.recoveryTargetPnl, currency)}` : ""}
            </small>}
          </div>
          <div className="at2-session-recovery-actions">
            {savedSession && (savedSession.phase === "ready" || savedSession.phase === "awaiting-settlement") && <button type="button" onClick={() => void verifyAndResumeSavedSession()} disabled={verifyingSavedSession || !connected} data-testid="at2-verify-resume">
              {verifyingSavedSession ? "VERIFYING…" : "VERIFY DERIV & RESUME"}
            </button>}
            {(savedSessionIssue || requiresAutoTrader2SessionReview(savedSession)) && <button type="button" className="secondary" onClick={discardSavedSession} disabled={verifyingSavedSession} data-testid="at2-discard-session">
              {discardSessionArmed ? "CONFIRM CLEAR LOCAL STATE" : "I CHECKED HISTORY"}
            </button>}
          </div>
        </section>}

        <AutoTrader2Panel
          contractFamily={family}
          onContractFamilyChange={chooseFamily}
          contractType={contractType}
          onContractTypeChange={setContractType}
          barrier={barrier}
          onBarrierChange={setBarrier}
          stake={stake}
          onStakeChange={setStake}
          nextStake={nextStake}
          duration={duration}
          onDurationChange={setDuration}
          takeProfit={takeProfit}
          onTakeProfitChange={setTakeProfit}
          lossLimit={lossLimit}
          onLossLimitChange={setLossLimit}
          stakeMode={stakeMode}
          onStakeModeChange={setStakeMode}
          multiplier={multiplier}
          onMultiplierChange={setMultiplier}
          aiEnabled={aiEnabled}
          onAiEnabledChange={setAiEnabled}
          aiStatus={aiStatus}
          running={running}
          stopping={stopping}
          connected={connected}
          tradeUpdatesConnected={tradeUpdatesConnected}
          tradeSlotBlocked={tradeSlotBlocked}
          sessionNeedsReview={
            sessionLoadingForAccount
            || Boolean(savedSessionIssue)
            || requiresAutoTrader2SessionReview(savedSession)
          }
          isPlacingTrade={isPlacing}
          selectedMarket={selectedMarket}
          selectedMarketLabel={selectedLabel}
          marketOptions={markets}
          onMarketChange={setSelectedMarket}
          autoSelect={autoSelect}
          onAutoSelectChange={setAutoSelect}
          aiDecision={decision}
          observedSampleCount={observedSampleCount}
          currency={currency}
          sessionPnl={sessionPnl}
          sessionTradeCount={sessionTradeCount}
          recentTrades={recentTrades}
          sessionRows={runRows}
          clearArmed={clearArmed}
          historyFading={historyFading}
          clearingHistory={clearingHistory}
          onStart={() => void start()}
          onStop={stop}
          onClearHistory={clearHistory}
          onOpenGuide={() => { setGuidePage(0); setGuideOpen(true); }}
        />

        <div className="at2-page-caution"><ShieldAlert size={15} /><span>Live account selection routes orders to real funds when server-side live trading is enabled. AI 2 only filters historical observations and cannot guarantee profit or loss recovery.</span></div>
        <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
          <DialogContent className="at2-guide-dialog" data-testid="at2-guide-dialog">
            <DialogHeader>
              <div className="at2-guide-overline"><BookOpen size={14} /> AUTO TRADER 2.0 GUIDE <span>{String(guidePage + 1).padStart(2, "0")} / 20</span></div>
              <DialogTitle>{guideCopy[guidePage][0]}</DialogTitle>
              <DialogDescription>{guideCopy[guidePage][1]}</DialogDescription>
            </DialogHeader>
            <div className="at2-guide-caution"><ShieldAlert size={15} /><span>{guideCopy[guidePage][2]}</span></div>
            <div className="at2-guide-progress"><span style={{ transform: `scaleX(${(guidePage + 1) / 20})` }} /></div>
            <div className="at2-guide-controls">
              <button type="button" onClick={() => setGuidePage((page) => Math.max(0, page - 1))} disabled={guidePage === 0} data-testid="at2-guide-previous"><ChevronLeft size={15} /> Previous</button>
              <button type="button" onClick={() => guidePage === 19 ? setGuideOpen(false) : setGuidePage((page) => Math.min(19, page + 1))} data-testid="at2-guide-next">{guidePage === 19 ? "Finish" : "Next"} <ChevronRight size={15} /></button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </AppShell>
  );
}

export default function AutoTrader2Page() {
  return <AutoTrader2Content />;
}
