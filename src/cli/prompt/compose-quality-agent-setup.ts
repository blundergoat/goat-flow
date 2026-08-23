/**
 * Builds the prompt that asks an agent to grade how well goat-flow was installed for one project and one agent.
 *
 * The user ran a quality assessment from the CLI or the dashboard; this is the reporting-only brief their agent receives.
 *
 * - Context is resolved once by `buildAgentSetupContext`, so every section reads the same paths and counts.
 * - Sections are appended in reading order: rules, audit summary, Step 0 grounding, pre-check, setup quality, skill testing, system assessment.
 * - The closing sections fix the output format and the JSON-report contract the dashboard later validates.
 *
 * Pure string assembly over the manifest, the agent profile, and the supplied quality input; nothing here reads or writes the project.
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
 * Precomputed values every `append*` section needs, resolved once by `buildAgentSetupContext` so the section helpers stay pure string assembly and
 * never re-read the manifest or agent profile.
 *
 * Agent-relative paths are already resolved here (skills dir, settings/hook config, instruction file) and may be null when the agent profile has no
 * such surface.
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
  formattedSkillList: string;
}

/**
 * Resolve every path, count, and audit summary the sections need once, so each appender reads fields instead of re-deriving them.
 *
 * @param input - quality request naming the project, agent, audit report, and any prior report
 * @param qualityMode - assessment depth the prompt is being built for
 * @returns the resolved context; a missing audit report resolves to an explicit unavailable summary rather than an empty one
 */
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
  const agentProfile = getAgentProfile(agent);
  // An agent without a settings path gets honest placeholder copy, while a missing hook config falls back to the same place the user will inspect.
  const settingsFile = agentProfile.settingsFile ?? "(no settings file)";
  const hookConfigFile = agentProfile.hookConfigFile ?? settingsFile;
  // A user can launch Quality without audit evidence; that request must display unavailable rather than silently reading as a pass.
  const auditStatus: QualityPayload["auditStatus"] = auditReport
    ? auditReport.status
    : "unavailable";
  const auditSummaryText = auditReport
    ? renderAuditSummary(auditReport)
    : renderAuditUnavailableSummary(auditUnavailableReason);
  const skillFacts = loadManifest().facts.skills;
  // Number the manifest's skills once so every overview generated for this user carries the same ordered inventory.
  const formattedSkillList = skillFacts.names
    .map((skillName, skillIndex) => `${skillIndex + 1}. \`${skillName}\``)
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
    agentLabel: agentProfile.name,
    skillsDir: agentProfile.skillsDir,
    settingsFile,
    hookConfigFile,
    instructionFile: agentProfile.instructionFile,
    hooksDir: agentProfile.hooksDir,
    denyHookFile: agentProfile.denyHookFile,
    skillFacts,
    formattedSkillList,
  };
}

/**
 * Open the prompt with the title, the reporting-only contract, and the orientation sections the reviewer needs before any judgement.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param promptContext - resolved prompt context supplying the agent label and target paths
 * @returns nothing; the title, rules, project context, and overview are appended for the user
 */
function appendIntroAndContext(
  lines: string[],
  promptContext: AgentSetupPromptContext,
): void {
  lines.push(`# GOAT Flow Quality Assessment - ${promptContext.agentLabel}`);
  lines.push("");
  lines.push(
    `Assess the quality of the goat-flow v${getPackageVersion()} setup on this project. Be thorough, honest, and specific. Do NOT be polite or generous - I want real problems identified with evidence.`,
  );
  lines.push("");
  lines.push(
    `REPORTING-ONLY ASSESSMENT MODE. Do NOT edit, create, rename, move, or delete any tracked files. Do NOT apply patches or implement fixes. Do NOT use /goat-review or any goat skill as the wrapper for this assessment; this prompt is the full assessment contract. Gitignored local artifacts written by validation tools or normal reporting workflows (e.g. \`dist/\`, \`node_modules/\`, \`.claude/worktrees/\`, \`.goat-flow/logs/**\`, \`.goat-flow/scratchpad/**\`, \`.goat-flow/plans/**\`) are fine - they don't change the repo's committed state and do not count as writes for this assessment contract. ${promptContext.input.persistence === "staged-draft" ? "Hand the final JSON report to the dashboard only through the staging contract below." : "Write the final JSON report to `.goat-flow/logs/quality/<filename>.json` as instructed below."}`,
  );
  lines.push("");
  appendRules(lines);
  appendProjectContextSection(lines, promptContext);
  appendGoatFlowOverview(lines, promptContext);
}

