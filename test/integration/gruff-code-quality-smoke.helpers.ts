/**
 * Shared fixtures for the gruff-code-quality hook integration suites: disposable git
 * roots, mock gruff binaries (legacy analyse, native changed-region, gruff.hook.v1
 * contract, config-error shapes), the hook spawner, and invocation-log readers.
 * Imported by the smoke, contract, and provider-contract suites; each consumer
 * registers `after(cleanupHookTestDirs)` so temporary user projects are removed.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

/** Absolute path of the canonical PostToolUse hook under test. */
const HOOK = join(PROJECT_ROOT, "workflow", "hooks", "gruff-code-quality.sh");

const disposables: string[] = [];
let payloadCounter = 0;

/**
 * Remove every disposable test root created via `makeRoot`.
 *
 * @returns nothing - deletes the registered temp directories from the filesystem
 */
export function cleanupHookTestDirs(): void {
  for (const dir of disposables) rmSync(dir, { recursive: true, force: true });
}

/**
 * Resolve a tool's absolute path from PATH.
 *
 * @param name - binary name to look up (e.g. "bash")
 * @returns the first matching absolute path; throws when the tool is missing
 */
export function resolveTool(name: string): string {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`required tool not found on PATH: ${name}`);
}

/**
 * Create a disposable git root for hook smoke-test isolation.
 *
 * @returns absolute path of a fresh temp directory registered for cleanup
 */
export function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-gruff-hook-"));
  disposables.push(root);
  return root;
}

/**
 * Install the default mock gruff binary used by most hook scenarios.
 *
 * @param root - disposable test root to install into
 * @returns absolute path of the created bin directory
 */
export function writeMockGruff(root: string): string {
  return writeMockGruffBinary(root, "bin", "gruff-ts", "changed.rule");
}

/**
 * Writes an executable legacy-analyse mock gruff binary into the test root.
 *
 * The mock logs each analysed file to gruff-invocations.log, emits a fixed
 * pre-existing finding on line 1 plus a changed-line finding on line 3, and
 * treats `src/new-file.ts` as a new file with a line-2 finding.
 *
 * @param root - disposable test root to install into
 * @param relativeBinDir - bin directory relative to the root (discovery path under test)
 * @param binaryName - gruff binary name to create (selects the analyzer language)
 * @param changedRuleId - ruleId the mock reports for the changed-line finding
 * @returns absolute path of the created bin directory
 */
export function writeMockGruffBinary(
  root: string,
  relativeBinDir: string,
  binaryName: string,
  changedRuleId: string,
): string {
  const binDir = join(root, relativeBinDir);
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, binaryName);
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "$1" == "analyse" && "$2" == "--help" ]]; then
  cat <<'HELP'
Usage: mock-gruff analyse [options] [paths...]
Options:
  --format <format>
  --fail-on <severity>
HELP
  exit 0
fi

if [[ "$1" == "hook" ]]; then
  echo "unknown command: hook" >&2
  exit 2
fi

file="\${@: -1}"
printf '%s\\n' "$file" >> "$PWD/gruff-invocations.log"
if [[ "$file" == "src/new-file.ts" ]]; then
  cat <<JSON
{"findings":[{"ruleId":"new.rule","message":"new file finding","filePath":"$file","line":2,"severity":"warning"}]}
JSON
  exit 1
fi

