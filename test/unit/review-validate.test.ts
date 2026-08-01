/**
 * Review-output validator coverage from pure grammar checks through CLI registration.
 * Fixtures use real files so semantic-anchor and refutation-ledger claims are behavioural.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";

import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import {
  renderReviewValidationResult,
  validateReviewReport,
} from "../../src/cli/review-validate.js";

const FRAMEWORK_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(FRAMEWORK_ROOT, "src", "cli", "cli.ts");

/** Create a disposable reviewed project whose source anchor can be resolved literally. */
function createReviewedProject(testContext: TestContext): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-review-validate-"));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(
    join(projectRoot, "src", "example.ts"),
    "export function loadConfig(): string { return 'configured'; }\n",
    "utf-8",
  );
  testContext.after(() =>
    rmSync(projectRoot, { recursive: true, force: true }),
  );
  return projectRoot;
}

/** Render one full report using every validator-owned finding and integrity field. */
function validReview(
  anchorPath = "src/example.ts",
  anchorText = "loadConfig",
  refutationsLogged: number | string = 0,
): string {
  return `## TL;DR

One configuration defect survived review.

## Review Integrity
- Scope snapshot: source=worktree, base=HEAD, head=worktree, uncommitted=yes, signals=1, bundle=n/a, chunking=none
- Files opened in Pass 2: 1/1 (diff paths: ${anchorPath})
- Evidence: 4 OBSERVED / 0 INFERRED
- Verdicts: 4/0/0/0
- Refutations logged: ${refutationsLogged}
- Review validator: validated
- Gates: skipped (not requested)
- Gate evidence: pass=0, changed-code=0, pre-existing=0, infrastructure=0, unresolved=0
- Size: 1 files, 1 changed lines (bundle chunks: no)
- Automated-review provenance: overlap-confirmed=0, local-only=4, bot-only-locally-verified=0, disputed-match=0; automated findings the local review missed: none; local findings every bot missed: R-001, R-002, R-003, R-004
- Refuter pass: yes; confirmed=1, refuted=0, unresolved=0, leads-verified=0, model=test-refuter
- Spec drift: checked M05
- Degradation flags: gates-not-run
- Conclusion: coverage-degraded

## Findings

### MUST / SHOULD / MAY
- R-001 [SHOULD:patch] [local-only] **Handle missing configuration** \`${anchorPath}\` (search: \`${anchorText}\`) - The loader accepts an empty value. | Harm: requests use an invalid configuration. | Footgun: none | Evidence: OBSERVED | Proof: STATIC
- R-002 [MAY:needs-signal] [local-only] **Expose fallback telemetry** \`${anchorPath}\` (search: \`${anchorText}\`) - The fallback has no operator signal. | Footgun: none | Evidence: OBSERVED | Proof: CONTRACT-GREP
- R-003 [MAY:patch] [local-only] **Cover the caller contract** \`${anchorPath}\` (search: \`${anchorText}\`) - The caller lacks a focused regression. | Footgun: none | Evidence: OBSERVED | Proof: STATIC

## Systemic Patterns
- R-004 [MAY:needs-signal] [local-only] [CONFIRMED-CROSS-MODEL] **Group configuration fallback gaps** - affected anchors: \`${anchorPath}\` (search: \`${anchorText}\`); repeated failure: three configuration checks share one silent fallback root | Evidence: OBSERVED | Proof: CONTRACT-GREP

## Spec Drift
- [advisory] **Milestone evidence** - claimed done in M05 but not supported by diff
- [ready-to-tick] **Validator fixture** - now satisfied by diff, milestone still shows open

## Ship Verdict
Decision: **YES WITH CONDITIONS**
Reasoning: R-001 remains open.
Confidence: MEDIUM
`;
}

