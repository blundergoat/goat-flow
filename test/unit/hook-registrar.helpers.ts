/**
 * Shared fixtures for the hook-registrar suites.
 * Registrar behaviour is all filesystem truth - which agent surfaces exist, what the
 * generated launchers contain, which config entries survive a sync - so the fixtures build
 * real projects, run real git, and execute the generated launcher scripts rather than
 * asserting on strings the registrar merely intended to write.
 *
 * The payload constants are the same JSON an agent host would deliver, so a launcher test
 * proves the full stdin-to-verdict path, not a parsing shortcut.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyHookState } from "../../src/cli/server/hook-registrar.js";
import {
  buildAgentHookCommand,
  writeAgentHookState,
} from "../../src/cli/server/agent-hook-writer.js";
import {
  listHookSpecs,
  type HookSpec,
} from "../../src/cli/server/hooks-registry.js";
import type { AgentProfile } from "../../src/cli/types.js";

export const HOOK_IDENTIFIER = "deny-dangerous";
export const CLAUDE_SAFE_PAYLOAD =
  '{"tool_name":"Bash","tool_input":{"command":"echo safe"}}';
export const CLAUDE_DANGEROUS_PAYLOAD =
  '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}';

export const HOOK_TIMEOUT_MODES = [
  { mode: "policy", status: 2, stream: "stderr", pattern: /BLOCKED:/u },
  { mode: "antigravity", status: 0, stream: "stdout", pattern: /decision/u },
  {
    mode: "copilot",
    status: 0,
    stream: "stdout",
    pattern: /permissionDecision/u,
  },
  { mode: "gruff", status: 0, stream: "stderr", pattern: /skipped/u },
  {
    mode: "post-turn",
    status: 2,
    stream: "stderr",
    pattern: /post-turn-safety/u,
  },
] as const;

export const GENERATED_AGENT_SURFACES = [
  ".claude/settings.json",
  ".goat-flow/hooks/run-with-bash.mjs",
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

/**
 * Collect runnable commands from one nested agent config for shared registration checks.
 * Use after hook writes so every supported JSON shape gets the same assertions.
 */
function collectInstalledHookCommandEntries(
  configValue: unknown,
  installedCommandEntries: Array<Record<string, unknown>>,
): void {
  // Hook groups are arrays, so every nested item may contain a user-visible command.
  if (Array.isArray(configValue)) {
    // Preserve every entry because one managed hook may register more than one command.
    for (const nestedConfigValue of configValue) {
      collectInstalledHookCommandEntries(
        nestedConfigValue,
        installedCommandEntries,
      );
    }
    return;
  }
  // Null and primitive settings cannot contain a runnable hook command for the user.
  if (configValue === null || typeof configValue !== "object") return;
  const configEntry = configValue as Record<string, unknown>;
  // Any supported command field marks this object as an executable registration.
  if (
    typeof configEntry.command === "string" ||
    typeof configEntry.bash === "string" ||
    typeof configEntry.powershell === "string"
  ) {
    installedCommandEntries.push(configEntry);
  }
  // Matcher and lifecycle wrappers may contain further commands the user will run.
  for (const nestedConfigValue of Object.values(configEntry)) {
    collectInstalledHookCommandEntries(
      nestedConfigValue,
      installedCommandEntries,
    );
  }
}

/** Select installed command entries that run one managed hook; empty means no launcher exists. */
function installedEntriesForHook(
  installedCommandEntries: Array<Record<string, unknown>>,
  hookSpec: HookSpec,
): Array<Record<string, unknown>> {
  return installedCommandEntries.filter((commandEntry) =>
    [commandEntry.command, commandEntry.bash, commandEntry.powershell].some(
      (commandValue) =>
        typeof commandValue === "string" &&
        commandValue.includes(hookSpec.primaryScript),
    ),
  );
}

