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
  refutationsLogged = 0,
): string {
  return `## TL;DR

One configuration defect survived review.

## Review Integrity
- Scope snapshot: source=worktree, base=HEAD, head=worktree, uncommitted=yes, signals=1, bundle=n/a, chunking=none
- Files opened in Pass 2: 1/1 (diff paths: ${anchorPath})
- Evidence: 4 OBSERVED / 0 INFERRED
- Verdicts: 4/0/0/0
- Refutations logged: ${refutationsLogged}
- Gates: skipped (not requested)
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

/** Return true when a validation result contains one named violation class. */
function hasViolation(
  result: ReturnType<typeof validateReviewReport>,
  code: string,
): boolean {
  return result.violations.some((violation) => violation.code === code);
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
Review Integrity: confident; 1/1 files opened; no degradation flags.
What I Didn't Examine: none.
`;
    assert.deepEqual(validateReviewReport(compact, projectRoot).violations, []);
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
    assert.match(rendered, /line \d+ \[anchor-unresolved\]/u);
    assert.match(rendered, /line \d+ \[finding-harm\]/u);
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
    assert.match(invalid.stdout, /\[anchor-unresolved\]/u);
    assert.match(invalid.stdout, /\[finding-harm\]/u);
  });
});
