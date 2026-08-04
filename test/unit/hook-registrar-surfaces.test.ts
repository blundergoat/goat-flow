/**
 * How hooks decide where they belong: only detected agent surfaces are enabled, uninstalled
 * ones are never scaffolded, removed hooks are pruned rather than resurrected, and sync
 * repairs configuration without inventing project state.
 * Every case builds a real project and reads back what the registrar actually wrote.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyHookState,
  syncHookStates,
} from "../../src/cli/server/hook-registrar.js";

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
} from "./hook-registrar.helpers.js";

describe("hook registrar: surface detection, toggles, and sync", () => {
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

  it("keeps generated Codex hooks PreToolUse-only", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");

      const denyState = applyHookState(HOOK_IDENTIFIER, true, root);
      const gruffState = applyHookState("gruff-code-quality", true, root);
      const safetyState = applyHookState("post-turn-safety", true, root);

      assert.equal(denyState.agents.codex.supported, true);
      assert.equal(denyState.agents.codex.installed, true);
      assert.equal(gruffState.agents.codex.supported, false);
      assert.match(gruffState.agents.codex.reason ?? "", /PreToolUse-only/iu);
      assert.equal(safetyState.agents.codex.supported, false);
      assert.match(safetyState.agents.codex.reason ?? "", /unverified/iu);
      assertCodexPreToolUseOnly(root);
    });
  });

  // Covers a project with stale managed Codex entries: writes them, because an upgrade must prune them.
  it("prunes stale managed Codex post-tool and stop hook entries", () => {
    withTempProject((root) => {
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
      assert.doesNotMatch(hooksJson, /gruff-code-quality\.sh/u);
      assert.doesNotMatch(hooksJson, /post-turn-safety\.sh/u);
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

  it("sync installs the remaining post-turn safety hook without project validation", () => {
    withTempProject((root) => {
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
      assert.equal(safetyState.agents.codex.supported, false);
      assert.match(safetyState.agents.codex.reason ?? "", /unverified/iu);
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
      assertCodexPreToolUseOnly(root);
      assert.equal(readAntigravitySafetyCommand(antigravityHooks), "");
      assert.doesNotMatch(claudeSettings, /post-turn-validate\.sh/u);
      assert.doesNotMatch(codexHooks, /post-turn-validate\.sh/u);
      assert.doesNotMatch(antigravityHooks, /post-turn-validate\.sh/u);
    });
  });

  // Covers sync pruning removed plan-checkbox-guard entries: writes stale config, because sync must clear it.
  it("sync prunes stale removed plan-checkbox-guard entries and config", () => {
    withTempProject((root) => {
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
      assert.doesNotMatch(codexHooks, /post-turn-safety\.sh/u);
      assert.equal(readAntigravitySafetyCommand(antigravityHooks), "");
    });
  });

  // Covers the same prune driven by a direct toggle: writes stale config, because a toggle must clear it too.
  it("direct hook toggles prune stale removed plan-checkbox-guard entries and config", () => {
    withTempProject((root) => {
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

  it("enables gruff-code-quality for a detected Antigravity surface", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".agents"), { recursive: true });
      writeFileSync(join(root, ".agents", "hooks.json"), "{}\n");

      const state = applyHookState("gruff-code-quality", true, root);

      assertPresent(root, [
        ".agents/hooks.json",
        ".goat-flow/hooks/gruff-code-quality.sh",
      ]);
      const config = JSON.parse(
        readFileSync(join(root, ".agents", "hooks.json"), "utf-8"),
      ) as {
        "gruff-code-quality": {
          enabled: boolean;
          PostToolUse: Array<{ matcher: string }>;
        };
      };
      assert.equal(config["gruff-code-quality"].enabled, true);
      assert.equal(
        config["gruff-code-quality"].PostToolUse[0]?.matcher,
        "write_to_file|replace_file_content|multi_replace_file_content",
      );
      assert.equal(state.agents.antigravity.supported, true);
      assert.equal(state.agents.antigravity.installed, true);
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
