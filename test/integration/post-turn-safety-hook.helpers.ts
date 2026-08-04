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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

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

/** Writes and removes one committed temporary repository around a safety-hook scenario.
 *
 * @param fn - the case body, given a repo root with one clean initial commit; the repo is
 *   removed afterwards even when the body throws
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

/** Writes and removes one unborn temporary repository around a first-commit scenario.
 *
 * @param fn - the case body, given a repo root whose HEAD does not exist yet - the state
 *   before a first commit, which the scanner must handle without a diff base
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
 * @param root - fixture repo root
 * @param path - repo-relative file to write; parent directories are created
 * @param content - exact bytes the scanner will read
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
 * @param root - fixture repo the command runs in
 * @param args - git arguments verbatim
 * @returns trimmed stdout; a non-zero exit fails the test with both streams attached
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
 * @param root - fixture repo root
 * @param message - commit message; identity is pinned so fixtures commit anywhere
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
 * @param root - fixture repo the hook scans
 * @param env - overrides merged onto the process env; absent means the default scanner
 * @returns the finished process; status 0 means the turn is allowed to stop
 */
export function runHook(
  root: string,
  env?: Record<string, string>,
): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [HOOK_PATH], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

/**
 * Normalize scanner-specific prose to the common finding-family/path decision.
 *
 * Callers compare these signatures across scanner implementations, so the
 * returned shape is a stable contract: same family and path in, same signature
 * out, regardless of which scanner produced the wording.
 *
 * @param stderr - the hook's stderr for one run
 * @returns sorted finding signatures; empty means the hook reported nothing blocked
 */
export function hookFindingSignatures(stderr: string): string[] {
  return stderr
    .split("\n")
    .flatMap((line) => {
      const nativePrefix = "post-turn-safety: blocked ";
      const compatibilityPrefix = "post-turn-safety: ";
      const compatibilitySuffix = " (Bash 3 compatibility scan).";
      if (line.startsWith(nativePrefix)) {
        return [line.slice(nativePrefix.length)];
      }
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
 * @param root - fixture repo expected to pass
 * @param env - scanner selection; absent proves both scanners agree on the allow
 */
export function assertHookAllows(
  root: string,
  env?: Record<string, string>,
): void {
  const explicitlySelectedScanner = env?.[FORCE_BASH3_ENV_KEY] !== undefined;
  const result = runHook(
    root,
    explicitlySelectedScanner
      ? env
      : { ...(env ?? {}), [FORCE_BASH3_ENV_KEY]: "0" },
  );
  assert.equal(
    result.status,
    0,
    `hook should allow fixture\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  if (!explicitlySelectedScanner) {
    const compatibilityResult = runHook(root, {
      ...(env ?? {}),
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
 * @param root - fixture repo expected to fail
 * @param expectedPattern - pattern the block message must match so the author knows why
 * @param env - scanner selection; absent proves both scanners agree on the block
 * @returns the blocking run, so a caller can assert further on its exact output
 */
export function assertHookBlocks(
  root: string,
  expectedPattern: RegExp,
  env?: Record<string, string>,
): ReturnType<typeof spawnSync> {
  const explicitlySelectedScanner = env?.[FORCE_BASH3_ENV_KEY] !== undefined;
  const result = runHook(
    root,
    explicitlySelectedScanner
      ? env
      : { ...(env ?? {}), [FORCE_BASH3_ENV_KEY]: "0" },
  );
  assert.equal(
    result.status,
    2,
    `hook should block fixture\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stderr, expectedPattern);
  assert.doesNotMatch(result.stderr, /validation/u);
  if (!explicitlySelectedScanner) {
    const compatibilityResult = runHook(root, {
      ...(env ?? {}),
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
