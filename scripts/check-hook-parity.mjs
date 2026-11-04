#!/usr/bin/env node
/**
 * The policy parity check a maintainer runs before accepting a change to the deny-dangerous or deny-git-mutations hooks.
 *
 * Example: after editing a rule in `src/hooks/` and running `npm run generate:hook-runtime`, run this with `--stage=candidate --require-complete`.
 * CI runs it with `--stage=installed` in the `hook-port-controls` and `hook-port-controls-wsl` jobs, so a regression fails the job log.
 *
 * - The shipped corpus `workflow/hooks/deny-dangerous/corpus.json` is the only source of expected decisions.
 * - Every corpus row runs through the real Node hook in both pinned locales, C and C.UTF-8.
 * - `--list-divergent` prints differences for investigation; it never turns them into accepted expectations.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policyNames = ["deny-dangerous", "deny-git-mutations"];
/** Stages a maintainer can check: `candidate` runs the hooks in `workflow/hooks/`, `installed` runs the `.goat-flow/hooks/` copy consumers get. */
export const stages = ["candidate", "installed"];
// Self-test rows each policy must keep per suite mode, as measured from the original Bash self-tests; a deleted corpus row fails this count.
const selfTestRowCounts = {
  "deny-dangerous": { smoke: 49, full: 921 },
  "deny-git-mutations": { smoke: 121, full: 953 },
};

/**
 * Fingerprint corpus input so an edited row is caught even when its ID stays the same.
 *
 * @param bytes - a row's serialized input; an empty input still gets a stable fingerprint
 * @returns SHA-256 hex digest of exactly these bytes; never empty
 */
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Build the environment one locale's rows run in, so the maintainer's own shell cannot change a hook decision.
 * Used once per locale by the stage runner before it spawns any hook.
 *
 * @param locale - the pinned locale to run, C or C.UTF-8; anything else stops the check
 * @returns a copy of the current environment with the locale pinned, Git config isolated and project-root overrides removed
 */
export function policyEnvironment(locale) {
  assert(["C", "C.UTF-8"].includes(locale), "explicit supported locale");
  const environment = {
    ...process.env,
    LC_ALL: locale,
    LANG: locale,
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  // On Windows, Path and PATH are one setting but two object keys; keep one so the hook finds Git on the maintainer's PATH.
  if (process.platform === "win32") {
    for (const key of Object.keys(environment)) {
      // A differently cased copy, such as `Path` from a Windows shell, becomes the single `PATH` entry.
      if (key.toUpperCase() === "PATH" && key !== "PATH") {
        environment.PATH = environment[key];
        Reflect.deleteProperty(environment, key);
      }
    }
  }
  // An override exported in the maintainer's shell, such as GOAT_FLOW_ROOT, would point rows at the real project instead of their fixtures.
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GOAT_FLOW_ROOT",
    "GOAT_HOOK_LIB_DIR",
  ])
    Reflect.deleteProperty(environment, key);
  return environment;
}

/**
 * Compare one hook run with the decision and messages its corpus row expects; this is the pass/fail rule for every row.
 * Also imported by `test/integration/hook-policy-node.test.ts`, so both checks judge outcomes the same way.
 *
 * @param actual - the finished hook run with base64 output; a missing or non-integer status means the hook never decided
 * @param expected - the row's saved outcome, or an approved denial-message predicate in `stderrIncludes`
 * @param requiresAvailable - false only for rows that deliberately remove the runtime to prove the hook fails closed
 * @param id - corpus row ID shown in the failure message; omitted shows a generic "case" label
 * @returns nothing; the first difference throws with the row ID so the maintainer can rerun that row with `--case=<id>`
 */
