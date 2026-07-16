/**
 * Shared building blocks for composing agent quality-review prompts.
 *
 * Collects the cross-mode helpers the per-mode composers reuse: shell/JSON/date
 * escaping for embedded snippets, project-path shaping that survives Windows and
 * UNC roots, audit-summary rendering, prior-report delta context, bounded
 * learning-loop context, and the focused JSON-report contract appended to the end
 * of every prompt. Pure string assembly; the only I/O is the `package.json` read
 * behind `inferQualityScope`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { AgentId, SharedFacts } from "../types.js";
import type { AuditConcernKey, AuditReport } from "../audit/types.js";
import type { QualityHistoryEntry } from "../quality/history.js";
import { QUALITY_REPORT_KIND, type QualityMode } from "../quality/schema.js";
import {
  QUALITY_EVIDENCE_METHODS,
  QUALITY_FINDING_SEVERITIES,
  QUALITY_FINDING_TYPES,
} from "../quality/schema-types.js";
import { getPackageVersion } from "../paths.js";
import {
  renderLearningLoopContext,
  selectLearningLoopContext,
} from "./learning-loop-context.js";

/**
 * Build the forward-slash project sub-path that goes inside a Bash snippet in
 * the prompt. On Windows `path.resolve` returns backslashes and (worse) drive-
 * prefixes POSIX-shape inputs; `path.posix.join` keeps the input shape and
 * forces forward-slash separators for the appended segment. Backslashes are
 * normalised first so UNC roots (`\\server\share`) survive as `//server/share`;
 * the leading slash that `posix.join` collapses on UNC inputs is then restored
 * so quality writes still target the network share, not a local absolute path.
 *
 * @param projectPath - absolute project root; may be a Windows path or a UNC root (`\\server\share`)
 * @param sub - POSIX-shaped sub-path to append, e.g. `.goat-flow/logs/quality`
 * @returns forward-slash path safe to embed in a generated Bash snippet, with the UNC root preserved
 */
function toShellProjectPath(projectPath: string, sub: string): string {
  const normalized = projectPath.replace(/\\/g, "/");
  const isUnc = normalized.startsWith("//");
  const joined = posix.join(normalized, sub);
  return isUnc && !joined.startsWith("//") ? "/" + joined : joined;
}

/** Inputs needed to compose an agent quality-review prompt for one project. */
export interface QualityInput {
  agent: AgentId;
  projectPath: string;
  auditReport: AuditReport | null;
  auditUnavailableReason?: AuditUnavailableReason | undefined;
  priorReport?: QualityHistoryEntry | null;
  qualityMode?: QualityMode;
  selectedProjectPath?: string;
  runDate?: string;
  sharedFacts?: SharedFacts | null;
}

/**
 * Why an audit summary could not be embedded in a quality prompt: the audit run
 * itself failed, or fast cache-only mode found no cached report to reuse.
 */
export type AuditUnavailableReason = "audit-failed" | "fast-cache-only";

/** Structured quality command payload returned to CLI and dashboard callers. */
export interface QualityPayload {
  command: "quality";
  agent: AgentId;
  auditStatus: "pass" | "fail" | "unavailable";
  auditSummary: string;
  prompt: string;
}

/**
 * Format one date as YYYY-MM-DD using the local calendar day, not UTC.
 *
 * @param date - day to format; defaults to the current local time
 * @returns the date as a zero-padded YYYY-MM-DD string
 */
