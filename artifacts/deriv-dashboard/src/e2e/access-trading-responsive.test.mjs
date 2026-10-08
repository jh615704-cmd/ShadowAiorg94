import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer as createNetServer } from "node:net";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const screenshotsDir = "/tmp/deriv-dashboard-e2e";
const accessKeyId = "11111111-1111-4111-8111-111111111111";
const account = {
  id: "VRTC12345",
  type: "demo",
  currency: "USD",
  balance: 1_000,
  status: "active",
};
const symbols = [
  "R_10", "R_25", "R_50", "R_75", "R_100",
  "JD10", "JD25", "JD50", "JD75", "JD100",
  "1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V",
];
const viewports = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1440, height: 900 },
];

let browser;
let viteServer;
let baseUrl;

before(async () => {
  await mkdir(screenshotsDir, { recursive: true });
  const port = await reservePort();
  delete process.env.REPL_ID;
  process.env.PORT = String(port);
  process.env.BASE_PATH = "/";
  process.env.NODE_ENV = "test";
  // This syntactically valid test-only public key provides ClerkProvider for AppShell.
  // The browser context aborts all external requests; it is not a real sign-in path.
  process.env.VITE_CLERK_PUBLISHABLE_KEY = "pk_test_dGVzdC5jbGVyay5hY2NvdW50cy5kZXYk";

  const { createServer } = await import("vite");
  viteServer = await createServer({
    configFile: path.join(dashboardRoot, "vite.config.ts"),
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  await viteServer.listen();
  baseUrl = `http://127.0.0.1:${port}`;

  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/repl/tools/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
}, { timeout: 60_000 });

after(async () => {
  await browser?.close();
  await viteServer?.close();
});

test("Auto Trader grants flow from admin key creation to the restricted or allowed page", async () => {
  const state = createState(adminSession());
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/admin`);
    try {
      await page.getByRole("heading", { name: "Create a new key" }).waitFor({ timeout: 10_000 });
    } catch (error) {
      await page.screenshot({ path: path.join(screenshotsDir, "admin-load-failure.png") });
      console.error("Admin fixture diagnostics", {
        url: page.url(),
        body: (await page.locator("body").innerText()).slice(0, 1800),
        apiCalls: state.apiCalls,
        unhandledApis: state.unhandledApis,
        pageErrors,
      });
      throw error;
    }

    const autoTraderOption = page.locator(".admin-feature-option").filter({ hasText: "Auto Trader" });
    await autoTraderOption.locator("input").check();
    assert.equal(await autoTraderOption.locator("input").isChecked(), true);

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await assertNoHorizontalOverflow(page, viewport, "admin feature picker");
      await assertWithinViewport(page, ".admin-feature-picker", viewport.width, "admin feature picker");
      await page.screenshot({ path: path.join(screenshotsDir, `admin-${viewport.name}.png`) });
    }

    await page.locator('input[placeholder="e.g. Alex — desktop"]').fill("Responsive test user");
    await page.getByRole("button", { name: "Generate user key" }).click();
    await page.getByText("fixture-access-key-for-tests", { exact: true }).waitFor({ timeout: 10_000 });
    assert.ok(state.createdKeyBody, "The admin form should submit a key-creation request.");
    assert.deepEqual(state.createdKeyBody.features, ["edge", "auto-trader"]);

    state.session = userSession(state.createdKeyBody.features);
    state.hasToken = true;
    await page.goto(`${baseUrl}/auto-trader`);
    await page.getByRole("heading", { name: "Auto Trader" }).waitFor();
    assert.equal(await page.getByTestId("status-auto-trader-restricted").count(), 0);
    assert.ok(state.apiCalls.some((call) => call.path === "/api/deriv/accounts"));

    const deniedState = createState(userSession(["settings"]));
    deniedState.hasToken = true;
    const denied = await createMockPage(deniedState, viewports[0]);
    try {
      await denied.page.goto(`${baseUrl}/auto-trader`);
      await denied.page.getByTestId("status-auto-trader-restricted").waitFor();
      await denied.page.waitForTimeout(300);
      const unauthorizedDataRequests = deniedState.apiCalls.filter((call) =>
      ["/api/deriv/accounts", "/api/deriv/status", "/api/deriv/history"].includes(call.path),
      );
      assert.deepEqual(unauthorizedDataRequests, [], "A denied feature must not load its Deriv account, status, or history data.");
      assert.deepEqual(deniedState.unhandledApis, []);
      assert.deepEqual(deniedState.tradeRequests, []);
      assert.deepEqual(denied.pageErrors, []);
    } finally {
      await denied.context.close();
    }

    assert.deepEqual(state.unhandledApis, [], `Unexpected API requests: ${JSON.stringify(state.unhandledApis)}`);
    assert.deepEqual(state.tradeRequests, [], "The access-flow test must never submit a trade.");
    assert.deepEqual(pageErrors, [], "The app should render without browser exceptions.");
  } finally {
    await context.close();
  }
});

test("Trade X and Auto Trader controls fit phone, tablet, and laptop viewports", async () => {
  const state = createState(userSession(["edge", "trade-x", "auto-trader"]));
  state.hasToken = true;
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/app`);
    const tradeXGrant = page.getByRole("checkbox", { name: "Toggle Trade X" });
    await tradeXGrant.waitFor();
    await page.locator(".xt-feature-card-trade-x .xt-switch").click();
    const tradeXPanel = page.getByTestId("trade-x-panel");
    const analysisSurface = page.getByTestId("trade-x-analysis-surface");
    await tradeXPanel.waitFor();
    await analysisSurface.waitFor();
    const sharedSurface = await analysisSurface.evaluate((element) => {
      const distribution = element.querySelector(".tx-distribution");
      const ranking = element.querySelector(".tx-safe-panel");
      return {
        distributionSharesParent: distribution?.parentElement === element,
        rankingSharesParent: ranking?.parentElement === element,
        distributionHasSeparateBorder: distribution
          ? getComputedStyle(distribution).borderTopWidth !== "0px"
          : true,
        distributionBackground: distribution ? getComputedStyle(distribution).backgroundColor : "",
        rankingBackground: ranking ? getComputedStyle(ranking).backgroundColor : "",
      };
    });
    assert.equal(sharedSurface.distributionSharesParent, true);
    assert.equal(sharedSurface.rankingSharesParent, true);
    assert.equal(sharedSurface.distributionHasSeparateBorder, false);
    assert.equal(sharedSurface.distributionBackground, "rgba(0, 0, 0, 0)");
    assert.equal(sharedSurface.rankingBackground, "rgba(0, 0, 0, 0)");

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await tradeXPanel.scrollIntoViewIfNeeded();
      await analysisSurface.scrollIntoViewIfNeeded();
      await assertNoHorizontalOverflow(page, viewport, "Trade X");
      await assertWithinViewport(page, '[data-testid="trade-x-panel"]', viewport.width, "Trade X panel");
      for (const selector of [
        '[data-testid="select-trade-x-symbol"]',
        '[data-testid="input-trade-x-stake"]',
        '[data-testid="button-trade-x-digit-4"]',
        '[data-testid="button-trade-x-duration-2"]',
        '[data-testid="button-place-trade-x"]',
      ]) {
        const control = page.locator(selector);
        await control.waitFor({ state: "visible" });
        await assertWithinViewport(page, selector, viewport.width, `Trade X control ${selector}`);
      }

      await page.locator('[data-testid="input-trade-x-stake"]').fill("2.50");
      await page.locator('[data-testid="button-trade-x-digit-4"]').click();
      await page.locator('[data-testid="button-trade-x-duration-2"]').click();
      await page.screenshot({ path: path.join(screenshotsDir, `trade-x-${viewport.name}.png`) });
    }

    await page.goto(`${baseUrl}/auto-trader`);
    await page.getByTestId("button-go-live").waitFor();
    await page.getByTestId("button-go-live").click();
    await page.locator(".at-market-list").waitFor();
    await page.waitForFunction(() => {
      const tradeButton = document.querySelector('[data-testid="button-trade-3x-R_10-0"]');
      return tradeButton instanceof HTMLButtonElement && !tradeButton.disabled;
    }, undefined, { timeout: 10_000 });

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.getByTestId("card-market-R_10").scrollIntoViewIfNeeded();
      await assertNoHorizontalOverflow(page, viewport, "Auto Trader");
      await assertWithinViewport(page, ".auto-trader-page", viewport.width, "Auto Trader content");
      const marketLayout = await page.locator(".at-market-grid").evaluateAll((grids) =>
        grids.map((grid) => {
          const cards = [...grid.querySelectorAll(".at-market-card")];
          const boxes = cards.map((card) => {
            const rect = card.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          });
          return { gridWidth: grid.getBoundingClientRect().width, boxes };
        }),
      );
      assert.equal(marketLayout.flatMap((grid) => grid.boxes).length, 15, "The complete 15-market list should render.");
      for (const grid of marketLayout) {
        for (let index = 0; index < grid.boxes.length; index += 1) {
          const card = grid.boxes[index];
          assert.ok(card.left >= -1 && card.right <= viewport.width + 1, `Market card escaped the ${viewport.name} viewport.`);
          assert.ok(card.right - card.left <= grid.gridWidth + 1, `Market card exceeds its column at ${viewport.name} width.`);
          if (index > 0) {
            assert.ok(card.top >= grid.boxes[index - 1].bottom - 1, `Markets should stay in one vertical column at ${viewport.name} width.`);
          }
        }
      }
      for (const selector of [
        '[data-testid="button-trade-3x-R_10-0"]',
        '[data-testid="button-trade-6x-R_10-0"]',
      ]) {
        const button = page.locator(selector);
        await button.waitFor({ state: "visible" });
        await assertWithinViewport(page, selector, viewport.width, `Auto Trader control ${selector}`);
      }
      await page.screenshot({ path: path.join(screenshotsDir, `auto-trader-${viewport.name}.png`) });
    }

    await page.getByTestId("button-filter-jump").click();
    assert.equal(await page.locator(".at-market-grid .at-market-card").count(), 5);
    await page.getByTestId("button-stop-scan").click();
    assert.equal(await page.getByTestId("button-go-live").isVisible(), true);

    assert.deepEqual(state.unhandledApis, [], `Unexpected API requests: ${JSON.stringify(state.unhandledApis)}`);
    assert.deepEqual(state.tradeRequests, [], "Responsive controls must be tested without submitting any trade.");
    assert.deepEqual(pageErrors, [], "The app should render without browser exceptions.");
  } finally {
    await context.close();
  }
});

