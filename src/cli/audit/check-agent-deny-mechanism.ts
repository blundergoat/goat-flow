/**
 * Audit checks for each agent's dangerous-command deny mechanism (concern 4). Verifies that a deny
 * guard is present, that any hook scripts pass `bash -n`, and that deny patterns are registered -
 * accepting both file-based and config-based mechanisms because agents satisfy the contract in
 * different ways. Some checks spawn `bash` and copy fixture hooks to a real path, so this file owns
 * the bridge from the in-memory audit FS to the actual workspace the shell needs.
 */
import * as childProcess from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { AUDIT_VERSION } from "../constants.js";
import { getTemplatePath } from "../paths.js";
import type { AuditContext, AuditFailure, BuildCheck } from "./types.js";
import {
  checkSelectedInstructionAvailable,
  incidentProvenance,
} from "./check-agent-common.js";

// === 4. Agent Deny Mechanism ===

const LEGACY_DENY_HOOK_FILES = [
  "guard-common.sh",
  "guard-destructive-shell.sh",
  "guard-secret-paths.sh",
  "guard-repository-writes.sh",
  "guardrails-self-test.sh",
  "deny-dangerous.self-test.sh",
];

const DENY_HOOK_TEMPLATE_FILES = [
  "deny-dangerous.sh",
  "deny-dangerous/patterns-shell.sh",
  "deny-dangerous/patterns-paths.sh",
  "deny-dangerous/patterns-writes.sh",
  "deny-dangerous/deny-dangerous-self-test.sh",
];

interface SpawnFailure {
  message: string;
  howToFix: string;
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function spawnFailureFor(error: unknown, action: string): SpawnFailure | null {
  const code = errnoCode(error);
  if (code === "EPERM") {
    return {
      message: `${action} could not spawn bash (EPERM: ${errorMessage(error)}). The current sandbox or permission profile blocks child-process execution.`,
      howToFix:
        "Run this audit outside the child-process-restricted sandbox, or use a profile that permits Node child_process to spawn bash.",
    };
  }
  if (code === "ENOENT") {
    return {
      message: `${action} could not spawn bash (ENOENT: ${errorMessage(error)}).`,
      howToFix:
        "Install bash or run the audit in an environment where bash is on PATH.",
    };
  }
  if (code === "ETIMEDOUT") {
    return {
      message: `${action} timed out while spawning bash (${errorMessage(error)}).`,
      howToFix:
        "Re-run the audit with the hook command manually to inspect whether the hook hangs.",
    };
  }
  return null;
}

function completedWithStatus(result: { status?: unknown }): boolean {
  return typeof result.status === "number";
}

function commandCompletedSuccessfully(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 0
  );
}

function spawnFailureFromResult(
  result: childProcess.SpawnSyncReturns<string>,
  action: string,
): SpawnFailure | null {
  if (completedWithStatus(result)) return null;
  return result.error ? spawnFailureFor(result.error, action) : null;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function runtimeSmokeEnv(input: string): NodeJS.ProcessEnv {
  return { ...process.env, GOAT_HOOK_SMOKE_PAYLOAD: input };
}

function pipeSmokePayloadTo(command: string): string {
  return `printf %s "$GOAT_HOOK_SMOKE_PAYLOAD" | { ${command}; }`;
}

/** Check deny-hook presence because unsupported agents and config-based agents need different handling. */
function checkDenyHookPresent(ctx: AuditContext): AuditFailure | null {
  for (const agentFacts of ctx.agents) {
    // Capability-limited agents (e.g. Antigravity at v1.0.1) have no documented
    // deny mechanism upstream. The manifest records this as
    // `denyMechanism: null`; skip the check rather than producing a permanent
    // audit failure that downstream projects cannot fix.
    if (agentFacts.agent.denyMechanism === null) continue;
    if (!agentFacts.hooks.denyExists && !agentFacts.hooks.denyIsConfigBased) {
      return {
        check: "Agent deny mechanism",
        message: `Missing deny mechanism for ${agentFacts.agent.id}`,
        howToFix:
          "Create a deny hook file or add deny patterns to the agent's settings file.",
      };
    }
  }
  return null;
}

/** Check shell syntax; spawns bash and recover from unreadable hook dirs because fixtures may be partial. */
function checkHookSyntax(ctx: AuditContext): AuditFailure | null {
  const failures: string[] = [];
  for (const agentFacts of ctx.agents) {
    if (!agentFacts.agent.hooksDir) continue;
    const hooksDir = agentFacts.agent.hooksDir;
    let files: string[];
    try {
      files = ctx.fs.listDir(hooksDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".sh")) continue;
      // ctx.fs may be backed by an in-memory fixture, but bash -n needs a real workspace path.
      const fullPath = join(ctx.projectPath, hooksDir, file);
      try {
        childProcess.execFileSync("bash", ["-n", fullPath], {
          stdio: "pipe",
          timeout: 5000,
        });
      } catch (error) {
        if (commandCompletedSuccessfully(error)) continue;
        const spawnFailure = spawnFailureFor(
          error,
          `bash syntax check for ${hooksDir}/${file}`,
        );
        if (spawnFailure !== null) {
          return {
            check: "Agent deny mechanism",
            message: spawnFailure.message,
            evidence: evidencePath(`${hooksDir}/${file}`),
            howToFix: spawnFailure.howToFix,
          };
        }
        failures.push(`${hooksDir}/${file}`);
      }
    }
  }
  if (failures.length === 0) return null;
  return {
    check: "Agent deny mechanism",
    message: `bash -n failed: ${failures.join(", ")}`,
    evidence: failures[0],
    howToFix: `Fix the bash syntax errors in ${failures.join(", ")}. Run \`bash -n <file>\` to see details.`,
  };
}

