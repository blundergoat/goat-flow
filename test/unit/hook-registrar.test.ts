/**
 * How hooks arrive on disk: newer installed copies are never overwritten, stale timeouts
 * read as uninstalled, and the generated launchers resolve the correct repo root from
 * worktrees, submodules, and outside-repo working directories.
 * Every case builds a real project and reads back what the registrar actually wrote.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import {
  deriveManagedHookDesiredState,
  readAgentHookState,
  writeAgentHookState,
} from "../../src/cli/server/agent-hook-writer.js";
import {
  applyHookState,
  HookRegistrarError,
  syncHookStates,
} from "../../src/cli/server/hook-registrar.js";
import {
  agentHookSpawnDescriptor,
  managedAgentHookDescriptor,
} from "../../src/cli/server/agent-hook-command.js";
import {
  getHookSpec,
  isValidHookIdShape,
  listHookSpecs,
} from "../../src/cli/server/hooks-registry.js";
import {
  discoverWindowsBashCandidates as discoverHookWindowsBashCandidates,
  pickWindowsBashPath as pickHookWindowsBashPath,
} from "../../workflow/hooks/run-with-bash.mjs";

import {
  HOOK_IDENTIFIER,
  CLAUDE_SAFE_PAYLOAD,
  CLAUDE_DANGEROUS_PAYLOAD,
  withTempProject,
  runGit,
  commitAll,
  readClaudeDenyLauncher,
  readCodexDenyLauncher,
  installClaudeDenyHook,
  installCodexDenyHook,
  readClaudeGruffCommands,
  runClaudeLauncher,
  assertLauncherAllows,
  runCodexLauncher,
  SUPPORTED_PROVIDER_HOOK_CASES,
  countOwnedCommandRows,
} from "./hook-registrar.helpers.js";

describe("hook registrar: launchers and installation", () => {
  /** Proves installed hooks can find default Git Bash when PATH exposes only WSL. */
  it("finds default Git Bash for hooks when PATH exposes only the WSL shim", () => {
    const defaultGitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
    const candidates = discoverHookWindowsBashCandidates({
      environment: { ProgramFiles: "C:\\Program Files" },
      pathExists: (candidate: string) => candidate === defaultGitBash,
      runWhere: (executable: string) =>
        executable === "bash" ? ["C:\\Windows\\System32\\bash.exe"] : [],
    });

    assert.equal(pickHookWindowsBashPath(candidates), defaultGitBash);
  });

  it("refuses to overwrite a hook stamped newer than the running CLI", () => {
    withTempProject((root) => {
      const hookDir = join(root, ".goat-flow", "hooks");
      const hookPath = join(hookDir, "deny-dangerous.sh");
      const futureHook =
        "#!/usr/bin/env bash\n# goat-flow-hook-version: 999.0.0\n";
      mkdirSync(join(root, ".codex"), { recursive: true });
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "\n");
      writeFileSync(hookPath, futureHook);

      assert.throws(
        () => syncHookStates(root),
        (error: unknown) => {
          assert.ok(error instanceof HookRegistrarError);
          assert.equal(error.statusCode, 409);
          assert.match(error.message, /Refusing to overwrite/u);
          assert.match(error.message, new RegExp(`CLI \\(${AUDIT_VERSION}\\)`));
          return true;
        },
      );
      assert.equal(readFileSync(hookPath, "utf-8"), futureHook);
      assert.equal(existsSync(join(root, ".codex", "hooks.json")), false);
    });
  });

  // Writes a stale timeout because dashboard state must stay off until sync replaces it.
  it("treats a stale Claude hook timeout as uninstalled", () => {
    withTempProject((root) => {
      const postTurnSafetySpec = getHookSpec("post-turn-safety");
      assert.ok(postTurnSafetySpec);
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(
        join(root, ".claude", "settings.json"),
        `${JSON.stringify(
          {
            hooks: {
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/post-turn-safety.sh",
                      timeout: 60,
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const staleTimeoutState = readAgentHookState(
        root,
        PROFILES.claude,
        postTurnSafetySpec,
      );
      assert.equal(staleTimeoutState.installed, false);

      writeAgentHookState(root, PROFILES.claude, postTurnSafetySpec, true);
      const repairedTimeoutState = readAgentHookState(
        root,
        PROFILES.claude,
        postTurnSafetySpec,
      );
      assert.equal(repairedTimeoutState.installed, true);
      assert.match(
        readFileSync(join(root, ".claude", "settings.json"), "utf-8"),
        /"timeout": 90/u,
      );
    });
  });

  it("persists hook state through the writer and exposes registry specs", () => {
    withTempProject((root) => {
      const spec = getHookSpec("deny-dangerous");
      assert.ok(spec);

      writeAgentHookState(root, PROFILES.codex, spec, true);
      const state = readAgentHookState(root, PROFILES.codex, spec);

      assert.equal(state.installed, true);
      assert.equal(
        listHookSpecs().some((hookSpec) => hookSpec.id === spec.id),
        true,
      );
      const gruffSpec = getHookSpec("gruff-code-quality");
      assert.equal(gruffSpec?.matcher, "Edit|Write|Bash");
      assert.equal(
        gruffSpec?.deliveryContract?.resultProtocol,
        "goat-flow.hook-result.v1",
      );
      assert.equal(
        gruffSpec?.scriptFiles.includes("hook-provider-adapters.mjs"),
        true,
      );
      assert.match(
        gruffSpec?.unsupportedAgents?.antigravity ?? "",
        /cannot deliver Gruff feedback/u,
      );
      assert.equal(getHookSpec("plan-checkbox-guard"), null);
      assert.equal(isValidHookIdShape("gruff-code-quality"), true);
      assert.equal(isValidHookIdShape("../bad"), false);
    });
  });

  it("covers every supported provider and hook in the desired-state fixtures", () => {
    const coveredProviderHooks = SUPPORTED_PROVIDER_HOOK_CASES.map(
      ({ agent, hookId }) => `${agent.id}:${hookId}`,
    );
    const registryProviderHooks = Object.values(PROFILES).flatMap((agent) =>
      listHookSpecs()
        .filter((hookSpec) => !hookSpec.unsupportedAgents?.[agent.id])
        .map((hookSpec) => `${agent.id}:${hookSpec.id}`),
    );
    assert.deepEqual(coveredProviderHooks.sort(), registryProviderHooks.sort());
  });

  // Separate TAP cases identify the provider and lifecycle whose desired-state contract drifted.
  for (const desiredStateCase of SUPPORTED_PROVIDER_HOOK_CASES) {
    it(`${desiredStateCase.agent.id}:${desiredStateCase.hookId} derives enabled and disabled targets`, () => {
      const hookSpec = getHookSpec(desiredStateCase.hookId);
      assert.ok(hookSpec);

      assert.deepEqual(
        deriveManagedHookDesiredState(desiredStateCase.agent, hookSpec, true),
        {
          managedScriptFiles: hookSpec.scriptFiles,
          registrationTargets: desiredStateCase.registrationTargets,
        },
      );
      assert.deepEqual(
        deriveManagedHookDesiredState(desiredStateCase.agent, hookSpec, false),
        {
          managedScriptFiles: hookSpec.scriptFiles,
          registrationTargets: [],
        },
      );
    });

    it(`${desiredStateCase.agent.id}:${desiredStateCase.hookId} repairs a duplicate registration`, () => {
      withTempProject((root) => {
        const hookSpec = getHookSpec(desiredStateCase.hookId);
        assert.ok(hookSpec);
        writeAgentHookState(root, desiredStateCase.agent, hookSpec, true);
        assert.ok(desiredStateCase.agent.hookConfigFile);
        const hookConfigPath = join(
          root,
          desiredStateCase.agent.hookConfigFile,
        );
        const hookConfig = JSON.parse(
          readFileSync(hookConfigPath, "utf-8"),
        ) as Record<string, unknown>;
        const firstRegistrationTarget = desiredStateCase.registrationTargets[0];
        assert.ok(firstRegistrationTarget);

        // Antigravity nests event rows below the hook id; other providers share a hooks object.
        const eventEntries =
          desiredStateCase.agent.id === "antigravity"
            ? (hookConfig[hookSpec.id] as Record<string, unknown[]>)[
                firstRegistrationTarget.event
              ]
            : (hookConfig.hooks as Record<string, unknown[]>)[
                firstRegistrationTarget.event
              ];
        assert.ok(Array.isArray(eventEntries));
        assert.ok(eventEntries[0]);
        eventEntries.push(structuredClone(eventEntries[0]));
        // A neighbouring user hook in the same event array must survive the repair.
        const userHookRow =
          desiredStateCase.agent.id === "copilot"
            ? {
                type: "command",
                bash: "./scripts/team-audit.sh",
                powershell: "./scripts/team-audit.ps1",
                timeoutSec: 10,
              }
            : {
                matcher: firstRegistrationTarget.matcher ?? undefined,
                hooks: [
                  { type: "command", command: "./scripts/team-audit.sh" },
                ],
              };
        eventEntries.push(structuredClone(userHookRow));
        hookConfig.userOwnedMarker = "preserve";
        writeFileSync(
          hookConfigPath,
          `${JSON.stringify(hookConfig, null, 2)}\n`,
        );

        // The seeded duplicate is executable state, not metadata: one extra owned row exists.
        assert.equal(
          countOwnedCommandRows(
            JSON.parse(readFileSync(hookConfigPath, "utf-8")),
            hookSpec,
          ),
          desiredStateCase.registrationTargets.length + 1,
        );
        assert.equal(
          readAgentHookState(root, desiredStateCase.agent, hookSpec)
            .registrationIssue,
          "duplicate-registration",
        );

        writeAgentHookState(root, desiredStateCase.agent, hookSpec, true);
        const repairedConfig = JSON.parse(
          readFileSync(hookConfigPath, "utf-8"),
        ) as Record<string, unknown>;
        assert.equal(
          readAgentHookState(root, desiredStateCase.agent, hookSpec).installed,
          true,
        );
        // Installed state alone cannot prove convergence; count the physical rows.
        assert.equal(
          countOwnedCommandRows(repairedConfig, hookSpec),
          desiredStateCase.registrationTargets.length,
        );
        assert.equal(repairedConfig.userOwnedMarker, "preserve");
        const repairedEventEntries =
          desiredStateCase.agent.id === "antigravity"
            ? (repairedConfig[hookSpec.id] as Record<string, unknown[]>)[
                firstRegistrationTarget.event
              ]
            : (repairedConfig.hooks as Record<string, unknown[]>)[
                firstRegistrationTarget.event
              ];
        assert.ok(Array.isArray(repairedEventEntries));
        // Antigravity definitions are replaced wholesale, so the user row lives elsewhere.
        if (desiredStateCase.agent.id !== "antigravity") {
          assert.ok(
            repairedEventEntries.some(
              (eventEntry) =>
                JSON.stringify(eventEntry) === JSON.stringify(userHookRow),
            ),
            "the neighbouring user hook row must survive duplicate repair",
          );
        }
      });
    });
  }

  it("converges duplicate and mixed stale and current rows across three CLI syncs", () => {
    withTempProject((root) => {
      runGit(root, ["init", "-q"]);
      const denySpec = getHookSpec("deny-dangerous");
      const postTurnSpec = getHookSpec("post-turn-safety");
      assert.ok(denySpec);
      assert.ok(postTurnSpec);
      const staleShellRow = {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: "bash .goat-flow/hooks/deny-dangerous.sh",
          },
        ],
      };
      const userShellRow = {
        matcher: "Bash",
        hooks: [{ type: "command", command: "./scripts/team-audit.sh" }],
      };
      // The reported consumer state: two byte-identical stale Stop groups.
      const staleStopGroup = {
        hooks: [
          {
            type: "command",
            command: [
              "node",
              "-e",
              JSON.stringify("process.exit(0);"),
              JSON.stringify(".goat-flow/hooks/post-turn-safety.sh"),
              JSON.stringify("post-turn"),
              JSON.stringify("CLAUDE_PROJECT_DIR"),
              JSON.stringify(".claude/settings.json"),
              JSON.stringify(".goat-flow/hooks/run-with-bash.mjs"),
            ].join(" "),
            timeout: 90,
          },
        ],
      };

      // Seed every provider surface with its current rows first.
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "\n");
      mkdirSync(join(root, ".agents"), { recursive: true });
      writeFileSync(join(root, ".agents", "hooks.json"), "{}\n");
      mkdirSync(join(root, ".github", "hooks"), { recursive: true });
      writeFileSync(join(root, ".github", "hooks", "hooks.json"), "{}\n");
      writeAgentHookState(root, PROFILES.claude, denySpec, true);
      writeAgentHookState(root, PROFILES.codex, denySpec, true);
      writeAgentHookState(root, PROFILES.antigravity, denySpec, true);
      writeAgentHookState(root, PROFILES.copilot, denySpec, true);

      // Pollute each provider with duplicate, stale, and user-owned rows.
      const claudeSettingsPath = join(root, ".claude", "settings.json");
      const claudeSettings = JSON.parse(
        readFileSync(claudeSettingsPath, "utf-8"),
      ) as { hooks: { PreToolUse: unknown[]; Stop: unknown[] } };
      const claudeDenyRow = claudeSettings.hooks.PreToolUse[0];
      assert.ok(claudeDenyRow);
      claudeSettings.hooks.PreToolUse.push(
        structuredClone(claudeDenyRow),
        structuredClone(staleShellRow),
        structuredClone(userShellRow),
      );
      claudeSettings.hooks.Stop = [
        structuredClone(staleStopGroup),
        structuredClone(staleStopGroup),
      ];
      writeFileSync(
        claudeSettingsPath,
        `${JSON.stringify(claudeSettings, null, 2)}\n`,
      );

      const codexHooksPath = join(root, ".codex", "hooks.json");
      const codexHooks = JSON.parse(readFileSync(codexHooksPath, "utf-8")) as {
        hooks: { PreToolUse: unknown[] };
      };
      const codexDenyRow = codexHooks.hooks.PreToolUse[0];
      assert.ok(codexDenyRow);
      codexHooks.hooks.PreToolUse.push(
        structuredClone(codexDenyRow),
        structuredClone(staleShellRow),
        structuredClone(userShellRow),
      );
      writeFileSync(codexHooksPath, `${JSON.stringify(codexHooks, null, 2)}\n`);

      const antigravityHooksPath = join(root, ".agents", "hooks.json");
      const antigravityHooks = JSON.parse(
        readFileSync(antigravityHooksPath, "utf-8"),
      ) as { "deny-dangerous": { PreToolUse: unknown[] } } & Record<
        string,
        unknown
      >;
      const antigravityDenyGroup =
        antigravityHooks["deny-dangerous"].PreToolUse[0];
      assert.ok(antigravityDenyGroup);
      antigravityHooks["deny-dangerous"].PreToolUse.push(
        structuredClone(antigravityDenyGroup),
      );
      antigravityHooks["team-audit"] = {
        enabled: true,
        PreToolUse: [
          {
            matcher: "run_command",
            hooks: [{ type: "command", command: "./scripts/team-audit.sh" }],
          },
        ],
      };
      writeFileSync(
        antigravityHooksPath,
        `${JSON.stringify(antigravityHooks, null, 2)}\n`,
      );

      const copilotHooksPath = join(root, ".github", "hooks", "hooks.json");
      const copilotHooks = JSON.parse(
        readFileSync(copilotHooksPath, "utf-8"),
      ) as { hooks: { preToolUse: unknown[] } };
      const copilotDenyRow = copilotHooks.hooks.preToolUse[0];
      assert.ok(copilotDenyRow);
      copilotHooks.hooks.preToolUse.push(
        structuredClone(copilotDenyRow),
        {
          type: "command",
          bash: "bash .goat-flow/hooks/deny-dangerous.sh",
          powershell: "bash .goat-flow/hooks/deny-dangerous.sh",
          timeoutSec: 30,
        },
        {
          type: "command",
          bash: "./scripts/team-audit.sh",
          powershell: "./scripts/team-audit.ps1",
          timeoutSec: 10,
        },
      );
      writeFileSync(
        copilotHooksPath,
        `${JSON.stringify(copilotHooks, null, 2)}\n`,
      );

      // Three consecutive syncs must converge once and then hold exact bytes.
      const providerConfigPaths = [
        claudeSettingsPath,
        codexHooksPath,
        antigravityHooksPath,
        copilotHooksPath,
      ];
      const configBytesPerRun: string[][] = [];
      for (let syncRun = 0; syncRun < 3; syncRun += 1) {
        syncHookStates(root);
        configBytesPerRun.push(
          providerConfigPaths.map((configPath) =>
            readFileSync(configPath, "utf-8"),
          ),
        );
      }
      assert.deepEqual(configBytesPerRun[1], configBytesPerRun[0]);
      assert.deepEqual(configBytesPerRun[2], configBytesPerRun[0]);

      // Each provider ends with exactly one owned deny row and no stale text.
      for (const [configIndex, configPath] of providerConfigPaths.entries()) {
        const convergedText = configBytesPerRun[0]![configIndex]!;
        assert.equal(
          countOwnedCommandRows(JSON.parse(convergedText), denySpec),
          1,
          `${configPath} must keep exactly one owned deny row`,
        );
        assert.ok(
          !convergedText.includes("bash .goat-flow/hooks/deny-dangerous.sh"),
          `${configPath} must drop the stale managed row`,
        );
        assert.ok(
          convergedText.includes("team-audit"),
          `${configPath} must preserve the user's own hook row`,
        );
      }

      // The duplicated stale Stop groups converge to one current structured row.
      const convergedClaude = JSON.parse(configBytesPerRun[0]![0]!) as {
        hooks: {
          Stop: Array<{ hooks: Array<{ command?: string; args?: string[] }> }>;
        };
      };
      assert.equal(
        countOwnedCommandRows(convergedClaude, postTurnSpec),
        1,
        "the reported duplicate Stop state must converge to one row",
      );
      assert.equal(convergedClaude.hooks.Stop.length, 1);
      assert.equal(convergedClaude.hooks.Stop[0]!.hooks[0]!.command, "node");
      assert.ok(Array.isArray(convergedClaude.hooks.Stop[0]!.hooks[0]!.args));
      assert.ok(
        !configBytesPerRun[0]![0]!.includes("process.exit(0);"),
        "stale inline Stop commands must not survive the sync",
      );
    });
  });

  it("keeps current managed files while a user leaves a hook disabled", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");

      applyHookState(HOOK_IDENTIFIER, false, root);

      const managedHookPath = join(
        root,
        ".goat-flow",
        "hooks",
        "deny-dangerous.sh",
      );
      assert.equal(existsSync(managedHookPath), true);
      assert.equal(existsSync(join(root, ".codex", "hooks.json")), false);

      // For example, the user may restore a checkout after its managed hook file was deleted.
      rmSync(managedHookPath);
      syncHookStates(root);

      const denyDangerousSpec = getHookSpec(HOOK_IDENTIFIER);
      assert.ok(denyDangerousSpec);
      assert.equal(existsSync(managedHookPath), true);
      const disabledState = readAgentHookState(
        root,
        PROFILES.codex,
        denyDangerousSpec,
      );
      assert.equal(disabledState.registrationIssue, undefined);
      assert.equal(disabledState.configMissing, true);
      assert.equal(existsSync(join(root, ".codex", "hooks.json")), false);
    });
  });

  it("uses policy-hook startup copy in generated launcher failures", () => {
    withTempProject((root) => {
      const denySpec = getHookSpec("deny-dangerous");
      const gruffSpec = getHookSpec("gruff-code-quality");
      assert.ok(denySpec);
      assert.ok(gruffSpec);

      writeAgentHookState(root, PROFILES.claude, denySpec, true);
      writeAgentHookState(root, PROFILES.claude, gruffSpec, true);
      writeAgentHookState(root, PROFILES.antigravity, denySpec, true);
      writeAgentHookState(root, PROFILES.copilot, denySpec, true);

      const claudeSettings = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      const antigravityHooks = readFileSync(
        join(root, ".agents", "hooks.json"),
        "utf-8",
      );
      const copilotHooks = readFileSync(
        join(root, ".github", "hooks", "hooks.json"),
        "utf-8",
      );
      const claudeGruffCommands = readClaudeGruffCommands(claudeSettings);

      // every() on an empty list passes vacuously; require commands first.
      assert.ok(
        claudeGruffCommands.length > 0,
        "expected generated Claude gruff commands",
      );
      assert.match(claudeSettings, /Policy hook unavailable:/u);
      assert.match(claudeSettings, /managed root unavailable/u);
      assert.ok(
        claudeGruffCommands.every((command) =>
          command.includes("gruff-code-quality: hook unavailable"),
        ),
      );
      assert.ok(
        claudeGruffCommands.every(
          (command) => !command.includes("BLOCKED: Policy hook unavailable"),
        ),
      );
      assert.doesNotMatch(claudeSettings, /Guard.*git repository root/u);
      assert.match(antigravityHooks, /Policy hook unavailable:/u);
      assert.match(antigravityHooks, /managed root unavailable/u);
      assert.doesNotMatch(antigravityHooks, /gruff-code-quality/u);
      assert.doesNotMatch(antigravityHooks, /Guard.*git repository root/u);
      assert.match(antigravityHooks, /"timeout": 30/u);
      assert.match(copilotHooks, /"timeoutSec": 30/u);
      const expectedFeedbackTimeoutSeconds = 90;
      assert.equal(gruffSpec.timeoutSec, expectedFeedbackTimeoutSeconds);
      assert.equal(
        getHookSpec("post-turn-safety")?.timeoutSec,
        expectedFeedbackTimeoutSeconds,
      );
    });
  });

  it("migrates a historical inline Claude row to the structured descriptor without touching user hooks", () => {
    withTempProject((root) => {
      const denySpec = getHookSpec(HOOK_IDENTIFIER);
      assert.ok(denySpec);
      // Historical registrations carried one shell string whose operands name the managed scripts.
      const historicalInlineCommand = [
        "node",
        "-e",
        JSON.stringify("process.exit(0);"),
        JSON.stringify(".goat-flow/hooks/deny-dangerous.sh"),
        JSON.stringify("policy"),
        JSON.stringify("CLAUDE_PROJECT_DIR"),
        JSON.stringify(".claude/settings.json"),
        JSON.stringify(".goat-flow/hooks/run-with-bash.mjs"),
      ].join(" ");
      const userHook = {
        type: "command",
        command: "./scripts/custom-audit.sh --strict",
        timeout: 15,
      };
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(
        join(root, ".claude", "settings.json"),
        `${JSON.stringify(
          {
            permissions: { deny: ["Bash(*sudo *)"] },
            hooks: {
              PreToolUse: [
                { matcher: "Bash", hooks: [userHook] },
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: historicalInlineCommand,
                      timeout: 30,
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      writeAgentHookState(root, PROFILES.claude, denySpec, true);
      const migratedText = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      const migrated = JSON.parse(migratedText) as {
        permissions?: unknown;
        hooks: {
          PreToolUse: Array<{
            matcher?: string;
            hooks: Array<Record<string, unknown>>;
          }>;
        };
      };

      // The user's own hook row and unrelated settings survive migration untouched.
      assert.deepEqual(migrated.hooks.PreToolUse[0], {
        matcher: "Bash",
        hooks: [userHook],
      });
      assert.deepEqual(migrated.permissions, { deny: ["Bash(*sudo *)"] });

      // Exactly one managed row remains, carrying the complete structured descriptor.
      const managedRows = migrated.hooks.PreToolUse.slice(1);
      assert.equal(managedRows.length, 1);
      const expectedDescriptor = managedAgentHookDescriptor(
        PROFILES.claude,
        denySpec,
      );
      if (expectedDescriptor.form !== "argv") {
        assert.fail("Claude must register the approved argv handler");
      }
      assert.deepEqual(managedRows[0], {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: expectedDescriptor.command,
            args: expectedDescriptor.args,
            timeout: denySpec.timeoutSec,
          },
        ],
      });

      // A second enable write is byte-identical, so migration cannot oscillate.
      writeAgentHookState(root, PROFILES.claude, denySpec, true);
      assert.equal(
        readFileSync(join(root, ".claude", "settings.json"), "utf-8"),
        migratedText,
      );
    });
  });

  it("keeps provider deny descriptors byte-identical to the committed installer contract", () => {
    const denySpec = getHookSpec(HOOK_IDENTIFIER);
    assert.ok(denySpec);
    const contract = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "..",
          "..",
          "workflow",
          "hooks",
          "agent-config",
          "managed-hook-desired-state.json",
        ),
        "utf-8",
      ),
    ) as {
      agents: Record<
        string,
        { hooks: Record<string, { config: Record<string, never> }> }
      >;
    };
    // Read one agent's deny-hook config out of the contract snapshot.
    const denyContractConfig = (agentId: string): Record<string, never> =>
      contract.agents[agentId]!.hooks["deny-dangerous"]!.config;

    // Codex keeps its deferred command bytes and adds the approved Windows override.
    const codexDescriptor = managedAgentHookDescriptor(
      PROFILES.codex,
      denySpec,
    );
    if (codexDescriptor.form !== "shell") {
      assert.fail("Codex must retain a shell registration");
    }
    const codexContractRow = (
      denyContractConfig("codex") as {
        hooks: {
          PreToolUse: Array<{
            hooks: Array<{ command: string; commandWindows: string }>;
          }>;
        };
      }
    ).hooks.PreToolUse[0]!.hooks[0]!;
    assert.equal(codexContractRow.command, codexDescriptor.command);
    assert.equal(
      codexContractRow.commandWindows,
      codexDescriptor.commandWindows,
    );
    assert.deepEqual(agentHookSpawnDescriptor(codexDescriptor, "linux"), {
      command: "bash",
      args: ["-c", codexDescriptor.command],
    });
    assert.deepEqual(agentHookSpawnDescriptor(codexDescriptor, "win32"), {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        codexDescriptor.commandWindows,
      ],
    });

    // Antigravity retains its one deferred command string byte-for-byte.
    const antigravityDescriptor = managedAgentHookDescriptor(
      PROFILES.antigravity,
      denySpec,
    );
    if (antigravityDescriptor.form !== "shell") {
      assert.fail("Antigravity stays on its deferred shell registration");
    }
    const antigravityContractRow = (
      denyContractConfig("antigravity") as {
        "deny-dangerous": {
          PreToolUse: Array<{ hooks: Array<{ command: string }> }>;
        };
      }
    )["deny-dangerous"].PreToolUse[0]!.hooks[0]!;
    assert.equal(antigravityContractRow.command, antigravityDescriptor.command);

    // Copilot's deferred registration keeps the same command in both shell fields.
    const copilotDescriptor = managedAgentHookDescriptor(
      PROFILES.copilot,
      denySpec,
    );
    if (copilotDescriptor.form !== "shell") {
      assert.fail("Copilot stays on its deferred shell registration");
    }
    const copilotContractRow = (
      denyContractConfig("copilot") as {
        hooks: {
          preToolUse: Array<{ bash: string; powershell: string }>;
        };
      }
    ).hooks.preToolUse[0]!;
    assert.equal(copilotContractRow.bash, copilotDescriptor.command);
    assert.equal(copilotContractRow.powershell, copilotDescriptor.command);

    // Claude's approved handler remains the provider-native argv form.
    const claudeDescriptor = managedAgentHookDescriptor(
      PROFILES.claude,
      denySpec,
    );
    if (claudeDescriptor.form !== "argv") {
      assert.fail("Claude must register the approved argv handler");
    }
    const claudeContractRow = (
      denyContractConfig("claude") as {
        hooks: {
          PreToolUse: Array<{
            hooks: Array<{ command: string; args: string[] }>;
          }>;
        };
      }
    ).hooks.PreToolUse[0]!.hooks[0]!;
    assert.equal(claudeContractRow.command, claudeDescriptor.command);
    assert.deepEqual(claudeContractRow.args, claudeDescriptor.args);
  });

  it("reports a stale Codex Windows override as command drift", () => {
    withTempProject((root) => {
      installCodexDenyHook(root);
      const configPath = join(root, ".codex", "hooks.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
        hooks: {
          PreToolUse: Array<{
            hooks: Array<{ commandWindows: string }>;
          }>;
        };
      };
      config.hooks.PreToolUse[0]!.hooks[0]!.commandWindows += " stale";
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

      const denySpec = getHookSpec(HOOK_IDENTIFIER);
      assert.ok(denySpec);
      assert.equal(
        readAgentHookState(root, PROFILES.codex, denySpec).registrationIssue,
        "command-or-response-mismatch",
      );
    });
  });

  // Fixture: writes four repository shapes a user can really be sitting in.
  // A launcher that resolves the wrong root silently protects nothing.
  it("generated Claude launchers resolve active worktrees, submodules, bare repos, and outside-repo cwd", () => {
    withTempProject((root) => {
      const main = join(root, "main");
      const worktree = join(root, "main-worktree");
      mkdirSync(main, { recursive: true });
      runGit(main, ["init", "-q"]);
      writeFileSync(join(main, "README.md"), "# main\n");
      writeFileSync(join(main, ".gitignore"), ".claude/\n");
      commitAll(main, "initial main");

      const mainLauncher = installClaudeDenyHook(main);
      commitAll(main, "install central hooks");
      // The registered handler is exec-form, so its contract lives in the argv tuple.
      const mainLauncherText = [
        mainLauncher.command,
        ...mainLauncher.args,
      ].join("\n");
      assert.match(mainLauncherText, /run-with-bash\.mjs/u);
      assert.match(mainLauncherText, /--show-toplevel/u);
      assert.doesNotMatch(mainLauncherText, /git-common-dir/u);
      runGit(main, [
        "worktree",
        "add",
        "-q",
        "-b",
        "fixture-worktree",
        worktree,
      ]);

      assert.equal(
        existsSync(join(worktree, ".goat-flow", "hooks", "deny-dangerous.sh")),
        true,
        "worktree fixture should prove central hooks exist in the active checkout",
      );
      installClaudeDenyHook(worktree);
      assert.match(
        runGit(worktree, ["rev-parse", "--show-toplevel"]),
        /main-worktree$/u,
      );
      assertLauncherAllows(mainLauncher, worktree);

      const subSource = join(root, "sub-source");
      mkdirSync(subSource, { recursive: true });
      runGit(subSource, ["init", "-q"]);
      writeFileSync(join(subSource, "README.md"), "# submodule\n");
      const sourceLauncher = installClaudeDenyHook(subSource);
      const sourceLauncherText = [
        sourceLauncher.command,
        ...sourceLauncher.args,
      ].join("\n");
      assert.match(sourceLauncherText, /run-with-bash\.mjs/u);
      assert.match(sourceLauncherText, /--show-toplevel/u);
      assert.doesNotMatch(sourceLauncherText, /git-common-dir/u);
      commitAll(subSource, "initial submodule with central hooks");

      const parent = join(root, "parent");
      mkdirSync(parent, { recursive: true });
      runGit(parent, ["init", "-q"]);
      writeFileSync(join(parent, "README.md"), "# parent\n");
      commitAll(parent, "initial parent");
      runGit(parent, [
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "-q",
        subSource,
        "sub",
      ]);
      commitAll(parent, "add submodule");

      const subWorktree = join(parent, "sub");
      const subLauncher = readClaudeDenyLauncher(subWorktree);
      assert.match(
        runGit(subWorktree, ["rev-parse", "--git-common-dir"]),
        /\.git\/modules\/sub$/u,
      );
      // Git prints forward-slash paths on Windows, so compare in one slash style.
      assert.equal(
        runGit(subWorktree, ["rev-parse", "--show-toplevel"]),
        subWorktree.replaceAll("\\", "/"),
      );
      assertLauncherAllows(subLauncher, subWorktree);

      const bare = join(root, "bare.git");
      runGit(root, ["init", "--bare", "-q", bare]);
      const bareResult = runClaudeLauncher(mainLauncher, bare);
      assert.equal(bareResult.status, 2);
      assert.match(bareResult.stderr, /Policy hook unavailable/u);
      assert.doesNotMatch(bareResult.stderr, /No such file or directory/u);

      const scratch = join(root, "scratch");
      mkdirSync(scratch, { recursive: true });
      const withEnv = { ...process.env, CLAUDE_PROJECT_DIR: main };
      const scratchAllowed = runClaudeLauncher(
        mainLauncher,
        scratch,
        CLAUDE_SAFE_PAYLOAD,
        withEnv,
      );
      assert.equal(scratchAllowed.status, 0);
      const scratchBlocked = runClaudeLauncher(
        mainLauncher,
        scratch,
        CLAUDE_DANGEROUS_PAYLOAD,
        withEnv,
      );
      assert.equal(scratchBlocked.status, 2);
      assert.match(scratchBlocked.stderr, /BLOCKED: Policy/u);
      const withoutEnv = runClaudeLauncher(mainLauncher, scratch);
      assert.equal(withoutEnv.status, 2);
      assert.match(withoutEnv.stderr, /Policy hook unavailable/u);
    });
  });

  it("generated Codex launchers resolve the active root without Claude env fallback", () => {
    withTempProject((root) => {
      runGit(root, ["init", "-q"]);
      writeFileSync(join(root, "README.md"), "# codex fixture\n");
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "\n");

      applyHookState(HOOK_IDENTIFIER, true, root);

      const launcher = readCodexDenyLauncher(root);
      assert.match(launcher.command, /run-with-bash\.mjs/u);
      assert.match(launcher.command, /--show-toplevel/u);
      assert.doesNotMatch(launcher.command, /CLAUDE_PROJECT_DIR/u);
      assert.doesNotMatch(launcher.command, /^\.goat-flow\/hooks/u);
      assert.match(launcher.commandWindows, /Buffer\.from/u);
      assert.doesNotMatch(launcher.commandWindows, /--show-toplevel/u);

      const nested = join(root, "src", "cli");
      mkdirSync(nested, { recursive: true });
      const safe = runCodexLauncher(launcher, nested);
      assert.equal(
        safe.status,
        0,
        `Codex launcher should allow benign payload from nested cwd\nstdout:\n${safe.stdout}\nstderr:\n${safe.stderr}`,
      );

      const blocked = runCodexLauncher(
        launcher,
        nested,
        CLAUDE_DANGEROUS_PAYLOAD,
      );
      assert.equal(blocked.status, 2);
      assert.match(blocked.stderr, /BLOCKED: Policy/u);
    });
  });

  it("launches the real guard from a managed non-Git root", () => {
    withTempProject((root) => {
      const launcher = installCodexDenyHook(root);
      assert.equal(runCodexLauncher(launcher, root).status, 0);
      const nested = join(root, "packages", "app");
      mkdirSync(nested, { recursive: true });

      const safe = runCodexLauncher(launcher, nested);
      assert.equal(safe.status, 0, `${safe.stdout}\n${safe.stderr}`);
      const blocked = runCodexLauncher(
        launcher,
        nested,
        CLAUDE_DANGEROUS_PAYLOAD,
      );
      assert.equal(blocked.status, 2, `${blocked.stdout}\n${blocked.stderr}`);
      assert.match(blocked.stderr, /BLOCKED: Policy/u);
    });
  });

  it("selects Git first, then the nearest complete managed ancestor", () => {
    withTempProject((root) => {
      const outerLauncher = installCodexDenyHook(root);
      const nestedGit = join(root, "workspace", "plain-git");
      mkdirSync(nestedGit, { recursive: true });
      runGit(nestedGit, ["init", "-q"]);
      const outerResult = runCodexLauncher(outerLauncher, nestedGit);
      assert.equal(
        outerResult.status,
        0,
        `${outerResult.stdout}\n${outerResult.stderr}`,
      );

      const inner = join(root, "workspace", "managed-inner");
      const innerLauncher = installCodexDenyHook(inner);
      assert.equal(typeof innerLauncher.commandWindows, "string");
      writeFileSync(
        join(inner, ".goat-flow", "hooks", "deny-dangerous.sh"),
        "#!/usr/bin/env bash\nprintf 'INNER_MANAGED_ROOT\\n'\n",
      );
      const innerCwd = join(inner, "src");
      mkdirSync(innerCwd, { recursive: true });
      const innerResult = runCodexLauncher(outerLauncher, innerCwd);
      assert.equal(
        innerResult.status,
        0,
        `${innerResult.stdout}\n${innerResult.stderr}`,
      );
      assert.equal(innerResult.stdout, "INNER_MANAGED_ROOT\n");
    });
  });

  /**
   * Fixture purpose: contrasts an unrelated config with a partial managed root the user must fix.
   * Writes both disposable layouts, then starts the launcher to show which one blocks the user.
   */
  it("skips unrelated configs but stops at a partial managed trace", () => {
    withTempProject((root) => {
      const launcher = installCodexDenyHook(root);
      const unrelated = join(root, "unrelated");
      // Fixture purpose: a user's unrelated agent config must not claim a managed goat-flow root.
      mkdirSync(join(unrelated, ".codex"), { recursive: true });
      writeFileSync(
        join(unrelated, ".codex", "hooks.json"),
        '{"hooks":{"PreToolUse":[{"command":"custom-tool"}]}}\n',
      );
      mkdirSync(join(unrelated, ".goat-flow", "hooks"), { recursive: true });
      writeFileSync(
        join(unrelated, ".goat-flow", "hooks", "run-with-bash.mjs"),
        "// launcher for a different managed hook\n",
      );
      const unrelatedResult = runCodexLauncher(launcher, unrelated);
      assert.equal(
        unrelatedResult.status,
        0,
        `${unrelatedResult.stdout}\n${unrelatedResult.stderr}`,
      );

      const partial = join(root, "partial");
      mkdirSync(join(partial, ".goat-flow", "hooks"), { recursive: true });
      writeFileSync(
        join(partial, ".goat-flow", "hooks", "deny-dangerous.sh"),
        "#!/usr/bin/env bash\nexit 0\n",
      );
      const partialResult = runCodexLauncher(launcher, partial);
      assert.equal(
        partialResult.status,
        2,
        `${partialResult.stdout}\n${partialResult.stderr}`,
      );
      assert.match(partialResult.stderr, /managed root incomplete/iu);
      assert.equal(partialResult.stderr.includes(root), false);
    });
  });

  /**
   * Fixture purpose: captures the exact user payload and verified working directory seen by a hook.
   * Writes capture files and starts the launcher inside a disposable project.
   */
  it("forwards stdin unchanged and gives the hook the verified root cwd", () => {
    withTempProject((root) => {
      const launcher = installCodexDenyHook(root);
      const payloadPath = join(root, "captured-payload.txt");
      const cwdPath = join(root, "captured-cwd.txt");
      // Fixture purpose: capture the exact user payload and working directory seen by the hook.
      writeFileSync(
        join(root, ".goat-flow", "hooks", "deny-dangerous.sh"),
        [
          "#!/usr/bin/env bash",
          'cat > "$GOAT_FLOW_TEST_PAYLOAD_PATH"',
          'if pwd -W >/dev/null 2>&1; then pwd -W; else pwd; fi > "$GOAT_FLOW_TEST_CWD_PATH"',
          "",
        ].join("\n"),
      );
      const nested = join(root, "deep", "cwd");
      mkdirSync(nested, { recursive: true });
      const payload = '{"raw":"line one\\nline two 🐐"}\n';
      const result = runCodexLauncher(launcher, nested, payload, {
        ...process.env,
        GOAT_FLOW_TEST_PAYLOAD_PATH: payloadPath,
        GOAT_FLOW_TEST_CWD_PATH: cwdPath,
      });

      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(readFileSync(payloadPath, "utf8"), payload);
      const capturedCwd = readFileSync(cwdPath, "utf8")
        .trim()
        .replaceAll("\\", "/");
      assert.equal(capturedCwd, root.replaceAll("\\", "/"));
    });
  });
});
