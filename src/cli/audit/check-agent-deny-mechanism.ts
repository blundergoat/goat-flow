/**
 * Check the selected agent's deny mechanism at the evidence level requested by the caller.
 *
 * Static checks inspect installed files, settings, and Bash syntax without running the target's hook policy.
 * Explicit full evidence also executes the target's self-test and configured hook path; passing proves local behavior, not external agent delivery.
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
  targetUsesNewerGoatFlow,
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

// Check deny-hook presence because unsupported agents and config-based agents need different handling.
function checkDenyHookPresent(ctx: AuditContext): AuditFailure | null {
  // Each included agent may provide deny protection through a hook file or its settings.
  for (const agentFacts of ctx.agents) {
    // A null capability means this agent has no supported deny mechanism the project owner could install.
    if (agentFacts.agent.denyMechanism === null) continue;
    // Neither supported installation form is present, so the report asks the user to add deny protection.
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

/**
 * List the agent's shell hooks for syntax checks; unreadable directories recover as an empty list.
 *
 * @param ctx - read-only target filesystem supplying the installed hook names
 * @param hooksDir - agent hook directory; a missing or unreadable directory supplies no syntax-check candidates
 * @returns - shell filenames to check, or an empty list when no readable shell hooks were found
 */
function listShellHookFiles(ctx: AuditContext, hooksDir: string): string[] {
  try {
    return ctx.fs
      .listDir(hooksDir)
      .filter((hookFilename) => hookFilename.endsWith(".sh"));
  } catch {
    // A caller's filesystem adapter may reject an unreadable hook directory; return no candidates and leave setup gaps to presence checks.
    return [];
  }
}

/**
 * Spawns Bash to parse one installed hook so users learn about syntax errors before relying on its protection.
 * Reports launch restrictions separately because a shell that never started provides no syntax verdict.
 *
 * @param ctx - target project root used to locate the installed hook on disk
 * @param hooksDir - project-relative directory containing the selected agent's hook
 * @param hookFilename - shell filename found in that directory
 * @returns - syntax result or launch failure; unavailable Bash receives environment repair guidance
 */
