/**
 * Composes a structured quality-assessment prompt for a selected agent.
 * Embeds live audit results when available.
 */
import type { AgentId } from "../types.js";
import type { AuditReport, AuditConcernKey } from "../audit/types.js";
import type { QualityHistoryEntry } from "../quality/history.js";
import { loadManifest } from "../manifest/manifest.js";
import { getAgentProfile } from "../agents/registry.js";
import { getPackageVersion } from "../paths.js";
import { QUALITY_REPORT_KIND } from "../quality/schema.js";

interface QualityInput {
  agent: AgentId;
  projectPath: string;
  auditReport: AuditReport | null;
  priorReport?: QualityHistoryEntry | null;
  runDate?: string;
}

interface QualityPayload {
  command: "quality";
  agent: AgentId;
  auditStatus: "pass" | "fail" | "unavailable";
  auditSummary: string;
  prompt: string;
}

/** Format one date using the local calendar day in YYYY-MM-DD form. */
function formatLocalDate(date: Date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Render one JSON-safe string literal for the embedded example block. */
function jsonString(value: string): string {
  return JSON.stringify(value);
}

/** Render the audit summary block embedded in the quality prompt. */
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

/** Render the fallback note used when audit data is unavailable. */
function renderDegradedNote(): string {
  return [
    "",
    "> **Note:** The automated audit could not complete on this project.",
    "> This may indicate missing config, broken setup, or an incomplete install.",
    "> Proceed with the assessment anyway - your findings may catch what the audit could not.",
    "",
  ].join("\n");
}

/** Return the finding severity rank. */
function findingSeverityRank(severity: "BLOCKER" | "MAJOR" | "MINOR"): number {
  if (severity === "BLOCKER") return 0;
  if (severity === "MAJOR") return 1;
  return 2;
}

/** Compose the quality review prompt. */
// eslint-disable-next-line complexity -- prompt assembly branches on audit availability and split hook-config surfaces
export function composeQuality(input: QualityInput): QualityPayload {
  const {
    agent,
    projectPath,
    auditReport,
    priorReport = null,
    runDate = formatLocalDate(),
  } = input;
  const profile = getAgentProfile(agent);
  const agentLabel = profile.name;
  const skillsDir = profile.skillsDir;
  const settingsFile = profile.settingsFile ?? "(no settings file)";
  const hookConfigFile = profile.hookConfigFile ?? settingsFile;
  const instructionFile = profile.instructionFile;
  const hooksDir = profile.hooksDir;
  const denyHookFile = profile.denyHookFile;

  const auditStatus: QualityPayload["auditStatus"] = auditReport
    ? auditReport.status
    : "unavailable";

  const auditSummaryText = auditReport
    ? renderAuditSummary(auditReport)
    : "Audit data unavailable (audit could not complete).";

  const skillFacts = loadManifest().facts.skills;
  const skillList = skillFacts.names
    .map((s, i) => `${i + 1}. \`${s}\``)
    .join(", ");

  const lines: string[] = [];

  // Title
  lines.push(`# GOAT Flow Quality Assessment - ${agentLabel}`);
  lines.push("");

  // Preamble
  lines.push(
    `Assess the quality of the goat-flow v${getPackageVersion()} setup on this project. Be thorough, honest, and specific. Do NOT be polite or generous - I want real problems identified with evidence.`,
  );
  lines.push("");
  lines.push(
    "REPORTING-ONLY ASSESSMENT MODE. Do NOT edit, create, rename, move, or delete any tracked files. Do NOT apply patches or implement fixes. Gitignored local artifacts written by validation tools or normal reporting workflows (e.g. `dist/`, `node_modules/`, `.claude/worktrees/`, `.goat-flow/logs/**`, `.goat-flow/scratchpad/**`, `.goat-flow/tasks/**`) are fine - they don't change the repo's committed state. This prompt also instructs you to write your final JSON report to `.goat-flow/logs/quality/<filename>.json`.",
  );
  lines.push("");

  // Rules (moved to top, was "How to review" at bottom)
  lines.push("## Rules");
  lines.push("");
  lines.push("These apply to EVERY finding you report:");
  lines.push("");
  lines.push(
    "- **No tracked-file writes.** Do NOT edit, create, rename, move, or delete tracked files. Redirection and write commands targeting gitignored local/build/reporting paths (e.g. `dist/`, `node_modules/`, `.claude/worktrees/`, `.goat-flow/logs/**`, `.goat-flow/scratchpad/**`, `.goat-flow/tasks/**`) are fine when they are part of normal validation or reporting. If a skill probe tries to modify tracked files or implement code, stop and report that as a finding.",
  );
  lines.push(
    "- **Mode vocabulary matters.** `reporting-only` means no committed-file changes and no implementation; gitignored logs, critique snapshots, scratchpad notes, and task checkbox updates are still compatible with reporting-only work. `strict no-write` means no writes except paths explicitly named by the prompt. Do not label allowed gitignored reporting/local-state writes as read-only violations.",
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
  lines.push(`- **Settings file:** \`${settingsFile}\``);
  if (hookConfigFile !== settingsFile) {
    lines.push(`- **Hook registration file:** \`${hookConfigFile}\``);
  }
  if (hooksDir) {
    lines.push(`- **Hooks directory:** \`${hooksDir}\``);
  }
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
    `2. **${skillFacts.total} skills** (${skillFacts.functional_count} functional + 1 dispatcher) - ${skillList}. Loaded on demand via slash commands.`,
  );
  lines.push("3. **Hook scripts** - deny-dangerous.sh for safety guardrails.");
  lines.push(
    "4. **Learning loop** (`.goat-flow/`) - config, architecture doc, footguns, lessons, decisions, session logs.",
  );
  lines.push(
    "5. **Shared reference** (under `.goat-flow/skill-reference/`) - skill-preamble.md (loaded every skill invocation), skill-conventions.md (loaded on full-depth), skill-quality-testing.md index plus skill-quality-testing/tdd-iteration.md, skill-quality-testing/adversarial-framing.md, and skill-quality-testing/deployment.md (full-depth authoring methodology split across an index and three topical files per ADR-023; load the topical file matching your skill type).",
  );
  lines.push("");
  lines.push(
    "The execution loop is READ -> SCOPE -> ACT -> VERIFY (4 steps). Setup follows 6 numbered steps.",
  );
  lines.push("");
  lines.push(
    "**Glossary (brief):** *Preflight* - the local umbrella validation script (`bash scripts/preflight-checks.sh`) that runs shellcheck, typecheck, ESLint, Prettier, tests, and project-specific drift checks. Preflight PASS is a hot-path DoD signal; a failing preflight is a real finding. *Audit* - `goat-flow audit` structural installation check (deterministic, no LLM). *Quality* - the agent-driven assessment this prompt generates.",
  );
  lines.push("");
  lines.push(
    "**Design notes** (do NOT flag these as findings - they are intentional):",
  );
  lines.push(
    '- Session logs (`.goat-flow/logs/sessions/*.md`), critique snapshots (`.goat-flow/logs/critiques/*.md`), scratchpad notes, and task/milestone files (`.goat-flow/tasks/`, scoped by the `.goat-flow/tasks/.active` marker - see ADR-017) are **intentionally gitignored**. They are local workspace artifacts, not committed content. This is by design - session logs should never be in version control. If the instruction file\'s DoD references session logs, it means "write them locally for the current agent\'s continuity," not "commit them."',
  );
  lines.push(
    "- `.goat-flow/tasks/.active` is an advisory local pointer, not a setup invariant. Missing `.active`, or `.active` naming a missing subdir, is normal local churn when work completes, users switch projects, or a project does not use goat-flow task files. Do NOT report this by itself as a setup-quality finding; evaluate whether `/goat` and `/goat-plan` handle the fallback gracefully.",
  );
  lines.push(
    "- `toolchain` and `ask_first` fields in `config.yaml` were removed from the base setup in v1.1.0 (see ADR-014). A lean config.yaml with only version, agents, and skills is correct - not a gap.",
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
      "> **Note:** The audit checks structural completeness only (pass/fail per concern). PASS means files exist, paths resolve, and patterns are registered. It does NOT mean documentation is accurate, footguns are current, or content is appropriate for this project. Your assessment must judge quality - what the audit cannot.",
    );
    if (auditReport.status === "fail") {
      lines.push(
        "> The setup has failures. Factor these into your assessment - are they real problems or false positives?",
      );
    }
  } else {
    lines.push("**Audit: UNAVAILABLE**");
    lines.push(renderDegradedNote());
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## Prior report context");
  lines.push("");
  if (priorReport) {
    const priorHighSeverityCount = priorReport.report.findings.filter(
      (finding) =>
        finding.severity === "BLOCKER" || finding.severity === "MAJOR",
    ).length;
    const priorTopFindings = [...priorReport.report.findings]
      .sort((left, right) => {
        const severityDiff =
          findingSeverityRank(left.severity) -
          findingSeverityRank(right.severity);
        if (severityDiff !== 0) return severityDiff;
        return left.id.localeCompare(right.id);
      })
      .slice(0, 3);

    lines.push(
      `Latest same-agent report: \`${priorReport.id}\` (${priorReport.report.run_date})`,
    );
    lines.push(`- Setup total: ${priorReport.report.scores.setup.total}/100`);
    lines.push(`- System total: ${priorReport.report.scores.system.total}/100`);
    lines.push(`- Prior BLOCKER + MAJOR count: ${priorHighSeverityCount}`);
    lines.push("- Top prior findings by severity:");
    for (const finding of priorTopFindings) {
      lines.push(
        `  - \`${finding.id}\` | ${finding.severity} | ${finding.type} | ${finding.summary}`,
      );
    }
    lines.push("");
    lines.push(
      'For the final JSON block in THIS run, use `delta_tag: "persisted"` when a current finding materially matches a prior finding by type/file/line. Use `delta_tag: "new"` when it does not. Do NOT emit `resolved` in current findings - resolved issues are derived later by `goat-flow quality diff` when a prior finding id disappears from a later run.',
    );
  } else {
    lines.push("No prior same-agent quality report exists for this project.");
    lines.push(
      "For the final JSON block in this run, omit `delta_tag` or set it to `null` for every finding.",
    );
  }
  lines.push("");

  // Step 0 - Ground yourself (CLI version: audit already injected)
  lines.push("---");
  lines.push("");
  lines.push("## Step 0 - Ground yourself");
  lines.push("");
  lines.push(
    "Audit results are included above in the Audit Summary section. Run these additional read-only commands to ground your assessment. Save the output. All findings must be grounded in what commands actually produce.",
  );
  lines.push("");
  lines.push("```bash");
  lines.push(
    "# 1. Run read-only validation commands. If the project ships an umbrella script that ties shellcheck/typecheck/tests/audit together (e.g. `bash scripts/preflight-checks.sh`), run it - any writes land in gitignored build directories.",
  );
  lines.push(
    `#    Otherwise, run shellcheck and bash -n on shell scripts listed in ${instructionFile}.`,
  );
  lines.push("#    Record: which pass, which fail, which don't exist.");
  lines.push("");
  lines.push(
    "# 2. Hook self-test (if deny-dangerous.sh exists in your hooks directory)",
  );
  if (denyHookFile) {
    lines.push(`bash ${denyHookFile} --self-test`);
  } else {
    lines.push("#    This agent has no on-disk deny hook script to self-test.");
  }
  lines.push("");
  lines.push("# 3. Quick structural checks");
  lines.push(
    `wc -l ${instructionFile}                          # target: about 120 lines; hard limit: 150`,
  );
  lines.push(
    `ls ${skillsDir}/                                  # expect ${skillFacts.total} goat-flow skill directories`,
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
  lines.push("- `.goat-flow/skill-reference/skill-preamble.md`");
  lines.push("- `.goat-flow/skill-reference/skill-conventions.md`");
  lines.push("- `.goat-flow/architecture.md`");
  lines.push(
    "- `.goat-flow/code-map.md`, `.goat-flow/glossary.md`, `.goat-flow/patterns.md` (if they exist)",
  );
  lines.push(
    `- All installed skill files in \`${skillsDir}\` - each \`SKILL.md\` plus any nested \`references/*.md\` packs`,
  );
  lines.push(`- Agent settings: \`${settingsFile}\``);
  if (hookConfigFile !== settingsFile) {
    lines.push(`- Hook registration file: \`${hookConfigFile}\``);
  }
  if (hooksDir) {
    lines.push("- All hook scripts in your agent's hooks directory");
  }

  lines.push("");
  lines.push(
    "For the learning loop - `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/decisions/` - DO NOT broad-load. Use grep-first retrieval per `skill-preamble.md` Learning-Loop Retrieval: derive 2-4 search terms from the target area and expected failure class, run `rg -n -i -S '<term1>|<term2>|<term3>' .goat-flow/footguns .goat-flow/lessons .goat-flow/decisions`, open only matching entries, reword once on zero hits, then record a retrieval miss. Broad-loading recreates the context-bloat failure this protocol exists to prevent.",
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
    `- Count skill directories - expect exactly ${skillFacts.total}: ${skillFacts.names.join(", ")}`,
  );
  lines.push(
    `- If >${skillFacts.total}, list extras. Known stale names: ${skillFacts.stale_names.join(", ")}`,
  );
  lines.push("- `.goat-flow/skill-reference/skill-preamble.md` exists?");
  lines.push("- `.goat-flow/skill-reference/skill-conventions.md` exists?");
  lines.push("- `.goat-flow/config.yaml` exists and parseable?");
  lines.push("- No `playbooks/` directory (that's legacy)?");
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
    `- Were hook scripts installed and registered in \`${hookConfigFile}\`?`,
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
    "**Option A (preferred): File analysis.** Read each SKILL.md and evaluate its structure, constraints, routing logic, cross-references, and coherence against the codebase. This is safe for reporting-only assessment and covers most quality signals.",
  );
  lines.push(
    "**Option B (if context allows): Live invocation.** Invoke the skill through the agent's normal slash-command/runtime path on a real target. Monitor for committed-file changes or implementation attempts - stop immediately if the skill tries to modify tracked files or code. Gitignored reporting/local-state writes are allowed under reporting-only probes. This tests runtime behavior but costs significant context.",
  );
  lines.push("");
  lines.push("Either approach is acceptable. State which you used.");
  lines.push("");
  lines.push(
    "1. **`/goat`** (dispatcher) - send 3 different reporting-only requests. Does routing work? Does the Planning Route handle briefs without pushing toward committed-file changes or implementation? Does it route critique requests to `/goat-critique` and planning questions to `/goat-plan` appropriately?",
  );
  lines.push(
    "2. **`/goat-debug`** - investigate a real module or risky pattern in this codebase",
  );
  lines.push(
    "3. **`/goat-plan`** - ask for a milestone/task breakdown inline. If it writes milestone files despite an inline/reporting-only request, report the mode confusion; do not frame gitignored task-file writes as committed-state read-only violations.",
  );
  lines.push(
    "4. **`/goat-review`** - review a real source file for quality issues",
  );
  lines.push(
    "5. **`/goat-critique`** - critique one of the other probe outputs in reporting-only / no-implementation mode (e.g., goat-plan breakdown or goat-security assessment). Gitignored critique logs are allowed; judge whether it attempts to implement recommendations or modify tracked files.",
  );
  lines.push(
    "6. **`/goat-security`** - threat-model one real component (auth, API, hooks, config, or whatever is riskiest) without making changes",
  );
  lines.push(
    "7. **`/goat-qa`** - find testing gaps in recent changes or audit coverage for a module without creating new tests",
  );
  lines.push("");
  lines.push(
    "For each skill report: (a) what worked, (b) what was confusing or failed, (c) what was useless ceremony. Cite `file:line` where possible.",
  );
  lines.push(
    "If any skill attempts to edit tracked files, implement code, or write outside the allowed gitignored local-state/reporting paths, stop that probe immediately and report it as a finding.",
  );
  lines.push("");
  lines.push(
    "**If context is limited:** At minimum test `/goat` (routing), `/goat-review` (most common use), and `/goat-critique` (highest-cost skill). Note which skills you skipped.",
  );
  lines.push("");

  // Part 4: System assessment
  lines.push("---");
  lines.push("");
  lines.push("## Part 4: System assessment - is goat-flow itself good?");
  lines.push("");
  lines.push("Answer with evidence from your testing in Part 3:");
  lines.push("");
  lines.push(
    "- Is the execution loop (READ -> SCOPE -> ACT -> VERIFY) useful or ceremonial overhead? Did you actually follow it during skill testing?",
  );
  lines.push(
    `- Are ${skillFacts.total} skills the right number? Which overlap? Which have gaps between them?`,
  );
  lines.push(
    "- Does the dispatcher (`/goat`) add value or just add a routing step?",
  );
  lines.push(
    "- Does the Planning Route (feature briefs → /goat-plan) work in practice?",
  );
  lines.push("- Is the Definition of Done practical or checkbox theater?");
  lines.push(
    "- Is `skill-preamble.md` (loaded every invocation) worth its token cost? Is `skill-conventions.md` (loaded on full-depth) referenced when it should be? Are the `skill-quality-testing.md` index and its topical files (tdd-iteration / adversarial-framing / deployment) consulted when skills are created or hardened, or do they sit unused?",
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
    "- Is `/goat-critique` worth its cost (spawns sub-agents) for this project's scale?",
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
    '- Any stale references to removed concepts: "playbooks", "coding-standards" as a first-class surface, "shapes", old skill names, removed legacy task-state surfaces, old execution loop steps (CLASSIFY, LOG as separate steps)',
  );
  lines.push(
    "- Does the instruction file execution loop match the skill-preamble's description?",
  );
  lines.push(
    '- Do the skills\' "NOT this skill" boundaries leave gaps? Is there any request that NO skill would handle?',
  );
  lines.push("");
  lines.push(
    `**Note:** Cross-agent consistency checks (deny patterns, skill parity, instruction structure) belong in the deterministic audit, not this per-agent assessment. Focus on ${agentLabel}'s surfaces only.`,
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
    '3. **Depth choice coherence:** Invoke one skill with "quick" and one with "full" in reporting-only mode. Is the experience meaningfully different?',
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
    `For each of the ${skillFacts.total} skills (or subset tested): what worked, what failed, what was ceremony.`,
  );
  lines.push("");

  lines.push("### Findings");
  lines.push("Ordered by severity. For each:");
  lines.push(
    "- Severity: `BLOCKER` (prevents work or creates safety risk), `MAJOR` (framework violates its own stated standards or a documented quality gate fails), or `MINOR` (suboptimal but not actively harmful)",
  );
  lines.push(
    "- Type: `setup_quality`, `skill_flaw`, `contradiction`, `false_path`, `content_quality`, or `framework_flaw`",
  );
  lines.push("- Exact `file:line` reference(s)");
  lines.push("- What is wrong");
  lines.push("- Why it matters");
  lines.push(
    "- Evidence quality: `OBSERVED` (verified in code/output) or `INFERRED` (state what's missing)",
  );
  lines.push(
    "- If prior report context was provided, current findings only use `delta_tag: new | persisted`; `resolved` belongs in derived diff output, not the current finding list.",
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

  lines.push("### Rating bands");
  lines.push("Use exact 25 / 20 / 15 / 10 / 5 / 0 increments only:");
  lines.push(
    "- Setup / Accuracy: 25 = all fact-checked claims verify; 20 = 1-2 minor drift points; 15 = one hot-path factual error; 10 = multiple hot-path errors; 5 = instruction file materially misstates the project; 0 = fabricated or wrong project.",
  );
  lines.push(
    "- Setup / Relevance: 25 = content is project-specific and directly useful; 20 = mostly adapted with small boilerplate residue; 15 = meaningful generic carry-over; 10 = mostly boilerplate; 5 = barely adapted; 0 = generic template noise.",
  );
  lines.push(
    "- Setup / Completeness: 25 = no important setup surface missing; 20 = one minor omission; 15 = one important omission with workaround; 10 = multiple gaps; 5 = missing a load-bearing surface; 0 = incomplete to the point of blocking productive use.",
  );
  lines.push(
    "- Setup / Friction: 25 = frictionless orientation; 20 = minor ceremony; 15 = noticeable but workable friction; 10 = frequent unnecessary steps; 5 = heavy ceremony or confusion; 0 = setup actively impedes work.",
  );
  lines.push(
    "- System / Usefulness: 25 = consistently improves work on this repo; 20 = useful more often than not; 15 = mixed value; 10 = occasional value only; 5 = mostly overhead; 0 = not useful.",
  );
  lines.push(
    "- System / Signal-to-noise: 25 = almost all content carries its weight; 20 = some redundancy; 15 = meaningful noise; 10 = more noise than signal; 5 = mostly ceremony; 0 = overwhelming noise.",
  );
  lines.push(
    "- System / Adaptability: 25 = clearly shaped for this codebase; 20 = mostly adapted; 15 = partial adaptation; 10 = generic assumptions leak through; 5 = poor fit; 0 = incompatible with the repo's real shape.",
  );
  lines.push(
    "- System / Learnability: 25 = fast to understand and apply; 20 = small onboarding tax; 15 = moderate study required; 10 = confusing structure; 5 = hard to learn; 0 = effectively opaque.",
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

  lines.push("### Write the JSON report");
  lines.push("");
  lines.push(
    "Do **not** emit the JSON as a fenced block in your reply. Write it as a file to `.goat-flow/logs/quality/` - that path is gitignored and expected, no other writes are permitted.",
  );
  lines.push("");
  lines.push("**Filename format:** `YYYY-MM-DD-HHMM-<agent>-<rand5>.json`");
  lines.push("");
  lines.push("Where:");
  lines.push(
    "- `YYYY-MM-DD-HHMM` is the current local date and 24-hour time (e.g. `2026-04-19-1430`)",
  );
  lines.push(`- \`<agent>\` is the literal string \`${agent}\``);
  lines.push(
    "- `<rand5>` is 5 lowercase alphanumeric characters (a-z, 0-9) that you generate fresh to avoid collisions with other parallel runs",
  );
  lines.push("");
  lines.push(
    "**Derive the date/time/random parts via your shell** (so the filename reflects when the report was actually written, not when this prompt was generated). On Linux/macOS:",
  );
  lines.push("");
  lines.push("```bash");
  lines.push('STAMP="$(date +"%Y-%m-%d-%H%M")"      # e.g. 2026-04-19-1430');
  lines.push("RAND=\"$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 5)\"");
  lines.push(`FILE=".goat-flow/logs/quality/\${STAMP}-${agent}-\${RAND}.json"`);
  lines.push("mkdir -p .goat-flow/logs/quality");
  lines.push("# (then write the JSON below to $FILE)");
  lines.push("```");
  lines.push("");
  lines.push("**JSON body shape:**");
  lines.push("");
  lines.push("```json");
  lines.push("{");
  lines.push(`  "report_kind": ${jsonString(QUALITY_REPORT_KIND)},`);
  lines.push(`  "goat_flow_version": ${jsonString(getPackageVersion())},`);
  lines.push(`  "agent": ${jsonString(agent)},`);
  lines.push(`  "project_path": ${jsonString(projectPath)},`);
  lines.push(`  "run_date": ${jsonString(runDate)},`);
  lines.push(`  "audit_status": ${jsonString(auditStatus)},`);
  lines.push('  "scope": "framework-self | consumer",');
  lines.push(`  "rubric_version": ${jsonString(getPackageVersion())},`);
  lines.push('  "scores": {');
  lines.push(
    '    "setup": { "total": 0, "accuracy": 0, "relevance": 0, "completeness": 0, "friction": 0 },',
  );
  lines.push(
    '    "system": { "total": 0, "usefulness": 0, "signal_to_noise": 0, "adaptability": 0, "learnability": 0 }',
  );
  lines.push("  },");
  lines.push('  "findings": [');
  lines.push("    {");
  lines.push(
    '      "type": "setup_quality", "severity": "MAJOR", "file": ".goat-flow/architecture.md", "line": 12,',
  );
  lines.push(
    `      "summary": "One-line finding summary", "detail": "Why it matters", "evidence_quality": "OBSERVED", "evidence_method": "static-analysis", "delta_tag": ${priorReport ? '"new"' : "null"}`,
  );
  lines.push("    }");
  lines.push("  ]");
  lines.push("}");
  lines.push("```");
  lines.push("");
  lines.push("JSON rules:");
  lines.push(
    "- `scores.*` axis values must use exact `0 | 5 | 10 | 15 | 20 | 25` increments and each axis sum must equal its `total` exactly.",
  );
  lines.push(
    "- Allowed `type` values: `setup_quality`, `skill_flaw`, `contradiction`, `false_path`, `content_quality`, `framework_flaw`.",
  );
  lines.push("- Allowed `severity` values: `BLOCKER`, `MAJOR`, `MINOR`.");
  lines.push(
    "- `evidence_quality` is REQUIRED on every finding. Allowed values: `OBSERVED` (verified in code/output), `INFERRED` (state what's missing). Omitting this field causes the report to be rejected.",
  );
  lines.push(
    "- `evidence_method` is REQUIRED on every finding (schema v2, 2026-04-19+). Allowed values: `runtime-probe` (you invoked commands/tools to verify - e.g. `npx eslint`, `bash <hook>`), `static-analysis` (you read files only), `mixed` (both methods for this specific finding). A finding labelled `OBSERVED` via `static-analysis` can still miss runtime-only defects; labelling the method honestly lets cross-report triangulation flag methodology gaps.",
  );
  lines.push(
    '- `scope` is REQUIRED at top level. Set `framework-self` if you detect this is the goat-flow repo itself (heuristic: `package.json` contains `"name": "@blundergoat/goat-flow"`). Otherwise set `consumer`.',
  );
  lines.push(
    `- \`rubric_version\` is REQUIRED at top level; copy the template value (\`"${getPackageVersion()}"\`). The Rating bands section above is the rubric - future readers use this version tag to trace which band anchors produced your scores.`,
  );
  lines.push(
    "- `line` must be a positive integer OR `null`. Never `0`. For file-wide findings with no specific line, use `null`.",
  );
  if (priorReport) {
    lines.push(
      '- `delta_tag` is REQUIRED on every current finding and must be either `"new"` or `"persisted"`.',
    );
  } else {
    lines.push(
      "- `delta_tag` must be `null` or omitted when no prior report context exists.",
    );
  }
  lines.push(
    "- Do NOT include an `id` field. The CLI attaches positional finding ids deterministically when the report is loaded.",
  );
  lines.push(
    "- Do NOT include extra top-level keys or extra finding keys. Unknown keys are rejected.",
  );
  lines.push(
    "- `summary` and `detail` MUST be single-line strings. No literal newlines, tabs, or other control characters. If you need to reference multi-line command output, summarise the outcome in prose - do NOT paste raw terminal blocks into JSON string fields. Pasted multi-line content produces unparseable JSON and the report is lost.",
  );
  lines.push(
    "- If you write the file via a bash heredoc, QUOTE the delimiter (`<<'EOF'`, not `<<EOF`). Unquoted delimiters make the shell interpret `` `backticks` `` as command substitution, which silently eats your inline code references.",
  );
  lines.push("");
  lines.push("**Validate before confirming.** After writing the file, run:");
  lines.push("");
  lines.push("```bash");
  lines.push(
    'goat-flow quality validate "$FILE"   # or: node --import tsx src/cli/cli.ts quality validate "$FILE"',
  );
  lines.push("```");
  lines.push("");
  lines.push(
    "If validate exits non-zero, read the reported error, fix the JSON, and re-write the file. Do NOT emit the confirmation below until validate passes.",
  );
  lines.push("");
  lines.push(
    "**End of response:** After validate passes, confirm in prose with a single line: `Wrote quality report to .goat-flow/logs/quality/<your-filename>.json`. Do not include the JSON inline in your reply.",
  );
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(
    "**IMPORTANT:** Respond with the full prose assessment (Pre-check Results through What You Did Not Verify). Write the JSON report to the file path described above. Then end your reply with the one-line confirmation. Do not edit any tracked file. Do not emit the JSON as a fenced block in your reply.",
  );

  const prompt = lines.join("\n");

  return {
    command: "quality",
    agent,
    auditStatus,
    auditSummary: auditSummaryText,
    prompt,
  };
}
