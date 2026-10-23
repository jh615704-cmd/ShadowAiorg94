import { Router, type IRouter } from "express";
import {
  ReportAccessDiagnosticBody,
  ReportAccessDiagnosticResponse,
  ScanAdminIntelligenceResponse,
} from "@workspace/api-zod";
import { requireAccess, requireAccessAdmin } from "../middlewares/requireAccess";
import { adminIntelligenceRegistry } from "../lib/admin-intelligence";

const router: IRouter = Router();

router.post("/access/diagnostics", requireAccess, (req, res): void => {
  const parsed = ReportAccessDiagnosticBody.safeParse(req.body);
  if (!parsed.success || parsed.data.feature === "admin") {
    res.status(400).json({ error: "Invalid diagnostic report" });
    return;
  }

  const allowedFeatures = res.locals.accessKey?.features as string[] | undefined;
  const isAdminKey = res.locals.accessKey?.kind === "admin";
  if (!isAdminKey && !allowedFeatures?.includes(parsed.data.feature)) {
    res.status(403).json({ error: "This access key cannot report that feature" });
    return;
  }

  const sessionId = String(res.locals.accessSessionId ?? "");
  if (!sessionId) {
    res.status(401).json({ error: "Access session required" });
    return;
  }

  adminIntelligenceRegistry.report(parsed.data, sessionId);
  res.status(202).json(ReportAccessDiagnosticResponse.parse({ accepted: true }));
});

router.get(
  "/admin/intelligence/scan",
  requireAccess,
  requireAccessAdmin,
  (_req, res): void => {
    res.json(ScanAdminIntelligenceResponse.parse(adminIntelligenceRegistry.scan()));
  },
);

export default router;
