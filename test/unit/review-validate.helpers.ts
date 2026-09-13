/**
 * Arrange disposable projects and review reports for validator tests.
 * Use these helpers to bind a valid source before introducing the defect a test is meant to exercise.
 *
 * Each project exposes a literal source anchor and registers its own cleanup.
 * The plain report template is deliberately unbound; validReview captures actual authority before a test mutates the report.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateReviewReport } from "../../src/cli/review-validate.js";
import { record } from "../../src/cli/review-validate-common.js";
import {
  canonicalReviewJson,
  captureReviewSnapshot,
  reviewScopeLabels,
  reviewGateId,
  type ReviewAuthoritySnapshot,
  type ReviewSnapshotEnvelope,
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
  mkdirSync(join(projectRoot, ".goat-flow/logs/review"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".goat-flow/logs/review/goat-review-bundle.fixture.diff"),
    "",
  );
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
  writeFileSync(join(projectRoot, ".git/info/exclude"), ".goat-flow/logs/\n");
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
- Source coverage: ${canonicalReviewJson([anchorPath])}
- Evidence: 4 OBSERVED / 0 INFERRED
- Verdicts: 4/0/${refutedVerdicts}/0
- Refutations logged: ${refutationsLogged}
- Refutation ledger: ${refutationLedger}
- Review validator: validated
- Gates: skipped (not requested)
- Gate evidence: pass=0, changed-code=0, pre-existing=0, infrastructure=0, unresolved=0
- Size: 1 files, 1 changed lines (source coverage: 1/1 exactly once)
- Automated-review provenance: n/a
- Refuter pass: yes; confirmed=1, refuted=0, unresolved=0, leads-verified=0, model=test-refuter
- Refuter outcomes: {"R-004":"confirmed"}
- Spec drift: checked M05
- Degradation flags: gates-not-run
- Degradation evidence: {"gates-not-run":"No gates were requested."}
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
  const paths = authority.inventory.map((member) => member.path);
  return report
    .replace(/^- (?:Authority snapshot|Gate authority):.*\n/gmu, "")
    .replace(/^- Scope snapshot:.*$/mu, fields)
    .replace(
      /^- Files opened in Pass 2:.*$/mu,
      `- Files opened in Pass 2: ${paths.length}/${paths.length} (paths: ${canonicalReviewJson(paths)})`,
    )
    .replace(
      /^- Source coverage:.*$/mu,
      `- Source coverage: ${canonicalReviewJson(paths)}`,
    )
    .replace(
      /^- Size: \d+ files?, (\d+) (changed lines|clusters) \(source coverage: \d+\/\d+ exactly once\)$/mu,
      `- Size: ${paths.length} files, $1 $2 (source coverage: ${paths.length}/${paths.length} exactly once)`,
    )
    .replace(
      "- Automated-review provenance: n/a",
      authority.source.kind === "pr"
        ? "- Automated-review provenance: no-automated-review-present"
        : "- Automated-review provenance: n/a",
    );
}

/**
 * Build compact review metadata with real selected files and a completed matching gate.
 *
 * @param projectRoot - fixture root whose default live source is captured
 * @returns canonical source, coverage, and gate records; the disposable command supplies one passing gate
 */
