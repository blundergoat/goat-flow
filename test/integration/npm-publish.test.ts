/** Exercise the maintainer's publish prompts without contacting the npm registry or GitHub. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const SCRIPT = join(PROJECT_ROOT, "scripts/npm-publish.sh");
const npmLookup = spawnSync("bash", ["-c", "command -v npm"], {
  encoding: "utf8",
});
assert.equal(
  npmLookup.status,
  0,
  "npm must be available for OTP config checks",
);
const REAL_NPM = npmLookup.stdout.trim();
const MOCK_HEAD = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const CI_PASSED = '[{"status":"completed","conclusion":"success"}]';
const workspaces: string[] = [];

after(() => {
  for (const workspace of workspaces)
    rmSync(workspace, { recursive: true, force: true });
});

/**
 * Exercise the release script against disposable npm, git, and gh shims.
 * Side effects: writes temporary files and spawns Bash; the after hook removes them.
 */
function runPublishScript(
  input: string,
  runConfig: {
    args?: string[];
    authenticated?: boolean;
    published?: boolean;
    ciRuns?: string;
    gitStatus?: string;
    firstAttempt?: "reject" | "succeed";
    packMode?: "stable" | "change-on-third";
    token?: string;
    nodeAuthToken?: string;
    inheritedOtp?: string;
  } = {},
) {
  const workspace = mkdtempSync(join(tmpdir(), "goat-flow-npm-publish-"));
  workspaces.push(workspace);
  const npmLog = join(workspace, "npm.log");
  const npmCommand = join(workspace, "npm");
  const npmUserConfig = join(workspace, "npm-user-config");
  writeFileSync(
    npmUserConfig,
    runConfig.inheritedOtp ? `otp=${runConfig.inheritedOtp}\n` : "",
  );
  writeFileSync(
    npmCommand,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'command:%s\\n' "$*" >> "$MOCK_NPM_LOG"
case "$1" in
  whoami)
    if [[ "$MOCK_AUTHENTICATED" != 1 ]]; then
      printf 'npm error code E401\\n' >&2
      exit 1
    fi
    printf 'publisher\\n'
    ;;
  profile) printf 'npm error code E403\\n' >&2; exit 1 ;;
  view)
    if [[ "$MOCK_PUBLISHED" != 1 ]]; then printf 'npm error code E404\\n' >&2; exit 1; fi
    printf '%s\\n' "\${2##*@}"
    ;;
  run) : ;;
  pack)
    count=0
    if [[ -f "$MOCK_PACK_COUNT" ]]; then count=$(<"$MOCK_PACK_COUNT"); fi
    count=$((count + 1))
    printf '%s' "$count" > "$MOCK_PACK_COUNT"
    shasum=a80d73a9daaa5698c30ff75bd9fa3d63542a6bd0
    if [[ "$MOCK_PACK_MODE" == change-on-third && "$count" -ge 3 ]]; then
      shasum=b80d73a9daaa5698c30ff75bd9fa3d63542a6bd0
    fi
    printf '[{"shasum":"%s"}]\\n' "$shasum"
    ;;
  publish)
    if [[ " $* " == *" --dry-run "* ]]; then exit 0; fi
    # Use npm's real config parser, but never its publish command.
    otp_flags=()
    for arg in "$@"; do
      case "$arg" in --otp=*) otp_flags+=("$arg") ;; esac
    done
    effective_otp=$(
      cd "$MOCK_WORKSPACE"
      "$MOCK_REAL_NPM" config get otp "\${otp_flags[@]}"
    )
    if [[ "$effective_otp" == null ]]; then effective_otp=""; fi
    printf 'publish-otp:%s\\n' "$effective_otp" >> "$MOCK_NPM_LOG"
    if [[ "$MOCK_FAIL_FIRST_PUBLISH" == 1 && ! -f "$MOCK_FIRST_PUBLISH_MARKER" ]]; then
      : > "$MOCK_FIRST_PUBLISH_MARKER"
      printf 'simulated publish rejection\\n' >&2
      exit 1
    fi
    ;;
esac
`,
  );
  chmodSync(npmCommand, 0o755);
  const gitCommand = join(workspace, "git");
  writeFileSync(
    gitCommand,
    `#!/usr/bin/env bash
case "$1" in
  rev-parse) printf '%s\\n' "$MOCK_GIT_HEAD" ;;
  status) if [[ -n "$MOCK_GIT_STATUS" ]]; then printf '%s\\n' "$MOCK_GIT_STATUS"; fi ;;
  *) printf 'unexpected git call: %s\\n' "$*" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(gitCommand, 0o755);
  // Runs are reported only for the query the script must make: CI push runs for the mocked HEAD commit.
  const ghCommand = join(workspace, "gh");
  writeFileSync(
    ghCommand,
    `#!/usr/bin/env bash
printf 'gh:%s\\n' "$*" >> "$MOCK_NPM_LOG"
if [[ " $* " == *" --commit $MOCK_GIT_HEAD "* && " $* " == *" --workflow ci.yml "* && " $* " == *" --event push "* ]]; then
  printf '%s\\n' "$MOCK_CI_RUNS"
else
  printf '[]\\n'
fi
`,
  );
  chmodSync(ghCommand, 0o755);
  const result = spawnSync("bash", [SCRIPT, ...(runConfig.args ?? [])], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    input,
    env: {
      PATH: `${workspace}:${process.env.PATH ?? ""}`,
      HOME: workspace,
      NPM_TOKEN: runConfig.token ?? "",
      NODE_AUTH_TOKEN: runConfig.nodeAuthToken ?? "",
      NPM_CONFIG_USERCONFIG: npmUserConfig,
      NPM_CONFIG_GLOBALCONFIG: join(workspace, "npm-global-config"),
      ...(runConfig.inheritedOtp
        ? {
            npm_config_otp: runConfig.inheritedOtp,
            NPM_CONFIG_OTP: runConfig.inheritedOtp,
          }
        : {}),
      MOCK_NPM_LOG: npmLog,
      MOCK_REAL_NPM: REAL_NPM,
      MOCK_WORKSPACE: workspace,
      MOCK_AUTHENTICATED: runConfig.authenticated === false ? "0" : "1",
      MOCK_PUBLISHED: runConfig.published ? "1" : "0",
      MOCK_GIT_HEAD: MOCK_HEAD,
      MOCK_GIT_STATUS: runConfig.gitStatus ?? "",
      MOCK_CI_RUNS: runConfig.ciRuns ?? "[]",
      MOCK_FAIL_FIRST_PUBLISH: runConfig.firstAttempt === "reject" ? "1" : "0",
      MOCK_FIRST_PUBLISH_MARKER: join(workspace, "first-publish"),
      MOCK_PACK_MODE: runConfig.packMode ?? "stable",
      MOCK_PACK_COUNT: join(workspace, "pack-count"),
    },
  });
  return { result, log: readFileSync(npmLog, "utf8") };
}

