/**
 * Composes a structured critique prompt for a selected agent.
 * Mirrors the critique template (.goat-flow/tasks/1.1.0/critique-self-goat-flow-prompt.md)
 * and embeds live audit results when available.
 */
import type { AgentId } from "../types.js";
import type { AuditReport, AuditConcernKey } from "../audit/types.js";
import { SKILL_NAMES } from "../constants.js";
import { getPackageVersion } from "../paths.js";

interface CritiqueInput {
  agent: AgentId;
  projectPath: string;
  auditReport: AuditReport | null;
}

interface CritiquePayload {
  command: "critique";
  agent: AgentId;
  auditStatus: "pass" | "fail" | "unavailable";
  auditSummary: string;
  prompt: string;
}

const AGENT_LABELS: Record<AgentId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

const AGENT_SKILL_DIRS: Record<AgentId, string> = {
  claude: ".claude/skills",
  codex: ".agents/skills",
  gemini: ".agents/skills",
};

const AGENT_SETTINGS: Record<AgentId, string> = {
  claude: ".claude/settings.json",
  codex: ".codex/config.toml",
  gemini: ".gemini/settings.json",
};

const AGENT_INSTRUCTION: Record<AgentId, string> = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  gemini: "GEMINI.md",
};

function renderAuditSummary(report: AuditReport): string {
  const lines: string[] = [];
  const scopes = [
    ["setup", "GOAT Flow Setup"],
    ["harness", "AI Harness Score"],
  ] as const;
  for (const [scope, label] of scopes) {
    const s = report.scopes[scope];
    const status = s.status === "pass" ? "PASS" : "FAIL";
    const scoreStr = s.score != null ? ` (${s.score}%)` : "";
    lines.push(`- **${label}**: ${status}${scoreStr}`);
    if (s.failures.length > 0) {
      for (const f of s.failures) {
        lines.push(`  - ${f.check}: ${f.message}`);
      }
    }
  }

  if (report.concerns) {
    const keys: AuditConcernKey[] = [
      "context",
      "constraints",
      "verification",
      "recovery",
      "feedback_loop",
    ];
    lines.push("");
    lines.push("Quality scores:");
    for (const key of keys) {
      lines.push(`- ${key}: ${report.concerns[key].score}%`);
    }
    if (report.overall.grade && report.overall.qualityScore !== null) {
      lines.push(
        `- Overall: ${report.overall.grade} (${report.overall.qualityScore}%)`,
      );
    }
  }

  return lines.join("\n");
}

function renderDegradedNote(): string {
  return [
    "",
    "> **Note:** The automated audit could not complete on this project.",
    "> This may indicate missing config, broken setup, or an incomplete install.",
    "> Proceed with the critique anyway - your assessment may catch what the audit could not.",
    "",
  ].join("\n");
}

