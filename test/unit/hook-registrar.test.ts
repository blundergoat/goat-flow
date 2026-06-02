/**
 * Unit tests for dashboard hook registration, drift detection, and script materialization.
 */
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
import { PROFILES } from "../../src/cli/detect/agents.js";
import {
  readAgentHookState,
  writeAgentHookState,
} from "../../src/cli/server/agent-hook-writer.js";
import {
  applyHookState,
  syncHookStates,
} from "../../src/cli/server/hook-registrar.js";
import {
  getHookSpec,
  isValidHookIdShape,
  listHookSpecs,
} from "../../src/cli/server/hooks-registry.js";

const HOOK_ID = "deny-dangerous";

const GENERATED_AGENT_SURFACES = [
  ".claude/settings.json",
  ".claude/hooks/deny-dangerous.sh",
  ".codex/hooks.json",
  ".codex/hooks/deny-dangerous.sh",
  ".agents/hooks.json",
  ".agents/hooks/deny-dangerous.sh",
  ".github/hooks/hooks.json",
  ".github/hooks/deny-dangerous.sh",
  ".goat-flow/hook-lib/patterns-shell.sh",
  ".goat-flow/hook-lib/patterns-paths.sh",
  ".goat-flow/hook-lib/patterns-writes.sh",
  ".goat-flow/hook-lib/deny-dangerous-self-test.sh",
];

/** Writes a cleaned temporary target project for hook-registrar assertions. */
function withTempProject(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-hook-registrar-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

/** Check fixture-relative generated hook paths. */
function pathExists(root: string, path: string): boolean {
  return existsSync(join(root, path));
}

/** Assert generated surfaces remain absent when a hook toggle should not scaffold. */
function assertMissing(root: string, paths: string[]): void {
  for (const path of paths) {
    assert.equal(pathExists(root, path), false, `${path} should be absent`);
  }
}

/** Assert generated surfaces are present after an explicit hook sync. */
function assertPresent(root: string, paths: string[]): void {
  for (const path of paths) {
    assert.equal(pathExists(root, path), true, `${path} should exist`);
  }
}

describe("hook registrar", () => {
  it("persists hook state through the writer and exposes registry specs", () => {
    withTempProject((root) => {
      const spec = getHookSpec("deny-dangerous");
      assert.ok(spec);

      writeAgentHookState(root, PROFILES.codex, spec, true);
      const state = readAgentHookState(root, PROFILES.codex, spec);

      assert.equal(state.installed, true);
      assert.equal(
        listHookSpecs().some((hookSpec) => hookSpec.id === spec.id),
        true,
      );
      assert.equal(isValidHookIdShape("gruff-code-quality"), true);
      assert.equal(isValidHookIdShape("../bad"), false);
    });
  });

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
        ".codex/hooks/deny-dangerous.sh",
        ".goat-flow/hook-lib/patterns-shell.sh",
        ".goat-flow/hook-lib/patterns-paths.sh",
        ".goat-flow/hook-lib/patterns-writes.sh",
        ".goat-flow/hook-lib/deny-dangerous-self-test.sh",
      ]);
      assertMissing(root, [
        ".claude/settings.json",
        ".claude/hooks/deny-dangerous.sh",
        ".agents/hooks.json",
        ".agents/hooks/deny-dangerous.sh",
        ".github/hooks/hooks.json",
        ".github/hooks/deny-dangerous.sh",
      ]);
      assert.match(
        readFileSync(join(root, ".codex", "hooks.json"), "utf-8"),
        /deny-dangerous\.sh/u,
      );
    });
  });

  it("unignores hook-lib when enabling deny-dangerous on a stale goat-flow gitignore", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".codex"), { recursive: true });
      mkdirSync(join(root, ".goat-flow"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");
      writeFileSync(join(root, ".goat-flow", ".gitignore"), "*\n!.gitignore\n");

      applyHookState(HOOK_ID, true, root);

      const gitignore = readFileSync(
        join(root, ".goat-flow", ".gitignore"),
        "utf-8",
      );
      assert.match(gitignore, /^!hook-lib\/$/m);
      assert.match(gitignore, /^!hook-lib\/\*\*$/m);
    });
  });

  it("does not treat shared AGENTS.md surfaces as a Codex or Antigravity opt-in", () => {
    withTempProject((root) => {
      writeFileSync(join(root, "AGENTS.md"), "# Local agent instructions\n");
      mkdirSync(join(root, ".agents", "skills"), { recursive: true });

      applyHookState(HOOK_ID, true, root);

      assertMissing(root, [
        ".codex/hooks.json",
        ".codex/hooks/deny-dangerous.sh",
        ".agents/hooks.json",
        ".agents/hooks/deny-dangerous.sh",
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
        ".claude/hooks/guard-common.sh",
        ".claude/hooks/guard-secret-paths.sh",
      ]);
    });
  });
});
