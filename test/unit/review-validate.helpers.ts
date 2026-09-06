/**
 * Arrange disposable projects and review reports for validator tests.
 * Use these helpers to bind a valid source before introducing the defect a test is meant to exercise.
 *
 * Each project exposes a literal source anchor and registers its own cleanup.
 * The plain report template is deliberately unbound; validReview captures actual authority before a test mutates the report.
 */
import { spawnSync } from "node:child_process";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateReviewReport } from "../../src/cli/review-validate.js";
import {
  canonicalReviewJson,
  captureReviewSnapshot,
  reviewScopeLabels,
} from "../../src/cli/review-validate-authority.js";

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
 * Create immutable source commits and a different live file for source-substitution tests.
 * Use before binding a PR or branch control whose evidence must come from its selected commit.
 *
 * @param testContext - running test that owns cleanup of the disposable project
 * @returns the project root and resolved base/head commit IDs; the live file deliberately differs from head
 */
export function createVersionedReviewedProject(testContext: TestContext): {
  base: string;
  head: string;
  projectRoot: string;
} {
  const projectRoot = createReviewedProject(testContext);
  // Spawns git inside the fixture repository, because anchor validation is judged against real Git objects rather than a stub.
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
  const base = runGit(
    ["commit-tree", runGit(["mktree"], "")],
    "empty comparison fixture\n",
  );
  writeFileSync(
    join(projectRoot, "src", "example.ts"),
    "export const committedAnchor = 'committed';\n",
    "utf-8",
  );
  runGit(["add", "src/example.ts"]);
  const tree = runGit(["write-tree"]);
  const head = runGit(["commit-tree", tree, "-p", base], "review fixture\n");
  writeFileSync(
    join(projectRoot, "src", "example.ts"),
    "export const workingTreeOnly = 'live';\n",
    "utf-8",
  );
  return { base, head, projectRoot };
}

/**
 * Render the shared report grammar before binding it to a fixture's actual source.
 *
 * @param anchorPath - file the findings cite; omitted uses the fixture source path
 * @param anchorText - literal evidence; omitted uses the fixture's loadConfig symbol
 * @param refutationsLogged - claimed count, optionally with the persist-skipped notation
 *
 * @param refutationLedger - exact ledger path or skip marker; n/a means no ledger is claimed
 * @returns an unbound report template; call withReviewSource before using it as a passing control
 */
export function reviewReportTemplate(
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
 * Build a full-report control bound to the selected fixture's actual source bytes.
 *
 * @param projectRoot - disposable project whose authority is captured before the tested mutation
 * @param anchorPath - selected live file; omitted uses src/example.ts
 * @param anchorText - literal finding evidence; omitted uses the fixture's loadConfig text
 *
 * @param refutationsLogged - declared count; zero requires no persisted ledger
 * @param refutationLedger - exact ledger path or skip marker; n/a is valid only when no refutations are claimed
 * @returns the bound report to mutate without refreshing its authority
 */
export function validReview(
  projectRoot: string,
  anchorPath = "src/example.ts",
  anchorText = "loadConfig",
  refutationsLogged: number | string = 0,
  refutationLedger = "n/a",
): string {
  // An outside-project anchor is a negative fixture; keep its baseline on the real source so the path check causes the failure.
  const selectedPath = anchorPath.startsWith("../")
    ? "src/example.ts"
    : anchorPath;
  return withReviewSource(
    reviewReportTemplate(
      anchorPath,
      anchorText,
      refutationsLogged,
      refutationLedger,
    ),
    projectRoot,
    { kind: "paths", paths: [{ path: selectedPath, from: "live" }] },
  );
}

/**
 * Bind a fixture report to a source during arrangement, before the test introduces drift or a substitution.
 *
 * @param report - report template whose readable and canonical authority fields are replaced together
 * @param projectRoot - fixture root where the source request resolves
 * @param source - explicit request selection used for the control
 *
 * @returns a report carrying the captured source and an empty, uncredited gate inventory
 */
export function withReviewSource(
  report: string,
  projectRoot: string,
  source: unknown,
): string {
  const { authority } = captureReviewSnapshot(
    JSON.stringify({ schema: "goat-review-request/v1", source }),
    projectRoot,
  );
  const labels = reviewScopeLabels(authority);
  const scope = `- Scope snapshot: source=${labels.source}, base=${labels.base}, head=${labels.head}, authority=${authority.fingerprint}, drift=verified, uncommitted=${labels.uncommitted}, signals=1, bundle=.goat-flow/logs/review/goat-review-bundle.fixture.diff, chunking=none`;
  const gates = {
    schema: "goat-review-gates/v1",
    review: authority.fingerprint,
    trustedBase: null,
    hostInstructions: [],
    gates: [],
  };
  const fields = `${scope}\n- Authority snapshot: ${canonicalReviewJson(authority)}\n- Gate authority: ${canonicalReviewJson(gates)}`;
  return report
    .replace(/^- (?:Authority snapshot|Gate authority):.*\n/gmu, "")
    .replace(/^- Scope snapshot:.*$/mu, fields);
}

/**
 * Build the two standalone authority lines required by a compact review control.
 *
 * @param projectRoot - fixture root whose default live source is captured
 * @returns canonical source and empty-gate records; no gates receive execution credit
 */
export function reviewAuthorityFields(projectRoot: string): string {
  return validReview(projectRoot)
    .split("\n")
    .filter((line) => /^- (?:Authority snapshot|Gate authority):/u.test(line))
    .map((line) => line.slice(2))
    .join("\n");
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
 *
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
 * @returns advisory issues only; empty means the report earned no warnings, not that the validator skipped them
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
 *
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