cat <<JSON
{"findings":[{"ruleId":"old.rule","message":"pre-existing finding","filePath":"$file","line":1,"severity":"advisory"},{"ruleId":"${changedRuleId}","message":"changed line finding","filePath":"$file","line":3,"severity":"warning"}]}
JSON
exit 1
`,
  );
  chmodSync(bin, 0o755);
  return binDir;
}

/**
 * Spawn git with a deterministic PATH inside the disposable test repo.
 *
 * @param root - repo directory to run in
 * @param args - git argv; the call asserts exit status 0
 * @returns nothing - mutates the repo and fails the test on a non-zero exit
 */
export function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, PATH: "/usr/bin:/bin" },
  });
  assert.equal(result.status, 0, result.stderr);
}

/**
 * Initialize the disposable repo without leaking command details into tests.
 *
 * @param root - directory to turn into a git repository
 * @returns nothing - writes the .git directory
 */
export function initGit(root: string): void {
  git(root, ["init", "--quiet"]);
}

/**
 * Escape file names before embedding them in assertion regular expressions.
 *
 * @param literalText - literal text to escape
 * @returns the text with regex metacharacters backslash-escaped
 */
export function escapeRegex(literalText: string): string {
  return literalText.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/**
 * Run the hook with a JSON payload on stdin the way an agent PostToolUse would.
 *
 * @param root - working directory for the hook process
 * @param payload - PostToolUse payload object serialized to stdin
 * @param pathPrefix - PATH value for the spawn (sandboxes binary discovery)
 * @param extraEnv - extra environment entries merged over process.env
 * @returns the completed spawnSync result with captured stdout/stderr
 */
export function runHook(
  root: string,
  payload: unknown,
  pathPrefix: string,
  extraEnv: NodeJS.ProcessEnv = {},
): ReturnType<typeof spawnSync> {
  payloadCounter += 1;
  const payloadPath = `${root}.payload.${process.pid}.${payloadCounter}.json`;
  writeFileSync(payloadPath, JSON.stringify(payload));
  try {
    // File-backed stdin keeps Bash `cat` readers from waiting forever for EOF
    // under Codex's sandboxed child-process plumbing.
    return spawnSync(
      "bash",
      ["-c", 'bash "$1" < "$2"', "gruff-code-quality-test", HOOK, payloadPath],
      {
        cwd: root,
        encoding: "utf-8",
        env: { ...process.env, ...extraEnv, PATH: pathPrefix },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } finally {
    rmSync(payloadPath, { force: true });
  }
}

/**
 * Run Gruff in the migrated result mode consumed by the provider launcher.
 * Use when a fixture must inspect the bounded result before model-facing adaptation.
 *
 * @param root - non-empty disposable project root used as the hook working directory
 * @param payload - PostToolUse payload; null or malformed input must produce an explicit result
 * @param pathPrefix - PATH used to isolate analyzer and Git discovery; empty prevents tool lookup
 * @param extraEnv - optional fixture overrides; an empty object keeps the default Claude contract
 * @param provider - provider identity embedded in the result; empty or unknown values are invalid
 * @returns completed hook process; empty stdout means the migrated hook failed its result contract
 */
export function runMigratedHook(
  root: string,
  payload: unknown,
  pathPrefix: string,
  extraEnv: NodeJS.ProcessEnv = {},
  provider: "claude" | "codex" | "antigravity" | "copilot" = "claude",
): ReturnType<typeof spawnSync> {
  return runHook(root, payload, pathPrefix, {
    ...extraEnv,
    GOAT_FLOW_HOOK_PROVIDER: provider,
    GOAT_FLOW_HOOK_EVENT: "post-tool",
    GOAT_FLOW_HOOK_PROVIDER_MODE: "fixture",
    GOAT_FLOW_HOOK_ADAPTER_VERSION: "1",
  });
}

/**
 * Writes one edited project for a migrated Gruff result scenario.
 * Use when users need the same source edit while analyzer output or failure changes.
 *
 * @param analyzerEnvelope - analyzer JSON; empty text models no analyzer response
 * @param analyzerBehavior - process controls; an empty object models successful analysis
 * @returns disposable project root; never empty after fixture creation
 */
export function makeEditedGruffContractProject(
  analyzerEnvelope: string,
  analyzerBehavior: {
    exitStatus?: number;
    standardError?: string;
    delaySeconds?: number;
  } = {},
): string {
  const projectRoot = makeRoot();
  writeContractGruffBinary(projectRoot, analyzerEnvelope, analyzerBehavior);
  writeFileSync(join(projectRoot, ".gruff-ts.yaml"), "rules: {}\n");
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "src", "sample.ts"), "a\nb\nc\nd\n");
  return projectRoot;
}

/**
 * Reads the neutral result a migrated hook sends toward provider feedback.
 * Use after execution; empty or malformed output fails instead of hiding missing UI feedback.
 *
 * @param hookResult - completed hook process; empty stdout means no result reached the adapter
 * @returns decoded result fields; never null for a conforming migrated hook
 */
export function readMigratedGruffResult(
  hookResult: ReturnType<typeof runMigratedHook>,
): Record<string, unknown> {
  assert.equal(hookResult.status, 0, hookResult.stderr);
  return JSON.parse(hookResult.stdout) as Record<string, unknown>;
}

/**
 * Builds the edit payload users produce when changing the shared Gruff fixture.
 * Use when a scenario needs an attributable file and optional stable session identity.
 *
 * @param sessionIdentifier - non-empty session ID; omitted uses the stable fixture session
 * @returns PostToolUse edit payload; file path and changed range are never empty
 */
export function sampleGruffEditPayload(sessionIdentifier = "fixture-session") {
  return {
    session_id: sessionIdentifier,
    tool_name: "Edit",
    tool_input: {
      file_path: "src/sample.ts",
      changed_ranges: [{ startLine: 3, endLine: 3 }],
    },
  };
}

/**
 * Assert extension-based binary routing through the hook using real payloads.
 *
 * @param root - disposable git root containing mock gruff binaries
 * @param cases - file/rule pairs that prove each extension selects its analyzer
 * @returns nothing - fails the calling test when routing or output mismatches
 */
export function assertExtensionRoutesToExpectedGruff(
  root: string,
  cases: ReadonlyArray<{ file: string; expectedRule: string }>,
): void {
  cases.forEach(({ file, expectedRule }) => {
    const result = runHook(
      root,
      {
        tool_name: "Edit",
        tool_input: {
          file_path: file,
          changed_ranges: [{ startLine: 3, endLine: 3 }],
        },
      },
      "/usr/bin:/bin",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      new RegExp(
        `\\[warning\\] ${escapeRegex(file)}:3 ${escapeRegex(expectedRule)} - changed line finding`,
      ),
    );
  });
}

/**
 * Assert unsupported hook payloads fail soft without surfacing analyzer output.
 *
 * @param root - disposable git root with the mock gruff binary installed
 * @param payloads - payload shapes that should be skipped by hook preflight
 * @returns nothing - fails the calling test on a non-zero exit or any stdout
 */
export function assertFailSoftSkipPayloadsSilent(
  root: string,
  payloads: ReadonlyArray<unknown>,
): void {
  payloads.forEach((payload) => {
    const result = runHook(root, payload, "/usr/bin:/bin");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  });
}

/**
 * Install a mock gruff binary that rejects the project config the way a real
 * gruff does when `.gruff-*.yaml` lacks the required `schemaVersion:` line:
 * it prints a config error naming `schemaVersion` and `init --force` to stderr
 * and exits non-zero, emitting no JSON. Used to assert the hook relays gruff's
 * real reason instead of the generic "produced non-JSON output" note. Writes
 * an executable mock binary into the temp root.
 *
 * @param root - disposable test root to install into
 * @returns absolute path of the created bin directory
 */
export function writeSchemaErrorMockGruff(root: string): string {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, "gruff-ts");
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "$1" == "analyse" && "$2" == "--help" ]]; then
  cat <<'HELP'
Usage: mock-gruff analyse [options] [paths...]
Options:
  --format <format>
  --fail-on <severity>
HELP
  exit 0
fi

cat >&2 <<'ERR'
gruff-ts: config error
  Config must include \`schemaVersion: gruff-ts.config.v0.1\` at the top.

Suggested fix:
  Run \`gruff-ts init --force\` to regenerate the config from current defaults.
ERR
exit 1
`,
  );
  chmodSync(bin, 0o755);
  return binDir;
}

