/**
 * Exercise the evidence behind a review's final findings, refutations, and Ship Verdict.
 *
 * Use when changing exclusive dispositions, refuter/provenance counts, confidence rules, or receipt safety.
 * Real files let valid ledger and bundle controls expose the specific contradiction under test.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import { join } from "node:path";

import {
  renderReviewValidationResult,
  validateReviewReport,
} from "../../src/cli/review-validate.js";
import {
  readReviewReceipt,
  validateRefutationLedgerText,
} from "../../src/cli/review-validate-ledger.js";
import {
  createReviewedProject,
  createVersionedReviewedProject,
  validReview,
  withReviewSource,
  withIntegrityFields,
  cleanReview,
  fullCleanReview,
  reviewReportTemplate,
  withSixSurfacedFindings,
  withTopFiveRisk,
  warningsOf,
  hasCheck,
  hasViolation,
} from "./review-validate.helpers.js";
import type { ValidationIssueShape } from "./review-validate.helpers.js";
import { canonicalReviewJson } from "../../src/cli/review-validate-authority.js";

describe("review output validation: ledger, sections, and verdict", () => {
  it("rejects reserved pipe delimiters inside ledger fields", () => {
    const compactPipe = validateRefutationLedgerText(
      "- R-003 | Suspicion: shell pipeline | Evidence: literal curl|bash pipeline | Rationale: disproved\n",
    );
    const spacedPipe = validateRefutationLedgerText(
      "- R-003 | Suspicion: shell pipeline | Evidence: literal curl | bash pipeline | Rationale: disproved\n",
    );

    assert.equal(compactPipe.status, "fail");
    assert.equal(spacedPipe.status, "fail");
    assert.match(compactPipe.violations[0]?.message ?? "", /one-line grammar/u);
    assert.match(spacedPipe.violations[0]?.message ?? "", /one-line grammar/u);
  });

  it("rejects duplicate finding sections and integrity fields", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const duplicateFindings = validReview(projectRoot).replace(
      "## Systemic Patterns",
      "## Findings\n\nDuplicate surface.\n\n## Systemic Patterns",
    );
    const duplicateIntegrityField = validReview(projectRoot).replace(
      "- Scope snapshot: source=explicit path list",
      "- Scope snapshot: source=area\n- Scope snapshot: source=explicit path list",
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
    const compactWithFindings = validReview(projectRoot).replace(
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
      validReview(projectRoot, undefined, undefined, 1),
      projectRoot,
    );
    assert.equal(hasViolation(result, "refutation-ledger"), true);
  });

  it("accepts a claimed refutation only from its declared counted ledger", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const ledgerPath =
      ".goat-flow/logs/review/goat-review-refutations.fixture.txt";
    writeFileSync(
      join(projectRoot, ledgerPath),
      "- R-005 | Suspicion: missing guard | Evidence: caller rejects empty values | Rationale: the guard removes reachability\n",
      "utf-8",
    );
    assert.deepEqual(
      validateReviewReport(
        validReview(projectRoot, undefined, undefined, 1, ledgerPath),
        projectRoot,
      ).violations,
      [],
    );
  });

  // Fixture purpose: writes a temporary eight-record ledger to model the consumer failure that
  // logged all nine suspicions; the surviving confirmation belongs in Findings, not in the ledger.
  it("accepts eight REFUTED ledger records alongside one surfaced confirmation", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const ledgerPath =
      ".goat-flow/logs/review/goat-review-refutations.mixed.txt";
    writeFileSync(
      join(projectRoot, ledgerPath),
      Array.from(
        { length: 8 },
        (_, index) =>
          `- R-${String(index + 2).padStart(3, "0")} | Suspicion: candidate ${index + 1} | Evidence: guard ${index + 1} removes reachability | Rationale: disproved`,
      ).join("\n") + "\n",
      "utf-8",
    );

    const report = validReview(projectRoot, undefined, undefined, 8, ledgerPath)
      .replace("- Evidence: 4 OBSERVED", "- Evidence: 1 OBSERVED")
      .replace("- Verdicts: 4/0/8/0", "- Verdicts: 1/0/8/0")
      .replace(/^- Refuter (?:pass|outcomes):.*\n/gmu, "")
      .replace(/- R-002[^\n]+\n/u, "")
      .replace(/- R-003[^\n]+\n/u, "")
      .replace(/\n## Systemic Patterns\n- R-004[^\n]+\n/u, "");

    assert.deepEqual(validateReviewReport(report, projectRoot).violations, []);
  });

  it("rejects stale unrelated ledgers and declared count mismatches", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const ledgerRoot = join(projectRoot, ".goat-flow", "logs", "review");
    writeFileSync(
      join(ledgerRoot, "goat-review-refutations.stale.txt"),
      "- R-099 | Suspicion: stale | Evidence: stale | Rationale: stale\n",
      "utf-8",
    );
    const unrelated = validateReviewReport(
      validReview(projectRoot, undefined, undefined, 1),
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
      validReview(projectRoot, undefined, undefined, 2, declaredPath),
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
    const report = withIntegrityFields(
      validReview(
        projectRoot,
        undefined,
        undefined,
        "1 (persist-skipped)",
        "persist-skipped",
      ),
      {
        "Final dispositions":
          '{"R-001":"confirmed","R-002":"confirmed","R-003":"confirmed","R-004":"confirmed","R-005":"refuted"}',
        "Degradation flags":
          "gates-not-run, persist-skipped: redactor-unavailable",
        "Degradation evidence":
          '{"gates-not-run":"No gates were requested.","persist-skipped: redactor-unavailable":"No compatible redactor was available."}',
      },
    ).replace(
      "bundle=.goat-flow/logs/review/goat-review-bundle.fixture.diff",
      "bundle=persist-skipped: redactor-unavailable",
    );
    const result = validateReviewReport(report, projectRoot);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(warningsOf(result), []);
  });

  it("permits pre-existing actions only when Scope snapshot declares area mode", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const diffReport = validReview(projectRoot).replace(
      "[MAY:patch] [local-only] **Cover the caller contract**",
      "[MAY:pre-existing] [local-only] **Cover the caller contract**",
    );
    const areaReport = withReviewSource(diffReport, projectRoot, {
      kind: "area",
      roots: ["src"],
      sample: null,
    }).replace("1 changed lines", "1 clusters");

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
    const duplicate = validReview(projectRoot).replace(
      "- R-003 [MAY:patch]",
      "- R-002 [MAY:patch]",
    );
    const unknownReference = withTopFiveRisk(validReview(projectRoot), "R-999");

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
    const ledgerPath =
      ".goat-flow/logs/review/goat-review-refutations.history.txt";
    writeFileSync(
      join(projectRoot, ledgerPath),
      "- R-005 | Suspicion: missing guard | Evidence: host reproduced guard | Rationale: disproved\n",
    );
    const refuted = withIntegrityFields(
      validReview(projectRoot, undefined, undefined, 1, ledgerPath),
      {
        "Refuter pass":
          "yes; confirmed=1, refuted=1, unresolved=0, leads-verified=0, model=test-refuter",
        "Refuter outcomes": '{"R-004":"confirmed","R-005":"refuted"}',
      },
    ).replace(
      "## Spec Drift",
      `## Refuted by Refuter
- R-005 [MAY:patch] **Retire a disproved concern** \`src/example.ts\` (search: \`loadConfig\`) - The host reproduced the removing guard. | Evidence: OBSERVED | Proof: RUNTIME

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
      withSixSurfacedFindings(validReview(projectRoot)),
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
      withSixSurfacedFindings(validReview(projectRoot)),
    ).replace("## Top 5 Risks (cross-tier)", "## Top 5 Risks");
    const result = validateReviewReport(report, projectRoot);

    assert.deepEqual(result.violations, []);
    assert.equal(hasCheck(warningsOf(result), "V7", "top-five-missing"), false);
  });

  it("rejects Ship Verdict decisions that contradict severity or integrity", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const severityConflict = validReview(projectRoot)
      .replace("[SHOULD:patch]", "[MUST:patch]")
      .replace("Decision: **PARTIAL**", "Decision: **YES**");
    const degradationConflict = validReview(projectRoot).replace(
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
    const overconfident = validReview(projectRoot)
      .replace(
        "- Degradation flags: gates-not-run",
        "- Degradation flags: risk-depth-declined",
      )
      .replace("- Conclusion: coverage-degraded", "- Conclusion: confident")
      .replace("Decision: **PARTIAL**", "Decision: **YES WITH CONDITIONS**");
    const aboveCap = validReview(projectRoot)
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
    const overconfident = validReview(projectRoot)
      .replace("- Conclusion: coverage-degraded", "- Conclusion: confident")
      .replace("Decision: **PARTIAL**", "Decision: **YES WITH CONDITIONS**");

    const result = validateReviewReport(overconfident, projectRoot);

    assert.match(
      result.violations.map((violation) => violation.message).join("\n"),
      /degradation flags require Conclusion: coverage-degraded/u,
    );
  });

  it("rejects unknown degradation flags as integrity failures", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = validReview(projectRoot).replace(
      "- Degradation flags: gates-not-run",
      "- Degradation flags: gates-not-run, mystery-degradation",
    );
    const result = validateReviewReport(report, projectRoot);
    assert.equal(result.status, "fail");
    assert.equal(
      hasCheck(result.violations, "V5", "degradation-flag-unknown"),
      true,
    );
    assert.match(
      renderReviewValidationResult(result),
      /^review validate: FAIL/u,
    );
  });

  it("rejects empty or contradictory degradation flag lists", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const emptyFlag = validReview(projectRoot).replace(
      "- Degradation flags: gates-not-run",
      "- Degradation flags: gates-not-run,",
    );
    const contradictoryNone = validReview(projectRoot).replace(
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
      withTopFiveRisk(validReview(projectRoot)),
      projectRoot,
    );
    const missingTopFive = validateReviewReport(
      withSixSurfacedFindings(validReview(projectRoot)),
      projectRoot,
    );
    const emptyOptional = validateReviewReport(
      validReview(projectRoot).replace(
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
      report: reviewReportTemplate("src/example.ts", "missingSymbol"),
    },
    {
      checkId: "V2",
      code: "finding-grammar",
      report: reviewReportTemplate().replace(
        "- R-001 [SHOULD:patch]",
        "- R-01 [SHOULD:patch]",
      ),
    },
    {
      checkId: "V3",
      code: "finding-harm",
      report: reviewReportTemplate().replace(
        " | Harm: requests use an invalid configuration.",
        "",
      ),
    },
    {
      checkId: "V4",
      code: "finding-evidence",
      report: reviewReportTemplate().replace(" | Evidence: OBSERVED", ""),
    },
    {
      checkId: "V5",
      code: "integrity-format",
      report: reviewReportTemplate().replace(
        "- Review validator: validated\n",
        "",
      ),
    },
    {
      checkId: "V6",
      code: "finding-id-duplicate",
      report: reviewReportTemplate().replace(
        "- R-003 [MAY:patch]",
        "- R-002 [MAY:patch]",
      ),
    },
    {
      checkId: "V8",
      code: "refutation-ledger",
      report: reviewReportTemplate(undefined, undefined, 1),
    },
  ];

  // Separate names make a validator-class regression visible directly in TAP output.
  for (const fixture of structuralValidationCases) {
    it(`maps the seeded structural corpus to ${fixture.checkId}/${fixture.code}`, (testContext) => {
      const projectRoot = createReviewedProject(testContext);
      const result = validateReviewReport(
        withReviewSource(fixture.report, projectRoot, {
          kind: "paths",
          paths: [{ path: "src/example.ts", from: "live" }],
        }),
        projectRoot,
      );
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
      validReview(projectRoot, "src/example.ts", "missingSymbol").replace(
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

/** Require a specific disposition/refuter refusal after establishing the companion report as a passing control. */
function assertDispositionFailure(
  report: string,
  root: string,
  pattern: RegExp,
): void {
  const result = validateReviewReport(report, root);
  assert.equal(result.status, "fail");
  assert.ok(
    result.violations.some((issue) => pattern.test(issue.message)),
    JSON.stringify(result.violations),
  );
}

