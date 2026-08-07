/**
 * How a review's claims are held to its contents: refutation ledgers that must exist,
 * Top 5 references that must resolve, and a Ship Verdict the findings actually justify -
 * plus the CLI surface that runs the same checks from stdin.
 * Fixtures use real files so anchor and ledger claims are behavioural, not mocked.
 */
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import {
  renderReviewValidationResult,
  validateReviewReport,
} from "../../src/cli/review-validate.js";
import {
  FRAMEWORK_ROOT,
  CLI_PATH,
  createReviewedProject,
  validReview,
  withSixSurfacedFindings,
  withTopFiveRisk,
  warningsOf,
  hasCheck,
  hasViolation,
} from "./review-validate.helpers.js";
import type { ValidationIssueShape } from "./review-validate.helpers.js";

describe("review output validation: ledger, sections, and verdict", () => {
  it("rejects duplicate finding sections and integrity fields", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const duplicateFindings = validReview().replace(
      "## Systemic Patterns",
      "## Findings\n\nDuplicate surface.\n\n## Systemic Patterns",
    );
    const duplicateIntegrityField = validReview().replace(
      "- Scope snapshot: source=worktree",
      "- Scope snapshot: source=area\n- Scope snapshot: source=worktree",
    );

    assert.equal(
      hasCheck(
        validateReviewReport(duplicateFindings, projectRoot)
          .violations as ValidationIssueShape[],
        "V2",
        "finding-section-duplicate",
      ),
      true,
    );
    assert.equal(
      hasCheck(
        validateReviewReport(duplicateIntegrityField, projectRoot)
          .violations as ValidationIssueShape[],
        "V5",
        "integrity-field-duplicate",
      ),
      true,
    );
  });

  it("permits compact integrity only on zero-finding reports", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const compactWithFindings = validReview().replace(
      /## Review Integrity\n[\s\S]*?\n## Findings/u,
      "Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.\n\n## Findings",
    );
    const result = validateReviewReport(compactWithFindings, projectRoot);

    assert.equal(
      hasCheck(
        result.violations as ValidationIssueShape[],
        "V5",
        "integrity-format",
      ),
      true,
    );
    assert.match(
      result.violations.map((violation) => violation.message).join("\n"),
      /zero-finding review/u,
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

  it("accepts a claimed refutation only from its declared counted ledger", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const ledgerRoot = join(projectRoot, ".goat-flow", "logs", "review");
    mkdirSync(ledgerRoot, { recursive: true });
    const ledgerPath =
      ".goat-flow/logs/review/goat-review-refutations.fixture.txt";
    writeFileSync(
      join(projectRoot, ledgerPath),
      "- R-003 | Suspicion: missing guard | Evidence: caller rejects empty values | Rationale: the guard removes reachability\n",
      "utf-8",
    );
    assert.deepEqual(
      validateReviewReport(
        validReview(undefined, undefined, 1, ledgerPath),
        projectRoot,
      ).violations,
      [],
    );
  });

  it("rejects stale unrelated ledgers and declared count mismatches", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const ledgerRoot = join(projectRoot, ".goat-flow", "logs", "review");
    mkdirSync(ledgerRoot, { recursive: true });
    writeFileSync(
      join(ledgerRoot, "goat-review-refutations.stale.txt"),
      "- R-099 | Suspicion: stale | Evidence: stale | Rationale: stale\n",
      "utf-8",
    );
    const unrelated = validateReviewReport(
      validReview(undefined, undefined, 1),
      projectRoot,
    );
    assert.equal(hasViolation(unrelated, "refutation-ledger"), true);

    const declaredPath =
      ".goat-flow/logs/review/goat-review-refutations.current.txt";
    writeFileSync(
      join(projectRoot, declaredPath),
      "- R-003 | Suspicion: first | Evidence: guard | Rationale: disproved\n",
      "utf-8",
    );
    const mismatch = validateReviewReport(
      validReview(undefined, undefined, 2, declaredPath),
      projectRoot,
    );
    assert.equal(hasViolation(mismatch, "refutation-ledger"), true);
    assert.match(
      mismatch.violations.map((violation) => violation.message).join("\n"),
      /has 1 records.*claims 2/u,
    );
  });

  it("accepts a persist-skipped refutation count without a local ledger", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = validReview(
      undefined,
      undefined,
      "1 (persist-skipped)",
      "persist-skipped",
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
    const refuted = validReview()
      .replace("- Evidence: 4 OBSERVED", "- Evidence: 5 OBSERVED")
      .replace("- Verdicts: 4/0/0/0", "- Verdicts: 5/0/0/0")
      .replace(
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
    const longHeadingReport = withTopFiveRisk(
      withSixSurfacedFindings(validReview()),
      "R-001",
      "missingTopFiveAnchor",
    );
    const shortHeadingReport = longHeadingReport.replace(
      "## Top 5 Risks (cross-tier)",
      "## Top 5 Risks",
    );

    const longHeadingResult = validateReviewReport(
      longHeadingReport,
      projectRoot,
    );
    const shortHeadingResult = validateReviewReport(
      shortHeadingReport,
      projectRoot,
    );
    assert.equal(
      hasCheck(
        longHeadingResult.violations as ValidationIssueShape[],
        "V1",
        "anchor-unresolved",
      ),
      true,
    );
    assert.equal(
      hasCheck(
        shortHeadingResult.violations as ValidationIssueShape[],
        "V1",
        "anchor-unresolved",
      ),
      true,
    );
  });

  it("accepts both documented Top 5 headings without a missing-section warning", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = withTopFiveRisk(
      withSixSurfacedFindings(validReview()),
    ).replace("## Top 5 Risks (cross-tier)", "## Top 5 Risks");
    const result = validateReviewReport(report, projectRoot);

    assert.deepEqual(result.violations, []);
    assert.equal(hasCheck(warningsOf(result), "V7", "top-five-missing"), false);
  });

  it("rejects Ship Verdict decisions that contradict severity or integrity", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const severityConflict = validReview()
      .replace("[SHOULD:patch]", "[MUST:patch]")
      .replace("Decision: **PARTIAL**", "Decision: **YES**");
    const degradationConflict = validReview().replace(
      "Decision: **PARTIAL**",
      "Decision: **YES WITH CONDITIONS**",
    );

    const severityConflictResult = validateReviewReport(
      severityConflict,
      projectRoot,
    );
    const degradationConflictResult = validateReviewReport(
      degradationConflict,
      projectRoot,
    );

    assert.equal(
      hasCheck(
        severityConflictResult.violations as ValidationIssueShape[],
        "V5",
        "ship-verdict-contradiction",
      ),
      true,
    );
    assert.equal(
      hasCheck(
        degradationConflictResult.violations as ValidationIssueShape[],
        "V5",
        "ship-verdict-contradiction",
      ),
      true,
    );
  });

  it("reconciles risk-depth-declined with a partial conclusion and verdict cap", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const overconfident = validReview()
      .replace(
        "- Degradation flags: gates-not-run",
        "- Degradation flags: risk-depth-declined",
      )
      .replace("- Conclusion: coverage-degraded", "- Conclusion: confident")
      .replace("Decision: **PARTIAL**", "Decision: **YES WITH CONDITIONS**");
    const aboveCap = validReview()
      .replace("[SHOULD:patch]", "[MAY:patch]")
      .replace(
        "- Degradation flags: gates-not-run",
        "- Degradation flags: risk-depth-declined",
      )
      .replace("- Conclusion: coverage-degraded", "- Conclusion: partial")
      .replace("Decision: **PARTIAL**", "Decision: **YES WITH CONDITIONS**");

    const overconfidentResult = validateReviewReport(
      overconfident,
      projectRoot,
    );
    const aboveCapResult = validateReviewReport(aboveCap, projectRoot);

    assert.match(
      overconfidentResult.violations
        .map((violation) => violation.message)
        .join("\n"),
      /risk-depth-declined requires Conclusion: partial/u,
    );
    assert.match(
      aboveCapResult.violations
        .map((violation) => violation.message)
        .join("\n"),
      /Ship Verdict claims YES WITH CONDITIONS.*require PARTIAL/u,
    );
  });

  /** A declared coverage loss cannot retain the validator's strongest confidence claim. */
  it("rejects confident conclusions paired with degradation flags", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const overconfident = validReview()
      .replace("- Conclusion: coverage-degraded", "- Conclusion: confident")
      .replace("Decision: **PARTIAL**", "Decision: **YES WITH CONDITIONS**");

    const result = validateReviewReport(overconfident, projectRoot);

    assert.match(
      result.violations.map((violation) => violation.message).join("\n"),
      /degradation flags require a non-confident Conclusion/u,
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

  it("rejects empty or contradictory degradation flag lists", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const emptyFlag = validReview().replace(
      "- Degradation flags: gates-not-run",
      "- Degradation flags: gates-not-run,",
    );
    const contradictoryNone = validReview().replace(
      "- Degradation flags: gates-not-run",
      "- Degradation flags: none, gates-not-run",
    );

    assert.match(
      validateReviewReport(emptyFlag, projectRoot)
        .violations.map((violation) => violation.message)
        .join("\n"),
      /must not contain an empty list item/u,
    );
    assert.match(
      validateReviewReport(contradictoryNone, projectRoot)
        .violations.map((violation) => violation.message)
        .join("\n"),
      /cannot combine "none" with another flag/u,
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

  const structuralValidationCases: Array<{
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

  // Separate names make a validator-class regression visible directly in TAP output.
  for (const fixture of structuralValidationCases) {
    it(`maps the seeded structural corpus to ${fixture.checkId}/${fixture.code}`, (testContext) => {
      const projectRoot = createReviewedProject(testContext);
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
    });
  }

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

  // Covers writing validation output through --output: writes the file and expects its contents to match.
  it("writes validation output through --output", (testContext) => {
    const outputRoot = mkdtempSync(join(tmpdir(), "goat-flow-review-output-"));
    testContext.after(() =>
      rmSync(outputRoot, { recursive: true, force: true }),
    );
    const outputPath = join(outputRoot, "validation.txt");
    const report = validReview("src/cli/cli.ts", "printHelp");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        CLI_PATH,
        "review",
        "validate",
        "--output",
        outputPath,
      ],
      { cwd: FRAMEWORK_ROOT, encoding: "utf-8", input: report },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(readFileSync(outputPath, "utf-8"), /review validate: PASS/u);
  });
});
