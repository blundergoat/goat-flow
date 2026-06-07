/**
 * Composer for the agent-setup quality-assessment prompt.
 *
 * Builds the long reporting-only prompt that asks an agent to judge how well
 * goat-flow was installed for one project + agent pairing. It gathers the prompt
 * context once (`buildAgentSetupContext`), then appends each Markdown section -
 * rules, audit summary, Step 0 grounding, pre-check, setup quality, skill testing,
 * system assessment, output format, and the JSON-report contract - as line blocks.
 * Pure string assembly; inputs are the manifest, agent profile, and QualityInput.
 */
import { getAgentProfile } from "../agents/registry.js";
import { loadManifest } from "../manifest/manifest.js";
import { getPackageVersion } from "../paths.js";
import type { QualityMode } from "../quality/schema.js";
import {
  formatLocalDate,
  renderAuditSummary,
  renderAuditUnavailableHeading,
  renderAuditUnavailableSummary,
  renderBoundedLearningLoopContext,
  renderDegradedNote,
  renderPriorReportContext,
  type AuditUnavailableReason,
  type QualityInput,
  type QualityPayload,
} from "./compose-quality-common.js";
import { appendAgentReportContract } from "./compose-quality-agent-report.js";

type SkillFacts = ReturnType<typeof loadManifest>["facts"]["skills"];

/**
 * Precomputed values every `append*` section needs, resolved once by
 * `buildAgentSetupContext` so the section helpers stay pure string assembly and
 * never re-read the manifest or agent profile. Agent-relative paths are already
 * resolved here (skills dir, settings/hook config, instruction file) and may be
 * null when the agent profile has no such surface.
 */
interface AgentSetupPromptContext {
  input: QualityInput;
  agent: QualityInput["agent"];
  projectPath: string;
  auditUnavailableReason: AuditUnavailableReason;
  priorReport: NonNullable<QualityInput["priorReport"]> | null;
  qualityMode: QualityMode;
  runDate: string;
  auditStatus: QualityPayload["auditStatus"];
  auditSummaryText: string;
  agentLabel: string;
  skillsDir: string;
  settingsFile: string;
  hookConfigFile: string;
  instructionFile: string;
  hooksDir: string | null;
  denyHookFile: string | null;
  skillFacts: SkillFacts;
  skillList: string;
}

function buildAgentSetupContext(
  input: QualityInput,
  qualityMode: QualityMode,
): AgentSetupPromptContext {
  const {
    agent,
    projectPath,
    auditReport,
    auditUnavailableReason = "audit-failed",
    priorReport = null,
    runDate = formatLocalDate(),
  } = input;
  const profile = getAgentProfile(agent);
  const settingsFile = profile.settingsFile ?? "(no settings file)";
  const hookConfigFile = profile.hookConfigFile ?? settingsFile;
  const auditStatus: QualityPayload["auditStatus"] = auditReport
    ? auditReport.status
    : "unavailable";
  const auditSummaryText = auditReport
    ? renderAuditSummary(auditReport)
    : renderAuditUnavailableSummary(auditUnavailableReason);
  const skillFacts = loadManifest().facts.skills;
  const skillList = skillFacts.names
    .map((s, i) => `${i + 1}. \`${s}\``)
    .join(", ");

  return {
    input,
    agent,
    projectPath,
    auditUnavailableReason,
    priorReport,
    qualityMode,
    runDate,
    auditStatus,
    auditSummaryText,
    agentLabel: profile.name,
    skillsDir: profile.skillsDir,
    settingsFile,
    hookConfigFile,
    instructionFile: profile.instructionFile,
    hooksDir: profile.hooksDir,
    denyHookFile: profile.denyHookFile,
    skillFacts,
    skillList,
  };
}