describe("exclusive final review dispositions", () => {
  it("ties inference and unreproduced disclosures to active evidence totals and finding IDs", (test) => {
    const root = createReviewedProject(test);
    const report = withIntegrityFields(validReview(root), {
      Evidence: "1 OBSERVED / 3 INFERRED",
      "Degradation flags":
        "gates-not-run, high-inference-ratio, not-reproduced-findings",
      "Degradation evidence": canonicalReviewJson({
        "gates-not-run": "No gates were requested.",
        "high-inference-ratio": "1 OBSERVED / 3 INFERRED active findings.",
        "not-reproduced-findings":
          "R-001: inspected the fixture contract but did not reproduce its claimed runtime failure.",
      }),
    })
      .replace(/^(- R-00[123].*Evidence: )OBSERVED/gmu, "$1INFERRED")
      .replace(/^(- R-001.*Proof: )STATIC/mu, "$1NOT-REPRODUCED");
    assert.deepEqual(validateReviewReport(report, root).violations, []);
    assertDispositionFailure(
      report.replace(
        "1 OBSERVED / 3 INFERRED active findings.",
        "Evidence remains incomplete.",
      ),
      root,
      /high-inference-ratio.*name/,
    );
    assertDispositionFailure(
      report.replace(
        "R-001: inspected the fixture contract",
        "The reviewer inspected the fixture contract",
      ),
      root,
      /not-reproduced-findings.*name/,
    );
    assertDispositionFailure(
      report.replace(
        "gates-not-run, high-inference-ratio, not-reproduced-findings",
        "gates-not-run",
      ),
      root,
      /outnumber|NOT-REPRODUCED/,
    );
  });

  it("requires an unresolved refuter disclosure to identify the surviving unconfirmed concern", (test) => {
    const root = createReviewedProject(test);
    const report = withIntegrityFields(validReview(root), {
      Verdicts: "3/0/0/1",
      "Final dispositions":
        '{"R-001":"confirmed","R-002":"confirmed","R-003":"confirmed","R-004":"unresolved"}',
      "Refuter pass":
        "yes; confirmed=0, refuted=0, unresolved=1, leads-verified=0, model=test-refuter",
      "Refuter outcomes": '{"R-004":"unresolved"}',
      "Degradation flags": "gates-not-run, cross-model-unresolved",
      "Degradation evidence": canonicalReviewJson({
        "gates-not-run": "No gates were requested.",
        "cross-model-unresolved":
          "R-004 needs the caller's configuration contract.",
      }),
    })
      .replace(" [CONFIRMED-CROSS-MODEL]", "")
      .replace(
        "**Group configuration fallback gaps**",
        "**Unconfirmed: group configuration fallback gaps**",
      )
      .replace(
        /^(- R-004.*)$/mu,
        "$1 | Missing proof: caller contract | Next check: inspect the caller",
      );
    assert.deepEqual(validateReviewReport(report, root).violations, []);
    assertDispositionFailure(
      report.replace(
        "R-004 needs the caller's",
        "The review needs the caller's",
      ),
      root,
      /cross-model-unresolved.*name/,
    );
    assertDispositionFailure(
      report.replace("gates-not-run, cross-model-unresolved", "gates-not-run"),
      root,
      /cross-model-unresolved must match/,
    );
  });

  it("reconciles PR bot counters and distinguishes missing ingestion from an empty response", (test) => {
    const { projectRoot, base, head } = createVersionedReviewedProject(test);
    const report = withIntegrityFields(
      withReviewSource(
        reviewReportTemplate("src/example.ts", "committedAnchor"),
        projectRoot,
        { kind: "pr", target: base, head },
      ),
      {
        "Automated-review provenance":
          "overlap-confirmed=0, local-only=4, bot-only-locally-verified=0, disputed-match=0; automated findings the local review missed: none; local findings every bot missed: R-001, R-002, R-003, R-004",
      },
    );
    assert.deepEqual(validateReviewReport(report, projectRoot).violations, []);
    assertDispositionFailure(
      report.replace("local-only=4", "local-only=5"),
      projectRoot,
      /counts and missed-ID lists/,
    );
    assertDispositionFailure(
      report.replace(
        "local findings every bot missed: R-001, R-002, R-003, R-004",
        "local findings every bot missed: R-001",
      ),
      projectRoot,
      /counts and missed-ID lists/,
    );
    const noBots = withIntegrityFields(report, {
      "Automated-review provenance": "no-automated-review-present",
    });
    assert.deepEqual(validateReviewReport(noBots, projectRoot).violations, []);
    const missing = withIntegrityFields(report, {
      "Automated-review provenance": "n/a",
      "Degradation flags": "gates-not-run, automated-review-uningested",
      "Degradation evidence":
        '{"automated-review-uningested":"The PR comment response was unavailable.","gates-not-run":"No gates were requested."}',
    });
    assert.deepEqual(validateReviewReport(missing, projectRoot).violations, []);
    assertDispositionFailure(
      withIntegrityFields(missing, {
        "Automated-review provenance": "no-automated-review-present",
      }),
      projectRoot,
      /distinguish unavailable ingestion/,
    );
    const localRoot = createReviewedProject(test);
    const local = validReview(localRoot);
    assert.deepEqual(validateReviewReport(local, localRoot).violations, []);
    assertDispositionFailure(
      withIntegrityFields(local, {
        "Automated-review provenance": "no-automated-review-present",
      }),
      localRoot,
      /outside PR mode/,
    );
  });

  it("matches exact refuted IDs, rejects duplicate records, and keeps history out of active evidence", (test) => {
    const root = createReviewedProject(test);
    const ledger =
      ".goat-flow/logs/review/goat-review-refutations.identities.txt";
    const record =
      "- R-005 | Suspicion: missing guard | Evidence: fixture guard removes reachability | Rationale: refuted\n";
    writeFileSync(join(root, ledger), record);
    const dispositions = canonicalReviewJson({
      "R-001": "confirmed",
      "R-002": "confirmed",
      "R-003": "confirmed",
      "R-004": "confirmed",
      "R-005": "refuted",
    });
    const report = withIntegrityFields(
      validReview(root, undefined, undefined, 1, ledger),
      {
        "Final dispositions": dispositions,
        "Refuter pass":
          "yes; confirmed=1, refuted=1, unresolved=0, leads-verified=0, model=test-refuter",
        "Refuter outcomes": '{"R-004":"confirmed","R-005":"refuted"}',
      },
    ).replace(
      "## Spec Drift",
      "## Refuted by Refuter\n- R-005 [MUST:patch] **Refuted fixture concern** `src/example.ts` (search: `loadConfig`) - The guard disproves this fixture claim. | Harm: disproved request failure | Evidence: OBSERVED | Proof: RUNTIME\n\n## Spec Drift",
    );
    assert.deepEqual(validateReviewReport(report, root).violations, []);
    assertDispositionFailure(
      withIntegrityFields(report, {
        Evidence: "5 OBSERVED / 0 INFERRED",
        Verdicts: "5/0/1/0",
      }),
      root,
      /active findings|Evidence claims/,
    );
    writeFileSync(join(root, ledger), record.replace("R-005", "R-006"));
    assertDispositionFailure(report, root, /unique IDs must equal/);
    writeFileSync(join(root, ledger), record + record);
    assertDispositionFailure(
      withIntegrityFields(report, { "Refutations logged": "2" }),
      root,
      /duplicate R-IDs/,
    );
    const duplicate = validateRefutationLedgerText(record + record);
    assert.equal(duplicate.status, "fail");
    assert.match(duplicate.violations[0]!.message, /duplicate R-IDs/);
  });

  it("requires an explicit map when legacy adjusted or unresolved identities would need guessing", (test) => {
    const root = createReviewedProject(test);
    const confirmed = validReview(root);
    assert.deepEqual(validateReviewReport(confirmed, root).violations, []);
    assertDispositionFailure(
      withIntegrityFields(confirmed, { Verdicts: "3/1/0/0" }),
      root,
      /cannot be inferred unambiguously/,
    );
    const adjusted = withIntegrityFields(confirmed, {
      Verdicts: "3/1/0/0",
      "Final dispositions":
        '{"R-001":"adjusted","R-002":"confirmed","R-003":"confirmed","R-004":"confirmed"}',
    });
    assert.deepEqual(validateReviewReport(adjusted, root).violations, []);
    // A malformed, unknown, or unrelated final outcome must not inherit the valid finding's disposition.
    for (const map of [
      '{"R-001":"confirmed","R-001":"adjusted"}',
      '{"R-001":"unknown"}',
      '{"R-999":"confirmed"}',
    ])
      assertDispositionFailure(
        withIntegrityFields(adjusted, { "Final dispositions": map }),
        root,
        /canonical JSON|values must|placement|matching final disposition/,
      );
  });

  it("keeps unresolved concerns visible with an honest title, decision request, and next check", (test) => {
    const root = createReviewedProject(test);
    const report = withIntegrityFields(validReview(root), {
      Verdicts: "3/0/0/1",
      "Final dispositions":
        '{"R-001":"unresolved","R-002":"confirmed","R-003":"confirmed","R-004":"confirmed"}',
    })
      .replace("[SHOULD:patch]", "[SHOULD:needs-decision]")
      .replace(
        "**Handle missing configuration**",
        "**Unconfirmed: handle missing configuration**",
      )
      .replace(
        "The loader accepts an empty value.",
        "The fixture needs a caller decision. | Missing proof: caller contract | Next check: inspect the caller",
      );
    assert.deepEqual(validateReviewReport(report, root).violations, []);
    // Each missing unresolved-field requirement must remain visible instead of becoming a confirmed-looking finding.
    for (const mutation of [
      report.replace("Unconfirmed: handle", "Handle"),
      report.replace("[SHOULD:needs-decision]", "[SHOULD:patch]"),
      report.replace(" | Missing proof: caller contract", ""),
      report.replace(" | Next check: inspect the caller", ""),
      report.replace(
        "**Unconfirmed: handle missing configuration**",
        "**Handle missing configuration** **Unconfirmed: misleading second title**",
      ),
    ])
      assertDispositionFailure(
        mutation,
        root,
        /unresolved needs an Unconfirmed/,
      );
  });

  it("reconciles no/skipped refuters, per-ID outcomes, and verified leads", (test) => {
    const root = createReviewedProject(test);
    const report = validReview(root);
    assert.deepEqual(validateReviewReport(report, root).violations, []);
    // Both supported no-run spellings require zero work and no claimed model.
    for (const state of ["no", "skipped"]) {
      const skipped = withIntegrityFields(report, {
        "Refuter pass": `${state}; confirmed=0, refuted=0, unresolved=0, leads-verified=0, model=n/a`,
        "Refuter outcomes": "{}",
      }).replace(" [CONFIRMED-CROSS-MODEL]", "");
      assert.deepEqual(validateReviewReport(skipped, root).violations, []);
      assertDispositionFailure(
        skipped.replace("confirmed=0", "confirmed=1"),
        root,
        /zero counts/,
      );
      assertDispositionFailure(
        skipped.replace("model=n/a", "model=test-refuter"),
        root,
        /model=n\/a/,
      );
    }
    assertDispositionFailure(
      withIntegrityFields(report, { "Refuter outcomes": "{}" }),
      root,
      /matching per-ID/,
    );
    assertDispositionFailure(
      report.replace("leads-verified=0", "leads-verified=99"),
      root,
      /verified refuter leads cannot exceed/,
    );
    assertDispositionFailure(
      withIntegrityFields(report, {
        "Refuter outcomes": '{"R-003":"confirmed"}',
      }),
      root,
      /cross-model tag requires/,
    );
  });

  it("applies the documented disclosure precedence once across material limit combinations", (test) => {
    const root = createReviewedProject(test);
    const full = fullCleanReview(cleanReview(root));
    const cases: Array<[string[], string, string]> = [
      [["unfamiliar-area"], "coverage-degraded", "YES WITH CONDITIONS"],
      [["missing-types"], "coverage-degraded", "YES WITH CONDITIONS"],
      [["footguns-unread"], "coverage-degraded", "YES WITH CONDITIONS"],
      [["coverage-degraded"], "coverage-degraded", "YES WITH CONDITIONS"],
      [
        ["callsite-completeness-grep-only"],
        "coverage-degraded",
        "YES WITH CONDITIONS",
      ],
      [
        ["configured-base-unresolved=missing-base"],
        "coverage-degraded",
        "YES WITH CONDITIONS",
      ],
      [["base-detection-failed"], "coverage-degraded", "YES WITH CONDITIONS"],
      [["base-fetch-failed"], "coverage-degraded", "YES WITH CONDITIONS"],
      [
        ["cross-model-refuter-failed"],
        "coverage-degraded",
        "YES WITH CONDITIONS",
      ],
      [
        ["refuter-citation-unverified"],
        "high-inference",
        "YES WITH CONDITIONS",
      ],
      [["risk-depth-declined"], "partial", "PARTIAL"],
      [
        ["risk-depth-declined", "missing-types", "refuter-citation-unverified"],
        "partial",
        "PARTIAL",
      ],
    ];
    // Each flag combination must yield one confidence result and one verdict downgrade, regardless of the number of flags.
    for (const [flags, conclusion, verdict] of cases) {
      const evidence = canonicalReviewJson(
        Object.fromEntries(
          flags.map((flag) => [
            flag,
            `Fixture disclosure for ${flag}; the named limitation remains unverified.`,
          ]),
        ),
      );
      const report = withIntegrityFields(full, {
        "Degradation flags": flags.join(", "),
        "Degradation evidence": evidence,
        Conclusion: conclusion,
        "Refuter pass":
          "skipped; confirmed=0, refuted=0, unresolved=0, leads-verified=0, model=n/a",
      }).replace("Decision: **YES**", `Decision: **${verdict}**`);
      assert.deepEqual(
        validateReviewReport(report, root).violations,
        [],
        flags.join(", "),
      );
      assertDispositionFailure(
        withIntegrityFields(report, { Conclusion: "confident" }),
        root,
        /degradation flags require Conclusion/,
      );
    }
  });
});

