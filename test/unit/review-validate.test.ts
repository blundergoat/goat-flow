/**
 * Exercise the visible evidence required by full and compact review reports.
 *
 * Use when changing metadata, coverage, anchor checks, or Markdown handling.
 * Real project files distinguish a valid source claim from an unrelated fixture setup failure.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateReviewReport } from "../../src/cli/review-validate.js";
import {
  createReviewedProject,
  createVersionedReviewedProject,
  validReview,
  withReviewSource,
  reviewAuthorityFields,
  cleanReview,
  fullCleanReview,
  withIntegrityFields,
  hasCheck,
  hasViolation,
} from "./review-validate.helpers.js";
import type { ValidationIssueShape } from "./review-validate.helpers.js";
import { canonicalReviewJson } from "../../src/cli/review-validate-authority.js";

describe("review output validation: grammar, masking, and integrity", () => {
  it("accepts a complete report and the compact clean-review surface", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    assert.deepEqual(
      validateReviewReport(validReview(projectRoot), projectRoot).violations,
      [],
    );

    const compact = `Scope: worktree; 1 file and 1 changed line; chunking=none.
${reviewAuthorityFields(projectRoot)}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
`;
    assert.deepEqual(validateReviewReport(compact, projectRoot).violations, []);
  });

  it("requires a terminal chunking state in compact clean reviews", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const compact = `Scope: worktree; 1 file and 1 changed line; chunking=none.
${reviewAuthorityFields(projectRoot)}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
`;
    const missing = validateReviewReport(
      compact.replace("; chunking=none", ""),
      projectRoot,
    );
    const proposed = validateReviewReport(
      compact.replace("chunking=none", "chunking=proposed"),
      projectRoot,
    );
    const declined = validateReviewReport(
      compact.replace("chunking=none", "chunking=declined"),
      projectRoot,
    );
    const accepted = validateReviewReport(
      compact.replaceAll("chunking=none", "chunking=accepted"),
      projectRoot,
    );

    assert.equal(hasViolation(missing, "integrity-format"), true);
    assert.equal(hasViolation(proposed, "integrity-format"), true);
    assert.equal(hasViolation(declined, "integrity-format"), true);
    assert.deepEqual(accepted.violations, []);
  });

  it("accepts a full local review that omits inapplicable integrity rows", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const resolvedOnlyReport = validReview(projectRoot)
      .replace("- Refutation ledger: n/a\n", "")
      .replace(/^- Automated-review provenance:.*\n/mu, "")
      .replace(/^- Refuter (?:pass|outcomes):.*\n/gmu, "")
      .replace("- Spec drift: checked M05\n", "")
      .replaceAll(" [local-only]", "")
      .replace(" [CONFIRMED-CROSS-MODEL]", "")
      .replace(/\n## Spec Drift\n[\s\S]*?(?=\n## Ship Verdict)/u, "");

    assert.deepEqual(
      validateReviewReport(resolvedOnlyReport, projectRoot).violations,
      [],
    );
  });

  it("rejects omitted integrity rows when the report makes them applicable", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const missingLedger = validateReviewReport(
      validReview(
        projectRoot,
        "src/example.ts",
        "loadConfig",
        "1 (persist-skipped)",
        "persist-skipped",
      ).replace("- Refutation ledger: persist-skipped\n", ""),
      projectRoot,
    );
    const missingRefuter = validateReviewReport(
      validReview(projectRoot).replace(
        /^- Refuter (?:pass|outcomes):.*\n/gmu,
        "",
      ),
      projectRoot,
    );
    const missingSpecDrift = validateReviewReport(
      validReview(projectRoot).replace("- Spec drift: checked M05\n", ""),
      projectRoot,
    );

    const versioned = createVersionedReviewedProject(testContext);
    const missingAutomatedReview = validateReviewReport(
      withReviewSource(
        validReview(versioned.projectRoot, "src/example.ts", "committedAnchor"),
        versioned.projectRoot,
        { kind: "pr", target: versioned.base, head: versioned.head },
      ).replace(/^- Automated-review provenance:.*\n/mu, ""),
      versioned.projectRoot,
    );

    assert.equal(hasViolation(missingLedger, "refutation-ledger"), true);

    // Each visible trigger must require its corresponding disclosure, without relying on another missing field to fail.
    for (const [result, field] of [
      [missingRefuter, "Refuter pass"],
      [missingSpecDrift, "Spec drift"],
      [missingAutomatedReview, "Automated-review provenance"],
    ] as const) {
      assert.equal(
        result.violations.some(
          (violation) =>
            violation.message === `Review Integrity is missing ${field}`,
        ),
        true,
        `${field}: ${JSON.stringify(result.violations)}`,
      );
    }
  });

  it("reads closing-ATX H2 headings the way CommonMark renders them", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    // `## Review Integrity ##` renders as the heading "Review Integrity", so
    // validation must find the section instead of reporting it missing.
    const closingAtx = validReview(projectRoot).replace(
      "## Review Integrity",
      "## Review Integrity ##",
    );

    assert.deepEqual(
      validateReviewReport(closingAtx, projectRoot).violations,
      [],
    );
  });

  it("rejects a second decision appended to a compact verdict", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    // Extra decisions must not change the compact verdict the reader sees.
    for (const verdict of [
      "Ship Verdict: **YES** and **NO**",
      "Ship Verdict: **YES** - actually **NO**",
    ]) {
      const report = `Scope: worktree; 1 file and 1 changed line; chunking=none.
${reviewAuthorityFields(projectRoot)}
${verdict}
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
`;
      const result = validateReviewReport(report, projectRoot);

      assert.equal(result.status, "fail", verdict);
      assert.equal(hasViolation(result, "ship-verdict-format"), true, verdict);
    }
  });

  it("rejects reports that mix compact and full verdict or integrity forms", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const mixedVerdict = validReview(projectRoot).replace(
      "## TL;DR",
      "Ship Verdict: **YES** - compact duplicate.\n\n## TL;DR",
    );
    const mixedIntegrity = validReview(projectRoot).replace(
      "## TL;DR",
      "Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.\n\n## TL;DR",
    );

    assert.equal(
      hasViolation(
        validateReviewReport(mixedVerdict, projectRoot),
        "ship-verdict-format",
      ),
      true,
    );
    assert.equal(
      hasViolation(
        validateReviewReport(mixedIntegrity, projectRoot),
        "integrity-format",
      ),
      true,
    );
  });

  it("rejects compact proof fields contained in multiline inline code", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = `\`Scope: worktree; 1 file and 1 changed line; chunking=none.
${reviewAuthorityFields(projectRoot)}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.\`
`;
    const result = validateReviewReport(report, projectRoot);

    assert.equal(result.status, "fail");
    assert.equal(hasViolation(result, "integrity-format"), true);
    assert.equal(hasViolation(result, "ship-verdict-format"), true);
  });

  it("keeps a contradictory verdict visible after an invalid fence opener", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = `Scope: worktree; 1 file and 1 changed line; chunking=none.
${reviewAuthorityFields(projectRoot)}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
\`\`\`markdown\`invalid
Ship Verdict: **NO**
`;
    const result = validateReviewReport(report, projectRoot);

    assert.equal(result.status, "fail");
    assert.equal(hasViolation(result, "ship-verdict-format"), true);
  });

  it("requires the compact clean-review disclosures", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const result = validateReviewReport(
      `Ship Verdict: **YES** - no blocking finding survived Pass 2.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
`,
      projectRoot,
    );
    const messages = result.violations.map((violation) => violation.message);

    assert.equal(result.status, "fail");

    // Each disclosure is named separately so a failure says which one the report dropped.
    assert.equal(
      messages.includes("compact clean review is missing Scope"),
      true,
      JSON.stringify(messages),
    );
    assert.equal(
      messages.includes("compact clean review is missing Zero findings"),
      true,
      JSON.stringify(messages),
    );
    assert.equal(
      messages.includes(
        "compact clean review is missing What I Didn't Examine",
      ),
      true,
      JSON.stringify(messages),
    );
  });

  it("rejects empty, undefended, or repeated compact disclosures", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const compact = `Scope: worktree; 1 file and 1 changed line; chunking=none.
${reviewAuthorityFields(projectRoot)}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
`;
    const emptyDisclosure = validateReviewReport(
      compact.replace(
        "What I Didn't Examine: none.",
        "What I Didn't Examine:   ",
      ),
      projectRoot,
    );
    const undefendedZeroFindings = validateReviewReport(
      compact.replace(
        "Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.",
        "Zero findings: checked boundary conditions.",
      ),
      projectRoot,
    );
    const duplicateIntegrity = validateReviewReport(
      compact.replace(
        "Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.",
        "Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.\nReview Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.",
      ),
      projectRoot,
    );

    assert.equal(hasViolation(emptyDisclosure, "integrity-format"), true);
    assert.equal(
      hasViolation(undefendedZeroFindings, "integrity-format"),
      true,
    );
    assert.equal(
      hasViolation(duplicateIntegrity, "integrity-field-duplicate"),
      true,
    );
  });

  it("keeps proof fields after an escaped HTML comment opener", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = `Checked the visible literal \\<!-- token.
Scope: worktree; 1 file and 1 changed line; chunking=none.
${reviewAuthorityFields(projectRoot)}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
`;

    assert.deepEqual(validateReviewReport(report, projectRoot).violations, []);
  });

  it("keeps compact proof fields after multiline inline code", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = `Checked the literal \`first line
continued <!-- remains code\` token.
Scope: worktree; 1 file and 1 changed line; chunking=none.
${reviewAuthorityFields(projectRoot)}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
`;

    assert.deepEqual(validateReviewReport(report, projectRoot).violations, []);
  });

  it("rejects structural review evidence inside a raw HTML block", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = `<pre>\n${validReview(projectRoot)}\n</pre>\n`;
    const result = validateReviewReport(report, projectRoot);

    assert.equal(result.status, "fail");
    assert.equal(hasViolation(result, "integrity-format"), true);
    assert.equal(hasViolation(result, "ship-verdict-format"), true);
  });

  it("rejects structural review evidence inside a type-7 HTML block", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = `<x-review>
Scope: worktree; 1 file and 1 changed line; chunking=none.
${reviewAuthorityFields(projectRoot)}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
</x-review>
`;
    const result = validateReviewReport(report, projectRoot);

    assert.equal(result.status, "fail");
    assert.equal(hasViolation(result, "integrity-format"), true);
    assert.equal(hasViolation(result, "ship-verdict-format"), true);
  });

  it("rejects degradation flags in compact integrity receipts", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = `Scope: worktree; 1 file and 1 changed line; chunking=none.
${reviewAuthorityFields(projectRoot)}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams.
Review Integrity: confident; 1/1 files opened; risk-depth-declined; validator=validated.
What I Didn't Examine: none.
`;
    const result = validateReviewReport(report, projectRoot);

    assert.equal(result.status, "fail");
    assert.equal(hasViolation(result, "integrity-format"), true);
  });

  it("requires validator status and gate evidence in full and compact integrity", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const missingValidator = validateReviewReport(
      validReview(projectRoot).replace("- Review validator: validated\n", ""),
      projectRoot,
    );
    const missingGateEvidence = validateReviewReport(
      validReview(projectRoot).replace(
        "- Gate evidence: pass=0, changed-code=0, pre-existing=0, infrastructure=0, unresolved=0\n",
        "",
      ),
      projectRoot,
    );
    const compactWithoutValidator = validateReviewReport(
      `Scope: worktree; 1 file and 1 changed line; chunking=none.
${reviewAuthorityFields(projectRoot)}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams.
Review Integrity: confident; 1/1 files opened; no degradation flags.
What I Didn't Examine: none.
`,
      projectRoot,
    );

    // Both receipt forms must disclose their validation state and applicable gate evidence.
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
      validReview(projectRoot, "src/example.ts", "missingSymbol"),
      projectRoot,
    );
    assert.equal(hasViolation(result, "anchor-unresolved"), true);
  });

  it("resolves semantic anchors from the declared immutable authority", (testContext) => {
    const { base, head, projectRoot } =
      createVersionedReviewedProject(testContext);
    const source = { kind: "pr", target: base, head };
    const committedReport = withReviewSource(
      validReview(projectRoot, "src/example.ts", "committedAnchor"),
      projectRoot,
      source,
    );
    const liveOnlyReport = withReviewSource(
      validReview(projectRoot, "src/example.ts", "workingTreeOnly"),
      projectRoot,
      source,
    );

    assert.deepEqual(
      validateReviewReport(committedReport, projectRoot).violations,
      [],
    );
    assert.equal(
      hasViolation(
        validateReviewReport(liveOnlyReport, projectRoot),
        "anchor-unresolved",
      ),
      true,
    );
  });

  it("rejects incomplete scope snapshots and contradictory totals", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const incompleteScope = validReview(projectRoot).replace(
      /^- Scope snapshot:.*$/mu,
      "- Scope snapshot: reviewed the current change",
    );
    const wrongEvidenceTotal = validReview(projectRoot).replace(
      "- Evidence: 4 OBSERVED / 0 INFERRED",
      "- Evidence: 3 OBSERVED / 0 INFERRED",
    );
    const wrongVerdictTotal = validReview(projectRoot).replace(
      "- Verdicts: 4/0/0/0",
      "- Verdicts: 3/0/0/0",
    );
    const impossibleFileCoverage = validReview(projectRoot).replace(
      "- Files opened in Pass 2: 1/1",
      "- Files opened in Pass 2: 2/1",
    );

    // Each contradictory count or incomplete scope must fail for the integrity defect it introduces.
    for (const report of [
      incompleteScope,
      wrongEvidenceTotal,
      wrongVerdictTotal,
      impossibleFileCoverage,
    ]) {
      assert.equal(
        hasViolation(
          validateReviewReport(report, projectRoot),
          "integrity-format",
        ),
        true,
      );
    }
  });

  // These unfinished or unknown chunking states cannot describe a completed review.
  for (const chunking of ["proposed", "declined", "unexpected"]) {
    it(`rejects completed review chunking=${chunking}`, (testContext) => {
      const projectRoot = createReviewedProject(testContext);
      const result = validateReviewReport(
        validReview(projectRoot).replace(
          "chunking=none",
          `chunking=${chunking}`,
        ),
        projectRoot,
      );
      assert.equal(result.status, "fail", chunking);
      assert.match(
        result.violations.map((violation) => violation.message).join("\n"),
        /completed review.+chunking/iu,
        chunking,
      );
    });
  }

  it("requires accepted chunking when completed scope size exceeds either limit", (testContext) => {
    // Real selected files keep chunk-limit failures separate from inventory-count contradictions.
    for (const [fileCount, changedLines, needsChunks] of [
      [21, 21, true],
      [1, 3001, true],
      [20, 3000, false],
    ] as const) {
      const projectRoot = createReviewedProject(testContext);
      writeFileSync(
        join(projectRoot, "src/example.ts"),
        "loadConfig\n".repeat(changedLines - fileCount + 1),
      );
      // Create the full selected inventory before capture so the file-count threshold is based on real source membership.
      for (let index = 1; index < fileCount; index += 1)
        writeFileSync(join(projectRoot, `src/file-${index}.ts`), "fixture\n");
      const compact = cleanReview(projectRoot, changedLines);
      // Both presentations must apply the same chunking threshold to the same selected files.
      for (const report of [compact, fullCleanReview(compact)]) {
        const result = validateReviewReport(report, projectRoot);
        // An oversized selection needs accepted chunking; the paired control proves that acceptance removes this specific error.
        if (needsChunks) {
          assert.ok(
            result.violations.some((issue) =>
              /exceeds.+requires chunking=accepted/u.test(issue.message),
            ),
            JSON.stringify(result.violations),
          );
          assert.deepEqual(
            validateReviewReport(
              report.replaceAll("chunking=none", "chunking=accepted"),
              projectRoot,
            ).violations,
            [],
          );
        } else assert.deepEqual(result.violations, []);
      }
    }
  });

  it("binds full-report size units to diff or area scope", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const diffUsingClusters = validReview(projectRoot).replace(
      "- Size: 1 files, 1 changed lines",
      "- Size: 1 files, 4001 clusters",
    );
    const areaUsingChangedLines = withReviewSource(
      validReview(projectRoot),
      projectRoot,
      { kind: "area", roots: ["src"], sample: null },
    );
    const areaUsingClusters = areaUsingChangedLines.replace(
      "- Size: 1 files, 1 changed lines",
      "- Size: 1 files, 1 clusters",
    );

    assert.equal(
      hasViolation(
        validateReviewReport(diffUsingClusters, projectRoot),
        "integrity-format",
      ),
      true,
    );
    assert.equal(
      hasViolation(
        validateReviewReport(areaUsingChangedLines, projectRoot),
        "integrity-format",
      ),
      true,
    );
    assert.deepEqual(
      validateReviewReport(areaUsingClusters, projectRoot).violations,
      [],
    );
  });

  it("binds opened-file coverage to the declared review size", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const compactMetadata = reviewAuthorityFields(projectRoot);
    const fullMismatch = validReview(projectRoot).replace(
      "- Size: 1 files, 1 changed lines",
      "- Size: 2 files, 1 changed lines",
    );
    const compact = `Scope: worktree; 2 files and 1 changed line; chunking=none.
${compactMetadata}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
`;
    const compactOveropened = compact
      .replace("2 files and", "1 file and")
      .replace("1/1 files", "2/1 files");

    const fullResult = validateReviewReport(fullMismatch, projectRoot);
    const compactResult = validateReviewReport(compact, projectRoot);
    const overopenedResult = validateReviewReport(
      compactOveropened,
      projectRoot,
    );

    assert.equal(hasViolation(fullResult, "integrity-format"), true);
    assert.match(
      fullResult.violations.map((violation) => violation.message).join("\n"),
      /selected files|counts and unique paths/iu,
    );
    assert.equal(hasViolation(compactResult, "integrity-format"), true);
    assert.match(
      compactResult.violations.map((violation) => violation.message).join("\n"),
      /compact Scope and files opened/iu,
    );
    assert.equal(hasViolation(overopenedResult, "integrity-format"), true);
    assert.match(
      overopenedResult.violations
        .map((violation) => violation.message)
        .join("\n"),
      /files opened/iu,
    );
  });

  it("rejects a transient draft-ledger marker in a final report", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const result = validateReviewReport(
      `${validReview(projectRoot)}<!-- goat-flow-review-ledger-draft -->\n`,
      projectRoot,
    );

    assert.equal(hasViolation(result, "integrity-format"), true);
    assert.match(
      result.violations.map((violation) => violation.message).join("\n"),
      /final review must not include.+draft-ledger marker/iu,
    );
  });

  // Retired flags must not turn an oversized, unchunked review into an accepted partial result.
  for (const flag of ["large-diff-unchunked", "large-area-unchunked"]) {
    it(`rejects retired ${flag} degradation flag`, (testContext) => {
      const projectRoot = createReviewedProject(testContext);
      const result = validateReviewReport(
        validReview(projectRoot).replace(
          "- Degradation flags: gates-not-run",
          `- Degradation flags: gates-not-run, ${flag}`,
        ),
        projectRoot,
      );
      assert.equal(result.status, "fail", flag);
      assert.match(
        result.violations.map((violation) => violation.message).join("\n"),
        /retired.+oversized review must stop before Pass 1/iu,
        flag,
      );
    });
  }

  it("rejects missing Evidence and Proof tags", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const missingEvidence = validReview(projectRoot).replace(
      " | Evidence: OBSERVED | Proof: STATIC",
      " | Proof: STATIC",
    );
    const missingProof = validReview(projectRoot).replace(
      " | Proof: STATIC",
      "",
    );
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
    const report = validReview(projectRoot).replace(
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
    const missingId = validReview(projectRoot).replace(
      "- R-001 [SHOULD:patch]",
      "- [SHOULD:patch]",
    );
    const retiredOverlap = validReview(projectRoot).replace(
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
    const report = validReview(projectRoot).replace(
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

  it("ignores fenced examples but rejects fenced-only live integrity", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const fencedExample = validReview(projectRoot).replace(
      "## Findings",
      `\`\`\`markdown
## Findings
- R-999 [MUST:patch] **Example only** \`missing.ts\` (search: \`missing\`) | Harm: example | Evidence: OBSERVED | Proof: STATIC
\`\`\`

## Findings`,
    );
    assert.deepEqual(
      validateReviewReport(fencedExample, projectRoot).violations,
      [],
    );

    const fencedIntegrity = validReview(projectRoot).replace(
      /## Review Integrity\n([\s\S]*?)\n## Findings/u,
      "```markdown\n## Review Integrity\n$1\n```\n\n## Findings",
    );
    const result = validateReviewReport(fencedIntegrity, projectRoot);
    assert.equal(
      hasCheck(
        result.violations as ValidationIssueShape[],
        "V5",
        "integrity-format",
      ),
      true,
    );
  });

  it("ignores indented code examples inside live report sections", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const indentedExample = validReview(projectRoot).replace(
      "### MUST / SHOULD / MAY",
      `    - R-999 [MUST:patch] **Example only** \`missing.ts\` (search: \`missing\`) | Harm: example | Evidence: OBSERVED | Proof: STATIC

### MUST / SHOULD / MAY`,
    );

    assert.deepEqual(
      validateReviewReport(indentedExample, projectRoot).violations,
      [],
    );
  });

  it("does not accept indented proof fields immediately after headings", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const indentedProof = validReview(projectRoot)
      .replace(/^(##+ .+)\n\n/gmu, "$1\n")
      .split("\n")
      .map((line) =>
        /^(?:- |Decision:|Reasoning:|Confidence:)/u.test(line)
          ? `    ${line}`
          : line,
      )
      .join("\n");

    const result = validateReviewReport(indentedProof, projectRoot);

    assert.equal(result.status, "fail");
    assert.equal(
      hasCheck(
        result.violations as ValidationIssueShape[],
        "V5",
        "integrity-format",
      ),
      true,
    );
  });

  it("ignores findings hidden inside multiline HTML comments", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const commentedExample = validReview(projectRoot).replace(
      "### MUST / SHOULD / MAY",
      `<!--
- R-999 [MUST:patch] **Hidden example** \`missing.ts\` (search: \`missing\`) - This is not rendered. | Harm: none | Evidence: OBSERVED | Proof: STATIC
-->

### MUST / SHOULD / MAY`,
    );

    assert.deepEqual(
      validateReviewReport(commentedExample, projectRoot).violations,
      [],
    );
  });
});

/** Require the named integrity refusal rather than accepting a failure caused by an unrelated fixture defect. */
function assertIntegrityFailure(
  report: string,
  projectRoot: string,
  message: RegExp,
): void {
  const result = validateReviewReport(report, projectRoot);
  assert.equal(result.status, "fail");
  assert.ok(
    result.violations.some((issue) => message.test(issue.message)),
    JSON.stringify(result.violations),
  );
}

