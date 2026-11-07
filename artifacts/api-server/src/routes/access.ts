import { Router, type IRouter } from "express";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db, accessKeySessionsTable, accessKeysTable, adminFeatureSettingsTable, tradingProtectionSettingsTable } from "@workspace/db";
import {
  GetAdminFeatureSettingsResponse,
  CreateAccessKeyBody,
  CreateAccessKeyResponse,
  GetAccessSessionResponse,
  ListAccessKeysResponseItem,
  LoginAccessKeyBody,
  UpdateAdminFeatureSettingsBody,
  UpdateAccessKeyBody,
  ListAccessKeysResponse,
  FEATURE_ACTION_CATALOG,
} from "@workspace/api-zod";
import {
  ACCESS_FEATURES,
  accessCookie,
  activeDeviceCount,
  clearAccessCookie,
  decryptAccessKey,
  deviceHash,
  encryptAccessKey,
  featureList,
  findSessionByToken,
  generateAccessKey,
  generateSessionToken,
  hashSecret,
  isOnline,
  isPrimaryAdminKeyHash,
  offlineSeconds,
  onlineDeviceCount,
  parseAccessCookie,
  syncConfiguredPrimaryAdminKey,
} from "../lib/access-keys";
import { disposeUser, withUserSerialized } from "../lib/deriv";
import { logger } from "../lib/logger";
import { publishGlobalAnnouncement, subscribeGlobalAnnouncements } from "../lib/global-announcement-events";
import { requireAccess, requireAccessAdmin } from "../middlewares/requireAccess";
import { summarizeUserAgent } from "../lib/device-summary";

const router: IRouter = Router();
const featureControlModes = new Set(["available", "restricted", "coming_soon", "under_construction"]);

async function deviceSummaries(accessKeyId: string) {
  const sessions = await db.select({
    deviceHash: accessKeySessionsTable.deviceHash,
    userAgent: accessKeySessionsTable.userAgent,
    firstSeenAt: accessKeySessionsTable.firstSeenAt,
    lastSeenAt: accessKeySessionsTable.lastSeenAt,
  }).from(accessKeySessionsTable).where(and(
    eq(accessKeySessionsTable.accessKeyId, accessKeyId),
    isNull(accessKeySessionsTable.revokedAt),
  ));
  const latestByDevice = new Map<string, typeof sessions[number]>();
  for (const session of sessions) {
    const previous = latestByDevice.get(session.deviceHash);
    if (!previous || session.lastSeenAt > previous.lastSeenAt) latestByDevice.set(session.deviceHash, session);
  }
  return [...latestByDevice.values()]
    .map((session) => ({
      ...summarizeUserAgent(session.userAgent),
      online: isOnline(session.lastSeenAt),
      first_seen_at: session.firstSeenAt,
      last_seen_at: session.lastSeenAt,
    }))
    .sort((left, right) => right.last_seen_at.getTime() - left.last_seen_at.getTime());
}

function defaultFeatureSettings() {
  return {
    features: ACCESS_FEATURES
      .filter((feature) => feature !== "admin" && feature !== "jdy-ai-3")
      .map((feature) => ({
        feature,
        mode: "available",
        audience: "all",
        user_ids: [],
        countdown_at: null,
        notice: "",
      })),
    action_controls: FEATURE_ACTION_CATALOG.map((control) => ({ ...control, mode: "available" })),
    global_announcement_enabled: false,
    global_announcement: "",
    global_announcement_revision: "",
    auto_trader_2_paused: false,
    auto_trader_2_pause_message: "Auto Trader 2.0 is temporarily paused by an administrator.",
  };
}

