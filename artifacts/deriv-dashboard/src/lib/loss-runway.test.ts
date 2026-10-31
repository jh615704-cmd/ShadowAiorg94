import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateLossRunway,
  getLossLimitRunwayMessage,
  getLossRunwayMessage,
} from "./loss-runway.ts";

const defaults = {
  balance: 100,
  baseStake: 1,
  nextStake: 1,
  stakeMode: "multiply" as const,
  multiplier: 2,
  takeProfit: 20,
  lossLimit: 7,
  sessionPnl: 0,
};

test("estimates consecutive losses to the session loss limit and balance", () => {
  const estimate = estimateLossRunway(defaults);

  assert.equal(estimate.lossesToSessionLossLimit, 3);
  assert.equal(estimate.lossesUntilBalanceBlocked, 6);
  assert.equal(estimate.balanceExhausted, false);
});

test("estimates when the current balance cannot fund another multiplied stake", () => {
  const estimate = estimateLossRunway({
    ...defaults,
    balance: 5,
    baseStake: 2,
    nextStake: 2,
    lossLimit: 100,
  });

  assert.equal(estimate.lossesUntilBalanceBlocked, 1);
  assert.equal(estimate.balanceExhausted, false);
});

test("counts the final full-stake loss when it exhausts the balance", () => {
  const estimate = estimateLossRunway({
    ...defaults,
    balance: 2.5,
    baseStake: 1.25,
    nextStake: 1.25,
    stakeMode: "flat",
    multiplier: 2,
    takeProfit: 0,
    lossLimit: 0,
  });

  assert.equal(estimate.lossesToSessionLossLimit, null);
  assert.equal(estimate.lossesUntilBalanceBlocked, 2);
  assert.equal(estimate.balanceExhausted, true);
});

test("includes current session P/L when estimating the remaining loss limit", () => {
  const estimate = estimateLossRunway({
    ...defaults,
    baseStake: 1.5,
    nextStake: 1.5,
    stakeMode: "flat",
    multiplier: 1,
    lossLimit: 5,
    sessionPnl: 2,
  });

  assert.equal(estimate.lossesToSessionLossLimit, 5);
});

test("shows only the consecutive-loss estimate for a configured session loss limit", () => {
  const message = getLossRunwayMessage({
    balance: 100,
    baseStake: 1,
    nextStake: 1,
    stakeMode: "flat",
    multiplier: 2,
    takeProfit: 0,
    lossLimit: 10,
    sessionPnl: 0,
  }, "USD");

  assert.equal(
    message,
    "10 consecutive full-stake losses could reach the $10.00 session loss limit.",
  );
  assert.doesNotMatch(message, /Current plan|profit target|balance|win-rate/i);
});

test("calculates the Clock Work loss message from its stake, multiplier, and loss limit", () => {
  const message = getLossLimitRunwayMessage({
    balance: null,
    baseStake: 1,
    nextStake: 1,
    stakeMode: "multiply",
    multiplier: 2,
    takeProfit: 5,
    lossLimit: 10,
    sessionPnl: 0,
  }, "USD");
  assert.equal(
    message,
    "4 consecutive full-stake losses could reach the $10.00 session loss limit.",
  );

  const changedSettingsMessage = getLossLimitRunwayMessage({
    balance: null,
    baseStake: 2,
    nextStake: 2,
    stakeMode: "multiply",
    multiplier: 1,
    takeProfit: 5,
    lossLimit: 10,
    sessionPnl: 0,
  }, "USD");
  assert.equal(
    changedSettingsMessage,
    "5 consecutive full-stake losses could reach the $10.00 session loss limit.",
  );
});

test("keeps the no-limit estimate concise", () => {
  const message = getLossRunwayMessage({
    ...defaults,
    takeProfit: 0,
    lossLimit: 0,
  }, "USD");

  assert.equal(
    message,
    "Set a session loss limit to see the consecutive-loss estimate.",
  );
});

test("reports an already reached profit target and does not imply a win rate", () => {
  const estimate = estimateLossRunway({
    ...defaults,
    sessionPnl: 20,
  });
  const message = getLossRunwayMessage(
    { ...defaults, sessionPnl: 20 },
    "USD",
  );

  assert.equal(estimate.profitTargetReached, true);
  assert.match(message, /Profit target.*already reached/);
  assert.doesNotMatch(message, /high win rate/i);
});
