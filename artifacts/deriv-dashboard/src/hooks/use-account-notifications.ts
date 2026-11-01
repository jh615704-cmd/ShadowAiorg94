import { useCallback, useEffect, useMemo, useState } from "react";
import {
  accountNotificationsStorageKey,
  MAX_ACCOUNT_NOTIFICATIONS,
  parseAccountNotifications,
  removeOpenContractSettlementWaitMessages,
  type AccountNotification,
  type AccountNotificationCategory,
} from "@/lib/account-notifications";

function readNotifications(accessKeyId: string): AccountNotification[] {
  try {
    return parseAccountNotifications(
      window.sessionStorage.getItem(
        accountNotificationsStorageKey(accessKeyId),
      ),
    );
  } catch {
    return [];
  }
}

function createNotificationId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useAccountNotifications(accessKeyId?: string) {
  const [notifications, setNotifications] = useState<AccountNotification[]>([]);
  const [loadedForAccessKeyId, setLoadedForAccessKeyId] = useState<
    string | null
  >(null);
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
      window.sessionStorage.setItem(
        accountNotificationsStorageKey(accessKeyId),
        JSON.stringify(notifications),
      );
    } catch {
      // The notification center still works for this page if browser storage is unavailable.
    }
  }, [accessKeyId, loadedForAccessKeyId, notifications]);

  const addNotification = useCallback(
    (category: AccountNotificationCategory, title: string, message: string) => {
      if (!accessKeyId || loadedForAccessKeyId !== accessKeyId) return;
      const safeTitle = title.slice(0, 120);
      const safeMessage = removeOpenContractSettlementWaitMessages(message).slice(0, 500);
      if (!safeMessage) return;
      const createdAt = Date.now();
      const notification: AccountNotification = {
        id: createNotificationId(),
        category,
        title: safeTitle,
        message: safeMessage,
        createdAt,
        read: false,
      };
      setNotifications((current) => {
        const duplicate = current.some(
          (item) =>
            item.category === category &&
            item.title === safeTitle &&
            item.message === safeMessage &&
            createdAt - item.createdAt < 8_000,
        );
        return duplicate
          ? current
          : [notification, ...current].slice(0, MAX_ACCOUNT_NOTIFICATIONS);
      });
    },
    [accessKeyId, loadedForAccessKeyId],
  );

  const upsertNotification = useCallback(
    (category: AccountNotificationCategory, title: string, message: string) => {
      if (!accessKeyId || loadedForAccessKeyId !== accessKeyId) return;
      const safeTitle = title.slice(0, 120);
      const safeMessage = removeOpenContractSettlementWaitMessages(message).slice(0, 500);
      if (!safeMessage) return;
      const createdAt = Date.now();
      setNotifications((current) => {
        const existing = current.find(
          (item) => item.category === category && item.title === safeTitle,
        );
        const notification: AccountNotification = {
          id: existing?.id ?? createNotificationId(),
          category,
          title: safeTitle,
          message: safeMessage,
          createdAt,
          read: false,
        };
        return [
          notification,
          ...current.filter((item) => item.id !== existing?.id),
        ].slice(0, MAX_ACCOUNT_NOTIFICATIONS);
      });
    },
    [accessKeyId, loadedForAccessKeyId],
  );

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification,
      ),
    );
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((current) =>
      current.filter((notification) => notification.id !== id),
    );
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.read ? notification : { ...notification, read: true },
      ),
    );
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    if (!accessKeyId) return;
    try {
      window.sessionStorage.removeItem(
        accountNotificationsStorageKey(accessKeyId),
      );
    } catch {
      // Clearing the in-memory list still works if browser storage is unavailable.
    }
  }, [accessKeyId]);

  const unreadCount = useMemo(
    () =>
      notifications.reduce(
        (count, notification) => count + Number(!notification.read),
        0,
      ),
    [notifications],
  );

  return {
    notifications: isReady ? notifications : [],
    unreadCount: isReady ? unreadCount : 0,
    isReady,
    addNotification,
    upsertNotification,
    markNotificationRead,
    dismissNotification,
    markAllNotificationsRead,
    clearNotifications,
  };
}
