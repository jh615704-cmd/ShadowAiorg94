import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiTransportError, customFetch } from "./custom-fetch.ts";

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

describe("customFetch transport recovery", () => {
  it("replaces the Replit preview HTML fallback with a clear API-routing error", async () => {
    globalThis.fetch = (async () => new Response(
      '<!doctype html><style>@font-face { font-family: "Replit Diatype"; }</style>Run this app to see the results here.',
      { status: 404, statusText: "Not Found", headers: { "content-type": "text/html" } },
    )) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/buy", {
        method: "POST",
        body: JSON.stringify({ amount: 1 }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /dashboard preview page was returned instead of the trading API/i);
        assert.doesNotMatch(error.message, /@font-face|Replit Diatype/);
        assert.match(error.message, /no order was sent/i);
        return true;
      },
    );
  });

  it("shows account-history recovery guidance for an ambiguous server buy failure", async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: "HTTP 502 Bad Gateway: You have reached the rate limit for buy" }),
      { status: 502, statusText: "Bad Gateway", headers: { "content-type": "application/json" } },
    )) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/bulk-buy", { method: "POST", body: JSON.stringify({ count: 2 }) }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /did not confirm whether every order/i);
        assert.match(error.message, /selected Deriv account's open contracts and history/i);
        assert.match(error.message, /do not resend/i);
        assert.doesNotMatch(error.message, /HTTP 502|Bad Gateway|rate limit for buy/i);
        return true;
      },
    );
  });

  it("treats an uncertain EDGE 429 batch as a history check, not routine throttling", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({
        code: "DERIV_BUY_RATE_LIMITED",
        error: "Deriv temporarily limited new buys.",
        trade_outcome: "uncertain",
        diagnostic_source: "deriv",
      }), {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/dual-buy", {
        method: "POST",
        body: JSON.stringify({ access_feature: "edge", amount: 1 }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /did not confirm whether every order/i);
        assert.match(error.message, /selected Deriv account's open contracts and history/i);
        assert.match(error.message, /do not resend/i);
        assert.doesNotMatch(error.message, /wait a moment before trying again/i);
        return true;
      },
    );

    assert.equal(calls, 1);
    assert.deepEqual(reported, {
      code: "trade_outcome_uncertain",
      severity: "warning",
      feature: "edge",
      source: "deriv",
      operation: "dual_buy",
    });
  });

  it("shows safe copy for an explicit exhausted Deriv buy-rate-limit response", async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        code: "DERIV_BUY_RATE_LIMITED",
        error: "Deriv temporarily limited new buys. Some earlier batch contracts may already be open.",
        trade_outcome: "rejected",
      }),
      { status: 429, statusText: "Too Many Requests", headers: { "content-type": "application/json" } },
    )) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/bulk-buy", { method: "POST", body: JSON.stringify({ count: 2 }) }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /temporarily limited new buys/i);
        assert.doesNotMatch(error.message, /HTTP 429|Bad Gateway|rate limit for buy/i);
        return true;
      },
    );
  });

  it("retries a safe read once with the same request reference", async () => {
    let calls = 0;
    const requestIds: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      calls += 1;
      requestIds.push(new Headers(init?.headers).get("x-client-request-id") ?? "");
      if (calls === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const response = await customFetch<{ status: string }>("/api/healthz");

    assert.deepEqual(response, { status: "ok" });
    assert.equal(calls, 2);
    assert.ok(requestIds[0]);
    assert.equal(requestIds[0], requestIds[1]);
  });

  it("does not replay an interrupted trade and explains how to verify its outcome", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/bulk-buy", {
        method: "POST",
        body: JSON.stringify({ amount: 1 }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiTransportError);
        assert.equal(error.tradeOutcomeUncertain, true);
        assert.match(error.message, /contract may already be open/i);
        assert.match(error.message, /refresh order status before trying again/i);
        assert.doesNotMatch(error.message, /^Failed to fetch$/);
        assert.ok(error.requestId);
        return true;
      },
    );

    assert.equal(calls, 1);
  });

  it("treats an interrupted buy as an uncertain trade and never replays it", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/buy", {
        method: "POST",
        body: JSON.stringify({ access_feature: "bulk-trader", contracts: [] }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiTransportError);
        assert.equal(error.tradeOutcomeUncertain, true);
        assert.match(error.message, /contract may already be open/i);
        assert.match(error.message, /refresh order status before trying again/i);
        return true;
      },
    );

    assert.equal(calls, 1);
  });

  it("attributes uncertain shared buys to their own feature in admin diagnostics", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    await assert.rejects(customFetch("/api/deriv/buy", {
      method: "POST",
      body: JSON.stringify({ access_feature: "digit-flip", amount: 1 }),
    }));

    assert.deepEqual(reported, {
      code: "trade_outcome_uncertain",
      severity: "warning",
      feature: "digit-flip",
      source: "transport",
      operation: "buy",
    });
  });

  it("marks an interrupted EDGE buy as uncertain without replaying it", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    const controller = new AbortController();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/bulk-buy", {
        method: "POST",
        body: JSON.stringify({ access_feature: "edge", amount: 1 }),
        signal: controller.signal,
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiTransportError);
        assert.equal(error.tradeOutcomeUncertain, true);
        assert.match(error.message, /contract may already be open/i);
        assert.match(error.message, /open contracts and history/i);
        assert.match(error.message, /do not resend/i);
        return true;
      },
    );

    assert.equal(calls, 1);
    assert.deepEqual(reported, {
      code: "trade_outcome_uncertain",
      severity: "warning",
      feature: "edge",
      source: "transport",
      operation: "bulk_buy",
    });
  });

  it("marks an unparseable EDGE success response as uncertain", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("not-json", {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/bulk-buy", {
        method: "POST",
        body: JSON.stringify({ access_feature: "edge", amount: 1 }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiTransportError);
        assert.equal(error.tradeOutcomeUncertain, true);
        assert.match(error.message, /response did not confirm whether the trade was accepted/i);
        assert.match(error.message, /open contracts and history/i);
        assert.match(error.message, /do not resend/i);
        return true;
      },
    );

    assert.equal(calls, 1);
    assert.deepEqual(reported, {
      code: "trade_outcome_uncertain",
      severity: "warning",
      feature: "edge",
      source: "transport",
      operation: "bulk_buy",
    });
  });

  it("does not call a pre-aborted EDGE request an uncertain trade", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = (async (_input, init) => {
      assert.equal(init?.signal?.aborted, true);
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/bulk-buy", {
        method: "POST",
        body: JSON.stringify({ access_feature: "edge", amount: 1 }),
        signal: controller.signal,
      }),
      (error: unknown) => {
        assert.ok(!(error instanceof ApiTransportError));
        assert.equal((error as Error).name, "AbortError");
        return true;
      },
    );

    assert.equal(reported, undefined);
  });

  it("reports partial trade acknowledgements from successful HTTP responses", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ ok: false, message: "A contract remains unconfirmed." }),
      { status: 202, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

    await customFetch("/api/deriv/bulk-buy", {
      method: "POST",
      body: JSON.stringify({ access_feature: "bulk-trader", contracts: [] }),
    });

    assert.deepEqual(reported, {
      code: "trade_outcome_uncertain",
      severity: "warning",
      feature: "bulk-trader",
      source: "unknown",
      operation: "bulk_buy",
    });
  });

  it("captures uncertain partial Jackpot batches with operation-level attribution", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        ok: true,
        message: "Some contracts were acknowledged.",
        failed: [{ key: "higher-1", outcome: "uncertain", source: "deriv", error: "Not confirmed." }],
      }),
      { status: 202, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

    await customFetch("/api/deriv/jackpot/buy", {
      method: "POST",
      body: JSON.stringify({ contract_types: ["CALL"] }),
    });

    assert.deepEqual(reported, {
      code: "trade_outcome_uncertain",
      severity: "warning",
      feature: "jackpot",
      source: "deriv",
      operation: "jackpot_batch",
    });
  });

  it("attributes shared contract-close uncertainty to the workspace, not a guessed feature", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: "Close was not confirmed.", trade_outcome: "uncertain" }),
      { status: 502, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

    await assert.rejects(customFetch("/api/deriv/sell", {
      method: "POST",
      body: JSON.stringify({ contract_id: "private-contract-id" }),
    }));

    assert.deepEqual(reported, {
      code: "trade_outcome_uncertain",
      severity: "warning",
      feature: "dashboard",
      source: "unknown",
      operation: "sell",
    });
  });

  it("uses explicit feature context to attribute a Cash Grab close failure", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    globalThis.fetch = (async () => {
      throw new TypeError("Connection lost");
    }) as typeof fetch;

    await assert.rejects(customFetch("/api/deriv/sell", {
      method: "POST",
      body: JSON.stringify({ contract_id: "private-contract-id", diagnostic_feature: "cash-grab" }),
    }));

    assert.deepEqual(reported, {
      code: "trade_outcome_uncertain",
      severity: "warning",
      feature: "cash-grab",
      source: "transport",
      operation: "sell",
    });
    assert.doesNotMatch(JSON.stringify(reported), /private-contract-id/);
  });

  it("attributes Speedbot uncertain orders to Speedbot", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    globalThis.fetch = (async () => {
      throw new TypeError("Connection lost");
    }) as typeof fetch;

    await assert.rejects(customFetch("/api/deriv/buy", {
      method: "POST",
      body: JSON.stringify({ access_feature: "speedbot", amount: 1 }),
    }));

    assert.deepEqual(reported, {
      code: "trade_outcome_uncertain",
      severity: "warning",
      feature: "speedbot",
      source: "transport",
      operation: "buy",
    });
  });

  it("attributes an explicit EDGE rejection separately from an uncertain acknowledgement", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        ok: false,
        message: "Deriv declined an order.",
        failed: [{ key: "abc", outcome: "rejected", source: "deriv", error: "Deriv declined an order." }],
      }),
      { status: 202, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

    await customFetch("/api/deriv/bulk-buy", {
      method: "POST",
      body: JSON.stringify({ access_feature: "edge", contracts: [] }),
    });

    assert.deepEqual(reported, {
      code: "api_server_error",
      severity: "error",
      feature: "edge",
      source: "deriv",
      operation: "bulk_buy",
    });
  });

  it("reports an API-confirmed not-sent trade failure as an app/API issue, not an uncertain trade", async () => {
    const events = new EventTarget();
    let reported: unknown;
    events.addEventListener("shadow-admin-diagnostic", (event) => {
      reported = (event as CustomEvent).detail;
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        error: "The Deriv connection is not ready.",
        diagnostic_source: "api_server",
        trade_outcome: "not_sent",
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

    await assert.rejects(customFetch("/api/deriv/bulk-buy", {
      method: "POST",
      body: JSON.stringify({ access_feature: "bulk-trader", contracts: [] }),
    }));

    assert.deepEqual(reported, {
      code: "api_server_error",
      severity: "error",
      feature: "bulk-trader",
      source: "api_server",
      operation: "bulk_buy",
    });
  });

  it("treats an interrupted Clock Work batch as uncertain and never replays it", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/clock-work/buy", {
        method: "POST",
        body: JSON.stringify({ contracts: [] }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiTransportError);
        assert.equal(error.tradeOutcomeUncertain, true);
        assert.match(error.message, /open/i);
        assert.match(error.message, /refresh order status before trying again/i);
        return true;
      },
    );
    assert.equal(calls, 1);
  });

  it("replaces Deriv's raw no-return response with clear no-contract copy", async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ message: "This contract offers no return." }),
      { status: 400, statusText: "Bad Request", headers: { "content-type": "application/json" } },
    )) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/buy", {
        method: "POST",
        body: JSON.stringify({ amount: 1, contract_type: "DIGITDIFF" }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Deriv did not offer this contract for the selected duration/i);
        assert.match(error.message, /No contract was accepted/i);
        assert.doesNotMatch(error.message, /HTTP 400|offers no return/i);
        return true;
      },
    );
  });
});