import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mock, test } from "node:test";
import express from "express";

type Column = { field: string };
type QueryCondition =
  | { kind: "eq" | "ne" | "isNull"; column: Column; value?: unknown }
  | { kind: "and"; conditions: QueryCondition[] };
type StoredKey = {
  id: string;
  keyHash: string;
  encryptedKey: string | null;
  keyPrefix: string;
  label: string;
  kind: "admin" | "user";
  status: "active" | "paused" | "blocked" | "banned" | "deleted";
  maxDevices: number;
  features: string[];
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function columns(fields: string[]) {
  return Object.fromEntries(fields.map((field) => [field, { field }])) as Record<string, Column>;
}

const accessKeysTable = columns([
  "id", "keyHash", "encryptedKey", "keyPrefix", "label", "kind", "status",
  "maxDevices", "features", "lastSeenAt", "createdAt", "updatedAt",
]);
const accessKeySessionsTable = columns([
  "id", "accessKeyId", "tokenHash", "deviceHash", "userAgent", "firstSeenAt",
  "lastSeenAt", "revokedAt",
]);
const tradingProtectionSettingsTable = columns([
  "id", "weekdaysEnabled", "weekendsEnabled", "dualWeekendsWeekdaysEnabled", "updatedAt",
]);
const storedKeys: StoredKey[] = [];
const storedSessions: Record<string, unknown>[] = [];
let nextKeyId = 0;
let nextRawKey = 0;

function recordsFor(table: unknown): Array<Record<string, unknown>> {
  if (table === accessKeysTable) return storedKeys as unknown as Array<Record<string, unknown>>;
  if (table === accessKeySessionsTable) return storedSessions;
  return [];
}

function matches(condition: QueryCondition, record: Record<string, unknown>): boolean {
  if (condition.kind === "and") return condition.conditions.every((item) => matches(item, record));
  const value = record[condition.column.field];
  if (condition.kind === "eq") return value === condition.value;
  if (condition.kind === "ne") return value !== condition.value;
  return value == null;
}

function selectBuilder(table: unknown) {
  let condition: QueryCondition | undefined;
  const builder = {
    where(next: QueryCondition) {
      condition = next;
      return builder;
    },
    for(_lock: string) {
      return builder;
    },
    async limit(limit: number) {
      return recordsFor(table).filter((record) => !condition || matches(condition, record)).slice(0, limit);
    },
    async orderBy() {
      return recordsFor(table).filter((record) => !condition || matches(condition, record));
    },
  };
  return builder;
}

const db: any = {
  select() {
    return { from: (table: unknown) => selectBuilder(table) };
  },
  insert(table: unknown) {
    return {
      values(values: Record<string, unknown>) {
        return {
          async returning() {
            const id = `00000000-0000-4000-8000-${String(++nextKeyId).padStart(12, "0")}`;
            const now = new Date();
            const row = {
              id,
              status: "active",
              lastSeenAt: null,
              createdAt: now,
              updatedAt: now,
              ...values,
            } as StoredKey;
            recordsFor(table).push(row as unknown as Record<string, unknown>);
            return [row];
          },
        };
      },
    };
  },
  update(table: unknown) {
    let values: Record<string, unknown> = {};
    return {
      set(next: Record<string, unknown>) {
        values = next;
        return this;
      },
      where(condition: QueryCondition) {
        const matchingRows = recordsFor(table).filter((record) => matches(condition, record));
        for (const row of matchingRows) Object.assign(row, values);
        const query = Promise.resolve(matchingRows) as Promise<Array<Record<string, unknown>>> & {
          returning: (selection?: Record<string, Column>) => Promise<Array<{ id: string }>>;
        };
        query.returning = async () => matchingRows.map((row) => ({ id: String(row.id) }));
        return query;
      },
    };
  },
  transaction<T>(operation: (transaction: typeof db) => Promise<T>) {
    return operation(db);
  },
};

mock.module("@workspace/db", {
  namedExports: { db, accessKeysTable, accessKeySessionsTable, tradingProtectionSettingsTable },
});
mock.module("drizzle-orm", {
  namedExports: {
    and: (...conditions: QueryCondition[]): QueryCondition => ({ kind: "and", conditions }),
    asc: (column: Column) => column,
    eq: (column: Column, value: unknown): QueryCondition => ({ kind: "eq", column, value }),
    isNull: (column: Column): QueryCondition => ({ kind: "isNull", column }),
    ne: (column: Column, value: unknown): QueryCondition => ({ kind: "ne", column, value }),
  },
});
mock.module("../lib/access-keys", {
  namedExports: {
    ACCESS_FEATURES: ["edge"],
    accessCookie: () => "",
    activeDeviceCount: async () => 0,
    clearAccessCookie: () => "",
    decryptAccessKey: () => null,
    deviceHash: (deviceId: string) => `device:${deviceId}`,
    encryptAccessKey: (accessKey: string) => `encrypted:${accessKey}`,
    featureList: (features: string[] | undefined) => features ?? ["edge"],
    findSessionByToken: async () => null,
    generateAccessKey: () => `user-key-${String(++nextRawKey).padStart(6, "0")}`,
    generateSessionToken: () => "test-session-token",
    hashSecret: (value: string) => `hash:${value}`,
    isOnline: () => false,
    isPrimaryAdminKeyHash: () => false,
    offlineSeconds: () => null,
    onlineDeviceCount: async () => 0,
    parseAccessCookie: () => null,
    syncConfiguredPrimaryAdminKey: async () => undefined,
  },
});
mock.module("../lib/deriv", {
  namedExports: {
    disposeUser: () => undefined,
    withUserSerialized: async (_userId: string, operation: () => Promise<unknown>) => operation(),
  },
});
mock.module("../lib/logger", { namedExports: { logger: { warn: () => undefined } } });
mock.module("../middlewares/requireAccess", {
  namedExports: {
    requireAccess: (_request: unknown, _response: unknown, next: () => void) => next(),
    requireAccessAdmin: (_request: unknown, _response: unknown, next: () => void) => next(),
  },
});

const { default: accessRouter } = await import("./access.ts");

test("deleted access-key names can be reused while deleted keys stay unable to sign in", async () => {
  const app = express();
  app.use(express.json());
  app.use(accessRouter);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const create = async () => fetch(`${baseUrl}/access/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Reusable user name",
        kind: "user",
        max_devices: 1,
        features: ["edge"],
      }),
    });

    const firstResponse = await create();
    assert.equal(firstResponse.status, 201);
    const firstKey = await firstResponse.json() as { key_id: string; access_key: string; label: string };

    assert.equal((await create()).status, 409, "An existing user's name should remain reserved while their key exists.");

    const deleteResponse = await fetch(`${baseUrl}/access/keys/${firstKey.key_id}`, { method: "DELETE" });
    assert.equal(deleteResponse.status, 200);
    assert.equal(storedKeys[0].status, "deleted");
    assert.equal(storedKeys[0].encryptedKey, null);
    assert.equal(storedKeys[0].keyHash, `hash:${firstKey.access_key}`, "Keep the old hashed key tombstone.");

    const secondResponse = await create();
    assert.equal(secondResponse.status, 201, "The deleted user's name should be available again.");
    const secondKey = await secondResponse.json() as { access_key: string; label: string };
    assert.equal(secondKey.label, firstKey.label);
    assert.notEqual(secondKey.access_key, firstKey.access_key);
    assert.equal(storedKeys[1].status, "active");

    const oldKeyLogin = await fetch(`${baseUrl}/access/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_key: firstKey.access_key, device_id: "old-user-device" }),
    });
    assert.equal(oldKeyLogin.status, 403, "The deleted access key must remain unusable.");
    assert.match(String((await oldKeyLogin.json() as { error: string }).error), /deleted/i);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
