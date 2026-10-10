const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const roundCents = (value: number) => Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
const floorCents = (value: number) => Math.floor((value + 1e-9) * 100) / 100;
const MIN_STAKE = 1;
const RECOVERY_LEVEL_NAMES = ["BASE", "L1", "L2", "L3", "L4", "L5", "L6"] as const;

export type MoneyBankStrategy = "budget" | "manual";

export type MoneyBankLadderLevel = {
  name: string;
  stake: number;
  cumulative: number;
  profit: number;
};

export function estimateAccumulatorReturnRate(growthRatePercent: number, ticks: number) {
  const growth = clamp(growthRatePercent, 1, 5) / 100;
  const duration = clamp(ticks, 5, 50);
  return Math.pow(1 + growth, duration) - 1;
}

export function calculateRecoveryLadder(input: {
  strategy: MoneyBankStrategy;
  budget: number;
  manualBase: number;
  growthRate: number;
  takeProfitTicks: number;
  preferredBase?: number;
}): MoneyBankLadderLevel[] {
  const payout = estimateAccumulatorReturnRate(input.growthRate, input.takeProfitTicks);
  const requestedRatio = clamp(1.12 + (0.08 / (payout + 0.16)), 1.14, 1.42);
  const requestedBudget = Number.isFinite(input.budget) ? input.budget : MIN_STAKE;
  if (input.strategy === "budget" && requestedBudget < MIN_STAKE) return [];
  const budget = roundCents(Math.max(MIN_STAKE, requestedBudget));
  const levelCount = input.strategy === "budget"
    ? Math.min(RECOVERY_LEVEL_NAMES.length, Math.max(1, Math.floor(budget + 1e-9)))
    : RECOVERY_LEVEL_NAMES.length;
  const levelNames = RECOVERY_LEVEL_NAMES.slice(0, levelCount);

  const makePlan = (ratio: number) => {
    const factors = levelNames.map((_, index) => Math.pow(ratio, index));
    const factorTotal = factors.reduce((sum, factor) => sum + factor, 0);
    let base: number;
    if (input.strategy === "budget") {
      const maximumBudgetBase = Math.max(MIN_STAKE, floorCents(budget / levelCount));
      base = input.preferredBase != null && Number.isFinite(input.preferredBase)
        ? roundCents(Math.min(maximumBudgetBase, Math.max(MIN_STAKE, input.preferredBase)))
        : Math.max(MIN_STAKE, floorCents(budget / factorTotal));
    } else {
      base = roundCents(Math.max(
        MIN_STAKE,
        Number.isFinite(input.manualBase) ? input.manualBase : MIN_STAKE,
      ));
    }

    const stakes = factors.map((factor) => roundCents(Math.max(MIN_STAKE, base * factor)));
    const total = roundCents(stakes.reduce((sum, stake) => roundCents(sum + stake), 0));
    return { base, stakes, total };
  };

  let ratio = requestedRatio;
  let plan = makePlan(ratio);
  if (input.strategy === "budget" && plan.total > budget) {
    let lowerRatio = 1;
    let upperRatio = requestedRatio;
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const candidateRatio = (lowerRatio + upperRatio) / 2;
      if (makePlan(candidateRatio).total <= budget) lowerRatio = candidateRatio;
      else upperRatio = candidateRatio;
    }
    ratio = lowerRatio;
    plan = makePlan(ratio);
  }

  let cumulative = 0;
  return levelNames.map((name, index) => {
    const stake = plan.stakes[index] ?? MIN_STAKE;
    cumulative = roundCents(cumulative + stake);
    return {
      name,
      stake,
      cumulative,
      profit: roundCents(stake * payout),
    };
  });
}