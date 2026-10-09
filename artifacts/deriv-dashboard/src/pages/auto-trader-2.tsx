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
  chooseAutoTrader2Candidate,
  updateAutoTrader2Recovery,
  type AutoTrader2Candidate,
  type AutoTrader2ContractType,
  type AutoTrader2Family,
  type AutoTrader2Signal,
} from "@/lib/auto-trader-2-strategy";
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
  ["Choose a contract family", "Choose Differs, Rise/Fall, or Even/Odd. The controls below the family choice show the exact contract type or digit barrier that will be used.", "The contract result is decided at expiry. A recent pattern does not determine the next result."],
  ["Digit Differs", "Differs wins when the last digit at contract expiry is not the selected barrier digit. Choose a digit from 0 through 9 when using manual settings.", "A digit that appeared less often in a sample is not guaranteed to stay uncommon."],
  ["Rise and Fall", "Rise uses a CALL contract and Fall uses a PUT contract. The selected market movement at expiry determines which contract wins.", "Recent up/down movements are descriptive history only; they do not predict the next movement."],
  ["Even and Odd", "Even and Odd use the last digit at expiry. Choose the parity manually or let AI 2 compare the observed sample when it is enabled.", "A recent imbalance can change quickly and is not a promise of future parity."],
  ["Set your stake", "Stake is the amount requested for each individual contract. The account balance and the server's trading checks remain authoritative.", "The amount risked can be lost. Keep it within an amount you can afford to lose."],
  ["Set contract duration", "Duration is the number of ticks before contract expiry. Auto Trader 2.0 uses whole-tick durations from 1 through 5.", "A shorter contract resolves sooner but is not automatically safer or more profitable."],
  ["Take-profit limit", "Take Profit stops the automated loop before another entry once the settled session profit reaches this value. Enter zero to turn this stop off.", "This is a session stop, not a guaranteed payout. An already-open contract may settle after the loop stops."],
  ["Loss limit", "Loss Limit stops the loop before another entry once settled session losses reach the configured amount. Enter zero to turn this stop off.", "This does not cap the possible loss on an already-open contract or guarantee an exact maximum loss."],
  ["Flat stake mode", "Flat mode uses the configured stake for each entry. It makes the planned amount consistent from one contract to the next.", "Flat staking cannot prevent losses. Review the stake against the account balance before starting."],
  ["Multiply after loss", "Multiply after loss increases the next requested stake after a losing settlement by your configured multiplier. A win returns the next amount to the base stake.", "Multiplying can increase exposure quickly and does not guarantee recovery. The server still checks the selected account balance."],
  ["Auto-select market", "When enabled, the feature can choose among the supported markets using the available live samples. Turn it off to keep the manually selected market.", "Auto-selection ranks observed data; it is not a forecast of future results."],
  ["AI 2 checkbox", "Select the AI 2 box before starting to enable its observed-data filter. The box displays a tick and the status reads WORKING while enabled.", "AI 2 is a rule-based filter of observed market data, not a source of guaranteed outcomes."],
  ["AI 2 sample threshold", "AI 2 waits for a minimum recent sample and looks for a measurable difference from a simple baseline before sending an entry. If the sample is too small or weak, it waits.", "A larger historical sample can still differ from future results. No win-rate promise is made."],
  ["Differs loss response", "After any AI 2 Differs trade settles at a loss, recovery selection switches to Rise/Fall or Even/Odd. It remains in recovery until settled session P/L rises above the P/L level from just before that loss, which means the loss has been made back and additional profit gained.", "Recovery does not guarantee a profit. If no qualifying recovery setup is available, AI 2 waits without placing an order."],
  ["One open contract at a time", "The loop waits for Deriv history to show the active contract as settled before considering another entry. Other open contracts also block new entries.", "If settlement cannot be verified, the loop pauses instead of guessing or sending another order."],
  ["Reading Auto Trader 2.0 History", "History uses the same session summary and trade-row design as Cash Grab. It only includes contracts this feature recorded for the currently selected account.", "The history list is a dashboard view. Deriv remains the authoritative account record."],
  ["Clear this feature's history", "The two-step clear removes only Auto Trader 2.0 rows from this browser's account-scoped view. It does not delete Deriv contracts or account records.", "Clearing the view does not close or cancel a contract."],
  ["When Deriv declines a setup", "Deriv can decline a setup when it has no available return or when the account, market, or contract is unavailable. Auto Trader 2.0 stops after an order rejection and does not automatically retry it.", "If the result of an order request is uncertain, verify the contract in Deriv history before any manual action."],
] as const;

type LocalContract = { id: string; placedAt: number };
type RunConfig = {
  family: AutoTrader2Family;
  contractType: AutoTrader2ContractType;
  barrier: number;
  stake: number;
  duration: number;
  takeProfit: number;
  lossLimit: number;
  stakeMode: "flat" | "multiply";
  multiplier: number;
  aiEnabled: boolean;
  autoSelect: boolean;
  selectedMarket: string;
};