export function reviewAuthorityFields(projectRoot: string): string {
  // Compact controls require an actual diff and a completed matching gate, so arrange both inside the disposable project.
  if (!existsSync(join(projectRoot, ".git"))) {
    const options = {
      cwd: projectRoot,
      encoding: "utf8" as const,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Review fixture",
        GIT_AUTHOR_EMAIL: "review@example.invalid",
        GIT_COMMITTER_NAME: "Review fixture",
        GIT_COMMITTER_EMAIL: "review@example.invalid",
      },
    };
    execFileSync("git", ["init", "-q"], options);
    writeFileSync(join(projectRoot, ".git/info/exclude"), ".goat-flow/logs/\n");
    const tree = execFileSync("git", ["mktree"], {
      ...options,
      input: "",
    }).trim();
    const commit = execFileSync("git", ["commit-tree", tree], {
      ...options,
      input: "empty fixture base\n",
    }).trim();
    execFileSync("git", ["update-ref", "HEAD", commit], options);
  }
  const request = JSON.stringify({
    schema: "goat-review-request/v1",
    source: {
      kind: "worktree",
      base: "HEAD",
      untracked: { mode: "all-nonignored" },
    },
    execution: true,
  });
  const before = captureReviewSnapshot(request, projectRoot);
  const argv = [
    process.execPath,
    "-e",
    "process.stdout.write('fixture gate\\n')",
  ];
  const processResult = spawnSync(argv[0]!, argv.slice(1), {
    cwd: projectRoot,
    encoding: "utf8",
  });
  assert.equal(processResult.status, 0, processResult.stderr);
  const after = captureReviewSnapshot(request, projectRoot);
  assert.equal(after.authority.fingerprint, before.authority.fingerprint);
  assert.equal(before.checkout.fingerprint, before.authority.workspace);
  const { authority } = before;
  const origin = {
    kind: "host",
    reference: "disposable fixture command",
    sha256: createHash("sha256").update(argv.join("\0")).digest("hex"),
  };
  const gate = {
    id: reviewGateId(argv, ".", origin),
    argv,
    cwd: ".",
    origin,
    expectedWorkspace: authority.workspace,
    attempts: [
      {
        number: 1,
        reviewBefore: authority.fingerprint,
        reviewAfter: after.authority.fingerprint,
        workspaceBefore: before.checkout.fingerprint,
        workspaceAfter: after.checkout.fingerprint,
        exitCode: processResult.status,
        output: processResult.stdout,
      },
    ],
    outcome: "pass",
    reason: null,
  };
  const gates = {
    schema: "goat-review-gates/v1",
    review: authority.fingerprint,
    trustedBase: null,
    hostInstructions: [{ reference: origin.reference, sha256: origin.sha256 }],
    gates: [gate],
  };
  const labels = reviewScopeLabels(authority);
  const paths = authority.inventory.map((member) => member.path);
  return `Scope snapshot: source=${labels.source}, base=${labels.base}, head=${labels.head}, authority=${authority.fingerprint}, drift=verified, uncommitted=${labels.uncommitted}, signals=1, bundle=.goat-flow/logs/review/goat-review-bundle.fixture.diff, chunking=none
Authority snapshot: ${canonicalReviewJson(authority)}
Gate authority: ${canonicalReviewJson(gates)}
Files opened in Pass 2: ${paths.length}/${paths.length} (paths: ${canonicalReviewJson(paths)})
Source coverage: ${canonicalReviewJson(paths)}
Size: ${paths.length} files, 1 changed lines (source coverage: ${paths.length}/${paths.length} exactly once)
Evidence: 0 OBSERVED / 0 INFERRED
Verdicts: 0/0/0/0
Final dispositions: {}
Refutations logged: 0
Gates: run
Gate evidence: pass=1, changed-code=0, pre-existing=0, infrastructure=0, unresolved=0
Degradation evidence: {}`;
}

/**
 * Replace named receipt fields while arranging a control or one deliberate contradiction.
 * Both report forms retain their own row syntax; missing new metadata is added to the same integrity surface.
 *
 * @param report - fixture report; existing duplicates are refused so a mutation cannot silently miss its target
 * @param values - complete serialized values for the named fields, including canonical JSON where required
 * @returns the same report with only the requested metadata changes
 * @throws Error when the fixture already contains duplicate fields
 */
export function withIntegrityFields(
  report: string,
  values: Record<string, string>,
): string {
  const full = /^## Review Integrity\s*$/mu.test(report);
  // Each requested field changes once, keeping control construction distinct from the production validator.
  for (const [label, value] of Object.entries(values)) {
    const pattern = new RegExp(`^(?:- )?${label}:.*$`, "gmu");
    const matches = report.match(pattern) ?? [];
    // A repeated fixture field would make a one-field mutation ambiguous and could hide the regression being tested.
    if (matches.length > 1)
      throw new Error(`duplicate fixture field: ${label}`);
    const replacement = `${full ? "- " : ""}${label}: ${value}`;
    // Replace an existing claim once; an absent claim is added in the report's current presentation.
    if (matches.length === 1)
      report = report.replace(pattern, () => replacement);
    else
      report = full
        ? report.replace(
            "## Review Integrity\n",
            `## Review Integrity\n${replacement}\n`,
          )
        : `${report}\n${replacement}\n`;
  }
  return report;
}