function appendIntroAndContext(
  lines: string[],
  ctx: AgentSetupPromptContext,
): void {
  lines.push(`# GOAT Flow Quality Assessment - ${ctx.agentLabel}`);
  lines.push("");
  lines.push(
    `Assess the quality of the goat-flow v${getPackageVersion()} setup on this project. Be thorough, honest, and specific. Do NOT be polite or generous - I want real problems identified with evidence.`,
  );
  lines.push("");
  lines.push(
    "REPORTING-ONLY ASSESSMENT MODE. Do NOT edit, create, rename, move, or delete any tracked files. Do NOT apply patches or implement fixes. Do NOT use /goat-review or any goat skill as the wrapper for this assessment; this prompt is the full assessment contract. Gitignored local artifacts written by validation tools or normal reporting workflows (e.g. `dist/`, `node_modules/`, `.claude/worktrees/`, `.goat-flow/logs/**`, `.goat-flow/scratchpad/**`, `.goat-flow/plans/**`) are fine - they don't change the repo's committed state and do not count as writes for this assessment contract. This prompt also instructs you to write your final JSON report to `.goat-flow/logs/quality/<filename>.json`.",
  );
  lines.push("");
  appendRules(lines);
  appendContext(lines, ctx);
  appendGoatFlowOverview(lines, ctx);
}

/**
 * Append the per-finding Rules section (no tracked-file writes, evidence-based,
 * content-over-existence) that constrains every finding the reviewer reports.
 *
 * @param lines - prompt line buffer; appended to in place
 */
