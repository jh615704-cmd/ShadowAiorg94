import {
  updateAutoTrader2Recovery,
  type AutoTrader2ContractType,
  type AutoTrader2Family,
} from "./auto-trader-2-strategy.ts";

export type AutoTrader2RunConfig = {
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

export type AutoTrader2SavedPhase =
  | "ready"
  | "placing"
  | "awaiting-settlement"
  | "manual-review"
  | "completed";

export type AutoTrader2SavedSession = {
  version: 1;
  accountId: string;
  phase: AutoTrader2SavedPhase;
  config: AutoTrader2RunConfig;
  contractIds: string[];
  sessionPnl: number;
  currentStake: number;
  recoveryTargetPnl: number | null;
  pendingContractId: string | null;
  pendingContractType: AutoTrader2ContractType | null;
  pendingStake: number | null;
  updatedAt: number;
};

export type AutoTrader2HistoryRow = {
  account_id: string;
  contract_id: string;
  profit: number;
  status: string;
};

export type AutoTrader2OpenContractCheck = {
  accountId: string | null;
  ready: boolean;
  activeCount: number;
};

export type AutoTrader2ResumeAssessment =
  | { kind: "ready"; session: AutoTrader2SavedSession }
  | { kind: "waiting"; session: AutoTrader2SavedSession; reason: string }
  | { kind: "uncertain"; session: AutoTrader2SavedSession; reason: string }
  | { kind: "completed"; session: AutoTrader2SavedSession };

const contractTypes: AutoTrader2ContractType[] = ["DIGITDIFF", "CALL", "PUT", "DIGITEVEN", "DIGITODD"];
const families: AutoTrader2Family[] = ["differs", "rise-fall", "even-odd"];
const phases: AutoTrader2SavedPhase[] = ["ready", "placing", "awaiting-settlement", "manual-review", "completed"];
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isSettled = (status: string) => !["open", "pending", "active"].includes(status.toLowerCase());
const cents = (value: number) => Number(value.toFixed(2));

function isRunConfig(value: unknown): value is AutoTrader2RunConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Record<string, unknown>;
  return families.includes(config.family as AutoTrader2Family)
    && contractTypes.includes(config.contractType as AutoTrader2ContractType)
    && isFiniteNumber(config.barrier)
    && isFiniteNumber(config.stake)
    && isFiniteNumber(config.duration)
    && isFiniteNumber(config.takeProfit)
    && isFiniteNumber(config.lossLimit)
    && (config.stakeMode === "flat" || config.stakeMode === "multiply")
    && isFiniteNumber(config.multiplier)
    && typeof config.aiEnabled === "boolean"
    && typeof config.autoSelect === "boolean"
    && typeof config.selectedMarket === "string";
}

export function parseAutoTrader2SavedSession(
  serialized: string | null,
  expectedAccountId: string,
): AutoTrader2SavedSession | null {
  if (!serialized || !expectedAccountId) return null;
  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (
      value.version !== 1
      || value.accountId !== expectedAccountId
      || !phases.includes(value.phase as AutoTrader2SavedPhase)
      || !isRunConfig(value.config)
      || !Array.isArray(value.contractIds)
      || !value.contractIds.every((id) => typeof id === "string" && id.length > 0)
      || new Set(value.contractIds).size !== value.contractIds.length
      || !isFiniteNumber(value.sessionPnl)
      || !isFiniteNumber(value.currentStake)
      || !(value.recoveryTargetPnl === null || isFiniteNumber(value.recoveryTargetPnl))
      || !(value.pendingContractId === null || typeof value.pendingContractId === "string")
      || !(value.pendingContractType === null || contractTypes.includes(value.pendingContractType as AutoTrader2ContractType))
      || !(value.pendingStake === null || isFiniteNumber(value.pendingStake))
      || !isFiniteNumber(value.updatedAt)
    ) {
      return null;
    }
    return value as AutoTrader2SavedSession;
  } catch {
    return null;
  }
}

