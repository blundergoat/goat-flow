#!/usr/bin/env node
/**
 * Check hook-policy parity against frozen Bash evidence before a maintainer accepts a runtime change.
 *
 * Re-run original assertions in disposable projects and compare their inputs, outputs, and exit status with saved evidence.
 * Report mode records completed differences for investigation; it never approves them as new expectations.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  bashPath,
  spawnReferenceCommand,
  replayFrozenRow,
} from "./hook-parity-reference-command.mjs";

export { bashPath };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "test/fixtures/hooks-bash");
const policies = ["deny-dangerous", "deny-git-mutations"];
/**
 * Hash fixture or corpus bytes so parity checks can detect changes independently of Git object identity.
 *
 * @param bytes - fixture or corpus content; empty content still has a stable hash
 * @returns SHA-256 identity for these exact bytes; never empty
 */
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Verify every frozen dependency before a maintainer runs policy comparisons.
 * Reads fixture files and runs Git; throws on missing files, changed bytes, or an incomplete dependency inventory.
 *
 * @param base - frozen fixture directory; omitted uses the repository's checked-in reference
 * @returns validated snapshot metadata; missing files or changed identities throw
 */
export function validateSnapshot(base = fixture) {
  const snapshot = JSON.parse(
    readFileSync(join(base, "snapshot.json"), "utf8"),
  );
  assert.equal(snapshot.schemaVersion, 1, "snapshot schema");
  assert.match(snapshot.freezeCommit, /^[a-f0-9]{40}$/, "freeze commit");
  assert.equal(
    snapshot.files.length,
    43,
    "complete frozen dependency inventory",
  );
  assert.equal(new Set(snapshot.files.map((file) => file.path)).size, 43);
  // Check every dependency before a replay can claim a trustworthy hook decision.
  for (const file of snapshot.files) {
    assert(
      !file.path.startsWith("/") && !file.path.split(/[\\/]/).includes(".."),
    );
    const bytes = readFileSync(join(base, file.path));
    assert.equal(bytes.length, file.bytes, `frozen length: ${file.path}`);
    assert.equal(digest(bytes), file.sha256, `frozen hash: ${file.path}`);
    // Git verifies its historical object identity; SHA-256 above checks integrity.
    const descriptor = openSync(join(base, file.path), "r");
    const started = Date.now();
    try {
      // A regular file gives Git EOF; its identity must still match the snapshot.
      const gitBlob = spawnSync("git", ["hash-object", "--stdin"], {
        stdio: [descriptor, "pipe", "pipe"],
        encoding: "utf8",
        cwd: root,
        timeout: 30_000,
        killSignal: "SIGKILL",
      });
      assert.ifError(gitBlob.error);
      assert.equal(gitBlob.status, 0, "Git blob identity calculation");
      assert.equal(gitBlob.stdout.trim(), file.gitBlob, "frozen Git blob");
    } catch (error) {
      // A missing Git executable or changed fixture bytes aborts this check with the affected file and elapsed time.
      throw new Error(
        `Frozen Git blob failed: file=${file.path}; elapsedMs=${Date.now() - started}: ${error.message}`,
        { cause: error },
      );
    } finally {
      closeSync(descriptor);
    }
  }
  // Both reference trees need their own frozen parser dependencies before comparisons can start.
  for (const prefix of ["workflow/hooks/", ".goat-flow/hooks/"]) {
    assert(
      snapshot.files.some(
        (file) => file.path === `${prefix}vendor/graphql.cjs`,
      ),
    );
    assert(
      snapshot.files.some(
        (file) => file.path === `${prefix}vendor/js-yaml.cjs`,
      ),
    );
  }
  return snapshot;
}

/**
 * Create a disposable project from verified frozen files so comparisons cannot read the maintainer's live hook source.
 * Writes files and permissions in a temporary directory; the caller removes that directory after use.
 *
 * @param base - frozen fixture directory; omitted uses the checked-in reference
 * @returns new temporary project path; the caller removes it after comparison
 */
export function materializeReference(base = fixture) {
  const snapshot = validateSnapshot(base);
  const project = mkdtempSync(join(tmpdir(), "goat-hook-reference-"));
  // Copy verified files into the disposable project so comparisons cannot borrow live source.
  for (const file of snapshot.files) {
    const destination = join(project, file.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(join(base, file.path)), {
      flag: "wx",
    });
    chmodSync(destination, Number.parseInt(file.gitMode.slice(-3), 8));
  }
  return project;
}

/**
 * Prepare the reference environment so the maintainer's shell settings cannot select a different project or parser.
 * An optional jq path is version-checked and copied into the disposable project; absent means use the inherited PATH.
 *
 * @param project - disposable reference project whose parser may be prepared
 * @param locale - supported frozen locale, C or C.UTF-8
 * @param jqBin - optional jq 1.6 executable; absent leaves parser lookup on the inherited PATH
 *
 * @returns environment map for the reference process; project-root overrides are removed
 */