function normalizeFeatureSettings(value: Record<string, unknown> | undefined, updatedAt: Date | null) {
  const defaults = defaultFeatureSettings();
  const storedFeatures = Array.isArray(value?.features) ? value.features : [];
  const featureById = new Map(storedFeatures
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => [String(item.feature), item]));
  const features = defaults.features.map((fallback) => {
    const saved = featureById.get(fallback.feature);
    if (!saved) return fallback;
    return {
      feature: fallback.feature,
      mode: typeof saved.mode === "string" && featureControlModes.has(saved.mode) ? saved.mode : fallback.mode,
      audience: saved.audience === "specific" ? "specific" : "all",
      user_ids: Array.isArray(saved.user_ids)
        ? Array.from(new Set(saved.user_ids.filter((id): id is string => typeof id === "string")))
        : [],
      countdown_at: typeof saved.countdown_at === "string" ? saved.countdown_at : null,
      notice: typeof saved.notice === "string" ? saved.notice.slice(0, 500) : "",
    };
  });
  const storedActionControls = (Array.isArray(value?.action_controls) ? value.action_controls : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .filter((item) =>
      typeof item.feature === "string"
      && ACCESS_FEATURES.includes(item.feature as typeof ACCESS_FEATURES[number])
      && item.feature !== "admin"
      && item.feature !== "jdy-ai-3"
      && typeof item.control_id === "string"
      && /^[a-z0-9][a-z0-9-]{0,79}$/.test(item.control_id)
      && typeof item.label === "string"
      && featureControlModes.has(String(item.mode)),
    )
    .map((item) => ({
      feature: item.feature,
      control_id: item.control_id,
      label: String(item.label).slice(0, 120),
      mode: item.mode,
    }));
  const storedActionsByKey = new Map(storedActionControls.map((control) => [
    `${control.feature}/${control.control_id}`,
    control,
  ]));
  const actionControls = FEATURE_ACTION_CATALOG.map((fallback) => {
    const saved = storedActionsByKey.get(`${fallback.feature}/${fallback.control_id}`);
    return {
      ...fallback,
      mode: typeof saved?.mode === "string" && featureControlModes.has(saved.mode)
        ? saved.mode
        : "available",
    };
  });
  return GetAdminFeatureSettingsResponse.parse({
    features,
    action_controls: actionControls,
    global_announcement_enabled: value?.global_announcement_enabled === true,
    global_announcement: typeof value?.global_announcement === "string" ? value.global_announcement.slice(0, 500) : "",
    global_announcement_revision: typeof value?.global_announcement_revision === "string"
      ? value.global_announcement_revision.slice(0, 128)
      : "",
    auto_trader_2_paused: value?.auto_trader_2_paused === true,
    auto_trader_2_pause_message: typeof value?.auto_trader_2_pause_message === "string"
      ? value.auto_trader_2_pause_message.slice(0, 300)
      : defaults.auto_trader_2_pause_message,
    updated_at: updatedAt,
  });
}

function sessionFeatureSettings(
  settings: ReturnType<typeof normalizeFeatureSettings>,
  accessKeyId: string,
  isAdmin: boolean,
) {
  if (isAdmin) return settings;
  return {
    ...settings,
    features: settings.features.map((control) => {
      const targeted = control.audience === "all" || control.user_ids.includes(accessKeyId);
      if (targeted) {
        return { ...control, audience: "all" as const, user_ids: [] };
      }
      return {
        ...control,
        mode: "available" as const,
        audience: "all" as const,
        user_ids: [],
        countdown_at: null,
        notice: "",
      };
    }),
  };
}

function secureCookie(forwardedProto?: string) {
  return forwardedProto === "https";
}

function readableAccessKey(encryptedKey: string | null) {
  if (!encryptedKey) return null;
  try {
    return decryptAccessKey(encryptedKey);
  } catch {
    return null;
  }
}

function sessionResponse(session: {
  accessKeyId: string;
  keyPrefix: string;
  label: string;
  kind: "admin" | "user";
  status: "active" | "paused" | "blocked" | "banned" | "deleted";
  maxDevices: number;
  features: string[] | null;
  sessionLastSeenAt: Date | null;
  keyHash: string;
}) {
  return GetAccessSessionResponse.parse({
    key_id: session.accessKeyId,
    key_prefix: session.keyPrefix,
    label: session.label,
    kind: session.kind,
    is_admin: isPrimaryAdminKeyHash(session.keyHash),
    status: session.status,
    max_devices: session.maxDevices,
    features: featureList(session.features, session.kind),
    online: isOnline(session.sessionLastSeenAt),
    last_seen_at: session.sessionLastSeenAt,
  });
}

function disposeRevokedSession(sessionId: string) {
  // Close this process's live Deriv socket immediately, then queue a final
  // cleanup behind any in-flight user operation so it cannot recreate state.
  disposeUser(sessionId);
  void withUserSerialized(sessionId, async () => {
    disposeUser(sessionId);
  }).catch((error) => {
    logger.warn({ err: error }, "Unable to finish cleanup for a revoked access session");
  });
}