export function reconcileAutoTrader2SavedSession(input: {
  session: AutoTrader2SavedSession;
  history: readonly AutoTrader2HistoryRow[];
  openContracts: AutoTrader2OpenContractCheck;
}): AutoTrader2ResumeAssessment {
  const { session, history, openContracts } = input;
  if (session.phase === "completed") return { kind: "completed", session };
  if (session.phase === "placing" || session.phase === "manual-review") {
    return {
      kind: "uncertain",
      session,
      reason: "The last order may have been submitted before the page reloaded. Check Deriv history and open contracts; this session will not resend it.",
    };
  }
  if (openContracts.accountId !== session.accountId) {
    return {
      kind: "uncertain",
      session,
      reason: "The selected Deriv account does not match the saved session. Switch back to the original account before resuming.",
    };
  }
  if (!openContracts.ready) {
    return {
      kind: "waiting",
      session,
      reason: "Deriv has not confirmed the open-contract check yet. No order will be sent.",
    };
  }
  if (openContracts.activeCount > 0) {
    return {
      kind: "waiting",
      session,
      reason: "Deriv still reports an open contract. Wait for it to settle before resuming.",
    };
  }

  const accountRows = history.filter((row) => row.account_id === session.accountId);
  const rowsById = new Map(accountRows.map((row) => [row.contract_id, row]));
  if (session.phase === "awaiting-settlement") {
    if (
      !session.pendingContractId
      || !session.pendingContractType
      || !isFiniteNumber(session.pendingStake)
      || !session.contractIds.includes(session.pendingContractId)
    ) {
      return {
        kind: "uncertain",
        session,
        reason: "The saved order details are incomplete. Check Deriv history before starting a new session.",
      };
    }
    const row = rowsById.get(session.pendingContractId);
    if (!row) {
      return {
        kind: "uncertain",
        session,
        reason: "The last contract was not found in this account's Deriv history. Check history manually; it will not be resubmitted.",
      };
    }
    if (!isSettled(row.status)) {
      return {
        kind: "waiting",
        session,
        reason: "The last contract is not settled yet. No new order will be sent.",
      };
    }
    if (!isFiniteNumber(row.profit)) {
      return {
        kind: "uncertain",
        session,
        reason: "Deriv history has no valid settled profit for the last contract. Check it manually before resuming.",
      };
    }

    const sessionPnl = cents(session.sessionPnl + row.profit);
    const historyPnl = cents(session.contractIds.reduce((total, id) => {
      const entry = rowsById.get(id);
      return total + (entry && isSettled(entry.status) && isFiniteNumber(entry.profit) ? entry.profit : 0);
    }, 0));
    if (session.contractIds.some((id) => !rowsById.has(id)) || Math.abs(historyPnl - sessionPnl) > 0.01) {
      return {
        kind: "uncertain",
        session,
        reason: "The saved session total does not match the settled contracts in Deriv history. Review the account history before resuming.",
      };
    }

    const recovery = updateAutoTrader2Recovery({
      state: {
        active: session.recoveryTargetPnl !== null,
        targetPnl: session.recoveryTargetPnl,
      },
      contractType: session.pendingContractType,
      settledProfit: row.profit,
      pnlBefore: session.sessionPnl,
      pnlAfter: sessionPnl,
      aiEnabled: session.config.aiEnabled,
    });
    const currentStake = row.profit < 0 && session.config.stakeMode === "multiply"
      ? cents(session.pendingStake * session.config.multiplier)
      : session.config.stake;
    const updatedSession: AutoTrader2SavedSession = {
      ...session,
      phase: "ready",
      sessionPnl,
      currentStake,
      recoveryTargetPnl: recovery.targetPnl,
      pendingContractId: null,
      pendingContractType: null,
      pendingStake: null,
    };

    if (
      (updatedSession.config.takeProfit > 0 && sessionPnl >= updatedSession.config.takeProfit)
      || (updatedSession.config.lossLimit > 0 && sessionPnl <= -updatedSession.config.lossLimit)
    ) {
      return { kind: "completed", session: { ...updatedSession, phase: "completed" } };
    }
    return { kind: "ready", session: updatedSession };
  }

  if (session.contractIds.some((id) => {
    const row = rowsById.get(id);
    return !row || !isSettled(row.status) || !isFiniteNumber(row.profit);
  })) {
    return {
      kind: "uncertain",
      session,
      reason: "One or more saved contracts could not be verified as settled in Deriv history. Review them before resuming.",
    };
  }

  const historyPnl = cents(session.contractIds.reduce((total, id) => total + rowsById.get(id)!.profit, 0));
  if (Math.abs(historyPnl - session.sessionPnl) > 0.01) {
    return {
      kind: "uncertain",
      session,
      reason: "The saved session total does not match Deriv history. Review the account history before resuming.",
    };
  }
  return {
    kind: "ready",
    session: { ...session, sessionPnl: historyPnl },
  };
}
