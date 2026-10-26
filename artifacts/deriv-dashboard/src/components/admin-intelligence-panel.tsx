import { getScanAdminIntelligenceQueryKey, useScanAdminIntelligence } from "@workspace/api-client-react";
import { Activity, AlertTriangle, ArrowUpRight, Check, Clock3, LockKeyhole, MessageSquareText, RefreshCw, ShieldCheck } from "lucide-react";
import "./admin-intelligence-panel.css";

const featureLabels: Record<string, string> = {
  edge: "Edge",
  "digit-flip": "Digit Flip",
  "trade-x": "Trade X",
  "bulk-trader": "Bulk Trader",
  "matches-analysis": "Matches Analysis",
  "clock-work": "Clock Work",
  "cash-grab": "Cash Grab",
  "money-bank": "Money Bank",
  "jdy-ai-3": "JDY AI 3",
  "auto-trader": "Auto Trader",
  "auto-trader-2": "Auto Trader 2",
  settings: "Settings",
  history: "History",
  admin: "Admin",
};

const codeLabels: Record<string, string> = {
  client_runtime_error: "Client runtime",
  client_unhandled_rejection: "Unhandled rejection",
  api_server_error: "Server response",
  trade_outcome_uncertain: "Trade outcome uncertain",
  saved_state_invalid: "Saved state",
  storage_unavailable: "Browser storage",
};

