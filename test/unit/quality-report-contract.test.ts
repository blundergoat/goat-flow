/**
 * Cross-surface contract tests for the quality report JSON contract (M15,
 * 1.13.0).
 *
 * A user can be asked to write a quality report from three surfaces: the CLI
 * agent-setup prompt (`goat-flow quality --agent <id>`), the CLI focused
 * prompts (process/harness/skills modes), and the dashboard's Quality launch
 * prompt. All three must demand the same required fields, or
 * `goat-flow quality validate`/`history`/`diff` will reject or mis-read
 * reports depending on where the run started.
 *
 * The two CLI surfaces render through ONE shared builder
 * (`appendQualityReportContract`), so these tests mostly guard its options
 * wiring. The dashboard is compiled as an isolated browser script and cannot
 * import that builder - its mirror in `dashboard-setup-quality.ts` is pinned
 * here at source-text level instead.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { composeQuality } from "../../src/cli/prompt/compose-quality.js";
import type { QualityInput } from "../../src/cli/prompt/compose-quality-common.js";
import {
  QUALITY_EVIDENCE_METHODS,
  QUALITY_FINDING_SEVERITIES,
  QUALITY_FINDING_TYPES,
} from "../../src/cli/quality/schema-types.js";

/** Top-level JSON keys every contract render must show in its body shape. */
const REQUIRED_TOP_LEVEL_FIELDS = [
  '"report_kind"',
  '"goat_flow_version"',
  '"agent"',
  '"project_path"',
  '"run_date"',
  '"audit_status"',
  '"scope"',
  '"rubric_version"',
  '"quality_mode"',
  '"prior_report_id"',
  '"scores"',
  '"findings"',
] as const;

/** Per-finding fields every contract render must require or demonstrate. */
const REQUIRED_FINDING_FIELDS = [
  "evidence_quality",
  "evidence_method",
  "delta_tag",
] as const;

/** Build a minimal QualityInput for a composer run. */
function makeInput(qualityMode: QualityInput["qualityMode"]): QualityInput {
  return {
    agent: "claude",
    projectPath: "/tmp/example-project",
    auditReport: null,
    auditUnavailableReason: "audit-failed",
    priorReport: null,
    qualityMode,
    runDate: "2026-07-03",
  };
}

/** Assert one rendered prompt (or source text) carries the whole contract. */
function assertCarriesContract(surface: string, text: string): void {
  // Every top-level field the schema parser requires must appear in the shape.
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    assert.ok(text.includes(field), `${surface}: missing ${field}`);
  }
  // Every per-finding requirement must be spelled out.
  for (const field of REQUIRED_FINDING_FIELDS) {
    assert.ok(
      text.includes(field),
      `${surface}: missing finding field ${field}`,
    );
  }
  // Allowed enum values must match the parser's lists verbatim.
  for (const value of [
    ...QUALITY_FINDING_TYPES,
    ...QUALITY_FINDING_SEVERITIES,
    ...QUALITY_EVIDENCE_METHODS,
  ]) {
    assert.ok(text.includes(value), `${surface}: missing enum value ${value}`);
  }
  // The validation command and existence proof close the loop.
  assert.ok(
    text.includes("quality validate"),
    `${surface}: missing validate command`,
  );
  assert.ok(
    text.includes("ls -la"),
    `${surface}: missing file existence proof`,
  );
}

describe("quality report contract: CLI surfaces", () => {
  it("agent-setup prompt carries the full contract", () => {
    const payload = composeQuality(makeInput("agent-setup"));
    assertCarriesContract("agent-setup", payload.prompt);
  });

  it("focused (harness) prompt carries the full contract", () => {
    const payload = composeQuality(makeInput("harness"));
    assertCarriesContract("focused/harness", payload.prompt);
  });

  it("focused (process) prompt carries the full contract", () => {
    const payload = composeQuality(makeInput("process"));
    assertCarriesContract("focused/process", payload.prompt);
  });

  it("prior-report runs demand delta_tag; fresh runs forbid it", () => {
    const fresh = composeQuality(makeInput("agent-setup")).prompt;
    assert.match(fresh, /`delta_tag` must be `null` or omitted/);
    // Minimal-but-complete history entry: the prior-context section reads
    // report.findings/scores/run_date, not just the id.
    const priorReport = {
      id: "2026-07-01-0900-claude-abc12",
      report: {
        run_date: "2026-07-01",
        scores: {
          setup: { total: 60 },
          system: { total: 55 },
        },
        findings: [],
      },
    } as never;
    const withPrior = composeQuality({
      ...makeInput("agent-setup"),
      priorReport,
    }).prompt;
    assert.match(withPrior, /`delta_tag` is REQUIRED on every current finding/);
    assert.match(withPrior, /2026-07-01-0900-claude-abc12/);
  });
});

describe("quality report contract: dashboard mirror", () => {
  const dashboardSource = readFileSync(
    fileURLToPath(
      new URL(
        "../../src/dashboard/dashboard-setup-quality.ts",
        import.meta.url,
      ),
    ),
    "utf-8",
  );

  it("dashboard prompt source mirrors the required fields and enums", () => {
    assertCarriesContract("dashboard", dashboardSource);
  });
});
