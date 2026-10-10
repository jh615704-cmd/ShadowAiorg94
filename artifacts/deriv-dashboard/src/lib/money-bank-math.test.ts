import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateRecoveryLadder, estimateAccumulatorReturnRate } from "./money-bank-math.ts";

const ladderInput = {
  strategy: "budget" as const,
  budget: 10,
  manualBase: 1,
  growthRate: 1,
  takeProfitTicks: 5,
};

describe("Money Bank Accumulator return estimates", () => {
  it("uses the selected growth and tick count without imposing an 8% payout floor", () => {
    assert.equal(estimateAccumulatorReturnRate(1, 5), Math.pow(1.01, 5) - 1);
  });

  it("keeps the full theoretical return at the highest supported settings", () => {
    assert.equal(estimateAccumulatorReturnRate(5, 50), Math.pow(1.05, 50) - 1);
  });
});

describe("Money Bank recovery budget", () => {
  it("keeps a $10 budget within the planned total across all seven levels", () => {
    const ladder = calculateRecoveryLadder(ladderInput);

    assert.equal(ladder.length, 7);
    assert.ok(ladder.every((level) => level.stake >= 1));
    assert.ok(ladder.at(-1)!.cumulative <= 10);
    assert.ok(ladder.at(-1)!.cumulative >= 9.9);
  });

  it("shows only as many minimum-stake levels as a smaller budget can cover", () => {
    const ladder = calculateRecoveryLadder({ ...ladderInput, budget: 5 });

    assert.equal(ladder.length, 5);
    assert.ok(ladder.every((level) => level.stake >= 1));
    assert.ok(ladder.at(-1)!.cumulative <= 5);
  });

  it("does not create a stake plan when the budget cannot cover the minimum contract stake", () => {
    const ladder = calculateRecoveryLadder({ ...ladderInput, budget: 0.5 });

    assert.deepEqual(ladder, []);
  });

  it("keeps reinvested budget-mode BASE increases inside the same cycle cap", () => {
    const ladder = calculateRecoveryLadder({ ...ladderInput, preferredBase: 1.2 });

    assert.ok(ladder[0].stake > 1);
    assert.ok(ladder.at(-1)!.cumulative <= 10);
  });

  it("keeps the full manual ladder independent from the Auto Budget cap", () => {
    const ladder = calculateRecoveryLadder({
      ...ladderInput,
      strategy: "manual",
      budget: 5,
      manualBase: 1,
    });

    assert.equal(ladder.length, 7);
    assert.ok(ladder.at(-1)!.cumulative > 5);
  });
});