/**
 * Cross-agent installer smoke coverage for every manifest-backed profile.
 * Use when installer, hook registration, skill paths, or cleanup behavior changes.
 * The fixtures install into disposable consumer targets without launching an AI agent.
 * Static Windows and PowerShell checks prove emitted command shape, not real-OS execution.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

import { getAgentProfiles } from "../../src/cli/agents/registry.js";
import { getSkillNames, getStaleSkillNames } from "../../src/cli/constants.js";
import { readAgentHookState } from "../../src/cli/server/agent-hook-writer.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";
import type { AgentProfile } from "../../src/cli/types.js";
import {
  PROJECT_ROOT,
  makeTempProject,
  runCliInstaller,
  runInstaller,
} from "./setup-install.helpers.js";

/** Machine-readable doctor fields used to verify one installed consumer skill. */
interface MatrixDoctorReport {
  status: string;
  target: string;
  agents: Array<{
    agent: { id: string };
    skills: Array<{
      invocation: string;
      installedPath: string;
      staticEligibility: string;
    }>;
  }>;
}

/**
 * Run the public source-mode doctor against a disposable consumer target.
 * Use after install or deliberate damage to show the path a user needs to repair.
 *
 * @param targetProjectPath - selected consumer; empty would make target evidence meaningless
 * @param agentId - manifest profile installed in that consumer; empty is rejected by CLI parsing
 * @returns parsed JSON report; empty stdout means the public command failed the fixture contract
 */
function runSkillDoctor(
  targetProjectPath: string,
  agentId: AgentProfile["id"],
): MatrixDoctorReport {
  const commandResult = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      join(PROJECT_ROOT, "src", "cli", "cli.ts"),
      "skill",
      "doctor",
      targetProjectPath,
      "--agent",
      agentId,
      "--skill",
      "goat",
      "--format",
      "json",
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 10_000,
    },
  );

  assert.ok(
    commandResult.status === 0 || commandResult.status === 1,
    commandResult.stderr || commandResult.stdout,
  );
  assert.notEqual(
    commandResult.stdout.trim(),
    "",
    "skill doctor must return JSON even when an installed skill is blocked",
  );
  return JSON.parse(commandResult.stdout) as MatrixDoctorReport;
}

/**
 * Assert the files and hook command a user receives for one selected profile.
 * Use after each fresh install so manifest drift fails with the exact profile and path.
 *
 * @param targetProjectPath - disposable consumer root; empty means no install target exists
 * @param agentProfile - selected manifest profile; missing paths are a product contract failure
 */
function assertInstalledAgentSurface(
  targetProjectPath: string,
  agentProfile: AgentProfile,
): void {
  // Every canonical skill must be invocable from the selected agent's installed mirror.
  for (const skillName of getSkillNames()) {
    const installedSkillPath = join(
      targetProjectPath,
      agentProfile.skillsDir,
      skillName,
      "SKILL.md",
    );
    assert.equal(
      existsSync(installedSkillPath),
      true,
      `${agentProfile.id} missing ${installedSkillPath}`,
    );
  }

  assert.ok(
    agentProfile.hookConfigFile,
    `${agentProfile.id} must expose a hook config path`,
  );
  const installedHookConfigPath = join(
    targetProjectPath,
    agentProfile.hookConfigFile,
  );
  assert.equal(
    existsSync(installedHookConfigPath),
    true,
    `${agentProfile.id} missing ${installedHookConfigPath}`,
  );

  const installedHookConfig = readFileSync(installedHookConfigPath, "utf-8");
  assert.match(
    installedHookConfig,
    /\.goat-flow\/hooks\/deny-dangerous\.sh/u,
    `${agentProfile.id} hook config must launch the central runtime path`,
  );

  const denyDangerousHook = getHookSpec("deny-dangerous");
  assert.ok(
    denyDangerousHook,
    "deny-dangerous must remain in the hook registry",
  );
  assert.equal(
    readAgentHookState(targetProjectPath, agentProfile, denyDangerousHook)
      .installed,
    true,
    `${agentProfile.id} installed command drifted from runtime writer semantics`,
  );

  // Copilot users on Windows need the emitted PowerShell fallback even on Linux CI.
  if (agentProfile.id === "copilot") {
    assert.match(installedHookConfig, /Get-Command bash/u);
    assert.match(installedHookConfig, /permissionDecision/u);
  }

  // A separate settings file is visible to users and must exist after installation.
  if (agentProfile.settingsFile !== null) {
    assert.equal(
      existsSync(join(targetProjectPath, agentProfile.settingsFile)),
      true,
      `${agentProfile.id} missing ${agentProfile.settingsFile}`,
    );
  }

  // Instruction files are completed by setup guidance, not silently written by install.
  assert.equal(
    existsSync(join(targetProjectPath, agentProfile.instructionFile)),
    false,
    `${agentProfile.id} installer unexpectedly wrote the setup-owned instruction file`,
  );
}