/**
 * Install a legacy `analyse --format json` mock that exits non-zero with valid
 * JSON but no findings because the project config was rejected. Writes an
 * executable mock binary into the temp root.
 *
 * @param root - disposable test root to install into
 * @returns absolute path of the created .venv/bin directory
 */
export function writeJsonConfigErrorMockGruffPy(root: string): string {
  const binDir = join(root, ".venv", "bin");
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, "gruff-py");
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "$1" == "analyse" && "$2" == "--help" ]]; then
  cat <<'HELP'
Usage: mock-gruff-py analyse [options] [paths...]
Options:
  --format <format>
  --fail-on <severity>
HELP
  exit 0
fi

cat <<'JSON'
{"findings":[],"diagnostics":[{"type":"config-error","message":"Unknown threshold size.file-length"}],"filesDiscovered":0}
JSON
exit 2
`,
  );
  chmodSync(bin, 0o755);
  return binDir;
}

/**
 * Install a gruff-py-shaped mock that advertises native changed-region flags.
 *
 * It returns a finding on line 8 while the payload edits line 9, matching
 * gruff-py's symbol-scope contract: the analyzer owns changed-region filtering
 * and can retain findings whose primary line sits outside the edited hunk.
 *
 * Side effect: creates `<root>/.venv/bin/` and writes an executable `gruff-py`
 * shim there (chmod 0o755) so the hook discovers it through normal binary resolution.
 *
 * @param root - temp project root the shim is installed under
 * @returns absolute path to the created `.venv/bin` directory
 */
export function writeNativeChangedRegionGruffPy(root: string): string {
  const binDir = join(root, ".venv", "bin");
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, "gruff-py");
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "$1" == "analyse" && "$2" == "--help" ]]; then
  cat <<'HELP'
Usage: mock-gruff-py analyse [options] [paths...]
Options:
  --format <format>
  --fail-on <severity>
  --changed-ranges <ranges>
  --changed-scope <scope>
  --no-baseline
HELP
  exit 0
fi

if [[ "$1" == "hook" ]]; then
  echo "unknown command: hook" >&2
  exit 2
fi

printf '%s\\n' "$*" >> "$PWD/gruff-args.log"
if [[ " $* " == *" --no-baseline "* && " $* " == *" --changed-ranges 9-9 "* && " $* " == *" --changed-scope symbol "* ]]; then
  cat <<JSON
{"findings":[{"ruleId":"security.shell-injection","message":"symbol-scoped finding","filePath":"src/sample.py","line":8,"severity":"error"}],"suppressedCount":2,"diff":{"suppressedCount":2}}
JSON
  exit 1
fi

cat <<JSON
{"findings":[{"ruleId":"security.shell-injection","message":"unscoped finding","filePath":"src/sample.py","line":8,"severity":"error"}]}
JSON
exit 1
`,
  );
  chmodSync(bin, 0o755);
  return binDir;
}

