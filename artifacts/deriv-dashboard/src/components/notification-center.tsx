import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  CircleAlert,
  Trash2,
  WalletCards,
  Wifi,
  X,
} from "lucide-react";
import type { AccountNotification } from "@/lib/account-notifications";

interface NotificationCenterProps {
  notifications: AccountNotification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onMarkAllRead: () => void;
}

function formatNotificationTime(timestamp: number) {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 1000),
  );
  const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (elapsedSeconds < 60) return "Just now";
  if (elapsedSeconds < 3_600)
    return relative.format(-Math.floor(elapsedSeconds / 60), "minute");
  if (elapsedSeconds < 86_400)
    return relative.format(-Math.floor(elapsedSeconds / 3_600), "hour");
  return relative.format(-Math.floor(elapsedSeconds / 86_400), "day");
}

export function NotificationCenter({
  notifications,
  unreadCount,
  onMarkRead,
  onDismiss,
  onMarkAllRead,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const exitingIdsRef = useRef(new Set<string>());
  const dismissTimersRef = useRef(new Map<string, number>());

  const beginDismiss = (id: string) => {
    if (exitingIdsRef.current.has(id)) return;
    const nextExitingIds = new Set(exitingIdsRef.current);
    nextExitingIds.add(id);
    exitingIdsRef.current = nextExitingIds;
    setExitingIds(nextExitingIds);

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(
      () => {
        dismissTimersRef.current.delete(id);
        onDismiss(id);
        const remaining = new Set(exitingIdsRef.current);
        remaining.delete(id);
        exitingIdsRef.current = remaining;
        setExitingIds(remaining);
      },
      reducedMotion ? 0 : 260,
    );
    dismissTimersRef.current.set(id, timer);
  };
  const beginDismissAll = () => {
    for (const notification of notifications) {
      beginDismiss(notification.id);
    }
  };

  useEffect(
    () => () => {
      for (const timer of dismissTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      dismissTimersRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const unreadLabel = `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`;

  return (
    <div className="notification-center" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`notification-center-trigger${unreadCount > 0 ? " has-unread" : ""}`}
        aria-label={`Open notifications, ${unreadLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="account-notification-panel"
        onClick={() => setOpen((current) => !current)}
        data-testid="button-notifications"
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="notification-center-count" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          id="account-notification-panel"
          className="notification-center-panel"
          role="dialog"
          aria-label="Account, connection, and workspace notifications"
        >
          <header className="notification-center-header">
            <div>
              <strong>Notifications</strong>
              <small>
                {unreadCount > 0 ? unreadLabel : "You’re all caught up"}
              </small>
            </div>
            <button
              type="button"
              className="notification-center-close"
              aria-label="Close notifications"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <X size={17} />
            </button>
          </header>

          <div className="notification-center-actions">
            <button
              type="button"
              onClick={onMarkAllRead}
              disabled={unreadCount === 0}
            >
              <CheckCheck size={14} />
              Mark all read
            </button>
            <button
              type="button"
              onClick={beginDismissAll}
              disabled={
                notifications.length === 0 ||
                notifications.every((notification) =>
                  exitingIds.has(notification.id),
                )
              }
            >
              <Trash2 size={14} />
              Clear all
            </button>
          </div>

          {notifications.length === 0 ? (
            <div className="notification-center-empty">
              <CircleAlert size={20} aria-hidden="true" />
              <strong>No updates yet</strong>
              <span>
                Account, connection, and workspace updates will appear here.
              </span>
            </div>
          ) : (
            <ul className="notification-center-list" aria-live="polite">
              {notifications.map((notification) => {
                const isDismissing = exitingIds.has(notification.id);
                return (
                  <li
                    key={notification.id}
                    className={`${notification.read ? "is-read" : "is-unread"}${isDismissing ? " is-dismissing" : ""}`}
                    aria-busy={isDismissing}
                  >
                    <div
                      className={`notification-center-icon ${notification.category}`}
                    >
                      {notification.category === "connection" ? (
                        <Wifi size={16} aria-hidden="true" />
                      ) : (
                        <WalletCards size={16} aria-hidden="true" />
                      )}
                    </div>
                    <div className="notification-center-copy">
                      <div className="notification-center-item-heading">
                        <strong>{notification.title}</strong>
                        {!notification.read && (
                          <span
                            className="notification-center-unread-dot"
                            aria-label="Unread"
                          />
                        )}
                      </div>
                      <p>{notification.message}</p>
                      <time
                        dateTime={new Date(
                          notification.createdAt,
                        ).toISOString()}
                        title={new Date(
                          notification.createdAt,
                        ).toLocaleString()}
                      >
                        {formatNotificationTime(notification.createdAt)}
                      </time>
                    </div>
                    <div className="notification-center-item-actions">
                      {!notification.read && (
                        <button
                          type="button"
                          className="notification-center-mark-read"
                          aria-label={`Mark ${notification.title} as read`}
                          title="Mark as read"
                          disabled={isDismissing}
                          onClick={() => onMarkRead(notification.id)}
                        >
                          <Check size={15} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="notification-center-dismiss"
                        aria-label={`Clear ${notification.title}`}
                        title="Clear notification"
                        disabled={isDismissing}
                        onClick={() => beginDismiss(notification.id)}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
