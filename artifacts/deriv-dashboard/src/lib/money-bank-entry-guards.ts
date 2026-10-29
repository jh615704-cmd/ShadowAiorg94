import type { MoneyBankMarketSignal, MoneyBankStartConfig } from "../components/money-bank-panel";

const MIN_STAKE = 1;
const MAX_LADDER_LEVELS = 7;
const LADDER_LEVEL_NAMES = ["BASE", "L1", "L2", "L3", "L4", "L5", "L6"] as const;

export const MONEY_BANK_JDY_MIN_SAMPLES = 20;
export const MONEY_BANK_JDY_MAX_TICK_AGE_SECONDS = 5;

const roundCents = (value: number) =>
  Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));

export function getMoneyBankStartConfigError(
  config: MoneyBankStartConfig,
  availableBalance: number | null | undefined,
  supportedSymbols: readonly string[],
  enforceCycleBalance = true,
): string | null {
  if (!supportedSymbols.includes(config.symbol)) {
    return "Select a supported Money Bank volatility market before starting.";
  }
  if (!Number.isInteger(config.growthRate) || config.growthRate < 1 || config.growthRate > 5) {
    return "Money Bank growth rate must be a whole number from 1% to 5%.";
  }
  if (!Number.isInteger(config.takeProfitTicks) || config.takeProfitTicks < 5 || config.takeProfitTicks > 50) {
    return "Money Bank duration must be a whole number from 5 to 50 ticks.";
  }
  if (config.strategy !== "budget" && config.strategy !== "manual") {
    return "Choose a valid Money Bank stake strategy.";
  }
  if (config.strategy === "budget" && (!Number.isFinite(config.budget) || config.budget < MIN_STAKE)) {
    return "The Auto Budget must cover at least one minimum Accumulator stake.";
  }
  if (config.strategy === "manual" && (!Number.isFinite(config.manualBase) || config.manualBase < MIN_STAKE)) {
    return "Manual BASE must be at least the minimum Accumulator stake.";
  }
  if (typeof config.autoKnockout !== "boolean") {
    return "Money Bank Auto Knockout setting is invalid.";
  }
  if (
    typeof config.reinvestProfit !== "boolean"
    || !Number.isFinite(config.reinvestPercent)
    || config.reinvestPercent < 0
    || config.reinvestPercent > 100
  ) {
    return "Money Bank reinvest settings are invalid.";
  }
  for (const [label, limit] of [["Profit target", config.profitTarget], ["Loss limit", config.lossLimit]] as const) {
    if (limit != null && (!Number.isFinite(limit) || limit < 0)) {
      return `Money Bank ${label.toLowerCase()} must be a valid non-negative amount.`;
    }
  }
  if (!Array.isArray(config.ladder) || config.ladder.length === 0 || config.ladder.length > MAX_LADDER_LEVELS) {
    return "Money Bank needs a valid recovery plan before starting.";
  }

  let cumulative = 0;
  for (const [index, level] of config.ladder.entries()) {
    const expectedName = LADDER_LEVEL_NAMES[index];
    if (
      !level
      || level.name !== expectedName
      || !Number.isFinite(level.stake)
      || level.stake < MIN_STAKE
      || Math.abs(level.stake - roundCents(level.stake)) > 0.001
      || !Number.isFinite(level.profit)
      || level.profit < 0
    ) {
      return "Money Bank recovery plan contains an invalid stake.";
    }
    cumulative = roundCents(cumulative + level.stake);
    if (!Number.isFinite(level.cumulative) || Math.abs(level.cumulative - cumulative) > 0.01) {
      return "Money Bank recovery plan totals do not match its stakes.";
    }
  }

  const balance = availableBalance;
  if (balance == null || !Number.isFinite(balance) || balance <= 0) {
    return "Wait for a fresh positive Deriv balance before starting Money Bank.";
  }
  if (config.ladder[0].stake > balance) {
    return "The calculated BASE is higher than the connected account balance.";
  }
  if (config.strategy === "budget" && cumulative > roundCents(config.budget)) {
    return "The planned recovery cycle exceeds the selected Auto Budget.";
  }
  if (config.strategy === "manual" && config.ladder[0].stake !== roundCents(config.manualBase)) {
    return "The planned BASE does not match the selected Manual BASE.";
  }
  if (config.strategy === "budget" && enforceCycleBalance && cumulative > balance) {
    return "The planned Auto Budget cycle exceeds the connected balance. Lower the budget before starting.";
  }
  return null;
}

export type MoneyBankJdySignalCheck = {
  ready: boolean;
  sampleCount: number;
  observedBalance: number | null;
  reason: string | null;
};

export function checkMoneyBankJdySignal(
  signal: MoneyBankMarketSignal | null | undefined,
  nowEpoch = Math.floor(Date.now() / 1000),
): MoneyBankJdySignalCheck {
  if (!signal) {
    return { ready: false, sampleCount: 0, observedBalance: null, reason: "the selected market has no live sample" };
  }

  const sampleCount = Number.isInteger(signal.sample_count) && signal.sample_count >= 0
    ? signal.sample_count
    : 0;
  if (sampleCount < MONEY_BANK_JDY_MIN_SAMPLES) {
    return {
      ready: false,
      sampleCount,
      observedBalance: null,
      reason: `the selected market needs at least ${MONEY_BANK_JDY_MIN_SAMPLES} recent samples`,
    };
  }

  const tickEpoch = signal.tick_epoch;
  const age = nowEpoch - (tickEpoch ?? 0);
  if (
    !Number.isFinite(tickEpoch)
    || tickEpoch! <= 0
    || age < -2
    || age > MONEY_BANK_JDY_MAX_TICK_AGE_SECONDS
  ) {
    return { ready: false, sampleCount, observedBalance: null, reason: "the selected market data is stale" };
  }

  const observedBalance = signal.rise_percentage;
  if (
    !Number.isFinite(observedBalance)
    || observedBalance! < 0
    || observedBalance! > 100
  ) {
    return { ready: false, sampleCount, observedBalance: null, reason: "the selected market direction data is invalid" };
  }

  return { ready: true, sampleCount, observedBalance: observedBalance!, reason: null };
}

export function getMoneyBankSessionStopReason(
  sessionPnl: number,
  config: Pick<MoneyBankStartConfig, "profitTarget" | "lossLimit">,
) {
  if (!Number.isFinite(sessionPnl)) return "Money Bank stopped because session P/L is invalid.";
  if (config.profitTarget != null && config.profitTarget > 0 && sessionPnl >= config.profitTarget) {
    return "Money Bank reached the session Profit target.";
  }
  if (config.lossLimit != null && config.lossLimit > 0 && sessionPnl <= -config.lossLimit) {
    return "Money Bank reached the session Loss limit.";
  }
  return null;
}
