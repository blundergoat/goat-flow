/**
 * Verifies quality CLI parsing and bounded report persistence.
 * Users reach these paths when they request, save, or inspect a quality run.
 * The tests keep invalid input out of history without hiding recoverable legacy reports.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CLIError } from "../../src/cli/cli-error.js";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import { getPackageVersion } from "../../src/cli/paths.js";
import { persistQualityReportText } from "../../src/cli/quality/quality-command.js";
import { parseQualityReport } from "../../src/cli/quality/schema.js";

const CLI_USAGE_EXIT_CODE = 2;
const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");
const QUALITY_REPORT_TOKEN_FIXTURE = `ghp_${"abcdefghijklmnopqrstuvwxyz"}`;

/** Impossible formatted dates that current quality reports must reject. */
const INVALID_CURRENT_RUN_DATES = [
  "2026-02-29",
  "2026-04-31",
  "2026-13-01",
] as const;

/** Build a source-backed candidate the assessor disproved before showing the user their findings. */
function staticRefutedCandidate(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    claim: "The parser accepts unsupported report keys",
    why_excluded: "Closed-schema validation rejects the extra key.",
    file: "src/cli/quality/schema-parser.ts",
    line: null,
    evidence_quality: "OBSERVED",
    evidence_method: "static-analysis",
    evidence_summary:
      'The parser calls rejectUnknownKeys before saving (search: "rejectUnknownKeys").',
    ...overrides,
  };
}

/** Build one current report accepted by the strict quality schema. */
function currentQualityReport(
  projectPath: string,
  detail = `Token fixture ${QUALITY_REPORT_TOKEN_FIXTURE}`,
) {
  const version = getPackageVersion();
  return {
    report_kind: "goat-flow-quality-report",
    goat_flow_version: version,
    agent: "claude",
    project_path: projectPath,
    run_date: "2026-07-31",
    audit_status: "pass",
    scope: "framework-self",
    rubric_version: version,
    quality_mode: "skills",
    prior_report_id: null,
    assessment_context: {
      project_revision: "6d95e75d4c8a6770fdeede79bb1cf22d9c3a9aa0",
      working_tree_state: "clean",
      grounding_status: "complete",
      unverified_probes: [],
      score_confidence: "high",
    },
    scores: {
      setup: {
        total: 0,
        accuracy: 0,
        relevance: 0,
        completeness: 0,
        friction: 0,
      },
      system: {
        total: 0,
        usefulness: 0,
        signal_to_noise: 0,
        adaptability: 0,
        learnability: 0,
      },
    },
    findings: [
      {
        type: "setup_quality",
        severity: "MINOR",
        file: null,
        line: null,
        summary: "Persistence fixture",
        detail,
        evidence_quality: "OBSERVED",
        evidence_method: "static-analysis",
        delta_tag: null,
      },
    ],
    refuted_candidates: [],
  };
}

/**
 * Assert that one disproved-candidate row is rejected before it reaches quality history.
 * Use for malformed candidate fixtures; an empty expected error would hide the field the user must repair.
 *
 * @param candidate - candidate row to validate; an empty object exercises missing required fields
 * @param expectedError - exact user-facing schema error; empty text would make the assertion ambiguous
 * @returns nothing; the assertion fails if the report is accepted or rejects a different field
 */
function assertRefutedCandidateError(
  candidate: Record<string, unknown>,
  expectedError: string,
): void {
  const parsed = parseQualityReport({
    ...currentQualityReport(resolve("quality-refutation-fixture")),
    refuted_candidates: [candidate],
  });
  assert.deepEqual(parsed, { ok: false, error: expectedError });
}

/** Spawns the public source CLI saver with one raw stdin body. */
function runQualitySaveText(projectPath: string, input: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli/cli.ts", "quality", "save", projectPath],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      input,
    },
  );
}