export function formatLocalDate(date: Date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Render one JSON-safe string literal for the embedded example block.
 *
 * @param value - raw string to embed in the prompt's JSON example
 * @returns the value as a quoted, escaped JSON string literal
 */
function jsonString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Render a Bash single-quoted literal so generated snippets do not expand `$` or backticks.
 *
 * @param value - raw string to quote for a generated shell snippet
 * @returns a single-quoted Bash literal with embedded quotes escaped as `'\''`
 */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Infer the report scope from package metadata; recover as consumer when metadata is unreadable.
 *
 * @param projectPath - project root whose `package.json` name field is inspected
 * @returns `framework-self` when the package is `@blundergoat/goat-flow`, otherwise `consumer`
 *   (also `consumer` when `package.json` is missing or unparseable)
 */
function inferQualityScope(projectPath: string): "framework-self" | "consumer" {
  const packagePath = join(projectPath, "package.json");
  try {
    if (!existsSync(packagePath)) return "consumer";
    const raw = JSON.parse(readFileSync(packagePath, "utf-8")) as {
      name?: unknown;
    };
    return raw.name === "@blundergoat/goat-flow"
      ? "framework-self"
      : "consumer";
  } catch {
    return "consumer";
  }
}

/** Append setup and agent scope failures to one audit summary. */
function appendScopeSummary(lines: string[], report: AuditReport): void {
  const scopes: [string, string][] = [
    ["setup", "GOAT Flow Setup"],
    ["agent", "Agent Setup"],
  ];
  for (const [scope, label] of scopes) {
    const scopeReport = report.scopes[scope as keyof typeof report.scopes];
    if (!scopeReport) continue;
    const status = scopeReport.status === "pass" ? "PASS" : "FAIL";
    lines.push(`- **${label}**: ${status}`);
    for (const failure of scopeReport.failures) {
      lines.push(`  - ${failure.check}: ${failure.message}`);
    }
  }
}

/** Append structural concern scores and evidence limits when harness facts exist. */
function appendConcernSummary(lines: string[], report: AuditReport): void {
  if (!report.concerns) return;
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
    const concern = report.concerns[key];
    const limits =
      concern.limits.length > 0
        ? `; limits: ${concern.limits.join(" | ")}`
        : "";
    lines.push(
      `- ${key}: ${concern.status === "pass" ? "PASS" : "FAIL"} (${concern.score}%; metrics=${concern.metrics}${limits})`,
    );
  }
}

/** Append template-drift findings when the audit collected drift evidence. */
function appendDriftSummary(lines: string[], report: AuditReport): void {
  if (!report.drift) return;
  lines.push("");
  lines.push(
    `- **Template Drift**: ${report.drift.status === "pass" ? "PASS" : "FAIL"} (${report.drift.checked} checked)`,
  );
  for (const finding of report.drift.findings) {
    lines.push(`  - ${finding.path}: ${finding.message}`);
  }
}

/** Append content-lint findings when the audit collected content evidence. */
function appendContentSummary(lines: string[], report: AuditReport): void {
  if (!report.content) return;
  lines.push("");
  lines.push(
    `- **Content Claims**: ${report.content.status === "pass" ? "PASS" : "FAIL"} (${report.content.filesScanned} files scanned)`,
  );
  for (const finding of report.content.findings) {
    lines.push(
      `  - ${finding.path}${finding.line ? `:${finding.line}` : ""} [${finding.rule}]: ${finding.message}`,
    );
  }
}

/**
 * Render the audit summary block because reviewers need setup failures before qualitative judgment.
 *
 * @param report - completed audit report whose scope results and concern scores are summarised
 * @returns a Markdown block listing setup/agent pass-fail plus harness-completeness percentages
 */
export function renderAuditSummary(report: AuditReport): string {
  const lines: string[] = [];
  appendScopeSummary(lines, report);
  appendConcernSummary(lines, report);
  appendDriftSummary(lines, report);
  appendContentSummary(lines, report);

  return lines.join("\n");
}

/**
 * Render the summary text returned when no audit report is embedded.
 *
 * @param reason - why audit data is absent (failed run vs fast cache miss)
 * @returns a one-line summary phrased for that reason
 */
export function renderAuditUnavailableSummary(
  reason: AuditUnavailableReason,
): string {
  if (reason === "fast-cache-only") {
    return "Audit data not loaded (fast cache-only mode had no cached report).";
  }
  return "Audit data unavailable (audit could not complete).";
}

/**
 * Render the heading used when no audit report is embedded.
 *
 * @param reason - why audit data is absent (failed run vs fast cache miss)
 * @returns a bold Markdown heading marking the audit as not-loaded or unavailable
 */
export function renderAuditUnavailableHeading(
  reason: AuditUnavailableReason,
): string {
  if (reason === "fast-cache-only") {
    return "**Audit: NOT LOADED (FAST CACHE-ONLY MODE)**";
  }
  return "**Audit: UNAVAILABLE**";
}

/**
 * Render the fallback note used when audit data is unavailable.
 *
 * @param reason - why audit data is absent (failed run vs fast cache miss)
 * @returns a blockquote telling the reviewer not to infer setup failure from the gap
 */
