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
  { name: "4K", width: 3840, height: 2160 },
];
const bulkViewports = [
  ...viewports,
  { name: "small-phone", width: 320, height: 740 },
];
const fixtureFeatureIds = [
  "edge",
  "digit-flip",
  "trade-x",
  "bulk-trader",
  "jackpot",
  "clock-work",
  "cash-grab",
  "money-bank",
  "auto-trader",
  "auto-trader-2",
  "settings",
];
const tradeXViewports = [
  ...viewports,
  { name: "small-phone", width: 320, height: 740 },
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
    cacheDir: path.join(dashboardRoot, "node_modules", ".vite-e2e"),
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

test("Auto Trader and Auto Trader 2.0 grants stay independent during key creation", async () => {
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

    const autoTraderOption = page.getByRole("checkbox", { name: /^Auto Trader Live market scanner/ });
    const autoTrader2Option = page.getByRole("checkbox", { name: /^Auto Trader 2\.0 Automated contract selection/ });
    await autoTrader2Option.check();
    assert.equal(await autoTrader2Option.isChecked(), true);
    assert.equal(await autoTraderOption.isChecked(), false, "Granting Auto Trader 2.0 must not also grant Auto Trader.");
    await autoTrader2Option.uncheck();
    await autoTraderOption.check();
    assert.equal(await autoTraderOption.isChecked(), true);
    assert.equal(await autoTrader2Option.isChecked(), false, "Granting Auto Trader must not also grant Auto Trader 2.0.");

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

    const tradingState = createState(userSession(state.createdKeyBody.features));
    tradingState.hasToken = true;
    const trading = await createMockPage(tradingState, viewports[0]);
    try {
      await trading.page.goto(`${baseUrl}/auto-trader`);
      await trading.page.getByRole("heading", { name: "Auto Trader" }).waitFor();
      assert.equal(await trading.page.getByTestId("status-auto-trader-restricted").count(), 0);
      assert.ok(tradingState.apiCalls.some((call) => call.path === "/api/deriv/accounts"));
    } finally {
      await trading.context.close();
    }

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

test("the workspace stays unlocked during a short departure and locks on return after 30 minutes", async () => {
  const state = createState(userSession(["settings"]));
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/`);
    await page.locator(".xt-feature-card-restricted").first().waitFor();

    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

    assert.equal(await page.getByRole("heading", { name: "Login to Shadow Ai" }).count(), 0, "A brief departure should not lock the workspace.");
    assert.equal(state.logoutCount, 0, "A brief departure should keep the access session active.");
    await page.evaluate(() => {
      localStorage.setItem("shadow-access-away-started", String(Date.now() - 30 * 60 * 1_000 - 1));
      window.dispatchEvent(new Event("pageshow"));
    });

    await page.getByRole("heading", { name: "Login to Shadow Ai" }).waitFor();
    await page.getByText(/Workspace locked because you were away for more than 30 minutes/).waitFor();
    assert.equal(state.logoutCount, 1, "Returning after more than 30 minutes away should end the active access session.");
    await page.reload();
    await page.getByRole("heading", { name: "Login to Shadow Ai" }).waitFor();
    assert.ok(state.sessionRevoked, "Returning to the app should not restore the previous session.");
    assert.deepEqual(pageErrors, [], "The away lock should not cause browser errors.");
    assert.deepEqual(state.unhandledApis, []);
  } finally {
    await context.close();
  }
});

test("the workspace does not lock just because the bot browser window loses focus", async () => {
  const state = createState(userSession(["settings"]));
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/`);
    await page.locator(".xt-feature-card-restricted").first().waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));

    assert.equal(await page.getByRole("heading", { name: "Login to Shadow Ai" }).count(), 0, "Losing focus for a short time should not lock the workspace.");
    assert.equal(state.logoutCount, 0, "A short focus change should not end the active access session.");
    assert.deepEqual(pageErrors, [], "A short focus change should not cause browser errors.");
  } finally {
    await context.close();
  }
});

test("the workspace locks after two hours without interaction while the page stays open", async () => {
  const state = createState(userSession(["settings"]));
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/`);
    await page.locator(".xt-feature-card-restricted").first().waitFor();
    await page.evaluate(() => {
      localStorage.setItem("shadow-access-session-active", "1");
      localStorage.setItem("shadow-access-last-activity", String(Date.now() - 2 * 60 * 60 * 1_000 - 1_000));
    });

    await page.getByRole("heading", { name: "Login to Shadow Ai" }).waitFor({ timeout: 5_000 });
    await page.getByText(/Workspace locked after 2 hours without activity/).waitFor();
    assert.equal(state.logoutCount, 1, "Two hours without interaction should end the active session.");
    assert.deepEqual(pageErrors, [], "The idle lock should not cause browser errors.");
    assert.deepEqual(state.unhandledApis, []);
  } finally {
    await context.close();
  }
});

test("real user interaction refreshes the inactivity timer", async () => {
  const state = createState(userSession(["settings"]));
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/`);
    await page.locator(".xt-feature-card-restricted").first().waitFor();
    const oldActivityAt = Date.now() - 60_000;
    await page.evaluate((timestamp) => {
      localStorage.setItem("shadow-access-session-active", "1");
      localStorage.setItem("shadow-access-last-activity", String(timestamp));
    }, oldActivityAt);
    await page.mouse.move(140, 120);

    const refreshedActivityAt = Number(await page.evaluate(() => localStorage.getItem("shadow-access-last-activity")));
    assert.ok(refreshedActivityAt > oldActivityAt, "Pointer activity should refresh the stored timestamp.");
    assert.equal(await page.getByRole("heading", { name: "Login to Shadow Ai" }).count(), 0);
    assert.deepEqual(pageErrors, [], "User activity should not cause browser errors.");
  } finally {
    await context.close();
  }
});