/** Run the public source CLI saver with one in-memory report body. */
function runQualitySave(projectPath: string, report: unknown) {
  return runQualitySaveText(
    projectPath,
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

/**
 * Writes a Git project whose exact quality report filename family is gitignored.
 * Use when a test needs the "report stays local" precondition the save path requires.
 *
 * @returns the project root path, already carrying the ignore rule the save path checks
 */
function makeIgnoredQualityRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-quality-save-"));
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  writeFileSync(join(root, ".gitignore"), ".goat-flow/logs/quality/*.json\n");
  return root;
}

/** Persist one current report through injected filesystem dependencies for race fixtures. */
function persistCurrentQualityReport(
  projectRoot: string,
  deps: Parameters<typeof persistQualityReportText>[1],
): string {
  return persistQualityReportText(
    {
      projectPath: projectRoot,
      rawText: JSON.stringify(currentQualityReport(projectRoot)),
    },
    deps,
  );
}

describe("quality subcommand parsing", () => {
  it("rejects the removed capture subcommand with a migration hint", () => {
    assert.throws(
      () => parseCLIArgs(["quality", "capture"]),
      /quality capture.+removed/i,
    );
  });

  it("parses history mode with --all", () => {
    const parsed = parseCLIArgs([
      "quality",
      "history",
      "--agent",
      "claude",
      "--mode",
      "skills",
      "--all",
    ]);
    assert.equal(parsed.qualitySubcommand, "history");
    assert.equal(parsed.includeAll, true);
    assert.equal(parsed.agent, "claude");
    assert.equal(parsed.qualityMode, "skills");
  });

  it("parses diff mode with an explicit report pair", () => {
    const parsed = parseCLIArgs([
      "quality",
      "diff",
      "2026-04-01-0900-claude-aaaaa:2026-04-15-1000-claude-bbbbb",
      "--agent",
      "claude",
    ]);
    assert.equal(parsed.qualitySubcommand, "diff");
    assert.equal(
      parsed.qualityDiffPair,
      "2026-04-01-0900-claude-aaaaa:2026-04-15-1000-claude-bbbbb",
    );
  });

  it("parses prompt mode for mode-specific quality prompts", () => {
    const parsed = parseCLIArgs([
      "quality",
      ".",
      "--agent",
      "claude",
      "--mode",
      "skills",
    ]);
    assert.equal(parsed.qualitySubcommand, "prompt");
    assert.equal(parsed.qualityMode, "skills");
  });

  it("treats a prototype-named positional as an ordinary project path", () => {
    const parsed = parseCLIArgs(["quality", "__proto__"]);
    assert.equal(parsed.qualitySubcommand, "prompt");
    assert.equal(parsed.projectPath, resolve("__proto__"));
  });

  it("parses bounded quality-save ownership and rejects ambiguous paths", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-quality-save-"));
    try {
      const parsed = parseCLIArgs(["quality", "save", projectRoot]);
      assert.equal(parsed.qualitySubcommand, "save");
      assert.equal(parsed.projectPath, projectRoot);
      assert.throws(
        () => parseCLIArgs(["quality", "save"]),
        /quality save requires exactly one positional project path/i,
      );
      assert.throws(
        () => parseCLIArgs(["quality", "save", projectRoot, "extra"]),
        /quality save requires exactly one positional project path/i,
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects --all on non-quality commands", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--all"]),
      /only valid for the quality command/i,
    );
  });
});

describe("quality report run dates", () => {
  /** A real leap day remains available to users saving a current quality report. */
  it("accepts a real leap day in a current report", () => {
    const projectRoot = resolve("quality-date-fixture");
    const leapDayReport = parseQualityReport({
      ...currentQualityReport(projectRoot),
      run_date: "2028-02-29",
    });
    assert.equal(leapDayReport.ok, true);
  });

  // Each impossible date gets a named failure before it can enter current history.
  for (const invalidRunDate of INVALID_CURRENT_RUN_DATES) {
    /** The schema error tells the user to repair the calendar date before saving. */
    it(`rejects current run date ${invalidRunDate}`, () => {
      const projectRoot = resolve("quality-date-fixture");
      const invalidReport = parseQualityReport({
        ...currentQualityReport(projectRoot),
        run_date: invalidRunDate,
      });
      assert.deepEqual(invalidReport, {
        ok: false,
        error: "report.run_date must be a real calendar date in YYYY-MM-DD",
      });
    });
  }

  /** Legacy history stays readable even when an old producer emitted an impossible formatted date. */
  it("loads a legacy impossible date without admitting it as a current report", () => {
    const projectRoot = resolve("quality-legacy-date-fixture");
    const impossibleDateReport = {
      ...currentQualityReport(projectRoot),
      run_date: "2026-02-30",
    };

    assert.equal(
      parseQualityReport(impossibleDateReport, {
        requireCurrentFields: false,
      }).ok,
      true,
    );
    assert.equal(parseQualityReport(impossibleDateReport).ok, false);
  });
});

