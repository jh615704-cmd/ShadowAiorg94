import express from "express";
import { createServer } from "node:http";
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { GetDerivStatusResponse } from "@workspace/api-zod";

process.env.DERIV_API_TOKEN = "workspace-secret-fallback";

type Credential = {
  clerkUserId: string;
  encryptedPat: string;
  expiresAt: string | null;
  lastVerifiedAt: Date | null;
};

type QueryCondition = { value: string };

const credentials = new Map<string, Credential>();
const userPats = new Map<string, string>();
const observedPats: string[] = [];
const historyRows: unknown[] = [];
const sessionId = "admin-access-session";
let forceCapacityError = false;
let forcePermissionError = false;
let forceInvalidCredentialError = false;
let forceAccessRevoked = false;
let forceHistoryRefreshError = false;
let buyInvocations = 0;
let bulkBuyInvocations = 0;
let dualBuyInvocations = 0;
let knockoutScanInvocations = 0;

class MockDerivCapacityError extends Error {}
class MockDerivCredentialError extends Error {
  constructor(readonly status: number) {
    super("PAT is missing a required permission");
  }
}
class MockAccessSessionRevokedError extends Error {
  readonly status = 403;
}

const db = {
  select() {
    return {
      from() {
        return {
          async limit() {
            return [];
          },
          where(condition: QueryCondition) {
            return {
              async limit() {
                const credential = credentials.get(condition.value);
                return credential ? [credential] : [];
              },
            };
          },
        };
      },
    };
  },
  delete() {
    return {
      async where(condition: QueryCondition) {
        credentials.delete(condition.value);
      },
    };
  },
  update() {
    return {
      set(values: Record<string, unknown>) {
        return {
          async where(condition: QueryCondition) {
            const credential = credentials.get(condition.value);
            if (credential) Object.assign(credential, values);
          },
        };
      },
    };
  },
};

mock.module("@workspace/db", {
  namedExports: {
    db,
    derivCredentialsTable: { clerkUserId: "clerkUserId" },
    adminFeatureSettingsTable: { id: "id", settings: "settings", updatedAt: "updatedAt" },
  },
});

mock.module("drizzle-orm", {
  namedExports: {
    eq: (_column: unknown, value: string): QueryCondition => ({ value }),
  },
});

mock.module("../lib/access-keys", {
  namedExports: {
    AccessSessionRevokedError: MockAccessSessionRevokedError,
    TRADING_ACCESS_FEATURES: ["edge", "digit-flip", "trade-x", "bulk-trader", "matches-analysis", "clock-work", "cash-grab", "money-bank", "jdy-ai-3", "auto-trader", "auto-trader-2"],
    findSessionByToken: async () => null,
    featureList: (features: string[] | null | undefined) => features ?? ["edge"],
    hashSecret: (value: string) => value,
    isPrimaryAdminKeyHash: () => false,
    parseAccessCookie: () => null,
    assertAccessSessionActive: async () => {
      if (forceAccessRevoked) {
        throw new MockAccessSessionRevokedError("This access key is blocked");
      }
    },
  },
});

mock.module("../lib/distributed-user-lock", {
  namedExports: {
    withDistributedUserLock: async (_userId: string, operation: () => Promise<unknown>) => operation(),
  },
});

function observePat() {
  const pat = userPats.get(sessionId);
  assert.ok(pat, "the route operation should have an authenticated PAT");
  observedPats.push(pat);
}

const status = {
  connected: true,
  authorized: true,
  open_contracts_ready: true,
  active_contract_count: 0,
  account: {
    id: "DOT123",
    type: "demo" as const,
    currency: "USD",
    balance: 100,
    status: "active",
  },
  bot_running: false,
  symbol: "R_75",
  currency: "USD",
  max_trade_amount: 10,
  market_signals: [],
};
const statusParse = GetDerivStatusResponse.safeParse(status);
assert.equal(statusParse.success, true, JSON.stringify(statusParse));