test("restricted homepage feature cards and switches glow red without enabling controls", async () => {
  const state = createState(userSession(["settings"]));
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/`);
    const restrictedSwitch = page.locator(".xt-feature-card-restricted .xt-switch").first();
    await restrictedSwitch.waitFor();
    await page.getByText(/Restricted — admin access only/).first().waitFor();

    const appearance = await restrictedSwitch.evaluate((switchLabel) => {
      const input = switchLabel.querySelector("input");
      const track = switchLabel.querySelector(":scope > span");
      const card = switchLabel.closest(".xt-feature-card-restricted");
      return {
        disabled: input?.disabled,
        cardShadow: card ? getComputedStyle(card).boxShadow : "",
        trackShadow: track ? getComputedStyle(track).boxShadow : "",
        trackBackground: track ? getComputedStyle(track).backgroundImage : "",
        thumbColor: track ? getComputedStyle(track, "::after").backgroundColor : "",
      };
    });

    assert.equal(appearance.disabled, true);
    assert.match(appearance.cardShadow, /255,\s*77,\s*93/, "The complete restricted feature card should have a red glow.");
    assert.match(appearance.trackShadow, /255,\s*64,\s*81/, "The switch track should have its own red glow.");
    assert.match(appearance.trackBackground, /linear-gradient/);
    assert.equal(appearance.thumbColor, "rgb(255, 115, 128)");

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await assertNoHorizontalOverflow(page, viewport, "restricted homepage feature cards");
    }
    assert.deepEqual(state.tradeRequests, [], "A restricted homepage control must not submit a trade.");
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("administrators do not see status labels or red card glows", async () => {
  const state = createState(adminSession());
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/admin`);
    await page.getByRole("heading", { name: "Create a new key" }).waitFor();
    const statusChanges = [
      ["Clock Work", "coming_soon"],
      ["Cash Grab", "under_construction"],
    ];
    for (const [featureName, mode] of statusChanges) {
      const row = page.locator(".admin-feature-control-row").filter({ hasText: featureName });
      await row.locator(".admin-feature-control-fields select").first().selectOption(mode);
      const saveResponse = page.waitForResponse((response) =>
        response.url().includes("/api/access/feature-settings") && response.request().method() === "PATCH",
      );
      await row.getByRole("button", { name: "Save" }).click();
      assert.equal((await saveResponse).ok(), true);
    }

    const settingsResponse = page.waitForResponse((response) =>
      response.url().includes("/api/access/feature-settings") && response.request().method() === "GET",
    );
    await page.goto(`${baseUrl}/app`);
    assert.equal((await settingsResponse).ok(), true);
    const expectedStatuses = [
      [".xt-feature-card-clock-work", "Coming soon"],
      [".xt-feature-card-cash-grab", "Under construction"],
    ];
    for (const [cardSelector, statusText] of expectedStatuses) {
      const card = page.locator(cardSelector);
      await card.waitFor({ state: "visible" });
      assert.equal(await card.locator(".xt-admin-feature-status").count(), 0);
      assert.equal(await card.getByText(statusText, { exact: true }).count(), 0);
      assert.equal(await card.evaluate((element) => element.classList.contains("xt-feature-card-restricted")), false);
      const cardShadow = await card.evaluate((element) => getComputedStyle(element).boxShadow);
      assert.doesNotMatch(cardShadow, /255,\s*77,\s*93/, "Admin feature cards must not glow red.");
    }
    assert.deepEqual(state.unhandledApis, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("global announcement reaches existing and new users, stays dismissed until republished", async () => {
  const adminState = createState(adminSession());
  const admin = await createMockPage(adminState, viewports[2]);
  let existingUser;
  let newUser;
  try {
    await admin.page.goto(`${baseUrl}/admin`);
    await admin.page.getByRole("heading", { name: "Create a new key" }).waitFor();
    const message = "Update complete. Our newest feature is now live — BFBX Premium AI.";
    const announcementToggle = admin.page.getByRole("checkbox", { name: /Show a global announcement/ });
    await announcementToggle.check({ force: true });
    assert.equal(await announcementToggle.isChecked(), true);
    assert.equal(
      await admin.page.locator(".admin-announcement-toggle").evaluate((element) => element.classList.contains("selected")),
      true,
      "The switch should visibly turn on when checked.",
    );
    await admin.page.getByRole("textbox", { name: "Global announcement" }).fill(message);
    const save = admin.page.locator(".admin-announcement-actions").getByRole("button", { name: "Save" });
    const firstSaveResponse = admin.page.waitForResponse((response) =>
      response.url().includes("/api/access/feature-settings") && response.request().method() === "PATCH",
    );
    await save.click();
    const firstBroadcast = await (await firstSaveResponse).json();
    assert.equal(firstBroadcast.global_announcement_enabled, true);
    assert.equal(firstBroadcast.global_announcement, message);
    assert.ok(firstBroadcast.global_announcement_revision, "Saving creates a distinct broadcast revision.");

    const adminAnnouncement = admin.page.getByTestId("global-announcement");
    await adminAnnouncement.waitFor();
    assert.match(await adminAnnouncement.innerText(), /Update complete\.\s+Our newest feature is now live/);

    const existingUserState = createState(userSession(["edge"]));
    existingUserState.featureSettings = adminState.featureSettings;
    existingUser = await createMockPage(existingUserState, viewports[2]);
    await existingUser.page.goto(`${baseUrl}/app`);
    const announcement = existingUser.page.getByTestId("global-announcement");
    await announcement.waitFor();
    assert.match(await announcement.innerText(), /Update complete\.\s+Our newest feature is now live/);
    assert.equal(await announcement.evaluate((element) => element.classList.contains("is-inline")), false);
    const announcementBounds = await announcement.boundingBox();
    const strategiesBounds = await existingUser.page.locator(".xt-trading-strategies-heading").boundingBox();
    assert.ok(announcementBounds && strategiesBounds);
    assert.ok(announcementBounds.y < strategiesBounds.y, "The full-width announcement must appear above Trading Strategies.");
    const appearance = await announcement.evaluate((element) => ({
      background: getComputedStyle(element).backgroundImage,
      color: getComputedStyle(element.querySelector(".global-announcement-copy")).color,
      closeButtonBounds: element.querySelector('[aria-label="Dismiss announcement"]')?.getBoundingClientRect().toJSON(),
      width: element.getBoundingClientRect().width,
    }));
    assert.match(appearance.background, /linear-gradient/);
    assert.equal(appearance.color, "rgb(216, 255, 231)");
    assert.ok(appearance.closeButtonBounds);
    assert.ok(appearance.closeButtonBounds.x > announcementBounds.x + announcementBounds.width * 0.9, "The X should stay at the far right of the banner.");

    await existingUser.page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(existingUser.page, viewports[0], "global announcement");
    await announcement.getByRole("button", { name: "Dismiss announcement" }).click();
    await announcement.waitFor({ state: "detached" });

    const dismissalKey = await existingUser.page.evaluate(() => Object.keys(localStorage).find((key) =>
      key.startsWith("shadow-ai:announcement:v2:") && localStorage.getItem(key) === "dismissed",
    ) ?? null);
    assert.ok(dismissalKey, "Dismissing the announcement should save its viewer-specific state.");
    await existingUser.page.reload();
    await existingUser.page.getByTestId("global-announcement-frame").waitFor({ state: "attached" });
    await existingUser.page.waitForFunction(() => !document.querySelector('[data-testid="global-announcement"]'));
    assert.equal(await existingUser.page.evaluate((key) => localStorage.getItem(key), dismissalKey), "dismissed");

    const secondSaveResponse = admin.page.waitForResponse((response) =>
      response.url().includes("/api/access/feature-settings") && response.request().method() === "PATCH",
    );
    await save.waitFor({ state: "visible" });
    assert.equal(await save.isEnabled(), true, "An unchanged active announcement can be broadcast again.");
    await save.click();
    const secondBroadcast = await (await secondSaveResponse).json();
    assert.notEqual(secondBroadcast.global_announcement_revision, firstBroadcast.global_announcement_revision);
    await announcement.waitFor({ timeout: 8_000 });

    const newUserState = createState({
      ...userSession(["edge"]),
      key_id: "33333333-3333-4333-8333-333333333333",
    });
    newUserState.featureSettings = adminState.featureSettings;
    newUser = await createMockPage(newUserState, viewports[2]);
    await newUser.page.goto(`${baseUrl}/app`);
    await newUser.page.getByTestId("global-announcement").waitFor();
    assert.deepEqual(adminState.unhandledApis, []);
    assert.deepEqual(existingUserState.unhandledApis, []);
    assert.deepEqual(newUserState.unhandledApis, []);
    assert.deepEqual(admin.pageErrors, []);
    assert.deepEqual(existingUser.pageErrors, []);
    assert.deepEqual(newUser.pageErrors, []);
  } finally {
    await Promise.all([admin.context.close(), existingUser?.context.close(), newUser?.context.close()]);
  }
});

test("DigitFlip history stays visible after switching the feature off", async () => {
  const state = createState(userSession(["digit-flip"]));
  state.hasToken = true;
  // Supply a qualified candidate: DigitFlip requires 100 samples and an
  // adjusted parity rate above its 55% evidence floor.
  state.statusVersion = 120;
  state.marketSignalOverrides = {
    R_10: { digit_even_percentage: 70, digit_odd_percentage: 30 },
  };
  state.allowFixtureTrades = true;
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/app`);
    const digitFlipToggle = page.getByRole("checkbox", { name: "Toggle DigitFlip" });
    const digitFlipSwitch = page.locator(".xt-feature-card-digit-flip .xt-switch");
    await digitFlipToggle.waitFor();
    await digitFlipSwitch.click();
    await page.getByTestId("digit-flip-panel").waitFor();
    await page.getByRole("button", { name: "AI Scanner" }).click();

    const history = page.locator(".digit-flip-history");
    await history.locator(".deriv-history-row").waitFor({ timeout: 10_000 });
    assert.match(await history.innerText(), /US\$0\.50/);

    await digitFlipSwitch.click();
    await page.getByTestId("digit-flip-panel").waitFor({ state: "hidden" });
    await history.locator(".deriv-history-row").waitFor();
    await assertWithinViewport(page, ".digit-flip-history", viewports[0].width, "DigitFlip history");
    assert.deepEqual(state.tradeRequests.map(({ path }) => path), ["/api/deriv/buy"]);
    assert.deepEqual(state.unhandledApis, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("Jackpot uses complete dual pairs, labels its run history, and excludes other features", async () => {
  const state = createState(userSession(["jackpot", "clock-work"]));
  state.hasToken = true;
  state.allowFixtureTrades = true;
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/app`);
    await page.getByRole("heading", { name: "Trading Strategies" }).waitFor();
    const jackpotCard = page.locator("#jackpot-feature");
    const clockWorkCard = page.locator("#clock-work-feature");
    assert.ok(
      (await jackpotCard.boundingBox()).y < (await clockWorkCard.boundingBox()).y,
      "Jackpot should appear above Clock Work.",
    );
    await jackpotCard.getByText("Jackpot Analysis", { exact: true }).waitFor();

    const jackpotToggle = page.getByRole("checkbox", { name: "Toggle Jackpot" });
    await jackpotToggle.check();
    const panel = page.getByTestId("jackpot-panel");
    await panel.waitFor({ state: "visible" });
    assert.equal(await panel.getByTestId("button-jackpot-pairs-1").getAttribute("aria-pressed"), "true");
    await panel.getByTestId("button-jackpot-place-batch").click();
    const history = panel.locator(".jackpot-history");
    await history.locator(".deriv-history-row").nth(1).waitFor({ timeout: 10_000 });
    assert.equal(await history.locator(".deriv-history-row").count(), 2);
    assert.equal(await history.getByText("CURRENT RUN", { exact: true }).count(), 2);
    assert.equal(await history.locator(".deriv-history-win-sample").count(), 0);
    assert.doesNotMatch(await history.innerText(), /n=0 settled/);
    assert.deepEqual(state.tradeRequests.map(({ path }) => path), ["/api/deriv/jackpot/buy"]);
    assert.deepEqual(state.tradeRequests[0].body, {
      access_feature: "jackpot",
      amount: 0.5,
      duration: 1,
      duration_unit: "t",
      symbol: "R_75",
      rise_fall_type: "CALL",
      parity_type: "DIGITEVEN",
      pair_count: 1,
    });

    const clockWorkToggle = page.getByRole("checkbox", { name: "Toggle Clock Work" });
    await clockWorkToggle.check();
    assert.equal(await jackpotToggle.isChecked(), false);
    assert.equal(await clockWorkToggle.isChecked(), true);
    await panel.waitFor({ state: "hidden" });
    await page.getByTestId("clock-work-panel").waitFor({ state: "visible" });
    assert.deepEqual(state.unhandledApis, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("all active trading panels fit phone, tablet, laptop, and 4K widths", async () => {
  const state = createState(userSession([
    "edge",
    "digit-flip",
    "trade-x",
    "bulk-trader",
    "jackpot",
    "cash-grab",
    "clock-work",
    "money-bank",
    "auto-trader",
    "auto-trader-2",
  ]));
  state.hasToken = true;
  state.marketSignalOverrides = {
    R_10: {
      recent_quotes: clockWorkQuotesForOutcomes(Array.from({ length: 20 }, () => true)),
      tick_epoch: Math.floor(Date.now() / 1_000),
    },
    R_75: {
      recent_quotes: clockWorkQuotesForOutcomes([
        ...Array.from({ length: 38 }, () => true),
        false,
      ]),
      tick_epoch: Math.floor(Date.now() / 1_000),
    },
  };
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  const screens = [
    { feature: "edge", card: "edge", selector: ".edge-reference-layout", label: "EDGE" },
    { feature: "digit-flip", card: "digit-flip", selector: '[data-testid="digit-flip-panel"]', label: "DigitFlip" },
    { feature: "trade-x", card: "trade-x", selector: '[data-testid="trade-x-panel"]', label: "Trade X" },
    { feature: "bulk-trader", card: "bulk", selector: '[data-testid="panel-bulk-trader"]', label: "Bulk Trader" },
    { feature: "jackpot", card: "jackpot", selector: '[data-testid="jackpot-panel"]', label: "Jackpot" },
    { feature: "cash-grab", card: "cash-grab", selector: '[data-testid="cash-grab-panel"]', label: "Cash Grab" },
    { feature: "clock-work", card: "clock-work", selector: '[data-testid="clock-work-panel"]', label: "Clock Work" },
    { feature: "money-bank", card: "edge2", selector: ".money-bank-panel", label: "Money Bank" },
  ];
  try {
    await page.goto(`${baseUrl}/app`);
    await page.getByRole("heading", { name: "Trading Strategies" }).waitFor();

    for (const screen of screens) {
      const control = page.locator(`.xt-feature-card-${screen.card} .xt-switch input`);
      await control.check();
      assert.equal(await control.isChecked(), true, `${screen.label} should be enabled in the mock session.`);
      const panel = page.locator(screen.selector);
      await panel.waitFor({ state: "visible" });
      if (screen.feature === "clock-work") {
        assert.equal(await panel.locator('input[type="number"]').count(), 4, "Clock Work should have stake, loss multiplier, and two session-limit inputs.");
        assert.equal(await panel.getByTestId("button-clock-start").count(), 1);
        assert.equal(await panel.getByTestId("switch-ai-clock").isChecked(), false);
        assert.equal(await panel.getByTestId("button-clock-start").isDisabled(), false);

        const marketSelect = panel.getByTestId("select-clock-market");
        assert.equal(await marketSelect.locator("option").first().textContent(), "Auto best market");
        await marketSelect.selectOption("R_10");
        const freshMarketEpoch = Math.floor(Date.now() / 1_000);
        state.marketSignalOverrides.R_10.tick_epoch = freshMarketEpoch;
        state.marketSignalOverrides.R_75.tick_epoch = freshMarketEpoch;
        await page.waitForTimeout(600);
        const autoBestValue = await marketSelect.locator("option").first().getAttribute("value");
        assert.ok(autoBestValue);
        await marketSelect.selectOption(autoBestValue);
        await panel.getByTestId("clock-ai-status").getByText(/Auto Best selected Volatility 75 Index\. Waiting for a live quote\./).waitFor();
        await panel.getByTestId("clock-work-auto-best-market").getByText(/Volatility 75 Index/).waitFor();
        assert.equal(await marketSelect.inputValue(), "R_75", "Auto best should select the market with the stronger sample-adjusted results.");

        assert.equal(await panel.getByTestId("clock-work-fixed-duration").getByText("5 ticks", { exact: true }).count(), 1);
        assert.equal(await panel.getByTestId("select-clock-duration").count(), 0, "Clock Work should not expose other contract durations.");

        const threshold = panel.getByTestId("select-ai-clock-rate");
        assert.equal(await threshold.inputValue(), "50");
        assert.deepEqual(await threshold.locator("option").allTextContents(), ["50%", "55%", "65%", "70%"]);
        for (const rate of ["50", "55", "65", "70"]) {
          await threshold.selectOption(rate);
          assert.equal(await threshold.inputValue(), rate);
        }
        const takeProfit = panel.getByTestId("input-clock-take-profit");
        const lossLimit = panel.getByTestId("input-clock-loss-limit");
        assert.equal(await takeProfit.inputValue(), "0");
        assert.equal(await lossLimit.inputValue(), "10");
        assert.equal(
          await panel.getByTestId("clock-work-loss-warning").innerText(),
          "4 consecutive full-stake losses could reach the $10.00 session loss limit.",
        );
        await takeProfit.fill("5");
        await lossLimit.fill("2");
        assert.equal(await takeProfit.inputValue(), "5");
        assert.equal(await lossLimit.inputValue(), "2");
        const lossMultiplier = panel.getByTestId("input-clock-loss-multiplier");
        assert.equal(await lossMultiplier.inputValue(), "2");
        await lossMultiplier.fill("1.75");
        assert.equal(await lossMultiplier.inputValue(), "1.75");
        assert.equal(await panel.getByTestId("clock-run-pnl").count(), 0, "Clock Work should not show a separate settled run P/L.");
        assert.equal(
          await page.locator('[aria-label="Clock Work History Deriv history"].digit-flip-history').count(),
          1,
          "Clock Work history should use the same presentation as DigitFlip.",
        );

        const visibleClockWorkText = await panel.evaluate((element) => {
          const clone = element.cloneNode(true);
          clone.querySelector(".cw-ai-threshold")?.remove();
          clone.querySelector(".cw-ai-status")?.remove();
          return clone.textContent ?? "";
        });
        assert.doesNotMatch(
          visibleClockWorkText,
          /price chart|recent moves|observed lean|higher barrier|lower barrier|half barrier|aggressive auto trading|higher and lower|dual|\d+(?:\.\d+)?%|chooses the direction and barrier|one ai-selected/i,
        );
        assert.equal(await panel.getByText("WIN RATE", { exact: true }).count(), 0, "Clock Work controls should not show a win-rate percentage.");

        const aiSwitch = panel.getByTestId("switch-ai-clock");
        const startButton = panel.getByTestId("button-clock-start");
        assert.equal(await aiSwitch.isChecked(), false);
        assert.equal(await startButton.isDisabled(), false);
        await startButton.click();
        const stopButton = panel.getByTestId("button-clock-stop");
        await stopButton.waitFor({ state: "visible" });
        assert.equal(await aiSwitch.isChecked(), false, "Start should work while the Ai Clock switch remains off.");
        assert.equal(await takeProfit.isDisabled(), true);
        assert.equal(await lossLimit.isDisabled(), true);
        await stopButton.click();
        await panel.getByTestId("button-clock-start").waitFor({ state: "visible" });
        assert.equal(await takeProfit.isDisabled(), false);
        assert.equal(await lossLimit.isDisabled(), false);
      }
      if (screen.feature === "cash-grab") {
        const marketTrigger = panel.getByRole("button", { name: "Select Cash Grab market" });
        await marketTrigger.click();
        const autoBestOption = panel.locator(".df-market-option.df-market-smart");
        await autoBestOption.waitFor({ state: "visible" });
        assert.equal(await autoBestOption.isDisabled(), false, "Auto Best should remain selectable before a best market sample is available.");
        await autoBestOption.click();
        assert.match(await panel.locator(".df-market-copy small").innerText(), /ACTIVE MARKET · AUTO BEST/);
      }
      for (const viewport of bulkViewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await assertNoHorizontalOverflow(page, viewport, screen.label);
        await assertWithinViewport(page, screen.selector, viewport.width, screen.label);
      }
      await page.setViewportSize({ width: viewports[0].width, height: viewports[0].height });
    }

    for (const screen of [
      { name: "Auto Trader", path: "/auto-trader" },
      { name: "Auto Trader 2.0", path: "/auto-trader-2" },
    ]) {
      await page.goto(`${baseUrl}${screen.path}`);
      const heading = page.locator("h1");
      await heading.waitFor({ state: "visible" });
      assert.equal((await heading.innerText()).trim(), screen.name);
      for (const viewport of bulkViewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await assertNoHorizontalOverflow(page, viewport, screen.name);
      }
      await page.setViewportSize({ width: viewports[0].width, height: viewports[0].height });
    }

    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("retired Matches Analysis is not shown or available to trade", async () => {
  const state = createState(userSession(["matches-analysis"]));
  state.hasToken = true;
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/app`);
    assert.equal(await page.locator(".xt-feature-card-matches").count(), 0);
    assert.equal(await page.getByRole("checkbox", { name: "Toggle Matches Analysis" }).count(), 0);
    assert.equal(state.tradeRequests.some(({ path }) => path === "/api/deriv/matches/buy"), false);
    assert.deepEqual(state.unhandledApis, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("clearing Auto Trader 2.0 resets run metrics and stake without deleting Deriv history", async () => {
  const state = createState(userSession(["auto-trader-2"]));
  state.hasToken = true;
  state.history = [
    {
      account_id: account.id,
      contract_id: "at2-win",
      contract_type: "DIGITDIFF",
      symbol: "R_10",
      account_type: "demo",
      currency: "USD",
      barrier: 2,
      buy_price: 2,
      current_value: 3.5,
      payout: 3.5,
      profit: 1.5,
      status: "won",
      buy_time: 1_700_000_002,
      sell_time: 1_700_000_003,
    },
    {
      account_id: account.id,
      contract_id: "at2-loss",
      contract_type: "CALL",
      symbol: "R_10",
      account_type: "demo",
      currency: "USD",
      barrier: null,
      buy_price: 2,
      current_value: 0.75,
      payout: 3.5,
      profit: -1.25,
      status: "lost",
      buy_time: 1_700_000_000,
      sell_time: 1_700_000_001,
    },
  ];
  const savedSession = {
    version: 2,
    accountId: account.id,
    phase: "ready",
    config: {
      family: "differs",
      contractType: "DIGITDIFF",
      barrier: 2,
      stake: 2.5,
      duration: 1,
      takeProfit: 10,
      lossLimit: 10,
      stakeMode: "multiply",
      multiplier: 2,
      aiEnabled: true,
      autoSelect: true,
      selectedMarket: "R_10",
    },
    contractIds: ["at2-win", "at2-loss"],
    sessionPnl: 0.25,
    currentStake: 5.5,
    recoveryTargetPnl: 0.5,
    lossStreaks: { CALL: 3 },
    pausedContractTypes: ["CALL"],
    pendingContractId: null,
    pendingContractType: null,
    pendingStake: null,
    updatedAt: 1_700_000_004,
  };
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.addInitScript(({ historyKey, sessionKey, historyLinks, session }) => {
      localStorage.setItem(historyKey, JSON.stringify(historyLinks));
      localStorage.setItem(sessionKey, JSON.stringify(session));
    }, {
      historyKey: `deriv-auto-trader-2-contracts:${account.id}`,
      sessionKey: `deriv-auto-trader-2-session:${account.id}`,
      historyLinks: ["at2-win", "at2-loss"].map((id, index) => ({ id, placedAt: 1_700_000_000 + index })),
      session: savedSession,
    });
    await page.goto(`${baseUrl}/auto-trader-2`);
    await page.getByTestId("auto-trader-2-panel").waitFor();
    const summary = page.locator(".deriv-history-session");
    await summary.getByText("50.0%", { exact: true }).waitFor();
    assert.match(await summary.innerText(), /n=2 settled/);
    assert.match(await summary.innerText(), /0\.25/);
    assert.match(await summary.innerText(), /TRADES\s+2/);
    assert.match(await summary.innerText(), /WON \/ LOST\s+1\s*\/\s*1/);
    assert.match(await summary.innerText(), /STAKED\s+US\$4\.00/, "Staked must total the two recorded $2 contracts, not the next stake.");
    assert.equal(await page.getByText("NET P/L", { exact: true }).count(), 2);
    assert.equal(await page.getByText("+US$1.50", { exact: true }).count(), 1);
    assert.equal(await page.getByText("-US$1.25", { exact: true }).count(), 1);
    assert.equal(await page.getByText("AMOUNT RETURNED", { exact: true }).count(), 2);

    await page.evaluate(() => window.__dispatchDerivEvent("history-snapshot", []));
    await page.waitForTimeout(4_200);
    assert.equal(await page.locator(".deriv-history-row").count(), 2, "A later account-history snapshot must not blank this feature's saved rows.");
    const persistentSummary = await summary.innerText();
    assert.match(persistentSummary, /0\.25/);
    assert.match(persistentSummary, /TRADES\s+2/);

    await page.getByRole("button", { name: "Clear Auto Trader 2.0 History session" }).click();
    assert.equal(await page.getByTestId("at2-message").count(), 0, "The clear confirmation should stay on the button, not create a blocking banner.");
    await page.getByRole("button", { name: "Tap again to clear Auto Trader 2.0 History session" }).click();
    await page.waitForFunction(() => /\bTRADES\s+0\b/.test(document.querySelector(".deriv-history-session")?.innerText ?? ""));
    assert.equal(await page.getByTestId("at2-message").count(), 0, "A completed clear should not require dismissing a status banner.");
    assert.equal(await page.getByText(/Session cleared · the next run starts at the configured stake/).count(), 0);

    const clearedSummary = await summary.innerText();
    assert.match(clearedSummary, /TRADES\s+0/);
    assert.match(clearedSummary, /WON \/ LOST\s+0\s+\/\s+0/);
    assert.match(clearedSummary, /WIN RATE\s+0\.0%/);
    assert.match(clearedSummary, /US\$0\.00/);
    assert.match(clearedSummary, /STAKED\s+US\$0\.00/);
    assert.match(await page.locator(".at2-stake-plan .at2-field-note").innerText(), /USD 2\.50/);
    assert.equal(await page.locator(".deriv-history-row").count(), 0);
    assert.equal(state.history.length, 2, "The local clear must leave Deriv's returned account history unchanged.");
    assert.deepEqual(await page.evaluate(() => ({
      history: localStorage.getItem("deriv-auto-trader-2-contracts:VRTC12345"),
      session: localStorage.getItem("deriv-auto-trader-2-session:VRTC12345"),
    })), { history: null, session: null });
    assert.deepEqual(state.tradeRequests, [], "Clearing run history must never submit a trade.");
    assert.deepEqual(state.unhandledApis, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("Auto Trader 2.0 Auto is exclusive of the manual Rise/Fall and Even/Odd sides", async () => {
  const state = createState(userSession(["auto-trader-2"]));
  state.hasToken = true;
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/auto-trader-2`);
    await page.getByTestId("auto-trader-2-panel").waitFor();

    await page.getByTestId("at2-contract-rise-fall").click();
    await page.getByTestId("at2-contract-type-auto").click();
    assert.equal(await page.getByTestId("at2-contract-type-auto").getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByTestId("at2-contract-type-call").getAttribute("aria-pressed"), "false");
    assert.equal(await page.getByTestId("at2-contract-type-put").getAttribute("aria-pressed"), "false");

    await page.getByTestId("at2-contract-even-odd").click();
    assert.equal(await page.getByTestId("at2-contract-type-auto").getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByTestId("at2-contract-type-digiteven").getAttribute("aria-pressed"), "false");
    assert.equal(await page.getByTestId("at2-contract-type-digitodd").getAttribute("aria-pressed"), "false");
    await page.getByText("Auto chooses the side with the higher observed win rate for this duration.").waitFor();

    assert.deepEqual(state.tradeRequests, [], "Changing selection must not place a trade.");
    assert.deepEqual(state.unhandledApis, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("Auto Trader Stop returns to Start when no order is pending", async () => {
  const state = createState(userSession(["auto-trader-2"]));
  state.hasToken = true;
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/auto-trader-2`);
    await page.getByTestId("auto-trader-2-panel").waitFor();
    await page.getByTestId("at2-ai-enabled").check();
    await page.getByTestId("at2-start").click();
    await page.getByTestId("at2-stop").waitFor();
    await page.getByTestId("at2-stop").click();

    const startButton = page.getByTestId("at2-start");
    await startButton.waitFor();
    await page.waitForFunction((key) => {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored).phase === "completed" : false;
    }, `deriv-auto-trader-2-session:${account.id}`);
    assert.equal((await startButton.innerText()).trim(), "START AUTO TRADER 2.0");
    assert.equal(await startButton.isEnabled(), true, "A cleanly stopped session should allow a new run.");
    assert.equal(await page.getByTestId("at2-verify-resume").count(), 0, "A normal Stop must not show Verify & Resume.");
    assert.deepEqual(state.tradeRequests, [], "Stopping while AI 2 is waiting must not place a contract.");
    assert.deepEqual(state.unhandledApis, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("stopped Auto Trader 2.0 uses Start while a contract settles, then allows verified history clearing", async () => {
  const state = createState(userSession(["auto-trader-2"]));
  state.hasToken = true;
  state.activeContractCount = 1;
  const contractId = "at2-stopped-open";
  state.history = [{
    account_id: account.id,
    contract_id: contractId,
    contract_type: "DIGITDIFF",
    symbol: "R_10",
    account_type: "demo",
    currency: "USD",
    barrier: 2,
    buy_price: 2,
    current_value: 1,
    payout: 3.5,
    profit: 0,
    status: "open",
    buy_time: 1_700_000_000,
    sell_time: null,
  }];
  const savedSession = {
    version: 3,
    accountId: account.id,
    phase: "awaiting-settlement",
    config: {
      family: "differs",
      contractType: "DIGITDIFF",
      barrier: 2,
      stake: 2,
      duration: 1,
      takeProfit: 10,
      lossLimit: 100,
      stakeMode: "flat",
      multiplier: 2,
      aiEnabled: true,
      autoSelect: false,
      selectedMarket: "R_10",
    },
    contractIds: [contractId],
    sessionPnl: 0,
    currentStake: 2,
    recoveryTargetPnl: null,
    lossStreaks: {},
    pausedContractTypes: [],
    forcedNextType: null,
    pendingContractId: contractId,
    pendingContractType: "DIGITDIFF",
    pendingStake: 2,
    updatedAt: 1_700_000_001,
  };
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.addInitScript(({ historyKey, sessionKey, historyLinks, session }) => {
      localStorage.setItem(historyKey, JSON.stringify(historyLinks));
      localStorage.setItem(sessionKey, JSON.stringify(session));
    }, {
      historyKey: `deriv-auto-trader-2-contracts:${account.id}`,
      sessionKey: `deriv-auto-trader-2-session:${account.id}`,
      historyLinks: [{ id: contractId, placedAt: 1_700_000_000 }],
      session: savedSession,
    });
    await page.goto(`${baseUrl}/auto-trader-2`);
    await page.getByTestId("auto-trader-2-panel").waitFor();
    await page.getByText("STOPPED · CONTRACT SETTLING").waitFor();

    const startButton = page.getByTestId("at2-start");
    assert.equal((await startButton.innerText()).trim(), "START AUTO TRADER 2.0");
    assert.equal(await startButton.isEnabled(), false, "An accepted open contract must settle before another run.");
    assert.equal(await page.getByTestId("at2-verify-resume").count(), 0);
    assert.equal(await page.getByTestId("at2-discard-session").count(), 0);

    const clearButton = page.getByRole("button", { name: "Clear Auto Trader 2.0 History session" });
    await clearButton.click();
    await page.getByRole("button", { name: "Tap again to clear Auto Trader 2.0 History session" }).click();
    await page.getByText(/only after Deriv confirms this account is connected and has no open contract/).waitFor();
    assert.ok(await page.evaluate((key) => localStorage.getItem(key), `deriv-auto-trader-2-session:${account.id}`));

    state.activeContractCount = 0;
    state.history = [{ ...state.history[0], current_value: 3.5, profit: 1.5, status: "won", sell_time: 1_700_000_001 }];
    await clearButton.click();
    await page.getByRole("button", { name: "Tap again to clear Auto Trader 2.0 History session" }).click();
    await page.waitForFunction(() => /\bTRADES\s+0\b/.test(document.querySelector(".deriv-history-session")?.innerText ?? ""));
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), `deriv-auto-trader-2-session:${account.id}`), null);
    assert.equal(await startButton.isEnabled(), true, "A verified, settled session can be cleared before a new run.");
    assert.equal(await page.getByTestId("at2-verify-resume").count(), 0);
    assert.equal(state.history.length, 1, "Clearing local rows must preserve Deriv's authoritative history.");
    assert.deepEqual(state.tradeRequests, []);
    assert.deepEqual(state.unhandledApis, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("Auto Trader shows daily stats and detailed deep-blue trading history", async () => {
  const state = createState(userSession(["auto-trader"]));
  state.hasToken = true;
  const placedAt = Date.now();
  const buyTime = Math.floor(placedAt / 1000);
  state.history = [
    {
      account_id: account.id,
      contract_id: "legacy-win",
      contract_type: "DIGITDIFF",
      symbol: "R_10",
      account_type: "demo",
      currency: "USD",
      barrier: 4,
      buy_price: 1,
      current_value: 1.06,
      payout: 1.06,
      profit: 0.06,
      status: "won",
      buy_time: buyTime,
      sell_time: buyTime + 1,
    },
    {
      account_id: account.id,
      contract_id: "legacy-loss",
      contract_type: "DIGITDIFF",
      symbol: "R_10",
      account_type: "demo",
      currency: "USD",
      barrier: 4,
      buy_price: 1,
      current_value: 0,
      payout: 0,
      profit: -1,
      status: "lost",
      buy_time: buyTime,
      sell_time: buyTime + 1,
    },
  ];
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.addInitScript(({ historyKey, contracts }) => {
      localStorage.setItem(historyKey, JSON.stringify(contracts));
    }, {
      historyKey: `deriv-auto-trader-contracts:${account.id}`,
      contracts: [
        { id: "legacy-win", placedAt, batchId: "legacy-batch", batchIndex: 1, batchCount: 2 },
        { id: "legacy-loss", placedAt, batchId: "legacy-batch", batchIndex: 2, batchCount: 2 },
      ],
    });
    await page.goto(`${baseUrl}/auto-trader`);
    await page.getByTestId("panel-daily-statistics").waitFor();
    await page.getByTestId("row-trade-legacy-win").waitFor();

    assert.match(await page.getByTestId("stat-daily-balance").innerText(), /\$1,000\.00/);
    assert.match(await page.getByTestId("stat-daily-pnl").innerText(), /0\.94/);
    assert.match(await page.getByTestId("stat-daily-trades").innerText(), /2/);
    assert.match(await page.getByTestId("stat-daily-wins").innerText(), /1/);
    assert.match(await page.getByTestId("stat-daily-losses").innerText(), /1/);
    assert.match(await page.getByTestId("stat-daily-win-rate").innerText(), /50\.0%/);
    assert.match(await page.getByTestId("stat-daily-win-sample").innerText(), /n=2 settled/);
    assert.equal(await page.getByText("Multi Differ (1/2)", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Multi Differ (2/2)", { exact: true }).count(), 1);
    assert.equal(await page.getByText("DIFFERS 4 on V10", { exact: true }).count(), 2);
    const backgrounds = await page.locator(".at-daily-panel, .at-history-row").evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).backgroundImage),
    );
    assert.ok(backgrounds.every((background) => background.includes("linear-gradient")));

    await page.getByTestId("button-settings").click();
    const [settingsBounds, statsBounds, historyBounds] = await Promise.all([
      page.getByTestId("panel-settings").boundingBox(),
      page.getByTestId("panel-daily-statistics").boundingBox(),
      page.locator(".at-history-panel").boundingBox(),
    ]);
    assert.ok(settingsBounds && statsBounds && historyBounds);
    assert.ok(settingsBounds.y < statsBounds.y && statsBounds.y < historyBounds.y);
    assert.deepEqual(state.tradeRequests, []);
    assert.deepEqual(state.unhandledApis, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("Auto Trader reflects Deriv tick and settlement events without polling delays", async () => {
  const state = createState(userSession(["auto-trader"]));
  state.hasToken = true;
  const buyTime = Math.floor(Date.now() / 1000);
  state.history = [{
    account_id: account.id,
    contract_id: "auto-trader-live-settlement",
    contract_type: "DIGITDIFF",
    symbol: "R_10",
    account_type: "demo",
    currency: "USD",
    barrier: 4,
    duration: 1,
    duration_unit: "t",
    buy_price: 1,
    current_value: 1,
    payout: 2,
    profit: 0,
    status: "open",
    buy_time: buyTime,
    sell_time: null,
  }];
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.addInitScript(({ historyKey, contract }) => {
      localStorage.setItem(historyKey, JSON.stringify([contract]));
    }, {
      historyKey: `deriv-auto-trader-contracts:${account.id}`,
      contract: { id: "auto-trader-live-settlement", placedAt: buyTime * 1000 },
    });
    await page.goto(`${baseUrl}/auto-trader`);
    await page.getByTestId("row-trade-auto-trader-live-settlement").waitFor();
    await page.getByTestId("button-go-live").click();
    await page.getByTestId("card-market-R_10").waitFor();
    await page.waitForFunction(() =>
      window.__getDerivEventSourceUrls().some((url) => String(url).includes("market_ticks=true")),
    );

    const nextSequence = state.statusVersion + 1;
    await page.evaluate((tickSequence) => {
      window.__dispatchDerivEvent("market-tick", {
        symbol: "R_10",
        tick_sequence: tickSequence,
        recent_digits: [7],
        tick_epoch: 1_700_000_001,
      });
    }, nextSequence);

    const market = page.getByTestId("card-market-R_10");
    await market.locator(".at-market-tick-count").getByText("1 tick").waitFor();
    await market.locator(".at-digit-column").nth(7).locator(".at-digit-count").getByText("1", { exact: true }).waitFor();

    await page.evaluate(({ accountId, buyTime }) => {
      window.__dispatchDerivEvent("trade-update", {
        account_id: accountId,
        contract_id: "auto-trader-live-settlement",
        contract_type: "DIGITDIFF",
        symbol: "R_10",
        account_type: "demo",
        currency: "USD",
        barrier: 4,
        duration: 1,
        duration_unit: "t",
        buy_price: 1,
        current_value: 2,
        payout: 2,
        profit: 1,
        status: "won",
        buy_time: buyTime,
        sell_time: buyTime + 1,
      });
    }, { accountId: account.id, buyTime });
    await page.getByTestId("stat-daily-wins").getByText("1", { exact: true }).waitFor();
    assert.match(await page.getByTestId("stat-daily-pnl").innerText(), /1\.00/);
    assert.deepEqual(state.tradeRequests, [], "The event-stream check must not submit trades.");
    assert.deepEqual(state.unhandledApis, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("Trade X and Auto Trader controls fit phone, tablet, laptop, and 4K viewports", async () => {
  const state = createState(userSession(["edge", "trade-x", "auto-trader", "auto-trader-2", "money-bank"]));
  state.hasToken = true;
  const moneyBankRows = [1, 2, 3, 4, 5].flatMap((growthRate) =>
    [1, 1, 1, 2, 2, 3, 3, 4, 5].map((ticks, index) => ({
      account_id: account.id,
      contract_id: `fixture-money-bank-${growthRate}-${index}`,
      contract_type: "ACCU",
      symbol: "1HZ90V",
      account_type: "demo",
      currency: "USD",
      growth_rate: growthRate,
      tick_passed: ticks,
      buy_price: 0.35,
      current_value: 0,
      payout: 0,
      profit: -0.35,
      status: "lost",
      buy_time: 1_700_000_000 + index,
      sell_time: 1_700_000_001 + index,
    })),
  );
  state.history = moneyBankRows;
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  await context.addInitScript(({ accountId, contractIds }) => {
    localStorage.setItem(
      `money-bank-history-contracts:v1:${encodeURIComponent(accountId)}`,
      JSON.stringify(contractIds),
    );
  }, { accountId: account.id, contractIds: moneyBankRows.map((row) => row.contract_id) });
  try {
    await page.goto(`${baseUrl}/app`);
    const strategiesHeading = page.getByRole("heading", { name: "Trading Strategies" });
    await strategiesHeading.waitFor();
    assert.ok(
      (await strategiesHeading.boundingBox()).y < (await page.locator("#cash-grab-feature").boundingBox()).y,
      "Trading Strategies should appear above Cash Grab.",
    );
    const dashboardNavigation = page.getByRole("navigation", { name: "Dashboard navigation" });
    const navEntries = await dashboardNavigation.locator("a, button").evaluateAll((items) =>
      items.map((item) => item.innerText.replace("Restricted — admin access only", "").replace(/\s+/g, " ").trim()),
    );
    assert.deepEqual(navEntries, ["Trading dashboard", "Auto Trader", "Auto Trader 2.0", "Log out"]);
    assert.equal(await page.getByRole("navigation", { name: "Main navigation" }).count(), 0);
    await dashboardNavigation.getByTestId("link-home-auto-trader-2").click();
    await page.locator(".auto-trader-2-page").waitFor();
    const autoTraderNavLink = page.getByTestId("link-nav-auto-trader");
    const autoTrader2NavLink = page.getByTestId("link-nav-auto-trader-2");
    assert.notEqual((await autoTraderNavLink.getAttribute("class"))?.includes("nav-item-active"), true);
    assert.equal(await autoTraderNavLink.getAttribute("aria-current"), null);
    assert.equal(await autoTraderNavLink.locator(".nav-live").count(), 0);
    assert.equal((await autoTrader2NavLink.getAttribute("class"))?.includes("nav-item-active"), true);
    assert.equal(await autoTrader2NavLink.getAttribute("aria-current"), "page");
    assert.equal(await autoTrader2NavLink.locator(".nav-live").count(), 1);

    await page.getByTestId("link-nav-auto-trader").evaluate((link) => link.click());
    await page.getByRole("heading", { name: "Auto Trader" }).waitFor();
    assert.equal((await autoTraderNavLink.getAttribute("class"))?.includes("nav-item-active"), true);
    assert.equal(await autoTraderNavLink.getAttribute("aria-current"), "page");
    assert.equal(await autoTraderNavLink.locator(".nav-live").count(), 1);
    assert.notEqual((await autoTrader2NavLink.getAttribute("class"))?.includes("nav-item-active"), true);
    assert.equal(await autoTrader2NavLink.getAttribute("aria-current"), null);
    assert.equal(await autoTrader2NavLink.locator(".nav-live").count(), 0);

    await page.getByTestId("link-nav-dashboard").evaluate((link) => link.click());
    const strategyCards = page.locator(".xt-feature-card");
    assert.ok(await strategyCards.count() >= 6, "The homepage should render the complete trading feature card set.");
    for (const viewport of bulkViewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await assertNoHorizontalOverflow(page, viewport, "trading feature cards and switches");
      const cardControls = await strategyCards.evaluateAll((cards) =>
        cards.map((card) => {
          const cardRect = card.getBoundingClientRect();
          const rect = (element) => {
            const bounds = element.getBoundingClientRect();
            return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width };
          };
          return {
            card: rect(card),
            controls: [...card.querySelectorAll("button, .xt-switch")].map(rect),
          };
        }),
      );
      for (const { card, controls } of cardControls) {
        assert.ok(card.width > 0 && card.left >= -1 && card.right <= viewport.width + 1, `A trading feature card escaped at ${viewport.name} width.`);
        for (const control of controls) {
          assert.ok(control.width > 0, `A feature-card button or switch is hidden at ${viewport.name} width.`);
          assert.ok(control.left >= card.left - 1 && control.right <= card.right + 1, `A feature-card button or switch overflowed its card at ${viewport.name} width.`);
        }
      }
    }
    const tradeXGrant = page.getByRole("checkbox", { name: "Toggle Trade X" });
    await tradeXGrant.waitFor();
    await page.locator(".xt-feature-card-trade-x .xt-switch").click();
    assert.equal(await tradeXGrant.isChecked(), true, "The Trade X access switch should activate the feature.");
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

    const digitLabels = await page.locator(".tx-digit-meta").allTextContents();
    assert.equal(digitLabels.length, 10);
    assert.ok(digitLabels.every((label) => /^\d+×$|^—$/.test(label.trim())), "Digit pills should show a compact numeric streak.");
    const rankedDetails = await page.locator(".tx-rank-metrics > small").allTextContents();
    assert.equal(rankedDetails.length, 3);
    assert.ok(rankedDetails.every((label) => /freq/i.test(label) && /absent/i.test(label)), "Each safest digit card should show its frequency and absence streak.");
    const selectedDetail = await page.locator(".tx-signal-metrics").innerText();
    assert.match(selectedDetail, /Frequency/);
    assert.match(selectedDetail, /Absence streak/);
    assert.match(selectedDetail, /Occurrences/);
    assert.match(selectedDetail, /ticks without appearing/);
    assert.equal(await page.locator(".tx-tap-trade").count(), 3);
    const visualOrder = await page.locator(".tx-signal-detail, .tx-safe-panel, .tx-distribution-foot").evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top),
    );
    assert.equal(visualOrder.length, 3);
    assert.ok(visualOrder[0] < visualOrder[1] && visualOrder[1] < visualOrder[2], "Safe-entry detail, top-three cards, and the legend should follow the reference order.");

    const liveDigit = page.locator(".tx-digit-market").first();
    await liveDigit.waitFor({ state: "visible", timeout: 10_000 });
    const liveDigitStyle = await liveDigit.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        insideDashboardTheme: Boolean(element.closest(".xt-app")),
        borderColor: style.borderTopColor,
        background: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        boxShadow: style.boxShadow,
      };
    });
    const borderChannels = liveDigitStyle.borderColor.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    assert.equal(liveDigitStyle.insideDashboardTheme, true);
    assert.ok(
      borderChannels && Math.max(...borderChannels) - Math.min(...borderChannels) > 20,
      `The current market digit should have a distinct cyan treatment: ${JSON.stringify(liveDigitStyle)}`,
    );
    assert.notEqual(liveDigitStyle.boxShadow, "none", "A subtle edge glow should reinforce the current market marker.");

    for (const viewport of tradeXViewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await tradeXPanel.scrollIntoViewIfNeeded();
      await analysisSurface.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const buttons = [...document.querySelectorAll(".tx-tap-trade")];
        return buttons.length === 3 && buttons.every((button) => button.getBoundingClientRect().width > 0);
      }, undefined, { timeout: 5_000 });
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
      const tapButtonLayout = await page.locator(".tx-tap-trade").evaluateAll((buttons) =>
        buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          const rank = button.closest(".tx-rank-row")?.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            display: getComputedStyle(button).display,
            visibility: getComputedStyle(button).visibility,
            rankWidth: rank?.width ?? 0,
          };
        }),
      );
      assert.equal(tapButtonLayout.length, 3, "Each of the three safest-digit cards should have its own trade action.");
      for (const button of tapButtonLayout) {
        assert.ok(button.width > 0 && button.left >= -1 && button.right <= viewport.width + 1, `A Trade X tap-to-trade button escaped at ${viewport.name} width: ${JSON.stringify(button)}`);
        assert.ok(button.height >= 40, `A Trade X tap-to-trade target is too short at ${viewport.name} width.`);
      }
      const cardLayout = await page.locator(".tx-ranking-list").evaluate((list) => {
        const cards = [...list.querySelectorAll(".tx-rank-row")];
        return cards.map((card) => {
          const rect = card.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height };
        });
      });
      assert.equal(cardLayout.length, 3);
      for (const card of cardLayout) {
        assert.ok(card.left >= -1 && card.right <= viewport.width + 1, `A safest-digit card escaped at ${viewport.name} width.`);
        assert.ok(card.height >= 100, `Safest-digit cards should remain spacious enough to use at ${viewport.name} width.`);
      }
      if (viewport.width >= 381) {
        assert.ok(Math.abs(cardLayout[0].top - cardLayout[1].top) <= 1 && Math.abs(cardLayout[1].top - cardLayout[2].top) <= 1, `The three reference cards should stay in one row at ${viewport.name} width.`);
      }

      await page.locator('[data-testid="input-trade-x-stake"]').fill("2.50");
      await page.locator('[data-testid="button-trade-x-digit-4"]').click();
      assert.equal(await page.locator('[data-testid="button-trade-x-digit-4"] .tx-market-touch').innerText(), "✓");
      await page.locator('[data-testid="button-trade-x-duration-2"]').click();
      assert.equal(await page.locator('[data-testid="button-place-trade-x"]').isEnabled(), true, "The configured Trade X trade button should be usable.");
      const readableStyles = await page.evaluate(() => {
        const selectors = {
          digit: ".tx-digit-number",
          percentage: ".tx-digit-percent",
          streak: ".tx-digit-meta",
          rankScore: ".tx-rank-metrics b",
          rankFrequency: ".tx-rank-metrics > small",
        };
        return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) return [name, null];
          const style = getComputedStyle(element);
          return [name, {
            fontSize: Number.parseFloat(style.fontSize),
            opacity: Number.parseFloat(style.opacity),
            filter: style.filter,
            textShadow: style.textShadow,
          }];
        }));
      });
      for (const [name, style] of Object.entries(readableStyles)) {
        assert.ok(style, `${name} should be visible in the Trade X analysis.`);
        const minimumFontSize = name === "digit" ? 20 : name === "rankFrequency" ? 8 : name === "rankScore" ? 12 : 10;
        assert.ok(style.fontSize >= minimumFontSize, `${name} should remain readable at ${viewport.name} width.`);
        assert.equal(style.opacity, 1, `${name} should not be faded at ${viewport.name} width.`);
        assert.equal(style.filter, "none", `${name} should not be blurred at ${viewport.name} width.`);
        assert.equal(style.textShadow, "none", `${name} should not have a soft text shadow at ${viewport.name} width.`);
      }
      await page.screenshot({ path: path.join(screenshotsDir, `trade-x-${viewport.name}.png`), fullPage: true });
    }

    await page.getByRole("navigation", { name: "Dashboard navigation" }).getByTestId("link-home-auto-trader").click();
    await page.getByTestId("button-go-live").waitFor();
    await page.getByTestId("button-go-live").click();
    await page.locator(".at-market-list").waitFor();
    await page.waitForFunction(() =>
      window.__getDerivEventSourceUrls().some((url) => String(url).includes("market_ticks=true")),
    );
    await page.evaluate((signals) => {
      window.__dispatchDerivEvent("market-tick-snapshot", signals);
    }, makeDerivStatus(state.statusVersion + 1).market_signals);
    await page.waitForFunction(() => {
      const tradeButton = document.querySelector('[data-testid="button-trade-3x-R_10-0"]');
      return tradeButton instanceof HTMLButtonElement && !tradeButton.disabled;
    }, undefined, { timeout: 10_000 });
    const firstMarketTradeButtons = page.getByTestId("card-market-R_10").locator('button[data-testid^="button-trade-"]');
    const firstMarketButtonStates = await firstMarketTradeButtons.evaluateAll((buttons) => buttons.map((button) => !button.disabled));
    assert.equal(firstMarketButtonStates.length, 20, "Every digit should have both 3× and 6× controls.");
    assert.ok(firstMarketButtonStates.every(Boolean), "All 3× and 6× controls should be usable once the market is live.");

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

    await page.getByTestId("button-filter-all").click();
    assert.equal(await page.locator(".at-market-grid .at-market-card").count(), 15);
    assert.equal(await page.getByTestId("button-filter-all").getAttribute("aria-selected"), "true");
    await page.getByTestId("button-rescan").click();
    await page.getByTestId("button-rescan").waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const rescan = document.querySelector('[data-testid="button-rescan"]');
      return rescan instanceof HTMLButtonElement && !rescan.disabled;
    });
    assert.equal(await page.getByTestId("button-filter-all").getAttribute("aria-selected"), "true");
    assert.equal(await page.locator(".at-market-grid .at-market-card").count(), 15);
    await page.getByTestId("button-stop-scan").click();
    assert.equal(await page.getByTestId("button-go-live").isVisible(), true);

    await page.getByTestId("link-nav-dashboard").click();
    const moneyBankToggle = page.getByRole("checkbox", { name: "Toggle Money Bank", exact: true });
    await moneyBankToggle.waitFor();
    await page.locator(".xt-feature-card-edge2 .xt-switch").click();
    assert.equal(await moneyBankToggle.isChecked(), true);
    await page.getByRole("heading", { name: "Money Bank" }).waitFor();
    assert.equal(await page.locator(".money-bank-knockout-card").count(), 0, "The retired live knockout area should remain absent.");
    const moneyBankHistory = page.locator(".money-bank-panel .deriv-history");
    await moneyBankHistory.getByText("WIN RATE", { exact: true }).waitFor();
    assert.doesNotMatch(await moneyBankHistory.innerText(), /n=0 settled/);
    assert.equal(await page.locator(".money-bank-chart-reset").count(), 0, "The chart refresh control should be hidden.");
    assert.equal(await page.getByText(/ticks since reset/).count(), 0, "The chart tick counter should be hidden.");
    assert.equal(await page.getByText(/BASE is the first stake|Auto Budget includes only levels affordable/).count(), 0, "The requested Money Bank helper copy should be hidden.");

    const marketSelect = page.getByRole("combobox", { name: "Select a Volatility market" });
    await marketSelect.selectOption("1HZ15V");
    await marketSelect.selectOption("1HZ90V");

    assert.equal(await page.getByRole("checkbox", { name: "Toggle Money Bank Auto Knockout" }).count(), 0);
    const takeProfitInput = page.locator('input[aria-label="Take Profit ticks"]');
    assert.equal(await takeProfitInput.getAttribute("min"), "1");
    assert.equal(await takeProfitInput.getAttribute("max"), "30");
    assert.equal(await page.getByRole("button", { name: "Reset live tick count" }).count(), 0, "Live knockout controls should remain absent.");
    await takeProfitInput.focus();
    await takeProfitInput.press("Home");
    assert.equal(await takeProfitInput.inputValue(), "1");
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await assertNoHorizontalOverflow(page, viewport, "Money Bank");
    }

    assert.deepEqual(state.unhandledApis, [], `Unexpected API requests: ${JSON.stringify(state.unhandledApis)}`);
    assert.deepEqual(state.tradeRequests, [], "Responsive controls must be tested without submitting any trade.");

    await page.getByRole("button", { name: "Start Accumulator" }).waitFor();
    state.knockoutScanReady = true;
    state.allowFixtureTrades = true;
    state.buyResponseDelayMs = 500;
    const pendingBuyRequest = page.waitForRequest((request) =>
      request.url().includes("/api/deriv/buy") && request.method() === "POST",
    );
    await page.getByRole("button", { name: "Start Accumulator" }).click();
    await pendingBuyRequest;
    const sellRequest = page.waitForRequest((request) =>
      request.url().includes("/api/deriv/sell") && request.method() === "POST",
    );
    const sellResponse = page.waitForResponse((response) =>
      response.url().includes("/api/deriv/sell") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Stop Accumulator" }).click();
    await Promise.all([sellRequest, sellResponse]);
    await page.getByRole("button", { name: "Start Accumulator" }).waitFor();
    assert.deepEqual(
      state.tradeRequests.map(({ path }) => path),
      ["/api/deriv/buy", "/api/deriv/sell"],
      "Stop should wait for the in-flight buy acknowledgement, close its confirmed contract, and send no duplicate buy.",
    );
    assert.equal(state.tradeRequests[0].body.duration, 1, "Money Bank should send the selected minimum duration.");
    assert.equal(state.tradeRequests[0].body.auto_knockout, undefined, "Money Bank should not request Auto Knockout.");
    assert.equal(state.history[0].status, "closed", "The acknowledged Money Bank contract should be closed after Stop.");

    assert.deepEqual(pageErrors, [], "The app should render without browser exceptions.");
  } finally {
    await context.close();
  }
});

test("Trade X history appears at acknowledgement, survives a stale snapshot, and reconciles", async () => {
  const state = createState(userSession(["trade-x"]));
  state.hasToken = true;
  state.allowFixtureTrades = true;
  const { context, page, pageErrors } = await createMockPage(state, viewports[0]);
  try {
    await page.goto(`${baseUrl}/app`);
    await page.getByRole("heading", { name: "Trading Strategies" }).waitFor();
    await page.locator(".xt-feature-card-trade-x .xt-switch").click();

    const panel = page.getByTestId("trade-x-panel");
    await panel.waitFor();
    await panel.getByTestId("input-trade-x-stake").fill("1.25");
    await panel.getByTestId("button-trade-x-digit-4").click();
    await panel.getByTestId("button-trade-x-duration-2").click();

    state.historyResponseOverride = [];
    state.holdHistoryResponses = true;
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/deriv/bulk-buy") && response.request().method() === "POST");
    await panel.getByTestId("button-place-trade-x").click();
    const response = await responsePromise;

    assert.equal(response.status(), 202);

    const historyRow = page.getByTestId("deriv-history-VRTC12345-fixture-contract-1");
    await historyRow.waitFor({ state: "visible" });
    await waitForHeldHistoryResponse(state);
    const currentValue = historyRow.locator(".deriv-history-details span")
      .filter({ hasText: "CURRENT VALUE" })
      .locator("b");
    assert.equal(await currentValue.innerText(), "US$1.25", "The acknowledged buy should appear immediately as an open row before history catches up.");
    assert.match(await historyRow.locator(".deriv-history-profit").innerText(), /US\$0\.00/);
    assert.equal(await page.getByTestId("deriv-history-VRTC12345-fixture-contract-1").count(), 1, "Trade X history must not duplicate the pending row.");

    state.history = [{
      ...state.history[0],
      current_value: 1.68,
      profit: 0.43,
    }, ...state.history.slice(1)];
    state.holdHistoryResponses = false;
    await releaseHeldHistoryResponses(state);
    assert.equal(await currentValue.innerText(), "US$1.25", "A stale empty history response must not remove the acknowledged row.");

    state.historyResponseOverride = undefined;
    await currentValue.getByText("US$1.68", { exact: true }).waitFor({ timeout: 10_000 });
    assert.match(await historyRow.locator(".deriv-history-profit").innerText(), /US\$0\.43/);
    assert.equal(await page.getByTestId("deriv-history-VRTC12345-fixture-contract-1").count(), 1, "The authoritative row should replace, not duplicate, the local pending row.");

    await page.locator(".xt-feature-card-trade-x .xt-switch").click();
    await page.getByTestId("button-notifications").click();
    const notificationPanel = page.getByRole("dialog", {
      name: "Account, connection, and workspace notifications",
    });
    await notificationPanel.waitFor({ state: "visible" });
    const notificationText = await notificationPanel.innerText();
    assert.doesNotMatch(notificationText, /Waiting for \d+ open Deriv contracts? to settle before another trade can start\.?/i);
    assert.doesNotMatch(notificationText, /Trade X paused/i, "Turning off Trade X must not add a misleading pause notification.");
    assert.deepEqual(state.tradeRequests, [{
      path: "/api/deriv/bulk-buy",
      method: "POST",
      body: {
        access_feature: "trade-x",
        amount: 1.25,
        duration: 2,
        duration_unit: "t",
        contract_type: "DIGITDIFF",
        barrier: 4,
        symbol: "R_75",
        count: 1,
      },
    }]);
    assert.deepEqual(state.unhandledApis, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    state.holdHistoryResponses = false;
    await releaseHeldHistoryResponses(state);
    await context.close();
  }
});

test("Bulk Trader digits match Trade X pill styling and fit phone, tablet, laptop, and 4K widths", async () => {
  const state = createState(userSession(["bulk-trader"]));
  state.hasToken = true;
  const { context, page, pageErrors } = await createMockPage(state, bulkViewports[0]);
  try {
    await page.goto(`${baseUrl}/app`);
    const bulkGrant = page.getByRole("checkbox", { name: "Toggle Bulk Trader" });
    await bulkGrant.waitFor();
    await page.locator(".xt-feature-card-bulk .xt-switch").click();
    assert.equal(await bulkGrant.isChecked(), true);

    const panel = page.getByTestId("panel-bulk-trader");
    await panel.waitFor();
    assert.equal(await page.getByTestId("bulk-duration-note").count(), 0, "Bulk Trader should not show the 1T entry-tick explanation.");
    assert.equal(await page.getByTestId("button-duration-1").getAttribute("aria-pressed"), "true");
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".bulk-digit-streak")].some((element) => /^\d+×$/.test(element.textContent?.trim() ?? "")),
    undefined, { timeout: 10_000 });

    for (const viewport of bulkViewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await panel.scrollIntoViewIfNeeded();
      await assertNoHorizontalOverflow(page, viewport, "Bulk Trader");
      await assertWithinViewport(page, '[data-testid="panel-bulk-trader"]', viewport.width, "Bulk Trader panel");

      const distribution = page.locator(".bulk-trader-digit-row");
      await distribution.scrollIntoViewIfNeeded();
      const layout = await distribution.evaluate((row) => {
        const rowRect = row.getBoundingClientRect();
        const digits = [...row.querySelectorAll(".bulk-digit")].map((digit) => {
          const rect = digit.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
        });
        return { left: rowRect.left, right: rowRect.right, boxes: digits };
      });
      assert.equal(layout.boxes.length, 10);
      assert.ok(layout.right <= viewport.width + 1 && layout.left >= -1, `The digit row must fit at ${viewport.name} width.`);
      for (const box of layout.boxes) {
        assert.ok(box.width >= 35, `Digit cells need enough width for readable values at ${viewport.name}: ${JSON.stringify(box)}`);
        assert.ok(box.left >= layout.left - 1 && box.right <= layout.right + 1, `A digit cell escaped its row at ${viewport.name}.`);
      }
      for (let index = 1; index < 5; index += 1) {
        assert.ok(Math.abs(layout.boxes[index].top - layout.boxes[0].top) <= 1, `Digits 0–4 should share the first row at ${viewport.name}.`);
      }
      assert.ok(layout.boxes[5].top >= layout.boxes[0].bottom - 1, `Digits 5–9 should wrap cleanly to the next row at ${viewport.name}.`);

      const pillStyles = await distribution.locator(".bulk-digit").evaluateAll((digits) =>
        digits.map((digit) => {
          const style = getComputedStyle(digit);
          const histogram = digit.querySelector("i");
          return {
            borderRadius: Number.parseFloat(style.borderRadius),
            backgroundImage: style.backgroundImage,
            opacity: Number.parseFloat(style.opacity),
            histogramDisplay: histogram instanceof HTMLElement ? getComputedStyle(histogram).display : "missing",
          };
        }),
      );
      assert.ok(pillStyles.every((style) => style.borderRadius >= 30), "Bulk Trader digits should use the same clean pill shape as Trade X.");
      assert.ok(pillStyles.every((style) => !style.backgroundImage.includes("repeating-linear-gradient")), "Digit pills should use a smooth fill, not a striped texture.");
      assert.ok(pillStyles.every((style) => style.opacity === 1), "Absence markers should stay readable rather than dimming their digits.");
      assert.ok(pillStyles.every((style) => style.histogramDisplay === "none"), "Percentages remain the distribution readout; remove the extra bars from the digit pills.");

      const streakLabels = await panel.locator(".bulk-digit-streak").allTextContents();
      assert.equal(streakLabels.length, 10);
      assert.ok(streakLabels.every((label) => /^\d+×$|^—$/.test(label.trim())), "Streaks should use the same compact numeric marker as Trade X.");
      assert.ok(streakLabels.every((label) => !/absent/i.test(label)));

      const readability = await distribution.evaluate((row) => {
        const digit = row.querySelector(".bulk-digit b");
        const percentage = row.querySelector(".bulk-digit > small:not(.bulk-digit-streak)");
        const streak = row.querySelector(".bulk-digit-streak");
        return [digit, percentage, streak].map((element) => {
          if (!(element instanceof HTMLElement)) return null;
          const style = getComputedStyle(element);
          return {
            fontSize: Number.parseFloat(style.fontSize),
            opacity: Number.parseFloat(style.opacity),
            filter: style.filter,
            textShadow: style.textShadow,
          };
        });
      });
      assert.ok(readability.every((style) => style), "Digit, percentage, and streak text should all render.");
      assert.ok(readability[0].fontSize >= 19 && readability[1].fontSize >= 11 && readability[2].fontSize >= 10);
      for (const style of readability) {
        assert.equal(style.opacity, 1);
        assert.equal(style.filter, "none");
        assert.equal(style.textShadow, "none");
      }

      const selectedDigit = page.getByTestId("button-digit-4");
      await selectedDigit.click();
      assert.equal(await selectedDigit.getAttribute("aria-pressed"), "true");
      const selectedPillStyle = await selectedDigit.evaluate((digit) => {
        const style = getComputedStyle(digit);
        return { backgroundImage: style.backgroundImage, selectedMark: getComputedStyle(digit, "::before").content };
      });
      assert.ok(selectedPillStyle.backgroundImage.includes("linear-gradient"), "The selected Bulk Trader digit should share Trade X's smooth cyan fill.");
      assert.match(selectedPillStyle.selectedMark, /✓/, "The selected digit should have a clean, compact selected marker.");
      await page.screenshot({ path: path.join(screenshotsDir, `bulk-trader-${viewport.name}.png`) });
    }

    assert.deepEqual(state.unhandledApis, [], `Unexpected API requests: ${JSON.stringify(state.unhandledApis)}`);
    assert.deepEqual(state.tradeRequests, [], "Bulk Trader layout checks must not submit any trade.");
    assert.deepEqual(pageErrors, [], "Bulk Trader should render without browser exceptions.");
  } finally {
    await context.close();
  }
});

function createState(session) {
  return {
    session,
    sessionRevoked: false,
    hasToken: false,
    allowFixtureTrades: false,
    tradeSequence: 0,
    selectedSymbol: "R_75",
    knockoutScanTickSequence: 0,
    apiCalls: [],
    unhandledApis: [],
    logoutCount: 0,
    tradeRequests: [],
    historyResponseOverride: undefined,
    holdHistoryResponses: false,
    heldHistoryResponses: [],
    createdKeyBody: null,
    statusVersion: 0,
    activeContractCount: 0,
    marketSignalOverrides: {},
    featureSettings: {
      features: fixtureFeatureIds.map((feature) => ({
        feature,
        mode: "available",
        audience: "all",
        user_ids: [],
        countdown_at: null,
        notice: "",
      })),
      global_announcement_enabled: false,
      global_announcement: "",
      global_announcement_revision: "",
      auto_trader_2_paused: false,
      auto_trader_2_pause_message: "Auto Trader 2.0 is temporarily paused by an administrator.",
      updated_at: null,
    },
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
  await context.addInitScript(() => {
    const openSources = new Set();

    class FixtureEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      constructor(url, options = {}) {
        super();
        this.url = String(url);
        this.withCredentials = Boolean(options.withCredentials);
        this.readyState = FixtureEventSource.CONNECTING;
        this.onopen = null;
        this.onerror = null;
        openSources.add(this);
        queueMicrotask(() => {
          if (this.readyState === FixtureEventSource.CLOSED) return;
          this.readyState = FixtureEventSource.OPEN;
          this.onopen?.(new Event("open"));
        });
      }

      close() {
        this.readyState = FixtureEventSource.CLOSED;
        openSources.delete(this);
      }
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: FixtureEventSource,
    });
    Object.defineProperty(window, "__dispatchDerivEvent", {
      configurable: true,
      value: (name, payload) => {
        const data = typeof payload === "string" ? payload : JSON.stringify(payload);
        const event = new MessageEvent(name, { data });
        for (const source of openSources) source.dispatchEvent(event);
      },
    });
    Object.defineProperty(window, "__getDerivEventSourceUrls", {
      configurable: true,
      value: () => [...openSources].map((source) => source.url),
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    // The harness intentionally aborts external requests, including the real Clerk SDK load.
    if (!error.message.includes("Clerk: Failed to load Clerk JS")) pageErrors.push(error.message);
  });
  return { context, page, pageErrors };
}

async function mockApiRequest(route, state, pathname, method) {
  state.apiCalls.push({ path: pathname, method });
  const request = route.request();

  if (pathname === "/api/access/session" && method === "GET") {
    await fulfillJson(
      route,
      state.sessionRevoked ? { error: "The access session is no longer active." } : state.session,
      state.sessionRevoked ? 401 : 200,
    );
    return;
  }
  if (pathname === "/api/access/feature-settings" && method === "GET") {
    await fulfillJson(route, state.featureSettings);
    return;
  }
  if (pathname === "/api/access/feature-settings" && method === "PATCH") {
    Object.assign(state.featureSettings, request.postDataJSON());
    state.featureSettings.updated_at = new Date().toISOString();
    await fulfillJson(route, state.featureSettings);
    return;
  }
  if (pathname === "/api/access/heartbeat" && method === "POST") {
    await fulfillJson(route, { success: true });
    return;
  }
  if (pathname === "/api/access/diagnostics" && method === "POST") {
    await fulfillJson(route, { accepted: true }, 202);
    return;
  }
  if (pathname === "/api/admin/intelligence/scan" && method === "GET") {
    await fulfillJson(route, {
      scanned_at: new Date().toISOString(),
      server_status: "healthy",
      features: [],
      findings: [],
    });
    return;
  }
  if (pathname === "/api/access/logout" && method === "POST") {
    state.logoutCount += 1;
    state.sessionRevoked = true;
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
    await fulfillJson(route, makeDerivStatus(state.statusVersion, state.activeContractCount, state.marketSignalOverrides, state.selectedSymbol));
    return;
  }
  if (pathname === "/api/deriv/history" && method === "GET") {
    const historyResponse = state.historyResponseOverride ?? state.history ?? [];
    if (state.holdHistoryResponses) {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const completion = gate.then(() => fulfillJson(route, historyResponse));
      state.heldHistoryResponses.push({ release, completion });
      await completion;
      return;
    }
    await fulfillJson(route, historyResponse);
    return;
  }
  if (pathname === "/api/deriv/clock-work/quotes" && method === "POST") {
    const { contracts } = request.postDataJSON();
    await fulfillJson(route, {
      quotes: contracts.map((contract) => ({
        ...contract,
        ask_price: contract.amount,
        payout: contract.amount * 2,
        spot: 100_000,
        longcode: "Fixture quote",
      })),
    });
    return;
  }
  if (pathname === "/api/deriv/accumulator-knockout-scan" && method === "POST") {
    const input = request.postDataJSON();
    if (input.action === "start") state.knockoutScanTickSequence = 0;
    else if (input.action === "poll") state.knockoutScanTickSequence += 1;
    const tickSequence = state.knockoutScanTickSequence;
    const readyToTrade = state.knockoutScanReady === true;
    await fulfillJson(route, {
      ok: true,
      message: readyToTrade
        ? "The required knockout sample is complete."
        : "Watching the selected market for a live scanner knockout.",
      phase: readyToTrade ? "ready" : "waiting_for_knockout",
      symbol: input.symbol,
      qualified_knockouts: readyToTrade ? input.required_knockouts : 0,
      required_knockouts: input.required_knockouts,
      tick_sequence: tickSequence,
      ready_to_trade: readyToTrade,
      market_matches: true,
    });
    return;
  }
  if (pathname === "/api/deriv/buy" && method === "POST" && state.allowFixtureTrades) {
    const order = request.postDataJSON();
    state.tradeRequests.push({ path: pathname, method, body: order });
    if (state.buyResponseDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, state.buyResponseDelayMs));
    }
    const buy = fixtureBuy(state, order);
    await fulfillJson(route, {
      ok: true,
      message: "Fixture buy confirmed.",
      proposal: { id: "fixture-proposal", ask_price: order.amount, payout: order.amount * 2, spot: 100_000 },
      buy: { contract_id: buy.contract_id, buy_price: order.amount, payout: order.amount * 2 },
    });
    return;
  }
  if (pathname === "/api/deriv/bulk-buy" && method === "POST" && state.allowFixtureTrades) {
    const order = request.postDataJSON();
    state.tradeRequests.push({ path: pathname, method, body: order });
    if (state.buyResponseDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, state.buyResponseDelayMs));
    }
    const buy = fixtureBuy(state, order);
    await fulfillJson(route, {
      ok: true,
      count: 1,
      message: "Fixture buy confirmed.",
      proposals: [{
        id: "fixture-proposal",
        ask_price: order.amount,
        payout: order.amount * 2,
        spot: 100_000,
        longcode: "Fixture quote",
      }],
      buys: [{
        contract_id: buy.contract_id,
        buy_price: order.amount,
        payout: order.amount * 2,
        start_time: buy.buy_time,
      }],
      failed: [],
    }, 202);
    return;
  }
  if (pathname === "/api/deriv/jackpot/buy" && method === "POST" && state.allowFixtureTrades) {
    const order = request.postDataJSON();
    state.tradeRequests.push({ path: pathname, method, body: order });
    const contractTypes = Array.from({ length: order.pair_count }, () => [
      order.rise_fall_type,
      order.parity_type,
    ]).flat();
    const buys = contractTypes.map((contract_type) => {
      const row = fixtureBuy(state, { ...order, contract_type });
      return {
        contract_id: row.contract_id,
        buy_price: row.buy_price,
        payout: row.payout,
        start_time: row.buy_time,
      };
    });
    state.activeContractCount = buys.length;
    await fulfillJson(route, {
      ok: true,
      count: buys.length,
      message: "Fixture Jackpot batch confirmed.",
      proposals: contractTypes.map(() => ({
        id: "fixture-proposal",
        ask_price: order.amount,
        payout: order.amount * 2,
        spot: 100_000,
        longcode: "Fixture quote",
      })),
      buys,
      failed: [],
    }, 202);
    return;
  }
  if (pathname === "/api/deriv/sell" && method === "POST" && state.allowFixtureTrades) {
    state.tradeRequests.push({ path: pathname, method });
    const { contract_id } = request.postDataJSON();
    const openTrade = (state.history ?? []).find((trade) => trade.contract_id === contract_id);
    const soldFor = openTrade?.current_value ?? 0;
    state.history = (state.history ?? []).map((trade) => trade.contract_id === contract_id
      ? {
          ...trade,
          current_value: soldFor,
          payout: soldFor,
          profit: soldFor - trade.buy_price,
          status: "closed",
          sell_time: Math.floor(Date.now() / 1000),
        }
      : trade);
    state.activeContractCount = Math.max(0, state.activeContractCount - 1);
    await fulfillJson(route, { ok: true, contract_id, sold_for: soldFor });
    return;
  }
  if (pathname === "/api/deriv/select-symbol" && method === "POST") {
    state.selectedSymbol = request.postDataJSON().symbol;
    await fulfillJson(route, { symbol: state.selectedSymbol });
    return;
  }
  if (/^\/api\/deriv\/(buy|bulk-buy|dual-buy|sell|jackpot\/buy)(\/|$)/.test(pathname)) {
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

function makeDerivStatus(version, activeContractCount = 0, marketSignalOverrides = {}, selectedSymbol = "R_75") {
  const signals = symbols.map((symbol, index) => {
    const digit = (version + index) % 10;
    return {
      symbol,
      quote: 100_000 + version + index,
      last_digit: digit,
      tick_sequence: version,
      recent_digits: [digit],
      recent_quotes: [],
      tick_epoch: 0,
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
      ...marketSignalOverrides[symbol],
    };
  });
  return {
    connected: true,
    authorized: true,
    symbol: selectedSymbol,
    account,
    active_contract_count: activeContractCount,
    last_digit: version % 10,
    open_contracts_ready: true,
    last_tick: { symbol: selectedSymbol, quote: 100_000 + version, epoch: 1_700_000_000 + version },
    market_signals: signals,
  };
}

function clockWorkQuotesForOutcomes(outcomes) {
  const quotes = [100];
  for (const wins of outcomes) {
    const start = quotes.at(-1);
    const expiry = start + (wins ? 1 : -1);
    for (let tick = 1; tick <= 5; tick += 1) {
      quotes.push(start + ((expiry - start) * tick) / 5);
    }
  }
  return quotes;
}

function fixtureBuy(state, order) {
  const contractId = `fixture-contract-${++state.tradeSequence}`;
  const row = {
    account_id: account.id,
    contract_id: contractId,
    contract_type: order.contract_type,
    symbol: order.symbol,
    account_type: "demo",
    currency: "USD",
    barrier: order.barrier ?? null,
    buy_price: order.amount,
    current_value: order.amount,
    payout: order.amount * 2,
    profit: 0,
    status: "open",
    buy_time: 1_700_000_000 + state.tradeSequence,
    sell_time: null,
  };
  state.history = [row, ...(state.history ?? [])];
  state.activeContractCount = 1;
  return row;
}

async function waitForHeldHistoryResponse(state, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (state.heldHistoryResponses.length === 0) {
    if (Date.now() >= deadline) {
      throw new Error("Trade X did not issue a history refresh after the confirmed buy.");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function releaseHeldHistoryResponses(state) {
  const heldResponses = state.heldHistoryResponses.splice(0);
  heldResponses.forEach(({ release }) => release());
  await Promise.all(heldResponses.map(({ completion }) => completion));
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
