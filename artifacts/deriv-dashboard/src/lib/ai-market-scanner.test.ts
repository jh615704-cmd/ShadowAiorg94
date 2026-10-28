import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseBulkScannerCandidate,
  chooseCashGrabScannerCandidate,
  chooseDigitFlipScannerCandidate,
  chooseTradeXScannerCandidate,
  digitDiffersRateFromPercentages,
  isValidObservedPercentage,
  isValidDigitFlipParityRates,
  type AiScannerMarketSignal,
} from "./ai-market-scanner.ts";
import { unprocessedDigitFlipSettlements } from "./digit-flip-logic.ts";

function signal(
  symbol: string,
  sampleCount: number,
  outcomes: Array<{ digit: number; over_percentage: number; under_percentage: number }>,
  even = 50,
  odd = 50,
  rise = 50,
  fall = 50,
): AiScannerMarketSignal {
  return {
    symbol,
    sample_count: sampleCount,
    digit_even_percentage: even,
    digit_odd_percentage: odd,
    rise_percentage: rise,
    fall_percentage: fall,
    digit_outcomes: outcomes,
  };
}

test("Bulk Trader scans all eligible pairs using the selected Over/Under barrier", () => {
  const candidate = chooseBulkScannerCandidate([
    signal("R_10", 50, [{ digit: 4, over_percentage: 48, under_percentage: 42 }]),
    signal("JD25", 80, [{ digit: 4, over_percentage: 68, under_percentage: 25 }]),
  ], ["R_10", "JD25"], "over-under", 4);

  assert.deepEqual(candidate, {
    symbol: "JD25",
    contractType: "DIGITOVER",
    barrier: 4,
    observedRate: 68,
    sampleCount: 80,
  });
});

test("Bulk Trader picks the observed Differs rate and the valid side of edge barriers", () => {
  const differs = chooseBulkScannerCandidate([
    signal("R_10", 40, [{ digit: 5, over_percentage: 41, under_percentage: 48 }]),
    signal("JD25", 40, [{ digit: 5, over_percentage: 45, under_percentage: 50 }]),
  ], ["R_10", "JD25"], "differs", 5);
  const edgeBarrier = chooseBulkScannerCandidate([
    signal("R_10", 40, [{ digit: 9, over_percentage: 0, under_percentage: 92 }]),
  ], ["R_10"], "over-under", 9);

  assert.equal(differs?.symbol, "JD25");
  assert.equal(differs?.contractType, "DIGITDIFF");
  assert.equal(differs?.barrier, 5);
  assert.equal(edgeBarrier?.contractType, "DIGITUNDER");
  assert.equal(edgeBarrier?.barrier, 9);
});

test("Bulk Trader scanner rejects invalid barriers and rates but tolerates percentage rounding", () => {
  const candidate = chooseBulkScannerCandidate([
    signal("R_10", 40, [{ digit: 5, over_percentage: 130, under_percentage: 10 }]),
    signal("JD25", 40, [{ digit: 5, over_percentage: 70, under_percentage: 40 }]),
    signal("R_75", 40, [{ digit: 5, over_percentage: 35.4, under_percentage: 64.7 }]),
  ], ["R_10", "JD25", "R_75"], "differs", 5);

  assert.equal(candidate?.symbol, "R_75");
  assert.equal(candidate?.observedRate, 100);
  assert.equal(chooseBulkScannerCandidate([], [], "differs", 10), null);
  assert.equal(digitDiffersRateFromPercentages(80, 30), null);
  assert.equal(isValidObservedPercentage(Number.NaN), false);
});

test("DigitFlip selects the strongest eligible observed parity without inventing a threshold", () => {
  const candidate = chooseDigitFlipScannerCandidate([
    signal("R_10", 30, [], 58, 42),
    signal("JD25", 80, [], 47, 53),
  ], ["R_10", "JD25"]);

  assert.equal(candidate?.symbol, "R_10");
  assert.equal(candidate?.parity, "DIGITEVEN");
  assert.equal(candidate?.observedRate, 58);
});

