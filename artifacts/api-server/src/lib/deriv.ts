import WebSocket from "ws";
import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "./logger";
import { assertTradingProtection, getTradingProtectionSettings } from "./trading-protection";

const API_BASE = "https://api.derivws.com";
const appId = process.env.DERIV_APP_ID;
const defaultSymbol = process.env.DERIV_SYMBOL ?? "R_75";
const defaultCurrency = process.env.DERIV_CURRENCY ?? "USD";
const configuredAccountId = process.env.DERIV_ACCOUNT_ID;
const liveTradingEnabled = process.env.DERIV_ALLOW_LIVE_TRADING === "true";
const proposalTimeoutMs = 8_000;
const proposalAttempts = 3;
const buyAckTimeoutMs = 12_000;
const settlementFallbackIntervalMs = 10_000;
const minimumProfitTableRefreshIntervalMs = 5_000;
const profitTableRateLimitBackoffMs = 10_000;
const maxBulkCount = 6;
const supportedSymbols = new Set([
  "R_10", "R_25", "R_50", "R_75", "R_100", "R_150", "R_250",
  "1HZ10V", "1HZ15V", "1HZ25V", "1HZ30V", "1HZ50V", "1HZ75V", "1HZ90V", "1HZ100V",
  "JD10", "JD25", "JD50", "JD75", "JD100",
]);
type DigitContractType = "DIGITEVEN" | "DIGITODD" | "DIGITOVER" | "DIGITUNDER" | "DIGITDIFF" | "DIGITMATCH" | "CALL" | "PUT" | "HIGHER" | "LOWER" | "ACCU";

export type DerivAccount = {
  id: string;
  type: "demo" | "real";
  currency: string;
  balance: number;
  status: string;
};

export type DerivTick = {
  symbol: string;
  quote: number;
  epoch: number;
};

export type DerivProposal = {
  id: string;
  ask_price: number;
  payout: number;
  spot: number;
  longcode: string | null;
  spot_time?: number;
  contract_details?: {
    tick_size_barrier?: number;
  };
};

export type DerivBuy = {
  contract_id: string;
  buy_price: number;
  payout: number;
  start_time: number | null;
};

export type DerivContract = {
  contract_id: string;
  status: string;
  is_sold: boolean;
  profit: number;
  buy_price: number;
  payout: number;
  sell_price: number;
  entry_spot: number;
  current_spot: number;
  expiry_time: number | null;
};

export type DerivHistoryItem = {
  contract_id: string;
  account_id: string;
  account_type: "demo" | "real";
  currency: string;
  contract_type: string;
  barrier: number | null;
  symbol: string;
  duration: number | null;
  duration_unit: string | null;
  growth_rate: number | null;
  tick_passed: number | null;
  buy_price: number;
  current_value: number;
  payout: number;
  profit: number;
  status: string;
  buy_time: number | null;
  sell_time: number | null;
};

export type DerivStatus = {
  connected: boolean;
  authorized: boolean;
  open_contracts_ready: boolean;
  active_contract_count: number;
  account: DerivAccount | null;
  last_tick: DerivTick | null;
  last_proposal: DerivProposal | null;
  last_buy: DerivBuy | null;
  last_contract: DerivContract | null;
  bot_running: boolean;
  symbol: string;
  currency: string;
  max_trade_amount: number;
  live_trading_enabled: boolean;
  digit_even_percentage: number;
  digit_odd_percentage: number;
  digit_sample_count: number;
  last_digit: number | null;
  digit_history: number[];
  digit_streaks: Array<{ digit: number; over: number; under: number }>;
  market_signals: Array<{
    symbol: string;
    quote: number | null;
    last_digit: number | null;
    tick_sequence: number;
    recent_digits: number[];
    recent_quotes: number[];
    tick_epoch: number;
    sample_count: number;
    digit_even_percentage: number;
    digit_odd_percentage: number;
    rise_percentage: number;
    fall_percentage: number;
    digit_streaks: Array<{ digit: number; over: number; under: number }>;
  }>;
};

export type DerivMarketTickUpdate = {
  symbol: string;
  tick_sequence: number;
  recent_digits: number[];
  tick_epoch: number;
};

type ProposalInput = {
  amount: number;
  duration: number;
  duration_unit: "t" | "s" | "m";
  contract_type: DigitContractType;
  barrier?: number | string;
  growth_rate?: number;
  symbol?: string;
};

type BuyInput = {
  amount: number;
  duration: number;
  duration_unit: "t";
  contract_type: DigitContractType;
  barrier?: number;
  growth_rate?: number;
  symbol?: string;
  /** Legacy Money Bank UI field. It must never gate an otherwise valid buy. */
  auto_knockout?: boolean;
};

export type SellResult = {
  contract_id: string;
  sold_for: number;
};

type DerivResponse = {
  data?: unknown;
  errors?: Array<{ message?: string }>;
  accounts?: unknown;
};

class DerivApiError extends Error {
  readonly code: string;

  constructor(code: unknown, message: string) {
    super(message);
    this.name = "DerivApiError";
    this.code = String(code ?? "");
  }
}

export function isDerivBuyRateLimitError(error: unknown): boolean {
  if (error instanceof DerivApiError) return error.code === "RateLimit";
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return (error as Record<string, unknown>).code === "DERIV_BUY_RATE_LIMITED";
}

export function isDerivApiError(error: unknown): boolean {
  return error instanceof DerivApiError;
}

export type TradeDiagnosticSource = "browser_app" | "api_server" | "deriv" | "transport" | "unknown";

function embeddedTradeFailure(error: unknown): {
  outcome?: "rejected" | "uncertain" | "not_sent";
  source?: TradeDiagnosticSource;
} {
  if (typeof error !== "object" || error === null) return {};
  const record = error as Record<string, unknown>;
  const outcome = record.tradeOutcome;
  const source = record.diagnosticSource;
  return {
    ...(outcome === "rejected" || outcome === "uncertain" || outcome === "not_sent" ? { outcome } : {}),
    ...(source === "browser_app" || source === "api_server" || source === "deriv" || source === "transport" || source === "unknown"
      ? { source }
      : {}),
  };
}

export function getTradeErrorSource(error: unknown): TradeDiagnosticSource {
  const embeddedSource = embeddedTradeFailure(error).source;
  if (embeddedSource) return embeddedSource;
  if (isDerivApiError(error) || isDerivBuyRateLimitError(error)) return "deriv";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("did not confirm") || message.includes("acknowledgement")) return "unknown";
  if (message.includes("websocket is not ready")) return "transport";
  return "unknown";
}

export class DerivCredentialError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DerivCredentialError";
    this.status = status;
  }
}

export const MAX_DERIV_USER_SESSIONS_PER_PROCESS = 4;

export class DerivCapacityError extends Error {
  readonly status = 503;

  constructor() {
    super(
      `This API instance is at its Deriv session limit (${MAX_DERIV_USER_SESSIONS_PER_PROCESS}). Try again later.`,
    );
    this.name = "DerivCapacityError";
  }
}

function createState() {
return {
  socket: null as WebSocket | null,
  connecting: null as Promise<boolean> | null,
  reconnectTimer: null as NodeJS.Timeout | null,
  portfolioRetryTimer: null as NodeJS.Timeout | null,
  portfolioRetryAttempt: 0,
  settlementFallbackTimer: null as NodeJS.Timeout | null,
  settlementFallbackContractIds: new Set<string>(),
  balanceRefreshAt: 0,
  balanceRefreshPromise: null as Promise<void> | null,
  account: null as DerivAccount | null,
  accounts: [] as DerivAccount[],
  lastTick: null as DerivTick | null,
  lastProposal: null as DerivProposal | null,
  proposalIds: new Set<string>(),
  lastBuy: null as DerivBuy | null,
  pendingBuyInputs: new Map<string, ProposalInput>(),
  buyWaiters: new Map<string, {
    resolve: (buy: DerivBuy) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>(),
  sellSequence: 0,
  sellWaiters: new Map<number, {
    resolve: (result: SellResult) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>(),
  lastContract: null as DerivContract | null,
  openContractsReady: false,
  history: [] as DerivHistoryItem[],
  historyListeners: new Set<(item: DerivHistoryItem) => void>(),
  marketTickListeners: new Set<(tick: DerivMarketTickUpdate) => void>(),
  profitTableReady: false,
  profitTableRefreshAt: 0,
  profitTableRetryAfter: 0,
  profitTableRefreshPromise: null as Promise<void> | null,
  activeContracts: new Map<string, DerivHistoryItem>(),
  verifiedPortfolioIds: new Set<string>(),
  lastProposalContractType: "",
  lastProposalSymbol: defaultSymbol,
  lastProposalInput: null as ProposalInput | null,
  lastProposalRefreshAt: 0,
  proposalSequence: 0,
  buySequence: 0,
  proposalWaiters: new Map<number, { resolve: (proposal: DerivProposal) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>(),
  portfolioSequence: 0,
  portfolioWaiters: new Map<number, {
    resolve: (contractIds: string[]) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>(),
  profitTableSequence: 0,
  profitTableWaiters: new Map<number, {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>(),
  contractInputs: new Map<string, ProposalInput>(),
  digitEvenCount: 0,
  digitOddCount: 0,
  digitHistory: [] as number[],
  marketHistory: new Map<string, {
    quote: number | null;
    epoch: number;
    tickSequence: number;
    digitHistory: number[];
    movementHistory: Array<"rise" | "fall" | "flat">;
    quoteHistory: Array<{ quote: number; epoch: number; sequence?: number }>;
  }>(),
  selectedSymbol: defaultSymbol,
  hiddenHistoryIds: new Set<string>(),
  selectedAccountId: configuredAccountId ?? null as string | null,
  botRunning: false,
  shuttingDown: false,
  pat: null as string | null,
  lastAccessAt: Date.now(),
  generation: 0,
};
}

const runtimes = new Map<string, ReturnType<typeof createState>>();
const operationTails = new Map<string, Promise<void>>();
const userContext = new AsyncLocalStorage<string>();
let generationSequence = 0;
const runtimeIdleTimeoutMs = 30 * 60 * 1000;

function assertRuntimeCapacity(userId: string) {
  if (!runtimes.has(userId) && runtimes.size >= MAX_DERIV_USER_SESSIONS_PER_PROCESS) {
    throw new DerivCapacityError();
  }
}

const runtimeReaper = setInterval(() => {
  const cutoff = Date.now() - runtimeIdleTimeoutMs;
  for (const [userId, runtime] of runtimes) {
    if (runtime.lastAccessAt < cutoff) {
      void withUserSerialized(userId, async () => {
        if (runtimes.get(userId) === runtime && runtime.lastAccessAt < cutoff) {
          disposeUser(userId);
        }
      });
    }
  }
}, 5 * 60 * 1000);
runtimeReaper.unref();

function getState(): any {
  const activeUser = userContext.getStore();
  if (!activeUser) throw new Error("Authenticated Deriv user is required");
  let runtime = runtimes.get(activeUser);
  if (!runtime) {
    assertRuntimeCapacity(activeUser);
    runtime = createState();
    runtime.generation = ++generationSequence;
    runtimes.set(activeUser, runtime);
  }
  return runtime;
}

export async function withUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const runtime = runtimes.get(userId);
  if (runtime) runtime.lastAccessAt = Date.now();
  return userContext.run(userId, fn);
}

export async function withUserSerialized<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = operationTails.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => turn);
  operationTails.set(userId, tail);
  await previous;
  try {
    return await userContext.run(userId, fn);
  } finally {
    release();
    if (operationTails.get(userId) === tail) operationTails.delete(userId);
  }
}

export function setUserPat(userId: string, pat: string) {
  const current = runtimes.get(userId);
  if (current && current.pat === pat && !current.shuttingDown) {
    current.lastAccessAt = Date.now();
    return;
  }
  if (current) disposeUser(userId);
  assertRuntimeCapacity(userId);
  const runtime = createState();
  runtime.pat = pat;
  runtime.shuttingDown = false;
  runtime.lastAccessAt = Date.now();
  runtime.generation = ++generationSequence;
  runtimes.set(userId, runtime);
}

export function disposeUser(userId: string) {
  const runtime = runtimes.get(userId);
  if (!runtime) return;
  runtime.shuttingDown = true;
  runtime.historyListeners.clear();
  runtime.marketTickListeners.clear();
  for (const waiter of runtime.proposalWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("Deriv runtime disposed"));
  }
  runtime.proposalWaiters.clear();
  for (const waiter of runtime.portfolioWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("Deriv runtime disposed"));
  }
  runtime.portfolioWaiters.clear();
  for (const waiter of runtime.profitTableWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("Deriv runtime disposed"));
  }
  runtime.profitTableWaiters.clear();
  for (const waiter of runtime.buyWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("Deriv runtime disposed"));
  }
  runtime.buyWaiters.clear();
  for (const waiter of runtime.sellWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("Deriv runtime disposed"));
  }
  runtime.sellWaiters.clear();
  if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
  if (runtime.portfolioRetryTimer) clearTimeout(runtime.portfolioRetryTimer);
  if (runtime.settlementFallbackTimer) clearTimeout(runtime.settlementFallbackTimer);
  runtime.socket?.close();
  runtimes.delete(userId);
}

