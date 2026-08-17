/**
 * Shared building blocks for composing agent quality-review prompts.
 *
 * Collects the cross-mode helpers the per-mode composers reuse: shell/JSON/date escaping for embedded snippets, project-path shaping that survives
 * Windows and UNC roots, audit-summary rendering, prior-report delta context, bounded learning-loop context, and the focused JSON-report contract
 * appended to the end of every prompt.
 *
 * Pure string assembly; the only I/O is the `package.json` read behind `inferQualityScope`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentId, SharedFacts } from "../types.js";
import type { AuditConcernKey, AuditReport } from "../audit/types.js";
import type { QualityHistoryEntry } from "../quality/history.js";
import type { QualityMode } from "../quality/schema.js";
import {
  renderLearningLoopContext,
  selectLearningLoopContext,
} from "./learning-loop-context.js";

/**
 * Public input contract for composing one project quality-review prompt.
 * Optional evidence stays absent rather than being synthesized, so every surface renders the same facts.
 */
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
  /** Report persistence contract; defaults to the bounded stdin saver. */
  persistence?: QualityPersistenceVariant | undefined;
}

/**
 * How the generated prompt tells the agent to persist its report.
 *
 * `bounded-saver` = the agent pipes the report into `quality save` itself (manual and Codex runs).
 * `staged-draft` = the agent writes one draft file and the dashboard server persists it (enforced Claude reporting sessions, per ADR-044, where no
 * Bash rule can authorize the heredoc saver).
 */
export type QualityPersistenceVariant = "bounded-saver" | "staged-draft";

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
export function jsonString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Render a Bash single-quoted literal so generated snippets do not expand `$` or backticks.
 *
 * @param value - raw string to quote for a generated shell snippet
 * @returns a single-quoted Bash literal with embedded quotes escaped as `'\''`
 */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Infer the report scope from package metadata; recover as consumer when metadata is unreadable.
 *
 * @param projectPath - project root whose `package.json` name field is inspected
 * @returns `framework-self` when the package is `@blundergoat/goat-flow`, otherwise `consumer`
 *   (also `consumer` when `package.json` is missing or unparseable)
 */
export function inferQualityScope(
  projectPath: string,
): "framework-self" | "consumer" {
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

/** Append template-drift findings in their deterministic audit order when evidence exists. */
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

/** Append content-lint findings without changing the audit report's stable path and rule identity. */
function appendContentSummary(lines: string[], report: AuditReport): void {
  if (!report.content) return;
  lines.push("");
  lines.push(
    `- **Content Claims**: ${report.content.status === "pass" ? "PASS" : "FAIL"} (${report.content.filesScanned} files scanned)`,
  );
  for (const finding of report.content.findings) {
    const lineSuffix = finding.line ? `:${finding.line}` : "";
    lines.push(
      `  - ${finding.path}${lineSuffix} [${finding.rule}]: ${finding.message}`,
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
      '> The pre-filled `audit_status: "unavailable"` is a placeholder superseded by any live audit completed during this assessment.',
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

/**
 * Render prior findings and continuity instructions for a quality prompt.
 * The continuity contract keeps prior claims provisional and never treats absence as proof of a fix.
 *
 * @param priorReport - selected same-mode report; null produces no-prior guidance
 * @param qualityMode - active mode used to describe a missing prior report
 * @returns Markdown context block ready for prompt composition
 */
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
      "A prior finding is a claim to re-test, not a fact. Validate its premise (who the violated standard binds, whether an accepted ADR already resolves it, whether the code still shows it) before carrying it forward; a prior severity is not evidence.",
    );
    lines.push(
      'For the final JSON block in THIS run, use `delta_tag: "persisted"` when a current finding materially matches a prior finding by type/file/line. Use `delta_tag: "new"` when it does not. Do NOT emit `absent` in current findings - absence is derived later by `goat-flow quality diff` when a prior finding id disappears from a later run, and it is not proof that the issue was resolved.',
    );
    lines.push(
      `Set top-level \`prior_report_id\` to \`${priorReport.id}\` so readers can tell that \`delta_tag: "new"\` means newly discovered relative to that same-agent report, not necessarily newly introduced in the codebase.`,
    );
    lines.push(
      'When a prior finding cannot be re-tested, do not carry the unverified claim into the current findings array solely to keep it visible and do not assign it `delta_tag: "persisted"`. List it under `What You Did Not Verify`, include the literal denied or unavailable probe, and state that omission is not verified resolution; the diff\'s derived `absent` bucket means absent from the later report, not proven fixed.',
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

/**
 * Render the slice of a project's learning loop that belongs in a quality prompt, bounded so it cannot crowd out the assessment itself.
 *
 * Only agent-setup and harness modes include it, because those are the assessments where the user's own recorded footguns and lessons
 * change the answer; the focused modes would just be paying context cost for it.
 *
 * @param sharedFacts - project facts holding the learning loop; null or undefined means the project has none to include
 * @param qualityMode - selected mode; any mode outside agent-setup and harness deliberately renders nothing
 * @returns the context block, or an empty string when this mode or project contributes none
 */
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