describe("quality assessment context", () => {
  const assessmentContext = {
    project_revision: "6d95e75d4c8a6770fdeede79bb1cf22d9c3a9aa0",
    working_tree_state: "dirty",
    grounding_status: "partial",
    unverified_probes: ["bash scripts/preflight-checks.sh: denied"],
    score_confidence: "medium",
  };

  it("accepts comparable provenance on a current report", () => {
    const parsed = parseQualityReport({
      ...currentQualityReport(resolve("quality-context-fixture")),
      assessment_context: assessmentContext,
    });
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
  });

  it("requires provenance on current reports while legacy history remains loadable", () => {
    const { assessment_context: _assessmentContext, ...reportWithoutContext } =
      currentQualityReport(resolve("quality-context-fixture"));
    const current = parseQualityReport(reportWithoutContext);
    assert.equal(current.ok, false);
    if (!current.ok) {
      assert.match(current.error, /assessment_context is required/u);
    }

    const historical = parseQualityReport(reportWithoutContext, {
      requireCurrentFields: false,
    });
    assert.equal(
      historical.ok,
      true,
      historical.ok ? undefined : historical.error,
    );
  });

  it("rejects contradictory grounding status and unverified probes", () => {
    const completeWithGap = parseQualityReport({
      ...currentQualityReport(resolve("quality-context-fixture")),
      assessment_context: {
        ...assessmentContext,
        grounding_status: "complete",
      },
    });
    assert.deepEqual(completeWithGap, {
      ok: false,
      error:
        "report.assessment_context.unverified_probes must be empty when grounding_status is complete",
    });

    const partialWithoutGap = parseQualityReport({
      ...currentQualityReport(resolve("quality-context-fixture")),
      assessment_context: {
        ...assessmentContext,
        grounding_status: "partial",
        unverified_probes: [],
      },
    });
    assert.deepEqual(partialWithoutGap, {
      ok: false,
      error:
        "report.assessment_context.unverified_probes must name at least one probe when grounding_status is partial or blocked",
    });
  });
});