function createState(session) {
  return {
    session,
    hasToken: false,
    apiCalls: [],
    unhandledApis: [],
    tradeRequests: [],
    createdKeyBody: null,
    statusVersion: 0,
  };
}

function adminSession() {
  return {
    key_id: accessKeyId,
    key_prefix: "fixture-admin",
    label: "Fixture admin",
    kind: "admin",
    is_admin: true,
    status: "active",
    max_devices: 0,
    features: ["admin", "edge", "trade-x", "auto-trader"],
    online: true,
    last_seen_at: null,
  };
}

function userSession(features) {
  return {
    key_id: accessKeyId,
    key_prefix: "fixture-user",
    label: "Fixture user",
    kind: "user",
    is_admin: false,
    status: "active",
    max_devices: 1,
    features,
    online: true,
    last_seen_at: null,
  };
}

async function createMockPage(state, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const pageErrors = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== baseUrl) {
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    await mockApiRequest(route, state, url.pathname, route.request().method());
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { context, page, pageErrors };
}

async function mockApiRequest(route, state, pathname, method) {
  state.apiCalls.push({ path: pathname, method });
  const request = route.request();

  if (pathname === "/api/access/session" && method === "GET") {
    await fulfillJson(route, state.session);
    return;
  }
  if (pathname === "/api/access/heartbeat" && method === "POST") {
    await fulfillJson(route, { success: true });
    return;
  }
  if (pathname === "/api/access/keys" && method === "GET") {
    await fulfillJson(route, []);
    return;
  }
  if (pathname === "/api/access/keys" && method === "POST") {
    state.createdKeyBody = request.postDataJSON();
    await fulfillJson(route, {
      key_id: "22222222-2222-4222-8222-222222222222",
      key_prefix: "fixture-user",
      access_key: "fixture-access-key-for-tests",
      label: state.createdKeyBody.label,
      kind: state.createdKeyBody.kind,
      is_admin: false,
      status: "active",
      max_devices: state.createdKeyBody.max_devices,
      features: state.createdKeyBody.features,
      online: false,
      last_seen_at: null,
      created_at: new Date().toISOString(),
    }, 201);
    return;
  }
  if (pathname === "/api/access/trading-protection" && method === "GET") {
    await fulfillJson(route, {
      weekdays_enabled: false,
      weekends_enabled: false,
      dual_weekends_weekdays_enabled: false,
    });
    return;
  }
  if (pathname === "/api/token/status" && method === "GET") {
    await fulfillJson(route, { has_token: state.hasToken, expires_at: null, last_verified_at: null });
    return;
  }
  if (pathname === "/api/deriv/accounts" && method === "GET") {
    await fulfillJson(route, [account]);
    return;
  }
  if (pathname === "/api/deriv/status" && method === "GET") {
    state.statusVersion += 1;
    await fulfillJson(route, makeDerivStatus(state.statusVersion));
    return;
  }
  if (pathname === "/api/deriv/history" && method === "GET") {
    await fulfillJson(route, []);
    return;
  }
  if (pathname === "/api/deriv/select-symbol" && method === "POST") {
    await fulfillJson(route, { symbol: request.postDataJSON().symbol });
    return;
  }
  if (/^\/api\/deriv\/(buy|bulk-buy|dual-buy|sell)(\/|$)/.test(pathname)) {
    state.tradeRequests.push({ path: pathname, method });
    await fulfillJson(route, { error: "Live trade endpoints are disabled in browser tests." }, 501);
    return;
  }
  if (pathname === "/api/healthz" && method === "GET") {
    await fulfillJson(route, { status: "ok" });
    return;
  }

  state.unhandledApis.push({ path: pathname, method });
  await fulfillJson(route, { error: "Unhandled fixture API request." }, 501);
}

