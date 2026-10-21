import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseQualifiedMatchesDigits,
  MATCHES_AUTO_MINIMUM_SETTLED_WIN_RATE,
  MATCHES_MINIMUM_SETTLED_TRADES_PER_DIGIT,
  MATCHES_MINIMUM_STAKE,
  rankSettledMatchOutcomes,
  type MatchesSettlementRow,
} from "./matches-analysis.ts";

function row(overrides: Partial<MatchesSettlementRow> = {}): MatchesSettlementRow {
  return {
    contract_id: "contract-1",
    account_id: "account-1",
    contract_type: "DIGITMATCH",
    symbol: "R_75",
    barrier: 7,
    duration: 2,
    duration_unit: "t",
    status: "won",
    ...overrides,
  };
}

function contractsForDigit(digit: number, wins: number, total: number): MatchesSettlementRow[] {
  return Array.from({ length: total }, (_, index) => row({
    contract_id: `digit-${digit}-${index}`,
    barrier: digit,
    status: index < wins ? "won" : "lost",
  }));
}

test("Matches ranks settled Digit Match outcomes for the selected account, market, and tick duration", () => {
  const rows = [
    ...contractsForDigit(7, 4, 5),
    ...contractsForDigit(2, 3, 5),
    ...contractsForDigit(9, 2, 5),
    ...contractsForDigit(0, 1, 5),
    ...contractsForDigit(6, 1, 10),
    ...contractsForDigit(4, 4, 4),
    row({ contract_id: "wrong-account", account_id: "account-2", barrier: 8 }),
    row({ contract_id: "wrong-market", symbol: "R_100", barrier: 8 }),
    row({ contract_id: "wrong-duration", duration: 3, barrier: 8 }),
    row({ contract_id: "wrong-unit", duration_unit: "s", barrier: 8 }),
    row({ contract_id: "wrong-contract", contract_type: "DIGITDIFF", barrier: 8 }),
    row({ contract_id: "still-open", barrier: 4, status: "open" }),
    row({ contract_id: "early-sold", barrier: 4, status: "closed" }),
  ];
  rows.push(rows[0]);

  const ranked = rankSettledMatchOutcomes(rows, "account-1", "R_75", 2);

  assert.deepEqual(ranked, [
    { digit: 7, count: 5, rate: 80 },
    { digit: 2, count: 5, rate: 60 },
    { digit: 9, count: 5, rate: 40 },
    { digit: 0, count: 5, rate: 20 },
    { digit: 6, count: 10, rate: 10 },
  ]);
});

test("Matches needs five resolved wins or losses before a digit can be ranked", () => {
  assert.equal(MATCHES_MINIMUM_SETTLED_TRADES_PER_DIGIT, 5);
  assert.deepEqual(
    rankSettledMatchOutcomes(contractsForDigit(3, 4, 4), "account-1", "R_75", 2),
    [],
  );
  assert.deepEqual(rankSettledMatchOutcomes(contractsForDigit(3, 4, 5), null, "R_75", 2), []);
});

test("Matches automation chooses only top settled win rates above the 10% baseline", () => {
  const ranked = [
    { digit: 7, count: 5, rate: 80 },
    { digit: 2, count: 5, rate: 60 },
    { digit: 9, count: 5, rate: 40 },
    { digit: 0, count: 5, rate: 20 },
    { digit: 6, count: 10, rate: 10 },
  ];

  assert.deepEqual(chooseQualifiedMatchesDigits(ranked, 1), [7]);
  assert.deepEqual(chooseQualifiedMatchesDigits(ranked, 2), [7, 2]);
  assert.deepEqual(chooseQualifiedMatchesDigits(ranked, 3), [7, 2, 9]);
  assert.equal(MATCHES_AUTO_MINIMUM_SETTLED_WIN_RATE, 10);
  assert.equal(MATCHES_MINIMUM_STAKE, 0.35);
});