/** Compose the critique prompt for the selected agent. */
export function composeCritique(input: CritiqueInput): CritiquePayload {
  const { agent, projectPath, auditReport } = input;
  const agentLabel = AGENT_LABELS[agent];
  const skillsDir = AGENT_SKILL_DIRS[agent];
  const settingsFile = AGENT_SETTINGS[agent];
  const instructionFile = AGENT_INSTRUCTION[agent];

  const auditStatus: CritiquePayload["auditStatus"] = auditReport
    ? auditReport.status
    : "unavailable";

  const auditSummaryText = auditReport
    ? renderAuditSummary(auditReport)
    : "Audit data unavailable (audit could not complete).";

  const skillList = SKILL_NAMES.map((s, i) => `${i + 1}. \`${s}\``).join(", ");

  const lines: string[] = [];

  // Title
  lines.push(`# GOAT Flow Critique - ${agentLabel}`);
  lines.push("");

  // Preamble
  lines.push(
    `Critique the goat-flow v${getPackageVersion()} setup on this project. Be thorough, honest, and specific. Do NOT be polite or generous - I want real problems identified with evidence.`,
  );
  lines.push("");
  lines.push(
    "Respond directly with your findings, ratings, and recommendations. Do not write to any files.",
  );
  lines.push("");

  // Context
  lines.push("## Context");
  lines.push("");
  lines.push(`- **Project:** \`${projectPath}\``);
  lines.push(`- **Agent:** ${agentLabel}`);
  lines.push(`- **Instruction file:** \`${instructionFile}\``);
  lines.push(`- **Skills directory:** \`${skillsDir}\``);
  lines.push(`- **Settings:** \`${settingsFile}\``);
  lines.push("");

  // What goat-flow is
  lines.push("## What goat-flow is");
  lines.push("");
  lines.push(
    "A documentation framework that gives AI coding agents structured workflows. It installed into this project:",
  );
  lines.push("");
  lines.push(
    `1. **Instruction file** (\`${instructionFile}\`) - execution loop, autonomy tiers, definition of done, router table. Loaded every turn.`,
  );
  lines.push(
    `2. **7 skills** (6 functional + 1 dispatcher) - ${skillList}. Loaded on demand via slash commands.`,
  );
  lines.push("3. **Hook scripts** - deny-dangerous.sh for safety guardrails.");
  lines.push(
    "4. **Learning loop** (`.goat-flow/`) - config, architecture doc, footguns, lessons, decisions, session logs, templates.",
  );
  lines.push(
    "5. **Shared conventions** - skill-preamble.md (loaded every skill invocation), skill-conventions.md (loaded on full-depth).",
  );
  lines.push("");
  lines.push(
    "The execution loop is READ -> SCOPE -> ACT -> VERIFY (4 steps). Setup follows 6 numbered steps.",
  );
  lines.push("");

  // Audit summary
  lines.push("---");
  lines.push("");
  lines.push("## Audit Summary");
  lines.push("");
  if (auditReport) {
    const overallStatus = auditReport.status === "pass" ? "PASS" : "FAIL";
    lines.push(`**Overall: ${overallStatus}**`);
    lines.push("");
    lines.push(auditSummaryText);
    if (auditReport.status === "fail") {
      lines.push("");
      lines.push(
        "> The setup has failures. Factor these into your critique - are they real problems or false positives?",
      );
    }
  } else {
    lines.push("**Audit: UNAVAILABLE**");
    lines.push(renderDegradedNote());
  }
  lines.push("");

  // Read first
  lines.push("---");
  lines.push("");
  lines.push("## Read first");
  lines.push("");
  lines.push("Read ALL of these before writing any findings:");
  lines.push("");
  lines.push(`- The instruction file: \`${instructionFile}\``);
  lines.push("- `.goat-flow/config.yaml`");
  lines.push("- `.goat-flow/skill-preamble.md`");
  lines.push("- `.goat-flow/skill-conventions.md`");
  lines.push("- `.goat-flow/architecture.md`");
  lines.push("- `.goat-flow/code-map.md` (if it exists)");
  lines.push("- `.goat-flow/glossary.md` (if it exists)");
  lines.push("- `.goat-flow/patterns.md` (if it exists)");
  lines.push(
    `- All installed skills - every \`goat-*/SKILL.md\` in \`${skillsDir}\``,
  );
  lines.push(`- Agent settings: \`${settingsFile}\``);
  lines.push("- All hook scripts in your agent's hooks directory");
  lines.push(
    "- `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/decisions/` (list and review what exists)",
  );
  lines.push("- `.goat-flow/templates/` (list and review what exists)");
  lines.push("");

  // Part 1: Pre-check
  lines.push("---");
  lines.push("");
  lines.push("## Part 1: Pre-check");
  lines.push("");
  lines.push("Answer these immediately after reading:");
  lines.push("");
  lines.push(`- Count skill directories - expect 7: ${SKILL_NAMES.join(", ")}`);
  lines.push(
    "- If >7, list stale names (goat-audit, goat-investigate, goat-onboard, goat-reflect, goat-resume, goat-simplify, goat-refactor, goat-context, goat-preflight, goat-research are known stale)",
  );
  lines.push("- `.goat-flow/skill-preamble.md` exists?");
  lines.push("- `.goat-flow/skill-conventions.md` exists?");
  lines.push("- `.goat-flow/config.yaml` exists and readable?");
  lines.push(
    "- `.goat-flow/templates/` exists? (no `playbooks/` directory - that's legacy)",
  );
  lines.push(
    "- No `todo.md`, `handoff.md`, or `handoff-template.md` in project root or `.goat-flow/`?",
  );
  lines.push(
    `- Instruction file has: project identity, execution loop, autonomy tiers, definition of done, router table, essential commands?`,
  );
  lines.push("- Instruction file line count (target: under 120)?");
  lines.push(
    "- Does the instruction file reference real project paths, or is it generic template fill?",
  );
  lines.push(
    "- Does the router table include `.goat-flow/templates/` and `.goat-flow/footguns/`?",
  );
  lines.push("");

  // Part 2: Skill testing
  lines.push("---");
  lines.push("");
  lines.push(
    "## Part 2: Skill testing - try each on REAL code in this project",
  );
  lines.push("");
  lines.push(
    "For each skill, use it on actual project files. Not hypothetical requests - real modules, real code, real concerns.",
  );
  lines.push("");
  lines.push(
    "1. **`/goat`** (dispatcher) - send 3 different requests. Does routing work? Does the Planning Route handle briefs correctly? Does it route milestones to `/goat-plan` and critique to `/goat-sbao`?",
  );
  lines.push(
    "2. **`/goat-debug`** - investigate a real module or risky pattern in this codebase",
  );
  lines.push(
    "3. **`/goat-plan`** - break a small improvement into milestone task files with testing gates",
  );
  lines.push(
    "4. **`/goat-review`** - review a real source file for quality issues",
  );
  lines.push(
    "5. **`/goat-sbao`** - critique one of the other probe outputs (e.g., the goat-plan milestones or goat-security assessment)",
  );
  lines.push(
    "6. **`/goat-security`** - threat-model one component (auth, API, hooks, config)",
  );
  lines.push(
    "7. **`/goat-test`** - find testing gaps in recent changes or audit coverage for an area",
  );
  lines.push("");
  lines.push(
    "For each skill write: (a) what worked, (b) what was confusing or failed, (c) what was useless ceremony. Cite `file:line` where possible.",
  );
  lines.push("");

  // Part 3: Setup quality critique
  lines.push("---");
  lines.push("");
  lines.push("## Part 3: Setup quality critique");
  lines.push("");
  lines.push("Evaluate how well goat-flow was set up on THIS project:");
  lines.push("");
  lines.push(
    "- Was the instruction file adapted to this project's actual stack and domain, or is it generic?",
  );
  lines.push(
    "- Are the BAD/GOOD examples real and project-specific, or template fill?",
  );
  lines.push(
    "- Are Ask First boundaries specific to real risk areas in THIS codebase, or generic boilerplate?",
  );
  lines.push(
    "- Were existing project files (`.github/instructions/`, `docs/`, etc.) respected or overwritten?",
  );
  lines.push(
    "- Did setup create duplicate surfaces (e.g., both `docs/footguns.md` and `.goat-flow/footguns/`)?",
  );
  lines.push(
    "- Are footgun entries real traps with file:line evidence, or fabricated/generic? Check 3-5 citations - do they point to real code?",
  );
  lines.push("- Are lesson entries from real incidents, or synthetic?");
  lines.push(
    "- Does the architecture doc describe the CURRENT system accurately?",
  );
  lines.push(
    "- Is the router table complete - do all paths resolve to real files?",
  );
  lines.push("- Are essential commands correct - do they actually run?");
  lines.push(
    "- Were hook scripts installed and registered correctly? Does deny-dangerous.sh work?",
  );
  lines.push(
    "- Does `.goat-flow/config.yaml` have real toolchain commands (test, lint, build), or placeholders?",
  );
  lines.push("- Were templates copied to `.goat-flow/templates/`?");
  lines.push("");

  // Part 4: System critique
  lines.push("---");
  lines.push("");
  lines.push("## Part 4: System critique - is goat-flow itself good?");
  lines.push("");
  lines.push("Answer these with evidence from your testing in Part 2:");
  lines.push("");
  lines.push(
    "- Is the execution loop (READ -> SCOPE -> ACT -> VERIFY) useful or ceremonial overhead?",
  );
  lines.push(
    "- Are 7 skills the right number? Which overlap? Which have gaps between them?",
  );
  lines.push("- Does the dispatcher add value or just add a routing step?");
  lines.push(
    "- Does the Planning Route (feature briefs, mob elaboration) work in practice?",
  );
  lines.push("- Is the Definition of Done practical or checkbox theater?");
  lines.push(
    "- Is `skill-preamble.md` (loaded every invocation) worth its weight? Is `skill-conventions.md` (loaded on full-depth) referenced when it should be?",
  );
  lines.push(
    "- Are footguns/lessons actually useful during skill execution, or noise?",
  );
  lines.push(
    "- Are the BLOCKING GATEs placed at the right moments, or do they interrupt flow?",
  );
  lines.push(
    "- Are the quick/full depth choices useful, or does everyone just pick one and ignore the other?",
  );
  lines.push("- Is goat-sbao worth its cost for this project?");
  lines.push(
    "- What's missing that this codebase needs but goat-flow doesn't provide?",
  );
  lines.push("- What should be removed to reduce noise?");
  lines.push("");

  // Part 5: Contradictions and false paths
  lines.push("---");
  lines.push("");
  lines.push("## Part 5: Contradictions and false paths");
  lines.push("");
  lines.push("Check for:");
  lines.push("");
  lines.push(
    "- Any contradiction between the instruction file, skill files, and `.goat-flow/` docs",
  );
  lines.push(
    "- Any path in the instruction file or skills that references a file that doesn't exist",
  );
  lines.push(
    "- Any skill that references `.goat-flow/templates/` files that weren't installed",
  );
  lines.push(
    "- Any skill that references `workflow/` paths - those only exist in the goat-flow repo, not in target projects",
  );
  lines.push(
    '- Any stale references to removed concepts: "playbooks", "coding-standards" as a first-class framework surface, "shapes", old skill names, "handoff.md", "todo.md", old execution loop steps (CLASSIFY, LOG as separate steps)',
  );
  lines.push(
    "- Does the instruction file execution loop match the skill-preamble's description of the loop?",
  );
  lines.push(
    '- Do the skills\' "NOT this skill" boundaries leave gaps? Is there any request that NO skill would handle?',
  );
  lines.push("");

  // Part 6: Specific things to verify
  lines.push("---");
  lines.push("");
  lines.push("## Part 6: Specific things to verify");
  lines.push("");
  lines.push(
    "1. **Skill template integrity:** Do the installed skill files match what you'd expect from a v1.1.0 install? Are there any signs of truncation, merging, or adaptation that broke the structure?",
  );
  lines.push(
    "2. **Config reality:** Does config.yaml's toolchain section (test, lint, build) contain commands that actually work? Run them.",
  );
  lines.push(
    "3. **Hook behavior:** Does deny-dangerous.sh actually block dangerous commands? Try: `rm -rf /`, `git push --force`, `chmod 777` in a hypothetical.",
  );
  lines.push(
    "4. **Router completeness:** For every path in the router table, verify the file/directory exists.",
  );
  lines.push(
    "5. **Evidence quality:** Pick 3-5 footgun or lesson entries. Read the cited file:line. Does the evidence still hold?",
  );
  lines.push(
    '6. **Depth choice coherence:** Invoke one skill with "quick" and one with "full." Is the experience meaningfully different?',
  );
  lines.push("");

  // How to review
  lines.push("---");
  lines.push("");
  lines.push("## How to review");
  lines.push("");
  lines.push("- Judge the current project state on its own merits.");
  lines.push("- Prefer correctness over style comments.");
  lines.push(
    "- Negative verification: for every suspected issue, try to disprove it before reporting it.",
  );
  lines.push(
    '- Do not reduce the review to "does the file exist?" - check whether the CONTENT is correct, specific, and useful.',
  );
  lines.push(
    "- Do not fabricate evidence. If you can't verify a file:line reference, say so.",
  );
  lines.push("");

  // Output format
  lines.push("---");
  lines.push("");
  lines.push("## Output format");
  lines.push("");

  lines.push("### Pre-check Results");
  lines.push("Pass/fail for each item from Part 1.");
  lines.push("");

  lines.push("### Skill Testing Results");
  lines.push(
    "For each of the 7 skills: what worked, what failed, what was ceremony.",
  );
  lines.push("");

  lines.push("### Findings");
  lines.push("Ordered by severity. For each finding:");
  lines.push("- Severity: `BLOCKER`, `MAJOR`, or `MINOR`");
  lines.push(
    "- Type: `setup quality`, `skill flaw`, `contradiction`, `false path`, `content quality`, or `framework flaw`",
  );
  lines.push("- Exact `file:line` reference(s)");
  lines.push("- What is wrong");
  lines.push("- Why it matters");
  lines.push("- Evidence quality: `OBSERVED` or `INFERRED`");
  lines.push("");

  lines.push("### Setup Quality");
  lines.push("Answer directly:");
  lines.push("- Was the setup adapted to this project or generic?");
  lines.push("- What was done well?");
  lines.push("- What was done poorly or left incomplete?");
  lines.push("- What's the single biggest gap?");
  lines.push("");

  lines.push("### System Assessment");
  lines.push("Answer directly:");
  lines.push("- Is goat-flow helping you work better on this project?");
  lines.push("- What's genuinely useful vs ceremony?");
  lines.push("- What's missing?");
  lines.push("- What should be removed?");
  lines.push("");

  lines.push("### Ratings");
  lines.push("");
  lines.push("**Setup: __/100**");
  lines.push(
    "- Accuracy __/25 - did it correctly detect this project's stack and patterns?",
  );
  lines.push("- Relevance __/25 - was generated content specific and useful?");
  lines.push("- Completeness __/25 - was anything important missing?");
  lines.push(
    "- Friction __/25 - how easy was zero-to-productive? (25 = frictionless)",
  );
  lines.push("");
  lines.push("**System: __/100**");
  lines.push("- Usefulness __/25 - does it help you write better code faster?");
  lines.push(
    "- Signal-to-noise __/25 - what percentage is valuable vs ceremony?",
  );
  lines.push(
    "- Adaptability __/25 - does it work for THIS codebase specifically?",
  );
  lines.push(
    "- Learnability __/25 - how quickly can you understand and use it?",
  );
  lines.push("");

  lines.push("### Top 5 Improvements");
  lines.push("For each:");
  lines.push("1. What to change");
  lines.push("2. Evidence from your testing (cite `file:line`)");
  lines.push("3. Expected impact on the ratings");
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(
    "**IMPORTANT:** Respond directly with all findings. Do not write files. Do not summarise - give the full critique with evidence, ratings, and recommendations in your response.",
  );

  const prompt = lines.join("\n");

  return {
    command: "critique",
    agent,
    auditStatus,
    auditSummary: auditSummaryText,
    prompt,
  };
}