function makeDerivStatus(version) {
  const signals = symbols.map((symbol, index) => {
    const digit = (version + index) % 10;
    return {
      symbol,
      quote: 100_000 + version + index,
      last_digit: digit,
      tick_sequence: version,
      recent_digits: [digit],
      sample_count: version,
      digit_even_percentage: 50,
      digit_odd_percentage: 50,
      rise_percentage: 52,
      fall_percentage: 48,
      digit_streaks: [],
      digit_outcomes: Array.from({ length: 10 }, (_, value) => ({
        digit: value,
        over_percentage: 50,
        under_percentage: 50,
      })),
    };
  });
  return {
    connected: true,
    authorized: true,
    account,
    active_contract_count: 0,
    open_contracts_ready: true,
    last_tick: { symbol: "R_75", quote: 100_000 + version, epoch: 1_700_000_000 + version },
    market_signals: signals,
  };
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function assertNoHorizontalOverflow(page, viewport, label) {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  assert.ok(
    metrics.documentWidth <= viewport.width + 1 && metrics.bodyWidth <= viewport.width + 1,
    `${label} overflows at ${viewport.name}: ${JSON.stringify(metrics)}`,
  );
}

async function assertWithinViewport(page, selector, viewportWidth, label) {
  const locator = page.locator(selector).first();
  const bounds = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width };
  });
  assert.ok(bounds.width > 0, `${label} should have a visible width.`);
  assert.ok(bounds.left >= -1 && bounds.right <= viewportWidth + 1, `${label} exceeds the viewport: ${JSON.stringify(bounds)}`);
}

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