function checkHookFileSyntax(
  ctx: AuditContext,
  hooksDir: string,
  hookFilename: string,
): HookSyntaxCheckResult {
  const hookPath = `${hooksDir}/${hookFilename}`;
  // Bash reads the actual project file; an in-memory audit adapter alone cannot supply the shell's syntax evidence.
  const hookAbsolutePath = join(ctx.projectPath, hooksDir, hookFilename);
  try {
    childProcess.execFileSync("bash", ["-n", hookAbsolutePath], {
      stdio: "pipe",
      timeout: 5000,
    });
    return { status: "ok" };
  } catch (error) {
    // An edited hook can fail parsing; a missing shell or sandbox restriction can instead prevent Bash from starting.
    // A recorded zero exit still proves syntax acceptance even if the process API also returned an error object.
    if (commandCompletedSuccessfully(error)) return { status: "ok" };
    const spawnFailure = spawnFailureFor(
      error,
      `bash syntax check for ${hookPath}`,
    );
    // Launch restrictions need environment repair rather than edits to a hook that Bash could not inspect.
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

/**
 * Spawns syntax checks for installed shell hooks and reports the files the user must repair.
 * Unreadable directories recover as no candidates; a launch failure stops the scan with environment guidance.
 *
 * @param ctx - included agents and target filesystem used to find shell hooks
 * @returns - launch or syntax failure, or null when scanned hooks parse successfully or none were available
 */
function checkHookSyntax(ctx: AuditContext): AuditFailure | null {
  const failures: string[] = [];
  // Inspect each included agent's shell hooks so its syntax failures identify the installation that needs repair.
  for (const agentFacts of ctx.agents) {
    // Agents without a hook directory have no shell files for this syntax check.
    if (!agentFacts.agent.hooksDir) continue;
    const hooksDir = agentFacts.agent.hooksDir;
    // A custom shell hook can break independently of the deny dispatcher, so inspect every listed shell file.
    for (const hookFilename of listShellHookFiles(ctx, hooksDir)) {
      const result = checkHookFileSyntax(ctx, hooksDir, hookFilename);
      // A blocked shell leaves later syntax checks unproven, so return the environment issue immediately.
      if (result.status === "spawn-failure") return result.failure;
      // Collect parse failures so one audit message can name all hook files that need editing.
      if (result.status === "syntax-error") failures.push(result.path);
    }
  }
  // No scanned hook failed parsing; missing hook installation remains the presence check's responsibility.
  if (failures.length === 0) return null;
  return {
    check: "Agent deny mechanism",
    message: `bash -n failed: ${failures.join(", ")}`,
    evidence: failures[0],
    howToFix: `Fix the bash syntax errors in ${failures.join(", ")}. Run \`bash -n <file>\` to see details.`,
  };
}

// Check deny-pattern registration because config and hook based agents satisfy the contract differently.
function checkDenyPatterns(ctx: AuditContext): AuditFailure | null {
  // Registration can be represented by settings or a hook file, depending on the selected agent.
  for (const agentFacts of ctx.agents) {
    // Skip agents with no documented project-local deny mechanism.
    if (agentFacts.agent.denyMechanism === null) continue;
    // Neither settings nor an installed hook supplies deny rules the project owner can rely on.
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
 * Report hook scripts left behind by an older layout, which would otherwise sit unused while the user assumes they still run.
 *
 * @param ctx - audit context supplying the target filesystem
 * @param agentId - agent whose hook directory is being audited
 * @param hooksDir - project-relative hooks directory for that agent
 * @returns the failure to show the user, or null when no legacy copies remain
 */
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
  // Old agent-specific directories may survive a move to shared hooks, so include those locations in migration findings.
  for (const candidateDir of candidateDirs) {
    // Recognized retired filenames identify the old guardrail layout the installer can replace.
    for (const legacyFile of LEGACY_DENY_HOOK_FILES) {
      const legacyRelPath = join(candidateDir, legacyFile);
      // Only a readable retired file supplies evidence for this migration finding; an absent file needs no cleanup.
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
 * Read a shipped hook template for comparison with the selected project's installed copy.
 * Swallows read failures into null so unavailable package evidence does not become an invented content mismatch.
 *
 * @param templateFile - source path under workflow/hooks, such as the dispatcher or one of its shared policy files
 * @returns - canonical UTF-8 text, or null when the package file is missing or unreadable
 */
function readHookTemplateContent(templateFile: string): string | null {
  const templatePath = getTemplatePath(`workflow/hooks/${templateFile}`);
  // Without the canonical package file, this comparison cannot tell the user whether their installed copy differs.
  if (!existsSync(templatePath)) return null;
  try {
    return readFileSync(templatePath, "utf-8");
  } catch {
    // An upgrade can remove the package file between lookup and read; omit that comparison instead of aborting the audit.
    return null;
  }
}

/**
 * Work out where one shipped hook template lives once installed, since the policy files sit in a shared directory rather than the agent's own.
 *
 * @param hooksDir - project-relative hooks directory for the agent being audited
 * @param templateFile - template path as shipped
 * @returns the project-relative installed path to compare against
 */
function installedTemplateRelPath(
  hooksDir: string,
  templateFile: string,
): string {
  // Policy modules install once under the shared hook directory; the dispatcher stays at the agent's configured hook path.
  return templateFile.startsWith("deny-dangerous/")
    ? join(".goat-flow", "hooks", templateFile)
    : join(hooksDir, templateFile);
}

/**
 * Report missing or differing installed hook files so the user can review their protection against this release's templates.
 *
 * @param ctx - audit context supplying the target filesystem
 * @param agentId - agent whose hook directory is being audited
 * @param hooksDir - project-relative hooks directory for that agent
 * @returns - first missing or differing installed file, or null when every available template matches or no template was readable
 */
function checkTemplateDrift(
  ctx: AuditContext,
  agentId: string,
  hooksDir: string,
): AuditFailure | null {
  // Check the dispatcher and its policy files together so an incomplete upgrade cannot hide behind one current file.
  for (const templateFile of DENY_HOOK_TEMPLATE_FILES) {
    const templateContent = readHookTemplateContent(templateFile);
    // Missing package evidence leaves this file unverified; there is no canonical content to compare with the user's copy.
    if (templateContent === null) continue;
    const installedRelPath = installedTemplateRelPath(hooksDir, templateFile);
    const installed = ctx.fs.readFile(installedRelPath);
    // The package supplies this required hook file, but the selected project's copy cannot be read.
    if (installed === null) {
      return {
        check: "Agent deny mechanism",
        message: `${templateFile} is missing for ${agentId}`,
        evidence: evidencePath(installedRelPath),
        howToFix: `Re-run \`npx @blundergoat/goat-flow@${AUDIT_VERSION} install . --agent ${agentId}\` to update the hook files.`,
      };
    }
    // Differences beyond trailing whitespace mean the user is running hook content that does not match this release.
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

// Compare installed deny hooks against templates; recover from missing templates because installs may be partial.
function checkHookVersion(ctx: AuditContext): AuditFailure | null {
  // Compare each included agent's hook layout with the files shipped by this CLI release.
  for (const agentFacts of ctx.agents) {
    const hooksDir = agentFacts.agent.hooksDir;
    // Agents without hook files have no versioned shell installation to compare.
    if (!hooksDir) continue;
    const legacyFailure = checkLegacyHookDrift(
      ctx,
      agentFacts.agent.id,
      hooksDir,
    );
    // Retired hook files take priority because the user must migrate that layout before checking current template parity.
    if (legacyFailure) return legacyFailure;

    const denyRelPath = join(hooksDir, "deny-dangerous.sh");
    // Without a readable dispatcher, this agent has no current hook installation to compare; presence checks report that gap.
    if (ctx.fs.readFile(denyRelPath) === null) continue;

    const templateFailure = checkTemplateDrift(
      ctx,
      agentFacts.agent.id,
      hooksDir,
    );
    // Stop at the first concrete template repair so the next audit can assess the corrected installation.
    if (templateFailure) return templateFailure;
  }
  return null;
}

/**
 * Spawns the installed deny self-test only after the caller requested full target-hook evidence.
 * Reports a failed local policy test or launch restriction; success does not prove external-agent hook delivery.
 *
 * @param ctx - target project and included agents whose installed dispatcher can be supplied to the self-test
 * @returns - self-test or environment failure, or null when runnable tests pass or no self-test file was readable
 */
function checkHookSelfTest(ctx: AuditContext): AuditFailure | null {
  // Test each included agent against its dispatcher so a shared policy test checks the installed entry point users invoke.
  for (const agentFacts of ctx.agents) {
    // An agent without a shell hook directory cannot supply a dispatcher for this test.
    if (!agentFacts.agent.hooksDir) continue;
    const denyRelPath = join(
      ".goat-flow",
      "hooks",
      "deny-dangerous",
      "deny-dangerous-self-test.sh",
    );
    const content = ctx.fs.readFile(denyRelPath);
    // A missing or unreadable self-test provides no runtime verdict; only an installed shell test can be executed.
    if (content === null) continue;
    const denyPath = join(ctx.projectPath, denyRelPath);
    const dispatcherRelPath = join(
      agentFacts.agent.hooksDir,
      "deny-dangerous.sh",
    );
    const dispatcherPath = join(ctx.projectPath, dispatcherRelPath);
    // When a dispatcher exists, the shared self-test must exercise that agent's installed entry point instead of its default.
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
      // A user-edited deny policy can fail its self-test; a missing shell or sandbox restriction may stop the test before it runs.
      // A recorded zero exit means the self-test completed successfully despite the process API's error object.
      if (commandCompletedSuccessfully(error)) continue;
      const spawnFailure = spawnFailureFor(
        error,
        `deny-dangerous self-test for ${agentFacts.agent.id}`,
      );
      // Launch failures point the user at their environment instead of claiming that the hook policy itself failed.
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
  // Template parity and bundled smoke expectations are not authoritative for a newer hook release.
  skip: targetUsesNewerGoatFlow,
  // Check the selected agent's deny installation, adding target-hook execution only when full evidence was explicitly requested.
  run: (ctx) => {
    // Aggregate reports leave agent-specific protection to a selected-agent audit.
    if (!ctx.agentFilter) return null;
    const instructionFailure = checkSelectedInstructionAvailable(
      ctx,
      "Agent deny mechanism",
    );
    // Restore the selected instruction file before reporting deeper deny-installation problems.
    if (instructionFailure) return instructionFailure;
    // Presence-only callers need an installation answer without shell parsing, template checks, or hook execution.
    if (ctx.denyMechanismEvidenceLevel === "present-only") {
      return checkDenyHookPresent(ctx);
    }
    // Return the first static repair before considering target policy execution; Bash syntax checks parse without running the hook.
    const staticFailure =
      checkDenyHookPresent(ctx) ??
      checkHookSyntax(ctx) ??
      checkDenyPatterns(ctx) ??
      checkHookVersion(ctx);

    // Omitted evidence stays static by contract; only explicit full evidence permits the target's self-test or configured launcher.
    if (ctx.denyMechanismEvidenceLevel !== "full") {
      return staticFailure;
    }

    return (
      staticFailure ?? checkHookSelfTest(ctx) ?? checkHookRuntimeSmoke(ctx)
    );
  },
};
