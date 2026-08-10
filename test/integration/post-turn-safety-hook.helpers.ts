/**
 * Shared fixtures for the post-turn-safety hook suites.
 * The hook scans a turn's changed content for secrets and conflict markers, so every case
 * needs the same scaffolding: a disposable git repo in a precise state, obviously fake
 * tokens shaped like real ones, and a runner that captures the hook's verdict on both the
 * modern and the bash-3 fallback scanner.
 *
 * The tokens are assembled from fragments so this file never contains a string a secret
 * scanner - including the hook under test - would rightly flag.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

export const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
export const HOOK_PATH = resolve(
  PROJECT_ROOT,
  "workflow/hooks/post-turn-safety.sh",
);
export const FORCE_BASH3_ENV_KEY =
  "GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK";
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

/** Run one committed-repository scenario that mirrors a user's edited project.
 *
 * @param fn - required scenario callback; absence means there is no user action to verify
 * @returns nothing; the fixture repository is removed even when the scenario throws
 */
export function withTempRepo(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-safety-"));
  try {
    runGit(root, ["init", "-q"]);
    writeFile(root, "README.md", "# fixture\n");
    commitAll(root, "initial");
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Run one unborn-repository scenario that mirrors a user's first commit.
 *
 * @param fn - required callback given a repo with no HEAD; absence means no scenario
 * @returns nothing; the fixture repository is removed even when the scenario throws
 */
export function withUnbornTempRepo(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-safety-"));
  try {
    runGit(root, ["init", "-q"]);
    fn(root);
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
 * Run the real hook against a fixture repo and capture its verdict.
 * The scanner variant is chosen by env so the same case can prove both implementations.
 *
 * @param root - non-empty fixture root the user expects the hook to scan
 * @param env - overrides merged onto the process env; absent means the default scanner
 * @param stdinPayload - optional provider JSON; absent means a direct user run
 * @returns the finished process; null status means Bash did not start for the user
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
 * @returns the finished command; a null status means Bash could not start for the user
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
 * @returns the completed hook process; a null status means Bash could not launch
 */
function runHookProcess(
  root: string,
  hookArguments: string[],
  env?: Record<string, string>,
  stdinPayload?: string,
): ReturnType<typeof spawnSync> {
  // A direct run has no provider payload, so closed stdin lets scanning start immediately.
  if (stdinPayload === undefined) {
    return spawnSync("bash", [HOOK_PATH, ...hookArguments], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
  }

  const payloadDirectory = mkdtempSync(
    join(tmpdir(), "goat-flow-post-turn-payload-"),
  );
  const payloadPath = join(payloadDirectory, "stdin.json");
  writeFileSync(payloadPath, stdinPayload);
  const payloadFileDescriptor = openSync(payloadPath, "r");
  try {
    return spawnSync("bash", [HOOK_PATH, ...hookArguments], {
      cwd: root,
      encoding: "utf8",
      stdio: [payloadFileDescriptor, "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
  } finally {
    closeSync(payloadFileDescriptor);
    rmSync(payloadDirectory, { recursive: true, force: true });
  }
}

/** Build the supported Stop payload a coding agent sends after the user's turn.
 *
 * @param sessionId - stable provider session; empty is intentionally invalid
 * @param stopHookActive - true means this is a continuation caused by the prior block
 * @returns bounded JSON consumed on stdin; never null or empty
 */
export function buildStopPayload(
  sessionId: string,
  stopHookActive: boolean,
): string {
  return JSON.stringify({
    session_id: sessionId,
    hook_event_name: "Stop",
    stop_hook_active: stopHookActive,
  });
}

/**
 * Put one deterministic command shim first on PATH for a bounded failure fixture.
 * The supplied body exits on its target invocation; other calls fall through to
 * the real command using the original PATH.
 *
 * @param command - required command name; empty cannot produce a usable shim
 * @param scriptBody - failure predicate; empty delegates every call to the real command
 * @param fn - required scenario callback given the shim environment; absence runs no proof
 * @returns nothing; the temporary shim is removed after the scenario
 */
export function withCommandShim(
  command: string,
  scriptBody: string,
  fn: (env: Record<string, string>) => void,
): void {
  const shimRoot = mkdtempSync(join(tmpdir(), "goat-flow-post-turn-shim-"));
  // A missing PATH represents a user environment where only the test shim is discoverable.
  const originalPath = process.env.PATH ?? "";
  try {
    const commandPath = join(shimRoot, command);
    writeFileSync(
      commandPath,
      [
        "#!/usr/bin/env bash",
        "set -u",
        scriptBody,
        `PATH="\${GOAT_FLOW_TEST_ORIGINAL_PATH:?}" exec ${command} "$@"`,
        "",
      ].join("\n"),
    );
    chmodSync(commandPath, 0o755);
    fn({
      PATH: `${shimRoot}${delimiter}${originalPath}`,
      GOAT_FLOW_TEST_ORIGINAL_PATH: originalPath,
    });
  } finally {
    rmSync(shimRoot, { recursive: true, force: true });
  }
}

/** Prove an infrastructure failure blocks without masquerading as a user finding.
 *
 * @param root - non-empty fixture root whose scan must remain incomplete
 * @param env - required failure controls; empty means no fault was injected
 * @returns the blocked process; null status means Bash did not start and fails the assertion
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
