/**
 * Build the report instructions used when a maintainer launches a quality assessment.
 *
 * The prompt names accepted fields, evidence obligations, and the persistence route so the resulting report can be saved and reopened.
 *
 * Shared schema constants and contract tests keep CLI and dashboard launches aligned with validation.
 */
import type { AgentId } from "../types.js";
import type { QualityHistoryEntry } from "../quality/history.js";
import { getPackageVersion } from "../paths.js";
import { getQualityRubricId } from "../quality/rubric.js";
import { QUALITY_SCORE_RULE } from "./compose-quality-static-sections.js";
import { QUALITY_REPORT_KIND, type QualityMode } from "../quality/schema.js";
import {
  QUALITY_CONCERNS,
  QUALITY_EVIDENCE_METHODS,
  QUALITY_FINDING_SEVERITIES,
  QUALITY_FINDING_TYPES,
  QUALITY_GROUNDING_STATUSES,
  QUALITY_IMPROVEMENT_CATEGORIES,
  QUALITY_MAX_IMPROVEMENTS,
  QUALITY_SCORE_RATIONALE_MAX_CHARACTERS,
  QUALITY_SCORE_CONFIDENCES,
  QUALITY_WORKTREE_STATES,
} from "../quality/schema-types.js";
import {
  inferQualityScope,
  jsonString,
  qualityModeLabel,
  shellSingleQuote,
  type QualityPayload,
  type QualityPersistenceVariant,
} from "./compose-quality-common.js";

/** Everything a report-contract render needs to know about the current run. */
export interface ReportContractInput {
  agent: AgentId;
  projectPath: string;
  auditStatus: QualityPayload["auditStatus"];
  qualityMode: QualityMode;
  priorReport: QualityHistoryEntry | null;
  runDate: string;
  /** Persistence contract rendered at the end of the block; defaults to `bounded-saver`. */
  persistence?: QualityPersistenceVariant | undefined;
}

/**
 * Per-surface presentation switches for the quality report contract block.
 *
 * Use when CLI and dashboard prompt surfaces need the same report schema with different verbosity.
 * Invariant: option names stay internal so user-facing JSON field names do not drift.
 */
export interface ReportContractOptions {
  /** `full` = agent-setup verbosity with explanations; `compact` = focused-mode terseness. */
  detail: "full" | "compact";
  /** Prepend a `---` section separator (focused prompts end with the contract). */
  hasLeadingSeparator?: boolean;
  /** Finding `type` shown in the JSON sample; defaults to `setup_quality`. */
  sampleFindingType?: (typeof QUALITY_FINDING_TYPES)[number];
}

/** Render a schema enum list as backticked prompt text, e.g. `` `a`, `b`, `c` ``. */
function backtickList(values: readonly (string | number)[]): string {
  return values.map((value) => `\`${value}\``).join(", ");
}

/**
 * Append the report contract shared by CLI and dashboard quality prompts.
 * Use after assessment guidance so the agent knows which fields and persistence route its saved report must use.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param input - run facts embedded into the contract (agent, paths, prior report, mode)
 * @param opts - per-surface presentation switches (detail level, separator, sample type)
 * @returns nothing; the supplied prompt buffer receives the report contract
 */

