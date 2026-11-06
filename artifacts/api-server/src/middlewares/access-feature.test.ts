import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { Request, RequestHandler, Response } from "express";
import {
  CreateAccessKeyBody,
  UpdateAccessKeyBody,
} from "@workspace/api-zod";
let savedFeatureSettings: { settings: unknown } | null = null;
const adminFeatureSettingsTable = {};
const fakeDb = {
  select() {
    return {
      from(table: unknown) {
        return {
          async limit() {
            return table === adminFeatureSettingsTable && savedFeatureSettings ? [savedFeatureSettings] : [];
          },
        };
      },
    };
  },
};

mock.module("@workspace/db", {
  namedExports: {
    db: fakeDb,
    accessKeysTable: {},
    accessKeySessionsTable: {},
    adminFeatureSettingsTable,
  },
});
mock.module("drizzle-orm", {
  namedExports: {
    and: (...conditions: unknown[]) => conditions,
    eq: (...conditions: unknown[]) => conditions,
    gt: (...conditions: unknown[]) => conditions,
    isNull: (...conditions: unknown[]) => conditions,
  },
});

const { ACCESS_FEATURES, featureList, TRADING_ACCESS_FEATURES } = await import("../lib/access-keys.ts");
const { requireAccessFeature, requireAnyAccessFeature, requireFeatureAction, requireTradeAccessFeature } = await import("./requireAccess.ts");

const autoTraderFeature = "auto-trader";
const autoTrader2Feature = "auto-trader-2";
const clockWorkFeature = "clock-work";
const matchesAnalysisFeature = "matches-analysis";

