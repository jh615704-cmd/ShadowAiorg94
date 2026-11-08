export const ACCESS_IDLE_LOCK_MS = 3 * 60 * 60 * 1_000;
export const ACCESS_AWAY_LOCK_MS = ACCESS_IDLE_LOCK_MS;
export const ACCESS_IDLE_EXIT_DELAY_MS = 5_000;
export const ACCESS_LOGOUT_EXIT_DELAY_MS = 2_000;
export const ACCESS_REVOCATION_EXIT_DELAY_MS = 10_000;
export const ACCESS_ACTIVE_MARKER = "shadow-access-session-active";
export const ACCESS_LAST_ACTIVITY = "shadow-access-last-activity";
export const ACCESS_AWAY_STARTED = "shadow-access-away-started";

export function isAccessAwayLockDue(
  activeMarker: string | null,
  lastActivity: string | null,
  now = Date.now(),
  awayStarted: string | null = null,
) {
  if (activeMarker !== "1") return false;
  if (awayStarted !== null) {
    const awayStartedAt = Number(awayStarted);
    if (!Number.isFinite(awayStartedAt) || awayStartedAt <= 0 || now - awayStartedAt >= ACCESS_AWAY_LOCK_MS) {
      return true;
    }
  }
  if (lastActivity === null) return true;
  const lastActivityAt = Number(lastActivity);
  return !Number.isFinite(lastActivityAt) || now - lastActivityAt >= ACCESS_IDLE_LOCK_MS;
}

export function markAccessActivity(now = Date.now()) {
  window.localStorage.setItem(ACCESS_ACTIVE_MARKER, "1");
  window.localStorage.setItem(ACCESS_LAST_ACTIVITY, String(now));
  window.localStorage.removeItem(ACCESS_AWAY_STARTED);
}

export function markAccessAway(now = Date.now()) {
  const current = window.localStorage.getItem(ACCESS_AWAY_STARTED);
  if (current === null || !Number.isFinite(Number(current)) || Number(current) <= 0) {
    window.localStorage.setItem(ACCESS_AWAY_STARTED, String(now));
  }
}

export function clearAccessAway() {
  window.localStorage.removeItem(ACCESS_AWAY_STARTED);
}

export function clearAccessActivity() {
  window.localStorage.removeItem(ACCESS_ACTIVE_MARKER);
  window.localStorage.removeItem(ACCESS_LAST_ACTIVITY);
  window.localStorage.removeItem(ACCESS_AWAY_STARTED);
}

export function isAccessSessionStillLocked() {
  return window.localStorage.getItem(ACCESS_ACTIVE_MARKER) === "1"
    && window.localStorage.getItem(ACCESS_LAST_ACTIVITY) === "0";
}