export function assertOutcome(
  actual,
  expected,
  requiresAvailable = true,
  id = "case",
) {
  assert(actual && Number.isInteger(actual.status), `missing result: ${id}`);
  const stdout = Buffer.from(actual.stdoutBase64, "base64").toString();
  const stderr = Buffer.from(actual.stderrBase64, "base64").toString();
  // A hook that could not start still refuses the request, so a matching refusal proves nothing unless the policy itself ran.
  if (requiresAvailable)
    assert(
      !`${stdout}${stderr}`.includes("Policy hook unavailable"),
      `unavailable: ${id}`,
    );
  assert.equal(actual.status, expected.status, `exit drift: ${id}`);
  // A reviewed protection only promises a denial line, so it checks for that text and an empty provider reply instead of exact bytes.
  if (expected.stderrIncludes !== undefined) {
    assert.equal(stdout, "", `unexpected provider envelope: ${id}`);
    assert(stderr.includes(expected.stderrIncludes), `required message: ${id}`);
    return;
  }
  assert.equal(
    typeof expected.stdoutBase64,
    "string",
    `missing stdout expectation: ${id}`,
  );
  assert.equal(
    typeof expected.stderrBase64,
    "string",
    `missing stderr expectation: ${id}`,
  );
  const expectedOut = Buffer.from(expected.stdoutBase64, "base64").toString();
  // A provider reply is JSON, so key order may differ; any other output must match the saved text exactly.
  if (expectedOut.trim().startsWith("{"))
    assert.deepEqual(
      JSON.parse(stdout),
      JSON.parse(expectedOut),
      `provider response drift: ${id}`,
    );
  else assert.equal(stdout, expectedOut, `stdout drift: ${id}`);
  assert.equal(
    stderr,
    Buffer.from(expected.stderrBase64, "base64").toString(),
    `asserted message drift: ${id}`,
  );
}

/**
 * Decide whether a row's exception label is one of the reviewed reasons its expectation may differ from the original Bash result.
 *
 * @param row - corpus row; an absent `exceptionId` means the row claims no difference and is always allowed
 * @returns true for a reviewed label, or `native-startup` on a missing-runtime row; false makes validation reject the row
 */
function isApprovedException(row) {
  return row.exceptionId === "native-startup"
    ? row.availabilityCase
    : !row.exceptionId ||
        /^(historical-gap-(?:[1-9]|10)|review-gap-(?:1[1-9]|2[01])|full-json-decoding|locale-C|invalid-request-encoding|obsolete-advice|native-powershell|recovery-message)$/.test(
          row.exceptionId,
        );
}

/**
 * Check the shipped corpus schema and every row before any hook runs, so a damaged corpus fails fast instead of passing quietly.
 * Runs on every stage and from `test/integration/hook-parity.test.ts`, which feeds it deliberately damaged copies.
 *
 * @param corpus - the parsed corpus with its declared `caseCount` and rows
 * @returns the case and policy totals; any missing, duplicated, edited or unapproved row throws with the row ID
 */
export function validateCorpus(corpus) {
  assert.equal(corpus.schemaVersion, 1, "corpus schema");
  assert.equal(
    corpus.caseCount,
    corpus.rows.length,
    "declared complete coverage",
  );
  assert.equal(
    new Set(corpus.rows.map((row) => row.id)).size,
    corpus.rows.length,
    "duplicate case identity",
  );
  // Every row must name a known policy, a suite it runs in and an unchanged input before its expected decision is trusted.
  for (const row of corpus.rows) {
    assert(policyNames.includes(row.policy), `unknown policy: ${row.id}`);
    assert(
      row.membership.length &&
        row.membership.every((mode) => ["smoke", "full"].includes(mode)),
      `suite membership: ${row.id}`,
    );
    assert.equal(
      row.inputSha256,
      digest(JSON.stringify(row.input)),
      `input drift: ${row.id}`,
    );
    assert(isApprovedException(row), `unknown exception: ${row.id}`);
    // A message predicate is either absent or the exact bounded denial text; an empty string would accept any stderr.
    assert(
      row.expected.stderrIncludes === undefined ||
        (/^(?:historical|review)-gap-/.test(row.exceptionId ?? "") &&
          row.expected.status === 2 &&
          row.expected.stderrIncludes === "BLOCKED: Policy"),
      `unapproved message predicate: ${row.id}`,
    );
    assert.equal(
      row.predicates.requiresAvailable,
      !row.availabilityCase,
      `availability predicate: ${row.id}`,
    );
  }
  // Count each policy and suite separately, so extra rows for one policy cannot hide rows deleted from the other.
  for (const policy of policyNames) {
    for (const mode of ["smoke", "full"]) {
      const count = corpus.rows.filter(
        (row) =>
          row.policy === policy &&
          row.origin.kind === "self-test" &&
          row.membership.includes(mode),
      ).length;
      assert.equal(
        count,
        selfTestRowCounts[policy][mode],
        `missing original ${policy}/${mode} rows`,
      );
    }
  }
  return { cases: corpus.caseCount, policies: policyNames.length };
}

/**
 * Read the maintainer's command-line options, so a typo stops the run instead of silently checking less.
 * `--require-complete` refuses case filters and report mode, so a partial run can never be mistaken for full acceptance.
 *
 * @param args - command-line arguments after the script name; with no `--stage` the check runs `installed`, the hooks consumers get
 * @returns the stage, selected case IDs and mode flags; an empty `cases` list means every corpus row
 * @throws when an argument or stage is unknown, or `--require-complete` is combined with `--case` or `--list-divergent`
 */
