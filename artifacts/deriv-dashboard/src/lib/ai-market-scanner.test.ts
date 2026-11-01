import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseBulkScannerCandidate,
  chooseCashGrabScannerCandidate,
  chooseCashGrabDirectionalMarket,
  getCashGrabDurationEvidence,
  chooseDigitFlipScannerCandidate,
  chooseTradeXScannerCandidate,
  digitDiffersRateFromPercentages,
  getDigitFlipAdjustedRate,
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

function quotesForOutcomes(outcomes: readonly boolean[], duration = 1): number[] {
  const quotes = [100];
  for (const wins of outcomes) {
    const start = quotes[quotes.length - 1]!;
    const expiry = start + (wins ? 1 : -1);
    for (let tick = 1; tick <= duration; tick += 1) {
      quotes.push(start + ((expiry - start) * tick) / duration);
    }
  }
  return quotes;
}

function signalWithQuotes(symbol: string, outcomes: readonly boolean[], duration = 1): AiScannerMarketSignal {
  return {
    ...signal(symbol, outcomes.length, []),
    recent_quotes: quotesForOutcomes(outcomes, duration),
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

test("Bulk Trader accepts the 50% observed-rate floor", () => {
  const candidate = chooseBulkScannerCandidate([
    signal("R_10", 20, [{ digit: 5, over_percentage: 50, under_percentage: 49.9 }]),
    signal("JD25", 20, [{ digit: 5, over_percentage: 49.9, under_percentage: 49.8 }]),
  ], ["R_10", "JD25"], "over-under", 5);

  assert.equal(candidate?.symbol, "R_10");
  assert.equal(candidate?.observedRate, 50);
});

test("DigitFlip ranks a sufficiently sampled parity after shrinking toward an even baseline", () => {
  const candidate = chooseDigitFlipScannerCandidate([
    signal("R_10", 100, [], 96, 4),
    signal("JD25", 120, [], 60, 40),
  ], ["R_10", "JD25"]);

  assert.equal(candidate?.symbol, "R_10");
  assert.equal(candidate?.parity, "DIGITEVEN");
  assert.equal(candidate?.observedRate, 96);
  assert.equal(getDigitFlipAdjustedRate(60, 100), 58.333333333333336);
});

test("DigitFlip scanner ignores malformed and undersampled rates while ranking valid parity evidence", () => {
  const candidate = chooseDigitFlipScannerCandidate([
    signal("R_10", 40, [], 140, -40),
    signal("JD25", 100, [], 55, Number.NaN),
    signal("R_25", 100, [], 55, 45),
    signal("R_75", 100, [], 60, 40),
  ], ["R_10", "JD25", "R_75"]);

  assert.equal(candidate?.symbol, "R_75");
  assert.equal(candidate?.parity, "DIGITEVEN");
  assert.equal(candidate?.observedRate, 60);
  assert.equal(candidate?.sampleCount, 100);
  assert.equal(isValidDigitFlipParityRates(0, 100), true);
  assert.equal(isValidDigitFlipParityRates(Number.POSITIVE_INFINITY, 0), false);
});

test("DigitFlip accepts the 50% parity floor at its minimum sample count", () => {
  const candidate = chooseDigitFlipScannerCandidate([
    signal("R_10", 100, [], 50, 50),
  ], ["R_10"]);

  assert.equal(candidate?.symbol, "R_10");
  assert.equal(candidate?.observedRate, 50);
});

test("DigitFlip does not scan a setup below its minimum sample count", () => {
  assert.equal(
    chooseDigitFlipScannerCandidate([
      signal("R_10", 99, [], 100, 0),
      signal("JD25", 99, [], 54, 46),
    ], ["R_10", "JD25"]),
    null,
  );
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

test("Trade X AI scanner only returns a valid, sufficiently observed digit", () => {
  const candidate = chooseTradeXScannerCandidate([
    signal("R_10", 80, [
      { digit: 2, over_percentage: 84, under_percentage: 12 },
      { digit: 7, over_percentage: 47.5, under_percentage: 47.5 },
      { digit: 12, over_percentage: 100, under_percentage: 0 },
      { digit: 4, over_percentage: 120, under_percentage: 0 },
    ]),
    signal("JD25", 19, [
      { digit: 8, over_percentage: 49, under_percentage: 49 },
    ]),
  ], ["R_10", "JD25"]);

  assert.deepEqual(candidate, {
    symbol: "R_10",
    digit: 2,
    observedRate: 96,
    sampleCount: 80,
  });
});

test("Trade X accepts the 50% observed-rate floor and rejects lower rates", () => {
  const candidate = chooseTradeXScannerCandidate([
    signal("R_10", 100, [
      { digit: 2, over_percentage: 25, under_percentage: 25 },
      { digit: 3, over_percentage: 24.9, under_percentage: 25 },
    ]),
  ], ["R_10"]);

  assert.equal(candidate?.digit, 2);
  assert.equal(candidate?.observedRate, 50);
});

test("Trade X AI scanner skips candidates below its observed-rate gate", () => {
  assert.equal(
    chooseTradeXScannerCandidate([
      signal("R_75", 200, [{ digit: 5, over_percentage: 24.9, under_percentage: 25 }]),
    ], ["R_75"]),
    null,
  );
});

test("Cash Grab scans actual duration-matched outcomes and favors conservative evidence", () => {
  const candidate = chooseCashGrabScannerCandidate([
    signalWithQuotes("R_10", [...Array.from({ length: 18 }, () => true), ...Array.from({ length: 2 }, () => false)]),
    signalWithQuotes("JD25", [...Array.from({ length: 24 }, () => true), ...Array.from({ length: 6 }, () => false)]),
    signalWithQuotes("R_25", [...Array.from({ length: 28 }, () => true), ...Array.from({ length: 12 }, () => false)]),
    signalWithQuotes("JD50", [...Array.from({ length: 36 }, () => true), ...Array.from({ length: 4 }, () => false)]),
  ], ["R_10", "JD25", "R_25", "JD50"], 1);

  assert.equal(candidate?.symbol, "JD50");
  assert.equal(candidate?.contractType, "CALL");
  assert.equal(candidate?.observedRate, 90);
  assert.equal(candidate?.sampleCount, 40);
  assert.ok((candidate?.conservativeRate ?? 0) > 70);
  assert.ok((candidate?.conservativeRate ?? 0) > 50);
});

test("Cash Grab counts non-overlapping windows at the selected duration", () => {
  const quotes = quotesForOutcomes([
    ...Array.from({ length: 24 }, () => true),
    ...Array.from({ length: 6 }, () => false),
  ], 5);
  const evidence = getCashGrabDurationEvidence(quotes, 5);
  const mismatchedDuration = getCashGrabDurationEvidence(quotes, 1);

  assert.equal(evidence?.sampleCount, 30);
  assert.equal(evidence?.callRate, 80);
  assert.equal(evidence?.putRate, 20);
  assert.notEqual(mismatchedDuration?.sampleCount, evidence?.sampleCount);
  assert.equal(getCashGrabDurationEvidence(quotes, 6), null);
  assert.equal(getCashGrabDurationEvidence([100, Number.NaN], 1), null);
});

test("Cash Grab candidate waits for adequate duration-specific samples and a conservative edge", () => {
  const candidate = chooseCashGrabScannerCandidate([
    signalWithQuotes("R_10", [...Array.from({ length: 19 }, () => true)]),
    signalWithQuotes("JD25", [...Array.from({ length: 20 }, () => true)]),
    signalWithQuotes("R_25", [...Array.from({ length: 10 }, () => true), ...Array.from({ length: 10 }, () => false)]),
  ], ["R_10", "JD25", "R_25"]);

  assert.equal(candidate?.symbol, "JD25");
  assert.equal(candidate?.contractType, "CALL");
  assert.equal(candidate?.observedRate, 100);
  assert.equal(candidate?.sampleCount, 20);
  assert.ok((candidate?.conservativeRate ?? 0) > 50);
});

test("Cash Grab ignores undersampled, equal, and invalid quote histories", () => {
  const candidate = chooseCashGrabScannerCandidate([
    signalWithQuotes("R_10", Array.from({ length: 19 }, () => true)),
    signalWithQuotes("R_25", [
      ...Array.from({ length: 15 }, () => true),
      ...Array.from({ length: 15 }, () => false),
    ]),
    {
      ...signal("JD25", 100, []),
      recent_quotes: [100, Number.NaN, 101],
    },
  ], ["R_10", "R_25", "JD25"]);

  assert.equal(candidate, null);
});

test("Cash Grab auto-best uses duration-specific evidence for the selected direction", () => {
  const signals = [
    signalWithQuotes("R_10", Array.from({ length: 19 }, () => true)),
    signalWithQuotes("JD25", [...Array.from({ length: 30 }, () => true), ...Array.from({ length: 10 }, () => false)]),
    signalWithQuotes("R_25", [...Array.from({ length: 10 }, () => true), ...Array.from({ length: 30 }, () => false)]),
    signalWithQuotes("JD50", [...Array.from({ length: 20 }, () => true), ...Array.from({ length: 20 }, () => false)]),
    { ...signal("JD75", 100, []), recent_quotes: [100, Number.NaN, 101] },
  ];

  assert.equal(chooseCashGrabDirectionalMarket(signals, ["R_10", "JD25", "R_25", "JD50", "JD75"], "CALL"), "JD25");
  assert.equal(chooseCashGrabDirectionalMarket(signals, ["R_10", "JD25", "R_25", "JD50", "JD75"], "PUT"), "R_25");
  assert.equal(chooseCashGrabDirectionalMarket(signals, ["R_10"], "CALL"), null);
});

test("all scanners ignore undersampled or unsupported markets", () => {
  const candidate = chooseDigitFlipScannerCandidate([
    signal("R_10", 19, [], 99, 1),
    signal("JD25", 100, [], 98, 2),
  ], ["R_10"]);

  assert.equal(candidate, null);
});