/** Add two valid surfaced findings so the report crosses the Top 5 threshold. */
function withSixSurfacedFindings(report: string): string {
  const additions = `- R-005 [MAY:patch] [local-only] **Cover configuration parsing** \`src/example.ts\` (search: \`loadConfig\`) - Parsing lacks one focused assertion. | Footgun: none | Evidence: OBSERVED | Proof: STATIC
- R-006 [MAY:needs-signal] [local-only] **Trace configuration defaults** \`src/example.ts\` (search: \`loadConfig\`) - Default selection lacks an operator signal. | Footgun: none | Evidence: OBSERVED | Proof: CONTRACT-GREP

`;
  return report.replace(
    "## Systemic Patterns",
    `${additions}## Systemic Patterns`,
  );
}

/** Insert one Top 5 section immediately before the verdict. */
function withTopFiveRisk(
  report: string,
  findingId = "R-001",
  anchorText = "loadConfig",
): string {
  const topFive = `## Top 5 Risks (cross-tier)
1. ${findingId} [SHOULD:patch] **Configuration risk** \`src/example.ts\` (search: \`${anchorText}\`) - invalid configuration can reach requests

`;
  return report.replace("## Ship Verdict", `${topFive}## Ship Verdict`);
}

interface ValidationIssueShape {
  checkId?: string;
  code: string;
  line: number | null;
  message: string;
}

/** Read warning output while RED remains compatible with the pre-warning result type. */
function warningsOf(
  result: ReturnType<typeof validateReviewReport>,
): ValidationIssueShape[] {
  return (
    (
      result as ReturnType<typeof validateReviewReport> & {
        warnings?: ValidationIssueShape[];
      }
    ).warnings ?? []
  );
}

/** Return true when a validation result contains one named violation class. */
function hasViolation(
  result: ReturnType<typeof validateReviewReport>,
  code: string,
): boolean {
  return result.violations.some((violation) => violation.code === code);
}

/** Return true when one issue carries the public V1-V8 check ID and detail code. */
function hasCheck(
  issues: ValidationIssueShape[],
  checkId: string,
  code: string,
): boolean {
  return issues.some(
    (issue) => issue.checkId === checkId && issue.code === code,
  );
}

