/**
 * Composes setup prompts from audit results and project facts.
 * Routes by project state: bare/partial → full setup guide,
 * v0.9/outdated → upgrade redirect, current → audit-driven pass/fail.
 */
import type { AuditReport, CheckResult } from "../audit/types.js";
import type { AgentId, ProjectFacts } from "../types.js";
import { loadManifest } from "../manifest/manifest.js";
import { PROFILES } from "../detect/agents.js";
import { getTemplatePath, getCliCommand } from "../paths.js";

/**
 * Forward-slash version of a packaged template path, suitable for embedding
 * in user-visible setup prompts. `getTemplatePath` returns OS-native paths
 * (backslashes on Windows); they render as ugly backslash strings to the
 * agent and break test assertions that compare against POSIX shapes.
 */
function displayTemplatePath(relative: string): string {
  return getTemplatePath(relative).replace(/\\/g, "/");
}
import { classifyProjectState } from "../classify-state.js";
import { createFS } from "../facts/fs.js";
import { resolve } from "node:path";

/** Return `.` when projectRoot is the cwd, otherwise the absolute path. */
function targetArg(projectRoot: string): string {
  return resolve(projectRoot) === resolve(process.cwd())
    ? "."
    : resolve(projectRoot);
}

/** Public one-command installer users can run from any project. */
function installCommand(projectRoot: string, agentId: AgentId): string {
  return `npx @blundergoat/goat-flow@latest install ${targetArg(projectRoot)} --agent ${agentId}`;
}

// ----------------------------------------------------------------
// Setup-step references
// ----------------------------------------------------------------

/** Maps audit check IDs to the setup step that fixes them. */
const CHECK_TO_STEP: Record<string, string> = {
  lessons: "Step 05 (customise to project)",
  footguns: "Step 05 (customise to project)",
  architecture: "Step 04 (architecture and code map)",
  "code-map": "Step 04 (architecture and code map)",
  glossary: "Step 05 (customise to project)",
  patterns: "Step 05 (customise to project)",
  decisions: "Step 04 (architecture and code map)",
  "session-logs": "Step 04 (architecture and code map)",
  tasks: "Step 04 (architecture and code map)",
  "other-files": "Step 02 (instruction file) or Step 04 (architecture)",
  "config-parses": "Step 02 or Step 05 (config.yaml)",
  "config-version": "Step 05 (config version field)",
  "agent-instruction": "Step 02 (instruction file for agent)",
  "agent-skills": "Step 03 (install skills)",
  "agent-settings": "Step 05 (customise - settings file)",
  "agent-guardrails": "Step 05 (customise - deny mechanism)",
};

/** Lookup from agent ID to its agent-specific setup guide. */
const SETUP_FILES: Record<AgentId, string> = {
  claude: "workflow/setup/agents/claude.md",
  codex: "workflow/setup/agents/codex.md",
  antigravity: "workflow/setup/agents/antigravity.md",
  copilot: "workflow/setup/agents/copilot.md",
};

type DenyMechanismEvidenceLevel = "full" | "static" | "present-only";

function usesLimitedDenyEvidence(
  evidenceLevel: DenyMechanismEvidenceLevel | undefined,
): boolean {
  return evidenceLevel === "static" || evidenceLevel === "present-only";
}

function auditPassHeadline(
  evidenceLevel: DenyMechanismEvidenceLevel | undefined,
): string {
  return usesLimitedDenyEvidence(evidenceLevel)
    ? "Dashboard setup checks pass."
    : "All audit checks pass.";
}

function auditPassInstallLine(
  evidenceLevel: DenyMechanismEvidenceLevel | undefined,
): string {
  if (!usesLimitedDenyEvidence(evidenceLevel)) {
    return "- Audit: all build checks passing";
  }
  const label = evidenceLevel === "present-only" ? "presence-only" : "static";
  return `- Audit: ${label} setup checks passing; runtime deny-hook probes not run`;
}

