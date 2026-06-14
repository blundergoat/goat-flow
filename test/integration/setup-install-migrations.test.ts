/**
 * setup --apply installer upgrade migrations: legacy artifacts are migrated or pruned
 * without overwriting target collisions - tasks workspace/config to plans, learning-loop
 * dirs, hook-lib content and fat per-agent hook copies, enabled gruff hook registrations,
 * Codex permission entries, stale Claude MultiEdit deny rules, legacy skill docs, 1.8.0
 * split guard hooks and registrations, and stale per-skill reference files.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeTempProject, runInstaller } from "./setup-install.helpers.js";

describe("setup --apply installer upgrade migrations", () => {
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
    assert.match(settings, /post-turn-safety\.sh/u);
  });

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

  // Fixture purpose: writes old Codex gruff hook registrations because unsupported hooks must be pruned without leaving stale launchers.
  it("prunes legacy Codex gruff hook registrations because Codex gruff is unsupported", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".codex", "hooks"), { recursive: true });
    mkdirSync(join(root, ".goat-flow"), { recursive: true });
    writeFileSync(
      join(root, ".codex", "hooks", "gruff-code-quality.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    writeFileSync(
      join(root, ".codex", "hooks.json"),
      JSON.stringify(
        {
          hooks: {
            PostToolUse: [
              {
                matcher: "Edit",
                hooks: [
                  {
                    type: "command",
                    command: ".codex/hooks/gruff-code-quality.sh",
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(root, ".goat-flow", "config.yaml"),
      [
        'version: "1.9.0"',
        "hooks:",
        "  deny-dangerous:",
        "    enabled: true",
        "  gruff-code-quality:",
        "    enabled: true",
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.equal(
      existsSync(join(root, ".codex", "hooks", "gruff-code-quality.sh")),
      false,
    );
    const hooksJson = readFileSync(join(root, ".codex", "hooks.json"), "utf-8");
    assert.doesNotMatch(hooksJson, /\.codex\/hooks\/gruff-code-quality\.sh/);
    assert.doesNotMatch(
      hooksJson,
      /\.goat-flow\/hooks\/gruff-code-quality\.sh/,
    );
    assert.doesNotMatch(hooksJson, /PostToolUse/);
    assert.match(hooksJson, /\.goat-flow\/hooks\/deny-dangerous\.sh/);
    assert.doesNotMatch(hooksJson, /"matcher": "MultiEdit"/);
  });

  // Fixture purpose: writes single-quoted Codex denies to cover quote-normalizing migration.
  it("preserves single-quoted Codex filesystem deny entries during permission migration", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "default_permissions = 'goat-flow'",
        "",
        "[permissions.goat-flow.filesystem]",
        "'private/**' = 'deny'",
        "'**/.env*' = 'deny'",
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(root, ".codex", "config.toml"), "utf-8");
    assert.match(config, /"private\/\*\*" = "deny"/);
    assert.match(config, /"\*\*\/\.env\*" = "deny"/);
  });

  // Fixture purpose: writes stale Claude deny settings to cover removed-tool pruning.
  it("prunes stale removed-tool (MultiEdit) deny rules from existing Claude settings on upgrade", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".claude"), { recursive: true });
    // Claude Code v2.x removed MultiEdit; surviving MultiEdit(...) deny rules
    // print "matches no known tool" on every launch. The upgrade must strip
    // them WITHOUT touching managed (Edit) or user-added unmanaged (WebFetch)
    // denies for tools Claude still recognises.
    writeFileSync(
      join(root, ".claude", "settings.json"),
      JSON.stringify(
        {
          permissions: {
            deny: [
              "MultiEdit(**/secrets/**)",
              "MultiEdit(**/*.key)",
              "Edit(**/*.key)",
              "WebFetch(**/internal/**)",
            ],
          },
        },
        null,
        2,
      ) + "\n",
    );

    const result = runInstaller(root, "--agent", "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /stale removed-tool deny rules/);

    const settings = JSON.parse(
      readFileSync(join(root, ".claude", "settings.json"), "utf-8"),
    ) as { permissions?: { deny?: string[] } };
    const deny = settings.permissions?.deny ?? [];
    assert.ok(
      deny.every((rule) => !rule.startsWith("MultiEdit(")),
      `MultiEdit deny rules should be pruned, got: ${deny.join(", ")}`,
    );
    // No collateral damage to valid managed/unmanaged tool denies.
    assert.ok(deny.includes("Edit(**/*.key)"), "managed Edit deny preserved");
    assert.ok(
      deny.includes("WebFetch(**/internal/**)"),
      "user-added WebFetch deny preserved",
    );

    // Idempotent: a second upgrade reports no further deny migration.
    const second = runInstaller(root, "--agent", "claude");
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.doesNotMatch(second.stdout, /stale removed-tool deny rules/);
    const settings2 = JSON.parse(
      readFileSync(join(root, ".claude", "settings.json"), "utf-8"),
    ) as { permissions?: { deny?: string[] } };
    assert.ok(
      (settings2.permissions?.deny ?? []).every(
        (rule) => !rule.startsWith("MultiEdit("),
      ),
    );
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