mock.module("../lib/deriv", {
  namedExports: {
    DerivCredentialError: MockDerivCredentialError,
    DerivCapacityError: MockDerivCapacityError,
    getAccounts: async () => {
      observePat();
      if (forcePermissionError) throw new MockDerivCredentialError(403);
      if (forceInvalidCredentialError) throw new MockDerivCredentialError(401);
      return [status.account];
    },
    getStatus: async () => {
      observePat();
      return status;
    },
    getLiveStatus: async () => {
      observePat();
      return status;
    },
    getHistory: async () => {
      observePat();
      return historyRows;
    },
    subscribeDerivHistoryUpdates: () => () => {},
    refreshDerivHistory: async () => {
      if (forceHistoryRefreshError) throw new Error("Deriv history refresh timed out");
      return;
    },
    clearHistory: async () => {
      observePat();
      return { success: true };
    },
    requestProposal: async () => {
      observePat();
      return { ok: true, message: "proposal requested" };
    },
    scanAccumulatorKnockout: async () => {
      observePat();
      knockoutScanInvocations += 1;
      return { ok: true, message: "scan passed" };
    },
    buyContract: async () => {
      observePat();
      buyInvocations += 1;
      return { ok: true, message: "contract bought", proposal: null, buy: null };
    },
    sellContract: async () => {
      observePat();
      return { ok: true, contract_id: "contract-1", sold_for: 1 };
    },
    bulkBuyContracts: async (input: { duration: number; contract_type: string }) => {
      observePat();
      bulkBuyInvocations += 1;
      if (input.duration > 5 && input.contract_type !== "CALL" && input.contract_type !== "PUT") {
        throw new Error("Tick durations above 5 are only supported for Rise/Fall contracts.");
      }
      return { ok: true, message: "contracts bought", count: 1, proposals: [], buys: [] };
    },
    dualBuyContracts: async () => {
      observePat();
      dualBuyInvocations += 1;
      return { ok: true, message: "contracts bought", count: 2, results: [] };
    },
    quoteClockWorkContracts: async () => {
      observePat();
      return { quotes: [] };
    },
    buyClockWorkContracts: async () => {
      observePat();
      return { ok: true, message: "contracts bought", requested_count: 0, completed_count: 0, contracts: [], failed: [] };
    },
    buyMatchesContracts: async () => {
      observePat();
      return { ok: true, message: "1 Matches contract sent to Deriv.", requested_count: 1, completed_count: 1, contracts: [], failed: [] };
    },
    selectAccount: async () => {
      observePat();
      return status;
    },
    selectSymbol: async () => {
      observePat();
      return status;
    },
    testConnection: async () => {
      observePat();
      return { ok: true, message: "connected", accounts: [status.account], status };
    },
    withUser: async (_userId: string, operation: () => Promise<unknown>) => operation(),
    withUserSerialized: async (_userId: string, operation: () => Promise<unknown>) => operation(),
    setUserPat: (userId: string, pat: string) => {
      if (forceCapacityError) throw new MockDerivCapacityError("API process is at capacity");
      userPats.set(userId, pat);
    },
    disposeUser: (userId: string) => {
      userPats.delete(userId);
    },
    isDerivBuyRateLimitError: () => false,
  },
});

const { encryptPat } = await import("../lib/pat-crypto.ts");
const { default: derivRouter } = await import("./deriv.ts");
const { default: tokenRouter } = await import("./token.ts");

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  Object.assign(req, { log: { error() {}, warn() {} } });
  res.locals.userId = sessionId;
  res.locals.accessKey = { features: ["clock-work", "edge"] };
  next();
});
app.use(derivRouter);
app.use(tokenRouter);

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

