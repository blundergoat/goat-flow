/**
 * Check the selected agent's deny mechanism at the evidence level requested by the caller.
 *
 * Static checks inspect installed files, settings, and JavaScript syntax without running the target's hook policy.
 * Explicit full evidence also executes the target's self-test and configured hook path; passing proves local behavior, not external agent delivery.
 */
import * as childProcess from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { AUDIT_VERSION } from "../constants.js";
import { getTemplatePath } from "../paths.js";
import { listHookSpecs } from "../server/hooks-registry.js";
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

// Retain the existing per-host smoke budget while switching the policy runtime.
const DENY_POLICY_SMOKE_TIMEOUT_MS =
  process.platform === "win32" ? 120_000 : 30_000;

const LEGACY_DENY_HOOK_FILES = [
  "guard-common.sh",
  "guard-destructive-shell.sh",
  "guard-secret-paths.sh",
  "guard-repository-writes.sh",
  "guardrails-self-test.sh",
  "deny-dangerous.self-test.sh",
];

const DENY_HOOK_TEMPLATE_FILES = [
  ...new Set(
    listHookSpecs()
      .filter(
        (hook) =>
          hook.id === "deny-dangerous" || hook.id === "deny-git-mutations",
      )
      .flatMap((hook) => hook.scriptFiles),
  ),
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
    if (
      agentFacts.agent.hooksDir &&
      (!agentFacts.hooks.gitDenyExists || !agentFacts.hooks.gitDenyIsRegistered)
    ) {
      return {
        check: "Agent deny mechanism",
        message: `Missing or unregistered deny-git-mutations policy for ${agentFacts.agent.id}`,
        howToFix:
          "Run goat-flow hooks sync, then verify both deny-hook and git-mutations-hook with --trusted-target.",
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
 * List the agent's native hooks for syntax checks; unreadable directories recover as an empty list.
 *
 * @param ctx - read-only target filesystem supplying the installed hook names
 * @param hooksDir - agent hook directory; a missing or unreadable directory supplies no syntax-check candidates
 * @returns - native filenames to check, or an empty list when no readable native hooks were found
 */
function listNativeHookFiles(ctx: AuditContext, hooksDir: string): string[] {
  try {
    return ctx.fs
      .listDir(hooksDir)
      .filter((hookFilename) => hookFilename.endsWith(".mjs"));
  } catch {
    // A caller's filesystem adapter may reject an unreadable hook directory; return no candidates and leave setup gaps to presence checks.
    return [];
  }
}

/**
 * Spawns the selected runtime to parse one hook without executing its policy.
 * Reports launch restrictions separately because a runtime that never started provides no syntax verdict.
 *
 * @param ctx - target project root used to locate the installed hook on disk
 * @param hooksDir - project-relative directory containing the selected agent's hook
 * @param hookFilename - installed native .mjs filename
 * @returns - syntax result or launch failure; an unavailable runtime receives repair guidance
 */
export function checkHookFileSyntax(
  ctx: AuditContext,
  hooksDir: string,
  hookFilename: string,
): HookSyntaxCheckResult {
  const hookPath = `${hooksDir}/${hookFilename}`;
  // Syntax checks read the actual project file; an in-memory adapter alone cannot supply parser evidence.
  const hookAbsolutePath = join(ctx.projectPath, hooksDir, hookFilename);
  if (!hookFilename.endsWith(".mjs") || !existsSync(hookAbsolutePath)) {
    return {
      status: "spawn-failure",
      failure: {
        check: "Agent deny mechanism",
        message: `Native syntax check requires an existing .mjs hook: ${hookPath}`,
        evidence: evidencePath(hookPath),
        howToFix: "Install the native hook before checking its syntax.",
      },
    };
  }
  try {
    runHookNode(["--check", hookAbsolutePath], 5000);
    return { status: "ok" };
  } catch (error) {
    return classifyHookSyntaxFailure(error, hookPath);
  }
}

/** Spawns Node with literal native-check arguments; throws launch, timeout and nonzero-exit failures for audit classification. */
function runHookNode(
  args: string[],
  timeout: number,
  env: NodeJS.ProcessEnv = process.env,
): void {
  childProcess.execFileSync(process.execPath, args, {
    env,
    stdio: "pipe",
    timeout,
  });
}

/** Distinguish a rejected hook from a Node process that could not inspect it. */
function classifyHookSyntaxFailure(
  error: unknown,
  hookPath: string,
): HookSyntaxCheckResult {
  // A recorded zero exit still proves syntax acceptance even if the process API also returned an error object.
  if (commandCompletedSuccessfully(error)) return { status: "ok" };
  const spawnFailure = spawnFailureFor(
    error,
    `node syntax check for ${hookPath}`,
    "node",
  );
  // Launch restrictions need environment repair rather than edits to a hook that Node could not inspect.
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

/**
 * Spawns syntax checks for installed native hooks and reports the files the user must repair.
 * Unreadable directories recover as no candidates; a launch failure stops the scan with environment guidance.
 *
 * @param ctx - included agents and target filesystem used to find native hooks
 * @returns - launch or syntax failure, or null when scanned hooks parse successfully or none were available
 */
function checkHookSyntax(ctx: AuditContext): AuditFailure | null {
  const failures: string[] = [];
  // Inspect each included agent's native hooks so its syntax failures identify the installation that needs repair.
  for (const agentFacts of ctx.agents) {
    // Agents without a hook directory have no native files for this syntax check.
    if (!agentFacts.agent.hooksDir) continue;
    const hooksDir = agentFacts.agent.hooksDir;
    // A custom native hook can break independently of the deny dispatcher, so inspect every listed native file.
    for (const hookFilename of listNativeHookFiles(ctx, hooksDir)) {
      const result = checkHookFileSyntax(ctx, hooksDir, hookFilename);
      // A blocked Node process leaves later syntax checks unproven, so return the environment issue immediately.
      if (result.status === "spawn-failure") return result.failure;
      // Collect parse failures so one audit message can name all hook files that need editing.
      if (result.status === "syntax-error") failures.push(result.path);
    }
  }
  // No scanned hook failed parsing; missing hook installation remains the presence check's responsibility.
  if (failures.length === 0) return null;
  return {
    check: "Agent deny mechanism",
    message: `node --check failed: ${failures.join(", ")}`,
    evidence: failures[0],
    howToFix: `Fix the JavaScript syntax errors in ${failures.join(", ")}. Run \`node --check <file>\` to see details.`,
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
    // Agents without hook files have no versioned hook installation to compare.
    if (!hooksDir) continue;
    const legacyFailure = checkLegacyHookDrift(
      ctx,
      agentFacts.agent.id,
      hooksDir,
    );
    // Retired hook files take priority because the user must migrate that layout before checking current template parity.
    if (legacyFailure) return legacyFailure;

    const denyRelPath = join(hooksDir, "deny-dangerous.mjs");
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
 * Spawns one deny self-test and classifies its result for the selected dispatcher.
 * Reports an explicit failure when an installed native dispatcher is unavailable.
 */
function checkDispatcherSelfTest(
  ctx: AuditContext,
  agentId: string,
  dispatcherRelPath: string,
): AuditFailure | null {
  const hookId = basename(dispatcherRelPath, ".mjs");
  if (ctx.fs.readFile(dispatcherRelPath) === null) {
    return {
      check: "Agent deny mechanism",
      message: `Native self-test dispatcher is unavailable: ${dispatcherRelPath}`,
      evidence: evidencePath(dispatcherRelPath),
      howToFix: "Run goat-flow hooks sync to install the native policy hook.",
    };
  }
  try {
    runHookNode(
      [join(ctx.projectPath, dispatcherRelPath), "--self-test=smoke"],
      DENY_POLICY_SMOKE_TIMEOUT_MS,
    );
    return null;
  } catch (error) {
    return classifyHookSelfTestFailure(error, {
      agentId,
      hookId,
      denyRelPath: dispatcherRelPath,
      runtime: "node",
      suffix: ".mjs",
    });
  }
}

/** Preserve completed exits and separate launcher failures from failed policy self-tests. */
function classifyHookSelfTestFailure(
  error: unknown,
  invocation: {
    agentId: string;
    hookId: string;
    denyRelPath: string;
    runtime: "bash" | "node";
    suffix: string;
  },
): AuditFailure | null {
  if (commandCompletedSuccessfully(error)) return null;
  const { agentId, hookId, denyRelPath, runtime, suffix } = invocation;
  const spawnFailure = spawnFailureFor(
    error,
    `${hookId} self-test for ${agentId}`,
    runtime,
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
    message: `${hookId} self-test --self-test=smoke failed for ${agentId}`,
    evidence: evidencePath(denyRelPath),
    howToFix: `Run ${runtime} .goat-flow/hooks/${hookId}${suffix} --self-test=smoke to see which cases fail.`,
  };
}

/**
 * Spawns deny self-tests after the caller authorizes target execution; shared dispatchers run once.
 * Each installed policy dispatcher runs its own native smoke corpus.
 *
 * @param ctx - selected project and included agents whose dispatchers the self-test must exercise
 * @returns first self-test or environment failure, or null when every selected dispatcher passes
 */
export function checkHookSelfTest(ctx: AuditContext): AuditFailure | null {
  const suffix = ".mjs";
  const testedDispatchers = new Set<string>();
  for (const agentFacts of ctx.agents) {
    for (const hookId of ["deny-dangerous", "deny-git-mutations"]) {
      if (!agentFacts.agent.hooksDir) continue;
      const dispatcherRelPath = join(
        agentFacts.agent.hooksDir,
        `${hookId}${suffix}`,
      );
      const dispatcherPath = join(ctx.projectPath, dispatcherRelPath);
      if (testedDispatchers.has(dispatcherPath)) continue;
      testedDispatchers.add(dispatcherPath);
      const failure = checkDispatcherSelfTest(
        ctx,
        agentFacts.agent.id,
        dispatcherRelPath,
      );
      if (failure !== null) return failure;
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
    // Return the first static repair before considering target policy execution; Node syntax checks parse without running the hook.
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