/** Check deny-pattern registration because config and hook based agents satisfy the contract differently. */
function checkDenyPatterns(ctx: AuditContext): AuditFailure | null {
  for (const agentFacts of ctx.agents) {
    // Skip agents with no documented project-local deny mechanism.
    if (agentFacts.agent.denyMechanism === null) continue;
    if (!agentFacts.settings.hasDenyPatterns && !agentFacts.hooks.denyExists) {
      return {
        check: "Agent deny mechanism",
        message: `No deny patterns registered for ${agentFacts.agent.id}`,
        howToFix:
          "Register deny patterns in the agent's settings file or create a deny hook script in the agent's hooks directory.",
      };
    }
  }
  return null;
}

/**
 * Audit evidence paths are user-visible in text/markdown/JSON output. Force
 * forward slashes so Windows and POSIX agree on the rendered shape.
 */
function evidencePath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

function checkLegacyHookDrift(
  ctx: AuditContext,
  agentId: string,
  hooksDir: string,
): AuditFailure | null {
  const candidateDirs = [
    hooksDir,
    ".claude/hooks",
    ".codex/hooks",
    ".agents/hooks",
    ".github/hooks",
  ];
  for (const candidateDir of candidateDirs) {
    for (const legacyFile of LEGACY_DENY_HOOK_FILES) {
      const legacyRelPath = join(candidateDir, legacyFile);
      if (ctx.fs.readFile(legacyRelPath) !== null) {
        return {
          check: "Agent deny mechanism",
          message: `${legacyFile} is a legacy guardrail hook for ${agentId}; migrate to deny-dangerous.sh`,
          evidence: evidencePath(legacyRelPath),
          howToFix: `Re-run \`npx @blundergoat/goat-flow@${AUDIT_VERSION} install . --agent ${agentId}\` to remove legacy guard hooks and install deny-dangerous.sh.`,
        };
      }
    }
  }
  return null;
}

/**
 * Read a canonical hook template's text from the packaged `workflow/hooks/` tree.
 *
 * Swallows read errors and returns null as a fallback when the template is absent or
 * unreadable, so drift checks can treat "no canonical template" and "installed copy
 * differs" as distinct, non-fatal outcomes instead of aborting the whole audit.
 *
 * @param templateFile - path under `workflow/hooks/` (e.g. `deny-dangerous.sh` or `deny-dangerous/patterns-shell.sh`)
 * @returns the template's UTF-8 contents, or null when the file is missing or unreadable
 */
function readHookTemplateContent(templateFile: string): string | null {
  const templatePath = getTemplatePath(`workflow/hooks/${templateFile}`);
  if (!existsSync(templatePath)) return null;
  try {
    return readFileSync(templatePath, "utf-8");
  } catch {
    return null;
  }
}