describe("npm publish helper", () => {
  it("accepts a fresh 2FA code on retry without repeating the full release check", () => {
    const { result, log } = runPublishScript("1\ny\n123456\ny\n654321\n", {
      firstAttempt: "reject",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(log.match(/command:run publish:check\n/gu)?.length, 1);
    assert.deepEqual(log.match(/publish-otp:\d+/gu), [
      "publish-otp:123456",
      "publish-otp:654321",
    ]);
    assert.equal(log.match(/command:pack /gu)?.length, 3);
    assert.doesNotMatch(result.stdout + result.stderr, /123456|654321/u);
  });

  it("continues with interactive 2FA when login succeeds but profile access is unavailable", () => {
    const { result, log } = runPublishScript("\ny\n123456\n");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(log.match(/command:run publish:check\n/gu)?.length, 1);
    assert.match(log, /publish-otp:123456/u);
  });

  it("stops before the expensive gate when npm is not authenticated", () => {
    const { result, log } = runPublishScript("", { authenticated: false });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /npm error code E401/u);
    assert.match(result.stderr, /unable to verify npm login/u);
    assert.doesNotMatch(log, /command:run publish:check/u);
    assert.doesNotMatch(log, /command:publish /u);
  });

  it("stops before the release check when this version is already on npm", () => {
    const { result, log } = runPublishScript("", { published: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is already on npm/u);
    assert.doesNotMatch(log, /command:whoami|command:run /u);
  });

  it("skips the local test suites when CI's push run passed for this exact commit", () => {
    const { result, log } = runPublishScript("1\ny\n123456\n", {
      ciRuns: CI_PASSED,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(log, /command:run publish:check:quick\n/u);
    assert.doesNotMatch(log, /command:run publish:check\n/u);
    assert.match(log, /publish-otp:123456/u);
  });

  for (const fallback of [
    {
      reason: "CI failed for this commit",
      runConfig: {
        ciRuns: '[{"status":"completed","conclusion":"failure"}]',
      },
    },
    {
      reason: "the working tree has uncommitted changes",
      runConfig: { ciRuns: CI_PASSED, gitStatus: " M workflow/fixture.md" },
      stdout:
        /uncommitted changes\. Packaged files[^\n]*\n {2} M workflow\/fixture\.md/u,
    },
    {
      reason: "--full is passed",
      runConfig: { ciRuns: CI_PASSED, args: ["--full"] },
    },
  ]) {
    it(`runs the full release check when ${fallback.reason}`, () => {
      const { result, log } = runPublishScript(
        "1\ny\n123456\n",
        fallback.runConfig,
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(log.match(/command:run publish:check\n/gu)?.length, 1);
      assert.doesNotMatch(log, /command:run publish:check:quick/u);
      if (fallback.stdout) assert.match(result.stdout, fallback.stdout);
    });
  }

  it("requires a fresh release check if the tarball changes before retry", () => {
    const { result, log } = runPublishScript("1\ny\n123456\ny\n", {
      firstAttempt: "reject",
      packMode: "change-on-third",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /package contents changed since the dry run/u);
    assert.deepEqual(log.match(/publish-otp:\d+/gu), ["publish-otp:123456"]);
  });

  it("accepts one bypass token without asking for an OTP", () => {
    const { result, log } = runPublishScript("2\ny\n", {
      token: "fixture-token",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Credential source: NPM_TOKEN/u);
    assert.doesNotMatch(log, /command:profile /u);
    assert.match(log, /publish-otp:\n/u);
  });

  it("accepts an authenticated npm config credential without parsing npm config output", () => {
    const { result, log } = runPublishScript("2\ny\n");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Credential source: npm config or npm login/u);
    assert.doesNotMatch(log, /command:config /u);
    assert.doesNotMatch(log, /command:profile /u);
  });

  it("accepts NODE_AUTH_TOKEN as an alternative token variable", () => {
    const { result, log } = runPublishScript("2\ny\n", {
      nodeAuthToken: "fixture-token",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Credential source: NODE_AUTH_TOKEN/u);
    assert.match(log, /publish-otp:\n/u);
  });

  for (const code of ["123456", ""]) {
    it(`overrides stale OTP settings with ${code ? "a fresh code" : "npm's own prompt"}`, () => {
      const { result, log } = runPublishScript(`1\ny\n${code}\n`, {
        inheritedOtp: "654321",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.ok(log.includes(`publish-otp:${code}\n`));
      assert.doesNotMatch(log, /publish-otp:654321/u);
      assert.doesNotMatch(result.stdout + result.stderr, /123456|654321/u);
    });
  }
});
