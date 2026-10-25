import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_AWAY_LOCK_MS,
  ACCESS_IDLE_LOCK_MS,
  ACCESS_REVOCATION_EXIT_DELAY_MS,
  isAccessAwayLockDue,
} from "./access-lock.ts";

test("the workspace idle lock is two hours, the away lock is 30 minutes, and revocation remains ten seconds", () => {
  assert.equal(ACCESS_IDLE_LOCK_MS, 2 * 60 * 60 * 1_000);
  assert.equal(ACCESS_AWAY_LOCK_MS, 30 * 60 * 1_000);
  assert.equal(ACCESS_REVOCATION_EXIT_DELAY_MS, 10_000);
});

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

test("a short departure does not lock, but being away for 30 minutes does", () => {
  const awayStarted = 10_000;
  const lastActivity = awayStarted;
  assert.equal(
    isAccessAwayLockDue("1", String(lastActivity), awayStarted + ACCESS_AWAY_LOCK_MS - 1, String(awayStarted)),
    false,
  );
  assert.equal(
    isAccessAwayLockDue("1", String(lastActivity), awayStarted + ACCESS_AWAY_LOCK_MS, String(awayStarted)),
    true,
  );
});

test("a two-hour idle lock still applies even when the user returns before 30 minutes", () => {
  const lastActivity = 10_000;
  const awayStarted = lastActivity + 1;
  assert.equal(
    isAccessAwayLockDue(
      "1",
      String(lastActivity),
      lastActivity + ACCESS_IDLE_LOCK_MS,
      String(awayStarted),
    ),
    true,
  );
});