// ----------------------------------------------------------------
// Mode: Audit pass (current version, all build checks passing)
// ----------------------------------------------------------------

function renderAuditPass(
  facts: ProjectFacts,
  agentId: AgentId,
  evidenceLevel?: DenyMechanismEvidenceLevel,
): string {
  const profile = PROFILES[agentId];
  const agentFacts = facts.agents.find((af) => af.agent.id === agentId);
  const lines: string[] = [];

  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push("");
  lines.push(auditPassHeadline(evidenceLevel));
  lines.push("");

  if (agentFacts) {
    const skillCount = agentFacts.skills.found.length;
    const totalSkills = loadManifest().facts.skills.total;
    const hookScripts: string[] = [];
    if (agentFacts.hooks.denyExists) hookScripts.push("deny");
    if (agentFacts.hooks.postTurnExists) hookScripts.push("post-turn");
    const hooksDir = profile.hooksDir ?? "hooks";

    lines.push("**Installed:**");
    lines.push(
      `- ${skillCount}/${totalSkills} skills installed (in ${profile.skillsDir}/)`,
    );
    if (hookScripts.length > 0) {
      lines.push(
        `- ${hookScripts.length} hook scripts (${hookScripts.join(", ")}) in ${hooksDir}/`,
      );
    }
    lines.push(auditPassInstallLine(evidenceLevel));
    lines.push("");
  }

  lines.push("**Run now:**");
  lines.push(
    `Run \`goat-flow audit ${targetArg(facts.root)} --harness --agent ${agentId}\` and report the per-concern scores. This is the harness verification gate - do not skip it.`,
  );
  lines.push("");
  lines.push("**Maintenance:**");
  lines.push(
    "- After upgrading goat-flow, re-run `goat-flow audit` to check for new checks",
  );
  lines.push("- Run `goat-flow audit` in CI to catch drift");
  lines.push(
    "- Review `.goat-flow/learning-loop/footguns/` and `.goat-flow/learning-loop/lessons/` after incidents",
  );

  return lines.join("\n");
}

function renderHarnessCardPass(
  facts: ProjectFacts,
  agentId: AgentId,
  evidenceLevel?: DenyMechanismEvidenceLevel,
): string {
  const profile = PROFILES[agentId];
  const lines: string[] = [];

  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push("");
  lines.push(auditPassHeadline(evidenceLevel));
  lines.push("");
  lines.push("The harness-scored Setup card is passing for this target agent.");
  lines.push("");
  lines.push("**Run now:**");
  lines.push(
    `Run \`${rerunAuditCommand(facts, agentId, true)}\` and report the per-concern scores. This is the harness verification gate - do not skip it.`,
  );
  lines.push("");
  lines.push("**Maintenance:**");
  lines.push(
    "- After upgrading goat-flow, re-run the dashboard Re-audit action to refresh card-scoped setup prompts",
  );

  return lines.join("\n");
}

// ----------------------------------------------------------------
// Mode: Audit fail (current version, some build checks failing)
// ----------------------------------------------------------------

type SetupPromptScope = "full" | "harness-card";

/** Options that narrow setup prompt output for a full prompt or dashboard harness card. */
interface ComposeSetupOptions {
  promptScope?: SetupPromptScope;
  denyMechanismEvidenceLevel?: DenyMechanismEvidenceLevel;
}

function auditStatusForPrompt(
  auditReport: AuditReport,
  promptScope: SetupPromptScope,
): "pass" | "fail" {
  if (promptScope === "harness-card") {
    return auditReport.scopes.harness?.status ?? auditReport.status;
  }
  return auditReport.status;
}

