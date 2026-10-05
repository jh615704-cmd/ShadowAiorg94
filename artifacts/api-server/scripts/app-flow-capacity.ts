import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { inArray, like, and, eq, isNull, ne, sql } from "drizzle-orm";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { Server } from "node:http";
import {
  accessKeysTable,
  accessKeySessionsTable,
  db,
  pool,
} from "@workspace/db";
import app from "../src/app";
import { logger } from "../src/lib/logger";

const REGISTERED_USER_TARGET = 15_000;
const MAU_TARGET = 7_000;
const FLOW_STAGES = [
  { name: "one-concurrent-user", users: 1, concurrency: 1 },
  { name: "70-concurrent-users", users: 70, concurrency: 70 },
  { name: "350-concurrent-users", users: 350, concurrency: 350 },
];
const PEAK_CONCURRENCY = 700;
const PEAK_SETUP_CONCURRENCY = 350;
const LOGIN_SPREAD_MS = 8_000;
const SESSION_ACTION_SPREAD_MS = 8_000;
const ACTIVE_SESSION_HOLD_MS = 3_000;
const INSERT_BATCH_SIZE = 500;
const DELETE_BATCH_SIZE = 1_000;
const REQUEST_TIMEOUT_MS = 30_000;
const CLEANUP_ARGUMENT = "--cleanup-run-id";
const COOKIE_NAME = "jdy_access";

type SyntheticUser = {
  id: string;
  accessKey: string;
};

type EndpointName = "login" | "session" | "heartbeat" | "logout";

type EndpointStats = {
  requests: number;
  errors: number;
  statuses: Record<string, number>;
  latenciesMs: number[];
};

type StageStats = {
  name: string;
  requestedUsers: number;
  completedUsers: number;
  failedUsers: number;
  batches: number;
  maxConcurrentFlows: number;
  activeSessions: number;
  peakActiveSessions: number;
  startedAt: number;
  endedAt: number;
  endpoints: Record<EndpointName, EndpointStats>;
  poolSamples: number;
  samplesWithWaiters: number;
  peakPoolConnections: number;
  peakPoolWaiters: number;
  poolAcquisitionMs: number[];
};

type ApiResponse = {
  ok: boolean;
  payload: unknown;
  cookie: string | null;
};

type FinishUserFlow = (heartbeatDelayMs: number, logoutDelayMs: number) => Promise<boolean>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function round(value: number, decimals = 1) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]);
}

function latencySummary(values: number[]) {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: values.length ? round(Math.max(...values)) : 0,
  };
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function spreadDelay(index: number, count: number, durationMs: number) {
  return count <= 1 ? 0 : Math.round((index / (count - 1)) * durationMs);
}

function createEndpointStats(): EndpointStats {
  return { requests: 0, errors: 0, statuses: {}, latenciesMs: [] };
}

function createStageStats(name: string, requestedUsers: number): StageStats {
  return {
    name,
    requestedUsers,
    completedUsers: 0,
    failedUsers: 0,
    batches: 0,
    maxConcurrentFlows: 0,
    activeSessions: 0,
    peakActiveSessions: 0,
    startedAt: performance.now(),
    endedAt: 0,
    endpoints: {
      login: createEndpointStats(),
      session: createEndpointStats(),
      heartbeat: createEndpointStats(),
      logout: createEndpointStats(),
    },
    poolSamples: 0,
    samplesWithWaiters: 0,
    peakPoolConnections: 0,
    peakPoolWaiters: 0,
    poolAcquisitionMs: [],
  };
}

function recordEndpoint(
  stats: EndpointStats,
  status: number | "network_error",
  elapsedMs: number,
  successful: boolean,
) {
  stats.requests += 1;
  stats.latenciesMs.push(elapsedMs);
  const statusName = String(status);
  stats.statuses[statusName] = (stats.statuses[statusName] ?? 0) + 1;
  if (!successful) stats.errors += 1;
}

function summarizeEndpoint(stats: EndpointStats) {
  return {
    requests: stats.requests,
    errors: stats.errors,
    statuses: stats.statuses,
    latency: latencySummary(stats.latenciesMs),
  };
}

