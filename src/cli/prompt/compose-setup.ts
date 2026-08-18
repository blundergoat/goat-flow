/**
 * Builds the setup prompt a user gets back from `goat-flow setup`, ready to paste into their coding agent.
 *
 * The user has pointed the CLI at a project and named an agent; what comes back depends on what the audit found there:
 *
 * - Nothing installed, a half install, or an unreadable one sends them to the full setup guide.
 * - A v0.9-era or otherwise older install sends them to the installer first, then back to the numbered setup docs.
 * - A current install with failing checks lists each failure beside the setup step that fixes it.
 * - A current install with everything passing lists what is present plus the audit gates still to run.
 */
import type { AuditReport, CheckResult } from "../audit/types.js";
import type { AgentId, ProjectFacts } from "../types.js";
import { loadManifest } from "../manifest/manifest.js";
import { PROFILES } from "../detect/agents.js";
import { getTemplatePath, getCliCommand } from "../paths.js";

/**
 * Render a packaged template path with forward slashes so the prompt reads the same on Windows as it does on macOS and Linux.
 * `getTemplatePath` returns OS-native paths, so a Windows user would otherwise be told to open a backslash path in the copy they paste.
 *
 * @param relative - template path relative to the packaged workflow directory
 * @returns the POSIX-style path embedded in prompt text; never empty
 */
function displayTemplatePath(relative: string): string {
  return getTemplatePath(relative).replace(/\\/g, "/");
}
import { classifyProjectState } from "../classify-state.js";
import { createFS } from "../facts/fs.js";
import { resolve } from "node:path";

/**
 * Choose how the target project appears in commands the prompt tells the user to run.
 * Someone already sitting in that project sees the short `.` form; anyone else gets the absolute path so the command works from any directory.
 *
 * @param projectRoot - project the audit ran against
 * @returns `.` or an absolute path, ready to paste into a shell; never empty
 */
function targetArg(projectRoot: string): string {
  return resolve(projectRoot) === resolve(process.cwd())
    ? "."
    : resolve(projectRoot);
}

/**
 * Build the single install command a user can paste into any terminal, already pointed at their project and agent.
 *
 * @param projectRoot - project the files are installed into
 * @param agentId - agent whose skills, hooks, and settings get installed
 * @returns the full npx command line; never empty
 */
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

/**
 * Whether the audit ran in a mode that never executed the deny hook, so prompt copy must not claim runtime proof.
 *
 * @param evidenceLevel - how deny-mechanism evidence was gathered; `undefined` means the full runtime probe ran
 * @returns true for the static and presence-only levels, false for full evidence
 */
function usesLimitedDenyEvidence(
  evidenceLevel: DenyMechanismEvidenceLevel | undefined,
): boolean {
  return evidenceLevel === "static" || evidenceLevel === "present-only";
}

/**
 * Write the first line the user reads, without claiming evidence the selected audit mode never collected.
 *
 * @param evidenceLevel - how deny-mechanism evidence was gathered; `undefined` means the full runtime probe ran
 * @returns the headline sentence at the top of the prompt; never empty
 */
function auditPassHeadline(
  evidenceLevel: DenyMechanismEvidenceLevel | undefined,
): string {
  // The run actually executed the deny hook, so the user can be told plainly that everything passed.
  if (!usesLimitedDenyEvidence(evidenceLevel)) return "All audit checks pass.";
  const label = evidenceLevel === "present-only" ? "Presence-only" : "Static";
  return `${label} audit checks pass; runtime deny-hook probes were not run.`;
}

/**
 * Render the installed-state bullet describing audit coverage, hedged when only limited deny evidence exists.
 *
 * @param evidenceLevel - how deny-mechanism evidence was gathered; `undefined` renders the unqualified line
 * @returns one Markdown list item; never empty
 */