test("admin Deriv routes require the session PAT and forget it on disconnect", async () => {
  userPats.set(sessionId, "prior-session-pat");
  observedPats.length = 0;
  credentials.clear();

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const missingCredentialResponse = await fetch(`${baseUrl}/deriv/accounts`);
    assert.equal(missingCredentialResponse.status, 401);
    assert.deepEqual(await readJson(missingCredentialResponse), { error: "Connect a Deriv token first" });
    assert.deepEqual(observedPats, []);

    const enteredPat = "explicitly-entered-pat";
    credentials.set(sessionId, {
      clerkUserId: sessionId,
      encryptedPat: encryptPat(enteredPat),
      expiresAt: null,
      lastVerifiedAt: new Date(),
    });

    const accountsResponse = await fetch(`${baseUrl}/deriv/accounts`);
    assert.equal(accountsResponse.status, 200);

    forceCapacityError = true;
    const capacityResponse = await fetch(`${baseUrl}/deriv/accounts`);
    assert.equal(capacityResponse.status, 503);
    assert.deepEqual(await readJson(capacityResponse), { error: "API process is at capacity" });
    assert.equal(credentials.has(sessionId), true, "capacity rejection must not erase the saved PAT");
    forceCapacityError = false;

    const statusResponse = await fetch(`${baseUrl}/deriv/status`);
    assert.equal(statusResponse.status, 200, JSON.stringify(await readJson(statusResponse)));

    const proposalResponse = await fetch(`${baseUrl}/deriv/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "edge",
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "R_75",
      }),
    });
    assert.equal(proposalResponse.status, 202);

    const scanResponse = await fetch(`${baseUrl}/deriv/accumulator-knockout-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "edge",
        amount: 1,
        duration: 5,
        duration_unit: "t",
        contract_type: "ACCU",
        growth_rate: 0.04,
        symbol: "1HZ90V",
      }),
    });
    assert.equal(scanResponse.status, 200, JSON.stringify(await readJson(scanResponse)));
    assert.equal(knockoutScanInvocations, 1);

    const buyResponse = await fetch(`${baseUrl}/deriv/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "edge",
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "R_75",
      }),
    });
    assert.equal(buyResponse.status, 202);

    const riseFallBulkResponse = await fetch(`${baseUrl}/deriv/bulk-buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "edge",
        amount: 1,
        duration: 10,
        duration_unit: "t",
        contract_type: "CALL",
        symbol: "R_75",
        count: 1,
      }),
    });
    assert.equal(riseFallBulkResponse.status, 202);

    const digitBulkResponse = await fetch(`${baseUrl}/deriv/bulk-buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "edge",
        amount: 1,
        duration: 10,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "R_75",
        count: 1,
      }),
    });
    assert.equal(digitBulkResponse.status, 400);
    assert.match(String((await readJson(digitBulkResponse)).error), /duration/);
    assert.deepEqual(observedPats, [enteredPat, enteredPat, enteredPat, enteredPat, enteredPat, enteredPat, enteredPat]);

    const priorBuyInvocations = buyInvocations;
    const priorBulkBuyInvocations = bulkBuyInvocations;
    const priorDualBuyInvocations = dualBuyInvocations;
    forceAccessRevoked = true;
    const deniedBuy = await fetch(`${baseUrl}/deriv/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "edge",
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "R_75",
      }),
    });
    assert.equal(deniedBuy.status, 403);
    assert.equal(buyInvocations, priorBuyInvocations, "revoked sessions must not reach the Deriv buy handler");

    const deniedBulkBuy = await fetch(`${baseUrl}/deriv/bulk-buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "edge",
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "R_75",
        count: 1,
      }),
    });
    assert.equal(deniedBulkBuy.status, 403);
    assert.equal(bulkBuyInvocations, priorBulkBuyInvocations, "revoked sessions must not reach the Deriv bulk-buy handler");

    const deniedDualBuy = await fetch(`${baseUrl}/deriv/dual-buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "edge",
        amount: 1,
        duration: 1,
        duration_unit: "t",
        barrier: 5,
        symbol: "R_75",
      }),
    });
    assert.equal(deniedDualBuy.status, 403);
    assert.equal(dualBuyInvocations, priorDualBuyInvocations, "revoked sessions must not reach the Deriv dual-buy handler");
    forceAccessRevoked = false;

    const disconnectResponse = await fetch(`${baseUrl}/token`, { method: "DELETE" });
    assert.equal(disconnectResponse.status, 200);
    assert.equal(userPats.has(sessionId), false);
    assert.equal(credentials.has(sessionId), false);

    const afterDisconnectResponse = await fetch(`${baseUrl}/deriv/accounts`);
    assert.equal(afterDisconnectResponse.status, 401);
    assert.deepEqual(await readJson(afterDisconnectResponse), { error: "Connect a Deriv token first" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("history route accepts decimal Rise/Fall price barriers outside the digit range", async () => {
  const enteredPat = "history-route-test-pat";
  observedPats.length = 0;
  credentials.clear();
  userPats.delete(sessionId);
  historyRows.splice(0, historyRows.length, {
    contract_id: "rise-contract-1",
    account_id: "DOT123",
    account_type: "demo",
    currency: "USD",
    contract_type: "CALL",
    barrier: "12345.678",
    symbol: "R_75",
    duration: null,
    duration_unit: null,
    buy_price: 1,
    current_value: 1.25,
    payout: 1.95,
    profit: 0.25,
    status: "open",
  });
  credentials.set(sessionId, {
    clerkUserId: sessionId,
    encryptedPat: encryptPat(enteredPat),
    expiresAt: null,
    lastVerifiedAt: new Date(),
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/deriv/history`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-deriv-history-stale"), "false");
    const history = await response.json() as Array<{ barrier: number | null }>;
    assert.equal(history[0]?.barrier, 12_345.678);
    assert.deepEqual(observedPats, [enteredPat]);

    forceHistoryRefreshError = true;
    const cachedResponse = await fetch(`http://127.0.0.1:${address.port}/deriv/history`);
    assert.equal(cachedResponse.status, 200);
    assert.equal(cachedResponse.headers.get("x-deriv-history-stale"), "true");
    const cachedHistory = await cachedResponse.json() as Array<{ barrier: number | null }>;
    assert.equal(cachedHistory[0]?.barrier, 12_345.678);

    forceHistoryRefreshError = false;
    historyRows.push({ contract_id: "malformed-history-row" });
    const sanitizedResponse = await fetch(`http://127.0.0.1:${address.port}/deriv/history`);
    assert.equal(sanitizedResponse.status, 200);
    assert.equal(sanitizedResponse.headers.get("x-deriv-history-stale"), "true");
    const sanitizedHistory = await sanitizedResponse.json() as Array<{ barrier: number | null }>;
    assert.equal(sanitizedHistory.length, 1);
    assert.equal(sanitizedHistory[0]?.barrier, 12_345.678);
  } finally {
    forceHistoryRefreshError = false;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    historyRows.length = 0;
    credentials.clear();
    userPats.delete(sessionId);
  }
});

test("a Deriv 403 permission denial preserves the valid saved PAT", async () => {
  const enteredPat = "permission-denied-test-pat";
  credentials.clear();
  userPats.delete(sessionId);
  credentials.set(sessionId, {
    clerkUserId: sessionId,
    encryptedPat: encryptPat(enteredPat),
    expiresAt: null,
    lastVerifiedAt: new Date(),
  });
  forcePermissionError = true;

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/deriv/accounts`);
    assert.equal(response.status, 403);
    assert.deepEqual(await readJson(response), { error: "PAT is missing a required permission" });
    assert.equal(credentials.has(sessionId), true);
    assert.equal(userPats.get(sessionId), enteredPat);
  } finally {
    forcePermissionError = false;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    credentials.clear();
    userPats.delete(sessionId);
  }
});

test("a Deriv 401 invalid-token response clears the rejected saved PAT", async () => {
  const enteredPat = "invalid-token-test-pat";
  credentials.clear();
  userPats.delete(sessionId);
  credentials.set(sessionId, {
    clerkUserId: sessionId,
    encryptedPat: encryptPat(enteredPat),
    expiresAt: null,
    lastVerifiedAt: new Date(),
  });
  forceInvalidCredentialError = true;

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/deriv/accounts`);
    assert.equal(response.status, 401);
    assert.match(String((await readJson(response)).error), /Enter your PAT again/);
    assert.equal(credentials.has(sessionId), false);
    assert.equal(userPats.has(sessionId), false);
  } finally {
    forceInvalidCredentialError = false;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    credentials.clear();
    userPats.delete(sessionId);
  }
});