function summarizeStage(stats: StageStats) {
  const seconds = Math.max(0.001, (stats.endedAt - stats.startedAt) / 1_000);
  return {
    name: stats.name,
    users: stats.completedUsers,
    failedUsers: stats.failedUsers,
    batches: stats.batches,
    maxConcurrentFlows: stats.maxConcurrentFlows,
    peakActiveSessions: stats.peakActiveSessions,
    elapsedSeconds: round(seconds, 2),
    usersPerSecond: round(stats.completedUsers / seconds, 1),
    endpoints: {
      login: summarizeEndpoint(stats.endpoints.login),
      session: summarizeEndpoint(stats.endpoints.session),
      heartbeat: summarizeEndpoint(stats.endpoints.heartbeat),
      logout: summarizeEndpoint(stats.endpoints.logout),
    },
    databasePool: {
      samples: stats.poolSamples,
      samplesWithWaiters: stats.samplesWithWaiters,
      peakConnections: stats.peakPoolConnections,
      peakWaiters: stats.peakPoolWaiters,
      acquisitionDelay: latencySummary(stats.poolAcquisitionMs),
    },
  };
}

function fixtureLabelPrefix(runId: string) {
  return `synthetic-capacity:${runId}:`;
}

function assertSafeRunEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("This fixture load test is disabled when NODE_ENV=production.");
  }
  if (process.env.CAPACITY_FIXTURE_MODE !== "development") {
    throw new Error(
      "Set CAPACITY_FIXTURE_MODE=development explicitly to allow temporary synthetic database fixtures.",
    );
  }
}

function readCgroupLimits() {
  const read = (path: string) => {
    try {
      return readFileSync(path, "utf8").trim();
    } catch {
      return null;
    }
  };
  const memoryValue = read("/sys/fs/cgroup/memory.max");
  const cpuValue = read("/sys/fs/cgroup/cpu.max");
  let memoryLimitMiB: number | null = null;
  if (memoryValue && memoryValue !== "max") {
    const bytes = Number(memoryValue);
    if (Number.isFinite(bytes)) memoryLimitMiB = round(bytes / (1024 * 1024));
  }
  let cpuQuotaCores: number | null = null;
  if (cpuValue) {
    const [quotaText, periodText] = cpuValue.split(/\s+/);
    const quota = Number(quotaText);
    const period = Number(periodText);
    if (Number.isFinite(quota) && Number.isFinite(period) && quota > 0 && period > 0) {
      cpuQuotaCores = round(quota / period, 2);
    }
  }
  return { memoryLimitMiB, cpuQuotaCores };
}

async function registeredUserCount() {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accessKeysTable)
    .where(and(
      eq(accessKeysTable.kind, "user"),
      ne(accessKeysTable.status, "deleted"),
    ));
  return result?.count ?? 0;
}

async function seedSyntheticUsers(runId: string, count: number): Promise<SyntheticUser[]> {
  const users: SyntheticUser[] = [];
  const labelPrefix = fixtureLabelPrefix(runId);
  await db.transaction(async (tx) => {
    for (let start = 0; start < count; start += INSERT_BATCH_SIZE) {
      const end = Math.min(count, start + INSERT_BATCH_SIZE);
      const batch = Array.from({ length: end - start }, (_, offset) => {
        const index = start + offset;
        const accessKey = `CAPLOAD-${runId}-${index.toString().padStart(5, "0")}-${randomBytes(32).toString("base64url")}`;
        return {
          accessKey,
          row: {
            keyHash: createHash("sha256").update(accessKey).digest("hex"),
            encryptedKey: null,
            keyPrefix: accessKey.slice(0, 17),
            label: `${labelPrefix}user:${index.toString().padStart(5, "0")}`,
            kind: "user" as const,
            status: "active" as const,
            maxDevices: 1,
            features: ["edge"],
          },
        };
      });
      const inserted = await tx
        .insert(accessKeysTable)
        .values(batch.map(({ row }) => row))
        .returning({ id: accessKeysTable.id });
      inserted.forEach(({ id }, offset) => {
        users.push({ id, accessKey: batch[offset].accessKey });
      });
    }
  });
  return users;
}