function disposeRevokedSessions(sessions: Array<{ id: string }>) {
  for (const session of sessions) disposeRevokedSession(session.id);
}

async function revokeActiveSessions(accessKeyId: string) {
  const sessions = await db.update(accessKeySessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(accessKeySessionsTable.accessKeyId, accessKeyId),
      isNull(accessKeySessionsTable.revokedAt),
    ))
    .returning({ id: accessKeySessionsTable.id });
  disposeRevokedSessions(sessions);
}

router.post("/access/login", async (req, res): Promise<void> => {
  const parsed = LoginAccessKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter an access key and device identifier" });
    return;
  }

  await syncConfiguredPrimaryAdminKey();
  const accessKeyHash = hashSecret(parsed.data.access_key.trim());
  const fingerprint = deviceHash(parsed.data.device_id);
  const rawSession = generateSessionToken();
  const now = new Date();
  const loginResult = await db.transaction(async (tx) => {
    // Serialize login with administrator status/key changes. A key that was
    // disabled while the login request was in flight must not mint a session.
    const [key] = await tx.select().from(accessKeysTable)
      .where(eq(accessKeysTable.keyHash, accessKeyHash))
      .for("update")
      .limit(1);
    if (!key) return { error: { status: 401, message: "That access key is not recognized" } } as const;
    if (key.status !== "active") {
      const message = key.status === "banned"
        ? "This access key is permanently banned"
        : key.status === "deleted"
          ? "This access key has been deleted"
          : `This access key is ${key.status}`;
      return { error: { status: 403, message } } as const;
    }

    const sessions = await tx.select().from(accessKeySessionsTable).where(and(
      eq(accessKeySessionsTable.accessKeyId, key.id),
      isNull(accessKeySessionsTable.revokedAt),
    ));
    const existingDevice = sessions.find((session) => session.deviceHash === fingerprint);
    const deviceCount = new Set(sessions.map((session) => session.deviceHash)).size;
    if (!existingDevice && key.maxDevices > 0 && deviceCount >= key.maxDevices) {
      return {
        error: {
          status: 403,
          message: `This access key is already in use on ${key.maxDevices} device${key.maxDevices === 1 ? "" : "s"}`,
        },
      } as const;
    }

    if (existingDevice) {
      await tx.update(accessKeySessionsTable)
        .set({ revokedAt: now })
        .where(eq(accessKeySessionsTable.id, existingDevice.id));
    }
    const [session] = await tx.insert(accessKeySessionsTable).values({
      accessKeyId: key.id,
      tokenHash: hashSecret(rawSession),
      deviceHash: fingerprint,
      userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
    }).returning();
    await tx.update(accessKeysTable)
      .set({ lastSeenAt: now, updatedAt: now })
      .where(eq(accessKeysTable.id, key.id));
    return { key, session, replacedSessionId: existingDevice?.id ?? null } as const;
  });
  if ("error" in loginResult && loginResult.error) {
    res.status(loginResult.error.status).json({ error: loginResult.error.message });
    return;
  }

  const { key, session } = loginResult;
  if (loginResult.replacedSessionId) disposeRevokedSession(loginResult.replacedSessionId);

  res.append("Set-Cookie", accessCookie(rawSession, secureCookie(req.get("x-forwarded-proto"))));
  res.json(sessionResponse({
    accessKeyId: key.id,
    keyPrefix: key.keyPrefix,
    label: key.label,
    kind: key.kind,
    status: key.status,
    maxDevices: key.maxDevices,
    features: key.features,
    keyHash: key.keyHash,
    sessionLastSeenAt: session.lastSeenAt,
  }));
});

router.get("/access/session", requireAccess, async (_req, res): Promise<void> => {
  res.json(sessionResponse({
    accessKeyId: res.locals.accessKeyId,
    keyPrefix: res.locals.accessKey.keyPrefix,
    label: res.locals.accessKey.label,
    kind: res.locals.accessKey.kind,
    status: res.locals.accessKey.status,
    maxDevices: res.locals.accessKey.maxDevices,
    features: res.locals.accessKey.features,
    keyHash: res.locals.accessKey.keyHash,
    sessionLastSeenAt: new Date(),
  }));
});