function appendRules(lines: string[]): void {
  lines.push("## Rules");
  lines.push("");
  lines.push("These apply to EVERY finding you report:");
  lines.push("");
  lines.push(
    "- **No tracked-file writes.** Do NOT edit, create, rename, move, or delete tracked files. Redirection and write commands targeting gitignored local/build/reporting paths (e.g. `dist/`, `node_modules/`, `.claude/worktrees/`, `.goat-flow/logs/**`, `.goat-flow/scratchpad/**`, `.goat-flow/plans/**`) are fine when they are part of normal validation or reporting. If a skill probe tries to modify tracked files or implement code, stop and report that as a finding.",
  );
  lines.push(
    "- **Mode vocabulary matters.** `reporting-only`, `read-only`, `no-write`, and `no implementation` mean no committed-file changes and no implementation in this assessment. Gitignored logs, critique snapshots, scratchpad notes, quality reports, and task checkbox updates are local workflow artifacts; they do not count as writes for this contract. Do not label allowed gitignored reporting/local-state artifacts as read-only violations.",
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
}

/**
 * Append the Context section listing the project path, agent, and the resolved
 * instruction/skills/settings/hook locations the reviewer needs to find files.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param ctx - resolved prompt context supplying the agent-relative paths
 */
function appendContext(lines: string[], ctx: AgentSetupPromptContext): void {
  lines.push("## Context");
  lines.push("");
  lines.push(`- **Project:** \`${ctx.projectPath}\``);
  lines.push(`- **Agent:** ${ctx.agentLabel}`);
  lines.push(`- **Instruction file:** \`${ctx.instructionFile}\``);
  lines.push(`- **Skills directory:** \`${ctx.skillsDir}\``);
  lines.push(`- **Settings file:** \`${ctx.settingsFile}\``);
  if (ctx.hookConfigFile !== ctx.settingsFile) {
    lines.push(`- **Hook registration file:** \`${ctx.hookConfigFile}\``);
  }
  if (ctx.hooksDir) lines.push(`- **Hooks directory:** \`${ctx.hooksDir}\``);
  lines.push("");
}

function appendGoatFlowOverview(
  lines: string[],
  ctx: AgentSetupPromptContext,
): void {
  lines.push("## What goat-flow is");
  lines.push("");
  lines.push(
    "A documentation framework that gives AI coding agents structured workflows. It installed into this project:",
  );
  lines.push("");
  lines.push(
    `1. **Instruction file** (\`${ctx.instructionFile}\`) - execution loop, autonomy tiers, definition of done, router table. Loaded every turn.`,
  );
  lines.push(
    `2. **${ctx.skillFacts.total} skills** (${ctx.skillFacts.functional_count} functional + 1 dispatcher) - ${ctx.skillList}. Loaded on demand via slash commands.`,
  );
  lines.push("3. **Hook scripts** - guardrail hooks for command safety.");
  lines.push(
    "4. **Learning loop** (`.goat-flow/`) - config, architecture doc, footguns, lessons, decisions, session logs.",
  );
  lines.push(
    "5. **Shared meta references** (under `.goat-flow/skill-docs/`) - skill-preamble.md (loaded every skill invocation), skill-conventions.md (loaded on full-depth). **Standalone playbooks** (under `.goat-flow/skill-docs/playbooks/`) - README.md index; browser-use.md and page-capture.md for browser evidence capture; observability.md for instrumentation; code-comments.md for commenting discipline; gruff-code-quality.md for gruff analyzer triage and fix verification across gruff-go/gruff-rs/gruff-ts/gruff-php/gruff-py; changelog.md for CHANGELOG.md discipline; release-notes.md for per-release narrative discipline (derives from changelog); skill-quality-testing.md index plus skill-quality-testing/tdd-iteration.md, skill-quality-testing/adversarial-framing.md, and skill-quality-testing/deployment.md (full-depth authoring methodology split across an index and three topical files per ADR-023; load the topical file matching your skill type).",
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
  appendDesignNotes(lines);
}

/**
 * Append the intentional-design notes the reviewer must NOT flag - gitignored
 * local state, the advisory `.active` pointer, unchecked task boxes, and the
 * lean post-ADR-014 config - so known-good shapes are not reported as findings.
 *
 * @param lines - prompt line buffer; appended to in place
 */
function appendDesignNotes(lines: string[]): void {
  lines.push(
    "**Design notes** (do NOT flag these as findings - they are intentional):",
  );
  lines.push(
    '- Session logs (`.goat-flow/logs/sessions/*.md`), critique snapshots (`.goat-flow/logs/critiques/*.md`), scratchpad notes, and task/milestone files (`.goat-flow/plans/`, scoped by the `.goat-flow/plans/.active` marker - see ADR-017) are **intentionally gitignored**. They are local workspace artifacts, not committed content. This is by design - session logs should never be in version control. If the instruction file\'s DoD references session logs, it means "write them locally for the current agent\'s continuity," not "commit them." When evaluating skills, do NOT flag writes to these gitignored paths as a design flaw or write-safety violation - a skill writing to `.goat-flow/logs/` or `.goat-flow/plans/` is normal working-state behavior.',
  );
  lines.push(
    "- `.goat-flow/plans/.active` is an advisory local pointer, not a setup invariant. Missing `.active`, or `.active` naming a missing subdir, is normal local churn when work completes, users switch projects, or a project does not use goat-flow task files. Do NOT report this by itself as a setup-quality finding; evaluate whether `/goat` and `/goat-plan` handle the fallback gracefully.",
  );
  lines.push(
    "- Unchecked task or milestone checkboxes, milestone status fields, roadmap files, and task-file completion percentages are local workflow state. Do NOT report them as quality findings by themselves. Only report task-file issues when they cause an observed skill behavior failure, such as ignoring explicit user intent or corrupting task files.",
  );
  lines.push(
    "- `toolchain` and `ask_first` fields in `config.yaml` were removed from the base setup in v1.1.0 (see ADR-014). A lean config.yaml with version and skills is correct - not a gap; legacy `agents:` entries are ignored.",
  );
  lines.push("");
}

function appendAuditAndPrior(
  lines: string[],
  ctx: AgentSetupPromptContext,
): void {
  lines.push("---");
  lines.push("");
  lines.push("## Audit Summary");
  lines.push("");
  if (ctx.input.auditReport) {
    const overallStatus =
      ctx.input.auditReport.status === "pass" ? "PASS" : "FAIL";
    lines.push(`**Overall: ${overallStatus}**`);
    lines.push("");
    lines.push(ctx.auditSummaryText);
    lines.push("");
    lines.push(
      "> **Note:** The audit checks structural completeness only (pass/fail per concern). PASS means files exist, paths resolve, and patterns are registered. It does NOT mean documentation is accurate, footguns are current, or content is appropriate for this project. Your assessment must judge quality - what the audit cannot.",
    );
    if (ctx.input.auditReport.status === "fail") {
      lines.push(
        "> The setup has failures. Factor these into your assessment - are they real problems or false positives?",
      );
    }
  } else {
    lines.push(renderAuditUnavailableHeading(ctx.auditUnavailableReason));
    lines.push(renderDegradedNote(ctx.auditUnavailableReason));
  }
  lines.push("");
  lines.push(renderPriorReportContext(ctx.priorReport, ctx.qualityMode));
  lines.push("");
  const learningLoopContext = renderBoundedLearningLoopContext(
    ctx.input.sharedFacts,
    ctx.qualityMode,
  );
  if (learningLoopContext) {
    lines.push(learningLoopContext);
    lines.push("");
  }
}

function appendGroundingAndReadNext(
  lines: string[],
  ctx: AgentSetupPromptContext,
): void {
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
    `#    Otherwise, run shellcheck and bash -n on shell scripts listed in ${ctx.instructionFile}.`,
  );
  lines.push("#    Record: which pass, which fail, which don't exist.");
  lines.push("");
  lines.push(
    "# 2. Hook self-test (if deny-dangerous.sh exists in your hooks directory)",
  );
  lines.push(
    ctx.denyHookFile
      ? `bash ${ctx.denyHookFile} --self-test=smoke`
      : "#    This agent has no on-disk deny hook script to self-test.",
  );
  lines.push("");
  lines.push("# 3. Quick structural checks");
  lines.push(
    `wc -l ${ctx.instructionFile}                          # target: about 125 lines; hard limit: 150`,
  );
  lines.push(
    `ls ${ctx.skillsDir}/                                  # expect ${ctx.skillFacts.total} goat-flow skill directories`,
  );
  lines.push(
    "cat .goat-flow/config.yaml                        # minimal valid config: version and skills; legacy agents is ignored; line-limits/toolchain are optional calibration only",
  );
  lines.push("```");
  lines.push("");
  appendReadNext(lines, ctx);
}

/**
 * Append the "Read next" reading list - instruction file, config, skill
 * references, architecture, skills - plus the grep-first learning-loop retrieval
 * protocol that forbids broad-loading footguns/lessons/decisions.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param ctx - resolved prompt context supplying instruction/skills/hook paths
 */
function appendReadNext(lines: string[], ctx: AgentSetupPromptContext): void {
  lines.push("---");
  lines.push("");
  lines.push("## Read next");
  lines.push("");
  lines.push("After Step 0, read ALL of these before writing any findings:");
  lines.push("");
  lines.push(`- Your instruction file: \`${ctx.instructionFile}\``);
  lines.push("- `.goat-flow/config.yaml`");
  lines.push("- `.goat-flow/skill-docs/skill-preamble.md`");
  lines.push("- `.goat-flow/skill-docs/skill-conventions.md`");
  lines.push("- `.goat-flow/architecture.md`");
  lines.push(
    "- `.goat-flow/code-map.md`, `.goat-flow/glossary.md`, `.goat-flow/learning-loop/patterns/` (if they exist)",
  );
  lines.push(
    `- All installed skill files in \`${ctx.skillsDir}\` - each \`SKILL.md\` plus any nested \`references/*.md\` packs`,
  );
  lines.push(`- Agent settings: \`${ctx.settingsFile}\``);
  if (ctx.hookConfigFile !== ctx.settingsFile) {
    lines.push(`- Hook registration file: \`${ctx.hookConfigFile}\``);
  }
  if (ctx.hooksDir)
    lines.push("- All hook scripts in your agent's hooks directory");
  lines.push("");
  lines.push(
    "For the learning loop - `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/decisions/` - DO NOT broad-load. Use grep-first retrieval per `skill-preamble.md` Learning-Loop Retrieval: derive 2-4 search terms from the target area and expected failure class, run `rg -n -i -S '<term1>|<term2>|<term3>' .goat-flow/learning-loop/footguns .goat-flow/learning-loop/lessons .goat-flow/learning-loop/decisions`, open only matching entries, reword once on zero hits, then record a retrieval miss. Broad-loading recreates the context-bloat failure this protocol exists to prevent.",
  );
  lines.push("");
}

function appendPrecheckAndSetupQuality(
  lines: string[],
  ctx: AgentSetupPromptContext,
): void {
  lines.push("---");
  lines.push("");
  lines.push("## Part 1: Pre-check");
  lines.push("");
  lines.push("Answer these after reading. Quick pass/fail:");
  lines.push("");
  lines.push("**Structure:**");
  lines.push(
    `- Count skill directories - expect exactly ${ctx.skillFacts.total}: ${ctx.skillFacts.names.join(", ")}`,
  );
  lines.push(
    `- If >${ctx.skillFacts.total}, list extras. Known stale names: ${ctx.skillFacts.stale_names.join(", ")}`,
  );
  lines.push("- `.goat-flow/skill-docs/skill-preamble.md` exists?");
  lines.push("- `.goat-flow/skill-docs/skill-conventions.md` exists?");
  lines.push("- `.goat-flow/config.yaml` exists and parseable?");
  lines.push("- No `playbooks/` directory (that's legacy)?");
  lines.push("");
  lines.push("**Instruction file (from Step 0 output):**");
  lines.push("- Line count (target: under 125, hard limit: 150)?");
  lines.push(
    "- Has required sections: project identity, execution loop (4-step READ->SCOPE->ACT->VERIFY), autonomy tiers, definition of done, router table, essential commands?",
  );
  lines.push("- References real project paths or generic template fill?");
  lines.push("");
  lines.push("**Router table integrity:**");
  lines.push(
    "- For EVERY path in the router table, verify the file/directory exists. List any that don't resolve.",
  );
  lines.push("- Does it include `.goat-flow/learning-loop/footguns/`?");
  lines.push("");
  appendSetupQuality(lines, ctx);
}

function appendSetupQuality(
  lines: string[],
  ctx: AgentSetupPromptContext,
): void {
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
    '- Pick 3-5 footgun entries from `.goat-flow/learning-loop/footguns/`. For each: (a) grep for the cited semantic anchor (function name, unique string, or `(search: "pattern")`) - does the code still exhibit the described behavior? (b) Is the `Status` field (active/resolved) accurate? An entry marked `active` that describes fixed behavior is a stale entry - report it. (c) Do the semantic anchors resolve to the described code?',
  );
  lines.push(
    "- Pick 2-3 lesson entries from `.goat-flow/learning-loop/lessons/`. Are they from real incidents or synthetic?",
  );
  lines.push("");
  lines.push("**Setup hygiene:**");
  lines.push(
    "- Were existing project files (`.github/instructions/`, `docs/`, etc.) respected or overwritten?",
  );
  lines.push(
    "- Did setup create duplicate surfaces (e.g., both `docs/footguns.md` and `.goat-flow/learning-loop/footguns/`)?",
  );
  lines.push("- Was `.goat-flow/scratchpad/` created?");
  lines.push("");
  lines.push("**Config reality:**");
  lines.push(
    "- Does `.goat-flow/config.yaml` stay lean and accurate for this project? If it includes optional project-calibration fields like `toolchain`, verify the commands are real before treating them as authoritative. If you also run the tool at broader scope (e.g., `npx eslint .` vs a project's scoped command), note whether the project intentionally scopes narrower - that's a design choice, not a finding, unless it hides real problems. Beware that `.claude/worktrees/`, `node_modules/`, and `dist/` can pollute unscoped tool runs.",
  );
  lines.push(
    `- Were hook scripts installed and registered in \`${ctx.hookConfigFile}\`?`,
  );
  lines.push(
    "- Did deny-dangerous.sh pass the self-test in Step 0? If not, what failed?",
  );
  lines.push("");
}

