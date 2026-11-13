import type {
  AdminIntelligenceFinding,
  AdminIntelligenceFindingReviewResponse,
  AdminIntelligenceScan,
  DiagnosticCode,
  DiagnosticFeature,
  DiagnosticOperation,
  DiagnosticSource,
  DiagnosticReportInput,
} from "@workspace/api-zod";
import { ACCESS_FEATURES } from "./access-keys";

const FINDING_RETENTION_MS = 30 * 60 * 1_000;
const REPORT_THROTTLE_MS = 30 * 1_000;
const MAX_FINDINGS = 300;

type DiagnosticCopy = Pick<AdminIntelligenceFinding, "summary" | "likely_cause" | "guidance">;

const diagnosticCopy: Record<DiagnosticCode, DiagnosticCopy> = {
  client_runtime_error: {
    summary: "A browser runtime error was reported.",
    likely_cause: "A browser code path threw an error; the diagnostic intentionally does not collect the raw message or stack.",
    guidance: "Review the named feature's sanitized reports and reproduce the issue before changing code. A source repair needs a normal release; no user or trade state was changed.",
  },
  client_unhandled_rejection: {
    summary: "A browser task failed without a handled response.",
    likely_cause: "An asynchronous browser operation rejected without a handled response; the exact cause is not collected.",
    guidance: "Review the named feature and reproduce the issue before changing code. No user or trade state was changed.",
  },
  api_server_error: {
    summary: "A feature reported an unsuccessful server response.",
    likely_cause: "The browser received a server failure or could not complete an API request; this report alone cannot distinguish a transient connection from a service fault.",
    guidance: "Compare the report time with service logs. Retry safe reads only; never replay a trade mutation based only on this report.",
  },
  trade_outcome_uncertain: {
    summary: "A trade request may have been accepted, but its response was not confirmed.",
    likely_cause: "The response was lost, malformed, or inconclusive after a trade request; Deriv may still have accepted the order.",
    guidance: "Check Deriv history and open contracts before acting. Never resend or clear an uncertain order automatically. The diagnostic scanner does not change Deriv contracts or account history.",
  },
  saved_state_invalid: {
    summary: "Auto Trader 2.0 could not validate saved session state.",
    likely_cause: "Browser-saved Auto Trader 2.0 state did not pass the feature's recovery checks.",
    guidance: "Keep automation paused and verify Deriv history and open contracts. Do not clear or resume an uncertain session.",
  },
  storage_unavailable: {
    summary: "A browser could not save or read feature recovery state.",
    likely_cause: "The browser reported that local storage could not complete a feature-state read or write.",
    guidance: "The affected user should restore browser storage and review the feature state. Do not clear browser data remotely; no trade was retried.",
  },
};

const scanCoverage = {
  mode: "reported_client_signals" as const,
  reported_signal_categories: [
    "Browser runtime errors and unhandled rejections reported by connected dashboard sessions.",
    "API transport and server failures observed by the shared API client.",
    "Uncertain or partially confirmed trade responses from instrumented single, bulk, dual, sell, and Clock Work requests.",
    "Auto Trader 2.0 saved-state validation and browser-storage failures.",
  ],
  not_directly_scanned: [
    "Current Deriv open contracts, overlapping positions, or account history.",
    "Live market tick freshness or feature-specific history refresh freshness.",
    "Automation activity on user devices that has not submitted a diagnostic report.",
  ],
  note: "Reports are aggregated for up to 30 minutes. No report means no signal was received; it is not proof that a feature or account is healthy. Overlapping and uncertain trades require manual review in Deriv history and open contracts.",
};

interface DiagnosticRecord {
  id: string;
  feature: DiagnosticFeature;
  code: DiagnosticCode;
  operation?: DiagnosticOperation;
  source: DiagnosticSource;
  severity: "warning" | "error";
  firstSeenAt: number;
  lastSeenAt: number;
  occurrences: number;
  sessionReports: Map<string, number>;
  reviewedAt: number | null;
  reviewedBy: "administrator" | null;
}

export class AdminIntelligenceRegistry {
  private readonly records = new Map<string, DiagnosticRecord>();

