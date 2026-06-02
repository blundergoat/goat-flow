/**
 * setup --apply installer behaviour: scaffolds config.yaml without an agents allowlist and manages
 * that allowlist on existing configs (removing single/multi-agent lists or a null value, leaving an
 * absent one absent), prunes orphaned artifacts on upgrade (legacy deny-dangerous self-test files,
 * 1.8.0 split guard hooks and their registrations, stale per-skill reference files), and does not
 * duplicate an existing node_modules gitignore entry.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  addCommit,
  git,
  gitAvailable,
  makeTempProject,
  runCliInstaller,
  runInstaller,
} from "./setup-install.helpers.js";

describe("setup --apply installer", () => {
  it("scaffolds config.yaml without an agents allowlist", () => {
    const root = makeTempProject();
    const result = runInstaller(root, "--agent", "codex");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const config = readFileSync(
      join(root, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    assert.doesNotMatch(config, /^agents:/m);
    const gitignore = readFileSync(join(root, ".gitignore"), "utf-8");
    assert.match(gitignore, /^node_modules\/$/m);
    assert.equal(
      existsSync(join(root, ".agents", "skills", "goat", "SKILL.md")),
      true,
    );
    assert.equal(
      existsSync(join(root, ".codex", "hooks", "deny-dangerous.sh")),
      true,
    );
    assert.equal(
      existsSync(join(root, ".goat-flow", "hook-lib", "patterns-shell.sh")),
      true,
    );
    assert.equal(
      existsSync(
        join(root, ".goat-flow", "hook-lib", "deny-dangerous-self-test.sh"),
      ),
      true,
    );
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
      existsSync(join(root, ".codex", "hooks", "deny-dangerous.sh")),
      true,
    );
    assert.equal(
      existsSync(
        join(root, ".goat-flow", "hook-lib", "deny-dangerous-self-test.sh"),
      ),
      true,
    );
    assert.match(result.stdout, /removed stale hook/);
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

  it("removes an existing agents allowlist from config.yaml", () => {
    const root = makeTempProject();
    const configDir = join(root, ".goat-flow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.yaml"),
      'version: "1.6.0"\n\nagents:\n  - claude\n\nskills:\n  install: all\n\ncustom_key: preserve_me\n',
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(configDir, "config.yaml"), "utf-8");
    assert.doesNotMatch(config, /^agents:/m);
    assert.match(config, /custom_key: preserve_me/);
  });

  it("removes multi-agent allowlists without touching other config", () => {
    const root = makeTempProject();
    const configDir = join(root, ".goat-flow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.yaml"),
      'version: "1.6.0"\n\nagents:\n  - claude\n  - codex\n\nskills:\n  install: all\n',
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(configDir, "config.yaml"), "utf-8");
    assert.doesNotMatch(config, /^agents:/m);
    assert.match(config, /skills:\n  install: all\n/);
  });

  it("keeps agents absent when existing config.yaml has none", () => {
    const root = makeTempProject();
    const configDir = join(root, ".goat-flow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.yaml"),
      'version: "1.6.0"\n\nskills:\n  install: all\n',
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(configDir, "config.yaml"), "utf-8");
    assert.doesNotMatch(config, /^agents:/m);
    assert.match(config, /skills:\n  install: all\n/);
  });

  it("removes agents null from config.yaml", () => {
    const root = makeTempProject();
    const configDir = join(root, ".goat-flow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.yaml"),
      'version: "1.6.0"\n\nagents: null\n\nskills:\n  install: all\n',
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(configDir, "config.yaml"), "utf-8");
    assert.doesNotMatch(config, /agents: null/);
    assert.match(config, /skills:\n  install: all\n/);
  });

  it("does not duplicate an existing node_modules gitignore entry", () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), "dist/\nnode_modules\n");

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const gitignore = readFileSync(join(root, ".gitignore"), "utf-8");
    assert.equal(gitignore.match(/^node_modules$/gm)?.length, 1);
    assert.doesNotMatch(gitignore, /^node_modules\/$/m);
    assert.match(gitignore, /^dist\/$/m);
  });

  it(
    "CLI install seeds missing GitHub commit instructions from target git history",
    { skip: !gitAvailable },
    () => {
      const root = makeTempProject();
      git(root, ["init"]);
      git(root, ["config", "user.name", "GOAT Test"]);
      git(root, ["config", "user.email", "goat@example.test"]);
      for (let i = 0; i < 10; i += 1) {
        addCommit(root, `feat(setup): add fixture ${i}`);
      }

      const result = runCliInstaller(root, "--agent", "copilot");
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const guidance = readFileSync(
        join(root, "docs", "coding-standards", "git-commit.md"),
        "utf-8",
      );
      assert.match(guidance, /generated from recent git history/);
      assert.match(guidance, /Use conventional commits/);
      assert.match(result.stdout, /Git commit instructions:/);
    },
  );
});

// ── Bug 1: Config version stuck on upgrade ──────────────────────────────