export function appendQualityReportContract(
  lines: string[],
  input: ReportContractInput,
  opts: ReportContractOptions,
): void {
  const full = opts.detail === "full";
  /**
   * Push the full-detail or compact wording of one line.
   * The detail branch lives in this arrow's own scope, so it does not add to the enclosing function's complexity budget - just its readability.
   */
  const pushVariant = (fullText: string, compactText: string): void => {
    lines.push(full ? fullText : compactText);
  };
  /** Push extra lines that only the full-detail prompt carries. */
  const pushFull = (...texts: string[]): void => {
    // Append these explanatory lines only when the selected prompt uses full detail.
    if (full) for (const text of texts) lines.push(text);
  };

  // Focused prompts place the contract as the final section -> visually separate it.
  if (opts.hasLeadingSeparator) {
    lines.push("---");
    lines.push("");
  }
  lines.push("### Write the JSON report");
  lines.push("");
  const usesStagedDraft = input.persistence === "staged-draft";
  lines.push(
    usesStagedDraft
      ? "Do **not** emit the JSON as a fenced block in your reply. Follow the dashboard staging contract below; no tracked-file writes or implementation edits are permitted."
      : "Do **not** emit the JSON as a fenced block in your reply. Write it as a file to `.goat-flow/logs/quality/` - that path is gitignored and expected. No tracked-file writes or implementation edits are permitted.",
  );
  lines.push("");
  // CLI-owned saves need a durable filename and saver instructions for history to find the report.
  if (!usesStagedDraft) {
    // Full detail spells out WHY the file must exist on disk - a report that
    // lives only in the agent's reply is invisible to history/diff.
    pushFull(
      "**CRITICAL:** Use the bounded saver below. It prints `OK <absolute-report-path>` only after redaction, strict validation, and an exclusive file write. A report that exists only in conversation history is invisible to `goat-flow quality history` and `goat-flow quality diff`.",
      "",
    );
    lines.push("**Filename format:** `YYYY-MM-DD-HHMM-<agent>-<rand5>.json`");
    lines.push("");
    pushFull(
      `The saver derives the timestamp and random suffix at write time and uses the report's \`agent\` field (\`${input.agent}\`).`,
      "",
    );
  }
  lines.push(
    "**Assessment rule:** Harness scores describe deterministic check coverage; reconcile declared `limits` and accepted ADRs before proposing new gates or score changes.",
  );
  lines.push("");
  lines.push(
    "**Version-skew calibration:** Executable version checks select a compatible report saver; they are not findings or score inputs. Before publication, the framework checkout may be newer than the bare `goat-flow` on `PATH`; use the matching source CLI and do not report or score that PATH-only skew. Raise version findings only when repository-owned declarations or managed target artifacts disagree.",
  );
  lines.push("");
  lines.push("**JSON body shape:**");
  lines.push("");
  lines.push("```json");
  lines.push("{");
  lines.push(`  "report_kind": ${jsonString(QUALITY_REPORT_KIND)},`);
  lines.push(`  "goat_flow_version": ${jsonString(getPackageVersion())},`);
  lines.push(`  "agent": ${jsonString(input.agent)},`);
  lines.push(`  "project_path": ${jsonString(input.projectPath)},`);
  lines.push(`  "run_date": ${jsonString(input.runDate)},`);
  lines.push(`  "audit_status": ${jsonString(input.auditStatus)},`);
  lines.push(`  "scope": ${jsonString(inferQualityScope(input.projectPath))},`);
  lines.push(
    `  "rubric_version": ${jsonString(getQualityRubricId(input.qualityMode))},`,
  );
  lines.push(`  "quality_mode": ${jsonString(input.qualityMode)},`);
  lines.push(
    `  "prior_report_id": ${input.priorReport ? jsonString(input.priorReport.id) : "null"},`,
  );
  lines.push('  "assessment_context": {');
  lines.push('    "project_revision": null,');
  lines.push('    "working_tree_state": "unavailable",');
  lines.push('    "grounding_status": "blocked",');
  lines.push(
    '    "unverified_probes": ["runtime grounding not yet recorded"],',
  );
  lines.push('    "score_confidence": "low",');
  lines.push('    "workspace_snapshot": { "start": null, "end": null },');
  lines.push(
    '    "assessment_identity": { "model": null, "tool_version": null, "prompt_sha256": null, "settings_sha256": null, "capture": "unknown", "fixed_input_protocol": null }',
  );
  lines.push("  },");
  lines.push('  "scores": {');
  lines.push(
    '    "setup": { "total": 0, "accuracy": 0, "relevance": 0, "completeness": 0, "friction": 0 },',
  );
  lines.push(
    '    "system": { "total": 0, "usefulness": 0, "signal_to_noise": 0, "adaptability": 0, "learnability": 0 }',
  );
  lines.push("  },");
  lines.push('  "score_rationale": {');
  lines.push('    "setup": {');
  lines.push(
    '      "accuracy": { "evidence": "Observed evidence for this score", "deduction": "Reason for points deducted, or no deduction" },',
  );
  lines.push(
    '      "relevance": { "evidence": "Observed evidence for this score", "deduction": "Reason for points deducted, or no deduction" },',
  );
  lines.push(
    '      "completeness": { "evidence": "Observed evidence for this score", "deduction": "Reason for points deducted, or no deduction" },',
  );
  lines.push(
    '      "friction": { "evidence": "Observed evidence for this score", "deduction": "Reason for points deducted, or no deduction" }',
  );
  lines.push("    },");
  lines.push('    "system": {');
  lines.push(
    '      "usefulness": { "evidence": "Observed evidence for this score", "deduction": "Reason for points deducted, or no deduction" },',
  );
  lines.push(
    '      "signal_to_noise": { "evidence": "Observed evidence for this score", "deduction": "Reason for points deducted, or no deduction" },',
  );
  lines.push(
    '      "adaptability": { "evidence": "Observed evidence for this score", "deduction": "Reason for points deducted, or no deduction" },',
  );
  lines.push(
    '      "learnability": { "evidence": "Observed evidence for this score", "deduction": "Reason for points deducted, or no deduction" }',
  );
  lines.push("    }");
  lines.push("  },");
  lines.push('  "findings": [');
  const sampleType = opts.sampleFindingType ?? "setup_quality";
  const sampleDelta = input.priorReport ? '"new"' : "null";
  // Full detail keeps the multi-line sample with the semantic-anchor guidance
  // baked into the detail text; compact keeps the one-liner.
  if (full) {
    lines.push("    {");
    lines.push(
      `      "type": "${sampleType}", "concern": "context", "severity": "MAJOR", "file": ".goat-flow/architecture.md", "line": null,`,
    );
    lines.push(
      `      "summary": "One-line finding summary", "detail": "Why it matters; include a semantic anchor when the evidence should survive as a durable learning-loop artifact.", "evidence_quality": "OBSERVED", "evidence_method": "static-analysis", "delta_tag": ${sampleDelta}`,
    );
    lines.push("    }");
  } else {
    lines.push(
      `    { "type": "${sampleType}", "concern": "context", "severity": "MAJOR", "file": ".goat-flow/architecture.md", "line": null, "summary": "One-line finding summary", "detail": "Why it matters", "evidence_quality": "OBSERVED", "evidence_method": "static-analysis", "delta_tag": ${sampleDelta} }`,
    );
  }
  lines.push("  ],");
  lines.push('  "refuted_candidates": [],');
  lines.push('  "fixes": [],');
  lines.push('  "improvements": []');
  lines.push("}");
  lines.push("```");
  lines.push("");
  appendReportJsonRules(lines, input, usesStagedDraft, pushVariant, pushFull);
}