  report(input: DiagnosticReportInput, sessionId: string, now = Date.now()): void {
    this.prune(now);
    const source = input.source ?? "unknown";
    const operation = input.operation;
    const id = `${input.feature}:${input.code}:${operation ?? "unspecified"}:${source}`;
    let record = this.records.get(id);
    const wasReviewed = record?.reviewedAt != null;
    if (!record) {
      record = {
        id,
        feature: input.feature,
        code: input.code,
        ...(operation ? { operation } : {}),
        source,
        severity: input.severity,
        firstSeenAt: now,
        lastSeenAt: now,
        occurrences: 0,
        sessionReports: new Map(),
        reviewedAt: null,
        reviewedBy: null,
      };
      this.records.set(id, record);
    }

    // A fresh report reopens the finding after an administrator acknowledged it.
    if (wasReviewed) {
      record.reviewedAt = null;
      record.reviewedBy = null;
    }
    const lastReport = record.sessionReports.get(sessionId) ?? 0;
    if (!wasReviewed && lastReport > 0 && now - lastReport < REPORT_THROTTLE_MS) return;

    record.sessionReports.set(sessionId, now);
    record.lastSeenAt = now;
    record.occurrences += 1;
    if (input.severity === "error") record.severity = "error";

    while (this.records.size > MAX_FINDINGS) {
      const oldestId = this.records.keys().next().value;
      if (!oldestId) break;
      this.records.delete(oldestId);
    }
  }

  review(id: string, now = Date.now()): AdminIntelligenceFindingReviewResponse | null {
    this.prune(now);
    const record = this.records.get(id);
    if (!record) return null;

    record.reviewedAt = now;
    record.reviewedBy = "administrator";
    return {
      id: record.id,
      reviewed_at: new Date(now),
      reviewed_by: "administrator",
    };
  }

  scan(now = Date.now()): AdminIntelligenceScan {
    this.prune(now);
    const findings = [...this.records.values()]
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .map((record) => {
        const isAutoTrader2UncertainOrder = record.feature === "auto-trader-2"
          && record.code === "trade_outcome_uncertain";
        const copy = isAutoTrader2UncertainOrder
          ? {
            summary: "The last order may have been submitted. Check Deriv history and open contracts before deciding what to do.",
            likely_cause: "Auto Trader 2.0 could not confirm whether Deriv accepted the most recent order.",
            guidance: "Auto Trader 2.0 will not resend the order. A pending or uncertain order must be reviewed before clearing this feature's history. The diagnostic scanner does not change Deriv contracts or account history.",
          }
          : diagnosticCopy[record.code];

        const affectedSessions = record.sessionReports.size;
        return {
          id: record.id,
          feature: record.feature,
          code: record.code,
          ...(record.operation ? { operation: record.operation } : {}),
          source: record.source,
          severity: record.severity,
          ...copy,
          evidence: `${record.occurrences} sanitized report${record.occurrences === 1 ? "" : "s"} from ${affectedSessions} access session${affectedSessions === 1 ? "" : "s"}${record.operation ? `; operation: ${record.operation}` : ""}; reported source: ${record.source}.`,
          resolution_status: record.reviewedAt != null
            ? "review_acknowledged" as const
            : record.code === "trade_outcome_uncertain" || record.code === "saved_state_invalid"
              ? "review_required" as const
              : "recovery_unconfirmed" as const,
          reviewed_at: record.reviewedAt == null ? null : new Date(record.reviewedAt),
          reviewed_by: record.reviewedBy,
          first_seen_at: new Date(record.firstSeenAt),
          last_seen_at: new Date(record.lastSeenAt),
          occurrences: record.occurrences,
          affected_sessions: affectedSessions,
          // The current diagnostic categories have no safe one-click repair.
          // In particular, no trade or saved-session action may be automated.
          fix_available: false,
        };
      });

    const featureStatuses = (["dashboard", ...ACCESS_FEATURES.filter((feature) => feature !== "admin")] as DiagnosticFeature[])
      .map((feature) => {
        const recentFindings = findings.filter((finding) => finding.feature === feature).length;
        return {
          feature,
          status: recentFindings > 0 ? "reports_received" as const : "no_reports" as const,
          recent_findings: recentFindings,
        };
      });

    return {
      scanned_at: new Date(now),
      server_status: "healthy",
      coverage: scanCoverage,
      features: featureStatuses,
      findings,
    };
  }

  private prune(now: number): void {
    for (const [id, record] of this.records) {
      if (now - record.lastSeenAt >= FINDING_RETENTION_MS) {
        this.records.delete(id);
        continue;
      }
      for (const [sessionId, reportedAt] of record.sessionReports) {
        if (now - reportedAt >= FINDING_RETENTION_MS) {
          record.sessionReports.delete(sessionId);
        }
      }
    }
  }
}

export const adminIntelligenceRegistry = new AdminIntelligenceRegistry();
