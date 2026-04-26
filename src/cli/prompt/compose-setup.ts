/**
 * Composes setup prompts from audit results and project facts.
 * Routes by project state: bare/partial → full setup guide,
 * v0.9/outdated → upgrade redirect, current → audit-driven pass/fail.
 */
import type { AuditReport } from "../audit/types.js";
import type { AgentId, ProjectFacts } from "../types.js";
import { loadManifest } from "../manifest/manifest.js";
import { PROFILES } from "../detect/agents.js";
import { getTemplatePath, getCliCommand } from "../paths.js";
import { classifyProjectState } from "../classify-state.js";
import { createFS } from "../facts/fs.js";
import { resolve } from "node:path";

/** Return `.` when projectRoot is the cwd, otherwise the absolute path. */
function targetArg(projectRoot: string): string {
  return resolve(projectRoot) === resolve(process.cwd())
    ? "."
    : resolve(projectRoot);
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
  "agent-deny-dangerous": "Step 05 (customise - deny mechanism)",
};

/** Lookup from agent ID to its agent-specific setup guide. */
const SETUP_FILES: Record<AgentId, string> = {
  claude: "workflow/setup/agents/claude.md",
  codex: "workflow/setup/agents/codex.md",
  gemini: "workflow/setup/agents/gemini.md",
  copilot: "workflow/setup/agents/copilot.md",
};

// ----------------------------------------------------------------
// Mode: Audit pass (current version, all build checks passing)
// ----------------------------------------------------------------

function renderAuditPass(facts: ProjectFacts, agentId: AgentId): string {
  const profile = PROFILES[agentId];
  const agentFacts = facts.agents.find((af) => af.agent.id === agentId);
  const lines: string[] = [];

  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push("");
  lines.push("All audit checks pass.");
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
    lines.push("- Audit: all build checks passing");
    lines.push("");
  }

  lines.push("**Next step (recommended):**");
  lines.push(
    `- Run \`goat-flow audit ${targetArg(facts.root)} --harness\` for AI harness completeness checks across 5 concerns (context, constraints, verification, recovery, feedback loop). Pass/fail integrity gate - CI-safe.`,
  );
  lines.push("");
  lines.push("**Maintenance:**");
  lines.push(
    "- After upgrading goat-flow, re-run `goat-flow audit` to check for new checks",
  );
  lines.push("- Run `goat-flow audit` in CI to catch drift");
  lines.push(
    "- Review `.goat-flow/footguns/` and `.goat-flow/lessons/` after incidents",
  );

  return lines.join("\n");
}

// ----------------------------------------------------------------
// Mode: Audit fail (current version, some build checks failing)
// ----------------------------------------------------------------

function renderAuditFail(
  auditReport: AuditReport,
  facts: ProjectFacts,
  agentId: AgentId,
): string {
  const profile = PROFILES[agentId];
  const lines: string[] = [];

  const failedChecks = [
    ...auditReport.scopes.setup.checks.filter((c) => c.status === "fail"),
    ...auditReport.scopes.agent.checks.filter((c) => c.status === "fail"),
  ];

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
    `Re-run: \`${getCliCommand()} audit ${targetArg(facts.root)} --agent ${agentId}\``,
  );
  lines.push(
    `If audit fails, run \`${getCliCommand()} setup ${targetArg(facts.root)} --agent ${agentId}\` for fix instructions. Repeat until audit passes (max 3 cycles).`,
  );

  return lines.join("\n");
}

// ----------------------------------------------------------------
// Mode: Upgrade redirect (v0.9 or outdated projects)
// ----------------------------------------------------------------

