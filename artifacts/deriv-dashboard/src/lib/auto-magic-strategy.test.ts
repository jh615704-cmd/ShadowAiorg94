import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTO_MAGIC_6X_MIN_OBSERVED_WIN_RATE,
  chooseAutoMagicCandidate,
  getAutoMagicBatchCount,
} from "./auto-magic-strategy.ts";

test("Auto Magic chooses its hidden batch size from the observed win rate", () => {
  assert.equal(getAutoMagicBatchCount(70), 3);
  assert.equal(getAutoMagicBatchCount(AUTO_MAGIC_6X_MIN_OBSERVED_WIN_RATE - 0.1), 3);
  assert.equal(getAutoMagicBatchCount(AUTO_MAGIC_6X_MIN_OBSERVED_WIN_RATE), 6);
  assert.equal(getAutoMagicBatchCount(95), 6);
});

const signal = (symbol: string, digits: number[]) => ({
  symbol,
  sample_count: digits.length,
  recent_digits: digits,
});

const frequencies = (symbols: string[], touchedDigits: number[] = []) =>
  Object.fromEntries(symbols.map((symbol) => {
    const counts = Array(10).fill(0) as number[];
    for (const digit of touchedDigits) counts[digit] = 1;
    return [symbol, counts];
  }));

test("Auto Magic waits for at least 50 expiry samples", () => {
  const candidate = chooseAutoMagicCandidate({
    signals: [signal("R_10", Array(50).fill(0))],
    markets: [{ symbol: "R_10" }],
    latestDigits: { R_10: 0 },
    scanFrequencies: frequencies(["R_10"], [6, 7, 8, 9]),
    duration: 1,
  });

  assert.equal(candidate, null);
});

test("Auto Magic requires a historical observed rate strictly above 68 percent", () => {
  const exactly68 = [0, ...Array(16).fill(5), ...Array(34).fill(0)];
  const above68 = [0, ...Array(15).fill(5), ...Array(35).fill(0)];
  const input = {
    markets: [{ symbol: "R_10" }],
    latestDigits: { R_10: 0 },
    scanFrequencies: frequencies(["R_10"], [6, 7, 8, 9]),
    duration: 1,
  };

  assert.equal(chooseAutoMagicCandidate({ ...input, signals: [signal("R_10", exactly68)] }), null);
  assert.equal(
    chooseAutoMagicCandidate({ ...input, signals: [signal("R_10", above68)] })?.observedWinRate,
    70,
  );
});

test("Auto Magic chooses the highest observed rate from untouched opposite-half digits", () => {
  const symbols = ["R_10", "R_25"];
  const candidate = chooseAutoMagicCandidate({
    signals: [
      signal("R_10", [0, ...Array(5).fill(5), ...Array(45).fill(0)]),
      signal("R_25", [0, ...Array(15).fill(5), ...Array(35).fill(0)]),
    ],
    markets: symbols.map((symbol) => ({ symbol })),
    latestDigits: { R_10: 0, R_25: 0 },
    scanFrequencies: frequencies(symbols, [6, 7, 8, 9]),
    duration: 1,
  });

  assert.equal(candidate?.symbol, "R_10");
  assert.equal(candidate?.barrier, 5);
  assert.equal(candidate?.latestDigit, 0);
  assert.equal(candidate?.observedWinRate, 90);
  assert.equal(candidate?.sampleCount, 50);
});

test("Auto Magic reverses its allowed digit half when the latest digit is 5 through 9", () => {
  const candidate = chooseAutoMagicCandidate({
    signals: [signal("R_10", Array(51).fill(7))],
    markets: [{ symbol: "R_10" }],
    latestDigits: { R_10: 7 },
    scanFrequencies: frequencies(["R_10"], [1, 2, 3, 4]),
    duration: 1,
  });

  assert.ok(candidate);
  assert.ok(candidate.barrier >= 0 && candidate.barrier <= 4);
});

test("Auto Magic rejects digits already touched in the current scan", () => {
  const candidate = chooseAutoMagicCandidate({
    signals: [signal("R_10", Array(51).fill(0))],
    markets: [{ symbol: "R_10" }],
    latestDigits: { R_10: 0 },
    scanFrequencies: frequencies(["R_10"], [5, 6, 7, 8, 9]),
    duration: 1,
  });

  assert.equal(candidate, null);
});
