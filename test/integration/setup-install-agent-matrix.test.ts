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
import { basename, dirname, join, posix } from "node:path";
import { spawnSync } from "node:child_process";

import { load } from "js-yaml";

import { getAgentProfiles } from "../../src/cli/agents/registry.js";
import { getSkillNames, getStaleSkillNames } from "../../src/cli/constants.js";
import { readAgentHookState } from "../../src/cli/server/agent-hook-writer.js";
import {
  getHookSpec,
  listHookSpecs,
} from "../../src/cli/server/hooks-registry.js";
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

type ManagedHookMatrixState =
  | "first-install"
  | "upgrade"
  | "enabled"
  | "disabled"
  | "missing"
  | "locally-edited"
  | "duplicated"
  | "forced";

type ManagedHookWriteTarget =
  | "all-managed-files"
  | "primary-managed-file"
  | "agent-hook-config"
  | "goat-flow-config"
  | "install-state";

/** One pre-install state and the exact hook-state result M01 must derive. */
interface ManagedHookDesiredStateFixture {
  state: ManagedHookMatrixState;
  currentManagedFiles:
    "absent" | "current" | "missing" | "stale" | "locally-edited";
  currentRegistrationCount: number;
  isDesiredEnabled: boolean;
  authority: "normal" | "force-managed";
  expectedManagedFiles: "current" | "preserved-local";
  expectedRegistrationCount: number;
  expectedResult: "ready" | "repair" | "blocked-conflict";
  expectedWriteTargets: ManagedHookWriteTarget[];
}

const MANAGED_HOOK_STATE_NAMES: ManagedHookMatrixState[] = [
  "first-install",
  "upgrade",
  "enabled",
  "disabled",
  "missing",
  "locally-edited",
  "duplicated",
  "forced",
];

const MANAGED_HOOK_DESIRED_STATE_FIXTURES: ManagedHookDesiredStateFixture[] = [
  {
    state: "first-install",
    currentManagedFiles: "absent",
    currentRegistrationCount: 0,
    isDesiredEnabled: true,
    authority: "normal",
    expectedManagedFiles: "current",
    expectedRegistrationCount: 1,
    expectedResult: "repair",
    expectedWriteTargets: [
      "all-managed-files",
      "agent-hook-config",
      "goat-flow-config",
      "install-state",
    ],
  },
  {
    state: "upgrade",
    currentManagedFiles: "stale",
    currentRegistrationCount: 1,
    isDesiredEnabled: true,
    authority: "normal",
    expectedManagedFiles: "current",
    expectedRegistrationCount: 1,
    expectedResult: "repair",
    expectedWriteTargets: [
      "all-managed-files",
      "agent-hook-config",
      "goat-flow-config",
      "install-state",
    ],
  },
  {
    state: "enabled",
    currentManagedFiles: "current",
    currentRegistrationCount: 1,
    isDesiredEnabled: true,
    authority: "normal",
    expectedManagedFiles: "current",
    expectedRegistrationCount: 1,
    expectedResult: "ready",
    expectedWriteTargets: [],
  },
  {
    state: "disabled",
    currentManagedFiles: "current",
    currentRegistrationCount: 0,
    isDesiredEnabled: false,
    authority: "normal",
    expectedManagedFiles: "current",
    expectedRegistrationCount: 0,
    expectedResult: "ready",
    expectedWriteTargets: [],
  },
  {
    state: "missing",
    currentManagedFiles: "missing",
    currentRegistrationCount: 0,
    isDesiredEnabled: false,
    authority: "normal",
    expectedManagedFiles: "current",
    expectedRegistrationCount: 0,
    expectedResult: "repair",
    expectedWriteTargets: ["primary-managed-file", "install-state"],
  },
  {
    state: "locally-edited",
    currentManagedFiles: "locally-edited",
    currentRegistrationCount: 1,
    isDesiredEnabled: true,
    authority: "normal",
    expectedManagedFiles: "preserved-local",
    expectedRegistrationCount: 1,
    expectedResult: "blocked-conflict",
    expectedWriteTargets: [],
  },
  {
    state: "duplicated",
    currentManagedFiles: "current",
    currentRegistrationCount: 2,
    isDesiredEnabled: true,
    authority: "normal",
    expectedManagedFiles: "current",
    expectedRegistrationCount: 1,
    expectedResult: "repair",
    expectedWriteTargets: ["agent-hook-config", "install-state"],
  },
  {
    state: "forced",
    currentManagedFiles: "locally-edited",
    currentRegistrationCount: 0,
    isDesiredEnabled: false,
    authority: "force-managed",
    expectedManagedFiles: "current",
    expectedRegistrationCount: 0,
    expectedResult: "repair",
    expectedWriteTargets: ["primary-managed-file", "install-state"],
  },
];

