/**
 * Unit tests for dashboard hook registration, drift detection, and script materialization.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const CLAUDE_SAFE_PAYLOAD =
  '{"tool_name":"Bash","tool_input":{"command":"echo safe"}}';
const CLAUDE_DANGEROUS_PAYLOAD =
  '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}';

const GENERATED_AGENT_SURFACES = [
  ".claude/settings.json",
  ".goat-flow/hooks/deny-dangerous.sh",
  ".codex/hooks.json",
  ".goat-flow/hooks/deny-dangerous.sh",
  ".agents/hooks.json",
  ".goat-flow/hooks/deny-dangerous.sh",
  ".github/hooks/hooks.json",
  ".goat-flow/hooks/deny-dangerous.sh",
  ".goat-flow/hooks/deny-dangerous/patterns-shell.sh",
  ".goat-flow/hooks/deny-dangerous/patterns-paths.sh",
  ".goat-flow/hooks/deny-dangerous/patterns-writes.sh",
  ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
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

/** Run a git command in a fixture project and fail with stdout/stderr context. */
function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout.trim();
}

/** Create one commit so git worktree/submodule fixtures have a real HEAD. */
function commitAll(root: string, message: string): void {
  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=goat-flow-test",
    "-c",
    "user.email=goat-flow-test@example.invalid",
    "commit",
    "-m",
    message,
  ]);
}

/** Read the first generated Claude deny-dangerous launcher from settings. */
function readClaudeDenyLauncher(root: string): string {
  const settings = JSON.parse(
    readFileSync(join(root, ".claude", "settings.json"), "utf-8"),
  ) as {
    hooks?: {
      PreToolUse?: Array<{
        hooks?: Array<{ command?: string }>;
      }>;
    };
  };
  const command = settings.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command;
  assert.equal(typeof command, "string");
  return command;
}

/** Seed a Claude hook-capable fixture and return the generated deny launcher. */
function installClaudeDenyHook(root: string): string {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
  applyHookState(HOOK_ID, true, root);
  return readClaudeDenyLauncher(root);
}