/** Default gruff.hook.v1 envelope emitted by `writeContractGruffBinary` mocks. */
const DEFAULT_CONTRACT_ENVELOPE =
  '{"contractVersion":"gruff.hook.v1","findings":[{"ruleId":"size.file-length","pillar":"size","severity":"warning","scope":"file","file":"src/sample.ts","line":1,"message":"file too long","remediation":"split it"},{"ruleId":"naming.short","pillar":"naming","severity":"advisory","scope":"line","file":"src/sample.ts","line":3,"message":"too short"}],"suppressed":{"count":2},"ignored":{"paths":[]},"config":{"schemaOk":true,"error":null}}';

/** Clean analyzer response used when the user's edit has no findings. */
export const CLEAN_GRUFF_CONTRACT_ENVELOPE =
  '{"contractVersion":"gruff.hook.v1","findings":[],"suppressed":{"count":0},"ignored":{"paths":[]},"config":{"schemaOk":true,"error":null}}';

/** Finding response used when provider feedback must show one changed-file warning. */
export const FINDING_GRUFF_CONTRACT_ENVELOPE =
  '{"contractVersion":"gruff.hook.v1","findings":[{"ruleId":"size.file-length","pillar":"size","severity":"warning","scope":"file","file":"src/sample.ts","line":1,"message":"file too long","remediation":"split it"},{"ruleId":"naming.short","pillar":"naming","severity":"advisory","scope":"line","file":"src/sample.ts","line":3,"message":"too short"}],"suppressed":{"count":0},"ignored":{"paths":[]},"config":{"schemaOk":true,"error":null}}';

