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
      // Trusted audit requires a selected agent; see "rejects trusted audit without a selected agent".
      args: ["audit", ".", "--agent", "claude", "--trusted-target"],
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

  it("rejects trusted audit without a selected agent", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--trusted-target"]),
      (error: unknown) =>
        error instanceof CLIError &&
        error.exitCode === 2 &&
        /--agent/u.test(error.message),
    );
  });

  it("rejects trust choices on routes that cannot execute target code", () => {
    for (const args of [
      ["install", ".", "--trusted-target"],
      ["setup", ".", "--apply", "--trusted-target"],
      ["setup", ".", "--dry-run", "--untrusted-target"],
      ["quality", "history", "--trusted-target"],
      ["hooks", "list", "--trusted-target"],
      ["status", ".", "--untrusted-target"],
    ]) {
      assert.throws(
        () => parseCLIArgs(args),
        (error: unknown) =>
          error instanceof CLIError &&
          error.exitCode === 2 &&
          /only valid for audit, setup prompt, quality prompt, or hooks verify/u.test(
            error.message,
          ),
        args.join(" "),
      );
    }
  });

  it("rejects trusted audit without a selected agent", () => {
    // Trusted audit reports `full` deny-mechanism evidence, but the runtime deny check only runs
    // for a selected agent. Without `--agent` the report would claim proof nothing produced, so the
    // omission is refused as a usage error before any audit executes.
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--trusted-target"]),
      (error: unknown) =>
        error instanceof CLIError &&
        error.exitCode === 2 &&
        /--agent/u.test(error.message),
    );
  });

  it("accepts trust choices only on target-executing routes", () => {
    for (const args of [
      ["audit", ".", "--agent", "claude", "--trusted-target"],
      ["setup", ".", "--trusted-target"],
      ["quality", ".", "--agent", "claude", "--trusted-target"],
      [
        "hooks",
        "verify",
        ".",
        "--agent",
        "codex",
        "--scenario",
        "deny-hook",
        "--trusted-target",
      ],
    ]) {
      const parsed = parseCLIArgs(args);
      assert.equal(parsed.isTargetTrusted, true, args.join(" "));
      assert.equal(parsed.isTargetUntrusted, false, args.join(" "));
    }
  });

  it("accepts setup dry-run authority flags as preview inputs", () => {
    const parsed = parseCLIArgs([
      "setup",
      ".",
      "--dry-run",
      "--force-managed",
      "--force-user-owned",
      "--force-path",
      ".goat-flow/config.yaml",
      "--update-config-version",
    ]);

    assert.equal(parsed.shouldDryRun, true);
    assert.equal(parsed.shouldForceManaged, true);
    assert.equal(parsed.shouldForceUserOwned, true);
    assert.deepEqual(parsed.forcePaths, [".goat-flow/config.yaml"]);
    assert.equal(parsed.updateConfigVersion, true);
  });
});

describe("setup runtime evidence identity", () => {
  it("requires the trusted runtime probe to name the rendered agent", async () => {
    const { setupDenyMechanismEvidenceLevel } =
      await import("../../src/cli/cli-handlers.js");

    assert.equal(
      setupDenyMechanismEvidenceLevel(
        { agent: null, isTargetTrusted: true },
        "claude",
      ),
      "static",
    );
    assert.equal(
      setupDenyMechanismEvidenceLevel(
        { agent: "claude", isTargetTrusted: true },
        "claude",
      ),
      "full",
    );
    assert.equal(
      setupDenyMechanismEvidenceLevel(
        { agent: "claude", isTargetTrusted: true },
        "codex",
      ),
      "static",
    );
  });
});

describe("spawn failure identity", () => {
  it("names the executable that a configured handler attempted", async () => {
    const { spawnFailureFor } =
      await import("../../src/cli/audit/check-agent-deny-runtime.js");
    const error = Object.assign(new Error("not found"), { code: "ENOENT" });

    const failure = spawnFailureFor(error, "configured hook", "node");

    assert.match(failure?.message ?? "", /could not spawn node/u);
    assert.match(failure?.howToFix ?? "", /Install node/u);
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