export function renderDegradedNote(reason: AuditUnavailableReason): string {
  if (reason === "fast-cache-only") {
    return [
      "",
      "> **Note:** The dashboard requested a fast quality prompt and no cached audit report was available.",
      "> This does not mean the audit failed. Run the Re-audit action or `goat-flow audit . --harness --agent <id>` for live audit status.",
      "> Continue the assessment, but do not infer setup failure from this cache miss.",
      "",
    ].join("\n");
  }
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

/**
 * Return the operator-facing label for a quality prompt mode.
 *
 * @param mode - quality prompt mode being rendered
 * @returns the human-readable label shown to operators (e.g. `Harness Engineering`)
 */
export function qualityModeLabel(mode: QualityMode): string {
  if (mode === "process") return "Process";
  if (mode === "harness") return "Harness Engineering";
  if (mode === "skills") return "Skills";
  return "Agent Installation";
}

/**
 * Describe which workspace or target the selected quality mode should assess.
 *
 * @param mode - quality prompt mode being rendered
 * @returns a sentence naming the workspace or target the mode's assessment covers
 */
export function qualityModeTargetScope(mode: QualityMode): string {
  if (mode === "process") {
    return "controlling goat-flow workspace, plus selected target only when it is a goat-flow installation";
  }
  if (mode === "harness") {
    return "selected target project harness, interpreted from the controlling workspace";
  }
  if (mode === "skills") {
    return "controlling goat-flow workspace skills and shared references";
  }
  return "selected project and selected agent installation";
}

const WRITE_POLICY_MARKERS = ["write", "no-write", "read-only"] as const;
const LOCAL_ARTIFACT_MARKERS = [
  "gitignored",
  "local artifact",
  "local-state",
  ".goat-flow/logs",
  ".goat-flow/plans",
  "critique snapshot",
  "scratchpad",
  "quality report",
  "session log",
  "task-local",
] as const;

// Quality prompts may request semantic anchors for durable follow-up, but
// automatic tracked learning-loop writes belong to CLI-owned code after opt-in.
function includesAnyMarker(text: string, markers: readonly string[]): boolean {
  return markers.some((marker) => text.includes(marker));
}

/** Return true for legacy prior findings that conflict with the current
 * reporting-only contract, where gitignored local artifacts are not findings. */
function isSupersededLocalArtifactWriteFinding(
  finding: QualityHistoryEntry["report"]["findings"][number],
): boolean {
  const text = `${finding.summary} ${finding.detail}`.toLowerCase();
  const referencesWritePolicy = includesAnyMarker(text, WRITE_POLICY_MARKERS);
  const referencesLocalArtifact = includesAnyMarker(
    text,
    LOCAL_ARTIFACT_MARKERS,
  );
  return referencesWritePolicy && referencesLocalArtifact;
}

/** Rewrite legacy prior-finding phrasing before embedding it in new quality prompts. */
function renderPriorFindingSummary(summary: string): string {
  return summary.replace(
    /\bstrict no-write\b/gi,
    "tracked-file write restriction",
  );
}

/**
 * Escape Markdown table cell content emitted from scorer details.
 *
 * @param value - raw cell text that may contain pipes or newlines
 * @returns single-line cell text with `|` escaped and line breaks flattened to spaces
 */
export function markdownTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

export function renderPriorReportContext(
  priorReport: QualityHistoryEntry | null,
  qualityMode: QualityMode,
): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("");
  lines.push("## Prior report context");
  lines.push("");
  if (priorReport) {
    const currentContractFindings = priorReport.report.findings.filter(
      (finding) => !isSupersededLocalArtifactWriteFinding(finding),
    );
    const omittedPriorFindingCount =
      priorReport.report.findings.length - currentContractFindings.length;
    const priorHighSeverityCount = currentContractFindings.filter(
      (finding) =>
        finding.severity === "BLOCKER" || finding.severity === "MAJOR",
    ).length;
    const priorTopFindings = [...currentContractFindings]
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
    if (omittedPriorFindingCount > 0) {
      lines.push(
        `- Omitted ${omittedPriorFindingCount} prior local-artifact write finding(s) that conflict with the current contract: gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes.`,
      );
    }
    lines.push("- Top prior findings by severity:");
    if (priorTopFindings.length === 0) {
      lines.push("  - none after applying the current local-artifact contract");
    } else {
      for (const finding of priorTopFindings) {
        lines.push(
          `  - \`${finding.id}\` | ${finding.severity} | ${finding.type} | ${renderPriorFindingSummary(finding.summary)}`,
        );
      }
    }
    lines.push("");
    lines.push(
      'For the final JSON block in THIS run, use `delta_tag: "persisted"` when a current finding materially matches a prior finding by type/file/line. Use `delta_tag: "new"` when it does not. Do NOT emit `resolved` in current findings - resolved issues are derived later by `goat-flow quality diff` when a prior finding id disappears from a later run.',
    );
    lines.push(
      `Set top-level \`prior_report_id\` to \`${priorReport.id}\` so readers can tell that \`delta_tag: "new"\` means newly discovered relative to that same-agent report, not necessarily newly introduced in the codebase.`,
    );
  } else {
    const modeText = qualityMode === "agent-setup" ? "" : `${qualityMode} `;
    lines.push(
      `No prior same-agent ${modeText}quality report exists for this project.`,
    );
    lines.push(
      "For the final JSON block in this run, omit `delta_tag` or set it to `null` for every finding.",
    );
    lines.push(
      "Set top-level `prior_report_id` to `null` because no prior same-agent report context was provided.",
    );
  }
  return lines.join("\n");
}

