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

const AGENT_HOOKS_DIR: Record<AgentId, string> = {
  claude: ".claude/hooks",
  codex: ".codex/hooks",
  gemini: ".gemini/hooks",
};

function renderAuditSummary(report: AuditReport): string {
  const lines: string[] = [];
  const scopes: [string, string][] = [
    ["setup", "GOAT Flow Setup"],
    ["agent", "Agent Setup"],
  ];
  for (const [scope, label] of scopes) {
    const s = report.scopes[scope as keyof typeof report.scopes];
    if (!s) continue;
    const status = s.status === "pass" ? "PASS" : "FAIL";
    lines.push(`- **${label}**: ${status}`);
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
    lines.push(
      "Harness completeness (structural integrity, not quality assessment):",
    );
    for (const key of keys) {
      lines.push(
        `- ${key}: ${report.concerns[key].status === "pass" ? "PASS" : "FAIL"}`,
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
    "READ-ONLY CRITIQUE MODE. Do NOT edit, create, rename, move, or delete any files. Do NOT run write commands or apply patches. Only read files, run read-only inspection commands, and report your findings, ratings, and recommendations in the response.",
  );
  lines.push("");

  // Rules (moved to top, was "How to review" at bottom)
  lines.push("## Rules");
  lines.push("");
  lines.push("These apply to EVERY finding you report:");
  lines.push("");
  lines.push(
    "- **Read-only only.** Do NOT edit, create, rename, move, or delete files. Do NOT use write commands, redirection, or patch tools. If a skill probe tries to make changes, stop and report that as a critique finding.",
  );
  lines.push(
    "- **No mutation commands.** When testing toolchain commands, use `--check`, `--dry-run`, or read-only flags. Use `format:check` not `format`. Use `eslint` not `eslint --fix`. If unsure, run the tool with `--help` first to find the read-only flag.",
  );
  lines.push(
    "- **Negative verification is mandatory.** Before reporting any finding, try to disprove it. Re-read the cited file. Check if surrounding context resolves it. Only report findings that survive disproval.",
  );
  lines.push(
    '- **Evidence-based only.** No fabricated line numbers - say "approximate" or cite file without a line number. No padding, no softened findings.',
  );
  lines.push(
    '- **Content over existence.** Do not reduce the review to "does the file exist?" - check whether the CONTENT is correct, specific, and useful for THIS project.',
  );
  lines.push(
    "- **Command output wins.** If a command's output contradicts a doc, the command wins.",
  );
  lines.push(
    "- **Judge the current state.** Not what it was, not what it could be. What it IS right now.",
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
    "4. **Learning loop** (`.goat-flow/`) - config, architecture doc, footguns, lessons, decisions, session logs.",
  );
  lines.push(
    "5. **Shared conventions** - skill-preamble.md (loaded every skill invocation), skill-conventions.md (loaded on full-depth).",
  );
  lines.push("");
  lines.push(
    "The execution loop is READ -> SCOPE -> ACT -> VERIFY (4 steps). Setup follows 6 numbered steps.",
  );
  lines.push("");
  lines.push(
    "**Design notes** (do NOT flag these as findings - they are intentional):",
  );
  lines.push(
    '- Session logs (`.goat-flow/logs/sessions/*.md`) and task/milestone files (`.goat-flow/tasks/`) are **intentionally gitignored**. They are local workspace artifacts, not committed content. This is by design - session logs should never be in version control. If the instruction file\'s DoD references session logs, it means "write them locally for the current agent\'s continuity," not "commit them."',
  );
  lines.push(
    "- `toolchain` and `ask_first` fields in `config.yaml` were removed from the base setup in v1.1.0 (see ADR-039). A lean config.yaml with only version, agents, and skills is correct - not a gap.",
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
    lines.push("");
    lines.push(
      "> **Note:** The audit checks structural completeness only (pass/fail per concern). PASS means files exist, paths resolve, and patterns are registered. It does NOT mean documentation is accurate, footguns are current, or content is appropriate for this project. Your critique must assess quality - what the audit cannot.",
    );
    if (auditReport.status === "fail") {
      lines.push(
        "> The setup has failures. Factor these into your critique - are they real problems or false positives?",
      );
    }
  } else {
    lines.push("**Audit: UNAVAILABLE**");
    lines.push(renderDegradedNote());
  }
  lines.push("");

  // Step 0 - Ground yourself (CLI version: audit already injected)
  lines.push("---");
  lines.push("");
  lines.push("## Step 0 - Ground yourself");
  lines.push("");
  lines.push(
    "Audit results are included above in the Audit Summary section. Run these additional read-only commands to ground your critique. Save the output. All findings must be grounded in what commands actually produce.",
  );
  lines.push("");
  lines.push("```bash");
  lines.push(
    "# 1. Run read-only validation commands (do NOT run preflight-checks.sh - it writes to dist/)",
  );
  lines.push(
    `#    Run shellcheck and bash -n on shell scripts listed in ${instructionFile}.`,
  );
  lines.push("#    Record: which pass, which fail, which don't exist.");
  lines.push("");
  lines.push(
    "# 2. Hook self-test (if deny-dangerous.sh exists in your hooks directory)",
  );
  const hooksDir = AGENT_HOOKS_DIR[agent];
  lines.push(`bash ${hooksDir}/deny-dangerous.sh --self-test`);
  lines.push("");
  lines.push("# 3. Quick structural checks");
  lines.push(
    `wc -l ${instructionFile}                          # target: under 120 lines`,
  );
  lines.push(
    `ls ${skillsDir}/                                  # expect 7 goat-flow skill directories`,
  );
  lines.push(
    "cat .goat-flow/config.yaml                        # should have version, agents, skills, line-limits",
  );
  lines.push("```");
  lines.push("");

  // Read next
  lines.push("---");
  lines.push("");
  lines.push("## Read next");
  lines.push("");
  lines.push("After Step 0, read ALL of these before writing any findings:");
  lines.push("");
  lines.push(`- Your instruction file: \`${instructionFile}\``);
  lines.push("- `.goat-flow/config.yaml`");
  lines.push("- `.goat-flow/skill-preamble.md`");
  lines.push("- `.goat-flow/skill-conventions.md`");
  lines.push("- `.goat-flow/architecture.md`");
  lines.push(
    "- `.goat-flow/code-map.md`, `.goat-flow/glossary.md`, `.goat-flow/patterns.md` (if they exist)",
  );
  lines.push(`- All installed skills - every \`SKILL.md\` in \`${skillsDir}\``);
  lines.push(`- Agent settings: \`${settingsFile}\``);
  lines.push("- All hook scripts in your agent's hooks directory");
  lines.push(
    "- `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/decisions/` (list and scan what exists)",
  );

  lines.push("");

  // Part 1: Pre-check (reorganized into subsections, router table moved here)
  lines.push("---");
  lines.push("");
  lines.push("## Part 1: Pre-check");
  lines.push("");
  lines.push("Answer these after reading. Quick pass/fail:");
  lines.push("");
  lines.push("**Structure:**");
  lines.push(
    `- Count skill directories - expect exactly 7: ${SKILL_NAMES.join(", ")}`,
  );
  lines.push(
    "- If >7, list extras. Known stale names: goat-audit, goat-investigate, goat-onboard, goat-reflect, goat-resume, goat-simplify, goat-refactor, goat-context, goat-preflight, goat-research",
  );
  lines.push("- `.goat-flow/skill-preamble.md` exists?");
  lines.push("- `.goat-flow/skill-conventions.md` exists?");
  lines.push("- `.goat-flow/config.yaml` exists and parseable?");
  lines.push("- No `playbooks/` directory (that's legacy)?");
  lines.push(
    "- No `todo.md`, `handoff.md`, or `handoff-template.md` in project root or `.goat-flow/`?",
  );
  lines.push("");
  lines.push("**Instruction file (from Step 0 output):**");
  lines.push("- Line count (target: under 120, hard limit: 150)?");
  lines.push(
    "- Has required sections: project identity, execution loop (4-step READ->SCOPE->ACT->VERIFY), autonomy tiers, definition of done, router table, essential commands?",
  );
  lines.push("- References real project paths or generic template fill?");
  lines.push("");
  lines.push("**Router table integrity:**");
  lines.push(
    "- For EVERY path in the router table, verify the file/directory exists. List any that don't resolve.",
  );
  lines.push("- Does it include `.goat-flow/footguns/`?");
  lines.push("");

  // Part 2: Setup quality (was Part 3, with config/hook checks merged from old Part 6)
  lines.push("---");
  lines.push("");
  lines.push("## Part 2: Setup quality");
  lines.push("");
  lines.push("Evaluate how well goat-flow was adapted to THIS project:");
  lines.push("");
  lines.push("**Adaptation quality:**");
  lines.push(
    "- Was the instruction file written for this project's actual stack and domain? Or is it generic boilerplate that could apply to any repo?",
  );
  lines.push(
    "- Are Ask First boundaries specific to real risk areas in THIS codebase? Or generic placeholders?",
  );
  lines.push(
    "- Are the BAD/GOOD examples (in the instruction file's READ section) drawn from this project? Or template fill?",
  );
  lines.push(
    "- Does the architecture doc (`.goat-flow/architecture.md`) describe the CURRENT system accurately? Read the actual codebase and compare. **Verify numeric claims** (check counts, skill counts, file counts) against actual code exports or constants - numeric claims are the most common doc-code drift.",
  );
  lines.push("");
  lines.push("**Evidence quality - spot-check 3-5 entries:**");
  lines.push(
    "- Pick 3-5 footgun entries from `.goat-flow/footguns/`. For each: (a) read the cited `file:line` - does the code still exhibit the described behavior? (b) Is the `Status` field (active/resolved) accurate? An entry marked `active` that describes fixed behavior is a stale entry - report it. (c) Do the line numbers match the current file?",
  );
  lines.push(
    "- Pick 2-3 lesson entries from `.goat-flow/lessons/`. Are they from real incidents or synthetic?",
  );
  lines.push("");
  lines.push("**Setup hygiene:**");
  lines.push(
    "- Were existing project files (`.github/instructions/`, `docs/`, etc.) respected or overwritten?",
  );
  lines.push(
    "- Did setup create duplicate surfaces (e.g., both `docs/footguns.md` and `.goat-flow/footguns/`)?",
  );
  lines.push("- Was `.goat-flow/scratchpad/` created?");
  lines.push("");
  lines.push("**Config reality:**");
  lines.push(
    "- Does `.goat-flow/config.yaml` stay lean and accurate for this project? If it includes optional project-calibration fields like `toolchain`, verify the commands are real before treating them as authoritative. If you also run the tool at broader scope (e.g., `npx eslint .` vs a project's scoped command), note whether the project intentionally scopes narrower - that's a design choice, not a finding, unless it hides real problems. Beware that `.claude/worktrees/`, `node_modules/`, and `dist/` can pollute unscoped tool runs.",
  );
  lines.push(
    `- Were hook scripts installed and registered in \`${settingsFile}\`?`,
  );
  lines.push(
    "- Did deny-dangerous.sh pass the self-test in Step 0? If not, what failed?",
  );
  lines.push("");

  // Part 3: Skill testing (was Part 2, added "if context is limited" guidance)
  lines.push("---");
  lines.push("");
  lines.push("## Part 3: Skill testing - try each on REAL code");
  lines.push("");
  lines.push(
    "For each skill, assess it against actual project code. Two approaches, in order of preference:",
  );
  lines.push("");
  lines.push(
    "**Option A (preferred): File analysis.** Read each SKILL.md and evaluate its structure, constraints, routing logic, cross-references, and coherence against the codebase. This is safe for read-only critiques and covers most quality signals.",
  );
  lines.push(
    "**Option B (if context allows): Live invocation.** Invoke the skill via the Skill tool on a real target. Monitor for file-write attempts - stop immediately if the skill tries to create or modify files. This tests runtime behavior but costs significant context.",
  );
  lines.push("");
  lines.push("Either approach is acceptable. State which you used.");
  lines.push("");
  lines.push(
    "1. **`/goat`** (dispatcher) - send 3 different read-only requests. Does routing work? Does the Planning Route handle briefs without pushing toward file creation? Does it route critique to `/goat-sbao` and planning questions to `/goat-plan` appropriately?",
  );
  lines.push(
    "2. **`/goat-debug`** - investigate a real module or risky pattern in this codebase",
  );
  lines.push(
    "3. **`/goat-plan`** - ask for a milestone/task breakdown in the response only. Do NOT let it write milestone files; if it tries to, report that as a failure of critique-safe behavior.",
  );
  lines.push(
    "4. **`/goat-review`** - review a real source file for quality issues",
  );
  lines.push(
    "5. **`/goat-sbao`** - critique one of the other probe outputs in the response only (e.g., goat-plan breakdown or goat-security assessment)",
  );
  lines.push(
    "6. **`/goat-security`** - threat-model one real component (auth, API, hooks, config, or whatever is riskiest) without making changes",
  );
  lines.push(
    "7. **`/goat-test`** - find testing gaps in recent changes or audit coverage for a module without creating new tests",
  );
  lines.push("");
  lines.push(
    "For each skill report: (a) what worked, (b) what was confusing or failed, (c) what was useless ceremony. Cite `file:line` where possible.",
  );
  lines.push(
    "If any skill attempts to edit files, create artifacts, or otherwise leave read-only mode, stop that probe immediately and report it as a critique finding.",
  );
  lines.push("");
  lines.push(
    "**If context is limited:** At minimum test `/goat` (routing), `/goat-review` (most common use), and `/goat-sbao` (highest-cost skill). Note which skills you skipped.",
  );
  lines.push("");

  // Part 4: System critique (unchanged except reference to Part 3)
  lines.push("---");
  lines.push("");
  lines.push("## Part 4: System critique - is goat-flow itself good?");
  lines.push("");
  lines.push("Answer with evidence from your testing in Part 3:");
  lines.push("");
  lines.push(
    "- Is the execution loop (READ -> SCOPE -> ACT -> VERIFY) useful or ceremonial overhead? Did you actually follow it during skill testing?",
  );
  lines.push(
    "- Are 7 skills the right number? Which overlap? Which have gaps between them?",
  );
  lines.push(
    "- Does the dispatcher (`/goat`) add value or just add a routing step?",
  );
  lines.push(
    "- Does the Planning Route (feature briefs → /goat-plan) work in practice?",
  );
  lines.push("- Is the Definition of Done practical or checkbox theater?");
  lines.push(
    "- Is `skill-preamble.md` (loaded every invocation) worth its token cost? Is `skill-conventions.md` (loaded on full-depth) referenced when it should be?",
  );
  lines.push(
    "- Are footguns/lessons actually consulted during skill execution, or ignored noise?",
  );
  lines.push(
    "- Are the BLOCKING GATEs placed at the right moments, or do they interrupt productive flow?",
  );
  lines.push(
    "- Are the quick/full depth choices meaningfully different? Or does everyone just pick one?",
  );
  lines.push(
    "- Is `/goat-sbao` worth its cost (spawns sub-agents) for this project's scale?",
  );
  lines.push(
    "- What's missing that this codebase needs but goat-flow doesn't provide?",
  );
  lines.push("- What should be removed to reduce noise?");
  lines.push("");

  // Part 5: Contradictions and false paths (added cross-agent consistency check)
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
    "- Any skill that references `.goat-flow/templates/` (removed from core)",
  );
  lines.push(
    "- Any skill that references `workflow/` paths - those are framework-internal and don't exist in target projects",
  );
  lines.push(
    '- Any stale references to removed concepts: "playbooks", "coding-standards" as a first-class surface, "shapes", old skill names, "handoff.md", "todo.md", old execution loop steps (CLASSIFY, LOG as separate steps)',
  );
  lines.push(
    "- Does the instruction file execution loop match the skill-preamble's description?",
  );
  lines.push(
    '- Do the skills\' "NOT this skill" boundaries leave gaps? Is there any request that NO skill would handle?',
  );
  lines.push("");
  lines.push(
    `**Note:** Cross-agent consistency checks (deny patterns, skill parity, instruction structure) belong in the deterministic audit, not this per-agent critique. Focus on ${agentLabel}'s surfaces only.`,
  );
  lines.push("");

  // Part 6: Skill template integrity (new focused section from old Part 6 remnants)
  lines.push("---");
  lines.push("");
  lines.push("## Part 6: Skill template integrity");
  lines.push("");
  lines.push(
    "1. **Version tags:** Do all installed SKILL.md files have a `goat-flow-skill-version` header? Does it match the config.yaml version?",
  );
  lines.push(
    "2. **Truncation or corruption:** Do the installed skill files look complete? Are there any signs of truncation, merging, or adaptation that broke the structure? (Skills should be installed verbatim from templates - they should NOT be adapted.)",
  );
  lines.push(
    '3. **Depth choice coherence:** Invoke one skill with "quick" and one with "full" in read-only mode. Is the experience meaningfully different?',
  );
  lines.push("");

  // Output format
  lines.push("---");
  lines.push("");
  lines.push("## Output format");
  lines.push("");

  lines.push("### Pre-check Results");
  lines.push(
    "Pass/fail for each item from Part 1. Include Step 0 command output summary.",
  );
  lines.push("");

  lines.push("### Skill Testing Results");
  lines.push(
    "For each of the 7 skills (or subset tested): what worked, what failed, what was ceremony.",
  );
  lines.push("");

  lines.push("### Findings");
  lines.push("Ordered by severity. For each:");
  lines.push(
    "- Severity: `BLOCKER` (prevents work or creates safety risk), `MAJOR` (framework violates its own stated standards or a documented quality gate fails), or `MINOR` (suboptimal but not actively harmful)",
  );
  lines.push(
    "- Type: `setup quality`, `skill flaw`, `contradiction`, `false path`, `content quality`, or `framework flaw`",
  );
  lines.push("- Exact `file:line` reference(s)");
  lines.push("- What is wrong");
  lines.push("- Why it matters");
  lines.push(
    "- Evidence quality: `OBSERVED` (verified in code/output) or `INFERRED` (state what's missing)",
  );
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

  lines.push("### What You Did Not Verify");
  lines.push(
    "Be explicit about remaining uncertainty. List skipped skills, untested commands, unverified claims.",
  );
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(
    "**IMPORTANT:** Respond directly with all findings. DO NOT EDIT ANY FILES. ONLY READ, INSPECT, AND REPORT. Do not summarise - give the full critique with evidence, ratings, and recommendations in your response.",
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
