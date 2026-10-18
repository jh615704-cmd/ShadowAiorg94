import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import {
  CreateAccessKeyBody,
  UpdateAccessKeyBody,
} from "@workspace/api-zod";
import {
  ACCESS_FEATURES,
  featureList,
  TRADING_ACCESS_FEATURES,
} from "../lib/access-keys.ts";
import {
  requireAccessFeature,
  requireAnyAccessFeature,
} from "./requireAccess.ts";

const autoTraderFeature = "auto-trader";
const autoTrader2Feature = "auto-trader-2";
const clockWorkFeature = "clock-work";
const matchesAnalysisFeature = "matches-analysis";

describe("Auto Trader access-key feature path", () => {
  it("accepts Matches Analysis grants and limits its buy route to that feature", () => {
    const create = CreateAccessKeyBody.parse({
      label: "Matches Analysis user",
      kind: "user",
      max_devices: 1,
      features: [matchesAnalysisFeature],
    });
    const update = UpdateAccessKeyBody.parse({ features: [matchesAnalysisFeature] });

    assert.deepEqual(create.features, [matchesAnalysisFeature]);
    assert.deepEqual(update.features, [matchesAnalysisFeature]);
    assert.ok(ACCESS_FEATURES.includes(matchesAnalysisFeature));
    assert.ok(TRADING_ACCESS_FEATURES.includes(matchesAnalysisFeature));
    assert.equal(
      runGuard(requireAccessFeature(matchesAnalysisFeature), [matchesAnalysisFeature]).nextCalled,
      true,
    );
    assert.equal(
      runGuard(requireAccessFeature(matchesAnalysisFeature), ["trade-x"]).statusCode,
      403,
    );
  });

  it("accepts Clock Work grants and includes them on trading routes", () => {
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
    assert.equal(
      runGuard(requireAccessFeature(clockWorkFeature), [clockWorkFeature]).nextCalled,
      true,
    );
    assert.equal(
      runGuard(requireAccessFeature(clockWorkFeature), ["trade-x"]).statusCode,
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

  it("allows the feature route only when the session has the matching grant", () => {
    const authorized = runGuard(requireAccessFeature(autoTraderFeature), [autoTraderFeature]);
    assert.equal(authorized.nextCalled, true);
    assert.equal(authorized.statusCode, undefined);

    const denied = runGuard(requireAnyAccessFeature(autoTraderFeature), ["trade-x"]);
    assert.equal(denied.nextCalled, false);
    assert.equal(denied.statusCode, 403);
    assert.match(String(denied.body?.error), /auto-trader/);
  });
});

function runGuard(
  guard: (request: Request, response: Response, next: () => void) => void,
  features: string[],
) {
  const result: {
    nextCalled: boolean;
    statusCode?: number;
    body?: Record<string, unknown>;
  } = { nextCalled: false };
  const response = {
    locals: { accessKey: { features } },
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      result.body = body;
      return this;
    },
  } as unknown as Response;

  guard({} as Request, response, () => {
    result.nextCalled = true;
  });
  return result;
}