/** Assert one installed entry matches the command and deadline the user should receive. */
function assertManagedHookRegistration(
  agentProfile: AgentProfile,
  hookSpec: HookSpec,
  commandEntry: Record<string, unknown>,
  expectedCommand: string,
): void {
  // Copilot users need the same portable launcher in both supported shell fields.
  if (agentProfile.id === "copilot") {
    assert.equal(commandEntry.bash, expectedCommand);
    assert.equal(commandEntry.powershell, expectedCommand);
    assert.equal(commandEntry.timeoutSec, hookSpec.timeoutSec);
    return;
  }
  assert.equal(commandEntry.command, expectedCommand);
  // Codex has no host timeout field, so the shared launcher is the user's deadline.
  if (agentProfile.id === "codex") {
    assert.equal(commandEntry.timeout, undefined);
    return;
  }
  assert.equal(commandEntry.timeout, hookSpec.timeoutSec);
}

/** Assert launcher failure uses the response format this agent's user sees. */
function assertHookUnavailableResponse(
  agentProfile: AgentProfile,
  hookSpec: HookSpec,
  installedCommand: string,
): void {
  // Quality-hook startup failures remain advisory instead of blocking the user's edit.
  if (hookSpec.id === "gruff-code-quality") {
    assert.match(installedCommand, /gruff-code-quality: hook unavailable/u);
    return;
  }
  // Stop-hook startup failures block completion with their own visible category.
  if (hookSpec.id === "post-turn-safety") {
    assert.match(installedCommand, /post-turn-safety: hook unavailable/u);
    return;
  }
  // Antigravity users receive a deny decision object on standard output.
  if (agentProfile.id === "antigravity") {
    assert.match(installedCommand, /decision:'deny'/u);
    return;
  }
  // Copilot users receive its permission-decision response object.
  if (agentProfile.id === "copilot") {
    assert.match(installedCommand, /permissionDecision:'deny'/u);
    return;
  }
  assert.match(installedCommand, /BLOCKED: Policy hook unavailable/u);
}

/**
 * Verify one agent receives every supported launcher, deadline, and response format.
 * @param agentProfile - selected agent; a missing config path means no registration surface
 * @param targetProjectPath - non-empty isolated project where the user-facing config is written
 * @returns installed command count; zero means the user received no runnable hook
 */
export function verifyAgentHookRegistrationMatrix(
  agentProfile: AgentProfile,
  targetProjectPath: string,
): number {
  // Install every hook this agent can expose to the user.
  for (const hookSpec of listHookSpecs()) {
    // Unsupported lifecycles stay absent instead of creating a broken user toggle.
    if (hookSpec.unsupportedAgents?.[agentProfile.id]) continue;
    writeAgentHookState(targetProjectPath, agentProfile, hookSpec, true);
  }

  // Without a config path, this agent cannot expose the registrations under test.
  assert.ok(agentProfile.hookConfigFile);
  const installedAgentConfig = JSON.parse(
    readFileSync(join(targetProjectPath, agentProfile.hookConfigFile), "utf-8"),
  ) as unknown;
  const installedCommandEntries: Array<Record<string, unknown>> = [];
  collectInstalledHookCommandEntries(
    installedAgentConfig,
    installedCommandEntries,
  );

  // Recheck every supported hook against the exact registration setup promises the user.
  for (const hookSpec of listHookSpecs()) {
    // Unsupported hooks are intentionally absent and have no registration to compare.
    if (hookSpec.unsupportedAgents?.[agentProfile.id]) continue;
    const expectedCommand = buildAgentHookCommand(
      agentProfile.id,
      agentProfile.hooksDir ?? ".goat-flow/hooks",
      hookSpec,
    );
    const matchingCommandEntries = installedEntriesForHook(
      installedCommandEntries,
      hookSpec,
    );
    assert.ok(
      matchingCommandEntries.length > 0,
      `${agentProfile.id} missing ${hookSpec.id} registration`,
    );
    // Multiple host fields must preserve the same managed command and response contract.
    for (const commandEntry of matchingCommandEntries) {
      assertManagedHookRegistration(
        agentProfile,
        hookSpec,
        commandEntry,
        expectedCommand,
      );
      // Empty command fields mean this registration cannot start a user-visible hook.
      const installedCommand = String(
        commandEntry.command ??
          commandEntry.bash ??
          commandEntry.powershell ??
          "",
      );
      assertHookUnavailableResponse(agentProfile, hookSpec, installedCommand);
    }
  }
  return installedCommandEntries.length;
}