function rejectProposalWaiters(message: string) {
  for (const waiter of getState().proposalWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message));
  }
  getState().proposalWaiters.clear();
}

function rejectPortfolioWaiters(message: string) {
  for (const waiter of getState().portfolioWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message));
  }
  getState().portfolioWaiters.clear();
}

function rejectProfitTableWaiters(message: string) {
  for (const waiter of getState().profitTableWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message));
  }
  getState().profitTableWaiters.clear();
}

function rejectBuyWaiters(message: string) {
  for (const waiter of getState().buyWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message));
  }
  getState().buyWaiters.clear();
  getState().pendingBuyInputs.clear();
}

function rejectSellWaiters(message: string) {
  for (const waiter of getState().sellWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message));
  }
  getState().sellWaiters.clear();
}

function getActiveContractCount() {
  const runtime = getState();
  const activeAccountId = runtime.account?.id ?? runtime.selectedAccountId;
  const activeContractIds = new Set(
    [...runtime.activeContracts.values()]
      .filter((item: DerivHistoryItem) => item.account_id === activeAccountId && isOpenContractStatus(item.status))
      .map((item: DerivHistoryItem) => item.contract_id),
  );
  if (
    runtime.lastContract?.contract_id
    && !runtime.lastContract.is_sold
    && isOpenContractStatus(runtime.lastContract.status)
  ) {
    activeContractIds.add(runtime.lastContract.contract_id);
  }
  return activeContractIds.size + runtime.pendingBuyInputs.size;
}

function hasActiveContract() {
  return getActiveContractCount() > 0;
}

function assertNoActiveContract(useFreshPortfolio = false) {
  const runtime = getState();
  if (!runtime.openContractsReady) {
    throw new Error("Account status is being refreshed.");
  }
  if (useFreshPortfolio) {
    if (runtime.verifiedPortfolioIds.size || runtime.pendingBuyInputs.size) {
      throw new Error("Deriv still reports an open contract for this account. Wait for it to settle before sending another trade.");
    }
    return;
  }
  if (hasActiveContract()) {
    throw new Error("The previous contract is still settling. Wait for it to finish before sending another trade.");
  }
}

function assertConfigured() {
  if (!appId || !getState().pat) {
    throw new Error("Deriv credentials are not configured");
  }
}

function normalizeAccount(raw: unknown): DerivAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = record.account_id ?? record.accountId ?? record.loginid ?? record.id;
  if (typeof id !== "string" || !id) return null;

  const type =
    record.account_type === "demo" ||
    record.type === "demo" ||
    id.startsWith("DOT")
      ? "demo"
      : "real";

  return {
    id,
    type,
    currency: typeof record.currency === "string" ? record.currency : defaultCurrency,
    balance: Number(record.balance ?? 0),
    status: typeof record.status === "string" ? record.status : "unknown",
  };
}

function extractAccounts(body: DerivResponse): DerivAccount[] {
  const data = body.data;
  const candidates = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { accounts?: unknown }).accounts)
      ? (data as { accounts: unknown[] }).accounts
      : Array.isArray(body.accounts)
        ? body.accounts
        : data
          ? [data]
          : [];

  return candidates.map(normalizeAccount).filter((account): account is DerivAccount => Boolean(account));
}

function historyKey(item: Pick<DerivHistoryItem, "account_id" | "contract_id">) {
  return JSON.stringify([item.account_id, item.contract_id]);
}

