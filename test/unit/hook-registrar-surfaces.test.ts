/**
 * How hooks decide where they belong: only detected agent surfaces are enabled, uninstalled
 * ones are never scaffolded, removed hooks are pruned rather than resurrected, and sync
 * repairs configuration without inventing project state.
 * Every case builds a real project and reads back what the registrar actually wrote.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, it } from "node:test";
import {
  applyHookState,
  filesystemPathsAreEquivalent,
  syncHookStates,
} from "../../src/cli/server/hook-registrar.js";
import {
  readAgentHookState,
  writeAgentHookState,
} from "../../src/cli/server/agent-hook-writer.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";
import { PROFILES } from "../../src/cli/detect/agents.js";
import {
  HOOK_IDENTIFIER,
  GENERATED_AGENT_SURFACES,
  withTempProject,
  assertMissing,
  assertPresent,
  assertCodexPreToolUseOnly,
  readStopHookCommands,
  readAntigravitySafetyCommand,
  writePostTurnCapableSurfaces,
  verifyAgentHookRegistrationMatrix,
  runGit,
  installCodexDenyHook,
  MANAGED_SHAPE_MUTATIONS,
  runCodexLauncher,
} from "./hook-registrar.helpers.js";

describe("hook registrar: surface detection, toggles, and sync", () => {
  it("treats Windows case and separator variants as the same physical root", () => {
    assert.equal(
      filesystemPathsAreEquivalent(
        "C:\\Work\\HealthKit",
        "c:/work/healthkit",
        win32.relative,
      ),
      true,
    );
    const installerSource = readFileSync(
      join(import.meta.dirname, "..", "..", "workflow", "install-goat-flow.sh"),
      "utf-8",
    );
    assert.match(
      installerSource,
      /function filesystemPathsAreEquivalent[\s\S]*pathModule\.relative\(leftDirectory, rightDirectory\)[\s\S]*pathModule\.relative\(rightDirectory, leftDirectory\)/u,
    );
    assert.doesNotMatch(
      installerSource,
      /gitTopLevel\([^\n]+\) === [^\n]+/u,
    );
  });

  it("publishes cleanup metadata for hooks unsupported by one provider", () => {
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
        {
          hooks: Record<
            string,
            {
              supported: boolean;
              cleanup: {
                hookIds: string[];
                commandScriptNames: string[];
              };
            }
          >;
        }
      >;
    };
    const antigravityContract = contract.agents.antigravity;
    assert.ok(antigravityContract);
    assert.deepEqual(antigravityContract.hooks["gruff-code-quality"], {
      supported: false,
      cleanup: {
        hookIds: ["gruff-code-quality"],
        commandScriptNames: ["gruff-code-quality.sh"],
      },
    });
  });

  it("uses the selected Git project as the implicit post-turn scan root", () => {
    withTempProject((root) => {
      runGit(root, ["init", "-q"]);
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");

      const state = applyHookState("post-turn-safety", true, root);

      assert.deepEqual(state.scanRoots, {
        status: "implicit",
        roots: ["."],
        issue: null,
      });
      assert.equal(state.agents.codex.installed, true);
    });
  });

  // Fixture purpose: creates two child Git repositories, writes config, and registers them atomically.
  it("registers every valid explicit child repository as one post-turn contract", () => {
    withTempProject((root) => {
      const configuredRoots = ["services/api", "packages/web"];
      for (const configuredRoot of configuredRoots) {
        const childRoot = join(root, configuredRoot);
        mkdirSync(childRoot, { recursive: true });
        runGit(childRoot, ["init", "-q"]);
      }
      mkdirSync(join(root, ".codex"), { recursive: true });
      mkdirSync(join(root, ".goat-flow"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");
      writeFileSync(
        join(root, ".goat-flow", "config.yaml"),
        [
          "hooks:",
          "  post-turn-safety:",
          "    enabled: true",
          "    scan-roots:",
          ...configuredRoots.map((scanRoot) => `      - ${scanRoot}`),
          "",
        ].join("\n"),
      );

      const state = applyHookState("post-turn-safety", true, root);

      assert.deepEqual(state.scanRoots, {
        status: "configured",
        roots: configuredRoots,
        issue: null,
      });
      assert.equal(state.agents.codex.installed, true);
    });
  });

  for (const rootCase of [
    { name: "absent", roots: null, expectedStatus: "missing" },
    { name: "escaping", roots: ["../outside"], expectedStatus: "invalid" },
    { name: "missing", roots: ["missing"], expectedStatus: "invalid" },
    { name: "non-Git", roots: ["not-git"], expectedStatus: "invalid" },
    {
      name: "mixed valid and invalid",
      roots: ["valid-repo", "not-git"],
      expectedStatus: "invalid",
    },
  ] as const) {
    it(`keeps ${rootCase.name} non-Git root state wholly unregistered`, () => {
      withTempProject((root) => {
        mkdirSync(join(root, ".codex"), { recursive: true });
        mkdirSync(join(root, ".goat-flow"), { recursive: true });
        mkdirSync(join(root, "not-git"), { recursive: true });
        mkdirSync(join(root, "valid-repo"), { recursive: true });
        runGit(join(root, "valid-repo"), ["init", "-q"]);
        writeFileSync(join(root, ".codex", "config.toml"), "");
        writeFileSync(
          join(root, ".goat-flow", "config.yaml"),
          [
            "hooks:",
            "  post-turn-safety:",
            "    enabled: true",
            ...(rootCase.roots === null
              ? []
              : [
                  "    scan-roots:",
                  ...rootCase.roots.map((scanRoot) => `      - ${scanRoot}`),
                ]),
            "",
          ].join("\n"),
        );

        const state = applyHookState("post-turn-safety", true, root);

        assert.equal(state.scanRoots?.status, rootCase.expectedStatus);
        assert.deepEqual(state.scanRoots?.roots, rootCase.roots ?? []);
        assert.equal(state.agents.codex.installed, false);
        assert.equal(state.agents.codex.isRegistered, false);
        assert.equal(
          state.agents.codex.effectiveState.status,
          "not-registered",
        );
        assert.equal(state.agents.codex.repairCommand, null);
        assert.match(
          state.agents.codex.repairSummary,
          /configure valid scan roots or disable this hook/iu,
        );
        assert.equal(existsSync(join(root, ".codex", "hooks.json")), false);
      });
    });
  }

  // Fixture purpose: creates and later removes an external Git repo, symlinks it, writes config, and attempts registration.
  it("rejects a scan root that escapes through a symlink", () => {
    const externalRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-external-scan-root-"),
    );
    try {
      runGit(externalRoot, ["init", "-q"]);
      withTempProject((root) => {
        symlinkSync(externalRoot, join(root, "linked-repo"), "dir");
        mkdirSync(join(root, ".codex"), { recursive: true });
        mkdirSync(join(root, ".goat-flow"), { recursive: true });
        writeFileSync(join(root, ".codex", "config.toml"), "");
        writeFileSync(
          join(root, ".goat-flow", "config.yaml"),
          [
            "hooks:",
            "  post-turn-safety:",
            "    enabled: true",
            "    scan-roots:",
            "      - linked-repo",
            "",
          ].join("\n"),
        );

        const state = applyHookState("post-turn-safety", true, root);

        assert.equal(state.scanRoots?.status, "invalid");
        assert.match(state.scanRoots?.issue ?? "", /escapes/iu);
        assert.equal(state.agents.codex.installed, false);
        assert.equal(existsSync(join(root, ".codex", "hooks.json")), false);
      });
    } finally {
      rmSync(externalRoot, { force: true, recursive: true });
    }
  });

  it("does not scaffold uninstalled agent surfaces on clean target toggles", () => {
    withTempProject((root) => {
      applyHookState(HOOK_IDENTIFIER, false, root);

      assertMissing(root, GENERATED_AGENT_SURFACES);
    });

    withTempProject((root) => {
      applyHookState(HOOK_IDENTIFIER, true, root);

      assertMissing(root, GENERATED_AGENT_SURFACES);
    });
  });

  it("does not scaffold uninstalled agent surfaces during sync", () => {
    withTempProject((root) => {
      syncHookStates(root);

      assertMissing(root, GENERATED_AGENT_SURFACES);
    });
  });

  it("enables hooks only for a detected installed Codex surface", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");

      applyHookState(HOOK_IDENTIFIER, true, root);

      assertPresent(root, [
        ".codex/hooks.json",
        ".goat-flow/hooks/deny-dangerous.sh",
        ".goat-flow/hooks/deny-dangerous/patterns-shell.sh",
        ".goat-flow/hooks/deny-dangerous/patterns-paths.sh",
        ".goat-flow/hooks/deny-dangerous/patterns-writes.sh",
        ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
      ]);
      assertMissing(root, [
        ".claude/settings.json",
        ".agents/hooks.json",
        ".github/hooks/hooks.json",
      ]);
      assert.match(
        readFileSync(join(root, ".codex", "hooks.json"), "utf-8"),
        /deny-dangerous\.sh/u,
      );
      assertCodexPreToolUseOnly(root);
    });
  });

  it("treats a stale managed launcher command as uninstalled until sync rewrites it", () => {
    withTempProject((root) => {
      const denySpec = getHookSpec(HOOK_IDENTIFIER);
      assert.ok(denySpec);
      writeAgentHookState(root, PROFILES.codex, denySpec, true);

      const hooksPath = join(root, ".codex", "hooks.json");
      const current = readFileSync(hooksPath, "utf-8");
      const stale = current.replace(
        /managed root unavailable/gu,
        "git repository root unavailable",
      );
      assert.notEqual(
        stale,
        current,
        "fixture must alter the launcher contract",
      );
      writeFileSync(hooksPath, stale);

      assert.equal(
        readAgentHookState(root, PROFILES.codex, denySpec).installed,
        false,
      );

      mkdirSync(join(root, ".goat-flow"), { recursive: true });
      writeFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "hooks:\n  deny-dangerous:\n    enabled: true\n",
      );
      syncHookStates(root);

      assert.equal(existsSync(join(root, ".git")), false);
      assert.equal(
        readAgentHookState(root, PROFILES.codex, denySpec).installed,
        true,
      );
      assert.doesNotMatch(
        readFileSync(hooksPath, "utf-8"),
        /git repository root unavailable/u,
      );
    });
  });

  // One TAP case per agent tells users exactly which registration contract drifted.
  for (const agentProfile of Object.values(PROFILES)) {
    it(`${agentProfile.id} keeps supported hook deadlines and response formats`, () => {
      withTempProject((targetProjectPath) => {
        const installedCommandCount = verifyAgentHookRegistrationMatrix(
          agentProfile,
          targetProjectPath,
        );
        assert.ok(
          installedCommandCount > 0,
          `${agentProfile.id} should expose at least one runnable hook command`,
        );
      });
    });
  }

  it("generates only the approved Codex lifecycle hooks", () => {
    withTempProject((root) => {
      runGit(root, ["init", "-q"]);
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");

      const denyState = applyHookState(HOOK_IDENTIFIER, true, root);
      const gruffState = applyHookState("gruff-code-quality", true, root);
      const safetyState = applyHookState("post-turn-safety", true, root);

      assert.equal(denyState.agents.codex.supported, true);
      assert.equal(denyState.agents.codex.installed, true);
      assert.equal(gruffState.agents.codex.supported, true);
      assert.equal(gruffState.agents.codex.installed, true);
      assert.equal(safetyState.agents.codex.supported, true);
      assert.equal(safetyState.agents.codex.installed, true);
      const codexHookConfig = readFileSync(
        join(root, ".codex", "hooks.json"),
        "utf-8",
      );
      assert.match(codexHookConfig, /"PreToolUse"/u);
      assert.match(codexHookConfig, /"PostToolUse"/u);
      assert.match(codexHookConfig, /"Stop"/u);
      assert.match(codexHookConfig, /"matcher": "\^apply_patch\$"/u);
      assert.match(codexHookConfig, /"timeout": 90/u);
      assert.match(
        codexHookConfig,
        /codex:post-turn:goat-flow\.hook-result\.v1:turn-stop:1:75000/u,
      );
    });
  });

  // Covers a project with stale managed Codex entries: writes them because upgrade must replace only Goat Flow-owned fields.
  it("migrates stale managed Codex post-tool and Stop entries", () => {
    withTempProject((root) => {
      runGit(root, ["init", "-q"]);
      mkdirSync(join(root, ".codex"), { recursive: true });
      mkdirSync(join(root, ".goat-flow"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");
      writeFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "hooks:\n  gruff-code-quality:\n    enabled: true\n  post-turn-safety:\n    enabled: true\n",
      );
      writeFileSync(
        join(root, ".codex", "hooks.json"),
        `${JSON.stringify(
          {
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/deny-dangerous.sh",
                    },
                  ],
                },
              ],
              PostToolUse: [
                {
                  matcher: "Edit",
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/gruff-code-quality.sh",
                    },
                  ],
                },
                {
                  matcher: "Edit",
                  hooks: [
                    {
                      type: "command",
                      command: "bash ./custom-user-post-tool.sh",
                    },
                  ],
                },
              ],
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/post-turn-safety.sh",
                    },
                  ],
                },
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash ./custom-user-stop.sh",
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

      syncHookStates(root);

      const hooksJson = readFileSync(
        join(root, ".codex", "hooks.json"),
        "utf-8",
      );
      assert.match(hooksJson, /gruff-code-quality\.sh/u);
      assert.match(hooksJson, /post-turn-safety\.sh/u);
      assert.match(hooksJson, /"matcher": "\^apply_patch\$"/u);
      assert.match(hooksJson, /"timeout": 90/u);
      assert.match(hooksJson, /deny-dangerous\.sh/u);
      assert.match(hooksJson, /custom-user-post-tool\.sh/u);
      assert.match(hooksJson, /custom-user-stop\.sh/u);
    });
  });

  it("unignores hooks when enabling deny-dangerous on a stale goat-flow gitignore", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".codex"), { recursive: true });
      mkdirSync(join(root, ".goat-flow"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");
      writeFileSync(join(root, ".goat-flow", ".gitignore"), "*\n!.gitignore\n");

      applyHookState(HOOK_IDENTIFIER, true, root);

      const gitignore = readFileSync(
        join(root, ".goat-flow", ".gitignore"),
        "utf-8",
      );
      assert.match(gitignore, /^!hooks\/$/m);
      assert.match(gitignore, /^!hooks\/\*\*$/m);
    });
  });

  it("rejects removed plan-checkbox-guard toggles without changing config", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".claude"), { recursive: true });
      mkdirSync(join(root, ".goat-flow"), { recursive: true });
      writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
      writeFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "hooks:\n  deny-dangerous:\n    enabled: true\n",
      );
      const before = readFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "utf-8",
      );

      assert.throws(
        () => applyHookState("plan-checkbox-guard", true, root),
        /Unknown hook: plan-checkbox-guard/u,
      );

      assert.equal(
        readFileSync(join(root, ".goat-flow", "config.yaml"), "utf-8"),
        before,
      );
      assertMissing(root, [
        ".goat-flow/hooks/plan-checkbox-guard.sh",
        ".claude/hooks/plan-checkbox-guard.sh",
      ]);
    });
  });

  it("sync installs the remaining post-turn safety hook at an implicit Git root", () => {
    withTempProject((root) => {
      runGit(root, ["init", "-q"]);
      writePostTurnCapableSurfaces(root);

      const states = syncHookStates(root);
      const safetyState = states.find(
        (state) => state.id === "post-turn-safety",
      );

      assert.ok(safetyState);
      assert.equal(
        states.some((state) => state.id === "post-turn-validate"),
        false,
      );
      assert.equal(
        states.some((state) => state.id === "plan-checkbox-guard"),
        false,
      );
      assert.equal(safetyState.enabled, true);
      assert.equal(safetyState.agents.claude.installed, true);
      assert.equal(safetyState.agents.codex.supported, true);
      assert.equal(safetyState.agents.codex.installed, true);
      assert.equal(safetyState.agents.antigravity.supported, false);
      assert.match(safetyState.agents.antigravity.reason ?? "", /unverified/iu);
      assert.equal(safetyState.agents.copilot.supported, false);
      assertPresent(root, [
        ".claude/settings.json",
        ".codex/hooks.json",
        ".agents/hooks.json",
        ".goat-flow/hooks/post-turn-safety.sh",
      ]);
      assertMissing(root, [
        ".goat-flow/hooks/post-turn-validate.sh",
        ".goat-flow/hooks/plan-checkbox-guard.sh",
      ]);

      const claudeSettings = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      const codexHooks = readFileSync(
        join(root, ".codex", "hooks.json"),
        "utf-8",
      );
      const antigravityHooks = readFileSync(
        join(root, ".agents", "hooks.json"),
        "utf-8",
      );
      assert.match(
        readStopHookCommands(claudeSettings).join("\n"),
        /post-turn-safety\.sh/u,
      );
      assert.match(
        readStopHookCommands(codexHooks).join("\n"),
        /post-turn-safety\.sh/u,
      );
      assert.equal(readAntigravitySafetyCommand(antigravityHooks), "");
      assert.doesNotMatch(claudeSettings, /post-turn-validate\.sh/u);
      assert.doesNotMatch(codexHooks, /post-turn-validate\.sh/u);
      assert.doesNotMatch(antigravityHooks, /post-turn-validate\.sh/u);
    });
  });

  // Covers sync pruning removed plan-checkbox-guard entries: writes stale config, because sync must clear it.
  it("sync prunes stale removed plan-checkbox-guard entries and config", () => {
    withTempProject((root) => {
      runGit(root, ["init", "-q"]);
      writePostTurnCapableSurfaces(root);
      mkdirSync(join(root, ".goat-flow", "hooks"), { recursive: true });
      writeFileSync(
        join(root, ".goat-flow", "hooks", "plan-checkbox-guard.sh"),
        "",
      );
      writeFileSync(
        join(root, ".goat-flow", ".gitignore"),
        "*\n!.gitignore\nlogs/plan-guard-state.json\n",
      );
      writeFileSync(
        join(root, ".goat-flow", "config.yaml"),
        [
          "hooks:",
          "  plan-checkbox-guard:",
          "    enabled: true",
          "  post-turn-safety:",
          "    enabled: true",
          "plan-guard:",
          "  enabled: true",
          "  search-paths:",
          "    - .goat-flow/plans",
          "",
        ].join("\n"),
      );
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
                      command: "bash .goat-flow/hooks/plan-checkbox-guard.sh",
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
      writeFileSync(
        join(root, ".codex", "hooks.json"),
        `${JSON.stringify(
          {
            hooks: {
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/plan-checkbox-guard.sh",
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
      writeFileSync(
        join(root, ".agents", "hooks.json"),
        `${JSON.stringify(
          {
            "plan-checkbox-guard": {
              enabled: true,
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/plan-checkbox-guard.sh",
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
      writeFileSync(
        join(root, ".github", "hooks", "hooks.json"),
        `${JSON.stringify(
          {
            version: 1,
            hooks: {
              postToolUse: [
                {
                  type: "command",
                  bash: ".goat-flow/hooks/plan-checkbox-guard.sh",
                  powershell: "bash .goat-flow/hooks/plan-checkbox-guard.sh",
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const states = syncHookStates(root);

      const claudeSettings = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      const codexHooks = readFileSync(
        join(root, ".codex", "hooks.json"),
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
      const config = readFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "utf-8",
      );
      const gitignore = readFileSync(
        join(root, ".goat-flow", ".gitignore"),
        "utf-8",
      );
      assert.equal(
        states.some((state) => state.id === "plan-checkbox-guard"),
        false,
      );
      assert.doesNotMatch(claudeSettings, /plan-checkbox-guard\.sh/u);
      assert.doesNotMatch(codexHooks, /plan-checkbox-guard\.sh/u);
      assert.doesNotMatch(antigravityHooks, /plan-checkbox-guard\.sh/u);
      assert.doesNotMatch(copilotHooks, /plan-checkbox-guard\.sh/u);
      assert.doesNotMatch(config, /plan-checkbox-guard|plan-guard/u);
      assert.doesNotMatch(gitignore, /plan-guard-state/u);
      assertMissing(root, [".goat-flow/hooks/plan-checkbox-guard.sh"]);
      assert.match(codexHooks, /post-turn-safety\.sh/u);
      assert.equal(readAntigravitySafetyCommand(antigravityHooks), "");
    });
  });

  // Covers the same prune driven by a direct toggle: writes stale config, because a toggle must clear it too.
  it("direct hook toggles prune stale removed plan-checkbox-guard entries and config", () => {
    withTempProject((root) => {
      runGit(root, ["init", "-q"]);
      writePostTurnCapableSurfaces(root);
      mkdirSync(join(root, ".goat-flow", "hooks"), { recursive: true });
      writeFileSync(
        join(root, ".goat-flow", "hooks", "plan-checkbox-guard.sh"),
        "",
      );
      writeFileSync(
        join(root, ".goat-flow", "config.yaml"),
        [
          "hooks:",
          "  plan-checkbox-guard:",
          "    enabled: true",
          "plan-guard:",
          "  enabled: true",
          "",
        ].join("\n"),
      );
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
                      command: "bash .goat-flow/hooks/plan-checkbox-guard.sh",
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

      const safetyState = applyHookState("post-turn-safety", true, root);

      const claudeSettings = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      const config = readFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "utf-8",
      );
      assert.equal(safetyState.id, "post-turn-safety");
      assert.match(claudeSettings, /post-turn-safety\.sh/u);
      assert.doesNotMatch(claudeSettings, /plan-checkbox-guard\.sh/u);
      assert.doesNotMatch(config, /plan-checkbox-guard|plan-guard/u);
      assertMissing(root, [".goat-flow/hooks/plan-checkbox-guard.sh"]);
    });
  });

  it("does not treat shared AGENTS.md surfaces as a Codex or Antigravity opt-in", () => {
    withTempProject((root) => {
      writeFileSync(join(root, "AGENTS.md"), "# Local agent instructions\n");
      mkdirSync(join(root, ".agents", "skills"), { recursive: true });

      applyHookState(HOOK_IDENTIFIER, true, root);

      assertMissing(root, [
        ".codex/hooks.json",
        ".goat-flow/hooks/deny-dangerous.sh",
        ".agents/hooks.json",
        ".goat-flow/hooks/deny-dangerous.sh",
      ]);
    });
  });

  /** Proves an enabled toggle stays visible without installing feedback the model cannot receive. */
  // Side effects: writes one disposable Antigravity config and removes any managed Gruff entry.
  it("keeps gruff-code-quality unregistered for Antigravity without result delivery", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".agents"), { recursive: true });
      writeFileSync(join(root, ".agents", "hooks.json"), "{}\n");
      const state = applyHookState("gruff-code-quality", true, root);
      assertPresent(root, [".agents/hooks.json"]);
      assertMissing(root, [
        ".goat-flow/hooks/gruff-code-quality.sh",
        ".goat-flow/hooks/hook-provider-adapters.mjs",
      ]);
      const config = JSON.parse(
        readFileSync(join(root, ".agents", "hooks.json"), "utf-8"),
      ) as Record<string, unknown>;
      assert.equal(config["gruff-code-quality"], undefined);
      assert.equal(state.enabled, true);
      assert.equal(state.agents.antigravity.supported, false);
      assert.equal(state.agents.antigravity.installed, false);
      assert.equal(state.agents.antigravity.isRegistered, false);
      assert.deepEqual(state.agents.antigravity.effectiveState, {
        status: "result-undelivered",
        severity: "danger",
      });
      assert.equal(state.agents.antigravity.repairCommand, null);
      assert.match(
        state.agents.antigravity.repairSummary,
        /Provider result delivery must be proven/iu,
      );
      assert.match(
        state.agents.antigravity.reason ?? "",
        /cannot deliver Gruff feedback to the active model/iu,
      );
      // Registry evidence keeps the dashboard reason aligned with the unregistered state.
      assert.equal(
        getHookSpec("gruff-code-quality")?.providerEvidence?.antigravity
          ?.effectiveSupportGate,
        "result-undelivered",
      );
    });
  });

  it("cleans existing script residue without creating missing hook config", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
      writeFileSync(join(root, ".claude", "hooks", "guard-common.sh"), "");
      writeFileSync(
        join(root, ".claude", "hooks", "guard-secret-paths.sh"),
        "",
      );

      applyHookState(HOOK_IDENTIFIER, false, root);

      assertMissing(root, [
        ".claude/settings.json",
        ".claude/hooks/guard-common.sh",
        ".claude/hooks/guard-secret-paths.sh",
      ]);
    });
  });
});