/**
 * Append the rules an assessor must follow when filling the report template.
 * Use before persistence instructions so users receive reports their matching CLI can validate and save.
 *
 * @param lines - prompt lines appended to in place
 * @param input - the quality request, supplying mode and any prior report being compared
 * @param isStagedDraftMode - true when the dashboard stages the draft, which changes how the report must be handed back
 * @param pushVariant - emit the full-detail or compact wording of one rule
 * @param pushFull - emit lines only the full-detail prompt carries
 * @returns nothing; the rules are appended to `lines`
 */
function appendReportJsonRules(
  lines: string[],
  input: ReportContractInput,
  isStagedDraftMode: boolean,
  pushVariant: (fullText: string, compactText: string) => void,
  pushFull: (...texts: string[]) => void,
): void {
  lines.push("JSON rules:");
  lines.push(
    "- Retain `assessment_context.assessment_identity` for this assessment. Copy available launch metadata supplied separately by the transport (Claude CLI context or `GOAT_QUALITY_ASSESSMENT_IDENTITY` in the initial Codex session); never dump the environment or settings. That record fingerprints the exact user-prompt UTF-8 body, excluding terminal framing and the metadata carrier itself. Use it only for the initial matching prompt, never a later pasted or edited prompt. Otherwise record directly observed model/tool identity with `capture: assessor-reported`; unavailable fields stay null. Never infer model or settings from the agent name, defaults, or current save-time state. Keep `fixed_input_protocol` null unless a recorded frozen-input study supplies it. Available identity alone does not establish a controlled rerun.",
  );
  appendConcernAndFixRules(lines);
  lines.push(QUALITY_SCORE_RULE);
  lines.push(
    `- Every score axis requires \`evidence\` and \`deduction\` as non-empty single-line strings of ${QUALITY_SCORE_RATIONALE_MAX_CHARACTERS} characters or fewer.`,
  );
  lines.push(
    `- Allowed \`type\` values: ${backtickList(QUALITY_FINDING_TYPES)}.`,
  );
  lines.push(
    `- Allowed \`severity\` values: ${backtickList(QUALITY_FINDING_SEVERITIES)}.`,
  );
  lines.push(
    "- Set `audit_status` from this run's live grounding audit outcome (`pass` or `fail`); use `unavailable` only when no live audit completed this run.",
  );
  pushVariant(
    "- `evidence_quality` is REQUIRED on every finding. Allowed values: `OBSERVED` (verified in code/output), `INFERRED` (state what's missing). Omitting this field causes the report to be rejected.",
    "- `evidence_quality` is REQUIRED on every finding. Allowed values: `OBSERVED` or `INFERRED`.",
  );
  pushVariant(
    "- `evidence_method` is REQUIRED on every finding (schema v2, 2026-04-19+). Allowed values: `runtime-probe` (you invoked commands/tools to verify - e.g. `npx eslint`, `bash <hook>`), `static-analysis` (you read files only), `mixed` (both methods for this specific finding). A finding labelled `OBSERVED` via `static-analysis` can still miss runtime-only defects; labelling the method honestly lets cross-report triangulation flag methodology gaps.",
    `- \`evidence_method\` is REQUIRED on every finding. Allowed values: ${backtickList(QUALITY_EVIDENCE_METHODS)}.`,
  );
  pushVariant(
    "- A `runtime-probe` or `mixed` finding requires `evidence_command`, `evidence_exit_code`, and `evidence_summary` from the same completed tool call. Optional `evidence_warning_count` and `evidence_excerpt` must match that output. Keep text single-line; do not reconstruct exits from memory or paste terminal blocks.",
    "- A `runtime-probe` or `mixed` finding requires `evidence_command`, `evidence_exit_code`, and `evidence_summary` from the same completed tool call. Optional `evidence_warning_count` and `evidence_excerpt` must match that output.",
  );
  lines.push(
    "- Capture command output and its real exit code together. A grep with no matches can exit 1; a failed analyzer startup is not a clean run. Truncated output, a signal, or an unavailable exit code cannot support a precise count or a fabricated exit 0; name the missing evidence in `unverified_probes`.",
    "- Recheck each candidate against current source, accepted decisions, and a negative control before scoring it. Report findings only for concrete current defects. Keep qualification gaps, maintenance work, and design opportunities distinct; a local classifier test does not prove live provider delivery. State whether a skill was inspected or invoked; static inspection is valid evidence for static claims.",
    `- Record up to ${QUALITY_MAX_IMPROVEMENTS} actionable recommendations in \`improvements\`, or \`[]\` when none remain. Each row has \`category\` (${backtickList(QUALITY_IMPROVEMENT_CATEGORIES)}), \`summary\` (up to 240 characters), \`action\` and \`evidence\` (up to 1000 each), and \`file\` (path or null for project-wide work). Text must be non-empty and single-line. Preserve the same recommendations in prose; do not repeat refuted candidates or change rubric scores merely because an opportunity exists.`,
  );
  pushVariant(
    "- `refuted_candidates` is REQUIRED and may be `[]`. Preserve every candidate you tested and excluded; never repeat those candidates in `findings`. Each row requires `claim`, `why_excluded`, nullable `file` and `line`, `evidence_quality`, `evidence_method`, and `evidence_summary`; `evidence_command`, `evidence_exit_code`, and `evidence_excerpt` are optional unless the method rule below requires them.",
    "- `refuted_candidates` is REQUIRED and may be `[]`. Each row requires `claim`, `why_excluded`, nullable `file` and `line`, `evidence_quality`, `evidence_method`, and `evidence_summary`; excluded candidates do not belong in `findings`.",
  );
  lines.push(
    "- A `runtime-probe` or `mixed` refuted candidate requires `evidence_command`, `evidence_exit_code`, and `evidence_summary` so the disproval is reproducible.",
  );
  lines.push(
    '- A refuted candidate must use `evidence_quality: "OBSERVED"`; an `INFERRED` candidate remains unresolved and must not enter the refutation ledger.',
  );
  lines.push(
    '- A `static-analysis` or `mixed` refuted candidate requires a non-null `file` and a grep-friendly semantic anchor such as `(search: "pattern")` in `evidence_summary`.',
  );
  pushVariant(
    '- `scope` is REQUIRED at top level. Set `framework-self` if you detect this is the goat-flow repo itself (heuristic: `package.json` contains `"name": "@blundergoat/goat-flow"`). Otherwise set `consumer`.',
    "- `scope` is REQUIRED at top level: `framework-self` when the target is the goat-flow repo itself, otherwise `consumer` (copy the template value above).",
  );
  pushVariant(
    `- \`rubric_version\` is REQUIRED at top level; copy the template value (\`"${getQualityRubricId(input.qualityMode)}"\`). It identifies this mode's scoring text and prior-context policy.`,
    `- \`rubric_version\` is REQUIRED at top level; copy the template value (\`"${getQualityRubricId(input.qualityMode)}"\`).`,
  );
  lines.push(
    `- \`quality_mode\` is REQUIRED for new reports generated from this prompt. Use \`${jsonString(input.qualityMode)}\` for this ${qualityModeLabel(input.qualityMode)} assessment.`,
  );
  pushVariant(
    `- \`assessment_context\` is REQUIRED for new reports. Set \`project_revision\` to the assessed Git HEAD or \`null\`; set \`working_tree_state\` to ${backtickList(QUALITY_WORKTREE_STATES)}; set \`grounding_status\` to ${backtickList(QUALITY_GROUNDING_STATUSES)}; list every skipped, denied, or unavailable command or skill probe in \`unverified_probes\`; and set \`score_confidence\` to ${backtickList(QUALITY_SCORE_CONFIDENCES)}. Use an empty \`unverified_probes\` array only when grounding is complete. This metadata does not change or cap the rubric scores.`,
    `- \`assessment_context\` is REQUIRED: record \`project_revision\`; \`working_tree_state\` as ${backtickList(QUALITY_WORKTREE_STATES)}; \`grounding_status\` as ${backtickList(QUALITY_GROUNDING_STATUSES)}; \`unverified_probes\`; and \`score_confidence\` as ${backtickList(QUALITY_SCORE_CONFIDENCES)}. This metadata does not change or cap the rubric scores.`,
  );
  lines.push(
    "- Record `workspace_snapshot.start` before assessment and `.end` afterwards using the same raw-file snapshot request below; copy each returned `authority.fingerprint`. This covers the selected project's non-ignored regular files, not ignored plans/logs, symlinks, or nested repositories. Re-read any ignored evidence separately. These are reviewer-recorded fingerprints, not launcher attestation.",
    `- With a version-matched CLI, send {"schema":"goat-review-request/v1","source":{"kind":"area","roots":["."],"sample":null}} on stdin to \`goat-flow review snapshot --project ${shellSingleQuote(input.projectPath)} --expected-version ${getPackageVersion()}\`. In the controlling framework checkout, the matching \`node --import tsx src/cli/cli.ts\` prefix is also valid.`,
    "- If snapshot capture is unavailable, use null for that endpoint and name the limitation in `unverified_probes`. If endpoints differ, recheck affected findings and use partial grounding while the drift remains unresolved. A shared HEAD or a dirty/clean label alone does not establish identical assessed content. Compare score changes only with matching rubric, scope, and adequately grounded evidence.",
  );
  // Same prior-report id in both wordings - compute once so the branch doesn't
  // sit inline in each variant string.
  const priorIdText = input.priorReport
    ? `\`${input.priorReport.id}\``
    : "`null`";
  pushVariant(
    `- \`prior_report_id\` must be ${priorIdText} for this run. This makes \`delta_tag\` traceable to the same-agent baseline and prevents readers from treating \`new\` as newly introduced without a diff.`,
    `- \`prior_report_id\` must be ${priorIdText} for this run. This makes \`delta_tag\` traceable to the same-agent baseline.`,
  );
  pushFull(
    "- `line` must be a positive integer OR `null`. Never `0`. For file-wide findings with no specific line, use `null`.",
    "- Live review findings should cite `file` + semantic anchor after re-reading the cited file and anchor. Durable footguns, lessons, patterns, and decisions must use file paths plus semantic anchors rather than line numbers.",
  );
  // Prior-report context flips the delta_tag requirement - keep both halves of
  // that rule here so no surface restates (and drifts) it.
  if (input.priorReport) {
    lines.push(
      '- `delta_tag` is REQUIRED on every current finding and must be either `"new"` or `"persisted"`. `absent` belongs in derived diff output, not the current finding list; absence is not proof of resolution.',
    );
  } else {
    lines.push(
      "- `delta_tag` must be `null` or omitted when no prior report context exists.",
    );
  }
  pushVariant(
    "- Do NOT include an `id` field. The CLI derives finding IDs deterministically from finding fields when the report is loaded; they do not establish semantic identity across rewrites.",
    "- Do NOT include an `id` field.",
  );
  pushVariant(
    "- Do NOT include extra top-level keys or extra finding keys outside this contract. Unknown keys are rejected.",
    "- Do NOT include extra top-level keys or extra finding keys outside this contract.",
  );
  pushFull(
    "- `summary` and `detail` MUST be single-line strings. No literal newlines, tabs, or other control characters. If you need to reference multi-line command output, summarise the outcome in prose - do NOT paste raw terminal blocks into JSON string fields. Pasted multi-line content produces unparseable JSON and the report is lost.",
  );
  // Shell-based saving needs a quoted delimiter to keep report text from becoming commands.
  if (!isStagedDraftMode) {
    pushFull(
      "- QUOTE the persistence delimiter (`<<'JSON'`, not `<<JSON`). Unquoted delimiters make the shell interpret `$`, backticks, and escapes inside the report.",
    );
  }
  lines.push("");
  // Dashboard-launched restricted reviews hand their draft to the launcher's persistence route.
  if (isStagedDraftMode) {
    appendStagedDraftPersistence(lines, input);
    return;
  }
  lines.push(
    "**Persist through the bounded saver.** `quality save` redacts and validates stdin in memory before choosing the report filename. It owns the destination under the selected project's `.goat-flow/logs/quality/`; never stage the raw draft or pass `--output`.",
  );
  lines.push("");
  lines.push(
    `**Select a compatible saver.** Run \`goat-flow --version\`; it must print \`goat-flow v${getPackageVersion()}\`. If that matching CLI lacks \`quality save\`, use the source fallback only from the goat-flow framework checkout after \`node --import tsx src/cli/cli.ts --version\` prints the same version.`,
  );
  lines.push(
    "If the PATH executable is missing or does not match, do not use it. In the framework checkout, use the source fallback after its version matches the report version.",
  );
  lines.push(
    "Place the completed report object between the quoted delimiters. Minified and pretty-printed JSON are both supported by the bounded quality-save transport; keep the delimiter quoted so report text stays inert.",
  );
  lines.push("");
  lines.push("```bash");
  lines.push(
    `goat-flow quality save ${shellSingleQuote(input.projectPath)} <<'JSON'`,
    "<insert the complete report object here>",
    "JSON",
  );
  lines.push("```");
  lines.push("");
  lines.push("Framework source fallback:");
  lines.push("");
  lines.push("```bash");
  lines.push(
    `node --import tsx src/cli/cli.ts quality save ${shellSingleQuote(input.projectPath)} <<'JSON'`,
    "<insert the complete report object here>",
    "JSON",
  );
  lines.push("```");
  lines.push("");
  lines.push(
    "If both compatible saver paths are unavailable, keep the report non-durable and state `persist-skipped: redactor-unavailable`; never write an unredacted fallback.",
  );
  lines.push("");
  lines.push(
    "If save exits non-zero, fix the reported JSON or ownership error and retry through the same command. Do not claim persistence until it prints `OK <absolute-report-path>`.",
  );
  lines.push("");
  lines.push(
    "**End of response:** After `OK`, confirm with one line using that exact path: `Wrote quality report to <absolute-report-path>`. Do not include the JSON inline.",
  );
}