function isDerivFlagSet(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function numericDerivContractId(contractId: string): number | null {
  if (!/^\d+$/.test(contractId)) return null;
  const numericId = Number(contractId);
  return Number.isSafeInteger(numericId) ? numericId : null;
}

function requestOpenContractUpdate(contractId: string, subscribe = false) {
  const numericId = numericDerivContractId(contractId);
  if (numericId == null) {
    logger.warn({ contractId }, "Skipping Deriv open-contract request with an invalid contract ID");
    return false;
  }
  return send({
    proposal_open_contract: 1,
    contract_id: numericId,
    ...(subscribe ? { subscribe: 1 } : {}),
  });
}

function isOpenContractStatus(status: string) {
  return ["open", "pending", "active"].includes(status.trim().toLowerCase());
}

function upsertHistory(item: DerivHistoryItem) {
  const key = historyKey(item);
  const existing = getState().history.find((entry: DerivHistoryItem) =>
    entry.account_id === item.account_id && entry.contract_id === item.contract_id,
  );
  const wasOpen = getState().activeContracts.has(key)
    || Boolean(existing && isOpenContractStatus(existing.status))
    || getState().verifiedPortfolioIds.has(item.contract_id);
  const wasFallbackCheck = !isOpenContractStatus(item.status)
    && getState().settlementFallbackContractIds.has(item.contract_id);
  if (!isOpenContractStatus(item.status)) {
    getState().settlementFallbackContractIds.delete(item.contract_id);
    if (wasOpen) {
      logger.info({
        accountId: item.account_id,
        contractId: item.contract_id,
        status: item.status,
        profit: item.profit,
      }, wasFallbackCheck
        ? "Fallback check confirmed Deriv contract settlement and cleared the active trade lock"
        : "Deriv contract settled and the active trade lock was cleared");
    }
    getState().verifiedPortfolioIds.delete(item.contract_id);
    if (getState().lastContract?.contract_id === item.contract_id) {
      getState().lastContract = {
        ...getState().lastContract,
        status: item.status,
        is_sold: true,
        profit: item.profit,
        buy_price: item.buy_price,
        payout: item.payout,
        sell_price: item.current_value,
      };
    }
  } else {
    getState().settlementFallbackContractIds.delete(item.contract_id);
    if (existing && !isOpenContractStatus(existing.status)) {
      // A delayed subscription event must not reopen a contract already
      // confirmed closed by Deriv history or a settlement response.
      return;
    }
  }
  if (isOpenContractStatus(item.status)) getState().activeContracts.set(key, item);
  else getState().activeContracts.delete(key);
  if (getState().hiddenHistoryIds.has(key)) return;
  const existingIndex = getState().history.findIndex((entry: DerivHistoryItem) =>
    entry.account_id === item.account_id && entry.contract_id === item.contract_id,
  );
  if (existingIndex >= 0) {
    const existing = getState().history[existingIndex];
    getState().history[existingIndex] = {
      ...existing,
      ...item,
      growth_rate: item.growth_rate ?? existing.growth_rate,
      tick_passed: item.tick_passed == null
        ? existing.tick_passed
        : Math.max(existing.tick_passed ?? 0, item.tick_passed),
    };
  } else {
    getState().history.push(item);
  }
  getState().history.sort((left: DerivHistoryItem, right: DerivHistoryItem) => (right.buy_time ?? 0) - (left.buy_time ?? 0));
  const accountCounts = new Map<string, number>();
  getState().history = getState().history.filter((entry: DerivHistoryItem) => {
    const count = accountCounts.get(entry.account_id) ?? 0;
    if (count >= 100) return false;
    accountCounts.set(entry.account_id, count + 1);
    return true;
  });
  const updatedItem = getState().history.find((entry: DerivHistoryItem) =>
    entry.account_id === item.account_id && entry.contract_id === item.contract_id,
  );
  if (updatedItem) {
    for (const listener of getState().historyListeners) {
      try {
        listener(updatedItem);
      } catch (error) {
        logger.warn({ err: error, contractId: item.contract_id }, "Deriv trade update listener failed");
      }
    }
  }
}

function digitStreaksFor(history: number[]) {
  return Array.from({ length: 10 }, (_, digit) => {
    let over = 0;
    let under = 0;
    for (let cursor = history.length - 1; cursor >= 0 && history[cursor] > digit; cursor -= 1) over += 1;
    for (let cursor = history.length - 1; cursor >= 0 && history[cursor] < digit; cursor -= 1) under += 1;
    return { digit, over, under };
  });
}

function recordMarketTick(symbol: string, quote: unknown, epoch: number, pipSize: unknown) {
  const runtime = getState();
  // Deriv sends quotes as JSON numbers, so a trailing decimal zero is lost
  // before it reaches this process. Use the pip size reported with the tick
  // instead of guessing a fixed precision: a wrong precision turns every
  // quote into a synthetic trailing zero.
  const reportedPrecision = Number(pipSize);
  const precision = Number.isInteger(reportedPrecision) && reportedPrecision >= 0 && reportedPrecision <= 8
    ? reportedPrecision
    : null;
  const rawQuote = typeof quote === "string"
    ? quote
    : Number.isFinite(Number(quote))
      ? precision == null ? String(quote) : Number(quote).toFixed(precision)
      : "";
  const digits = rawQuote.replace(/\D/g, "");
  const lastDigit = digits.at(-1);
  const market = runtime.marketHistory.get(symbol) ?? { quote: null, epoch: 0, tickSequence: 0, digitHistory: [], movementHistory: [], quoteHistory: [] };
  const nextSequence = market.tickSequence + 1;
  const nextQuote = Number(quote ?? 0);
  if (market.quote != null && Number.isFinite(market.quote) && Number.isFinite(nextQuote)) {
    market.movementHistory.push(nextQuote > market.quote ? "rise" : nextQuote < market.quote ? "fall" : "flat");
    market.movementHistory = market.movementHistory.slice(-1000);
  }
  market.quote = nextQuote;
  market.epoch = epoch;
  if (Number.isFinite(nextQuote) && nextQuote > 0) {
    market.quoteHistory.push({ quote: nextQuote, epoch, sequence: nextSequence });
    market.quoteHistory = market.quoteHistory.slice(-200);
  }
  market.tickSequence = nextSequence;
  if (lastDigit !== undefined) market.digitHistory.push(Number(lastDigit));
  market.digitHistory = market.digitHistory.slice(-1000);
  runtime.marketHistory.set(symbol, market);
  const tickUpdate: DerivMarketTickUpdate = {
    symbol,
    tick_sequence: market.tickSequence,
    recent_digits: market.digitHistory.slice(-100),
    tick_epoch: epoch,
  };
  for (const listener of runtime.marketTickListeners) {
    try {
      listener(tickUpdate);
    } catch (error) {
      logger.warn({ err: error, symbol }, "Deriv market tick listener failed");
    }
  }
  if (symbol === runtime.selectedSymbol) {
    runtime.lastTick = { symbol, quote: market.quote, epoch };
    runtime.digitHistory = [...market.digitHistory];
    runtime.digitEvenCount = runtime.digitHistory.filter((digit: number) => digit % 2 === 0).length;
    runtime.digitOddCount = runtime.digitHistory.length - runtime.digitEvenCount;
  }
}

function getDigitStreaks() {
  return digitStreaksFor(getState().digitHistory as number[]);
}

function getMarketSignals() {
  return Array.from(supportedSymbols, (symbol) => {
    const market = getState().marketHistory.get(symbol);
    const digits = (market?.digitHistory ?? []).slice(-100);
    const evenCount = digits.filter((digit: number) => digit % 2 === 0).length;
    const sampleCount = digits.length;
    const movementHistory = (market?.movementHistory ?? []).slice(-100);
    const riseCount = movementHistory.filter((movement: "rise" | "fall" | "flat") => movement === "rise").length;
    const movementSampleCount = movementHistory.length;
    return {
      symbol,
      quote: market?.quote ?? null,
      last_digit: digits.at(-1) ?? null,
      tick_sequence: market?.tickSequence ?? 0,
      recent_digits: digits,
      recent_quotes: (market?.quoteHistory ?? []).slice(-200).map((tick: { quote: number; epoch: number }) => tick.quote),
      tick_epoch: market?.epoch ?? 0,
      sample_count: sampleCount,
      digit_even_percentage: sampleCount ? Number(((evenCount / sampleCount) * 100).toFixed(1)) : 50,
      digit_odd_percentage: sampleCount ? Number((((sampleCount - evenCount) / sampleCount) * 100).toFixed(1)) : 50,
      rise_percentage: movementSampleCount ? Number(((riseCount / movementSampleCount) * 100).toFixed(1)) : 50,
      fall_percentage: movementSampleCount
        ? Number((((movementSampleCount - riseCount - movementHistory.filter((movement: "rise" | "fall" | "flat") => movement === "flat").length) / movementSampleCount) * 100).toFixed(1))
        : 50,
      digit_streaks: digitStreaksFor(digits),
      digit_outcomes: Array.from({ length: 10 }, (_, digit) => {
        const overCount = digits.filter((value: number) => value > digit).length;
        const underCount = digits.filter((value: number) => value < digit).length;
        return {
          digit,
          over_percentage: sampleCount ? Number(((overCount / sampleCount) * 100).toFixed(1)) : 50,
          under_percentage: sampleCount ? Number(((underCount / sampleCount) * 100).toFixed(1)) : 50,
        };
      }),
    };
  });
}

export function getMarketTickSnapshot(): DerivMarketTickUpdate[] {
  return getMarketSignals().map(({ symbol, tick_sequence, recent_digits, tick_epoch }) => ({
    symbol,
    tick_sequence,
    recent_digits,
    tick_epoch,
  }));
}

function getDigitPercentages() {
  const total = getState().digitEvenCount + getState().digitOddCount;
  if (!total) return { even: 50, odd: 50 };
  return {
    even: Number(((getState().digitEvenCount / total) * 100).toFixed(1)),
    odd: Number(((getState().digitOddCount / total) * 100).toFixed(1)),
  };
}

function normalizeHistory(raw: unknown, fallbackStatus = "closed"): DerivHistoryItem | null {
  if (!raw || typeof raw !== "object" || !getState().account) return null;
  const record = raw as Record<string, unknown>;
  const rawContractId = record.contract_id ?? record.id;
  const contractId = typeof rawContractId === "string"
    ? rawContractId.trim()
    : typeof rawContractId === "number" && Number.isSafeInteger(rawContractId)
      ? String(rawContractId)
      : "";
  if (!contractId) return null;
  const isSold = isDerivFlagSet(record.is_sold);
  const reportedStatus = String(record.status ?? (isSold ? "closed" : fallbackStatus));
  const buyPrice = Number(record.buy_price ?? record.purchase_price ?? 0);
  const status = isSold && isOpenContractStatus(reportedStatus) ? "closed" : reportedStatus;
  const settled = !isOpenContractStatus(status);
  const returnedValue = record.sell_price == null ? null : Number(record.sell_price);
  const hasReportedProfit = record.profit != null && Number.isFinite(Number(record.profit));
  const profit = hasReportedProfit
    ? Number(record.profit)
    : settled && returnedValue != null && Number.isFinite(returnedValue) && Number.isFinite(buyPrice)
      ? Number((returnedValue - buyPrice).toFixed(2))
      : 0;
  const contractInput = getState().contractInputs.get(contractId);
  const rawDuration = record.duration ?? contractInput?.duration;
  const parsedDuration = Number(rawDuration);
  const duration = Number.isSafeInteger(parsedDuration) && parsedDuration > 0 ? parsedDuration : null;
  const rawDurationUnit = record.duration_unit ?? contractInput?.duration_unit;
  const duration_unit = typeof rawDurationUnit === "string" && rawDurationUnit.trim()
    ? rawDurationUnit.trim()
    : null;
  const rawGrowthRate = record.growth_rate ?? contractInput?.growth_rate;
  const parsedGrowthRate = rawGrowthRate == null ? Number.NaN : Number(rawGrowthRate);
  const growth_rate = Number.isFinite(parsedGrowthRate) && parsedGrowthRate > 0
    ? parsedGrowthRate
    : null;
  const rawTickPassed = record.tick_passed;
  const parsedTickPassed = rawTickPassed == null ? Number.NaN : Number(rawTickPassed);
  const tick_passed = Number.isSafeInteger(parsedTickPassed) && parsedTickPassed >= 0
    ? parsedTickPassed
    : null;
  const reportedCurrentValue = record.bid_price
    ?? record.current_value
    ?? (settled ? returnedValue ?? undefined : undefined);
  const currentValue = reportedCurrentValue == null
    ? buyPrice + profit
    : Number(reportedCurrentValue);

  return {
    contract_id: contractId,
    account_id: getState().account.id,
    account_type: getState().account.type,
    currency: getState().account.currency,
    contract_type: String((record.contract_type ?? getState().lastProposalContractType) || "unknown"),
    barrier: record.barrier == null
      ? (contractInput?.barrier ?? null)
      : Number(record.barrier),
    symbol: String(record.underlying_symbol ?? record.symbol ?? getState().lastProposalSymbol),
    duration,
    duration_unit,
    growth_rate,
    tick_passed,
    buy_price: buyPrice,
    current_value: Number.isFinite(currentValue) ? currentValue : buyPrice + profit,
    payout: Number(record.payout ?? 0),
    profit,
    // Deriv can briefly report status "open" alongside is_sold=true. Trust the
    // explicit sale flag so an already-closed contract cannot hold the user's
    // single-trade slot indefinitely.
    status,
    buy_time: record.purchase_time == null && record.buy_time == null
      ? null
      : Number(record.purchase_time ?? record.buy_time),
    sell_time: record.sell_time == null ? null : Number(record.sell_time),
  };
}

async function derivRequest(pathname: string, init: RequestInit = {}) {
  assertConfigured();
  const response = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: {
      "Deriv-App-ID": appId!,
      Authorization: `Bearer ${getState().pat}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as DerivResponse;
  if (!response.ok) {
    const message = body.errors?.[0]?.message ?? `Deriv REST request failed (${response.status})`;
    if (response.status === 401 || response.status === 403) {
      throw new DerivCredentialError(
        response.status === 401
          ? "Deriv rejected this PAT. Enter a valid token to reconnect."
          : "Deriv denied this request. The PAT may be missing a required permission; check its scopes before replacing it.",
        response.status,
      );
    }
    throw new Error(message);
  }
  return body;
}

async function loadAccountsFromDeriv() {
  const response = await derivRequest("/trading/v1/options/accounts");
  const accounts = extractAccounts(response);
  if (!accounts.length) throw new Error("Deriv returned no Options accounts");
  getState().accounts = accounts;
  const selected = getState().account && accounts.find((account) => account.id === getState().account?.id);
  if (selected && getState().account) {
    getState().account = {
      ...getState().account,
      balance: selected.balance,
      currency: selected.currency,
      status: selected.status,
    };
  }
  return getState().accounts;
}

async function refreshSelectedBalance() {
  if (!getState().account) return;
  const now = Date.now();
  if (now - getState().balanceRefreshAt < 2000) return;
  if (getState().balanceRefreshPromise) return getState().balanceRefreshPromise;

  getState().balanceRefreshAt = now;
  getState().balanceRefreshPromise = loadAccountsFromDeriv()
    .then(() => undefined)
    .catch((error) => {
      logger.warn({ err: error }, "Deriv REST balance refresh failed");
    })
    .finally(() => {
      getState().balanceRefreshPromise = null;
    });
  return getState().balanceRefreshPromise;
}

async function getOtpUrl(accountId: string) {
  const response = await derivRequest(
    `/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
    { method: "POST" },
  );
  const url = (response.data as { url?: unknown } | undefined)?.url;
  if (typeof url !== "string" || !url.startsWith("wss://")) {
    throw new Error("Deriv returned an invalid authenticated WebSocket URL");
  }
  return url;
}

function preferredAccount(accounts: DerivAccount[]) {
  if (getState().selectedAccountId) {
    const selected = accounts.find((account) => account.id === getState().selectedAccountId);
    if (!selected) throw new Error("Selected account was not found in the account list");
    return selected;
  }
  if (configuredAccountId) {
    const configured = accounts.find((account) => account.id === configuredAccountId);
    if (!configured) throw new Error("DERIV_ACCOUNT_ID was not found in the account list");
    return configured;
  }
  return accounts.find((account) => account.type === "demo") ?? accounts[0];
}

function send(message: Record<string, unknown>) {
  if (!getState().socket || getState().socket.readyState !== WebSocket.OPEN) return false;
  getState().socket.send(JSON.stringify(message));
  return true;
}

function contractParameters(input: ProposalInput) {
  const isAccumulator = input.contract_type === "ACCU";
  const amount = roundCents(input.amount);
  const expiryOrTakeProfit = isAccumulator
    ? {
        limit_order: {
          take_profit: Math.max(
            0.01,
            roundCents(amount * (Math.pow(1 + (input.growth_rate ?? 0), input.duration) - 1)),
          ),
        },
      }
    : { duration: input.duration, duration_unit: input.duration_unit };

  return {
    amount,
    basis: "stake" as const,
    contract_type: input.contract_type,
    currency: getState().account?.currency ?? defaultCurrency,
    ...expiryOrTakeProfit,
    underlying_symbol: input.symbol ?? defaultSymbol,
    ...(input.barrier == null ? {} : { barrier: String(input.barrier) }),
    ...(input.growth_rate == null ? {} : { growth_rate: input.growth_rate }),
  };
}

function roundCents(value: number) {
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

function sendStakeProposal(input: ProposalInput, reqId: number) {
  // Deriv owns the payout quote. Every feature must request a stake-based
  // proposal, buy at the exact returned ask price, and pass the returned
  // payout through unchanged. Do not apply an app-level payout cap, fee, or
  // percentage reduction here or in any future feature that uses this path.
  return send({
    proposal: 1,
    ...contractParameters(input),
    req_id: reqId,
  });
}

function sendProposalRequest(input: ProposalInput) {
  const reqId = ++getState().proposalSequence;
  const sent = sendStakeProposal(input, reqId);
  return sent ? reqId : null;
}

async function sendProposalBuy(proposal: DerivProposal, input: ProposalInput): Promise<DerivBuy> {
  const requestKey = proposal.id;
  return new Promise<DerivBuy>((resolve, reject) => {
    const timer = setTimeout(() => {
      getState().buyWaiters.delete(requestKey);
      getState().pendingBuyInputs.delete(requestKey);
      reject(new Error("Deriv did not confirm the contract purchase in time"));
    }, buyAckTimeoutMs);
    getState().pendingBuyInputs.set(requestKey, input);
    getState().buyWaiters.set(requestKey, { resolve, reject, timer });
    if (!send({ buy: proposal.id, price: proposal.ask_price })) {
      clearTimeout(timer);
      getState().buyWaiters.delete(requestKey);
      getState().pendingBuyInputs.delete(requestKey);
      reject(new Error("Deriv WebSocket is not ready"));
    }
  });
}

async function sendDirectBuy(proposal: DerivProposal, input: ProposalInput): Promise<DerivBuy> {
  const reqId = ++getState().buySequence;
  const requestKey = `req:${reqId}`;
  return new Promise<DerivBuy>((resolve, reject) => {
    const timer = setTimeout(() => {
      getState().buyWaiters.delete(requestKey);
      getState().pendingBuyInputs.delete(requestKey);
      reject(new Error("Deriv did not confirm the contract purchase in time"));
    }, buyAckTimeoutMs);
    getState().pendingBuyInputs.set(requestKey, input);
    getState().buyWaiters.set(requestKey, { resolve, reject, timer });
    const sent = send({
      buy: "1",
      parameters: {
        ...contractParameters(input),
      },
      price: proposal.ask_price,
      req_id: reqId,
    });
    if (!sent) {
      clearTimeout(timer);
      getState().buyWaiters.delete(requestKey);
      getState().pendingBuyInputs.delete(requestKey);
      reject(new Error("Deriv WebSocket is not ready"));
    }
  });
}

async function sendDirectBuyWithRateLimitRetry(
  initialProposal: DerivProposal,
  input: ProposalInput,
): Promise<DerivBuy> {
  let proposal = initialProposal;
  for (let retry = 0; ; retry += 1) {
    try {
      return await sendDirectBuy(proposal, input);
    } catch (error) {
      if (!isDerivBuyRateLimitError(error) || retry >= 2) throw error;
      const waitMs = retry === 0 ? 1_250 : 2_500;
      logger.warn({ retry: retry + 1, waitMs }, "Deriv rejected a buy for rate limiting; retrying the confirmed rejection safely");
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      proposal = await requestFreshProposal(input);
    }
  }
}

async function sendBatchBuysSequentially<T>(
  items: readonly T[],
  buy: (item: T) => Promise<DerivBuy>,
): Promise<PromiseSettledResult<DerivBuy>[]> {
  const results: PromiseSettledResult<DerivBuy>[] = [];
  for (let index = 0; index < items.length; index += 1) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1_050));
    try {
      results.push({ status: "fulfilled", value: await buy(items[index]) });
    } catch (reason) {
      results.push({ status: "rejected", reason });
      // Once Deriv's response is ambiguous, do not create more positions from
      // this batch until the account state is reconciled.
      if (!(reason instanceof DerivApiError)) {
        for (let remaining = index + 1; remaining < items.length; remaining += 1) {
          results.push({ status: "rejected", reason: new Error("This order was not sent because an earlier order needs account-history verification.") });
        }
        break;
      }
    }
  }
  return results;
}

