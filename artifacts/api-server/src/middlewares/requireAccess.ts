import type { RequestHandler } from "express";
import { db, adminFeatureSettingsTable } from "@workspace/db";
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

export const requireTradeAccessFeature: RequestHandler = async (req, res, next) => {
  const feature = req.body && typeof req.body === "object" ? req.body.access_feature : undefined;
  if (typeof feature !== "string" || !TRADING_ACCESS_FEATURES.includes(feature as typeof TRADING_ACCESS_FEATURES[number])) {
    res.status(400).json({ error: "A valid access_feature is required to place this trade." });
    return;
  }
  await requireAccessFeature(feature)(req, res, next);
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
