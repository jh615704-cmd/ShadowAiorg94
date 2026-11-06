import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseBestDigitSignal,
  chooseBestEdgeDirectionForDigit,
  chooseBestEdgeSignal,
  chooseBestEdgeTradeSignal,
  chooseEdgeDurationByWinRate,
  createEdgeDurationAvailabilitySetup,
  rankBestEdgeTradeSignals,
  digitForTick,
  findNewlySettledTrade,
  rankDigitsForDiffers,
  nextStakeAfterSettlement,
  nextStakeFromLossHistory,
  rankDigitsByDistribution,
  sessionStopReason,
  type MarketSignal,
} from "./trading-sequence.ts";

const market = (
  symbol: string,
  quote: number | null,
  sample_count: number,
  over: number,
  under: number,
  digit = 5,
): MarketSignal => ({
  symbol,
  quote,
  sample_count,
  digit_streaks: [{ digit, over, under }],
});

describe("digit-distribution tick selection", () => {
  it("ranks digits from the live distribution with deterministic tie ordering", () => {
    assert.deepEqual(
      rankDigitsByDistribution([2, 8, 3, 8, 0, 1, 3, 0, 0, 1]),
      [1, 3, 2, 6, 0, 5, 9, 4, 7, 8],
    );
  });

  it("maps tick duration to the matching ranked digit position", () => {
    const rankedDigits = [7, 2, 9, 1, 4, 0, 3, 5, 6, 8];
    assert.equal(digitForTick(1, rankedDigits, 5), 7);
    assert.equal(digitForTick(2, rankedDigits, 5), 2);
    assert.equal(digitForTick(3, rankedDigits, 5), 9);
    assert.equal(digitForTick(4, rankedDigits, 5), 1);
    assert.equal(digitForTick(5, rankedDigits, 5), 4);
    assert.equal(digitForTick(6, rankedDigits, 5), 0);
    assert.equal(digitForTick(8, rankedDigits, 5), 0);
  });

  it("keeps the configured digit until a live ranking is available", () => {
    assert.equal(digitForTick(1, [], 5), 5);
  });

  it("ranks low-frequency digits first for Digit Differs safe entries", () => {
    assert.deepEqual(
      rankDigitsForDiffers([4, 1, 3, 1, 0, 5, 2, 0, 2, 1], [0, 2, 0, 5, 8, 0, 1, 7, 3, 4]).slice(0, 3),
      [4, 7, 3],
    );
  });
});

describe("martingale settlement sequencing", () => {
  it("multiplies the next stake after a loss", () => {
    assert.equal(nextStakeAfterSettlement(-1.25, 1.25, 1.25, 2.5), 3.13);
  });

  it("resets the next stake to the normal amount after a win", () => {
    assert.equal(nextStakeAfterSettlement(2.5, 3.13, 1.25, 2.5), 1.25);
  });

  it("keeps the multiplied stake through wins until feature history is cleared", () => {
    const rows = [
      { contract_id: "loss", status: "lost", profit: -0.5, buy_time: 1 },
      { contract_id: "win", status: "won", profit: 1, buy_time: 2 },
      { contract_id: "loss-2", status: "lost", profit: -1, buy_time: 3 },
      { contract_id: "open", status: "open", profit: -2, buy_time: 4 },
    ];
    assert.equal(nextStakeFromLossHistory(rows, 0.5, 2), 2);
    assert.equal(nextStakeFromLossHistory([], 0.5, 2), 0.5);
  });

  it("ignores open and already-known rows when finding a settlement", () => {
    const knownIds = new Set(["old"]);
    assert.deepEqual(
      findNewlySettledTrade(
        [
          { contract_id: "open", status: "open", profit: -1.25 },
          { contract_id: "old", status: "won", profit: 2.5 },
          { contract_id: "new", status: "lost", profit: -1.25 },
        ],
        knownIds,
      ),
      { contract_id: "new", status: "lost", profit: -1.25 },
    );
  });
});

describe("Auto Best Digit selection", () => {
  it("selects the strongest current market, direction, and barrier", () => {
    assert.deepEqual(
      chooseBestDigitSignal(
        [
          market("R_10", 100.1, 20, 2, 1, 3),
          market("R_75", 75.5, 30, 1, 8, 7),
        ],
        market("R_25", 25.2, 40, 9, 1, 2),
      ),
      {
        symbol: "R_75",
        direction: "DIGITUNDER",
        digit: 7,
        streak: 8,
        sampleCount: 30,
      },
    );
  });

  it("uses the latest selected market as a fallback when no market is ready", () => {
    assert.deepEqual(
      chooseBestDigitSignal([], market("R_75", 75.5, 4, 2, 5, 4)),
      {
        symbol: "R_75",
        direction: "DIGITUNDER",
        digit: 4,
        streak: 5,
        sampleCount: 4,
      },
    );
  });
});

