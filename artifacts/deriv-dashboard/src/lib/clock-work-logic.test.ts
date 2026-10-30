import assert from "node:assert/strict";
import test from "node:test";
import {
  appendClockWorkQuote,
  chooseClockWorkAiCandidate,
  createClockWorkAiConfirmationState,
  getClockWorkAiCandidateKey,
  getClockWorkLimitReached,
  updateClockWorkAiConfirmation,
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
  const outcomes = [...Array.from({ length: 28 }, () => true), ...Array.from({ length: 12 }, () => false)];
  const candidate = chooseClockWorkAiCandidate(historyForOutcomes(outcomes));

  assert.deepEqual(candidate, {
    direction: "HIGHER",
    barrier: "+0.05",
    barrierOffset: 0.05,
    observedRate: 70,
    sampleCount: 40,
  });
});

test("Clock Work does not select a direction below the 70% cutoff", () => {
  const outcomes = [...Array.from({ length: 27 }, () => true), ...Array.from({ length: 13 }, () => false)];
  assert.equal(chooseClockWorkAiCandidate(historyForOutcomes(outcomes)), null);
});

test("Clock Work accepts the selected 55%, 65%, or 70% entry threshold", () => {
  const outcomes = [...Array.from({ length: 26 }, () => true), ...Array.from({ length: 14 }, () => false)];
  const quotes = historyForOutcomes(outcomes);

  assert.equal(chooseClockWorkAiCandidate(quotes, { minimumWinRate: 55 })?.observedRate, 65);
  assert.equal(chooseClockWorkAiCandidate(quotes, { minimumWinRate: 65 })?.observedRate, 65);
  assert.equal(chooseClockWorkAiCandidate(quotes, { minimumWinRate: 70 }), null);
});

test("Clock Work selects LOWER and sends a negative barrier when that side qualifies", () => {
  const outcomes = [...Array.from({ length: 12 }, () => true), ...Array.from({ length: 28 }, () => false)];
  assert.deepEqual(chooseClockWorkAiCandidate(historyForOutcomes(outcomes)), {
    direction: "LOWER",
    barrier: "-0.05",
    barrierOffset: 0.05,
    observedRate: 70,
    sampleCount: 40,
  });
});

test("Clock Work waits for one complete five-tick outcome", () => {
  assert.equal(chooseClockWorkAiCandidate([100, 101, 102, 103, 104]), null);
  assert.deepEqual(chooseClockWorkAiCandidate(historyForOutcomes([true])), {
    direction: "HIGHER",
    barrier: "+0.05",
    barrierOffset: 0.05,
    observedRate: 100,
    sampleCount: 1,
  });
});

test("Clock Work does not count an expiry that only touches its barrier as a win", () => {
  const quotes = historyForOutcomes(Array.from({ length: 20 }, () => false));
  const candidate = chooseClockWorkAiCandidate(quotes, {
    minimumWinRate: 30,
    barrierOffsets: [1],
  });
  assert.equal(candidate, null);
});

test("Clock Work requires one fresh-tick confirmation of the same setup", () => {
  const candidate = chooseClockWorkAiCandidate(historyForOutcomes([true]))!;
  let state = createClockWorkAiConfirmationState("10:100");
  assert.equal(getClockWorkAiCandidateKey(candidate), "HIGHER:+0.05");

  state = updateClockWorkAiConfirmation(state, candidate, "11:101");
  assert.equal(state.count, 1);
  assert.equal(updateClockWorkAiConfirmation(state, candidate, "11:101"), state, "Duplicate ticks must not add confirmations.");
});

test("Clock Work resets confirmations when evidence changes, disappears, or goes stale", () => {
  const higher = chooseClockWorkAiCandidate(historyForOutcomes([true]))!;
  const lower = chooseClockWorkAiCandidate(historyForOutcomes([false]))!;
  let state = updateClockWorkAiConfirmation(createClockWorkAiConfirmationState("10:100"), higher, "11:101");
  state = updateClockWorkAiConfirmation(state, lower, "12:102");
  assert.equal(state.count, 1, "A different direction or barrier starts a new confirmation sequence.");
  state = updateClockWorkAiConfirmation(state, null, "13:103");
  assert.deepEqual(state, { candidateKey: null, lastTickId: "13:103", count: 0 });
  state = updateClockWorkAiConfirmation(state, higher, "100:104");
  assert.equal(state.count, 1, "A long gap in fresh ticks starts a new sequence.");
});

test("Clock Work stops at configured settled P&L limits and treats zero as disabled", () => {
  assert.equal(getClockWorkLimitReached(2, 2, 1), "take-profit");
  assert.equal(getClockWorkLimitReached(-1, 2, 1), "loss-limit");
  assert.equal(getClockWorkLimitReached(10, 0, 0), null);
  assert.equal(getClockWorkLimitReached(Number.NaN, 0, 0), "invalid");
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
