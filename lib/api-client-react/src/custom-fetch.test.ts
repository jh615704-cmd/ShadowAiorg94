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
        assert.match(error.message, /check Deriv history before retrying/i);
        return true;
      },
    );
  });

  it("hides upstream rate-limit and gateway wording from confirmed buy failures", async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: "HTTP 502 Bad Gateway: You have reached the rate limit for buy" }),
      { status: 502, statusText: "Bad Gateway", headers: { "content-type": "application/json" } },
    )) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/bulk-buy", { method: "POST", body: JSON.stringify({ count: 2 }) }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /could not be confirmed/i);
        assert.match(error.message, /check Deriv open contracts and account history/i);
        assert.doesNotMatch(error.message, /HTTP 502|Bad Gateway|rate limit for buy/i);
        return true;
      },
    );
  });

  it("shows safe copy for an explicit exhausted Deriv buy-rate-limit response", async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        code: "DERIV_BUY_RATE_LIMITED",
        error: "Deriv temporarily limited new buys. Some earlier batch contracts may already be open.",
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
        assert.match(error.message, /Refresh Deriv history before sending it again/i);
        assert.doesNotMatch(error.message, /^Failed to fetch$/);
        assert.ok(error.requestId);
        return true;
      },
    );

    assert.equal(calls, 1);
  });

  it("treats an interrupted Matches buy as an uncertain trade and never replays it", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    await assert.rejects(
      customFetch("/api/deriv/matches/buy", {
        method: "POST",
        body: JSON.stringify({ contracts: [] }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiTransportError);
        assert.equal(error.tradeOutcomeUncertain, true);
        assert.match(error.message, /contract may already be open/i);
        assert.match(error.message, /Refresh Deriv history before sending it again/i);
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
    });
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

    await customFetch("/api/deriv/matches/buy", {
      method: "POST",
      body: JSON.stringify({ contracts: [] }),
    });

    assert.deepEqual(reported, {
      code: "trade_outcome_uncertain",
      severity: "warning",
      feature: "matches-analysis",
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
        assert.match(error.message, /history before sending it again/i);
        return true;
      },
    );
    assert.equal(calls, 1);
  });

  it("replaces Deriv's raw no-return response with a safe, non-retry message", async () => {
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
        assert.match(error.message, /Deriv did not offer a return/i);
        assert.match(error.message, /no contract was placed/i);
        assert.match(error.message, /stopped without retrying/i);
        assert.doesNotMatch(error.message, /HTTP 400|offers no return/i);
        return true;
      },
    );
  });
});