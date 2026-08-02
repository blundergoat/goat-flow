/**
 * Unit tests for dashboard hook registration, drift detection, and script materialization.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
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

const HOOK_IDENTIFIER = "deny-dangerous";
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

/** Spawns a git command in a fixture project and fails with stdout/stderr context. */
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

/** Read the first generated Claude deny launcher because hook arrays are nested by event and matcher. */
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

/** Read the first generated Codex deny launcher because hook arrays are nested by event and matcher. */
function readCodexDenyLauncher(root: string): string {
  const settings = readCodexHookConfig(root) as {
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

/** Read generated Codex hook config for event-key assertions. */
function readCodexHookConfig(root: string): unknown {
  return JSON.parse(
    readFileSync(join(root, ".codex", "hooks.json"), "utf-8"),
  ) as unknown;
}

/** Assert generated Codex output stays within goat-flow's current supported surface. */
function assertCodexPreToolUseOnly(root: string): void {
  const hooksJson = readFileSync(join(root, ".codex", "hooks.json"), "utf-8");
  const config = JSON.parse(hooksJson) as {
    hooks?: Record<string, unknown>;
  };
  assert.ok(
    Array.isArray(config.hooks?.PreToolUse),
    "Codex should retain PreToolUse hooks",
  );
  assert.deepEqual(
    Object.keys(config.hooks ?? {}),
    ["PreToolUse"],
    `Codex goat-flow output should be PreToolUse-only; got ${hooksJson}`,
  );
  assert.match(hooksJson, /deny-dangerous\.sh/u);
  assert.doesNotMatch(hooksJson, /PostToolUse/u);
  assert.doesNotMatch(hooksJson, /Stop/u);
  assert.doesNotMatch(hooksJson, /gruff-code-quality\.sh/u);
  assert.doesNotMatch(hooksJson, /post-turn-safety\.sh/u);
}

/** Writes a Claude hook-capable fixture and return the generated deny launcher. */
function installClaudeDenyHook(root: string): string {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
  applyHookState(HOOK_IDENTIFIER, true, root);
  return readClaudeDenyLauncher(root);
}

type GeneratedHookEntry = { hooks?: Array<{ command?: string }> };

/** Flatten generated hook entries into command strings for fixture assertions. */
function generatedHookCommands(entries: GeneratedHookEntry[] = []): string[] {
  return entries.flatMap(({ hooks = [] }) =>
    hooks.map(({ command = "" }) => command),
  );
}

/** Read generated Claude gruff hook commands because settings nest hooks by event and matcher. */
function readClaudeGruffCommands(settingsJson: string): string[] {
  const config = JSON.parse(settingsJson) as {
    hooks?: {
      PostToolUse?: GeneratedHookEntry[];
    };
  };
  return generatedHookCommands(config.hooks?.PostToolUse);
}

/** Read the generated Antigravity gruff hook command because hooks are grouped by hook id. */
function readAntigravityGruffCommand(hooksJson: string): string {
  const config = JSON.parse(hooksJson) as {
    "gruff-code-quality"?: {
      PostToolUse?: GeneratedHookEntry[];
    };
  };
  return (
    generatedHookCommands(config["gruff-code-quality"]?.PostToolUse)[0] ?? ""
  );
}

/** Read matcherless Stop hook commands from Claude/Codex-style hook config. */
function readStopHookCommands(settingsJson: string): string[] {
  const config = JSON.parse(settingsJson) as {
    hooks?: {
      Stop?: GeneratedHookEntry[];
    };
  };
  return generatedHookCommands(config.hooks?.Stop);
}

/** Read one generated Antigravity Stop hook command by goat-flow hook id. */
function readAntigravityStopCommand(hooksJson: string, hookId: string): string {
  const config = JSON.parse(hooksJson) as Record<
    string,
    { Stop?: GeneratedHookEntry[] } | undefined
  >;
  return generatedHookCommands(config[hookId]?.Stop)[0] ?? "";
}

/** Read the generated Antigravity post-turn safety command. */
function readAntigravitySafetyCommand(hooksJson: string): string {
  return readAntigravityStopCommand(hooksJson, "post-turn-safety");
}

/** Writes agent surfaces that make post-turn hook registration applicable in a fixture. */
function writePostTurnCapableSurfaces(root: string): void {
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, ".codex"), { recursive: true });
  mkdirSync(join(root, ".agents"), { recursive: true });
  mkdirSync(join(root, ".github", "hooks"), { recursive: true });
  mkdirSync(join(root, ".goat-flow"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
  writeFileSync(join(root, ".codex", "config.toml"), "\n");
  writeFileSync(join(root, ".agents", "hooks.json"), "{}\n");
  writeFileSync(join(root, ".github", "hooks", "hooks.json"), "{}\n");
}

/** Execute the generated Claude launcher with a runtime-shaped payload. */
function runLauncherWithPayload(
  command: string,
  cwd: string,
  payload: string,
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof spawnSync> {
  const payloadPath = join(
    tmpdir(),
    `goat-flow-hook-payload-${process.pid}-${Date.now()}.json`,
  );
  writeFileSync(payloadPath, payload);
  const fd = openSync(payloadPath, "r");
  try {
    return spawnSync("bash", ["-c", command], {
      cwd,
      encoding: "utf8",
      env,
      stdio: [fd, "pipe", "pipe"],
    });
  } finally {
    closeSync(fd);
    rmSync(payloadPath, { force: true });
  }
}

/** Execute the generated Claude launcher with a runtime-shaped payload. */
function runClaudeLauncher(
  command: string,
  cwd: string,
  payload = CLAUDE_SAFE_PAYLOAD,
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof spawnSync> {
  return runLauncherWithPayload(command, cwd, payload, env);
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

/** Execute the generated Codex launcher with a runtime-shaped payload. */
function runCodexLauncher(
  command: string,
  cwd: string,
  payload = CLAUDE_SAFE_PAYLOAD,
): ReturnType<typeof spawnSync> {
  return runLauncherWithPayload(command, cwd, payload);
}

describe("hook registrar", () => {
  // Writes a stale timeout because dashboard state must stay off until sync replaces it.
  it("treats a stale Claude hook timeout as uninstalled", () => {
    withTempProject((root) => {
      const postTurnSafetySpec = getHookSpec("post-turn-safety");
      assert.ok(postTurnSafetySpec);
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(
        join(root, ".claude", "settings.json"),
        `${JSON.stringify(
          {
            hooks: {
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/post-turn-safety.sh",
                      timeout: 60,
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const staleTimeoutState = readAgentHookState(
        root,
        PROFILES.claude,
        postTurnSafetySpec,
      );
      assert.equal(staleTimeoutState.installed, false);

      writeAgentHookState(root, PROFILES.claude, postTurnSafetySpec, true);
      const repairedTimeoutState = readAgentHookState(
        root,
        PROFILES.claude,
        postTurnSafetySpec,
      );
      assert.equal(repairedTimeoutState.installed, true);
      assert.match(
        readFileSync(join(root, ".claude", "settings.json"), "utf-8"),
        /"timeout": 90/u,
      );
    });
  });

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
      assert.equal(getHookSpec("plan-checkbox-guard"), null);
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
      writeAgentHookState(root, PROFILES.antigravity, gruffSpec, true);

      const claudeSettings = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      const antigravityHooks = readFileSync(
        join(root, ".agents", "hooks.json"),
        "utf-8",
      );
      const claudeGruffCommands = readClaudeGruffCommands(claudeSettings);
      const antigravityGruffCommand =
        readAntigravityGruffCommand(antigravityHooks);

      // every() on an empty list passes vacuously; require commands first.
      assert.ok(
        claudeGruffCommands.length > 0,
        "expected generated Claude gruff commands",
      );
      assert.match(
        claudeSettings,
        /Policy hook unavailable: git repository root unavailable\./u,
      );
      assert.ok(
        claudeGruffCommands.every((command) =>
          command.includes("gruff-code-quality: hook unavailable"),
        ),
      );
      assert.ok(
        claudeGruffCommands.every(
          (command) => !command.includes("BLOCKED: Policy hook unavailable"),
        ),
      );
      assert.doesNotMatch(claudeSettings, /Guard.*git repository root/u);
      assert.match(
        antigravityHooks,
        /Policy hook unavailable: git repository root unavailable\./u,
      );
      assert.match(
        antigravityGruffCommand,
        /gruff-code-quality: hook unavailable/u,
      );
      assert.doesNotMatch(antigravityGruffCommand, /"decision":"deny"/u);
      assert.doesNotMatch(antigravityHooks, /Guard.*git repository root/u);
    });
  });

  it("generated Claude launchers resolve active worktrees, submodules, bare repos, and outside-repo cwd", () => {
    withTempProject((root) => {
      const main = join(root, "main");
      const worktree = join(root, "main-worktree");
      mkdirSync(main, { recursive: true });
      runGit(main, ["init", "-q"]);
      writeFileSync(join(main, "README.md"), "# main\n");
      writeFileSync(join(main, ".gitignore"), ".claude/\n");
      commitAll(main, "initial main");

      const mainLauncher = installClaudeDenyHook(main);
      commitAll(main, "install central hooks");
      assert.match(mainLauncher, /git rev-parse --show-toplevel/u);
      assert.doesNotMatch(mainLauncher, /git-common-dir/u);
      runGit(main, [
        "worktree",
        "add",
        "-q",
        "-b",
        "fixture-worktree",
        worktree,
      ]);

      assert.equal(
        existsSync(join(worktree, ".goat-flow", "hooks", "deny-dangerous.sh")),
        true,
        "worktree fixture should prove central hooks exist in the active checkout",
      );
      assert.match(
        runGit(worktree, ["rev-parse", "--show-toplevel"]),
        /main-worktree$/u,
      );
      assertLauncherAllows(mainLauncher, worktree);

      const subSource = join(root, "sub-source");
      mkdirSync(subSource, { recursive: true });
      runGit(subSource, ["init", "-q"]);
      writeFileSync(join(subSource, "README.md"), "# submodule\n");
      const sourceLauncher = installClaudeDenyHook(subSource);
      assert.match(sourceLauncher, /git rev-parse --show-toplevel/u);
      assert.doesNotMatch(sourceLauncher, /git-common-dir/u);
      commitAll(subSource, "initial submodule with central hooks");

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

  it("generated Codex launchers resolve the active root without Claude env fallback", () => {
    withTempProject((root) => {
      runGit(root, ["init", "-q"]);
      writeFileSync(join(root, "README.md"), "# codex fixture\n");
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "\n");

      applyHookState(HOOK_IDENTIFIER, true, root);

      const launcher = readCodexDenyLauncher(root);
      assert.match(launcher, /git rev-parse --show-toplevel/u);
      assert.match(launcher, /cd "\$root"/u);
      assert.doesNotMatch(launcher, /CLAUDE_PROJECT_DIR/u);
      assert.doesNotMatch(launcher, /^\.goat-flow\/hooks/u);

      const nested = join(root, "src", "cli");
      mkdirSync(nested, { recursive: true });
      const safe = runCodexLauncher(launcher, nested);
      assert.equal(
        safe.status,
        0,
        `Codex launcher should allow benign payload from nested cwd\nstdout:\n${safe.stdout}\nstderr:\n${safe.stderr}`,
      );

      const blocked = runCodexLauncher(
        launcher,
        nested,
        CLAUDE_DANGEROUS_PAYLOAD,
      );
      assert.equal(blocked.status, 2);
      assert.match(blocked.stderr, /BLOCKED: Policy/u);
    });
  });

  it("does not scaffold uninstalled agent surfaces on clean target toggles", () => {
    withTempProject((root) => {
      applyHookState(HOOK_IDENTIFIER, false, root);

      assertMissing(root, GENERATED_AGENT_SURFACES);
    });

    withTempProject((root) => {
      applyHookState(HOOK_IDENTIFIER, true, root);

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

      applyHookState(HOOK_IDENTIFIER, true, root);

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
      assertCodexPreToolUseOnly(root);
    });
  });

  it("keeps generated Codex hooks PreToolUse-only", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");

      const denyState = applyHookState(HOOK_IDENTIFIER, true, root);
      const gruffState = applyHookState("gruff-code-quality", true, root);
      const safetyState = applyHookState("post-turn-safety", true, root);

      assert.equal(denyState.agents.codex.supported, true);
      assert.equal(denyState.agents.codex.installed, true);
      assert.equal(gruffState.agents.codex.supported, false);
      assert.match(gruffState.agents.codex.reason ?? "", /PreToolUse-only/iu);
      assert.equal(safetyState.agents.codex.supported, false);
      assert.match(safetyState.agents.codex.reason ?? "", /unverified/iu);
      assertCodexPreToolUseOnly(root);
    });
  });

  // Covers a project with stale managed Codex entries: writes them, because an upgrade must prune them.
  it("prunes stale managed Codex post-tool and stop hook entries", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".codex"), { recursive: true });
      mkdirSync(join(root, ".goat-flow"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");
      writeFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "hooks:\n  gruff-code-quality:\n    enabled: true\n  post-turn-safety:\n    enabled: true\n",
      );
      writeFileSync(
        join(root, ".codex", "hooks.json"),
        `${JSON.stringify(
          {
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
              PostToolUse: [
                {
                  matcher: "Edit",
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/gruff-code-quality.sh",
                    },
                  ],
                },
                {
                  matcher: "Edit",
                  hooks: [
                    {
                      type: "command",
                      command: "bash ./custom-user-post-tool.sh",
                    },
                  ],
                },
              ],
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/post-turn-safety.sh",
                    },
                  ],
                },
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash ./custom-user-stop.sh",
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      syncHookStates(root);

      const hooksJson = readFileSync(
        join(root, ".codex", "hooks.json"),
        "utf-8",
      );
      assert.doesNotMatch(hooksJson, /gruff-code-quality\.sh/u);
      assert.doesNotMatch(hooksJson, /post-turn-safety\.sh/u);
      assert.match(hooksJson, /deny-dangerous\.sh/u);
      assert.match(hooksJson, /custom-user-post-tool\.sh/u);
      assert.match(hooksJson, /custom-user-stop\.sh/u);
    });
  });

  it("unignores hooks when enabling deny-dangerous on a stale goat-flow gitignore", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".codex"), { recursive: true });
      mkdirSync(join(root, ".goat-flow"), { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "");
      writeFileSync(join(root, ".goat-flow", ".gitignore"), "*\n!.gitignore\n");

      applyHookState(HOOK_IDENTIFIER, true, root);

      const gitignore = readFileSync(
        join(root, ".goat-flow", ".gitignore"),
        "utf-8",
      );
      assert.match(gitignore, /^!hooks\/$/m);
      assert.match(gitignore, /^!hooks\/\*\*$/m);
    });
  });

  it("rejects removed plan-checkbox-guard toggles without changing config", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".claude"), { recursive: true });
      mkdirSync(join(root, ".goat-flow"), { recursive: true });
      writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
      writeFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "hooks:\n  deny-dangerous:\n    enabled: true\n",
      );
      const before = readFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "utf-8",
      );

      assert.throws(
        () => applyHookState("plan-checkbox-guard", true, root),
        /Unknown hook: plan-checkbox-guard/u,
      );

      assert.equal(
        readFileSync(join(root, ".goat-flow", "config.yaml"), "utf-8"),
        before,
      );
      assertMissing(root, [
        ".goat-flow/hooks/plan-checkbox-guard.sh",
        ".claude/hooks/plan-checkbox-guard.sh",
      ]);
    });
  });

  it("sync installs the remaining post-turn safety hook without project validation", () => {
    withTempProject((root) => {
      writePostTurnCapableSurfaces(root);

      const states = syncHookStates(root);
      const safetyState = states.find(
        (state) => state.id === "post-turn-safety",
      );

      assert.ok(safetyState);
      assert.equal(
        states.some((state) => state.id === "post-turn-validate"),
        false,
      );
      assert.equal(
        states.some((state) => state.id === "plan-checkbox-guard"),
        false,
      );
      assert.equal(safetyState.enabled, true);
      assert.equal(safetyState.agents.claude.installed, true);
      assert.equal(safetyState.agents.codex.supported, false);
      assert.match(safetyState.agents.codex.reason ?? "", /unverified/iu);
      assert.equal(safetyState.agents.antigravity.supported, false);
      assert.match(safetyState.agents.antigravity.reason ?? "", /unverified/iu);
      assert.equal(safetyState.agents.copilot.supported, false);
      assertPresent(root, [
        ".claude/settings.json",
        ".codex/hooks.json",
        ".agents/hooks.json",
        ".goat-flow/hooks/post-turn-safety.sh",
      ]);
      assertMissing(root, [
        ".goat-flow/hooks/post-turn-validate.sh",
        ".goat-flow/hooks/plan-checkbox-guard.sh",
      ]);

      const claudeSettings = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      const codexHooks = readFileSync(
        join(root, ".codex", "hooks.json"),
        "utf-8",
      );
      const antigravityHooks = readFileSync(
        join(root, ".agents", "hooks.json"),
        "utf-8",
      );
      assert.match(
        readStopHookCommands(claudeSettings).join("\n"),
        /post-turn-safety\.sh/u,
      );
      assertCodexPreToolUseOnly(root);
      assert.equal(readAntigravitySafetyCommand(antigravityHooks), "");
      assert.doesNotMatch(claudeSettings, /post-turn-validate\.sh/u);
      assert.doesNotMatch(codexHooks, /post-turn-validate\.sh/u);
      assert.doesNotMatch(antigravityHooks, /post-turn-validate\.sh/u);
    });
  });

  // Covers sync pruning removed plan-checkbox-guard entries: writes stale config, because sync must clear it.
  it("sync prunes stale removed plan-checkbox-guard entries and config", () => {
    withTempProject((root) => {
      writePostTurnCapableSurfaces(root);
      mkdirSync(join(root, ".goat-flow", "hooks"), { recursive: true });
      writeFileSync(
        join(root, ".goat-flow", "hooks", "plan-checkbox-guard.sh"),
        "",
      );
      writeFileSync(
        join(root, ".goat-flow", ".gitignore"),
        "*\n!.gitignore\nlogs/plan-guard-state.json\n",
      );
      writeFileSync(
        join(root, ".goat-flow", "config.yaml"),
        [
          "hooks:",
          "  plan-checkbox-guard:",
          "    enabled: true",
          "  post-turn-safety:",
          "    enabled: true",
          "plan-guard:",
          "  enabled: true",
          "  search-paths:",
          "    - .goat-flow/plans",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(root, ".claude", "settings.json"),
        `${JSON.stringify(
          {
            hooks: {
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/plan-checkbox-guard.sh",
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(root, ".codex", "hooks.json"),
        `${JSON.stringify(
          {
            hooks: {
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/plan-checkbox-guard.sh",
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(root, ".agents", "hooks.json"),
        `${JSON.stringify(
          {
            "plan-checkbox-guard": {
              enabled: true,
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/plan-checkbox-guard.sh",
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(root, ".github", "hooks", "hooks.json"),
        `${JSON.stringify(
          {
            version: 1,
            hooks: {
              postToolUse: [
                {
                  type: "command",
                  bash: ".goat-flow/hooks/plan-checkbox-guard.sh",
                  powershell: "bash .goat-flow/hooks/plan-checkbox-guard.sh",
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const states = syncHookStates(root);

      const claudeSettings = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      const codexHooks = readFileSync(
        join(root, ".codex", "hooks.json"),
        "utf-8",
      );
      const antigravityHooks = readFileSync(
        join(root, ".agents", "hooks.json"),
        "utf-8",
      );
      const copilotHooks = readFileSync(
        join(root, ".github", "hooks", "hooks.json"),
        "utf-8",
      );
      const config = readFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "utf-8",
      );
      const gitignore = readFileSync(
        join(root, ".goat-flow", ".gitignore"),
        "utf-8",
      );
      assert.equal(
        states.some((state) => state.id === "plan-checkbox-guard"),
        false,
      );
      assert.doesNotMatch(claudeSettings, /plan-checkbox-guard\.sh/u);
      assert.doesNotMatch(codexHooks, /plan-checkbox-guard\.sh/u);
      assert.doesNotMatch(antigravityHooks, /plan-checkbox-guard\.sh/u);
      assert.doesNotMatch(copilotHooks, /plan-checkbox-guard\.sh/u);
      assert.doesNotMatch(config, /plan-checkbox-guard|plan-guard/u);
      assert.doesNotMatch(gitignore, /plan-guard-state/u);
      assertMissing(root, [".goat-flow/hooks/plan-checkbox-guard.sh"]);
      assert.doesNotMatch(codexHooks, /post-turn-safety\.sh/u);
      assert.equal(readAntigravitySafetyCommand(antigravityHooks), "");
    });
  });

  // Covers the same prune driven by a direct toggle: writes stale config, because a toggle must clear it too.
  it("direct hook toggles prune stale removed plan-checkbox-guard entries and config", () => {
    withTempProject((root) => {
      writePostTurnCapableSurfaces(root);
      mkdirSync(join(root, ".goat-flow", "hooks"), { recursive: true });
      writeFileSync(
        join(root, ".goat-flow", "hooks", "plan-checkbox-guard.sh"),
        "",
      );
      writeFileSync(
        join(root, ".goat-flow", "config.yaml"),
        [
          "hooks:",
          "  plan-checkbox-guard:",
          "    enabled: true",
          "plan-guard:",
          "  enabled: true",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(root, ".claude", "settings.json"),
        `${JSON.stringify(
          {
            hooks: {
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "bash .goat-flow/hooks/plan-checkbox-guard.sh",
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const safetyState = applyHookState("post-turn-safety", true, root);

      const claudeSettings = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      const config = readFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "utf-8",
      );
      assert.equal(safetyState.id, "post-turn-safety");
      assert.match(claudeSettings, /post-turn-safety\.sh/u);
      assert.doesNotMatch(claudeSettings, /plan-checkbox-guard\.sh/u);
      assert.doesNotMatch(config, /plan-checkbox-guard|plan-guard/u);
      assertMissing(root, [".goat-flow/hooks/plan-checkbox-guard.sh"]);
    });
  });

  it("does not treat shared AGENTS.md surfaces as a Codex or Antigravity opt-in", () => {
    withTempProject((root) => {
      writeFileSync(join(root, "AGENTS.md"), "# Local agent instructions\n");
      mkdirSync(join(root, ".agents", "skills"), { recursive: true });

      applyHookState(HOOK_IDENTIFIER, true, root);

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

      applyHookState(HOOK_IDENTIFIER, false, root);

      assertMissing(root, [
        ".claude/settings.json",
        ".claude/hooks/guard-common.sh",
        ".claude/hooks/guard-secret-paths.sh",
      ]);
    });
  });
});
