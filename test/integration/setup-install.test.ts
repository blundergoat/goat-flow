/**
 * Proves the files and settings a user receives from `setup --apply`.
 * Use when config allowlists, the `node_modules` ignore rule, or Git commit-guidance installation changes.
 *
 * The suite covers absent, null, single-agent, and multi-agent config states without duplicating existing user content.
 * Upgrade migration and prune cases remain in `setup-install-migrations.test.ts`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

import { emitCommitGuidanceInstallResult } from "../../src/cli/prompt/commit-guidance.js";
import {
  acquirePathWriteClaims,
  readPathWriteTargetIdentity,
  releasePathWriteClaims,
} from "../../src/cli/path-write-claim.js";
import {
  git,
  makeTempProject,
  POST_TURN_SAFETY_TIMEOUT_SECONDS,
  PROJECT_ROOT,
  readClaudePostTurnSafetyTimeout,
  runCliInstaller,
  runInstaller,
} from "./setup-install.helpers.js";
import {
  readInvocations,
  resolveTool,
  writeMockGruffBinary,
} from "./gruff-code-quality-smoke.helpers.js";

/**
 * Groups the permission choices a Claude user sees after setup migration.
 * Empty arrays mean that group has no saved rules.
 */
interface ClaudePermissionGroups {
  deny: string[];
  allow: string[];
  ask: string[];
}

/**
 * Assert the permission bits a Unix user receives on an installed file.
 * Use for security-sensitive setup output; Windows reports synthetic modes outside this contract.
 */
function assertPosixFileMode(filePath: string, expectedMode: number): void {
  // Windows users receive synthetic mode bits, so this POSIX-only assertion has no meaningful UI or filesystem result there.
  if (process.platform === "win32") return;
  assert.equal(statSync(filePath).mode & 0o777, expectedMode);
}

/**
 * Reads the permission groups users receive after setup migrates their settings.
 * Use when a test needs the same deny, allow, and ask categories a Claude user sees after upgrade.
 *
 * @param projectRoot - non-empty fixture root containing `.claude/settings.json`
 * @returns all three groups; a missing group appears as an empty user rule list
 */
function readClaudePermissionGroups(
  projectRoot: string,
): ClaudePermissionGroups {
  const settings = JSON.parse(
    readFileSync(join(projectRoot, ".claude", "settings.json"), "utf-8"),
  ) as { permissions?: Record<string, string[]> };
  // A missing group means the user has not saved rules in that UI category.
  return {
    deny: settings.permissions?.deny ?? [],
    allow: settings.permissions?.allow ?? [],
    ask: settings.permissions?.ask ?? [],
  };
}

/**
 * Finds stale rules that would show misleading permission choices after upgrade.
 * Use after reading migrated settings so tests can report any retired tool label still visible to the user.
 *
 * @param groups - migrated groups; empty arrays mean the user saved no rules there
 * @returns stale rule labels, or an empty list when the UI contract is current
 */
function stalePermissionRules(groups: ClaudePermissionGroups): string[] {
  const stalePrefixes = ["MultiEdit(", "Write(", "NotebookEdit(", "Glob("];
  return [groups.deny, groups.allow, groups.ask]
    .flat()
    .filter((rule) => stalePrefixes.some((prefix) => rule.startsWith(prefix)));
}

/**
 * Create the executable nested analyzer convention inside a disposable project.
 *
 * Use before setup so tests can verify the analyzer path a user receives in generated config.
 * Side effect: writes and marks one analyzer fixture executable inside `projectRoot`; fixture calls supply a disposable project.
 *
 * @param projectRoot - non-empty disposable project that owns the generated analyzer fixture
 * @returns executable analyzer path; never empty after fixture creation succeeds
 */
function writeConventionalGruffPy(projectRoot: string): string {
  const binaryDirectory = join(projectRoot, "strands_agents", ".venv", "bin");
  const binaryPath = join(binaryDirectory, "gruff-py");
  mkdirSync(binaryDirectory, { recursive: true });
  writeFileSync(binaryPath, "#!/usr/bin/env python3\n");
  chmodSync(binaryPath, 0o755);
  return binaryPath;
}