router.post("/access/heartbeat", requireAccess, async (_req, res): Promise<void> => {
  const now = new Date();
  await db.update(accessKeySessionsTable)
    .set({ lastSeenAt: now })
    .where(and(eq(accessKeySessionsTable.id, res.locals.accessSessionId), isNull(accessKeySessionsTable.revokedAt)));
  await db.update(accessKeysTable)
    .set({ lastSeenAt: now, updatedAt: now })
    .where(eq(accessKeysTable.id, res.locals.accessKeyId));
  res.json({ success: true });
});

router.post("/access/logout", requireAccess, async (req, res): Promise<void> => {
  await db.update(accessKeySessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(accessKeySessionsTable.id, res.locals.accessSessionId));
  disposeRevokedSession(res.locals.userId);
  res.append("Set-Cookie", clearAccessCookie(secureCookie(req.get("x-forwarded-proto"))));
  res.json({ success: true });
});

router.get("/access/trading-protection", requireAccess, requireAccessAdmin, async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(tradingProtectionSettingsTable).limit(1);
  res.json({
    weekdays_enabled: settings?.weekdaysEnabled ?? false,
    weekends_enabled: settings?.weekendsEnabled ?? false,
    dual_weekends_weekdays_enabled: settings?.dualWeekendsWeekdaysEnabled ?? false,
    updated_at: settings?.updatedAt ?? null,
  });
});

router.patch("/access/trading-protection", requireAccess, requireAccessAdmin, async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const [existing] = await db.select()
    .from(tradingProtectionSettingsTable)
    .limit(1);
  const values = {
    weekdaysEnabled: typeof body.weekdays_enabled === "boolean"
      ? body.weekdays_enabled
      : existing?.weekdaysEnabled ?? false,
    weekendsEnabled: typeof body.weekends_enabled === "boolean"
      ? body.weekends_enabled
      : existing?.weekendsEnabled ?? false,
    dualWeekendsWeekdaysEnabled: typeof body.dual_weekends_weekdays_enabled === "boolean"
      ? body.dual_weekends_weekdays_enabled
      : existing?.dualWeekendsWeekdaysEnabled ?? false,
    updatedAt: new Date(),
  };
  const [settings] = existing
    ? await db.update(tradingProtectionSettingsTable).set(values)
      .where(eq(tradingProtectionSettingsTable.id, existing.id)).returning()
    : await db.insert(tradingProtectionSettingsTable).values({ id: 1, ...values }).returning();
  res.json({
    weekdays_enabled: settings.weekdaysEnabled,
    weekends_enabled: settings.weekendsEnabled,
    dual_weekends_weekdays_enabled: settings.dualWeekendsWeekdaysEnabled,
    updated_at: settings.updatedAt,
  });
});

router.get("/access/feature-settings", requireAccess, async (_req, res): Promise<void> => {
  const [row] = await db.select().from(adminFeatureSettingsTable).limit(1);
  const settings = normalizeFeatureSettings(row?.settings, row?.updatedAt ?? null);
  const isAdmin = isPrimaryAdminKeyHash(res.locals.accessKey.keyHash);
  res.json(sessionFeatureSettings(settings, res.locals.accessKeyId, isAdmin));
});

