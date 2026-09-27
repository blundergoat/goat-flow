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
    profileMode?: string;
    firstAttempt?: "reject" | "succeed";
    packMode?: "stable" | "change-on-third";
    token?: string;
    nodeAuthToken?: string;
  } = {},
) {
  const workspace = mkdtempSync(join(tmpdir(), "goat-flow-npm-publish-"));
  workspaces.push(workspace);
  const npmLog = join(workspace, "npm.log");
  const npmCommand = join(workspace, "npm");
  writeFileSync(
    npmCommand,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'command:%s\\n' "$*" >> "$MOCK_NPM_LOG"
case "$1" in
  whoami) printf 'publisher\\n' ;;
  profile) printf '%s\\n' "$MOCK_PROFILE_MODE" ;;
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
    printf 'publish-otp:%s\\n' "\${NPM_CONFIG_OTP:-}" >> "$MOCK_NPM_LOG"
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
      MOCK_NPM_LOG: npmLog,
      MOCK_PROFILE_MODE: runConfig.profileMode ?? "auth-and-writes",
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

  it("stops before the expensive gate when account 2FA cannot authorize writes", () => {
    const { result, log } = runPublishScript("1\n", {
      profileMode: "auth-only",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /interactive publishing requires account 2FA/u);
    assert.doesNotMatch(log, /command:run publish:check/u);
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
});