const DENY_POLICY_PATHS = [
  ".goat-flow/hooks/deny-dangerous/patterns-shell.sh",
  ".goat-flow/hooks/deny-dangerous/patterns-paths.sh",
  ".goat-flow/hooks/deny-dangerous/patterns-writes.sh",
  ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
];

/** Expand one matrix row into the project-relative paths apply is allowed to mutate. */
function expectedManagedHookWritePaths(
  fixture: ManagedHookDesiredStateFixture,
  agentProfile: AgentProfile,
): string[] {
  const denyDangerousHook = getHookSpec("deny-dangerous");
  assert.ok(denyDangerousHook);
  assert.ok(agentProfile.hooksDir);
  assert.ok(agentProfile.hookConfigFile);

  const allManagedPaths = [
    ...denyDangerousHook.scriptFiles.map((fileName) =>
      posix.join(agentProfile.hooksDir ?? "", fileName),
    ),
    ...DENY_POLICY_PATHS,
    ".goat-flow/.gitignore",
  ];
  const targetPaths: Record<ManagedHookWriteTarget, string[]> = {
    "all-managed-files": allManagedPaths,
    "primary-managed-file": [
      posix.join(agentProfile.hooksDir, denyDangerousHook.primaryScript),
    ],
    "agent-hook-config": [agentProfile.hookConfigFile],
    "goat-flow-config": [".goat-flow/config.yaml"],
    "install-state": [`.goat-flow/install-state/${agentProfile.id}.json`],
  };
  return fixture.expectedWriteTargets.flatMap((target) => targetPaths[target]);
}

/** Count logical command rows for one managed script without double-counting shell fields. */
function countManagedHookRegistrations(
  configValue: unknown,
  primaryScript: string,
): number {
  if (Array.isArray(configValue)) {
    return configValue.reduce(
      (count, nestedValue) =>
        count + countManagedHookRegistrations(nestedValue, primaryScript),
      0,
    );
  }
  if (configValue === null || typeof configValue !== "object") return 0;
  const configEntry = configValue as Record<string, unknown>;
  // Structured exec-form rows carry the script path as an argv element, not command text.
  const argumentOperands = Array.isArray(configEntry.args)
    ? configEntry.args.filter(
        (argumentValue): argumentValue is string =>
          typeof argumentValue === "string",
      )
    : [];
  const ownsManagedCommand = [
    configEntry.command,
    configEntry.bash,
    configEntry.powershell,
    ...argumentOperands,
  ].some(
    (command) => typeof command === "string" && command.includes(primaryScript),
  );
  return (
    (ownsManagedCommand ? 1 : 0) +
    Object.values(configEntry).reduce(
      (count, nestedValue) =>
        count + countManagedHookRegistrations(nestedValue, primaryScript),
      0,
    )
  );
}

/**
 * Spawns the public source-mode doctor against a disposable consumer target.
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
  assert.match(
    installedHookConfig,
    /run-with-bash\.mjs/u,
    `${agentProfile.id} hook config must use the managed Bash resolver`,
  );

  // This fixture is intentionally non-Git, so Codex receives policy but no unsafe Stop row.
  if (agentProfile.id === "codex") {
    assert.match(installedHookConfig, /"PreToolUse"/u);
    assert.doesNotMatch(installedHookConfig, /"Stop"/u);
    assert.doesNotMatch(installedHookConfig, /"timeout": 90/u);
    assert.doesNotMatch(
      installedHookConfig,
      /codex:post-turn:goat-flow\.hook-result\.v1:turn-stop:1:75000/u,
    );
  }

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

  // Copilot uses the same shell-neutral Node command for Bash and PowerShell hosts.
  if (agentProfile.id === "copilot") {
    assert.match(installedHookConfig, /node -e/u);
    assert.match(installedHookConfig, /permissionDecision/u);
    assert.doesNotMatch(installedHookConfig, /Get-Command bash/u);
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
  // The user selected an ordinary folder, so install must not create Git state for them.
  assert.equal(existsSync(join(targetProjectPath, ".git")), false);
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
  // Installation leaves the user's non-Git project type unchanged.
  assert.equal(existsSync(join(targetProjectPath, ".git")), false);
  assertInstalledAgentSurface(targetProjectPath, agentProfile);
  assert.equal(
    readFileSync(join(targetProjectPath, ".goat-flow", ".gitignore"), "utf-8"),
    readFileSync(
      join(
        PROJECT_ROOT,
        "workflow",
        "setup",
        "reference",
        "goat-flow-gitignore",
      ),
      "utf-8",
    ),
    `${agentProfile.id} standalone installer must preserve the canonical goat-flow gitignore exactly`,
  );

  const doctorReport = runSkillDoctor(targetProjectPath, agentProfile.id);
  const expectedInvocation =
    agentProfile.promptInvocationStyle === "dollar" ? "$goat" : "/goat";
  assert.equal(doctorReport.status, "static-pass");
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

/**
 * Prove the standalone installer and TypeScript writer show one hook state to a user; it writes into a disposable consumer target.
 * Use per agent after launcher or migration behavior changes.
 *
 * @param agentProfile - agent selected at install time; missing support keeps that hook absent
 * @returns installed target path; never empty after fixture creation
 */
