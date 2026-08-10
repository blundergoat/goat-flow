/**
 * Covers Codex upgrades users receive when they run setup on an older project.
 * Use for hook-launcher, feature-flag, and permission-profile migrations.
 * Real release bytes prove supported upgrades without approximating old installs.
 * User settings and unrelated permission tables remain intact throughout.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { readAgentHookState } from "../../src/cli/server/agent-hook-writer.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";

import {
  makeTempProject,
  PROJECT_ROOT,
  runInstaller,
} from "./setup-install.helpers.js";

/**
 * Spawns a read-only Git process to load exact v1.15.0 bytes for a user upgrade fixture.
 * @param relativePath - non-empty tagged path; empty cannot identify a release file
 * @returns file bytes, or null when the user's checkout lacks the v1.15.0 tag
 */
function readReleaseFile(relativePath: string): string | null {
  const gitShowResult = spawnSync("git", ["show", `v1.15.0:${relativePath}`], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
  });
  // Missing tag bytes make the real upgrade fixture unavailable instead of approximate.
  return gitShowResult.status === 0 ? gitShowResult.stdout : null;
}

const V1_15_0_CODEX_HOOKS = readReleaseFile(
  "workflow/hooks/agent-config/codex-hooks.json",
);
const V1_15_0_BASH_RUNNER = readReleaseFile("workflow/hooks/run-with-bash.mjs");
// Shallow archives have no release bytes, so users' upgrade proof is explicitly unavailable.
const V1_15_0_UPGRADE_FIXTURE_UNAVAILABLE =
  V1_15_0_CODEX_HOOKS === null || V1_15_0_BASH_RUNNER === null;

