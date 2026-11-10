import type { RequestHandler } from "express";
import { db, adminFeatureSettingsTable } from "@workspace/db";
import { FEATURE_ACTION_CATALOG } from "@workspace/api-zod";
import {
  findSessionByToken,
  featureList,
  TRADING_ACCESS_FEATURES,
  hashSecret,
  isPrimaryAdminKeyHash,
  parseAccessCookie,
} from "../lib/access-keys";

type FeatureStatus = "restricted" | "coming_soon" | "under_construction";

function featureStatusMessage(mode: string, notice: string) {
  const label = mode === "restricted"
    ? "Restricted — admin access only"
    : mode === "coming_soon"
      ? "Coming soon"
      : "Under construction";
  return notice ? `${label}: ${notice}` : label;
}

async function blockedFeatures(features: string[], accessKeyId: string) {
  const [row] = await db.select().from(adminFeatureSettingsTable).limit(1);
  const settings = row?.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return features.map(() => null);
  const controls = (settings as { features?: unknown }).features;
  if (!Array.isArray(controls)) return features.map(() => null);
  return features.map((feature) => {
    const control = controls.find((item) =>
      Boolean(item)
      && typeof item === "object"
      && !Array.isArray(item)
      && (item as { feature?: unknown }).feature === feature,
    ) as {
      mode?: unknown;
      audience?: unknown;
      user_ids?: unknown;
      notice?: unknown;
    } | undefined;
    if (!control || typeof control.mode !== "string" || control.mode === "available") return null;
    const targeted = control.audience !== "specific"
      || (Array.isArray(control.user_ids) && control.user_ids.includes(accessKeyId));
    if (!targeted) return null;
    const mode = control.mode as FeatureStatus;
    if (!["restricted", "coming_soon", "under_construction"].includes(mode)) return null;
    return {
      feature,
      mode,
      message: featureStatusMessage(mode, typeof control.notice === "string" ? control.notice : ""),
    };
  });
}

async function blockedFeature(feature: string, accessKeyId: string) {
  return (await blockedFeatures([feature], accessKeyId))[0] ?? null;
}

async function blockedFeatureAction(feature: string, controlId: string) {
  const [row] = await db.select().from(adminFeatureSettingsTable).limit(1);
  const settings = row?.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const controls = (settings as { action_controls?: unknown }).action_controls;
  if (!Array.isArray(controls)) return null;
  const control = controls.find((item) =>
    Boolean(item)
    && typeof item === "object"
    && !Array.isArray(item)
    && (item as { feature?: unknown }).feature === feature
    && (item as { control_id?: unknown }).control_id === controlId,
  ) as { mode?: unknown; label?: unknown } | undefined;
  if (!control || typeof control.mode !== "string" || control.mode === "available") return null;
  if (!["restricted", "coming_soon", "under_construction"].includes(control.mode)) return null;
  return {
    feature,
    control_id: controlId,
    message: `${featureStatusMessage(control.mode, "")}: ${typeof control.label === "string" ? control.label : "This control"} is unavailable.`,
  };
}

