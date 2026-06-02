/**
 * Audit checks for each agent's dangerous-command deny mechanism (concern 4). Verifies that a deny
 * guard is present, that any hook scripts pass `bash -n`, and that deny patterns are registered -
 * accepting both file-based and config-based mechanisms because agents satisfy the contract in
 * different ways. Some checks spawn `bash` and copy fixture hooks to a real path, so this file owns
 * the bridge from the in-memory audit FS to the actual workspace the shell needs.
 */
import { execFileSync, spawnSync } from "node:child_process";
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
  "hook-lib/patterns-shell.sh",
  "hook-lib/patterns-paths.sh",
  "hook-lib/patterns-writes.sh",
  "hook-lib/deny-dangerous-self-test.sh",
];

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
        execFileSync("bash", ["-n", fullPath], {
          stdio: "pipe",
          timeout: 5000,
        });
      } catch {
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
  for (const legacyFile of LEGACY_DENY_HOOK_FILES) {
    const legacyRelPath = join(hooksDir, legacyFile);
    if (ctx.fs.readFile(legacyRelPath) !== null) {
      return {
        check: "Agent deny mechanism",
        message: `${legacyFile} is a legacy guardrail hook for ${agentId}; migrate to deny-dangerous.sh`,
        evidence: evidencePath(legacyRelPath),
        howToFix: `Re-run \`npx @blundergoat/goat-flow@${AUDIT_VERSION} install . --agent ${agentId}\` to remove legacy guard hooks and install deny-dangerous.sh.`,
      };
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
 * @param templateFile - path under `workflow/hooks/` (e.g. `deny-dangerous.sh` or `hook-lib/patterns-shell.sh`)
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
  return templateFile.startsWith("hook-lib/")
    ? join(".goat-flow", templateFile)
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
      "hook-lib",
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
      execFileSync("bash", [denyPath, "--self-test=smoke"], {
        env,
        stdio: "pipe",
        timeout: 30000,
      });
    } catch {
      return {
        check: "Agent deny mechanism",
        message: `deny-dangerous-self-test.sh --self-test=smoke failed for ${agentFacts.agent.id}`,
        evidence: evidencePath(denyRelPath),
        howToFix:
          "Run `bash .goat-flow/hook-lib/deny-dangerous-self-test.sh --self-test=smoke` to see which cases fail.",
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

const CONFIGURED_SMOKE_SCRIPTS = ["deny-dangerous.sh"] as const;

/** Hook command extracted from agent config for runtime-shaped smoke validation. */
interface ConfiguredHookCommand {
  command: string;
  scriptFile: string;
  scriptPath: string | null;
  configPath: string;
}

/** Extract the configured guard script path without executing shell glue from agent config. */
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

function runConfiguredHookCommandSmoke(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
  configured: ConfiguredHookCommand,
): { ok: boolean; message: string; evidence: string } {
  if (configured.scriptPath === null) {
    return {
      ok: false,
      message: `${agentFacts.agent.id} configured hook command does not name an exact guard script path: ${configured.command}`,
      evidence: configured.configPath,
    };
  }
  const smoke = runtimeSmokePayloadForScript(
    agentFacts.agent.id,
    configured.scriptFile,
  );
  const result = spawnSync("bash", ["-lc", configured.command], {
    cwd: ctx.projectPath,
    encoding: "utf8",
    input: smoke.input,
    timeout: 5000,
  });
  const status = result.status ?? (result.error ? -1 : 0);
  if (status === 126 || status === 127) {
    return {
      ok: false,
      message: `${agentFacts.agent.id} configured hook script exited ${status}: ${configured.scriptPath}`,
      evidence: configured.configPath,
    };
  }
  const stream =
    smoke.expectedStream === "stdout" ? result.stdout : result.stderr;
  if (status !== smoke.expectedStatus || !smoke.expectedPattern.test(stream)) {
    return {
      ok: false,
      message: `${agentFacts.agent.id} configured hook script did not deny ${configured.scriptFile}: ${configured.scriptPath}`,
      evidence: configured.configPath,
    };
  }
  return { ok: true, message: "", evidence: configured.configPath };
}

function runDirectHookRuntimeSmoke(
  ctx: AuditContext,
  agentFacts: AuditContext["agents"][number],
  denyRelPath: string,
): boolean {
  const smoke = runtimeSmokePayload(agentFacts.agent.id);
  const result = spawnSync("bash", [join(ctx.projectPath, denyRelPath)], {
    cwd: ctx.projectPath,
    encoding: "utf8",
    input: smoke.input,
    timeout: 5000,
  });

  const status = result.status ?? (result.error ? -1 : 0);
  const stream =
    smoke.expectedStream === "stdout" ? result.stdout : result.stderr;
  return status === smoke.expectedStatus && smoke.expectedPattern.test(stream);
}

/** Run a runtime-shaped blocked payload because configured commands and direct hooks fail differently. */
function checkHookRuntimeSmoke(ctx: AuditContext): AuditFailure | null {
  for (const agentFacts of ctx.agents) {
    const configuredCommands = configuredGuardCommands(ctx, agentFacts);
    if (configuredCommands.length > 0) {
      for (const configured of configuredCommands) {
        const result = runConfiguredHookCommandSmoke(
          ctx,
          agentFacts,
          configured,
        );
        if (result.ok) continue;
        return {
          check: "Agent deny mechanism",
          message: result.message,
          evidence: evidencePath(result.evidence),
          howToFix:
            "Run the configured guard script path with a runtime-shaped payload and confirm it reaches the guard script without exit 126/127.",
        };
      }
      continue;
    }

    const denyRelPath = registeredDenyRelPath(agentFacts);
    if (denyRelPath === null) continue;
    const content = ctx.fs.readFile(denyRelPath);
    if (content === null) continue;

    if (runDirectHookRuntimeSmoke(ctx, agentFacts, denyRelPath)) continue;

    return {
      check: "Agent deny mechanism",
      message: `registered deny hook runtime smoke failed for ${agentFacts.agent.id}`,
      evidence: evidencePath(denyRelPath),
      howToFix:
        "Run the registered deny hook with a runtime-shaped Bash payload and confirm it denies `git push origin main`.",
    };
  }
  return null;
}

export const agentDenyMechanism: BuildCheck = {
  id: "agent-guardrails",
  name: "Agent deny mechanism",
  scope: "agent",
  provenance: incidentProvenance([
    ".goat-flow/footguns/auditor.md",
    ".goat-flow/footguns/hooks.md",
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