async function sendBatchBuysTogether<T>(
  items: readonly T[],
  buy: (item: T) => Promise<DerivBuy>,
): Promise<PromiseSettledResult<DerivBuy>[]> {
  // Dispatch each already-quoted order in the same event-loop turn. Deriv
  // still acknowledges and settles each contract independently.
  return Promise.allSettled(items.map((item) => buy(item)));
}

function safeBuyFailureMessage(error: unknown): string {
  if (isDerivBuyRateLimitError(error)) {
    return "Deriv temporarily limited new buys. The rejected order was safely retried; check account history before resubmitting.";
  }
  if (error instanceof DerivApiError) {
    return "Deriv declined an order. Any confirmed contracts remain open; check account history before resubmitting.";
  }
  return "An order could not be confirmed. Check account history before resubmitting.";
}

export function classifyBuyFailure(error: unknown): {
  outcome: "rejected" | "uncertain" | "not_sent";
  source: TradeDiagnosticSource;
} {
  const embedded = embeddedTradeFailure(error);
  if (embedded.outcome) {
    return { outcome: embedded.outcome, source: embedded.source ?? getTradeErrorSource(error) };
  }
  if (isDerivApiError(error) || isDerivBuyRateLimitError(error)) {
    return { outcome: "rejected", source: "deriv" };
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("this order was not sent")) {
    return { outcome: "not_sent", source: "api_server" };
  }
  if (message.includes("websocket is not ready")) {
    return { outcome: "not_sent", source: "transport" };
  }
  return { outcome: "uncertain", source: "unknown" };
}

async function runBeforeBuy<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const annotated = error instanceof Error && Object.isExtensible(error)
      ? error
      : new Error(error instanceof Error ? error.message : "Pre-trade checks could not be completed.", { cause: error });
    Object.assign(annotated, {
      tradeOutcome: "not_sent" as const,
      diagnosticSource: "api_server" as const,
    });
    throw annotated;
  }
}

async function sendSell(contractId: string): Promise<SellResult> {
  const reqId = ++getState().sellSequence;
  return new Promise<SellResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      getState().sellWaiters.delete(reqId);
      reject(new Error("Deriv did not confirm the contract close in time"));
    }, buyAckTimeoutMs);
    getState().sellWaiters.set(reqId, { resolve, reject, timer });
    if (!send({ sell: contractId, price: 0, req_id: reqId })) {
      clearTimeout(timer);
      getState().sellWaiters.delete(reqId);
      reject(new Error("Deriv WebSocket is not ready"));
    }
  });
}

function proposalFromMessage(raw: unknown): DerivProposal | null {
  if (!raw || typeof raw !== "object") return null;
  const proposal = raw as Record<string, unknown>;
  const id = String(proposal.id ?? "");
  if (!id) return null;
  const rawDetails = proposal.contract_details && typeof proposal.contract_details === "object"
    ? proposal.contract_details as Record<string, unknown>
    : null;
  const rawBarrier = Number(rawDetails?.tick_size_barrier);
  return {
    id,
    ask_price: Number(proposal.ask_price ?? 0),
    payout: Number(proposal.payout ?? 0),
    spot: Number(proposal.spot ?? 0),
    longcode: typeof proposal.longcode === "string" ? proposal.longcode : null,
    ...(Number.isFinite(Number(proposal.spot_time)) ? { spot_time: Number(proposal.spot_time) } : {}),
    ...(Number.isFinite(rawBarrier) && rawBarrier > 0
      ? { contract_details: { tick_size_barrier: rawBarrier } }
      : {}),
  };
}

function assertAccumulatorKnockoutClear(input: BuyInput, proposal: DerivProposal) {
  if (!input.auto_knockout) return;
  if (input.contract_type !== "ACCU") {
    throw new Error("Auto Knockout is only supported for Accumulator contracts.");
  }

  const symbol = input.symbol ?? defaultSymbol;
  const market = getState().marketHistory.get(symbol);
  const barrier = proposal.contract_details?.tick_size_barrier;
  const now = Math.floor(Date.now() / 1000);
  const proposalEpoch = proposal.spot_time;
  const proposalSpot = proposal.spot;
  if (
    !market
    || !Number.isFinite(barrier)
    || barrier! <= 0
    || !Number.isFinite(proposalEpoch)
    || Math.abs(now - proposalEpoch!) > 3
    || Math.abs(now - market.epoch) > 3
    || !Number.isFinite(proposalSpot)
    || proposalSpot <= 0
  ) {
    throw new Error("Money Bank Auto Knockout is waiting for a fresh Deriv proposal and quote sample. No contract was sent.");
  }

  const samples = market.quoteHistory.filter((tick: { quote: number; epoch: number }) => tick.epoch <= proposalEpoch!);
  const latest = samples.at(-1);
  if (!latest || proposalEpoch! - latest.epoch > 1) {
    throw new Error("Money Bank Auto Knockout is waiting for a matching quote sample. No contract was sent.");
  }

  const requiredQuotes = input.duration + 1;
  if (samples.slice(-requiredQuotes).length !== requiredQuotes) {
    throw new Error("Money Bank Auto Knockout is waiting for enough ticks to scan this contract window. No contract was sent.");
  }

  // An Accumulator's barrier is measured from its contract's entry spot, not
  // from the preceding tick. Same-second ticks are ambiguous, so check them
  // conservatively against the proposal spot too.
  const afterProposal = market.quoteHistory.filter((tick: { quote: number; epoch: number }) => tick.epoch >= proposalEpoch!);
  for (const tick of afterProposal) {
    if (Math.abs(tick.quote - proposalSpot!) >= barrier!) {
      throw new Error("Money Bank Auto Knockout blocked this entry after a new tick reached Deriv's contract barrier. No contract was sent.");
    }
  }
}

async function observeAccumulatorMarketForKnockouts(
  input: BuyInput,
  proposal: DerivProposal,
  observationMs: number,
) {
  const symbol = input.symbol ?? defaultSymbol;
  const market = getState().marketHistory.get(symbol);
  const barrier = proposal.contract_details?.tick_size_barrier;
  if (!market || !Number.isFinite(barrier) || barrier! <= 0) {
    throw new Error("Money Bank Auto Knockout cannot start without the selected market's Deriv barrier and live ticks.");
  }

  let lastSequence = market.tickSequence;
  const entrySpot = proposal.spot;
  let observedTicks = 0;
  const deadline = Date.now() + observationMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())));
    const current = getState().marketHistory.get(symbol);
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (!current || nowEpoch - current.epoch > 3 || current.epoch - nowEpoch > 3) {
      throw new Error("Money Bank Auto Knockout did not receive fresh ticks for the selected market during its scan. No contract was sent.");
    }

    const newTickCount = current.tickSequence - lastSequence;
    if (newTickCount <= 0) continue;
    const newTicks = current.quoteHistory.filter((tick: { quote: number; epoch: number; sequence?: number }) =>
      tick.sequence != null
      && tick.sequence > lastSequence
      && tick.sequence <= current.tickSequence,
    );
    if (newTicks.length !== newTickCount) {
      throw new Error("Money Bank Auto Knockout could not verify every tick in the selected market's scan. No contract was sent.");
    }
    for (const tick of newTicks) {
      if (Math.abs(tick.quote - entrySpot) >= barrier!) {
        throw new Error("Money Bank Auto Knockout blocked this entry after detecting a knockout-sized move during its 10-second scan. No contract was sent.");
      }
      observedTicks += 1;
    }
    lastSequence = current.tickSequence;
  }

  if (observedTicks === 0) {
    throw new Error("Money Bank Auto Knockout did not observe any new ticks during its 10-second scan. No contract was sent.");
  }
}

export async function scanAccumulatorKnockout(
  input: ProposalInput,
  observationMs = 10_000,
) {
  if (input.contract_type !== "ACCU") {
    throw new Error("Money Bank Auto Knockout is only supported for Accumulator contracts.");
  }
  validateProposalInput(input);
  validateAccumulatorInput(input);

  const scanInput: BuyInput = {
    ...input,
    barrier: typeof input.barrier === "number" ? input.barrier : undefined,
    duration_unit: "t",
    auto_knockout: true,
  };
  const initialProposal = await requestFreshProposal(input);
  assertAccumulatorKnockoutClear(scanInput, initialProposal);
  await observeAccumulatorMarketForKnockouts(scanInput, initialProposal, observationMs);

  // The proposal used to start the scan is stale by the time the observation
  // finishes. Requote and validate the selected exit-tick window immediately
  // before reporting success; buyContract repeats this check on its own quote.
  const finalProposal = await requestFreshProposal(input);
  assertAccumulatorKnockoutClear(scanInput, finalProposal);

  return {
    ok: true,
    message: "The 10-second Auto Knockout scan passed for the selected market, growth rate, and exit-tick window. The buy will run one final fresh-quote check.",
  };
}

function scheduleReconnect() {
  const ownerId = userContext.getStore();
  const runtime = getState();
  if (!ownerId || runtime.shuttingDown || runtime.reconnectTimer) return;
  runtime.reconnectTimer = setTimeout(() => {
    if (runtimes.get(ownerId) !== runtime || runtime.shuttingDown) return;
    runtime.reconnectTimer = null;
    void withUserSerialized(ownerId, async () => {
      if (runtimes.get(ownerId) !== runtime || runtime.shuttingDown) return;
      await connect();
    });
  }, 5000);
}

