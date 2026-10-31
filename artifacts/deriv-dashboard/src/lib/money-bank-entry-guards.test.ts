import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MoneyBankStartConfig } from "../components/money-bank-panel.tsx";
import {
  getMoneyBankSessionStopReason,
  getMoneyBankStartConfigError,
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
