import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  getGetAccessSessionQueryKey,
  getUserFacingErrorMessage,
  useGetAccessSession,
  useHeartbeatAccessSession,
  useLoginAccessKey,
  useLogoutAccessSession,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, LockKeyhole, LogOut, MessageCircle, ShieldCheck } from "lucide-react";
import {
  ACCESS_AWAY_LOCK_MS,
  ACCESS_AWAY_STARTED,
  ACCESS_ACTIVE_MARKER,
  ACCESS_IDLE_EXIT_DELAY_MS,
  ACCESS_IDLE_LOCK_MS,
  ACCESS_LAST_ACTIVITY,
  ACCESS_LOGOUT_EXIT_DELAY_MS,
  ACCESS_REVOCATION_EXIT_DELAY_MS,
  clearAccessAway,
  clearAccessActivity,
  isAccessAwayLockDue,
  markAccessAway,
  markAccessActivity,
  isAccessSessionStillLocked,
} from "@/lib/access-lock";

const DEVICE_STORAGE_KEY = "jdy-edge-device-id";

function getDeviceId() {
  const saved = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (saved) return saved;
  const next = `browser-${crypto.randomUUID()}`;
  window.localStorage.setItem(DEVICE_STORAGE_KEY, next);
  return next;
}

function getErrorMessage(error: unknown) {
  return getUserFacingErrorMessage(error, "That access key could not be accepted.");
}

function getErrorStatus(error: unknown) {
  const candidate = error as { status?: number };
  return candidate.status;
}