function scheduleSettlementFallbackCheck(
  ownerId: string,
  ownerRuntime: ReturnType<typeof createState>,
) {
  if (ownerRuntime.shuttingDown || runtimes.get(ownerId) !== ownerRuntime) return;
  if (ownerRuntime.settlementFallbackTimer) clearTimeout(ownerRuntime.settlementFallbackTimer);
  ownerRuntime.settlementFallbackTimer = setTimeout(() => {
    ownerRuntime.settlementFallbackTimer = null;
    void withUserSerialized(ownerId, async () => {
      if (runtimes.get(ownerId) !== ownerRuntime || ownerRuntime.shuttingDown) return;
      try {
        if (ownerRuntime.socket?.readyState !== WebSocket.OPEN && !await connect()) {
          throw new Error("Deriv WebSocket is not ready for the settlement check");
        }
        const runtime = getState();
        const accountId = runtime.account?.id ?? runtime.selectedAccountId;
        const contractIds = new Set([
          ...[...runtime.activeContracts.values()]
            .filter((item: DerivHistoryItem) => item.account_id === accountId && isOpenContractStatus(item.status))
            .map((item: DerivHistoryItem) => item.contract_id),
          ...runtime.history
            .filter((item: DerivHistoryItem) => item.account_id === accountId && isOpenContractStatus(item.status))
            .map((item: DerivHistoryItem) => item.contract_id),
          ...runtime.verifiedPortfolioIds,
        ]);
        for (const contractId of contractIds) {
          if (!requestOpenContractUpdate(contractId)) {
            runtime.settlementFallbackContractIds.delete(contractId);
            continue;
          }
          runtime.settlementFallbackContractIds.add(contractId);
        }
        if (contractIds.size) {
          logger.debug(
            { accountId, contractCount: contractIds.size },
            "Requested fallback Deriv settlement checks for active contracts",
          );
        }
      } catch (error) {
        logger.warn({ err: error, accountId: ownerRuntime.account?.id ?? ownerRuntime.selectedAccountId }, "Deriv settlement fallback check failed; keeping unresolved contracts blocked");
      } finally {
        scheduleSettlementFallbackCheck(ownerId, ownerRuntime);
      }
    }).catch((error) => {
      logger.warn({ err: error, accountId: ownerRuntime.account?.id ?? ownerRuntime.selectedAccountId }, "Deriv settlement fallback check could not run");
      scheduleSettlementFallbackCheck(ownerId, ownerRuntime);
    });
  }, settlementFallbackIntervalMs);
  ownerRuntime.settlementFallbackTimer.unref();
}

function scheduleOpenContractsCheckRetry(
  ownerId: string,
  ownerRuntime: ReturnType<typeof createState>,
) {
  if (ownerRuntime.shuttingDown || runtimes.get(ownerId) !== ownerRuntime || ownerRuntime.portfolioRetryTimer) return;
  const delayMs = Math.min(500 * (2 ** ownerRuntime.portfolioRetryAttempt), 10_000);
  ownerRuntime.portfolioRetryAttempt = Math.min(ownerRuntime.portfolioRetryAttempt + 1, 5);
  ownerRuntime.portfolioRetryTimer = setTimeout(() => {
    ownerRuntime.portfolioRetryTimer = null;
    void withUserSerialized(ownerId, async () => {
      if (runtimes.get(ownerId) !== ownerRuntime || ownerRuntime.shuttingDown) return;
      try {
        await refreshOpenContracts();
      } catch (error) {
        logger.warn(
          { err: error, accountId: ownerRuntime.account?.id ?? ownerRuntime.selectedAccountId },
          "Deriv open-contract check failed; trading remains paused and another safe check will be attempted",
        );
      }
    }).catch((error) => {
      logger.warn({ err: error }, "Deriv open-contract check retry could not run");
      scheduleOpenContractsCheckRetry(ownerId, ownerRuntime);
    });
  }, delayMs);
  ownerRuntime.portfolioRetryTimer.unref();
}

function requestPortfolioSnapshot(): Promise<string[]> {
  const runtime = getState();
  if (runtime.socket?.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Deriv WebSocket is not ready"));
  }
  runtime.openContractsReady = false;
  const reqId = ++runtime.portfolioSequence;
  return new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      runtime.portfolioWaiters.delete(reqId);
      if (!runtime.portfolioWaiters.size) runtime.openContractsReady = false;
      reject(new Error("Deriv did not confirm the current open-contract portfolio in time."));
    }, 5_000);
    runtime.portfolioWaiters.set(reqId, { resolve, reject, timer });
    if (!send({ portfolio: 1, req_id: reqId })) {
      clearTimeout(timer);
      runtime.portfolioWaiters.delete(reqId);
      if (!runtime.portfolioWaiters.size) runtime.openContractsReady = false;
      reject(new Error("Deriv WebSocket is not ready"));
    }
  });
}

async function connectInternal() {
  const ownerId = userContext.getStore();
  const ownerRuntime = getState();
  const isRuntimeCurrent = () => Boolean(ownerId && runtimes.get(ownerId) === ownerRuntime && !ownerRuntime.shuttingDown);
  const accounts = await loadAccountsFromDeriv();
  if (!isRuntimeCurrent()) return false;
  const account = preferredAccount(accounts);
  getState().selectedAccountId = account.id;
  const url = await getOtpUrl(account.id);
  if (!isRuntimeCurrent()) return false;

  return await new Promise<boolean>((resolve, reject) => {
    const socket = new WebSocket(url);
    ownerRuntime.socket = socket;
    ownerRuntime.account = account;
    const isCurrentSocket = () => isRuntimeCurrent() && ownerRuntime.socket === socket;
    let settled = false;
    const resolveOnce = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    socket.once("open", () => {
      if (!isCurrentSocket()) {
        resolveOnce(false);
        socket.close();
        return;
      }
      ownerRuntime.openContractsReady = false;
      logger.info({ accountId: account.id }, "Deriv WebSocket connected");
      send({ balance: 1, subscribe: 1 });
      for (const symbol of supportedSymbols) send({ ticks: symbol, subscribe: 1 });
      void requestPortfolioSnapshot().catch((error) => {
        logger.warn(
          { err: error, accountId: account.id },
          "Initial Deriv open-contract check failed; trading remains paused until a later check succeeds",
        );
        scheduleOpenContractsCheckRetry(ownerId!, ownerRuntime);
      });
      scheduleSettlementFallbackCheck(ownerId!, ownerRuntime);
      resolveOnce(true);
    });

    socket.on("message", (raw) => {
      if (!isCurrentSocket()) return;
      let message: Record<string, any>;
      try {
        message = JSON.parse(raw.toString()) as Record<string, any>;
      } catch (error) {
        logger.warn({ err: error }, "Ignoring malformed Deriv WebSocket message");
        return;
      }
      if (message.error) {
        const errorMessage = String(message.error.message ?? message.error.code ?? "Deriv rejected the request");
        const derivError = new DerivApiError(message.error.code, errorMessage);
        const reqId = Number(message.req_id ?? message.echo_req?.req_id);
        const proposalWaiter = getState().proposalWaiters.get(reqId);
        if (proposalWaiter) {
          clearTimeout(proposalWaiter.timer);
          getState().proposalWaiters.delete(reqId);
          proposalWaiter.reject(derivError);
        }
        const portfolioWaiter = getState().portfolioWaiters.get(reqId);
        if (portfolioWaiter) {
          clearTimeout(portfolioWaiter.timer);
          getState().portfolioWaiters.delete(reqId);
          if (!getState().portfolioWaiters.size) getState().openContractsReady = false;
          portfolioWaiter.reject(new Error(errorMessage));
        }
        const profitTableWaiter = getState().profitTableWaiters.get(reqId);
        if (profitTableWaiter) {
          clearTimeout(profitTableWaiter.timer);
          getState().profitTableWaiters.delete(reqId);
          if (message.error.code === "RateLimit") {
            getState().profitTableRetryAfter = Date.now() + profitTableRateLimitBackoffMs;
            getState().profitTableRefreshAt = Date.now();
            logger.warn(
              { backoffMs: profitTableRateLimitBackoffMs },
              "Deriv rate-limited trade history refresh; serving cached history during backoff",
            );
            profitTableWaiter.resolve();
          } else {
            profitTableWaiter.reject(new Error(errorMessage));
          }
        }
        const echoedBuyRequestId = Number(message.req_id ?? message.echo_req?.req_id);
        const rejectedProposalId = typeof message.echo_req?.buy === "string" && message.echo_req.buy !== "1"
          ? message.echo_req.buy
          : null;
        const rejectedBuyKey = echoedBuyRequestId > 0 ? `req:${echoedBuyRequestId}` : rejectedProposalId;
        if (rejectedBuyKey) {
          getState().pendingBuyInputs.delete(rejectedBuyKey);
          const buyWaiter = getState().buyWaiters.get(rejectedBuyKey);
          if (buyWaiter) {
            clearTimeout(buyWaiter.timer);
            getState().buyWaiters.delete(rejectedBuyKey);
            buyWaiter.reject(derivError);
          }
        }
        logger.warn(
          { code: message.error.code, message: errorMessage },
          "Deriv WebSocket returned an error",
        );
        return;
      }

      if (message.msg_type === "balance") {
        getState().account = {
          ...(getState().account ?? account),
          balance: Number(message.balance?.balance ?? 0),
          currency: message.balance?.currency ?? account.currency,
        };
      } else if (message.msg_type === "tick") {
        recordMarketTick(
          String(message.tick?.symbol ?? getState().selectedSymbol),
          message.tick?.quote,
          Number(message.tick?.epoch ?? 0),
          message.tick?.pip_size,
        );
        if (getState().lastProposalInput && Date.now() - getState().lastProposalRefreshAt >= 1000) {
          getState().lastProposalRefreshAt = Date.now();
          sendProposalRequest(getState().lastProposalInput);
        }
      } else if (message.msg_type === "proposal") {
        const proposal = proposalFromMessage(message.proposal);
        if (proposal) {
          getState().lastProposal = proposal;
          getState().proposalIds.add(proposal.id);
          const reqId = Number(message.req_id ?? message.echo_req?.req_id);
          const waiter = getState().proposalWaiters.get(reqId);
          if (waiter) {
            clearTimeout(waiter.timer);
            getState().proposalWaiters.delete(reqId);
            waiter.resolve(proposal);
          }
        }
      } else if (message.msg_type === "buy") {
          const echoedProposalId = typeof message.echo_req?.buy === "string" && message.echo_req.buy !== "1"
          ? message.echo_req.buy
          : null;
          const buyRequestId = Number(message.req_id ?? message.echo_req?.req_id);
          const buyKey = buyRequestId > 0 ? `req:${buyRequestId}` : echoedProposalId;
          const buyInput = buyKey ? getState().pendingBuyInputs.get(buyKey) : undefined;
          if (buyKey) getState().pendingBuyInputs.delete(buyKey);
        getState().lastBuy = {
          contract_id: String(message.buy?.contract_id ?? ""),
          buy_price: Number(message.buy?.buy_price ?? 0),
          payout: Number(message.buy?.payout ?? 0),
          start_time: message.buy?.start_time == null ? null : Number(message.buy.start_time),
        };
        if (getState().lastBuy.contract_id && buyInput) {
          getState().contractInputs.set(getState().lastBuy.contract_id, buyInput);
        }
        const historyItem = normalizeHistory({
          contract_id: getState().lastBuy.contract_id,
          buy_price: getState().lastBuy.buy_price,
          payout: getState().lastBuy.payout,
          purchase_time: getState().lastBuy.start_time,
          contract_type: buyInput?.contract_type ?? "unknown",
          underlying_symbol: buyInput?.symbol ?? defaultSymbol,
          status: "open",
        }, "open");
        if (historyItem) upsertHistory(historyItem);
        if (getState().lastBuy.contract_id) {
          send({ balance: 1 });
          requestOpenContractUpdate(getState().lastBuy.contract_id, true);
        }
        if (buyKey) {
          const buyWaiter = getState().buyWaiters.get(buyKey);
          if (buyWaiter) {
            clearTimeout(buyWaiter.timer);
            getState().buyWaiters.delete(buyKey);
            buyWaiter.resolve(getState().lastBuy);
          }
        }
      } else if (message.msg_type === "sell") {
        const reqId = Number(message.req_id ?? message.echo_req?.req_id);
        const waiter = getState().sellWaiters.get(reqId);
        if (waiter) {
          clearTimeout(waiter.timer);
          getState().sellWaiters.delete(reqId);
          waiter.resolve({
            contract_id: String(message.sell?.contract_id ?? message.echo_req?.sell ?? ""),
            sold_for: Number(message.sell?.sold_for ?? 0),
          });
        }
      } else if (message.msg_type === "proposal_open_contract") {
        const contract = message.proposal_open_contract;
        if (contract) {
          const contractId = String(contract.contract_id ?? "");
          const isSold = isDerivFlagSet(contract.is_sold);
          const contractStatus = String(contract.status ?? "open");
          const normalizedStatus = isSold && isOpenContractStatus(contractStatus) ? "closed" : contractStatus;
          const previousHistoryItem = getState().history.find((item: DerivHistoryItem) =>
            item.account_id === account.id && item.contract_id === contractId,
          );
          const isStaleOpenUpdate = isOpenContractStatus(normalizedStatus)
            && previousHistoryItem
            && !isOpenContractStatus(previousHistoryItem.status);
          if (!isStaleOpenUpdate) {
            getState().lastContract = {
              contract_id: contractId,
              status: normalizedStatus,
              is_sold: isSold,
              profit: Number(contract.profit ?? 0),
              buy_price: Number(contract.buy_price ?? getState().lastBuy?.buy_price ?? 0),
              payout: Number(contract.payout ?? getState().lastBuy?.payout ?? 0),
              sell_price: Number(contract.sell_price ?? 0),
              entry_spot: Number(contract.entry_spot ?? 0),
              current_spot: Number(contract.current_spot ?? 0),
              expiry_time: contract.expiry_time == null ? null : Number(contract.expiry_time),
            };
          }
          const historyItem = normalizeHistory({
            ...contract,
            contract_id: contractId,
            status: normalizedStatus,
            sell_time: contract.sell_time,
            contract_type: getState().contractInputs.get(contractId)?.contract_type ?? getState().lastProposalContractType,
            underlying_symbol: getState().contractInputs.get(contractId)?.symbol ?? getState().lastProposalSymbol,
          }, isSold ? "closed" : "open");
          if (historyItem) upsertHistory(historyItem);
        }
      } else if (message.msg_type === "profit_table") {
        const reqId = Number(message.req_id ?? message.echo_req?.req_id);
        const waiter = getState().profitTableWaiters.get(reqId);
        // Only correlated refreshes are safe to apply. An unsolicited reply
        // can belong to the previous account after a cross-server switch.
        if (!waiter) return;
        const transactions = Array.isArray(message.profit_table?.transactions)
          ? message.profit_table.transactions
          : [];
        for (const transaction of transactions) {
          const historyItem = normalizeHistory(transaction);
          if (historyItem) upsertHistory(historyItem);
        }
        getState().profitTableReady = true;
        if (waiter) {
          clearTimeout(waiter.timer);
          getState().profitTableWaiters.delete(reqId);
          waiter.resolve();
        }
      } else if (message.msg_type === "portfolio") {
        const reqId = Number(message.req_id ?? message.echo_req?.req_id);
        const waiter = getState().portfolioWaiters.get(reqId);
        if (!waiter) return;
        if (!Array.isArray(message.portfolio?.contracts)) {
          const error = new Error("Deriv returned an invalid open-contract portfolio.");
          if (waiter) {
            clearTimeout(waiter.timer);
            getState().portfolioWaiters.delete(reqId);
            waiter.reject(error);
          }
          getState().openContractsReady = false;
          logger.warn({ reqId }, "Deriv returned an invalid open-contract portfolio; keeping trading paused");
          return;
        }
        const contracts = message.portfolio.contracts;
        const portfolioContractIds = new Set<string>();
        for (const contract of contracts) {
          const historyItem = normalizeHistory(contract, "open");
          if (!historyItem) continue;
          upsertHistory(historyItem);
          if (isOpenContractStatus(historyItem.status)) {
            portfolioContractIds.add(historyItem.contract_id);
            requestOpenContractUpdate(historyItem.contract_id, true);
          }
        }
        const activeAccountId = getState().account?.id ?? getState().selectedAccountId;
        getState().verifiedPortfolioIds = new Set(portfolioContractIds);
        for (const [contractKey, historyItem] of getState().activeContracts) {
          if (
            historyItem.account_id === activeAccountId
            && !portfolioContractIds.has(historyItem.contract_id)
          ) {
            getState().activeContracts.delete(contractKey);
          }
        }
        if (
          isOpenContractStatus(getState().lastContract?.status ?? "")
          && !portfolioContractIds.has(getState().lastContract.contract_id)
        ) {
          getState().lastContract = null;
        }
        for (const historyItem of getState().history as DerivHistoryItem[]) {
          if (
            historyItem.account_id === activeAccountId
            && isOpenContractStatus(historyItem.status)
            && !portfolioContractIds.has(historyItem.contract_id)
          ) {
            // A contract may have settled while this socket was disconnected.
            // Fetch its final state instead of leaving a stale open row blocking
            // every later trade.
            requestOpenContractUpdate(historyItem.contract_id);
          }
        }
        getState().openContractsReady = true;
        getState().portfolioRetryAttempt = 0;
        if (getState().portfolioRetryTimer) {
          clearTimeout(getState().portfolioRetryTimer);
          getState().portfolioRetryTimer = null;
        }
        if (waiter) {
          clearTimeout(waiter.timer);
          getState().portfolioWaiters.delete(reqId);
          waiter.resolve([...portfolioContractIds]);
        }
      }
    });

    socket.on("close", () => {
      if (!isCurrentSocket()) {
        resolveOnce(false);
        return;
      }
      getState().socket = null;
      getState().account = null;
      getState().openContractsReady = false;
      rejectProposalWaiters("Deriv WebSocket disconnected before the proposal was returned");
      rejectPortfolioWaiters("Deriv WebSocket disconnected before the account portfolio was confirmed");
      rejectProfitTableWaiters("Deriv WebSocket disconnected before trade history was refreshed");
      rejectBuyWaiters("Deriv WebSocket disconnected before the contract purchase was acknowledged");
      rejectSellWaiters("Deriv WebSocket disconnected before the contract could be sold");
      logger.warn("Deriv WebSocket closed");
      resolveOnce(false);
      if (isRuntimeCurrent()) scheduleReconnect();
    });

    socket.once("error", (error) => {
      if (!isCurrentSocket()) {
        resolveOnce(false);
        return;
      }
      logger.error({ err: error }, "Deriv WebSocket connection failed");
      rejectOnce(error);
    });
  });
}