describe("hook registrar: managed surface preservation", () => {
  // Each malformed managed root represents a user project the launcher must reject safely.
  for (const fixture of MANAGED_SHAPE_MUTATIONS) {
    it(`rejects a ${fixture.name} without exposing its root`, () => {
      withTempProject((fixtureProjectPath) => {
        const installedLauncher = installCodexDenyHook(fixtureProjectPath);
        fixture.mutate(fixtureProjectPath);
        const launcherResult = runCodexLauncher(
          installedLauncher,
          fixtureProjectPath,
        );

        assert.equal(
          launcherResult.status,
          2,
          `${launcherResult.stdout}\n${launcherResult.stderr}`,
        );
        assert.match(launcherResult.stderr, /managed root incomplete/iu);
        assert.equal(launcherResult.stderr.includes(fixtureProjectPath), false);
      });
    });
  }

  /**
   * Writes and toggles a disposable Stop hook because a similar filename must remain user-owned.
   * Fixture purpose: catches broad matching that would delete a user's existing safety hook.
   */
  it("preserves user hooks whose names merely contain a managed script name", () => {
    withTempProject((fixtureProjectPath) => {
      mkdirSync(join(fixtureProjectPath, ".claude"), { recursive: true });
      writeFileSync(
        join(fixtureProjectPath, ".claude", "settings.json"),
        `${JSON.stringify(
          {
            hooks: {
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash .claude/hooks/custom-post-turn-safety.sh",
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

      applyHookState("post-turn-safety", true, fixtureProjectPath);
      const settingsAfterEnable = readFileSync(
        join(fixtureProjectPath, ".claude", "settings.json"),
        "utf-8",
      );
      assert.match(
        settingsAfterEnable,
        /custom-post-turn-safety\.sh/u,
        "managed registration must not claim the user's similarly named hook",
      );

      applyHookState("post-turn-safety", false, fixtureProjectPath);
      const settingsAfterDisable = readFileSync(
        join(fixtureProjectPath, ".claude", "settings.json"),
        "utf-8",
      );
      assert.match(
        settingsAfterDisable,
        /custom-post-turn-safety\.sh/u,
        "managed removal must not delete the user's similarly named hook",
      );
    });
  });
});
