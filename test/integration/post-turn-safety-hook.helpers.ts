/**
 * Shared fixtures for the post-turn-safety hook suites.
 * The hook scans a turn's changed content for secrets and conflict markers, so every case
 * needs the same scaffolding: a disposable git repo in a precise state, obviously fake
 * tokens shaped like real ones, and a runner that captures the selected Node scanner's verdict.
 *
 * The tokens are assembled from fragments so this file never contains a string a secret
 * scanner - including the hook under test - would rightly flag.
 */
import assert from "node:assert/strict";
import {
  copyHookTree,
  hookTreeRoot,
  selectedHookPath,
  spawnSelectedHook,
} from "../helpers/hook-entrypoint.js";
import { basename, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
export const HOOK_PATH = selectedHookPath(
  join(hookTreeRoot(), "post-turn-safety.sh"),
);
export const FORCE_BASH3_ENV_KEY =
  "GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK";

/**
 * Install the post-turn hook into a test project the way setup installs it for a consumer, optionally adding code to the scanner child.
 *
 * Writes the selected hook folder into `.goat-flow/hooks/`; with `nodeChildCode` it also rewrites the copied scanner entrypoint.
 *
 * @param root - temporary test project whose `.goat-flow/hooks/` folder is replaced
 * @param nodeChildCode - Node code run only inside the controller's scanner child; empty installs the hook unchanged
 * @returns nothing; the installed files are the result
 */
export function installPostTurnHook(root: string, nodeChildCode = ""): void {
  const hooksDirectory = join(root, ".goat-flow/hooks");
  copyHookTree(hooksDirectory);
  // No child code means the test runs the hook exactly as shipped.
  if (nodeChildCode === "") return;
  const scannerEntrypoint = join(hooksDirectory, basename(HOOK_PATH));
  const shippedSource = readFileSync(scannerEntrypoint, "utf8");
  // The injected code goes after any shebang line and runs only when the controller starts the scanner as its child.
  const nodeChildGuard =
    'if (process.env.GOAT_FLOW_POST_TURN_CONTROLLER_CHILD === "1") {\n';
  const instrumented = shippedSource.replace(
    /^(#![^\n]*\n)?/u,
    (opening) => opening + `${nodeChildGuard}${nodeChildCode}\n}\n`,
  );
  assert.notEqual(
    instrumented,
    shippedSource,
    "scanner instrumentation must apply",
  );
  writeFileSync(scannerEntrypoint, instrumented);
}
export const TEST_AWS_ACCESS_KEY = `AKIA${"1234567890ABCDEF"}`;
export const TEST_GITHUB_TOKEN = `ghp_${"abcdefghijklmnopqrsttestuvwxyzABCD"}`;
export const TEST_FINE_GRAINED_GITHUB_TOKEN = `github_pat_${"a".repeat(20)}`;
export const TEST_SHORT_GITHUB_TOKEN = `ghp_${"b".repeat(20)}`;
export const TEST_NPM_TOKEN = `npm_${"123456789012345678901234567890123456"}`;
export const TEST_SHORT_NPM_TOKEN = `npm_${"c".repeat(20)}`;
export const TEST_SLACK_TOKEN = `xoxb-${"1234567890-1234567890-abcdef"}`;
export const TEST_API_TOKEN = `sk-${"12345678901234567890123456789012"}`;
export const TEST_UNDERSCORE_API_TOKEN = `sk-${"d".repeat(16)}_${"e".repeat(16)}`;
export const TEST_OPENAI_PROJECT_TOKEN = [
  "sk-proj-",
  "f".repeat(24),
  "_",
  "g".repeat(24),
].join("");
export const TEST_ANTHROPIC_API_TOKEN = [
  "sk-ant-api03-",
  "h".repeat(24),
  "-",
  "j".repeat(24),
].join("");
export const TEST_CLIENT_SECRET = ["7Hk9Lm2Qr8Tv5Wx1Zb4Nc6", "Df"].join("");
export const TEST_INI_PASSWORD = ["S3cr3tP4ssw0rd", "X"].join("");
export const TEST_PRIVATE_KEY_HEADER = [
  "-----BEGIN",
  "OPENSSH PRIVATE KEY-----",
].join(" ");
export const TEST_RSA_PRIVATE_KEY_HEADER = [
  "-----BEGIN",
  "RSA PRIVATE KEY-----",
].join(" ");
export const TEST_RSA_PRIVATE_KEY_FOOTER = [
  "-----END",
  "RSA PRIVATE KEY-----",
].join(" ");
export const TEST_RSA_PRIVATE_KEY_BODY = [
  "MIIEpAIBAAKCAQEA",
  "1234567890abcdef",
].join("");
export const TEST_JWT_TOKEN = [
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  ["SflKxwRJSMeK", "KF2QT4fwpMeJ", "f36POk6yJV_adQssw5c"].join(""),
].join(".");
export const TEST_DOCUMENTED_AWS_PLACEHOLDER = `AKIA${"IOSFODNN7EXAMPLE"}`;
export const TEST_DOCUMENTED_SLACK_PLACEHOLDER = `xoxb-${"test-1234567890-1234567890"}`;

/** Run one committed-repository scenario that mirrors a user's edited project; it writes and then removes a temporary repository.
 *
 * @param scenario - required scenario callback; absence means there is no user action to verify
 * @returns nothing; the fixture repository is removed even when the scenario throws
 */
export function withTempRepo(scenario: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-safety-"));
  try {
    createCommittedRepo(root);
    scenario(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Writes one committed fixture repository at an already selected directory.
 *
 * @param root - non-empty directory that becomes an independent Git top level
 * @returns nothing; the caller owns fixture cleanup
 */
export function createCommittedRepo(root: string): void {
  mkdirSync(root, { recursive: true });
  runGit(root, ["init", "-q"]);
  writeFile(root, "README.md", "# fixture\n");
  commitAll(root, "initial");
}

/** Write the explicit post-turn roots a non-Git controller is allowed to scan.
 * Side effects: writes the disposable controller's Goat Flow config.
 *
 * @param root - non-empty controller directory that owns `.goat-flow/config.yaml`
 * @param scanRoots - project-relative roots; an empty list removes the explicit contract
 * @returns nothing; the caller owns the disposable controller fixture
 */
export function writePostTurnScanRoots(
  root: string,
  scanRoots: string[],
): void {
  if (scanRoots.length === 0) return;
  writeFile(
    root,
    ".goat-flow/config.yaml",
    [
      "version: 1",
      "hooks:",
      "  post-turn-safety:",
      "    enabled: true",
      "    scan-roots:",
      ...scanRoots.map((scanRoot) => `      - ${scanRoot}`),
      "",
    ].join("\n"),
  );
}

/** Run one non-Git controller scenario with explicitly configured child repositories.
 * Side effects: writes repositories and controller config, then deletes the fixture tree.
 *
 * @param childNames - repository names also written as the controller's explicit scan roots
 * @param scenario - required callback given the controller and child roots
 * @returns nothing; every controller and child path is removed after the scenario
 */
export function withTempController(
  childNames: string[],
  scenario: (root: string, childRoots: Record<string, string>) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-controller-"));
  const childRoots: Record<string, string> = {};
  try {
    for (const childName of childNames) {
      const childRoot = join(root, childName);
      createCommittedRepo(childRoot);
      childRoots[childName] = childRoot;
    }
    writePostTurnScanRoots(root, childNames);
    scenario(root, childRoots);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Run one unborn-repository scenario that mirrors a user's first commit; it writes and then removes a temporary repository.
 *
 * @param scenario - required callback given a repo with no HEAD; absence means no scenario
 * @returns nothing; the fixture repository is removed even when the scenario throws
 */
export function withUnbornTempRepo(scenario: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-safety-"));
  try {
    runGit(root, ["init", "-q"]);
    scenario(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Writes one fixture file and its required parent directories.
 *
 * @param root - non-empty fixture root representing the user's project
 * @param path - repo-relative user file; empty would target the root and is invalid
 * @param content - exact scanner input; empty creates an empty user file
 * @returns nothing; the file and any missing parent directories are created
 */
export function writeFile(
  root: string,
  path: string,
  content: string | Buffer,
): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** Spawns one Git fixture command and fails the active test with captured output on error.
 *
 * @param root - non-empty fixture root where the user ran Git
 * @param args - exact Git arguments; empty requests Git's default command behavior
 * @returns trimmed stdout; empty means Git printed nothing, while non-zero fails the test
 */
export function runGit(root: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout.trim();
}

/** Commit the complete fixture state so later edits are visible as changed repository content.
 *
 * @param root - non-empty fixture root whose complete user state is committed
 * @param message - required commit label; empty makes Git reject the fixture commit
 * @returns nothing; later user edits remain visible as changed content
 */
export function commitAll(root: string, message: string): void {
  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=goat-flow-test",
    "-c",
    "user.email=goat-flow-test@example.invalid",
    "commit",
    "-m",
    message,
  ]);
}

/**
 * Writes and commits one tracked file, then appends a line to it, like a user editing a committed file without staging it.
 *
 * @param root - committed fixture repository
 * @param path - repository-relative file to create, commit and edit
 * @param line - text appended after the committed first line; a multi-line value appends several lines
 * @returns nothing; the worktree holds the edit and the index still matches HEAD
 */
export function appendCommittedLine(
  root: string,
  path: string,
  line: string,
): void {
  writeFile(root, path, "export const safe = 1;\n");
  commitAll(root, `add ${path}`);
  writeFile(root, path, `export const safe = 1;\n${line}\n`);
}

/**
 * Writes, commits and stages an appended line, like a user running `git add`; optionally the worktree is then restored.
 *
 * @param root - committed fixture repository
 * @param path - repository-relative file to create, commit, edit and stage
 * @param line - text appended and staged
 * @param isIndexOnly - true restores the committed worktree copy after staging; false leaves worktree and index equal
 * @returns nothing; the index always holds the appended line
 */
export function stageAppendedLine(
  root: string,
  path: string,
  line: string,
  isIndexOnly: boolean,
): void {
  appendCommittedLine(root, path, line);
  runGit(root, ["add", path]);
  // Index-only is a user who staged the line and then reverted the file, so only `git diff --cached` still shows it.
  if (isIndexOnly) writeFile(root, path, "export const safe = 1;\n");
}

/**
 * Run the real hook against a fixture repo and capture its verdict.
 * The scanner variant is chosen by env so the same case can prove both implementations.
 *
 * @param root - non-empty fixture root the user expects the hook to scan
 * @param env - overrides merged onto the process env; absent means the default scanner
 * @param stdinPayload - optional provider JSON; absent means a direct user run
 * @returns captured process metadata; inspect error and signal when status is null
 */
export function runHook(
  root: string,
  env?: Record<string, string>,
  stdinPayload?: string,
): ReturnType<typeof spawnSync> {
  return runHookProcess(root, [], env, stdinPayload);
}

/** Run a user-selected hook command such as self-test without changing the project fixture.
 *
 * @param root - non-empty fixture root used as the hook's current project
 * @param hookArguments - exact CLI options; empty means the normal Stop scan
 * @param env - optional process overrides; absent keeps the user's environment
 * @param stdinPayload - optional provider JSON; absent represents direct human use
 * @returns captured command metadata; inspect error and signal when status is null
 */
export function runHookCommand(
  root: string,
  hookArguments: string[],
  env?: Record<string, string>,
  stdinPayload?: string,
): ReturnType<typeof spawnSync> {
  return runHookProcess(root, hookArguments, env, stdinPayload);
}

/** Run the hook with file-backed provider input so Bash reliably sees end-of-file.
 *
 * @param root - non-empty fixture root the user expects the hook to inspect
 * @param hookArguments - selected command options; empty starts a normal scan
 * @param env - optional scanner or failure-injection settings; absent keeps defaults
 * @param stdinPayload - provider JSON; absent closes stdin for a direct user run
 * @returns captured hook metadata; inspect error and signal when status is null
 */
function runHookProcess(
  root: string,
  hookArguments: string[],
  env?: Record<string, string>,
  stdinPayload?: string,
): ReturnType<typeof spawnSync> {
  // A direct run has no provider payload, so closed stdin lets scanning start immediately.
  if (stdinPayload === undefined) {
    return captureHookOutput(root, hookArguments, env, "ignore");
  }

  const payloadDirectory = mkdtempSync(
    join(tmpdir(), "goat-flow-post-turn-payload-"),
  );
  const payloadPath = join(payloadDirectory, "stdin.json");
  writeFileSync(payloadPath, stdinPayload);
  const payloadFileDescriptor = openSync(payloadPath, "r");
  try {
    return captureHookOutput(root, hookArguments, env, payloadFileDescriptor);
  } finally {
    closeSync(payloadFileDescriptor);
    rmSync(payloadDirectory, { recursive: true, force: true });
  }
}

/** Spawns the real hook with caller-owned stdin, then captures and removes private output files. */
function captureHookOutput(
  root: string,
  hookArguments: string[],
  env: Record<string, string> | undefined,
  stdin: number | "ignore",
) {
  const directory = mkdtempSync(join(tmpdir(), "goat-post-turn-output-"));
  const stdoutPath = join(directory, "stdout");
  const stderrPath = join(directory, "stderr");
  const descriptors: number[] = [];
  try {
    for (const path of [stdoutPath, stderrPath])
      descriptors.push(openSync(path, "wx", 0o600));
    const result = spawnSelectedHook(HOOK_PATH, hookArguments, {
      cwd: root,
      encoding: "utf8",
      stdio: [stdin, ...descriptors],
      env: { ...process.env, ...env },
    });
    return {
      ...result,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
    };
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Build the supported Stop payload a coding agent sends after the user's turn.
 *
 * @param sessionId - stable provider session; empty is intentionally invalid
 * @param isStopHookActive - true means this is a continuation caused by the prior block
 * @returns bounded JSON consumed on stdin; never null or empty
 */
export function buildStopPayload(
  sessionId: string,
  isStopHookActive: boolean,
): string {
  return JSON.stringify({
    session_id: sessionId,
    hook_event_name: "Stop",
    stop_hook_active: isStopHookActive,
  });
}

/** A command fault names one absolute executable and its observable failure. */
export interface CommandFault {
  when?: {
    first?: string;
    prefix?: string[];
    includes?: string[];
    any?: string[];
    absoluteOperand?: boolean;
  };
  status?: number;
  stdout?: string;
  stdoutEnvironment?: string;
  stderr?: string;
  delegateThenRemoveEnvironment?: string;
}

// Child argv belongs to generated source, separate from the parent fixture's write path.
function commandFaultSource(
  declaration: CommandFault & { executable: string },
): string {
  return `import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
const fault = ${JSON.stringify(declaration)};
const args = process.argv.slice(2);
const predicate = fault.when ?? {};
const absolute = args.find((argument) => argument.startsWith("/"));
const matches = (!predicate.first || args[0] === predicate.first)
  && (!predicate.prefix || predicate.prefix.every((argument, index) => args[index] === argument))
  && (!predicate.includes || predicate.includes.every((argument) => args.includes(argument)))
  && (!predicate.any || predicate.any.some((argument) => args.includes(argument)))
  && (!predicate.absoluteOperand || absolute !== undefined);
const delegate = () => spawnSync(fault.executable, args, { stdio: "inherit" }).status ?? 1;
if (!matches) process.exit(delegate());
if (fault.delegateThenRemoveEnvironment) {
  const status = delegate();
  const path = process.env[fault.delegateThenRemoveEnvironment];
  if (!path) throw new Error("fault removal target missing");
  rmSync(path, { force: true });
  process.exit(status);
}
if (fault.stdoutEnvironment) process.stdout.write((process.env[fault.stdoutEnvironment] ?? "") + "\\n");
if (fault.stdout) process.stdout.write(fault.stdout);
if (fault.stderr) process.stderr.write(fault.stderr.replaceAll("{{cwd}}", process.cwd()).replaceAll("{{absolute}}", absolute ?? ""));
process.exit(fault.status ?? 2);
`;
}

/**
 * Make one command misbehave inside the hook's child processes, so a test can check what the user sees when, say, `git` fails mid-scan.
 *
 * Writes a fault driver and a preload to a temporary directory; the preload sends only the declared command to the driver.
 * The driver applies the fault's predicates, output and exit status the same way on every host, then the directory is removed.
 *
 * @param executable - absolute path of the command to fault, resolved by the caller without shell lookup
 * @param fault - predicates, output and exit status the driver applies
 * @param scenario - assertions run with the fault environment; NODE_OPTIONS loads the preload in each hook child
 * @returns nothing; the temporary directory is removed even when the scenario throws
 */
export function withCommandShim(
  executable: string,
  fault: CommandFault,
  scenario: (env: Record<string, string>) => void,
): void {
  assert(isAbsolute(executable), "fault target must be an absolute executable");
  const shimRoot = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-shim-"));
  const driver = join(shimRoot, "fault.mjs");
  const preload = join(shimRoot, "fault-preload.cjs");
  const declaration = { executable, ...fault };
  try {
    writeFileSync(driver, commandFaultSource(declaration));
    const shimmedCommandName = basename(executable).replace(/\.exe$/iu, "");
    // Redirect only this declared command; the driver delegates by absolute path without recursion.
    writeFileSync(
      preload,
      `const cp = require("node:child_process");
const original = cp.spawnSync;
cp.spawnSync = function(command, args = [], options = {}) {
  return command === ${JSON.stringify(shimmedCommandName)}
    ? original.call(this, process.execPath, [${JSON.stringify(driver)}, ...args], options)
    : original.call(this, command, args, options);
};
require("node:module").syncBuiltinESMExports();
`,
    );
    scenario({
      NODE_OPTIONS:
        `${process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(preload)}`.trim(),
      GOAT_TEST_COMMAND_FAULT: JSON.stringify(declaration),
    });
  } finally {
    rmSync(shimRoot, { recursive: true, force: true });
  }
}

/** Make the scanner child fail to read settings.env, or change it mid-digest, without production test switches.
 * Writes a temporary preload file that the scanner child loads, and deletes it when the scenario ends.
 *
 * @param operation - Fault applied only to settings.env; the two `-during-digest` faults keep its bytes and size the same.
 * @param scenario - Assertions run with the disposable preload; the helper removes it afterward.
 */
export function withScannerFileFault(
  operation:
    | "readFileSync"
    | "readSync"
    | "lstatSync"
    | "vanish"
    | "replace-during-digest"
    | "touch-during-digest",
  scenario: (environment: Record<string, string>) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "goat-scanner-fault-"));
  const preload = join(root, "fault.cjs");
  // Preload before ESM imports so the real scanner encounters the chosen filesystem failure.
  try {
    writeFileSync(
      preload,
      `
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const operation = ${JSON.stringify(operation)};
const matches = (path) => typeof path === 'string' && /(?:^|[\\\\/])settings\\.env$/.test(path);
const handles = new Set();
const paths = new Map();
const mutated = new Set();
const fail = () => { throw Object.assign(new Error('injected scanner file failure'), { code: 'EACCES' }); };
// Wrap each call the scanner uses to open or inspect settings.env, so a test can break it the way a locked or deleted file would.
for (const name of ['openSync', 'readFileSync', 'lstatSync']) {
  const original = fs[name];
  fs[name] = function(path, ...args) {
    // The chosen call fails as if the user had locked settings.env, for example by removing read permission mid-turn.
    if (matches(path) && name === operation) fail();
    const result = original.call(fs, path, ...args);
    // Remember every open settings.env handle, so later reads can be faulted or changed.
    if (matches(path) && name === 'openSync') { handles.add(result); paths.set(result, path); }
    // The file disappears right after the scanner looks at it, as if the agent deleted it during the scan.
    if (matches(path) && name === 'lstatSync' && operation === 'vanish') fs.unlinkSync(path);
    return result;
  };
}
const close = fs.closeSync;
fs.closeSync = function(fd) { handles.delete(fd); paths.delete(fd); return close.call(fs, fd); };
const read = fs.readSync;
fs.readSync = function(fd, ...args) {
  // Reading settings.env fails part-way, as if the disk or a permission change interrupted the scan.
  if (operation === 'readSync' && handles.has(fd)) fail();
  const count = read.call(fs, fd, ...args);
  // 1048576 matches the scanner's digest chunk size, so only the binary digest read triggers the change, once per open file.
  if (handles.has(fd) && args[2] === 1048576 && !mutated.has(fd)) {
    mutated.add(fd);
    const path = paths.get(fd);
    const before = fs.statSync(path);
    // Swap in an identical copy with the same timestamps, as if an editor saved the file by replacing it mid-scan.
    if (operation === 'replace-during-digest') {
      const replacement = path + '.replacement';
      fs.writeFileSync(replacement, fs.readFileSync(path));
      fs.utimesSync(replacement, before.atime, before.mtime);
      fs.renameSync(replacement, path);
    } else if (operation === 'touch-during-digest') {
      // Leave the bytes alone but move the modified time, as if a tool touched the file mid-scan.
      fs.utimesSync(path, before.atime, new Date(before.mtimeMs + 2000));
    }
  }
  return count;
};
syncBuiltinESMExports();
`,
    );
    // Keep any NODE_OPTIONS the test run already set; when none is set, only the fault preload is added.
    scenario({
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(preload)}`,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Prove an infrastructure failure blocks without masquerading as a user finding.
 *
 * @param root - non-empty fixture root whose scan must remain incomplete
 * @param env - required failure controls; empty means no fault was injected
 * @returns the blocked process; a null status fails the completed-exit assertion
 */
export function assertHookIncomplete(
  root: string,
  env: Record<string, string>,
): ReturnType<typeof spawnSync> {
  const result = runHook(root, env);
  assert.equal(
    result.status,
    2,
    `incomplete scan should block\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stderr, /post-turn-safety: .*scan incomplete/iu);
  assert.doesNotMatch(
    result.stderr,
    /fix or remove the flagged changed content/u,
  );
  assert.equal(
    result.stderr.includes(root),
    false,
    `incomplete-scan diagnostics exposed the fixture path: ${result.stderr}`,
  );
  return result;
}

/**
 * Normalize scanner prose to the common finding-family and path decision.
 * Stable signatures let tests compare what users see across implementations.
 *
 * @param stderr - hook diagnostics; empty means the user saw no blocking explanation
 * @returns sorted finding signatures; empty means the hook reported nothing blocked
 */
export function hookFindingSignatures(stderr: string): string[] {
  return stderr
    .split("\n")
    .flatMap((line) => {
      const nativePrefix = "post-turn-safety: blocked ";
      const compatibilityPrefix = "post-turn-safety: ";
      const compatibilitySuffix = " (Bash 3 compatibility scan).";
      // Native findings use the optimized scanner's explicit blocked prefix.
      if (line.startsWith(nativePrefix)) {
        return [line.slice(nativePrefix.length)];
      }
      // Compatibility findings use a suffix so stock macOS users see their active path.
      if (
        line.startsWith(compatibilityPrefix) &&
        line.endsWith(compatibilitySuffix)
      ) {
        return [
          line.slice(compatibilityPrefix.length, -compatibilitySuffix.length),
        ];
      }
      return [];
    })
    .sort();
}

/** Execute the real hook and prove the fixture reaches the allowed exit path.
 *
 * @param root - non-empty fixture root expected to pass
 * @param env - scanner selection; absent proves both scanners agree on the allow
 * @returns nothing; any non-allow user verdict fails the active test
 */
export function assertHookAllows(
  root: string,
  env?: Record<string, string>,
): void {
  // An absent hook environment means normal user settings before adding a proof selector.
  const hookEnvironment = env ?? {};
  const scannerSelection = hookEnvironment[FORCE_BASH3_ENV_KEY];
  // An absent scanner selection means the user contract must be proved on both paths.
  const userSelectedScanner = scannerSelection !== undefined;
  // Start on the user-selected path, or choose native before comparing compatibility.
  const result = runHook(
    root,
    userSelectedScanner
      ? hookEnvironment
      : { ...hookEnvironment, [FORCE_BASH3_ENV_KEY]: "0" },
  );
  assert.equal(
    result.status,
    0,
    `hook should allow fixture\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  // An unspecified scanner asks the helper to prove the same allow on both user paths.
  if (!userSelectedScanner) {
    // Preserve all user settings while selecting only the compatibility implementation.
    const compatibilityResult = runHook(root, {
      ...hookEnvironment,
      [FORCE_BASH3_ENV_KEY]: "1",
    });
    assert.equal(
      compatibilityResult.status,
      result.status,
      `scanner decisions differ\nnative stderr:\n${result.stderr}\nfallback stderr:\n${compatibilityResult.stderr}`,
    );
    assert.deepStrictEqual(
      hookFindingSignatures(compatibilityResult.stderr),
      hookFindingSignatures(result.stderr),
    );
  }
}

/**
 * Run the real hook and prove the fixture is blocked with an explanation.
 *
 * @param root - non-empty fixture root expected to fail
 * @param expectedPattern - pattern the block message must match so the author knows why
 * @param env - scanner selection; absent proves both scanners agree on the block
 * @returns the blocking run; null status means Bash did not start and fails the assertion
 */
export function assertHookBlocks(
  root: string,
  expectedPattern: RegExp,
  env?: Record<string, string>,
): ReturnType<typeof spawnSync> {
  // An absent hook environment means normal user settings before adding a proof selector.
  const hookEnvironment = env ?? {};
  const scannerSelection = hookEnvironment[FORCE_BASH3_ENV_KEY];
  // An absent scanner selection means the user contract must be proved on both paths.
  const userSelectedScanner = scannerSelection !== undefined;
  // Start on the user-selected path, or choose native before comparing compatibility.
  const result = runHook(
    root,
    userSelectedScanner
      ? hookEnvironment
      : { ...hookEnvironment, [FORCE_BASH3_ENV_KEY]: "0" },
  );
  assert.equal(
    result.status,
    2,
    `hook should block fixture\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stderr, expectedPattern);
  assert.doesNotMatch(result.stderr, /validation/u);
  // An unspecified scanner asks the helper to prove the same block on both user paths.
  if (!userSelectedScanner) {
    // Preserve all user settings while selecting only the compatibility implementation.
    const compatibilityResult = runHook(root, {
      ...hookEnvironment,
      [FORCE_BASH3_ENV_KEY]: "1",
    });
    assert.equal(
      compatibilityResult.status,
      result.status,
      `scanner decisions differ\nnative stderr:\n${result.stderr}\nfallback stderr:\n${compatibilityResult.stderr}`,
    );
    assert.deepStrictEqual(
      hookFindingSignatures(compatibilityResult.stderr),
      hookFindingSignatures(result.stderr),
    );
    assert.match(compatibilityResult.stderr, expectedPattern);
    assert.doesNotMatch(compatibilityResult.stderr, /validation/u);
  }
  return result;
}