/** Writes a cleaned temporary target project for hook-registrar assertions.
 *
 * @param fn - the case body, given the project root; the directory is removed afterwards even on throw
 */
export function withTempProject(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-hook-registrar-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

/** Check fixture-relative generated hook paths.
 *
 * @param root - fixture project root
 * @param path - repo-relative path under the fixture root
 * @returns whether the path exists under the fixture root
 */
export function pathExists(root: string, path: string): boolean {
  return existsSync(join(root, path));
}

/** Assert generated surfaces remain absent when a hook toggle should not scaffold.
 *
 * @param root - fixture project root
 * @param paths - repo-relative paths asserted as a set, so one failure names every offender at once
 */
export function assertMissing(root: string, paths: string[]): void {
  for (const path of paths) {
    assert.equal(pathExists(root, path), false, `${path} should be absent`);
  }
}

/** Assert generated surfaces are present after an explicit hook sync.
 *
 * @param root - fixture project root
 * @param paths - repo-relative paths asserted as a set, so one failure names every offender at once
 */
export function assertPresent(root: string, paths: string[]): void {
  for (const path of paths) {
    assert.equal(pathExists(root, path), true, `${path} should exist`);
  }
}

/** Spawns a git command in a fixture project and fails with stdout/stderr context.
 *
 * @param cwd - working directory the process runs in
 * @param args - git arguments verbatim
 * @returns trimmed stdout; a non-zero exit fails the test with both streams attached
 */
export function runGit(cwd: string, args: string[]): string {
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

/** Create one commit so git worktree/submodule fixtures have a real HEAD.
 *
 * @param root - fixture project root
 * @param message - commit message; identity is pinned so fixtures commit anywhere
 */
export function commitAll(root: string, message: string): void {
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

/** Read the first generated Claude deny launcher because hook arrays are nested by event and matcher.
 *
 * @param root - fixture project root
 * @returns the generated Claude launcher command, proving one was written
 */
export function readClaudeDenyLauncher(root: string): string {
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

/** Read the first generated Codex deny launcher because hook arrays are nested by event and matcher.
 *
 * @param root - fixture project root
 * @returns the generated Codex launcher command, proving one was written
 */
export function readCodexDenyLauncher(root: string): string {
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

/** Read generated Codex hook config for event-key assertions.
 *
 * @param root - fixture project root
 * @returns parsed .codex/hooks.json content
 */
export function readCodexHookConfig(root: string): unknown {
  return JSON.parse(
    readFileSync(join(root, ".codex", "hooks.json"), "utf-8"),
  ) as unknown;
}

/** Assert generated Codex output stays within goat-flow's current supported surface.
 *
 * @param root - fixture project root
 */
export function assertCodexPreToolUseOnly(root: string): void {
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

/** Writes a Claude hook-capable fixture and return the generated deny launcher.
 *
 * @param root - fixture project root
 * @returns the installed hook path, ready for a newer-stamp overwrite attempt
 */
export function installClaudeDenyHook(root: string): string {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
  applyHookState(HOOK_IDENTIFIER, true, root);
  return readClaudeDenyLauncher(root);
}

/** Install a Codex deny hook without requiring the fixture root to be a Git repository.
 *
 * @param root - fixture project root
 * @returns generated Codex launcher command, ready for literal execution
 */
export function installCodexDenyHook(root: string): string {
  mkdirSync(join(root, ".codex"), { recursive: true });
  writeFileSync(join(root, ".codex", "config.toml"), "\n");
  applyHookState(HOOK_IDENTIFIER, true, root);
  return readCodexDenyLauncher(root);
}

/** Corrupt one trusted launcher surface while retaining enough trace to select the candidate. */
export const MANAGED_SHAPE_MUTATIONS: Array<{
  name: string;
  mutate: (root: string) => void;
}> = [
  {
    name: "malformed registration",
    mutate: (root) => writeFileSync(join(root, ".codex", "hooks.json"), "{"),
  },
  {
    name: "registration without requested operands",
    mutate: (root) =>
      writeFileSync(
        join(root, ".codex", "hooks.json"),
        '{"hooks":{"PreToolUse":[{"command":"custom-tool"}]}}\n',
      ),
  },
  {
    name: "missing registration",
    mutate: (root) => rmSync(join(root, ".codex", "hooks.json")),
  },
  {
    name: "non-regular registration",
    mutate: (root) => {
      const registration = join(root, ".codex", "hooks.json");
      rmSync(registration);
      mkdirSync(registration);
    },
  },
  {
    name: "symlinked registration",
    mutate: (root) => {
      const registration = join(root, ".codex", "hooks.json");
      const target = join(root, "registration-target.json");
      writeFileSync(target, readFileSync(registration));
      rmSync(registration);
      symlinkSync(target, registration);
    },
  },
  {
    name: "hard-linked registration",
    mutate: (root) =>
      linkSync(
        join(root, ".codex", "hooks.json"),
        join(root, "registration-second-name.json"),
      ),
  },
  {
    name: "symlinked launcher",
    mutate: (root) => {
      const launcher = join(root, ".goat-flow", "hooks", "run-with-bash.mjs");
      const target = join(root, "launcher-target.mjs");
      writeFileSync(target, readFileSync(launcher));
      rmSync(launcher);
      symlinkSync(target, launcher);
    },
  },
  {
    name: "hard-linked launcher",
    mutate: (root) =>
      linkSync(
        join(root, ".goat-flow", "hooks", "run-with-bash.mjs"),
        join(root, "launcher-second-name.mjs"),
      ),
  },
  {
    name: "missing launcher",
    mutate: (root) =>
      rmSync(join(root, ".goat-flow", "hooks", "run-with-bash.mjs")),
  },
  {
    name: "non-regular launcher",
    mutate: (root) => {
      const launcher = join(root, ".goat-flow", "hooks", "run-with-bash.mjs");
      rmSync(launcher);
      mkdirSync(launcher);
    },
  },
  {
    name: "symlinked requested script",
    mutate: (root) => {
      const script = join(root, ".goat-flow", "hooks", "deny-dangerous.sh");
      const target = join(root, "script-target.sh");
      writeFileSync(target, readFileSync(script));
      rmSync(script);
      symlinkSync(target, script);
    },
  },
  {
    name: "hard-linked requested script",
    mutate: (root) =>
      linkSync(
        join(root, ".goat-flow", "hooks", "deny-dangerous.sh"),
        join(root, "script-second-name.sh"),
      ),
  },
  {
    name: "missing requested script",
    mutate: (root) =>
      rmSync(join(root, ".goat-flow", "hooks", "deny-dangerous.sh")),
  },
  {
    name: "non-regular requested script",
    mutate: (root) => {
      const script = join(root, ".goat-flow", "hooks", "deny-dangerous.sh");
      rmSync(script);
      mkdirSync(script);
    },
  },
];

/** One hook entry as the registrar writes it into an agent's config file. */
export type GeneratedHookEntry = { hooks?: Array<{ command?: string }> };

/** Flatten generated hook entries into command strings for fixture assertions.
 *
 * @param entries - generated hook entries read back from config; empty means none were written
 * @returns the command strings in registration order; empty means no hooks
 */
export function generatedHookCommands(
  entries: GeneratedHookEntry[] = [],
): string[] {
  return entries.flatMap(({ hooks = [] }) =>
    hooks.map(({ command = "" }) => command),
  );
}

/** Read generated Claude gruff hook commands because settings nest hooks by event and matcher.
 *
 * @param settingsJson - raw .claude/settings.json text as the registrar wrote it
 * @returns gruff hook commands registered for Claude; empty means not enabled
 */
export function readClaudeGruffCommands(settingsJson: string): string[] {
  const config = JSON.parse(settingsJson) as {
    hooks?: {
      PostToolUse?: GeneratedHookEntry[];
    };
  };
  return generatedHookCommands(config.hooks?.PostToolUse);
}

/** Read the generated Antigravity gruff hook command because hooks are grouped by hook id.
 *
 * @param hooksJson - raw hooks.json text as the registrar wrote it
 * @returns the single Antigravity gruff command; missing entries fail loudly
 */
export function readAntigravityGruffCommand(hooksJson: string): string {
  const config = JSON.parse(hooksJson) as {
    "gruff-code-quality"?: {
      PostToolUse?: GeneratedHookEntry[];
    };
  };
  return (
    generatedHookCommands(config["gruff-code-quality"]?.PostToolUse)[0] ?? ""
  );
}

/** Read matcherless Stop hook commands from Claude/Codex-style hook config.
 *
 * @param settingsJson - raw .claude/settings.json text as the registrar wrote it
 * @returns Stop hook commands registered for Claude; empty means none
 */
export function readStopHookCommands(settingsJson: string): string[] {
  const config = JSON.parse(settingsJson) as {
    hooks?: {
      Stop?: GeneratedHookEntry[];
    };
  };
  return generatedHookCommands(config.hooks?.Stop);
}

/** Read one generated Antigravity Stop hook command by goat-flow hook id.
 *
 * @param hooksJson - raw hooks.json text as the registrar wrote it
 * @param hookId - hook identifier the entry is registered under
 * @returns the Stop command registered under the hook id; absence fails loudly
 */
export function readAntigravityStopCommand(
  hooksJson: string,
  hookId: string,
): string {
  const config = JSON.parse(hooksJson) as Record<
    string,
    { Stop?: GeneratedHookEntry[] } | undefined
  >;
  return generatedHookCommands(config[hookId]?.Stop)[0] ?? "";
}

/** Read the generated Antigravity post-turn safety command.
 *
 * @param hooksJson - raw hooks.json text as the registrar wrote it
 * @returns the post-turn safety command; absence fails loudly
 */
export function readAntigravitySafetyCommand(hooksJson: string): string {
  return readAntigravityStopCommand(hooksJson, "post-turn-safety");
}

/** Writes agent surfaces that make post-turn hook registration applicable in a fixture.
 *
 * @param root - fixture project root
 */
export function writePostTurnCapableSurfaces(root: string): void {
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

/** Execute the generated Claude launcher with a runtime-shaped payload.
 *
 * @param command - generated launcher command line to execute
 * @param cwd - working directory the process runs in
 * @param payload - hook JSON delivered on stdin, as an agent host would send it
 * @param env - extra environment merged onto the process env; absent means the plain env
 * @returns the finished launcher process with captured streams
 */
export function runLauncherWithPayload(
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

/** Execute the generated Claude launcher with a runtime-shaped payload.
 *
 * @param command - generated launcher command line to execute
 * @param cwd - working directory the process runs in
 * @param payload - hook JSON delivered on stdin; defaults to the safe Claude payload
 * @param env - extra environment merged onto the process env; absent means the plain env
 * @returns the finished launcher process for the Claude payload shape
 */
export function runClaudeLauncher(
  command: string,
  cwd: string,
  payload = CLAUDE_SAFE_PAYLOAD,
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof spawnSync> {
  return runLauncherWithPayload(command, cwd, payload, env);
}

/** Assert the generated launcher allows a benign payload from this cwd.
 *
 * @param command - generated launcher command line to execute
 * @param cwd - working directory the process runs in
 */
export function assertLauncherAllows(command: string, cwd: string): void {
  const result = runClaudeLauncher(command, cwd);
  assert.equal(
    result.status,
    0,
    `launcher should allow benign payload\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
}

/** Execute the generated Codex launcher with a runtime-shaped payload.
 *
 * @param command - generated launcher command line to execute
 * @param cwd - working directory the process runs in
 * @param payload - hook JSON delivered on stdin; defaults to the safe Codex payload
 * @returns the finished launcher process for the Codex payload shape
 */
export function runCodexLauncher(
  command: string,
  cwd: string,
  payload = CLAUDE_SAFE_PAYLOAD,
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof spawnSync> {
  return runLauncherWithPayload(command, cwd, payload, env);
}

/** Render one captured launcher result for assertion failures. */
export function launcherDiagnostics(
  result: ReturnType<typeof spawnSync>,
): string {
  return `status=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}