export function renderBoundedLearningLoopContext(
  sharedFacts: SharedFacts | null | undefined,
  qualityMode: QualityMode,
): string {
  if (!sharedFacts) return "";
  if (qualityMode !== "agent-setup" && qualityMode !== "harness") return "";
  const surface =
    qualityMode === "harness" ? "quality-harness" : "quality-agent-setup";
  return renderLearningLoopContext(
    selectLearningLoopContext(sharedFacts, { surface }),
  );
}

/** Everything a report-contract render needs to know about the current run. */
export interface ReportContractInput {
  agent: AgentId;
  projectPath: string;
  auditStatus: QualityPayload["auditStatus"];
  qualityMode: QualityMode;
  priorReport: QualityHistoryEntry | null;
  runDate: string;
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
  lines.push(
    "Do **not** emit the JSON as a fenced block in your reply. Write it as a file to `.goat-flow/logs/quality/` - that path is gitignored and expected. No tracked-file writes or implementation edits are permitted.",
  );
  lines.push("");
  // Full detail spells out WHY the file must exist on disk - a report that
  // lives only in the agent's reply is invisible to history/diff.
  pushFull(
    "**CRITICAL:** After writing the file, verify it was saved by running `ls -la .goat-flow/logs/quality/` and confirming the file appears with non-zero size. If missing, retry the write. A quality report that exists only in conversation history is invisible to `goat-flow quality history` and `goat-flow quality diff`.",
    "",
  );
  lines.push("**Filename format:** `YYYY-MM-DD-HHMM-<agent>-<rand5>.json`");
  lines.push("");
  pushFull(
    "Where:",
    "- `YYYY-MM-DD-HHMM` is the current local date and 24-hour time (e.g. `2026-04-19-1430`)",
    `- \`<agent>\` is the literal string \`${input.agent}\``,
    "- `<rand5>` is 5 lowercase alphanumeric characters (a-z, 0-9) that you generate fresh to avoid collisions with other parallel runs",
    "",
    "**Derive the date/time/random parts via your shell** (so the filename reflects when the report was actually written, not when this prompt was generated). On Linux/macOS:",
    "",
  );
  lines.push("```bash");
  lines.push('STAMP="$(date +"%Y-%m-%d-%H%M")"      # e.g. 2026-04-19-1430');
  lines.push("RAND=\"$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 5)\"");
  lines.push(
    `QUALITY_DIR=${shellSingleQuote(toShellProjectPath(input.projectPath, ".goat-flow/logs/quality"))}`,
  );
  lines.push(`FILE="\${QUALITY_DIR}/\${STAMP}-${input.agent}-\${RAND}.json"`);
  lines.push('mkdir -p "$QUALITY_DIR"');
  lines.push("# (then write the JSON below to $FILE)");
  lines.push("```");
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
    "- If you write the file via a bash heredoc, QUOTE the delimiter (`<<'EOF'`, not `<<EOF`). Unquoted delimiters make the shell interpret `` `backticks` `` as command substitution, which silently eats your inline code references.",
  );
  lines.push("");
  lines.push("**Validate before confirming.** After writing the file, run:");
  lines.push("");
  lines.push("```bash");
  lines.push(
    'goat-flow quality validate "$FILE"   # or: node --import tsx src/cli/cli.ts quality validate "$FILE"',
  );
  lines.push('ls -la "$FILE"');
  lines.push("```");
  lines.push("");
  lines.push(
    "If validate exits non-zero, read the reported error, fix the JSON, and re-write the file. Do NOT emit the confirmation below until validate passes.",
  );
  lines.push("");
  lines.push(
    "If command execution is unavailable, do not claim validation passed. Confirm instead with: `Wrote unvalidated quality report to .goat-flow/logs/quality/<your-filename>.json; validation unavailable: <exact reason>`.",
  );
  lines.push("");
  lines.push(
    "**End of response:** After validate passes, confirm in prose with a single line: `Wrote quality report to .goat-flow/logs/quality/<your-filename>.json`. Do not include the JSON inline in your reply.",
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
