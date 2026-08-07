/**
 * How hooks arrive on disk: newer installed copies are never overwritten, stale timeouts
 * read as uninstalled, and the generated launchers resolve the correct repo root from
 * worktrees, submodules, and outside-repo working directories.
 * Every case builds a real project and reads back what the registrar actually wrote.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import {
  readAgentHookState,
  writeAgentHookState,
} from "../../src/cli/server/agent-hook-writer.js";
import {
  applyHookState,
  HookRegistrarError,
  syncHookStates,
} from "../../src/cli/server/hook-registrar.js";
import {
  getHookSpec,
  isValidHookIdShape,
  listHookSpecs,
} from "../../src/cli/server/hooks-registry.js";
import {
  discoverWindowsBashCandidates as discoverHookWindowsBashCandidates,
  pickWindowsBashPath as pickHookWindowsBashPath,
} from "../../workflow/hooks/run-with-bash.mjs";

import {
  HOOK_IDENTIFIER,
  CLAUDE_SAFE_PAYLOAD,
  CLAUDE_DANGEROUS_PAYLOAD,
  withTempProject,
  runGit,
  commitAll,
  readClaudeDenyLauncher,
  readCodexDenyLauncher,
  installClaudeDenyHook,
  readClaudeGruffCommands,
  readAntigravityGruffCommand,
  runClaudeLauncher,
  assertLauncherAllows,
  runCodexLauncher,
} from "./hook-registrar.helpers.js";

describe("hook registrar: launchers and installation", () => {
  /** Proves installed hooks can find default Git Bash when PATH exposes only WSL. */
  it("finds default Git Bash for hooks when PATH exposes only the WSL shim", () => {
    const defaultGitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
    const candidates = discoverHookWindowsBashCandidates({
      environment: { ProgramFiles: "C:\\Program Files" },
      pathExists: (candidate: string) => candidate === defaultGitBash,
      runWhere: (executable: string) =>
        executable === "bash" ? ["C:\\Windows\\System32\\bash.exe"] : [],
    });

    assert.equal(pickHookWindowsBashPath(candidates), defaultGitBash);
  });

  it("refuses to overwrite a hook stamped newer than the running CLI", () => {
    withTempProject((root) => {
      const hookDir = join(root, ".goat-flow", "hooks");
      const hookPath = join(hookDir, "deny-dangerous.sh");
      const futureHook =
        "#!/usr/bin/env bash\n# goat-flow-hook-version: 999.0.0\n";
      mkdirSync(join(root, ".codex"), { recursive: true });
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(join(root, ".codex", "config.toml"), "\n");
      writeFileSync(hookPath, futureHook);

      assert.throws(
        () => syncHookStates(root),
        (error: unknown) => {
          assert.ok(error instanceof HookRegistrarError);
          assert.equal(error.statusCode, 409);
          assert.match(error.message, /Refusing to overwrite/u);
          assert.match(error.message, new RegExp(`CLI \\(${AUDIT_VERSION}\\)`));
          return true;
        },
      );
      assert.equal(readFileSync(hookPath, "utf-8"), futureHook);
      assert.equal(existsSync(join(root, ".codex", "hooks.json")), false);
    });
  });

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
      assert.match(mainLauncher, /run-with-bash\.mjs/u);
      assert.match(mainLauncher, /--show-toplevel/u);
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
      assert.match(sourceLauncher, /run-with-bash\.mjs/u);
      assert.match(sourceLauncher, /--show-toplevel/u);
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
      assert.match(launcher, /run-with-bash\.mjs/u);
      assert.match(launcher, /--show-toplevel/u);
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
});