/** Give every assessment mode the same concern and attributed-fix evidence contract. */
function appendConcernAndFixRules(lines: string[]): void {
  lines.push(
    `- Each current finding requires exactly one primary \`concern\`: ${backtickList(QUALITY_CONCERNS)}. Choose the affected harness responsibility; a hook bypass belongs to constraints. Do not duplicate one defect across concern rows or change axis scores merely because of its concern. Counts describe reported findings in this run, not all open defects; legacy omissions remain unclassified.`,
    '- Optional `fixes` contains at most 20 assessor-verified correction claims. Recheck the original problem and explain how the evidence proves its correction. A "Fixed at" prefix, disappearance from a later report, passing command or existing link alone does not prove a fix. Do not open prior scored reports; use the score-free prior finding IDs and claims supplied in this prompt. Omit a fix record when the exact prior identity or proof is unavailable.',
    '- Each fix has `prior_report_id`, `finding_id`, `conclusion: "assessor-verified"`, `explanation`, `target`, and `evidence`. Attribution is this report\'s agent and saved report ID. Use null for unavailable claim fields; incomplete or unresolved records remain unconfirmed. Do not supply `reference_check`: the saver derives it. Record one claim per exact prior report/finding pair; distinct findings may share a proof artifact.',
    '- A committed target is `{ "kind": "commit", "revision": <full commit ID> }`. A workspace target is `{ "kind": "workspace-snapshot", "fingerprint": <review fingerprint>, "capture": { "file": <retained project-relative review capture>, "sha256": <its SHA-256> } }`. Reuse evidence from normal work; do not create a separate tracking workflow. HEAD alone never identifies an uncommitted fix.',
    "- Fix `evidence` has `method`, `file`, `sha256`, and `summary`. Runtime behavior requires `runtime-probe` or `mixed` evidence with the recorded `command` and `exit_code`, referring to retained reproduction/test output. Interpret that output against the original failure; an exit code alone is insufficient. Static source/document corrections may use `static-analysis` with an exact `anchor` when the file proves the whole claim. For committed static evidence, hash the file bytes at the target revision; workspace static evidence must match the retained capture inventory. Use project-relative paths and full lowercase SHA-256 digests.",
    '- The CLI validates record shape and references; it does not certify the correction or run saved commands. Historical records retain their original conclusion and target if a reference is lost, with "evidence unavailable; not reverified". Unconfirmed claims are not verified fixes.',
  );
}