function installedTemplateRelPath(
  hooksDir: string,
  templateFile: string,
): string {
  return templateFile.startsWith("deny-dangerous/")
    ? join(".goat-flow", "hooks", templateFile)
    : join(hooksDir, templateFile);
}

function checkTemplateDrift(
  ctx: AuditContext,
  agentId: string,
  hooksDir: string,
): AuditFailure | null {
  for (const templateFile of DENY_HOOK_TEMPLATE_FILES) {
    const templateContent = readHookTemplateContent(templateFile);
    if (templateContent === null) continue;
    const installedRelPath = installedTemplateRelPath(hooksDir, templateFile);
    const installed = ctx.fs.readFile(installedRelPath);
    if (installed === null) {
      return {
        check: "Agent deny mechanism",
        message: `${templateFile} is missing for ${agentId}`,
        evidence: evidencePath(installedRelPath),
        howToFix: `Re-run \`npx @blundergoat/goat-flow@${AUDIT_VERSION} install . --agent ${agentId}\` to update the hook files.`,
      };
    }
    if (installed.trimEnd() !== templateContent.trimEnd()) {
      return {
        check: "Agent deny mechanism",
        message: `${templateFile} for ${agentId} differs from the current goat-flow template (v${AUDIT_VERSION})`,
        evidence: evidencePath(installedRelPath),
        howToFix: `Re-run \`npx @blundergoat/goat-flow@${AUDIT_VERSION} install . --agent ${agentId}\` to update the hook files.`,
      };
    }
  }
  return null;
}

/** Compare installed deny hooks against templates; recover from missing templates because installs may be partial. */
function checkHookVersion(ctx: AuditContext): AuditFailure | null {
  for (const agentFacts of ctx.agents) {
    const hooksDir = agentFacts.agent.hooksDir;
    if (!hooksDir) continue;
    const legacyFailure = checkLegacyHookDrift(
      ctx,
      agentFacts.agent.id,
      hooksDir,
    );
    if (legacyFailure) return legacyFailure;

    const denyRelPath = join(hooksDir, "deny-dangerous.sh");
    if (ctx.fs.readFile(denyRelPath) === null) continue;

    const templateFailure = checkTemplateDrift(
      ctx,
      agentFacts.agent.id,
      hooksDir,
    );
    if (templateFailure) return templateFailure;
  }
  return null;
}

/** Run each deny hook self-test; spawns bash and reports failures because static registration is insufficient. */
function checkHookSelfTest(ctx: AuditContext): AuditFailure | null {
  for (const agentFacts of ctx.agents) {
    if (!agentFacts.agent.hooksDir) continue;
    const denyRelPath = join(
      ".goat-flow",
      "hooks",
      "deny-dangerous",
      "deny-dangerous-self-test.sh",
    );
    const content = ctx.fs.readFile(denyRelPath);
    // Config-based deny rules satisfy the deny-mechanism requirement, but only an
    // on-disk shell hook can run the registered self-test.
    if (content === null) continue;
    const denyPath = join(ctx.projectPath, denyRelPath);
    const dispatcherRelPath = join(
      agentFacts.agent.hooksDir,
      "deny-dangerous.sh",
    );
    const dispatcherPath = join(ctx.projectPath, dispatcherRelPath);
    const env =
      ctx.fs.readFile(dispatcherRelPath) === null
        ? process.env
        : { ...process.env, GOAT_DENY_DANGEROUS_HOOK: dispatcherPath };
    try {
      childProcess.execFileSync("bash", [denyPath, "--self-test=smoke"], {
        env,
        stdio: "pipe",
        timeout: 30000,
      });
    } catch (error) {
      if (commandCompletedSuccessfully(error)) continue;
      const spawnFailure = spawnFailureFor(
        error,
        `deny-dangerous self-test for ${agentFacts.agent.id}`,
      );
      if (spawnFailure !== null) {
        return {
          check: "Agent deny mechanism",
          message: spawnFailure.message,
          evidence: evidencePath(denyRelPath),
          howToFix: spawnFailure.howToFix,
        };
      }
      return {
        check: "Agent deny mechanism",
        message: `deny-dangerous-self-test.sh --self-test=smoke failed for ${agentFacts.agent.id}`,
        evidence: evidencePath(denyRelPath),
        howToFix:
          "Run `bash .goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh --self-test=smoke` to see which cases fail.",
      };
    }
  }
  return null;
}