export function AccessGate({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const logoutAccess = useLogoutAccessSession();
  const [accessRejected, setAccessRejected] = useState(() => isAccessAwayLockDue(
    window.localStorage.getItem(ACCESS_ACTIVE_MARKER),
    window.localStorage.getItem(ACCESS_LAST_ACTIVITY),
    Date.now(),
    window.localStorage.getItem(ACCESS_AWAY_STARTED),
  ));
  const [lockReason, setLockReason] = useState(() => {
    if (!accessRejected) return "";
    const awayStarted = Number(window.localStorage.getItem(ACCESS_AWAY_STARTED));
    return Number.isFinite(awayStarted)
      && awayStarted > 0
      && Date.now() - awayStarted >= ACCESS_AWAY_LOCK_MS
      ? "Workspace locked after three hours away. Enter your access key again."
      : "Workspace locked after three hours without activity. Enter your access key again.";
  });
  const [exitDeadline, setExitDeadline] = useState<number | null>(() =>
    accessRejected ? Date.now() + ACCESS_IDLE_EXIT_DELAY_MS : null,
  );
  const [exitCountdown, setExitCountdown] = useState(() =>
    accessRejected ? ACCESS_IDLE_EXIT_DELAY_MS / 1_000 : ACCESS_REVOCATION_EXIT_DELAY_MS / 1_000,
  );
  const [exitKind, setExitKind] = useState<"idle" | "logout" | "revocation" | null>(() =>
    accessRejected ? "idle" : null,
  );
  const [logoutPending, setLogoutPending] = useState(false);
  const accessRejectedRef = useRef(accessRejected);
  const sessionWasActiveRef = useRef(false);
  const forcedExitRef = useRef(false);
  const initialAwayLockRef = useRef(accessRejected);
  const logoutInFlightRef = useRef(false);
  const observedActivityAtRef = useRef(0);
  const lastPersistedActivityAtRef = useRef(0);
  const accessSession = useGetAccessSession({
    query: {
      retry: false,
      enabled: !accessRejected,
      refetchOnWindowFocus: true,
      refetchInterval: (query) => query.state.data && !accessRejected ? 2_000 : false,
      refetchIntervalInBackground: true,
      queryKey: getGetAccessSessionQueryKey(),
    },
  });
  const heartbeatAccess = useHeartbeatAccessSession().mutate;
  const login = useLoginAccessKey();
  const [accessKey, setAccessKey] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const unlockTimerRef = useRef<number | null>(null);
  const deviceId = useMemo(() => getDeviceId(), []);
  const exitDurationMs = exitKind === "logout"
    ? ACCESS_LOGOUT_EXIT_DELAY_MS
    : exitKind === "revocation"
      ? ACCESS_REVOCATION_EXIT_DELAY_MS
      : ACCESS_IDLE_EXIT_DELAY_MS;

  useEffect(() => {
    accessRejectedRef.current = accessRejected;
  }, [accessRejected]);

  const lockAfterAway = useCallback((
    message = "Workspace locked after three hours without activity. Enter your access key again.",
  ) => {
    if (accessRejectedRef.current || !sessionWasActiveRef.current) return;
    accessRejectedRef.current = true;
    sessionWasActiveRef.current = false;
    setAccessRejected(true);
    setLockReason(message);
    setExitKind("idle");
    setExitCountdown(ACCESS_IDLE_EXIT_DELAY_MS / 1_000);
    setExitDeadline(Date.now() + ACCESS_IDLE_EXIT_DELAY_MS);
    setLogoutPending(true);
    // Keep a stale marker until the server confirms logout, so a reload during
    // a network failure still fails closed and asks for the key again.
    window.localStorage.setItem(ACCESS_ACTIVE_MARKER, "1");
    window.localStorage.setItem(ACCESS_LAST_ACTIVITY, "0");
    void queryClient.removeQueries();
    if (logoutInFlightRef.current) return;
    logoutInFlightRef.current = true;
    let clearQueriesAfterLogout = false;
    logoutAccess.mutate(undefined, {
      onSuccess: () => {
        if (!isAccessSessionStillLocked()) return;
        clearQueriesAfterLogout = true;
        clearAccessActivity();
      },
      onSettled: () => {
        logoutInFlightRef.current = false;
        setLogoutPending(false);
        if (clearQueriesAfterLogout || isAccessSessionStillLocked()) queryClient.clear();
      },
    });
  }, [logoutAccess, queryClient]);

  const beginRevocationCountdown = useCallback((reason: string) => {
    if (forcedExitRef.current) return;
    forcedExitRef.current = true;
    accessRejectedRef.current = true;
    sessionWasActiveRef.current = false;
    setAccessRejected(true);
    setLockReason(`No more trades — ${reason}.`);
    setExitKind("revocation");
    setExitCountdown(ACCESS_REVOCATION_EXIT_DELAY_MS / 1_000);
    setExitDeadline(Date.now() + ACCESS_REVOCATION_EXIT_DELAY_MS);
    clearAccessActivity();
    void queryClient.removeQueries();
  }, [queryClient]);

  useEffect(() => () => {
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!initialAwayLockRef.current || logoutInFlightRef.current) return;
    initialAwayLockRef.current = false;
    logoutInFlightRef.current = true;
    window.localStorage.setItem(ACCESS_ACTIVE_MARKER, "1");
    window.localStorage.setItem(ACCESS_LAST_ACTIVITY, "0");
    window.localStorage.removeItem(ACCESS_AWAY_STARTED);
    setLogoutPending(true);
    let clearQueriesAfterLogout = false;
    logoutAccess.mutate(undefined, {
      onSuccess: () => {
        if (!isAccessSessionStillLocked()) return;
        clearQueriesAfterLogout = true;
        clearAccessActivity();
      },
      onSettled: () => {
        logoutInFlightRef.current = false;
        setLogoutPending(false);
        if (clearQueriesAfterLogout || isAccessSessionStillLocked()) queryClient.clear();
      },
    });
  }, [logoutAccess, queryClient]);

  useEffect(() => {
    if (!accessSession.data || accessRejected) return;
    sessionWasActiveRef.current = true;
    if (window.localStorage.getItem(ACCESS_ACTIVE_MARKER) !== "1") {
      markAccessActivity();
    }
  }, [accessSession.data, accessRejected]);

  useEffect(() => {
    if (!accessSession.data || accessRejected) return;
    const timer = window.setInterval(() => heartbeatAccess(), 30_000);
    return () => window.clearInterval(timer);
  }, [accessRejected, accessSession.data, heartbeatAccess]);

  useEffect(() => {
    if (!sessionWasActiveRef.current || !accessSession.isError || accessRejected) return;
    const status = getErrorStatus(accessSession.error);
    if (status !== 401 && status !== 403) return;
    beginRevocationCountdown(getErrorMessage(accessSession.error));
  }, [accessRejected, accessSession.error, accessSession.isError, beginRevocationCountdown]);

  useEffect(() => {
    if (exitDeadline === null) return;
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((exitDeadline - Date.now()) / 1_000));
      setExitCountdown(remaining);
      if (remaining === 0) {
        if (exitKind === "logout" || exitKind === "idle") setLogoutPending(false);
        setExitDeadline(null);
        setExitKind(null);
        void queryClient.removeQueries();
        setLocation("/");
      }
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [exitDeadline, exitKind, queryClient, setLocation]);

  useEffect(() => {
    if (!accessSession.data || accessRejected) return;

    const isIdleLockDue = () => {
      const persistedActivityAt = Number(window.localStorage.getItem(ACCESS_LAST_ACTIVITY));
      const mostRecentActivityAt = Math.max(
        Number.isFinite(persistedActivityAt) ? persistedActivityAt : 0,
        observedActivityAtRef.current,
      );
      return isAccessAwayLockDue(
        window.localStorage.getItem(ACCESS_ACTIVE_MARKER),
        mostRecentActivityAt > 0 ? String(mostRecentActivityAt) : null,
        Date.now(),
        window.localStorage.getItem(ACCESS_AWAY_STARTED),
      );
    };

    const getLockMessage = () => {
      const awayStarted = Number(window.localStorage.getItem(ACCESS_AWAY_STARTED));
      if (Number.isFinite(awayStarted) && awayStarted > 0 && Date.now() - awayStarted >= ACCESS_AWAY_LOCK_MS) {
        return "Workspace locked after three hours away. Enter your access key again.";
      }
      return "Workspace locked after three hours without activity. Enter your access key again.";
    };

    const onUserActivity = () => {
      if (document.visibilityState !== "visible" || accessRejectedRef.current) return;
      if (isIdleLockDue()) {
        lockAfterAway(getLockMessage());
        return;
      }
      const now = Date.now();
      observedActivityAtRef.current = now;
      if (now - lastPersistedActivityAtRef.current >= 1_000) {
        markAccessActivity(now);
        lastPersistedActivityAtRef.current = now;
      }
    };

    const checkIdleLock = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      if (isIdleLockDue()) lockAfterAway(getLockMessage());
    };

    const idleLockTimer = window.setInterval(checkIdleLock, 1_000);

    const onResume = () => {
      if (document.visibilityState !== "visible" || accessRejectedRef.current) return;
      if (accessRejectedRef.current || isIdleLockDue()) {
        lockAfterAway(getLockMessage());
        return;
      }
      clearAccessAway();
      heartbeatAccess();
      void queryClient.invalidateQueries({ queryKey: getGetAccessSessionQueryKey() });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markAccessAway();
        return;
      }
      onResume();
    };

    const onPageExit = () => {
      markAccessAway();
    };
    const onPageShow = () => {
      onResume();
    };

    if (document.visibilityState === "visible" && window.localStorage.getItem(ACCESS_AWAY_STARTED) !== null) {
      onResume();
    }

    const activityEvents = ["pointerdown", "pointermove", "keydown", "input", "touchstart", "wheel", "scroll", "click"] as const;
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, onUserActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onPageExit);
    window.addEventListener("focus", onResume);
    window.addEventListener("pagehide", onPageExit);
    window.addEventListener("beforeunload", onPageExit);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearInterval(idleLockTimer);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, onUserActivity);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onPageExit);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("pagehide", onPageExit);
      window.removeEventListener("beforeunload", onPageExit);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [accessRejected, accessSession.data, heartbeatAccess, lockAfterAway, queryClient]);

  useEffect(() => {
    const onManualLock = () => {
      sessionWasActiveRef.current = false;
      accessRejectedRef.current = true;
      setAccessRejected(true);
      setLockReason("Workspace locked. Enter your access key again.");
      setExitKind("logout");
      setExitCountdown(ACCESS_LOGOUT_EXIT_DELAY_MS / 1_000);
      setExitDeadline(Date.now() + ACCESS_LOGOUT_EXIT_DELAY_MS);
      setLogoutPending(true);
      window.localStorage.setItem(ACCESS_ACTIVE_MARKER, "1");
      window.localStorage.setItem(ACCESS_LAST_ACTIVITY, "0");
      window.localStorage.removeItem(ACCESS_AWAY_STARTED);
      void queryClient.removeQueries();
    };
    const onLogoutSettled = () => setLogoutPending(false);
    window.addEventListener("shadow-access-key-locked", onManualLock);
    window.addEventListener("shadow-access-key-logout-settled", onLogoutSettled);
    return () => {
      window.removeEventListener("shadow-access-key-locked", onManualLock);
      window.removeEventListener("shadow-access-key-logout-settled", onLogoutSettled);
    };
  }, [queryClient]);

  useEffect(() => {
    if (location.startsWith("/admin") && accessSession.data && !accessSession.data.is_admin) {
      setLocation("/app");
    }
  }, [accessSession.data, location, setLocation]);

  if (location === "/sign-in" || location.startsWith("/sign-in/")) return <>{children}</>;
  if (exitDeadline !== null) {
    const ExitIcon = exitKind === "logout" ? LogOut : LockKeyhole;
    const title = exitKind === "revocation"
      ? "NO MORE TRADES"
      : exitKind === "logout"
        ? "SECURE LOGOUT"
        : "SESSION LOCKED";
    return (
      <div
        className={`access-gate access-gate-countdown${exitKind === "revocation" ? " is-revoked" : ""}`}
        role={exitKind === "revocation" ? "alert" : "status"}
        aria-live={exitKind === "revocation" ? "assertive" : "polite"}
        aria-atomic="true"
        data-testid="access-exit-transition"
      >
        <div className="access-gate-orbit" aria-hidden="true" />
        <div className={`access-gate-card access-gate-transition-card${exitKind === "revocation" ? " access-gate-revoked" : ""}`}>
          <div className={`access-gate-lock access-gate-transition-icon${exitKind === "revocation" ? " access-gate-lock-revoked" : ""}`}>
            <ExitIcon size={25} />
          </div>
          <strong>{title}</strong>
          <p>{lockReason}</p>
          <div className="access-gate-exit-progress" aria-hidden="true" data-testid="access-exit-progress">
            <span style={{ animationDuration: `${exitDurationMs}ms` }} />
          </div>
          <div className="access-gate-exit-countdown">
            <span>Returning to access-key login in</span>
            <b data-testid="access-exit-countdown">{exitCountdown}</b>
            <span>seconds</span>
          </div>
        </div>
      </div>
    );
  }
  if (!accessRejected && accessSession.isLoading) {
    return (
      <div className="access-gate">
        <div className="access-gate-card access-gate-loading">
          <Loader2 className="spin" size={26} />
          <span>Checking access…</span>
        </div>
      </div>
    );
  }

  if (!accessRejected && accessSession.data) {
    return (
      <>
        {children}
        {isUnlocking && (
          <div className="access-gate access-gate-exit" role="status" aria-live="polite">
            <div className="access-gate-card access-gate-unlocking">
              <ShieldCheck size={26} />
              <strong>Access verified</strong>
              <span>Opening your workspace…</span>
            </div>
          </div>
        )}
      </>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const session = await login.mutateAsync({
        data: { access_key: accessKey.trim(), device_id: deviceId },
      });
      // The login response is already the server-verified session. Put it in
      // the cache immediately instead of waiting for a second request that
      // can briefly race the cookie update in the browser.
      queryClient.clear();
      queryClient.setQueryData(getGetAccessSessionQueryKey(), session);
      accessRejectedRef.current = false;
      sessionWasActiveRef.current = true;
      forcedExitRef.current = false;
      setAccessRejected(false);
      setLockReason("");
      setExitDeadline(null);
      clearAccessActivity();
      markAccessActivity();
      setAccessKey("");
      setIsUnlocking(true);
      unlockTimerRef.current = window.setTimeout(() => {
        setLocation("/app");
        unlockTimerRef.current = window.setTimeout(() => {
          setIsUnlocking(false);
          unlockTimerRef.current = null;
        }, 180);
      }, 300);
    } catch (loginError) {
      setError(getErrorMessage(loginError));
    }
  };

  return (
    <div className={`access-gate${lockReason ? " access-gate-login-enter" : ""}`}>
      <div className="access-gate-orbit" aria-hidden="true" />
      <div className="access-gate-card">
        <div className="brand-lockup access-gate-brand">
          <span className="brand-mark">S</span>
          <span className="access-brand-copy"><strong>Shadow Ai Trading</strong><small>AI Trading</small></span>
        </div>
        <div className="access-gate-risk"><b>TRADING RISK</b><p>Options and CFDs are risky. You may lose some or all of your money; currency conversion can affect results. Never trade with borrowed money or money you cannot afford to lose.</p></div>
        <div className="access-gate-lock"><ShieldCheck size={25} /></div>
        <h1>Login to Shadow Ai</h1>
        <p className="access-gate-intro">Use your access key to open your private trading workspace.</p>
        {lockReason && <div className="access-gate-locked-note" role="status">{lockReason}</div>}
        <a className="access-message-link" href="https://t.me/JDY_HATED" target="_blank" rel="noreferrer"><MessageCircle size={16} /> Message me now</a>
        {error && <div className="access-gate-error" role="alert">{error}</div>}
        <form onSubmit={handleSubmit} className="access-gate-form">
          <label htmlFor="edge-access-key">ACCESS KEY</label>
          <div className="access-gate-input">
            <KeyRound size={17} />
            <input
              id="edge-access-key"
              type="password"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              placeholder="Enter your access key"
              autoComplete="off"
              autoFocus
              disabled={login.isPending || logoutPending}
            />
          </div>
          <label className="access-terms"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} disabled={login.isPending} /><span>I acknowledge and agree to the terms and conditions of Shadow Ai Trading.</span></label>
          <button type="submit" disabled={login.isPending || logoutPending || !accessKey.trim() || !termsAccepted}>
            {logoutPending ? <><Loader2 className="spin" size={16} /> Locking previous session…</> : login.isPending ? <><Loader2 className="spin" size={16} /> Checking key…</> : "Unlock workspace"}
          </button>
        </form>
      </div>
    </div>
  );
}