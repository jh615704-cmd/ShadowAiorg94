import { pool } from "@workspace/db";

export type AdvisoryLockClient = {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};

export type AdvisoryLockPool = {
  connect: () => Promise<AdvisoryLockClient>;
};

export async function withAdvisoryUserLock<T>(
  lockPool: AdvisoryLockPool,
  userId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const client = await lockPool.connect();
  let acquired = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [userId]);
    acquired = true;
    return await operation();
  } finally {
    try {
      if (acquired) {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [userId]);
      }
    } finally {
      client.release();
    }
  }
}

export function withDistributedUserLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  return withAdvisoryUserLock(pool, userId, operation);
}
