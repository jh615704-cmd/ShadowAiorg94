import { Router, type IRouter } from "express";
import {
  ReviewAdminIntelligenceFindingBody,
  ReviewAdminIntelligenceFindingParams,
  ReviewAdminIntelligenceFindingResponse,
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
  const mayReportSharedDashboard = parsed.data.feature === "dashboard"
    && Boolean(allowedFeatures?.some((feature) => feature !== "admin"));
  if (!isAdminKey && !allowedFeatures?.includes(parsed.data.feature) && !mayReportSharedDashboard) {
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

router.post(
  "/admin/intelligence/findings/:id/review",
  requireAccess,
  requireAccessAdmin,
  (req, res): void => {
    const params = ReviewAdminIntelligenceFindingParams.safeParse({ id: req.params.id });
    const body = ReviewAdminIntelligenceFindingBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Explicit review confirmation is required" });
      return;
    }

    const result = adminIntelligenceRegistry.review(params.data.id);
    if (!result) {
      res.status(404).json({ error: "Diagnostic finding was not found" });
      return;
    }
    res.json(ReviewAdminIntelligenceFindingResponse.parse(result));
  },
);

export default router;
