/**
 * Proves the hook status chain users see after setup, drift, or tampering.
 * Use these fixtures when registry evidence, registration commands, installed
 * bytes, trust checks, or repair guidance changes across CLI and dashboard views.
 * Every project is disposable and no provider model is launched.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runAudit } from "../../src/cli/audit/audit.js";
import {
  renderAuditJson,
  renderAuditText,
} from "../../src/cli/audit/render.js";
import { createFS } from "../../src/cli/facts/fs.js";
import {
  createManagedInstallStateRow,
  writeManagedInstallStateV2,
} from "../../src/cli/managed-setup-state.js";
import { hashFile } from "../../src/cli/managed-setup-write-set.js";
import { HOOK_VERIFICATION_CONTRACTS } from "../../src/cli/hook-verification-contracts.js";
import {
  applyHookState,
  readAllHookStates,
  syncHookStates,
  type HookAgentState,
  type HookState,
} from "../../src/cli/server/hook-registrar.js";
import { writeAgentHookState } from "../../src/cli/server/agent-hook-writer.js";
import { PROFILES } from "../../src/cli/detect/agents.js";
import {
  currentHookProviderSupportGate,
  getHookSpec,
  type HookDeliveryContract,
  type HookProviderRegistryEvidence,
} from "../../src/cli/server/hooks-registry.js";
import { verifyManagedDenyHook } from "../../src/cli/hooks-runtime-evidence.js";
import { verifyManagedConfiguredHook } from "../../src/cli/hooks-configured-runtime-evidence.js";
import { countOwnedCommandRows } from "../unit/hook-registrar.helpers.js";

const disposableProjects: string[] = [];

/** Minimal Claude settings shape used only to move or alter managed fixture entries. */
interface ClaudeHookSettingsFixture {
  hooks: Record<
    string,
    Array<{
      matcher?: string;
      hooks?: Array<{ command?: string; args?: string[]; timeout?: number }>;
    }>
  >;
}

/** Remove every project created by this suite after its user-state assertions finish. */
after(() => {
  // Each recorded path is a suite-owned temporary directory, never a user workspace.
  for (const disposableProjectPath of disposableProjects) {
    rmSync(disposableProjectPath, { recursive: true, force: true });
  }
});

/**
 * Create the smallest Claude project that the registrar may safely reconcile.
 * Side effects: creates and writes one disposable project removed by suite cleanup.
 */
function createClaudeProject(): string {
  const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-hook-state-"));
  disposableProjects.push(projectPath);
  mkdirSync(join(projectPath, ".goat-flow"), { recursive: true });
  mkdirSync(join(projectPath, ".claude"), { recursive: true });
  writeFileSync(
    join(projectPath, ".goat-flow", "config.yaml"),
    'version: "1.15.0"\n',
  );
  writeFileSync(join(projectPath, ".claude", "settings.json"), "{}\n");
  return projectPath;
}

/** Create the smallest Codex project whose generated handlers can be replayed on Windows. */
function createCodexProject(): string {
  const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-codex-state-"));
  disposableProjects.push(projectPath);
  mkdirSync(join(projectPath, ".goat-flow"), { recursive: true });
  mkdirSync(join(projectPath, ".codex"), { recursive: true });
  writeFileSync(
    join(projectPath, ".goat-flow", "config.yaml"),
    'version: "1.15.0"\n',
  );
  writeFileSync(join(projectPath, ".codex", "config.toml"), "\n");
  return projectPath;
}

/**
 * Record previous managed hook bytes for one disposable agent install.
 * Filesystem side effects: writes that fixture's hash-only install-state JSON.
 * Invariant: each stored hash represents the exact fixture bytes present when this helper runs.
 */