/**
 * Build a complete compact worktree control after arranging real source files; the caller supplies the measured changed-line count.
 *
 * @param projectRoot - disposable project with its source files arranged before capture
 * @param changedLines - measured fixture line count; omitted uses the one-line control
 * @returns complete zero-finding compact report with actual source and gate authority
 */
export function cleanReview(projectRoot: string, changedLines = 1): string {
  const metadata = reviewAuthorityFields(projectRoot);
  const count = Number(metadata.match(/Files opened in Pass 2: (\d+)/u)![1]);
  return `Scope: worktree; ${count} files and ${changedLines} changed lines; chunking=none.
${metadata.replace(/Size:.*$/mu, `Size: ${count} files, ${changedLines} changed lines (source coverage: ${count}/${count} exactly once)`)}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; ${count}/${count} files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
`;
}

/**
 * Render the same clean control in full form so a test can compare integrity behavior without changing its authority or gate evidence.
 *
 * @param compact - complete compact control whose authority and receipt claims must remain unchanged
 * @returns equivalent full report for comparing presentation behavior
 */
export function fullCleanReview(compact: string): string {
  const metadata = compact
    .split("\n")
    .filter(
      (line) =>
        line.trim() &&
        !/^(Scope:|Ship Verdict:|Zero findings:|Review Integrity:|What I Didn't Examine:)/u.test(
          line,
        ),
    );
  const conclusion = compact.match(/Review Integrity: ([^;]+)/u)![1];
  const flags = compact.match(/; flags=([^;]+)/u)?.[1] ?? "none";
  const validator = compact.match(/validator=([^.;]+)/u)![1];
  const verdict = compact.match(/Ship Verdict: \*\*([^*]+)\*\*/u)![1];
  return `## Review Integrity\n${metadata.map((line) => `- ${line}`).join("\n")}\n- Conclusion: ${conclusion}\n- Degradation flags: ${flags}\n- Review validator: ${validator}\n\n## Findings\nNo findings survived this fixture.\n\n## Ship Verdict\nDecision: **${verdict}**\n\n## What I Didn't Examine\nNone.\n`;
}

/**
 * Add two valid surfaced findings so the report crosses the Top 5 threshold.
 *
 * @param report - valid control to extend; evidence and verdict totals grow with the added findings
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

/**
 * Spawn Git to write fixture history or read its state, exclusively inside the disposable reviewed project.
 *
 * @param root - disposable fixture repository; never the controlling workspace
 * @param args - literal Git arguments for fixture arrangement or inspection
 * @param input - optional stdin; omitted supplies none, while an empty string supplies empty input
 * @returns trimmed Git stdout, which may be empty for a successful quiet operation
 * @throws Error when the fixture Git command cannot start or exits unsuccessfully
 */
