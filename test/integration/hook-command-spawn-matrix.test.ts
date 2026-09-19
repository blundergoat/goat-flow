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
  closeSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { after, describe, it } from "node:test";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { managedHookEnvironment } from "../../src/cli/hooks-configured-runtime-evidence.js";
import {
  agentHookSpawnDescriptor,
  commandEntryReferencesSpec,
} from "../../src/cli/server/agent-hook-command.js";
import { writeAgentHookState } from "../../src/cli/server/agent-hook-writer.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";
import {
  applyHookState,
  syncHookStates,
} from "../../src/cli/server/hook-registrar.js";
import {
  FINDING_GRUFF_CONTRACT_ENVELOPE,
  writeContractGruffBinary,
} from "./gruff-code-quality-smoke.helpers.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const WORKFLOW_HOOKS = join(PROJECT_ROOT, "workflow", "hooks");
const SHARED_HOOK_FILES = [
  "run-with-bash.mjs",
  "hook-launch-runtime.mjs",
  "hook-policy-state.cjs",
  "vendor/js-yaml.cjs",
  "hook-provider-adapters.mjs",
  "deny-dangerous.sh",
  "deny-git-mutations.sh",
  "gruff-code-quality.sh",
  "post-turn-safety.sh",
];
const DENY_POLICY_FILES = [
  "guard-runtime.sh",
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
 *
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
  mkdirSync(projectRoot, { recursive: true });
  // Create the chosen provider's marker so hook setup registers the handlers that this consumer would receive.
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
  installShippedHookFiles(projectRoot);

  // Register through the public writer so the fixture rows equal user rows.
  for (const hookId of [
    "deny-dangerous",
    "deny-git-mutations",
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
 * Copies the exact repository hook bytes into one project so replays cover real launch code.
 * It writes the managed hook files only; registration stays with the caller.
 *
 * @param projectRoot - existing project directory that receives `.goat-flow/hooks`
 */
function installShippedHookFiles(projectRoot: string): void {
  mkdirSync(join(projectRoot, ".goat-flow", "hooks", "deny-dangerous"), {
    recursive: true,
  });
  for (const sharedHookFile of SHARED_HOOK_FILES) {
    const installedPath = join(
      projectRoot,
      ".goat-flow",
      "hooks",
      sharedHookFile,
    );
    mkdirSync(join(installedPath, ".."), { recursive: true });
    cpSync(join(WORKFLOW_HOOKS, sharedHookFile), installedPath);
    chmodSync(installedPath, 0o755);
  }
  // Install every shared policy module before replaying the provider's saved handler.
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
}

/**
 * Read one registered Claude handler for a lifecycle event.
 * The registrar wrote the fixture, so a missing row fails the test naturally.
 *
 * @param projectRoot - fixture project root
 *
 * @param lifecycleEvent - Claude settings event key holding the handler
 * @returns the exec-form handler exactly as registered
 */
function registeredHandler(
  projectRoot: string,
  lifecycleEvent: "PreToolUse" | "PostToolUse" | "Stop",
  policyHookId = "deny-dangerous",
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
  const policySpec = getHookSpec(policyHookId);
  assert.ok(policySpec);
  const registeredHook = settings.hooks[lifecycleEvent]!.flatMap(
    (group) => group.hooks,
  ).find(
    (row) =>
      lifecycleEvent !== "PreToolUse" ||
      commandEntryReferencesSpec(row, policySpec),
  );
  assert.ok(registeredHook);
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
  policyHookId = "deny-dangerous",
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
  const registeredHook = settings.hooks[lifecycleEvent]!.flatMap(
    (entry) => entry.hooks,
  ).find(
    (entry) =>
      lifecycleEvent !== "PreToolUse" ||
      entry.command?.includes(`${policyHookId}.sh`),
  )!;
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
 *
 * @param payload - hook input JSON delivered on stdin
 * @param cwd - working directory; defaults to the project root
 * @param providerProjectDirectory - value Claude exports as CLAUDE_PROJECT_DIR; null models a provider that exports none
 *
 * @returns the finished handler process with captured streams
 */
function runRegisteredHandler(
  projectRoot: string,
  handler: RegisteredHandler,
  payload: string,
  cwd: string = projectRoot,
  providerProjectDirectory: string | null = projectRoot,
): ReturnType<typeof spawnSync> {
  const selected = agentHookSpawnDescriptor({ form: "argv", ...handler });
  // Pin the provider directory so a developer's own session variable never selects their real checkout.
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment.CLAUDE_PROJECT_DIR;
  if (providerProjectDirectory !== null) {
    environment.CLAUDE_PROJECT_DIR = providerProjectDirectory;
  }
  // The public writer owns this executable and argv; fixture payloads reach stdin only.
  return spawnSync(selected.command, selected.args, {
    cwd,
    encoding: "utf8",
    env: environment,
    input: payload,
    timeout: 60_000,
  });
}

/** Spawn Codex's exact current-platform command field with a provider payload on stdin. */
function runRegisteredCodexHandler(
  projectRoot: string,
  handler: { command: string; commandWindows: string },
  payload: string,
  options: {
    environment?: NodeJS.ProcessEnv;
    stdin?: "file" | "pipe";
  } = {},
): ReturnType<typeof spawnSync> {
  const selected = agentHookSpawnDescriptor({ form: "shell", ...handler });
  const spawnOptions = {
    cwd: projectRoot,
    encoding: "utf8" as const,
    env: options.environment ?? process.env,
    timeout: 60_000,
  };
  // Piped requests reproduce the provider's direct payload delivery to its configured command.
  if ((options.stdin ?? "pipe") === "pipe") {
    return spawnSync(selected.command, selected.args, {
      ...spawnOptions,
      input: payload,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  const payloadDirectory = mkdtempSync(
    join(tmpdir(), "goat-flow-codex-matrix-"),
  );
  const payloadPath = join(payloadDirectory, "payload.json");
  let payloadDescriptor: number | null = null;
  try {
    writeFileSync(payloadPath, payload, { mode: 0o600 });
    payloadDescriptor = openSync(payloadPath, "r");
    return spawnSync(selected.command, selected.args, {
      ...spawnOptions,
      stdio: [payloadDescriptor, "pipe", "pipe"],
    });
  } finally {
    // Close an opened payload file after replay so the fixture does not retain resources across cases.
    if (payloadDescriptor !== null) closeSync(payloadDescriptor);
    rmSync(payloadDirectory, { recursive: true, force: true });
  }
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

    // Native Git publication is enforced by its separately registered handler.
    const gitHandler = registeredHandler(
      projectRoot,
      "PreToolUse",
      "deny-git-mutations",
    );
    const gitAllowed = runRegisteredHandler(
      projectRoot,
      gitHandler,
      denyPayload("git status"),
    );
    assert.equal(gitAllowed.status, 0, handlerDiagnostics(gitAllowed));
    const pushBlocked = runRegisteredHandler(
      projectRoot,
      gitHandler,
      denyPayload("git push origin main"),
    );
    assert.equal(pushBlocked.status, 2, handlerDiagnostics(pushBlocked));
    assert.match(String(pushBlocked.stderr), /BLOCKED: Policy /u);
  });

  it(
    "delivers allow and exit-2 deny results through Codex's registered Windows override",
    { skip: process.platform !== "win32" },
    (testContext) => {
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

      const managedEnvironment = managedHookEnvironment(
        projectRoot,
        process.env,
        process.platform,
      );
      const replayVariants: Array<{
        environment: "full" | "managed";
        values: NodeJS.ProcessEnv;
        stdin: "file" | "pipe";
      }> = [
        { environment: "full", values: process.env, stdin: "pipe" },
        { environment: "managed", values: managedEnvironment, stdin: "pipe" },
        { environment: "full", values: process.env, stdin: "file" },
        { environment: "managed", values: managedEnvironment, stdin: "file" },
      ];
      const blockedPayload = denyPayload("cat .env");
      const blockedReplays = replayVariants.map((variant) => {
        const startedAt = performance.now();
        const result = runRegisteredCodexHandler(
          projectRoot,
          denyHandler,
          blockedPayload,
          { environment: variant.values, stdin: variant.stdin },
        );
        const durationMs = Math.max(
          0,
          Math.round(performance.now() - startedAt),
        );
        const errorCode =
          (result.error as NodeJS.ErrnoException | undefined)?.code ?? "none";
        testContext.diagnostic(
          `codex-windows-replay environment=${variant.environment} stdin=${variant.stdin} duration_ms=${durationMs} status=${String(result.status)} error=${errorCode}`,
        );
        return result;
      });

      // Each blocked replay must retain the user's sensitive-file protection and actionable denial.
      for (const blocked of blockedReplays) {
        assert.equal(blocked.status, 2, handlerDiagnostics(blocked));
        assert.match(String(blocked.stderr), /BLOCKED: Policy secret/u);
        assert.ok(
          !String(blocked.stdout).includes(ENV_CANARY) &&
            !String(blocked.stderr).includes(ENV_CANARY),
          "the canary secret must never appear in a Codex handler stream",
        );
      }
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
      // Remove every spelling of PATH so this fixture reproduces a launcher unable to discover Node.
      for (const environmentName of Object.keys(nodeUnavailableEnvironment)) {
        // Windows-style case differences must not leave another executable search path available to this failure fixture.
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
    // Filesystem side effects: removes a disposable installed file to reproduce an absent launch dependency before provider replay.
    mutate: (projectRoot) =>
      rmSync(join(projectRoot, ".goat-flow", "hooks", "run-with-bash.mjs")),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: deny-dangerous\.sh: managed root incomplete\./u,
  },
  {
    name: "corrupt launcher source becomes the policy could-not-start response",
    lifecycleEvent: "PreToolUse",
    payload: denyPayload("git status"),
    // Filesystem side effects: writes a disposable installed file to reproduce an invalid or incomplete launch dependency before provider replay.
    mutate: (projectRoot) =>
      writeFileSync(
        join(projectRoot, ".goat-flow", "hooks", "run-with-bash.mjs"),
        CORRUPT_MODULE_SOURCE,
      ),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: deny-dangerous\.sh: managed launcher could not start\./u,
  },
  {
    name: "launcher without the runHookWithBash API is an explicit mismatch",
    lifecycleEvent: "PreToolUse",
    payload: denyPayload("git status"),
    // Filesystem side effects: writes a disposable installed file to reproduce an invalid or incomplete launch dependency before provider replay.
    mutate: (projectRoot) =>
      writeFileSync(
        join(projectRoot, ".goat-flow", "hooks", "run-with-bash.mjs"),
        "export const probeOnly = true;\n",
      ),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: deny-dangerous\.sh: managed launcher API mismatch\./u,
  },
  {
    name: "missing launch runtime breaks the launcher import chain",
    lifecycleEvent: "PreToolUse",
    payload: denyPayload("git status"),
    // Filesystem side effects: removes a disposable installed file to reproduce an absent launch dependency before provider replay.
    mutate: (projectRoot) =>
      rmSync(
        join(projectRoot, ".goat-flow", "hooks", "hook-launch-runtime.mjs"),
      ),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: deny-dangerous\.sh: managed launcher could not start\./u,
  },
  {
    name: "corrupt launch runtime breaks the launcher import chain",
    lifecycleEvent: "PreToolUse",
    payload: denyPayload("git status"),
    // Filesystem side effects: writes a disposable installed file to reproduce an invalid or incomplete launch dependency before provider replay.
    mutate: (projectRoot) =>
      writeFileSync(
        join(projectRoot, ".goat-flow", "hooks", "hook-launch-runtime.mjs"),
        CORRUPT_MODULE_SOURCE,
      ),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: deny-dangerous\.sh: managed launcher could not start\./u,
  },
  {
    name: "missing hook script fails root classification with the policy response",
    lifecycleEvent: "PreToolUse",
    payload: denyPayload("git status"),
    // Filesystem side effects: removes a disposable installed file to reproduce an absent launch dependency before provider replay.
    mutate: (projectRoot) =>
      rmSync(join(projectRoot, ".goat-flow", "hooks", "deny-dangerous.sh")),
    expectedStatus: 2,
    expectedStderr:
      /BLOCKED: Policy hook unavailable: deny-dangerous\.sh: managed root incomplete\./u,
  },
  {
    name: "missing provider adapter keeps the Gruff soft-skip contract",
    lifecycleEvent: "PostToolUse",
    payload: GRUFF_EDIT_PAYLOAD,
    // Filesystem side effects: removes a disposable installed file to reproduce an absent launch dependency before provider replay.
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
    // Filesystem side effects: writes a disposable installed file to reproduce an invalid or incomplete launch dependency before provider replay.
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
    // Filesystem side effects: writes a disposable installed file to reproduce an invalid or incomplete launch dependency before provider replay.
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

/** Saved handlers must survive the exact registrar transitions used by the Hooks page. */
describe("retained policy registrations", () => {
  // Exercise both saved policy switches through repeated disable, Sync and enable actions.
  for (const hookId of ["deny-dangerous", "deny-git-mutations"]) {
    const blockedCommand =
      hookId === "deny-dangerous" ? "rm -rf /" : "git commit -m blocked";
    // The same lifecycle must work for both supported provider handler shapes.
    for (const provider of ["claude", "codex"] as const) {
      it(`${provider}:${hookId} reuses a saved handler through two off/sync/on cycles`, () => {
        const root = createRegisteredHostileProject(provider);
        syncHookStates(root);
        const spec = getHookSpec(hookId)!;
        const saved =
          provider === "claude"
            ? registeredHandler(root, "PreToolUse", hookId)
            : registeredCodexHandler(root, "PreToolUse", hookId);
        // Replay the handler saved before toggling so each cycle proves an already-loaded registration remains usable.
        const run = (command: string) =>
          "args" in saved
            ? runRegisteredHandler(root, saved, denyPayload(command))
            : runRegisteredCodexHandler(root, saved, denyPayload(command));
        const configPath = join(
          root,
          provider === "claude" ? ".claude/settings.json" : ".codex/hooks.json",
        );
        const config = JSON.parse(readFileSync(configPath, "utf8"));
        config.hooks.PreToolUse.push({
          matcher: "Bash",
          hooks: [{ command: "echo preserved-user-hook" }],
        });
        writeFileSync(configPath, JSON.stringify(config));
        const sibling =
          hookId === "deny-dangerous" ? "deny-git-mutations" : "deny-dangerous";
        // Repeat the lifecycle to prove later Sync actions do not wedge the user's saved handler.
        for (let cycle = 0; cycle < 2; cycle += 1) {
          assert.equal(run("git status").status, 0);
          assert.equal(run(blockedCommand).status, 2);
          const disabled = applyHookState(hookId, false, root);
          assert.equal(disabled.agents[provider].drift, undefined);
          assert.equal(
            disabled.agents[provider].effectiveState.status,
            "disabled",
          );
          const bytes = readFileSync(
            join(root, ".goat-flow/hooks", spec.primaryScript),
            "utf8",
          );
          // While disabled, benign and normally blocked requests must both pass without a policy denial.
          for (const command of ["git status", blockedCommand]) {
            const result = run(command);
            assert.equal(result.status, 0, handlerDiagnostics(result));
            assert.equal(result.stderr, "");
            assert.equal(result.stdout, "");
          }
          const synced = syncHookStates(root);
          assert.equal(
            synced.find((state) => state.id === sibling)?.enabled,
            true,
          );
          assert.equal(
            readFileSync(
              join(root, ".goat-flow/hooks", spec.primaryScript),
              "utf8",
            ),
            bytes,
          );
          assert.ok(
            readFileSync(configPath, "utf8").includes("preserved-user-hook"),
          );
          assert.ok(readFileSync(configPath, "utf8").includes(`${hookId}.sh`));
          assert.equal(run(blockedCommand).status, 0);
          applyHookState(hookId, true, root);
          assert.equal(run(blockedCommand).status, 2);
          assert.equal(run("git status").status, 0);
        }
      });
    }

    it(`${hookId} defaults absent choices on and refuses invalid config or missing launch dependencies`, () => {
      const root = createRegisteredHostileProject();
      const saved = registeredHandler(root, "PreToolUse", hookId);
      const config = join(root, ".goat-flow/config.yaml");
      assert.equal(
        runRegisteredHandler(root, saved, denyPayload(blockedCommand)).status,
        2,
      );
      assert.equal(
        runRegisteredHandler(root, saved, denyPayload("git status")).status,
        0,
      );
      // Malformed or ambiguous saved choices must never authorize skipping the user's policy enforcement.
      for (const text of [
        "hooks: [",
        `hooks: {${hookId}: {enabled: 'false'}}`,
        `hooks: {${hookId}: {enabled: false}, guard-secret-paths: {enabled: nope}}`,
      ]) {
        writeFileSync(config, text);
        const failed = runRegisteredHandler(
          root,
          saved,
          denyPayload("git status"),
        );
        assert.equal(failed.status, 2);
        assert.match(String(failed.stderr), /unavailable/);
      }
      writeFileSync(config, `hooks: {${hookId}: {enabled: false}}`);
      // Break each launch dependency to verify an archived handler cannot silently skip protection.
      for (const dependency of [
        "run-with-bash.mjs",
        "hook-launch-runtime.mjs",
        `${hookId}.sh`,
        "hook-policy-state.cjs",
        "vendor/js-yaml.cjs",
      ]) {
        const installed = join(root, ".goat-flow/hooks", dependency);
        const bytes = readFileSync(installed);
        rmSync(installed);
        assert.equal(
          runRegisteredHandler(root, saved, denyPayload("git status")).status,
          2,
          dependency,
        );
        writeFileSync(installed, bytes);
      }
      // A complete off decision skips downstream policy code without requiring Bash.
      rmSync(join(root, ".goat-flow/hooks/deny-dangerous/guard-runtime.sh"));
      assert.equal(
        runRegisteredHandler(root, saved, denyPayload(blockedCommand)).status,
        0,
      );
      const selected = agentHookSpawnDescriptor({ form: "argv", ...saved });
      const noBash = spawnSync(process.execPath, selected.args, {
        cwd: root,
        encoding: "utf8",
        input: denyPayload(blockedCommand),
        env: { ...process.env, PATH: "" },
      });
      assert.equal(noBash.status, 0, handlerDiagnostics(noBash));
    });

    it(`${hookId} rejects unsafe config components even for explicit off`, () => {
      const root = createRegisteredHostileProject();
      const saved = registeredHandler(root, "PreToolUse", hookId);
      const config = join(root, ".goat-flow/config.yaml");
      writeFileSync(config + ".target", `hooks: {${hookId}: {enabled: false}}`);
      symlinkSync(config + ".target", config);
      assert.equal(
        runRegisteredHandler(root, saved, denyPayload("git status")).status,
        2,
      );
      rmSync(config);
      writeFileSync(config, `hooks: {${hookId}: {enabled: false}}`);
      renameSync(join(root, ".goat-flow"), join(root, "moved-state"));
      symlinkSync(join(root, "moved-state"), join(root, ".goat-flow"), "dir");
      assert.equal(
        runRegisteredHandler(root, saved, denyPayload("git status")).status,
        2,
      );
    });
  }

  it("reports disabled policy launcher cost", () => {
    const root = createRegisteredHostileProject();
    const saved = registeredHandler(root, "PreToolUse");
    const config = join(root, ".goat-flow/config.yaml");
    // Measure both saved choices so enabled enforcement and an explicit opt-out remain bounded.
    for (const enabled of [true, false]) {
      writeFileSync(config, `hooks: {deny-dangerous: {enabled: ${enabled}}}`);
      const durations = Array.from({ length: 5 }, () => {
        const started = performance.now();
        const result = runRegisteredHandler(
          root,
          saved,
          denyPayload("git status"),
        );
        assert.equal(result.status, 0, handlerDiagnostics(result));
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, "");
        return performance.now() - started;
      }).sort((a, b) => a - b);
      console.log(
        JSON.stringify({
          policy: "deny-dangerous",
          enabled,
          repetitions: 5,
          cache:
            "fresh Node process; OS cache uncontrolled/warm; same fixture and benign payload",
          medianMs: durations[2],
          minMs: durations[0],
          maxMs: durations[4],
        }),
      );
    }
  });
});

/** Source edit with no analyzer config: a stable Gruff result that proves which install answered. */
const GRUFF_SOURCE_EDIT_PAYLOAD = JSON.stringify({
  tool_name: "Edit",
  tool_input: { file_path: "src/sample.ts" },
});
/** Stderr text printed only by the child install's substituted Gruff script. */
const CHILD_RUNTIME_MARKER = "child Gruff runtime ran";

/**
 * Builds a registered parent project holding one nested child repository, as measured in a consumer workspace.
 * It writes temporary trees: the child gets the shipped hook files, and only a `registered` child also registers Gruff.
 *
 * @param childRegistration - `disabled` leaves script copies without a registration; `registered` adds a marker runtime
 * @returns parent root and child root
 */
function createParentWithChildInstall(
  childRegistration: "disabled" | "registered",
): { parentRoot: string; childRoot: string } {
  const parentRoot = createRegisteredHostileProject();
  mkdirSync(join(parentRoot, "src"));
  writeFileSync(join(parentRoot, "src", "sample.ts"), "export {};\n");
  const childRoot = join(parentRoot, "child");
  mkdirSync(join(childRoot, ".claude"), { recursive: true });
  writeFileSync(join(childRoot, ".claude", "settings.json"), "{}\n");
  execFileSync("git", ["init", "-q", childRoot]);
  installShippedHookFiles(childRoot);
  // A registered child models a sibling install whose older runtime must not answer for the parent's session.
  if (childRegistration === "registered") {
    const gruffSpec = getHookSpec("gruff-code-quality");
    assert.ok(gruffSpec);
    writeAgentHookState(childRoot, PROFILES.claude, gruffSpec, true);
    writeFileSync(
      join(childRoot, ".goat-flow", "hooks", "gruff-code-quality.sh"),
      `#!/usr/bin/env bash\nprintf '${CHILD_RUNTIME_MARKER}\\n' >&2\n`,
    );
  }
  return { parentRoot, childRoot };
}

describe("Gruff entry selection ignores the shell working directory", () => {
  // Incident: a child install with Gruff disabled stopped the parent's registration for unrelated edits.
  for (const providerDirectory of ["exported", "absent"] as const) {
    it(`answers from the parent when the cwd is a Gruff-disabled child (provider directory ${providerDirectory})`, () => {
      const { parentRoot, childRoot } =
        createParentWithChildInstall("disabled");
      const result = runRegisteredHandler(
        parentRoot,
        registeredHandler(parentRoot, "PostToolUse"),
        GRUFF_SOURCE_EDIT_PAYLOAD,
        childRoot,
        providerDirectory === "exported" ? parentRoot : null,
      );
      assert.equal(result.status, 0, handlerDiagnostics(result));
      assert.doesNotMatch(String(result.stderr), /managed root incomplete/u);
      assert.match(String(result.stdout), /analyzer-config-missing/u);
    });
  }

  it("runs the provider project's runtime when the cwd is a child with its own Gruff registration", () => {
    const { parentRoot, childRoot } =
      createParentWithChildInstall("registered");
    const result = runRegisteredHandler(
      parentRoot,
      registeredHandler(parentRoot, "PostToolUse"),
      GRUFF_SOURCE_EDIT_PAYLOAD,
      childRoot,
    );
    assert.equal(result.status, 0, handlerDiagnostics(result));
    assert.doesNotMatch(
      String(result.stderr),
      new RegExp(CHILD_RUNTIME_MARKER, "u"),
    );
    assert.match(String(result.stdout), /analyzer-config-missing/u);
  });

  it("keeps the fail-closed corrupt classification for policy hooks in the same child", () => {
    const { parentRoot, childRoot } = createParentWithChildInstall("disabled");
    const blocked = runRegisteredHandler(
      parentRoot,
      registeredHandler(parentRoot, "PreToolUse"),
      denyPayload("git status"),
      childRoot,
    );
    assert.equal(blocked.status, 2, handlerDiagnostics(blocked));
    assert.match(
      String(blocked.stderr),
      /BLOCKED: Policy hook unavailable: deny-dangerous\.sh: managed root incomplete\./u,
    );
  });
});