export function referenceEnvironment(
  project,
  locale,
  jqBin = process.env.GOAT_FLOW_JQ16_BIN,
) {
  assert(["C", "C.UTF-8"].includes(locale), "explicit supported locale");
  const env = {
    ...process.env,
    LC_ALL: locale,
    LANG: locale,
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  // Windows treats Path and PATH as one variable; a spread object does not.
  // Keep one spelling before prepending jq so Bash remains discoverable.
  if (process.platform === "win32") {
    // Collapse duplicate PATH spellings before adding the parser selected for this comparison.
    for (const key of Object.keys(env)) {
      // Native Windows processes treat these spellings as one setting, so retain a single key.
      if (key.toUpperCase() === "PATH" && key !== "PATH") {
        env.PATH = env[key];
        Reflect.deleteProperty(env, key);
      }
    }
  }
  // Clear inherited project overrides so the replay stays inside its disposable reference tree.
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GOAT_FLOW_ROOT",
    "GOAT_HOOK_LIB_DIR",
  ])
    Reflect.deleteProperty(env, key);
  // An explicit jq path selects the exact parser version used to freeze the evidence.
  if (jqBin) {
    const version = spawnSync(jqBin, ["--version"], { encoding: "utf8" });
    assert.equal(version.status, 0, "pinned jq starts");
    assert.equal(version.stdout.trim(), "jq-1.6", "pinned jq version");
    const bin = join(project, "reference-bin");
    mkdirSync(bin, { recursive: true });
    const destination = join(
      bin,
      process.platform === "win32" ? "jq.exe" : "jq",
    );
    // Reuse the parser already copied for this disposable project instead of overwriting it on each replay.
    if (!existsSync(destination))
      cpSync(jqBin, destination, { errorOnExist: true });
    chmodSync(destination, 0o755);
    env.PATH = `${bin}${process.platform === "win32" ? ";" : ":"}${env.PATH}`;
  }
  return env;
}

/**
 * Run the frozen policy on inert command text or provider input without executing the proposed user action.
 * Use for replay comparisons; throws on process startup failure, timeout, or incomplete output.
 *
 * @param project - disposable reference project used for hook lookup
 * @param policy - registered policy whose saved decision is being replayed
 * @param input - inert command text or provider bytes; no command field selects the stdin route
 *
 * @param locale - frozen locale to replay; omitted uses C
 * @param env - fixture environment overrides; empty means use only the prepared reference environment
 * @param id - optional case identity for errors; absent uses a hash of the input
 *
 * @param options - timeout in milliseconds or timeout/cwd overrides; omitted uses the project cwd and 30 seconds
 * @returns completed exit status and encoded output; no result is accepted when startup or completion fails
 */