describe("setup --apply installer", () => {
  // A fresh Claude user needs enough runner time to see the hook's own incomplete-scan warning.
  it("registers Claude post-turn safety with the registry timeout", () => {
    const root = makeTempProject();
    git(root, ["init"]);
    const result = runInstaller(root, "--agent", "claude");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      readClaudePostTurnSafetyTimeout(root),
      POST_TURN_SAFETY_TIMEOUT_SECONDS,
    );
  });

  it("scaffolds config.yaml without an agents allowlist", () => {
    const root = makeTempProject();
    git(root, ["init"]);
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
    // Fresh Codex users receive the live-proven Stop feedback path without enabling Gruff.
    assert.match(codexHooks, /"Stop"/u);
    assert.doesNotMatch(codexHooks, /gruff-code-quality\.sh/u);
    assert.match(codexHooks, /post-turn-safety\.sh/u);
    assert.match(codexHooks, /"timeout": 90/u);
    assert.match(
      codexHooks,
      /codex:post-turn:goat-flow\.hook-result\.v1:turn-stop:1:75000/u,
    );
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

  // Fixture purpose: installs with the nested analyzer and proves an explicit path wins; writes stay in the disposable project.
  it("pins a conventional strands_agents gruff-py during install", () => {
    const root = makeTempProject();
    writeConventionalGruffPy(root);

    const result = runInstaller(root, "--agent", "codex");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const config = readFileSync(
      join(root, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    assert.match(
      config,
      /binaries:\n {6}py: strands_agents\/\.venv\/bin\/gruff-py/u,
    );

    const configPath = join(root, ".goat-flow", "config.yaml");
    writeFileSync(
      configPath,
      config.replace("strands_agents/.venv/bin/gruff-py", "tools/gruff-py"),
    );
    const secondResult = runInstaller(root, "--agent", "codex");
    assert.equal(
      secondResult.status,
      0,
      secondResult.stderr || secondResult.stdout,
    );
    const preservedConfig = readFileSync(configPath, "utf-8");
    assert.match(preservedConfig, /binaries:\n {6}py: tools\/gruff-py/u);
    assert.doesNotMatch(
      preservedConfig,
      /strands_agents\/\.venv\/bin\/gruff-py/u,
    );
  });

  // Fixture purpose: runs the installed hook through its persisted nested analyzer override; writes stay in the disposable project.
  it(
    "runs the installed Gruff hook through the detected strands_agents binary",
    { skip: process.platform === "win32" },
    () => {
      const root = makeTempProject();
      writeMockGruffBinary(
        root,
        "strands_agents/.venv/bin",
        "gruff-py",
        "installed-config.rule",
      );
      writeFileSync(join(root, ".gruff-py.yaml"), "rules: {}\n");
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "sample.py"), "a\nb\nc\n");

      const installResult = runCliInstaller(root, "--agent", "codex");
      assert.equal(
        installResult.status,
        0,
        installResult.stderr || installResult.stdout,
      );

      const payloadPath = join(root, "post-tool-payload.json");
      writeFileSync(
        payloadPath,
        JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: "src/sample.py",
            changed_ranges: [{ startLine: 3, endLine: 3 }],
          },
        }),
      );
      const bashPath = resolveTool("bash");
      const payloadHandle = openSync(payloadPath, "r");
      let hookResult: ReturnType<typeof spawnSync>;
      try {
        // Argv contains only the test runner's resolved Bash and the hook installed below this disposable fixture root.
        hookResult = spawnSync(
          bashPath,
          [join(root, ".goat-flow", "hooks", "gruff-code-quality.sh")],
          {
            cwd: root,
            encoding: "utf-8",
            env: {
              ...process.env,
              GRUFF_PY_BIN: "",
              PATH: "/usr/bin:/bin",
            },
            stdio: [payloadHandle, "pipe", "pipe"],
          },
        );
      } finally {
        // For example, a hook process can fail while reading the payload, so its file handle and one-use fixture must still be released.
        closeSync(payloadHandle);
        unlinkSync(payloadPath);
      }

      assert.equal(
        hookResult.status,
        0,
        hookResult.stderr || hookResult.stdout,
      );
      assert.match(hookResult.stdout, /installed-config\.rule/u);
      assert.deepEqual(readInvocations(root), ["src/sample.py"]);
    },
  );

  // Fixture purpose: reproduces an enabled hook without its nested analyzer override; writes stay in the disposable project.
  it("repairs a missing gruff-py override for an enabled existing hook", () => {
    const root = makeTempProject();
    writeConventionalGruffPy(root);
    mkdirSync(join(root, ".goat-flow"), { recursive: true });
    writeFileSync(
      join(root, ".goat-flow", "config.yaml"),
      [
        'version: "1.16.0"',
        "hooks:",
        "    deny-dangerous:",
        "        enabled: true",
        "    post-turn-safety:",
        "        enabled: true",
        "# Keep the project-specific Gruff choice visible.",
        "    gruff-code-quality:",
        "        enabled: true",
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const config = readFileSync(
      join(root, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    assert.match(config, /gruff-code-quality:\n {8}enabled: true/u);
    assert.match(
      config,
      / {8}binaries:\n {12}py: strands_agents\/\.venv\/bin\/gruff-py/u,
    );
    const parsedConfig = load(config) as {
      hooks: Record<string, { binaries?: Record<string, string> }>;
    };
    assert.equal(
      parsedConfig.hooks["gruff-code-quality"].binaries?.py,
      "strands_agents/.venv/bin/gruff-py",
    );
  });

  // Fixture purpose: redirects the conventional analyzer outside the selected target; side effects: writes only inside cleaned temp projects.
  it(
    "does not pin a conventional gruff-py symlink that escapes the project",
    { skip: process.platform === "win32" },
    () => {
      const outsideRoot = makeTempProject();
      const outsideBinary = join(outsideRoot, "gruff-py");
      writeFileSync(outsideBinary, "#!/usr/bin/env python3\n");
      chmodSync(outsideBinary, 0o755);
      const root = makeTempProject();
      const binaryDirectory = join(root, "strands_agents", ".venv", "bin");
      mkdirSync(binaryDirectory, { recursive: true });
      symlinkSync(outsideBinary, join(binaryDirectory, "gruff-py"));

      const result = runInstaller(root, "--agent", "codex");

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const config = readFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "utf-8",
      );
      assert.doesNotMatch(config, /binaries:/u);
    },
  );

  // Fixture purpose: removes execute permission from the nested analyzer; writes stay in the disposable project.
  it(
    "does not pin a non-executable conventional gruff-py during install",
    { skip: process.platform === "win32" },
    () => {
      const root = makeTempProject();
      chmodSync(writeConventionalGruffPy(root), 0o644);

      const result = runInstaller(root, "--agent", "codex");

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const config = readFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "utf-8",
      );
      assert.doesNotMatch(config, /binaries:/u);
    },
  );

  // Fixture purpose: keeps compact hook YAML while detecting the nested analyzer; writes stay in the disposable project.
  it("pins gruff-py without expanding a flow-style hooks mapping", () => {
    const root = makeTempProject();
    writeConventionalGruffPy(root);
    mkdirSync(join(root, ".goat-flow"), { recursive: true });
    const configPath = join(root, ".goat-flow", "config.yaml");
    writeFileSync(
      configPath,
      'version: "1.16.0"\nhooks: { "gruff-code-quality": { enabled: true } }\n',
    );

    const result = runInstaller(root, "--agent", "codex");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const config = readFileSync(configPath, "utf-8");
    assert.match(
      config,
      /^hooks: \{.*"gruff-code-quality": \{ enabled: true, binaries: \{ py: strands_agents\/\.venv\/bin\/gruff-py \} \}.*\}$/mu,
    );
    const parsedConfig = load(config) as {
      hooks: Record<string, { binaries?: Record<string, string> }>;
    };
    assert.equal(
      parsedConfig.hooks["gruff-code-quality"].binaries?.py,
      "strands_agents/.venv/bin/gruff-py",
    );
  });

  // Fixture purpose: puts colliding and nested keys before Gruff; writes stay in the disposable project.
  it("pins gruff-py to the exact flow-style hook key", () => {
    const root = makeTempProject();
    writeConventionalGruffPy(root);
    mkdirSync(join(root, ".goat-flow"), { recursive: true });
    const configPath = join(root, ".goat-flow", "config.yaml");
    writeFileSync(
      configPath,
      [
        'version: "1.16.0"',
        'hooks: { other-hook: { note: "#, gruff-code-quality: { enabled: true }" },',
        "  other-flow-hook: {}, #, gruff-code-quality: { enabled: true }",
        "  not-gruff-code-quality: { enabled: true, gruff-code-quality: { enabled: true } },",
        '  "deny-dangerous": { enabled: true },',
        '  "post-turn-safety": { enabled: true },',
        '  "gruff-code-quality": { enabled: true }',
        "}",
        "",
      ].join("\n"),
    );

    const result = runInstaller(root, "--agent", "codex");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsedConfig = load(readFileSync(configPath, "utf-8")) as {
      hooks: Record<
        string,
        {
          binaries?: Record<string, string>;
          "gruff-code-quality"?: { binaries?: Record<string, string> };
        }
      >;
    };
    assert.equal(
      parsedConfig.hooks["not-gruff-code-quality"].binaries,
      undefined,
    );
    assert.equal(
      parsedConfig.hooks["not-gruff-code-quality"]["gruff-code-quality"]
        ?.binaries,
      undefined,
    );
    assert.equal(
      parsedConfig.hooks["gruff-code-quality"].binaries?.py,
      "strands_agents/.venv/bin/gruff-py",
    );
    assert.match(
      readFileSync(configPath, "utf-8"),
      /#, gruff-code-quality: \{ enabled: true \}\n/u,
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
    const installedPatternsReadmePath = join(
      projectRoot,
      ".goat-flow",
      "learning-loop",
      "patterns",
      "README.md",
    );
    writeFileSync(installedReadmePath, "user edited a system file\n");
    writeFileSync(
      installedPatternsReadmePath,
      "user edited the patterns guide\n",
    );

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
    const canonicalPatternsReadme = readFileSync(
      join(
        import.meta.dirname,
        "..",
        "..",
        "workflow",
        "setup",
        "reference",
        "patterns-readme.md",
      ),
      "utf-8",
    );
    assert.match(canonicalPatternsReadme, /^## Bucket Size$/mu);
    assert.equal(
      readFileSync(installedPatternsReadmePath, "utf-8"),
      canonicalPatternsReadme,
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

  it("CLI install renames commit guidance from the former canonical path", () => {
    const root = makeTempProject();
    const guidanceDir = join(root, "docs", "coding-standards");
    const legacyGuidancePath = join(guidanceDir, "git-commit.md");
    const preferredGuidancePath = join(guidanceDir, "git-commit-message.md");
    const legacyGuidance = "# Team Commit Rules\n\nKeep this project rule.\n";
    mkdirSync(join(root, ".git"));
    mkdirSync(guidanceDir, { recursive: true });
    writeFileSync(legacyGuidancePath, legacyGuidance);

    const result = runCliInstaller(root, "--agent", "copilot");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(legacyGuidancePath), false);
    assert.equal(readFileSync(preferredGuidancePath, "utf-8"), legacyGuidance);
    assert.match(
      result.stdout,
      /renamed from docs\/coding-standards\/git-commit\.md/,
    );
  });

  // Fixture purpose: the selected Copilot instruction holds the only former-path link; a following section proves other bytes and mode survive.
  // Side effects: creates and mutates a disposable project owned by this test.
  it("commit guidance rewrites the selected Commit Messages bridge before renaming", () => {
    const root = makeTempProject();
    const guidanceDir = join(root, "docs", "coding-standards");
    const legacyGuidancePath = join(guidanceDir, "git-commit.md");
    const preferredGuidancePath = join(guidanceDir, "git-commit-message.md");
    const instructionPath = join(root, ".github", "copilot-instructions.md");
    const legacyGuidance = "# Team Commit Rules\n\nKeep this project rule.\n";
    const instructionContent =
      "# Copilot\n\n## Commit Messages\n\nRead docs/coding-standards/git-commit.md before proposing a commit.\n\n## Verification\n\nKeep this section unchanged.\n";
    mkdirSync(join(root, ".git"));
    mkdirSync(guidanceDir, { recursive: true });
    mkdirSync(join(root, ".github"), { recursive: true });
    writeFileSync(legacyGuidancePath, legacyGuidance);
    writeFileSync(instructionPath, instructionContent);
    chmodSync(instructionPath, 0o640);

    emitCommitGuidanceInstallResult(root, "copilot");

    assert.equal(existsSync(legacyGuidancePath), false);
    assert.equal(readFileSync(preferredGuidancePath, "utf-8"), legacyGuidance);
    assert.equal(
      readFileSync(instructionPath, "utf-8"),
      instructionContent.replace(
        "docs/coding-standards/git-commit.md",
        "docs/coding-standards/git-commit-message.md",
      ),
    );
    assertPosixFileMode(instructionPath, 0o640);
  });

  // Fixture purpose: the same selected bridge must appear in dry-run and contend through the public install claim boundary.
  // Side effects: writes one disposable target, spawns dry-run and install subprocesses, and acquires then releases one owner-checked claim.
  it("previews and claims the selected commit-guidance migration bridge", () => {
    const root = makeTempProject();
    const guidanceDir = join(root, "docs", "coding-standards");
    const legacyGuidancePath = join(guidanceDir, "git-commit.md");
    const preferredGuidancePath = join(guidanceDir, "git-commit-message.md");
    const instructionRelativePath = ".github/copilot-instructions.md";
    const instructionPath = join(root, instructionRelativePath);
    const legacyGuidance = "# Team Commit Rules\n\nKeep this project rule.\n";
    const instructionContent =
      "# Copilot\n\n## Commit Messages\n\nRead docs/coding-standards/git-commit.md before proposing a commit.\n";
    mkdirSync(join(root, ".git"));
    mkdirSync(guidanceDir, { recursive: true });
    mkdirSync(join(root, ".github"), { recursive: true });
    writeFileSync(legacyGuidancePath, legacyGuidance);
    writeFileSync(instructionPath, instructionContent);

    const dryRun = runCliInstaller(
      root,
      "--agent",
      "copilot",
      "--dry-run",
      "--format",
      "json",
    );
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    const report = JSON.parse(dryRun.stdout) as {
      files: Array<{ path: string; action: string; reason: string }>;
    };
    const bridgeRow = report.files.find(
      (file) => file.path === instructionRelativePath,
    );
    assert.equal(bridgeRow?.action, "migrate");
    assert.match(bridgeRow?.reason ?? "", /Commit Messages/u);

    const bridgeClaim = acquirePathWriteClaims(root, [
      {
        targetPath: instructionRelativePath,
        expectedIdentity: readPathWriteTargetIdentity(
          root,
          instructionRelativePath,
        ),
      },
    ]);
    let blockedInstall: ReturnType<typeof runCliInstaller> | null = null;
    try {
      blockedInstall = runCliInstaller(root, "--agent", "copilot");
    } finally {
      assert.deepEqual(releasePathWriteClaims(bridgeClaim), [
        { targetPath: instructionRelativePath, status: "released" },
      ]);
    }

    assert.ok(blockedInstall, "the claimed public install must return");
    assert.equal(blockedInstall.status, 1, blockedInstall.stdout);
    assert.match(blockedInstall.stderr, /copilot-instructions\.md/u);
    assert.equal(readFileSync(legacyGuidancePath, "utf-8"), legacyGuidance);
    assert.equal(existsSync(preferredGuidancePath), false);
    assert.equal(readFileSync(instructionPath, "utf-8"), instructionContent);
  });

  // Fixture purpose: a Claude-owned former-path link blocks a Copilot install from renaming the shared guide, preserving every involved file.
  // Side effects: creates and mutates a disposable project owned by this test.
  it("commit guidance keeps the former guide when another agent instruction still references it", () => {
    const root = makeTempProject();
    const guidanceDir = join(root, "docs", "coding-standards");
    const legacyGuidancePath = join(guidanceDir, "git-commit.md");
    const preferredGuidancePath = join(guidanceDir, "git-commit-message.md");
    const foreignInstructionPath = join(root, "CLAUDE.md");
    const legacyGuidance = "# Team Commit Rules\n\nKeep this project rule.\n";
    const foreignInstruction =
      "# Claude\n\n## Commit Messages\n\nRead docs/coding-standards/git-commit.md before proposing a commit.\n";
    mkdirSync(join(root, ".git"));
    mkdirSync(guidanceDir, { recursive: true });
    writeFileSync(legacyGuidancePath, legacyGuidance);
    writeFileSync(foreignInstructionPath, foreignInstruction);

    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => {
      output.push(values.map(String).join(" "));
    };
    try {
      emitCommitGuidanceInstallResult(root, "copilot");
    } finally {
      // For example, a failed guidance migration can throw after console capture starts, so later tests still need normal user-facing output.
      console.log = originalLog;
    }

    assert.equal(readFileSync(legacyGuidancePath, "utf-8"), legacyGuidance);
    assert.equal(existsSync(preferredGuidancePath), false);
    assert.equal(
      readFileSync(foreignInstructionPath, "utf-8"),
      foreignInstruction,
    );
    assert.match(
      output.join("\n"),
      /kept docs\/coding-standards\/git-commit\.md/,
    );
    assert.match(output.join("\n"), /legacy references in CLAUDE\.md/);
  });

  it("CLI install copies the reviewed template for a Git project", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".git"));

    const result = runCliInstaller(root, "--agent", "copilot");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const guidance = readFileSync(
      join(root, "docs", "coding-standards", "git-commit-message.md"),
      "utf-8",
    );
    const template = readFileSync(
      join(
        PROJECT_ROOT,
        "workflow",
        "setup",
        "reference",
        "git-commit-message.md",
      ),
      "utf-8",
    );
    assert.equal(guidance, template);
    assert.match(result.stdout, /copied from goat-flow template/);
  });

  it("CLI install does not create commit guidance without .git", () => {
    const root = makeTempProject();

    const result = runCliInstaller(root, "--agent", "copilot");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      existsSync(
        join(root, "docs", "coding-standards", "git-commit-message.md"),
      ),
      false,
    );
    assert.doesNotMatch(result.stdout, /Git commit instructions:/);
  });

  it("CLI install preserves both commit guides when the preferred path exists", () => {
    const root = makeTempProject();
    const guidanceDir = join(root, "docs", "coding-standards");
    const legacyGuidancePath = join(guidanceDir, "git-commit.md");
    const preferredGuidancePath = join(guidanceDir, "git-commit-message.md");
    const legacyGuidance = "# Legacy Team Rules\n";
    const preferredGuidance = "# Preferred Team Rules\n";
    mkdirSync(join(root, ".git"));
    mkdirSync(guidanceDir, { recursive: true });
    writeFileSync(legacyGuidancePath, legacyGuidance);
    writeFileSync(preferredGuidancePath, preferredGuidance);

    const result = runCliInstaller(root, "--agent", "copilot");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(readFileSync(legacyGuidancePath, "utf-8"), legacyGuidance);
    assert.equal(
      readFileSync(preferredGuidancePath, "utf-8"),
      preferredGuidance,
    );
    assert.doesNotMatch(result.stdout, /Git commit instructions:/);
  });
});

