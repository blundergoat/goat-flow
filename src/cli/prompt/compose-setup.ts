/**
 * Composes setup prompts from audit results and project facts.
 * Routes by project state: bare/partial → full setup guide,
 * v0.9/v1.0 → upgrade redirect, v1.1 → audit-driven pass/fail.
 */
import type { AuditReport } from "../audit/types.js";
import type { AgentId, ProjectFacts } from "../types.js";
import { SKILL_NAMES } from "../constants.js";
import { PROFILES } from "../detect/agents.js";
import { getTemplatePath, getCliCommand } from "../paths.js";
import { classifyProjectState } from "../classify-state.js";
import { createFS } from "../facts/fs.js";

// ----------------------------------------------------------------
// Setup-step references
// ----------------------------------------------------------------

/** Maps audit check IDs to the setup step that fixes them. */
const CHECK_TO_STEP: Record<string, string> = {
  "required-files": "Step 02 (instruction file) or Step 04 (architecture)",
  "required-dirs":
    "Step 04 (architecture and code map — creates .goat-flow/ directories)",
  "config-parses": "Step 02 or Step 05 (config.yaml)",
  "config-version": "Step 05 (config version field)",
  "agents-supported": "Step 05 (config.yaml agents list)",
  "canonical-skills": "Step 03 (install skills)",
  "skill-versions": "Step 03 (version tags)",
  "configured-agent-present": "Step 02 (instruction file for agent)",
  "agent-artifacts-consistent":
    "Step 02 (create instruction file for listed agents) or Step 04 (remove stale agent directories)",
  "instruction-files": "Step 02 (create/update instruction file)",
  "stale-skill-dirs": "Step 03 (clean up stale skills)",
  "workflow-path-leaks":
    "Step 03 (skill files must reference .goat-flow/ not workflow/)",
  "toolchain-commands": "Step 05 (config.yaml toolchain)",
  "agent-settings-parse": "Step 05 (customise — hooks and settings)",
  "hook-files-exist": "Step 05 (customise — install hook scripts)",
  "hook-syntax": "Step 05 (customise — hook script syntax)",
  "deny-patterns": "Step 05 (customise — deny mechanism)",
};

/** Lookup from agent ID to its agent-specific setup guide. */
const SETUP_FILES: Record<AgentId, string> = {
  claude: "workflow/setup/agents/claude.md",
  codex: "workflow/setup/agents/codex.md",
  gemini: "workflow/setup/agents/gemini.md",
};

