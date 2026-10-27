import assert from "node:assert/strict";
import test from "node:test";
import { AdminIntelligenceRegistry } from "./admin-intelligence";

test("diagnostic scan reports all features and starts clear", () => {
  const registry = new AdminIntelligenceRegistry();
  const scan = registry.scan(10_000);

  assert.equal(scan.server_status, "healthy");
  assert.ok(scan.features.length > 1);
  assert.ok(scan.features.every((feature) => feature.status === "clear"));
  assert.equal(scan.findings.length, 0);
});

test("diagnostic aggregation exposes only safe summaries and counts", () => {
  const registry = new AdminIntelligenceRegistry();
  registry.report({
    feature: "auto-trader-2",
    code: "trade_outcome_uncertain",
    severity: "warning",
  }, "session-1", 10_000);
  registry.report({
    feature: "auto-trader-2",
    code: "trade_outcome_uncertain",
    severity: "error",
  }, "session-2", 11_000);

  const scan = registry.scan(12_000);
  assert.equal(scan.findings.length, 1);
  assert.equal(scan.findings[0]?.feature, "auto-trader-2");
  assert.equal(scan.findings[0]?.source, "unknown");
  assert.equal(scan.findings[0]?.severity, "error");
  assert.equal(scan.findings[0]?.affected_sessions, 2);
  assert.equal(scan.findings[0]?.occurrences, 2);
  assert.equal(scan.findings[0]?.fix_available, false);
  assert.match(scan.findings[0]?.summary ?? "", /last order may have been submitted/);
  assert.match(scan.findings[0]?.guidance ?? "", /will not resend the order/);
  assert.match(scan.findings[0]?.guidance ?? "", /scanner does not change Deriv contracts or account history/);
  assert.equal(scan.features.find((feature) => feature.feature === "auto-trader-2")?.status, "issue");
});

test("diagnostics keep distinct failure sources visible without storing raw errors", () => {
  const registry = new AdminIntelligenceRegistry();
  registry.report({
    feature: "bulk-trader",
    code: "trade_outcome_uncertain",
    severity: "warning",
    source: "transport",
  }, "session-1", 10_000);
  registry.report({
    feature: "bulk-trader",
    code: "trade_outcome_uncertain",
    severity: "warning",
    source: "deriv",
  }, "session-2", 11_000);

  const findings = registry.scan(12_000).findings;
  assert.equal(findings.length, 2);
  assert.deepEqual(new Set(findings.map((finding) => finding.source)), new Set(["transport", "deriv"]));
  assert.ok(findings.every((finding) => !("raw_error" in finding)));
});

test("repeated reports from one session are throttled and old findings expire", () => {
  const registry = new AdminIntelligenceRegistry();
  const input = {
    feature: "edge" as const,
    code: "api_server_error" as const,
    severity: "error" as const,
  };
  registry.report(input, "session-1", 10_000);
  registry.report(input, "session-1", 20_000);
  assert.equal(registry.scan(20_000).findings[0]?.occurrences, 1);

  registry.report(input, "session-1", 41_000);
  assert.equal(registry.scan(41_000).findings[0]?.occurrences, 2);
  assert.equal(registry.scan(41_000 + 30 * 60 * 1_000).findings.length, 0);
});