export function git(root: string, args: string[], input?: string): string {
  return execFileSync("git", ["--no-optional-locks", "-C", root, ...args], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Review fixture",
      GIT_AUTHOR_EMAIL: "review@example.invalid",
      GIT_COMMITTER_NAME: "Review fixture",
      GIT_COMMITTER_EMAIL: "review@example.invalid",
    },
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Create one actual commit with a tracked source file and an attached HEAD.
 *
 * @param test - test context that owns cleanup of the disposable repository
 * @param format - Git object format; omitted uses sha1
 * @returns fixture root and actual base commit ID for source-selection tests
 */
export function repository(
  test: TestContext,
  format = "sha1",
): { root: string; base: string } {
  const root = createReviewedProject(test);
  git(root, ["init", "-q", `--object-format=${format}`]);
  writeFileSync(join(root, ".git/info/exclude"), ".goat-flow/logs/\n");
  git(root, ["add", "src/example.ts"]);
  const base = git(
    root,
    ["commit-tree", git(root, ["write-tree"])],
    "initial fixture\n",
  );
  git(root, ["update-ref", "HEAD", base]);
  return { root, base };
}

/**
 * Capture the selected source exactly as the CLI producer does; execution defaults to unrequested.
 *
 * @param root - fixture project whose source is being selected
 * @param source - request source object, including any intentionally invalid value under test
 * @param execution - whether to capture gate execution state; omitted leaves it unrequested
 * @param renames - declared old/new pairs; empty means no rename claims
 * @returns actual producer response with authority and optional checkout measurement
 */
export function capture(
  root: string,
  source: unknown,
  execution = false,
  renames: unknown[] = [],
): ReviewSnapshotEnvelope {
  return captureReviewSnapshot(
    JSON.stringify({
      schema: "goat-review-request/v1",
      source,
      execution,
      renames,
    }),
    root,
  );
}

/**
 * Supply an explicit no-gate record, which cannot be confused with executed proof.
 *
 * @param snapshot - actual selected source to bind the explicit no-execution record
 * @returns empty gate inventory and no trusted command source; it cannot substantiate Gates: run
 */
export function noGates(snapshot: ReviewAuthoritySnapshot): unknown {
  return {
    schema: "goat-review-gates/v1",
    review: snapshot.fingerprint,
    trustedBase: null,
    hostInstructions: [],
    gates: [],
  };
}

/**
 * Record every fixture file's bytes and mode, including Git metadata, before read-only validation.
 *
 * @param root - disposable project whose source and Git metadata must remain unchanged
 * @param directory - relative subtree to inspect; empty starts at the fixture root
 * @returns sorted byte/mode observations; an empty directory contributes no file records
 */
export function fixtureState(root: string, directory = ""): string[] {
  return readdirSync(join(root, directory))
    .sort()
    .flatMap((name) => {
      const path = directory ? `${directory}/${name}` : name;
      const absolute = join(root, path);
      const details = lstatSync(absolute);
      // Fixture trees contain only files, directories, and explicitly tested symlinks; never traverse a symlink.
      if (details.isDirectory()) return fixtureState(root, path);
      // Record the symlink itself without following it into files outside the disposable fixture.
      if (details.isSymbolicLink()) return [`${path}:symlink:${details.mode}`];
      return [
        `${path}:${details.mode}:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`,
      ];
    });
}

/**
 * Assert a report result and prove that the validator itself left the fixture unchanged.
 *
 * @param root - disposable project before and after read-only validation
 * @param text - submitted report; invalid or empty text remains available to exercise refusals
 * @param expected - pass requires no violations; otherwise require this specific violation code
 */
export function assertReviewResult(
  root: string,
  text: string,
  expected: "pass" | string,
): void {
  const before = fixtureState(root);
  const result = validateReviewReport(text, root);
  assert.deepEqual(
    fixtureState(root),
    before,
    "validation must preserve fixture bytes and modes",
  );
  // A negative case must fail for its intended authority issue, not merely for an unrelated malformed fixture field.
  if (expected === "pass") assert.deepEqual(result.violations, []);
  else
    assert.equal(
      result.violations.some((violation) => violation.code === expected),
      true,
      JSON.stringify(result.violations),
    );
}

/**
 * Run a literal fixture command and retain its actual result against the same before/after source; null requests a real interrupted process.
 *
 * @param root - disposable project in which the literal fixture command may run
 * @param snapshot - selected source whose review and workspace fingerprints must stay unchanged
 * @param exitCode - requested process exit; null sends SIGTERM to exercise an actual interrupted command
 * @returns recorded command, origin, and its single measured attempt for later classification
 * @throws AssertionError when the process result or source measurements differ from the requested control
 */
export function fixtureGate(
  root: string,
  snapshot: ReviewAuthoritySnapshot,
  exitCode: number | null,
) {
  const argv = [
    process.execPath,
    "-e",
    exitCode === null
      ? 'process.kill(process.pid,"SIGTERM")'
      : `process.exit(${exitCode})`,
  ];
  const before = capture(
    root,
    { kind: "worktree", base: "HEAD", untracked: { mode: "all-nonignored" } },
    true,
  );
  const result = spawnSync(argv[0]!, argv.slice(1), {
    cwd: root,
    encoding: "utf8",
  });
  const after = capture(
    root,
    { kind: "worktree", base: "HEAD", untracked: { mode: "all-nonignored" } },
    true,
  );
  assert.equal(result.status, exitCode);
  assert.equal(before.authority.fingerprint, snapshot.fingerprint);
  assert.equal(after.authority.fingerprint, snapshot.fingerprint);
  assert.equal(before.checkout.fingerprint, snapshot.workspace);
  assert.equal(after.checkout.fingerprint, snapshot.workspace);
  const origin = {
    kind: "host",
    reference: "literal fixture outcome command",
    sha256: createHash("sha256").update(argv.join("\0")).digest("hex"),
  };
  return {
    id: reviewGateId(argv, ".", origin),
    argv,
    cwd: ".",
    origin,
    expectedWorkspace: snapshot.workspace,
    attempts: [
      {
        number: 1,
        reviewBefore: snapshot.fingerprint,
        reviewAfter: snapshot.fingerprint,
        workspaceBefore: before.checkout.fingerprint,
        workspaceAfter: after.checkout.fingerprint,
        exitCode: result.status,
        output: result.stdout,
      },
    ],
    outcome: "unresolved",
    reason: null as string | null,
  };
}

/**
 * Bind a full-report control to the actual selected source before introducing a report defect.
 *
 * @param snapshot - captured inventory and identity; its selected paths remain the coverage denominator
 * @param search - literal source anchor; omitted uses the fixture's loadConfig marker
 * @param path - selected file owning the anchor; omitted uses src/example.ts
 * @param side - explicit old/new evidence side; omitted uses the report's normal anchor side
 * @returns full report with actual authority and no executed gates; sampled areas retain their exclusions
 */
export function report(
  snapshot: ReviewAuthoritySnapshot,
  search = "loadConfig",
  path = "src/example.ts",
  side?: "old" | "new",
): string {
  const labels = reviewScopeLabels(snapshot);
  const scope = `- Scope snapshot: source=${labels.source}, base=${labels.base}, head=${labels.head}, authority=${snapshot.fingerprint}, drift=verified, uncommitted=${labels.uncommitted}, signals=1, bundle=.goat-flow/logs/review/goat-review-bundle.fixture.diff, chunking=none`;
  let text = reviewReportTemplate(path, search).replace(
    /^- Scope snapshot:.*$/mu,
    `${scope}\n- Authority snapshot: ${canonicalReviewJson(snapshot)}\n- Gate authority: ${canonicalReviewJson(noGates(snapshot))}`,
  );
  const selectedPaths = snapshot.inventory.map((member) => member.path);
  text = text
    .replace(
      /^- Files opened in Pass 2:.*$/mu,
      `- Files opened in Pass 2: ${selectedPaths.length}/${selectedPaths.length} (paths: ${canonicalReviewJson(selectedPaths)})`,
    )
    .replace(
      /^- Source coverage:.*$/mu,
      `- Source coverage: ${canonicalReviewJson(selectedPaths)}`,
    )
    .replace(
      /^- Size:.*$/mu,
      `- Size: ${selectedPaths.length} files, 1 changed lines (source coverage: ${selectedPaths.length}/${selectedPaths.length} exactly once)`,
    )
    .replace(
      "- Automated-review provenance: n/a",
      snapshot.source.kind === "pr"
        ? "- Automated-review provenance: no-automated-review-present"
        : "- Automated-review provenance: n/a",
    );
  // Area reviews count clusters; retaining diff units would mask the authority behavior under test.
  if (snapshot.source.kind === "area")
    text = text.replace("1 changed lines", "1 clusters");
  // A sampled control identifies the surrounding files it deliberately leaves outside its review.
  if (
    snapshot.source.kind === "area" &&
    record(snapshot.source.requested, "area request").sample !== null
  )
    text +=
      "\n## What I Didn't Examine\nFiles outside the selected sample under the declared roots.\n";
  // An explicit side or delimiter-bearing filename needs escaped evidence so the report preserves its literal meaning.
  if (side !== undefined || /[\n\r\t`|"<>]/u.test(path + search))
    text = text.replaceAll(
      `\`${path}\` (search: \`${search}\`)`,
      `anchor=${canonicalReviewJson({ path, search, side: side ?? "new" })}`,
    );
  return text;
}

/**
 * Keep source-authority controls free of findings; selections without completed gates use the full report.
 *
 * @param snapshot - actual source selection to validate without any active finding claims
 * @returns full zero-finding report that discloses its unexecuted gates
 */
export function zeroFindingReport(snapshot: ReviewAuthoritySnapshot): string {
  return report(snapshot)
    .replace(
      /\n## Findings\n[\s\S]*?(?=\n## Ship Verdict)/u,
      "\n## Findings\n\nNo findings in this fixture.\n",
    )
    .replace("- Evidence: 4 OBSERVED", "- Evidence: 0 OBSERVED")
    .replace("- Verdicts: 4/0/0/0", "- Verdicts: 0/0/0/0")
    .replace(/^- Refuter (?:pass|outcomes):.*\n/gmu, "")
    .replace("Decision: **PARTIAL**", "Decision: **YES WITH CONDITIONS**")
    .replace(
      "One configuration defect survived review.",
      "No finding survived this source-authority control.",
    )
    .replace(
      "Reasoning: R-001 remains open.",
      "Reasoning: gate execution remains unverified.",
    );
}

/**
 * Arrange a new immutable tree without checkout, using only the fixture index and local objects.
 *
 * @param root - disposable repository whose fixture index and object store may be changed
 * @param files - literal path-to-content map; empty builds an empty fixture tree
 * @param parents - actual parent commit IDs; empty creates a root revision
 * @returns new immutable commit ID without moving the fixture checkout
 */
export function revision(
  root: string,
  files: Record<string, string>,
  parents: string[],
): string {
  git(root, ["read-tree", "--empty"]);
  // Each supplied path becomes an exact blob in the synthetic history; arrangement never runs a reviewed command.
  for (const [path, contents] of Object.entries(files)) {
    const blob = git(root, ["hash-object", "-w", "--stdin"], contents);
    git(root, [
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${blob},${path}`,
    ]);
  }
  return git(
    root,
    [
      "commit-tree",
      git(root, ["write-tree"]),
      ...parents.flatMap((parent) => ["-p", parent]),
    ],
    "selected fixture revision\n",
  );
}

/**
 * Rebuild a selected-state gate report after each receipt mutation, preserving the same pass and wrong-checkout controls.
 *
 * @param snapshot - actual selected source retained across receipt mutations
 * @param gates - complete gate-authority record submitted by the fixture
 * @param gate - current pass or wrong-checkout outcome used to align the report's summary
 * @returns full report whose gate totals, disclosures, confidence, and verdict agree with this fixture outcome
 */
export function reportWithGate(
  snapshot: ReviewAuthoritySnapshot,
  gates: unknown,
  gate: { outcome: string },
): string {
  return report(snapshot)
    .replace(
      /^- Gate authority:.*$/mu,
      `- Gate authority: ${canonicalReviewJson(gates)}`,
    )
    .replace(
      "- Gates: skipped (not requested)",
      gate.outcome === "pass"
        ? "- Gates: run"
        : "- Gates: skipped (selected-state-mismatch)",
    )
    .replace(
      "pass=0, changed-code=0",
      `pass=${gate.outcome === "pass" ? 1 : 0}, changed-code=0`,
    )
    .replace(
      "- Degradation flags: gates-not-run",
      gate.outcome === "pass"
        ? "- Degradation flags: none"
        : "- Degradation flags: gates-not-run",
    )
    .replace(
      '- Degradation evidence: {"gates-not-run":"No gates were requested."}',
      gate.outcome === "pass"
        ? "- Degradation evidence: {}"
        : '- Degradation evidence: {"gates-not-run":"The selected source did not match the executed checkout."}',
    )
    .replace(
      "- Conclusion: coverage-degraded",
      gate.outcome === "pass"
        ? "- Conclusion: confident"
        : "- Conclusion: coverage-degraded",
    )
    .replace(
      "Decision: **PARTIAL**",
      gate.outcome === "pass"
        ? "Decision: **YES WITH CONDITIONS**"
        : "Decision: **PARTIAL**",
    );
}
