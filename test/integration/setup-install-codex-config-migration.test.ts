/**
 * Codex config.toml migration during install: rewrites deprecated codex_hooks (and removes it when
 * hooks is already present), refreshes legacy Codex permission profiles to the current
 * `extends = ":workspace"` + access="deny" shape, and leaves comment-only references and unrelated
 * glob 'none' entries untouched.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeTempProject, runInstaller } from "./setup-install.helpers.js";

describe("codex config migration", () => {
  it("migrates deprecated codex_hooks without overwriting custom config", () => {
    const root = makeTempProject();
    const codexDir = join(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "config.toml"),
      'model = "gpt-5"\napproval_policy = "on-request"\n\n[features]\ncodex_hooks = true\n',
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(codexDir, "config.toml"), "utf-8");
    assert.match(config, /model = "gpt-5"/);
    assert.match(config, /approval_policy = "on-request"/);
    assert.match(config, /\[features\]\nhooks = true\n/);
    assert.doesNotMatch(config, /^\s*codex_hooks\s=/m);
    assert.match(result.stdout, /migrated:.*deprecated hooks flag/);
  });

  // Fixture purpose: writes invalid permission globs to cover in-place profile migration.
  it("migrates invalid filesystem permission globs in place", () => {
    const root = makeTempProject();
    const codexDir = join(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "config.toml"),
      [
        'model = "gpt-5"',
        'default_permissions = "goat-flow"',
        "",
        "[features]",
        "hooks = true",
        "",
        "[permissions.goat-flow.filesystem]",
        "glob_scan_max_depth = 3",
        "",
        '[permissions.goat-flow.filesystem.":workspace_roots"]',
        '"." = "write"',
        '"**/*.key" = "none"',
        '"*.pem" = "none"',
        '"secrets/**" = "none"',
        "",
        "[other]",
        'preserved = "yes"',
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(codexDir, "config.toml"), "utf-8");
    assert.match(config, /\[permissions\.goat-flow\]\s*\ndescription = /);
    assert.match(config, /extends = ":workspace"/);
    assert.doesNotMatch(config, /"none"/);
    assert.match(
      config,
      /\[permissions\.goat-flow\.filesystem\.":workspace_roots"\]/,
    );
    assert.match(config, /"\*\*\/secrets\/\*\*"\s*=\s*"deny"/);
    assert.match(config, /"\*\*\/\*\.key"\s*=\s*"deny"/);
    assert.match(config, /model = "gpt-5"/);
    assert.match(config, /\[other\]\s*\npreserved = "yes"/);
    assert.match(result.stdout, /migrated:.*Codex permission profile/);
  });

  // Fixture purpose: writes a legacy project-root anchor to cover workspace-root migration.
  it("migrates the legacy :project_roots anchor to :workspace_roots", () => {
    const root = makeTempProject();
    const codexDir = join(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "config.toml"),
      [
        'default_permissions = "goat-flow"',
        "",
        "[features]",
        "hooks = true",
        "",
        "[permissions.goat-flow.filesystem]",
        "glob_scan_max_depth = 3",
        "",
        '[permissions.goat-flow.filesystem.":project_roots"]',
        '"." = "write"',
        '"secrets/**" = "none"',
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(codexDir, "config.toml"), "utf-8");
    assert.doesNotMatch(config, /:project_roots/);
    assert.match(config, /extends = ":workspace"/);
    assert.match(config, /"\*\*\/secrets\/\*\*"\s*=\s*"deny"/);
  });

  // Fixture purpose: writes a missing active profile to cover default permission repair.
  it("repairs goat-flow default permissions when the active profile is missing", () => {
    const root = makeTempProject();
    const codexDir = join(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "config.toml"),
      [
        'default_permissions = "goat-flow"',
        "",
        "[features]",
        "hooks = true",
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(codexDir, "config.toml"), "utf-8");
    assert.match(config, /\[permissions\.goat-flow\]/);
    assert.match(config, /extends = ":workspace"/);
    assert.match(
      config,
      /\[permissions\.goat-flow\.filesystem\.":workspace_roots"\]/,
    );
  });

  // Fixture purpose: writes stale exact secret denies to cover broad-pattern migration.
  it("migrates stale exact env and credentials denies to broad patterns", () => {
    const root = makeTempProject();
    const codexDir = join(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "config.toml"),
      [
        'default_permissions = "goat-flow"',
        "",
        "[permissions.goat-flow]",
        'description = "goat-flow workspace editing with secret-path read denies."',
        'extends = ":workspace"',
        "",
        "[permissions.goat-flow.filesystem]",
        "glob_scan_max_depth = 3",
        "",
        '[permissions.goat-flow.filesystem.":workspace_roots"]',
        '"**/.env" = "deny"',
        '"**/.env.local" = "deny"',
        '"**/.env.development" = "deny"',
        '"**/.env.production" = "deny"',
        '"**/.env.staging" = "deny"',
        '"**/.env.test" = "deny"',
        '"**/.envrc" = "deny"',
        '"**/secrets/**" = "deny"',
        '"**/.ssh/**" = "deny"',
        '"**/.aws/**" = "deny"',
        '"**/.docker/**" = "deny"',
        '"**/.gnupg/**" = "deny"',
        '"**/.kube/**" = "deny"',
        '"**/credentials" = "deny"',
        '"**/.npmrc" = "deny"',
        '"**/.pypirc" = "deny"',
        '"**/*.pem" = "deny"',
        '"**/*.key" = "deny"',
        '"**/*.pfx" = "deny"',
        '"private/**" = "deny"',
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(codexDir, "config.toml"), "utf-8");
    assert.match(config, /"\*\*\/\.env\*"\s*=\s*"deny"/);
    assert.match(config, /"\*\*\/credentials\*"\s*=\s*"deny"/);
    assert.match(config, /"private\/\*\*"\s*=\s*"deny"/);
    assert.match(config, /env\.example is intentionally denied/);
    assert.doesNotMatch(config, /"\*\*\/\.env\.local"\s*=\s*"deny"/);
    assert.doesNotMatch(config, /"\*\*\/credentials"\s*=\s*"deny"/);
    assert.match(result.stdout, /migrated:.*Codex permission profile/);
  });

  // Fixture purpose: writes a custom active profile to cover non-goat-flow migration.
  it("migrates the active custom Codex permission profile", () => {
    const root = makeTempProject();
    const codexDir = join(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "config.toml"),
      [
        'default_permissions = "custom"',
        "",
        "[permissions.custom.filesystem]",
        "glob_scan_max_depth = 3",
        "",
        '[permissions.custom.filesystem.":project_roots"]',
        '"." = "write"',
        '"*.pem" = "none"',
        '"secrets/**" = "none"',
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(codexDir, "config.toml"), "utf-8");
    assert.match(config, /default_permissions = "custom"/);
    assert.match(config, /extends = ":workspace"/);
    assert.match(config, /\[permissions\.custom\.filesystem\]/);
    assert.doesNotMatch(config, /\[permissions\.goat-flow\.filesystem\]/);
    assert.doesNotMatch(config, /:project_roots/);
    assert.doesNotMatch(config, /"\*\.pem"\s*=\s*"none"/);
    assert.match(config, /"\*\*\/\*\.pem"\s*=\s*"deny"/);
    assert.match(result.stdout, /migrated:.*Codex permission profile/);
  });

  // Fixture purpose: writes an old goat-flow profile to cover custom deny preservation.
  it("migrates old goat-flow profiles and preserves custom deny entries", () => {
    const root = makeTempProject();
    const codexDir = join(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "config.toml"),
      [
        'default_permissions = "goat-flow"',
        "",
        "[permissions.goat-flow.filesystem]",
        "glob_scan_max_depth = 3",
        '":workspace_roots" = { "." = "write", "secrets/**" = "none", "private/**" = "none" }',
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(codexDir, "config.toml"), "utf-8");
    assert.match(config, /extends = ":workspace"/);
    assert.match(config, /"private\/\*\*"\s*=\s*"deny"/);
    assert.match(result.stdout, /migrated:.*Codex permission profile/);
  });

  // Fixture purpose: writes inline workspace-root globs to cover table migration.
  it("migrates invalid globs inside an inline :workspace_roots table", () => {
    const root = makeTempProject();
    const codexDir = join(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "config.toml"),
      [
        'default_permissions = "goat-flow"',
        "",
        "[permissions.goat-flow.filesystem]",
        "glob_scan_max_depth = 3",
        '":workspace_roots" = { "." = "write", "*.pem" = "none", "secrets/**" = "none" }',
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(codexDir, "config.toml"), "utf-8");
    assert.doesNotMatch(config, /"\*\.pem"\s*=\s*"none"/);
    assert.match(config, /"\*\*\/secrets\/\*\*"\s*=\s*"deny"/);
    assert.match(result.stdout, /migrated:.*Codex permission profile/);
  });

  // Fixture purpose: writes comment-only legacy text to cover no-op migration behavior.
  it("does not treat comment-only :project_roots references as legacy anchors", () => {
    const root = makeTempProject();
    const codexDir = join(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "config.toml"),
      [
        'default_permissions = "goat-flow"',
        "",
        "[permissions.goat-flow]",
        'extends = ":workspace"',
        "",
        "[permissions.goat-flow.filesystem]",
        "glob_scan_max_depth = 3",
        "# legacy :project_roots anchor was replaced with :workspace_roots",
        '[permissions.goat-flow.filesystem.":workspace_roots"]',
        '"**/.env*" = "deny"',
        '"**/secrets/**" = "deny"',
        '"**/.ssh/**" = "deny"',
        '"**/.aws/**" = "deny"',
        '"**/.docker/**" = "deny"',
        '"**/.gnupg/**" = "deny"',
        '"**/.kube/**" = "deny"',
        '"**/credentials*" = "deny"',
        '"**/.npmrc" = "deny"',
        '"**/.pypirc" = "deny"',
        '"**/*.pem" = "deny"',
        '"**/*.key" = "deny"',
        '"**/*.pfx" = "deny"',
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(codexDir, "config.toml"), "utf-8");
    assert.match(config, /# legacy :project_roots anchor was replaced/);
    assert.doesNotMatch(result.stdout, /migrated:.*Codex permission profile/);
  });

  it("post-install validator does not flag a glob 'none' entry in an unrelated table", () => {
    const root = makeTempProject();
    const codexDir = join(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "config.toml"),
      [
        'default_permissions = "goat-flow"',
        "",
        "[permissions.goat-flow.filesystem]",
        "glob_scan_max_depth = 3",
        '":workspace_roots" = { "." = "write", "secrets/**" = "none" }',
        "",
        "[my_custom_section]",
        '"*.pem" = "none"',
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(
      result.stderr,
      /still has invalid Codex permission entries/,
    );
  });

  it("removes deprecated codex_hooks when hooks is already present", () => {
    const root = makeTempProject();
    const codexDir = join(root, ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "config.toml"),
      "[features]\nhooks = true\ncodex_hooks = true\n",
    );

    const result = runInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(codexDir, "config.toml"), "utf-8");
    assert.equal(config.match(/^hooks = true$/gm)?.length, 1);
    assert.doesNotMatch(config, /^\s*codex_hooks\s=/m);
  });
});

// ── Bug 3: Deprecated skill cleanup ─────────────────────────────────────
