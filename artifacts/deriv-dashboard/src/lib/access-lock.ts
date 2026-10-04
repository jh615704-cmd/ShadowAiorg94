export const ACCESS_IDLE_LOCK_MS = 10_000;
export const ACCESS_ACTIVE_MARKER = "shadow-access-session-active";
export const ACCESS_LAST_ACTIVITY = "shadow-access-last-activity";

export function isAccessAwayLockDue(
  activeMarker: string | null,
  lastActivity: string | null,
  now = Date.now(),
) {
  if (activeMarker !== "1") return false;
  const lastActivityAt = Number(lastActivity);
  return !Number.isFinite(lastActivityAt) || now - lastActivityAt >= ACCESS_IDLE_LOCK_MS;
}

export function markAccessActivity(now = Date.now()) {
  window.localStorage.setItem(ACCESS_ACTIVE_MARKER, "1");
  window.localStorage.setItem(ACCESS_LAST_ACTIVITY, String(now));
}

export function clearAccessActivity() {
  window.localStorage.removeItem(ACCESS_ACTIVE_MARKER);
  window.localStorage.removeItem(ACCESS_LAST_ACTIVITY);
}