/**
 * Prove one profile installs its manifest-owned files and explicit command evidence.
 * Use per profile so a failure names the exact agent the user selected.
 *
 * @param agentProfile - selected profile; missing fields make its individual test fail
 * @returns disposable installed target path; never empty after fixture creation
 */
function verifyFreshAgentInstall(agentProfile: AgentProfile): string {
  const targetProjectPath = makeTempProject();
  const installResult = runInstaller(
    targetProjectPath,
    "--agent",
    agentProfile.id,
  );

  assert.equal(
    installResult.status,
    0,
    installResult.stderr || installResult.stdout,
  );
  assert.match(installResult.stdout, new RegExp(`agent: ${agentProfile.id}`));
  assertInstalledAgentSurface(targetProjectPath, agentProfile);

  const doctorReport = runSkillDoctor(targetProjectPath, agentProfile.id);
  const expectedInvocation =
    agentProfile.promptInvocationStyle === "dollar" ? "$goat" : "/goat";
  assert.equal(doctorReport.status, "pass");
  assert.equal(doctorReport.target, targetProjectPath);
  assert.equal(doctorReport.agents[0]?.agent.id, agentProfile.id);
  assert.equal(
    doctorReport.agents[0]?.skills[0]?.installedPath,
    `${agentProfile.skillsDir}/goat/SKILL.md`,
  );
  assert.equal(
    doctorReport.agents[0]?.skills[0]?.invocation,
    expectedInvocation,
  );
  assert.equal(
    doctorReport.agents[0]?.skills[0]?.staticEligibility,
    "eligible",
  );
  return targetProjectPath;
}

/**
 * Prove one profile repairs managed damage while retaining visible user content.
 * Use per profile so cleanup failures never hide behind a shared matrix loop.
 * Writes disposable fixture files and launches installer subprocesses only inside that target.
 *
 * @param agentProfile - selected profile; missing config/path evidence fails its named test
 * @returns preserved user-owned file path; never empty after the repair flow completes
 */
