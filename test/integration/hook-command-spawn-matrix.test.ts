/**
 * Executes the registered Claude exec-form handlers exactly as the provider spawns them: benign and blocked
 * payloads from hostile-named projects, then every catchable managed-file failure mapped to its provider response.
 *
 * Windows CI runs this file at the package-minimum Node to lock ADR-053.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { agentHookSpawnDescriptor } from "../../src/cli/server/agent-hook-command.js";
import { writeAgentHookState } from "../../src/cli/server/agent-hook-writer.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";
import {
  FINDING_GRUFF_CONTRACT_ENVELOPE,
  writeContractGruffBinary,
} from "./gruff-code-quality-smoke.helpers.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const WORKFLOW_HOOKS = join(PROJECT_ROOT, "workflow", "hooks");
const SHARED_HOOK_FILES = [
  "run-with-bash.mjs",
  "hook-launch-runtime.mjs",
  "hook-provider-adapters.mjs",
  "deny-dangerous.sh",
  "gruff-code-quality.sh",
  "post-turn-safety.sh",
];
const DENY_POLICY_FILES = [
  "patterns-shell.sh",
  "patterns-paths.sh",
  "patterns-writes.sh",
  "deny-dangerous-self-test.sh",
];
/** Secret canary that must never appear in any handler stream. */
const ENV_CANARY = "goat-flow-canary";

const disposableParents: string[] = [];

/** Remove every fixture tree after the suite so hostile-named roots never linger. */
after(() => {
  // Each recorded parent is a suite-owned temporary directory, never a user workspace.
  for (const disposableParent of disposableParents) {
    rmSync(disposableParent, { recursive: true, force: true });
  }
});

/** One registered exec-form handler: the executable plus its exact argv tuple. */
interface RegisteredHandler {
  command: string;
  args: string[];
  bash: string;
  powershell: string;
}

/**
 * Build a Git project whose name carries spaces and shell metacharacters, with
 * the shipped hook files installed and all three selected-provider hooks registered.
 * It writes one temporary tree, recorded for suite cleanup.
 *
 * @returns hostile-named project root ready for exact handler replay
 */
function createRegisteredHostileProject(
  agentId: "claude" | "codex" = "claude",
): string {
  const disposableParent = mkdtempSync(
    join(tmpdir(), "goat-flow-spawn-matrix-"),
  );
  disposableParents.push(disposableParent);
  const projectRoot = join(disposableParent, "goat's flow & (matrix) [m03]");
  mkdirSync(join(projectRoot, ".goat-flow", "hooks", "deny-dangerous"), {
    recursive: true,
  });
  if (agentId === "claude") {
    mkdirSync(join(projectRoot, ".claude"), { recursive: true });
    writeFileSync(join(projectRoot, ".claude", "settings.json"), "{}\n");
  } else {
    mkdirSync(join(projectRoot, ".codex"), { recursive: true });
    writeFileSync(join(projectRoot, ".codex", "config.toml"), "\n");
  }
  // A fake secret proves the block response without ever exposing real content.
  writeFileSync(join(projectRoot, ".env"), `${ENV_CANARY}\n`);
  execFileSync("git", ["init", "-q", projectRoot]);

  // Ship the exact repository hook bytes so the replay covers real launch code.
  for (const sharedHookFile of SHARED_HOOK_FILES) {
    const installedPath = join(
      projectRoot,
      ".goat-flow",
      "hooks",
      sharedHookFile,
    );
    cpSync(join(WORKFLOW_HOOKS, sharedHookFile), installedPath);
    chmodSync(installedPath, 0o755);
  }
  for (const denyPolicyFile of DENY_POLICY_FILES) {
    cpSync(
      join(WORKFLOW_HOOKS, "deny-dangerous", denyPolicyFile),
      join(
        projectRoot,
        ".goat-flow",
        "hooks",
        "deny-dangerous",
        denyPolicyFile,
      ),
    );
  }

  // Register through the public writer so the fixture rows equal user rows.
  for (const hookId of [
    "deny-dangerous",
    "gruff-code-quality",
    "post-turn-safety",
  ]) {
    const hookSpec = getHookSpec(hookId);
    assert.ok(hookSpec);
    writeAgentHookState(projectRoot, PROFILES[agentId], hookSpec, true);
  }
  return projectRoot;
}

