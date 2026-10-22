import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { createGlobalAnnouncementDismissalKey } from "@/lib/global-announcement";

type Props = {
  message: string;
  viewerId: string;
  identityResolved: boolean;
  placement?: "banner" | "inline";
};

function splitAnnouncement(message: string) {
  const punctuation = message.search(/[.!?](?=\s|$)/);
  if (punctuation < 0) return { headline: message, detail: "" };
  return {
    headline: message.slice(0, punctuation + 1),
    detail: message.slice(punctuation + 1).trim(),
  };
}

export function GlobalFeatureAnnouncement({
  message,
  viewerId,
  identityResolved,
  placement = "banner",
}: Props) {
  const normalizedMessage = message.trim();
  const dismissalKey = createGlobalAnnouncementDismissalKey(viewerId, normalizedMessage);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [fadingKey, setFadingKey] = useState<string | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const { headline, detail } = splitAnnouncement(normalizedMessage);

  useEffect(() => {
    setLoadedKey(null);
    setFadingKey(null);
    let isDismissed = false;
    try {
      isDismissed = window.localStorage.getItem(dismissalKey) === "dismissed";
    } catch {
      // Keep the announcement available if this browser blocks local storage.
    }
    setDismissedKey(isDismissed ? dismissalKey : null);
    setLoadedKey(dismissalKey);

    return () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [dismissalKey]);

  const dismiss = () => {
    if (fadingKey === dismissalKey) return;
    try {
      window.localStorage.setItem(dismissalKey, "dismissed");
    } catch {
      // The current view still fades away when persistent storage is unavailable.
    }
    setFadingKey(dismissalKey);
    dismissTimerRef.current = window.setTimeout(() => {
      setDismissedKey(dismissalKey);
      setFadingKey((current) => current === dismissalKey ? null : current);
      dismissTimerRef.current = null;
    }, 340);
  };

  if (!normalizedMessage || !identityResolved || loadedKey !== dismissalKey || dismissedKey === dismissalKey) {
    return null;
  }

  return (
    <div
      className={`global-feature-announcement ${placement === "inline" ? "is-inline" : ""} ${fadingKey === dismissalKey ? "is-fading" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="global-announcement"
    >
      <span className="global-announcement-indicator" aria-hidden="true" />
      <p className="global-announcement-copy">
        <strong>{headline}</strong>{detail ? ` ${detail}` : ""}
      </p>
      <button
        type="button"
        className="global-announcement-dismiss"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        title="Dismiss announcement"
        data-testid="button-dismiss-global-announcement"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