describe("Trading access-key feature path", () => {
  it("does not grant access to the retired Matches Analysis feature", async () => {
    assert.equal((ACCESS_FEATURES as readonly string[]).includes(matchesAnalysisFeature), false);
    assert.equal((TRADING_ACCESS_FEATURES as readonly string[]).includes(matchesAnalysisFeature), false);
    assert.deepEqual(featureList([matchesAnalysisFeature], "user"), []);
    assert.equal(
      (await runGuard(requireAccessFeature(matchesAnalysisFeature), featureList([matchesAnalysisFeature], "user"))).statusCode,
      403,
    );
  });

  it("accepts Clock Work grants and includes them on trading routes", async () => {
    const create = CreateAccessKeyBody.parse({
      label: "Clock Work user",
      kind: "user",
      max_devices: 1,
      features: [clockWorkFeature],
    });
    const update = UpdateAccessKeyBody.parse({ features: [clockWorkFeature] });

    assert.deepEqual(create.features, [clockWorkFeature]);
    assert.deepEqual(update.features, [clockWorkFeature]);
    assert.ok(ACCESS_FEATURES.includes(clockWorkFeature));
    assert.ok(TRADING_ACCESS_FEATURES.includes(clockWorkFeature));
    assert.equal((await runGuard(requireAccessFeature(clockWorkFeature), [clockWorkFeature])).nextCalled, true);
    assert.equal(
      (await runGuard(requireAccessFeature(clockWorkFeature), ["trade-x"])).statusCode,
      403,
    );
  });

  it("accepts Auto Trader in both create and edit requests", () => {
    const create = CreateAccessKeyBody.parse({
      label: "Fixture user",
      kind: "user",
      max_devices: 1,
      features: ["edge", autoTraderFeature],
    });
    const update = UpdateAccessKeyBody.parse({ features: [autoTraderFeature] });

    assert.deepEqual(create.features, ["edge", autoTraderFeature]);
    assert.deepEqual(update.features, [autoTraderFeature]);
  });

  it("keeps Auto Trader 2.0 as an independent access grant", () => {
    const create = CreateAccessKeyBody.parse({
      label: "Auto Trader 2.0 user",
      kind: "user",
      max_devices: 1,
      features: [autoTrader2Feature],
    });
    const update = UpdateAccessKeyBody.parse({ features: [autoTrader2Feature] });
    assert.deepEqual(create.features, [autoTrader2Feature]);
    assert.deepEqual(update.features, [autoTrader2Feature]);
    assert.ok(TRADING_ACCESS_FEATURES.includes(autoTrader2Feature));
    assert.ok(ACCESS_FEATURES.includes(autoTrader2Feature));
  });

  it("preserves the grant for user sessions and filters administrator-only values", () => {
    assert.deepEqual(
      featureList(["edge", autoTraderFeature, "admin"], "user"),
      ["edge", autoTraderFeature],
    );
  });

  it("keeps every trading-route grant in the shared feature schema", () => {
    assert.ok(TRADING_ACCESS_FEATURES.includes(autoTraderFeature));
    assert.ok(TRADING_ACCESS_FEATURES.every((feature) => ACCESS_FEATURES.includes(feature)));
  });

  it("allows the feature route only when the session has the matching grant", async () => {
    const authorized = await runGuard(requireAccessFeature(autoTraderFeature), [autoTraderFeature]);
    assert.equal(authorized.nextCalled, true);
    assert.equal(authorized.statusCode, undefined);

    const denied = await runGuard(requireAnyAccessFeature(autoTraderFeature), ["trade-x"]);
    assert.equal(denied.nextCalled, false);
    assert.equal(denied.statusCode, 403);
    assert.match(String(denied.body?.error), /auto-trader/);
  });

  it("blocks only the selected access keys when a feature is restricted", async () => {
    savedFeatureSettings = {
      settings: {
        features: [{
          feature: autoTraderFeature,
          mode: "restricted",
          audience: "specific",
          user_ids: ["00000000-0000-4000-8000-000000000001"],
          notice: "Please contact support.",
        }],
      },
    };
    const selected = await runGuard(
      requireAccessFeature(autoTraderFeature),
      [autoTraderFeature],
      "00000000-0000-4000-8000-000000000001",
    );
    const unselected = await runGuard(
      requireAccessFeature(autoTraderFeature),
      [autoTraderFeature],
      "00000000-0000-4000-8000-000000000002",
    );
    assert.equal(selected.statusCode, 403);
    assert.match(String(selected.body?.error), /Restricted — admin access only/);
    assert.equal(unselected.nextCalled, true);
    savedFeatureSettings = null;
  });

  it("requires a feature context and enforces that feature before a generic buy", async () => {
    savedFeatureSettings = {
      settings: {
        features: [{
          feature: autoTraderFeature,
          mode: "under_construction",
          audience: "all",
          user_ids: [],
          notice: "",
        }],
      },
    };
    const missing = await runGuard(requireTradeAccessFeature, [autoTraderFeature]);
    const blocked = await runGuard(
      requireTradeAccessFeature,
      [autoTraderFeature],
      "00000000-0000-4000-8000-000000000099",
      { access_feature: autoTraderFeature },
    );
    assert.equal(missing.statusCode, 400);
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.body?.feature, autoTraderFeature);
    savedFeatureSettings = null;
  });

  it("blocks a feature trade when its admin-managed Place trade action is unavailable", async () => {
    savedFeatureSettings = {
      settings: {
        features: [{ feature: autoTraderFeature, mode: "available", audience: "all", user_ids: [], notice: "" }],
        action_controls: [{
          feature: autoTraderFeature,
          control_id: "place-trade",
          label: "Place trade",
          mode: "coming_soon",
        }, {
          feature: "clock-work",
          control_id: "ai-clock",
          label: "AI Clock switch",
          mode: "restricted",
        }],
      },
    };
    const blocked = await runGuard(
      requireTradeAccessFeature,
      [autoTraderFeature],
      "00000000-0000-4000-8000-000000000099",
      { access_feature: autoTraderFeature },
    );
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.body?.code, "FEATURE_ACTION_UNAVAILABLE");
    assert.equal(blocked.body?.control_id, "place-trade");

    const directAction = await runGuard(
      requireFeatureAction("clock-work", "ai-clock"),
      ["clock-work"],
    );
    assert.equal(directAction.nextCalled, false);
    savedFeatureSettings = null;
  });
});

async function runGuard(
  guard: RequestHandler,
  features: string[],
  accessKeyId = "00000000-0000-4000-8000-000000000099",
  body?: Record<string, unknown>,
) {
  const result: {
    nextCalled: boolean;
    statusCode?: number;
    body?: Record<string, unknown>;
  } = { nextCalled: false };
  const response = {
    locals: { accessKey: { features, keyHash: "test-key-hash" }, accessKeyId },
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      result.body = body;
      return this;
    },
  } as unknown as Response;

  await guard({ body } as Request, response, () => {
    result.nextCalled = true;
  });
  return result;
}
