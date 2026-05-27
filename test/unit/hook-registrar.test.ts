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
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyHookState,
  syncHookStates,
} from "../../src/cli/server/hook-registrar.js";

const HOOK_ID = "guard-secret-paths";

const GENERATED_AGENT_SURFACES = [
  ".claude/settings.json",
  ".claude/hooks/guard-common.sh",
  ".claude/hooks/guard-secret-paths.sh",
  ".codex/hooks.json",
  ".codex/hooks/guard-common.sh",
  ".codex/hooks/guard-secret-paths.sh",
  ".agents/hooks.json",
  ".agents/hooks/guard-common.sh",
  ".agents/hooks/guard-secret-paths.sh",
  ".github/hooks/hooks.json",
  ".github/hooks/guard-common.sh",
  ".github/hooks/guard-secret-paths.sh",
];

function withTempProject(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-hook-registrar-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function pathExists(root: string, path: string): boolean {
  return existsSync(join(root, path));
}

function assertMissing(root: string, paths: string[]): void {
  for (const path of paths) {
    assert.equal(pathExists(root, path), false, `${path} should be absent`);
  }
}

function assertPresent(root: string, paths: string[]): void {
  for (const path of paths) {
    assert.equal(pathExists(root, path), true, `${path} should exist`);
  }
}

describe("hook registrar", () => {
  it("does not scaffold uninstalled agent surfaces on clean target toggles", () => {
    withTempProject((root) => {
      applyHookState(HOOK_ID, false, root);

      assertMissing(root, GENERATED_AGENT_SURFACES);
    });

    withTempProject((root) => {
      applyHookState(HOOK_ID, true, root);

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

      applyHookState(HOOK_ID, true, root);

      assertPresent(root, [
        ".codex/hooks.json",
        ".codex/hooks/guard-common.sh",
        ".codex/hooks/guard-secret-paths.sh",
      ]);
      assertMissing(root, [
        ".claude/settings.json",
        ".claude/hooks/guard-secret-paths.sh",
        ".agents/hooks.json",
        ".agents/hooks/guard-secret-paths.sh",
        ".github/hooks/hooks.json",
        ".github/hooks/guard-secret-paths.sh",
      ]);
      assert.match(
        readFileSync(join(root, ".codex", "hooks.json"), "utf-8"),
        /guard-secret-paths\.sh/u,
      );
    });
  });

  it("does not treat shared AGENTS.md surfaces as a Codex or Antigravity opt-in", () => {
    withTempProject((root) => {
      writeFileSync(join(root, "AGENTS.md"), "# Local agent instructions\n");
      mkdirSync(join(root, ".agents", "skills"), { recursive: true });

      applyHookState(HOOK_ID, true, root);

      assertMissing(root, [
        ".codex/hooks.json",
        ".codex/hooks/guard-secret-paths.sh",
        ".agents/hooks.json",
        ".agents/hooks/guard-secret-paths.sh",
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
        ".agents/hooks/gruff-code-quality.sh",
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

      applyHookState(HOOK_ID, false, root);

      assertMissing(root, [
        ".claude/settings.json",
        ".claude/hooks/guard-secret-paths.sh",
      ]);
    });
  });
});