describe("hook launcher script validation", () => {
  const LAUNCHER = resolve(
    import.meta.dirname,
    "..",
    "..",
    "workflow",
    "hooks",
    "run-with-bash.mjs",
  );

  /** Run the canonical launcher exactly as agent configs do: a child process rooted in the project. */
  function runLauncherProcess(root: string, scriptRel: string) {
    return spawnSync(process.execPath, [LAUNCHER, scriptRel, "policy"], {
      cwd: root,
      encoding: "utf8" as const,
    });
  }

  /** Create the managed hooks directory inside a fixture project. */
  function makeHookDir(root: string): string {
    const hookDir = join(root, ".goat-flow", "hooks");
    mkdirSync(hookDir, { recursive: true });
    return hookDir;
  }

  /** Diagnostic string so a failing launcher assertion names both streams. */
  function launcherDiagnostics(
    result: ReturnType<typeof runLauncherProcess>,
  ): string {
    return `status=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
  }

  it("fails closed when the managed hook script is a symlink", () => {
    withTempProject((root) => {
      const hookDir = makeHookDir(root);
      const redirectTarget = join(root, "innocent-looking.sh");
      writeFileSync(redirectTarget, "#!/usr/bin/env bash\nexit 0\n");
      symlinkSync(redirectTarget, join(hookDir, "deny-dangerous.sh"));

      const result = runLauncherProcess(
        root,
        ".goat-flow/hooks/deny-dangerous.sh",
      );
      assert.equal(result.status, 2, launcherDiagnostics(result));
      assert.match(result.stderr, /BLOCKED: Policy hook unavailable/u);
      assert.match(result.stderr, /symlink/u);
    });
  });

  it("fails closed when the managed hook path is not a regular file", () => {
    withTempProject((root) => {
      const hookDir = makeHookDir(root);
      mkdirSync(join(hookDir, "deny-dangerous.sh"));

      const result = runLauncherProcess(
        root,
        ".goat-flow/hooks/deny-dangerous.sh",
      );
      assert.equal(result.status, 2, launcherDiagnostics(result));
      assert.match(result.stderr, /BLOCKED: Policy hook unavailable/u);
      assert.match(result.stderr, /regular file/u);
    });
  });

  it("fails closed when the managed hook script has extra hard links", () => {
    withTempProject((root) => {
      const hookDir = makeHookDir(root);
      const scriptPath = join(hookDir, "deny-dangerous.sh");
      writeFileSync(scriptPath, "#!/usr/bin/env bash\nexit 0\n");
      linkSync(scriptPath, join(root, "second-name.sh"));

      const result = runLauncherProcess(
        root,
        ".goat-flow/hooks/deny-dangerous.sh",
      );
      assert.equal(result.status, 2, launcherDiagnostics(result));
      assert.match(result.stderr, /BLOCKED: Policy hook unavailable/u);
      assert.match(result.stderr, /hard link/u);
    });
  });

  it("fails closed when a symlinked parent directory escapes the project root", () => {
    withTempProject((root) => {
      const outsideHooks = mkdtempSync(join(tmpdir(), "goat-flow-outside-"));
      try {
        writeFileSync(
          join(outsideHooks, "deny-dangerous.sh"),
          "#!/usr/bin/env bash\nexit 0\n",
        );
        mkdirSync(join(root, ".goat-flow"), { recursive: true });
        symlinkSync(outsideHooks, join(root, ".goat-flow", "hooks"));

        const result = runLauncherProcess(
          root,
          ".goat-flow/hooks/deny-dangerous.sh",
        );
        assert.equal(result.status, 2, launcherDiagnostics(result));
        assert.match(result.stderr, /BLOCKED: Policy hook unavailable/u);
        assert.match(result.stderr, /escaped the project root/u);
      } finally {
        rmSync(outsideHooks, { recursive: true, force: true });
      }
    });
  });
});

describe("hook registrar: unrelated hook preservation", () => {
  it("preserves user hooks whose names merely contain a managed script name", () => {
    withTempProject((root) => {
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
                      command: "bash .claude/hooks/custom-post-turn-safety.sh",
                      timeout: 30,
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

      applyHookState("post-turn-safety", true, root);
      const afterEnable = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      assert.match(
        afterEnable,
        /custom-post-turn-safety\.sh/u,
        "managed registration must not claim the user's similarly named hook",
      );

      applyHookState("post-turn-safety", false, root);
      const afterDisable = readFileSync(
        join(root, ".claude", "settings.json"),
        "utf-8",
      );
      assert.match(
        afterDisable,
        /custom-post-turn-safety\.sh/u,
        "managed removal must not delete the user's similarly named hook",
      );
    });
  });
});
