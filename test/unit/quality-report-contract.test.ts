/**
 * Cross-surface quality-prompt contract for CLI and dashboard users.
 * It keeps report fields, audit evidence limits, and validation instructions consistent across every mode.
 * Use when prompt composition changes so a report launched from one screen is not weaker than another.
 * The dashboard mirror stays source-pinned because its classic script cannot import the CLI builder.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const PROJECT_VALIDATION_LIMIT =
  "This audit inspected verification guidance and hook configuration; it did not execute project build, test, lint, typecheck, or format commands.";
const RECOVERY_RESUMABILITY_LIMIT =
  "Recovery storage is available, but this audit did not validate the current objective, completed work, last verification, next action, or end-to-end resumability.";
const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");

/** Extract the executable report-write block from a composed prompt. */
function extractReportWriteBlock(prompt: string): string {
  const selectionIndex = prompt.indexOf("**Select a compatible redactor.**");
  assert.notEqual(selectionIndex, -1, "missing compatible-redactor section");
  const fenceStart = prompt.indexOf("```bash\n", selectionIndex);
  assert.notEqual(fenceStart, -1, "missing report-write fence");
  const blockStart = fenceStart + "```bash\n".length;
  const blockEnd = prompt.indexOf("\n```", blockStart);
  assert.notEqual(blockEnd, -1, "unterminated report-write fence");
  return prompt.slice(blockStart, blockEnd);
}

/** Build the prompt input a user gets before any audit evidence is available. */
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

/** Build one complete concern so prompt tests can vary only the evidence limits users need to see. */
function auditConcern(limits: string[] = []) {
  return {
    status: "pass" as const,
    score: 100,
    findings: [],
    limits,
    recommendations: [],
    howToFix: [],
    integrityPass: 1,
    integrityFail: 0,
    advisoryPass: 0,
    advisoryFail: 0,
    advisoryAcknowledged: 0,
    metrics: 0,
  };
}

/** Build the passing audit a user sees when structural scores need explicit evidence limits. */
function makeLimitedAuditReport(): NonNullable<QualityInput["auditReport"]> {
  const emptyScope = {
    status: "pass" as const,
    checks: [],
    failures: [],
    summary: {},
  };
  return {
    command: "audit",
    status: "pass",
    target: "/tmp/example-project",
    harness: true,
    scopes: {
      setup: emptyScope,
      agent: emptyScope,
      harness: emptyScope,
    },
    concerns: {
      context: auditConcern(),
      constraints: auditConcern(),
      verification: auditConcern([PROJECT_VALIDATION_LIMIT]),
      recovery: auditConcern([RECOVERY_RESUMABILITY_LIMIT]),
      feedback_loop: auditConcern(),
    },
    enforcement: [],
    drift: null,
    content: null,
    overall: { status: "pass" },
  };
}

