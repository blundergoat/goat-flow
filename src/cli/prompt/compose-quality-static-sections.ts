/**
 * Shared Markdown sections a reviewer sees in quality prompts: rules, design notes, skill checks, rating rubrics, and the closing reminder.
 * Use when a mode-specific composer needs the same user-facing assessment contract without duplicating prompt text.
 *
 * Helpers only assemble strings in a shared line buffer; sections that depend on the user's selected mode remain in that mode's composer.
 */
import type { QualityMode } from "../quality/schema.js";

type FocusedQualityMode = Exclude<QualityMode, "agent-setup">;

const FOCUSED_ASSESSMENT_SCOPE_LABELS: Record<FocusedQualityMode, string> = {
  process: "framework process",
  harness: "selected target harness",
  skills: "eight-skill system",
};

/**
 * Append the Rules section that keeps every quality finding read-only, evidence-based, and focused on content rather than file presence.
 * Use before mode-specific instructions so CLI and dashboard users receive the same safety and evidence contract.
 *
 * @param lines - prompt lines shown to the reviewer; an empty buffer starts the Rules section at the beginning
 */
export function appendRules(lines: string[]): void {
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
    "- **Standards bind their audience.** Before reporting that the framework violates its own stated standard, identify who the standard binds (agent output, human workflow, or CI) and check the decisions INDEX for an accepted ADR that already resolves the tension. A human-workflow convention does not by itself prove a framework self-violation; identify the agent-facing mechanism or quality gate that makes it relevant.",
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
 * Append accepted design notes so reviewers do not turn supported local state or known evidence limits into user-facing findings.
 * Use after Rules to explain the local artifacts, advisory plan pointer, task state, lean config, and audit boundaries users may encounter.
 *
 * @param lines - prompt lines shown to the reviewer; an empty buffer starts these notes at the beginning
 */
export function appendDesignNotes(lines: string[]): void {
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
  lines.push(
    "- Goat-flow coding agents are prohibited from running `git commit` or `git push`; shipped deny hooks enforce that workflow. A commit that breaks an instruction-file drafting convention is not, by itself, a `framework_flaw` or self-violation. Establish agent authorship or an agent-facing mechanism that caused the violation before reporting it.",
  );
  lines.push(
    '- The deterministic audit checks hook installation, registration, and (only with `--trusted-target`) launcher execution; it cannot observe provider-side hook delivery during live agent tool use, and its `limits` say so. That boundary is a documented, accepted design limit. Do NOT report "audit cannot prove end-to-end runtime enforcement" as a `framework_flaw` or MAJOR finding; report only a concrete case where the audit claims more than it verified.',
  );
  lines.push("");
}

/**
 * Append the safe file-analysis and live-invocation choices used to assess each installed skill on real project evidence.
 * Use in the full setup review so users can see what was exercised and whether a probe attempted an unauthorized tracked-file change.
 *
 * @param lines - prompt lines shown to the reviewer; an empty buffer starts skill testing at the beginning
 */
export function appendSkillTesting(lines: string[]): void {
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
    "**Option B (if context allows): Live invocation.** Invoke reporting-only skills through the agent's normal slash-command/runtime path on a real target. Run mutation-capable skills only against a disposable copy of current project evidence with a frozen write boundary. Stop immediately on writes outside that boundary or on any attempt to modify the assessed checkout. Gitignored reporting/local-state writes are allowed under reporting-only probes. This tests runtime behavior but costs significant context.",
  );
  lines.push("");
  lines.push("Either approach is acceptable. State which you used.");
  lines.push("");
  lines.push(
    "1. **`/goat`** (dispatcher) - Option A: trace how the route map would handle 3 representative reporting-only requests. Option B: send those requests through the live runtime when available. Does routing work? Does the Planning Route handle briefs without pushing toward committed-file changes or implementation? Does it route critique requests to `/goat-critique` and planning questions to `/goat-plan` appropriately?",
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
  lines.push(
    "8. **`/goat-clarity`** - inspect the three selector contracts, frozen write-set rules, naming-before-comments order, and receipt completeness. Prefer file analysis; if live invocation is available, use only a disposable copy of current project source and verify that compliant bytes and out-of-scope paths stay unchanged.",
  );
  lines.push("");
  lines.push(
    "For each skill report: (a) what worked, (b) what was confusing or failed, (c) what was useless ceremony. Cite file + semantic anchor where possible.",
  );
  lines.push(
    "If any reporting-only skill attempts to edit tracked files or implement code, stop that probe immediately and report it as a finding. For `/goat-clarity`, stop on any write outside its disposable frozen target or any mutation of the assessed checkout.",
  );
  lines.push("");
  lines.push(
    "**If context is limited:** At minimum test `/goat` (routing), `/goat-review` (most common use), and `/goat-critique` (highest-cost skill). Note which skills you skipped.",
  );
  lines.push("");
}

/**
 * Append the skill-template integrity checks for version tags, installation damage, and quick-versus-full behavior.
 * Use near the end of setup review so users can separate a broken installation from weak skill behavior.
 *
 * @param lines - prompt lines shown to the reviewer; an empty buffer starts template checks at the beginning
 */
export function appendSkillTemplateIntegrity(lines: string[]): void {
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

/**
 * Append the setup and system questions plus the two calibrated 0-100 rating rubrics shown in a full agent-setup assessment.
 * Use after setup evidence so the reviewer turns verified behavior into scores a user can compare across runs.
 *
 * @param lines - prompt lines shown to the reviewer; an empty buffer starts the ratings at the beginning
 */
export function appendRatingSections(lines: string[]): void {
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
 * Append score instructions calibrated to the process, harness, or skills area the user selected.
 * Use before saving a focused report so shared Setup/System fields cannot absorb evidence from another quality mode.
 *
 * @param lines - prompt lines shown to the reviewer; an empty buffer starts the calibration at the beginning
 * @param qualityMode - focused area the user selected; it bounds every score in this section
 */
export function appendFocusedRatingSections(
  lines: string[],
  qualityMode: FocusedQualityMode,
): void {
  const assessmentScopeLabel = FOCUSED_ASSESSMENT_SCOPE_LABELS[qualityMode];
  lines.push("---");
  lines.push("");
  lines.push("## Scoring calibration");
  lines.push("");
  lines.push(
    `Score only the ${assessmentScopeLabel} named in this assessment.`,
  );
  lines.push(
    "Do not score unrelated setup surfaces or carry an overall repository impression into these axes.",
  );
  lines.push("");
  lines.push("### Ratings");
  lines.push("");
  lines.push("**Setup: __/100**");
  lines.push(
    `- Accuracy __/25 - are claims about the ${assessmentScopeLabel} correct?`,
  );
  lines.push(
    `- Relevance __/25 - does the evidence test the ${assessmentScopeLabel}?`,
  );
  lines.push(
    `- Completeness __/25 - is important ${assessmentScopeLabel} evidence missing?`,
  );
  lines.push(
    `- Friction __/25 - how hard is the ${assessmentScopeLabel} to use or assess?`,
  );
  lines.push("");
  lines.push("**System: __/100**");
  lines.push(
    `- Usefulness __/25 - does the ${assessmentScopeLabel} improve real work?`,
  );
  lines.push("- Signal-to-noise __/25 - how much evidence carries its weight?");
  lines.push(
    `- Adaptability __/25 - does the ${assessmentScopeLabel} fit this codebase?`,
  );
  lines.push(
    `- Learnability __/25 - how quickly can the ${assessmentScopeLabel} be used?`,
  );
  lines.push("");
  lines.push("### Rating bands");
  lines.push("Use exact 25 / 20 / 15 / 10 / 5 / 0 increments only:");
  lines.push(
    `- Setup / Accuracy: 25 = all ${assessmentScopeLabel} claims verify; 20 = 1-2 minor drift points; 15 = one hot-path factual error; 10 = multiple hot-path errors; 5 = a load-bearing claim is wrong; 0 = the assessed scope is materially fabricated.`,
  );
  lines.push(
    `- Setup / Relevance: 25 = all evidence directly tests the ${assessmentScopeLabel}; 20 = small adjacent residue; 15 = meaningful generic or off-scope evidence; 10 = mostly indirect evidence; 5 = barely relevant; 0 = unrelated.`,
  );
  lines.push(
    `- Setup / Completeness: 25 = no important ${assessmentScopeLabel} behavior is omitted; 20 = one minor omission; 15 = one important omission with a workaround; 10 = multiple gaps; 5 = a load-bearing surface is missing; 0 = evidence cannot support an assessment.`,
  );
  lines.push(
    `- Setup / Friction: 25 = the ${assessmentScopeLabel} is frictionless to use and assess; 20 = minor ceremony; 15 = noticeable but workable friction; 10 = frequent unnecessary steps; 5 = heavy confusion; 0 = the workflow is blocked.`,
  );
  lines.push(
    `- System / Usefulness: 25 = the ${assessmentScopeLabel} consistently improves work; 20 = useful more often than not; 15 = mixed value; 10 = occasional value; 5 = mostly overhead; 0 = no useful outcome.`,
  );
  lines.push(
    "- System / Signal-to-noise: 25 = almost all evidence carries its weight; 20 = some redundancy; 15 = meaningful noise; 10 = more noise than signal; 5 = mostly ceremony; 0 = overwhelming noise.",
  );
  lines.push(
    `- System / Adaptability: 25 = the ${assessmentScopeLabel} clearly fits this codebase; 20 = mostly adapted; 15 = partial adaptation; 10 = generic assumptions leak through; 5 = poor fit; 0 = incompatible.`,
  );
  lines.push(
    `- System / Learnability: 25 = the ${assessmentScopeLabel} is fast to understand and apply; 20 = small onboarding tax; 15 = moderate study; 10 = confusing; 5 = hard to learn; 0 = effectively opaque.`,
  );
  lines.push("");
}

/**
 * Append the score anchors and closing evidence sections a user reads in the prose assessment.
 * Use after the ratings shell so improvements, disproved candidates, and remaining uncertainty appear in a stable order.
 *
 * @param lines - prompt lines shown to the reviewer; empty means the rating bands begin the remaining assessment
 * @returns nothing; the supplied prompt receives the rating and closing sections
 */
function appendRatingBands(lines: string[]): void {
  lines.push("### Rating bands");
  lines.push("Use exact 25 / 20 / 15 / 10 / 5 / 0 increments only:");
  lines.push(
    "- Setup / Accuracy: 25 = all fact-checked claims verify; 20 = 1-2 minor drift points; 15 = one hot-path factual error; 10 = multiple hot-path errors; 5 = instruction file materially misstates the project; 0 = fabricated or wrong project. A hot-path factual error is a claim an agent would act on and fail (wrong command, wrong path, wrong count); a minor drift point is a stale-but-harmless description.",
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
    'Do NOT recommend adding quick/lite/reduced modes to any skill. Skill mode decisions (e.g. goat-critique being full-delegated-only) are ADR-decided architectural choices, not gaps to fill. See ADR-021, "goat-critique is a core feature, full delegated mode only".',
  );
  lines.push("For each:");
  lines.push("1. What to change");
  lines.push("2. Evidence from your testing (cite file + semantic anchor)");
  lines.push("3. Expected impact on the ratings");
  lines.push("");
  lines.push("### Refuted Candidates");
  lines.push(
    "List every candidate finding you tested and excluded, why it was excluded, and the source anchor or command result that disproved it. Write `None` when no candidate was ruled out.",
  );
  lines.push(
    "Keep these candidates out of Findings and Top 5 Improvements; the ledger exists so the user and later reviewers do not repeat disproved work.",
  );
  lines.push("");
  lines.push("### What You Did Not Verify");
  lines.push(
    "Be explicit about remaining uncertainty. List skipped skills, untested commands, unverified claims.",
  );
  lines.push("");
}

/**
 * Append the closing reminder that keeps the full assessment in the response and the validated JSON in its report file.
 * Use as the final prompt section so the user gets readable findings without tracked-file edits or an inline JSON dump.
 *
 * @param lines - prompt lines shown to the reviewer; an empty buffer makes this reminder the whole prompt
 */
export function appendClosing(lines: string[]): void {
  lines.push("---");
  lines.push("");
  lines.push(
    "**IMPORTANT:** Respond with the full prose assessment (Pre-check Results through What You Did Not Verify). Write the JSON report to the file path described above. Then end your reply with the one-line confirmation. Do not edit any tracked file. Do not emit the JSON as a fenced block in your reply.",
  );
}