function appendSkillAndSystemSections(
  lines: string[],
  ctx: AgentSetupPromptContext,
): void {
  appendSkillTesting(lines);
  appendSystemAssessment(lines, ctx);
  appendContradictions(lines, ctx);
  appendSkillTemplateIntegrity(lines);
}

/**
 * Append Part 3 skill-testing instructions: the file-analysis vs live-invocation
 * options and the per-skill reporting-only probes, including the stop-and-report
 * rule when a probe attempts a tracked-file write or implementation.
 *
 * @param lines - prompt line buffer; appended to in place
 */
function appendSkillTesting(lines: string[]): void {
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
    "3. **`/goat-plan`** - ask for a milestone/task breakdown inline, then try a bare `.goat-flow/plans/<name>` path. The bare path must produce read-only orientation only. If it writes milestone files despite inline/reporting-only/path-only input, report the mode confusion; do not frame gitignored task-file writes as committed-state read-only violations.",
  );
  lines.push(
    "4. **`/goat-review`** - review a real source file for quality issues",
  );
  lines.push(
    "5. **`/goat-critique`** - critique one of the other probe outputs in reporting-only / no-implementation mode (e.g., goat-plan breakdown or goat-security assessment). Gitignored critique logs are normal local workflow artifacts and do not count as writes; judge whether it attempts to implement recommendations or modify tracked files.",
  );
  lines.push(
    "6. **`/goat-security`** - threat-model one real component (auth, API, hooks, config, or whatever is riskiest) without making changes",
  );
  lines.push(
    "7. **`/goat-qa`** - find testing gaps in recent changes or audit coverage for a module without creating new tests",
  );
  lines.push("");
  lines.push(
    "For each skill report: (a) what worked, (b) what was confusing or failed, (c) what was useless ceremony. Cite file + semantic anchor where possible.",
  );
  lines.push(
    "If any skill attempts to edit tracked files, implement code, or write outside the allowed gitignored local-state/reporting paths, stop that probe immediately and report it as a finding.",
  );
  lines.push("");
  lines.push(
    "**If context is limited:** At minimum test `/goat` (routing), `/goat-review` (most common use), and `/goat-critique` (highest-cost skill). Note which skills you skipped.",
  );
  lines.push("");
}

