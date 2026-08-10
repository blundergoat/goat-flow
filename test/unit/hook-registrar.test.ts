/**
 * How hooks arrive on disk: newer installed copies are never overwritten, stale timeouts
 * read as uninstalled, and the generated launchers resolve the correct repo root from
 * worktrees, submodules, and outside-repo working directories.
 * Every case builds a real project and reads back what the registrar actually wrote.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  installCodexDenyHook,
  readClaudeGruffCommands,
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
      const gruffSpec = getHookSpec("gruff-code-quality");
      assert.equal(gruffSpec?.matcher, "Edit|Write|Bash");
      assert.equal(
        gruffSpec?.deliveryContract?.resultProtocol,
        "goat-flow.hook-result.v1",
      );
      assert.equal(
        gruffSpec?.scriptFiles.includes("hook-provider-adapters.mjs"),
        true,
      );
      assert.match(
        gruffSpec?.unsupportedAgents?.antigravity ?? "",
        /cannot deliver Gruff feedback/u,
      );
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
      writeAgentHookState(root, PROFILES.copilot, denySpec, true);

      const claudeSettings = readFileSync(
        join(root, ".claude", "settings.json"),
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
      const claudeGruffCommands = readClaudeGruffCommands(claudeSettings);

      // every() on an empty list passes vacuously; require commands first.
      assert.ok(
        claudeGruffCommands.length > 0,
        "expected generated Claude gruff commands",
      );
      assert.match(claudeSettings, /Policy hook unavailable:/u);
      assert.match(claudeSettings, /managed root unavailable/u);
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
      assert.match(antigravityHooks, /Policy hook unavailable:/u);
      assert.match(antigravityHooks, /managed root unavailable/u);
      assert.doesNotMatch(antigravityHooks, /gruff-code-quality/u);
      assert.doesNotMatch(antigravityHooks, /Guard.*git repository root/u);
      assert.match(antigravityHooks, /"timeout": 30/u);
      assert.match(copilotHooks, /"timeoutSec": 30/u);
      const expectedFeedbackTimeoutSeconds = 90;
      assert.equal(gruffSpec.timeoutSec, expectedFeedbackTimeoutSeconds);
      assert.equal(
        getHookSpec("post-turn-safety")?.timeoutSec,
        expectedFeedbackTimeoutSeconds,
      );
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
      installClaudeDenyHook(worktree);
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

  it("launches the real guard from a managed non-Git root", () => {
    withTempProject((root) => {
      const launcher = installCodexDenyHook(root);
      assert.equal(runCodexLauncher(launcher, root).status, 0);
      const nested = join(root, "packages", "app");
      mkdirSync(nested, { recursive: true });

      const safe = runCodexLauncher(launcher, nested);
      assert.equal(safe.status, 0, `${safe.stdout}\n${safe.stderr}`);
      const blocked = runCodexLauncher(
        launcher,
        nested,
        CLAUDE_DANGEROUS_PAYLOAD,
      );
      assert.equal(blocked.status, 2, `${blocked.stdout}\n${blocked.stderr}`);
      assert.match(blocked.stderr, /BLOCKED: Policy/u);
    });
  });

  it("selects Git first, then the nearest complete managed ancestor", () => {
    withTempProject((root) => {
      const outerLauncher = installCodexDenyHook(root);
      const nestedGit = join(root, "workspace", "plain-git");
      mkdirSync(nestedGit, { recursive: true });
      runGit(nestedGit, ["init", "-q"]);
      const outerResult = runCodexLauncher(outerLauncher, nestedGit);
      assert.equal(
        outerResult.status,
        0,
        `${outerResult.stdout}\n${outerResult.stderr}`,
      );

      const inner = join(root, "workspace", "managed-inner");
      const innerLauncher = installCodexDenyHook(inner);
      assert.equal(typeof innerLauncher, "string");
      writeFileSync(
        join(inner, ".goat-flow", "hooks", "deny-dangerous.sh"),
        "#!/usr/bin/env bash\nprintf 'INNER_MANAGED_ROOT\\n'\n",
      );
      const innerCwd = join(inner, "src");
      mkdirSync(innerCwd, { recursive: true });
      const innerResult = runCodexLauncher(outerLauncher, innerCwd);
      assert.equal(
        innerResult.status,
        0,
        `${innerResult.stdout}\n${innerResult.stderr}`,
      );
      assert.equal(innerResult.stdout, "INNER_MANAGED_ROOT\n");
    });
  });

  /**
   * Fixture purpose: contrasts an unrelated config with a partial managed root the user must fix.
   * Writes both disposable layouts, then starts the launcher to show which one blocks the user.
   */
  it("skips unrelated configs but stops at a partial managed trace", () => {
    withTempProject((root) => {
      const launcher = installCodexDenyHook(root);
      const unrelated = join(root, "unrelated");
      // Fixture purpose: a user's unrelated agent config must not claim a managed goat-flow root.
      mkdirSync(join(unrelated, ".codex"), { recursive: true });
      writeFileSync(
        join(unrelated, ".codex", "hooks.json"),
        '{"hooks":{"PreToolUse":[{"command":"custom-tool"}]}}\n',
      );
      mkdirSync(join(unrelated, ".goat-flow", "hooks"), { recursive: true });
      writeFileSync(
        join(unrelated, ".goat-flow", "hooks", "run-with-bash.mjs"),
        "// launcher for a different managed hook\n",
      );
      const unrelatedResult = runCodexLauncher(launcher, unrelated);
      assert.equal(
        unrelatedResult.status,
        0,
        `${unrelatedResult.stdout}\n${unrelatedResult.stderr}`,
      );

      const partial = join(root, "partial");
      mkdirSync(join(partial, ".goat-flow", "hooks"), { recursive: true });
      writeFileSync(
        join(partial, ".goat-flow", "hooks", "deny-dangerous.sh"),
        "#!/usr/bin/env bash\nexit 0\n",
      );
      const partialResult = runCodexLauncher(launcher, partial);
      assert.equal(
        partialResult.status,
        2,
        `${partialResult.stdout}\n${partialResult.stderr}`,
      );
      assert.match(partialResult.stderr, /managed root incomplete/iu);
      assert.doesNotMatch(partialResult.stderr, new RegExp(root, "u"));
    });
  });

  /**
   * Fixture purpose: captures the exact user payload and verified working directory seen by a hook.
   * Writes capture files and starts the launcher inside a disposable project.
   */
  it("forwards stdin unchanged and gives the hook the verified root cwd", () => {
    withTempProject((root) => {
      const launcher = installCodexDenyHook(root);
      const payloadPath = join(root, "captured-payload.txt");
      const cwdPath = join(root, "captured-cwd.txt");
      // Fixture purpose: capture the exact user payload and working directory seen by the hook.
      writeFileSync(
        join(root, ".goat-flow", "hooks", "deny-dangerous.sh"),
        [
          "#!/usr/bin/env bash",
          'cat > "$GOAT_FLOW_TEST_PAYLOAD_PATH"',
          'pwd > "$GOAT_FLOW_TEST_CWD_PATH"',
          "",
        ].join("\n"),
      );
      const nested = join(root, "deep", "cwd");
      mkdirSync(nested, { recursive: true });
      const payload = '{"raw":"line one\\nline two 🐐"}\n';
      const result = runCodexLauncher(launcher, nested, payload, {
        ...process.env,
        GOAT_FLOW_TEST_PAYLOAD_PATH: payloadPath,
        GOAT_FLOW_TEST_CWD_PATH: cwdPath,
      });

      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(readFileSync(payloadPath, "utf8"), payload);
      assert.equal(readFileSync(cwdPath, "utf8").trim(), root);
    });
  });
});