async function cleanupSyntheticRun(runId: string) {
  const prefix = fixtureLabelPrefix(runId);
  const fixtureKeys = await db
    .select({ id: accessKeysTable.id })
    .from(accessKeysTable)
    .where(like(accessKeysTable.label, `${prefix}%`));
  let deletedUsers = 0;
  for (let start = 0; start < fixtureKeys.length; start += DELETE_BATCH_SIZE) {
    const ids = fixtureKeys.slice(start, start + DELETE_BATCH_SIZE).map(({ id }) => id);
    const deleted = await db
      .delete(accessKeysTable)
      .where(inArray(accessKeysTable.id, ids))
      .returning({ id: accessKeysTable.id });
    deletedUsers += deleted.length;
  }
  const [remainingSessions] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accessKeySessionsTable)
    .innerJoin(accessKeysTable, eq(accessKeySessionsTable.accessKeyId, accessKeysTable.id))
    .where(like(accessKeysTable.label, `${prefix}%`));
  return {
    deletedUsers,
    remainingFixtureSessions: remainingSessions?.count ?? 0,
  };
}

async function fixtureSessionCounts(runId: string) {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accessKeySessionsTable)
    .innerJoin(accessKeysTable, eq(accessKeySessionsTable.accessKeyId, accessKeysTable.id))
    .where(like(accessKeysTable.label, `${fixtureLabelPrefix(runId)}%`));
  const [active] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accessKeySessionsTable)
    .innerJoin(accessKeysTable, eq(accessKeySessionsTable.accessKeyId, accessKeysTable.id))
    .where(and(
      like(accessKeysTable.label, `${fixtureLabelPrefix(runId)}%`),
      isNull(accessKeySessionsTable.revokedAt),
    ));
  return {
    totalSessions: result?.count ?? 0,
    activeSessions: active?.count ?? 0,
  };
}

