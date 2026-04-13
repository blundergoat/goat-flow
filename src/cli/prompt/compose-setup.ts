/**
 * Composes setup prompts from audit results and project facts.
 * Routes by project state: bare/partial → full setup guide,
 * v0.9/v1.0 → upgrade redirect, v1.1 → audit-driven pass/fail.
 */
import type { AuditReport } from "../audit/types.js";
import type { AgentId, ProjectFacts, ProjectSignals } from "../types.js";
import { SKILL_NAMES } from "../constants.js";
import { PROFILES } from "../detect/agents.js";
import { getTemplatePath, getCliCommand } from "../paths.js";
import { classifyProjectState } from "../classify-state.js";
import { createFS } from "../facts/fs.js";

// ----------------------------------------------------------------
// Signal helpers
// ----------------------------------------------------------------

/** Format static analysis tools. */
function formatStaticAnalysisTools(
  signals: ProjectSignals,
  withLevelLabel: boolean,
): string {
  return signals.staticAnalysis
    .map((signal) => {
      if (!signal.level) return signal.tool;
      return withLevelLabel
        ? `${signal.tool} level ${signal.level}`
        : `${signal.tool} (${signal.level})`;
    })
    .join(", ");
}

/** Collect signal summary parts. */
function collectSignalSummaryParts(signals: ProjectSignals): string[] {
  const parts: string[] = [];
  if (signals.codeGenTools.length > 0)
    parts.push(`**Code gen:** ${signals.codeGenTools.join(", ")}`);
  if (signals.deployPlatforms.length > 0)
    parts.push(`**Deploy:** ${signals.deployPlatforms.join(", ")}`);
  if (signals.llmIntegration) parts.push("**LLM integration detected**");
  if (signals.staticAnalysis.length > 0)
    parts.push(
      `**Static analysis:** ${formatStaticAnalysisTools(signals, false)}`,
    );
  return parts;
}

/** Collect signal action lines. */
function collectSignalActionLines(signals: ProjectSignals): string[] {
  const actions: string[] = [];
  if (signals.llmIntegration) {
    actions.push(
      '- **LLM integration:** Add prompt/template file paths to the Router Table. Add "prompt changes require scenario testing" to Ask First boundaries. Seed a learning-loop entry for prompt-regression risk.',
    );
  }
  if (signals.staticAnalysis.length > 0) {
    const tools = formatStaticAnalysisTools(signals, true);
    actions.push(
      `- **Static analysis (${tools}):** Verify post-turn validation hooks run these checks, not just record commands in config. Add \`<important if="editing source files">MUST maintain ${tools} compliance</important>\` to the instruction file (conditional tag keeps it contextual).`,
    );
  }
  return actions;
}

