/**
 * Review-output validator coverage from pure grammar checks through CLI registration.
 * Fixtures use real files so semantic-anchor and refutation-ledger claims are behavioural.
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import {
  renderReviewValidationResult,
  validateReviewReport,
} from "../../src/cli/review-validate.js";

const FRAMEWORK_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(FRAMEWORK_ROOT, "src", "cli", "cli.ts");

/** Writes a disposable reviewed project whose source anchor can be resolved literally. */
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

/**
 * Writes one immutable review authority whose file differs from the live checkout.
 * Use when a test must prove validation reads the pinned authority, not the working tree.
 *
 * @returns paths to the written project and its pinned authority file
 */
function createVersionedReviewedProject(testContext: TestContext): {
  head: string;
  projectRoot: string;
} {
  const projectRoot = createReviewedProject(testContext);
  const runGit = (args: string[], input?: string): string => {
    const result = spawnSync("git", ["-C", projectRoot, ...args], {
      encoding: "utf-8",
      input,
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: "review-validator@example.invalid",
        GIT_AUTHOR_NAME: "Review Validator",
        GIT_COMMITTER_EMAIL: "review-validator@example.invalid",
        GIT_COMMITTER_NAME: "Review Validator",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  runGit(["init", "--quiet"]);
  writeFileSync(
    join(projectRoot, "src", "example.ts"),
    "export const committedAnchor = 'committed';\n",
    "utf-8",
  );
  runGit(["add", "src/example.ts"]);
  const tree = runGit(["write-tree"]);
  const head = runGit(["commit-tree", tree], "review fixture\n");
  writeFileSync(
    join(projectRoot, "src", "example.ts"),
    "export const workingTreeOnly = 'live';\n",
    "utf-8",
  );
  return { head, projectRoot };
}

/** Render one full report using every validator-owned finding and integrity field. */
function validReview(
  anchorPath = "src/example.ts",
  anchorText = "loadConfig",
  refutationsLogged: number | string = 0,
  refutationLedger = "n/a",
): string {
  const refutedVerdicts = Number(
    String(refutationsLogged).match(/^\d+/u)?.[0] ?? "0",
  );
  return `## TL;DR

One configuration defect survived review.

## Review Integrity
- Scope snapshot: source=worktree, base=HEAD, head=worktree, authority=live worktree snapshot, drift=verified, uncommitted=yes, signals=1, bundle=.goat-flow/logs/review/goat-review-bundle.fixture.diff, chunking=none
- Files opened in Pass 2: 1/1 (diff paths: ${anchorPath})
- Evidence: 4 OBSERVED / 0 INFERRED
- Verdicts: 4/0/${refutedVerdicts}/0
- Refutations logged: ${refutationsLogged}
- Refutation ledger: ${refutationLedger}
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
Decision: **PARTIAL**
Reasoning: R-001 remains open.
Confidence: MEDIUM
`;
}

/** Add two valid surfaced findings so the report crosses the Top 5 threshold. */
function withSixSurfacedFindings(report: string): string {
  const additions = `- R-005 [MAY:patch] [local-only] **Cover configuration parsing** \`src/example.ts\` (search: \`loadConfig\`) - Parsing lacks one focused assertion. | Footgun: none | Evidence: OBSERVED | Proof: STATIC
- R-006 [MAY:needs-signal] [local-only] **Trace configuration defaults** \`src/example.ts\` (search: \`loadConfig\`) - Default selection lacks an operator signal. | Footgun: none | Evidence: OBSERVED | Proof: CONTRACT-GREP

`;
  return report
    .replace("- Evidence: 4 OBSERVED", "- Evidence: 6 OBSERVED")
    .replace(/- Verdicts: 4\/0\/(\d+)\/0/u, "- Verdicts: 6/0/$1/0")
    .replace("## Systemic Patterns", `${additions}## Systemic Patterns`);
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

/** Stable validator issue fields asserted by warning and violation fixtures. */
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
    for (const label of ["Scope", "Zero findings", "What I Didn't Examine"]) {
      assert.equal(
        messages.includes(`compact clean review is missing ${label}`),
        true,
        JSON.stringify(messages),
      );
    }
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