function renderUpgradeRedirect(
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

    lines.push("## Step 1 - Install files");
    lines.push("");
    lines.push(
      `Run: \`bash ${getTemplatePath("workflow/install-goat-flow.sh")} ${targetArg(facts.root)} --agent ${agentId}\``,
    );
    lines.push("");
    lines.push(
      "This refreshes skills, hooks, settings, and reference files to the current version.",
    );
    lines.push("");

    lines.push("## Step 2 - Rebuild project-specific content");
    lines.push("");
    lines.push(
      `Continue with \`${getTemplatePath("workflow/setup/02-instruction-file.md")}\` and then the remaining numbered setup docs to refresh the instruction file and local goat-flow content in place.`,
    );
  } else {
    lines.push(`# GOAT Flow Migration - ${profile.name}`);
    lines.push("");
    lines.push("This project has old goat-flow skills (v0.9 era).");
    lines.push("");

    lines.push("## Step 1 - Install current files");
    lines.push("");
    lines.push(
      `Run: \`bash ${getTemplatePath("workflow/install-goat-flow.sh")} ${targetArg(facts.root)} --agent ${agentId}\``,
    );
    lines.push("");
    lines.push(
      `This installs the ${loadManifest().facts.skills.total} canonical skills, hooks, settings, and reference files.`,
    );
    lines.push("");

    lines.push("## Step 2 - Remove legacy surfaces manually");
    lines.push("");
    lines.push(
      "Preserve any useful content in `.goat-flow/logs/sessions/`, then remove stale skill directories, flat learning-loop docs, and legacy task-state files if they still exist.",
    );
    lines.push("");

    lines.push("## Step 3 - Rebuild project-specific content");
    lines.push("");
    lines.push(
      `Continue with \`${getTemplatePath("workflow/setup/02-instruction-file.md")}\` and then the remaining numbered setup docs to rebuild the project-specific goat-flow surfaces on the current layout.`,
    );
  }

  lines.push("");
  lines.push(`## ${state === "outdated" ? "Step 3" : "Step 4"} - Verify`);
  lines.push("");
  lines.push(
    `**Audit:** Run \`${getCliCommand()} audit ${targetArg(facts.root)} --agent ${agentId}\``,
  );
  lines.push("");
  lines.push("**Target: audit passes with zero failures.**");
  lines.push(
    `If audit fails, run \`${getCliCommand()} setup ${targetArg(facts.root)} --agent ${agentId}\` for remaining fix instructions. Repeat until audit passes (max 3 cycles).`,
  );

  return lines.join("\n");
}

// ----------------------------------------------------------------
// Mode: Full setup (bare or partial projects)
// ----------------------------------------------------------------

function renderFullSetup(facts: ProjectFacts, agentId: AgentId): string {
  const profile = PROFILES[agentId];
  const setupFile = getTemplatePath(SETUP_FILES[agentId]);
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
  lines.push(
    `Run: \`bash ${getTemplatePath("workflow/install-goat-flow.sh")} ${targetArg(facts.root)} --agent ${agentId}\``,
  );
  lines.push("");
  lines.push(
    "This installs skills, hooks, settings, and reference files. Verify it completes with zero errors.",
  );
  lines.push("");

  lines.push("## Step 2 - Create project-specific content");
  lines.push("");
  lines.push(
    `Read \`${setupFile}\` for agent-specific paths, then follow the setup steps in \`${getTemplatePath("workflow/setup/")}\` one at a time:`,
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

  lines.push(
    `**Audit:** Run \`${getCliCommand()} audit ${targetArg(facts.root)} --agent ${agentId}\``,
  );
  lines.push("");
  lines.push("**Target: audit passes with zero failures.**");
  lines.push(
    `If audit fails, run \`${getCliCommand()} setup ${targetArg(facts.root)} --agent ${agentId}\` for remaining fix instructions. Repeat until audit passes (max 3 cycles).`,
  );

  return lines.join("\n");
}

// ----------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------

/** Compose the setup prompt that matches the project's current install state. */
export function composeSetup(
  auditReport: AuditReport,
  facts: ProjectFacts,
  agentId: AgentId,
): string | null {
  const projectFS = createFS(facts.root);
  const projectState = classifyProjectState(projectFS, agentId);

  if (
    projectState.state === "bare" ||
    projectState.state === "partial" ||
    projectState.state === "error"
  ) {
    return renderFullSetup(facts, agentId);
  }
  if (projectState.state === "v0.9" || projectState.state === "outdated") {
    return renderUpgradeRedirect(
      facts,
      agentId,
      projectState.state,
      projectState.version,
    );
  }
  // Current version: audit-driven
  if (auditReport.status === "pass") {
    return renderAuditPass(facts, agentId);
  }
  return renderAuditFail(auditReport, facts, agentId);
}