/** Assert a prompt carries every field needed to save and validate the user's quality report. */
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
    text.includes("quality validate") || text.includes('"quality", "validate"'),
    `${surface}: missing validate command`,
  );
  assert.ok(
    text.includes("ls -la") || text.includes('"ls", ["-la"'),
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

  it("redacts the completed JSON before any quality report reaches disk", () => {
    for (const qualityMode of [
      "agent-setup",
      "process",
      "harness",
      "skills",
    ] as const) {
      const prompt = composeQuality(makeInput(qualityMode)).prompt;
      const writeBlock = extractReportWriteBlock(prompt);
      const compatibilityIndex = writeBlock.indexOf("--version");
      const packageIdentityIndex = writeBlock.indexOf(
        'packageJson.name === "@blundergoat/goat-flow"',
      );
      const sourceFallbackIndex = writeBlock.indexOf("src/cli/cli.ts");
      const stringifyIndex = writeBlock.indexOf(
        'JSON.stringify(report, null, 2) + "\\n"',
      );
      const redactIndex = writeBlock.indexOf('"redact", "--output"');
      const validateIndex = writeBlock.indexOf(
        '"quality", "validate", outputPath',
      );
      const listIndex = writeBlock.indexOf('runOrExit("ls", ["-la"');

      assert.notEqual(
        compatibilityIndex,
        -1,
        `${qualityMode}: missing redactor compatibility check`,
      );
      assert.match(writeBlock, /goat-flow v1\.14\.0/, qualityMode);
      assert.ok(
        packageIdentityIndex > compatibilityIndex &&
          sourceFallbackIndex > packageIdentityIndex,
        `${qualityMode}: source fallback must remain package-identity gated`,
      );
      assert.match(
        writeBlock,
        /^node --input-type=module - "\$FILE" <<'NODE'$/mu,
        `${qualityMode}: missing literal hook-recognizable Node heredoc`,
      );
      assert.doesNotMatch(
        writeBlock,
        /\$\{GOAT_FLOW_CLI\[@\]\}/u,
        `${qualityMode}: dynamic shell-array heredoc remains`,
      );
      assert.notEqual(
        stringifyIndex,
        -1,
        `${qualityMode}: missing in-memory JSON`,
      );
      assert.notEqual(redactIndex, -1, `${qualityMode}: missing redact gate`);
      assert.ok(
        stringifyIndex > sourceFallbackIndex &&
          redactIndex > stringifyIndex &&
          validateIndex > redactIndex &&
          listIndex > validateIndex,
        `${qualityMode}: redaction, validation, and listing order is unsafe`,
      );
      assert.match(writeBlock, /input: reportJson/u, qualityMode);
      assert.match(
        writeBlock,
        /process\.exit\(result\.status \?\? 1\)/u,
        qualityMode,
      );
      assert.match(
        prompt,
        /Only the redacted JSON may reach `\$FILE`; never stage the raw draft in a file/,
        `${qualityMode}: missing raw-draft prohibition`,
      );
      assert.doesNotMatch(
        writeBlock,
        /writeFile|>\s*"?\$FILE/u,
        `${qualityMode}: raw JSON can reach disk before redaction`,
      );
      assert.doesNotMatch(
        prompt,
        /then write the JSON below to \$FILE/,
        `${qualityMode}: prompt still teaches a direct raw write`,
      );
      assert.doesNotMatch(
        prompt,
        /^goat-flow (?:redact|quality validate)\b/m,
        `${qualityMode}: stale global CLI remains unconditional`,
      );
    }
  });

  it("sends a realistic 60-line report block through the actual deny hook", () => {
    const prompt = composeQuality(makeInput("agent-setup")).prompt;
    const writeBlock = extractReportWriteBlock(prompt);
    const reportObject = [
      "{",
      ...Array.from(
        { length: 60 },
        (_, index) => `  "field_${index}": "value_${index}",`,
      ),
      '  "final_field": "final_value"',
      "}",
    ].join("\n");
    const realisticBlock = writeBlock
      .replace("<insert the complete JSON body here>", reportObject)
      .replace("<insert the complete report object here>", reportObject);
    const hookResult = spawnSync(
      "bash",
      [".goat-flow/hooks/deny-dangerous.sh", "--check", realisticBlock],
      {
        cwd: REPOSITORY_ROOT,
        encoding: "utf-8",
      },
    );

    assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);
  });

  it("embeds live Verification and Recovery limits in every quality mode prompt and summary", () => {
    const qualityModes = [
      "agent-setup",
      "process",
      "harness",
      "skills",
    ] as const;
    const auditReport = makeLimitedAuditReport();

    // A user choosing any Quality mode must receive the same deterministic evidence boundaries.
    for (const qualityMode of qualityModes) {
      const payload = composeQuality({
        ...makeInput(qualityMode),
        auditReport,
      });
      assert.ok(
        payload.prompt.includes(PROJECT_VALIDATION_LIMIT),
        `${qualityMode}: prompt omitted Verification limit`,
      );
      assert.ok(
        payload.prompt.includes(RECOVERY_RESUMABILITY_LIMIT),
        `${qualityMode}: prompt omitted Recovery limit`,
      );
      assert.ok(
        payload.auditSummary.includes(PROJECT_VALIDATION_LIMIT),
        `${qualityMode}: auditSummary omitted Verification limit`,
      );
      assert.ok(
        payload.auditSummary.includes(RECOVERY_RESUMABILITY_LIMIT),
        `${qualityMode}: auditSummary omitted Recovery limit`,
      );
    }
  });

  it("keeps the focused cache-miss contract when no audit report is available", () => {
    const focusedModes = ["process", "harness", "skills"] as const;

    // A fast dashboard launch without cached evidence must disclose the gap instead of inventing limits.
    for (const qualityMode of focusedModes) {
      const payload = composeQuality({
        ...makeInput(qualityMode),
        auditUnavailableReason: "fast-cache-only",
      });
      assert.match(
        payload.prompt,
        /Audit: NOT LOADED \(FAST CACHE-ONLY MODE\)/,
      );
      assert.match(payload.auditSummary, /fast cache-only mode/);
      assert.match(
        payload.prompt,
        /Audit data not loaded \(fast cache-only mode/u,
      );
      assert.equal(payload.prompt.includes(PROJECT_VALIDATION_LIMIT), false);
      assert.equal(payload.prompt.includes(RECOVERY_RESUMABILITY_LIMIT), false);
    }
  });

  it("embeds drift and content failures in focused prompts and summaries", () => {
    const auditReport = makeLimitedAuditReport();
    auditReport.status = "fail";
    auditReport.overall.status = "fail";
    auditReport.drift = {
      status: "fail",
      checked: 12,
      findings: [
        {
          kind: "content",
          path: ".agents/skills/goat/SKILL.md",
          message: "installed dispatcher differs from its workflow source",
        },
      ],
    };
    auditReport.content = {
      status: "fail",
      warnings: 1,
      infos: 0,
      filesScanned: 4,
      findings: [
        {
          severity: "warning",
          rule: "removed-command-scan",
          path: "README.md",
          line: 8,
          message: "documentation teaches a removed command",
        },
      ],
    };

    for (const qualityMode of ["process", "harness", "skills"] as const) {
      const payload = composeQuality({
        ...makeInput(qualityMode),
        auditReport,
      });
      for (const evidence of [
        ".agents/skills/goat/SKILL.md",
        "installed dispatcher differs",
        "README.md:8 [removed-command-scan]",
        "documentation teaches a removed command",
      ]) {
        assert.ok(
          payload.prompt.includes(evidence),
          `${qualityMode}: prompt omitted ${evidence}`,
        );
        assert.ok(
          payload.auditSummary.includes(evidence),
          `${qualityMode}: auditSummary omitted ${evidence}`,
        );
      }
    }
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
