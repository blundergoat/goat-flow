/**
 * Keeps a failed or partial setup from enrolling unrelated agents or replacing the developer's source files.
 *
 * Replays the reviewed installer failures through real disposable projects.
 * Tests preserve settings, parse the resulting YAML, and verify that linked documentation stays untouched.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { load } from "js-yaml";
import { emitCommitGuidanceInstallResult } from "../../src/cli/prompt/commit-guidance.js";
import {
  makeTempProject,
  runCliInstaller,
  runInstaller,
} from "./setup-install.helpers.js";

/** Writes an executable analyzer fixture so setup exercises YAML path detection without running or installing Gruff. */
function writeConventionalGruffPy(projectRoot: string): string {
  const binaryDirectory = join(projectRoot, "strands_agents", ".venv", "bin");
  const binaryPath = join(binaryDirectory, "gruff-py");
  mkdirSync(binaryDirectory, { recursive: true });
  writeFileSync(binaryPath, "#!/usr/bin/env python3\n");
  chmodSync(binaryPath, 0o755);
  return binaryPath;
}

describe("setup safety regressions", () => {
  // Local overrides isolate permission previews from the selected provider's separate hook-registration changes.
  for (const [label, denyRules, shouldMigrate] of [
    ["home only", ["Read(~/.ssh/**)"], true],
    ["project only", ["Read(**/.ssh/**)"], true],
    ["complete pair", ["Read(~/.ssh/**)", "Read(**/.ssh/**)"], false],
    ["absent pair", [], false],
  ] as const) {
    it(`previews credential-pair migration for ${label}`, () => {
      const root = makeTempProject();
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(
        join(root, ".claude/settings.local.json"),
        JSON.stringify({ permissions: { deny: denyRules } }),
      );
      const preview = runCliInstaller(
        root,
        "--agent",
        "claude",
        "--dry-run",
        "--format",
        "json",
      );
      assert.equal(preview.status, 0, preview.stderr);
      const previewRows = (
        JSON.parse(preview.stdout) as {
          files: Array<{ path: string; action: string }>;
        }
      ).files;
      const localSettingsRow = previewRows.find(
        (row) => row.path === ".claude/settings.local.json",
      );
      assert.ok(localSettingsRow);
      assert.equal(
        localSettingsRow.action,
        shouldMigrate ? "migrate" : "preserve",
      );
    });
  }

  // Choosing Codex must preserve unrelated Claude settings, including comments that strict JSON cannot parse.
  for (const foreignConfig of [
    '{"permissions":{"allow":["Read(notes.md)"]}}\n',
    '{ // user JSON comment\n "permissions": {}\n}\n',
  ]) {
    it(`preserves unmanaged foreign provider settings (${foreignConfig.includes("//") ? "commented" : "valid"})`, () => {
      const root = makeTempProject();
      mkdirSync(join(root, ".claude"), { recursive: true });
      const settings = join(root, ".claude/settings.json");
      writeFileSync(settings, foreignConfig);
      const preview = runCliInstaller(
        root,
        "--agent",
        "codex",
        "--dry-run",
        "--format",
        "json",
      );
      assert.equal(preview.status, 0, preview.stderr);
      const previewRows = (
        JSON.parse(preview.stdout) as { files: Array<{ path: string }> }
      ).files;
      assert.equal(
        previewRows.some((row) => row.path === ".claude/settings.json"),
        false,
      );
      const result = runCliInstaller(root, "--agent", "codex");
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(readFileSync(settings, "utf8"), foreignConfig);
      assert.ok(
        existsSync(join(root, ".goat-flow/hooks/deny-git-mutations.sh")),
      );
    });
  }

  it("previews Git protection for an already enrolled sibling provider", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".claude"), { recursive: true });
    // A legacy managed guard proves enrollment even though its Git companion has not been installed yet.
    writeFileSync(
      join(root, ".claude/settings.json"),
      JSON.stringify({
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
        },
      }),
    );
    const preview = runCliInstaller(
      root,
      "--agent",
      "codex",
      "--dry-run",
      "--format",
      "json",
    );
    assert.equal(preview.status, 0, preview.stderr);
    const previewRows = (
      JSON.parse(preview.stdout) as {
        files: Array<{ path: string; reason: string }>;
      }
    ).files;
    const siblingRow = previewRows.find(
      (row) => row.path === ".claude/settings.json",
    );
    assert.ok(siblingRow);
    assert.match(siblingRow.reason, /deny-git-mutations/);
  });

  it("keeps new agent registrations absent if existing managed policy registration is invalid", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(
      join(root, ".claude/settings.json"),
      '{"hooks": "deny-dangerous.sh",',
    );
    const result = runInstaller(root, "--agent", "codex");
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(root, ".codex/hooks.json")), false);
  });

  // These valid multiline forms broke after the installer inserted a detected binary path beside the user's existing choice.
  for (const gruffConfig of [
    "  gruff-code-quality:\n    {enabled: true}\n",
    "  gruff-code-quality:\n    enabled:\n      true\n",
  ]) {
    it(`preserves valid Gruff YAML when a value starts on the next line (${gruffConfig.includes("{") ? "flow" : "scalar"})`, () => {
      const root = makeTempProject();
      writeConventionalGruffPy(root);
      mkdirSync(join(root, ".goat-flow"), { recursive: true });
      const configPath = join(root, ".goat-flow/config.yaml");
      writeFileSync(configPath, 'version: "1.17.0"\nhooks:\n' + gruffConfig);
      const result = runInstaller(root, "--agent", "codex");
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const config = load(readFileSync(configPath, "utf8")) as {
        hooks: Record<string, { enabled: boolean }>;
      };
      assert.equal(config.hooks["gruff-code-quality"].enabled, true);
    });
  }

  // The outside sentinel proves setup neither imports unrelated documentation nor removes the developer's link to it.
  it("does not migrate a legacy commit guide through a symlink", (testContext) => {
    const root = makeTempProject();
    const outside = makeTempProject();
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "docs/coding-standards"), { recursive: true });
    const source = join(outside, "guide.md");
    writeFileSync(source, "outside sentinel\n");
    const legacy = join(root, "docs/coding-standards/git-commit.md");
    try {
      symlinkSync(source, legacy);
    } catch (error) {
      // Windows without Developer Mode can refuse symlink fixtures before the migration is exercised.
      if (
        process.platform === "win32" &&
        (error as NodeJS.ErrnoException).code === "EPERM"
      ) {
        testContext.skip("Host does not permit symlink creation");
        return;
      }
      throw error;
    }
    emitCommitGuidanceInstallResult(root, "codex");
    assert.equal(
      existsSync(join(root, "docs/coding-standards/git-commit-message.md")),
      false,
    );
    assert.equal(readFileSync(legacy, "utf8"), "outside sentinel\n");
  });
});