/** Append signal-specific lines and actionable follow-up tasks to the prompt output. */
function renderSignals(lines: string[], signals: ProjectSignals): void {
  const parts = collectSignalSummaryParts(signals);
  if (parts.length > 0) {
    lines.push("");
    lines.push(parts.join(" | "));
  }
  const actions = collectSignalActionLines(signals);
  if (actions.length > 0) {
    lines.push("");
    lines.push("**Signal-driven setup tasks:**");
    lines.push(...actions);
  }
}

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
    `- Run \`goat-flow audit . --quality\` for advisory quality scores across 5 harness concerns (context, constraints, verification, recovery, feedback loop). Never blocks CI - surfaces improvements only.`,
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
  facts: ProjectFacts,
  agentId: AgentId,
  version: "v0.9" | "v1.0",
): string {
  const profile = PROFILES[agentId];
  const stack = facts.stack;
  const languages = stack.languages.join(", ") || "unknown";
  const lines: string[] = [];

  if (version === "v1.0") {
    lines.push(`# GOAT Flow Upgrade - ${profile.name}`);
    lines.push("");
    lines.push("## Upgrade from v1.0 to current");
    lines.push("");
    lines.push("This project has goat-flow v1.0. Follow the upgrade path:");
    lines.push(
      `Read and implement \`${getTemplatePath("workflow/setup/upgrade-from-1.0.x.md")}\`.`,
    );
    lines.push("");
    lines.push(
      "Key changes: install `.goat-flow/skill-preamble.md` and `.goat-flow/skill-conventions.md`, refresh skills and dispatcher from current templates,",
    );
    lines.push(
      "remove handoff-template.md/todo.md/handoff.md, and collapse setup to the 6-step flow.",
    );
  } else {
    lines.push(`# GOAT Flow Migration - ${profile.name}`);
    lines.push("");
    lines.push("## Migration from v0.9 to current");
    lines.push("");
    lines.push(
      "This project has old goat-flow skills (v0.9 era). Follow the migration path:",
    );
    lines.push(
      `Read and implement \`${getTemplatePath("workflow/setup/upgrade-from-0.9.x.md")}\`.`,
    );
    lines.push("");
    lines.push(
      "Key changes: consolidate old skills to the 7 canonical skills (6 specialized + dispatcher), migrate docs/footguns.md → .goat-flow/footguns/,",
    );
    lines.push(
      "docs/lessons.md → .goat-flow/lessons/, create .goat-flow/config.yaml, install skill-preamble.md and skill-conventions.md.",
    );
  }

  lines.push("");
  lines.push(`**Stack:** ${languages}`);
  const cmds = [
    stack.buildCommand && `**Build:** \`${stack.buildCommand}\``,
    stack.testCommand && `**Test:** \`${stack.testCommand}\``,
    stack.lintCommand && `**Lint:** \`${stack.lintCommand}\``,
  ]
    .filter(Boolean)
    .join(" | ");
  if (cmds) lines.push(cmds);
  renderSignals(lines, stack.signals);
  lines.push("");

  if (stack.signals.llmIntegration) {
    lines.push(
      "**LLM integration detected.** Ensure Ask First boundaries and router table include prompt/template files.",
    );
    lines.push("");
  }

  const setupFile = getTemplatePath(SETUP_FILES[agentId]);
  if (setupFile) {
    lines.push(
      `For ${profile.name}-specific hooks and settings, also read: \`${setupFile}\``,
    );
    lines.push("");
  }

  return lines.join("\n");
}

// ----------------------------------------------------------------
// Mode: Full setup (bare or partial projects)
// ----------------------------------------------------------------