async function connect() {
  const ownerId = userContext.getStore();
  const runtime = getState();
  if (!ownerId || runtime.shuttingDown) return false;
  if (runtime.socket?.readyState === WebSocket.OPEN) return true;
  if (runtime.connecting) return runtime.connecting;

  runtime.connecting = connectInternal()
    .catch((error) => {
      logger.error({ err: error }, "Deriv connection attempt failed");
      if (runtimes.get(ownerId) === runtime && !runtime.shuttingDown) {
        scheduleReconnect();
      }
      return false;
    })
    .finally(() => {
      runtime.connecting = null;
    });

  return runtime.connecting;
}

async function refreshOpenContracts(): Promise<string[]> {
  const ownerId = userContext.getStore();
  const runtime = getState();
  try {
    if (!await connect()) throw new Error("Deriv WebSocket is not ready");
    return await requestPortfolioSnapshot();
  } catch (error) {
    if (ownerId) scheduleOpenContractsCheckRetry(ownerId, runtime);
    throw error;
  }
}

export function getStatus(): DerivStatus {
  const digitPercentages = getDigitPercentages();
  return {
    connected: getState().socket?.readyState === WebSocket.OPEN,
    authorized: getState().socket?.readyState === WebSocket.OPEN,
    open_contracts_ready: getState().openContractsReady,
    active_contract_count: getActiveContractCount(),
    account: getState().account,
    last_tick: getState().lastTick,
    last_proposal: getState().lastProposal,
    last_buy: getState().lastBuy,
    last_contract: getState().lastContract,
    bot_running: getState().botRunning,
    symbol: getState().selectedSymbol,
    currency: defaultCurrency,
    // There is intentionally no application-level stake ceiling. Deriv and
    // the selected account balance are the source of truth for affordability.
    max_trade_amount: 0,
    live_trading_enabled: liveTradingEnabled,
    digit_even_percentage: digitPercentages.even,
    digit_odd_percentage: digitPercentages.odd,
    digit_sample_count: getState().digitEvenCount + getState().digitOddCount,
    last_digit: getState().digitHistory.at(-1) ?? null,
    digit_history: getState().digitHistory.slice(-50),
    digit_streaks: getDigitStreaks(),
    market_signals: getMarketSignals(),
  };
}

export async function getLiveStatus() {
  await refreshSelectedBalance();
  if (getState().socket?.readyState !== WebSocket.OPEN) {
    await connect();
  }
  return getStatus();
}

export async function refreshDerivHistory() {
  if (!await connect()) throw new Error("Deriv WebSocket is not ready");
  const runtime = getState();
  if (runtime.profitTableRefreshPromise) return runtime.profitTableRefreshPromise;
  const now = Date.now();
  if (now < runtime.profitTableRetryAfter) return;
  if (now - runtime.profitTableRefreshAt < minimumProfitTableRefreshIntervalMs) return;

  const reqId = ++runtime.profitTableSequence;
  runtime.profitTableRefreshAt = Date.now();
  runtime.profitTableRefreshPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      runtime.profitTableWaiters.delete(reqId);
      reject(new Error("Deriv did not refresh trade history in time."));
    }, 5_000);
    runtime.profitTableWaiters.set(reqId, { resolve, reject, timer });
    if (!send({ profit_table: 1, limit: 50, description: 1, sort: "DESC", req_id: reqId })) {
      clearTimeout(timer);
      runtime.profitTableWaiters.delete(reqId);
      reject(new Error("Deriv WebSocket is not ready"));
    }
  }).catch((error: unknown) => {
    runtime.profitTableRefreshAt = 0;
    throw error;
  }).finally(() => {
    runtime.profitTableRefreshPromise = null;
  });
  return runtime.profitTableRefreshPromise;
}

export async function getAccounts() {
  return loadAccountsFromDeriv();
}

export async function testConnection() {
  const accounts = await loadAccountsFromDeriv();
  const connected = await connect();
  return {
    ok: connected,
    message: connected
      ? "Deriv REST and WebSocket connection are healthy"
      : "Deriv accounts loaded, but the WebSocket is still reconnecting",
    accounts,
    status: await getLiveStatus(),
  };
}

export async function requestProposal(input: ProposalInput) {
  validateProposalInput(input);
  validateAccumulatorInput(input);
  getState().lastProposalContractType = input.contract_type;
  getState().lastProposalSymbol = input.symbol ?? defaultSymbol;
  getState().lastProposalInput = input;
  const connected = await connect();
  if (!connected || !sendProposalRequest(input)) {
    throw new Error("Deriv WebSocket is not ready");
  }
  return {
    ok: true,
    message: "Proposal requested. Review the returned quote before any trade action.",
  };
}

