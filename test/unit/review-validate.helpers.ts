/**
 * Shared fixtures for the review-output validator suites.
 * A validator test needs three things again and again: a disposable reviewed project whose
 * semantic anchors resolve literally, a complete valid report to mutate one field at a time,
 * and readers for the violations and warnings a run produces. These builders own that
 * boilerplate so each test states only the defect it introduces.
 *
 * `validReview` is the load-bearing piece: it renders a report that passes every check, so a
 * test that breaks exactly one thing proves that one rule rather than tripping several.
 */
import { spawnSync } from "node:child_process";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateReviewReport } from "../../src/cli/review-validate.js";

export const FRAMEWORK_ROOT = resolve(import.meta.dirname, "..", "..");
export const CLI_PATH = join(FRAMEWORK_ROOT, "src", "cli", "cli.ts");

/**
 * Writes a disposable reviewed project whose source anchor can be resolved literally.
 *
 * @param testContext - the running test; cleanup of the project is registered on it
 * @returns absolute project root the validator resolves anchors against
 */
export function createReviewedProject(testContext: TestContext): string {
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
 * @param testContext - the running test; cleanup of the project is registered on it
 * @returns paths to the written project and its pinned authority file
 */
export function createVersionedReviewedProject(testContext: TestContext): {
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

/**
 * Render one full report using every validator-owned finding and integrity field.
 *
 * @param anchorPath - file the findings cite; defaults to the fixture source written above
 * @param anchorText - literal each anchor must find; defaults to the fixture symbol
 * @param refutationsLogged - count the integrity block claims; a string form covers the
 *   persist-skipped notation
 * @param refutationLedger - ledger path the claim cites; "n/a" means none is claimed
 * @returns a report that passes every check, ready for a test to break one field
 */
export function validReview(
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

/**
 * Add two valid surfaced findings so the report crosses the Top 5 threshold.
 *
 * @param report - a valid report to extend; its evidence and verdict tallies are updated so
 *   the added findings stay consistent with the integrity block
 * @returns the report with six surfaced findings, the count that makes Top 5 mandatory
 */
export function withSixSurfacedFindings(report: string): string {
  const additions = `- R-005 [MAY:patch] [local-only] **Cover configuration parsing** \`src/example.ts\` (search: \`loadConfig\`) - Parsing lacks one focused assertion. | Footgun: none | Evidence: OBSERVED | Proof: STATIC
- R-006 [MAY:needs-signal] [local-only] **Trace configuration defaults** \`src/example.ts\` (search: \`loadConfig\`) - Default selection lacks an operator signal. | Footgun: none | Evidence: OBSERVED | Proof: CONTRACT-GREP

`;
  return report
    .replace("- Evidence: 4 OBSERVED", "- Evidence: 6 OBSERVED")
    .replace(/- Verdicts: 4\/0\/(\d+)\/0/u, "- Verdicts: 6/0/$1/0")
    .replace("## Systemic Patterns", `${additions}## Systemic Patterns`);
}

/**
 * Insert one Top 5 section immediately before the verdict.
 *
 * @param report - report to extend
 * @param findingId - finding the risk entry cites; defaults to the report's first finding
 * @param anchorText - literal the entry anchors to; defaults to the fixture's known symbol
 * @returns the report with a Top 5 Risks section whose reference must resolve
 */
export function withTopFiveRisk(
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
export interface ValidationIssueShape {
  checkId?: string;
  code: string;
  line: number | null;
  message: string;
}

/**
 * Read warning output while RED remains compatible with the pre-warning result type.
 *
 * @param result - a validator run; a result predating the warnings field reads as empty
 * @returns advisory issues only; empty means the report earned no warnings, not that the
 *   validator skipped them
 */
export function warningsOf(
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

/**
 * Return true when a validation result contains one named violation class.
 *
 * @param result - a validator run to inspect
 * @param code - stable issue code under test; unknown codes simply never match
 * @returns whether that violation class fired at least once
 */
export function hasViolation(
  result: ReturnType<typeof validateReviewReport>,
  code: string,
): boolean {
  return result.violations.some((violation) => violation.code === code);
}

/**
 * Return true when one issue carries the public V1-V8 check ID and detail code.
 *
 * @param issues - violations or warnings from a validator run
 * @param checkId - public check identifier the user sees beside the message
 * @param code - stable issue code that must accompany it
 * @returns whether the pair appears together, proving the issue is attributed correctly
 */
export function hasCheck(
  issues: ValidationIssueShape[],
  checkId: string,
  code: string,
): boolean {
  return issues.some(
    (issue) => issue.checkId === checkId && issue.code === code,
  );
}
