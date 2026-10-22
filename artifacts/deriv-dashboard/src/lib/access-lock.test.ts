import assert from "node:assert/strict";
import test from "node:test";
import { ACCESS_IDLE_LOCK_MS, isAccessAwayLockDue } from "./access-lock.ts";

test("the away lock requires a prior active session marker", () => {
  assert.equal(isAccessAwayLockDue(null, "0", ACCESS_IDLE_LOCK_MS * 2), false);
});

test("the away lock triggers after two hours and treats missing activity as stale", () => {
  const lastActivity = 1_000;
  assert.equal(isAccessAwayLockDue("1", String(lastActivity), lastActivity + ACCESS_IDLE_LOCK_MS - 1), false);
  assert.equal(isAccessAwayLockDue("1", String(lastActivity), lastActivity + ACCESS_IDLE_LOCK_MS), true);
  assert.equal(isAccessAwayLockDue("1", null, 1_000), true);
});

test("the away lock ignores activity from another visible tab", () => {
  const lastActivity = 8_000;
  assert.equal(isAccessAwayLockDue("1", String(lastActivity), lastActivity + ACCESS_IDLE_LOCK_MS - 1), false);
  assert.equal(isAccessAwayLockDue("1", String(lastActivity), lastActivity + ACCESS_IDLE_LOCK_MS), true);
});