/**
 * Writes a contract-aware mock that advertises gruff.hook.v1 from
 * `hook --capabilities` and emits a gruff.hook.v1 envelope from `hook --format
 * json`, so tests exercise the hook's thin-renderer contract path (not the
 * legacy analyse path). Logs the `hook` argv to gruff-hook-args.log.
 *
 * @param root - temp project root the shim is installed under
 * @param envelope - gruff.hook.v1 JSON the mock emits from `hook --format json`
 * @param behavior - optional exit, stderr, and delay controls; omitted values model a clean exchange
 * @returns absolute path to the created node_modules/.bin directory
 */
export function writeContractGruffBinary(
  root: string,
  envelope: string = DEFAULT_CONTRACT_ENVELOPE,
  behavior: {
    exitStatus?: number;
    standardError?: string;
    delaySeconds?: number;
  } = {},
): string {
  const binDir = join(root, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, "gruff-ts");
  const analyzerOutputProgram =
    envelope.length === 0 ? ":" : ["cat <<'JSON'", envelope, "JSON"].join("\n");
  const analyzerErrorProgram =
    (behavior.standardError ?? "").length === 0
      ? ":"
      : ["cat >&2 <<'ERROR'", behavior.standardError ?? "", "ERROR"].join("\n");
  const analyzerDelayProgram =
    (behavior.delaySeconds ?? 0) > 0 ? `sleep ${behavior.delaySeconds}` : ":";
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
if [[ "$1" == "hook" && " $* " == *" --capabilities "* ]]; then
  printf 'capabilities\n' >> "$PWD/gruff-capabilities.log"
  cat <<'JSON'
{"contractVersion":"gruff.hook.v1","analyzer":{"name":"gruff-ts","version":"9.9.9"},"supports":{"changedRanges":true,"diff":true,"baseline":true,"scopeField":true,"metadata":true,"stableIdentity":true,"ignoreReport":true,"newOnly":true},"flags":{"changedRanges":"--changed-ranges","diff":"--diff","baseline":"--baseline"},"flagOrder":"any"}
JSON
  exit 0
fi
if [[ "$1" == "hook" ]]; then
  printf '%s\\n' "$*" >> "$PWD/gruff-hook-args.log"
  ${analyzerDelayProgram}
  ${analyzerErrorProgram}
  ${analyzerOutputProgram}
  exit ${behavior.exitStatus ?? 0}
fi
exit 2
`,
  );
  chmodSync(bin, 0o755);
  return binDir;
}

/**
 * Read the files passed to the mock gruff binary.
 *
 * @param root - test root holding gruff-invocations.log
 * @returns analysed file paths in invocation order; a missing log file is the
 *   no-invocations fallback (empty list) while any other read error throws
 */
export function readInvocations(root: string): string[] {
  try {
    const content = readFileSync(
      join(root, "gruff-invocations.log"),
      "utf-8",
    ).trim();
    return content.length > 0 ? content.split("\n") : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Read the raw mock-gruff argument log.
 *
 * @param root - test root holding gruff-args.log
 * @returns one argv string per invocation; a missing log file is the
 *   no-invocations fallback (empty list) while any other read error throws
 */
export function readArgumentInvocations(root: string): string[] {
  try {
    const content = readFileSync(join(root, "gruff-args.log"), "utf-8").trim();
    return content.length > 0 ? content.split("\n") : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
