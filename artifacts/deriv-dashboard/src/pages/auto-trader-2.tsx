import { useEffect, useMemo, useRef, useState } from "react";
import {
  getGetAccessSessionQueryKey,
  getGetAdminFeatureSettingsQueryKey,
  getGetDerivAccountsQueryKey,
  getGetDerivHistoryQueryKey,
  getGetDerivStatusQueryKey,
  getGetDerivTokenStatusQueryKey,
  ApiError,
  ApiTransportError,
  useBuyDerivContract,
  useGetAccessSession,
  useGetAdminFeatureSettings,
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
  getAutoTrader2StopReason,
  parseAutoTrader2SavedSession,
  reconcileAutoTrader2SavedSession,
  requiresAutoTrader2SessionReview,
  type AutoTrader2RunConfig as RunConfig,
  type AutoTrader2SavedPhase,
  type AutoTrader2SavedSession,
} from "@/lib/auto-trader-2-session";
import {
  chooseAutoTrader2Candidate,
  chooseAutoTrader2ManualCandidate,
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
  ["Choose a contract family", "Choose Differs, Rise/Fall, or Even/Odd. Select A · Auto to use the least frequent recent digit for Differs, or the higher observed expiry win rate for Rise/Fall and Even/Odd. AI 2 remains an optional stricter filter.", "The contract result is decided at expiry. A recent pattern does not determine the next result."],
  ["Digit Differs", "Differs wins when the last digit at contract expiry is not the selected barrier digit. Choose a digit from 0 through 9 when using manual settings.", "A digit that appeared less often in a sample is not guaranteed to stay uncommon."],
  ["Rise and Fall", "Rise uses a CALL contract and Fall uses a PUT contract. The selected market movement at expiry determines which contract wins.", "Recent up/down movements are descriptive history only; they do not predict the next movement."],
  ["Even and Odd", "Even and Odd use the last digit at expiry. Choose the parity manually or let AI 2 compare the observed sample when it is enabled.", "A recent imbalance can change quickly and is not a promise of future parity."],
  ["Set your stake", "Stake is the amount requested for each individual contract. The account balance and the server's trading checks remain authoritative.", "The amount risked can be lost. Keep it within an amount you can afford to lose."],
  ["Set contract duration", "Duration is the number of ticks before contract expiry. Auto Trader 2.0 uses whole-tick durations from 1 through 5.", "A shorter contract resolves sooner but is not automatically safer or more profitable."],
  ["Stop conditions", "Auto Trader 2.0 continues after wins and stops when you press Stop, settled losses reach Loss Limit, or settled session profit reaches Profit Target. Enter zero to disable either limit.", "An already-open contract may settle after you stop. Neither limit caps the possible result of an open contract."],
  ["Loss limit", "Loss Limit stops the loop before another entry once settled session losses reach the configured amount. Enter zero to turn this stop off.", "This does not cap the possible loss on an already-open contract or guarantee an exact maximum loss."],
  ["Profit target", "Profit Target stops the loop before another entry once settled session profit reaches your configured amount. Enter zero to turn this stop off.", "An already-open contract may settle after a target is reached; the bot will not open another entry after settlement."],
  ["Flat stake mode", "Flat mode uses the configured stake for each entry. It makes the planned amount consistent from one contract to the next.", "Flat staking cannot prevent losses. Review the stake against the account balance before starting."],
  ["Multiply after loss", "Multiply after loss increases the next requested stake after a losing settlement by your configured multiplier. A win returns the next amount to the base stake.", "Multiplying can increase exposure quickly and does not guarantee recovery. The server still checks the selected account balance."],
  ["Auto-select market", "When enabled, Auto Trader 2.0 compares recent expiry results across supported markets and uses the strongest observed sample for your selected contract or Auto choice. Turn it off to stay on the manually selected market.", "Auto-selection ranks observed data; it is not a forecast of future results."],
  ["AI 2 checkbox", "AI 2 uses a stricter evidence filter, chooses the strongest qualifying direction or parity, and switches to the paired opposite side after a loss. It analyzes fresh market data before the next entry; if the opposite side does not qualify, it waits. After three losses on one type, it pauses that type for the rest of the session.", "AI 2 is a rule-based filter of observed market data, not a source of guaranteed outcomes."],
  ["AI 2 sample threshold", "AI 2 requires a larger recent expiry sample and statistical support above the contract baseline. When the evidence is weak or inconsistent, it waits instead of placing a trade.", "Observed rates are historical context, not a promise of future contract results."],
  ["Differs loss response", "After any AI 2 Differs loss settles, recovery selection switches to qualifying Rise/Fall or Even/Odd candidates and can auto-select the strongest market. It remains in recovery until settled session P/L rises above the P/L level from just before that loss.", "Recovery does not guarantee a profit. If no qualifying setup is available, AI 2 waits without placing an order."],
  ["One open contract at a time", "The loop waits for Deriv history to show the active contract as settled before considering another entry. Other open contracts also block new entries.", "If settlement cannot be verified, the loop pauses instead of guessing or sending another order."],
  ["Reading Auto Trader 2.0 History", "History uses the same session summary and trade-row design as Cash Grab. It only includes contracts this feature recorded for the currently selected account.", "The history list is a dashboard view. Deriv remains the authoritative account record."],
  ["Clear this feature's history", "The two-step clear removes this browser's Auto Trader 2.0 rows and verified local run state. It resets this run's totals and next stake to the configured stake; Deriv account history is unchanged.", "If a stopped contract is settling, Deriv must first confirm it is closed. An uncertain order still requires review; clearing never closes or cancels a contract."],
  ["Declines, uncertain orders & reloads", "A confirmed rejection is retried after a short wait. If the order outcome is uncertain, Auto Trader 2.0 stays paused for review and will never resend it. Session state is saved for this account in this browser; after reload, Deriv history and open contracts are checked before continuing.", "A saved checkpoint is not proof of settlement. If history, account identity, or open-contract status cannot be confirmed, keep the session paused and review Deriv directly."],
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
  const featureSettings = useGetAdminFeatureSettings({
    query: { queryKey: getGetAdminFeatureSettingsQueryKey(), retry: false, refetchInterval: 10_000 },
  });
  const isAdmin = access.data?.is_admin === true;
  const featureAvailable = featureSettings.data?.features.find((item) => item.feature === "auto-trader-2")?.mode === "available";
  const hasAccess = isAdmin || (access.data?.features.includes("auto-trader-2") === true && featureAvailable);
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
  const [lossLimit, setLossLimit] = useState(10);
  const [profitLimit, setProfitLimit] = useState(0);
  const [stakeMode, setStakeMode] = useState<"flat" | "multiply">("flat");
  const [multiplier, setMultiplier] = useState(2);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [autoContractType, setAutoContractType] = useState(false);
  const [autoSelect, setAutoSelect] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState("R_10");
  const [nextStake, setNextStake] = useState(1);
  const [decision, setDecision] = useState("Choose a contract family and start a session.");
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [messageFading, setMessageFading] = useState(false);
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
        const featureContractIds = new Set(localContractsRef.current.map((entry) => entry.id));
        queryClient.setQueryData<DerivHistoryItem[]>(
          derivHistoryQueryKey,
          (current) => {
            const merged = new Map(
              rows
                .filter((row) => row.account_id === accountId)
                .map((row) => [row.contract_id, row]),
            );
            for (const row of current ?? []) {
              if (
                row.account_id === accountId
                && featureContractIds.has(row.contract_id)
                && !merged.has(row.contract_id)
              ) {
                merged.set(row.contract_id, row);
              }
            }
            return [...merged.values()];
          },
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
        setLossLimit(restoredSession.config.lossLimit);
        setProfitLimit(restoredSession.config.profitLimit);
        setStakeMode(restoredSession.config.stakeMode);
        setMultiplier(restoredSession.config.multiplier);
        setAiEnabled(restoredSession.config.aiEnabled);
        setAutoContractType(restoredSession.config.autoContractType);
        setAutoSelect(restoredSession.config.autoSelect);
        setSelectedMarket(restoredSession.config.selectedMarket);
        setSavedSessionNotice(
          restoredSession.phase === "placing" || restoredSession.phase === "manual-review"
            ? "The last order may have been submitted before the page reloaded. Check Deriv history and open contracts; no order will be resent."
            : restoredSession.phase === "awaiting-settlement"
              ? "Auto Trader 2.0 is stopped. The accepted contract remains with Deriv; Start will check its settlement before continuing."
              : restoredSession.phase === "completed"
                ? "This session is stopped. Starting again begins a new run; Deriv history remains unchanged."
                : "A saved Auto Trader 2.0 session was found. Press Start to check Deriv history and continue safely.",
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
    lossLimit,
    profitLimit,
    stakeMode,
    multiplier,
    aiEnabled,
    autoContractType,
    autoSelect,
    selectedMarket,
  });

  const persistRunState = (phase: AutoTrader2SavedPhase, config = runRef.current.config) => {
    if (!config) return true;
    if (!accountId) return false;
    const isTerminalOrReady = phase === "ready" || phase === "completed";
    const snapshot: AutoTrader2SavedSession = {
      version: 4,
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

  const chooseCandidate = (
    config: RunConfig,
    recovery: boolean,
    currentSignals: readonly AutoTrader2Signal[] = signalsRef.current,
  ) => {
    const autoDiffers = !recovery && config.family === "differs" && config.autoContractType
      ? chooseManualCandidate(config, currentSignals)
      : null;
    if (!recovery && config.family === "differs" && config.autoContractType && !autoDiffers) return null;
    return chooseAutoTrader2Candidate({
      signals: currentSignals,
      family: recovery ? "recovery" : config.family,
      preferredType: config.contractType,
      barrier: config.barrier,
      selectedMarket: autoDiffers?.symbol ?? config.selectedMarket,
      autoSelect: autoDiffers ? false : config.autoSelect,
      duration: config.duration,
      excludedContractTypes: runRef.current.pausedContractTypes,
      requiredContractType: runRef.current.forcedNextType,
      requiredBarrier: autoDiffers?.barrier,
    });
  };

  const chooseManualCandidate = (
    config: RunConfig,
    currentSignals: readonly AutoTrader2Signal[],
  ) => chooseAutoTrader2ManualCandidate({
    signals: currentSignals,
    family: config.family,
    preferredType: config.contractType,
    barrier: config.barrier,
    autoContractType: config.autoContractType,
    selectedMarket: config.selectedMarket,
    autoSelect: config.autoSelect,
    duration: config.duration,
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
    const saved = readStoredSession();
    if (saved) {
      setSavedSession(saved);
      setSavedSessionNotice(
        saved.phase === "placing" || saved.phase === "manual-review"
          ? "The last order may have been submitted. Check Deriv history and open contracts before deciding what to do; Auto Trader 2.0 will not resend it."
          : saved.phase === "awaiting-settlement"
            ? "The accepted contract is still settling. Press Start after it settles; Auto Trader 2.0 will check Deriv before continuing."
            : saved.phase === "completed"
              ? `${finalMessage?.text ?? "Auto Trader 2.0 is stopped."} Starting again begins a new run; Deriv history remains unchanged.`
              : "The saved session is paused. Verify its Deriv history and open-contract status before resuming.",
      );
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
      if (savedSession.phase === "ready" || savedSession.phase === "awaiting-settlement") {
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
        setMessage({ tone: "info", text: "This session has an uncertain order. Review Deriv history before starting; no order will be retried." });
        return;
      }
    }
    if (!Number.isFinite(stake) || stake < minimumStake) {
      setMessage({ tone: "error", text: `Enter a stake of at least ${minimumStake.toFixed(2)} ${currency}.` });
      return;
    }
    if (!Number.isFinite(lossLimit) || lossLimit < 0 || !Number.isFinite(profitLimit) || profitLimit < 0) {
      setMessage({ tone: "error", text: "Loss Limit and Profit Target must be zero or greater." });
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
    setDecision(config.aiEnabled
      ? "AI 2 is working. Waiting for an eligible live sample."
      : config.autoContractType || config.autoSelect
        ? "Auto selection is active. Waiting for enough recent samples."
        : "Manual setup ready. The selected contract will repeat until a stop limit is reached or you stop it.");

    if (!persistRunState("ready", config)) {
      finishLoop(generation, {
        tone: "error",
        text: "Auto Trader 2.0 could not save a session checkpoint, so it stopped before sending an order.",
      });
      return;
    }

    await runTrades(generation, config, null);
  };

  const runTrades = async (
    generation: number,
    config: RunConfig,
    firstCandidate: AutoTrader2Candidate | null,
  ) => {
    let first = true;
    let loopCandidate = firstCandidate;
    let confirmedRejectionDelay = 1_000;
    while (runRef.current.active && runRef.current.generation === generation) {
      let slotReady = false;
      let latestSignals: readonly AutoTrader2Signal[] = signalsRef.current;
      let statusRetryDelay = 1_000;
      while (!slotReady && runRef.current.active && runRef.current.generation === generation) {
        try {
          const refreshedStatus = await statusRef.current.refetch();
          const currentStatus = refreshedStatus.data;
          if (
            !refreshedStatus.isError
            &&
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
          // Keep the session alive, but never send a new order without a fresh open-contract confirmation.
        }
        if (!slotReady && runRef.current.active && runRef.current.generation === generation) {
          setDecision("Waiting for Deriv to confirm there are no open contracts. No new order will be sent until it does.");
          await delay(statusRetryDelay);
          statusRetryDelay = Math.min(statusRetryDelay * 2, 5_000);
        }
      }
      if (!slotReady) return;

      const inRecovery = runRef.current.recovery;
      if (!first || !loopCandidate) {
        loopCandidate = config.aiEnabled
          ? chooseCandidate(config, inRecovery, latestSignals)
          : config.autoContractType || config.autoSelect
            ? chooseManualCandidate(config, latestSignals)
            : null;
        if (!loopCandidate && (config.aiEnabled || config.autoContractType || config.autoSelect)) {
          const pausedTypes = runRef.current.pausedContractTypes
            .map((type) => type.replace("DIGIT", ""))
            .join(", ");
          setDecision(pausedTypes
            ? `Waiting for a qualifying alternate sample · AI 2 paused ${pausedTypes} after three losses; no new order sent.`
            : inRecovery
              ? "Waiting for a qualifying Rise/Fall or Even/Odd recovery sample; no new order sent."
              : config.aiEnabled
                ? "Waiting for a fresh sample that meets the AI 2 entry filter."
                : "Waiting for enough recent samples to choose the requested automatic contract or market.");
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
        access_feature: "auto-trader-2",
        amount: orderStake,
        duration: config.duration,
        duration_unit: "t",
        contract_type: selectedType,
        ...(selectedBarrier == null ? {} : { barrier: selectedBarrier }),
        symbol,
      };

      runRef.current.lastCandidate = candidate;
      setDecision(config.aiEnabled && inRecovery
          ? `Recovery selection · ${selectedType.replace("DIGIT", "")} · ${symbol} · ${candidate?.observedRate.toFixed(1) ?? "—"}% observed`
          : config.aiEnabled
            ? `AI 2 selected ${selectedType.replace("DIGIT", "")}${selectedBarrier == null ? "" : ` ${selectedBarrier}`} · ${symbol} · ${candidate?.observedRate.toFixed(1) ?? "—"}% observed`
            : candidate
              ? `Auto selected ${selectedType.replace("DIGIT", "")}${selectedBarrier == null ? "" : ` ${selectedBarrier}`} · ${symbol} · ${candidate.observedRate.toFixed(1)}% observed`
              : `Repeating selected ${selectedType.replace("DIGIT", "")}${selectedBarrier == null ? "" : ` ${selectedBarrier}`} on ${symbol}.`);
      runRef.current.pendingContractId = null;
      runRef.current.pendingContractType = selectedType;
      runRef.current.pendingStake = orderStake;
      if (!persistRunState("placing", config)) {
        finishLoop(generation, {
          tone: "error",
          text: "Auto Trader 2.0 could not save the pre-order checkpoint. It stopped before sending this order.",
        });
        return;
      }
      setIsPlacing(true);
      let contractId = "";
      try {
        const result = await buyRef.current.mutateAsync({ data: { ...order, automated: true } });
        contractId = String(result.buy?.contract_id ?? "");
        if (!contractId) {
          persistRunState("manual-review", config);
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
        if (!persistRunState("awaiting-settlement", config)) {
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
          queryClient.refetchQueries({ queryKey: getGetDerivStatusQueryKey(), type: "active" }, { cancelRefetch: false }),
          queryClient.refetchQueries({ queryKey: derivHistoryQueryKey, type: "active" }, { cancelRefetch: false }),
          queryClient.refetchQueries({ queryKey: getGetDerivAccountsQueryKey(), type: "active" }, { cancelRefetch: false }),
        ]).catch((error: unknown) => console.warn("Could not refresh Auto Trader 2.0 data after an accepted order.", error));
      } catch (error) {
        const errorData = error instanceof ApiError && error.data && typeof error.data === "object"
          ? error.data as Record<string, unknown>
          : null;
        const errorCode = typeof errorData?.code === "string" ? errorData.code : "";
        const confirmedRejection = error instanceof ApiError
          && error.status < 500
          && error.status !== 403;
        if (errorCode === "AUTO_TRADER_2_PAUSED" || errorCode === "DERIV_BUY_RATE_LIMITED" || confirmedRejection) {
          runRef.current.pendingContractType = null;
          runRef.current.pendingStake = null;
          if (!persistRunState("ready", config)) {
            finishLoop(generation, {
              tone: "error",
              text: "The order was rejected, but Auto Trader 2.0 could not save its session state. It stopped before another order.",
            });
            return;
          }
          const retryText = error instanceof Error
            ? `${error.message} No contract was accepted. Auto Trader 2.0 remains active and will check again.`
            : "Deriv rejected the order. Auto Trader 2.0 remains active and will check again.";
          setMessage({ tone: "info", text: retryText });
          setDecision("Waiting briefly after a confirmed rejection. Auto Trader 2.0 remains active.");
          setIsPlacing(false);
          await delay(confirmedRejectionDelay);
          confirmedRejectionDelay = Math.min(confirmedRejectionDelay * 2, 30_000);
          continue;
        }
        const uncertain = error instanceof ApiTransportError && error.tradeOutcomeUncertain;
        persistRunState("manual-review", config);
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
            "Auto Trader 2.0 is stopped. The accepted contract remains with Deriv; Start will check its settlement before continuing.",
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
          timeoutMs: null,
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

      const stopReason = getAutoTrader2StopReason({
        sessionPnl: runRef.current.sessionPnl,
        lossLimit: config.lossLimit,
        profitLimit: config.profitLimit,
      });
      if (stopReason === "loss") {
        persistRunState("completed", config);
        finishLoop(generation, { tone: "info", text: "Loss limit reached. No further entry was sent." });
        setDecision("Loss limit reached · automation stopped.");
        return;
      }
      if (stopReason === "profit") {
        persistRunState("completed", config);
        finishLoop(generation, { tone: "success", text: "Profit target reached. No further entry was sent." });
        setDecision("Profit target reached · automation stopped.");
        return;
      }

      if (!persistRunState("ready", config)) {
        finishLoop(generation, {
          tone: "error",
          text: "The settled result was verified, but the session checkpoint could not be saved. Auto Trader 2.0 stopped before another order.",
        });
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
          setSavedSessionNotice("The saved session reached its configured stop limit. Start again to begin a new run.");
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
      setLossLimit(config.lossLimit);
      setProfitLimit(config.profitLimit);
      setStakeMode(config.stakeMode);
      setMultiplier(config.multiplier);
      setAiEnabled(config.aiEnabled);
      setAutoContractType(config.autoContractType);
      setAutoSelect(config.autoSelect);
      setSelectedMarket(config.selectedMarket);
      setSavedSession(null);
      setSavedSessionNotice("");
      setSavedSessionIssue("");
      setRunning(true);
      setStopping(false);
      setMessage({ tone: "success", text: "Deriv history and open-contract status were verified. The saved session resumed without resending its last contract." });
      setDecision("AI 2 resumed from the verified checkpoint.");
      void runTrades(generation, config, null);
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
    const orderStillSubmitting = runRef.current.pendingContractId === null
      && (runRef.current.pendingContractType !== null || isPlacing);
    setStopping(true);
    runRef.current.stopRequested = true;
    runRef.current.active = false;
    runRef.current.settlementAbortController?.abort();
    setRunning(false);
    setStopping(false);
    setIsPlacing(orderStillSubmitting);
    setDecision("Stopped · any open contract remains with Deriv and may still settle.");
    setMessage({ tone: "info", text: "Auto Trader 2.0 stopped. Any accepted contract remains with Deriv and will settle; new entries are paused." });
    let saved = readStoredSession();
    if (!orderPending && runRef.current.config) {
      persistRunState("completed");
      saved = readStoredSession();
    }
    if (saved) {
      setSavedSession(saved);
      setSavedSessionNotice(
        saved.phase === "completed"
          ? "Auto Trader 2.0 is stopped. Starting again begins a new run; Deriv history is unchanged."
          : saved.phase === "awaiting-settlement"
          ? "Auto Trader 2.0 is stopped. Its accepted contract remains with Deriv; Start will check settlement before continuing."
          : saved.phase === "placing" || saved.phase === "manual-review"
            ? "The last order may have been submitted. Check Deriv history and open contracts; no order will be resent."
            : "This saved session needs a fresh Deriv check before it can resume.",
      );
    }
  };

  useEffect(() => {
    if (!hasAccess && runRef.current.active) {
      stop();
      setMessage({ tone: "error", text: "Auto Trader 2.0 access was removed. No further entries will be sent." });
    }
  }, [hasAccess, stop]);

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
      || (runRef.current.pendingContractId === null
        && (runRef.current.pendingContractType !== null || isPlacing))
    ) {
      setMessage({
        tone: "info",
        text: "A pending or uncertain order must be checked before clearing this feature's history. No Deriv contracts or account history were changed.",
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
      const historyResult = await historyRef.current.refetch();
      if (historyResult.isError || !Array.isArray(historyResult.data)) {
        setMessage({
          tone: "info",
          text: "Deriv history could not be refreshed to verify the account. The local history and session were left unchanged.",
        });
        return;
      }
      const savedContractStillOpen = savedSession?.contractIds.some((contractId) =>
        (historyResult.data as DerivHistoryItem[]).some((row) =>
          row.account_id === accountId
          && row.contract_id === contractId
          && ["open", "pending", "active"].includes(row.status.toLowerCase()),
        ),
      );
      if (savedContractStillOpen) {
        setMessage({
          tone: "info",
          text: "Deriv history still reports a saved contract as open. The local history and session were left unchanged.",
        });
        return;
      }
      if (savedSession && (savedSession.phase === "ready" || savedSession.phase === "awaiting-settlement")) {
        const assessment = reconcileAutoTrader2SavedSession({
          session: savedSession,
          history: historyResult.data as DerivHistoryItem[],
          openContracts: {
            accountId,
            ready: currentStatus.open_contracts_ready === true,
            activeCount: currentStatus.active_contract_count ?? 0,
          },
        });
        if (assessment.kind === "waiting" || assessment.kind === "uncertain") {
          setSavedSession(assessment.session);
          setSavedSessionNotice(assessment.reason);
          setMessage({
            tone: "info",
            text: `${assessment.reason} The history and session were left unchanged.`,
          });
          return;
        }
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
        {message && <div className={`at2-page-message ${message.tone}${messageFading ? " fading" : ""}`} role={message.tone === "error" ? "alert" : "status"} data-testid="at2-message">
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
            <strong>
              {sessionLoadingForAccount
                ? "CHECKING SAVED SESSION"
                : savedSessionIssue
                  ? "RECOVERY CHECK NEEDED"
                  : savedSession?.phase === "completed"
                    ? "SESSION STOPPED"
                    : savedSession?.phase === "awaiting-settlement"
                      ? "STOPPED · CONTRACT SETTLING"
                      : "SAVED AI 2 SESSION"}
            </strong>
            <p>{sessionLoadingForAccount ? "Checking account-scoped browser state before enabling new trades." : savedSessionIssue || savedSessionNotice || "Press Start to check this account's Deriv history before continuing."}</p>
            {savedSession && <small>
              {savedSession.contractIds.length} saved contract{savedSession.contractIds.length === 1 ? "" : "s"} · session P/L {amountLabel(savedSession.sessionPnl, currency)}
              {savedSession.recoveryTargetPnl !== null ? ` · Differs recovery target ${amountLabel(savedSession.recoveryTargetPnl, currency)}` : ""}
            </small>}
          </div>
          <div className="at2-session-recovery-actions" />
        </section>}

        <AutoTrader2Panel
          contractFamily={family}
          onContractFamilyChange={chooseFamily}
          contractType={contractType}
          onContractTypeChange={(type) => { setContractType(type); setAutoContractType(false); }}
          barrier={barrier}
          onBarrierChange={setBarrier}
          stake={stake}
          onStakeChange={setStake}
          nextStake={nextStake}
          duration={duration}
          onDurationChange={setDuration}
          lossLimit={lossLimit}
          onLossLimitChange={setLossLimit}
          profitLimit={profitLimit}
          onProfitLimitChange={setProfitLimit}
          stakeMode={stakeMode}
          onStakeModeChange={setStakeMode}
          multiplier={multiplier}
          onMultiplierChange={setMultiplier}
          aiEnabled={aiEnabled}
          onAiEnabledChange={setAiEnabled}
          autoContractType={autoContractType}
          onAutoContractTypeChange={setAutoContractType}
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

        <div className="at2-page-caution"><ShieldAlert size={15} /><span>Live account selection routes orders to real funds when server-side live trading is enabled. Auto selection and AI 2 use historical observations and cannot guarantee future results.</span></div>
        <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
          <DialogContent className="at2-guide-dialog" data-testid="at2-guide-dialog">
            <DialogHeader>
              <div className="at2-guide-overline"><BookOpen size={14} /> AUTO TRADER 2.0 GUIDE <span>{String(guidePage + 1).padStart(2, "0")} / {guideCopy.length}</span></div>
              <DialogTitle>{guideCopy[guidePage][0]}</DialogTitle>
              <DialogDescription>{guideCopy[guidePage][1]}</DialogDescription>
            </DialogHeader>
            <div className="at2-guide-caution"><ShieldAlert size={15} /><span>{guideCopy[guidePage][2]}</span></div>
            <div className="at2-guide-progress"><span style={{ transform: `scaleX(${(guidePage + 1) / guideCopy.length})` }} /></div>
            <div className="at2-guide-controls">
              <button type="button" onClick={() => setGuidePage((page) => Math.max(0, page - 1))} disabled={guidePage === 0} data-testid="at2-guide-previous"><ChevronLeft size={15} /> Previous</button>
              <button type="button" onClick={() => guidePage === guideCopy.length - 1 ? setGuideOpen(false) : setGuidePage((page) => Math.min(guideCopy.length - 1, page + 1))} data-testid="at2-guide-next">{guidePage === guideCopy.length - 1 ? "Finish" : "Next"} <ChevronRight size={15} /></button>
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
