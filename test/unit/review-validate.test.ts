/**
 * How a drafted review is read before it is judged: compact and full surfaces, fenced and
 * commented examples that must stay inert, semantic anchors that must resolve, and the
 * Review Integrity block's required fields.
 * Fixtures use real files so anchor and ledger claims are behavioural, not mocked.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateReviewReport } from "../../src/cli/review-validate.js";
import {
  createReviewedProject,
  createVersionedReviewedProject,
  validReview,
  hasCheck,
  hasViolation,
} from "./review-validate.helpers.js";
import type { ValidationIssueShape } from "./review-validate.helpers.js";

describe("review output validation: grammar, masking, and integrity", () => {
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

  it("rejects a second decision appended to a compact verdict", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    for (const verdict of [
      "Ship Verdict: **YES** and **NO**",
      "Ship Verdict: **YES** - actually **NO**",
    ]) {
      const report = `Scope: reviewed worktree at HEAD; 1 file and 1 changed line.
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
    const mixedVerdict = validReview().replace(
      "## TL;DR",
      "Ship Verdict: **YES** - compact duplicate.\n\n## TL;DR",
    );
    const mixedIntegrity = validReview().replace(
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
    const report = `\`Scope: reviewed worktree at HEAD; 1 file and 1 changed line.
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
    const report = `Scope: reviewed worktree at HEAD; 1 file and 1 changed line.
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
    const compact = `Scope: reviewed worktree at HEAD; 1 file and 1 changed line.
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
Scope: reviewed worktree at HEAD; 1 file and 1 changed line.
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
Scope: reviewed worktree at HEAD; 1 file and 1 changed line.
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
`;

    assert.deepEqual(validateReviewReport(report, projectRoot).violations, []);
  });

  it("rejects structural review evidence inside a raw HTML block", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = `<pre>\n${validReview()}\n</pre>\n`;
    const result = validateReviewReport(report, projectRoot);

    assert.equal(result.status, "fail");
    assert.equal(hasViolation(result, "integrity-format"), true);
    assert.equal(hasViolation(result, "ship-verdict-format"), true);
  });

  it("rejects structural review evidence inside a type-7 HTML block", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = `<x-review>
Scope: reviewed worktree at HEAD; 1 file and 1 changed line.
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
    const report = `Scope: reviewed worktree at HEAD; 1 file and 1 changed line.
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

  it("resolves semantic anchors from the declared immutable authority", (testContext) => {
    const { head, projectRoot } = createVersionedReviewedProject(testContext);
    const scope = `- Scope snapshot: source=PR #57, base=${head}, head=${head}, authority=immutable Git objects, drift=verified, uncommitted=no, signals=1, bundle=.goat-flow/logs/review/goat-review-bundle.fixture.diff, chunking=none`;
    const committedReport = validReview(
      "src/example.ts",
      "committedAnchor",
    ).replace(/^- Scope snapshot:.*$/mu, scope);
    const liveOnlyReport = validReview(
      "src/example.ts",
      "workingTreeOnly",
    ).replace(/^- Scope snapshot:.*$/mu, scope);

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
    const incompleteScope = validReview().replace(
      /^- Scope snapshot:.*$/mu,
      "- Scope snapshot: reviewed the current change",
    );
    const wrongEvidenceTotal = validReview().replace(
      "- Evidence: 4 OBSERVED / 0 INFERRED",
      "- Evidence: 3 OBSERVED / 0 INFERRED",
    );
    const wrongVerdictTotal = validReview().replace(
      "- Verdicts: 4/0/0/0",
      "- Verdicts: 3/0/0/0",
    );
    const impossibleFileCoverage = validReview().replace(
      "- Files opened in Pass 2: 1/1",
      "- Files opened in Pass 2: 2/1",
    );

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

  it("ignores fenced examples but rejects fenced-only live integrity", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const fencedExample = validReview().replace(
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

    const fencedIntegrity = validReview().replace(
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
    const indentedExample = validReview().replace(
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
    const indentedProof = validReview()
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
    const commentedExample = validReview().replace(
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
