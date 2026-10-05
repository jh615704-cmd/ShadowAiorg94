import assert from "node:assert/strict";
import test from "node:test";
import { ACCESS_IDLE_LOCK_MS, isAccessAwayLockDue } from "./access-lock.ts";

test("the away lock requires a prior active session marker", () => {
  assert.equal(isAccessAwayLockDue(null, "0", ACCESS_IDLE_LOCK_MS * 2), false);
});

test("the away lock triggers at ten seconds and treats missing activity as stale", () => {
  assert.equal(isAccessAwayLockDue("1", "1000", 10_999), false);
  assert.equal(isAccessAwayLockDue("1", "1000", 11_000), true);
  assert.equal(isAccessAwayLockDue("1", null, 1_000), true);
});

test("the away lock ignores activity from another visible tab", () => {
  const lastActivity = 8_000;
  assert.equal(isAccessAwayLockDue("1", String(lastActivity), 17_999), false);
  assert.equal(isAccessAwayLockDue("1", String(lastActivity), 18_000), true);
});