type Runtime = {
  generation: number;
  active: boolean;
  stopRequested: boolean;
  contractIds: string[];
  currentStake: number;
  sessionPnl: number;
  recovery: boolean;
  recoveryTargetPnl: number | null;
  lastCandidate: AutoTrader2Candidate | null;
};

const storagePrefix = "deriv-auto-trader-2-contracts:";
const minimumStake = 0.35;
const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const isSettled = (status: string) => !["open", "pending", "active"].includes(status.toLowerCase());

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
  const hasAccess = access.data?.is_admin === true || access.data?.features.includes("auto-trader") === true;
  const token = useGetDerivTokenStatus({ query: { queryKey: getGetDerivTokenStatusQueryKey(), retry: false, enabled: hasAccess } });
  const hasToken = token.data?.has_token === true;
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);
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
  const [historyFading, setHistoryFading] = useState(false);
  const [sessionPnl, setSessionPnl] = useState(0);
  const [sessionTradeCount, setSessionTradeCount] = useState(0);
  const clearTimer = useRef<number | null>(null);
  const runRef = useRef<Runtime>({
    generation: 0,
    active: false,
    stopRequested: false,
    contractIds: [],
    currentStake: 1,
    sessionPnl: 0,
    recovery: false,
    recoveryTargetPnl: null,
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
    query: { queryKey: getGetDerivHistoryQueryKey(), enabled: hasAccess && hasToken, retry: false, refetchInterval: hasAccess && hasToken ? 2_000 : false },
  });
  const statusRef = useRef(status);
  statusRef.current = status;
  const historyRef = useRef(history);
  historyRef.current = history;

  const account = status.data?.account ?? null;
  const accountId = account?.id ?? "";
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
  const aiStatus = !aiEnabled ? "off" : running ? (decision.toLowerCase().includes("waiting") ? "waiting" : "working") : "working";
  localContractsRef.current = localContracts;

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
    if (clearTimer.current !== null) {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    if (!accountId) {
      setLocalContracts([]);
      return;
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(`${storagePrefix}${accountId}`) ?? "[]") as LocalContract[];
      setLocalContracts(Array.isArray(parsed)
        ? parsed.filter((entry) => typeof entry?.id === "string" && Number.isFinite(entry.placedAt)).slice(-500)
        : []);
    } catch {
      setLocalContracts([]);
    }
  }, [accountId]);

  useEffect(() => () => {
    runRef.current.active = false;
    runRef.current.stopRequested = true;
    runRef.current.generation += 1;
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
  }, []);

  useEffect(() => {
    setSessionTradeCount(runContractIds.length);
    setSessionPnl(Number(runRows.filter((entry) => isSettled(entry.status))
      .reduce((total, entry) => total + Number(entry.profit || 0), 0).toFixed(2)));
  }, [runContractIds, runRows]);

  const persistContract = (contractId: string) => {
    if (!accountId) return;
    const next = [...localContractsRef.current.filter((entry) => entry.id !== contractId), { id: contractId, placedAt: Date.now() }].slice(-500);
    localContractsRef.current = next;
    setLocalContracts(next);
    try {
      localStorage.setItem(`${storagePrefix}${accountId}`, JSON.stringify(next));
    } catch {
      setMessage({ tone: "info", text: "Deriv accepted the contract, but this browser could not save its local history link. Check Deriv history." });
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

  const chooseCandidate = (config: RunConfig, recovery: boolean) => chooseAutoTrader2Candidate({
    signals: signalsRef.current,
    family: recovery ? "recovery" : config.family,
    preferredType: config.contractType,
    barrier: config.barrier,
    selectedMarket: config.selectedMarket,
    autoSelect: config.autoSelect,
  });

  const finishLoop = (generation: number, finalMessage?: { tone: "error" | "success" | "info"; text: string }) => {
    if (runRef.current.generation !== generation) return;
    runRef.current.active = false;
    runRef.current.stopRequested = true;
    setRunning(false);
    setStopping(false);
    setIsPlacing(false);
    if (finalMessage) setMessage(finalMessage);
  };

  const start = async () => {
    if (runRef.current.active || !connected || !accountId || tradeSlotBlocked) return;
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
      currentStake: config.stake,
      sessionPnl: 0,
      recovery: false,
      recoveryTargetPnl: null,
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
      for (let attempt = 0; attempt < 10 && runRef.current.active && runRef.current.generation === generation; attempt += 1) {
        try {
          const refreshedStatus = await statusRef.current.refetch();
          if (refreshedStatus.data?.open_contracts_ready === true && (refreshedStatus.data?.active_contract_count ?? 0) === 0) {
            slotReady = true;
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
        loopCandidate = chooseCandidate(config, inRecovery);
        if (!loopCandidate) {
          setDecision(inRecovery
            ? "Recovery active · AI 2 is waiting for a qualifying Rise/Fall or Even/Odd sample; no new order sent."
            : "Waiting for a fresh sample that meets the entry filter.");
          await delay(1_000);
          continue;
        }
      }

      const candidate = loopCandidate;
      const selectedType = candidate?.contractType ?? config.contractType;
      const symbol = candidate?.symbol ?? config.selectedMarket;
      const selectedBarrier = selectedType === "DIGITDIFF" ? candidate?.barrier ?? config.barrier : undefined;
      const order: DerivBuyInput = {
        amount: Number(runRef.current.currentStake.toFixed(2)),
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
      setIsPlacing(true);
      let contractId = "";
      try {
        const result = await buyRef.current.mutateAsync({ data: order });
        contractId = String(result.buy?.contract_id ?? "");
        if (!contractId) {
          finishLoop(generation, {
            tone: "error",
            text: "Deriv returned an order response without a contract ID. New entries are paused; verify Deriv history before taking any further action.",
          });
          return;
        }
        runRef.current.contractIds = [...runRef.current.contractIds, contractId];
        setRunContractIds([...runRef.current.contractIds]);
        persistContract(contractId);
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetDerivStatusQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetDerivHistoryQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetDerivAccountsQueryKey() }),
        ]).catch((error: unknown) => console.warn("Could not refresh Auto Trader 2.0 data after an accepted order.", error));
      } catch (error) {
        const uncertain = error instanceof ApiTransportError && error.tradeOutcomeUncertain;
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

      if (!contractId || !runRef.current.active || runRef.current.generation !== generation) return;
      let settledRow: DerivHistoryItem | null = null;
      for (let check = 0; check < 90 && runRef.current.active && runRef.current.generation === generation; check += 1) {
        try {
          const refreshed = await historyRef.current.refetch();
          const row = (refreshed.data as DerivHistoryItem[] | undefined)?.find((entry) =>
            entry.account_id === accountId && entry.contract_id === contractId,
          );
          if (row && isSettled(row.status)) {
            settledRow = row;
            break;
          }
        } catch {
          finishLoop(generation, {
            tone: "error",
            text: "Deriv history could not verify settlement. Auto Trader 2.0 paused without sending another order; check the account history before restarting.",
          });
          setDecision("Paused · Deriv settlement could not be verified.");
          return;
        }
        await delay(1_500);
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
      runRef.current.recovery = recovery.active;
      runRef.current.recoveryTargetPnl = recovery.targetPnl;

      const hitTakeProfit = config.takeProfit > 0 && runRef.current.sessionPnl >= config.takeProfit;
      const hitLossLimit = config.lossLimit > 0 && runRef.current.sessionPnl <= -config.lossLimit;
      if (hitTakeProfit || hitLossLimit) {
        const resultLabel = hitTakeProfit ? "Take-profit limit reached" : "Loss limit reached";
        finishLoop(generation, { tone: "info", text: `${resultLabel}. No further entry was sent.` });
        setDecision(`${resultLabel} · automation stopped.`);
        return;
      }

      if (settledProfit < 0 && config.stakeMode === "multiply") {
        runRef.current.currentStake = Number((runRef.current.currentStake * config.multiplier).toFixed(2));
      } else {
        runRef.current.currentStake = config.stake;
      }
      setNextStake(runRef.current.currentStake);

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
      setDecision(runRef.current.recovery
        ? `WORKING · recovery selection stays active until session P/L is above ${amountLabel(runRef.current.recoveryTargetPnl ?? 0, currency)}.`
        : "WORKING · waiting for the next eligible live sample.");
      await delay(300);
    }
  };

  const stop = () => {
    if (!runRef.current.active) return;
    setStopping(true);
    runRef.current.stopRequested = true;
    runRef.current.active = false;
    setRunning(false);
    setStopping(false);
    setIsPlacing(false);
    setDecision("Stopped · any open contract remains with Deriv and may still settle.");
    setMessage({ tone: "info", text: "Auto Trader 2.0 stopped. Any accepted open contract remains active at Deriv and may still settle." });
  };

  const clearHistory = () => {
    if (!accountId || running) return;
    if (!clearArmed) {
      setClearArmed(true);
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
    setHistoryFading(true);
    window.setTimeout(() => setHistoryFading(false), 320);
    setLocalContracts([]);
    setRunContractIds([]);
    try {
      localStorage.removeItem(`${storagePrefix}${accountId}`);
      setMessage({ tone: "success", text: "Auto Trader 2.0 history was cleared from this account-scoped view. Deriv account history is unchanged." });
    } catch {
      setMessage({ tone: "error", text: "History was cleared from this view, but this browser could not save the change." });
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
    return <AppShell title="AUTO TRADER 2.0"><main className="auto-trader-2-page"><div className="at2-page-notice error" role="status"><ShieldAlert size={16} />Auto Trader access is required for this feature.</div></main></AppShell>;
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
          <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message">×</button>
        </div>}
        <section className="at2-account-strip" aria-label="Selected Deriv account">
          <span className={account?.type === "real" ? "real" : ""}>{account?.type ? `${account.type.toUpperCase()} ACCOUNT` : "NO ACCOUNT"}</span>
          <strong>{account?.id ?? "Select an account"}</strong>
          <b>{account && getAccountBalance(account) != null ? amountLabel(getAccountBalance(account)!, currency) : "—"}</b>
          <i className={connected ? "connected" : ""}>{connected ? "CONNECTED" : "OFFLINE"}</i>
        </section>

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
          tradeSlotBlocked={tradeSlotBlocked}
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
