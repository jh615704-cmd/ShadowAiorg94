import { useEffect, useRef, useState } from "react";
import { Bell, Check, CheckCheck, CircleAlert, Trash2, WalletCards, Wifi, X } from "lucide-react";
import type { AccountNotification } from "@/lib/account-notifications";

interface NotificationCenterProps {
  notifications: AccountNotification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClear: () => void;
}

function formatNotificationTime(timestamp: number) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (elapsedSeconds < 60) return "Just now";
  if (elapsedSeconds < 3_600) return relative.format(-Math.floor(elapsedSeconds / 60), "minute");
  if (elapsedSeconds < 86_400) return relative.format(-Math.floor(elapsedSeconds / 3_600), "hour");
  return relative.format(-Math.floor(elapsedSeconds / 86_400), "day");
}

export function NotificationCenter({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onClear,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
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
          aria-label="Account and connection notifications"
        >
          <header className="notification-center-header">
            <div>
              <strong>Notifications</strong>
              <small>{unreadCount > 0 ? unreadLabel : "You’re all caught up"}</small>
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
            <button type="button" onClick={onMarkAllRead} disabled={unreadCount === 0}>
              <CheckCheck size={14} />Mark all read
            </button>
            <button type="button" onClick={onClear} disabled={notifications.length === 0}>
              <Trash2 size={14} />Clear all
            </button>
          </div>

          {notifications.length === 0 ? (
            <div className="notification-center-empty">
              <CircleAlert size={20} aria-hidden="true" />
              <strong>No account updates yet</strong>
              <span>Connection and account changes will appear here.</span>
            </div>
          ) : (
            <ul className="notification-center-list" aria-live="polite">
              {notifications.map((notification) => (
                <li key={notification.id} className={notification.read ? "is-read" : "is-unread"}>
                  <div className={`notification-center-icon ${notification.category}`}>
                    {notification.category === "connection"
                      ? <Wifi size={16} aria-hidden="true" />
                      : <WalletCards size={16} aria-hidden="true" />}
                  </div>
                  <div className="notification-center-copy">
                    <div className="notification-center-item-heading">
                      <strong>{notification.title}</strong>
                      {!notification.read && <span className="notification-center-unread-dot" aria-label="Unread" />}
                    </div>
                    <p>{notification.message}</p>
                    <time dateTime={new Date(notification.createdAt).toISOString()} title={new Date(notification.createdAt).toLocaleString()}>
                      {formatNotificationTime(notification.createdAt)}
                    </time>
                  </div>
                  {!notification.read && (
                    <button
                      type="button"
                      className="notification-center-mark-read"
                      aria-label={`Mark ${notification.title} as read`}
                      title="Mark as read"
                      onClick={() => onMarkRead(notification.id)}
                    >
                      <Check size={15} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