async function requestFreshProposal(input: ProposalInput) {
  getState().lastProposalContractType = input.contract_type;
  getState().lastProposalSymbol = input.symbol ?? defaultSymbol;
  getState().lastProposalInput = input;
  let lastError = "Deriv WebSocket is not ready";

  for (let attempt = 1; attempt <= proposalAttempts; attempt += 1) {
    const connected = await connect();
    if (!connected) {
      lastError = "Deriv WebSocket is not ready";
    } else {
      try {
        const proposal = await new Promise<DerivProposal>((resolve, reject) => {
          const reqId = ++getState().proposalSequence;
          const timer = setTimeout(() => {
            getState().proposalWaiters.delete(reqId);
            reject(new Error("Deriv did not return a proposal in time"));
          }, proposalTimeoutMs);
          getState().proposalWaiters.set(reqId, { resolve, reject, timer });
          const sent = sendStakeProposal(input, reqId);
          if (!sent) {
            clearTimeout(timer);
            getState().proposalWaiters.delete(reqId);
            reject(new Error("Deriv WebSocket is not ready"));
          }
        });
        return proposal;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Deriv proposal request failed";
        logger.warn({ attempt, err: error }, "Deriv proposal attempt failed");
      }
    }

    if (attempt < proposalAttempts) {
      // A stale authenticated socket can stay open while no longer delivering
      // replies. Force a clean reconnect before the next correlated request.
      getState().socket?.close();
      getState().socket = null;
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }

  throw new Error(
    lastError === "Deriv did not return a proposal in time"
      ? "Deriv did not return a proposal after 3 attempts. The connection was refreshed; please try again."
      : lastError,
  );
}

export async function selectAccount(accountId: string) {
  const accounts = getState().accounts.length ? getState().accounts : await loadAccountsFromDeriv();
  const account = accounts.find((item: DerivAccount) => item.id === accountId);
  if (!account) throw new Error("That account is not available");
  if (getState().selectedAccountId && account.id !== getState().selectedAccountId) {
    assertNoActiveContract();
  }

  getState().selectedAccountId = account.id;
  rejectProposalWaiters("Deriv account changed before proposal completed");
  rejectPortfolioWaiters("Deriv account changed before the portfolio was returned");
  getState().socket?.close();
  getState().socket = null;
  getState().account = null;
  getState().lastProposal = null;
  getState().lastBuy = null;
  getState().lastContract = null;
  getState().openContractsReady = false;
  getState().verifiedPortfolioIds.clear();
  getState().profitTableReady = false;
  getState().profitTableRefreshAt = 0;
  getState().profitTableRetryAfter = 0;
  getState().profitTableRefreshPromise = null;
  rejectProfitTableWaiters("Deriv account changed before trade history was returned");
  rejectBuyWaiters("Deriv account changed before the contract purchase was acknowledged");
  getState().lastProposalContractType = "";
  getState().lastProposalSymbol = defaultSymbol;
  getState().lastProposalInput = null;
  getState().lastProposalRefreshAt = 0;
  getState().contractInputs.clear();
  getState().digitEvenCount = 0;
  getState().digitOddCount = 0;
  getState().digitHistory = [];
  getState().marketHistory.clear();
  await connect();
  return getStatus();
}

export async function selectSymbol(symbol: string) {
  if (!supportedSymbols.has(symbol)) throw new Error("That market is not supported");
  if (getState().selectedSymbol === symbol) return getStatus();
  getState().selectedSymbol = symbol;
  const market = getState().marketHistory.get(symbol);
  getState().lastTick = market?.quote == null
    ? null
    : { symbol, quote: market.quote, epoch: market.epoch };
  getState().digitHistory = [...(market?.digitHistory ?? [])];
  getState().digitEvenCount = getState().digitHistory.filter((digit: number) => digit % 2 === 0).length;
  getState().digitOddCount = getState().digitHistory.length - getState().digitEvenCount;
  getState().lastProposal = null;
  getState().lastProposalInput = null;
  return getStatus();
}

type TradeAuthorizationCheck = () => Promise<void>;

export async function buyContract(input: BuyInput, assertAuthorized?: TradeAuthorizationCheck) {
  await assertAuthorized?.();
  const normalizedInput = { ...input, amount: roundCents(input.amount) };
  if (!getState().account) throw new Error("Select an account before buying a contract");
  if (getState().account.type === "real" && !liveTradingEnabled) {
    throw new Error("Live trading is disabled on this server");
  }
  if (normalizedInput.amount > getState().account.balance) {
    throw new Error("The selected stake exceeds the current account balance");
  }
  validateProposalInput(normalizedInput);
  const proposalInput: ProposalInput = {
    amount: normalizedInput.amount,
    duration: normalizedInput.duration,
    duration_unit: normalizedInput.duration_unit,
    contract_type: normalizedInput.contract_type,
    barrier: normalizedInput.barrier,
    growth_rate: normalizedInput.growth_rate,
    symbol: normalizedInput.symbol,
  };
  let proposal = await runBeforeBuy(async () => {
    const [protection] = await Promise.all([
      getTradingProtectionSettings(),
      refreshOpenContracts(),
    ]);
    assertTradingProtection(protection, getStatus(), normalizedInput);
    assertNoActiveContract(true);
    const freshProposal = await requestFreshProposal(proposalInput);
    if (!await connect()) throw new Error("Deriv WebSocket is not ready");
    await assertAuthorized?.();
    return freshProposal;
  });
  let buy: DerivBuy;
  try {
    buy = await sendProposalBuy(proposal, normalizedInput);
  } catch (error) {
    if (
      !(error instanceof DerivApiError)
      || (error.code !== "InvalidContractProposal" && error.code !== "RateLimit")
    ) {
      throw error;
    }

    // Deriv explicitly rejected the request, so no contract was opened.
    // Refresh the quote and retry only this known-rejected order.
    logger.warn(
      { code: error.code, contractType: normalizedInput.contract_type, symbol: proposalInput.symbol },
      "Deriv explicitly rejected the single-trade request; requesting a fresh direct quote",
    );
    proposal = await requestFreshProposal(proposalInput);
    await assertAuthorized?.();
    buy = await sendDirectBuyWithRateLimitRetry(proposal, normalizedInput);
  }
  return {
    ok: true,
    message: getState().account.type === "real"
      ? "Live buy request sent. Contract and balance updates will appear here."
      : "Demo buy request sent to Deriv. Contract and balance updates will appear here.",
    proposal,
    buy,
  };
}

export async function sellContract(contractId: string) {
  const normalizedContractId = contractId.trim();
  if (!normalizedContractId) throw new Error("A contract id is required to close a contract");
  const matching = getState().history.find((trade: DerivHistoryItem) => trade.contract_id === normalizedContractId);
  if (!matching) throw new Error("That contract is not owned by the selected account");
  if (matching.status !== "open") throw new Error("That contract is already settled");
  const connected = await connect();
  if (!connected) throw new Error("Deriv WebSocket is not ready");
  const result = await sendSell(normalizedContractId);
  const soldAt = Math.floor(Date.now() / 1000);
  const settledProfit = roundCents(result.sold_for - matching.buy_price);
  upsertHistory({
    ...matching,
    status: "closed",
    sell_time: soldAt,
    current_value: result.sold_for,
    payout: result.sold_for,
    profit: settledProfit,
  });
  if (getState().lastContract?.contract_id === normalizedContractId) {
    getState().lastContract = {
      ...getState().lastContract,
      status: "closed",
      is_sold: true,
      sell_price: result.sold_for,
      profit: settledProfit,
    };
  }
  return { ok: true, ...result };
}

export async function bulkBuyContracts(input: {
  amount: number;
  duration: number;
  duration_unit: "t";
  contract_type: DigitContractType;
  barrier?: number;
  symbol?: string;
  growth_rate?: number;
  count: number;
}, assertAuthorized?: TradeAuthorizationCheck, sendTogether = false) {
  await assertAuthorized?.();
  const amount = roundCents(input.amount);
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > maxBulkCount) {
    throw new Error(`Bulk count must be between 1 and ${maxBulkCount}`);
  }
  if (input.duration > 5 && input.contract_type !== "CALL" && input.contract_type !== "PUT") {
    throw new Error("Tick durations above 5 are only supported for Rise/Fall contracts.");
  }
  if (!getState().account) throw new Error("Select an account before buying contracts");
  if (getState().account.type === "real" && !liveTradingEnabled) {
    throw new Error("Live trading is disabled on this server");
  }
  if (amount * input.count > getState().account.balance) {
    throw new Error("The selected bulk stake exceeds the current account balance");
  }
  validateProposalInput({ ...input, amount });

  const proposalInput = {
    amount,
    duration: input.duration,
    duration_unit: input.duration_unit,
    contract_type: input.contract_type,
    barrier: input.barrier,
    growth_rate: input.growth_rate,
    symbol: input.symbol,
  } satisfies ProposalInput;
  const proposals = await runBeforeBuy(async () => {
    assertTradingProtection(await getTradingProtectionSettings(), getStatus(), input);
    await refreshOpenContracts();
    assertNoActiveContract(true);

    // Quote the complete batch before buying anything. This prevents a
    // partially-started batch when one contract is unavailable, and lets the
    // buys leave the socket together instead of serializing them.
    const freshProposals = await Promise.all(
      Array.from({ length: input.count }, () => requestFreshProposal(proposalInput)),
    );
    await assertAuthorized?.();
    if (!await connect()) throw new Error("Deriv WebSocket is not ready");
    await assertAuthorized?.();
    return freshProposals;
  });

  // Direct parameter buys use the fresh quote as the maximum price and avoid
  // holding temporary proposal IDs until the whole batch is ready. Deriv can
  // invalidate those IDs between the proposal response and a later buy.
  const buyResults = sendTogether && input.count > 1
    ? await sendBatchBuysTogether(
      proposals,
      (proposal) => sendDirectBuyWithRateLimitRetry(proposal, proposalInput),
    )
    : await sendBatchBuysSequentially(
      proposals,
      (proposal) => sendDirectBuyWithRateLimitRetry(proposal, proposalInput),
    );
  const buys = buyResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failures = buyResults.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  const failed = buyResults.flatMap((result, index) => {
    if (result.status !== "rejected") return [];
    return [{
      index,
      ...classifyBuyFailure(result.reason),
      error: safeBuyFailureMessage(result.reason),
    }];
  });
  const ok = failures.length === 0;
  if (failures.length > 0 && !(sendTogether && input.count > 1)) {
    const failedBuy = failures[0];
    const failureClass = classifyBuyFailure(failedBuy.reason);
    const error = Object.assign(
      new Error(`Bulk buy could not be fully confirmed. ${safeBuyFailureMessage(failedBuy.reason)}`),
      {
        diagnosticSource: failureClass.source,
        tradeOutcome: buys.length > 0 ? "uncertain" as const : failureClass.outcome,
      },
    );
    if (isDerivBuyRateLimitError(failedBuy.reason)) Object.assign(error, { code: "DERIV_BUY_RATE_LIMITED" });
    throw error;
  }

  return {
    ok,
    count: buys.length,
    message: ok
      ? `${buys.length} ${getState().account.type} buy requests sent together. Each contract settles independently.`
      : `${buys.length} of ${proposals.length} contracts were confirmed. The remaining order status is uncertain or rejected; check Deriv history before resubmitting.`,
    proposals,
    buys,
    failed,
  };
}

export type ClockWorkOrder = {
  key: string;
  amount: number;
  duration: 5;
  duration_unit: "t";
  contract_type: "HIGHER" | "LOWER";
  barrier: string;
  symbol: string;
};

function normalizeClockWorkOrders(contracts: readonly ClockWorkOrder[]) {
  if (!Array.isArray(contracts) || contracts.length < 1 || contracts.length > 4) {
    throw new Error("Clock Work needs between one and four contracts.");
  }
  const normalized = contracts.map((contract) => ({
    ...contract,
    amount: roundCents(contract.amount),
  }));
  const keys = normalized.map((contract) => contract.key);
  if (keys.some((key) => !key.trim()) || new Set(keys).size !== keys.length) {
    throw new Error("Clock Work contract keys must be unique and non-empty.");
  }
  const symbols = new Set(normalized.map((contract) => contract.symbol));
  if (symbols.size !== 1) {
    throw new Error("All Clock Work contracts in one action must use the same market.");
  }
  for (const contract of normalized) {
    if (!Number.isFinite(contract.amount) || contract.amount < 1) {
      throw new Error("Clock Work stakes must be at least 1.00.");
    }
    if (contract.duration !== 5 || contract.duration_unit !== "t") {
      throw new Error("Clock Work supports five-tick contracts only.");
    }
    if (contract.contract_type !== "HIGHER" && contract.contract_type !== "LOWER") {
      throw new Error("Clock Work supports Higher and Lower contracts only.");
    }
    if (typeof contract.barrier !== "string" || !/^[+-]?\d+(?:\.\d+)?$/.test(contract.barrier)) {
      throw new Error("Clock Work needs a valid signed offset or absolute price barrier.");
    }
    validateProposalInput({
      amount: contract.amount,
      duration: contract.duration,
      duration_unit: contract.duration_unit,
      contract_type: contract.contract_type,
      barrier: contract.barrier,
      symbol: contract.symbol,
    });
  }
  return normalized;
}

