/**
 * Exercises setup migrations that remove retired managed state while preserving user-owned files and settings.
 *
 * Use when installer cleanup or hook convergence changes what returning users receive during an upgrade.
 * Fixtures cover historical layouts, provider registrations, config aliases, and repeated installation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { getAgentProfiles } from "../../src/cli/agents/registry.js";
import { managedInstallStatePath } from "../../src/cli/managed-setup-state.js";
import {
  getHookSpec,
  listHookSpecs,
} from "../../src/cli/server/hooks-registry.js";
import {
  readAgentHookState,
  writeAgentHookState,
} from "../../src/cli/server/agent-hook-writer.js";
import {
  agentHookSpawnDescriptor,
  buildAgentHookDescriptor,
} from "../../src/cli/server/agent-hook-command.js";
import {
  makeTempProject,
  PROJECT_ROOT,
  readClaudePostTurnSafetyTimeout,
  runCliInstaller,
  runInstaller,
  runInstallerWithEnvironment,
} from "./setup-install.helpers.js";

describe("setup --apply installer upgrade migrations", () => {
  // ADD INTEGRATION: final-state tests cannot prove Git protection survives an interrupted split.
  // Each fixture writes legacy Git coverage, interrupts a real atomic installer write, then retries.
  for (const interruptedPath of [
    ".claude/settings.json",
    ".codex/hooks.json",
    ".goat-flow/hooks/run-with-bash.mjs",
    ".goat-flow/hooks/deny-git-mutations.sh",
    ".goat-flow/hooks/deny-dangerous.sh",
    ".goat-flow/hooks/deny-dangerous/guard-runtime.sh",
    ".goat-flow/hooks/deny-dangerous/patterns-writes.sh",
  ]) {
    it(`retains Git protection when the split stops at ${interruptedPath}`, () => {
      const root = makeTempProject();
      const hookDirectory = join(root, ".goat-flow/hooks");
      mkdirSync(hookDirectory, { recursive: true });
      assert.equal(spawnSync("git", ["init", "--quiet", root]).status, 0);
      for (const file of [
        "run-with-bash.mjs",
        "hook-launch-runtime.mjs",
        "hook-provider-adapters.mjs",
      ]) {
        copyFileSync(
          join(PROJECT_ROOT, "workflow/hooks", file),
          join(hookDirectory, file),
        );
      }
      // Fixture-created pre-split policy: the existing registration denies this exact push and permits status.
      // The pending command is parsed as data and is never executed.
      writeFileSync(
        join(hookDirectory, "deny-dangerous.sh"),
        [
          "#!/usr/bin/env bash",
          'node -e \'const p = JSON.parse(require("node:fs").readFileSync(0, "utf8")); if (p.tool_input.command === "git push origin main") { process.stderr.write("BLOCKED: Policy fixture: legacy Git protection\\n"); process.exit(2); }\'',
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(root, ".goat-flow/config.yaml"),
        "hooks:\n  deny-dangerous:\n    enabled: true\n  post-turn-safety:\n    enabled: false\n",
      );
      const profiles = getAgentProfiles().filter(
        (agent) => agent.id === "claude" || agent.id === "codex",
      );
      const dangerous = getHookSpec("deny-dangerous");
      const git = getHookSpec("deny-git-mutations");
      assert.ok(dangerous && git);
      for (const agent of profiles) {
        assert.ok(agent.hookConfigFile && agent.hooksDir);
        mkdirSync(join(root, agent.hookConfigFile, ".."), { recursive: true });
        writeFileSync(
          join(root, agent.hookConfigFile),
          JSON.stringify({
            userMarker: "preserve",
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [{ type: "command", command: "node user-hook.js" }],
                },
              ],
            },
          }),
        );
        writeAgentHookState(root, agent, dangerous, true);
      }
      // Replay only fixture-owned registered policy handlers; operands remain inert provider payloads.
      const decisions = (command: string) =>
        profiles.map((agent) => {
          assert.ok(agent.hooksDir);
          return [dangerous, git]
            .filter((spec) => readAgentHookState(root, agent, spec).installed)
            .map((spec) => {
              assert.ok(agent.hooksDir);
              const descriptor = agentHookSpawnDescriptor(
                buildAgentHookDescriptor(agent.id, agent.hooksDir, spec),
              );
              return spawnSync(descriptor.command, descriptor.args, {
                cwd: root,
                input: JSON.stringify({
                  tool_name: "Bash",
                  tool_input: { command },
                }),
                encoding: "utf-8",
                timeout: 30000,
              });
            });
        });
      assert.ok(
        decisions("git status").every(
          (results) => results.length === 1 && results[0]?.status === 0,
        ),
      );
      assert.ok(
        decisions("git push origin main").every((results) =>
          results.some((result) => result.status === 2),
        ),
      );
      const shimDirectory = join(root, "interruption-tools");
      mkdirSync(shimDirectory);
      const realMv = spawnSync("bash", ["-c", "command -v mv"], {
        encoding: "utf-8",
      }).stdout.trim();
      assert.ok(realMv);
      writeFileSync(
        join(shimDirectory, "mv"),
        '#!/usr/bin/env bash\nif [[ "${!#}" == "$M20_INTERRUPT_PATH" ]]; then printf \'M20 interrupted replacement\\n\' >&2; exit 73; fi\nexec "$M20_REAL_MV" "$@"\n',
        { mode: 0o755 },
      );
      const interrupted = runInstallerWithEnvironment(
        root,
        {
          PATH: `${shimDirectory}:${process.env.PATH ?? ""}`,
          M20_REAL_MV: realMv,
          M20_INTERRUPT_PATH: interruptedPath,
        },
        "--agent",
        "codex",
      );
      assert.notEqual(interrupted.status, 0);
      assert.match(interrupted.stderr, /M20 interrupted replacement/u);
      for (const results of decisions("git push origin main")) {
        assert.ok(
          results.some(
            (result) =>
              result.status === 2 &&
              /BLOCKED: Policy|Policy hook unavailable:/u.test(result.stderr),
          ),
          JSON.stringify(results),
        );
      }
      const retried = runInstaller(root, "--agent", "codex");
      assert.equal(retried.status, 0, retried.stderr || retried.stdout);
      for (const agent of profiles) {
        assert.ok(readAgentHookState(root, agent, dangerous).installed);
        assert.ok(readAgentHookState(root, agent, git).installed);
        assert.ok(agent.hookConfigFile);
        const config = readFileSync(join(root, agent.hookConfigFile), "utf-8");
        assert.match(config, /userMarker/u);
        assert.match(config, /node user-hook\.js/u);
      }
      for (const results of decisions("git push origin main")) {
        assert.deepEqual(
          results.map((result) => result.status),
          [0, 2],
        );
      }
      assert.ok(
        decisions("git status").every((results) =>
          results.every((result) => result.status === 0),
        ),
      );
    });
  }

  // Writes legacy install state, then runs public preview and the playbook install block against locally edited guidance in a disposable project.
  // The invariant is exact preservation alongside installed replacements; later installer stages cannot hide these results behind a timeout.
  it("preserves retired writing playbooks when installing replacements", () => {
    const root = makeTempProject();
    const playbookDirectory = join(root, ".goat-flow/skill-docs/playbooks");
    mkdirSync(playbookDirectory, { recursive: true });
    const retiredAgentPath = join(playbookDirectory, "writing-for-agents.md");
    const retiredHumanProse = join(playbookDirectory, "writing-style.md");
    const agentContent =
      "# Local agent guidance\n\nKeep our project-specific review checklist.\n";
    const humanContent =
      "# Local prose guidance\n\nKeep our project-specific terminology.\n";
    writeFileSync(retiredAgentPath, agentContent);
    writeFileSync(retiredHumanProse, humanContent);
    const retiredPlaybookPaths = [
      ".goat-flow/skill-docs/playbooks/writing-for-agents.md",
      ".goat-flow/skill-docs/playbooks/writing-style.md",
    ];
    const statePath = managedInstallStatePath(root, "codex");
    mkdirSync(dirname(statePath), { recursive: true });
    // The old package baseline deliberately differs from both locally edited files.
    const legacyBaseline = {
      schemaVersion: "goat-flow.install-state.v1",
      agent: "codex",
      goatFlowVersion: "1.16.0",
      files: retiredPlaybookPaths.map((path) => ({
        path,
        expectedSha256: createHash("sha256")
          .update("retired package template\n")
          .digest("hex"),
      })),
    };
    writeFileSync(statePath, `${JSON.stringify(legacyBaseline, null, 2)}\n`);
    const preview = runCliInstaller(
      root,
      "--agent",
      "codex",
      "--dry-run",
      "--format",
      "json",
    );
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const report = JSON.parse(preview.stdout) as {
      files: { path: string; state: string; action: string }[];
    };
    // Both retired names must carry the preservation promise before the test exercises installation.
    for (const retiredPath of retiredPlaybookPaths) {
      const previewRow = report.files.find((file) => file.path === retiredPath);
      assert.ok(previewRow, `Preview must list ${retiredPath}`);
      assert.equal(previewRow.state, "removed", `Retired: ${retiredPath}`);
      assert.equal(previewRow.action, "preserve", `Preserve: ${retiredPath}`);
    }

    const installerSource = readFileSync(
      join(PROJECT_ROOT, "workflow", "install-goat-flow.sh"),
      "utf-8",
    );
    const blockStart = installerSource.indexOf('echo "Standalone playbooks');
    const blockEnd = installerSource.indexOf(
      'copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/skill-quality-testing.md"',
      blockStart,
    );
    assert.ok(blockStart >= 0, "standalone playbook install block is missing");
    assert.ok(blockEnd > blockStart, "playbook block end is missing");
    // Execute the shipped migration, not a copy of its policy; only the ordinary copy primitive is supplied by the fixture.
    const install = spawnSync(
      "bash",
      [
        "-c",
        [
          "set -euo pipefail",
          "copy_file() {",
          '  local src="$1" dst="$2"',
          '  mkdir -p "$(dirname "$dst")"',
          '  cp "$src" "$dst"',
          '  printf "%s\\n" "$dst"',
          "}",
          installerSource.slice(blockStart, blockEnd),
        ].join("\n"),
      ],
      {
        cwd: root,
        encoding: "utf-8",
        env: { ...process.env, GOAT_FLOW_ROOT: PROJECT_ROOT },
        timeout: 10000,
      },
    );
    assert.equal(install.status, 0, install.stderr || install.stdout);
    // Every replacement must contain the shipped guidance while the project's retired copies remain available below.
    for (const replacementPlaybook of [
      "writing-agent-facing-instructions.md",
      "writing-human-facing-prose.md",
    ]) {
      const templatePath = join(
        PROJECT_ROOT,
        "workflow/skills/playbooks",
        replacementPlaybook,
      );
      assert.equal(
        readFileSync(join(playbookDirectory, replacementPlaybook), "utf-8"),
        readFileSync(templatePath, "utf-8"),
        `Installed content: ${replacementPlaybook}`,
      );
    }
    assert.equal(readFileSync(retiredAgentPath, "utf-8"), agentContent);
    assert.equal(readFileSync(retiredHumanProse, "utf-8"), humanContent);
    // The install log must tell users that old copies remain available for their own review and removal.
    for (const retiredPath of retiredPlaybookPaths) {
      assert.ok(
        install.stdout.includes(`retained retired ${retiredPath}`),
        `Missing retention notice for ${retiredPath}: ${install.stdout}`,
      );
    }
  });

  it("keeps derived config migration flags under the force alias", () => {
    const root = makeTempProject();
    const firstInstall = runCliInstaller(root, "--agent", "codex");
    assert.equal(
      firstInstall.status,
      0,
      firstInstall.stderr || firstInstall.stdout,
    );
    const configPath = join(root, ".goat-flow", "config.yaml");
    writeFileSync(
      configPath,
      readFileSync(configPath, "utf-8").replace(
        /^version: .*$/mu,
        'version: "1.14.0"',
      ),
    );
    const packageVersion = (
      JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8")) as {
        version: string;
      }
    ).version;

    const forcedUpgrade = runCliInstaller(root, "--agent", "codex", "--force");

    assert.equal(
      forcedUpgrade.status,
      0,
      forcedUpgrade.stderr || forcedUpgrade.stdout,
    );
    assert.match(
      readFileSync(configPath, "utf-8"),
      new RegExp(`^version: ["']${packageVersion}["']$`, "mu"),
    );
  });

  // Covers upgrading past the retired guard: writes old config, which must be pruned because it is retired.
  it("prunes retired plan checkbox guard config and selected-agent registration", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".goat-flow", "hooks"), { recursive: true });
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(
      join(root, ".goat-flow", "hooks", "plan-checkbox-guard.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".goat-flow", ".gitignore"),
      "*\n!.gitignore\nlogs/plan-guard-state.json\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "config.yaml"),
      [
        'version: "1.12.0"',
        "",
        "skills:",
        "  install: all",
        "",
        "hooks:",
        "  plan-checkbox-guard:",
        "    enabled: true",
        "  post-turn-safety:",
        "    enabled: true",
        "",
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
                    command: "bash .goat-flow/hooks/post-turn-safety.sh",
                    timeout: 60,
                  },
                  { type: "command", command: "node user-stop-hook.js" },
                ],
              },
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

    const result = runInstaller(root, "--agent", "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(
      join(root, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    const gitignore = readFileSync(
      join(root, ".goat-flow", ".gitignore"),
      "utf-8",
    );
    const settings = readFileSync(
      join(root, ".claude", "settings.json"),
      "utf-8",
    );
    assert.equal(
      existsSync(join(root, ".goat-flow", "hooks", "plan-checkbox-guard.sh")),
      false,
    );
    assert.doesNotMatch(config, /plan-checkbox-guard|plan-guard/u);
    assert.doesNotMatch(gitignore, /plan-guard-state/u);
    assert.doesNotMatch(settings, /plan-checkbox-guard\.sh/u);
    assert.doesNotMatch(settings, /post-turn-safety\.sh/u);
    assert.match(settings, /user-stop-hook\.js/u);
    assert.equal(readClaudePostTurnSafetyTimeout(root), undefined);
  });
  // Covers the same prune on CRLF config a Windows user committed: writes it and expects a clean result.
  it("prunes retired plan guard config from CRLF config files", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".claude"), { recursive: true });
    mkdirSync(join(root, ".goat-flow"), { recursive: true });
    writeFileSync(
      join(root, ".goat-flow", "config.yaml"),
      [
        'version: "1.12.0"',
        "",
        "hooks:",
        "  post-turn-safety:",
        "    enabled: true",
        "",
        "plan-guard:",
        "  enabled: true",
        "  search-paths:",
        "    - .goat-flow/plans",
        "",
        "line-limits:",
        "  target: 125",
        "",
      ].join("\r\n"),
    );
    writeFileSync(join(root, ".claude", "settings.json"), "{}\n");

    const result = runInstaller(root, "--agent", "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(
      join(root, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    assert.doesNotMatch(config, /plan-guard/u);
    assert.match(config, /line-limits:\r\n  target: 125/u);
    assert.doesNotMatch(config, /\r\n\r\n\r\n/u);
  });

  it("prunes legacy deny-dangerous self-test files during upgrades", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".codex", "hooks"), { recursive: true });
    writeFileSync(
      join(root, ".codex", "hooks", "deny-dangerous.self-test.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.equal(
      existsSync(join(root, ".codex", "hooks", "deny-dangerous.self-test.sh")),
      false,
    );
    assert.equal(
      existsSync(join(root, ".goat-flow", "hooks", "deny-dangerous.sh")),
      true,
    );
    assert.equal(
      existsSync(
        join(
          root,
          ".goat-flow",
          "hooks",
          "deny-dangerous",
          "deny-dangerous-self-test.sh",
        ),
      ),
      true,
    );
    assert.match(result.stdout, /removed stale hook/);
  });

  // Fixture purpose: writes colliding legacy task files to cover safe plans migration.
  it("migrates legacy tasks workspace and config to plans without overwriting collisions", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".goat-flow", "tasks", "legacy"), {
      recursive: true,
    });
    mkdirSync(join(root, ".goat-flow", "tasks", "current"), {
      recursive: true,
    });
    mkdirSync(join(root, ".goat-flow", "plans", "current"), {
      recursive: true,
    });
    writeFileSync(join(root, ".goat-flow", "tasks", ".active"), "legacy\n");
    writeFileSync(
      join(root, ".goat-flow", "tasks", "legacy", "M01-old.md"),
      "# Old plan\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "tasks", "current", "M01-old.md"),
      "# Colliding old plan\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "plans", "current", "M01-current.md"),
      "# Current plan\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "config.yaml"),
      [
        'version: "1.9.0"',
        "",
        "tasks:",
        '  path: ".goat-flow/tasks/"',
        "",
        "skills:",
        "  install: all",
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.equal(
      existsSync(join(root, ".goat-flow", "plans", "legacy", "M01-old.md")),
      true,
    );
    assert.equal(
      existsSync(
        join(root, ".goat-flow", "plans", "current", "M01-current.md"),
      ),
      true,
    );
    assert.equal(
      existsSync(join(root, ".goat-flow", "tasks", "current", "M01-old.md")),
      true,
    );
    const config = readFileSync(
      join(root, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    assert.match(config, /^plans:\n  path: "\.goat-flow\/plans\/"/m);
    assert.doesNotMatch(config, /^tasks:/m);
    assert.match(result.stdout, /legacy tasks config migrated to plans/);
    assert.match(result.stdout, /target exists, left old entry in place/);
  });

  // Fixture purpose: writes a custom tasks path to cover config key migration.
  it("preserves custom legacy tasks config paths while renaming the key to plans", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".goat-flow"), { recursive: true });
    writeFileSync(
      join(root, ".goat-flow", "config.yaml"),
      [
        'version: "1.9.0"',
        "",
        "tasks:",
        '  path: ".custom-goat-flow/milestones/"',
        "",
        "skills:",
        "  install: all",
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(
      join(root, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    assert.match(
      config,
      /^plans:\n  path: "\.custom-goat-flow\/milestones\/"/m,
    );
    assert.doesNotMatch(config, /^tasks:/m);
    assert.match(result.stdout, /legacy tasks config migrated to plans/);
  });

  // Fixture purpose: writes legacy learning-loop dirs to cover collision-safe migration.
  it("migrates legacy learning-loop dirs without overwriting target collisions", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".goat-flow", "footguns"), { recursive: true });
    mkdirSync(join(root, ".goat-flow", "lessons"), { recursive: true });
    mkdirSync(join(root, ".goat-flow", "patterns"), { recursive: true });
    mkdirSync(join(root, ".goat-flow", "decisions"), { recursive: true });
    mkdirSync(join(root, ".goat-flow", "learning-loop", "footguns"), {
      recursive: true,
    });
    writeFileSync(
      join(root, ".goat-flow", "footguns", "legacy-only.md"),
      "# Legacy footgun\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "footguns", "collision.md"),
      "# Old collision\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "learning-loop", "footguns", "collision.md"),
      "# Existing collision\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "lessons", "legacy-lesson.md"),
      "# Legacy lesson\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "patterns", "legacy-pattern.md"),
      "# Legacy pattern\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "decisions", "ADR-999-legacy.md"),
      "# Legacy decision\n",
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.equal(
      existsSync(
        join(root, ".goat-flow", "learning-loop", "footguns", "legacy-only.md"),
      ),
      true,
    );
    assert.equal(
      readFileSync(
        join(root, ".goat-flow", "learning-loop", "footguns", "collision.md"),
        "utf-8",
      ),
      "# Existing collision\n",
    );
    assert.equal(
      existsSync(join(root, ".goat-flow", "footguns", "collision.md")),
      true,
    );
    assert.equal(
      existsSync(
        join(
          root,
          ".goat-flow",
          "learning-loop",
          "lessons",
          "legacy-lesson.md",
        ),
      ),
      true,
    );
    assert.equal(
      existsSync(
        join(
          root,
          ".goat-flow",
          "learning-loop",
          "patterns",
          "legacy-pattern.md",
        ),
      ),
      true,
    );
    assert.equal(
      existsSync(
        join(
          root,
          ".goat-flow",
          "learning-loop",
          "decisions",
          "ADR-999-legacy.md",
        ),
      ),
      true,
    );
    assert.match(result.stdout, /\.goat-flow\/footguns\/legacy-only\.md/);
    assert.match(result.stdout, /target exists, left old entry in place/);
  });

  // Fixture purpose: writes old hook-lib and per-agent hooks to cover pruning migration.
  it("migrates old hook-lib content and prunes fat per-agent hook copies", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".goat-flow", "hook-lib"), { recursive: true });
    mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
    mkdirSync(join(root, ".codex", "hooks"), { recursive: true });
    mkdirSync(join(root, ".agents", "hooks"), { recursive: true });
    mkdirSync(join(root, ".github", "hooks"), { recursive: true });
    writeFileSync(
      join(root, ".goat-flow", "hook-lib", "local-policy-note.txt"),
      "preserve me\n",
    );
    for (const legacyHook of [
      join(root, ".claude", "hooks", "deny-dangerous.sh"),
      join(root, ".codex", "hooks", "deny-dangerous.sh"),
      join(root, ".agents", "hooks", "gruff-code-quality.sh"),
      join(root, ".github", "hooks", "gruff-code-quality.sh"),
    ]) {
      writeFileSync(legacyHook, "#!/usr/bin/env bash\nexit 0\n");
    }

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.equal(
      existsSync(
        join(
          root,
          ".goat-flow",
          "hooks",
          "deny-dangerous",
          "local-policy-note.txt",
        ),
      ),
      true,
    );
    assert.equal(
      existsSync(join(root, ".goat-flow", "hook-lib", "local-policy-note.txt")),
      false,
    );
    assert.equal(
      existsSync(join(root, ".claude", "hooks", "deny-dangerous.sh")),
      false,
    );
    assert.equal(
      existsSync(join(root, ".codex", "hooks", "deny-dangerous.sh")),
      false,
    );
    assert.equal(
      existsSync(join(root, ".agents", "hooks", "gruff-code-quality.sh")),
      false,
    );
    assert.equal(
      existsSync(join(root, ".github", "hooks", "gruff-code-quality.sh")),
      false,
    );
    assert.match(
      result.stdout,
      /\.goat-flow\/hook-lib\/ → \.goat-flow\/hooks\/deny-dangerous\//,
    );
    assert.match(result.stdout, /removed stale per-agent copy/);
  });

  // Fixture purpose: writes a personal settings.local.json to cover local-override repair.
  it("repairs stale permission rules in .claude/settings.local.json on upgrade", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(
      join(root, ".claude", "settings.local.json"),
      JSON.stringify(
        {
          permissions: {
            deny: ["Write(**/scratch/**)", "MultiEdit(**/*.pem)"],
          },
        },
        null,
        2,
      ) + "\n",
    );

    const result = runInstaller(root, "--agent", "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      /settings\.local\.json \(migrated: stale or superseded permission rules\)/,
    );

    const local = JSON.parse(
      readFileSync(join(root, ".claude", "settings.local.json"), "utf-8"),
    ) as { permissions?: { deny?: string[] } };
    assert.deepEqual(local.permissions?.deny ?? [], ["Edit(**/scratch/**)"]);

    // Idempotent: a second upgrade leaves the repaired local file alone.
    const second = runInstaller(root, "--agent", "claude");
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.doesNotMatch(second.stdout, /settings\.local\.json \(migrated/);
  });

  // Fixture purpose: writes legacy skill docs to cover collision-safe skill-doc migration.
  it("migrates legacy skill docs without overwriting target collisions", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".goat-flow", "skill-reference"), {
      recursive: true,
    });
    mkdirSync(join(root, ".goat-flow", "skill-playbooks"), {
      recursive: true,
    });
    mkdirSync(join(root, ".goat-flow", "skill-docs", "playbooks"), {
      recursive: true,
    });
    writeFileSync(
      join(root, ".goat-flow", "skill-reference", "local-doctrine.md"),
      "# Local doctrine\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "skill-playbooks", "local-playbook.md"),
      "# Local playbook\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "skill-playbooks", "collision.md"),
      "# Old playbook collision\n",
    );
    writeFileSync(
      join(root, ".goat-flow", "skill-docs", "playbooks", "collision.md"),
      "# Existing playbook collision\n",
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.equal(
      existsSync(join(root, ".goat-flow", "skill-docs", "local-doctrine.md")),
      true,
    );
    assert.equal(
      existsSync(
        join(
          root,
          ".goat-flow",
          "skill-docs",
          "playbooks",
          "local-playbook.md",
        ),
      ),
      true,
    );
    assert.equal(
      readFileSync(
        join(root, ".goat-flow", "skill-docs", "playbooks", "collision.md"),
        "utf-8",
      ),
      "# Existing playbook collision\n",
    );
    assert.equal(
      existsSync(join(root, ".goat-flow", "skill-playbooks", "collision.md")),
      true,
    );
    assert.match(
      result.stdout,
      /\.goat-flow\/skill-reference\/local-doctrine\.md → \.goat-flow\/skill-docs\/local-doctrine\.md/,
    );
    assert.match(result.stdout, /target exists, left old entry in place/);
  });

  // Fixture writes the 1.8.0 split-hook layout because upgrade pruning must collapse files and registrations.
  it("prunes 1.8.0 split guard hook files and registrations during upgrades", () => {
    const root = makeTempProject();
    // Fixture recreates the old split-hook layout so upgrade pruning proves both
    // files and registrations collapse to the single dispatcher.
    mkdirSync(join(root, ".codex", "hooks"), { recursive: true });
    mkdirSync(join(root, ".goat-flow"), { recursive: true });
    for (const file of [
      "guard-common.sh",
      "guard-destructive-shell.sh",
      "guard-secret-paths.sh",
      "guard-repository-writes.sh",
      "guardrails-self-test.sh",
    ]) {
      writeFileSync(
        join(root, ".codex", "hooks", file),
        "#!/usr/bin/env bash\n",
      );
    }
    writeFileSync(
      join(root, ".codex", "hooks.json"),
      '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":".codex/hooks/guard-repository-writes.sh"}]}]}}\n',
    );
    writeFileSync(
      join(root, ".goat-flow", "config.yaml"),
      [
        'version: "1.8.0"',
        "hooks:",
        "  guard-destructive-shell:",
        "    enabled: true",
        "  guard-secret-paths:",
        "    enabled: true",
        "  guard-repository-writes:",
        "    enabled: true",
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const file of [
      "guard-common.sh",
      "guard-destructive-shell.sh",
      "guard-secret-paths.sh",
      "guard-repository-writes.sh",
      "guardrails-self-test.sh",
    ]) {
      assert.equal(existsSync(join(root, ".codex", "hooks", file)), false);
    }
    const hooksJson = readFileSync(join(root, ".codex", "hooks.json"), "utf-8");
    assert.doesNotMatch(hooksJson, /guard-repository-writes/);
    assert.match(hooksJson, /deny-dangerous\.sh/);
    const config = readFileSync(
      join(root, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    assert.doesNotMatch(
      config,
      /guard-(destructive-shell|secret-paths|repository-writes)/,
    );
    assert.match(config, /deny-dangerous:\n    enabled: true/);
    assert.match(result.stdout, /removed stale hook/);
    assert.match(result.stdout, /migrated deny hook registration/);
  });

  // Fixture purpose: writes disabled split-hook config to cover deny-dangerous state migration.
  it("preserves disabled split guardrail config when migrating to deny-dangerous", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".codex", "hooks"), { recursive: true });
    mkdirSync(join(root, ".goat-flow"), { recursive: true });
    for (const file of [
      "guard-common.sh",
      "guard-destructive-shell.sh",
      "guard-secret-paths.sh",
      "guard-repository-writes.sh",
      "guardrails-self-test.sh",
    ]) {
      writeFileSync(
        join(root, ".codex", "hooks", file),
        "#!/usr/bin/env bash\n",
      );
    }
    writeFileSync(
      join(root, ".goat-flow", "config.yaml"),
      [
        'version: "1.8.0"',
        "hooks:",
        "  guard-destructive-shell:",
        "    enabled: false",
        "  guard-secret-paths:",
        "    enabled: true",
        "  guard-repository-writes:",
        "    enabled: true",
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(
      join(root, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    assert.doesNotMatch(
      config,
      /guard-(destructive-shell|secret-paths|repository-writes)/,
    );
    assert.match(config, /deny-dangerous:\n    enabled: false/);
  });

  const disabledHookSpecs = listHookSpecs();
  const managedScriptFiles = [
    ...new Set(disabledHookSpecs.flatMap((hookSpec) => hookSpec.scriptFiles)),
  ];
  const disabledConfig =
    "hooks:\n  deny-dangerous:\n    enabled: false\n  gruff-code-quality:\n    enabled: false\n  post-turn-safety:\n    enabled: false\n";
  // Each named fixture writes an all-off config and launches setup twice so provider defaults cannot silently return.
  for (const agentProfile of getAgentProfiles()) {
    it(`${agentProfile.id} keeps disabled hooks installed and inert`, () => {
      const consumerRoot = makeTempProject();
      const { id: agentId, hookConfigFile, hooksDir } = agentProfile;
      mkdirSync(join(consumerRoot, ".goat-flow"), { recursive: true });
      writeFileSync(
        join(consumerRoot, ".goat-flow", "config.yaml"),
        disabledConfig,
      );
      const firstInstall = runInstaller(consumerRoot, "--agent", agentId);
      assert.equal(
        firstInstall.status,
        0,
        firstInstall.stderr || firstInstall.stdout,
      );
      assert.ok(hookConfigFile && hooksDir);
      const hookConfigPath = join(consumerRoot, hookConfigFile);
      const firstHookConfig = readFileSync(hookConfigPath, "utf-8");
      assert.equal(
        disabledHookSpecs.some((hookSpec) =>
          firstHookConfig.includes(hookSpec.primaryScript),
        ),
        false,
        `${agentId} restored a hook the user disabled`,
      );
      assert.equal(
        managedScriptFiles.every((file) =>
          existsSync(join(consumerRoot, hooksDir, file)),
        ),
        true,
        `${agentId} removed files needed by a later UI toggle`,
      );
      const repeatedInstall = runInstaller(consumerRoot, "--agent", agentId);
      assert.equal(repeatedInstall.status, 0, repeatedInstall.stderr);
      assert.equal(readFileSync(hookConfigPath, "utf-8"), firstHookConfig);
    });
  }

  it("prunes stale per-skill reference files during upgrades", () => {
    const root = makeTempProject();
    const firstInstall = runInstaller(root, "--agent", "claude");
    assert.equal(
      firstInstall.status,
      0,
      firstInstall.stderr || firstInstall.stdout,
    );

    const staleReference = join(
      root,
      ".claude",
      "skills",
      "goat-security",
      "references",
      "auth-authz.md",
    );
    writeFileSync(
      staleReference,
      '---\ngoat-flow-reference-version: "1.6.0"\n---\n# Old auth reference\n',
    );

    const secondInstall = runInstaller(root, "--agent", "claude");
    assert.equal(
      secondInstall.status,
      0,
      secondInstall.stderr || secondInstall.stdout,
    );

    assert.equal(existsSync(staleReference), false);
    assert.equal(
      existsSync(
        join(
          root,
          ".claude",
          "skills",
          "goat-security",
          "references",
          "identity-and-data.md",
        ),
      ),
      true,
    );
    assert.match(secondInstall.stdout, /removed stale reference/);
    assert.match(secondInstall.stdout, /1 stale removed/);
  });
});
