import assert from "node:assert/strict";
import test from "node:test";
import { buildCashGrabBulkBuyPayload } from "./cash-grab-order.ts";

test("Cash Grab Rise maps to a Deriv CALL payload", () => {
  assert.deepEqual(
    buildCashGrabBulkBuyPayload({
      amount: 0.35,
      duration: 2,
      direction: "CALL",
      symbol: "R_75",
      count: 1,
    }),
    {
      amount: 0.35,
      duration: 2,
      duration_unit: "t",
      contract_type: "CALL",
      symbol: "R_75",
      count: 1,
    },
  );
});

test("Cash Grab Fall maps to a Deriv PUT payload", () => {
  assert.deepEqual(
    buildCashGrabBulkBuyPayload({
      amount: 1.25,
      duration: 5,
      direction: "PUT",
      symbol: "JD75",
      count: 1,
    }),
    {
      amount: 1.25,
      duration: 5,
      duration_unit: "t",
      contract_type: "PUT",
      symbol: "JD75",
      count: 1,
    },
  );
});

test("Cash Grab rejects durations outside the visible 1–5 tick range", () => {
  assert.throws(
    () => buildCashGrabBulkBuyPayload({
      amount: 0.35,
      duration: 6 as never,
      direction: "CALL",
      symbol: "R_75",
      count: 1,
    }),
    /1 to 5 ticks/,
  );
});

test("Cash Grab rejects non-Rise/Fall contract types at runtime", () => {
  const invalidInput = {
    amount: 0.35,
    duration: 1,
    direction: "DIGITEVEN",
    symbol: "R_75",
    count: 1,
  };
  assert.throws(
    () => buildCashGrabBulkBuyPayload(invalidInput as never),
    /Cash Grab supports Rise\/Fall contracts only/,
  );
});

test("Cash Grab rejects bulk orders and invalid stakes", () => {
  assert.throws(
    () => buildCashGrabBulkBuyPayload({
      amount: 0.35,
      duration: 1,
      direction: "CALL",
      symbol: "R_75",
      count: 2,
    }),
    /one contract at a time/,
  );
  assert.throws(
    () => buildCashGrabBulkBuyPayload({
      amount: Number.NaN,
      duration: 1,
      direction: "CALL",
      symbol: "R_75",
      count: 1,
    }),
    /stake must be finite/,
  );
});