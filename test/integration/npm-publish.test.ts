/** Exercise the maintainer's publish prompts without contacting the npm registry. */
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
const workspaces: string[] = [];

after(() => {
  for (const workspace of workspaces)
    rmSync(workspace, { recursive: true, force: true });
});

/**
 * Exercise the release script against a disposable npm shim.
 * Side effects: writes temporary files and spawns Bash; the after hook removes them.
 */
function runPublishScript(
  input: string,
  runConfig: {
    authenticated?: boolean;
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
  const result = spawnSync("bash", [SCRIPT], {
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
    assert.equal(log.match(/command:run publish:check/gu)?.length, 1);
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
    assert.equal(log.match(/command:run publish:check/gu)?.length, 1);
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