describe("review receipt files", () => {
  it("verifies final bundle files and refuses symlink leaves or parents", (test) => {
    // Each filesystem mutation starts from a real valid receipt so the refusal belongs to that defect alone.
    for (const defect of [
      "missing",
      "directory",
      "leaf-symlink",
      "parent-symlink",
    ] as const) {
      const root = createReviewedProject(test);
      const receipt = join(
        root,
        ".goat-flow/logs/review/goat-review-bundle.fixture.diff",
      );
      const control = validReview(root);
      assert.deepEqual(validateReviewReport(control, root).violations, []);
      // Redirecting a parent must fail even when the linked directory still contains the original receipt.
      if (defect === "parent-symlink") {
        renameSync(
          join(root, ".goat-flow/logs"),
          join(root, ".goat-flow/retained"),
        );
        symlinkSync("retained", join(root, ".goat-flow/logs"), "dir");
      } else {
        unlinkSync(receipt);
        // A directory with the expected filename cannot supply the receipt's bytes.
        if (defect === "directory") mkdirSync(receipt);
        // A linked leaf must be rejected even when it points to a regular file inside the project.
        if (defect === "leaf-symlink")
          symlinkSync(join(root, "src/example.ts"), receipt);
      }
      assertDispositionFailure(
        control,
        root,
        /cannot verify declared review bundle/,
      );
    }
  });

  it("checks fresh draft destinations without creating files or accepting existing evidence", (test) => {
    const root = createReviewedProject(test);
    const absent = ".goat-flow/logs/review/goat-review-bundle.future.diff";
    assert.equal(readReviewReceipt(root, absent, "draft"), null);
    assert.throws(() => readReviewReceipt(root, absent, "final"), /absent/);
    assert.throws(
      () =>
        readReviewReceipt(
          root,
          ".goat-flow/logs/review/goat-review-bundle.fixture.diff",
          "draft",
        ),
      /already exists/,
    );
    assert.throws(
      () => readReviewReceipt(root, "../outside.diff", "draft"),
      /outside/,
    );
    symlinkSync("review", join(root, ".goat-flow/logs/linked"), "dir");
    assert.throws(
      () =>
        readReviewReceipt(
          root,
          ".goat-flow/logs/linked/goat-review-bundle.future.diff",
          "draft",
        ),
      /outside/,
    );
  });
});