/**
 * Add the project and agent paths a reviewer needs after a user launches an installation assessment.
 * Missing optional hook surfaces are omitted rather than rendered as paths that do not exist.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param promptContext - resolved prompt context supplying the agent-relative paths
 * @returns nothing; the user-facing Context section is appended to the prompt
 */
function appendProjectContextSection(
  lines: string[],
  promptContext: AgentSetupPromptContext,
): void {
  lines.push("## Context");
  lines.push("");
  lines.push(`- **Project:** \`${promptContext.projectPath}\``);
  lines.push(`- **Agent:** ${promptContext.agentLabel}`);
  lines.push(`- **Instruction file:** \`${promptContext.instructionFile}\``);
  lines.push(`- **Skills directory:** \`${promptContext.skillsDir}\``);
  lines.push(`- **Settings file:** \`${promptContext.settingsFile}\``);
  // Some agents register hooks in a separate file, and naming both stops the reviewer hunting for a registration that is not in settings.
  if (promptContext.hookConfigFile !== promptContext.settingsFile) {
    lines.push(
      `- **Hook registration file:** \`${promptContext.hookConfigFile}\``,
    );
  }
  // An agent with no hooks directory gets no line, rather than a path the reviewer would look for and fail to find.
  if (promptContext.hooksDir)
    lines.push(`- **Hooks directory:** \`${promptContext.hooksDir}\``);
  lines.push("");
}

/**
 * Describe what goat-flow installed here, so the reviewer grades the install against what it was meant to contain.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param promptContext - resolved prompt context supplying the instruction path and skill inventory
 * @returns nothing; the installation overview and design notes are appended for the reviewer
 */
