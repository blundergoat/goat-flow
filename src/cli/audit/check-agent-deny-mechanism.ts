/**
 * Audit checks for each agent's dangerous-command deny mechanism (concern 4). Verifies that a deny
 * guard is present, that any hook scripts pass `bash -n`, and that deny patterns are registered -
 * accepting both file-based and config-based mechanisms because agents satisfy the contract in
 * different ways. Some checks spawn `bash` and copy fixture hooks to a real path, so this file owns
 * the bridge from the in-memory audit FS to the actual workspace the shell needs. The runtime
 * smoke that replays a blocked payload through configured launchers and the registered hook
 * lives in check-agent-deny-runtime.ts; this file composes both halves into the BuildCheck.
 */
import * as childProcess from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_VERSION } from "../constants.js";
import { getTemplatePath } from "../paths.js";
import type { AuditContext, AuditFailure, BuildCheck } from "./types.js";
import {
  checkSelectedInstructionAvailable,
  incidentProvenance,
} from "./check-agent-common.js";
import {
  checkHookRuntimeSmoke,
  commandCompletedSuccessfully,
  evidencePath,
  spawnFailureFor,
} from "./check-agent-deny-runtime.js";

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

type HookSyntaxCheckResult =
  | { status: "ok" }
  | { status: "syntax-error"; path: string }
  | { status: "spawn-failure"; failure: AuditFailure };

/** List shell hook files and swallows unreadable fixture dirs the same way the audit check always has. */
function listShellHookFiles(ctx: AuditContext, hooksDir: string): string[] {
  try {
    return ctx.fs.listDir(hooksDir).filter((file) => file.endsWith(".sh"));
  } catch {
    return [];
  }
}

/** Spawn bash syntax validation for one hook and map process failures into audit evidence. */
function checkHookFileSyntax(
  ctx: AuditContext,
  hooksDir: string,
  file: string,
): HookSyntaxCheckResult {
  const hookPath = `${hooksDir}/${file}`;
  // ctx.fs may be backed by an in-memory fixture, but bash -n needs a real workspace path.
  const fullPath = join(ctx.projectPath, hooksDir, file);
  try {
    childProcess.execFileSync("bash", ["-n", fullPath], {
      stdio: "pipe",
      timeout: 5000,
    });
    return { status: "ok" };
  } catch (error) {
    if (commandCompletedSuccessfully(error)) return { status: "ok" };
    const spawnFailure = spawnFailureFor(
      error,
      `bash syntax check for ${hookPath}`,
    );
    if (spawnFailure !== null) {
      return {
        status: "spawn-failure",
        failure: {
          check: "Agent deny mechanism",
          message: spawnFailure.message,
          evidence: evidencePath(hookPath),
          howToFix: spawnFailure.howToFix,
        },
      };
    }
    return { status: "syntax-error", path: hookPath };
  }
}

/** Check shell syntax; spawns bash and recover from unreadable hook dirs because fixtures may be partial. */
function checkHookSyntax(ctx: AuditContext): AuditFailure | null {
  const failures: string[] = [];
  for (const agentFacts of ctx.agents) {
    if (!agentFacts.agent.hooksDir) continue;
    const hooksDir = agentFacts.agent.hooksDir;
    for (const file of listShellHookFiles(ctx, hooksDir)) {
      const result = checkHookFileSyntax(ctx, hooksDir, file);
      if (result.status === "spawn-failure") return result.failure;
      if (result.status === "syntax-error") failures.push(result.path);
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

export const agentDenyMechanism: BuildCheck = {
  id: "agent-guardrails",
  name: "Agent deny mechanism",
  scope: "agent",
  provenance: incidentProvenance([
    ".goat-flow/learning-loop/footguns/auditor.md",
    ".goat-flow/learning-loop/footguns/hook-installation.md",
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
