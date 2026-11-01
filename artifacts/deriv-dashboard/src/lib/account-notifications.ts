export type AccountNotificationCategory = "account" | "connection";

export type AccountNotification = {
  id: string;
  category: AccountNotificationCategory;
  title: string;
  message: string;
  createdAt: number;
  read: boolean;
};

export const MAX_ACCOUNT_NOTIFICATIONS = 40;

export function accountNotificationsStorageKey(accessKeyId: string) {
  return `shadow-ai:account-notifications:${accessKeyId}`;
}

export function isOpenContractSettlementWaitMessage(message: string) {
  return /^Waiting for \d+ open Deriv contracts? to settle before another trade can start\.$/.test(
    message.trim(),
  );
}

function isAccountNotification(value: unknown): value is AccountNotification {
  if (!value || typeof value !== "object") return false;
  const notification = value as Partial<AccountNotification>;
  return (
    typeof notification.id === "string" &&
    notification.id.length <= 128 &&
    (notification.category === "account" ||
      notification.category === "connection") &&
    typeof notification.title === "string" &&
    notification.title.length <= 120 &&
    typeof notification.message === "string" &&
    notification.message.length <= 500 &&
    typeof notification.createdAt === "number" &&
    Number.isFinite(notification.createdAt) &&
    Math.abs(notification.createdAt) <= 8_640_000_000_000_000 &&
    typeof notification.read === "boolean"
  );
}

export function parseAccountNotifications(
  raw: string | null,
): AccountNotification[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isAccountNotification)
      .filter((notification) => !isOpenContractSettlementWaitMessage(notification.message))
      .slice(0, MAX_ACCOUNT_NOTIFICATIONS);
  } catch {
    return [];
  }
}