export const requireAccess: RequestHandler = async (req, res, next) => {
  try {
    const rawToken = parseAccessCookie(req.headers.cookie);
    if (!rawToken) {
      res.status(401).json({ error: "An access key is required" });
      return;
    }

    const session = await findSessionByToken(hashSecret(rawToken));
    if (!session) {
      res.status(401).json({ error: "Access session expired. Enter your access key again." });
      return;
    }
    if (session.status !== "active") {
      const message = session.status === "banned"
        ? "This access key is permanently banned"
        : `This access key is ${session.status}`;
      res.status(403).json({ error: message });
      return;
    }
    if (session.revokedAt) {
      res.status(401).json({ error: "Access session expired. Enter your access key again." });
      return;
    }

    res.locals.accessKeyId = session.accessKeyId;
    res.locals.accessSessionId = session.sessionId;
    // Deriv credentials and runtime state belong to this browser session,
    // not to the reusable access-key record. A second session using the same
    // key must enter its own PAT and choose its own account.
    res.locals.userId = session.sessionId;
    res.locals.accessKey = {
      ...session,
      features: featureList(session.features, session.kind),
    };
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAccessFeature = (feature: string): RequestHandler => async (_req, res, next) => {
  const features = res.locals.accessKey?.features as string[] | undefined;
  const keyHash = res.locals.accessKey?.keyHash as string | undefined;
  if (keyHash && isPrimaryAdminKeyHash(keyHash)) {
    next();
    return;
  }
  if (!features?.includes(feature)) {
    res.status(403).json({ error: `Restricted — admin access only: this access key does not include the ${feature} feature` });
    return;
  }
  const blocked = await blockedFeature(feature, String(res.locals.accessKeyId ?? ""));
  if (blocked) {
    res.status(403).json({ error: blocked.message, code: "FEATURE_UNAVAILABLE", feature: blocked.feature });
    return;
  }
  next();
};

function tradeActionControlId(feature: string, path: string, body: Record<string, unknown>): string | undefined {
  const contractType = typeof body.contract_type === "string" ? body.contract_type : "";
  if (
    body.automated === true
    && ["edge", "digit-flip", "trade-x", "bulk-trader", "cash-grab"].includes(feature)
  ) return "ai-scanner";
  if (feature === "auto-trader" && body.automated === true) return "auto-magic";
  if (path === "/deriv/dual-buy") return "trade-dual";
  if (path === "/deriv/jackpot/buy") return "place-batch";
  if (feature === "auto-trader" && path === "/deriv/bulk-buy") {
    const symbol = typeof body.symbol === "string" ? body.symbol.toLowerCase().replaceAll("_", "-") : "";
    const digit = typeof body.barrier === "number" ? String(body.barrier) : "";
    const count = body.count;
    if (symbol && digit && (count === 3 || count === 6)) return `trade-${count}x-${symbol}-${digit}`;
  }
  if (feature === "bulk-trader" || path === "/deriv/bulk-buy") {
    if (contractType === "DIGITOVER") return "trade-over";
    if (contractType === "DIGITUNDER") return "trade-under";
    if (contractType === "DIGITEVEN") return "trade-even";
    if (contractType === "DIGITODD") return "trade-odd";
    if (contractType === "DIGITDIFF") return "trade-differs";
  }
  if (feature === "edge") {
    if (contractType === "DIGITOVER") return "trade-over";
    if (contractType === "DIGITUNDER") return "trade-under";
    return "start";
  }
  if (feature === "digit-flip") return "start-stop";
  if (feature === "trade-x") return "place-differs";
  if (feature === "cash-grab") return "start";
  if (feature === "jackpot") return "place-batch";
  if (feature === "clock-work") return "start";
  if (feature === "money-bank") return "start-stop";
  if (feature === "auto-trader-2") return "start";
  if (feature === "speedbot") return "start";
  if (feature === "auto-trader") {
    if (contractType === "DIGITOVER") return "trade-over";
    if (contractType === "DIGITUNDER") return "trade-under";
    return "go-live";
  }
  return undefined;
}

export const requireTradeAccessFeature: RequestHandler = async (req, res, next) => {
  const feature = req.body && typeof req.body === "object" ? req.body.access_feature : undefined;
  if (typeof feature !== "string" || !TRADING_ACCESS_FEATURES.includes(feature as typeof TRADING_ACCESS_FEATURES[number])) {
    res.status(400).json({ error: "A valid access_feature is required to place this trade." });
    return;
  }
  const keyHash = res.locals.accessKey?.keyHash as string | undefined;
  if (keyHash && isPrimaryAdminKeyHash(keyHash)) {
    next();
    return;
  }
  const features = res.locals.accessKey?.features as string[] | undefined;
  if (!features?.includes(feature)) {
    res.status(403).json({ error: `Restricted — admin access only: this access key does not include the ${feature} feature` });
    return;
  }
  const accessKeyId = String(res.locals.accessKeyId ?? "");
  const featureBlock = await blockedFeature(feature, accessKeyId);
  if (featureBlock) {
    res.status(403).json({ error: featureBlock.message, code: "FEATURE_UNAVAILABLE", feature });
    return;
  }
  const controlId = tradeActionControlId(feature, req.path, req.body as Record<string, unknown>);
  if (!controlId || !FEATURE_ACTION_CATALOG.some((control) => control.feature === feature && control.control_id === controlId)) {
    res.status(400).json({ error: "The trade action could not be matched to an available feature control." });
    return;
  }
  const actionBlock = await blockedFeatureAction(feature, controlId);
  if (actionBlock) {
    res.status(403).json({
      error: actionBlock.message,
      code: "FEATURE_ACTION_UNAVAILABLE",
      feature,
      control_id: controlId,
    });
    return;
  }
  next();
};

export const requireFeatureAction = (feature: string, controlId: string): RequestHandler => async (_req, res, next) => {
  const keyHash = res.locals.accessKey?.keyHash as string | undefined;
  if (keyHash && isPrimaryAdminKeyHash(keyHash)) {
    next();
    return;
  }
  const blocked = await blockedFeatureAction(feature, controlId);
  if (blocked) {
    res.status(403).json({
      error: blocked.message,
      code: "FEATURE_ACTION_UNAVAILABLE",
      feature,
      control_id: controlId,
    });
    return;
  }
  next();
};

export const requireAnyAccessFeature = (...allowedFeatures: string[]): RequestHandler => async (_req, res, next) => {
  const features = res.locals.accessKey?.features as string[] | undefined;
  const keyHash = res.locals.accessKey?.keyHash as string | undefined;
  if (keyHash && isPrimaryAdminKeyHash(keyHash)) {
    next();
    return;
  }
  const grants = features?.filter((feature) => allowedFeatures.includes(feature)) ?? [];
  if (!grants.length) {
    res.status(403).json({ error: `Restricted — admin access only: this access key does not include one of: ${allowedFeatures.join(", ")}` });
    return;
  }
  const accessKeyId = String(res.locals.accessKeyId ?? "");
  const controls = await blockedFeatures(grants, accessKeyId);
  if (controls.some((control) => control === null)) {
    next();
    return;
  }
  const blocked = controls.find((control) => control !== null);
  res.status(403).json({
    error: blocked?.message ?? "The available features for this access key are restricted.",
    code: "FEATURE_UNAVAILABLE",
    feature: blocked?.feature,
  });
};

export const requireAccessAdmin: RequestHandler = (req, res, next) => {
  if (res.locals.accessKey?.keyHash && isPrimaryAdminKeyHash(res.locals.accessKey.keyHash)) {
    next();
    return;
  }
  res.status(403).json({ error: "Primary administrator access key required" });
};