router.get("/access/feature-announcements/stream", requireAccess, (req, res): void => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const unsubscribe = subscribeGlobalAnnouncements((event) => {
    res.write(`event: announcement\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.patch("/access/feature-settings", requireAccess, requireAccessAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateAdminFeatureSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid feature settings" });
    return;
  }
  const [existing] = await db.select().from(adminFeatureSettingsTable).limit(1);
  const previousSettings = existing?.settings
    && typeof existing.settings === "object"
    && !Array.isArray(existing.settings)
    ? existing.settings as Record<string, unknown>
    : {};
  const previousRevision = previousSettings && typeof previousSettings === "object" && !Array.isArray(previousSettings)
    ? (previousSettings as Record<string, unknown>).global_announcement_revision
    : undefined;
  const featureSettingsById = new Map<string, unknown>();
  if (Array.isArray(previousSettings.features)) {
    for (const item of previousSettings.features) {
      if (item && typeof item === "object" && !Array.isArray(item) && typeof item.feature === "string") {
        featureSettingsById.set(item.feature, item);
      }
    }
  }
  for (const feature of parsed.data.features) featureSettingsById.set(feature.feature, feature);

  const actionControlsById = new Map<string, unknown>();
  if (Array.isArray(previousSettings.action_controls)) {
    for (const item of previousSettings.action_controls) {
      if (
        item && typeof item === "object" && !Array.isArray(item)
        && typeof item.feature === "string" && typeof item.control_id === "string"
      ) {
        actionControlsById.set(`${item.feature}/${item.control_id}`, item);
      }
    }
  }
  for (const control of parsed.data.action_controls ?? []) {
    actionControlsById.set(`${control.feature}/${control.control_id}`, control);
  }
  const values = {
    settings: {
      ...previousSettings,
      ...parsed.data,
      features: [...featureSettingsById.values()],
      action_controls: [...actionControlsById.values()],
      global_announcement_revision: parsed.data.global_announcement_revision
        ?? (typeof previousRevision === "string" ? previousRevision : ""),
    },
    updatedAt: new Date(),
  };
  const [row] = existing
    ? await db.update(adminFeatureSettingsTable).set(values)
      .where(eq(adminFeatureSettingsTable.id, existing.id)).returning()
    : await db.insert(adminFeatureSettingsTable).values({ id: 1, ...values }).returning();
  const settings = normalizeFeatureSettings(row.settings, row.updatedAt);
  publishGlobalAnnouncement({
    enabled: settings.global_announcement_enabled,
    message: settings.global_announcement,
    revision: settings.global_announcement_revision,
  });
  res.json(settings);
});

router.use("/access/keys", requireAccess, requireAccessAdmin);

router.get("/access/keys", async (_req, res): Promise<void> => {
  const keys = await db.select().from(accessKeysTable)
    .where(ne(accessKeysTable.status, "deleted"))
    .orderBy(asc(accessKeysTable.createdAt));
  const response = await Promise.all(keys.map(async (key) => {
    const devices = await deviceSummaries(key.id);
    const onlineDevices = devices.filter((device) => device.online).length;
    return {
      key_id: key.id,
      access_key: isPrimaryAdminKeyHash(key.keyHash) ? null : readableAccessKey(key.encryptedKey),
      key_prefix: key.keyPrefix,
      label: key.label,
      kind: key.kind,
      is_admin: isPrimaryAdminKeyHash(key.keyHash),
      status: key.status,
      max_devices: key.maxDevices,
      device_count: devices.length,
      online_devices: onlineDevices,
      device_sessions: devices,
      online: onlineDevices > 0,
      features: featureList(key.features, key.kind),
      last_seen_at: key.lastSeenAt,
      offline_seconds: offlineSeconds(key.lastSeenAt),
      created_at: key.createdAt,
    };
  }));
  res.json(ListAccessKeysResponse.parse(response));
});

router.post("/access/keys", async (req, res): Promise<void> => {
  const parsed = CreateAccessKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide a label, a valid device limit, and at least one feature" });
    return;
  }
  const kind = parsed.data.kind;
  if (parsed.data.max_devices === 0 && kind !== "admin") {
    res.status(400).json({ error: "Unlimited devices are available only for administrator keys" });
    return;
  }
  const label = parsed.data.label.trim();
  const [labelMatch] = await db.select({ id: accessKeysTable.id })
    .from(accessKeysTable)
    .where(and(
      eq(accessKeysTable.label, label),
      ne(accessKeysTable.status, "deleted"),
    ))
    .limit(1);
  if (labelMatch) {
    res.status(409).json({ error: "That name is already used by another access key. Choose a different name." });
    return;
  }
  const rawKey = generateAccessKey(kind);
  const features = featureList(parsed.data.features, kind);
  const [created] = await db.insert(accessKeysTable).values({
    keyHash: hashSecret(rawKey),
    encryptedKey: encryptAccessKey(rawKey),
    keyPrefix: rawKey.slice(0, 17),
    label,
    kind,
    maxDevices: parsed.data.max_devices,
    features,
  }).returning();
  res.status(201).json(CreateAccessKeyResponse.parse({
    key_id: created.id,
    access_key: rawKey,
    key_prefix: created.keyPrefix,
    label: created.label,
    kind: created.kind,
    is_admin: isPrimaryAdminKeyHash(created.keyHash),
    status: created.status,
    max_devices: created.maxDevices,
    features: featureList(created.features, created.kind),
    online: false,
    last_seen_at: null,
    created_at: created.createdAt,
  }));
});

router.delete("/access/keys/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [current] = await db.select().from(accessKeysTable).where(eq(accessKeysTable.id, id)).limit(1);
  if (!current) {
    res.status(404).json({ error: "Access key not found" });
    return;
  }
  if (isPrimaryAdminKeyHash(current.keyHash)) {
    res.status(400).json({ error: "The primary administrator key cannot be deleted" });
    return;
  }
  if (current.status === "deleted") {
    res.json({ success: true });
    return;
  }

  // Keep the hashed-key tombstone so the deleted credential can never
  // authenticate again. Labels are reusable after deletion.
  await db.update(accessKeysTable)
    .set({ status: "deleted", encryptedKey: null, updatedAt: new Date() })
    .where(eq(accessKeysTable.id, id));
  await revokeActiveSessions(id);
  res.json({ success: true });
});

router.post("/access/keys/:id/reset", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [current] = await db.select().from(accessKeysTable).where(eq(accessKeysTable.id, id)).limit(1);
  if (!current) {
    res.status(404).json({ error: "Access key not found" });
    return;
  }
  if (isPrimaryAdminKeyHash(current.keyHash)) {
    res.status(400).json({ error: "The primary administrator key cannot be replaced" });
    return;
  }

  const rawKey = generateAccessKey(current.kind);
  const [updated] = await db.update(accessKeysTable).set({
    keyHash: hashSecret(rawKey),
    encryptedKey: encryptAccessKey(rawKey),
    keyPrefix: rawKey.slice(0, 17),
    updatedAt: new Date(),
  }).where(eq(accessKeysTable.id, id)).returning();
  await revokeActiveSessions(id);

  res.status(201).json(CreateAccessKeyResponse.parse({
    key_id: updated.id,
    access_key: rawKey,
    key_prefix: updated.keyPrefix,
    label: updated.label,
    kind: updated.kind,
    is_admin: isPrimaryAdminKeyHash(updated.keyHash),
    status: updated.status,
    max_devices: updated.maxDevices,
    features: featureList(updated.features, updated.kind),
    online: false,
    last_seen_at: null,
    created_at: updated.createdAt,
  }));
});

router.patch("/access/keys/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = UpdateAccessKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid access key update" });
    return;
  }
  const [current] = await db.select().from(accessKeysTable).where(eq(accessKeysTable.id, id)).limit(1);
  if (!current) {
    res.status(404).json({ error: "Access key not found" });
    return;
  }
  if (current.status === "banned" && parsed.data.status !== "banned") {
    res.status(400).json({ error: "Banned access keys cannot be restored" });
    return;
  }
  if (parsed.data.max_devices === 0 && current.kind !== "admin") {
    res.status(400).json({ error: "Unlimited devices are available only for administrator keys" });
    return;
  }
  if (id === res.locals.accessKeyId && parsed.data.status && parsed.data.status !== "active") {
    res.status(400).json({ error: "The current administrator key cannot be disabled from its own session" });
    return;
  }

  const nextStatus = parsed.data.status ?? current.status;
  const [updated] = await db.update(accessKeysTable).set({
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
    ...(parsed.data.max_devices !== undefined ? { maxDevices: parsed.data.max_devices } : {}),
    ...(parsed.data.features ? { features: featureList(parsed.data.features, current.kind) } : {}),
    updatedAt: new Date(),
  }).where(eq(accessKeysTable.id, id)).returning();
  if (nextStatus !== "active") {
    await revokeActiveSessions(id);
  }
  const onlineDevices = await onlineDeviceCount(updated.id);
  res.json(ListAccessKeysResponseItem.parse({
    key_id: updated.id,
    access_key: isPrimaryAdminKeyHash(updated.keyHash) ? null : readableAccessKey(updated.encryptedKey),
    key_prefix: updated.keyPrefix,
    label: updated.label,
    kind: updated.kind,
     is_admin: isPrimaryAdminKeyHash(updated.keyHash),
    status: updated.status,
    max_devices: updated.maxDevices,
    device_count: await activeDeviceCount(updated.id),
    online_devices: onlineDevices,
    device_sessions: await deviceSummaries(updated.id),
    online: onlineDevices > 0,
    features: featureList(updated.features, updated.kind),
    last_seen_at: updated.lastSeenAt,
    offline_seconds: offlineSeconds(updated.lastSeenAt),
    created_at: updated.createdAt,
  }));
});

export default router;