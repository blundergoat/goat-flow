/**
 * Integration tests for deterministic setup/install scaffolding.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const disposables: string[] = [];

after(() => {
  for (const dir of disposables) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-setup-install-"));
  disposables.push(root);
  return root;
}

function runInstaller(root: string, ...extraArgs: string[]) {
  return spawnSync(
    "bash",
    [
      join(PROJECT_ROOT, "workflow", "install-goat-flow.sh"),
      root,
      ...extraArgs,
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 30000,
    },
  );
}

describe("setup --apply installer", () => {
  it("scaffolds config.yaml for only the requested agent", () => {
    const root = makeTempProject();
    const result = runInstaller(root, "--agent", "codex");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const config = readFileSync(
      join(root, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    assert.match(config, /agents:\n  - codex\n/);
    assert.doesNotMatch(config, /  - claude\n/);
    assert.doesNotMatch(config, /  - gemini\n/);
    assert.doesNotMatch(config, /  - copilot\n/);
    assert.equal(
      existsSync(join(root, ".agents", "skills", "goat", "SKILL.md")),
      true,
    );
    assert.equal(
      existsSync(join(root, ".codex", "hooks", "deny-dangerous.sh")),
      true,
    );
    assert.equal(
      existsSync(join(root, ".codex", "hooks", "deny-dangerous.self-test.sh")),
      true,
    );
  });

  it("adds the requested agent to an existing config.yaml", () => {
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
    assert.match(config, /agents:\n  - claude\n  - codex\n/);
    assert.match(config, /custom_key: preserve_me/);
  });

  it("does not duplicate an agent already listed in config.yaml", () => {
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
    assert.equal(config.match(/  - codex\n/g)?.length, 1);
  });

  it("adds an agents block when existing config.yaml has none", () => {
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
    assert.match(config, /agents:\n  - codex\n/);
  });

  it("replaces agents null with the requested agent", () => {
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
    assert.match(config, /agents:\n  - codex\n/);
    assert.doesNotMatch(config, /agents: null/);
  });
});

// ── Bug 1: Config version stuck on upgrade ──────────────────────────────

describe("--update-config-version flag", () => {
  it("updates only the version field in existing config.yaml", () => {
    const root = makeTempProject();
    const configDir = join(root, ".goat-flow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.yaml"),
      'version: "1.4.3"\n\nagents:\n  - claude\n  - codex\n\nskills:\n  install: all\n\ncustom_key: preserve_me\n',
    );

    const result = runInstaller(
      root,
      "--agent",
      "claude",
      "--update-config-version",
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(configDir, "config.yaml"), "utf-8");
    assert.doesNotMatch(config, /1\.4\.3/, "old version should be replaced");
    assert.match(
      config,
      /agents:\n  - claude\n  - codex\n/,
      "agents list must be preserved",
    );
    assert.match(
      config,
      /custom_key: preserve_me/,
      "custom keys must be preserved",
    );
  });

  it("preserves config.yaml version when --update-config-version is not passed", () => {
    const root = makeTempProject();
    const configDir = join(root, ".goat-flow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.yaml"),
      'version: "1.3.0"\n\nagents:\n  - claude\n',
    );

    const result = runInstaller(root, "--agent", "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const config = readFileSync(join(configDir, "config.yaml"), "utf-8");
    assert.match(config, /1\.3\.0/, "version should remain unchanged");
  });
});

// ── Bug 2: Settings skip warning ────────────────────────────────────────

describe("settings skip warning", () => {
  it("warns when deny hook is installed but settings.json was skipped", () => {
    const root = makeTempProject();
    const claudeDir = join(root, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.json"), '{"permissions":{}}');

    const result = runInstaller(root, "--agent", "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.match(
      result.stdout,
      /Settings file was preserved/,
      "should warn about preserved settings",
    );
    assert.match(
      result.stdout,
      /deny hook.*was installed but may not be/i,
      "should mention the deny hook may not be registered",
    );
  });
});

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
    assert.match(result.stdout, /migrated deprecated hooks flag/);
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

describe("--clean-deprecated flag", () => {
  it("removes deprecated skill directories when flag is passed", () => {
    const root = makeTempProject();
    // Simulate a v0.9 project with deprecated skills
    const deprecatedDirs = ["goat-audit", "goat-test", "goat-investigate"];
    for (const name of deprecatedDirs) {
      const dir = join(root, ".claude", "skills", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `# ${name}`);
    }

    const result = runInstaller(
      root,
      "--agent",
      "claude",
      "--clean-deprecated",
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const name of deprecatedDirs) {
      assert.equal(
        existsSync(join(root, ".claude", "skills", name)),
        false,
        `deprecated skill ${name} should be removed`,
      );
    }
    assert.equal(
      existsSync(join(root, ".claude", "skills", "goat", "SKILL.md")),
      true,
      "canonical skills should still be installed",
    );
  });

  it("does not remove deprecated skills without the flag", () => {
    const root = makeTempProject();
    const deprecatedDir = join(root, ".claude", "skills", "goat-audit");
    mkdirSync(deprecatedDir, { recursive: true });
    writeFileSync(join(deprecatedDir, "SKILL.md"), "# goat-audit");

    const result = runInstaller(root, "--agent", "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.equal(
      existsSync(deprecatedDir),
      true,
      "deprecated skill should be preserved without flag",
    );
  });
});
