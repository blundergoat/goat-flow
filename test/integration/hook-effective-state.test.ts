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
  readAllHookStates,
  syncHookStates,
  type HookAgentState,
  type HookState,
} from "../../src/cli/server/hook-registrar.js";
import {
  verifyManagedConfiguredHook,
  verifyManagedDenyHook,
} from "../../src/cli/hooks-runtime-evidence.js";

const disposableProjects: string[] = [];

/** Minimal Claude settings shape used only to move or alter managed fixture entries. */
interface ClaudeHookSettingsFixture {
  hooks: Record<
    string,
    Array<{
      matcher?: string;
      hooks?: Array<{ command?: string; timeout?: number }>;
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

/** Create the smallest Claude project that the registrar may safely reconcile. */
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

/** Initialize an empty Git worktree so Stop-hook fixtures have a real changed-file boundary. */
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

/** Write one intentionally drifted Claude fixture for the next read-only status assertion. */
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
      /hooks verify .* --agent claude --scenario deny-hook/u,
    );
    assert.equal(
      denyHookState.evidenceIdentity,
      "hook-provider-adapter.v1:claude:pre-tool",
    );
  });

  // Fixture purpose: writes a temporary user customization; suite cleanup removes the project.
  it("names installed byte drift as a stale installation", () => {
    const projectPath = createClaudeProject();
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
    assert.equal(postTurnState.installationIssue, "installed-version-mismatch");
    assert.deepEqual(postTurnState.effectiveState, {
      status: "installation-stale",
      severity: "warning",
    });
    assert.match(postTurnState.repairCommand ?? "", /hooks sync/u);
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
    syncHookStates(projectPath);

    const matcherSettings = readClaudeHookSettings(projectPath);
    const denyEventEntry = matcherSettings.hooks.PreToolUse?.find(
      (eventEntry) => eventEntry.matcher === "Bash",
    );
    assert.ok(denyEventEntry);
    denyEventEntry.matcher = "Read";
    writeClaudeHookSettings(projectPath, matcherSettings);
    assert.equal(
      claudeHookState(projectPath, "deny-dangerous").registrationIssue,
      "matcher-mismatch",
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

    syncHookStates(projectPath);
    const commandSettings = readClaudeHookSettings(projectPath);
    const denyCommand = commandSettings.hooks.PreToolUse?.find(
      (eventEntry) => eventEntry.matcher === "Bash",
    )?.hooks?.[0];
    assert.ok(denyCommand?.command);
    denyCommand.command = denyCommand.command.replace(
      '"policy"',
      '"policy-stale"',
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
    assert.match(terminalReport, /hooks verify .*--scenario deny-hook/u);
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
    const codexState = postTurnHook.agents.codex;

    assert.equal(codexState.supported, false);
    assert.equal(codexState.installed, false);
    assert.deepEqual(codexState.effectiveState, {
      status: "provider-capture-absent",
      severity: "warning",
    });
    assert.match(codexState.reason ?? "", /Stop-hook delivery is unverified/u);
    assert.equal(codexState.repairCommand, null);
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
    assert.equal(report.summary.pass, 4);
    assert.deepEqual(
      report.scenarios.map((scenario) => scenario.observed),
      ["blocked", "blocked", "blocked", "allowed"],
    );
  });

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
      report.scenarios.map((scenario) => scenario.observed),
      ["finding", "incomplete"],
    );
  });

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
      report.scenarios.map((scenario) => scenario.observed),
      ["incomplete", "finding", "unavailable"],
    );
  });
});