describe("quality refuted candidates", () => {
  it("accepts an empty current ledger and source-backed disproval", () => {
    const emptyLedger = parseQualityReport(
      currentQualityReport(resolve("quality-refutation-fixture")),
    );
    assert.equal(
      emptyLedger.ok,
      true,
      emptyLedger.ok ? undefined : emptyLedger.error,
    );

    const sourceBackedLedger = parseQualityReport({
      ...currentQualityReport(resolve("quality-refutation-fixture")),
      refuted_candidates: [staticRefutedCandidate()],
    });
    assert.equal(
      sourceBackedLedger.ok,
      true,
      sourceBackedLedger.ok ? undefined : sourceBackedLedger.error,
    );

    const singleQuotedAnchor = parseQualityReport({
      ...currentQualityReport(resolve("quality-refutation-fixture")),
      refuted_candidates: [
        staticRefutedCandidate({
          evidence_summary:
            "The parser rejects unknown keys (search: 'rejectUnknownKeys').",
        }),
      ],
    });
    assert.equal(
      singleQuotedAnchor.ok,
      true,
      singleQuotedAnchor.ok ? undefined : singleQuotedAnchor.error,
    );
  });

  it("accepts runtime and mixed disprovals with command provenance", () => {
    const runtimeCandidate = staticRefutedCandidate({
      file: null,
      evidence_method: "runtime-probe",
      evidence_command: "npm test -- --runInBand",
      evidence_exit_code: 0,
      evidence_summary: "The focused regression passed with zero failures.",
      evidence_excerpt: "tests 12; pass 12; fail 0",
    });
    const mixedCandidate = staticRefutedCandidate({
      evidence_method: "mixed",
      evidence_command: "npm run typecheck",
      evidence_exit_code: 0,
      evidence_summary:
        'Typecheck passed after source inspection (search: "parseQualityReport").',
    });
    const parsed = parseQualityReport({
      ...currentQualityReport(resolve("quality-refutation-fixture")),
      refuted_candidates: [runtimeCandidate, mixedCandidate],
    });
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
  });

  it("rejects an unsafe runtime evidence exit code", () => {
    assertRefutedCandidateError(
      staticRefutedCandidate({
        file: null,
        evidence_method: "runtime-probe",
        evidence_command: "npm test",
        evidence_exit_code: Number.MAX_SAFE_INTEGER + 1,
        evidence_summary: "The focused regression produced an exit status.",
      }),
      "refuted_candidates[0].evidence_exit_code must be a non-negative integer",
    );
  });

  it("requires the current ledger while normalizing its legacy absence", () => {
    const { refuted_candidates: _ledger, ...reportWithoutLedger } =
      currentQualityReport(resolve("quality-refutation-fixture"));
    const current = parseQualityReport(reportWithoutLedger);
    assert.deepEqual(current, {
      ok: false,
      error:
        "report.refuted_candidates is required for current quality reports",
    });

    const historical = parseQualityReport(reportWithoutLedger, {
      requireCurrentFields: false,
    });
    assert.equal(
      historical.ok,
      true,
      historical.ok ? undefined : historical.error,
    );
    // An old report has no recorded disprovals, so history exposes an honest empty ledger.
    assert.ok(historical.ok);
    assert.deepEqual(historical.report.refuted_candidates, []);
  });

  it("rejects each missing required candidate field", () => {
    const withoutClaim = staticRefutedCandidate();
    delete withoutClaim.claim;
    assertRefutedCandidateError(
      withoutClaim,
      "refuted_candidates[0].claim must be a string",
    );

    const withoutReason = staticRefutedCandidate();
    delete withoutReason.why_excluded;
    assertRefutedCandidateError(
      withoutReason,
      "refuted_candidates[0].why_excluded must be a string",
    );

    const withoutFile = staticRefutedCandidate();
    delete withoutFile.file;
    assertRefutedCandidateError(
      withoutFile,
      "refuted_candidates[0].file must be a string",
    );

    const withoutLine = staticRefutedCandidate();
    delete withoutLine.line;
    assertRefutedCandidateError(
      withoutLine,
      "refuted_candidates[0].line must be a positive integer or null",
    );

    const withoutEvidenceQuality = staticRefutedCandidate();
    delete withoutEvidenceQuality.evidence_quality;
    assertRefutedCandidateError(
      withoutEvidenceQuality,
      "refuted_candidates[0].evidence_quality must be one of: OBSERVED, INFERRED",
    );

    const withoutEvidenceMethod = staticRefutedCandidate();
    delete withoutEvidenceMethod.evidence_method;
    assertRefutedCandidateError(
      withoutEvidenceMethod,
      "refuted_candidates[0].evidence_method must be one of: runtime-probe, static-analysis, mixed",
    );

    const withoutEvidenceSummary = staticRefutedCandidate();
    delete withoutEvidenceSummary.evidence_summary;
    assertRefutedCandidateError(
      withoutEvidenceSummary,
      "refuted_candidates[0].evidence_summary must be a string",
    );
  });

  it("rejects unknown keys and unsupported evidence labels", () => {
    assertRefutedCandidateError(
      staticRefutedCandidate({ proof_class: "STATIC" }),
      "refuted_candidates[0] has unknown key(s): proof_class",
    );
    assertRefutedCandidateError(
      staticRefutedCandidate({ evidence_quality: "ACTUAL_MEASURED" }),
      "refuted_candidates[0].evidence_quality must be one of: OBSERVED, INFERRED",
    );
    assertRefutedCandidateError(
      staticRefutedCandidate({ evidence_method: "browser" }),
      "refuted_candidates[0].evidence_method must be one of: runtime-probe, static-analysis, mixed",
    );
    assertRefutedCandidateError(
      staticRefutedCandidate({ evidence_quality: "INFERRED" }),
      "refuted_candidates[0].evidence_quality must be OBSERVED for a refuted candidate",
    );
  });

  it("requires runtime command provenance for runtime and mixed evidence", () => {
    assertRefutedCandidateError(
      staticRefutedCandidate({
        file: null,
        evidence_method: "runtime-probe",
        evidence_summary: "The focused regression passed.",
      }),
      "refuted_candidates[0].evidence_command is required for runtime-probe evidence",
    );
    assertRefutedCandidateError(
      staticRefutedCandidate({
        evidence_method: "mixed",
        evidence_command: "npm run typecheck",
        evidence_summary:
          'Typecheck passed after source inspection (search: "parseQualityReport").',
      }),
      "refuted_candidates[0].evidence_exit_code is required for mixed evidence",
    );
  });

  it("requires a file and semantic anchor for static and mixed evidence", () => {
    assertRefutedCandidateError(
      staticRefutedCandidate({ file: null }),
      "refuted_candidates[0].file is required for static-analysis evidence",
    );
    assertRefutedCandidateError(
      staticRefutedCandidate({
        evidence_summary: "The parser calls rejectUnknownKeys before saving.",
      }),
      'refuted_candidates[0].evidence_summary must include a semantic anchor such as (search: "pattern") for static-analysis evidence',
    );
    assertRefutedCandidateError(
      staticRefutedCandidate({
        file: null,
        evidence_method: "mixed",
        evidence_command: "npm run typecheck",
        evidence_exit_code: 0,
      }),
      "refuted_candidates[0].file is required for mixed evidence",
    );
    assertRefutedCandidateError(
      staticRefutedCandidate({
        evidence_method: "mixed",
        evidence_command: "npm run typecheck",
        evidence_exit_code: 0,
        evidence_summary: "Typecheck passed after source inspection.",
      }),
      'refuted_candidates[0].evidence_summary must include a semantic anchor such as (search: "pattern") for mixed evidence',
    );
  });
});