/**
 * Read one registered Claude handler for a lifecycle event.
 * The registrar wrote the fixture, so a missing row fails the test naturally.
 *
 * @param projectRoot - fixture project root
 * @param lifecycleEvent - Claude settings event key holding the handler
 * @returns the exec-form handler exactly as registered
 */
function registeredHandler(
  projectRoot: string,
  lifecycleEvent: "PreToolUse" | "PostToolUse" | "Stop",
): RegisteredHandler {
  const settings = JSON.parse(
    readFileSync(join(projectRoot, ".claude", "settings.json"), "utf-8"),
  ) as {
    hooks: Record<
      string,
      Array<{
        hooks: Array<{
          command?: string;
          args?: string[];
          bash?: string;
          powershell?: string;
        }>;
      }>
    >;
  };
  const registeredHook = settings.hooks[lifecycleEvent]![0]!.hooks[0]!;
  assert.equal(typeof registeredHook.command, "string");
  assert.ok(
    Array.isArray(registeredHook.args),
    `${lifecycleEvent} registration should carry a structured args tuple`,
  );
  assert.equal(registeredHook.bash, "exit 0");
  assert.equal(registeredHook.powershell, "exit 0");
  return {
    command: registeredHook.command as string,
    args: registeredHook.args as string[],
    bash: registeredHook.bash as string,
    powershell: registeredHook.powershell as string,
  };
}

/** Read one registered Codex handler whose Windows override is required on this suite's Windows CI lane. */
function registeredCodexHandler(
  projectRoot: string,
  lifecycleEvent: "PreToolUse" | "PostToolUse" | "Stop",
): { command: string; commandWindows: string } {
  const settings = JSON.parse(
    readFileSync(join(projectRoot, ".codex", "hooks.json"), "utf-8"),
  ) as {
    hooks: Record<
      string,
      Array<{
        hooks: Array<{ command?: string; commandWindows?: string }>;
      }>
    >;
  };
  const registeredHook = settings.hooks[lifecycleEvent]![0]!.hooks[0]!;
  const command = registeredHook.command;
  const commandWindows = registeredHook.commandWindows;
  assert.equal(typeof command, "string");
  assert.equal(typeof commandWindows, "string");
  return {
    command,
    commandWindows,
  };
}

/** Provider payload asking the deny hook to review one shell command. */
function denyPayload(shellCommand: string): string {
  return JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: shellCommand },
  });
}

/**
 * Spawns one registered handler with its exact argv, no shell, payload on stdin.
 * This is the provider-native execution path Claude's exec form uses.
 *
 * @param projectRoot - fixture root; a different cwd exercises root discovery
 * @param handler - registered executable plus argv tuple
 * @param payload - hook input JSON delivered on stdin
 * @param cwd - working directory; defaults to the project root
 * @returns the finished handler process with captured streams
 */
function runRegisteredHandler(
  projectRoot: string,
  handler: RegisteredHandler,
  payload: string,
  cwd: string = projectRoot,
): ReturnType<typeof spawnSync> {
  const selected = agentHookSpawnDescriptor({ form: "argv", ...handler });
  // The public writer owns this executable and argv; fixture payloads reach stdin only.
  return spawnSync(selected.command, selected.args, {
    cwd,
    encoding: "utf8",
    input: payload,
    timeout: 60_000,
  });
}

/** Spawn Codex's exact current-platform command field with a provider payload on stdin. */
function runRegisteredCodexHandler(
  projectRoot: string,
  handler: { command: string; commandWindows: string },
  payload: string,
): ReturnType<typeof spawnSync> {
  const selected = agentHookSpawnDescriptor({ form: "shell", ...handler });
  return spawnSync(selected.command, selected.args, {
    cwd: projectRoot,
    encoding: "utf8",
    input: payload,
    timeout: 60_000,
  });
}

