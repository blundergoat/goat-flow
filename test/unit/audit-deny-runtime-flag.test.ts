/**
 * Locks the explicit trust contract for audit-backed target execution.
 * Static/default paths may parse target hook files, but only `--trusted-target`
 * may run a managed self-test or configured launcher from the selected checkout.
 */
import { createRequire, syncBuiltinESMExports } from "node:module";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { runAudit } from "../../src/cli/audit/audit.js";
import { CLIError } from "../../src/cli/cli-error.js";
import { parseCLIArgs } from "../../src/cli/cli.js";
import { createFS } from "../../src/cli/facts/fs.js";
import { PROJECT_ROOT } from "./audit-command/helpers.js";

const require = createRequire(import.meta.url);
const childProcess =
  require("node:child_process") as typeof import("node:child_process");
const originalExecFileSync = childProcess.execFileSync;
const originalSpawnSync = childProcess.spawnSync;

afterEach(() => {
  childProcess.execFileSync = originalExecFileSync;
  childProcess.spawnSync = originalSpawnSync;
  syncBuiltinESMExports();
});

describe("target execution trust flags", () => {
  for (const testCase of [
    {
      name: "defaults to static target inspection",
      args: ["audit", "."],
      trusted: false,
      untrusted: false,
    },
    {
      name: "accepts the affirmative trusted-target choice",
      args: ["audit", ".", "--trusted-target"],
      trusted: true,
      untrusted: false,
    },
    {
      name: "keeps untrusted-target as a static compatibility alias",
      args: ["audit", ".", "--untrusted-target"],
      trusted: false,
      untrusted: true,
    },
  ] as const) {
    it(testCase.name, () => {
      const parsed = parseCLIArgs([...testCase.args]);
      assert.equal(parsed.isTargetTrusted, testCase.trusted);
      assert.equal(parsed.isTargetUntrusted, testCase.untrusted);
    });
  }

  it("rejects contradictory trusted and untrusted choices as usage error", () => {
    assert.throws(
      () =>
        parseCLIArgs(["audit", ".", "--trusted-target", "--untrusted-target"]),
      (error: unknown) =>
        error instanceof CLIError &&
        error.exitCode === 2 &&
        /cannot be used together/u.test(error.message),
    );
  });
});

/** Return a successful configured-launcher probe while recording that target code was requested. */
function configuredProbeResult(
  hookInput: string,
): ReturnType<typeof childProcess.spawnSync> {
  const isAllowedProbe = hookInput.includes("echo safe");
  const blockedMessage = "BLOCKED: Policy repository: git push is not allowed.";
  return {
    status: isAllowedProbe ? 0 : 2,
    signal: null,
    error: undefined,
    output: [null, "", isAllowedProbe ? "" : blockedMessage],
    pid: 0,
    stdout: "",
    stderr: isAllowedProbe ? "" : blockedMessage,
  } as ReturnType<typeof childProcess.spawnSync>;
}

describe("audit library target execution default", () => {
  it("does not run a managed self-test or configured launcher when evidence level is omitted", () => {
    let managedSelfTestCount = 0;
    let configuredLauncherCount = 0;
    childProcess.execFileSync = ((command, args) => {
      if (command === "bash" && args?.includes("--self-test=smoke")) {
        managedSelfTestCount += 1;
      }
      return Buffer.from("");
    }) as typeof childProcess.execFileSync;
    childProcess.spawnSync = ((_command, _args, options) => {
      const hookInput = String(
        (options as { env?: NodeJS.ProcessEnv } | undefined)?.env
          ?.GOAT_HOOK_SMOKE_PAYLOAD ??
          (options as { input?: string } | undefined)?.input ??
          "",
      );
      if (hookInput !== "") configuredLauncherCount += 1;
      return configuredProbeResult(hookInput);
    }) as typeof childProcess.spawnSync;
    syncBuiltinESMExports();

    runAudit(createFS(PROJECT_ROOT), PROJECT_ROOT, {
      agentFilter: "codex",
      harness: false,
      checkDrift: false,
    });

    assert.equal(managedSelfTestCount, 0);
    assert.equal(configuredLauncherCount, 0);
  });

  it("retains runtime proof when the caller explicitly requests full evidence", () => {
    let configuredLauncherCount = 0;
    childProcess.execFileSync = (() =>
      Buffer.from("")) as typeof childProcess.execFileSync;
    childProcess.spawnSync = ((_command, _args, options) => {
      const hookInput = String(
        (options as { env?: NodeJS.ProcessEnv } | undefined)?.env
          ?.GOAT_HOOK_SMOKE_PAYLOAD ??
          (options as { input?: string } | undefined)?.input ??
          "",
      );
      if (hookInput !== "") configuredLauncherCount += 1;
      return configuredProbeResult(hookInput);
    }) as typeof childProcess.spawnSync;
    syncBuiltinESMExports();

    runAudit(createFS(PROJECT_ROOT), PROJECT_ROOT, {
      agentFilter: "codex",
      harness: false,
      checkDrift: false,
      denyMechanismEvidenceLevel: "full",
    });

    assert.ok(
      configuredLauncherCount > 0,
      "explicit full evidence should execute the configured target launcher",
    );
  });
});
