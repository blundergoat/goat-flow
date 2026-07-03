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
import {
  appendClosing,
  appendDesignNotes,
  appendRatingSections,
  appendRules,
  appendSkillTemplateIntegrity,
  appendSkillTesting,
} from "./compose-quality-static-sections.js";

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
    "5. **Shared meta references** (under `.goat-flow/skill-docs/`) - skill-preamble.md (loaded every skill invocation), skill-conventions.md (loaded on full-depth). **Standalone playbooks** (under `.goat-flow/skill-docs/playbooks/`) - README.md index; browser-use.md and page-capture.md for browser evidence capture; observability.md for instrumentation; code-comments.md for commenting discipline; gruff-code-quality.md for gruff analyzer triage and fix verification across gruff-go/gruff-rs/gruff-ts/gruff-php/gruff-py; changelog.md for CHANGELOG.md discipline; release-notes.md for per-release narrative discipline (derives from changelog). **Skill-authoring methodology** lives under `.goat-flow/skill-docs/skill-quality-testing/`: README.md index plus tdd-iteration.md, adversarial-framing.md, and deployment.md (full-depth authoring methodology split per ADR-023; load the topical file matching your skill type).",
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
 * references, architecture, skills - plus the INDEX-first learning-loop retrieval
 * protocol that forbids broad-loading durable learning buckets.
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
    "For the learning loop - `.goat-flow/learning-loop/{footguns,lessons,patterns,decisions}/INDEX.md` - DO NOT broad-load buckets. Use INDEX-first retrieval per `skill-preamble.md` Learning-Loop Retrieval: derive 2-4 search terms from the target area and expected failure class, read matching INDEX rows first, open source entries only on candidate hits, grep individual buckets only after the INDEX pass or on a known retrieval miss, reword once on zero hits, then record the miss. Broad-loading recreates the context-bloat failure this protocol exists to prevent.",
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
  lines.push(
    "- No root-level legacy `playbooks/` directory? Do not flag current `.goat-flow/skill-docs/playbooks/` or `workflow/skills/playbooks/` directories as legacy.",
  );
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
    "- Is `skill-preamble.md` (loaded every invocation) worth its token cost? Is `skill-conventions.md` (loaded on full-depth) referenced when it should be? Are the `skill-quality-testing/README.md` index and its topical files (tdd-iteration / adversarial-framing / deployment) consulted when skills are created or hardened, or do they sit unused?",
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
    '- Any stale references to removed concepts: root-level "playbooks/" (not `.goat-flow/skill-docs/playbooks/`), "coding-standards" as a generated setup pack (not `docs/coding-standards/git-commit.md`), "shapes", old skill names, removed legacy task-state surfaces, old execution loop steps (CLASSIFY, LOG as separate steps)',
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
    "- `delta_tag` handling follows the JSON report contract below - do not restate it here.",
  );
  lines.push("");
  appendRatingSections(lines);
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