describe("setup --apply permission upgrade migrations", () => {
  // Covers removed-tool, unmatched-rule, and broad env-deny migrations together.
  // Fixture purpose: writes stale Claude rules for pruning, rewriting, and env-deny expansion.
  it("prunes removed-tool (MultiEdit) denies and rewrites unmatched Write/NotebookEdit/Glob denies on upgrade", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".claude"), { recursive: true });
    // Example: a user upgrades after MultiEdit was removed and old rules now show as invalid.
    // Setup rewrites usable paths, expands env protection, and preserves custom WebFetch rules.
    writeFileSync(
      join(root, ".claude", "settings.json"),
      JSON.stringify(
        {
          permissions: {
            allow: ["Read(**/.env.example)", "Write(docs/**)"],
            ask: ["Glob(**/dist/**)"],
            deny: [
              "MultiEdit(**/secrets/**)",
              "MultiEdit(**/*.key)",
              "Edit(**/*.key)",
              "Write(**/*.key)",
              "Write(**/custom-cert.pem)",
              "NotebookEdit(**/notebooks/**)",
              "Glob(**/generated/**)",
              "Read(**/.env*)",
              "Edit(**/.env*)",
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
    assert.match(result.stdout, /stale or superseded permission rules/);

    const { deny, allow, ask } = readClaudePermissionGroups(root);
    assert.deepEqual(
      stalePermissionRules({ deny, allow, ask }),
      [],
      "retired and unmatched permission forms should be gone",
    );
    // Write(**/*.key) deduped into the existing Edit rule, not duplicated.
    assert.deepEqual(
      deny.filter((rule) => rule === "Edit(**/*.key)"),
      ["Edit(**/*.key)"],
      "managed Edit deny preserved exactly once",
    );
    // Unmatched forms without a covering rule keep their intent via rewrite.
    assert.ok(deny.includes("Edit(**/custom-cert.pem)"), "Write rewritten");
    assert.ok(deny.includes("Edit(**/notebooks/**)"), "NotebookEdit rewritten");
    assert.ok(deny.includes("Read(**/generated/**)"), "Glob rewritten");
    // Broad env denies expanded so .env.example matches no deny rule.
    assert.ok(!deny.includes("Read(**/.env*)"), "broad env read deny expanded");
    assert.ok(deny.includes("Read(**/.env)"), "exact env deny added");
    assert.ok(deny.includes("Read(**/.envrc)"), "envrc deny added");
    assert.ok(
      deny.includes("Read(**/.env.*.local)"),
      "local-variant deny added",
    );
    assert.ok(!deny.includes("Edit(**/.env*)"), "broad env edit deny expanded");
    assert.ok(deny.includes("Edit(**/.env)"), "exact env edit deny added");
    assert.ok(
      deny.includes("Edit(**/.env.*.local)"),
      "local-variant edit deny added",
    );
    // Allow/ask arrays repaired without env expansion.
    assert.ok(allow.includes("Edit(docs/**)"), "allow Write rewritten to Edit");
    assert.ok(
      allow.includes("Read(**/.env.example)"),
      "sample env allow preserved",
    );
    assert.ok(ask.includes("Read(**/dist/**)"), "ask Glob rewritten to Read");
    // No collateral damage to valid user-added unmanaged tool denies.
    assert.ok(
      deny.includes("WebFetch(**/internal/**)"),
      "user-added WebFetch deny preserved",
    );

    // Idempotent: a second upgrade reports no further permission migration.
    const second = runInstaller(root, "--agent", "claude");
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.doesNotMatch(second.stdout, /stale or superseded permission rules/);
  });
});
