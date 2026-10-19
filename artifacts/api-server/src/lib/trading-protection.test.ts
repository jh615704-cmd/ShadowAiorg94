import assert from "node:assert/strict";
import test from "node:test";
import { assertTradingProtection } from "./trading-protection.ts";

const settings = {
  weekdaysEnabled: false,
  weekendsEnabled: false,
  dualWeekendsWeekdaysEnabled: true,
};

const status = (digit: number, overPercentage: number, underPercentage: number) => ({
  symbol: "R_75",
  market_signals: [{
    symbol: "R_75",
    sample_count: 100,
    digit_even_percentage: 50,
    digit_odd_percentage: 50,
    rise_percentage: 50,
    fall_percentage: 50,
    digit_outcomes: [{
      digit,
      over_percentage: overPercentage,
      under_percentage: underPercentage,
    }],
  }],
});

test("DIGITMATCH applies global protection to the selected digit's observed match rate", () => {
  assert.throws(
    () => assertTradingProtection(settings, status(3, 70, 20), {
      contract_type: "DIGITMATCH",
      barrier: 3,
      symbol: "R_75",
    }),
    /Global trading protection/,
  );

  assert.doesNotThrow(() => assertTradingProtection(settings, status(3, 20, 20), {
    contract_type: "DIGITMATCH",
    barrier: 3,
    symbol: "R_75",
  }));
});