/** Build the per-agent hook payload and expected denial shape for runtime smoke tests. */
function runtimeSmokePayload(agentId: string): {
  input: string;
  expectedStatus: number;
  expectedStream: "stdout" | "stderr";
  expectedPattern: RegExp;
} {
  if (agentId === "copilot") {
    return {
      input:
        '{"toolName":"bash","toolArgs":{"command":"git push origin main"}}',
      expectedStatus: 0,
      expectedStream: "stdout",
      expectedPattern: /"permissionDecision"\s*:\s*"deny"/,
    };
  }
  if (agentId === "antigravity") {
    return {
      input:
        '{"hookEventName":"PreToolUse","toolCall":{"name":"run_command","args":{"CommandLine":"git push origin main"}}}',
      expectedStatus: 0,
      expectedStream: "stdout",
      expectedPattern: /"decision"\s*:\s*"deny"/,
    };
  }
  return {
    input:
      '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}',
    expectedStatus: 2,
    expectedStream: "stderr",
    expectedPattern: /BLOCKED:/,
  };
}

function runtimeSmokePayloadForScript(
  agentId: string,
  scriptFile: string,
): ReturnType<typeof runtimeSmokePayload> {
  const command =
    scriptFile === "deny-dangerous.sh" ||
    scriptFile === "guard-repository-writes.sh"
      ? "git push origin main"
      : scriptFile === "guard-secret-paths.sh"
        ? "cat .env"
        : "rm -rf /";
  const base = runtimeSmokePayload(agentId);
  if (agentId === "copilot") {
    return {
      ...base,
      input: JSON.stringify({
        toolName: "bash",
        toolArgs: { command },
      }),
    };
  }
  if (agentId === "antigravity") {
    return {
      ...base,
      input: JSON.stringify({
        hookEventName: "PreToolUse",
        toolCall: { name: "run_command", args: { CommandLine: command } },
      }),
    };
  }
  return {
    ...base,
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
    }),
  };
}

function registeredDenyRelPath(
  agentFacts: AuditContext["agents"][number],
): string | null {
  if (agentFacts.hooks.denyRegisteredPath)
    return agentFacts.hooks.denyRegisteredPath;
  if (!agentFacts.agent.hooksDir) return null;
  return join(agentFacts.agent.hooksDir, "deny-dangerous.sh");
}