/** Spawns the public source CLI validator against one saved report path. */
function runQualityValidate(reportPath: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli/cli.ts", "quality", "validate", reportPath],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    },
  );
}

/**
 * Writes one report body into a throwaway directory the public validator can open.
 * Use when a test needs the command's real filesystem path instead of an in-memory object.
 *
 * @param body - report to serialise; a string is written verbatim so a malformed fixture stays malformed
 * @returns the throwaway directory the caller must remove, and the report path to validate
 */
function writeQualityReportFixture(body: unknown): {
  directory: string;
  reportPath: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "goat-flow-quality-validate-"));
  const reportPath = join(directory, "report.json");
  const serialised =
    typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`;
  writeFileSync(reportPath, serialised);
  return { directory, reportPath };
}

/**
 * Build one report the compatibility parser accepts and the current-report parser rejects.
 * Use for the legacy half of every validate outcome; it omits only the provenance block.
 *
 * @param projectPath - project the report claims to describe, matched by the saver's ownership check
 * @returns a report body with no `assessment_context`, so exactly one current-report rule fails
 */
function legacyQualityReport(projectPath: string) {
  const { assessment_context: _assessmentContext, ...legacy } =
    currentQualityReport(projectPath);
  return legacy;
}

describe("quality validate", () => {
  it("gives a current report an unqualified receipt", () => {
    const fixture = writeQualityReportFixture(
      currentQualityReport(resolve("quality-validate-current")),
    );
    try {
      const result = runQualityValidate(fixture.reportPath);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(result.stdout.trim(), `OK ${fixture.reportPath}`);
      // A current report has nothing to disclose, so the advisory stream stays empty for scripts.
      assert.equal(result.stderr.trim(), "");
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("labels a legacy-compatible report and names the rule it misses", () => {
    const fixture = writeQualityReportFixture(
      legacyQualityReport(resolve("quality-validate-legacy")),
    );
    try {
      const result = runQualityValidate(fixture.reportPath);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(
        result.stdout.trim(),
        `OK LEGACY-COMPATIBLE ${fixture.reportPath}`,
      );
      // Naming the failed rule is what separates "old but readable" from "ready to save".
      assert.match(
        result.stderr,
        /report\.assessment_context is required for current quality reports/u,
      );
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("keeps the saver stricter than the validator for the same legacy bytes", () => {
    const projectRoot = makeIgnoredQualityRoot();
    const legacy = legacyQualityReport(projectRoot);
    const fixture = writeQualityReportFixture(legacy);
    try {
      const validated = runQualityValidate(fixture.reportPath);
      assert.equal(validated.status, 0, validated.stderr || validated.stdout);
      assert.match(validated.stdout, /OK LEGACY-COMPATIBLE /u);

      // The qualifier is only truthful while the saver still refuses the identical report.
      const saved = runQualitySave(projectRoot, legacy);
      assert.equal(saved.status, CLI_USAGE_EXIT_CODE);
      assert.match(
        saved.stderr,
        /report\.assessment_context is required for current quality reports/u,
      );
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects a report both parsers refuse", () => {
    const fixture = writeQualityReportFixture({
      ...currentQualityReport(resolve("quality-validate-invalid")),
      report_kind: "not-a-quality-report",
    });
    try {
      const result = runQualityValidate(fixture.reportPath);
      assert.equal(result.status, CLI_USAGE_EXIT_CODE);
      assert.match(result.stderr, /quality validate: schema error in /u);
      assert.ok(result.stderr.includes(fixture.reportPath));
      assert.equal(result.stdout.trim(), "");
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects unreadable input before either parser runs", () => {
    const malformed = writeQualityReportFixture("not json");
    try {
      const invalidJson = runQualityValidate(malformed.reportPath);
      assert.equal(invalidJson.status, CLI_USAGE_EXIT_CODE);
      assert.match(invalidJson.stderr, /quality validate: invalid JSON in /u);

      const missing = runQualityValidate(
        join(malformed.directory, "absent.json"),
      );
      assert.equal(missing.status, CLI_USAGE_EXIT_CODE);
      assert.match(missing.stderr, /quality validate: file not found: /u);
    } finally {
      rmSync(malformed.directory, { recursive: true, force: true });
    }
  });
});

describe("quality save", () => {
  it("redacts, validates, and exclusively writes under the selected project", () => {
    const projectRoot = makeIgnoredQualityRoot();
    try {
      const sensitiveValue = ["fixture", "-credential", "-value"].join("");
      const nestedDetail = [
        "API",
        "_KEY=",
        sensitiveValue,
        "; ",
        JSON.stringify({ password: sensitiveValue }),
      ].join("");
      const result = runQualitySave(
        projectRoot,
        currentQualityReport(projectRoot, nestedDetail),
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(
        result.stdout.trim(),
        /^OK .+\.goat-flow\/logs\/quality\/.+\.json$/u,
      );

      const qualityDir = join(projectRoot, ".goat-flow", "logs", "quality");
      const files = readdirSync(qualityDir);
      assert.equal(files.length, 1);
      assert.match(
        files[0] ?? "",
        /^\d{4}-\d{2}-\d{2}-\d{4}-claude-[a-z0-9]{5}\.json$/u,
      );
      const reportPath = join(qualityDir, files[0] ?? "");
      const stats = lstatSync(reportPath);
      assert.equal(stats.isFile(), true);
      assert.equal(stats.nlink, 1);
      const saved = readFileSync(reportPath, "utf8");
      assert.equal(saved.includes(sensitiveValue), false);
      assert.match(saved, /\[REDACTED:env-value\]/u);
      assert.match(saved, /\[REDACTED:field\]/u);
      assert.equal(JSON.parse(saved).project_path, projectRoot);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails closed before creating directories when reports are not ignored", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-quality-save-"));
    try {
      const result = runQualitySave(
        projectRoot,
        currentQualityReport(projectRoot),
      );

      assert.equal(result.status, CLI_USAGE_EXIT_CODE);
      assert.match(result.stderr, /must be gitignored before writing/i);
      assert.equal(readdirSync(projectRoot).includes(".goat-flow"), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("writes nothing for malformed or wrong-owner reports", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-quality-save-"));
    const otherRoot = mkdtempSync(join(tmpdir(), "goat-flow-quality-owner-"));
    try {
      const malformed = runQualitySave(projectRoot, { invalid: true });
      assert.equal(malformed.status, CLI_USAGE_EXIT_CODE);
      assert.match(malformed.stderr, /quality save: schema error/i);

      const wrongOwner = runQualitySave(
        projectRoot,
        currentQualityReport(otherRoot),
      );
      assert.equal(wrongOwner.status, CLI_USAGE_EXIT_CODE);
      assert.match(wrongOwner.stderr, /project_path.+selected project/i);
      assert.equal(
        readdirSync(projectRoot).includes(".goat-flow"),
        false,
        "validation failures must happen before directory creation",
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("rejects deeply nested invalid input without overflowing the scrubber", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-quality-save-"));
    try {
      const nesting = 15_000;
      const input = `{"unknown":${"[".repeat(nesting)}0${"]".repeat(nesting)}}`;
      const result = runQualitySaveText(projectRoot, input);

      assert.equal(result.status, CLI_USAGE_EXIT_CODE);
      assert.match(result.stderr, /quality save: schema error/i);
      assert.doesNotMatch(result.stderr, /Maximum call stack|RangeError/u);
      assert.equal(readdirSync(projectRoot).includes(".goat-flow"), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses a redirected quality-report directory", () => {
    const projectRoot = makeIgnoredQualityRoot();
    const redirectRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-quality-redirect-"),
    );
    try {
      symlinkSync(redirectRoot, join(projectRoot, ".goat-flow"));
      const result = runQualitySave(
        projectRoot,
        currentQualityReport(projectRoot),
      );
      assert.equal(result.status, CLI_USAGE_EXIT_CODE);
      assert.match(result.stderr, /must be a real project-local directory/i);
      assert.deepStrictEqual(readdirSync(redirectRoot), []);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(redirectRoot, { recursive: true, force: true });
    }
  });

  /**
   * Preserve both reports when two first saves observe the same missing directory chain.
   * Side effects: writes two local reports and removes the temporary project afterwards.
   * Fixture purpose: the injected creator completes a competing save before the first mkdir resumes.
   */
  it("keeps both valid reports when first-save directory creation races", () => {
    const projectRoot = makeIgnoredQualityRoot();
    let competingReportPath: string | null = null;
    const firstSaveDependencies = {
      CLIError,
      /** Writes the competing report, then retries this directory creation. */
      createReportDirectory(directoryPath: string): void {
        // Example: another dashboard session completes its first save while this user is saving.
        if (competingReportPath === null) {
          competingReportPath = persistCurrentQualityReport(projectRoot, {
            CLIError,
          });
        }
        mkdirSync(directoryPath);
      },
    };

    try {
      const firstReportPath = persistCurrentQualityReport(
        projectRoot,
        firstSaveDependencies,
      );

      assert.ok(competingReportPath);
      const savedReports = readdirSync(
        join(projectRoot, ".goat-flow", "logs", "quality"),
      ).map((name) => join(projectRoot, ".goat-flow", "logs", "quality", name));
      assert.equal(savedReports.length, 2);
      assert.ok(savedReports.includes(firstReportPath));
      assert.ok(savedReports.includes(competingReportPath));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  /**
   * Reject a path changed to a file while the user's first report directory is being created.
   * Side effects: writes the unsafe fixture, verifies rejection, then removes the temporary project.
   * Fixture purpose: the injected creator swaps in a file and reproduces an unsafe EEXIST race.
   */
  it("fails closed when a first-save race creates a non-directory", () => {
    const projectRoot = makeIgnoredQualityRoot();
    const unsafeSaveDependencies = {
      CLIError,
      /** Writes a file at the requested folder path to model an unsafe race. */
      createReportDirectory(directoryPath: string): void {
        // Example: an external process replaces the expected folder before the save reaches mkdir.
        writeFileSync(directoryPath, "not a directory");
        mkdirSync(directoryPath);
      },
    };

    try {
      assert.throws(
        () => persistCurrentQualityReport(projectRoot, unsafeSaveDependencies),
        /must be a real project-local directory/u,
      );
      assert.equal(lstatSync(join(projectRoot, ".goat-flow")).isFile(), true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: replaces a checked ancestor during a save and proves no report escapes.
   * Filesystem side effects: mutates paths only inside the two temporary fixture roots.
   */
  it("fails closed when a first-save race replaces an existing ancestor", () => {
    const projectRoot = makeIgnoredQualityRoot();
    const outsideRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-quality-outside-"),
    );
    mkdirSync(join(projectRoot, ".goat-flow"));
    let hasSwappedAncestor = false;
    const unsafeSaveDependencies = {
      CLIError,
      /** Renames the checked ancestor, writes a symlink, then creates the requested child. */
      createReportDirectory(directoryPath: string): void {
        if (!hasSwappedAncestor) {
          hasSwappedAncestor = true;
          renameSync(
            join(projectRoot, ".goat-flow"),
            join(projectRoot, ".goat-flow-original"),
          );
          symlinkSync(outsideRoot, join(projectRoot, ".goat-flow"), "dir");
        }
        mkdirSync(directoryPath);
      },
    };

    try {
      assert.throws(
        () => persistCurrentQualityReport(projectRoot, unsafeSaveDependencies),
        /must be a real project-local directory/u,
      );
      assert.deepEqual(readdirSync(join(outsideRoot, "logs", "quality")), []);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: swaps the checked report directory at allocation and proves no report bytes escape.
   * Filesystem side effects: mutates paths only inside the two temporary fixture roots.
   */
  it("fails closed when report allocation follows a swapped parent", () => {
    const projectRoot = makeIgnoredQualityRoot();
    const outsideRoot = mkdtempSync(join(tmpdir(), "quality-outside-"));
    const qualityDirectory = join(projectRoot, ".goat-flow/logs/quality");
    const unsafeSaveDependencies = {
      CLIError,
      /** Filesystem side effects: renames the checked parent, symlinks it outside, and allocates an empty report there. */
      openReportFile(reportPath: string): number {
        renameSync(qualityDirectory, `${qualityDirectory}-original`);
        symlinkSync(outsideRoot, qualityDirectory, "dir");
        return openSync(reportPath, "wx", 0o600);
      },
    };

    try {
      assert.throws(
        () => persistCurrentQualityReport(projectRoot, unsafeSaveDependencies),
        /must be a real project-local directory/u,
      );
      const [escapedFile] = readdirSync(outsideRoot);
      assert.equal(lstatSync(join(outsideRoot, escapedFile ?? "")).size, 0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe("skill subcommand parsing", () => {
  it("keeps projectPath at cwd instead of treating 'new' as a path", () => {
    const redLogPath =
      ".goat-flow/logs/sessions/2026-07-17-deploy-checks-tdd.md";
    const parsed = parseCLIArgs([
      "skill",
      "new",
      "I want a workflow for deploy checks",
      "--name",
      "deploy-checks",
      "--red-log",
      redLogPath,
      "--yes",
    ]);
    assert.equal(parsed.command, "skill");
    assert.equal(parsed.skillSubcommand, "new");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(
      parsed.skillDescription,
      "I want a workflow for deploy checks",
    );
    assert.equal(parsed.skillRedLogPath, resolve(redLogPath));
  });

  it("parses an explicit project path after skill new", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-skill-cli-"));
    const redLogPath =
      ".goat-flow/logs/sessions/2026-07-17-deploy-checks-tdd.md";
    try {
      const parsed = parseCLIArgs([
        "skill",
        "new",
        projectRoot,
        "I want a workflow for deploy checks",
        "--red-log",
        redLogPath,
      ]);
      assert.equal(parsed.command, "skill");
      assert.equal(parsed.skillSubcommand, "new");
      assert.equal(parsed.projectPath, projectRoot);
      assert.equal(
        parsed.skillDescription,
        "I want a workflow for deploy checks",
      );
      assert.equal(parsed.skillRedLogPath, resolve(projectRoot, redLogPath));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("parses an explicit project path before skill new", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-skill-cli-"));
    try {
      const parsed = parseCLIArgs([
        "skill",
        projectRoot,
        "new",
        "I want a workflow for deploy checks",
      ]);
      assert.equal(parsed.command, "skill");
      assert.equal(parsed.skillSubcommand, "new");
      assert.equal(parsed.projectPath, projectRoot);
      assert.equal(
        parsed.skillDescription,
        "I want a workflow for deploy checks",
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("parses skill doctor with the shared agent/format flags and a skill filter", () => {
    const parsed = parseCLIArgs([
      "skill",
      "doctor",
      ".",
      "--agent",
      "codex",
      "--skill",
      "goat",
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "skill");
    assert.equal(parsed.skillSubcommand, "doctor");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.skillFilter, "goat");
    assert.equal(parsed.format, "json");
  });

  it("parses a project path before skill doctor", () => {
    const parsed = parseCLIArgs(["skill", ".", "doctor"]);

    assert.equal(parsed.skillSubcommand, "doctor");
    assert.equal(parsed.projectPath, resolve("."));
  });

  it("reports a missing skill subcommand after a project path", () => {
    assert.throws(
      () => parseCLIArgs(["skill", "./fixture-project"]),
      (error: unknown) =>
        error instanceof CLIError &&
        error.exitCode === CLI_USAGE_EXIT_CODE &&
        /project path.*missing a subcommand.*new.*doctor/iu.test(error.message),
    );
  });

  it("rejects unsupported agent profiles before skill doctor dispatch", () => {
    assert.throws(
      () => parseCLIArgs(["skill", "doctor", "--agent", "unknown"]),
      /Invalid agent: unknown/i,
    );
  });

  it("keeps skill-new write flags out of the read-only doctor mode", () => {
    assert.throws(
      () => parseCLIArgs(["skill", "doctor", "--yes"]),
      /--yes is only valid for skill new/i,
    );
    assert.throws(
      () => parseCLIArgs(["skill", "new", "description", "--skill", "goat"]),
      /--skill is only valid for skill doctor/i,
    );
  });
});

describe("quality candidacy draft naming", () => {
  it("uses the platform path basename instead of POSIX-only splitting", () => {
    const qualityCommandSource = readFileSync(
      resolve(
        import.meta.dirname,
        "..",
        "..",
        "src",
        "cli",
        "quality",
        "quality-command.ts",
      ),
      "utf-8",
    );
    assert.match(qualityCommandSource, /basename\(path\)\.replace/);
    assert.doesNotMatch(qualityCommandSource, /path\.split\("\/"\)/);
  });
});
