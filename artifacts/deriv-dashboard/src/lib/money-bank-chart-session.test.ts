import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceMoneyBankChartSession,
  startMoneyBankChartSession,
} from "./money-bank-chart-session.ts";

test("a selected market starts with an empty line and zero ticks", () => {
  assert.deepEqual(startMoneyBankChartSession("R_10", 250), {
    symbol: "R_10",
    lastSequence: 250,
    tickCount: 0,
    quotes: [],
  });
});

test("a market switch resets the line and begins counting only new ticks", () => {
  const current = {
    symbol: "R_10",
    lastSequence: 250,
    tickCount: 8,
    quotes: [100, 101],
  };

  const switched = advanceMoneyBankChartSession(current, "R_25", 780, [200, 201, 202]);
  const updated = advanceMoneyBankChartSession(switched, "R_25", 782, [200, 201, 202, 203, 204]);

  assert.deepEqual(switched, {
    symbol: "R_25",
    lastSequence: 780,
    tickCount: 0,
    quotes: [],
  });
  assert.deepEqual(updated, {
    symbol: "R_25",
    lastSequence: 782,
    tickCount: 2,
    quotes: [203, 204],
  });
});

test("manual reset counts from the current sequence without reusing recent history", () => {
  const reset = startMoneyBankChartSession("R_10", 100);
  const updated = advanceMoneyBankChartSession(reset, "R_10", 102, [98, 99, 100, 101, 102]);

  assert.equal(updated.tickCount, 2);
  assert.deepEqual(updated.quotes, [101, 102]);
});

test("a Deriv sequence restart rebases the chart at zero", () => {
  const current = {
    symbol: "R_10",
    lastSequence: 500,
    tickCount: 20,
    quotes: [100, 101, 102],
  };

  const restarted = advanceMoneyBankChartSession(current, "R_10", 3, [200, 201, 202]);

  assert.equal(restarted.lastSequence, 3);
  assert.equal(restarted.tickCount, 0);
  assert.deepEqual(restarted.quotes, []);
});
