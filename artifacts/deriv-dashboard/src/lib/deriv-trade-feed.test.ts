import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeDerivTradeUpdate,
  waitForSettledDerivTrade,
  type DerivTradeFeedRow,
} from "./deriv-trade-feed.ts";

type TestTrade = DerivTradeFeedRow & { profit: number };

test("live updates replace the matching account trade without adding a duplicate", () => {
  const original: TestTrade = {
    account_id: "VRTC123",
    contract_id: "9001",
    status: "open",
    profit: 0,
  };
  const updated = mergeDerivTradeUpdate([original], { ...original, status: "won", profit: 1.25 });

  assert.equal(updated.length, 1);
  assert.deepEqual(updated[0], { ...original, status: "won", profit: 1.25 });
});

test("a settled contract wakes its waiter from the live update without a polling refetch", async () => {
  let rows: TestTrade[] = [{
    account_id: "VRTC123",
    contract_id: "9002",
    status: "open",
    profit: 0,
  }];
  let notify: (() => void) | null = null;
  const settlement = waitForSettledDerivTrade({
    accountId: "VRTC123",
    contractId: "9002",
    getRows: () => rows,
    subscribe: (listener) => {
      notify = listener;
      return () => { notify = null; };
    },
    isSettled: (status) => !["open", "pending", "active"].includes(status.toLowerCase()),
    timeoutMs: 1_000,
  });

  rows = mergeDerivTradeUpdate(rows, { ...rows[0], status: "won", profit: 0.8 });
  notify?.();
  const settled = await settlement;

  assert.equal(settled?.status, "won");
  assert.equal(settled?.profit, 0.8);
  assert.equal(notify, null);
});