describe("Percentage evidence selection", () => {
  it("selects the better observed side for only the configured market and digit", () => {
    assert.deepEqual(
      chooseBestEdgeDirectionForDigit(
        [
          {
            symbol: "R_75",
            quote: 75.5,
            sample_count: 25,
            digit_streaks: [],
            digit_outcomes: [
              { digit: 4, over_percentage: 61, under_percentage: 29 },
              { digit: 6, over_percentage: 37, under_percentage: 53 },
            ],
          },
          {
            symbol: "R_100",
            quote: 100.1,
            sample_count: 200,
            digit_streaks: [],
            digit_outcomes: [{ digit: 4, over_percentage: 89, under_percentage: 8 }],
          },
        ],
        "R_75",
        6,
      ),
      {
        symbol: "R_75",
        direction: "DIGITUNDER",
        digit: 6,
        score: 53,
        sampleCount: 25,
      },
    );
  });

  it("waits for the minimum live sample and rejects ties", () => {
    const signal: MarketSignal = {
      symbol: "R_75",
      quote: 75.5,
      sample_count: 19,
      digit_streaks: [],
      digit_outcomes: [{ digit: 5, over_percentage: 52, under_percentage: 48 }],
    };
    assert.equal(chooseBestEdgeDirectionForDigit([signal], "R_75", 5), null);
    assert.equal(
      chooseBestEdgeDirectionForDigit(
        [{ ...signal, sample_count: 20, digit_outcomes: [{ digit: 5, over_percentage: 50, under_percentage: 50 }] }],
        "R_75",
        5,
      ),
      null,
    );
  });

  it("recommends Dual from combined observed coverage", () => {
    assert.deepEqual(
      chooseBestEdgeSignal(
        [{
          symbol: "R_75",
          quote: 75.5,
          sample_count: 20,
          digit_streaks: [],
          digit_outcomes: [
            { digit: 5, over_percentage: 48, under_percentage: 47 },
            { digit: 1, over_percentage: 95, under_percentage: 5 },
          ],
        }],
        90,
      ),
      {
        symbol: "R_75",
        direction: "DUAL",
        digit: 5,
        score: 95,
        sampleCount: 20,
      },
    );
  });

  it("does not recommend when no observed outcome reaches the floor", () => {
    assert.equal(
      chooseBestEdgeSignal(
        [{
          symbol: "R_75",
          quote: 75.5,
          sample_count: 20,
          digit_streaks: [],
          digit_outcomes: [{ digit: 5, over_percentage: 44, under_percentage: 44 }],
        }],
        90,
      ),
      null,
    );
  });

  it("chooses the strongest qualifying cross-market Over or Under sample", () => {
    assert.deepEqual(
      chooseBestEdgeTradeSignal([
        {
          symbol: "R_75",
          quote: 75.5,
          sample_count: 40,
          digit_streaks: [],
          digit_outcomes: [
            { digit: 4, over_percentage: 92, under_percentage: 8 },
            { digit: 7, over_percentage: 51, under_percentage: 49 },
          ],
        },
        {
          symbol: "JD25",
          quote: 123.4,
          sample_count: 30,
          digit_streaks: [],
          digit_outcomes: [
            { digit: 2, over_percentage: 4, under_percentage: 96 },
          ],
        },
      ]),
      {
        symbol: "JD25",
        direction: "DIGITUNDER",
        digit: 2,
        score: 96,
        sampleCount: 30,
      },
    );
  });

  it("does not turn an observed sample below the 50% floor into a trade signal", () => {
    assert.equal(
      chooseBestEdgeTradeSignal([{
        symbol: "R_75",
        quote: 75.5,
        sample_count: 100,
        digit_streaks: [],
        digit_outcomes: [{ digit: 5, over_percentage: 49.9, under_percentage: 49.8 }],
      }]),
      null,
    );
  });

  it("accepts EDGE signals at the 50% observed-frequency threshold", () => {
    const sample = {
      symbol: "R_75",
      quote: 75.5,
      sample_count: 20,
      digit_streaks: [],
      digit_outcomes: [{ digit: 5, over_percentage: 50, under_percentage: 49 }],
    };

    assert.equal(chooseBestEdgeTradeSignal([sample])?.score, 50);
    assert.equal(chooseBestEdgeTradeSignal([sample], 50, 20)?.score, 50);
    assert.equal(chooseBestEdgeTradeSignal([sample], 51, 20), null);
  });

  it("ranks alternate EDGE markets so unsupported quotes can fall through", () => {
    const ranked = rankBestEdgeTradeSignals([
      {
        symbol: "JD100",
        quote: 100.5,
        sample_count: 80,
        digit_streaks: [],
        digit_outcomes: [{ digit: 8, over_percentage: 61, under_percentage: 39 }],
      },
      {
        symbol: "R_75",
        quote: 75.5,
        sample_count: 60,
        digit_streaks: [],
        digit_outcomes: [{ digit: 5, over_percentage: 58, under_percentage: 42 }],
      },
    ], 50, 20);

    assert.deepEqual(
      ranked.map(({ symbol, direction, digit }) => ({ symbol, direction, digit })),
      [
        { symbol: "JD100", direction: "DIGITOVER", digit: 8 },
        { symbol: "R_75", direction: "DIGITOVER", digit: 5 },
      ],
    );
  });

  it("ignores insufficient, tied, invalid, and tautological Over/Under samples", () => {
    assert.equal(
      chooseBestEdgeTradeSignal([
        {
          symbol: "R_75",
          quote: 75.5,
          sample_count: 19,
          digit_streaks: [],
          digit_outcomes: [{ digit: 5, over_percentage: 100, under_percentage: 0 }],
        },
        {
          symbol: "JD25",
          quote: 123.4,
          sample_count: 30,
          digit_streaks: [],
          digit_outcomes: [
            { digit: 5, over_percentage: 50, under_percentage: 50 },
            { digit: 5, over_percentage: 1000, under_percentage: 0 },
            { digit: 0, over_percentage: 100, under_percentage: 0 },
            { digit: 9, over_percentage: 0, under_percentage: 100 },
          ],
        },
      ]),
      null,
    );
  });
});

