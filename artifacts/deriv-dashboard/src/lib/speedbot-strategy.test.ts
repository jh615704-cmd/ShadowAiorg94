import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseSpeedbotCandidate,
  getSpeedbotNextStake,
  getSpeedbotSessionStopReason,
} from "./speedbot-strategy.ts";
import type { AutoMagicSignal } from "./auto-magic-strategy.ts";
import type { DerivHistoryRow } from "./deriv-history.ts";

const speedbotRow = (
  contractId: string,
  status: string,
  profit: number,
  buyTime: number,
  accountId = "account-1",
): DerivHistoryRow => ({
  contract_id: contractId,
  account_id: accountId,
  contract_type: "DIGITDIFF",
  symbol: "1HZ10V",
  account_type: "demo",
  barrier: 5,
  duration: 1,
  duration_unit: "t",
  buy_price: 0.35,
  current_value: 0.35 + profit,
  payout: 0.7,
  profit,
  status,
  buy_time: buyTime,
  sell_time: buyTime + 1,
});

function signal(digits: number[]): AutoMagicSignal {
  return { symbol: "1HZ10V", sample_count: digits.length, recent_digits: digits };
}

test("Speedbot waits for at least 50 duration-matched expiry samples", () => {
  const digits = Array.from({ length: 50 }, (_, index) => index % 10);
  const candidate = chooseSpeedbotCandidate({
    signal: signal(digits),
    latestDigit: 5,
    scanFrequencies: Array(10).fill(0),
    duration: 1,
  });
  assert.equal(candidate, null);
});

test("Speedbot uses the same strict observed-rate gate as Auto Magic", () => {
  const digits = Array.from({ length: 52 }, (_, index) => (index % 2 === 0 ? 5 : 6));
  const candidate = chooseSpeedbotCandidate({
    signal: signal(digits),
    latestDigit: 5,
    scanFrequencies: Array(10).fill(0),
    duration: 1,
  });
  assert.ok(candidate);
  assert.ok(candidate.observedWinRate > 68);
});

test("Speedbot rejects a candidate at exactly 68 percent", () => {
  const expiryDigits = Array.from({ length: 50 }, (_, index) => (
    index < 16 ? 0 : index === 49 ? 5 : 6
  ));
  const candidate = chooseSpeedbotCandidate({
    signal: signal([5, ...expiryDigits]),
    latestDigit: 5,
    scanFrequencies: [0, 1, 1, 1, 1, 0, 0, 0, 0, 0],
    duration: 1,
  });
  assert.equal(candidate, null);
});

test("Speedbot selects an unseen opposite-half barrier from qualifying evidence", () => {
  const digits = Array.from({ length: 53 }, (_, index) => index % 10 === 0 || index === 52 ? 5 : 6);
  const candidate = chooseSpeedbotCandidate({
    signal: signal(digits),
    latestDigit: 5,
    scanFrequencies: Array(10).fill(0),
    duration: 1,
  });
  assert.ok(candidate);
  assert.ok(candidate.observedWinRate > 68);
  assert.ok(candidate.sampleCount >= 50);
  assert.ok(candidate.barrier >= 0 && candidate.barrier <= 4);
});

test("Speedbot stops entries at its configured session targets", () => {
  assert.equal(getSpeedbotSessionStopReason(10, 10, 10), "take-profit");
  assert.equal(getSpeedbotSessionStopReason(-10, 10, 10), "loss-limit");
  assert.equal(getSpeedbotSessionStopReason(-2, 10, 10), null);
  assert.equal(getSpeedbotSessionStopReason(Number.NaN, 10, 10), "loss-limit");
});

test("Speedbot multiplies after settled losses and resets to base after a non-loss", () => {
  const rows = [
    speedbotRow("third", "lost", -0.7, 30),
    speedbotRow("second", "won", 0.7, 20),
    speedbotRow("first", "lost", -0.35, 10),
  ];

  assert.equal(
    getSpeedbotNextStake(rows, "account-1", new Set(["first"]), 0.35, 2),
    0.7,
  );
  assert.equal(
    getSpeedbotNextStake(rows, "account-1", new Set(["first", "third"]), 0.35, 2),
    1.4,
  );
  assert.equal(
    getSpeedbotNextStake(rows, "account-1", new Set(["first", "second", "third"]), 0.35, 2),
    0.7,
    "A settled win resets the next stake before a later loss is applied.",
  );
  assert.equal(getSpeedbotNextStake([], "account-1", new Set(), 0.35, 2), 0.35);
});

test("Speedbot refuses to calculate a stake from missing, open, invalid, or other-account history", () => {
  const rows = [
    speedbotRow("open", "open", -0.35, 10),
    speedbotRow("other-account", "lost", -0.35, 20, "account-2"),
    speedbotRow("invalid-profit", "closed", Number.NaN, 30),
  ];

  assert.equal(getSpeedbotNextStake(rows, "account-1", new Set(["missing"]), 0.35, 2), null);
  assert.equal(getSpeedbotNextStake(rows, "account-1", new Set(["open"]), 0.35, 2), null);
  assert.equal(getSpeedbotNextStake(rows, "account-1", new Set(["invalid-profit"]), 0.35, 2), null);
  assert.equal(getSpeedbotNextStake(rows, "account-1", new Set(["other-account"]), 0.35, 2), null);
  assert.equal(getSpeedbotNextStake([], "account-1", new Set(), 0.35, 11), null);
});
