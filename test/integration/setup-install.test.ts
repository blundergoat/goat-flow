/**
 * setup --apply installer behaviour: scaffolds config.yaml without an agents allowlist and manages
 * that allowlist on existing configs (removing single/multi-agent lists or a null value, leaving an
 * absent one absent), does not duplicate an existing node_modules gitignore entry, and seeds GitHub
 * commit instructions from target git history. Upgrade migration and prune cases live in
 * setup-install-migrations.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
    assert.doesNotMatch(config, /plan-checkbox-guard/u);
    assert.doesNotMatch(config, /plan-guard/u);
    const gitignore = readFileSync(join(root, ".gitignore"), "utf-8");
    assert.match(gitignore, /^node_modules\/$/m);
    assert.equal(
      existsSync(join(root, ".agents", "skills", "goat", "SKILL.md")),
      true,
    );
    assert.equal(
      existsSync(join(root, ".goat-flow", "hooks", "deny-dangerous.sh")),
      true,
    );
    assert.equal(
      existsSync(join(root, ".goat-flow", "hooks", "plan-checkbox-guard.sh")),
      false,
    );
    const codexHooks = readFileSync(
      join(root, ".codex", "hooks.json"),
      "utf-8",
    );
    assert.match(codexHooks, /PreToolUse/u);
    assert.match(codexHooks, /deny-dangerous\.sh/u);
    assert.doesNotMatch(codexHooks, /PostToolUse/u);
    assert.doesNotMatch(codexHooks, /Stop/u);
    assert.doesNotMatch(codexHooks, /gruff-code-quality\.sh/u);
    assert.doesNotMatch(codexHooks, /post-turn-safety\.sh/u);
    assert.equal(
      existsSync(
        join(
          root,
          ".goat-flow",
          "hooks",
          "deny-dangerous",
          "patterns-shell.sh",
        ),
      ),
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
  });

  it("does not register unverified Antigravity Stop hooks during install", () => {
    const root = makeTempProject();
    const result = runInstaller(root, "--agent", "antigravity");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const hooksJson = readFileSync(
      join(root, ".agents", "hooks.json"),
      "utf-8",
    );
    assert.match(hooksJson, /deny-dangerous/u);
    assert.doesNotMatch(hooksJson, /post-turn-safety\.sh/u);
    assert.doesNotMatch(hooksJson, /plan-checkbox-guard\.sh/u);
    assert.doesNotMatch(hooksJson, /"Stop"/u);
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

  // Runs two installs and writes one temp system file to prove canonical content replaces it.
  it("overwrites system-owned files from their declared source", () => {
    const projectRoot = makeTempProject();
    const firstInstall = runInstaller(projectRoot, "--agent", "codex");
    assert.equal(
      firstInstall.status,
      0,
      firstInstall.stderr || firstInstall.stdout,
    );
    const installedReadmePath = join(
      projectRoot,
      ".goat-flow",
      "logs",
      "quality",
      "README.md",
    );
    writeFileSync(installedReadmePath, "user edited a system file\n");

    const reinstall = runInstaller(projectRoot, "--agent", "codex");
    assert.equal(reinstall.status, 0, reinstall.stderr || reinstall.stdout);
    assert.equal(
      readFileSync(installedReadmePath, "utf-8"),
      readFileSync(
        join(
          import.meta.dirname,
          "..",
          "..",
          "workflow",
          "setup",
          "reference",
          "quality-readme.md",
        ),
        "utf-8",
      ),
    );
  });

  // Runs two installs and writes one temp policy to prove project-owner content survives.
  it("preserves user-owned files during a normal reinstall", () => {
    const projectRoot = makeTempProject();
    const firstInstall = runInstaller(projectRoot, "--agent", "codex");
    assert.equal(
      firstInstall.status,
      0,
      firstInstall.stderr || firstInstall.stdout,
    );
    const securityPolicyPath = join(
      projectRoot,
      ".goat-flow",
      "security-policy.md",
    );
    const customizedPolicy =
      "# Team security policy\n\nKeep this local rule.\n";
    writeFileSync(securityPolicyPath, customizedPolicy);

    const reinstall = runInstaller(projectRoot, "--agent", "codex");
    assert.equal(reinstall.status, 0, reinstall.stderr || reinstall.stdout);
    assert.equal(readFileSync(securityPolicyPath, "utf-8"), customizedPolicy);
  });

  // Runs two installs and removes one temp anchor to prove local session storage is recreated.
  it("regenerates declared generated anchors", () => {
    const projectRoot = makeTempProject();
    const firstInstall = runInstaller(projectRoot, "--agent", "codex");
    assert.equal(
      firstInstall.status,
      0,
      firstInstall.stderr || firstInstall.stdout,
    );
    const sessionAnchorPath = join(
      projectRoot,
      ".goat-flow",
      "logs",
      "sessions",
      ".gitkeep",
    );
    unlinkSync(sessionAnchorPath);

    const reinstall = runInstaller(projectRoot, "--agent", "codex");
    assert.equal(reinstall.status, 0, reinstall.stderr || reinstall.stdout);
    assert.equal(existsSync(sessionAnchorPath), true);
    assert.equal(readFileSync(sessionAnchorPath, "utf-8"), "");
  });

  // Writes one temp editor file, runs install, and proves the user's external rules stay unchanged.
  it("leaves external files unchanged", () => {
    const projectRoot = makeTempProject();
    const cursorIgnorePath = join(projectRoot, ".cursorignore");
    const editorRules = ".env*\nprivate-notes/\n";
    writeFileSync(cursorIgnorePath, editorRules);

    const install = runInstaller(projectRoot, "--agent", "codex");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    assert.equal(readFileSync(cursorIgnorePath, "utf-8"), editorRules);
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
