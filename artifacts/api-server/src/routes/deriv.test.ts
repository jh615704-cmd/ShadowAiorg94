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
const bulkBuyDurations: number[] = [];
let dualBuyInvocations = 0;
let knockoutStatisticsInvocations = 0;
const knockoutStatisticsInputs: Array<{ symbol: string; amount: number; duration: number }> = [];
let routeAccessFeatures = ["clock-work", "edge", "trade-x", "bulk-trader", "auto-trader", "money-bank", "matrix", "speedbot"];
let knockoutScanInvocations = 0;
const marketTickListeners = new Set<(tick: {
  symbol: string;
  tick_sequence: number;
  recent_digits: number[];
  tick_epoch: number;
}) => void>();

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
    TRADING_ACCESS_FEATURES: ["edge", "digit-flip", "trade-x", "bulk-trader", "clock-work", "cash-grab", "money-bank", "jdy-ai-3", "auto-trader", "auto-trader-2", "speedbot"],
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
    refreshOpenContracts: async () => [],
    getHistory: async () => {
      observePat();
      return historyRows;
    },
    getMarketTickSnapshot: () => [{
      symbol: "R_75",
      tick_sequence: 0,
      recent_digits: [],
      tick_epoch: 0,
    }],
    subscribeDerivHistoryUpdates: () => () => {},
    subscribeDerivMarketTickUpdates: (listener: (tick: {
      symbol: string;
      tick_sequence: number;
      recent_digits: number[];
      tick_epoch: number;
    }) => void) => {
      marketTickListeners.add(listener);
      return () => marketTickListeners.delete(listener);
    },
    refreshDerivHistory: async () => {
      if (forceHistoryRefreshError) throw new Error("Deriv history refresh timed out");
      return true;
    },
    clearHistory: async () => {
      observePat();
      return { success: true };
    },
    requestProposal: async () => {
      observePat();
      return { ok: true, message: "proposal requested" };
    },
    getEdgeAvailableDurations: async () => {
      observePat();
      return { supported_durations: [1, 3, 4, 5] };
    },
    scanAccumulatorKnockout: async () => {
      observePat();
      knockoutScanInvocations += 1;
      return {
        ok: true,
        message: "scan passed",
        phase: "waiting_for_knockout",
        symbol: "1HZ90V",
        qualified_knockouts: 0,
        required_knockouts: 5,
        tick_sequence: 0,
        ready_to_trade: false,
        market_matches: true,
      };
    },
    getMoneyBankKnockoutStatistics: async (input: { symbol: string; amount: number; duration: number }) => {
      observePat();
      knockoutStatisticsInvocations += 1;
      knockoutStatisticsInputs.push(input);
      return {
        symbol: input.symbol,
        duration_ticks: input.duration,
        quote_count: 200,
        tick_sequence: 200,
        window_start_epoch: 1_700_000_000,
        window_end_epoch: 1_700_000_199,
        captured_at_epoch: 1_700_000_200,
        tick_age_seconds: 1,
        freshness: "fresh",
        confidence_level: 0.95,
        rates: [1, 2, 3, 4, 5].map((growthRate) => ({
          growth_rate: growthRate,
          barrier: 0.00005,
          status: "ready",
          training_windows: 23,
          training_knockouts: 3,
          holdout_windows: 10,
          observed_knockouts: 2,
          estimated_knockouts: 1.3,
          estimate_lower_count: 0.5,
          estimate_upper_count: 3.2,
          estimated_knockout_rate: 3 / 23,
          observed_knockout_rate: 0.2,
          holdout_gap_percentage_points: 6.95,
          message: null,
        })),
      };
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
    buyMatrixContracts: async () => {
      observePat();
      return { ok: true, message: "Matrix batch accepted", count: 0, proposals: [], buys: [], failed: [] };
    },
    bulkBuyContracts: async (input: { duration: number; contract_type: string }) => {
      observePat();
      bulkBuyInvocations += 1;
      bulkBuyDurations.push(input.duration);
      if (input.duration > 5 && input.contract_type !== "CALL" && input.contract_type !== "PUT") {
        throw new Error("Tick durations above 5 are only supported for Rise/Fall contracts.");
      }
      return { ok: true, message: "contracts bought", count: 1, proposals: [], buys: [], failed: [] };
    },
    dualBuyContracts: async () => {
      observePat();
      dualBuyInvocations += 1;
      return { ok: true, message: "contracts bought", count: 2, proposals: [], buys: [], failed: [] };
    },
    quoteClockWorkContracts: async () => {
      observePat();
      return { quotes: [] };
    },
    buyClockWorkContracts: async () => {
      observePat();
      return { ok: true, message: "contracts bought", requested_count: 0, completed_count: 0, contracts: [], failed: [] };
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
    isDerivApiError: () => false,
    classifyBuyFailure: () => ({ outcome: "uncertain", source: "unknown" }),
    getTradeErrorSource: () => "api_server",
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
  res.locals.accessKey = { features: routeAccessFeatures };
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
  bulkBuyDurations.length = 0;
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

    const edgeDurationsResponse = await fetch(`${baseUrl}/deriv/edge-available-durations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "edge",
        amount: 1,
        contract_type: "DIGITOVER",
        barrier: 5,
        symbol: "R_75",
      }),
    });
    assert.equal(edgeDurationsResponse.status, 200);
    assert.deepEqual(await readJson(edgeDurationsResponse), {
      supported_durations: [1, 3, 4, 5],
    });

    const scanResponse = await fetch(`${baseUrl}/deriv/accumulator-knockout-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start",
        amount: 1,
        duration: 5,
        duration_unit: "t",
        contract_type: "ACCU",
        growth_rate: 0.04,
        symbol: "1HZ90V",
      required_knockouts: 5,
      }),
    });
    const scanResponseBody = await readJson(scanResponse);
    assert.equal(scanResponse.status, 200, JSON.stringify(scanResponseBody));
    assert.equal(scanResponseBody.required_knockouts, 5);
    assert.equal(knockoutScanInvocations, 1);

    knockoutStatisticsInvocations = 0;
    knockoutStatisticsInputs.length = 0;
    const statisticsUrl = `${baseUrl}/deriv/accumulator-knockout-statistics?symbol=1HZ90V&amount=1.25&duration=5`;
    const statisticsResponse = await fetch(statisticsUrl);
    const statisticsBody = await readJson(statisticsResponse);
    assert.equal(statisticsResponse.status, 200, JSON.stringify(statisticsBody));
    assert.equal(statisticsResponse.headers.get("cache-control"), "no-store");
    assert.deepEqual((statisticsBody.rates as Array<{ growth_rate: number }>).map((rate) => rate.growth_rate), [1, 2, 3, 4, 5]);
    assert.deepEqual(knockoutStatisticsInputs, [{ symbol: "1HZ90V", amount: 1.25, duration: 5 }]);
    assert.equal(knockoutStatisticsInvocations, 1);

    const unsupportedStatisticsResponse = await fetch(
      `${baseUrl}/deriv/accumulator-knockout-statistics?symbol=R_75&amount=1&duration=5`,
    );
    assert.equal(unsupportedStatisticsResponse.status, 400);
    assert.equal(knockoutStatisticsInvocations, 1);

    const grantedFeatures = routeAccessFeatures;
    routeAccessFeatures = ["edge"];
    const blockedStatisticsResponse = await fetch(statisticsUrl);
    routeAccessFeatures = grantedFeatures;
    assert.equal(blockedStatisticsResponse.status, 403);
    assert.equal(knockoutStatisticsInvocations, 1);

    const invalidMoneyBankDurationResponse = await fetch(`${baseUrl}/deriv/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "money-bank",
        amount: 1,
        duration: 0,
        duration_unit: "t",
        contract_type: "ACCU",
        growth_rate: 0.04,
        symbol: "1HZ90V",
      }),
    });
    assert.equal(invalidMoneyBankDurationResponse.status, 400);
    assert.match(String((await readJson(invalidMoneyBankDurationResponse)).error), /Invalid trade request/);

    const invalidMoneyBankContractResponse = await fetch(`${baseUrl}/deriv/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "money-bank",
        amount: 1,
        duration: 5,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "1HZ90V",
      }),
    });
    assert.equal(invalidMoneyBankContractResponse.status, 400);
    assert.match(String((await readJson(invalidMoneyBankContractResponse)).error), /Accumulator contracts from 1 to 30 ticks/);

    const invalidMoneyBankUpperDurationResponse = await fetch(`${baseUrl}/deriv/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "money-bank",
        amount: 1,
        duration: 31,
        duration_unit: "t",
        contract_type: "ACCU",
        growth_rate: 0.04,
        symbol: "1HZ90V",
      }),
    });
    assert.equal(invalidMoneyBankUpperDurationResponse.status, 400);

    const validMoneyBankBuyResponse = await fetch(`${baseUrl}/deriv/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "money-bank",
        amount: 1,
        duration: 1,
        duration_unit: "t",
        contract_type: "ACCU",
        growth_rate: 0.04,
        symbol: "1HZ90V",
      }),
    });
    assert.equal(validMoneyBankBuyResponse.status, 202, JSON.stringify(await readJson(validMoneyBankBuyResponse)));

    const removedJackpotRoute = await fetch(`${baseUrl}/deriv/jackpot/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_feature: "jackpot" }),
    });
    assert.equal(removedJackpotRoute.status, 404);

    const validMoneyBankMaxDurationResponse = await fetch(`${baseUrl}/deriv/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "money-bank",
        amount: 1,
        duration: 30,
        duration_unit: "t",
        contract_type: "ACCU",
        growth_rate: 0.04,
        symbol: "1HZ90V",
      }),
    });
    assert.equal(validMoneyBankMaxDurationResponse.status, 202, JSON.stringify(await readJson(validMoneyBankMaxDurationResponse)));

    const speedbotBuyCountBefore = buyInvocations;
    const validSpeedbotResponse = await fetch(`${baseUrl}/deriv/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "speedbot",
        amount: 0.35,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 0,
        symbol: "1HZ90V",
        automated: true,
      }),
    });
    assert.equal(validSpeedbotResponse.status, 202, JSON.stringify(await readJson(validSpeedbotResponse)));
    assert.equal(buyInvocations, speedbotBuyCountBefore + 1, "Valid Speedbot payloads should pass schema validation and reach the buy handler.");

    const invalidSpeedbotResponse = await fetch(`${baseUrl}/deriv/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "speedbot",
        amount: 0.35,
        duration: 1,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 10,
        symbol: "1HZ90V",
        automated: true,
      }),
    });
    const invalidSpeedbotBody = await readJson(invalidSpeedbotResponse);
    assert.equal(invalidSpeedbotResponse.status, 400);
    assert.match(String(invalidSpeedbotBody.error), /barrier must be a whole digit from 0 to 9/);
    assert.equal(invalidSpeedbotBody.trade_outcome, "not_sent");
    assert.equal(buyInvocations, speedbotBuyCountBefore + 1, "Invalid Speedbot requests must not reach Deriv.");

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
    const tradeXDurationOffset = bulkBuyDurations.length;
    const validTradeXResponse = await fetch(`${baseUrl}/deriv/bulk-buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "trade-x",
        amount: 0.35,
        duration: 5,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 4,
        symbol: "R_75",
        count: 1,
      }),
    });
    assert.equal(validTradeXResponse.status, 202);
    assert.deepEqual(bulkBuyDurations.slice(tradeXDurationOffset), [5]);

    const priorTradeXValidationInvocations = bulkBuyInvocations;
    const invalidTradeXRequests = [
      { amount: 1, duration: 1, contract_type: "DIGITDIFF", count: 2, error: /one contract/ },
      { amount: 1, duration: 1, contract_type: "CALL", count: 1, error: /Digit Differs/ },
      { amount: 0.34, duration: 1, contract_type: "DIGITDIFF", count: 1, error: /at least 0.35/ },
      { amount: 1, duration: 6, contract_type: "DIGITDIFF", count: 1, error: /Trade X supports whole-number durations from 1 to 5 ticks/ },
    ] as const;
    for (const request of invalidTradeXRequests) {
      const response = await fetch(`${baseUrl}/deriv/bulk-buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_feature: "trade-x",
          amount: request.amount,
          duration: request.duration,
          duration_unit: "t",
          contract_type: request.contract_type,
          barrier: 4,
          symbol: "R_75",
          count: request.count,
        }),
      });
      assert.equal(response.status, 400);
      assert.match(String((await readJson(response)).error), request.error);
    }
    assert.equal(bulkBuyInvocations, priorTradeXValidationInvocations, "invalid Trade X requests must not reach Deriv");

    const bulkTraderDurationOffset = bulkBuyDurations.length;
    const bulkTraderContractTypes = ["DIGITOVER", "DIGITUNDER", "DIGITDIFF"] as const;
    for (const contractType of bulkTraderContractTypes) {
      for (const duration of [1, 2, 3, 4, 5]) {
        const bulkTraderResponse = await fetch(`${baseUrl}/deriv/bulk-buy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_feature: "bulk-trader",
            amount: 1,
            duration,
            duration_unit: "t",
            contract_type: contractType,
            barrier: contractType === "DIGITDIFF" ? 4 : 3,
            symbol: "R_75",
            count: 1,
          }),
        });
        assert.equal(bulkTraderResponse.status, 202, `Bulk Trader should accept ${contractType} at ${duration} tick(s).`);
      }
    }
    assert.deepEqual(
      bulkBuyDurations.slice(bulkTraderDurationOffset),
      bulkTraderContractTypes.flatMap(() => [1, 2, 3, 4, 5]),
    );
    const priorBulkTraderValidationInvocations = bulkBuyInvocations;
    const invalidBulkTraderRequests = [
      { duration: 6, contract_type: "DIGITDIFF", error: /1 to 5 ticks/ },
      { duration: 1, contract_type: "CALL", error: /trade action could not be matched/ },
    ] as const;
    for (const request of invalidBulkTraderRequests) {
      const response = await fetch(`${baseUrl}/deriv/bulk-buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_feature: "bulk-trader",
          amount: 1,
          duration: request.duration,
          duration_unit: "t",
          contract_type: request.contract_type,
          barrier: 4,
          symbol: "R_75",
          count: 1,
        }),
      });
      assert.equal(response.status, 400);
      assert.match(String((await readJson(response)).error), request.error);
    }
    assert.equal(bulkBuyInvocations, priorBulkTraderValidationInvocations, "invalid Bulk Trader requests must not reach Deriv");

    const autoTraderDurationOffset = bulkBuyDurations.length;
    for (const duration of [1, 2, 3, 4, 5]) {
      const autoTraderBulkResponse = await fetch(`${baseUrl}/deriv/bulk-buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_feature: "auto-trader",
          amount: 1,
          duration,
          duration_unit: "t",
          contract_type: "DIGITDIFF",
          barrier: 5,
          symbol: "R_75",
          count: 1,
        }),
      });
      assert.equal(autoTraderBulkResponse.status, 202, `Auto Trader should accept ${duration} tick duration.`);
    }
    assert.deepEqual(bulkBuyDurations.slice(autoTraderDurationOffset), [1, 2, 3, 4, 5]);
    const outOfRangeAutoTraderResponse = await fetch(`${baseUrl}/deriv/bulk-buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_feature: "auto-trader",
        amount: 1,
        duration: 6,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 5,
        symbol: "R_75",
        count: 1,
      }),
    });
    assert.equal(outOfRangeAutoTraderResponse.status, 400);
    assert.match(String((await readJson(outOfRangeAutoTraderResponse)).error), /1 to 5 ticks/);
    assert.deepEqual(observedPats, Array.from({ length: 33 }, () => enteredPat));

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

    const tickStreamAbort = new AbortController();
    const tickStreamResponse = await fetch(`${baseUrl}/deriv/events?market_ticks=true`, {
      signal: tickStreamAbort.signal,
    });
    assert.equal(tickStreamResponse.status, 200);
    const tickStreamReader = tickStreamResponse.body?.getReader();
    assert.ok(tickStreamReader);
    const decoder = new TextDecoder();
    let initialEvents = "";
    while (!initialEvents.includes("event: market-tick-snapshot")) {
      const chunk = await tickStreamReader.read();
      assert.equal(chunk.done, false, "the stream should send its initial tick snapshot");
      initialEvents += decoder.decode(chunk.value, { stream: true });
    }
    assert.match(initialEvents, /event: history-snapshot/);
    assert.match(initialEvents, /event: market-tick-snapshot/);

    const nextEvent = tickStreamReader.read();
    for (const listener of marketTickListeners) {
      listener({ symbol: "R_75", tick_sequence: 1, recent_digits: [6], tick_epoch: 1 });
    }
    const liveTick = await nextEvent;
    assert.match(decoder.decode(liveTick.value), /event: market-tick/);
    tickStreamAbort.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(marketTickListeners.size, 0, "closing the response must remove its per-user tick listener");

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