describe("review output validation", () => {
  it("accepts a complete report and the compact clean-review surface", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    assert.deepEqual(
      validateReviewReport(validReview(), projectRoot).violations,
      [],
    );

    const compact = `Scope: reviewed worktree at HEAD; 1 file and 1 changed line.
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
`;
    assert.deepEqual(validateReviewReport(compact, projectRoot).violations, []);
  });

  it("requires validator status and gate evidence in full and compact integrity", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const missingValidator = validateReviewReport(
      validReview().replace("- Review validator: validated\n", ""),
      projectRoot,
    );
    const missingGateEvidence = validateReviewReport(
      validReview().replace(
        "- Gate evidence: pass=0, changed-code=0, pre-existing=0, infrastructure=0, unresolved=0\n",
        "",
      ),
      projectRoot,
    );
    const compactWithoutValidator = validateReviewReport(
      `Scope: reviewed worktree at HEAD; 1 file and 1 changed line.
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams.
Review Integrity: confident; 1/1 files opened; no degradation flags.
What I Didn't Examine: none.
`,
      projectRoot,
    );

    for (const result of [
      missingValidator,
      missingGateEvidence,
      compactWithoutValidator,
    ]) {
      assert.equal(
        hasCheck(
          result.violations as ValidationIssueShape[],
          "V5",
          "integrity-format",
        ),
        true,
      );
    }
  });

  it("rejects an unresolved semantic anchor", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const result = validateReviewReport(
      validReview("src/example.ts", "missingSymbol"),
      projectRoot,
    );
    assert.equal(hasViolation(result, "anchor-unresolved"), true);
  });

  it("rejects missing Evidence and Proof tags", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const missingEvidence = validReview().replace(
      " | Evidence: OBSERVED | Proof: STATIC",
      " | Proof: STATIC",
    );
    const missingProof = validReview().replace(" | Proof: STATIC", "");
    assert.equal(
      hasViolation(
        validateReviewReport(missingEvidence, projectRoot),
        "finding-evidence",
      ),
      true,
    );
    assert.equal(
      hasViolation(
        validateReviewReport(missingProof, projectRoot),
        "finding-proof",
      ),
      true,
    );
  });

  it("requires Harm on MUST and SHOULD findings", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = validReview().replace(
      " | Harm: requests use an invalid configuration.",
      "",
    );
    assert.equal(
      hasViolation(validateReviewReport(report, projectRoot), "finding-harm"),
      true,
    );
  });

  it("rejects malformed R-IDs and retired overlap tags", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const missingId = validReview().replace(
      "- R-001 [SHOULD:patch]",
      "- [SHOULD:patch]",
    );
    const retiredOverlap = validReview().replace(
      "[local-only]",
      "[overlap:reviewer]",
    );
    assert.equal(
      hasViolation(
        validateReviewReport(missingId, projectRoot),
        "finding-grammar",
      ),
      true,
    );
    assert.equal(
      hasViolation(
        validateReviewReport(retiredOverlap, projectRoot),
        "finding-grammar",
      ),
      true,
    );
  });

  it("rejects an unparseable Review Integrity block", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = validReview().replace(
      "- Verdicts: 4/0/0/0",
      "- Verdicts: two",
    );
    assert.equal(
      hasViolation(
        validateReviewReport(report, projectRoot),
        "integrity-format",
      ),
      true,
    );
  });

  it("requires a local refutation ledger when the report claims one", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const result = validateReviewReport(
      validReview(undefined, undefined, 1),
      projectRoot,
    );
    assert.equal(hasViolation(result, "refutation-ledger"), true);
  });

  it("accepts a claimed refutation when a non-empty ledger exists", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const ledgerRoot = join(projectRoot, ".goat-flow", "logs", "review");
    mkdirSync(ledgerRoot, { recursive: true });
    writeFileSync(
      join(ledgerRoot, "goat-review-refutations.fixture.txt"),
      "R-003 refuted by an existing guard\n",
      "utf-8",
    );
    assert.deepEqual(
      validateReviewReport(validReview(undefined, undefined, 1), projectRoot)
        .violations,
      [],
    );
  });

  it("accepts a persist-skipped refutation count without a local ledger", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = validReview(
      undefined,
      undefined,
      "1 (persist-skipped)",
    ).replace(
      "- Degradation flags: gates-not-run",
      "- Degradation flags: gates-not-run, persist-skipped: redactor-unavailable",
    );
    const result = validateReviewReport(report, projectRoot);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(warningsOf(result), []);
  });

  it("permits pre-existing actions only when Scope snapshot declares area mode", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const diffReport = validReview().replace(
      "[MAY:patch] [local-only] **Cover the caller contract**",
      "[MAY:pre-existing] [local-only] **Cover the caller contract**",
    );
    const areaReport = diffReport.replace("source=worktree", "source=area");

    assert.equal(
      hasCheck(
        validateReviewReport(diffReport, projectRoot)
          .violations as ValidationIssueShape[],
        "V2",
        "finding-action-scope",
      ),
      true,
    );
    assert.deepEqual(
      validateReviewReport(areaReport, projectRoot).violations,
      [],
    );
  });

  it("rejects duplicate definitions and unresolved Top 5 R-ID references", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const duplicate = validReview().replace(
      "- R-003 [MAY:patch]",
      "- R-002 [MAY:patch]",
    );
    const unknownReference = withTopFiveRisk(validReview(), "R-999");

    assert.equal(
      hasCheck(
        validateReviewReport(duplicate, projectRoot)
          .violations as ValidationIssueShape[],
        "V6",
        "finding-id-duplicate",
      ),
      true,
    );
    assert.equal(
      hasCheck(
        validateReviewReport(unknownReference, projectRoot)
          .violations as ValidationIssueShape[],
        "V6",
        "finding-reference-unresolved",
      ),
      true,
    );
  });

  it("preserves moved refuter IDs while rejecting undefined secondary references", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const refuted = validReview().replace(
      "## Spec Drift",
      `## Refuted by Refuter
- R-005 [MAY:patch] [CONFIRMED-CROSS-MODEL] **Retire a disproved concern** \`src/example.ts\` (search: \`loadConfig\`) - The host reproduced the removing guard. | Evidence: OBSERVED | Proof: RUNTIME

## Spec Drift`,
    );
    assert.deepEqual(validateReviewReport(refuted, projectRoot).violations, []);

    const unresolvedReference = refuted.replace(
      "The host reproduced the removing guard.",
      "The host reproduced the removing guard; related claim R-999 remains.",
    );
    assert.equal(
      hasCheck(
        validateReviewReport(unresolvedReference, projectRoot)
          .violations as ValidationIssueShape[],
        "V6",
        "finding-reference-unresolved",
      ),
      true,
    );
  });

  it("resolves every semantic anchor cited by Top 5 Risks", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = withTopFiveRisk(
      withSixSurfacedFindings(validReview()),
      "R-001",
      "missingTopFiveAnchor",
    );
    const result = validateReviewReport(report, projectRoot);
    assert.equal(
      hasCheck(
        result.violations as ValidationIssueShape[],
        "V1",
        "anchor-unresolved",
      ),
      true,
    );
  });

  it("warns for unknown degradation flags without failing validation", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = validReview().replace(
      "- Degradation flags: gates-not-run",
      "- Degradation flags: gates-not-run, mystery-degradation",
    );
    const result = validateReviewReport(report, projectRoot);
    assert.equal(result.status, "pass");
    assert.equal(
      hasCheck(warningsOf(result), "V5", "degradation-flag-unknown"),
      true,
    );
    assert.match(
      renderReviewValidationResult(result),
      /^review validate: PASS \(1 warning\)/u,
    );
  });

  it("warns for conditional Top 5 and empty optional-section defects", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const prematureTopFive = validateReviewReport(
      withTopFiveRisk(validReview()),
      projectRoot,
    );
    const missingTopFive = validateReviewReport(
      withSixSurfacedFindings(validReview()),
      projectRoot,
    );
    const emptyOptional = validateReviewReport(
      validReview().replace(
        "## Ship Verdict",
        "## Breaking Changes\n\n## Ship Verdict",
      ),
      projectRoot,
    );

    assert.equal(
      hasCheck(warningsOf(prematureTopFive), "V7", "top-five-unexpected"),
      true,
    );
    assert.equal(
      hasCheck(warningsOf(missingTopFive), "V7", "top-five-missing"),
      true,
    );
    assert.equal(
      hasCheck(warningsOf(emptyOptional), "V7", "optional-section-empty"),
      true,
    );
    assert.equal(prematureTopFive.status, "pass");
    assert.equal(missingTopFive.status, "pass");
    assert.equal(emptyOptional.status, "pass");
  });

  it("maps the seeded structural corpus to V1-V6 and V8", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const fixtures: Array<{
      checkId: string;
      code: string;
      report: string;
    }> = [
      {
        checkId: "V1",
        code: "anchor-unresolved",
        report: validReview("src/example.ts", "missingSymbol"),
      },
      {
        checkId: "V2",
        code: "finding-grammar",
        report: validReview().replace(
          "- R-001 [SHOULD:patch]",
          "- R-01 [SHOULD:patch]",
        ),
      },
      {
        checkId: "V3",
        code: "finding-harm",
        report: validReview().replace(
          " | Harm: requests use an invalid configuration.",
          "",
        ),
      },
      {
        checkId: "V4",
        code: "finding-evidence",
        report: validReview().replace(" | Evidence: OBSERVED", ""),
      },
      {
        checkId: "V5",
        code: "integrity-format",
        report: validReview().replace("- Review validator: validated\n", ""),
      },
      {
        checkId: "V6",
        code: "finding-id-duplicate",
        report: validReview().replace(
          "- R-003 [MAY:patch]",
          "- R-002 [MAY:patch]",
        ),
      },
      {
        checkId: "V8",
        code: "refutation-ledger",
        report: validReview(undefined, undefined, 1),
      },
    ];

    for (const fixture of fixtures) {
      const result = validateReviewReport(fixture.report, projectRoot);
      assert.equal(
        hasCheck(
          result.violations as ValidationIssueShape[],
          fixture.checkId,
          fixture.code,
        ),
        true,
        `${fixture.checkId} should emit ${fixture.code}`,
      );
    }
  });

  it("renders every violation with its class and line when available", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const result = validateReviewReport(
      validReview("src/example.ts", "missingSymbol").replace(
        " | Harm: requests use an invalid configuration.",
        "",
      ),
      projectRoot,
    );
    const rendered = renderReviewValidationResult(result);
    assert.match(rendered, /^review validate: FAIL \(\d+ violations\)/u);
    assert.match(rendered, /line \d+ \[V1\/anchor-unresolved\]/u);
    assert.match(rendered, /line \d+ \[V3\/finding-harm\]/u);
  });
});