/** Normalize registered hook paths to the same slash style as parsed shell command paths. */
function normalizedRegisteredDenyRelPath(
  agentFacts: AuditContext["agents"][number],
): string | null {
  const registeredPath = registeredDenyRelPath(agentFacts);
  if (registeredPath === null) return null;
  return posix.normalize(
    registeredPath.replace(/\\/gu, "/").replace(/^\.\//u, ""),
  );
}

const CONFIGURED_SMOKE_SCRIPTS = ["deny-dangerous.sh"] as const;

/** Hook command extracted from agent config for runtime-shaped smoke validation. */
interface ConfiguredHookCommand {
  command: string;
  scriptFile: string;
  scriptPath: string | null;
  configPath: string;
}

/** Extract the configured hook script path without executing shell glue from agent config. */
function extractConfiguredScriptPath(
  command: string,
  scriptFile: string,
): string | null {
  const withoutShellComment =
    command.replace(/\\/g, "/").split("#", 1)[0] ?? "";
  for (const candidate of withoutShellComment.match(/[^\s"'`;|&{}]+\.sh/gu) ??
    []) {
    if (posix.basename(candidate) !== scriptFile) continue;
    const withoutRoot = candidate.startsWith("$root/")
      ? candidate.slice("$root/".length)
      : candidate;
    const relative = withoutRoot.replace(/^\.\//, "");
    const normalised = posix.normalize(relative);
    if (
      normalised.startsWith("../") ||
      normalised === ".." ||
      posix.isAbsolute(normalised)
    ) {
      continue;
    }
    return normalised;
  }
  return null;
}

function pushConfiguredCommand(
  commands: ConfiguredHookCommand[],
  command: unknown,
  configPath: string,
): void {
  if (typeof command !== "string" || command.length === 0) return;
  const scriptFile = CONFIGURED_SMOKE_SCRIPTS.find((script) =>
    command.includes(script),
  );
  if (!scriptFile) return;
  commands.push({
    command,
    scriptFile,
    scriptPath: extractConfiguredScriptPath(command, scriptFile),
    configPath,
  });
}

function collectNestedCommandValues(
  value: unknown,
  configPath: string,
  commands: ConfiguredHookCommand[],
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectNestedCommandValues(entry, configPath, commands);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  pushConfiguredCommand(commands, obj.command, configPath);
  pushConfiguredCommand(commands, obj.bash, configPath);
  for (const child of Object.values(obj)) {
    if (typeof child === "object") {
      collectNestedCommandValues(child, configPath, commands);
    }
  }
}

function configuredGuardCommands(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): ConfiguredHookCommand[] {
  const configPath =
    agentFacts.agent.hookConfigFile ?? agentFacts.agent.settingsFile;
  if (!configPath) return [];
  const rawConfig = ctx.fs.readFile(configPath);
  if (rawConfig === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    return [];
  }
  const commands: ConfiguredHookCommand[] = [];
  collectNestedCommandValues(parsed, configPath, commands);
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = `${command.configPath}\0${command.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function configuredHookCommandPathFailure(
  agentFacts: AuditContext["agents"][number],
  configured: ConfiguredHookCommand,
): string | null {
  if (configured.scriptPath === null) {
    return `${agentFacts.agent.id} configured hook command does not name an exact managed hook script path: ${configured.command}`;
  }
  const expectedScriptPath = normalizedRegisteredDenyRelPath(agentFacts);
  if (
    expectedScriptPath !== null &&
    configured.scriptPath !== expectedScriptPath
  ) {
    return `${agentFacts.agent.id} configured hook command points at ${configured.scriptPath}, expected ${expectedScriptPath}: ${configured.command}`;
  }
  return null;
}

function runConfiguredHookCommandSmoke(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
  configured: ConfiguredHookCommand,
): { ok: boolean; message: string; evidence: string; howToFix?: string } {
  const pathFailure = configuredHookCommandPathFailure(agentFacts, configured);
  if (pathFailure !== null) {
    return {
      ok: false,
      message: pathFailure,
      evidence: configured.configPath,
    };
  }
  const smoke = runtimeSmokePayloadForScript(
    agentFacts.agent.id,
    configured.scriptFile,
  );
  // Invoke via `bash -c`, not `-lc`: the agent runtimes run the configured
  // launcher directly without a login shell, so `-lc` would source user rc files
  // and make audit results environment-dependent. `-c` is more faithful to
  // runtime and drops that rc-sourcing surface. This smoke still executes the
  // project-configured launcher string by design (to validate the real
  // root-resolution/cd glue), so the runtime evidence level should only be run
  // against trusted target projects.
  const result = childProcess.spawnSync(
    "bash",
    ["-c", pipeSmokePayloadTo(configured.command)],
    {
      cwd: ctx.projectPath,
      encoding: "utf8",
      env: runtimeSmokeEnv(smoke.input),
      input: "",
      timeout: 5000,
    },
  );
  const spawnFailure = spawnFailureFromResult(
    result,
    `${agentFacts.agent.id} configured hook command for ${configured.scriptFile}`,
  );
  if (spawnFailure !== null) {
    return {
      ok: false,
      message: spawnFailure.message,
      evidence: configured.configPath,
      howToFix: spawnFailure.howToFix,
    };
  }
  const status = result.status ?? (result.error ? -1 : 0);
  if (status === 126 || status === 127) {
    return {
      ok: false,
      message: `${agentFacts.agent.id} configured hook command exited before ${configured.scriptFile} could start (exit ${status}): ${configured.scriptPath}`,
      evidence: configured.configPath,
    };
  }
  const stream =
    smoke.expectedStream === "stdout" ? result.stdout : result.stderr;
  if (status !== smoke.expectedStatus || !smoke.expectedPattern.test(stream)) {
    return {
      ok: false,
      message: `${agentFacts.agent.id} configured hook command did not return the expected deny response for ${configured.scriptFile}: ${configured.scriptPath}`,
      evidence: configured.configPath,
    };
  }
  return { ok: true, message: "", evidence: configured.configPath };
}

function runDirectHookRuntimeSmoke(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
  denyRelPath: string,
): { ok: boolean; message?: string; howToFix?: string } {
  const smoke = runtimeSmokePayload(agentFacts.agent.id);
  const command = pipeSmokePayloadTo(
    `bash ${shellSingleQuote(join(ctx.projectPath, denyRelPath))}`,
  );
  const result = childProcess.spawnSync("bash", ["-c", command], {
    cwd: ctx.projectPath,
    encoding: "utf8",
    env: runtimeSmokeEnv(smoke.input),
    input: "",
    timeout: 5000,
  });
  const spawnFailure = spawnFailureFromResult(
    result,
    `registered deny hook runtime smoke for ${agentFacts.agent.id}`,
  );
  if (spawnFailure !== null) {
    return { ok: false, ...spawnFailure };
  }

  const status = result.status ?? (result.error ? -1 : 0);
  const stream =
    smoke.expectedStream === "stdout" ? result.stdout : result.stderr;
  return {
    ok: status === smoke.expectedStatus && smoke.expectedPattern.test(stream),
  };
}

function configuredHookRuntimeFailure(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): AuditFailure | null | undefined {
  const configuredCommands = configuredGuardCommands(ctx, agentFacts);
  if (configuredCommands.length === 0) return undefined;
  for (const configured of configuredCommands) {
    const result = runConfiguredHookCommandSmoke(ctx, agentFacts, configured);
    if (result.ok) continue;
    return {
      check: "Agent deny mechanism",
      message: result.message,
      evidence: evidencePath(result.evidence),
      howToFix:
        result.howToFix ??
        "Run the configured hook command with a runtime-shaped payload and confirm it reaches the managed hook script without exit 126/127.",
    };
  }
  return null;
}

function directHookRuntimeFailure(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
): AuditFailure | null {
  const denyRelPath = registeredDenyRelPath(agentFacts);
  if (denyRelPath === null) return null;
  const content = ctx.fs.readFile(denyRelPath);
  if (content === null) return null;

  const directSmoke = runDirectHookRuntimeSmoke(ctx, agentFacts, denyRelPath);
  if (directSmoke.ok) return null;

  return {
    check: "Agent deny mechanism",
    message:
      directSmoke.message ??
      `registered deny hook runtime smoke failed for ${agentFacts.agent.id}`,
    evidence: evidencePath(denyRelPath),
    howToFix:
      directSmoke.howToFix ??
      "Run the registered deny hook with a runtime-shaped Bash payload and confirm it denies `git push origin main`.",
  };
}

/** Run a runtime-shaped blocked payload because configured commands and direct hooks fail differently. */
function checkHookRuntimeSmoke(ctx: AuditContext): AuditFailure | null {
  for (const agentFacts of ctx.agents) {
    const configuredFailure = configuredHookRuntimeFailure(ctx, agentFacts);
    if (configuredFailure !== undefined) return configuredFailure;

    const directFailure = directHookRuntimeFailure(ctx, agentFacts);
    if (directFailure !== null) return directFailure;
  }
  return null;
}

export const agentDenyMechanism: BuildCheck = {
  id: "agent-guardrails",
  name: "Agent deny mechanism",
  scope: "agent",
  provenance: incidentProvenance([
    ".goat-flow/learning-loop/footguns/auditor.md",
    ".goat-flow/learning-loop/footguns/hooks.md",
  ]),
  /** Run the Agent deny mechanism check. */
  run: (ctx) => {
    if (!ctx.agentFilter) return null;
    const blocked = checkSelectedInstructionAvailable(
      ctx,
      "Agent deny mechanism",
    );
    if (blocked) return blocked;
    if (ctx.denyMechanismEvidenceLevel === "present-only") {
      return checkDenyHookPresent(ctx);
    }
    // Order the checks from cheapest/static to most expensive/runtime so we stop on
    // the clearest failure before attempting shell execution.
    const staticFailure =
      checkDenyHookPresent(ctx) ??
      checkHookSyntax(ctx) ??
      checkDenyPatterns(ctx) ??
      checkHookVersion(ctx);

    if (ctx.denyMechanismEvidenceLevel === "static") {
      return staticFailure;
    }

    return (
      staticFailure ?? checkHookSelfTest(ctx) ?? checkHookRuntimeSmoke(ctx)
    );
  },
};
