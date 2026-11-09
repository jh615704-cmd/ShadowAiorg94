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
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Loader2,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Shield,
  ShieldCheck,
} from "lucide-react";
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
import "./access-gate-reference.css";

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
  const [showAccessKey, setShowAccessKey] = useState(false);
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
    <div className={`access-gate access-gate-login${lockReason ? " access-gate-login-enter" : ""}`}>
      <div className="access-gate-orbit" aria-hidden="true" />
      <div className="access-gate-login-grid" aria-hidden="true" />
      <div className="access-gate-login-glow" aria-hidden="true" />
      <svg className="access-gate-login-network" viewBox="0 0 1000 1500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g className="network-lines">
          <path d="M55 170 225 250 340 165 485 270 635 175 820 260 955 155" />
          <path d="M15 475 175 390 330 500 470 390 620 500 780 405 990 520" />
          <path d="M10 815 165 710 335 840 480 720 650 835 805 715 990 850" />
          <path d="M0 1190 165 1060 335 1190 490 1085 645 1205 820 1080 1000 1190" />
          <path d="M225 250 175 390 165 710 165 1060" />
          <path d="M485 270 470 390 480 720 490 1085" />
          <path d="M820 260 780 405 805 715 820 1080" />
          <path d="M340 165 330 500 335 840 335 1190" />
          <path d="M635 175 620 500 650 835 645 1205" />
          <path d="M55 170 175 390 330 500 480 720 650 835 820 1080 990 1190" />
          <path d="M955 155 780 405 620 500 480 720 335 840 165 1060 0 1190" />
        </g>
        <g className="network-flow">
          <path d="M55 170 225 250 340 165 485 270 635 175 820 260 955 155" />
          <path d="M15 475 175 390 330 500 470 390 620 500 780 405 990 520" />
          <path d="M10 815 165 710 335 840 480 720 650 835 805 715 990 850" />
          <path d="M0 1190 165 1060 335 1190 490 1085 645 1205 820 1080 1000 1190" />
          <path d="M225 250 175 390 165 710 165 1060" />
          <path d="M485 270 470 390 480 720 490 1085" />
          <path d="M820 260 780 405 805 715 820 1080" />
          <path d="M340 165 330 500 335 840 335 1190" />
          <path d="M635 175 620 500 650 835 645 1205" />
          <path d="M55 170 175 390 330 500 480 720 650 835 820 1080 990 1190" />
          <path d="M955 155 780 405 620 500 480 720 335 840 165 1060 0 1190" />
        </g>
        <g className="network-nodes">
          <circle cx="55" cy="170" r="3" />
          <circle cx="225" cy="250" r="3" />
          <circle cx="340" cy="165" r="2.5" />
          <circle cx="485" cy="270" r="3" />
          <circle cx="635" cy="175" r="2.5" />
          <circle cx="820" cy="260" r="3" />
          <circle cx="955" cy="155" r="2.5" />
          <circle cx="175" cy="390" r="3" />
          <circle cx="330" cy="500" r="2.5" />
          <circle cx="470" cy="390" r="3" />
          <circle cx="620" cy="500" r="2.5" />
          <circle cx="780" cy="405" r="3" />
          <circle cx="165" cy="710" r="2.5" />
          <circle cx="335" cy="840" r="3" />
          <circle cx="480" cy="720" r="2.5" />
          <circle cx="650" cy="835" r="3" />
          <circle cx="805" cy="715" r="2.5" />
          <circle cx="165" cy="1060" r="3" />
          <circle cx="335" cy="1190" r="2.5" />
          <circle cx="490" cy="1085" r="3" />
          <circle cx="645" cy="1205" r="2.5" />
          <circle cx="820" cy="1080" r="3" />
        </g>
        <g className="network-particles">
          <circle r="4">
            <animateMotion dur="8s" repeatCount="indefinite" path="M55 170 L225 250 L340 165 L485 270 L635 175 L820 260 L955 155" />
            <animate attributeName="opacity" values="0;.9;.9;0" keyTimes="0;.1;.85;1" dur="8s" repeatCount="indefinite" />
          </circle>
          <circle r="3.5">
            <animateMotion begin="1.7s" dur="9.5s" repeatCount="indefinite" path="M10 815 L165 710 L335 840 L480 720 L650 835 L805 715 L990 850" />
            <animate attributeName="opacity" values="0;.8;.8;0" keyTimes="0;.1;.85;1" begin="1.7s" dur="9.5s" repeatCount="indefinite" />
          </circle>
          <circle r="3.5">
            <animateMotion begin="3.2s" dur="11s" repeatCount="indefinite" path="M955 155 L780 405 L620 500 L480 720 L335 840 L165 1060 L0 1190" />
            <animate attributeName="opacity" values="0;.75;.75;0" keyTimes="0;.1;.85;1" begin="3.2s" dur="11s" repeatCount="indefinite" />
          </circle>
        </g>
      </svg>
      <div className="access-gate-card">
        <div className="brand-lockup access-gate-brand">
          <span className="access-gate-brand-icon" aria-hidden="true"><Shield size={23} strokeWidth={2.5} /></span>
          <span className="access-brand-copy">
            <strong>Shadow AI <span className="access-gate-version">v4.8</span></strong>
            <small>AUTONOMOUS ALGORITHMIC TRADING</small>
          </span>
        </div>
        <div className="access-gate-risk">
          <AlertTriangle size={14} strokeWidth={2.5} aria-hidden="true" />
          <div>
            <b>HIGH TRADING RISK NOTICE</b>
            <p>
              Options and leveraged CFDs carry significant risk. You may lose
              capital exceeding initial deposits. Ensure you understand
              algorithmic execution mechanics before deploying capital.
            </p>
          </div>
        </div>
        <div className="access-gate-lock" aria-hidden="true"><Fingerprint size={26} strokeWidth={1.8} /></div>
        <h1>Login to Shadow AI</h1>
        <p className="access-gate-intro">Authenticate with your private access key to initialize workspace</p>
        {lockReason && <div className="access-gate-locked-note" role="status">{lockReason}</div>}
        <a className="access-message-link" href="https://t.me/JDY_HATED" target="_blank" rel="noreferrer">
          <MessageCircle size={16} fill="currentColor" strokeWidth={1.5} />
          Message Support / Get Access Key
        </a>
        <div className="access-gate-divider"><span>SECURE GATEWAY</span></div>
        {error && <div className="access-gate-error" role="alert">{error}</div>}
        <form onSubmit={handleSubmit} className="access-gate-form">
          <label htmlFor="edge-access-key">ACCESS KEY</label>
          <div className="access-gate-input">
            <KeyRound size={16} aria-hidden="true" />
            <input
              id="edge-access-key"
              type={showAccessKey ? "text" : "password"}
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              placeholder="shdw_live_XXXXXXXX..."
              autoComplete="off"
              disabled={login.isPending || logoutPending}
            />
            <button
              className="access-gate-show-key"
              type="button"
              aria-label={showAccessKey ? "Hide access key" : "Show access key"}
              aria-pressed={showAccessKey}
              onClick={() => setShowAccessKey((current) => !current)}
              disabled={login.isPending || logoutPending}
            >
              {showAccessKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <label className="access-terms">
            <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} disabled={login.isPending} />
            <span>
              I acknowledge and agree to the algorithmic trading terms, automated
              risk protocols, and privacy policies of Shadow AI Trading.
            </span>
          </label>
          <button type="submit" disabled={login.isPending || logoutPending || !accessKey.trim() || !termsAccepted}>
            {logoutPending
              ? <><Loader2 className="spin" size={16} /> Locking previous session…</>
              : login.isPending
                ? <><Loader2 className="spin" size={16} /> Checking key…</>
                : <><span>Unlock Workspace</span><ArrowRight size={16} strokeWidth={2.4} /></>}
          </button>
        </form>
        <footer className="access-gate-footer">
          <span className="access-gate-nodes"><i /> Nodes Online</span>
          <span>Secure connection</span>
        </footer>
      </div>
    </div>
  );
}