function verifyStandaloneInstallerHookSemantics(
  agentProfile: AgentProfile,
): string {
  const targetProjectPath = makeTempProject();
  mkdirSync(join(targetProjectPath, ".goat-flow"), { recursive: true });
  // This fixture represents a user who enabled every shared hook before reinstalling.
  writeFileSync(
    join(targetProjectPath, ".goat-flow", "config.yaml"),
    [
      "hooks:",
      "  deny-dangerous:",
      "    enabled: true",
      "  gruff-code-quality:",
      "    enabled: true",
      "  post-turn-safety:",
      "    enabled: true",
      "",
    ].join("\n"),
  );

  // A previous Antigravity install may have registered a hook whose delivery is no longer supported.
  if (agentProfile.id === "antigravity") {
    assert.ok(agentProfile.hookConfigFile);
    const hookConfigPath = join(targetProjectPath, agentProfile.hookConfigFile);
    mkdirSync(dirname(hookConfigPath), { recursive: true });
    writeFileSync(
      hookConfigPath,
      `${JSON.stringify(
        {
          "renamed-gruff-policy": {
            enabled: true,
            PostToolUse: [
              {
                matcher: "edit_file",
                hooks: [
                  {
                    type: "command",
                    command:
                      "node .goat-flow/hooks/run-with-bash.mjs .goat-flow/hooks/gruff-code-quality.sh",
                  },
                ],
              },
            ],
          },
          "team-audit": {
            enabled: true,
            PreToolUse: [
              {
                matcher: "run_command",
                hooks: [
                  { type: "command", command: "./scripts/team-audit.sh" },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );
  }

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
  // Hook installation must not turn the user's ordinary folder into a Git repository.
  assert.equal(existsSync(join(targetProjectPath, ".git")), false);

  assert.ok(agentProfile.hookConfigFile);
  const installedHookConfig = JSON.parse(
    readFileSync(join(targetProjectPath, agentProfile.hookConfigFile), "utf-8"),
  ) as unknown;

  if (agentProfile.id === "antigravity") {
    const antigravityConfig = installedHookConfig as Record<string, unknown>;
    assert.equal(
      countManagedHookRegistrations(antigravityConfig, "gruff-code-quality.sh"),
      0,
      "standalone install must remove registrations unsupported by Antigravity",
    );
    assert.equal(antigravityConfig["renamed-gruff-policy"], undefined);
    assert.ok(antigravityConfig["team-audit"]);
  }

  // Every shipped hook must match provider support plus this non-Git root's eligibility.
  for (const hookSpec of listHookSpecs()) {
    const installedHookState = readAgentHookState(
      targetProjectPath,
      agentProfile,
      hookSpec,
    );
    // Post-turn stays unregistered until a Git root or complete explicit root list exists.
    const doesRootContractAllowRegistration =
      hookSpec.id !== "post-turn-safety";
    const shouldInstallHook =
      !hookSpec.unsupportedAgents?.[agentProfile.id] &&
      doesRootContractAllowRegistration;
    assert.equal(
      installedHookState.installed,
      shouldInstallHook,
      `${agentProfile.id} ${hookSpec.id} diverged between installer and writer`,
    );
    // A matcherless event has one logical row, so existential checks must not hide duplicates.
    if (hookSpec.matcher === "") {
      assert.equal(
        countManagedHookRegistrations(
          installedHookConfig,
          hookSpec.primaryScript,
        ),
        shouldInstallHook ? 1 : 0,
        `${agentProfile.id} ${hookSpec.id} must have one exact registration`,
      );
    }
  }
  // An enabled Codex Gruff hook uses the canonical tool observed by the active provider.
  if (agentProfile.id === "codex") {
    const codexHookConfig = readFileSync(
      join(targetProjectPath, agentProfile.hookConfigFile ?? ""),
      "utf-8",
    );
    assert.match(codexHookConfig, /"PostToolUse"/u);
    assert.match(codexHookConfig, /"matcher": "\^apply_patch\$"/u);
    assert.match(codexHookConfig, /"timeout": 90/u);
  }
  return targetProjectPath;
}

/** Shell text that names the managed script the way pre-upgrade installs did. */
const STALE_DENY_COMMAND = "bash .goat-flow/hooks/deny-dangerous.sh";
/** Marker the installer must never remove from a user's own hook rows. */
const USER_HOOK_MARKER = "./scripts/team-audit.sh";

/**
 * Insert duplicate, stale, and user-owned deny rows into one installed config.
 * Shapes follow each provider's real config format so the seeded state is executable.
 *
 * @param agentProfile - provider whose installed config is polluted
 * @param installedConfig - parsed hook config mutated in place
 */
function seedDuplicateAndStaleDenyRows(
  agentProfile: AgentProfile,
  installedConfig: Record<string, unknown>,
): void {
  // Antigravity stores the managed hook as one top-level definition keyed by id.
  if (agentProfile.id === "antigravity") {
    const denyDefinition = installedConfig["deny-dangerous"] as {
      PreToolUse: unknown[];
    };
    denyDefinition.PreToolUse.push(
      structuredClone(denyDefinition.PreToolUse[0]),
      {
        matcher: "run_command",
        hooks: [{ type: "command", command: STALE_DENY_COMMAND, timeout: 30 }],
      },
    );
    installedConfig["team-audit"] = {
      enabled: true,
      PreToolUse: [
        {
          matcher: "run_command",
          hooks: [{ type: "command", command: USER_HOOK_MARKER }],
        },
      ],
    };
    return;
  }
  const hooks = installedConfig.hooks as Record<string, unknown[]>;
  // Copilot keeps direct dual-shell command rows under camel-case events.
  if (agentProfile.id === "copilot") {
    hooks.preToolUse.push(structuredClone(hooks.preToolUse[0]), {
      type: "command",
      bash: STALE_DENY_COMMAND,
      powershell: STALE_DENY_COMMAND,
      timeoutSec: 30,
    });
    hooks.preToolUse.push({
      type: "command",
      bash: USER_HOOK_MARKER,
      powershell: USER_HOOK_MARKER,
      timeoutSec: 10,
    });
    return;
  }
  // Claude and Codex nest runnable commands below matcher groups per event.
  hooks.PreToolUse.push(structuredClone(hooks.PreToolUse[0]), {
    matcher: "Bash",
    hooks: [{ type: "command", command: STALE_DENY_COMMAND }],
  });
  hooks.PreToolUse.push({
    matcher: "Bash",
    hooks: [{ type: "command", command: USER_HOOK_MARKER }],
  });
}

/**
 * Prove the standalone installer converges duplicate and stale deny rows across
 * three consecutive runs while preserving the user's own hook rows; it writes into a disposable consumer target.
 * Use per agent so a convergence failure names the exact provider shape.
 *
 * @param agentProfile - agent selected at install time
 * @returns converged hook config path; never empty after the three-run flow
 */
function verifyInstallerDuplicateConvergence(
  agentProfile: AgentProfile,
): string {
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

  assert.ok(agentProfile.hookConfigFile);
  const hookConfigPath = join(targetProjectPath, agentProfile.hookConfigFile);
  const installedConfig = JSON.parse(
    readFileSync(hookConfigPath, "utf-8"),
  ) as Record<string, unknown>;
  seedDuplicateAndStaleDenyRows(agentProfile, installedConfig);
  writeFileSync(
    hookConfigPath,
    `${JSON.stringify(installedConfig, null, 2)}\n`,
  );
  // The seeded state is executable: extra managed rows exist before convergence.
  assert.ok(
    countManagedHookRegistrations(installedConfig, "deny-dangerous.sh") > 1,
    `${agentProfile.id} fixture must seed duplicate managed rows`,
  );

  // Three consecutive runs must converge once and then hold the exact bytes.
  const configBytesPerRun: string[] = [];
  for (let installerRun = 0; installerRun < 3; installerRun += 1) {
    const repairRun = runInstaller(
      targetProjectPath,
      "--agent",
      agentProfile.id,
    );
    assert.equal(repairRun.status, 0, repairRun.stderr || repairRun.stdout);
    configBytesPerRun.push(readFileSync(hookConfigPath, "utf-8"));
  }
  assert.equal(configBytesPerRun[1], configBytesPerRun[0]);
  assert.equal(configBytesPerRun[2], configBytesPerRun[0]);

  const convergedConfig = JSON.parse(configBytesPerRun[0]!) as Record<
    string,
    unknown
  >;
  assert.equal(
    countManagedHookRegistrations(convergedConfig, "deny-dangerous.sh"),
    1,
    `${agentProfile.id} must keep exactly one managed deny row`,
  );
  // Stable pretty JSON keeps user diffs readable after every future run.
  assert.equal(
    configBytesPerRun[0],
    `${JSON.stringify(convergedConfig, null, 2)}\n`,
  );
  assert.ok(
    configBytesPerRun[0]!.includes(USER_HOOK_MARKER),
    `${agentProfile.id} must preserve the user's own hook row`,
  );
  assert.ok(
    !configBytesPerRun[0]!.includes(STALE_DENY_COMMAND),
    `${agentProfile.id} must remove the stale managed row`,
  );
  const denyDangerousHook = getHookSpec("deny-dangerous");
  assert.ok(denyDangerousHook);
  assert.equal(
    readAgentHookState(targetProjectPath, agentProfile, denyDangerousHook)
      .installed,
    true,
    `${agentProfile.id} converged registration must read as installed`,
  );
  return hookConfigPath;
}

describe("cross-agent install smoke matrix", () => {
  const supportedAgentProfiles = getAgentProfiles();
  assert.deepEqual(
    supportedAgentProfiles.map((profile) => profile.id),
    ["claude", "codex", "antigravity", "copilot"],
  );

  it("defines one complete managed-hook desired-state matrix per agent", () => {
    assert.deepEqual(
      MANAGED_HOOK_DESIRED_STATE_FIXTURES.map((fixture) => fixture.state),
      MANAGED_HOOK_STATE_NAMES,
    );

    for (const agentProfile of supportedAgentProfiles) {
      for (const fixture of MANAGED_HOOK_DESIRED_STATE_FIXTURES) {
        const expectedWritePaths = expectedManagedHookWritePaths(
          fixture,
          agentProfile,
        );
        assert.equal(
          new Set(expectedWritePaths).size,
          expectedWritePaths.length,
          `${agentProfile.id} ${fixture.state} repeats a write path`,
        );
        assert.equal(
          expectedWritePaths.every(
            (path) =>
              path.length > 0 &&
              !path.startsWith("/") &&
              !path.split("/").includes(".."),
          ),
          true,
          `${agentProfile.id} ${fixture.state} has a non-project-relative write`,
        );
        assert.equal(
          fixture.expectedRegistrationCount,
          fixture.isDesiredEnabled ? 1 : 0,
          `${agentProfile.id} ${fixture.state} registration target disagrees with config`,
        );
        if (fixture.expectedResult === "blocked-conflict") {
          assert.deepEqual(expectedWritePaths, []);
          assert.equal(fixture.expectedManagedFiles, "preserved-local");
        }
      }
    }
  });

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

    it(`${agentProfile.id} standalone install matches writer hook state`, () => {
      const installedTargetPath =
        verifyStandaloneInstallerHookSemantics(agentProfile);
      assert.ok(agentProfile.hookConfigFile);
      assert.equal(
        existsSync(join(installedTargetPath, agentProfile.hookConfigFile)),
        true,
      );
    });

    it(`${agentProfile.id} standalone installs converge duplicate and stale deny rows`, () => {
      const convergedHookConfigPath =
        verifyInstallerDuplicateConvergence(agentProfile);
      assert.equal(existsSync(convergedHookConfigPath), true);
    });
  }

  it("reads inline and quoted hook toggles as semantic YAML", () => {
    const targetProjectPath = makeTempProject();
    const claudeProfile = supportedAgentProfiles.find(
      (profile) => profile.id === "claude",
    );
    const denySpec = getHookSpec("deny-dangerous");
    const gruffSpec = getHookSpec("gruff-code-quality");
    assert.ok(claudeProfile?.hookConfigFile);
    assert.ok(denySpec);
    assert.ok(gruffSpec);
    const configText =
      'hooks: { "deny-dangerous": { enabled: false }, "post-turn-safety": { enabled: false }, "gruff-code-quality": { enabled: true } }\n';
    mkdirSync(join(targetProjectPath, ".goat-flow"), { recursive: true });
    writeFileSync(
      join(targetProjectPath, ".goat-flow", "config.yaml"),
      configText,
    );

    const installResult = runInstaller(
      targetProjectPath,
      "--agent",
      claudeProfile.id,
    );

    assert.equal(installResult.status, 0, installResult.stderr);
    assert.equal(
      readAgentHookState(targetProjectPath, claudeProfile, denySpec).installed,
      false,
    );
    assert.equal(
      readAgentHookState(targetProjectPath, claudeProfile, gruffSpec).installed,
      true,
    );
    assert.equal(
      readFileSync(
        join(targetProjectPath, ".goat-flow", "config.yaml"),
        "utf-8",
      ),
      configText,
    );
  });

  it("adds a missing managed hook to a flow-style hooks mapping without corrupting YAML", () => {
    const targetProjectPath = makeTempProject();
    const claudeProfile = supportedAgentProfiles.find(
      (profile) => profile.id === "claude",
    );
    assert.ok(claudeProfile?.hookConfigFile);
    const configText =
      'hooks: { "deny-dangerous": { enabled: false }, "gruff-code-quality": { enabled: true } }\n';
    mkdirSync(join(targetProjectPath, ".goat-flow"), { recursive: true });
    writeFileSync(
      join(targetProjectPath, ".goat-flow", "config.yaml"),
      configText,
    );

    const installResult = runInstaller(
      targetProjectPath,
      "--agent",
      claudeProfile.id,
    );

    assert.equal(installResult.status, 0, installResult.stderr);
    const mutatedText = readFileSync(
      join(targetProjectPath, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    const parsedConfig = load(mutatedText) as {
      hooks: Record<string, { enabled: boolean }>;
    };
    assert.ok(parsedConfig !== null && typeof parsedConfig === "object");
    assert.equal(parsedConfig.hooks["post-turn-safety"].enabled, true);
    assert.equal(parsedConfig.hooks["deny-dangerous"].enabled, false);
    assert.equal(parsedConfig.hooks["gruff-code-quality"].enabled, true);
    assert.equal(
      mutatedText.includes('"deny-dangerous": { enabled: false }'),
      true,
      "explicit user hook choices must survive byte-for-byte",
    );
    assert.equal(
      mutatedText.split("\n").length,
      configText.split("\n").length,
      "a flow-style mapping must converge inside its own line",
    );
    assert.equal(mutatedText.endsWith("\n"), true);
  });

  it("migrates a legacy disabled guard before reconciling registration", () => {
    const targetProjectPath = makeTempProject();
    const claudeProfile = supportedAgentProfiles.find(
      (profile) => profile.id === "claude",
    );
    const denySpec = getHookSpec("deny-dangerous");
    assert.ok(claudeProfile?.hookConfigFile);
    assert.ok(denySpec);
    const firstInstall = runInstaller(
      targetProjectPath,
      "--agent",
      claudeProfile.id,
    );
    assert.equal(firstInstall.status, 0, firstInstall.stderr);
    writeFileSync(
      join(targetProjectPath, ".goat-flow", "config.yaml"),
      "hooks:\n  guard-secret-paths:\n    enabled: false\n",
    );

    const migration = runInstaller(
      targetProjectPath,
      "--agent",
      claudeProfile.id,
    );

    assert.equal(migration.status, 0, migration.stderr);
    assert.equal(
      readAgentHookState(targetProjectPath, claudeProfile, denySpec).installed,
      false,
    );
    const migratedConfig = readFileSync(
      join(targetProjectPath, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    assert.match(migratedConfig, /deny-dangerous:\s*\n\s+enabled: false/u);
    assert.doesNotMatch(migratedConfig, /guard-secret-paths/u);
  });

  it("keeps a preview-preserved goat-flow gitignore byte-identical", () => {
    const targetProjectPath = makeTempProject();
    const gitignorePath = join(targetProjectPath, ".goat-flow", ".gitignore");
    const preservedContent = "# local policy\n*.private\n";
    mkdirSync(dirname(gitignorePath), { recursive: true });
    writeFileSync(gitignorePath, preservedContent);

    const installResult = runInstaller(
      targetProjectPath,
      "--agent",
      "codex",
      "--preserve-path",
      ".goat-flow/.gitignore",
    );

    assert.equal(installResult.status, 0, installResult.stderr);
    assert.equal(readFileSync(gitignorePath, "utf-8"), preservedContent);
  });

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