function appendGoatFlowOverview(
  lines: string[],
  promptContext: AgentSetupPromptContext,
): void {
  lines.push("## What goat-flow is");
  lines.push("");
  lines.push(
    "A documentation framework that gives AI coding agents structured workflows. It installed into this project:",
  );
  lines.push("");
  lines.push(
    `1. **Instruction file** (\`${promptContext.instructionFile}\`) - execution loop, autonomy tiers, definition of done, router table. Loaded every turn.`,
  );
  lines.push(
    `2. **${promptContext.skillFacts.total} skills** (${promptContext.skillFacts.functional_count} functional + 1 dispatcher) - ${promptContext.formattedSkillList}. Loaded on demand via slash commands.`,
  );
  lines.push("3. **Hook scripts** - guardrail hooks for command safety.");
  lines.push(
    "4. **Learning loop** (`.goat-flow/`) - config, architecture doc, footguns, lessons, decisions, session logs.",
  );
  lines.push(
    "5. **Shared meta references** (under `.goat-flow/skill-docs/`) - skill-preamble.md (loaded every skill invocation), skill-conventions.md (loaded on full-depth). **Standalone playbooks** (under `.goat-flow/skill-docs/playbooks/`) - README.md index; browser-use.md and page-capture.md for browser evidence capture; observability.md for instrumentation; code-comments.md for commenting discipline; naming-and-placement.md for responsibility-first placement and truthful naming; test-selection.md for value-led test dispositions and placement; gruff-code-quality.md for gruff analyzer triage and fix verification across gruff-go/gruff-rs/gruff-ts/gruff-php/gruff-py; hook-policy-testing.md for deny-hook policy, mirror, and agent-registration verification; changelog.md for CHANGELOG.md discipline; release-notes.md for per-release narrative discipline (derives from changelog); skill-playbook-authoring-sync.md for built-in playbook enrollment and verification; writing-style.md for the human-read prose correctness router; writing-sentence-diagnostics.md for sentence-level reader costs; writing-structure-diagnostics.md for document-level assembly defects (agent-read control text is explicitly exempt). **Skill-authoring methodology** lives under `.goat-flow/skill-docs/skill-quality-testing/`: README.md index plus tdd-iteration.md, adversarial-framing.md, and deployment.md (full-depth authoring methodology split per ADR-023; load the topical file matching your skill type).",
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
 * Hand over the audit result, the previous report, and a bounded learning-loop excerpt as evidence the reviewer must weigh, not trust.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param promptContext - resolved prompt context supplying the audit summary text and prior report
 * @returns nothing; available evidence and honest empty states are appended to the prompt
 */
function appendAuditAndPriorEvidence(
  lines: string[],
  promptContext: AgentSetupPromptContext,
): void {
  lines.push("---");
  lines.push("");
  lines.push("## Audit Summary");
  lines.push("");
  // For example, after a user clicks Re-audit, the reviewer gets that live verdict plus the limits of a structural check.
  if (promptContext.input.auditReport) {
    const overallAuditStatusLabel =
      promptContext.input.auditReport.status === "pass" ? "PASS" : "FAIL";
    lines.push(`**Overall: ${overallAuditStatusLabel}**`);
    lines.push("");
    lines.push(promptContext.auditSummaryText);
    lines.push("");
    lines.push(
      "> **Note:** The audit checks structural completeness only (pass/fail per concern). PASS means files exist, paths resolve, and patterns are registered. It does NOT mean documentation is accurate, footguns are current, or content is appropriate for this project. Your assessment must judge quality - what the audit cannot.",
    );
    // Known failures are handed over as claims to test, not as accepted findings, so the reviewer still judges them.
    if (promptContext.input.auditReport.status === "fail") {
      lines.push(
        "> The setup has failures. Factor these into your assessment - are they real problems or false positives?",
      );
    }
    // No audit result reached the prompt, so the reviewer is told the ground truth is missing rather than assuming a pass.
  } else {
    lines.push(
      renderAuditUnavailableHeading(promptContext.auditUnavailableReason),
    );
    lines.push(renderDegradedNote(promptContext.auditUnavailableReason));
  }
  lines.push("");
  lines.push(
    renderPriorReportContext(
      promptContext.priorReport,
      promptContext.qualityMode,
    ),
  );
  lines.push("");
  const learningLoopPromptBlock = renderBoundedLearningLoopContext(
    promptContext.input.sharedFacts,
    promptContext.qualityMode,
    promptContext.input.auditReport,
  );
  // Projects with no usable learning-loop entries get no block at all, which keeps an empty heading out of the prompt.
  if (learningLoopPromptBlock) {
    lines.push(learningLoopPromptBlock);
    lines.push("");
  }
}

/**
 * Add the Step 0 probes and the fallback a reviewer sees when a session denies them.
 * Use at assessment start so unavailable runtime evidence becomes an explicit verification gap.
 *
 * @param lines - prompt lines built so far; empty means this section starts the rendered assessment
 * @param promptContext - resolved session context; a null deny-hook path means no on-disk hook probe is offered
 * @returns nothing; the supplied prompt lines receive the grounding and reading sections
 */
function appendGroundingAndReadNext(
  lines: string[],
  promptContext: AgentSetupPromptContext,
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
    `#    Otherwise, run shellcheck and bash -n on shell scripts listed in ${promptContext.instructionFile}.`,
  );
  lines.push("#    Record: which pass, which fail, which don't exist.");
  lines.push("");
  lines.push(
    "# 2. Hook self-test (if deny-dangerous.sh exists in your hooks directory)",
  );
  // An agent profile without an on-disk deny hook gives the reviewer a clear no-probe message instead of an unusable command.
  lines.push(
    promptContext.denyHookFile
      ? `bash ${promptContext.denyHookFile} --self-test=smoke`
      : "#    This agent has no on-disk deny hook script to self-test.",
  );
  lines.push("");
  lines.push("# 3. Quick structural checks");
  lines.push(
    `wc -l ${promptContext.instructionFile}                          # target: about 125 lines; hard limit: 150`,
  );
  lines.push(
    `ls ${promptContext.skillsDir}/                                  # expect ${promptContext.skillFacts.total} goat-flow skill directories`,
  );
  lines.push(
    "cat .goat-flow/config.yaml                        # minimal valid config: version and skills; legacy agents is ignored; line-limits/toolchain are optional calibration only",
  );
  lines.push("```");
  lines.push("");
  lines.push(
    '**Degraded grounding protocol:** If a command above is denied by the session\'s permission profile or unavailable, record the literal denial, do NOT infer pass or fail from it, and do not retry it verbatim or work around the profile. Fall back to static analysis (`evidence_method: "static-analysis"`), keep `audit_status` at `unavailable` unless a live audit completed this run, and list every unexecuted command in "What You Did Not Verify".',
  );
  lines.push("");
  appendReadNext(lines, promptContext);
}

/**
 * Add the reading order a reviewer follows after grounding, including INDEX-first learning retrieval.
 * Use before assessment questions so the user receives findings based on the same required evidence.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param promptContext - resolved prompt context supplying instruction/skills/hook paths
 * @returns nothing; the ordered reading list is appended to the generated prompt
 */
function appendReadNext(
  lines: string[],
  promptContext: AgentSetupPromptContext,
): void {
  lines.push("---");
  lines.push("");
  lines.push("## Read next");
  lines.push("");
  lines.push("After Step 0, read ALL of these before writing any findings:");
  lines.push("");
  lines.push(`- Your instruction file: \`${promptContext.instructionFile}\``);
  lines.push("- `.goat-flow/config.yaml`");
  lines.push("- `.goat-flow/skill-docs/skill-preamble.md`");
  lines.push("- `.goat-flow/skill-docs/skill-conventions.md`");
  lines.push("- `.goat-flow/architecture.md`");
  lines.push(
    "- `.goat-flow/code-map.md`, `.goat-flow/glossary.md`, `.goat-flow/learning-loop/patterns/` (if they exist)",
  );
  lines.push(
    `- All installed skill files in \`${promptContext.skillsDir}\` - each \`SKILL.md\` plus any nested \`references/*.md\` packs`,
  );
  lines.push(`- Agent settings: \`${promptContext.settingsFile}\``);
  // Reading list mirrors the Context section: the registration file is only listed when it is not the settings file itself.
  if (promptContext.hookConfigFile !== promptContext.settingsFile) {
    lines.push(`- Hook registration file: \`${promptContext.hookConfigFile}\``);
  }
  // Only agents that support hooks are asked to read them.
  if (promptContext.hooksDir)
    lines.push("- All hook scripts in your agent's hooks directory");
  lines.push("");
  lines.push(
    "For the learning loop - `.goat-flow/learning-loop/{footguns,lessons,patterns,decisions}/INDEX.md` - DO NOT broad-load buckets. Use INDEX-first retrieval per `skill-preamble.md` Learning-Loop Retrieval: derive 2-4 search terms from the target area and expected failure class, read matching INDEX rows first, open source entries only on candidate hits, grep individual buckets only after the INDEX pass or on a known retrieval miss, reword once on zero hits, then record the miss. Broad-loading recreates the context-bloat failure this protocol exists to prevent.",
  );
  lines.push("");
}

/**
 * Ask the quick structural questions of Part 1, then hand straight on to the Part 2 quality questions.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param promptContext - resolved prompt context supplying the expected skill names and counts
 * @returns nothing; Parts 1 and 2 are appended in the order the reviewer should answer them
 */
function appendPrecheckAndSetupQuality(
  lines: string[],
  promptContext: AgentSetupPromptContext,
): void {
  lines.push("---");
  lines.push("");
  lines.push("## Part 1: Pre-check");
  lines.push("");
  lines.push("Answer these after reading. Quick pass/fail:");
  lines.push("");
  lines.push("**Structure:**");
  lines.push(
    `- Count skill directories - expect exactly ${promptContext.skillFacts.total}: ${promptContext.skillFacts.names.join(", ")}`,
  );
  lines.push(
    `- If >${promptContext.skillFacts.total}, list extras. Known stale names: ${promptContext.skillFacts.stale_names.join(", ")}`,
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
  appendSetupQuality(lines, promptContext);
}

/**
 * Ask how well the install was adapted to this project, which is the judgement the deterministic audit cannot make.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param promptContext - resolved prompt context supplying the hook registration path
 * @returns nothing; the project-adaptation questions are appended for the user's reviewer
 */
function appendSetupQuality(
  lines: string[],
  promptContext: AgentSetupPromptContext,
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
    `- Were hook scripts installed and registered in \`${promptContext.hookConfigFile}\`?`,
  );
  lines.push(
    "- Did deny-dangerous.sh pass the self-test in Step 0? If not, what failed?",
  );
  lines.push("");
}

/**
 * Append Parts 3 to 5 in reading order: skill testing, the system assessment, then the contradiction sweep.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param promptContext - resolved prompt context supplying the skill inventory
 * @returns nothing; Parts 3 through 6 are appended in their required reading order
 */
function appendSkillAndSystemSections(
  lines: string[],
  promptContext: AgentSetupPromptContext,
): void {
  appendSkillTesting(lines);
  appendSystemAssessment(lines, promptContext);
  appendContradictions(lines, promptContext);
  appendSkillTemplateIntegrity(lines);
}

/**
 * Ask whether goat-flow itself earns its cost on this project, answered from the reviewer's own Part 3 testing.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param promptContext - resolved prompt context supplying the skill inventory
 * @returns nothing; the framework-value questions are appended after live skill testing
 */
function appendSystemAssessment(
  lines: string[],
  promptContext: AgentSetupPromptContext,
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
    `- Are ${promptContext.skillFacts.total} skills the right number? Which overlap? Which have gaps between them?`,
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

/**
 * Sweep for contradictions, dead paths, and references to concepts this release removed, which are the defects a reader hits first.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param promptContext - resolved prompt context supplying the instruction path
 * @returns nothing; the contradiction checklist is appended for the selected agent only
 */
function appendContradictions(
  lines: string[],
  promptContext: AgentSetupPromptContext,
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
    '- Any stale references to removed concepts: root-level "playbooks/" (not `.goat-flow/skill-docs/playbooks/`), "coding-standards" as a generated setup pack (not `docs/coding-standards/git-commit-message.md`), "shapes", old skill names, removed legacy task-state surfaces, old execution loop steps (CLASSIFY, LOG as separate steps)',
  );
  lines.push(
    "- Does the instruction file execution loop match the skill-preamble's description?",
  );
  lines.push(
    '- Do the skills\' "NOT this skill" boundaries leave gaps? Is there any request that NO skill would handle?',
  );
  lines.push("");
  lines.push(
    `**Note:** Cross-agent consistency checks (deny patterns, skill parity, instruction structure) belong in the deterministic audit, not this per-agent assessment. Focus on ${promptContext.agentLabel}'s surfaces only.`,
  );
  lines.push("");
}

/**
 * Add the response headings and finding fields the user will receive from an agent-setup assessment.
 * Use after Parts 1 through 6 and before the machine-readable report contract.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param promptContext - resolved prompt context supplying the expected skill count
 * @returns nothing; the human-readable output contract is appended to the prompt
 */

function appendOutputFormat(
  lines: string[],
  promptContext: AgentSetupPromptContext,
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
    `For each of the ${promptContext.skillFacts.total} skills (or subset tested): what worked, what failed, what was ceremony.`,
  );
  lines.push("");
  lines.push("### Findings");
  lines.push("Ordered by severity. For each:");
  lines.push(
    "- Severity: `BLOCKER` (prevents work or creates safety risk), `MAJOR` (framework violates a standard that binds the surface being assessed - agent-facing instructions, skills, hooks - or a documented quality gate fails; human-workflow conventions are out of scope unless they corrupt agent behavior), or `MINOR` (suboptimal but not actively harmful)",
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

/**
 * Assemble the agent-setup quality prompt, the long-form assessment a user launches from the Quality tab or `goat-flow quality prompt`.
 *
 * The prompt is built section by section in a fixed order, because the assessment it asks for depends on the reader having already
 * seen the audit result and the grounding commands before it reaches the rating instructions.
 *
 * @param input - the quality request: selected project, agent, audit facts, and any prior report to compare against
 * @param qualityMode - selected mode, which decides which rating contract the prompt asks the agent to follow
 * @returns the composed payload the caller renders or copies; the prompt text is never empty
 */
export function composeAgentSetupQuality(
  input: QualityInput,
  qualityMode: QualityMode,
): QualityPayload {
  const promptContext = buildAgentSetupContext(input, qualityMode);
  const lines: string[] = [];
  appendIntroAndContext(lines, promptContext);
  appendAuditAndPriorEvidence(lines, promptContext);
  appendGroundingAndReadNext(lines, promptContext);
  appendPrecheckAndSetupQuality(lines, promptContext);
  appendSkillAndSystemSections(lines, promptContext);
  appendOutputFormat(lines, promptContext);
  appendAgentReportContract(lines, {
    agent: promptContext.agent,
    projectPath: promptContext.projectPath,
    auditStatus: promptContext.auditStatus,
    qualityMode,
    priorReport: promptContext.priorReport,
    runDate: promptContext.runDate,
    persistence: promptContext.input.persistence,
  });
  appendClosing(lines);

  return {
    command: "quality",
    agent: promptContext.agent,
    auditStatus: promptContext.auditStatus,
    auditSummary: promptContext.auditSummaryText,
    prompt: lines.join("\n"),
  };
}
