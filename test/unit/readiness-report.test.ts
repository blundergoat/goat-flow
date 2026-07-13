/**
 * Protects the advisory target-readiness report users inspect before agent work begins.
 * Use these fixtures when concern labels, evidence states, blockers, or disabled command
 * suggestions change so empty, partial, installed, and non-goat targets stay distinct.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type {
  AuditConcern,
  AuditConcernKey,
  AuditReport,
  AuditScope,
  CheckResult,
} from "../../src/cli/audit/types.js";
import {
  buildReadinessReport,
  collectReadinessReport,
  renderReadinessReportJson,
  renderReadinessReportText,
} from "../../src/cli/diagnostics/readiness-report.js";
import type { StackInfo } from "../../src/cli/types.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");

const CONCERN_CHECK_IDS: Record<AuditConcernKey, string> = {
  context: "instruction-line-count",
  constraints: "deny-covers-secrets",
  verification: "hooks-registered",
  recovery: "milestone-tracking",
  feedback_loop: "feedback-loop-active",
};

/**
 * Build one harness concern for a target fixture.
 * Empty limits mean the static audit recorded no extra evidence boundary.
 *
 * @param status - deterministic concern result; `fail` means required evidence is absent
 * @param limits - non-gating evidence boundaries; empty means no caveat was recorded
 * @returns concern summary used by the readiness builder; arrays stay empty when no detail exists
 */
function readinessConcern(
  status: "pass" | "fail",
  limits: string[] = [],
): AuditConcern {
  return {
    status,
    score: status === "pass" ? 100 : 0,
    findings: [],
    limits,
    recommendations: [],
    howToFix: [],
    integrityPass: status === "pass" ? 1 : 0,
    integrityFail: status === "fail" ? 1 : 0,
    advisoryPass: 0,
    advisoryFail: 0,
    advisoryAcknowledged: 0,
    metrics: 0,
  };
}

/**
 * Build one check result with optional target-file evidence.
 * Use this when a fixture needs to distinguish a missing file from unknown evidence.
 *
 * @param id - canonical harness check id; empty would make the fixture invalid
 * @param status - observed static outcome shown to the readiness user
 * @param evidencePath - target file backing the result; null means no file evidence was available
 * @returns stable audit check; a passing or skipped check has no failure body
 */
function readinessCheck(
  id: string,
  status: "pass" | "fail" | "skipped",
  evidencePath: string | null,
): CheckResult {
  // No path means the user sees an unknown evidence source instead of a fabricated file citation.
  const targetEvidence =
    evidencePath === null ? {} : { target_evidence_paths: [evidencePath] };
  return {
    id,
    name: id.replaceAll("-", " "),
    status,
    displayStatus: status,
    impact: status === "fail" ? "scope-fail" : "none",
    provenance: {
      source_type: "incident",
      source_urls: [],
      verified_on: "2026-07-14",
      normative_level: "MUST",
      evidence_paths: [".goat-flow/architecture.md"],
      ...targetEvidence,
    },
    failure:
      status === "fail"
        ? {
            check: id,
            message: `${id} evidence is missing`,
            howToFix: `Add the required ${id} evidence.`,
          }
        : undefined,
    type: "integrity",
    evidenceKind: "structural",
  };
}

/**
 * Build the five-concern audit input consumed by readiness fixtures.
 * Empty check arrays represent an audit that could not observe applicable evidence.
 *
 * @param checks - harness results already tied to canonical concern ids; empty means all concerns are unknown
 * @param concerns - deterministic concern summaries; each key must be present for the dashboard-ready schema
 * @returns audit report limited to fields the readiness layer may reuse; no runtime evidence is implied
 */
function readinessAudit(
  checks: CheckResult[],
  concerns: Record<AuditConcernKey, AuditConcern>,
): AuditReport {
  const emptyScope: AuditScope = {
    status: "pass",
    checks: [],
    failures: [],
    summary: {},
  };
  return {
    command: "audit",
    harness: true,
    status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
    target: "/fixture",
    scopes: {
      setup: emptyScope,
      agent: emptyScope,
      harness: {
        status: checks.some((check) => check.status === "fail")
          ? "fail"
          : "pass",
        checks,
        failures: checks.flatMap((check) =>
          check.failure === undefined ? [] : [check.failure],
        ),
        summary: {},
      },
    },
    concerns,
    enforcement: [],
    drift: null,
    content: null,
    overall: {
      status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
    },
  };
}

/**
 * Build detected project commands without running them.
 * Empty command slots mean the readiness user receives no invented next command.
 *
 * @param commands - detected command overrides; omitted values stay unavailable
 * @returns static stack facts; empty language and signal arrays mean nothing was detected
 */
function readinessStack(commands: Partial<StackInfo> = {}): StackInfo {
  return {
    languages: [],
    buildCommand: null,
    testCommand: null,
    lintCommand: null,
    formatCommand: null,
    sourceFileCount: 0,
    signals: {
      codeGenTools: [],
      deployPlatforms: [],
      llmIntegration: false,
      staticAnalysis: [],
      complianceSignals: false,
      formatterGaps: [],
    },
    ...commands,
  };
}