test("DigitFlip scanner ignores malformed parity rates without adding a signal threshold", () => {
  const candidate = chooseDigitFlipScannerCandidate([
    signal("R_10", 40, [], 140, -40),
    signal("JD25", 30, [], 55, Number.NaN),
    signal("R_75", 25, [], 53, 47),
  ], ["R_10", "JD25", "R_75"]);

  assert.deepEqual(candidate, {
    symbol: "R_75",
    parity: "DIGITEVEN",
    observedRate: 53,
    sampleCount: 25,
  });
  assert.equal(isValidDigitFlipParityRates(0, 100), true);
  assert.equal(isValidDigitFlipParityRates(Number.POSITIVE_INFINITY, 0), false);
});

test("DigitFlip settlement processing ignores unclaimed, open, known, and processed contracts", () => {
  const rows = [
    { contract_id: "owned-later", contract_type: "DIGITODD", status: "lost", buy_time: 20 },
    { contract_id: "outside-feature", contract_type: "DIGITEVEN", status: "lost", buy_time: 10 },
    { contract_id: "owned-open", contract_type: "DIGITEVEN", status: "open", buy_time: 5 },
    { contract_id: "owned-known", contract_type: "DIGITEVEN", status: "won", buy_time: 6 },
    { contract_id: "owned-processed", contract_type: "DIGITODD", status: "lost", buy_time: 7 },
    { contract_id: "owned-earlier", contract_type: "DIGITEVEN", status: "won", buy_time: 15 },
    { contract_id: "owned-other-contract", contract_type: "DIGITDIFF", status: "lost", buy_time: 1 },
  ];

  const settlements = unprocessedDigitFlipSettlements(
    rows,
    new Set(["owned-later", "owned-open", "owned-known", "owned-processed", "owned-earlier", "owned-other-contract"]),
    new Set(["owned-known"]),
    new Set(["owned-processed"]),
  );

  assert.deepEqual(settlements.map((trade) => trade.contract_id), ["owned-earlier", "owned-later"]);
});

test("Trade X ranks the least frequent observed digit across eligible markets", () => {
  const candidate = chooseTradeXScannerCandidate([
    signal("R_10", 30, [{ digit: 2, over_percentage: 80, under_percentage: 12 }]),
    signal("JD25", 80, [{ digit: 7, over_percentage: 44, under_percentage: 52 }]),
  ], ["R_10", "JD25"]);

  assert.equal(candidate?.symbol, "JD25");
  assert.equal(candidate?.digit, 7);
  assert.equal(candidate?.observedRate, 96);
});

test("Cash Grab chooses the strongest valid Rise/Fall sample on a supported market", () => {
  const candidate = chooseCashGrabScannerCandidate([
    signal("R_10", 30, [], 50, 50, 48, 53),
    signal("JD25", 80, [], 50, 50, 63, 35),
    signal("R_25", 100, [], 50, 50, 51, 47),
    signal("JD50", 100, [], 50, 50, 90, 5),
  ], ["R_10", "JD25", "R_25"]);

  assert.deepEqual(candidate, {
    symbol: "JD25",
    contractType: "CALL",
    observedRate: 63,
    sampleCount: 80,
  });
});

test("Cash Grab ignores undersampled, equal, and invalid Rise/Fall readings", () => {
  const candidate = chooseCashGrabScannerCandidate([
    signal("R_10", 19, [], 50, 50, 99, 1),
    signal("R_25", 40, [], 50, 50, 50, 50),
    signal("JD25", 60, [], 50, 50, Number.NaN, 40),
  ], ["R_10", "R_25", "JD25"]);

  assert.equal(candidate, null);
});

test("all scanners ignore undersampled or unsupported markets", () => {
  const candidate = chooseDigitFlipScannerCandidate([
    signal("R_10", 19, [], 99, 1),
    signal("JD25", 100, [], 98, 2),
  ], ["R_10"]);

  assert.equal(candidate, null);
});