describe("codex config migration", () => {
  it(
    "migrates the literal 1.15.0 launcher and runner without creating Git state",
    { skip: V1_15_0_UPGRADE_FIXTURE_UNAVAILABLE },
    () => {
      // The skip above handles shallow archives; these checks narrow the real tagged bytes.
      assert.ok(V1_15_0_CODEX_HOOKS);
      assert.ok(V1_15_0_BASH_RUNNER);
      const targetProjectPath = makeTempProject();
      mkdirSync(join(targetProjectPath, ".codex"), { recursive: true });
      mkdirSync(join(targetProjectPath, ".goat-flow", "hooks"), {
        recursive: true,
      });
      // This is the exact non-Git project a Codex user would have after installing v1.15.0.
      writeFileSync(
        join(targetProjectPath, ".codex", "hooks.json"),
        V1_15_0_CODEX_HOOKS,
      );
      writeFileSync(
        join(targetProjectPath, ".goat-flow", "hooks", "run-with-bash.mjs"),
        V1_15_0_BASH_RUNNER,
      );

      const installResult = runInstaller(targetProjectPath, "--agent", "codex");
      // When setup fails, show whichever user-facing stream explains the problem.
      assert.equal(
        installResult.status,
        0,
        installResult.stderr || installResult.stdout,
      );
      // Upgrade must not create Git state just to make the user's hook launcher work.
      assert.equal(existsSync(join(targetProjectPath, ".git")), false);

      const installedHookConfig = readFileSync(
        join(targetProjectPath, ".codex", "hooks.json"),
        "utf-8",
      );
      const installedBashRunner = readFileSync(
        join(targetProjectPath, ".goat-flow", "hooks", "run-with-bash.mjs"),
        "utf-8",
      );
      assert.doesNotMatch(
        installedHookConfig,
        /git repository root unavailable/u,
      );
      assert.match(installedHookConfig, /managed root unavailable/u);
      assert.match(installedHookConfig, /"Stop"/u);
      assert.match(installedHookConfig, /"timeout": 90/u);
      assert.match(
        installedHookConfig,
        /codex:post-turn:goat-flow\.hook-result\.v1:turn-stop:1:75000/u,
      );
      assert.equal(
        existsSync(
          join(
            targetProjectPath,
            ".goat-flow",
            "hooks",
            "hook-launch-runtime.mjs",
          ),
        ),
        true,
      );
      assert.notEqual(installedBashRunner, V1_15_0_BASH_RUNNER);
      assert.equal(
        installedBashRunner,
        readFileSync(
          join(PROJECT_ROOT, "workflow", "hooks", "run-with-bash.mjs"),
          "utf-8",
        ),
      );

      const denySpec = getHookSpec("deny-dangerous");
      // A missing registry entry means setup cannot prove the user's deny registration.
      assert.ok(denySpec);
      assert.equal(
        readAgentHookState(targetProjectPath, PROFILES.codex, denySpec)
          .installed,
        true,
      );

      const convergedHookConfig = installedHookConfig;
      const convergedBashRunner = installedBashRunner;
      const repeatedInstallResult = runInstaller(
        targetProjectPath,
        "--agent",
        "codex",
      );
      // When repeated setup fails, show whichever user-facing stream explains the problem.
      assert.equal(
        repeatedInstallResult.status,
        0,
        repeatedInstallResult.stderr || repeatedInstallResult.stdout,
      );
      // Repeating setup keeps the user's project non-Git and leaves managed bytes unchanged.
      assert.equal(existsSync(join(targetProjectPath, ".git")), false);
      assert.equal(
        readFileSync(join(targetProjectPath, ".codex", "hooks.json"), "utf-8"),
        convergedHookConfig,
      );
      assert.equal(
        readFileSync(
          join(targetProjectPath, ".goat-flow", "hooks", "run-with-bash.mjs"),
          "utf-8",
        ),
        convergedBashRunner,
      );
    },
  );

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

  // Fixture purpose: writes stale exact secret denies to cover canonical-pattern migration.
  it("migrates stale credentials denies and completes the enumerated env set", () => {
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
    assert.match(config, /"\*\*\/\.env" = "deny"/);
    assert.match(config, /"\*\*\/\.env\.local" = "deny"/);
    assert.match(config, /"\*\*\/\.env\.\*\.local" = "deny"/);
    assert.doesNotMatch(config, /"\*\*\/\.env\*" = "deny"/);
    assert.match(config, /"\*\*\/credentials\*"\s*=\s*"deny"/);
    assert.match(config, /"private\/\*\*"\s*=\s*"deny"/);
    assert.match(config, /env\.example stays readable/);
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
        '"**/.env" = "deny"',
        '"**/.env.local" = "deny"',
        '"**/.env.development" = "deny"',
        '"**/.env.production" = "deny"',
        '"**/.env.staging" = "deny"',
        '"**/.env.test" = "deny"',
        '"**/.envrc" = "deny"',
        '"**/.env.*.local" = "deny"',
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

describe("codex hook and permission upgrade migrations", () => {
  // Fixture purpose: writes an old Codex Gruff registration so upgrades replace Goat Flow fields and preserve user entries.
  it("migrates legacy Codex Gruff registration to the approved provider contract", () => {
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
            CustomEvent: [{ command: "node custom-user-hook.mjs" }],
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
    assert.match(hooksJson, /\.goat-flow\/hooks\/gruff-code-quality\.sh/);
    assert.match(hooksJson, /"PostToolUse"/u);
    assert.match(hooksJson, /"matcher": "\^apply_patch\$"/u);
    assert.match(hooksJson, /"timeout": 90/u);
    assert.match(
      hooksJson,
      /codex:gruff:goat-flow\.hook-result\.v1:post-tool:1:75000/u,
    );
    assert.match(hooksJson, /custom-user-hook\.mjs/u);
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
    assert.match(config, /"\*\*\/\.env" = "deny"/);
    assert.doesNotMatch(config, /"\*\*\/\.env\*" = "deny"/);
  });
});

// ── Bug 3: Deprecated skill cleanup ─────────────────────────────────────
