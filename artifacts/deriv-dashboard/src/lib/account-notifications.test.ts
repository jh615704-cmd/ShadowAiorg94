import assert from "node:assert/strict";
import test from "node:test";
import {
  accountNotificationsStorageKey,
  MAX_ACCOUNT_NOTIFICATIONS,
  parseAccountNotifications,
  type AccountNotification,
} from "./account-notifications.ts";

function makeNotification(index: number): AccountNotification {
  return {
    id: `notice-${index}`,
    category: index % 2 === 0 ? "connection" : "account",
    title: `Update ${index}`,
    message: `Account event ${index}`,
    createdAt: 1_800_000_000_000 + index,
    read: index % 3 === 0,
  };
}

test("notification history ignores empty, malformed, and non-array storage", () => {
  assert.deepEqual(parseAccountNotifications(null), []);
  assert.deepEqual(parseAccountNotifications(""), []);
  assert.deepEqual(parseAccountNotifications("{bad json"), []);
  assert.deepEqual(
    parseAccountNotifications(JSON.stringify({ id: "not-a-list" })),
    [],
  );
});

test("notification history validates fields and caps the saved list", () => {
  const validNotifications = Array.from(
    { length: MAX_ACCOUNT_NOTIFICATIONS + 5 },
    (_, index) => makeNotification(index),
  );
  const invalidNotifications = [
    { ...makeNotification(100), category: "trade" },
    { ...makeNotification(101), title: "x".repeat(121) },
    { ...makeNotification(102), createdAt: 9_000_000_000_000_000 },
    { ...makeNotification(103), read: "false" },
  ];

  const parsed = parseAccountNotifications(
    JSON.stringify([...validNotifications, ...invalidNotifications]),
  );

  assert.equal(parsed.length, MAX_ACCOUNT_NOTIFICATIONS);
  assert.equal(parsed[0]?.id, "notice-0");
  assert.equal(parsed.at(-1)?.id, `notice-${MAX_ACCOUNT_NOTIFICATIONS - 1}`);
});

test("notification storage is isolated by access-key session", () => {
  assert.notEqual(
    accountNotificationsStorageKey("session-a"),
    accountNotificationsStorageKey("session-b"),
  );
});