export function parseOptions(args) {
  const options = {
    stage: "installed",
    cases: [],
    requireComplete: false,
    listDivergent: false,
  };
  // Each argument maps to one option; for example a mistyped `--stages=candidate` stops with "unknown argument".
  for (const argument of args) {
    // `--stage=installed` or `--stage=candidate` picks which hook copy runs.
    if (argument.startsWith("--stage=")) options.stage = argument.slice(8);
    // `--case=<row id>` reruns only the named rows while a maintainer is debugging one failure.
    else if (argument.startsWith("--case="))
      options.cases.push(argument.slice(7));
    // `--require-complete` is what CI passes: every row, no filters, no report mode.
    else if (argument === "--require-complete") options.requireComplete = true;
    // `--list-divergent` prints every difference as JSON and still exits 0; without it, differences fail the run and name the first five.
    else if (argument === "--list-divergent") options.listDivergent = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  assert(stages.includes(options.stage), `known stage: ${options.stage}`);
  assert(
    !(options.requireComplete && options.cases.length),
    "complete acceptance rejects case filters",
  );
  assert(
    !(options.requireComplete && options.listDivergent),
    "divergence report is not acceptance",
  );
  return options;
}

/**
 * Require the installed corpus copy to match the shipped one byte for byte, so a stale `.goat-flow/hooks/` copy cannot pass.
 *
 * @param canonical - the shipped corpus bytes from `workflow/hooks/`, whitespace included
 * @param installed - the installed copy's bytes; an empty file never matches a non-empty shipped corpus
 * @returns nothing; a non-buffer argument or any byte difference throws
 */
export function assertMirrorBytes(canonical, installed) {
  assert(
    Buffer.isBuffer(canonical) && Buffer.isBuffer(installed),
    "mirror bytes required",
  );
  assert(canonical.equals(installed), "corpus mirror bytes");
}

/**
 * Load the shipped corpus, validate it, and confirm the installed copy matches; every stage starts here.
 *
 * @returns the validated corpus; a missing file, an invalid row or a stale installed copy throws before any hook runs
 */
export function loadCorpus() {
  const canonical = readFileSync(
    join(repositoryRoot, "workflow/hooks/deny-dangerous/corpus.json"),
  );
  const corpus = JSON.parse(canonical.toString("utf8"));
  validateCorpus(corpus);
  assertMirrorBytes(
    canonical,
    readFileSync(
      join(repositoryRoot, ".goat-flow/hooks/deny-dangerous/corpus.json"),
    ),
  );
  return corpus;
}

/**
 * Ask npm what a publish would include, so the shipped corpus is in the package and test fixtures are not.
 * Runs `npm pack --dry-run` without lifecycle scripts, which reads the real package rules rather than the manifest's intent.
 *
 * @returns how many files the package would contain, after the corpus-included and fixtures-excluded checks pass
 */
export function checkPackInventory() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    command,
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, `npm pack inventory: ${result.stderr}`);
  const packedPaths = JSON.parse(result.stdout)[0].files.map(
    (file) => file.path,
  );
  assert(
    packedPaths.includes("workflow/hooks/deny-dangerous/corpus.json"),
    "shipped corpus packed",
  );
  assert(
    !packedPaths.some((path) => path.startsWith("test/")),
    "test fixtures excluded from archive",
  );
  assert(
    !packedPaths.some((path) => path.startsWith("dist/hooks/")),
    "candidate output not shipped before cutover",
  );
  return packedPaths.length;
}

/**
 * Run the stage the maintainer asked for; any failure reports one `FAIL: hook parity:` line and leaves exit status 1.
 * The stage runner is imported here, at run time, because it imports this module's helpers too.
 *
 * @returns a promise that settles when the stage finishes; failures set `process.exitCode` instead of rejecting
 */
async function runCli() {
  try {
    const options = parseOptions(process.argv.slice(2));
    const { compareCandidate } =
      await import("./check-hook-parity-candidate.mjs");
    await compareCandidate(options);
  } catch (error) {
    // For example a mistyped `--case` ID, a corpus row whose decision changed, or a hook that denied a spawn ends here.
    console.error(`FAIL: hook parity: ${error.message}`);
    process.exitCode = 1;
  }
}

// Tests import this file for its helpers; only `node scripts/check-hook-parity.mjs ...` should start a parity run.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runCli();
}
