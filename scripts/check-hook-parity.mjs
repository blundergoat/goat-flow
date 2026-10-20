#!/usr/bin/env node
// Freeze policy assertions from the Bash reference and compare the Node candidate against them.
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
} from "./hook-parity-reference-command.mjs";

export { bashPath };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "test/fixtures/hooks-bash");
const policies = ["deny-dangerous", "deny-git-mutations"];
// Bind fixture and corpus bytes independently of Git's historical object IDs.
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

// Refuse incomplete or changed reference dependencies before any hook runs.
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
      throw new Error(
        `Frozen Git blob failed: file=${file.path}; elapsedMs=${Date.now() - started}: ${error.message}`,
        { cause: error },
      );
    } finally {
      closeSync(descriptor);
    }
  }
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

// Return an isolated, caller-owned project containing only hash-verified bytes.
export function materializeReference(base = fixture) {
  const snapshot = validateSnapshot(base);
  const project = mkdtempSync(join(tmpdir(), "goat-hook-reference-"));
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

// Pin the requested locale and clear root overrides. An explicit jq binary is
// version-checked and copied locally; acceptance also checks the resolved jq.
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
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === "PATH" && key !== "PATH") {
        env.PATH = env[key];
        Reflect.deleteProperty(env, key);
      }
    }
  }
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GOAT_FLOW_ROOT",
    "GOAT_HOOK_LIB_DIR",
  ])
    Reflect.deleteProperty(env, key);
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
    if (!existsSync(destination))
      cpSync(jqBin, destination, { errorOnExist: true });
    chmodSync(destination, 0o755);
    env.PATH = `${bin}${process.platform === "win32" ? ";" : ":"}${env.PATH}`;
  }
  return env;
}

