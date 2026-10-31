import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MoneyBankStartConfig } from "../components/money-bank-panel.tsx";
import {
  checkMoneyBankJdySignal,
  getMoneyBankSessionStopReason,
  getMoneyBankStartConfigError,
  MONEY_BANK_JDY_MAX_TICK_AGE_SECONDS,
  MONEY_BANK_JDY_MIN_SAMPLES,
  shouldRunMoneyBankJdyGate,
} from "./money-bank-entry-guards.ts";

const validConfig: MoneyBankStartConfig = {
  symbol: "1HZ10V",
  growthRate: 4,
  takeProfitTicks: 5,
  autoKnockout: true,
  knockoutsBeforeTrade: 5,
  strategy: "budget",
  budget: 2.2,
  manualBase: 1,
  ladder: [
    { name: "BASE", stake: 1, cumulative: 1, profit: 0.2 },
    { name: "L1", stake: 1.2, cumulative: 2.2, profit: 0.24 },
  ],
  reinvestProfit: false,
  reinvestPercent: 100,
  profitTarget: 5,
  lossLimit: 4,
};

describe("Money Bank entry safeguards", () => {
  it("accepts a valid plan whose budget is affordable", () => {
    assert.equal(
      getMoneyBankStartConfigError(validConfig, 2.2, ["1HZ10V"]),
      null,
    );
  });

  it("rejects malformed settings and inconsistent ladder totals", () => {
    assert.match(
      getMoneyBankStartConfigError({ ...validConfig, takeProfitTicks: 4 }, 10, ["1HZ10V"]) ?? "",
      /duration/,
    );
    assert.match(
      getMoneyBankStartConfigError({
        ...validConfig,
        ladder: [{ ...validConfig.ladder[0], cumulative: 1.5 }],
      }, 10, ["1HZ10V"]) ?? "",
      /totals/,
    );
    assert.match(
      getMoneyBankStartConfigError({ ...validConfig, knockoutsBeforeTrade: 0 }, 10, ["1HZ10V"]) ?? "",
      /1 to 20 qualifying knockouts/,
    );
  });

  it("rejects a budget cycle above balance while allowing manual mode to check each stake", () => {
    assert.match(
      getMoneyBankStartConfigError(validConfig, 2.19, ["1HZ10V"]) ?? "",
      /cycle exceeds/,
    );
    assert.equal(
      getMoneyBankStartConfigError({ ...validConfig, strategy: "manual" }, 2.19, ["1HZ10V"]),
      null,
    );
  });

  it("uses exact session-limit boundaries", () => {
    assert.equal(getMoneyBankSessionStopReason(5, validConfig), "Money Bank reached the session Profit target.");
    assert.equal(getMoneyBankSessionStopReason(-4, validConfig), "Money Bank reached the session Loss limit.");
    assert.equal(getMoneyBankSessionStopReason(4.99, validConfig), null);
  });
});

describe("Money Bank AI entry gate", () => {
  it("always requires AI approval after Auto Knockout completes its sample", () => {
    assert.equal(shouldRunMoneyBankJdyGate({
      autoKnockout: true,
      jdyEnabled: false,
      knockoutSampleComplete: false,
    }), false);
    assert.equal(shouldRunMoneyBankJdyGate({
      autoKnockout: true,
      jdyEnabled: false,
      knockoutSampleComplete: true,
    }), true);
    assert.equal(shouldRunMoneyBankJdyGate({
      autoKnockout: true,
      jdyEnabled: true,
      knockoutSampleComplete: false,
    }), false);
    assert.equal(shouldRunMoneyBankJdyGate({
      autoKnockout: true,
      jdyEnabled: true,
      knockoutSampleComplete: true,
    }), true);
  });

  it("keeps manual Money Bank AI review controlled by JDY", () => {
    assert.equal(shouldRunMoneyBankJdyGate({
      autoKnockout: false,
      jdyEnabled: false,
      knockoutSampleComplete: false,
    }), false);
    assert.equal(shouldRunMoneyBankJdyGate({
      autoKnockout: false,
      jdyEnabled: true,
      knockoutSampleComplete: false,
    }), true);
  });
});

describe("Money Bank JDY entry signal", () => {
  const now = 1_800_000_000;

  it("accepts only a fresh, sufficiently sampled, valid upward movement signal", () => {
    const result = checkMoneyBankJdySignal({
      symbol: "1HZ10V",
      sample_count: MONEY_BANK_JDY_MIN_SAMPLES,
      tick_epoch: now,
      rise_percentage: 62,
    }, now);

    assert.deepEqual(result, {
      ready: true,
      sampleCount: MONEY_BANK_JDY_MIN_SAMPLES,
      observedBalance: 62,
      reason: null,
    });
  });

  it("holds on insufficient or stale market data", () => {
    const signal = {
      symbol: "1HZ10V",
      sample_count: MONEY_BANK_JDY_MIN_SAMPLES - 1,
      tick_epoch: now,
      rise_percentage: 70,
    };
    assert.match(checkMoneyBankJdySignal(signal, now).reason ?? "", /at least/);
    assert.match(checkMoneyBankJdySignal({
      ...signal,
      sample_count: MONEY_BANK_JDY_MIN_SAMPLES,
      tick_epoch: now - MONEY_BANK_JDY_MAX_TICK_AGE_SECONDS - 1,
    }, now).reason ?? "", /stale/);
  });

  it("rejects invalid direction percentages instead of treating them as safe", () => {
    assert.equal(checkMoneyBankJdySignal({
      symbol: "1HZ10V",
      sample_count: MONEY_BANK_JDY_MIN_SAMPLES,
      tick_epoch: now,
      rise_percentage: 101,
    }, now).ready, false);
  });
});