function failedChecksForPrompt(
  auditReport: AuditReport,
  promptScope: SetupPromptScope,
): CheckResult[] {
  const isPromptFailure = (c: CheckResult): boolean =>
    c.status === "fail" &&
    c.failure !== undefined &&
    !c.acknowledged &&
    c.type !== "metric";

  if (promptScope === "harness-card") {
    return auditReport.scopes.harness?.checks.filter(isPromptFailure) ?? [];
  }
  return [
    ...auditReport.scopes.setup.checks.filter(isPromptFailure),
    ...auditReport.scopes.agent.checks.filter(isPromptFailure),
    ...(auditReport.scopes.harness?.checks.filter(isPromptFailure) ?? []),
  ];
}

function rerunAuditCommand(
  facts: ProjectFacts,
  agentId: AgentId,
  includeHarness: boolean,
): string {
  const scopeFlag = includeHarness ? " --harness" : "";
  return `${getCliCommand()} audit ${targetArg(facts.root)}${scopeFlag} --agent ${agentId}`;
}

/** Build the audit command shown in generated setup prompts for the selected agent. */
function auditCommand(facts: ProjectFacts, agentId: AgentId): string {
  return `${getCliCommand()} audit ${targetArg(facts.root)} --agent ${agentId}`;
}

/** Build the harness audit command variant used by setup follow-up instructions. */
function harnessAuditCommand(facts: ProjectFacts, agentId: AgentId): string {
  return `${getCliCommand()} audit ${targetArg(facts.root)} --agent ${agentId} --harness`;
}

function pushFinalSetupGate(
  lines: string[],
  facts: ProjectFacts,
  agentId: AgentId,
): void {
  lines.push("**Audit:** Run both required setup gates:");
  lines.push(`- \`${auditCommand(facts, agentId)}\``);
  lines.push(`- \`${harnessAuditCommand(facts, agentId)}\``);
  lines.push("");
  lines.push("**Target: both audits pass with zero failures.**");
  lines.push(
    `If either audit fails, run \`${getCliCommand()} setup ${targetArg(facts.root)} --agent ${agentId}\` for remaining fix instructions, then re-run both audit gates. Repeat until both pass (max 3 cycles).`,
  );
}

function promptIncludesHarness(
  auditReport: AuditReport,
  promptScope: SetupPromptScope,
): boolean {
  return (
    promptScope === "harness-card" ||
    auditReport.harness ||
    auditReport.scopes.harness !== null
  );
}

function renderAuditFail(
  auditReport: AuditReport,
  facts: ProjectFacts,
  agentId: AgentId,
  promptScope: SetupPromptScope,
): string {
  const profile = PROFILES[agentId];
  const lines: string[] = [];

  const failedChecks = failedChecksForPrompt(auditReport, promptScope);
  const includeHarness = promptIncludesHarness(auditReport, promptScope);

  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push("");
  lines.push(
    `${failedChecks.length} audit ${failedChecks.length === 1 ? "check" : "checks"} failed:`,
  );
  lines.push("");

  let num = 1;
  for (const check of failedChecks) {
    const failure = check.failure;
    if (!failure) continue;
    const step = CHECK_TO_STEP[check.id] ?? "relevant setup step";

    lines.push(`${num++}. **${failure.check}** - FAIL`);
    lines.push(`   ${failure.message}`);
    if (failure.evidence) lines.push(`   Evidence: ${failure.evidence}`);
    if (failure.howToFix) {
      lines.push(`   Fix: ${failure.howToFix} (see ${step})`);
    } else {
      lines.push(`   See ${step}`);
    }
    lines.push("");
  }

  lines.push(`**Target: audit passes with zero failures.**`);
  lines.push(
    `Re-run: \`${rerunAuditCommand(facts, agentId, includeHarness)}\``,
  );
  lines.push(
    `If audit fails, run \`${getCliCommand()} setup ${targetArg(facts.root)} --agent ${agentId}\` for fix instructions. Repeat until audit passes (max 3 cycles).`,
  );

  return lines.join("\n");
}