export function runFrozen(
  project,
  policy,
  input,
  locale = "C",
  env = {},
  id,
  options = 30_000,
) {
  const { timeoutMs = 30_000, cwd = project } =
    typeof options === "number" ? { timeoutMs: options } : options;
  assert(policies.includes(policy), "known policy");
  const command = join(project, ".goat-flow/hooks", `${policy}.sh`);
  // Without command text, the hook reads provider input from stdin instead of the explicit check route.
  const args = input.command === undefined ? [] : [`--check=${input.command}`];
  const started = Date.now();
  const result = spawnReferenceCommand("bash", [bashPath(command), ...args], {
    cwd,
    env: { ...referenceEnvironment(project, locale), ...env },
    input: input.payloadBase64
      ? Buffer.from(input.payloadBase64, "base64")
      : undefined,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  // A missing Bash executable or replay timeout produces no decision that a maintainer can accept.
  if (result.error || result.status === null)
    throw new Error(
      `Frozen launch failed: case=${id ?? digest(JSON.stringify(input))}; policy=${policy}; locale=${locale}; elapsedMs=${Date.now() - started}: ${result.error?.message ?? "reference process incomplete"}`,
      { cause: result.error },
    );
  return {
    status: result.status,
    stdoutBase64: result.stdout.toString("base64"),
    stderrBase64: result.stderr.toString("base64"),
  };
}

/**
 * Replay a saved case with its fixture setup and pinned environment when a maintainer compares supplemental evidence.
 *
 * @param project - disposable frozen project used to restore the saved case setup
 * @param row - saved input, working directory, fixture files, and environment
 * @param locale - saved locale to replay; omitted uses C
 *
 * @returns completed frozen outcome; startup failures throw instead of becoming policy evidence
 */
export const runFrozenRow = (project, row, locale = "C") =>
  replayFrozenRow(project, row, locale, referenceEnvironment, runFrozen);

/**
 * Build the observer program used while extracting evidence from a disposable Bash self-test.
 * Forward each subprocess's output and exit status so the original assertions still decide whether that run succeeds.
 *
 * @returns Node observer source; extraction writes it into a disposable work directory
 */
function captureProgram() {
  return (
    String.raw`
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
` +
    bashPath.toString() +
    "\n" +
    spawnReferenceCommand.toString() +
    String.raw`
const [journal, sequence, helper, label, cwd, ...tail] = process.argv.slice(2);
const split = tail.indexOf('--');
const fixturePaths = tail.slice(0, split).filter(Boolean);
const [executable, ...args] = tail.slice(split + 1);
const native = (s) => {
  if (process.platform !== 'win32' || !s.startsWith('/')) return s;
  const converted = spawnSync('cygpath', ['-w', s], {encoding:'utf8'});
  if (converted.status !== 0) throw new Error('cannot convert owned MSYS path');
  return converted.stdout.trim();
};
const base = native(process.env.GOAT_PARITY_PROJECT);
const replacements = [[base, '$REFERENCE']];
const setup = [];
for (const raw of [...new Set(fixturePaths)]) {
  const path = native(raw);
  if (!existsSync(path) || path === '/dev/null' || path === 'NUL') continue;
  const rel = relative(tmpdir(), path);
  if (rel.startsWith('..') || isAbsolute(rel) || path.startsWith(base)) continue;
  const token = '$FIXTURE' + setup.length;
  replacements.push([path, token]);
  const files = [];
  const visit = (p, name) => {
    const stat = lstatSync(p);
    if (stat.isSymbolicLink()) { files.push({path:name, kind:'symlink'}); return; }
    if (stat.isDirectory()) {
      if (name.includes('.git/objects') || name.includes('.git/logs')) return;
      files.push({path:name, kind:'directory'});
      for (const child of readdirSync(p).sort()) visit(join(p,child), name ? name + '/' + child : child);
    } else if (stat.isFile()) {
      const runtime = name.includes('/hooks/') || name.startsWith('hooks/');
      files.push(runtime ? {path:name, kind:'frozen-runtime'} : {path:name, kind:'file', bytesBase64:readFileSync(p).toString('base64')});
    }
  };
  visit(path, ''); setup.push({token, files});
}
if (!replacements.some(([path]) => native(cwd).startsWith(path))) replacements.push([native(cwd), '$CWD']);
for (const [path, token] of [...replacements]) {
  if (process.platform === 'win32') {
    const posix = spawnSync('cygpath', ['-u', path], {encoding:'utf8'});
    if (posix.status !== 0) throw new Error('cannot normalize owned MSYS path');
    replacements.push([posix.stdout.trim(), token], [path.replaceAll('\\','/'), token]);
  }
}
replacements.sort((a,b) => b[0].length-a[0].length);
const normalize = (s) => replacements.reduce((v,[from,to]) => v.split(from).join(to), s);
const explicit = args.some(a => a.startsWith('--check') || a.startsWith('--self-test'));
const input = explicit ? null : readFileSync(0);
const policyEnvironment = {...process.env};
if (process.platform === 'win32') {
  // The observer disables conversion only for its incoming argv. Restore the
  // original setting before frozen Bash launches its own native dependencies.
  policyEnvironment.MSYS2_ARG_CONV_EXCL = process.env.GOAT_PARITY_ORIGINAL_ARG_CONV ?? '';
  delete policyEnvironment.GOAT_PARITY_ORIGINAL_ARG_CONV;
}
const result = spawnReferenceCommand(executable, args, {cwd:native(cwd), env:policyEnvironment,
  ...(explicit ? {stdio:['inherit','pipe','pipe']} : {input}), maxBuffer:8*1024*1024});
if (result.error || result.status === null) throw result.error || new Error('reference did not finish');
const environment = {};
for (const key of ['GIT_CONFIG_GLOBAL','GIT_CONFIG_NOSYSTEM','GIT_DIR','GIT_WORK_TREE','GOAT_DENY_FORCE_NO_JQ'])
  if (process.env[key] !== undefined) environment[key] = normalize(process.env[key]);
const row = {sequence:Number(sequence), helper, label, executable,
  args:args.map(normalize), cwd:normalize(native(cwd)), setup, environment,
  payloadBase64:input === null ? null : input.toString('base64'), status:result.status,
  stdoutBase64:Buffer.from(normalize(result.stdout.toString())).toString('base64'),
  stderrBase64:Buffer.from(normalize(result.stderr.toString())).toString('base64')};
appendFileSync(native(journal), JSON.stringify(row)+'\n');
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exit(result.status);
`
  );
}

/**
 * Build an instrumented self-test and write its observer into the caller's temporary work directory.
 * Use during evidence extraction; preserve original assertions and leave restoration of the disposable self-test to the caller.
 *
 * @param source - original Bash self-test text; empty or missing execution markers fail validation
 * @param work - existing disposable directory where the observer file is written
 * @returns instrumented text and observer path; the original assertions remain byte-identical
 */
export function instrumentSelfTest(source, work) {
  const capture = join(work, "capture.mjs");
  writeFileSync(capture, captureProgram(), { flag: "wx" });
  const observeNode =
    process.platform === "win32"
      ? "MSYS2_ARG_CONV_EXCL='*' command node"
      : "command node";
  const injected = [
    "",
    "goat_parity_case() {",
    '  printf \'{"sequence":%d,"helper":"%s"}\\n\' "$executed" "${FUNCNAME[1]}" >> "$GOAT_PARITY_BEGINS"',
    "}",
    "bash() {",
    '  case "${1:-}" in',
    "    */deny-dangerous.sh|*/deny-git-mutations.sh)",
    "      " +
      observeNode +
      ' "$GOAT_PARITY_CAPTURE" "$GOAT_PARITY_JOURNAL" "$executed" "${FUNCNAME[1]}" "${label:-}" "$PWD" \\',
    '        "${GIT_CONFIG_GLOBAL:-}" "${fixture_root:-}" "${alias_project_root:-}" "${saved_alias_config:-}" \\',
    '        "${tmp:-}" "${project:-}" "${outside:-}" "${main:-}" "${worktree:-}" -- bash "$@" ;;',
    '    *) command bash "$@" ;;',
    "  esac",
    "}",
    "timeout() {",
    '  if [[ "${2:-}" == bash && "${3:-}" == */deny-*.sh ]]; then',
    "    " +
      observeNode +
      ' "$GOAT_PARITY_CAPTURE" "$GOAT_PARITY_JOURNAL" "$executed" "${FUNCNAME[1]}" "${label:-}" "$PWD" \\',
    '      "${tmp:-}" -- timeout "$@"',
    "  else",
    '    command timeout "$@"',
    "  fi",
    "}",
    "",
  ].join("\n");
  const marker = 'case "$SELF_TEST_MODE" in\n';
  assert.equal(
    source.split(marker).length,
    2,
    "unique self-test execution boundary",
  );
  const increment = "executed=$((executed + 1))";
  const instrumented = source
    .replaceAll(increment, `${increment}; goat_parity_case`)
    .replace(marker, `${injected}\n${marker}`);
  assert.equal(
    instrumented
      .replace(`${injected}\n${marker}`, marker)
      .replaceAll(`${increment}; goat_parity_case`, increment),
    source,
    "instrumentation leaves original assertions byte-identical",
  );
  return { instrumented, capture };
}

/**
 * Run original assertions and reconcile captured subprocesses with their executed/skipped totals.
 *
 * Temporarily rewrites the disposable self-test, then restores it; successful runs remove the temporary journal.
 * Only report mode retains completed failures as evidence; acceptance failures and incomplete runs throw.
 *
 * @param project - disposable project whose Bash self-test is temporarily rewritten
 * @param locale - pinned locale used for every original subprocess
 * @param mode - original smoke or full suite to run
 *
 * @param policy - hook whose assertions and skip counts are being measured
 * @param allowAssertionFailures - true only for reports; false makes failed original assertions stop acceptance
 * @returns assertion totals and captures; a null diagnosticsDirectory means no failed-assertion journal was retained
 */
export function extractSelfTests(
  project,
  locale,
  mode,
  policy,
  allowAssertionFailures = false,
) {
  const work = mkdtempSync(join(tmpdir(), "goat-hook-extract-"));
  const sourcePath = join(
    project,
    "workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
  );
  const source = readFileSync(sourcePath, "utf8");
  const { instrumented, capture } = instrumentSelfTest(source, work);
  // Only this disposable copy changes; fixture originals stay hash-bound.
  writeFileSync(sourcePath, instrumented);
  const journal = join(work, "rows.jsonl");
  const begins = join(work, "begins.jsonl");
  writeFileSync(journal, "");
  writeFileSync(begins, "");
  const env = {
    ...referenceEnvironment(project, locale),
    GOAT_DENY_DANGEROUS_HOOK: bashPath(
      join(project, "workflow/hooks", `${policy}.sh`),
    ),
    // Native Node consumes this path; the observer call disables MSYS conversion.
    GOAT_PARITY_CAPTURE: capture,
    GOAT_PARITY_ORIGINAL_ARG_CONV: process.env.MSYS2_ARG_CONV_EXCL ?? "",
    GOAT_PARITY_JOURNAL: bashPath(journal),
    GOAT_PARITY_BEGINS: bashPath(begins),
    GOAT_PARITY_PROJECT: bashPath(project),
  };
  const result = spawnSync(
    "bash",
    [bashPath(sourcePath), `--self-test=${mode}`, `--policy=${policy}`],
    {
      cwd: project,
      env,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      // The measured native observer reached its ten-minute cap before all
      // assertions finished. Keep a bounded twenty-minute Windows reference run.
      timeout: process.platform === "win32" ? 1_200_000 : 600_000,
    },
  );
  writeFileSync(sourcePath, source);
  assert.ifError(result.error);
  // Strict acceptance stops on failed assertions; report mode retains completed failures for diagnosis.
  if (!allowAssertionFailures)
    assert.equal(
      result.status,
      0,
      `original ${policy}/${mode}/${locale}: ${result.stdout}${result.stderr}`,
    );
  const summary = `${result.stdout}\n${result.stderr}`.match(
    /(?:PASS|FAIL): ([\w-]+) self-test \(mode=(\w+), executed=(\d+), skipped=(\d+)(?:, failed=(\d+))?\)/,
  );
  assert(
    summary && summary[1] === policy && summary[2] === mode,
    "original full result",
  );
  const failed = Number(summary[5] ?? 0);
  assert.equal(
    result.status,
    failed ? 1 : 0,
    "original assertion exit matches summary",
  );
  const records = readFileSync(journal, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  const assertions = readFileSync(begins, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  assert.equal(
    assertions.length,
    Number(summary[3]),
    "actual assertion count reconciles",
  );
  assert.equal(
    new Set(assertions.map((row) => row.sequence)).size,
    assertions.length,
  );
  // Every original assertion needs a captured subprocess before the extracted totals can be trusted.
  for (const row of assertions)
    assert(
      records.some((record) => record.sequence === row.sequence),
      `uncaptured assertion ${row.sequence}/${row.helper}`,
    );
  assert(
    records.every((row) =>
      assertions.some((item) => item.sequence === row.sequence),
    ),
    "no orphan capture",
  );
  // Retain failed-assertion journals for investigation; successful extraction needs no diagnostic files.
  if (!failed) rmSync(work, { recursive: true, force: true });
  return {
    policy,
    mode,
    locale,
    executed: Number(summary[3]),
    skipped: Number(summary[4]),
    failed,
    diagnosticsDirectory: failed ? work : null,
    records,
  };
}

/**
 * Turn captured assertions into stable cases for comparison across smoke/full runs and locales.
 * Preserve each locale's actual input because Bash can decode the same Unicode escape differently.
 *
 * @param report - extracted original assertions; empty records produce no comparison cases
 * @returns case rows with stable IDs and the exact measured inputs and outcomes
 */
export function caseRows(report) {
  const occurrences = new Map();
  return report.records.map((record) => {
    const hook = record.args.findIndex((arg) =>
      /\/deny-(?:dangerous|git-mutations)\.sh$/.test(arg),
    );
    assert(hook >= 0, "captured policy entrypoint");
    const args = record.args.slice(hook + 1);
    const check = args.find((arg) => arg.startsWith("--check="));
    const selfTest = args.find((arg) => arg.startsWith("--self-test"));
    // Without an explicit check or self-test argument, this capture represents the provider payload route.
    const input =
      check !== undefined
        ? { kind: "check", command: check.slice("--check=".length) }
        : selfTest !== undefined
          ? { kind: "self-test", mode: selfTest.split("=")[1] ?? "full" }
          : { kind: "provider", payloadBase64: record.payloadBase64 };
    const identity = digest(
      JSON.stringify({ helper: record.helper, label: record.label }),
    ).slice(0, 16);
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    const availabilityCase = [
      "expect_missing_common_fails_closed",
      "expect_missing_common_self_test_does_not_read_stdin",
      "expect_missing_common_fails_closed_json",
      "expect_script_path_fallback_missing_policy_fails_closed",
    ].includes(record.helper);
    return {
      id: `selftest-${report.policy}-${identity}-${occurrence}`,
      policy: report.policy,
      membership: [report.mode],
      origin: { kind: "self-test", helper: record.helper, label: record.label },
      input,
      inputSha256: digest(JSON.stringify(input)),
      setup: {
        cwd: record.cwd,
        files: record.setup,
        environment: record.environment,
      },
      availabilityCase,
      original: {
        status: record.status,
        stdoutBase64: record.stdoutBase64,
        stderrBase64: record.stderrBase64,
      },
    };
  });
}

/**
 * Build candidate and reference inventories from measured reports without changing the frozen evidence.
 * Supply C reports first to establish candidate expectations; retain every locale's actual input and outcome independently.
 *
 * @param reports - measured self-test reports, with C first to establish candidate expectations
 * @param extras - supplemental cases; empty adds no cases beyond the original assertions
 * @param snapshot - frozen reference metadata and original execution counts
 *
 * @param historicalSha256 - identity of the historical input evidence bound to this reference
 * @returns separate candidate and frozen-reference inventories; each locale retains its own evidence
 */
export function buildCorpora(reports, extras, snapshot, historicalSha256) {
  const byId = new Map();
  // Merge measured runs without allowing one locale to replace another locale's evidence.
  for (const report of reports) {
    // Match the same assertion across smoke/full reports before accumulating its evidence.
    for (const row of caseRows(report)) {
      let saved = byId.get(row.id);
      // The first observation establishes this case; later runs must agree with its saved input and outcome.
      if (!saved) {
        saved = {
          ...row,
          original: {},
          inputs: {},
          expected: row.original,
          exceptionId: null,
        };
        byId.set(row.id, saved);
      }
      // Repeated locales must use the same input even when smoke and full runs share an assertion.
      if (saved.inputs[report.locale])
        assert.deepEqual(
          saved.inputs[report.locale],
          row.input,
          `smoke/full input drift: ${row.id}`,
        );
      // Record each suite once so the final inventory accounts for both smoke and full coverage.
      if (!saved.membership.includes(report.mode))
        saved.membership.push(report.mode);
      // Repeated observations must not silently change the decision or message a user would receive.
      if (saved.original[report.locale])
        assert.deepEqual(
          saved.original[report.locale],
          row.original,
          `smoke/full drift: ${row.id}`,
        );
      saved.original[report.locale] = row.original;
      saved.inputs[report.locale] = row.input;
    }
  }
  // Supplemental evidence needs new IDs so it cannot replace an original assertion.
  for (const row of extras) {
    assert(!byId.has(row.id), `duplicate extra: ${row.id}`);
    byId.set(row.id, row);
  }
  const rows = [...byId.values()].sort((a, b) =>
    a.id.localeCompare(b.id, "en"),
  );
  const common = {
    schemaVersion: 1,
    freezeCommit: snapshot.freezeCommit,
    caseCount: rows.length,
  };
  const corpus = {
    ...common,
    rows: rows.map((row) => {
      const candidate = { ...row };
      delete candidate.original;
      delete candidate.inputs;
      return candidate;
    }),
  };
  const reference = {
    ...common,
    snapshotSha256: digest(readFileSync(join(fixture, "snapshot.json"))),
    historicalSha256,
    executionCounts: snapshot.generatedRowCounts,
    host: {
      name: /microsoft/i.test(release()) ? "WSL2" : process.platform,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    rows: rows.map(
      ({
        id,
        policy,
        inputSha256,
        input,
        inputs,
        original,
        expected,
        exceptionId,
      }) => ({
        id,
        policy,
        inputSha256,
        inputs: inputs ?? { C: input, "C.UTF-8": input },
        original,
        expected,
        exceptionId,
      }),
    ),
  };
  return { corpus, reference };
}

/**
 * Compare a completed policy result with the saved decision and user-visible messages.
 * Missing runtime is acceptable only for named dependency fixtures; ordinary cases must prove that a hook actually ran.
 *
 * @param actual - completed process outcome; null or missing status cannot prove a hook decision
 * @param expected - saved decision and output, or an approved denial-message predicate
 * @param requiresAvailable - false only for fixtures that deliberately omit the runtime
 *
 * @param id - case identity included in mismatch diagnostics; omitted uses a generic case label
 * @returns no value; a decision or message mismatch throws before acceptance
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
  // Ordinary allow/block comparisons cannot pass merely because both hook launches were unavailable.
  if (requiresAvailable)
    assert(
      !`${stdout}${stderr}`.includes("Policy hook unavailable"),
      `unavailable: ${id}`,
    );
  assert.equal(actual.status, expected.status, `exit drift: ${id}`);
  // Approved message predicates require a denial message without expecting a provider JSON envelope.
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
  // Provider JSON compares by field values; plain-text responses retain their exact saved bytes.
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
 * Check inventory identity and case counts before a maintainer trusts any saved policy comparisons.
 *
 * @param artifact - saved corpus/reference inventory with declared IDs and case count
 * @param snapshot - frozen identity the inventory must retain
 * @returns no value; a mismatched identity, count, or duplicate case ID throws
 */
function validateCorpusHeader(artifact, snapshot) {
  assert.equal(artifact.schemaVersion, 1, "corpus schema");
  assert.equal(artifact.freezeCommit, snapshot.freezeCommit, "freeze identity");
  assert.equal(
    artifact.caseCount,
    artifact.rows.length,
    "declared complete coverage",
  );
  assert.equal(
    new Set(artifact.rows.map((row) => row.id)).size,
    artifact.rows.length,
    "duplicate case identity",
  );
}

/**
 * Check whether a saved difference has an approved evidence category before accepting its expectation.
 * Startup exceptions belong only to cases that intentionally omit the runtime; an absent exception means no deviation is claimed.
 *
 * @param row - case with an optional exception ID; absent means no expectation difference is claimed
 * @returns true for an approved category; false prevents an unknown difference from being accepted
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
 * Validate that candidate expectations still refer to the complete, unchanged frozen evidence.
 * Use before replay; reject missing identities, changed inputs, and differences without an approved exception.
 *
 * @param corpus - candidate case inventory and expected decisions
 * @param reference - independent saved inputs and original outcomes
 * @param snapshot - frozen metadata; omitted revalidates the checked-in snapshot
 *
 * @returns validated case and policy totals; incomplete or unapproved evidence throws
 */
export function validateCorpora(
  corpus,
  reference,
  snapshot = validateSnapshot(),
) {
  validateCorpusHeader(corpus, snapshot);
  validateCorpusHeader(reference, snapshot);
  assert.equal(
    corpus.caseCount,
    reference.caseCount,
    "orphaned reference/candidate IDs",
  );
  const originals = new Map(reference.rows.map((row) => [row.id, row]));
  // Bind every candidate decision to independent saved evidence before allowing replay acceptance.
  for (const row of corpus.rows) {
    assert(policies.includes(row.policy), `unknown policy: ${row.id}`);
    assert(
      row.membership.length &&
        row.membership.every((mode) => ["smoke", "full"].includes(mode)),
    );
    assert.equal(
      row.inputSha256,
      digest(JSON.stringify(row.input)),
      `input drift: ${row.id}`,
    );
    const original = originals.get(row.id);
    assert(original, `orphaned candidate ID: ${row.id}`);
    // Ownership and input identity must agree even when an approved exception changes the expected decision.
    for (const [field, label] of Object.entries({
      inputSha256: "reference input drift",
      policy: "policy ownership",
      exceptionId: "exception identity",
    }))
      assert.equal(original[field], row[field], `${label}: ${row.id}`);
    assert.deepEqual(
      original.inputs.C,
      row.input,
      `C candidate input binding: ${row.id}`,
    );
    assert.deepEqual(
      original.expected,
      row.expected,
      `candidate expectation drift: ${row.id}`,
    );
    assert(isApprovedException(row), `unknown exception: ${row.id}`);
    assert(
      !row.expected.stderrIncludes ||
        (/^(?:historical|review)-gap-/.test(row.exceptionId ?? "") &&
          row.expected.status === 2 &&
          row.expected.stderrIncludes === "BLOCKED: Policy"),
      `unapproved message predicate: ${row.id}`,
    );
    // Both pinned locales need a saved result; a missing locale would hide host-dependent behavior.
    for (const locale of ["C", "C.UTF-8"]) {
      assert(original.original[locale], `missing pinned locale: ${row.id}`);
      assertOutcome(
        original.original[locale],
        original.original[locale],
        !row.availabilityCase,
        row.id,
      );
    }
    const differs =
      JSON.stringify(original.original.C) !== JSON.stringify(row.expected);
    assert(
      !differs || row.exceptionId,
      `unapproved expectation difference: ${row.id}`,
    );
    assert.equal(
      row.predicates.requiresAvailable,
      !row.availabilityCase,
      `availability predicate: ${row.id}`,
    );
  }
  // Coverage from one policy cannot hide missing original assertions in the other policy.
  for (const policy of policies) {
    // Both suite sizes must match their frozen original counts before the inventory is trusted.
    for (const mode of ["smoke", "full"]) {
      const count = corpus.rows.filter(
        (row) =>
          row.policy === policy &&
          row.origin.kind === "self-test" &&
          row.membership.includes(mode),
      ).length;
      assert.equal(
        count,
        snapshot.generatedRowCounts.C[policy][mode].executed,
        `missing original ${policy}/${mode} rows`,
      );
    }
  }
  const differences = reference.rows
    .filter((row) => row.exceptionId)
    .map(({ id, exceptionId, original, expected }) => ({
      id,
      exceptionId,
      original,
      expected,
    }));
  assert.deepEqual(
    reference.approvedDifferences,
    differences,
    "complete named exception inventory",
  );
  return { cases: corpus.caseCount, policies: policies.length };
}

/**
 * Read the maintainer's parity-check options and reject unknown arguments or unsupported stages.
 * Complete acceptance rejects case filters and report-only mode so a partial run cannot claim full coverage.
 *
 * @param args - CLI arguments; empty selects unfiltered reference extraction
 * @returns validated stage, selected case IDs, and mode flags; empty cases means the full corpus
 * @throws when an option or stage is unknown, or complete acceptance is combined with a filter or report mode
 */
export function parseOptions(args) {
  const options = {
    stage: "extraction",
    cases: [],
    requireComplete: false,
    listDivergent: false,
  };
  // An unrecognized option must not silently alter the scope of the maintainer's acceptance check.
  for (const arg of args) {
    // The selected stage chooses reference extraction or a runtime comparison.
    if (arg.startsWith("--stage=")) options.stage = arg.slice(8);
    // Case filters narrow a development run and are forbidden for complete acceptance below.
    else if (arg.startsWith("--case=")) options.cases.push(arg.slice(7));
    // Complete mode requires every case and rejects report-only execution.
    else if (arg === "--require-complete") options.requireComplete = true;
    // Report mode collects completed host differences for diagnosis rather than approving them.
    else if (arg === "--list-divergent") options.listDivergent = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  assert(
    ["extraction", "candidate", "installed"].includes(options.stage),
    "known stage",
  );
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
 * Load and validate the shipped corpus and independent frozen reference before any maintainer comparison.
 * Bind their hashes and installed mirror bytes so regenerating candidate expectations cannot silently rewrite the reference.
 *
 * @returns validated snapshot, corpus, and reference; missing or changed artifacts throw
 */
export function loadArtifacts() {
  const snapshot = validateSnapshot();
  const corpus = JSON.parse(
    readFileSync(
      join(root, "workflow/hooks/deny-dangerous/corpus.json"),
      "utf8",
    ),
  );
  const reference = JSON.parse(
    readFileSync(join(fixture, "policy-reference.json"), "utf8"),
  );
  assert.equal(
    reference.snapshotSha256,
    digest(readFileSync(join(fixture, "snapshot.json"))),
    "snapshot binding",
  );
  assert.equal(
    reference.historicalSha256,
    digest(readFileSync(join(fixture, "historical-cases.json"))),
    "historical evidence binding",
  );
  validateCorpora(corpus, reference, snapshot);
  assertMirrorBytes(
    readFileSync(join(root, "workflow/hooks/deny-dangerous/corpus.json")),
    readFileSync(join(root, ".goat-flow/hooks/deny-dangerous/corpus.json")),
  );
  return { snapshot, corpus, reference };
}

/**
 * Reject any byte difference between the shipped and installed corpus so status cannot hide installed-file drift.
 *
 * @param canonical - shipped corpus bytes, including whitespace
 * @param installed - installed corpus bytes; empty differs from a non-empty shipped corpus
 * @returns no value when bytes match; non-buffer inputs or any byte difference throw
 */
export function assertMirrorBytes(canonical, installed) {
  assert(
    Buffer.isBuffer(canonical) && Buffer.isBuffer(installed),
    "mirror bytes required",
  );
  assert(canonical.equals(installed), "corpus mirror bytes");
}

/**
 * Run npm's archive dry run to verify what a maintainer would publish, independently of manifest declarations.
 * Spawns npm without lifecycle scripts; the archive must include the corpus and exclude test references and pre-cutover candidate output.
 *
 * @returns number of packed paths after the required inclusion and exclusion checks
 */
export function checkPackInventory() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    command,
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, `npm pack inventory: ${result.stderr}`);
  const paths = JSON.parse(result.stdout)[0].files.map((file) => file.path);
  assert(
    paths.includes("workflow/hooks/deny-dangerous/corpus.json"),
    "shipped corpus packed",
  );
  assert(
    !paths.some((path) => path.startsWith("test/")),
    "test reference excluded from archive",
  );
  assert(
    !paths.some((path) => path.startsWith("dist/hooks/")),
    "candidate output not shipped before cutover",
  );
  return paths.length;
}

/**
 * Compare captured original assertions with the selected frozen evidence during extraction.
 * Unknown identities always throw; report mode records completed input or outcome differences for maintainer investigation.
 *
 * @param report - freshly extracted original assertions and locale
 * @param comparison - saved outcomes, selected IDs, report mode, and collected differences
 * @param seen - IDs visited in this locale; empty means no cases have been visited yet
 *
 * @returns no value; selected completed cases update seen and report-mode differences
 * @throws on an unknown original case, or a completed mismatch outside report mode
 */
function compareOriginalRows(report, comparison, seen) {
  const { originals, selected, options, divergences } = comparison;
  // Compare each recaptured assertion with its saved identity and selected locale outcome.
  for (const row of caseRows(report)) {
    assert(originals.has(row.id), `unrecorded original ID: ${row.id}`);
    // A development case filter excludes other known assertions from this comparison.
    if (!selected.has(row.id)) continue;
    seen.add(row.id);
    const original = originals.get(row.id);
    try {
      assert.deepEqual(
        original.inputs[report.locale],
        row.input,
        `input drift: ${row.id}/${report.locale}`,
      );
      assertOutcome(
        row.original,
        original.original[report.locale],
        !row.availabilityCase,
        row.id,
      );
    } catch (error) {
      // A changed locale-decoded input or denial message is reportable only when the maintainer requested differences.
      if (!options.listDivergent) throw error;
      divergences.push({
        id: row.id,
        locale: report.locale,
        expected: original.original[report.locale],
        actual: row.original,
        expectedInput: original.inputs[report.locale],
        actualInput: row.input,
        message: error.message,
      });
    }
  }
}

/**
 * Compare supplemental frozen outcomes after a maintainer selects report mode or strict acceptance.
 * Record completed differences only in report mode; a launch failure cannot serve as comparison evidence.
 * @param project - isolated frozen project used for execution
 *
 * @param rows - supplemental inputs to compare; empty means there are no supplemental cases in this call
 * @param comparison - saved outcomes, selected IDs, mode and destination for reported differences
 * @param seen - completed IDs, updated after each comparison; an empty set means no cases have completed yet
 *
 * @param locale - pinned locale whose saved outcomes apply
 * @throws on launch failure, or any outcome difference in strict acceptance mode
 */
export function compareExtraRows(project, rows, comparison, seen, locale) {
  const { originals, selected, options, divergences } = comparison;
  // Compare selected supplemental cases after handling the original self-test assertions.
  for (const row of rows.filter(
    (row) => row.origin.kind !== "self-test" && selected.has(row.id),
  )) {
    // Launch outside the outcome catch: a missing cwd or failed process is not a completed policy difference.
    const actual = runFrozenRow(project, row, locale);
    try {
      // Sentinels expose the frozen parser's byte-versus-character limit in the selected locale.
      if (row.origin.kind === "locale-sentinel")
        assert.equal(
          actual.status,
          locale === "C" ? 2 : 0,
          "locale sentinel must distinguish byte and character limits",
        );
      assertOutcome(
        actual,
        originals.get(row.id).original[locale],
        true,
        row.id,
      );
    } catch (error) {
      // A sentinel that allows instead of blocking is recorded in report mode; strict acceptance still stops.
      if (!options.listDivergent) throw error;
      divergences.push({
        id: row.id,
        locale,
        expected: originals.get(row.id).original[locale],
        actual,
        message: error.message,
      });
    }
    seen.add(row.id);
  }
}

/**
 * Re-run original assertions and supplemental cases so the maintainer can check this host against frozen evidence.
 *
 * Creates and removes a disposable project; report mode keeps completed differences separate from strict acceptance.
 * Replay original assertions rather than trusting captured results; every selected ID must complete in each requested locale.
 *
 * @param options - validated stage, selected IDs, and report/acceptance mode
 * @param artifacts - validated saved evidence; omitted loads and verifies the checked-in files
 * @returns host details, compared case count, and differences; an empty differences list means none were observed
 */
export function compareExtraction(options, artifacts = loadArtifacts()) {
  assert.equal(
    options.stage,
    "extraction",
    `${options.stage} runtime unavailable; later milestone required`,
  );
  // Reject a mistyped case filter before running expensive original assertions.
  for (const id of options.cases)
    assert(
      artifacts.corpus.rows.some((row) => row.id === id),
      `unknown case: ${id}`,
    );
  // No case filters means compare the complete corpus rather than an empty selection.
  const selected = new Set(
    options.cases.length
      ? options.cases
      : artifacts.corpus.rows.map((row) => row.id),
  );
  // A supported pinned locale selects one comparison; otherwise exercise both frozen locales.
  const locales = ["C", "C.UTF-8"].includes(process.env.LC_ALL)
    ? [process.env.LC_ALL]
    : ["C", "C.UTF-8"];
  const project = materializeReference();
  const env = referenceEnvironment(project, "C");
  const bashVersion = spawnSync("bash", ["--version"], {
    env,
    encoding: "utf8",
  });
  const jqVersion = spawnSync("bash", ["-c", "jq --version"], {
    env,
    encoding: "utf8",
  });
  assert.equal(jqVersion.stdout.trim(), "jq-1.6", "reference requires jq 1.6");
  const host = {
    name: /microsoft/i.test(release()) ? "WSL2" : process.platform,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    bash: bashVersion.stdout.split("\n")[0],
    jq: jqVersion.stdout.trim(),
    locales,
  };
  console.log(`Reference host: ${JSON.stringify(host)}`);
  const originals = new Map(
    artifacts.reference.rows.map((row) => [row.id, row]),
  );
  const divergences = [];
  const selfTests = [];
  const comparison = { originals, selected, options, divergences };
  // Repeat the selected inventory in each requested locale to expose parser differences.
  for (const locale of locales) {
    const seen = new Set();
    // Each policy retains its own original assertion counts and skip accounting.
    for (const policy of policies) {
      // Run both suite modes; saved outcomes alone cannot verify the live reference transport.
      for (const mode of ["smoke", "full"]) {
        const report = extractSelfTests(
          project,
          locale,
          mode,
          policy,
          options.listDivergent,
        );
        selfTests.push({
          policy,
          mode,
          locale,
          executed: report.executed,
          skipped: report.skipped,
          failed: report.failed,
          diagnosticsDirectory: report.diagnosticsDirectory,
        });
        const expectedCount =
          artifacts.snapshot.generatedRowCounts[locale][policy][mode];
        assert.equal(report.executed, expectedCount.executed, "executed count");
        assert.equal(
          report.skipped,
          expectedCount.skipped,
          "cross-policy skip count",
        );
        compareOriginalRows(report, comparison, seen);
        console.log(
          `${report.failed ? "DIVERGENT" : "PASS"}: original ${policy}/${mode}/${locale} assertions=${report.executed} captured=${report.records.length} cross-policy-skips=${report.skipped} failed=${report.failed}`,
        );
      }
    }
    compareExtraRows(project, artifacts.corpus.rows, comparison, seen, locale);
    assert.deepEqual(
      [...seen].sort(),
      [...selected].sort(),
      `missing cases: ${locale}`,
    );
    console.log(`PASS: ${locale} complete policy inventory ${seen.size} IDs`);
  }
  rmSync(project, { recursive: true, force: true });
  // Include diagnostic evidence only when the maintainer requested a host-divergence report.
  if (options.listDivergent)
    console.log(JSON.stringify({ host, selfTests, divergences }, null, 2));
  console.log(
    `PASS: ${options.listDivergent ? "host divergence report" : "reference extraction"}; cases=${selected.size}; differences=${divergences.length}`,
  );
  return { host, cases: selected.size, divergences };
}

/**
 * Run the maintainer's selected parity stage; failures print on stderr and set exit status 1.
 * Defer the candidate import until this module loads because that runner imports these helpers too.
 *
 * @returns completion promise; failures print a diagnostic and set the CLI exit status to 1
 */
async function runCli() {
  try {
    const options = parseOptions(process.argv.slice(2));
    // Load the candidate runner only when the maintainer selected that stage.
    if (options.stage === "candidate") {
      const { compareCandidate } =
        await import("./check-hook-parity-candidate.mjs");
      await compareCandidate(options);
    } else compareExtraction(options);
  } catch (error) {
    // An unknown case or missing jq 1.6 makes this CLI invocation fail visibly for the maintainer.
    console.error(`FAIL: hook parity: ${error.message}`);
    process.exitCode = 1;
  }
}

// Importing helpers must not start a parity run; execute only when the maintainer invokes this file directly.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runCli();
}