function auditPassInstallLine(
  evidenceLevel: DenyMechanismEvidenceLevel | undefined,
): string {
  // Full evidence, so the inventory bullet can claim every build check without a caveat.
  if (!usesLimitedDenyEvidence(evidenceLevel)) {
    return "- Audit: all build checks passing";
  }
  const label = evidenceLevel === "present-only" ? "presence-only" : "static";
  return `- Audit: ${label} setup checks passing; runtime deny-hook probes not run`;
}

// ----------------------------------------------------------------
// Mode: Audit pass (current version, all build checks passing)
// ----------------------------------------------------------------

/**
 * Render the prompt a user sees when their project is already current and every build check passes.
 * This is the "nothing to install" path: an inventory of what is present, then the audit gates they still have to run.
 *
 * @param facts - detected project facts; the entry matching `agentId` supplies the installed counts
 * @param agentId - agent this prompt is addressed to, selecting its display name and skill/hook dirs
 * @param evidenceLevel - how deny-mechanism evidence was gathered; `undefined` renders the
 *   full-confidence headline, while presence-only and static levels say runtime probes were not run
 * @returns the prompt as newline-joined Markdown; never empty
 */
function renderAuditPass(
  facts: ProjectFacts,
  agentId: AgentId,
  evidenceLevel?: DenyMechanismEvidenceLevel,
): string {
  const profile = PROFILES[agentId];
  const agentFacts = facts.agents.find(
    (candidate) => candidate.agent.id === agentId,
  );
  const lines: string[] = [];

  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push("");
  lines.push(auditPassHeadline(evidenceLevel));
  lines.push("");

  // Detection found this agent in the project, so the user gets a concrete list of what is already installed.
  // Without it the prompt skips straight to the commands rather than showing a half-filled inventory.
  if (agentFacts) {
    const skillCount = agentFacts.skills.found.length;
    const totalSkills = loadManifest().facts.skills.total;
    const hookScripts: string[] = [];
    // Each guardrail script found on disk is named, so the user can see which protections are live.
    if (agentFacts.hooks.denyExists) hookScripts.push("deny");
    if (agentFacts.hooks.postTurnExists) hookScripts.push("post-turn");
    const hooksDir = profile.hooksDir ?? "hooks";

    lines.push("**Installed:**");
    lines.push(
      `- ${skillCount}/${totalSkills} skills installed (in ${profile.skillsDir}/)`,
    );
    // A project with no hook scripts installed simply has no hook line, rather than a bullet reading zero.
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
    `- Run \`${harnessAuditCommand(facts, agentId)}\` and report the per-concern scores.`,
  );
  lines.push(
    `- Run \`${contentAuditCommand(facts, agentId)}\` to verify supported cold-path content claims.`,
  );
  lines.push(
    "These are the remaining setup verification gates - do not skip them.",
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

/**
 * Render the passing-setup prompt behind the dashboard harness card, which carries the harness gate only.
 *
 * Use instead of `renderAuditPass` when the user opened the card rather than the full prompt; the inventory and content blocks would overstate
 * what that card actually verified.
 *
 * @param facts - detected project facts; supplies the project root for the rerun command
 * @param agentId - agent this prompt is addressed to, selecting its display name
 * @param evidenceLevel - how deny-mechanism evidence was gathered; drives the headline hedge
 * @returns the prompt as newline-joined Markdown; never empty
 */
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

/**
 * Pick the status a prompt should render for the requested scope.
 *
 * A harness-card prompt reports the harness scope status, falling back to the report-wide status when the audit collected no harness scope.
 *
 * @param auditReport - completed audit report for the target project
 * @param promptScope - whether the caller wants the full prompt or the dashboard harness card
 * @returns the pass/fail verdict that selects the pass or fail renderer
 */
function auditStatusForPrompt(
  auditReport: AuditReport,
  promptScope: SetupPromptScope,
): "pass" | "fail" {
  // The user is looking at the harness card, so its own verdict wins; an audit run without harness scope falls back to the overall status.
  if (promptScope === "harness-card") {
    return auditReport.scopes.harness?.status ?? auditReport.status;
  }
  return auditReport.status;
}

/**
 * Collect the checks a setup prompt should list as failures for the requested scope.
 *
 * Acknowledged failures and metric checks are left out because neither is something the agent can clear by following a setup step.
 *
 * @param auditReport - completed audit report for the target project
 * @param promptScope - whether the caller wants the full prompt or the dashboard harness card
 * @returns failing checks in setup, agent, then harness order; empty when nothing actionable failed
 */
function failedChecksForPrompt(
  auditReport: AuditReport,
  promptScope: SetupPromptScope,
): CheckResult[] {
  // A failure earns a place in the prompt only when it carries fix detail, nobody acknowledged it, and it is not a score-only metric.
  const isPromptFailure = (check: CheckResult): boolean =>
    check.status === "fail" &&
    check.failure !== undefined &&
    !check.acknowledged &&
    check.type !== "metric";

  // Card scope keeps the list to harness failures; an audit run without harness scope leaves the user an empty list rather than setup noise.
  if (promptScope === "harness-card") {
    return auditReport.scopes.harness?.checks.filter(isPromptFailure) ?? [];
  }
  return [
    ...auditReport.scopes.setup.checks.filter(isPromptFailure),
    ...auditReport.scopes.agent.checks.filter(isPromptFailure),
    ...(auditReport.scopes.harness?.checks.filter(isPromptFailure) ?? []),
  ];
}

/**
 * Build the audit command a prompt tells the agent to re-run after applying fixes.
 *
 * @param facts - detected project facts; supplies the audit target path
 * @param agentId - agent the audit should be scoped to
 * @param includeHarness - true to add `--harness` so the harness card gate is re-scored too
 * @returns the full CLI command line; never empty
 */
function rerunAuditCommand(
  facts: ProjectFacts,
  agentId: AgentId,
  includeHarness: boolean,
): string {
  // Harness runs get the extra flag so the rerun re-scores the same gate the user was just shown.
  const scopeFlag = includeHarness ? " --harness" : "";
  return `${getCliCommand()} audit ${targetArg(facts.root)}${scopeFlag} --agent ${agentId}`;
}

/**
 * Build the plain audit command, the first of the three gates a user must clear before setup counts as done.
 *
 * @param facts - detected project facts; supplies the audit target path
 * @param agentId - agent the audit is scoped to
 * @returns the full CLI command line; never empty
 */
function auditCommand(facts: ProjectFacts, agentId: AgentId): string {
  return `${getCliCommand()} audit ${targetArg(facts.root)} --agent ${agentId}`;
}

/**
 * Build the harness audit command, the gate that scores how completely the agent governance was installed.
 *
 * @param facts - detected project facts; supplies the audit target path
 * @param agentId - agent the audit is scoped to
 * @returns the full CLI command line; never empty
 */
function harnessAuditCommand(facts: ProjectFacts, agentId: AgentId): string {
  return `${getCliCommand()} audit ${targetArg(facts.root)} --agent ${agentId} --harness`;
}

/**
 * Build the content audit command, the gate that reads the cold-path docs rather than just checking that files exist.
 *
 * @param facts - detected project facts; supplies the audit target path
 * @param agentId - agent the audit is scoped to
 * @returns the full CLI command line; never empty
 */
function contentAuditCommand(facts: ProjectFacts, agentId: AgentId): string {
  return `${getCliCommand()} audit ${targetArg(facts.root)} --agent ${agentId} --check-content`;
}

/**
 * Append the three-gate closing block that every full setup prompt ends with.
 *
 * @param lines - prompt buffer, extended in place with the gate block
 * @param facts - detected project facts; supplies the audit target path
 * @param agentId - agent the three audit commands should be scoped to
 */
function pushFinalSetupGate(
  lines: string[],
  facts: ProjectFacts,
  agentId: AgentId,
): void {
  lines.push("**Audit:** Run all three required setup gates:");
  lines.push(`- \`${auditCommand(facts, agentId)}\``);
  lines.push(`- \`${harnessAuditCommand(facts, agentId)}\``);
  lines.push(`- \`${contentAuditCommand(facts, agentId)}\``);
  lines.push("");
  lines.push("**Target: all three audits pass with zero failures.**");
  lines.push(
    `If the base or harness audit fails, run \`${getCliCommand()} setup ${targetArg(facts.root)} --agent ${agentId}\` for remaining structural fix instructions.`,
  );
  lines.push(
    "If the content audit fails, follow its reported findings and suggestions; setup does not rerun the cold content scan.",
  );
  lines.push(
    "Then re-run all three audit gates. Repeat until all three pass (max 3 cycles).",
  );
}

/**
 * Whether the prompt should point at the harness variant of the audit command.
 *
 * @param auditReport - completed audit report for the target project
 * @param promptScope - whether the caller wants the full prompt or the dashboard harness card
 * @returns true when the card is harness-scoped or the report already covered the harness scope
 */
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

/**
 * Render the setup prompt shown when audit checks are still failing on the current version.
 *
 * Each failure becomes a numbered entry with its message, evidence, and the setup step that owns the fix, so the agent can work the list in order.
 *
 * @param auditReport - completed audit report supplying the failing checks
 * @param facts - detected project facts; supplies the audit target path
 * @param agentId - agent this prompt is addressed to, selecting its display name
 * @param promptScope - whether the caller wants the full prompt or the dashboard harness card
 * @returns the prompt as newline-joined Markdown; never empty
 */
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

  let entryNumber = 1;
  // One numbered entry per failure, so the user can work down the list and tick items off in order.
  for (const check of failedChecks) {
    const failure = check.failure;
    // A check can fail without failure detail; listing it would give the user a number and nothing to act on.
    if (!failure) continue;
    const step = CHECK_TO_STEP[check.id] ?? "relevant setup step";

    lines.push(`${entryNumber++}. **${failure.check}** - FAIL`);
    lines.push(`   ${failure.message}`);
    // Evidence is optional; when the check captured a path or value, the user gets the receipt rather than a bare verdict.
    if (failure.evidence) lines.push(`   Evidence: ${failure.evidence}`);
    // A check that knows its own repair prints it; otherwise the user is pointed at the setup step that owns the area.
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

/**
 * Collect the install failures worth showing above an upgrade prompt, leaving out anything that passed or only warned.
 *
 * @param auditReport - completed audit report for the target project
 * @returns failing setup checks then failing agent checks; empty when the install itself is sound
 */
function failedInstallChecks(auditReport: AuditReport): CheckResult[] {
  return [
    ...auditReport.scopes.setup.checks.filter(
      (check) => check.status === "fail",
    ),
    ...auditReport.scopes.agent.checks.filter(
      (check) => check.status === "fail",
    ),
  ];
}

/**
 * Append the detected-install-issues section to an upgrade prompt, or nothing when the audit found no install failures.
 *
 * @param lines - prompt buffer, extended in place
 * @param auditReport - completed audit report supplying the failing install checks
 */
function pushDetectedInstallIssues(
  lines: string[],
  auditReport: AuditReport,
): void {
  const failures = failedInstallChecks(auditReport).filter(
    (check) => check.failure !== undefined,
  );
  // A clean install gets no issues heading at all, so the upgrade prompt opens straight on the install step.
  if (failures.length === 0) return;

  lines.push("## Detected install issues");
  lines.push("");
  // One bullet per issue the user should expect the reinstall to clear.
  for (const check of failures) {
    const failure = check.failure;
    // No failure detail means nothing actionable to show, so the issue is left out rather than listed blank.
    if (!failure) continue;
    lines.push(`- **${failure.check}:** ${failure.message}`);
    // Evidence and repair text are both optional; each is printed only when the check captured it.
    if (failure.evidence) lines.push(`  Evidence: ${failure.evidence}`);
    if (failure.howToFix) lines.push(`  Fix: ${failure.howToFix}`);
  }
  lines.push("");
}

/**
 * Render the prompt that sends an out-of-date project through the installer before any content work.
 *
 * Both routes lead with the install command, because refreshing the shipped files first keeps the follow-up setup docs matched to what is on disk.
 *
 * @param auditReport - completed audit report supplying detected install issues
 * @param facts - detected project facts; supplies the install target path
 * @param agentId - agent this prompt is addressed to, selecting its display name
 * @param state - `outdated` for an older goat-flow install, `v0.9` for the pre-1.0 skill layout
 * @param detectedVersion - version found in the project when known; omitting it renders the generic older-version line
 * @returns the prompt as newline-joined Markdown; never empty
 */
function renderUpgradeRedirect(
  auditReport: AuditReport,
  facts: ProjectFacts,
  agentId: AgentId,
  state: "v0.9" | "outdated",
  detectedVersion?: string,
): string {
  const profile = PROFILES[agentId];
  const lines: string[] = [];

  // An ordinary older install just needs a refresh, so the user gets a two-step upgrade with no cleanup work.
  if (state === "outdated") {
    lines.push(`# GOAT Flow Upgrade - ${profile.name}`);
    lines.push("");
    // Naming the version they are on is more useful than a generic warning, so the vaguer line appears only when detection came up empty.
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
    // A v0.9-era layout needs the extra removal step, so this route is a migration rather than a straight upgrade.
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

/**
 * Render the full setup walkthrough for a project that has nothing installed yet, or too little to repair piecemeal.
 *
 * @param facts - detected project facts; supplies the target path and whether this agent is configured at all
 * @param agentId - agent this prompt is addressed to, selecting its display name and setup guide
 * @returns the prompt as newline-joined Markdown; never empty
 */
function renderFullSetup(facts: ProjectFacts, agentId: AgentId): string {
  const profile = PROFILES[agentId];
  const setupFile = displayTemplatePath(SETUP_FILES[agentId]);
  const lines: string[] = [];

  const agentFacts = facts.agents.find(
    (candidate) => candidate.agent.id === agentId,
  );
  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push("");
  // The agent is configured here but the install is incomplete, so the opening line frames this as repair rather than first-time setup.
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
    "- **05-customise-to-project.md** - Deep codebase read, real footguns/lessons, evidence-gated history candidates, and project-specific instruction refinement",
  );
  lines.push(
    "- **06-final-verification.md** - Three audit gates, stale-ref check, file manifest, command smoke test",
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

  // Nothing usable installed, or a half-finished install: the audit result cannot be trusted as a to-do list, so start from the setup guide.
  if (
    FULL_SETUP_STATES.has(projectState.state) ||
    projectState.action === "incomplete"
  ) {
    return renderFullSetup(facts, agentId);
  }
  // Files are present but from an older release, so the user is sent to the installer before being asked to fix anything by hand.
  if (UPGRADE_STATES.has(projectState.state)) {
    return renderUpgradeRedirect(
      auditReport,
      facts,
      agentId,
      projectState.state as "v0.9" | "outdated",
      projectState.version,
    );
  }
  // A current install that passes its checks gets the inventory-and-next-gates prompt; the card variant keeps the harness gate on its own.
  if (auditStatusForPrompt(auditReport, promptScope) === "pass") {
    return promptScope === "harness-card"
      ? renderHarnessCardPass(
          facts,
          agentId,
          options.denyMechanismEvidenceLevel,
        )
      : renderAuditPass(facts, agentId, options.denyMechanismEvidenceLevel);
  }
  // Everything is installed and current, but checks are failing, so the user gets the numbered failure list instead.
  return renderAuditFail(auditReport, facts, agentId, promptScope);
}
