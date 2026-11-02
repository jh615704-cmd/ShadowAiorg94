import { useEffect } from "react";

type DiagnosticCode =
  | "client_runtime_error"
  | "client_unhandled_rejection"
  | "api_server_error"
  | "trade_outcome_uncertain"
  | "saved_state_invalid"
  | "storage_unavailable";

type DiagnosticFeature =
  | "edge"
  | "digit-flip"
  | "trade-x"
  | "bulk-trader"
  | "jackpot"
  | "clock-work"
  | "cash-grab"
  | "money-bank"
  | "jdy-ai-3"
  | "auto-trader"
  | "auto-trader-2"
  | "settings"
  | "history";

type DiagnosticSource = "browser_app" | "api_server" | "deriv" | "transport" | "unknown";

const allowedFeatures = new Set<DiagnosticFeature>([
  "edge",
  "digit-flip",
  "trade-x",
  "bulk-trader",
  "jackpot",
  "clock-work",
  "cash-grab",
  "money-bank",
  "jdy-ai-3",
  "auto-trader",
  "auto-trader-2",
  "settings",
  "history",
]);

const diagnosticWindow = window as Window & {
  __shadowDiagnosticLastSent?: Map<string, number>;
};

function featureForCurrentRoute(): DiagnosticFeature | null {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/auto-trader-2")) return "auto-trader-2";
  if (path.startsWith("/auto-trader")) return "auto-trader";
  if (path.startsWith("/settings") || path.startsWith("/dashboard")) return "settings";
  if (path.startsWith("/admin") || path.startsWith("/sign-in")) return null;
  return "trade-x";
}

function sendDiagnostic(
  feature: DiagnosticFeature,
  code: DiagnosticCode,
  severity: "warning" | "error",
  source: DiagnosticSource,
) {
  const now = Date.now();
  const key = `${feature}:${code}:${source}`;
  const lastSent = diagnosticWindow.__shadowDiagnosticLastSent ?? new Map<string, number>();
  diagnosticWindow.__shadowDiagnosticLastSent = lastSent;
  if (now - (lastSent.get(key) ?? 0) < 30_000) return;
  lastSent.set(key, now);

  void fetch("/api/access/diagnostics", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ feature, code, severity, source }),
  }).catch(() => undefined);
}

export function AdminDiagnosticsReporter() {
  useEffect(() => {
    const report = (
      code: DiagnosticCode,
      severity: "warning" | "error",
      feature?: DiagnosticFeature,
      source: DiagnosticSource = "browser_app",
    ) => {
      const resolvedFeature = feature ?? featureForCurrentRoute();
      if (!resolvedFeature || !allowedFeatures.has(resolvedFeature)) return;
      sendDiagnostic(resolvedFeature, code, severity, source);
    };

    const onError = () => report("client_runtime_error", "error");
    const onUnhandledRejection = () => report("client_unhandled_rejection", "error");
    const onFeatureDiagnostic = (event: Event) => {
      const detail = (event as CustomEvent<{
        feature?: unknown;
        code?: unknown;
        severity?: unknown;
        source?: unknown;
      }>).detail;
      if (!detail || typeof detail !== "object") return;
      if (
        typeof detail.feature !== "string"
        || !allowedFeatures.has(detail.feature as DiagnosticFeature)
        || !["client_runtime_error", "client_unhandled_rejection", "api_server_error", "trade_outcome_uncertain", "saved_state_invalid", "storage_unavailable"].includes(String(detail.code))
        || (detail.severity !== "warning" && detail.severity !== "error")
      ) return;
      const source = ["browser_app", "api_server", "deriv", "transport", "unknown"].includes(String(detail.source))
        ? detail.source as DiagnosticSource
        : "unknown";
      report(detail.code as DiagnosticCode, detail.severity, detail.feature as DiagnosticFeature, source);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("shadow-admin-diagnostic", onFeatureDiagnostic);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("shadow-admin-diagnostic", onFeatureDiagnostic);
    };
  }, []);

  return null;
}