// Classify inert check text or raw provider bytes; proposed commands never run.
// Process startup, timeout and incomplete output fail extraction visibly.
export function runFrozen(
  project,
  policy,
  input,
  locale = "C",
  env = {},
  id,
  timeoutMs = 30_000,
) {
  assert(policies.includes(policy), "known policy");
  const command = join(project, ".goat-flow/hooks", `${policy}.sh`);
  const args = input.command === undefined ? [] : [`--check=${input.command}`];
  const started = Date.now();
  const result = spawnReferenceCommand("bash", [bashPath(command), ...args], {
    cwd: project,
    env: { ...referenceEnvironment(project, locale), ...env },
    input: input.payloadBase64
      ? Buffer.from(input.payloadBase64, "base64")
      : undefined,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
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

// This program observes a disposable self-test's real subprocesses. It forwards
// their original output and exit so the original assertions still decide success.
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

// Instrument only the disposable copy, retaining every original assertion.
// The caller owns work and must restore the self-test after extraction.
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

// Reconcile real subprocess captures against original executed/skipped totals.
// Failed assertions retain their external journal; successful runs clean it up.
// Only divergence reporting may retain completed assertion failures as data;
// acceptance, incomplete runs and process failures always throw.
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

// IDs follow assertion identity across smoke/full and locales. Exact inputs stay
// separate because Bash decodes ANSI-C Unicode escapes differently by locale.
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

// Supply C reports first to establish candidate inputs and expectations. Preserve
// every locale's measured input and outcome independently of the candidate.
export function buildCorpora(reports, extras, snapshot, historicalSha256) {
  const byId = new Map();
  for (const report of reports) {
    for (const row of caseRows(report)) {
      let saved = byId.get(row.id);
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
      if (saved.inputs[report.locale])
        assert.deepEqual(
          saved.inputs[report.locale],
          row.input,
          `smoke/full input drift: ${row.id}`,
        );
      if (!saved.membership.includes(report.mode))
        saved.membership.push(report.mode);
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

// A missing runtime is an intentional dependency fixture only in named cases.
// Ordinary expected allows/denials must never pass by failing to load both hooks.
export function assertOutcome(
  actual,
  expected,
  requiresAvailable = true,
  id = "case",
) {
  assert(actual && Number.isInteger(actual.status), `missing result: ${id}`);
  const stdout = Buffer.from(actual.stdoutBase64, "base64").toString();
  const stderr = Buffer.from(actual.stderrBase64, "base64").toString();
  if (requiresAvailable)
    assert(
      !`${stdout}${stderr}`.includes("Policy hook unavailable"),
      `unavailable: ${id}`,
    );
  assert.equal(actual.status, expected.status, `exit drift: ${id}`);
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

// Startup exceptions belong only to fixtures that deliberately omit the runtime.
function isApprovedException(row) {
  return row.exceptionId === "native-startup"
    ? row.availabilityCase
    : !row.exceptionId ||
        /^(historical-gap-(?:[1-6]|8|9|10)|full-json-decoding|locale-C|invalid-request-encoding|obsolete-advice|recovery-message)$/.test(
          row.exceptionId,
        );
}

// Refuse missing identities, changed inputs and unrecorded expectation changes.
// Original generated counts and the named exception inventory must reconcile.
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
        (row.exceptionId?.startsWith("historical-gap-") &&
          row.expected.status === 2 &&
          row.expected.stderrIncludes === "BLOCKED: Policy"),
      `unapproved message predicate: ${row.id}`,
    );
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
  for (const policy of policies) {
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

// Acceptance cannot use a development filter or a non-executing listing mode.
export function parseOptions(args) {
  const options = {
    stage: "extraction",
    cases: [],
    requireComplete: false,
    listDivergent: false,
  };
  for (const arg of args) {
    if (arg.startsWith("--stage=")) options.stage = arg.slice(8);
    else if (arg.startsWith("--case=")) options.cases.push(arg.slice(7));
    else if (arg === "--require-complete") options.requireComplete = true;
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

// The shipped mirror and test-only reference are distinct artifacts. Binding
// their hashes here prevents a regenerated candidate from rewriting its oracle.
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

// JSON-equivalent reformatting is still installed-file drift.
export function assertMirrorBytes(canonical, installed) {
  assert(
    Buffer.isBuffer(canonical) && Buffer.isBuffer(installed),
    "mirror bytes required",
  );
  assert(canonical.equals(installed), "corpus mirror bytes");
}

// Check npm's actual archive inventory, independently of manifest declarations.
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

// Missing identities remain fatal; report mode records input and outcome drift.
function compareOriginalRows(report, comparison, seen) {
  const { originals, selected, options, divergences } = comparison;
  for (const row of caseRows(report)) {
    assert(originals.has(row.id), `unrecorded original ID: ${row.id}`);
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

// Supplemental rows classify inert inputs directly, including the locale sentinel.
function compareExtraRows(project, rows, comparison, seen, locale) {
  const { originals, selected, options, divergences } = comparison;
  for (const row of rows.filter(
    (row) => row.origin.kind !== "self-test" && selected.has(row.id),
  )) {
    const actual = runFrozen(
      project,
      row.policy,
      row.input,
      locale,
      row.setup.environment,
      row.id,
    );
    if (row.origin.kind === "locale-sentinel")
      assert.equal(
        actual.status,
        locale === "C" ? 2 : 0,
        "locale sentinel must distinguish byte and character limits",
      );
    try {
      assertOutcome(
        actual,
        originals.get(row.id).original[locale],
        true,
        row.id,
      );
    } catch (error) {
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

// Extraction reruns original assertions rather than replaying captured results.
// Divergence mode reports host differences; it never approves new expectations.
export function compareExtraction(options, artifacts = loadArtifacts()) {
  assert.equal(
    options.stage,
    "extraction",
    `${options.stage} runtime unavailable; later milestone required`,
  );
  for (const id of options.cases)
    assert(
      artifacts.corpus.rows.some((row) => row.id === id),
      `unknown case: ${id}`,
    );
  const selected = new Set(
    options.cases.length
      ? options.cases
      : artifacts.corpus.rows.map((row) => row.id),
  );
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
  for (const locale of locales) {
    const seen = new Set();
    for (const policy of policies) {
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
  if (options.listDivergent)
    console.log(JSON.stringify({ host, selfTests, divergences }, null, 2));
  console.log(
    `PASS: ${options.listDivergent ? "host divergence report" : "reference extraction"}; cases=${selected.size}; differences=${divergences.length}`,
  );
  return { host, cases: selected.size, divergences };
}

// Avoid top-level await: the candidate runner imports helpers from this module,
// so this module must finish loading before waiting for the candidate import.
// Failures print on stderr and set exit status 1.
async function runCli() {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.stage === "candidate") {
      const { compareCandidate } =
        await import("./check-hook-parity-candidate.mjs");
      await compareCandidate(options);
    } else compareExtraction(options);
  } catch (error) {
    console.error(`FAIL: hook parity: ${error.message}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runCli();
}