describe("EDGE duration selection", () => {
  const makeHistory = (
    duration: number,
    wins: number,
    losses: number,
    overrides: Partial<{
      symbol: string;
      contract_type: string;
      barrier: number;
      status: string;
    }> = {},
  ) => [
    ...Array.from({ length: wins }, () => ({
      symbol: "R_75",
      contract_type: "DIGITUNDER",
      barrier: 4,
      duration,
      status: "won",
      profit: 0.5,
      ...overrides,
    })),
    ...Array.from({ length: losses }, () => ({
      symbol: "R_75",
      contract_type: "DIGITUNDER",
      barrier: 4,
      duration,
      status: "lost",
      profit: -1,
      ...overrides,
    })),
  ];

  it("uses only sufficiently sampled, matching settled results for tick selection", () => {
    const rows = [
      ...makeHistory(1, 19, 1),
      ...makeHistory(2, 18, 2),
      ...makeHistory(3, 20, 0, { symbol: "JD25" }),
      ...makeHistory(4, 20, 0, { status: "open" }),
    ];

    assert.equal(
      chooseEdgeDurationByWinRate(rows, "R_75", "DIGITUNDER", 4, [1, 2, 3, 4], 2),
      1,
    );
  });

  it("keeps the preferred supported duration until a qualifying history sample exists", () => {
    const rows = makeHistory(1, 19, 0);

    assert.equal(
      chooseEdgeDurationByWinRate(rows, "R_75", "DIGITUNDER", 4, [1, 2, 5], 2),
      2,
    );
    assert.equal(
      chooseEdgeDurationByWinRate(rows, "R_75", "DIGITUNDER", 4, [1, 2], 5),
      1,
    );
  });

  it("checks duration availability for the scanned candidate, not stale UI values", () => {
    assert.deepEqual(
      createEdgeDurationAvailabilitySetup({
        symbol: "JD100",
        direction: "DIGITUNDER",
        digit: 7,
        score: 61.2,
        sampleCount: 50,
      }, 2.5),
      {
        amount: 2.5,
        contract_type: "DIGITUNDER",
        barrier: 7,
        symbol: "JD100",
      },
    );
  });
});

describe("session stop conditions", () => {
  it("stops at take profit or stop loss and keeps running between limits", () => {
    assert.equal(sessionStopReason(10, 10, 10), "take-profit");
    assert.equal(sessionStopReason(-10, 10, 10), "stop-loss");
    assert.equal(sessionStopReason(9.99, 10, 10), null);
  });
});