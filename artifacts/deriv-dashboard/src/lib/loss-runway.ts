const MAX_ESTIMATED_LOSSES = 10_000;

export type LossRunwayStakeMode = "flat" | "multiply" | "martingale";

export type LossRunwayEstimateInput = {
  balance: number | null | undefined;
  baseStake: number;
  nextStake: number;
  stakeMode: LossRunwayStakeMode;
  multiplier: number;
  takeProfit: number;
  lossLimit: number;
  sessionPnl: number;
};

export type LossRunwayEstimate = {
  valid: boolean;
  balanceAvailable: boolean;
  profitTargetReached: boolean;
  lossLimitReached: boolean;
  lossesToSessionLossLimit: number | null;
  lossesUntilBalanceBlocked: number | null;
  balanceExhausted: boolean;
  calculationCapped: boolean;
};

function roundMoney(value: number) {
  return Number.isFinite(value)
    ? Math.round((value + Number.EPSILON) * 100) / 100
    : value;
}

function isValidInput(input: LossRunwayEstimateInput) {
  return (
    Number.isFinite(input.baseStake)
    && input.baseStake > 0
    && Number.isFinite(input.nextStake)
    && input.nextStake > 0
    && Number.isFinite(input.multiplier)
    && input.multiplier > 0
    && Number.isFinite(input.takeProfit)
    && input.takeProfit >= 0
    && Number.isFinite(input.lossLimit)
    && input.lossLimit >= 0
    && Number.isFinite(input.sessionPnl)
    && ["flat", "multiply", "martingale"].includes(input.stakeMode)
  );
}

function followingStake(input: LossRunwayEstimateInput, currentStake: number) {
  return roundMoney(
    input.stakeMode === "flat"
      ? input.baseStake
      : currentStake * input.multiplier,
  );
}

export function estimateLossRunway(
  input: LossRunwayEstimateInput,
): LossRunwayEstimate {
  const valid = isValidInput(input);
  const balanceAvailable =
    Number.isFinite(input.balance) && (input.balance ?? 0) > 0;

  if (!valid) {
    return {
      valid: false,
      balanceAvailable,
      profitTargetReached: false,
      lossLimitReached: false,
      lossesToSessionLossLimit: null,
      lossesUntilBalanceBlocked: null,
      balanceExhausted: false,
      calculationCapped: false,
    };
  }

  const profitTargetReached =
    input.takeProfit > 0 && input.sessionPnl >= input.takeProfit;
  const lossLimitReached =
    input.lossLimit > 0 && input.sessionPnl <= -input.lossLimit;

  let lossesToSessionLossLimit: number | null = null;
  let calculationCapped = false;
  if (input.lossLimit > 0) {
    let remainingLossRoom = roundMoney(input.lossLimit + input.sessionPnl);
    let plannedStake = roundMoney(
      input.stakeMode === "flat" ? input.baseStake : input.nextStake,
    );
    if (remainingLossRoom <= 0) {
      lossesToSessionLossLimit = 0;
    } else {
      for (let losses = 0; losses < MAX_ESTIMATED_LOSSES; losses += 1) {
        if (!Number.isFinite(plannedStake) || plannedStake <= 0) break;
        remainingLossRoom = roundMoney(remainingLossRoom - plannedStake);
        if (remainingLossRoom <= 0) {
          lossesToSessionLossLimit = losses + 1;
          break;
        }
        plannedStake = followingStake(input, plannedStake);
      }
      if (lossesToSessionLossLimit === null && plannedStake > 0) {
        lossesToSessionLossLimit = MAX_ESTIMATED_LOSSES;
        calculationCapped = true;
      }
    }
  }

  let lossesUntilBalanceBlocked: number | null = null;
  let balanceExhausted = false;
  if (balanceAvailable) {
    let remainingBalance = roundMoney(input.balance ?? 0);
    let plannedStake = roundMoney(
      input.stakeMode === "flat" ? input.baseStake : input.nextStake,
    );
    for (let losses = 0; losses < MAX_ESTIMATED_LOSSES; losses += 1) {
      if (!Number.isFinite(plannedStake) || plannedStake <= 0) {
        lossesUntilBalanceBlocked = losses;
        break;
      }
      if (plannedStake > remainingBalance) {
        lossesUntilBalanceBlocked = losses;
        break;
      }
      remainingBalance = roundMoney(remainingBalance - plannedStake);
      const completedLosses = losses + 1;
      if (remainingBalance <= 0) {
        lossesUntilBalanceBlocked = completedLosses;
        balanceExhausted = true;
        break;
      }
      plannedStake = followingStake(input, plannedStake);
      if (completedLosses === MAX_ESTIMATED_LOSSES) {
        lossesUntilBalanceBlocked = MAX_ESTIMATED_LOSSES;
        calculationCapped = true;
      }
    }
  }

  return {
    valid: true,
    balanceAvailable,
    profitTargetReached,
    lossLimitReached,
    lossesToSessionLossLimit,
    lossesUntilBalanceBlocked,
    balanceExhausted,
    calculationCapped,
  };
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatLossCount(losses: number, capped: boolean) {
  const count = losses.toLocaleString();
  return capped ? `at least ${count}` : count;
}

export function getLossRunwayMessage(
  input: LossRunwayEstimateInput,
  currency: string,
) {
  const estimate = estimateLossRunway(input);
  if (!estimate.valid) {
    return "Set a valid stake, multiplier, and session limits to see the loss estimate.";
  }

  const targetText =
    input.takeProfit > 0
      ? formatMoney(input.takeProfit, currency)
      : "off";
  const lossLimitText =
    input.lossLimit > 0
      ? formatMoney(input.lossLimit, currency)
      : "off";

  if (estimate.profitTargetReached) {
    return `Profit target ${targetText} is already reached, so the run should stop before another entry.`;
  }
  if (estimate.lossLimitReached) {
    return `Session loss limit ${lossLimitText} is already reached, so the run should stop before another entry.`;
  }

  if (estimate.lossesToSessionLossLimit === null) {
    return "Set a session loss limit to see the consecutive-loss estimate.";
  }

  return `${formatLossCount(estimate.lossesToSessionLossLimit, estimate.calculationCapped)} consecutive full-stake losses could reach the ${lossLimitText} session loss limit.`;
}

export function getLossLimitRunwayMessage(
  input: LossRunwayEstimateInput,
  currency: string,
) {
  const estimate = estimateLossRunway(input);
  if (!estimate.valid) {
    return "Set a valid stake, multiplier, and session loss limit to see the loss estimate.";
  }
  if (input.lossLimit === 0 || estimate.lossesToSessionLossLimit === null) {
    return "Set a session loss limit to see the consecutive-loss estimate.";
  }

  const lossLimitText = formatMoney(input.lossLimit, currency);
  return `${formatLossCount(estimate.lossesToSessionLossLimit, estimate.calculationCapped)} consecutive full-stake losses could reach the ${lossLimitText} session loss limit.`;
}
