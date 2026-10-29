import assert from "node:assert/strict";
import test from "node:test";
import {
  appendClockWorkQuote,
  chooseClockWorkAiCandidate,
  type ClockWorkQuoteBuffer,
} from "./clock-work-logic.ts";

function historyForOutcomes(outcomes: readonly boolean[]) {
  const quotes = [100];
  for (const wins of outcomes) {
    const start = quotes[quotes.length - 1]!;
    const expiry = start + (wins ? 1 : -1);
    for (let tick = 1; tick <= 5; tick += 1) {
      quotes.push(start + ((expiry - start) * tick) / 5);
    }
  }
  return quotes;
}

test("Clock Work selects the strongest side and smallest tied barrier at 70%", () => {
  const outcomes = [...Array.from({ length: 14 }, () => true), ...Array.from({ length: 6 }, () => false)];
  const candidate = chooseClockWorkAiCandidate(historyForOutcomes(outcomes));

  assert.deepEqual(candidate, {
    direction: "HIGHER",
    barrier: "+0.05",
    barrierOffset: 0.05,
    observedRate: 70,
    sampleCount: 20,
  });
});

test("Clock Work does not select a direction below the 70% cutoff", () => {
  const outcomes = [...Array.from({ length: 13 }, () => true), ...Array.from({ length: 7 }, () => false)];
  assert.equal(chooseClockWorkAiCandidate(historyForOutcomes(outcomes)), null);
});

test("Clock Work selects LOWER and sends a negative barrier when that side qualifies", () => {
  const outcomes = [...Array.from({ length: 6 }, () => true), ...Array.from({ length: 14 }, () => false)];
  assert.deepEqual(chooseClockWorkAiCandidate(historyForOutcomes(outcomes)), {
    direction: "LOWER",
    barrier: "-0.05",
    barrierOffset: 0.05,
    observedRate: 70,
    sampleCount: 20,
  });
});

test("Clock Work waits for 20 complete non-overlapping five-tick outcomes", () => {
  assert.equal(chooseClockWorkAiCandidate(Array.from({ length: 100 }, (_, index) => 100 + index)), null);
  assert.deepEqual(
    chooseClockWorkAiCandidate(Array.from({ length: 101 }, (_, index) => 100 + index)),
    {
      direction: "HIGHER",
      barrier: "+0.05",
      barrierOffset: 0.05,
      observedRate: 100,
      sampleCount: 20,
    },
  );
});

test("Clock Work does not count an expiry that only touches its barrier as a win", () => {
  const quotes = historyForOutcomes(Array.from({ length: 20 }, () => false));
  const candidate = chooseClockWorkAiCandidate(quotes, {
    minimumWinRate: 30,
    barrierOffsets: [1],
  });
  assert.equal(candidate, null);
});

test("Clock Work quote history deduplicates ticks and respects its cap", () => {
  const emptyBuffer: ClockWorkQuoteBuffer = {
    symbol: "R_75",
    quotes: [],
    lastTickId: null,
  };
  const first = appendClockWorkQuote(emptyBuffer, "R_75", { symbol: "R_75", quote: 100, epoch: 1 }, 2);
  assert.equal(appendClockWorkQuote(first, "R_75", { symbol: "R_75", quote: 100, epoch: 1 }, 2), first);
  const second = appendClockWorkQuote(first, "R_75", { symbol: "R_75", quote: 101, epoch: 2 }, 2);
  const third = appendClockWorkQuote(second, "R_75", { symbol: "R_75", quote: 102, epoch: 3 }, 2);
  assert.deepEqual(third.quotes, [101, 102]);
});

test("Clock Work quote history resets when the selected market changes", () => {
  const changed = appendClockWorkQuote(
    { symbol: "R_75", quotes: [100, 101], lastTickId: "4:101" },
    "R_50",
    { symbol: "R_50", quote: 200, epoch: 5 },
  );
  assert.deepEqual(changed, {
    symbol: "R_50",
    quotes: [200],
    lastTickId: "5:200",
  });
});