// eslint-disable-next-line complexity -- state-aware setup guide requires many agent/stack branches
function renderFullSetup(facts: ProjectFacts, agentId: AgentId): string {
  const profile = PROFILES[agentId];
  const setupFile = getTemplatePath(SETUP_FILES[agentId]);
  const stack = facts.stack;
  const languages = stack.languages.join(", ") || "unknown";
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

  lines.push(`**Stack:** ${languages}`);
  const cmds = [
    stack.buildCommand && `**Build:** \`${stack.buildCommand}\``,
    stack.testCommand && `**Test:** \`${stack.testCommand}\``,
    stack.lintCommand && `**Lint:** \`${stack.lintCommand}\``,
  ]
    .filter(Boolean)
    .join(" | ");
  if (cmds) lines.push(cmds);
  renderSignals(lines, stack.signals);
  lines.push("");

  if (stack.signals.llmIntegration) {
    lines.push("## LLM Integration Detected");
    lines.push("");
    lines.push(
      "This project integrates with LLM providers (Anthropic, OpenAI, Strands, LangChain, or similar).",
    );
    lines.push("Setup MUST account for this:");
    lines.push("");
    lines.push(
      "1. **Ask First boundaries** in the instruction file MUST include prompt/template files,",
    );
    lines.push(
      "   system prompts, and agent configuration files. Prompt changes are behavioral changes.",
    );
    lines.push(
      "2. **Router table** MUST include paths to prompt files, system prompts, and agent configs.",
    );
    lines.push(
      "   Agents need to know where the sensitive LLM-facing files are.",
    );
    lines.push(
      "3. **goat-security** is especially important - the threat model should cover:",
    );
    lines.push(
      "   prompt injection, output validation, credential exposure, and LLM cost controls.",
    );
    lines.push(
      "4. **Footguns** should document any coupling between prompt templates and code logic",
    );
    lines.push(
      "   (e.g., if changing a system prompt breaks JSON parsing downstream).",
    );
    lines.push("");
  }

  lines.push("## Before you start");
  lines.push("");
  lines.push("**Step 0 - Clean up stale artifacts (if upgrading):**");
  lines.push("");
  lines.push(
    "**Skills:** The 7 canonical skills are: `goat`, `goat-debug`, `goat-plan`, `goat-review`, `goat-sbao`, `goat-security`, `goat-test`.",
  );
  lines.push("");
  lines.push("Check the skills directory for stale or duplicate entries:");
  lines.push(
    "- Delete stale `goat-*` directories: `goat-investigate`, `goat-audit`, `goat-onboard`, `goat-reflect`, `goat-resume`, `goat-simplify`, `goat-refactor`, `goat-context`",
  );
  lines.push(
    "- Check for generic skill directories: `audit/`, `review/`, `preflight/`, `debug/`, `plan/`, `test/`, `security/`",
  );
  lines.push(
    "  If any exist alongside the `goat-*` version: (a) migrate unique content into the goat-* version, (b) delete the generic directory, or (c) skip if it's a project-specific skill unrelated to goat-flow",
  );
  lines.push("");
  lines.push(
    "**Multi-agent consistency:** If multiple agent skill directories exist (`.claude/skills/`, `.agents/skills/`), clean stale dirs from ALL of them - not just the agent being set up. Also update `GEMINI.md` and `AGENTS.md` if they reference deleted skills.",
  );
  lines.push("");
  lines.push(
    "**Local instructions:** If `.github/instructions/` already exists, keep it as the canonical local-instructions surface during base setup. Do not create `.goat-flow/coding-standards/`.",
  );
  lines.push("");
  lines.push(
    "**Router table:** Rewrite the Router Table in the instruction file. Remove entries pointing to deleted skills. If `.goat-flow/README.md` exists, include it as the Project Guidelines entry.",
  );
  lines.push("");
  lines.push(
    "**Dispatcher:** Replace the `/goat` dispatcher skill entirely from the goat-flow template.",
  );
  lines.push(
    `Read the template at \`${getTemplatePath("workflow/skills/goat.md")}\` and write it to the agent skills dir.`,
  );
  lines.push(
    "Preserve any project-specific disambiguation examples the existing dispatcher may have.",
  );
  lines.push("");
  lines.push(
    "**Step 0b - Migrate, don't duplicate (check BEFORE creating files):**",
  );
  lines.push("");
  lines.push(
    "Before creating any artifact, check if an equivalent already exists. Do NOT create parallel surfaces.",
  );
  lines.push("");
  lines.push("| Artifact | If this exists... | Do NOT also create... |");
  lines.push("|----------|-------------------|----------------------|");
  lines.push("| Tasks | `tasks/` | `.goat-flow/tasks/` (or vice versa) |");
  lines.push(
    "| Footguns | `docs/footguns.md` (flat file) | `.goat-flow/footguns/` (directory) |",
  );
  lines.push(
    "| Lessons | `docs/lessons.md` (flat file) | `.goat-flow/lessons/` (directory) |",
  );
  lines.push(
    "| Local instructions | `.github/instructions/` | any second local-instructions tree with overlapping content |",
  );
  lines.push("");
  lines.push(
    "For each artifact type: (1) use the canonical `.goat-flow/` path, (2) migrate existing content there if needed, (3) list what you chose NOT to create and why.",
  );
  lines.push("");
  lines.push(
    "Examples: If `.github/instructions/` exists, keep it canonical during base setup instead of creating a competing second instruction tree. If `docs/footguns.md` exists, migrate its entries to `.goat-flow/footguns/` instead of creating a parallel surface.",
  );
  lines.push("");
  lines.push(
    "1. Verify the detected stack above is correct. If not, the setup file will",
  );
  lines.push(
    "   ask you to detect it from the actual codebase (package.json, composer.json, etc.)",
  );
  lines.push(
    '2. "Adapt" means: replace generic examples with THIS project\'s real examples.',
  );
  lines.push(
    "   Footguns: only real traps from THIS codebase with `file:line` evidence.",
  );
  lines.push(
    "   Local instructions added later: derive them from real build/test/lint commands and codebase patterns.",
  );
  lines.push(
    '3. Do NOT copy customization templates (architecture, footguns, code-map) verbatim. If a template says "[describe X]", describe X for THIS project. Note: skill SKILL.md files ARE installed verbatim - this rule applies to Step 04-05 artifacts only.',
  );
  const settingsRef = profile.settingsFile
    ? `\`${profile.settingsFile}\``
    : "the agent's settings file";
  lines.push(
    `4. Check for existing permission restrictions: if ${settingsRef}`,
  );
  lines.push(
    "   exists and limits allowed tools/commands, the setup may fail to create files.",
  );
  lines.push(
    "   Read it first. If it restricts Bash or Write, work single-threaded instead of spawning sub-agents.",
  );
  if (agentId === "claude") {
    lines.push(
      "5. **Deny rule escape hatch:** The default deny pattern `Bash(*git commit*)` blocks ALL commits.",
    );
    lines.push(
      "   To relax specific rules after setup, add allow overrides in `.claude/settings.local.json` (gitignored).",
    );
  } else if (agentId === "codex") {
    lines.push(
      "5. **Deny rules:** Codex uses execpolicy rules in `.codex/rules/deny-dangerous.star`. Review before setup to ensure setup commands are not blocked.",
    );
  } else {
    lines.push(
      `5. **Deny rules:** Review deny patterns in ${settingsRef} before setup to ensure setup commands are not blocked.`,
    );
  }
  lines.push(
    `   See \`${getTemplatePath("workflow/hooks/README.md")}\` for hook configuration details.`,
  );
  lines.push("");

  lines.push("## Setup instructions");
  lines.push("");
  lines.push(
    `FIRST, read \`${setupFile}\` for agent-specific paths and configuration.`,
  );
  lines.push("");
  lines.push(
    `Then follow the numbered setup steps in \`${getTemplatePath("workflow/setup/")}\` one at a time:`,
  );
  lines.push("");
  lines.push(
    "- **01-system-overview.md** - Design intent, state check, session-log setup",
  );
  lines.push(
    "- **02-instruction-file.md** - Create or update the instruction file",
  );
  lines.push(
    "- **03-install-skills.md** - Install the 7 verbatim skill templates",
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
  lines.push(
    "Install the full system for every project. Do not skip components based on project size.",
  );
  lines.push("");

  lines.push("## Post-setup verification");
  lines.push("");
  lines.push("**Hook smoke-test** (run after creating hook scripts):");
  lines.push("```bash");
  lines.push("# Syntax check every hook script");
  const hooksDir = profile.hooksDir ?? ".agents/hooks";
  lines.push(
    `for f in ${hooksDir}/*.sh; do bash -n "$f" || echo "FAIL: $f"; done`,
  );
  lines.push("# Shellcheck if available");
  lines.push(`command -v shellcheck >/dev/null && shellcheck ${hooksDir}/*.sh`);
  lines.push("```");
  lines.push(
    "If any hook fails syntax check: fix it before declaring setup complete.",
  );
  lines.push("");
  lines.push(
    "**File creation checklist:** After setup, verify all expected files exist. Report any you could not create (permission denied, path conflict) with the reason.",
  );
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
