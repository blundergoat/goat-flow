/**
 * Unit tests for quality report schema validation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  QUALITY_REPORT_KIND,
  parseQualityReport,
  parseSavedQualityReport,
} from "../../src/cli/quality/schema.js";

function makeRawReport() {
  return {
    report_kind: QUALITY_REPORT_KIND,
    goat_flow_version: "1.2.3",
    agent: "claude",
    project_path: "/tmp/quality-project",
    run_date: "2026-04-18",
    audit_status: "pass",
    scope: "framework-self",
    rubric_version: "1.2.3",
    quality_mode: "agent-setup",
    scores: {
      setup: {
        total: 75,
        accuracy: 20,
        relevance: 20,
        completeness: 20,
        friction: 15,
      },
      system: {
        total: 80,
        usefulness: 20,
        signal_to_noise: 20,
        adaptability: 20,
        learnability: 20,
      },
    },
    findings: [
      {
        type: "setup_quality",
        severity: "MAJOR",
        file: ".goat-flow/architecture.md",
        line: 12,
        summary: "Architecture doc drifts from the implemented command surface",
        detail: "The command list omits a shipped quality subcommand.",
        evidence_quality: "OBSERVED",
        evidence_method: "static-analysis",
        delta_tag: null,
      },
    ],
  };
}

describe("parseQualityReport", () => {
  it("accepts a valid raw report", () => {
    const parsed = parseQualityReport(makeRawReport());
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.report.report_kind, QUALITY_REPORT_KIND);
    assert.equal(parsed.report.findings[0]!.delta_tag, null);
  });

  it("rejects current reports that omit required provenance fields", () => {
    const report = makeRawReport() as Record<string, unknown>;
    delete report.quality_mode;
    const parsed = parseQualityReport(report);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /quality_mode is required/i);
  });

  it("accepts legacy reports through the relaxed history parse path", () => {
    // M17-6 backward-compat: existing reports under .goat-flow/logs/quality/
    // pre-date the provenance fields; they must still load cleanly.
    const legacy = makeRawReport() as Record<string, unknown>;
    delete legacy.scope;
    delete legacy.rubric_version;
    delete legacy.quality_mode;
    const findings = legacy.findings as Record<string, unknown>[];
    delete findings[0]!.evidence_method;
    const parsed = parseQualityReport(legacy, { requireCurrentFields: false });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.report.scope, undefined);
    assert.equal(parsed.report.rubric_version, undefined);
    assert.equal(parsed.report.quality_mode, undefined);
    assert.equal(parsed.report.findings[0]!.evidence_method, "static-analysis");
  });

  it("accepts v2 reports (with evidence_method) and preserves the value", () => {
    const report = makeRawReport();
    const parsed = parseQualityReport({
      ...report,
      scope: "framework-self",
      rubric_version: "1.2.3",
      findings: [{ ...report.findings[0], evidence_method: "runtime-probe" }],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.report.scope, "framework-self");
    assert.equal(parsed.report.rubric_version, "1.2.3");
    assert.equal(parsed.report.quality_mode, "agent-setup");
    assert.equal(parsed.report.findings[0]!.evidence_method, "runtime-probe");
  });

  it("rejects invalid evidence_method values", () => {
    const report = makeRawReport();
    const parsed = parseQualityReport({
      ...report,
      findings: [{ ...report.findings[0], evidence_method: "speculation" }],
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(
      parsed.error,
      /must be one of: runtime-probe, static-analysis, mixed/i,
    );
  });

  it("rejects invalid scope values", () => {
    const parsed = parseQualityReport({
      ...makeRawReport(),
      scope: "contributor",
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /must be one of: framework-self, consumer/i);
  });

  it("rejects invalid quality modes", () => {
    const parsed = parseQualityReport({
      ...makeRawReport(),
      quality_mode: "deep-dive",
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(
      parsed.error,
      /must be one of: process, agent-setup, harness, skills/i,
    );
  });

  it("rejects unknown top-level keys", () => {
    const parsed = parseQualityReport({
      ...makeRawReport(),
      unexpected: true,
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /unknown key/i);
  });

  it("rejects raw findings that include an id", () => {
    const report = makeRawReport();
    const parsed = parseQualityReport({
      ...report,
      findings: [
        {
          ...report.findings[0],
          id: "setup_quality:goat-flow-architecture-md:12",
        },
      ],
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /unknown key\(s\): id/i);
  });

  it("rejects unsupported delta tags", () => {
    const report = makeRawReport();
    const parsed = parseQualityReport({
      ...report,
      findings: [{ ...report.findings[0], delta_tag: "resolved" }],
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /must be one of: new, persisted/i);
  });

  it("rejects totals that do not equal the axis sum", () => {
    const report = makeRawReport();
    const parsed = parseQualityReport({
      ...report,
      scores: {
        ...report.scores,
        setup: {
          ...report.scores.setup,
          total: 70,
        },
      },
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /must sum exactly to total/i);
  });
});

describe("parseSavedQualityReport", () => {
  it("accepts persisted finding ids", () => {
    const report = makeRawReport();
    const parsed = parseSavedQualityReport({
      ...report,
      findings: [
        {
          id: "setup_quality:goat-flow-architecture-md:12",
          ...report.findings[0],
          delta_tag: "persisted",
        },
      ],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(
      parsed.report.findings[0]!.id,
      "setup_quality:goat-flow-architecture-md:12",
    );
  });
});