function verifyAgentRepairAndCleanup(agentProfile: AgentProfile): string {
  const [retiredSkillName] = getStaleSkillNames();
  assert.ok(
    retiredSkillName,
    "manifest must retain at least one retired skill for cleanup coverage",
  );

  const targetProjectPath = makeTempProject();
  const firstInstall = runInstaller(
    targetProjectPath,
    "--agent",
    agentProfile.id,
  );
  assert.equal(
    firstInstall.status,
    0,
    firstInstall.stderr || firstInstall.stdout,
  );

  const missingSkillPath = join(
    targetProjectPath,
    agentProfile.skillsDir,
    "goat",
    "SKILL.md",
  );
  rmSync(missingSkillPath);

  const staleSkillPath = join(
    targetProjectPath,
    agentProfile.skillsDir,
    retiredSkillName,
  );
  mkdirSync(staleSkillPath, { recursive: true });
  writeFileSync(join(staleSkillPath, "SKILL.md"), "# retired\n");

  const staleReferencePath = join(
    targetProjectPath,
    agentProfile.skillsDir,
    "goat-security",
    "references",
    "retired-matrix.md",
  );
  writeFileSync(staleReferencePath, "# retired reference\n");

  const userOwnedPath = join(targetProjectPath, "user-owned-matrix.txt");
  writeFileSync(userOwnedPath, "keep this user content\n");

  assert.ok(
    agentProfile.hookConfigFile,
    `${agentProfile.id} must expose a hook config path`,
  );
  const hookConfigPath = join(targetProjectPath, agentProfile.hookConfigFile);
  const hookConfig = JSON.parse(
    readFileSync(hookConfigPath, "utf-8"),
  ) as Record<string, unknown>;
  hookConfig.userOwnedMatrixMarker = "preserve";
  writeFileSync(hookConfigPath, `${JSON.stringify(hookConfig, null, 2)}\n`);

  const blockedReport = runSkillDoctor(targetProjectPath, agentProfile.id);
  assert.equal(blockedReport.status, "fail");
  assert.equal(blockedReport.target, targetProjectPath);
  assert.equal(
    blockedReport.agents[0]?.skills[0]?.installedPath,
    `${agentProfile.skillsDir}/goat/SKILL.md`,
  );

  const repairInstall = runInstaller(
    targetProjectPath,
    "--agent",
    agentProfile.id,
    "--clean-deprecated",
  );
  assert.equal(
    repairInstall.status,
    0,
    repairInstall.stderr || repairInstall.stdout,
  );
  assert.equal(existsSync(missingSkillPath), true);
  assert.equal(existsSync(staleSkillPath), false);
  assert.equal(existsSync(staleReferencePath), false);
  assert.equal(
    readFileSync(userOwnedPath, "utf-8"),
    "keep this user content\n",
  );
  const repairedHookConfig = JSON.parse(
    readFileSync(hookConfigPath, "utf-8"),
  ) as Record<string, unknown>;
  assert.equal(repairedHookConfig.userOwnedMatrixMarker, "preserve");
  assertInstalledAgentSurface(targetProjectPath, agentProfile);
  return userOwnedPath;
}

describe("cross-agent install smoke matrix", () => {
  const supportedAgentProfiles = getAgentProfiles();
  assert.deepEqual(
    supportedAgentProfiles.map((profile) => profile.id),
    ["claude", "codex", "antigravity", "copilot"],
  );

  // Separate names make the failing agent visible in TAP output and CI summaries.
  for (const agentProfile of supportedAgentProfiles) {
    it(`${agentProfile.id} installs manifest paths and invocation evidence`, () => {
      const installedTargetPath = verifyFreshAgentInstall(agentProfile);
      assert.equal(
        existsSync(
          join(installedTargetPath, agentProfile.skillsDir, "goat", "SKILL.md"),
        ),
        true,
      );
    });

    it(`${agentProfile.id} repairs managed files and preserves user content`, () => {
      const preservedUserFilePath = verifyAgentRepairAndCleanup(agentProfile);
      assert.equal(
        readFileSync(preservedUserFilePath, "utf-8"),
        "keep this user content\n",
      );
    });
  }

  it("keeps public CLI writes inside the selected consumer target", () => {
    const selectedTargetPath = makeTempProject();
    const untouchedNeighborPath = makeTempProject();
    const installResult = runCliInstaller(
      selectedTargetPath,
      "--agent",
      "codex",
    );

    assert.equal(
      installResult.status,
      0,
      installResult.stderr || installResult.stdout,
    );
    assert.match(
      installResult.stdout,
      new RegExp(basename(selectedTargetPath)),
    );
    assert.equal(
      existsSync(join(selectedTargetPath, ".goat-flow", "config.yaml")),
      true,
    );
    assert.equal(
      existsSync(join(untouchedNeighborPath, ".goat-flow")),
      false,
      "an unselected neighboring project must remain untouched",
    );
  });
});
