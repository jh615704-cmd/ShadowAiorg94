import type {
  AccessFeature,
  AdminIntelligenceFinding,
  AdminIntelligenceScan,
  DiagnosticCode,
  DiagnosticReportInput,
} from "@workspace/api-zod";
import { ACCESS_FEATURES } from "./access-keys";

const FINDING_RETENTION_MS = 30 * 60 * 1_000;
const REPORT_THROTTLE_MS = 30 * 1_000;
const MAX_FINDINGS = 300;

type DiagnosticCopy = Pick<AdminIntelligenceFinding, "summary" | "guidance">;

const diagnosticCopy: Record<DiagnosticCode, DiagnosticCopy> = {
  client_runtime_error: {
    summary: "A browser runtime error was reported.",
    guidance: "This may require a source-code repair and a normal release. No user session or trade state was changed.",
  },
  client_unhandled_rejection: {
    summary: "A browser task failed without a handled response.",
    guidance: "Review the feature and reproduce the issue before changing code. No user session or trade state was changed.",
  },
  api_server_error: {
    summary: "A feature reported an unsuccessful server response.",
    guidance: "Check the service and feature logs. The monitor does not retry mutations or restart services.",
  },
  trade_outcome_uncertain: {
    summary: "A trade request may have been accepted, but its response was not confirmed.",
    guidance: "Check Deriv account history and open contracts before acting. Never resend or clear this state automatically.",
  },
  saved_state_invalid: {
    summary: "Auto Trader 2.0 could not validate saved session state.",
    guidance: "Keep automation paused and verify Deriv history and open contracts. Do not clear or resume an uncertain session.",
  },
  storage_unavailable: {
    summary: "A browser could not save or read feature recovery state.",
    guidance: "The affected user must restore browser storage and review the feature state. No trade was retried.",
  },
};

interface DiagnosticRecord {
  id: string;
  feature: AccessFeature;
  code: DiagnosticCode;
  severity: "warning" | "error";
  firstSeenAt: number;
  lastSeenAt: number;
  occurrences: number;
  sessionReports: Map<string, number>;
}

export class AdminIntelligenceRegistry {
  private readonly records = new Map<string, DiagnosticRecord>();

  report(input: DiagnosticReportInput, sessionId: string, now = Date.now()): void {
    this.prune(now);
    const id = `${input.feature}:${input.code}`;
    let record = this.records.get(id);
    if (!record) {
      record = {
        id,
        feature: input.feature,
        code: input.code,
        severity: input.severity,
        firstSeenAt: now,
        lastSeenAt: now,
        occurrences: 0,
        sessionReports: new Map(),
      };
      this.records.set(id, record);
    }

    const lastReport = record.sessionReports.get(sessionId) ?? 0;
    if (lastReport > 0 && now - lastReport < REPORT_THROTTLE_MS) return;

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

  scan(now = Date.now()): AdminIntelligenceScan {
    this.prune(now);
    const findings = [...this.records.values()]
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .map((record) => ({
        id: record.id,
        feature: record.feature,
        code: record.code,
        severity: record.severity,
        ...diagnosticCopy[record.code],
        first_seen_at: new Date(record.firstSeenAt),
        last_seen_at: new Date(record.lastSeenAt),
        occurrences: record.occurrences,
        affected_sessions: record.sessionReports.size,
        // The current diagnostic categories have no safe one-click repair.
        // In particular, no trade or saved-session action may be automated.
        fix_available: false,
      }));

    const featureStatuses = ACCESS_FEATURES
      .filter((feature): feature is Exclude<AccessFeature, "admin"> => feature !== "admin")
      .map((feature) => {
        const openFindings = findings.filter((finding) => finding.feature === feature).length;
        return {
          feature,
          status: openFindings > 0 ? "issue" as const : "clear" as const,
          open_findings: openFindings,
        };
      });

    return {
      scanned_at: new Date(now),
      server_status: "healthy",
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