/** Render one captured result for assertion failures. */
function handlerDiagnostics(result: ReturnType<typeof spawnSync>): string {
  return `status=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

describe("hook command spawn matrix", () => {
  it("delivers benign and blocked payloads through the exact registered argv from a hostile-named root", () => {
    const projectRoot = createRegisteredHostileProject();
    const denyHandler = registeredHandler(projectRoot, "PreToolUse");

    // Benign input must reach the managed hook and come back as a silent allow.
    const allowed = runRegisteredHandler(
      projectRoot,
      denyHandler,
      denyPayload("git status"),
    );
    assert.equal(allowed.status, 0, handlerDiagnostics(allowed));
    assert.equal(allowed.stdout, "");
    assert.equal(allowed.stderr, "");

    // A fake .env read must return Claude's block response without leaking content.
    const secretBlocked = runRegisteredHandler(
      projectRoot,
      denyHandler,
      denyPayload("cat .env"),
    );
    assert.equal(secretBlocked.status, 2, handlerDiagnostics(secretBlocked));
    assert.match(String(secretBlocked.stderr), /BLOCKED: Policy secret/u);
    assert.ok(
      !String(secretBlocked.stdout).includes(ENV_CANARY) &&
        !String(secretBlocked.stderr).includes(ENV_CANARY),
      "the canary secret must never appear in a handler stream",
    );

    // A repository push is the plan's measured blocked operation.
    const pushBlocked = runRegisteredHandler(
      projectRoot,
      denyHandler,
      denyPayload("git push origin main"),
    );
    assert.equal(pushBlocked.status, 2, handlerDiagnostics(pushBlocked));
    assert.match(String(pushBlocked.stderr), /BLOCKED: Policy /u);
  });

  it(
    "delivers allow and exit-2 deny results through Codex's registered Windows override",
    { skip: process.platform !== "win32" },
    () => {
      const projectRoot = createRegisteredHostileProject("codex");
      const denyHandler = registeredCodexHandler(projectRoot, "PreToolUse");

      const allowed = runRegisteredCodexHandler(
        projectRoot,
        denyHandler,
        denyPayload("git status"),
      );
      assert.equal(allowed.status, 0, handlerDiagnostics(allowed));
      assert.equal(allowed.stdout, "");
      assert.equal(allowed.stderr, "");

      const blocked = runRegisteredCodexHandler(
        projectRoot,
        denyHandler,
        denyPayload("cat .env"),
      );
      assert.equal(blocked.status, 2, handlerDiagnostics(blocked));
      assert.match(String(blocked.stderr), /BLOCKED: Policy secret/u);
      assert.ok(
        !String(blocked.stdout).includes(ENV_CANARY) &&
          !String(blocked.stderr).includes(ENV_CANARY),
        "the canary secret must never appear in a Codex handler stream",
      );
    },
  );

  it(
    "delivers a managed Gruff result through Codex's registered Windows override",
    { skip: process.platform !== "win32" },
    () => {
      const projectRoot = createRegisteredHostileProject("codex");
      writeContractGruffBinary(projectRoot, FINDING_GRUFF_CONTRACT_ENVELOPE);
      writeFileSync(join(projectRoot, ".gruff-ts.yaml"), "rules: {}\n");
      mkdirSync(join(projectRoot, "src"), { recursive: true });
      writeFileSync(
        join(projectRoot, "src", "sample.ts"),
        "a\nb\nchanged\nd\n",
      );
      const gruffHandler = registeredCodexHandler(projectRoot, "PostToolUse");
      const patchText = [
        "*** Begin Patch",
        "*** Update File: src/sample.ts",
        "@@ -3,1 +3,1 @@",
        "-c",
        "+changed",
        "*** End Patch",
      ].join("\n");

      const result = runRegisteredCodexHandler(
        projectRoot,
        gruffHandler,
        JSON.stringify({
          session_id: "codex-windows-spawn-matrix",
          tool_name: "apply_patch",
          tool_input: { patch: patchText },
        }),
      );
      assert.equal(result.status, 0, handlerDiagnostics(result));
      const providerResult = JSON.parse(result.stdout) as {
        hookSpecificOutput?: {
          hookEventName?: string;
          additionalContext?: string;
        };
      };
      assert.equal(
        providerResult.hookSpecificOutput?.hookEventName,
        "PostToolUse",
      );
      assert.match(
        providerResult.hookSpecificOutput?.additionalContext ?? "",
        /gruff-code-quality: ADVISORY/u,
      );
      assert.match(
        readFileSync(join(projectRoot, "gruff-capabilities.log"), "utf8"),
        /capabilities/u,
      );
      assert.match(
        readFileSync(join(projectRoot, "gruff-hook-args.log"), "utf8"),
        /hook --format json src\/sample\.ts/u,
      );
    },
  );

  it(
    "fails when node.exe cannot start instead of reusing an empty native status",
    { skip: process.platform !== "win32" },
    () => {
      const projectRoot = createRegisteredHostileProject("codex");
      const denyHandler = registeredCodexHandler(projectRoot, "PreToolUse");
      const selected = agentHookSpawnDescriptor({
        form: "shell",
        ...denyHandler,
      });
      assert.equal(selected.command, "powershell.exe");

      const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR;
      assert.ok(windowsRoot, "Windows must expose SystemRoot or WINDIR");
      const powershellPath = join(
        windowsRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const emptyExecutablePath = join(projectRoot, "empty-executable-path");
      mkdirSync(emptyExecutablePath);

      const nodeUnavailableEnvironment = { ...process.env };
      for (const environmentName of Object.keys(nodeUnavailableEnvironment)) {
        if (environmentName.toUpperCase() === "PATH") {
          delete nodeUnavailableEnvironment[environmentName];
        }
      }
      nodeUnavailableEnvironment.PATH = emptyExecutablePath;

      const result = spawnSync(powershellPath, selected.args, {
        cwd: projectRoot,
        encoding: "utf8",
        env: nodeUnavailableEnvironment,
        input: denyPayload("git status"),
        timeout: 60_000,
      });
      assert.equal(result.status, 1, handlerDiagnostics(result));
    },
  );

  it("resolves the managed root from a nested working directory", () => {
    const projectRoot = createRegisteredHostileProject();
    const denyHandler = registeredHandler(projectRoot, "PreToolUse");
    const nestedCwd = join(projectRoot, "src", "deep");
    mkdirSync(nestedCwd, { recursive: true });

    const blocked = runRegisteredHandler(
      projectRoot,
      denyHandler,
      denyPayload("cat .env"),
      nestedCwd,
    );
    assert.equal(blocked.status, 2, handlerDiagnostics(blocked));
    assert.match(String(blocked.stderr), /BLOCKED: Policy secret/u);
  });
});

/** One catchable managed-file failure and the provider response it must keep. */
interface DegradationCase {
  name: string;
  lifecycleEvent: "PreToolUse" | "PostToolUse" | "Stop";
  payload: string;
  mutate: (projectRoot: string) => void;
  expectedStatus: number;
  expectedStderr: RegExp;
}

const GRUFF_EDIT_PAYLOAD = JSON.stringify({
  tool_name: "Edit",
  tool_input: { file_path: "README.md" },
});
const STOP_PAYLOAD = JSON.stringify({
  session_id: "goat-flow-spawn-matrix",
  stop_hook_active: false,
  hook_event_name: "Stop",
});
/** Text that is not JavaScript, so importing the file raises a SyntaxError. */
const CORRUPT_MODULE_SOURCE = "this is ( not : javascript\n";

const DEGRADATION_CASES: DegradationCase[] = [
  {
    name: "missing launcher fails root classification with the policy response",
    lifecycleEvent: "PreToolUse",
    payload: denyPayload("git status"),
    mutate: (projectRoot) =>
      rmSync(join(projectRoot, ".goat-flow", "hooks", "run-with-bash.mjs")),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: managed root incomplete\./u,
  },
  {
    name: "corrupt launcher source becomes the policy could-not-start response",
    lifecycleEvent: "PreToolUse",
    payload: denyPayload("git status"),
    mutate: (projectRoot) =>
      writeFileSync(
        join(projectRoot, ".goat-flow", "hooks", "run-with-bash.mjs"),
        CORRUPT_MODULE_SOURCE,
      ),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: managed launcher could not start\./u,
  },
  {
    name: "launcher without the runHookWithBash API is an explicit mismatch",
    lifecycleEvent: "PreToolUse",
    payload: denyPayload("git status"),
    mutate: (projectRoot) =>
      writeFileSync(
        join(projectRoot, ".goat-flow", "hooks", "run-with-bash.mjs"),
        "export const probeOnly = true;\n",
      ),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: managed launcher API mismatch\./u,
  },
  {
    name: "missing launch runtime breaks the launcher import chain",
    lifecycleEvent: "PreToolUse",
    payload: denyPayload("git status"),
    mutate: (projectRoot) =>
      rmSync(
        join(projectRoot, ".goat-flow", "hooks", "hook-launch-runtime.mjs"),
      ),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: managed launcher could not start\./u,
  },
  {
    name: "corrupt launch runtime breaks the launcher import chain",
    lifecycleEvent: "PreToolUse",
    payload: denyPayload("git status"),
    mutate: (projectRoot) =>
      writeFileSync(
        join(projectRoot, ".goat-flow", "hooks", "hook-launch-runtime.mjs"),
        CORRUPT_MODULE_SOURCE,
      ),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: managed launcher could not start\./u,
  },
  {
    name: "missing hook script fails root classification with the policy response",
    lifecycleEvent: "PreToolUse",
    payload: denyPayload("git status"),
    mutate: (projectRoot) =>
      rmSync(join(projectRoot, ".goat-flow", "hooks", "deny-dangerous.sh")),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: managed root incomplete\./u,
  },
  {
    name: "missing provider adapter keeps the Gruff soft-skip contract",
    lifecycleEvent: "PostToolUse",
    payload: GRUFF_EDIT_PAYLOAD,
    mutate: (projectRoot) =>
      rmSync(
        join(projectRoot, ".goat-flow", "hooks", "hook-provider-adapters.mjs"),
      ),
    expectedStatus: 0,
    expectedStderr:
      /gruff-code-quality: hook unavailable: hook provider adapter could not load; skipped\./u,
  },
  {
    name: "corrupt provider adapter keeps the Gruff soft-skip contract",
    lifecycleEvent: "PostToolUse",
    payload: GRUFF_EDIT_PAYLOAD,
    mutate: (projectRoot) =>
      writeFileSync(
        join(projectRoot, ".goat-flow", "hooks", "hook-provider-adapters.mjs"),
        CORRUPT_MODULE_SOURCE,
      ),
    expectedStatus: 0,
    expectedStderr:
      /gruff-code-quality: hook unavailable: hook provider adapter could not load; skipped\./u,
  },
  {
    name: "corrupt launcher keeps the post-turn Stop failure channel",
    lifecycleEvent: "Stop",
    payload: STOP_PAYLOAD,
    mutate: (projectRoot) =>
      writeFileSync(
        join(projectRoot, ".goat-flow", "hooks", "run-with-bash.mjs"),
        CORRUPT_MODULE_SOURCE,
      ),
    expectedStatus: 2,
    expectedStderr:
      /post-turn-safety: hook unavailable: managed launcher could not start\./u,
  },
];

describe("catchable managed-file failures keep provider responses", () => {
  // Every catchable failure after Node starts must keep its provider contract.
  for (const degradationCase of DEGRADATION_CASES) {
    it(degradationCase.name, () => {
      const projectRoot = createRegisteredHostileProject();
      const handler = registeredHandler(
        projectRoot,
        degradationCase.lifecycleEvent,
      );
      degradationCase.mutate(projectRoot);
      const result = runRegisteredHandler(
        projectRoot,
        handler,
        degradationCase.payload,
      );
      assert.equal(
        result.status,
        degradationCase.expectedStatus,
        handlerDiagnostics(result),
      );
      assert.match(String(result.stderr), degradationCase.expectedStderr);
    });
  }

  it("a corrupt hook script still blocks even though its message is Bash's own", () => {
    const projectRoot = createRegisteredHostileProject();
    const denyHandler = registeredHandler(projectRoot, "PreToolUse");
    // Shape checks pass for a regular file, so Bash itself rejects the content.
    writeFileSync(
      join(projectRoot, ".goat-flow", "hooks", "deny-dangerous.sh"),
      ")((((\n",
    );
    const result = runRegisteredHandler(
      projectRoot,
      denyHandler,
      denyPayload("git status"),
    );
    assert.equal(result.status, 2, handlerDiagnostics(result));
    assert.ok(
      String(result.stderr).length > 0,
      "a corrupt script must fail visibly, never silently allow",
    );
  });
});