function appendSystemAssessment(
  lines: string[],
  ctx: AgentSetupPromptContext,
): void {
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
    `- Are ${ctx.skillFacts.total} skills the right number? Which overlap? Which have gaps between them?`,
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
}

function appendContradictions(
  lines: string[],
  ctx: AgentSetupPromptContext,
): void {
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
    `**Note:** Cross-agent consistency checks (deny patterns, skill parity, instruction structure) belong in the deterministic audit, not this per-agent assessment. Focus on ${ctx.agentLabel}'s surfaces only.`,
  );
  lines.push("");
}

/**
 * Append Part 6 skill-template-integrity checks: version-tag presence and match,
 * truncation/corruption signs, and quick-vs-full depth-choice coherence.
 *
 * @param lines - prompt line buffer; appended to in place
 */
function appendSkillTemplateIntegrity(lines: string[]): void {
  lines.push("---");
  lines.push("");
  lines.push("## Part 6: Skill template integrity");
  lines.push("");
  lines.push(
    "1. **Version tags:** Do all installed SKILL.md files have a `goat-flow-skill-version` header, and do all installed reference docs have a `goat-flow-reference-version` header? Do they match the config.yaml version?",
  );
  lines.push(
    "2. **Truncation or corruption:** Do the installed skill files look complete? Are there any signs of truncation, merging, or adaptation that broke the structure? (Skills should be installed verbatim from templates - they should NOT be adapted.)",
  );
  lines.push(
    '3. **Depth choice coherence:** Evaluate one skill with "quick" and one with "full" in reporting-only mode. Is the experience meaningfully different?',
  );
  lines.push("");
}