/**
 * Add the dashboard staging instructions shown after an enforced quality review.
 *
 * Use after a user launches a write-restricted review, so the launcher can save the report.
 * The receipt exposes an outcome but does not bind that outcome to this run's draft.
 *
 * @param promptLines - save guidance shown to the reviewer; empty means this block starts the final section
 * @param reportContractInput - validated run context; project path and agent are non-empty after launch validation
 * @returns nothing; the supplied prompt receives the staged-draft instructions the reviewer follows
 */
function appendStagedDraftPersistence(
  promptLines: string[],
  reportContractInput: ReportContractInput,
): void {
  // e.g. a user finishes an enforced Claude review, and the dashboard needs one draft to persist.
  const reportOwnerRoot = reportContractInput.projectPath.replace(
    /[\\/]+$/u,
    "",
  );
  const qualityStagingDirectory = `${reportOwnerRoot}/.goat-flow/logs/quality/staging`;
  promptLines.push(
    "**Persist through the dashboard.** This session's launcher owns report persistence. Do not run any Bash saver command; write nothing except the single staged draft described here.",
  );
  promptLines.push("");
  promptLines.push(
    "Choose a fresh `<nonce>` of exactly 32 lowercase hexadecimal characters for collision avoidance; the format is not proof of randomness.",
    "Before writing, use an available read-only file or glob tool (not Bash) to confirm that neither the draft path nor the receipt path below exists. If either exists, choose a new token.",
    "If you cannot establish that both are absent, do not stage the draft; finish the prose assessment and state `persist-skipped: collision-precheck-unavailable`. A successful pre-check reduces collision risk but does not prove that a later receipt belongs to this draft.",
    "Minify the completed report object to one JSON line and, using your file tool, write it to exactly:",
  );
  promptLines.push("");
  promptLines.push("```");
  promptLines.push(
    `${qualityStagingDirectory}/goat-quality-draft-${reportContractInput.agent}-<nonce>.json`,
  );
  promptLines.push("```");
  promptLines.push("");
  promptLines.push(
    "Write one draft only, and no other file in that directory. The dashboard redacts, validates, and persists it within a few seconds, deletes the draft, and writes a receipt beside it:",
  );
  promptLines.push("");
  promptLines.push("```");
  promptLines.push(
    `${qualityStagingDirectory}/goat-quality-result-${reportContractInput.agent}-<nonce>.json`,
  );
  promptLines.push("```");
  promptLines.push("");
  promptLines.push(
    'Read the receipt with your file tool, retrying briefly until it exists. `"ok": true` means persisted; use its `reportPath`. `"ok": false` means rejected - fix the report per its `error` and write ONE corrected draft under a NEW nonce.',
  );
  promptLines.push("");
  promptLines.push(
    "If no receipt appears after several read attempts over roughly 30 seconds, state `persist-skipped: capture-unavailable`. Never fall back to Bash, another destination, or an inline JSON reply.",
    "If a session mode change blocks the staging write itself (plan mode, a write-locked overlay), finish the prose assessment and state `persist-skipped: <reason>` instead of aborting.",
  );
  promptLines.push("");
  promptLines.push(
    "**End of response:** After an `ok` receipt, confirm with one line using its exact report path: `Wrote quality report to <absolute-report-path>`. Do not include the JSON inline.",
  );
}

/**
 * Append the focused prose ledger followed by the compact shared report contract.
 * Use for process, harness, and skills assessments so their users see the same disproval evidence as the full assessment.
 *
 * @param lines - prompt line buffer; empty means the ledger starts the remaining focused output instructions
 * @param input - run facts embedded into the contract; a null prior report keeps finding delta tags unset
 * @returns nothing; the supplied prompt receives the prose ledger and JSON contract
 */
export function appendFocusedReportContract(
  lines: string[],
  input: ReportContractInput,
): void {
  lines.push("### Refuted Candidates");
  lines.push(
    "List every candidate finding you tested and excluded, why it was excluded, and the source anchor or command result that disproved it. Write `None` when no candidate was ruled out.",
  );
  lines.push(
    "Keep these candidates out of findings and recommendations; the ledger exists so the user and later reviewers do not repeat disproved work.",
  );
  lines.push("");
  appendQualityReportContract(lines, input, {
    detail: "compact",
    hasLeadingSeparator: true,
    sampleFindingType: "framework_flaw",
  });
}