/** Return one concern map where every static requirement passed with no caveat. */
function readyConcerns(): Record<AuditConcernKey, AuditConcern> {
  return {
    context: readinessConcern("pass"),
    constraints: readinessConcern("pass"),
    verification: readinessConcern("pass"),
    recovery: readinessConcern("pass"),
    feedback_loop: readinessConcern("pass"),
  };
}

/**
 * Spawns the public readiness command so parser, static collection, rendering, and stdout stay integrated.
 * This process reads target files but never executes detected project scripts.
 *
 * @param args - CLI arguments after `diagnostics readiness`; empty means the controlling workspace
 * @returns completed child result; empty stderr means structured output stayed clean
 */
function runReadinessCommand(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, "diagnostics", "readiness", ...args],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
}

describe("target readiness report", () => {
  // An empty repository gives users explicit missing evidence instead of an optimistic default.
  it("labels an empty target as not ready with three file-backed blockers", () => {
    const checks = (
      Object.entries(CONCERN_CHECK_IDS) as Array<[AuditConcernKey, string]>
    ).map(([concern, id]) => readinessCheck(id, "fail", `${concern}.md`));
    const concerns = {
      context: readinessConcern("fail"),
      constraints: readinessConcern("fail"),
      verification: readinessConcern("fail"),
      recovery: readinessConcern("fail"),
      feedback_loop: readinessConcern("fail"),
    };
    const report = buildReadinessReport({
      projectPath: "/empty",
      audit: readinessAudit(checks, concerns),
      stack: readinessStack(),
    });

    assert.equal(report.summary.overallLabel, "not-ready");
    assert.equal(report.concerns.context.evidenceState, "missing");
    assert.equal(report.blockers.length, 3);
    assert.equal(report.blockers[0]?.evidencePath, "context.md");
    assert.deepEqual(report.nextCommands, []);
  });

  // A partial install separates repairable gaps from concerns the audit could not observe.
  it("labels partial and unknown concerns without converting unknowns into failures", () => {
    const checks = [
      readinessCheck(CONCERN_CHECK_IDS.context, "pass", "AGENTS.md"),
      readinessCheck(
        CONCERN_CHECK_IDS.constraints,
        "fail",
        ".goat-flow/hooks/deny-dangerous.sh",
      ),
      readinessCheck(CONCERN_CHECK_IDS.verification, "pass", "package.json"),
      readinessCheck(CONCERN_CHECK_IDS.recovery, "pass", ".goat-flow/plans/"),
      readinessCheck(CONCERN_CHECK_IDS.feedback_loop, "skipped", null),
    ];
    const concerns = readyConcerns();
    concerns.constraints = readinessConcern("fail");
    const report = buildReadinessReport({
      projectPath: "/partial",
      audit: readinessAudit(checks, concerns),
      stack: readinessStack(),
    });

    assert.equal(report.summary.overallLabel, "needs-attention");
    assert.equal(report.concerns.constraints.label, "not-ready");
    assert.equal(report.concerns.feedback_loop.label, "unknown");
    assert.equal(report.concerns.feedback_loop.evidenceState, "unknown");
  });

  // A full goat-flow install gets one verified advisory label per canonical concern.
  it("renders stable JSON for a fully observed installed target", () => {
    const checks = (
      Object.entries(CONCERN_CHECK_IDS) as Array<[AuditConcernKey, string]>
    ).map(([concern, id]) => readinessCheck(id, "pass", `${concern}.md`));
    const report = buildReadinessReport({
      projectPath: "/installed",
      audit: readinessAudit(checks, readyConcerns()),
      stack: readinessStack({ languages: ["typescript", "bash"] }),
    });
    const rendered = renderReadinessReportJson(report);
    const parsed = JSON.parse(rendered) as typeof report;

    assert.equal(parsed.schema, "goat-flow.readiness-report.v1");
    assert.equal(parsed.summary.overallLabel, "ready");
    assert.deepEqual(Object.keys(parsed), [
      "schema",
      "projectPath",
      "advisory",
      "execution",
      "summary",
      "concerns",
      "blockers",
      "nextCommands",
    ]);
    assert.deepEqual(
      Object.values(parsed.concerns).map((concern) => concern.label),
      ["ready", "ready", "ready", "ready", "ready"],
    );
    assert.deepEqual(
      Object.values(parsed.concerns).map((concern) => concern.evidenceState),
      ["verified", "verified", "verified", "verified", "verified"],
    );
    assert.equal(renderReadinessReportJson(report), rendered);
  });

  // A normal codebase may expose useful commands even when goat-flow evidence is absent.
  it("keeps non-goat project commands inferred and disabled", () => {
    const checks = (
      Object.entries(CONCERN_CHECK_IDS) as Array<[AuditConcernKey, string]>
    ).map(([concern, id]) => readinessCheck(id, "fail", `${concern}.md`));
    const report = buildReadinessReport({
      projectPath: "/non-goat",
      audit: readinessAudit(checks, {
        context: readinessConcern("fail"),
        constraints: readinessConcern("fail"),
        verification: readinessConcern("fail"),
        recovery: readinessConcern("fail"),
        feedback_loop: readinessConcern("fail"),
      }),
      stack: readinessStack({
        languages: ["typescript"],
        testCommand: "npm test",
        lintCommand: "npm run lint",
      }),
    });
    const rendered = renderReadinessReportText(report);

    assert.deepEqual(report.nextCommands, [
      {
        purpose: "test",
        command: "npm test",
        evidenceState: "inferred",
        execution: "disabled",
      },
      {
        purpose: "lint",
        command: "npm run lint",
        evidenceState: "inferred",
        execution: "disabled",
      },
    ]);
    assert.match(
      rendered,
      /Advisory only; no target code or project commands were executed\./u,
    );
    assert.match(rendered, /npm test \[inferred, disabled\]/u);
  });

  // A passing concern with an audit caveat remains ready while its evidence stays inferred.
  it("keeps limited static evidence separate from the readiness label", () => {
    const checks = (
      Object.entries(CONCERN_CHECK_IDS) as Array<[AuditConcernKey, string]>
    ).map(([concern, id]) => readinessCheck(id, "pass", `${concern}.md`));
    const concerns = readyConcerns();
    concerns.verification = readinessConcern("pass", [
      "Project verification commands were not executed.",
    ]);
    const report = buildReadinessReport({
      projectPath: "/installed",
      audit: readinessAudit(checks, concerns),
      stack: readinessStack(),
    });

    assert.equal(report.concerns.verification.label, "ready");
    assert.equal(report.concerns.verification.evidenceState, "inferred");
  });

  // Normative provenance can name every agent file, but the blocker must cite the selected agent's file.
  it("selects the target path named by the failure instead of the first provenance path", () => {
    const instructionCheck = readinessCheck(
      CONCERN_CHECK_IDS.context,
      "fail",
      null,
    );
    instructionCheck.failure = {
      check: "Instruction file size",
      message: "Create AGENTS.md",
      howToFix: "Create AGENTS.md by running `goat-flow setup`.",
    };
    instructionCheck.provenance.target_evidence_paths = [
      "CLAUDE.md",
      "AGENTS.md",
      ".github/copilot-instructions.md",
    ];
    const concerns = readyConcerns();
    concerns.context = readinessConcern("fail");
    const report = buildReadinessReport({
      projectPath: "/empty",
      audit: readinessAudit([instructionCheck], concerns),
      stack: readinessStack(),
    });

    assert.equal(report.blockers[0]?.evidencePath, "AGENTS.md");
  });

  // This regression writes and removes a filesystem fixture proving advertised scripts and hooks stay inert.
  it("does not execute target scripts or hooks while collecting readiness", () => {
    const targetRoot = mkdtempSync(join(tmpdir(), "goat-flow-readiness-"));
    const executionMarker = join(targetRoot, "target-code-executed");
    const denyHookDirectory = join(targetRoot, ".goat-flow", "hooks");
    // Fixture purpose: expose executable-looking target files whose side effects must never occur.
    mkdirSync(denyHookDirectory, { recursive: true });
    writeFileSync(
      join(targetRoot, "package.json"),
      JSON.stringify({ scripts: { test: `touch ${executionMarker}` } }),
      "utf-8",
    );
    writeFileSync(
      join(denyHookDirectory, "deny-dangerous.sh"),
      `#!/usr/bin/env bash\ntouch ${executionMarker}\n`,
      "utf-8",
    );

    try {
      const report = collectReadinessReport(targetRoot, "codex");

      assert.equal(existsSync(executionMarker), false);
      assert.equal(report.execution.targetCodeExecuted, false);
      assert.equal(report.execution.projectCommandsExecuted, false);
      assert.equal(report.nextCommands[0]?.execution, "disabled");
    } finally {
      rmSync(targetRoot, { recursive: true, force: true });
    }
  });

  // Machine consumers receive one JSON object with no progress prose around it.
  it("emits stable JSON through the public CLI", () => {
    const result = runReadinessCommand(
      ".",
      "--agent",
      "codex",
      "--format",
      "json",
    );
    const parsed = JSON.parse(result.stdout) as {
      schema: string;
      advisory: boolean;
      execution: { projectCommandsExecuted: boolean };
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(parsed.schema, "goat-flow.readiness-report.v1");
    assert.equal(parsed.advisory, true);
    assert.equal(parsed.execution.projectCommandsExecuted, false);
  });

  // Unsupported Markdown output fails clearly instead of pretending a schema exists.
  it("rejects unsupported readiness formats", () => {
    const result = runReadinessCommand(".", "--format", "markdown");

    assert.equal(result.status, 2);
    assert.match(
      result.stderr,
      /diagnostics readiness supports --format text or --format json/iu,
    );
  });
});