function toClockWorkQuote(contract: ClockWorkOrder, proposal: DerivProposal) {
  return {
    key: contract.key,
    amount: contract.amount,
    contract_type: contract.contract_type,
    barrier: contract.barrier,
    symbol: contract.symbol,
    ask_price: proposal.ask_price,
    payout: proposal.payout,
    spot: proposal.spot,
    longcode: proposal.longcode,
  };
}

export async function quoteClockWorkContracts(input: { contracts: readonly ClockWorkOrder[] }) {
  const contracts = normalizeClockWorkOrders(input.contracts);
  if (!getState().account) throw new Error("Select a Deriv account before requesting Clock Work quotes.");
  const proposals = await Promise.all(contracts.map((contract) => requestFreshProposal({
    amount: contract.amount,
    duration: contract.duration,
    duration_unit: contract.duration_unit,
    contract_type: contract.contract_type,
    barrier: contract.barrier,
    symbol: contract.symbol,
  })));
  return { quotes: contracts.map((contract, index) => toClockWorkQuote(contract, proposals[index])) };
}

export async function buyClockWorkContracts(
  input: { contracts: readonly ClockWorkOrder[] },
  assertAuthorized?: TradeAuthorizationCheck,
) {
  await assertAuthorized?.();
  const contracts = normalizeClockWorkOrders(input.contracts);
  const account = getState().account;
  if (!account) throw new Error("Select a Deriv account before buying Clock Work contracts.");
  if (account.type === "real" && !liveTradingEnabled) {
    throw new Error("Live trading is disabled on this server.");
  }
  const totalStake = roundCents(contracts.reduce((total, contract) => total + contract.amount, 0));
  if (totalStake > account.balance) {
    throw new Error("The total Clock Work stake exceeds the current account balance.");
  }

  const proposals = await runBeforeBuy(async () => {
    const protection = await getTradingProtectionSettings();
    for (const contract of contracts) {
      assertTradingProtection(protection, getStatus(), {
        contract_type: contract.contract_type,
        symbol: contract.symbol,
      });
    }

    await refreshOpenContracts();
    assertNoActiveContract(true);
    const freshProposals = await Promise.all(contracts.map(async (contract) => ({
      contract,
      proposal: await requestFreshProposal({
        amount: contract.amount,
        duration: contract.duration,
        duration_unit: contract.duration_unit,
        contract_type: contract.contract_type,
        barrier: contract.barrier,
        symbol: contract.symbol,
      }),
    })));
    await assertAuthorized?.();
    if (!await connect()) throw new Error("Deriv WebSocket is not ready");
    await assertAuthorized?.();
    return freshProposals;
  });

  // All prices are quoted before any buy. Do not retry or auto-close a partial
  // batch: a buy acknowledgement timeout can be ambiguous, so the account
  // history must be checked before a user resubmits.
  const results = await sendBatchBuysTogether(proposals, ({ contract, proposal }) => sendDirectBuyWithRateLimitRetry(proposal, {
    amount: contract.amount,
    duration: contract.duration,
    duration_unit: contract.duration_unit,
    contract_type: contract.contract_type,
    barrier: contract.barrier,
    symbol: contract.symbol,
  }));
  const completed = results.flatMap((result, index) => result.status === "fulfilled"
    ? [{
        key: proposals[index].contract.key,
        amount: proposals[index].contract.amount,
        contract_type: proposals[index].contract.contract_type,
        barrier: proposals[index].contract.barrier,
        symbol: proposals[index].contract.symbol,
        proposal: proposals[index].proposal,
        buy: result.value,
      }]
    : []);
  const failed = results.flatMap((result, index) => result.status === "rejected"
    ? [{
        key: proposals[index].contract.key,
        contract_type: proposals[index].contract.contract_type,
        error: safeBuyFailureMessage(result.reason),
        ...classifyBuyFailure(result.reason),
      }]
    : []);
  const ok = failed.length === 0;
  return {
    ok,
    message: ok
      ? `${completed.length} Clock Work contract${completed.length === 1 ? "" : "s"} sent to Deriv.`
      : `${completed.length} of ${contracts.length} Clock Work contracts were confirmed. Check Deriv history before retrying any unconfirmed order.`,
    requested_count: contracts.length,
    completed_count: completed.length,
    contracts: completed,
    failed,
  };
}

function validateContractBarrier(input: { contract_type: DigitContractType; barrier?: number | string }) {
  if (input.contract_type === "HIGHER" || input.contract_type === "LOWER") {
    const barrier = input.barrier;
    if (typeof barrier !== "string" || !/^[+-]?\d+(?:\.\d+)?$/.test(barrier)) {
      throw new Error(`A relative or absolute price barrier is required for ${input.contract_type}.`);
    }
    return;
  }
  const requiresBarrier = input.contract_type === "DIGITDIFF"
    || input.contract_type === "DIGITOVER"
    || input.contract_type === "DIGITUNDER"
    || input.contract_type === "DIGITMATCH";
  const barrier = input.barrier;
  if (requiresBarrier && (typeof barrier !== "number" || !Number.isInteger(barrier) || barrier < 0 || barrier > 9)) {
    throw new Error(`A digit barrier from 0 to 9 is required for ${input.contract_type}.`);
  }
  if (input.contract_type === "DIGITOVER" && barrier === 9) {
    throw new Error("DIGITOVER barrier 9 offers no return. Choose a barrier from 0 to 8.");
  }
  if (input.contract_type === "DIGITUNDER" && barrier === 0) {
    throw new Error("DIGITUNDER barrier 0 offers no return. Choose a barrier from 1 to 9.");
  }
  if (!requiresBarrier && barrier != null) {
    throw new Error(`A digit barrier is not valid for ${input.contract_type}.`);
  }
}

function validateAccumulatorInput(input: {
  contract_type: DigitContractType;
  amount: number;
  duration?: number;
  growth_rate?: number;
}) {
  if (input.contract_type !== "ACCU") return;
  if (input.amount < 1) {
    throw new Error("Accumulator stakes must be at least 1.00.");
  }
  if (input.duration != null && (!Number.isInteger(input.duration) || input.duration < 5)) {
    throw new Error("Accumulator duration reference must be at least 5 ticks.");
  }
  if (
    input.growth_rate == null
    || !Number.isFinite(input.growth_rate)
    || input.growth_rate < 0.01
    || input.growth_rate > 0.05
  ) {
    throw new Error("Accumulator growth rate must be between 0.01 and 0.05.");
  }
}

function validateProposalInput(input: ProposalInput) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("A positive stake is required.");
  }
  if (!Number.isInteger(input.duration) || input.duration < 1) {
    throw new Error("A whole-number duration of at least 1 tick is required.");
  }
  if (input.duration_unit !== "t") {
    throw new Error("Only tick durations are supported.");
  }
  if (input.symbol != null && !supportedSymbols.has(input.symbol)) {
    throw new Error("That market is not supported.");
  }
  validateContractBarrier(input);
  if (input.contract_type === "ACCU") {
    validateAccumulatorInput(input);
  } else if (input.growth_rate != null) {
    throw new Error(`Growth rate is only valid for ACCU contracts, not ${input.contract_type}.`);
  }
}

export async function dualBuyContracts(input: {
  amount: number;
  duration: number;
  duration_unit: "t";
  barrier: number;
  symbol?: string;
}, assertAuthorized?: TradeAuthorizationCheck) {
  await assertAuthorized?.();
  const normalizedAmount = roundCents(input.amount);
  const commonInput = {
    amount: normalizedAmount,
    duration: input.duration,
    duration_unit: input.duration_unit,
    barrier: input.barrier,
    symbol: input.symbol,
  };
  validateProposalInput({ ...commonInput, contract_type: "DIGITOVER" });
  validateProposalInput({ ...commonInput, contract_type: "DIGITUNDER" });
  if (!getState().account) throw new Error("Select an account before buying contracts");
  if (getState().account.type === "real" && !liveTradingEnabled) {
    throw new Error("Live trading is disabled on this server");
  }
  if (normalizedAmount * 2 > getState().account.balance) {
    throw new Error("The selected dual stake exceeds the current account balance");
  }
  const proposals = await runBeforeBuy(async () => {
    const protection = await getTradingProtectionSettings();
    assertTradingProtection(protection, getStatus(), { ...input, contract_type: "DIGITOVER" });
    assertTradingProtection(protection, getStatus(), { ...input, contract_type: "DIGITUNDER" });
    await refreshOpenContracts();
    assertNoActiveContract(true);

    const freshProposals: Array<{ proposal: DerivProposal; input: ProposalInput }> = [];
    for (const contract_type of ["DIGITOVER", "DIGITUNDER"] as const) {
      await assertAuthorized?.();
      const proposal = await requestFreshProposal({
        amount: normalizedAmount,
        duration: input.duration,
        duration_unit: input.duration_unit,
        contract_type,
        barrier: input.barrier,
        symbol: input.symbol,
      });
      const buyInput = {
        amount: normalizedAmount,
        duration: input.duration,
        duration_unit: input.duration_unit,
        contract_type,
        barrier: input.barrier,
        symbol: input.symbol,
      } satisfies ProposalInput;
      freshProposals.push({ proposal, input: buyInput });
    }
    await assertAuthorized?.();
    if (!await connect()) throw new Error("Deriv WebSocket is not ready");
    await assertAuthorized?.();
    return freshProposals;
  });
   const buyResults = await sendBatchBuysTogether(
     proposals,
     ({ proposal, input: buyInput }) => sendDirectBuyWithRateLimitRetry(proposal, buyInput),
   );
  const failedBuy = buyResults.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failedBuy) {
     const failureClass = classifyBuyFailure(failedBuy.reason);
     const hasConfirmedBuy = buyResults.some((result) => result.status === "fulfilled");
     const error = Object.assign(
       new Error(`Dual buy could not be fully confirmed. ${safeBuyFailureMessage(failedBuy.reason)}`),
       {
         diagnosticSource: failureClass.source,
         tradeOutcome: hasConfirmedBuy ? "uncertain" as const : failureClass.outcome,
       },
     );
     if (isDerivBuyRateLimitError(failedBuy.reason)) Object.assign(error, { code: "DERIV_BUY_RATE_LIMITED" });
     throw error;
  }

  return {
    ok: true,
    count: proposals.length,
    message: getState().account.type === "real"
      ? "Dual Mode sent one live Over and one live Under request."
      : "Dual Mode sent one demo Over and one demo Under request.",
    proposals: proposals.map(({ proposal }) => proposal),
    buys: buyResults.map((result) => (result as PromiseFulfilledResult<DerivBuy>).value),
    failed: [],
  };
}

export function getHistory() {
  const accountId = getState().account?.id ?? getState().selectedAccountId;
  if (!accountId) return [];
  return getState().history.filter((item: DerivHistoryItem) => item.account_id === accountId);
}

export function subscribeDerivHistoryUpdates(listener: (item: DerivHistoryItem) => void) {
  const runtime = getState();
  runtime.historyListeners.add(listener);
  return () => runtime.historyListeners.delete(listener);
}

export function subscribeDerivMarketTickUpdates(listener: (tick: DerivMarketTickUpdate) => void) {
  const runtime = getState();
  runtime.marketTickListeners.add(listener);
  return () => runtime.marketTickListeners.delete(listener);
}

export function clearHistory() {
  const visibleHistory = getHistory();
  for (const item of visibleHistory) getState().hiddenHistoryIds.add(historyKey(item));
  const accountId = getState().account?.id ?? getState().selectedAccountId;
  getState().history = getState().history.filter((item: DerivHistoryItem) => item.account_id !== accountId);
  return { ok: true, message: "Recent dashboard trade rows for this account were cleared. Deriv records were not deleted." };
}

export function startDeriv() {
}

export function stopDeriv() {
  clearInterval(runtimeReaper);
  for (const userId of runtimes.keys()) disposeUser(userId);
}