/** Execute the generated Claude launcher with a runtime-shaped payload. */
function runClaudeLauncher(
  command: string,
  cwd: string,
  payload = CLAUDE_SAFE_PAYLOAD,
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof spawnSync> {
  return spawnSync("bash", ["-c", command], {
    cwd,
    encoding: "utf8",
    env,
    input: payload,
  });
}

/** Assert the generated launcher allows a benign payload from this cwd. */
function assertLauncherAllows(command: string, cwd: string): void {
  const result = runClaudeLauncher(command, cwd);
  assert.equal(
    result.status,
    0,
    `launcher should allow benign payload\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
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
      assert.equal(getHookSpec("gruff-code-quality")?.matcher, "Edit|Write");
      assert.equal(isValidHookIdShape("gruff-code-quality"), true);
      assert.equal(isValidHookIdShape("../bad"), false);
    });
  });

  it("uses policy-hook startup copy in generated launcher failures", () => {
    withTempProject((root) => {
      const denySpec = getHookSpec("deny-dangerous");
      const gruffSpec = getHookSpec("gruff-code-quality");
      assert.ok(denySpec);
      assert.ok(gruffSpec);

      writeAgentHookState(root, PROFILES.claude, denySpec, true);
      writeAgentHookState(root, PROFILES.claude, gruffSpec, true);
      writeAgentHookState(root, PROFILES.antigravity, denySpec, true);

      const claudeSettings = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      const antigravityHooks = readFileSync(
        join(root, ".agents", "hooks.json"),
        "utf-8",
      );

      assert.match(
        claudeSettings,
        /Policy hook unavailable: git repository root unavailable\./u,
      );
      assert.doesNotMatch(claudeSettings, /Guard.*git repository root/u);
      assert.match(
        antigravityHooks,
        /Policy hook unavailable: git repository root unavailable\./u,
      );
      assert.doesNotMatch(antigravityHooks, /Guard.*git repository root/u);
    });
  });

  it("generated Claude launchers resolve worktrees, submodules, bare repos, and outside-repo cwd", () => {
    withTempProject((root) => {
      const main = join(root, "main");
      const worktree = join(root, "main-worktree");
      mkdirSync(main, { recursive: true });
      runGit(main, ["init", "-q"]);
      writeFileSync(join(main, "README.md"), "# main\n");
      writeFileSync(join(main, ".gitignore"), ".claude/\n.goat-flow/\n");
      commitAll(main, "initial main");

      const mainLauncher = installClaudeDenyHook(main);
      assert.match(
        mainLauncher,
        /\/\*\|\[A-Za-z\]:\/\*\|\[A-Za-z\]:\\\\\*\)/u,
        "launcher should treat Windows drive-letter git-common-dir paths as absolute",
      );
      assert.match(
        mainLauncher,
        /\$\{gcd\/\/\\\\\/\/\}/u,
        "launcher should normalize defensive backslash drive paths before dirname",
      );
      runGit(main, [
        "worktree",
        "add",
        "-q",
        "-b",
        "fixture-worktree",
        worktree,
      ]);

      assert.equal(
        existsSync(join(worktree, ".claude", "hooks", "deny-dangerous.sh")),
        false,
        "worktree fixture should prove hooks exist only in the main checkout",
      );
      assert.match(
        runGit(worktree, ["rev-parse", "--git-common-dir"]),
        /\.git$/u,
      );
      assertLauncherAllows(mainLauncher, worktree);

      const subSource = join(root, "sub-source");
      mkdirSync(subSource, { recursive: true });
      runGit(subSource, ["init", "-q"]);
      writeFileSync(join(subSource, "README.md"), "# submodule\n");
      const sourceLauncher = installClaudeDenyHook(subSource);
      assert.match(
        sourceLauncher,
        /\.git\/modules/u,
        "launcher carries submodule branch",
      );
      commitAll(subSource, "initial submodule");

      const parent = join(root, "parent");
      mkdirSync(parent, { recursive: true });
      runGit(parent, ["init", "-q"]);
      writeFileSync(join(parent, "README.md"), "# parent\n");
      commitAll(parent, "initial parent");
      runGit(parent, [
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "-q",
        subSource,
        "sub",
      ]);
      commitAll(parent, "add submodule");

      const subWorktree = join(parent, "sub");
      const subLauncher = readClaudeDenyLauncher(subWorktree);
      assert.match(
        runGit(subWorktree, ["rev-parse", "--git-common-dir"]),
        /\.git\/modules\/sub$/u,
      );
      assert.equal(
        runGit(subWorktree, ["rev-parse", "--show-toplevel"]),
        subWorktree,
      );
      assertLauncherAllows(subLauncher, subWorktree);

      const bare = join(root, "bare.git");
      runGit(root, ["init", "--bare", "-q", bare]);
      const bareResult = runClaudeLauncher(mainLauncher, bare);
      assert.equal(bareResult.status, 2);
      assert.match(bareResult.stderr, /Policy hook unavailable/u);
      assert.doesNotMatch(bareResult.stderr, /No such file or directory/u);

      const scratch = join(root, "scratch");
      mkdirSync(scratch, { recursive: true });
      const withEnv = { ...process.env, CLAUDE_PROJECT_DIR: main };
      const scratchAllowed = runClaudeLauncher(
        mainLauncher,
        scratch,
        CLAUDE_SAFE_PAYLOAD,
        withEnv,
      );
      assert.equal(scratchAllowed.status, 0);
      const scratchBlocked = runClaudeLauncher(
        mainLauncher,
        scratch,
        CLAUDE_DANGEROUS_PAYLOAD,
        withEnv,
      );
      assert.equal(scratchBlocked.status, 2);
      assert.match(scratchBlocked.stderr, /BLOCKED: Policy/u);
      const withoutEnv = runClaudeLauncher(mainLauncher, scratch);
      assert.equal(withoutEnv.status, 2);
      assert.match(withoutEnv.stderr, /Policy hook unavailable/u);
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
        ".goat-flow/hooks/deny-dangerous.sh",
        ".goat-flow/hooks/deny-dangerous/patterns-shell.sh",
        ".goat-flow/hooks/deny-dangerous/patterns-paths.sh",
        ".goat-flow/hooks/deny-dangerous/patterns-writes.sh",
        ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
      ]);
      assertMissing(root, [
        ".claude/settings.json",
        ".agents/hooks.json",
        ".github/hooks/hooks.json",
      ]);
      assert.match(
        readFileSync(join(root, ".codex", "hooks.json"), "utf-8"),
        /deny-dangerous\.sh/u,
      );
    });
  });

  it("unignores hooks when enabling deny-dangerous on a stale goat-flow gitignore", () => {
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
      assert.match(gitignore, /^!hooks\/$/m);
      assert.match(gitignore, /^!hooks\/\*\*$/m);
    });
  });

  it("does not treat shared AGENTS.md surfaces as a Codex or Antigravity opt-in", () => {
    withTempProject((root) => {
      writeFileSync(join(root, "AGENTS.md"), "# Local agent instructions\n");
      mkdirSync(join(root, ".agents", "skills"), { recursive: true });

      applyHookState(HOOK_ID, true, root);

      assertMissing(root, [
        ".codex/hooks.json",
        ".goat-flow/hooks/deny-dangerous.sh",
        ".agents/hooks.json",
        ".goat-flow/hooks/deny-dangerous.sh",
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
        ".goat-flow/hooks/gruff-code-quality.sh",
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