function createApiServer() {
  const server = app.listen(0, "127.0.0.1");
  return new Promise<Server>((resolve, reject) => {
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

function closeApiServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

async function callApi(
  stats: EndpointStats,
  baseUrl: string,
  endpoint: EndpointName,
  path: string,
  init: RequestInit,
  validate: (payload: unknown, response: Response) => boolean,
): Promise<ApiResponse> {
  const startedAt = performance.now();
  let status: number | "network_error" = "network_error";
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    status = response.status;
    const payload: unknown = await response.json().catch(() => null);
    const successful = response.ok && validate(payload, response);
    recordEndpoint(stats, status, performance.now() - startedAt, successful);
    return {
      ok: successful,
      payload,
      cookie: response.headers.get("set-cookie"),
    };
  } catch {
    recordEndpoint(stats, status, performance.now() - startedAt, false);
    return { ok: false, payload: null, cookie: null };
  }
}

async function startUserFlowSession(
  stats: StageStats,
  baseUrl: string,
  user: SyntheticUser,
  userIndex: number,
  loginDelayMs: number,
): Promise<FinishUserFlow | null> {
  if (loginDelayMs > 0) await sleep(loginDelayMs);
  const deviceId = `capacity-${randomUUID()}-${userIndex}`;
  const login = await callApi(
    stats.endpoints.login,
    baseUrl,
    "login",
    "/access/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_key: user.accessKey, device_id: deviceId }),
    },
    (payload, response) => {
      const setCookie = response.headers.get("set-cookie") ?? "";
      return isRecord(payload)
        && payload.key_id === user.id
        && payload.status === "active"
        && setCookie.startsWith(`${COOKIE_NAME}=`);
    },
  );

  const cookieHeader = login.cookie?.split(";", 1)[0] ?? "";
  if (!login.ok || !cookieHeader.startsWith(`${COOKIE_NAME}=`)) return null;
  stats.activeSessions += 1;
  stats.peakActiveSessions = Math.max(stats.peakActiveSessions, stats.activeSessions);

  const authorizedHeaders = { cookie: cookieHeader };
  const session = await callApi(
    stats.endpoints.session,
    baseUrl,
    "session",
    "/access/session",
    { method: "GET", headers: authorizedHeaders },
    (payload) => isRecord(payload) && payload.key_id === user.id && payload.status === "active",
  );
  return async (heartbeatDelayMs, logoutDelayMs) => {
    let flowSuccessful = session.ok;
    if (heartbeatDelayMs > 0) await sleep(heartbeatDelayMs);
    const heartbeat = await callApi(
      stats.endpoints.heartbeat,
      baseUrl,
      "heartbeat",
      "/access/heartbeat",
      { method: "POST", headers: authorizedHeaders },
      (payload) => isRecord(payload) && payload.success === true,
    );
    if (!heartbeat.ok) flowSuccessful = false;
    if (logoutDelayMs > 0) await sleep(logoutDelayMs);
    const logout = await callApi(
      stats.endpoints.logout,
      baseUrl,
      "logout",
      "/access/logout",
      { method: "POST", headers: authorizedHeaders },
      (payload) => isRecord(payload) && payload.success === true,
    );
    if (!logout.ok) flowSuccessful = false;
    else stats.activeSessions -= 1;
    return flowSuccessful;
  };
}

async function runUserFlow(
  stats: StageStats,
  baseUrl: string,
  user: SyntheticUser,
  userIndex: number,
  loginDelayMs: number,
) {
  const finishFlow = await startUserFlowSession(stats, baseUrl, user, userIndex, loginDelayMs);
  if (!finishFlow) return false;
  await sleep(ACTIVE_SESSION_HOLD_MS);
  return finishFlow(0, 0);
}

function installPoolAcquisitionMeasurement(
  getActiveStage: () => StageStats | null,
) {
  const poolInternals = pool as unknown as { connect: () => Promise<unknown> };
  const originalConnect = poolInternals.connect.bind(pool);
  poolInternals.connect = async () => {
    const startedAt = performance.now();
    try {
      const client = await originalConnect();
      getActiveStage()?.poolAcquisitionMs.push(performance.now() - startedAt);
      return client;
    } catch (error) {
      getActiveStage()?.poolAcquisitionMs.push(performance.now() - startedAt);
      throw error;
    }
  };
  return () => {
    poolInternals.connect = originalConnect;
  };
}

function samplePool(stage: StageStats) {
  stage.poolSamples += 1;
  stage.peakPoolConnections = Math.max(stage.peakPoolConnections, pool.totalCount);
  stage.peakPoolWaiters = Math.max(stage.peakPoolWaiters, pool.waitingCount);
  if (pool.waitingCount > 0) stage.samplesWithWaiters += 1;
}

async function runStage(
  name: string,
  users: SyntheticUser[],
  concurrency: number,
  baseUrl: string,
  setActiveStage: (stage: StageStats | null) => void,
) {
  const stats = createStageStats(name, users.length);
  setActiveStage(stats);
  for (let start = 0; start < users.length; start += concurrency) {
    const batch = users.slice(start, start + concurrency);
    stats.batches += 1;
    stats.maxConcurrentFlows = Math.max(stats.maxConcurrentFlows, batch.length);
    const results = await Promise.all(
      batch.map((user, offset) => runUserFlow(
        stats,
        baseUrl,
        user,
        start + offset,
        spreadDelay(offset, batch.length, LOGIN_SPREAD_MS),
      )),
    );
    stats.completedUsers += results.length;
    stats.failedUsers += results.filter((successful) => !successful).length;
  }
  stats.endedAt = performance.now();
  setActiveStage(null);
  const summary = summarizeStage(stats);
  console.log(JSON.stringify({ event: "capacity_stage_complete", stage: summary }));
  return summary;
}

async function runPeakStage(
  name: string,
  users: SyntheticUser[],
  baseUrl: string,
  setActiveStage: (stage: StageStats | null) => void,
) {
  const stats = createStageStats(name, users.length);
  stats.maxConcurrentFlows = Math.min(PEAK_SETUP_CONCURRENCY, users.length);
  setActiveStage(stats);
  const activeFlows: Array<{ finishFlow: FinishUserFlow; userOffset: number }> = [];

  for (let start = 0; start < users.length; start += PEAK_SETUP_CONCURRENCY) {
    const batch = users.slice(start, start + PEAK_SETUP_CONCURRENCY);
    stats.batches += 1;
    const results = await Promise.all(batch.map((user, offset) =>
      startUserFlowSession(
        stats,
        baseUrl,
        user,
        start + offset,
        spreadDelay(offset, batch.length, LOGIN_SPREAD_MS),
      )));
    results.forEach((finishFlow, offset) => {
      if (!finishFlow) {
        stats.completedUsers += 1;
        stats.failedUsers += 1;
        return;
      }
      activeFlows.push({ finishFlow, userOffset: start + offset });
    });
  }

  await sleep(ACTIVE_SESSION_HOLD_MS);
  const results = await Promise.all(activeFlows.map(({ finishFlow, userOffset }) => {
    const delay = spreadDelay(userOffset, users.length, SESSION_ACTION_SPREAD_MS);
    return finishFlow(delay, delay);
  }));
  stats.completedUsers += results.length;
  stats.failedUsers += results.filter((successful) => !successful).length;
  stats.endedAt = performance.now();
  setActiveStage(null);
  const summary = summarizeStage(stats);
  console.log(JSON.stringify({ event: "capacity_stage_complete", stage: summary }));
  return summary;
}

function validateCleanupRunId(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${CLEANUP_ARGUMENT} requires the exact UUID printed when a probe starts.`);
  }
  return value;
}

async function runCleanupOnly(runId: string) {
  assertSafeRunEnvironment();
  const result = await cleanupSyntheticRun(runId);
  console.log(JSON.stringify({
    test: "synthetic_capacity_fixture_cleanup",
    runId,
    ...result,
  }));
  if (result.remainingFixtureSessions !== 0) {
    throw new Error("Synthetic fixture cleanup left associated access sessions behind.");
  }
}

async function runCapacityProbe() {
  assertSafeRunEnvironment();
  const runId = randomUUID();
  const labelPrefix = fixtureLabelPrefix(runId);
  let server: Server | null = null;
  let cleanupRun: (() => void) | null = null;
  let activeStage: StageStats | null = null;
  let sampler: NodeJS.Timeout | null = null;
  let eventLoopHistogram: ReturnType<typeof monitorEventLoopDelay> | null = null;
  let originalLoggerLevel = logger.level;
  let baselineUsers = 0;
  let fixtureUsers = 0;
  let mauSessionRows = 0;
  let mauActiveSessions = 0;
  let databaseMaxConnections: number | null = null;
  let apiBaseUrl = "";
  let stages: Array<Record<string, unknown>> = [];
  let memoryPeakMiB = 0;
  let heapPeakMiB = 0;
  let resultError: unknown = null;
  let cleanupResult: Awaited<ReturnType<typeof cleanupSyntheticRun>> | null = null;
  let probeResult: Record<string, unknown> | null = null;
  let databaseUserCountRestored = false;

  try {
    server = await createApiServer();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not bind the isolated API test server.");
    apiBaseUrl = `http://127.0.0.1:${address.port}/api`;

    // Suppress per-request logs from the 28,000-request local run; the probe
    // prints aggregate results and never logs cookies, keys, or request bodies.
    originalLoggerLevel = logger.level;
    logger.level = "silent";

    baselineUsers = await registeredUserCount();
    const fixtureCount = Math.max(REGISTERED_USER_TARGET - baselineUsers, MAU_TARGET);
    console.log(JSON.stringify({
      event: "synthetic_capacity_fixtures_starting",
      runId,
      intendedSyntheticUsers: fixtureCount,
      cleanupCommand: `CAPACITY_FIXTURE_MODE=development pnpm --filter @workspace/api-server capacity:app-flow -- ${CLEANUP_ARGUMENT} ${runId}`,
    }));

    const users = await seedSyntheticUsers(runId, fixtureCount);
    fixtureUsers = users.length;
    if (fixtureUsers < MAU_TARGET) {
      throw new Error("Fixture setup did not create enough synthetic accounts for the MAU cohort.");
    }
    const storedUsersAtTarget = await registeredUserCount();
    const connectionLimit = await pool.query<{ max_connections: string }>("SHOW max_connections");
    const parsedConnectionLimit = Number(connectionLimit.rows[0]?.max_connections);
    databaseMaxConnections = Number.isFinite(parsedConnectionLimit) ? parsedConnectionLimit : null;
    const cgroupLimits = readCgroupLimits();
    const eventLoop = monitorEventLoopDelay({ resolution: 20 });
    eventLoop.enable();
    eventLoopHistogram = eventLoop;
    const cpuBaseline = process.cpuUsage();
    const setActiveStage = (stage: StageStats | null) => {
      activeStage = stage;
    };
    cleanupRun = installPoolAcquisitionMeasurement(() => activeStage);
    sampler = setInterval(() => {
      if (activeStage) samplePool(activeStage);
      const usage = process.memoryUsage();
      memoryPeakMiB = Math.max(memoryPeakMiB, usage.rss / (1024 * 1024));
      heapPeakMiB = Math.max(heapPeakMiB, usage.heapUsed / (1024 * 1024));
    }, 10);

    let cohortOffset = 0;
    for (const stage of FLOW_STAGES) {
      const cohort = users.slice(cohortOffset, cohortOffset + stage.users);
      cohortOffset += cohort.length;
      stages.push(await runStage(stage.name, cohort, stage.concurrency, apiBaseUrl, setActiveStage));
    }
    const peakCohort = users.slice(cohortOffset, cohortOffset + PEAK_CONCURRENCY);
    cohortOffset += peakCohort.length;
    stages.push(await runPeakStage(
      "700-simultaneous-authorized-sessions",
      peakCohort,
      apiBaseUrl,
      setActiveStage,
    ));
    const remainingUsers = users.slice(cohortOffset, MAU_TARGET);
    if (remainingUsers.length > 0) {
      stages.push(await runStage(
        "steady-350-concurrent-users",
        remainingUsers,
        PEAK_SETUP_CONCURRENCY,
        apiBaseUrl,
        setActiveStage,
      ));
    }
    const sessionCounts = await fixtureSessionCounts(runId);
    mauSessionRows = sessionCounts.totalSessions;
    mauActiveSessions = sessionCounts.activeSessions;
    const cpuUsed = process.cpuUsage(cpuBaseline);
    eventLoop.disable();
    eventLoopHistogram = eventLoop;
    const metrics = stages as Array<{
      failedUsers: number;
      endpoints: Record<EndpointName, { requests: number; errors: number }>;
    }>;
    const totalFailedFlows = metrics.reduce((sum, stage) => sum + stage.failedUsers, 0);
    const endpointTotals = (["login", "session", "heartbeat", "logout"] as const).map((name) =>
      metrics.reduce((sum, stage) => sum + stage.endpoints[name].requests, 0));
    const endpointErrors = metrics.reduce((sum, stage) =>
      sum + (["login", "session", "heartbeat", "logout"] as const)
        .reduce((stageSum, name) => stageSum + stage.endpoints[name].errors, 0), 0);
    const peakConcurrentAppSessions = stages.reduce(
      (peak, stage) => Math.max(peak, (stage as { peakActiveSessions: number }).peakActiveSessions),
      0,
    );

    const p99EventLoopMs = Number.isFinite(eventLoop.percentile(99))
      ? round(eventLoop.percentile(99) / 1_000_000)
      : 0;
    probeResult = {
      test: "synthetic_access_key_application_flow_capacity",
      environment: {
        database: "explicitly opted-in workspace development database",
        api: "actual Express app routes on an isolated loopback server",
        derivRequestsSent: 0,
        tradeMessagesSent: 0,
        patCredentialsRequested: 0,
      },
      target: {
        registeredUsers: REGISTERED_USER_TARGET,
        monthlyActiveUsers: MAU_TARGET,
        peakSimultaneousAppFlows: PEAK_CONCURRENCY,
      },
      storedUsers: {
        preexistingRegisteredUsers: baselineUsers,
        syntheticFixtureUsers: fixtureUsers,
        totalDuringProbe: storedUsersAtTarget,
        atLeastTargetReached: storedUsersAtTarget >= REGISTERED_USER_TARGET,
        definition: "non-deleted access-key rows with kind=user; not Clerk identities",
      },
      mauCohort: {
        distinctSyntheticUsersExercised: MAU_TARGET,
        flow: ["login", "session read", "heartbeat write", "logout write"],
        totalEndpointRequests: endpointTotals.reduce((sum, value) => sum + value, 0),
        expectedEndpointRequests: MAU_TARGET * 4,
        endpointErrors,
        failedFlows: totalFailedFlows,
        peakSimultaneousFlows: peakConcurrentAppSessions,
        activeSessionHoldMs: ACTIVE_SESSION_HOLD_MS,
        loginArrivalSpreadMs: LOGIN_SPREAD_MS,
      },
      stages,
      databasePool: {
        configuredMaxConnections: pool.options.max,
        serverMaxConnections: databaseMaxConnections,
        connectionTimeoutMs: pool.options.connectionTimeoutMillis,
        poolAcquisitionDelayDescription:
          "Measured around the application's node-postgres pool.connect(); includes connection setup, not just queue wait.",
      },
      process: {
        apiAndLoadGeneratorInSameProcess: true,
        cgroupLimits,
        peakRssMiB: round(memoryPeakMiB),
        peakHeapUsedMiB: round(heapPeakMiB),
        cpuUserMs: round(cpuUsed.user / 1_000),
        cpuSystemMs: round(cpuUsed.system / 1_000),
        eventLoopDelayP99Ms: p99EventLoopMs,
      },
      cleanup: {
        automatic: true,
        fixtureLabelPrefix: labelPrefix,
        sessionRowsBeforeFixtureRemoval: mauSessionRows,
        activeSessionRowsBeforeFixtureRemoval: mauActiveSessions,
      },
      interpretation:
        "Development-only database and access-flow evidence. It is not a production capacity guarantee and does not measure Deriv WebSocket, quote, or trading capacity.",
    };

    if (
      totalFailedFlows > 0
      || endpointErrors > 0
      || endpointTotals.some((count) => count !== MAU_TARGET)
      || storedUsersAtTarget < REGISTERED_USER_TARGET
      || mauSessionRows !== MAU_TARGET
      || mauActiveSessions !== 0
      || peakConcurrentAppSessions !== PEAK_CONCURRENCY
    ) {
      resultError = new Error("The load completed with one or more failed checks; see the emitted result for evidence.");
    }
  } catch (error) {
    resultError = error;
  } finally {
    if (sampler) clearInterval(sampler);
    activeStage = null;
    if (cleanupRun) cleanupRun();
    if (server) {
      try {
        await closeApiServer(server);
      } catch (error) {
        resultError ??= error;
      }
    }
    try {
      cleanupResult = await cleanupSyntheticRun(runId);
      if (cleanupResult.remainingFixtureSessions !== 0) {
        resultError ??= new Error("Synthetic fixture cleanup left associated access sessions behind.");
      }
      const remainingUsers = await registeredUserCount();
      databaseUserCountRestored = remainingUsers === baselineUsers;
      if (!databaseUserCountRestored) {
        resultError ??= new Error("The registered-user count did not return to its pre-test value after cleanup.");
      }
    } catch (error) {
      resultError ??= error;
    }
    if (eventLoopHistogram) eventLoopHistogram.disable();
    logger.level = originalLoggerLevel;
  }

  if (probeResult) {
    probeResult.cleanup = {
      automatic: true,
      fixtureUsersInserted: fixtureUsers,
      fixtureUsersDeleted: cleanupResult?.deletedUsers ?? 0,
      remainingFixtureSessions: cleanupResult?.remainingFixtureSessions ?? null,
      databaseUserCountRestored,
    };
    console.log(JSON.stringify(probeResult));
  } else {
    console.log(JSON.stringify({
      test: "synthetic_access_key_application_flow_capacity",
      runId,
      fixtureUsersInserted: fixtureUsers,
      fixtureUsersDeleted: cleanupResult?.deletedUsers ?? 0,
      setupOrRunFailed: true,
      error: resultError instanceof Error ? resultError.message : "Unknown load test failure.",
    }));
  }

  if (resultError) throw resultError;
}

async function run() {
  try {
    const cleanupIndex = process.argv.indexOf(CLEANUP_ARGUMENT);
    if (cleanupIndex !== -1) {
      const runId = validateCleanupRunId(process.argv[cleanupIndex + 1]);
      await runCleanupOnly(runId);
      return;
    }
    await runCapacityProbe();
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Synthetic app-flow capacity probe failed.";
  console.error(message);
  process.exitCode = 1;
});