// ----------------------------------------------------------------
// Mode: Audit pass (v1.1, all build checks passing)
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
    const hookScripts: string[] = [];
    if (agentFacts.hooks.denyExists) hookScripts.push("deny");
    if (agentFacts.hooks.postTurnExists) hookScripts.push("post-turn");
    if (agentFacts.hooks.compactionHookExists) hookScripts.push("compaction");
    const hooksDir = profile.hooksDir ?? "hooks";

    lines.push("**Installed:**");
    lines.push(
      `- ${skillCount}/${SKILL_NAMES.length} skills installed (in ${profile.skillsDir}/)`,
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
    `- Run \`goat-flow audit . --harness\` for advisory quality scores across 5 harness concerns (context, constraints, verification, recovery, feedback loop). Never blocks CI - surfaces improvements only.`,
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
// Mode: Audit fail (v1.1, some build checks failing)
// ----------------------------------------------------------------

function renderAuditFail(
  auditReport: AuditReport,
  _facts: ProjectFacts,
  agentId: AgentId,
): string {
  const profile = PROFILES[agentId];
  const lines: string[] = [];

  const failedChecks = [
    ...auditReport.scopes.setup.checks.filter((c) => c.status === "fail"),
    ...auditReport.scopes.harness.checks.filter((c) => c.status === "fail"),
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
  lines.push(`Re-run: \`${getCliCommand()} audit . --agent ${agentId}\``);
  lines.push(
    `If audit fails, run \`${getCliCommand()} setup . --agent ${agentId}\` for fix instructions. Repeat until audit passes (max 3 cycles).`,
  );

  return lines.join("\n");
}

// ----------------------------------------------------------------
// Mode: Upgrade redirect (v0.9 or v1.0 projects)
// ----------------------------------------------------------------

function renderUpgradeRedirect(
  _facts: ProjectFacts,
  agentId: AgentId,
  version: "v0.9" | "v1.0",
): string {
  const profile = PROFILES[agentId];
  const lines: string[] = [];

  if (version === "v1.0") {
    lines.push(`# GOAT Flow Upgrade - ${profile.name}`);
    lines.push("");
    lines.push("This project has goat-flow v1.0.");
    lines.push("");

    lines.push("## Step 1 - Install files");
    lines.push("");
    lines.push(
      `Run: \`bash ${getTemplatePath("workflow/install-goat-flow.sh")} . --agent ${agentId}\``,
    );
    lines.push("");
    lines.push(
      "This refreshes skills, hooks, settings, templates, and reference files to the current version.",
    );
    lines.push("");

    lines.push("## Step 2 - Upgrade project-specific content");
    lines.push("");
    lines.push(
      `Read and follow \`${getTemplatePath("workflow/setup/upgrade-from-1.0.x.md")}\` for remaining changes (remove legacy files, update instruction file).`,
    );
  } else {
    lines.push(`# GOAT Flow Migration - ${profile.name}`);
    lines.push("");
    lines.push("This project has old goat-flow skills (v0.9 era).");
    lines.push("");

    lines.push("## Step 1 - Migrate old layout");
    lines.push("");
    lines.push(
      `Run: \`bash ${getTemplatePath("workflow/install-migrate-to-1.1.sh")} . --execute\``,
    );
    lines.push("");
    lines.push(
      "This migrates `docs/footguns.md` → `.goat-flow/footguns/`, `docs/lessons.md` → `.goat-flow/lessons/`, deletes stale skills, and removes legacy files.",
    );
    lines.push("");

    lines.push("## Step 2 - Install files");
    lines.push("");
    lines.push(
      `Run: \`bash ${getTemplatePath("workflow/install-goat-flow.sh")} . --agent ${agentId}\``,
    );
    lines.push("");
    lines.push(
      "This installs the 7 canonical skills, hooks, settings, templates, and reference files.",
    );
    lines.push("");

    lines.push("## Step 3 - Create project-specific content");
    lines.push("");
    lines.push(
      `Read and follow \`${getTemplatePath("workflow/setup/upgrade-from-0.9.x.md")}\` for remaining changes (instruction file, architecture docs, config).`,
    );
  }

  lines.push("");
  lines.push(`## ${version === "v1.0" ? "Step 3" : "Step 4"} - Verify`);
  lines.push("");
  lines.push(
    `**Audit:** Run \`${getCliCommand()} audit . --agent ${agentId}\``,
  );
  lines.push("");
  lines.push("**Target: audit passes with zero failures.**");
  lines.push(
    `If audit fails, run \`${getCliCommand()} setup . --agent ${agentId}\` for remaining fix instructions. Repeat until audit passes (max 3 cycles).`,
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
      `This project has setup issues - it needs a full setup pass. Run \`${getCliCommand()} audit .\` after fixing to verify.`,
    );
  } else {
    lines.push(
      `No ${profile.name} configuration detected - this project needs a full setup.`,
    );
  }
  lines.push("");

  lines.push(
    "Do NOT copy customization templates (architecture, footguns, code-map) verbatim. If a template says \"[describe X]\", describe X for THIS project. Skill SKILL.md files ARE installed verbatim - this rule applies to Step 04-05 artifacts only.",
  );
  lines.push("");

  lines.push("## Step 1 - Install files");
  lines.push("");
  lines.push(
    `Run: \`bash ${getTemplatePath("workflow/install-goat-flow.sh")} . --agent ${agentId}\``,
  );
  lines.push("");
  lines.push(
    "This installs skills, hooks, settings, templates, and reference files. Verify it completes with zero errors.",
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
    "- **05-customise-to-project.md** - Deep codebase read, real footguns/lessons, auto-seeded git signals, and `toolchain` / `ask_first` config sync",
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
    `**Audit:** Run \`${getCliCommand()} audit . --agent ${agentId}\``,
  );
  lines.push("");
  lines.push("**Target: audit passes with zero failures.**");
  lines.push(
    `If audit fails, run \`${getCliCommand()} setup . --agent ${agentId}\` for remaining fix instructions. Repeat until audit passes (max 3 cycles).`,
  );

  return lines.join("\n");
}

// ----------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------

/**
 * Compose a setup prompt for the given agent.
 *
 * Routing:
 * - bare/partial/error → full setup guide (step references)
 * - v0.9/v1.0         → upgrade/migration redirect
 * - v1.1 + audit pass → success with real counts from facts
 * - v1.1 + audit fail → failing checks with howToFix + step references
 */
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
  if (projectState.state === "v0.9" || projectState.state === "v1.0") {
    return renderUpgradeRedirect(facts, agentId, projectState.state);
  }
  // v1.1: audit-driven
  if (auditReport.status === "pass") {
    return renderAuditPass(facts, agentId);
  }
  return renderAuditFail(auditReport, facts, agentId);
}