/** Select only setup failures because upgrade prompts should not include passing or warning checks. */
function failedInstallChecks(auditReport: AuditReport): CheckResult[] {
  return [
    ...auditReport.scopes.setup.checks.filter((c) => c.status === "fail"),
    ...auditReport.scopes.agent.checks.filter((c) => c.status === "fail"),
  ];
}

function pushDetectedInstallIssues(
  lines: string[],
  auditReport: AuditReport,
): void {
  const failures = failedInstallChecks(auditReport).filter(
    (check) => check.failure !== undefined,
  );
  if (failures.length === 0) return;

  lines.push("## Detected install issues");
  lines.push("");
  for (const check of failures) {
    const failure = check.failure;
    if (!failure) continue;
    lines.push(`- **${failure.check}:** ${failure.message}`);
    if (failure.evidence) lines.push(`  Evidence: ${failure.evidence}`);
    if (failure.howToFix) lines.push(`  Fix: ${failure.howToFix}`);
  }
  lines.push("");
}

function renderUpgradeRedirect(
  auditReport: AuditReport,
  facts: ProjectFacts,
  agentId: AgentId,
  state: "v0.9" | "outdated",
  detectedVersion?: string,
): string {
  const profile = PROFILES[agentId];
  const lines: string[] = [];

  if (state === "outdated") {
    lines.push(`# GOAT Flow Upgrade - ${profile.name}`);
    lines.push("");
    lines.push(
      detectedVersion
        ? `This project has goat-flow ${detectedVersion}.`
        : "This project has an older goat-flow version.",
    );
    lines.push("");

    pushDetectedInstallIssues(lines, auditReport);

    lines.push("## Step 1 - Install files");
    lines.push("");
    lines.push(`Run: \`${installCommand(facts.root, agentId)}\``);
    lines.push("");
    lines.push(
      "This refreshes skills, hooks, settings, and reference files to the current version.",
    );
    lines.push("");

    lines.push("## Step 2 - Rebuild project-specific content");
    lines.push("");
    lines.push(
      `Continue with \`${displayTemplatePath("workflow/setup/02-instruction-file.md")}\` and then the remaining numbered setup docs to refresh the instruction file and local goat-flow content in place.`,
    );
  } else {
    lines.push(`# GOAT Flow Migration - ${profile.name}`);
    lines.push("");
    lines.push("This project has old goat-flow skills (v0.9 era).");
    lines.push("");

    pushDetectedInstallIssues(lines, auditReport);

    lines.push("## Step 1 - Install current files");
    lines.push("");
    lines.push(`Run: \`${installCommand(facts.root, agentId)}\``);
    lines.push("");
    lines.push(
      `This installs the ${loadManifest().facts.skills.total} canonical skills, hooks, settings, and reference files.`,
    );
    lines.push("");

    lines.push("## Step 2 - Remove legacy surfaces");
    lines.push("");
    lines.push(
      `If the install step above did not already run with \`--clean-deprecated\`, run \`${installCommand(facts.root, agentId)} --clean-deprecated\` to remove deprecated skill directories. Preserve any useful content in \`.goat-flow/logs/sessions/\`, then remove any remaining flat learning-loop docs and legacy task-state files.`,
    );
    lines.push("");

    lines.push("## Step 3 - Rebuild project-specific content");
    lines.push("");
    lines.push(
      `Continue with \`${displayTemplatePath("workflow/setup/02-instruction-file.md")}\` and then the remaining numbered setup docs to rebuild the project-specific goat-flow surfaces on the current layout.`,
    );
  }

  lines.push("");
  lines.push(`## ${state === "outdated" ? "Step 3" : "Step 4"} - Verify`);
  lines.push("");
  pushFinalSetupGate(lines, facts, agentId);

  return lines.join("\n");
}

