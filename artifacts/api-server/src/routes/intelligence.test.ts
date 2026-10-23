import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mock, test } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";

const sampleScan = {
  scanned_at: new Date("2026-10-23T20:00:00.000Z"),
  server_status: "healthy",
  features: [{ feature: "auto-trader-2", status: "issue", open_findings: 1 }],
  findings: [],
};

mock.module("../middlewares/requireAccess", {
  namedExports: {
    requireAccess: (req: Request, res: Response, next: NextFunction) => {
      const keyKind = req.header("x-test-access");
      if (keyKind !== "primary-admin" && keyKind !== "user") {
        res.status(401).json({ error: "An access key is required" });
        return;
      }
      res.locals.accessKey = {
        keyHash: keyKind === "primary-admin" ? "primary-admin-hash" : "user-key-hash",
      };
      next();
    },
    requireAccessAdmin: (_req: Request, res: Response, next: NextFunction) => {
      if (res.locals.accessKey?.keyHash !== "primary-admin-hash") {
        res.status(403).json({ error: "Primary administrator access key required" });
        return;
      }
      next();
    },
  },
});

mock.module("../lib/admin-intelligence", {
  namedExports: {
    adminIntelligenceRegistry: {
      report: () => undefined,
      scan: () => sampleScan,
    },
  },
});

const { default: intelligenceRouter } = await import("./intelligence.ts");

test("diagnostics scan is available only to the primary administrator access session", async () => {
  const app = express();
  app.use("/api", intelligenceRouter);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/admin/intelligence/scan`;

  try {
    const anonymous = await fetch(url);
    assert.equal(anonymous.status, 401);

    const regularUser = await fetch(url, { headers: { "x-test-access": "user" } });
    assert.equal(regularUser.status, 403);

    const admin = await fetch(url, { headers: { "x-test-access": "primary-admin" } });
    assert.equal(admin.status, 200);
    const payload = await admin.json() as { features: Array<{ feature: string }> };
    assert.equal(payload.features[0]?.feature, "auto-trader-2");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
