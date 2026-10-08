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

describe("Auto Trader access-key feature path", () => {
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