/** Render the full setup prompt for bare/partial projects because no targeted repair path exists yet. */
function renderFullSetup(facts: ProjectFacts, agentId: AgentId): string {
  const profile = PROFILES[agentId];
  const setupFile = displayTemplatePath(SETUP_FILES[agentId]);
  const lines: string[] = [];

  const agentFacts = facts.agents.find((af) => af.agent.id === agentId);
  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push("");
  if (agentFacts) {
    lines.push(
      `This project has setup issues - it needs a full setup pass. Run \`${getCliCommand()} audit ${targetArg(facts.root)}\` after fixing to verify.`,
    );
  } else {
    lines.push(
      `No ${profile.name} configuration detected - this project needs a full setup.`,
    );
  }
  lines.push("");

  lines.push(
    'Do NOT copy customization templates (architecture, footguns, code-map) verbatim. If a template says "[describe X]", describe X for THIS project. Skill SKILL.md files ARE installed verbatim - this rule applies to Step 04-05 artifacts only.',
  );
  lines.push("");

  lines.push("## Step 1 - Install files");
  lines.push("");
  lines.push(`Run: \`${installCommand(facts.root, agentId)}\``);
  lines.push("");
  lines.push(
    "This deterministically copies skills, hooks, settings, and reference files. It does not require an agent. Verify it completes with zero errors.",
  );
  lines.push("");

  lines.push("## Step 2 - Create project-specific content");
  lines.push("");
  lines.push(
    `Read \`${setupFile}\` for agent-specific paths, then follow the setup steps in \`${displayTemplatePath("workflow/setup/")}\` one at a time:`,
  );
  lines.push("");
  lines.push(
    "- **01-system-overview.md** - Design intent, state check, session-log setup",
  );
  lines.push(
    "- **02-instruction-file.md** - Create or update the instruction file",
  );
  lines.push(
    "- **04-architecture-code-map.md** - Create architecture and code map docs",
  );
  lines.push(
    "- **05-customise-to-project.md** - Deep codebase read, real footguns/lessons, auto-seeded git signals, and project-specific instruction refinement",
  );
  lines.push(
    "- **06-final-verification.md** - Audit passes, stale-ref check, file manifest, command smoke test",
  );
  lines.push("");
  lines.push(
    "Each step is self-contained with a verification gate. Complete one step before moving to the next.",
  );
  lines.push("");

  lines.push("## Step 3 - Verify");
  lines.push("");
  pushFinalSetupGate(lines, facts, agentId);

  return lines.join("\n");
}

// ----------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------

const FULL_SETUP_STATES = new Set(["bare", "partial", "error"]);
const UPGRADE_STATES = new Set(["v0.9", "outdated"]);

/**
 * Compose the setup prompt that matches the project's current install state.
 *
 * @param auditReport - current audit result used to select failure/upgrade/full setup copy
 * @param facts - project facts used to derive installed state and prompt paths
 * @param agentId - agent whose setup instructions should be rendered
 * @param options - optional output scope and deny-mechanism evidence hint
 * @returns setup prompt text, or null when no setup action applies
 */
export function composeSetup(
  auditReport: AuditReport,
  facts: ProjectFacts,
  agentId: AgentId,
  options: ComposeSetupOptions = {},
): string | null {
  const projectFS = createFS(facts.root);
  const projectState = classifyProjectState(projectFS, agentId);
  const promptScope = options.promptScope ?? "full";

  if (
    FULL_SETUP_STATES.has(projectState.state) ||
    projectState.action === "incomplete"
  ) {
    return renderFullSetup(facts, agentId);
  }
  if (UPGRADE_STATES.has(projectState.state)) {
    return renderUpgradeRedirect(
      auditReport,
      facts,
      agentId,
      projectState.state as "v0.9" | "outdated",
      projectState.version,
    );
  }
  if (auditStatusForPrompt(auditReport, promptScope) === "pass") {
    return promptScope === "harness-card"
      ? renderHarnessCardPass(
          facts,
          agentId,
          options.denyMechanismEvidenceLevel,
        )
      : renderAuditPass(facts, agentId, options.denyMechanismEvidenceLevel);
  }
  return renderAuditFail(auditReport, facts, agentId, promptScope);
}
