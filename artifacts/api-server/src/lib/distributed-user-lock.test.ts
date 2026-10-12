import assert from "node:assert/strict";
import test from "node:test";
import { withAdvisoryUserLock, type AdvisoryLockClient, type AdvisoryLockPool } from "./distributed-user-lock.ts";

class FakeAdvisoryPool implements AdvisoryLockPool {
  private readonly held = new Set<string>();
  private readonly waiters = new Map<string, Array<() => void>>();

  async connect(): Promise<AdvisoryLockClient> {
    return {
      query: async (sql, values) => {
        const userId = String(values?.[0]);
        if (sql.includes("pg_advisory_lock(")) {
          if (this.held.has(userId)) {
            await new Promise<void>((resolve) => {
              const queue = this.waiters.get(userId) ?? [];
              queue.push(resolve);
              this.waiters.set(userId, queue);
            });
          } else {
            this.held.add(userId);
          }
          return;
        }
        if (sql.includes("pg_advisory_unlock(")) {
          const next = this.waiters.get(userId)?.shift();
          if (next) next();
          else this.held.delete(userId);
        }
      },
      release: () => undefined,
    };
  }
}

test("advisory locks serialize a user's mutations across independent clients", async () => {
  const pool = new FakeAdvisoryPool();
  const order: string[] = [];
  let active = 0;
  let peakActive = 0;
  const operation = (label: string) => withAdvisoryUserLock(pool, "user-1", async () => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    order.push(`${label}:start`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(`${label}:end`);
    active -= 1;
  });

  await Promise.all([operation("first"), operation("second")]);
  assert.equal(peakActive, 1);
  assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);
});

test("advisory lock releases even when the operation throws", async () => {
  const pool = new FakeAdvisoryPool();
  await assert.rejects(
    withAdvisoryUserLock(pool, "user-1", async () => {
      throw new Error("operation failed");
    }),
    /operation failed/,
  );
  let ran = false;
  await withAdvisoryUserLock(pool, "user-1", async () => { ran = true; });
  assert.equal(ran, true);
});

test("different users do not block each other's advisory locks", async () => {
  const pool = new FakeAdvisoryPool();
  let bothEntered = 0;
  await Promise.all(["user-1", "user-2"].map((userId) =>
    withAdvisoryUserLock(pool, userId, async () => { bothEntered += 1; }),
  ));
  assert.equal(bothEntered, 2);
});