function appendOutputFormat(
  lines: string[],
  ctx: AgentSetupPromptContext,
): void {
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
    `For each of the ${ctx.skillFacts.total} skills (or subset tested): what worked, what failed, what was ceremony.`,
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
  lines.push("- Exact file + semantic-anchor reference(s)");
  lines.push("- What is wrong");
  lines.push("- Why it matters");
  lines.push(
    "- Evidence quality: `OBSERVED` (verified in code/output) or `INFERRED` (state what's missing)",
  );
  lines.push(
    "- If prior report context was provided, current findings only use `delta_tag: new | persisted`; `resolved` belongs in derived diff output, not the current finding list.",
  );
  lines.push("");
  appendRatingSections(lines);
}

/**
 * Append the Setup-Quality and System-Assessment prose prompts plus the two
 * 0-100 rating rubrics (four 0-25 axes each) the reviewer must score.
 *
 * @param lines - prompt line buffer; appended to in place
 */
function appendRatingSections(lines: string[]): void {
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
  appendRatingBands(lines);
}

/**
 * Append the per-axis rating-band definitions (exact 25/20/15/10/5/0 anchors)
 * and the Top-5-Improvements and What-You-Did-Not-Verify closing sections.
 *
 * @param lines - prompt line buffer; appended to in place
 */
