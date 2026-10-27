import { useCallback, useEffect, useMemo, useState } from "react";
import {
  accountNotificationsStorageKey,
  MAX_ACCOUNT_NOTIFICATIONS,
  parseAccountNotifications,
  type AccountNotification,
  type AccountNotificationCategory,
} from "@/lib/account-notifications";

function readNotifications(accessKeyId: string): AccountNotification[] {
  try {
    return parseAccountNotifications(window.sessionStorage.getItem(accountNotificationsStorageKey(accessKeyId)));
  } catch {
    return [];
  }
}

function createNotificationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useAccountNotifications(accessKeyId?: string) {
  const [notifications, setNotifications] = useState<AccountNotification[]>([]);
  const [loadedForAccessKeyId, setLoadedForAccessKeyId] = useState<string | null>(null);
  const isReady = Boolean(accessKeyId && loadedForAccessKeyId === accessKeyId);

  useEffect(() => {
    if (!accessKeyId) {
      setNotifications([]);
      setLoadedForAccessKeyId(null);
      return;
    }

    setNotifications(readNotifications(accessKeyId));
    setLoadedForAccessKeyId(accessKeyId);
  }, [accessKeyId]);

  useEffect(() => {
    if (!accessKeyId || loadedForAccessKeyId !== accessKeyId) return;
    try {
      window.sessionStorage.setItem(accountNotificationsStorageKey(accessKeyId), JSON.stringify(notifications));
    } catch {
      // The notification center still works for this page if browser storage is unavailable.
    }
  }, [accessKeyId, loadedForAccessKeyId, notifications]);

  const addNotification = useCallback((
    category: AccountNotificationCategory,
    title: string,
    message: string,
  ) => {
    if (!accessKeyId || loadedForAccessKeyId !== accessKeyId) return;
    const notification: AccountNotification = {
      id: createNotificationId(),
      category,
      title,
      message,
      createdAt: Date.now(),
      read: false,
    };
    setNotifications((current) => [notification, ...current].slice(0, MAX_ACCOUNT_NOTIFICATIONS));
  }, [accessKeyId, loadedForAccessKeyId]);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((current) => current.map((notification) =>
      notification.id === id ? { ...notification, read: true } : notification,
    ));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((current) => current.map((notification) =>
      notification.read ? notification : { ...notification, read: true },
    ));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    if (!accessKeyId) return;
    try {
      window.sessionStorage.removeItem(accountNotificationsStorageKey(accessKeyId));
    } catch {
      // Clearing the in-memory list still works if browser storage is unavailable.
    }
  }, [accessKeyId]);

  const unreadCount = useMemo(
    () => notifications.reduce((count, notification) => count + Number(!notification.read), 0),
    [notifications],
  );

  return {
    notifications: isReady ? notifications : [],
    unreadCount: isReady ? unreadCount : 0,
    isReady,
    addNotification,
    markNotificationRead,
    markAllNotificationsRead,
    clearNotifications,
  };
}
