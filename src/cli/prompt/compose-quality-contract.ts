/**
 * Writes the contract an agent must follow when it produces a quality report.
 * A quality assessment is written by a language model, so the prompt has to state exactly what
 * a valid report looks like: which fields exist, which values each one accepts, and what the
 * agent is forbidden from inventing. This module renders that contract into the prompt.
 *
 * The vocabulary is pulled from the same constants the parser validates against, so the
 * instructions an agent reads and the rules its output is checked by can never drift apart. A
 * contract that allowed a value the parser rejects would fail the user at save time, after the
 * expensive part of the work was already done.
 */
import type { AgentId } from "../types.js";
import type { QualityHistoryEntry } from "../quality/history.js";
import { getPackageVersion } from "../paths.js";
import { QUALITY_REPORT_KIND, type QualityMode } from "../quality/schema.js";
import {
  QUALITY_EVIDENCE_METHODS,
  QUALITY_FINDING_SEVERITIES,
  QUALITY_FINDING_TYPES,
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
 * THE single authoritative renderer for the quality report JSON contract.
 *
 * Every surface that asks an agent to write a quality report - the CLI's
 * agent-setup and focused prompts today - appends this block, so a user
 * running `goat-flow quality --agent claude` and one clicking Launch in the
 * dashboard's Quality page get reports that `goat-flow quality validate`,
 * `history`, and `diff` all parse identically. Field lists come from
 * `quality/schema-types.ts`, so prompt text cannot drift from the parser.
 * (The dashboard's browser-side mirror cannot import this module - it is
 * pinned to the same required fields by `test/unit/quality-report-contract.test.ts`.)
 *
 * @param lines - prompt line buffer; appended to in place
 * @param input - run facts embedded into the contract (agent, paths, prior report, mode)
 * @param opts - per-surface presentation switches (detail level, separator, sample type)
 */
// eslint-disable-next-line complexity -- Intentional because mutually exclusive saver contracts require one ordered renderer.
export function appendQualityReportContract(
  lines: string[],
  input: ReportContractInput,
  opts: ReportContractOptions,
): void {
  const full = opts.detail === "full";
  /**
   * Push the full-detail or compact wording of one line. The detail branch
   * lives in this arrow's own scope, so it does not add to the enclosing
   * function's complexity budget - just its readability.
   */
  const pushVariant = (fullText: string, compactText: string): void => {
    lines.push(full ? fullText : compactText);
  };
  /** Push extra lines that only the full-detail prompt carries. */
  const pushFull = (...texts: string[]): void => {
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
  lines.push(`  "rubric_version": ${jsonString(getPackageVersion())},`);
  lines.push(`  "quality_mode": ${jsonString(input.qualityMode)},`);
  lines.push(
    `  "prior_report_id": ${input.priorReport ? jsonString(input.priorReport.id) : "null"},`,
  );
  lines.push('  "scores": {');
  lines.push(
    '    "setup": { "total": 0, "accuracy": 0, "relevance": 0, "completeness": 0, "friction": 0 },',
  );
  lines.push(
    '    "system": { "total": 0, "usefulness": 0, "signal_to_noise": 0, "adaptability": 0, "learnability": 0 }',
  );
  lines.push("  },");
  lines.push('  "findings": [');
  const sampleType = opts.sampleFindingType ?? "setup_quality";
  const sampleDelta = input.priorReport ? '"new"' : "null";
  // Full detail keeps the multi-line sample with the semantic-anchor guidance
  // baked into the detail text; compact keeps the one-liner.
  if (full) {
    lines.push("    {");
    lines.push(
      `      "type": "${sampleType}", "severity": "MAJOR", "file": ".goat-flow/architecture.md", "line": null,`,
    );
    lines.push(
      `      "summary": "One-line finding summary", "detail": "Why it matters; include a semantic anchor when the evidence should survive as a durable learning-loop artifact.", "evidence_quality": "OBSERVED", "evidence_method": "static-analysis", "delta_tag": ${sampleDelta}`,
    );
    lines.push("    }");
  } else {
    lines.push(
      `    { "type": "${sampleType}", "severity": "MAJOR", "file": ".goat-flow/architecture.md", "line": null, "summary": "One-line finding summary", "detail": "Why it matters", "evidence_quality": "OBSERVED", "evidence_method": "static-analysis", "delta_tag": ${sampleDelta} }`,
    );
  }
  lines.push("  ]");
  lines.push("}");
  lines.push("```");
  lines.push("");
  lines.push("JSON rules:");
  lines.push(
    "- `scores.*` axis values must use exact `0 | 5 | 10 | 15 | 20 | 25` increments and each axis sum must equal its `total` exactly.",
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
    "- Runtime-backed findings SHOULD include compact evidence fields when useful: `evidence_command` (the command), `evidence_exit_code` (integer), `evidence_summary` (literal pass/fail or warning summary), `evidence_warning_count` (integer), and `evidence_excerpt` (short single-line excerpt). Do not paste raw terminal blocks into JSON.",
    "- Runtime-backed findings SHOULD include compact evidence fields when useful: `evidence_command`, `evidence_exit_code`, `evidence_summary`, `evidence_warning_count`, and `evidence_excerpt`. Keep these single-line and concise; do not paste raw terminal blocks.",
  );
  pushVariant(
    '- `scope` is REQUIRED at top level. Set `framework-self` if you detect this is the goat-flow repo itself (heuristic: `package.json` contains `"name": "@blundergoat/goat-flow"`). Otherwise set `consumer`.',
    "- `scope` is REQUIRED at top level: `framework-self` when the target is the goat-flow repo itself, otherwise `consumer` (copy the template value above).",
  );
  pushVariant(
    `- \`rubric_version\` is REQUIRED at top level; copy the template value (\`"${getPackageVersion()}"\`). The Rating bands section above is the rubric - future readers use this version tag to trace which band anchors produced your scores.`,
    `- \`rubric_version\` is REQUIRED at top level; copy the template value (\`"${getPackageVersion()}"\`).`,
  );
  lines.push(
    `- \`quality_mode\` is REQUIRED for new reports generated from this prompt. Use \`${jsonString(input.qualityMode)}\` for this ${qualityModeLabel(input.qualityMode)} assessment.`,
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
      '- `delta_tag` is REQUIRED on every current finding and must be either `"new"` or `"persisted"`. `resolved` belongs in derived diff output, not the current finding list.',
    );
  } else {
    lines.push(
      "- `delta_tag` must be `null` or omitted when no prior report context exists.",
    );
  }
  pushVariant(
    "- Do NOT include an `id` field. The CLI attaches positional finding ids deterministically when the report is loaded.",
    "- Do NOT include an `id` field.",
  );
  pushVariant(
    "- Do NOT include extra top-level keys or extra finding keys outside this contract. Unknown keys are rejected.",
    "- Do NOT include extra top-level keys or extra finding keys outside this contract.",
  );
  pushFull(
    "- `summary` and `detail` MUST be single-line strings. No literal newlines, tabs, or other control characters. If you need to reference multi-line command output, summarise the outcome in prose - do NOT paste raw terminal blocks into JSON string fields. Pasted multi-line content produces unparseable JSON and the report is lost.",
  );
  if (!usesStagedDraft) {
    pushFull(
      "- QUOTE the persistence delimiter (`<<'JSON'`, not `<<JSON`). Unquoted delimiters make the shell interpret `$`, backticks, and escapes inside the report.",
    );
  }
  lines.push("");
  if (usesStagedDraft) {
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
    "Minify the completed report object to one JSON line between the quoted delimiters. Multi-line heredoc bodies can be mistaken for chained shell commands by safety hooks.",
  );
  lines.push("");
  lines.push("```bash");
  lines.push(
    `goat-flow quality save ${shellSingleQuote(input.projectPath)} <<'JSON'`,
    "<insert the complete report object as one JSON line here>",
    "JSON",
  );
  lines.push("```");
  lines.push("");
  lines.push("Framework source fallback:");
  lines.push("");
  lines.push("```bash");
  lines.push(
    `node --import tsx src/cli/cli.ts quality save ${shellSingleQuote(input.projectPath)} <<'JSON'`,
    "<insert the complete report object as one JSON line here>",
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

/**
 * Render the staged-draft persistence contract for enforced dashboard sessions.
 *
 * Replaces the bounded-saver block when `persistence` is `staged-draft`: the
 * agent writes exactly one draft file with its file tool and the dashboard
 * server redacts, validates, and persists it (ADR-044). No Bash command
 * appears anywhere in this block because the Claude reporting overlay cannot
 * authorize the heredoc saver; the receipt file closes the honesty loop so
 * the agent never claims persistence it cannot observe.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param input - run facts naming the owner project and assessed agent
 */
function appendStagedDraftPersistence(
  lines: string[],
  input: ReportContractInput,
): void {
  const ownerRoot = input.projectPath.replace(/[\\/]+$/u, "");
  const stagingDir = `${ownerRoot}/.goat-flow/logs/quality/staging`;
  lines.push(
    "**Persist through the dashboard.** This session's launcher owns report persistence. Do not run any Bash saver command; write nothing except the single staged draft described here.",
  );
  lines.push("");
  lines.push(
    "Choose `<nonce>`: 6-12 random lowercase hex characters. Minify the completed report object to one JSON line and, using your file tool, write it to exactly:",
  );
  lines.push("");
  lines.push("```");
  lines.push(`${stagingDir}/goat-quality-draft-${input.agent}-<nonce>.json`);
  lines.push("```");
  lines.push("");
  lines.push(
    "Write one draft only, and no other file in that directory. The dashboard redacts, validates, and persists it within a few seconds, deletes the draft, and writes a receipt beside it:",
  );
  lines.push("");
  lines.push("```");
  lines.push(`${stagingDir}/goat-quality-result-${input.agent}-<nonce>.json`);
  lines.push("```");
  lines.push("");
  lines.push(
    'Read the receipt with your file tool, retrying briefly until it exists. `"ok": true` means persisted; use its `reportPath`. `"ok": false` means rejected - fix the report per its `error` and write ONE corrected draft under a NEW nonce.',
  );
  lines.push("");
  lines.push(
    "If no receipt appears after several read attempts over roughly 30 seconds, state `persist-skipped: capture-unavailable`. Never fall back to Bash, another destination, or an inline JSON reply.",
  );
  lines.push("");
  lines.push(
    "**End of response:** After an `ok` receipt, confirm with one line using its exact report path: `Wrote quality report to <absolute-report-path>`. Do not include the JSON inline.",
  );
}

/**
 * Focused-mode wrapper over {@link appendQualityReportContract}: compact
 * wording, trailing-section separator, framework-flavoured sample finding.
 * Kept as a named export so focused composers read naturally.
 *
 * @param lines - prompt line buffer; appended to in place
 * @param input - run facts embedded into the contract
 */
export function appendFocusedReportContract(
  lines: string[],
  input: ReportContractInput,
): void {
  appendQualityReportContract(lines, input, {
    detail: "compact",
    hasLeadingSeparator: true,
    sampleFindingType: "framework_flaw",
  });
}