function recordManagedHookBaseline(
  projectPath: string,
  agentId: "claude" | "codex",
  managedPaths: readonly string[],
): void {
  const stateDirectory = join(projectPath, ".goat-flow", "install-state");
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(
    join(stateDirectory, `${agentId}.json`),
    `${JSON.stringify(
      {
        schemaVersion: "goat-flow.install-state.v1",
        agent: agentId,
        goatFlowVersion: "previous-test-version",
        files: managedPaths.map((managedPath) => ({
          path: managedPath,
          expectedSha256: hashFile(join(projectPath, managedPath)),
        })),
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Publish canonical v2 rows for the fixture bytes currently present on disk.
 * Filesystem side effects: atomically writes managed.json inside the disposable project.
 * Invariant: retained v1 files cannot override these path-keyed hashes.
 */
function recordCanonicalManagedHookBaseline(
  projectPath: string,
  managedPaths: readonly string[],
): void {
  writeManagedInstallStateV2(projectPath, {
    schemaVersion: "goat-flow.install-state.v2",
    files: managedPaths.map((managedPath) =>
      createManagedInstallStateRow({
        path: managedPath,
        expectedSha256: hashFile(join(projectPath, managedPath)),
        provenance: {
          kind: "verified-install",
          goatFlowVersion: "previous-test-version",
        },
      }),
    ),
    receipts: [],
  });
}

/** Return one named hook row; a missing registry hook is an immediate fixture failure. */
function requiredHook(hooks: HookState[], hookId: string): HookState {
  const hook = hooks.find((hookState) => hookState.id === hookId);
  // A missing row means the user-facing registry no longer contains the fixture's hook.
  assert.ok(hook, `missing hook state: ${hookId}`);
  return hook;
}

/** Return Claude's state for one hook so each assertion names the visible agent surface. */
function claudeHookState(projectPath: string, hookId: string): HookAgentState {
  return requiredHook(readAllHookStates(projectPath), hookId).agents.claude;
}

/** Return Codex's state for one hook so Windows replay assertions use its exact registration. */
function codexHookState(projectPath: string, hookId: string): HookAgentState {
  return requiredHook(readAllHookStates(projectPath), hookId).agents.codex;
}

/**
 * Initialize an empty Git worktree so Stop fixtures have a real change boundary.
 * Side effects: spawns `git init`, which writes metadata inside the disposable project.
 */
function initializeDisposableGitProject(projectPath: string): void {
  const gitInitialization = spawnSync("git", ["init", "--quiet"], {
    cwd: projectPath,
    encoding: "utf-8",
  });
  assert.equal(gitInitialization.status, 0, gitInitialization.stderr);
}

/** Enable Gruff in the disposable config before sync writes its exact registered command. */
function enableGruffForProject(projectPath: string): void {
  writeFileSync(
    join(projectPath, ".goat-flow", "config.yaml"),
    [
      'version: "1.15.0"',
      "hooks:",
      "  gruff-code-quality:",
      "    enabled: true",
      "",
    ].join("\n"),
  );
}

/** Read the managed Claude fixture after sync so one exact registration field can be changed. */
function readClaudeHookSettings(
  projectPath: string,
): ClaudeHookSettingsFixture {
  return JSON.parse(
    readFileSync(join(projectPath, ".claude", "settings.json"), "utf-8"),
  ) as ClaudeHookSettingsFixture;
}

/** Write one intentionally drifted Claude fixture; filesystem side effect: replaces disposable settings. */
function writeClaudeHookSettings(
  projectPath: string,
  settings: ClaudeHookSettingsFixture,
): void {
  writeFileSync(
    join(projectPath, ".claude", "settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}

describe("effective hook state", () => {
  /** Invariant: deterministic fixture evidence stays below live support in user-facing state. */
  it("keeps deterministic delivery evidence below live support", () => {
    const denySpec = getHookSpec("deny-dangerous");
    const gruffSpec = getHookSpec("gruff-code-quality");
    assert.ok(denySpec);
    assert.ok(gruffSpec);
    const denyDeliveryContract: HookDeliveryContract | undefined =
      denySpec.deliveryContract;
    const claudeProviderEvidence: HookProviderRegistryEvidence | undefined =
      denySpec.providerEvidence?.claude;
    const antigravityProviderEvidence:
      HookProviderRegistryEvidence | undefined =
      gruffSpec.providerEvidence?.antigravity;
    assert.deepEqual(denyDeliveryContract, {
      resultProtocol: "legacy",
      adapterVersion: "1",
      launcherDeadlineMs: 25_000,
    });
    // Missing Claude evidence fails instead of presenting a fixture as live support.
    assert.equal(
      claudeProviderEvidence?.effectiveSupportGate,
      "scenario-unverified",
    );
    // Missing Antigravity evidence likewise fails the undelivered-result contract.
    assert.equal(
      antigravityProviderEvidence?.effectiveSupportGate,
      "result-undelivered",
    );
  });

  /** Current deny and Gruff proof expire while the uncaptured Stop registration stays stale. */
  it("expires exact Codex proof while keeping uncaptured Stop stale", () => {
    const denySpec = getHookSpec("deny-dangerous");
    const gruffSpec = getHookSpec("gruff-code-quality");
    const postTurnSpec = getHookSpec("post-turn-safety");
    assert.ok(denySpec);
    assert.ok(gruffSpec);
    assert.ok(postTurnSpec);
    const denyCodexEvidence = denySpec.providerEvidence?.codex;
    const gruffCodexEvidence = gruffSpec.providerEvidence?.codex;
    const postTurnCodexEvidence = postTurnSpec.providerEvidence?.codex;
    assert.ok(denyCodexEvidence);
    assert.ok(gruffCodexEvidence);
    assert.ok(postTurnCodexEvidence);

    assert.equal(
      currentHookProviderSupportGate(
        denyCodexEvidence,
        new Date("2026-09-21T02:17:08.834Z"),
      ),
      "scenario-unverified",
    );
    assert.equal(
      currentHookProviderSupportGate(
        denyCodexEvidence,
        new Date("2026-09-21T02:17:08.835Z"),
      ),
      "provider-capture-stale",
    );

    assert.equal(
      currentHookProviderSupportGate(
        gruffCodexEvidence,
        new Date("2026-09-25T20:17:22.830Z"),
      ),
      "scenario-unverified",
    );
    assert.equal(
      currentHookProviderSupportGate(
        gruffCodexEvidence,
        new Date("2026-09-25T20:17:22.831Z"),
      ),
      "provider-capture-stale",
    );

    assert.equal(postTurnCodexEvidence.expiresAt, undefined);
    assert.equal(
      currentHookProviderSupportGate(postTurnCodexEvidence),
      "provider-capture-stale",
    );
  });

  // A desired hook with no exact registration is not protected merely because the registry lists it.
  it("keeps enabled but unregistered hooks non-green", () => {
    const projectPath = createClaudeProject();
    const denyHookState = claudeHookState(projectPath, "deny-dangerous");

    assert.equal(denyHookState.installed, false);
    assert.equal(denyHookState.isRegistered, false);
    assert.equal(denyHookState.registrationIssue, "registration-missing");
    assert.deepEqual(denyHookState.effectiveState, {
      status: "not-registered",
      severity: "warning",
    });
    assert.equal(denyHookState.effectiveStateLabel, "not registered");
    assert.match(denyHookState.repairCommand ?? "", /hooks sync/u);
  });

  // A current local install still stops at the registry's explicit configured-scenario gate.
  it("separates current installation from scenario verification", () => {
    const projectPath = createClaudeProject();
    syncHookStates(projectPath);
    recordCanonicalManagedHookBaseline(projectPath, [
      ".goat-flow/hooks/deny-dangerous.sh",
    ]);
    const denyHookState = claudeHookState(projectPath, "deny-dangerous");

    assert.equal(denyHookState.installed, true);
    assert.equal(denyHookState.isRegistered, true);
    assert.equal(denyHookState.isCurrentVersionInstalled, true);
    assert.equal(denyHookState.isTrusted, true);
    assert.deepEqual(denyHookState.effectiveState, {
      status: "scenario-unverified",
      severity: "warning",
    });
    assert.match(
      denyHookState.repairCommand ?? "",
      /hooks verify .* --agent claude --scenario deny-hook --trusted-target/u,
    );
    assert.equal(
      denyHookState.evidenceIdentity,
      "hook-provider-adapter.v1:claude:pre-tool",
    );
  });

  /**
   * Fixture purpose: omit install state so status cannot guess whether changed bytes are old or local.
   * Side effects: writes one local hook customization inside a disposable project.
   * Invariant: unclassified drift stays command-free until a trusted baseline establishes direction.
   */
  it("keeps installed byte drift unclassified without a baseline", () => {
    const projectPath = createClaudeProject();
    initializeDisposableGitProject(projectPath);
    syncHookStates(projectPath);
    const hookScriptPath = join(
      projectPath,
      ".goat-flow",
      "hooks",
      "post-turn-safety.sh",
    );
    writeFileSync(
      hookScriptPath,
      `${readFileSync(hookScriptPath, "utf-8")}\n# user edit\n`,
    );
    const postTurnState = claudeHookState(projectPath, "post-turn-safety");

    assert.equal(postTurnState.isRegistered, true);
    assert.equal(postTurnState.isCurrentVersionInstalled, false);
    assert.equal(
      postTurnState.installationIssue,
      "installed-version-unclassified",
    );
    assert.deepEqual(postTurnState.effectiveState, {
      status: "installation-stale",
      severity: "warning",
    });
    assert.equal(postTurnState.repairCommand, null);
    assert.match(
      postTurnState.repairSummary,
      /No matching previous-install baseline proves the drift direction/u,
    );
  });

  /**
   * Fixture purpose: gives one shared hook a canonical row that contradicts retained Codex evidence.
   * Side effects: writes v1 and v2 state, one older managed script, and one removed orphan fixture.
   * Invariant: Claude reads the path row from managed.json; neither agent identity nor an orphan row changes it.
   */
  it("uses the canonical row for shared hook bytes despite retained agent evidence", () => {
    const projectPath = createClaudeProject();
    syncHookStates(projectPath);
    const managedPath = ".goat-flow/hooks/deny-dangerous.sh";
    const hookScriptPath = join(projectPath, managedPath);
    recordManagedHookBaseline(projectPath, "codex", [managedPath]);
    writeFileSync(
      hookScriptPath,
      "#!/usr/bin/env bash\n# previous package bytes\n",
    );
    const orphanPath = ".goat-flow/hooks/retired-orphan.sh";
    writeFileSync(join(projectPath, orphanPath), "retired managed bytes\n");
    recordCanonicalManagedHookBaseline(projectPath, [managedPath, orphanPath]);
    unlinkSync(join(projectPath, orphanPath));

    const denyState = claudeHookState(projectPath, "deny-dangerous");

    assert.equal(denyState.installationIssue, "installed-version-behind");
    assert.match(
      denyState.repairSummary,
      /previous-install baseline.*safely advances/iu,
    );
  });

  /**
   * Fixture purpose: stores an exact managed Antigravity command under a noncanonical sibling id.
   * Filesystem side effects: rewrites one disposable provider config and requests managed removal.
   * Invariant: ownership follows the exact script reference while unrelated definitions remain user-owned.
   */
  it("removes an Antigravity alias that references the exact managed script", () => {
    const projectPath = createClaudeProject();
    const denySpec = getHookSpec("deny-dangerous");
    assert.ok(denySpec);
    writeAgentHookState(projectPath, PROFILES.antigravity, denySpec, true);
    const configPath = join(projectPath, ".agents", "hooks.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    config["renamed-managed-policy"] = config["deny-dangerous"];
    delete config["deny-dangerous"];
    config["team-audit"] = {
      enabled: true,
      PreToolUse: [
        {
          matcher: "run_command",
          hooks: [{ type: "command", command: "./scripts/team-audit.sh" }],
        },
      ],
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    writeAgentHookState(projectPath, PROFILES.antigravity, denySpec, false);

    const cleaned = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    assert.equal(countOwnedCommandRows(cleaned, denySpec), 0);
    assert.ok(cleaned["team-audit"]);
  });

  /**
   * Fixture purpose: locally diverges a registered script after recording its prior managed hash.
   * Filesystem side effects: toggles the disposable hook off while preserving its inert edited bytes.
   * Invariant: disabling unregisters execution and never needs authority to refresh dormant files.
   */
  it("disables a diverged hook without refreshing its managed files", () => {
    const projectPath = createClaudeProject();
    syncHookStates(projectPath);
    const managedPath = ".goat-flow/hooks/deny-dangerous.sh";
    recordCanonicalManagedHookBaseline(projectPath, [managedPath]);
    const hookPath = join(projectPath, managedPath);
    const localBytes = `${readFileSync(hookPath, "utf-8")}\n# local disabled copy\n`;
    writeFileSync(hookPath, localBytes);

    const disabled = applyHookState("deny-dangerous", false, projectPath);

    assert.equal(disabled.enabled, false);
    assert.equal(readFileSync(hookPath, "utf-8"), localBytes);
    assert.doesNotMatch(
      readFileSync(join(projectPath, ".claude", "settings.json"), "utf-8"),
      /deny-dangerous\.sh/u,
    );
  });

  /**
   * Fixture purpose: combines a blocking local edit with removable tombstone state.
   * Filesystem side effects: invokes a rejected enable against a disposable project only.
   * Invariant: an enabled-state blocker is detected before cleanup, toggle, config, or script mutation.
   */
  it("checks enabled divergence before pruning any other hook state", () => {
    const projectPath = createClaudeProject();
    syncHookStates(projectPath);
    const managedPath = ".goat-flow/hooks/deny-dangerous.sh";
    const hookPath = join(projectPath, managedPath);
    const previousPackageBytes =
      "#!/usr/bin/env bash\n# previous package baseline\n";
    writeFileSync(hookPath, previousPackageBytes);
    recordCanonicalManagedHookBaseline(projectPath, [managedPath]);
    writeFileSync(hookPath, `${previousPackageBytes}# local enabled copy\n`);
    const tombstonePath = join(
      projectPath,
      ".goat-flow",
      "hooks",
      "plan-checkbox-guard.sh",
    );
    writeFileSync(tombstonePath, "retired bytes\n");
    const configPath = join(projectPath, ".goat-flow", "config.yaml");
    writeFileSync(
      configPath,
      [
        "hooks:",
        "  deny-dangerous:",
        "    enabled: true",
        "plan-guard:",
        "  enabled: true",
        "",
      ].join("\n"),
    );
    const configBefore = readFileSync(configPath, "utf-8");

    assert.throws(
      () => applyHookState("deny-dangerous", true, projectPath),
      /Refusing to sync diverged managed hook files/u,
    );
    assert.equal(readFileSync(configPath, "utf-8"), configBefore);
    assert.equal(readFileSync(tombstonePath, "utf-8"), "retired bytes\n");
  });

  // A hard-linked agent config can contain exact bytes while remaining unsafe to execute.
  it("keeps exact but hard-linked configuration untrusted", () => {
    const projectPath = createClaudeProject();
    syncHookStates(projectPath);
    const configPath = join(projectPath, ".claude", "settings.json");
    const linkedConfigPath = join(
      projectPath,
      ".claude",
      "linked-settings.json",
    );
    linkSync(configPath, linkedConfigPath);
    const denyHookState = claudeHookState(projectPath, "deny-dangerous");

    assert.equal(denyHookState.isRegistered, true);
    assert.equal(denyHookState.isCurrentVersionInstalled, true);
    assert.equal(denyHookState.isTrusted, false);
    assert.equal(denyHookState.installationIssue, "managed-path-untrusted");
    assert.deepEqual(denyHookState.effectiveState, {
      status: "runtime-untrusted",
      severity: "danger",
    });
    assert.equal(denyHookState.repairCommand, null);

    unlinkSync(linkedConfigPath);
  });

  // Setup diagnostics tell the user whether event, matcher, response command, or timeout owns drift.
  it("names exact registration drift without rewriting user configuration", () => {
    const projectPath = createClaudeProject();
    initializeDisposableGitProject(projectPath);
    enableGruffForProject(projectPath);
    syncHookStates(projectPath);

    const matcherSettings = readClaudeHookSettings(projectPath);
    const denyEventEntry = matcherSettings.hooks.PreToolUse?.find(
      (eventEntry) => eventEntry.matcher === "Bash",
    );
    assert.ok(denyEventEntry);
    denyEventEntry.matcher = "Read";
    const gruffEventEntry = matcherSettings.hooks.PostToolUse?.find(
      (eventEntry) => eventEntry.matcher === "Edit",
    );
    assert.ok(gruffEventEntry);
    gruffEventEntry.matcher = "Read";
    writeClaudeHookSettings(projectPath, matcherSettings);
    assert.equal(
      claudeHookState(projectPath, "deny-dangerous").registrationIssue,
      "matcher-mismatch",
    );
    assert.equal(
      claudeHookState(projectPath, "gruff-code-quality").registrationIssue,
      "matcher-mismatch",
    );
    const matcherReport = verifyManagedConfiguredHook({
      projectPath,
      agent: "claude",
      scenarioGroup: "gruff-hook",
      isTargetUntrusted: false,
    });
    assert.equal(matcherReport.status, "fail");
    assert.equal(
      matcherReport.summary.notConfigured,
      matcherReport.scenarios.length,
    );
    assert.equal(
      matcherReport.scenarios.every(
        (scenario) => scenario.reasonCode === "matcher-mismatch",
      ),
      true,
    );

    syncHookStates(projectPath);
    const timeoutSettings = readClaudeHookSettings(projectPath);
    const stopCommand = timeoutSettings.hooks.Stop?.[0]?.hooks?.[0];
    assert.ok(stopCommand);
    stopCommand.timeout = 1;
    writeClaudeHookSettings(projectPath, timeoutSettings);
    assert.equal(
      claudeHookState(projectPath, "post-turn-safety").registrationIssue,
      "timeout-mismatch",
    );

    syncHookStates(projectPath);
    const eventSettings = readClaudeHookSettings(projectPath);
    const stopEntries = eventSettings.hooks.Stop;
    assert.ok(stopEntries);
    eventSettings.hooks.Stop = [];
    eventSettings.hooks.PostToolUse = stopEntries;
    writeClaudeHookSettings(projectPath, eventSettings);
    assert.equal(
      claudeHookState(projectPath, "post-turn-safety").registrationIssue,
      "event-mismatch",
    );
    const eventReport = verifyManagedConfiguredHook({
      projectPath,
      agent: "claude",
      scenarioGroup: "post-turn-hook",
      isTargetUntrusted: false,
    });
    assert.equal(eventReport.status, "fail");
    assert.equal(
      eventReport.summary.notConfigured,
      eventReport.scenarios.length,
    );
    assert.equal(
      eventReport.scenarios.every(
        (scenario) => scenario.reasonCode === "event-mismatch",
      ),
      true,
    );

    syncHookStates(projectPath);
    const commandSettings = readClaudeHookSettings(projectPath);
    const denyCommand = commandSettings.hooks.PreToolUse?.find(
      (eventEntry) => eventEntry.matcher === "Bash",
    )?.hooks?.[0];
    assert.ok(denyCommand?.command);
    assert.ok(Array.isArray(denyCommand.args));
    // Claude's structured handler keeps its response mode as one argv operand.
    denyCommand.args = denyCommand.args.map((argumentValue) =>
      argumentValue === "policy" ? "policy-stale" : argumentValue,
    );
    writeClaudeHookSettings(projectPath, commandSettings);
    assert.equal(
      claudeHookState(projectPath, "deny-dangerous").registrationIssue,
      "command-or-response-mismatch",
    );

    syncHookStates(projectPath);
    const retiredSettings = readClaudeHookSettings(projectPath);
    retiredSettings.hooks.PreToolUse = [
      {
        matcher: "Bash",
        hooks: [
          {
            command: "bash .goat-flow/hooks/guard-secret-paths.sh",
          },
        ],
      },
    ];
    writeClaudeHookSettings(projectPath, retiredSettings);
    assert.equal(
      claudeHookState(projectPath, "deny-dangerous").registrationIssue,
      "retired-registration",
    );
  });

  // Audit users must see the registrar's exact state and repair without audit editing their setup.
  it("keeps audit JSON and terminal coverage aligned with read-only hook state", () => {
    const projectPath = createClaudeProject();
    syncHookStates(projectPath);
    const settingsPath = join(projectPath, ".claude", "settings.json");
    const settingsBeforeAudit = readFileSync(settingsPath, "utf-8");

    const auditReport = runAudit(createFS(projectPath), projectPath, {
      agentFilter: "claude",
      harness: false,
      denyMechanismEvidenceLevel: "present-only",
    });
    const directDenyState = claudeHookState(projectPath, "deny-dangerous");
    const auditDenyState = requiredHook(
      auditReport.hookCoverage.hooks,
      "deny-dangerous",
    ).agents.claude;
    const jsonReport = JSON.parse(renderAuditJson(auditReport)) as {
      hookCoverage: typeof auditReport.hookCoverage;
    };
    const terminalReport = renderAuditText(auditReport);

    assert.equal(auditReport.hookCoverage.status, "fail");
    assert.deepEqual(auditDenyState, directDenyState);
    assert.deepEqual(jsonReport.hookCoverage, auditReport.hookCoverage);
    assert.match(terminalReport, /Effective Hook Coverage:/u);
    assert.match(terminalReport, /deny-dangerous\/claude:/u);
    assert.match(terminalReport, /scenario unverified/u);
    assert.match(
      terminalReport,
      /hooks verify .*--scenario deny-hook --trusted-target/u,
    );
    assert.equal(readFileSync(settingsPath, "utf-8"), settingsBeforeAudit);
  });

  // Provider exclusions remain visible even when shared files happen to exist for another agent.
  it("does not present unsupported enabled hooks as installed coverage", () => {
    const projectPath = createClaudeProject();
    syncHookStates(projectPath);
    const postTurnHook = requiredHook(
      readAllHookStates(projectPath),
      "post-turn-safety",
    );
    const antigravityState = postTurnHook.agents.antigravity;

    assert.equal(antigravityState.supported, false);
    assert.equal(antigravityState.installed, false);
    assert.deepEqual(antigravityState.effectiveState, {
      status: "provider-capture-absent",
      severity: "warning",
    });
    assert.match(
      antigravityState.reason ?? "",
      /Stop-hook delivery is unverified/u,
    );
    assert.equal(antigravityState.repairCommand, null);
  });

  // The explicit policy proof now reaches the same generated command the selected agent invokes.
  it("replays deny scenarios through the exact configured command", () => {
    const projectPath = createClaudeProject();
    syncHookStates(projectPath);

    const report = verifyManagedDenyHook({
      projectPath,
      agent: "claude",
      scenarioGroup: "deny-hook",
      isTargetUntrusted: false,
    });

    assert.equal(report.status, "pass");
    assert.equal(report.summary.pass, report.scenarios.length);
    assert.deepEqual(
      report.scenarios.map((scenario) => scenario.id),
      HOOK_VERIFICATION_CONTRACTS["deny-hook"].requiredScenarioIds,
    );
    assert.deepEqual(
      report.scenarios.map((scenario) => scenario.observed),
      ["blocked", "blocked", "blocked", "allowed"],
    );
    assert.deepEqual(
      claudeHookState(projectPath, "deny-dangerous").effectiveState,
      { status: "effective", severity: "success" },
    );
  });

  it(
    "replays Codex deny scenarios through the Windows override",
    { skip: process.platform !== "win32" },
    () => {
      const projectPath = createCodexProject();
      syncHookStates(projectPath);

      const report = verifyManagedDenyHook({
        projectPath,
        agent: "codex",
        scenarioGroup: "deny-hook",
        isTargetUntrusted: false,
      });

      assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
      assert.equal(report.summary.pass, report.scenarios.length);
      assert.deepEqual(
        report.scenarios.map((scenario) => scenario.observed),
        ["blocked", "blocked", "blocked", "allowed"],
      );
      assert.deepEqual(
        codexHookState(projectPath, "deny-dangerous").effectiveState,
        { status: "effective", severity: "success" },
      );
    },
  );

  /**
   * Fixture purpose: prove finding and incomplete output through the user's exact Stop command.
   * Side effects: writes one merge-conflict file in a disposable Git project removed by cleanup.
   * Invariant: the configured command reports both result classes without provider invocation.
   */
  it("replays finding and incomplete results through the configured Stop command", () => {
    const projectPath = createClaudeProject();
    initializeDisposableGitProject(projectPath);
    mkdirSync(join(projectPath, "src"), { recursive: true });
    writeFileSync(
      join(projectPath, "src", "example.txt"),
      ["<<<<<<< HEAD", "left", "=======", "right", ">>>>>>> branch", ""].join(
        "\n",
      ),
    );
    syncHookStates(projectPath);

    const report = verifyManagedConfiguredHook({
      projectPath,
      agent: "claude",
      scenarioGroup: "post-turn-hook",
      isTargetUntrusted: false,
    });

    assert.equal(report.status, "pass");
    assert.deepEqual(
      report.scenarios.map((scenario) => scenario.id),
      HOOK_VERIFICATION_CONTRACTS["post-turn-hook"].requiredScenarioIds,
    );
    assert.deepEqual(
      report.scenarios.map((scenario) => scenario.observed),
      ["finding", "incomplete"],
    );
    assert.deepEqual(
      claudeHookState(projectPath, "post-turn-safety").effectiveState,
      { status: "effective", severity: "success" },
    );
  });

  it(
    "replays Codex Stop results without upgrading stale provider proof",
    { skip: process.platform !== "win32" },
    () => {
      const projectPath = createCodexProject();
      initializeDisposableGitProject(projectPath);
      mkdirSync(join(projectPath, "src"), { recursive: true });
      writeFileSync(
        join(projectPath, "src", "example.txt"),
        ["<<<<<<< HEAD", "left", "=======", "right", ">>>>>>> branch", ""].join(
          "\n",
        ),
      );
      syncHookStates(projectPath);

      const report = verifyManagedConfiguredHook({
        projectPath,
        agent: "codex",
        scenarioGroup: "post-turn-hook",
        isTargetUntrusted: false,
      });

      assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
      assert.deepEqual(
        report.scenarios.map((scenario) => scenario.observed),
        ["finding", "incomplete"],
      );
      assert.deepEqual(
        codexHookState(projectPath, "post-turn-safety").effectiveState,
        { status: "provider-capture-stale", severity: "warning" },
      );
    },
  );

  // An edited source without a Gruff config is unavailable, while other payload classes stay explicit.
  it("replays incomplete, advisory, and unavailable Gruff results through its configured command", () => {
    const projectPath = createClaudeProject();
    initializeDisposableGitProject(projectPath);
    enableGruffForProject(projectPath);
    syncHookStates(projectPath);

    const report = verifyManagedConfiguredHook({
      projectPath,
      agent: "claude",
      scenarioGroup: "gruff-hook",
      isTargetUntrusted: false,
    });

    assert.equal(report.status, "pass");
    assert.deepEqual(
      report.scenarios.map((scenario) => scenario.id),
      HOOK_VERIFICATION_CONTRACTS["gruff-hook"].requiredScenarioIds,
    );
    assert.deepEqual(
      report.scenarios.map((scenario) => scenario.observed),
      ["incomplete", "finding", "unavailable"],
    );
    assert.deepEqual(
      claudeHookState(projectPath, "gruff-code-quality").effectiveState,
      { status: "effective", severity: "success" },
    );
  });
});
