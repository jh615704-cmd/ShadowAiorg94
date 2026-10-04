import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  getGetAccessSessionQueryKey,
  useGetAccessSession,
  useLoginAccessKey,
  useLogoutAccessSession,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, LockKeyhole, MessageCircle, ShieldCheck } from "lucide-react";
import {
  ACCESS_ACTIVE_MARKER,
  ACCESS_IDLE_LOCK_MS,
  ACCESS_LAST_ACTIVITY,
  clearAccessActivity,
  isAccessAwayLockDue,
  markAccessActivity,
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
  const candidate = error as { data?: { error?: string }; message?: string };
  return candidate.data?.error ?? candidate.message ?? "That access key could not be accepted.";
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
  ));
  const [lockReason, setLockReason] = useState("");
  const [exitDeadline, setExitDeadline] = useState<number | null>(null);
  const [exitCountdown, setExitCountdown] = useState(10);
  const [logoutPending, setLogoutPending] = useState(false);
  const accessRejectedRef = useRef(accessRejected);
  const sessionWasActiveRef = useRef(false);
  const forcedExitRef = useRef(false);
  const initialAwayLockRef = useRef(accessRejected);
  const logoutInFlightRef = useRef(false);
  const hiddenAtRef = useRef<number | null>(null);
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
  const login = useLoginAccessKey();
  const [accessKey, setAccessKey] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const unlockTimerRef = useRef<number | null>(null);
  const deviceId = useMemo(() => getDeviceId(), []);

  useEffect(() => {
    accessRejectedRef.current = accessRejected;
  }, [accessRejected]);

  const lockAfterAway = useCallback(() => {
    if (accessRejectedRef.current || !sessionWasActiveRef.current) return;
    accessRejectedRef.current = true;
    sessionWasActiveRef.current = false;
    setAccessRejected(true);
    setLockReason("Workspace locked after 10 seconds away. Enter your access key again.");
    setExitDeadline(null);
    setLogoutPending(true);
    // Keep a stale marker until the server confirms logout, so a reload during
    // a network failure still fails closed and asks for the key again.
    window.localStorage.setItem(ACCESS_ACTIVE_MARKER, "1");
    window.localStorage.setItem(ACCESS_LAST_ACTIVITY, "0");
    void queryClient.removeQueries();
    if (logoutInFlightRef.current) return;
    logoutInFlightRef.current = true;
    logoutAccess.mutate(undefined, {
      onSuccess: () => clearAccessActivity(),
      onSettled: () => {
        logoutInFlightRef.current = false;
        setLogoutPending(false);
        queryClient.clear();
        setLocation("/");
      },
    });
  }, [logoutAccess, queryClient, setLocation]);

  const beginRevocationCountdown = useCallback((reason: string) => {
    if (forcedExitRef.current) return;
    forcedExitRef.current = true;
    accessRejectedRef.current = true;
    sessionWasActiveRef.current = false;
    setAccessRejected(true);
    setLockReason(`No more trades — ${reason}.`);
    setExitCountdown(10);
    setExitDeadline(Date.now() + ACCESS_IDLE_LOCK_MS);
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
    setLogoutPending(true);
    logoutAccess.mutate(undefined, {
      onSuccess: () => clearAccessActivity(),
      onSettled: () => {
        logoutInFlightRef.current = false;
        setLogoutPending(false);
        queryClient.clear();
      },
    });
  }, [logoutAccess, queryClient]);

  useEffect(() => {
    if (!accessSession.data || accessRejected) return;
    sessionWasActiveRef.current = true;
    markAccessActivity();
  }, [accessSession.data, accessRejected]);

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
        setExitDeadline(null);
        setLocation("/");
      }
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [exitDeadline, setLocation]);

  useEffect(() => {
    if (!accessSession.data || accessRejected) return;
    markAccessActivity();

    const keepForegroundActivityFresh = window.setInterval(() => {
      if (document.visibilityState === "visible") markAccessActivity();
    }, 1_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        markAccessActivity(hiddenAtRef.current);
        return;
      }

      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt !== null && Date.now() - hiddenAt >= ACCESS_IDLE_LOCK_MS) {
        lockAfterAway();
        return;
      }
      if (isAccessAwayLockDue(
        window.localStorage.getItem(ACCESS_ACTIVE_MARKER),
        window.localStorage.getItem(ACCESS_LAST_ACTIVITY),
      )) {
        lockAfterAway();
        return;
      }
      markAccessActivity();
      void queryClient.invalidateQueries({ queryKey: getGetAccessSessionQueryKey() });
    };

    const onPageHide = () => {
      markAccessActivity();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(keepForegroundActivityFresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [accessRejected, accessSession.data, lockAfterAway, queryClient]);

  useEffect(() => {
    const onManualLock = () => {
      sessionWasActiveRef.current = false;
      accessRejectedRef.current = true;
      setAccessRejected(true);
      setLockReason("Workspace locked. Enter your access key again.");
      setExitDeadline(null);
      clearAccessActivity();
      void queryClient.removeQueries();
    };
    window.addEventListener("shadow-access-key-locked", onManualLock);
    return () => window.removeEventListener("shadow-access-key-locked", onManualLock);
  }, [queryClient]);

  useEffect(() => {
    if (location.startsWith("/admin") && accessSession.data && !accessSession.data.is_admin) {
      setLocation("/app");
    }
  }, [accessSession.data, location, setLocation]);

  if (location === "/sign-in" || location.startsWith("/sign-in/")) return <>{children}</>;
  if (exitDeadline !== null) {
    return (
      <div className="access-gate" role="alert" aria-live="assertive">
        <div className="access-gate-orbit" aria-hidden="true" />
        <div className="access-gate-card access-gate-revoked">
          <div className="access-gate-lock access-gate-lock-revoked"><LockKeyhole size={25} /></div>
          <strong>NO MORE TRADES</strong>
          <p>{lockReason}</p>
          <span>Returning to access-key login in <b>{exitCountdown}</b> seconds.</span>
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
    <div className="access-gate">
      <div className="access-gate-orbit" aria-hidden="true" />
      <div className="access-gate-card">
        <div className="brand-lockup access-gate-brand">
          <span className="brand-mark">S</span>
          <span className="access-brand-copy"><strong>Shadow Ai Trading</strong><small>AI Trading</small></span>
        </div>
        <div className="access-gate-risk"><b>RISK DISCLAIMER</b><p>Deriv offers complex derivatives, such as options and contracts for difference (“CFDs”). These products may not be suitable for all clients, and trading them puts you at risk. You may lose some or all of the money you invest. If your trade involves currency conversion, exchange rates affect your profits and losses. Never trade with borrowed money or money you cannot afford to lose.</p></div>
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