describe("selected review integrity relationships", () => {
  it("retains all five selected files when opened or source coverage is partial", (test) => {
    const root = createReviewedProject(test);
    const paths = [
      "src/example.ts",
      ...Array.from({ length: 3 }, (_, index) => `src/selected-${index}.ts`),
      'src/anchor=literal, "quoted".ts',
    ];
    // Populate every selected path before capture so later undercoverage cannot be masked by source drift.
    for (const path of paths.slice(1))
      writeFileSync(join(root, path), "selected fixture\n");
    const compact = cleanReview(root, 5);
    const full = fullCleanReview(compact);
    // Establish a passing control in each presentation before removing coverage claims.
    for (const control of [compact, full])
      assert.deepEqual(validateReviewReport(control, root).violations, []);
    const opened = '1/5 (paths: ["src/example.ts"])';
    assertIntegrityFailure(
      withIntegrityFields(full, { "Files opened in Pass 2": opened }),
      root,
      /files-not-opened/,
    );
    const compactPartial = withIntegrityFields(compact, {
      "Files opened in Pass 2": opened,
    }).replace("5/5 files opened", "1/5 files opened");
    assertIntegrityFailure(compactPartial, root, /use full output/);
    // Plain paths remain readable; quote the filename whose commas and quotes would otherwise look like prose separators.
    const missing = paths
      .slice(1)
      .map((path) => (path.includes("anchor=") ? JSON.stringify(path) : path))
      .join(", ");
    const partial = withIntegrityFields(full, {
      "Files opened in Pass 2": opened,
      "Source coverage": '["src/example.ts"]',
      Size: "5 files, 5 changed lines (source coverage: 1/5 exactly once)",
      "Degradation flags": "chunked-partial, files-not-opened",
      "Degradation evidence": canonicalReviewJson({
        "chunked-partial": `Incomplete source: ${missing}`,
        "files-not-opened": `Unread selected files: ${missing}`,
      }),
      Conclusion: "partial",
    }).replace("Decision: **YES**", "Decision: **YES WITH CONDITIONS**");
    assert.deepEqual(validateReviewReport(partial, root).violations, []);
    // A longer filename containing an unread path cannot explain which selected file the reviewer skipped.
    assertIntegrityFailure(
      withIntegrityFields(partial, {
        "Degradation evidence": canonicalReviewJson({
          "chunked-partial": paths
            .slice(1)
            .map((path) => `other/${path}-copy`)
            .join(", "),
          "files-not-opened": missing,
        }),
      }),
      root,
      /chunked-partial.*naming missing paths/,
    );
    assertIntegrityFailure(
      withIntegrityFields(partial, {
        Size: "1 files, 5 changed lines (source coverage: 1/1 exactly once)",
        "Files opened in Pass 2": '1/1 (paths: ["src/example.ts"])',
      }),
      root,
      /selected inventory|selected files/,
    );
  });

  it("rejects duplicate paths, missing membership, and trailing Size clauses in both forms", (test) => {
    const root = createReviewedProject(test);
    const compact = cleanReview(root);
    // Duplicate paths and extra Size clauses must fail equally in compact and full reports.
    for (const report of [compact, fullCleanReview(compact)]) {
      assert.deepEqual(validateReviewReport(report, root).violations, []);
      // Each malformed manifest isolates duplicate, absent, or empty path membership.
      for (const manifest of [
        '["src/example.ts","src/example.ts"]',
        '["src/absent.ts"]',
        '[""]',
      ])
        assertIntegrityFailure(
          withIntegrityFields(report, { "Source coverage": manifest }),
          root,
          /Source coverage/,
        );
      // Appending another clause must not turn a valid Size prefix into an accepted contradictory claim.
      for (const suffix of [
        " extra",
        " (source coverage: 1/1 exactly once)",
        " (bundle chunks: no)",
      ])
        assertIntegrityFailure(
          withIntegrityFields(report, {
            Size: `1 files, 1 changed lines (source coverage: 1/1 exactly once)${suffix}`,
          }),
          root,
          /Size must be/,
        );
      assertIntegrityFailure(
        withIntegrityFields(report, {
          "Files opened in Pass 2":
            '1/1 (paths: ["src/example.ts","src/example.ts"])',
        }),
        root,
        /unique nonempty paths/,
      );
    }
  });

  it("requires every shared compact metadata row and refuses comparison-less paths and sampled areas", (test) => {
    const root = createReviewedProject(test);
    const compact = cleanReview(root);
    assert.deepEqual(validateReviewReport(compact, root).violations, []);
    // Removing any shared metadata field must identify the missing evidence even when the compact summary claims confidence.
    for (const label of [
      "Scope snapshot",
      "Authority snapshot",
      "Gate authority",
      "Source coverage",
      "Files opened in Pass 2",
      "Size",
      "Evidence",
      "Verdicts",
      "Gate evidence",
      "Degradation evidence",
    ])
      assertIntegrityFailure(
        compact.replace(new RegExp(`^${label}:.*\\n`, "mu"), ""),
        root,
        new RegExp(label),
      );
    const metadata = validReview(root).match(
      /## Review Integrity\n([\s\S]*?)\n## Findings/u,
    )![1]!;
    const pathCompact = compact
      .replace(
        /^Scope snapshot:.*$/mu,
        metadata.match(/^- Scope snapshot:.*$/mu)![0]!.slice(2),
      )
      .replace(
        /^Authority snapshot:.*$/mu,
        metadata.match(/^- Authority snapshot:.*$/mu)![0]!.slice(2),
      );
    assertIntegrityFailure(pathCompact, root, /use full output/);
    const area =
      withReviewSource(validReview(root), root, {
        kind: "area",
        roots: ["src"],
        sample: ["src/example.ts"],
      })
        .replace("1 changed lines", "1 clusters")
        .replace(
          "Decision: **PARTIAL**",
          "Decision: **N/A - AREA AUDIT ONLY**",
        ) +
      "\n## What I Didn't Examine\nOther files under src are outside the declared sample.\n";
    assert.deepEqual(validateReviewReport(area, root).violations, []);
    assertIntegrityFailure(
      withIntegrityFields(area, {
        "Files opened in Pass 2": "0/1 (paths: [])",
      }),
      root,
      /files-not-opened/,
    );
    // Markdown formatting cannot turn an empty exclusion into a description of the unreviewed surroundings.
    for (const emptyExclusion of [
      "None.",
      "- None.",
      "**None.**",
      "- n/a",
      "1. _Nothing._",
    ])
      assertIntegrityFailure(
        area.replace(
          "Other files under src are outside the declared sample.",
          emptyExclusion,
        ),
        root,
        /area sample.*excluded surroundings/,
      );
  });

  it("keeps intent and skipped-fetch disclosures confident in either presentation", (test) => {
    const root = createReviewedProject(test);
    const compact = cleanReview(root);
    // Missing supplied intent and a skipped fetch are disclosures when the selected local comparison is otherwise complete.
    for (const flag of ["intent-unstated", "base-fetch-skipped"]) {
      const evidence = canonicalReviewJson({
        [flag]:
          flag === "intent-unstated"
            ? "No product intent was supplied; the explicit comparison is complete."
            : "Fetch was intentionally skipped; only the pinned local comparison is claimed.",
      });
      const short = withIntegrityFields(compact, {
        "Degradation evidence": evidence,
      }).replace("no degradation flags", `flags=${flag}`);
      assert.deepEqual(validateReviewReport(short, root).violations, []);
      const full = withIntegrityFields(fullCleanReview(compact), {
        "Degradation flags": flag,
        "Degradation evidence": evidence,
      });
      assert.deepEqual(validateReviewReport(full, root).violations, []);
      assertIntegrityFailure(
        withIntegrityFields(full, { "Degradation evidence": "{}" }),
        root,
        /one nonempty explanation/,
      );
    }
  });

  it("rejects duplicate, unknown, empty, or unexplained degradation tokens", (test) => {
    const root = createReviewedProject(test);
    const full = fullCleanReview(cleanReview(root));
    // Ambiguous or unknown tokens must fail without weakening the valid report used as the control.
    for (const flags of [
      "intent-unstated, intent-unstated",
      "unrecognized-limit",
      "none, intent-unstated",
      "intent-unstated,",
      "configured-base-unresolved=",
    ])
      assertIntegrityFailure(
        withIntegrityFields(full, { "Degradation flags": flags }),
        root,
        /flag/,
      );
    assertIntegrityFailure(
      withIntegrityFields(full, {
        "Degradation evidence": '{"intent-unstated":"unclaimed"}',
      }),
      root,
      /one nonempty explanation/,
    );
  });
});
