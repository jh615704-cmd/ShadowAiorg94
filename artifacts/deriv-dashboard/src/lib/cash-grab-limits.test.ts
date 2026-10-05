import assert from "node:assert/strict";
import test from "node:test";
import { getCashGrabLimitReached } from "./cash-grab-limits.ts";

test("Cash Grab stops at or above the settled take-profit target", () => {
  assert.equal(getCashGrabLimitReached(1, 1, 2), "take-profit");
  assert.equal(getCashGrabLimitReached(1.25, 1, 2), "take-profit");
});

test("Cash Grab stops at or below the configured session loss limit", () => {
  assert.equal(getCashGrabLimitReached(-2, 5, 2), "loss-limit");
  assert.equal(getCashGrabLimitReached(-2.5, 5, 2), "loss-limit");
});

test("Cash Grab keeps running below active thresholds and when a threshold is disabled", () => {
  assert.equal(getCashGrabLimitReached(0.99, 1, 2), null);
  assert.equal(getCashGrabLimitReached(-1.99, 5, 2), null);
  assert.equal(getCashGrabLimitReached(100, 0, 0), null);
});

test("Cash Grab rejects invalid P/L limits", () => {
  assert.throws(() => getCashGrabLimitReached(Number.NaN, 1, 1), /P\/L must be finite/);
  assert.throws(() => getCashGrabLimitReached(0, -1, 1), /take-profit must be zero or greater/);
  assert.throws(() => getCashGrabLimitReached(0, 1, Number.POSITIVE_INFINITY), /loss limit must be zero or greater/);
});
