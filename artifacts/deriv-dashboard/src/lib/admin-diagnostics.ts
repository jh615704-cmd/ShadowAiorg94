export type AdminDiagnosticCode =
  | "client_runtime_error"
  | "client_unhandled_rejection"
  | "api_server_error"
  | "trade_outcome_uncertain"
  | "saved_state_invalid"
  | "storage_unavailable";

export type AdminDiagnosticFeature =
  | "edge"
  | "digit-flip"
  | "trade-x"
  | "bulk-trader"
  | "clock-work"
  | "cash-grab"
  | "money-bank"
  | "jdy-ai-3"
  | "auto-trader"
  | "auto-trader-2"
  | "settings"
  | "history";

export type AdminDiagnosticSource =
  | "browser_app"
  | "api_server"
  | "deriv"
  | "transport"
  | "unknown";

export function reportAdminDiagnostic(
  feature: AdminDiagnosticFeature,
  code: AdminDiagnosticCode,
  severity: "warning" | "error",
  source: AdminDiagnosticSource = "browser_app",
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("shadow-admin-diagnostic", {
    detail: { feature, code, severity, source },
  }));
}
