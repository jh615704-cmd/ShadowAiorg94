import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_AWAY_LOCK_MS,
  ACCESS_IDLE_EXIT_DELAY_MS,
  ACCESS_IDLE_LOCK_MS,
  ACCESS_LOGOUT_EXIT_DELAY_MS,
  ACCESS_REVOCATION_EXIT_DELAY_MS,
  isAccessAwayLockDue,
} from "./access-lock.ts";

test("idle and away locks are three hours, with distinct exit and revocation countdowns", () => {
  assert.equal(ACCESS_IDLE_LOCK_MS, 3 * 60 * 60 * 1_000);
  assert.equal(ACCESS_AWAY_LOCK_MS, 3 * 60 * 60 * 1_000);
  assert.equal(ACCESS_IDLE_EXIT_DELAY_MS, 5_000);
  assert.equal(ACCESS_LOGOUT_EXIT_DELAY_MS, 2_000);
  assert.equal(ACCESS_REVOCATION_EXIT_DELAY_MS, 10_000);
});

test("the away lock requires a prior active session marker", () => {
  assert.equal(isAccessAwayLockDue(null, "0", ACCESS_IDLE_LOCK_MS * 2), false);
});

test("the three-hour lock treats missing activity as stale", () => {
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

test("a departure stays unlocked briefly and locks after three hours away", () => {
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

test("the idle deadline still applies when the away period is shorter", () => {
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