describe("review validate CLI", () => {
  it("parses stdin-first and optional-file forms from the reviewed-project cwd", () => {
    const stdinForm = parseCLIArgs(["review", "validate"]);
    assert.equal(stdinForm.command, "review");
    assert.equal(stdinForm.reviewSubcommand, "validate");
    assert.equal(stdinForm.reviewValidatePath, null);
    assert.equal(stdinForm.projectPath, resolve("."));

    const fileForm = parseCLIArgs(["review", "validate", "saved-review.md"]);
    assert.equal(fileForm.reviewValidatePath, resolve("saved-review.md"));
    assert.equal(fileForm.projectPath, resolve("."));
  });

  it("rejects missing, unknown, and extra review positionals", () => {
    assert.throws(
      () => parseCLIArgs(["review"]),
      /requires subcommand "validate"/iu,
    );
    assert.throws(
      () => parseCLIArgs(["review", "check"]),
      /requires subcommand "validate"/iu,
    );
    assert.throws(
      () => parseCLIArgs(["review", "validate", "one.md", "two.md"]),
      /at most one \[report-file\]/iu,
    );
  });

  it("accepts review help without a report and validates stdin end to end", () => {
    const help = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_PATH, "review", "--help"],
      { cwd: FRAMEWORK_ROOT, encoding: "utf-8" },
    );
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /review validate \[report-file\]/u);
    assert.match(help.stdout, /structural failures exit 1/iu);
    assert.match(help.stdout, /advisory warnings.*exit 0/iu);

    const report = validReview("src/cli/cli.ts", "printHelp");
    const valid = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_PATH, "review", "validate"],
      { cwd: FRAMEWORK_ROOT, encoding: "utf-8", input: report },
    );
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /review validate: PASS/u);
  });

  it("exits one and reports each stdin violation", () => {
    const report = validReview(
      "src/cli/cli.ts",
      "missingReviewValidatorAnchor",
    ).replace(" | Harm: requests use an invalid configuration.", "");
    const invalid = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_PATH, "review", "validate"],
      { cwd: FRAMEWORK_ROOT, encoding: "utf-8", input: report },
    );
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.match(invalid.stdout, /\[V1\/anchor-unresolved\]/u);
    assert.match(invalid.stdout, /\[V3\/finding-harm\]/u);
  });

  it("keeps warning-only CLI results at exit zero", () => {
    const report = validReview("src/cli/cli.ts", "printHelp").replace(
      "- Degradation flags: gates-not-run",
      "- Degradation flags: gates-not-run, mystery-degradation",
    );
    const warned = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_PATH, "review", "validate"],
      { cwd: FRAMEWORK_ROOT, encoding: "utf-8", input: report },
    );
    assert.equal(warned.status, 0, warned.stderr);
    assert.match(warned.stdout, /review validate: PASS \(1 warning\)/u);
    assert.match(warned.stdout, /\[V5\/degradation-flag-unknown\]/u);
  });
});