const sourceLabels: Record<string, string> = {
  browser_app: "Browser app",
  api_server: "App API",
  deriv: "Deriv",
  transport: "Connection",
  unknown: "Unverified",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function featureName(value: string) {
  return featureLabels[value] ?? value.replaceAll("-", " ");
}

function findingSafeguard(code: string, source: string) {
  if (code === "trade_outcome_uncertain") {
    const sourceDescriptions: Record<string, string> = {
      browser_app: "The browser app reported this issue.",
      api_server: "The app API reported this issue.",
      deriv: "Deriv returned this issue.",
      transport: "The connection transport reported this issue.",
      unknown: "The origin could not be verified.",
    };
    return `${sourceDescriptions[source] ?? sourceDescriptions.unknown} This attribution does not prove fault. Review Deriv history and open contracts before resuming; do not replay or alter a contract.`;
  }
  if (code === "client_runtime_error" || code === "client_unhandled_rejection") {
    return "A source-code repair needs review and a release. This monitor will not change running user sessions.";
  }
  if (code === "saved_state_invalid") {
    return "Keep automation paused and review Deriv history and open contracts before clearing or resuming saved state.";
  }
  if (code === "storage_unavailable") {
    return "The affected user must restore browser storage. This monitor cannot safely change another user's browser state.";
  }
  return "No verified one-click repair is available. Review the feature and its service logs before making changes.";
}

export default function AdminIntelligencePanel() {
  const scan = useScanAdminIntelligence({
    query: {
      queryKey: getScanAdminIntelligenceQueryKey(),
      refetchInterval: 5000,
      refetchIntervalInBackground: true,
    },
  });
  const data = scan.data;
  const features = data?.features ?? [];
  const findings = data?.findings ?? [];
  const openCount = features.reduce((total, feature) => total + feature.open_findings, 0);
  const issueCount = features.filter((feature) => feature.status === "issue").length;

  return (
    <section className="intel-panel" aria-labelledby="intel-title">
      <header className="intel-header">
        <div className="intel-heading">
          <div className="intel-mark" aria-hidden="true"><Activity size={18} strokeWidth={2.2} /></div>
          <div>
            <p className="intel-eyebrow">OPERATIONS / DIAGNOSTICS</p>
            <h2 id="intel-title">Diagnostics chat</h2>
            <p className="intel-subtitle">Read-only, rule-based checks every five seconds. No AI; no user or trade state is changed.</p>
          </div>
        </div>
        <div className="intel-scan-state" data-testid="status-intelligence-scan">
          <span className="intel-live-dot" />
          <span>5-second scan</span>
          <span className="intel-scan-divider" />
          <span>{scan.isFetching ? "Checking" : "Polling"}</span>
        </div>
      </header>

      {scan.isLoading ? (
        <div className="intel-loading" aria-label="Loading diagnostics" data-testid="state-intelligence-loading">
          <div className="intel-loading-top"><span /><span /><span /></div>
          <div className="intel-loading-row"><span /><span /></div>
          <div className="intel-loading-row"><span /><span /></div>
          <div className="intel-loading-row"><span /><span /></div>
        </div>
      ) : scan.isError && !data ? (
        <div className="intel-state intel-error" data-testid="state-intelligence-error">
          <div className="intel-state-icon"><AlertTriangle size={19} /></div>
          <div className="intel-state-copy">
            <strong>Diagnostics are temporarily unavailable</strong>
            <p>The latest scan could not be loaded. Existing trading sessions are not interrupted.</p>
          </div>
          <button className="intel-retry" onClick={() => void scan.refetch()} data-testid="button-retry-intelligence">
            <RefreshCw size={14} /> Try scan again
          </button>
        </div>
      ) : data ? (
        <>
          <div className="intel-overview">
            <div className={`intel-health ${issueCount ? "has-issues" : "is-clear"}`}>
              <span className="intel-health-icon">{issueCount ? <AlertTriangle size={17} /> : <ShieldCheck size={18} />}</span>
              <span className="intel-health-copy">
                <strong>{issueCount ? `${issueCount} feature${issueCount === 1 ? "" : "s"} need attention` : "Systems clear"}</strong>
                <small>{data.server_status === "healthy" ? "Diagnostic service healthy" : "Service status reported"}</small>
              </span>
            </div>
            <div className="intel-metric">
              <strong>{features.length}</strong><span>features watched</span>
            </div>
            <div className="intel-metric">
              <strong>{openCount}</strong><span>open findings</span>
            </div>
            <div className="intel-updated">
              <Clock3 size={14} />
              <span><small>LAST SCAN</small><b>{formatDate(data.scanned_at)}</b></span>
            </div>
          </div>

          <div className="intel-feature-strip" aria-label="Feature status" data-testid="list-intelligence-features">
            <div className="intel-section-label"><span>FEATURE STATUS</span><span>{features.length} monitored</span></div>
            <div className="intel-feature-list">
              {features.map((feature) => (
                <div className={`intel-feature ${feature.status === "issue" ? "feature-issue" : "feature-clear"}`} key={feature.feature} data-testid={`status-feature-${feature.feature}`}>
                  <span className="intel-feature-led">{feature.status === "issue" ? <AlertTriangle size={12} /> : <Check size={12} />}</span>
                  <span className="intel-feature-name">{featureName(feature.feature)}</span>
                  {feature.open_findings > 0 && <b>{feature.open_findings}</b>}
                </div>
              ))}
            </div>
          </div>

          <div className="intel-feed-heading">
            <div><span className="intel-section-label">DIAGNOSTIC CHAT</span><span className="intel-feed-count">{findings.length.toString().padStart(2, "0")}</span></div>
            <span className="intel-feed-caption">Read-only reports · newest first</span>
          </div>

          {scan.isError && (
            <div className="intel-stale-note" role="status">The latest refresh failed. Showing the last successful scan.</div>
          )}

          {findings.length === 0 ? (
            <div className="intel-empty" data-testid="state-intelligence-empty">
              <span className="intel-empty-icon"><ShieldCheck size={21} /></span>
              <strong>No feature issues reported</strong>
              <p>All monitored features are clear. I’ll check again in five seconds while this admin panel is open.</p>
            </div>
          ) : (
            <ol className="intel-chat-thread" aria-live="polite" data-testid="list-intelligence-findings">
              {findings.map((finding) => {
                return (
                  <li className="intel-chat-message" key={finding.id} data-testid={`finding-${finding.id}`}>
                    <span className="intel-chat-avatar" aria-hidden="true"><MessageSquareText size={15} /></span>
                    <article className="intel-finding intel-chat-bubble">
                      <div className="intel-finding-top">
                        <div className="intel-finding-tags">
                          <span className={`intel-severity ${finding.severity}`}>{finding.severity}</span>
                          <span className="intel-feature-tag">{featureName(finding.feature)}</span>
                          <span className="intel-code">{codeLabels[finding.code] ?? finding.code.replaceAll("_", " ")}</span>
                          <span className={`intel-source-tag source-${finding.source}`}>{sourceLabels[finding.source] ?? "Unverified"}</span>
                        </div>
                        <time dateTime={finding.last_seen_at}>{formatDate(finding.last_seen_at)}</time>
                      </div>
                      <p className="intel-summary">{finding.summary}</p>
                      <div className="intel-guidance">
                        <span className="intel-guidance-label"><ArrowUpRight size={13} /> GUIDANCE</span>
                        <p>{finding.guidance}</p>
                      </div>
                      <div className="intel-finding-footer">
                        <div className="intel-impact">
                          <span><b>{finding.affected_sessions.toLocaleString()}</b> affected sessions</span>
                          <span><b>{finding.occurrences.toLocaleString()}</b> occurrences</span>
                          <span>First seen {formatDate(finding.first_seen_at)}</span>
                        </div>
                        <div className="intel-fix-wrap">
                          <button className="intel-fix-button is-disabled" disabled title="No verified safe repair is available." aria-describedby={`safeguard-${finding.id}`} data-testid={`button-fix-finding-${finding.id}`}>
                            <LockKeyhole size={13} /> Fix it now
                          </button>
                          <small id={`safeguard-${finding.id}`}>{findingSafeguard(finding.code, finding.source)}</small>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
          <footer className="intel-footer">
            <span><LockKeyhole size={12} /> Sanitized diagnostics only</span>
            <span>Last signal update {formatDate(data.scanned_at)}</span>
          </footer>
        </>
      ) : null}
    </section>
  );
}
