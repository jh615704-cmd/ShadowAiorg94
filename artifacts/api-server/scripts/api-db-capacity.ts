import { performance } from "node:perf_hooks";
import { pool } from "@workspace/db";

const apiBaseUrl = (process.env.CAPACITY_API_BASE_URL ?? "http://localhost").replace(/\/+$/, "");
const apiHealthUrl = `${apiBaseUrl}/api/healthz`;
const stages = [1, 70, 350, 700];
const requestsPerClient = 2;

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] * 10) / 10;
}

function roundMiB(bytes: number) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

async function runStage(simulatedClients: number) {
  const apiLatenciesMs: number[] = [];
  const dbLatenciesMs: number[] = [];
  let apiErrors = 0;
  let dbErrors = 0;
  let peakPoolConnections = 0;
  let peakPoolWaiters = 0;
  const timer = setInterval(() => {
    peakPoolConnections = Math.max(peakPoolConnections, pool.totalCount);
    peakPoolWaiters = Math.max(peakPoolWaiters, pool.waitingCount);
  }, 5);
  const startedAt = performance.now();

  await Promise.all(Array.from({ length: simulatedClients }, async () => {
    for (let request = 0; request < requestsPerClient; request += 1) {
      const apiStartedAt = performance.now();
      try {
        const response = await fetch(apiHealthUrl);
        if (!response.ok) apiErrors += 1;
        await response.arrayBuffer();
      } catch {
        apiErrors += 1;
      } finally {
        apiLatenciesMs.push(performance.now() - apiStartedAt);
      }

      const dbStartedAt = performance.now();
      try {
        await pool.query("SELECT 1");
      } catch {
        dbErrors += 1;
      } finally {
        dbLatenciesMs.push(performance.now() - dbStartedAt);
      }
    }
  }));

  clearInterval(timer);
  peakPoolConnections = Math.max(peakPoolConnections, pool.totalCount);
  peakPoolWaiters = Math.max(peakPoolWaiters, pool.waitingCount);
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const apiRequests = apiLatenciesMs.length;
  const dbQueries = dbLatenciesMs.length;
  return {
    simulatedClients,
    requestsPerClient,
    elapsedSeconds: Math.round(elapsedSeconds * 100) / 100,
    api: {
      requests: apiRequests,
      errors: apiErrors,
      requestsPerSecond: Math.round(apiRequests / elapsedSeconds),
      p50Ms: percentile(apiLatenciesMs, 0.5),
      p95Ms: percentile(apiLatenciesMs, 0.95),
      p99Ms: percentile(apiLatenciesMs, 0.99),
    },
    database: {
      queries: dbQueries,
      errors: dbErrors,
      queriesPerSecond: Math.round(dbQueries / elapsedSeconds),
      p50Ms: percentile(dbLatenciesMs, 0.5),
      p95Ms: percentile(dbLatenciesMs, 0.95),
      p99Ms: percentile(dbLatenciesMs, 0.99),
      peakPoolConnections,
      peakPoolWaiters,
    },
    rssMiB: roundMiB(process.memoryUsage().rss),
  };
}

async function run() {
  const configuredPoolMax = Number(process.env.DB_POOL_MAX ?? 20);
  const poolMax = Number.isFinite(configuredPoolMax)
    ? Math.max(5, Math.min(100, configuredPoolMax))
    : 20;
  const results = [];

  try {
    for (const stage of stages) {
      results.push(await runStage(stage));
    }
    console.log(JSON.stringify({
      test: "synthetic_api_health_and_database_pool",
      apiHealthUrl,
      databasePoolMax: poolMax,
      stages: results,
      derivRequestsSent: 0,
      tradeMessagesSent: 0,
      interpretation: "Synthetic health and SELECT 1 probe only; this does not validate authenticated API workload, Deriv session capacity, or production capacity.",
    }));
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Synthetic API/database capacity probe failed.";
  console.error(message);
  process.exitCode = 1;
});