function appendRatingBands(lines: string[]): void {
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
  lines.push(
    "Do NOT recommend adding quick/lite/reduced modes to any skill. Skill mode decisions (e.g. goat-critique being full-delegated-only) are ADR-decided architectural choices, not gaps to fill. See `.goat-flow/learning-loop/decisions/ADR-021-goat-critique-full-mode-only.md`.",
  );
  lines.push("For each:");
  lines.push("1. What to change");
  lines.push("2. Evidence from your testing (cite file + semantic anchor)");
  lines.push("3. Expected impact on the ratings");
  lines.push("");
  lines.push("### What You Did Not Verify");
  lines.push(
    "Be explicit about remaining uncertainty. List skipped skills, untested commands, unverified claims.",
  );
  lines.push("");
}

/**
 * Append the closing reminder: respond with the full prose assessment, write the
 * JSON report to the file path (not inline), and make no tracked-file edits.
 *
 * @param lines - prompt line buffer; appended to in place
 */
function appendClosing(lines: string[]): void {
  lines.push("---");
  lines.push("");
  lines.push(
    "**IMPORTANT:** Respond with the full prose assessment (Pre-check Results through What You Did Not Verify). Write the JSON report to the file path described above. Then end your reply with the one-line confirmation. Do not edit any tracked file. Do not emit the JSON as a fenced block in your reply.",
  );
}

export function composeAgentSetupQuality(
  input: QualityInput,
  qualityMode: QualityMode,
): QualityPayload {
  const ctx = buildAgentSetupContext(input, qualityMode);
  const lines: string[] = [];
  appendIntroAndContext(lines, ctx);
  appendAuditAndPrior(lines, ctx);
  appendGroundingAndReadNext(lines, ctx);
  appendPrecheckAndSetupQuality(lines, ctx);
  appendSkillAndSystemSections(lines, ctx);
  appendOutputFormat(lines, ctx);
  appendAgentReportContract(lines, {
    agent: ctx.agent,
    projectPath: ctx.projectPath,
    auditStatus: ctx.auditStatus,
    qualityMode,
    priorReport: ctx.priorReport,
    runDate: ctx.runDate,
  });
  appendClosing(lines);

  return {
    command: "quality",
    agent: ctx.agent,
    auditStatus: ctx.auditStatus,
    auditSummary: ctx.auditSummaryText,
    prompt: lines.join("\n"),
  };
}
