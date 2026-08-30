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
  selectedProjectPath?: string | undefined;
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
 * @param text - raw string to embed in the prompt's JSON example
 * @returns the value as a quoted, escaped JSON string literal
 */
export function jsonString(text: string): string {
  return JSON.stringify(text);
}

/**
 * Render a Bash single-quoted literal so generated snippets do not expand `$` or backticks.
 *
 * @param argument - raw string to quote for a generated shell snippet
 * @returns a single-quoted Bash literal with embedded quotes escaped as `'\''`
 */
export function shellSingleQuote(argument: string): string {
  return `'${argument.replace(/'/g, "'\\''")}'`;
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
    // A user can assess a non-Node or incomplete project; without package metadata the prompt uses the safer consumer scope.
    if (!existsSync(packagePath)) return "consumer";
    const packageMetadata = JSON.parse(readFileSync(packagePath, "utf-8")) as {
      name?: unknown;
    };
    return packageMetadata.name === "@blundergoat/goat-flow"
      ? "framework-self"
      : "consumer";
  } catch {
    // For example, a user may launch Quality while `package.json` is half-written or unreadable; the prompt still opens as a consumer review.
    return "consumer";
  }
}

/**
 * Add setup and agent results to the audit summary shown in a generated quality prompt.
 * Missing scopes add no rows because that audit did not assess them.
 *
 * @param lines - audit-summary line buffer; empty means this helper starts the rendered summary
 * @param report - completed audit report; missing individual scopes are omitted rather than treated as passing
 * @returns nothing; available scope rows and failures are appended to the supplied buffer
 */
function appendScopeSummary(lines: string[], report: AuditReport): void {
  const auditScopes: [string, string][] = [
    ["setup", "GOAT Flow Setup"],
    ["agent", "Agent Setup"],
  ];
  // Show each audit surface in the same order users see it elsewhere in Quality.
  for (const [scopeKey, scopeLabel] of auditScopes) {
    const scopeReport = report.scopes[scopeKey as keyof typeof report.scopes];
    // An audit that skipped this surface contributes no misleading pass or fail row.
    if (!scopeReport) continue;
    const scopeStatusLabel = scopeReport.status === "pass" ? "PASS" : "FAIL";
    lines.push(`- **${scopeLabel}**: ${scopeStatusLabel}`);
    // Every failed check remains visible so the reviewing agent can re-test the exact issue the user encountered.
    for (const failure of scopeReport.failures) {
      lines.push(`  - ${failure.check}: ${failure.message}`);
    }
  }
}

/**
 * Add harness concern scores and evidence limits to the prompt's audit summary.
 * Use only when the audit returned concern facts; otherwise the user sees no invented completeness score.
 *
 * @param lines - audit-summary line buffer; empty means the concern block becomes its first content
 * @param report - completed audit report; absent concerns leave the buffer unchanged
 * @returns nothing; available concern scores and limits are appended to the supplied buffer
 */
function appendConcernSummary(lines: string[], report: AuditReport): void {
  // A setup-only audit has no harness concerns, so its summary ends without an empty section.
  if (!report.concerns) return;
  const concernKeys: AuditConcernKey[] = [
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
  // Keep the five harness concerns in their user-facing scorecard order.
  for (const concernKey of concernKeys) {
    const concern = report.concerns[concernKey];
    // No evidence limits means the score row stays compact; any limitation is shown beside the score it qualifies.
    const evidenceLimitsSuffix =
      concern.limits.length > 0
        ? `; limits: ${concern.limits.join(" | ")}`
        : "";
    lines.push(
      `- ${concernKey}: ${concern.status === "pass" ? "PASS" : "FAIL"} (${concern.score}%; metrics=${concern.metrics}${evidenceLimitsSuffix})`,
    );
  }
}

/**
 * Add template-drift results in deterministic audit order so users can trace generated files that differ from their source templates.
 * A report without drift evidence adds no drift section.
 *
 * @param lines - audit-summary line buffer; empty means the drift block becomes its first content
 * @param report - completed audit report; absent drift evidence leaves the buffer unchanged
 * @returns nothing; the drift status and any findings are appended to the supplied buffer
 */
function appendDriftSummary(lines: string[], report: AuditReport): void {
  // Drift may be disabled for a quick audit, so absence is not rendered as a pass.
  if (!report.drift) return;
  lines.push("");
  lines.push(
    `- **Template Drift**: ${report.drift.status === "pass" ? "PASS" : "FAIL"} (${report.drift.checked} checked)`,
  );
  // Preserve audit order so repeated prompt launches present the same actionable file list.
  for (const finding of report.drift.findings) {
    lines.push(`  - ${finding.path}: ${finding.message}`);
  }
}

/**
 * Add content-lint findings without changing the stable path-and-rule contract a user needs to reproduce them.
 * A report without content evidence adds no content section.
 *
 * @param lines - audit-summary line buffer; empty means the content block becomes its first content
 * @param report - completed audit report; absent content evidence leaves the buffer unchanged
 * @returns nothing; the content status and any findings are appended to the supplied buffer
 */
function appendContentSummary(lines: string[], report: AuditReport): void {
  // Content checks are optional, so missing results must not appear as a clean scan.
  if (!report.content) return;
  lines.push("");
  lines.push(
    `- **Content Claims**: ${report.content.status === "pass" ? "PASS" : "FAIL"} (${report.content.filesScanned} files scanned)`,
  );
  // Keep every finding in audit order so the prompt matches the CLI report the user just ran.
  for (const finding of report.content.findings) {
    // A file-level finding has no line suffix; a line-level finding keeps its exact reproduction location.
    const sourceLineSuffix = finding.line ? `:${finding.line}` : "";
    lines.push(
      `  - ${finding.path}${sourceLineSuffix} [${finding.rule}]: ${finding.message}`,
    );
  }
}

/**
 * Add effective hook coverage so a reviewer sees a broken safety chain that the top-level audit status does not report.
 * The rows nest hook inside selected agent because one shared hook file never proves that every agent registered it, so a per-agent row is the
 * smallest unit that can be true or false on its own.
 *
 * Hook coverage is its own contract: a project can pass every audit scope while a required hook is never invoked, so omitting this block lets a
 * quality assessment certify a harness whose guardrails do not run. The wording matches the CLI and Markdown audit renderers so the same failure
 * reads identically wherever a user meets it.
 *
 * @param lines - audit-summary line buffer; empty means the coverage block becomes its first content
 * @param report - completed audit report; its hook chain is always present because the audit cache rejects an envelope without one
 * @returns nothing; the coverage status, the agents it covers, and any ineffective surfaces are appended to the supplied buffer
 */
function appendHookCoverageSummary(lines: string[], report: AuditReport): void {
  const hookCoverage = report.hookCoverage;
  // An agent-scoped audit and an all-agent audit produce the same sentence, so the scope is stated rather than left to the reader to assume.
  const coveredAgents =
    hookCoverage.selectedAgents.length > 0
      ? `agents covered: ${hookCoverage.selectedAgents.join(", ")}`
      : "no agent surface selected";
  lines.push("");
  lines.push(
    `- **Effective Hook Coverage**: ${hookCoverage.status === "pass" ? "PASS" : "FAIL"} (${hookCoverage.summary.requiredIneffective} required surface(s) ineffective; offline status only; ${coveredAgents})`,
  );
  // Each selected agent keeps its own row because a shared hook file never proves shared provider support.
  for (const hook of hookCoverage.hooks) {
    for (const agentId of hookCoverage.selectedAgents) {
      const agentState = hook.agents[agentId];
      lines.push(
        `  - ${hook.id}/${agentId}: ${agentState.effectiveState.severity.toUpperCase()} - ${agentState.effectiveStateLabel}`,
      );
      // Only a broken link needs repair guidance; a working one would add noise to every passing report.
      if (agentState.effectiveState.status !== "effective") {
        lines.push(`    - ${agentState.repairSummary}`);
        // Provider evidence gaps have no local fix, so no command is invented where the registry supplies none.
        if (agentState.repairCommand !== null) {
          lines.push(`    - Next: \`${agentState.repairCommand}\``);
        }
      }
    }
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
  appendHookCoverageSummary(lines, report);
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
  // A dashboard fast launch without cached evidence is a cache miss, not a failed live audit.
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
  // Fast cache-only mode tells the user no audit was loaded rather than implying an attempted audit failed.
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
  // A cache miss points the user to Re-audit while preserving the distinction from an actual audit failure.
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

/**
 * Rank quality finding severities for the three-item prior-report preview.
 * Lower values appear first in the prompt the user reviews.
 *
 * @param severity - saved finding severity; all three supported values receive a deterministic rank
 * @returns zero for BLOCKER, one for MAJOR, or two for MINOR
 */
function qualityFindingSeverityRank(
  severity: "BLOCKER" | "MAJOR" | "MINOR",
): number {
  // Blockers lead because they can prevent work or create safety risk for the user.
  if (severity === "BLOCKER") return 0;
  // Major findings follow blockers and remain ahead of minor usability weaknesses.
  if (severity === "MAJOR") return 1;
  return 2;
}

/**
 * Return the operator-facing label for a quality prompt mode.
 *
 * @param qualityMode - quality prompt mode being rendered
 * @returns the human-readable label shown to operators (e.g. `Harness Engineering`)
 */
export function qualityModeLabel(qualityMode: QualityMode): string {
  // Process mode is shown as the framework workflow assessment in the CLI and dashboard.
  if (qualityMode === "process") return "Process";
  // Harness mode is labelled as engineering work so users do not confuse it with installation review.
  if (qualityMode === "harness") return "Harness Engineering";
  // Skills mode names the focused skill-quality assessment directly.
  if (qualityMode === "skills") return "Skills";
  return "Agent Installation";
}

/**
 * Describe which workspace or target the selected quality mode should assess.
 *
 * @param qualityMode - quality prompt mode being rendered
 * @returns a sentence naming the workspace or target the mode's assessment covers
 */
export function qualityModeTargetScope(qualityMode: QualityMode): string {
  // Process reviews begin in the controlling workspace and only include an installed target when relevant.
  if (qualityMode === "process") {
    return "controlling goat-flow workspace, plus selected target only when it is a goat-flow installation";
  }
  // Harness reviews inspect the selected project while retaining the controlling workspace as the source of framework behavior.
  if (qualityMode === "harness") {
    return "selected target project harness, interpreted from the controlling workspace";
  }
  // Skills reviews stay on shared workflow definitions and installed mirrors rather than the selected project's product code.
  if (qualityMode === "skills") {
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

/**
 * Check whether prior-report prose names any current policy marker.
 * Used to hide obsolete write-policy findings before a user sees them as current context.
 *
 * @param text - normalized prior-finding prose; empty text cannot match a marker
 * @param markers - policy phrases to find; an empty list produces false
 * @returns true when at least one marker occurs in the text
 */
function containsAnyPolicyMarker(
  text: string,
  markers: readonly string[],
): boolean {
  return markers.some((marker) => text.includes(marker));
}

/**
 * Identify legacy findings that treated allowed local report artifacts as tracked-file writes.
 * Use before showing prior findings so a user is not asked to re-test a superseded contract.
 *
 * @param finding - saved finding whose summary and detail are inspected; both fields are present in the history contract
 * @returns true only when the finding mentions both write policy and an allowed local artifact
 */
function isSupersededLocalArtifactWriteFinding(
  finding: QualityHistoryEntry["report"]["findings"][number],
): boolean {
  const normalizedFindingText =
    `${finding.summary} ${finding.detail}`.toLowerCase();
  const referencesWritePolicy = containsAnyPolicyMarker(
    normalizedFindingText,
    WRITE_POLICY_MARKERS,
  );
  const referencesLocalArtifact = containsAnyPolicyMarker(
    normalizedFindingText,
    LOCAL_ARTIFACT_MARKERS,
  );
  return referencesWritePolicy && referencesLocalArtifact;
}

/**
 * Rewrite a superseded phrase while carrying an otherwise useful prior finding into a new prompt.
 * The user sees current tracked-file language without losing the historical evidence.
 *
 * @param summary - saved finding summary; empty text remains empty
 * @returns summary with legacy no-write wording replaced, or the original text when it contains no legacy phrase
 */
function renderPriorFindingSummary(summary: string): string {
  // Flatten first: the schema caps a summary at 200 characters but permits newlines inside that budget, and this value
  // is rendered as a two-space `  - ` bullet, so an embedded newline would start a sibling list item or a `## ` heading
  // and restructure the section. Mirrors the guard renderPriorRefutationText already applies to its sibling field.
  const flattened = summary.replace(/\s+/gu, " ").trim();
  return (
    flattened
      .replace(/\bstrict no-write\b/gi, "tracked-file write restriction")
      // The row separates its fields with ` | `, so an unescaped pipe would forge a field boundary.
      .replaceAll("|", "\\|")
  );
}

/**
 * Proof limit for the prior-report guards below: flattening and pipe-escaping keep a saved summary inside the bullet
 * that labels it, so it cannot forge a sibling item, a heading, or a field boundary. That is structural containment
 * only - it does not make a prior claim true, and it does not make target-authored text safe to follow as an
 * instruction. Callers keep treating prior findings as claims to re-test.
 */
/** Rationale: three rows, because that matches the finding preview and keeps both history lists equally bounded. */
const PRIOR_REFUTATION_PREVIEW_LIMIT = 3;
/** Rationale: 240 characters, because two short sentences fit in that budget and a longer row would dominate the prompt. */
const PRIOR_REFUTATION_TEXT_LIMIT = 240;

/**
 * Flatten and bound one saved refutation field before it enters a generated prompt.
 * This keeps prior-report context useful without allowing a long historical claim to crowd out the current assessment.
 *
 * @param text - saved claim or exclusion reason; schema validation guarantees non-empty text
 * @returns one prompt-safe line, truncated with an ellipsis when it exceeds the preview limit
 */
function renderPriorRefutationText(text: string): string {
  const flattened = text.replace(/\s+/gu, " ").trim();
  if (flattened.length <= PRIOR_REFUTATION_TEXT_LIMIT) return flattened;
  return `${flattened.slice(0, PRIOR_REFUTATION_TEXT_LIMIT - 1).trimEnd()}…`;
}

/**
 * Escape Markdown table cell content emitted from scorer details.
 *
 * @param cellText - raw cell text that may contain pipes or newlines
 * @returns single-line cell text with `|` escaped and line breaks flattened to spaces
 */
export function markdownTableCell(cellText: string): string {
  return cellText.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
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
  // A saved same-mode report gives the user concrete claims to re-test; null starts a clean baseline instead.
  if (priorReport) {
    // Remove findings whose write-policy premise no longer matches the reporting-only user contract.
    const currentContractFindings = priorReport.report.findings.filter(
      (finding) => !isSupersededLocalArtifactWriteFinding(finding),
    );
    const omittedPriorFindingCount =
      priorReport.report.findings.length - currentContractFindings.length;
    // Count serious prior claims so the new reviewer can compare risk without inheriting their verdict.
    const priorHighSeverityCount = currentContractFindings.filter(
      (finding) =>
        finding.severity === "BLOCKER" || finding.severity === "MAJOR",
    ).length;
    // Show only the three most important prior claims, with deterministic IDs breaking equal-severity ties.
    const priorTopFindings = [...currentContractFindings]
      .sort((left, right) => {
        const severityDiff =
          qualityFindingSeverityRank(left.severity) -
          qualityFindingSeverityRank(right.severity);
        // A more severe claim appears first in the prior-findings preview the user receives.
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
    // Tell the user when obsolete local-artifact claims were intentionally excluded from the new review context.
    if (omittedPriorFindingCount > 0) {
      lines.push(
        `- Omitted ${omittedPriorFindingCount} prior local-artifact write finding(s) that conflict with the current contract: gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes.`,
      );
    }
    lines.push("- Top prior findings by severity:");
    // A prior report with no current-contract findings displays an explicit empty state instead of a blank list.
    if (priorTopFindings.length === 0) {
      lines.push("  - none after applying the current local-artifact contract");
    } else {
      // Each retained claim stays visible with its stable ID, severity, type, and current-contract summary.
      for (const finding of priorTopFindings) {
        lines.push(
          `  - \`${finding.id}\` | ${finding.severity} | ${finding.type} | ${renderPriorFindingSummary(finding.summary)}`,
        );
      }
    }
    const priorRefutations = priorReport.report.refuted_candidates.slice(
      0,
      PRIOR_REFUTATION_PREVIEW_LIMIT,
    );
    lines.push(
      "- Prior refuted candidates (do not repeat unless evidence or contract changed):",
    );
    if (priorRefutations.length === 0) {
      lines.push("  - none recorded");
    } else {
      for (const candidate of priorRefutations) {
        lines.push(
          `  - ${renderPriorRefutationText(candidate.claim)} — ${renderPriorRefutationText(candidate.why_excluded)}`,
        );
      }
    }
    const omittedPriorRefutationCount =
      priorReport.report.refuted_candidates.length - priorRefutations.length;
    if (omittedPriorRefutationCount > 0) {
      lines.push(
        `  - ${omittedPriorRefutationCount} additional prior refuted candidate(s) omitted from this bounded preview.`,
      );
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
    // Agent-setup copy reads naturally without a mode prefix; focused modes name which prior report is absent.
    const qualityModePrefix =
      qualityMode === "agent-setup" ? "" : `${qualityMode} `;
    lines.push(
      `No prior same-agent ${qualityModePrefix}quality report exists for this project.`,
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
 * @param auditReport - completed audit evidence used for task targeting; null keeps the selector's original ranking
 * @returns the context block, or an empty string when this mode or project contributes none
 */
export function renderBoundedLearningLoopContext(
  sharedFacts: SharedFacts | null | undefined,
  qualityMode: QualityMode,
  auditReport: AuditReport | null = null,
): string {
  // A project without extracted learning facts adds no empty context block to the prompt the user launches.
  if (!sharedFacts) return "";
  // Process and skills reviews do not consume this pilot, so those focused prompts retain their existing output.
  if (qualityMode !== "agent-setup" && qualityMode !== "harness") return "";
  const surface =
    qualityMode === "harness" ? "quality-harness" : "quality-agent-setup";
  return renderLearningLoopContext(
    selectLearningLoopContext(sharedFacts, {
      surface,
      taskSignals: qualityLearningLoopTaskSignals(auditReport, qualityMode),
    }),
  );
}

/** Add non-empty audit text to the ephemeral retrieval input in report order. */
function appendConcreteAuditSignals(
  concreteSignals: string[],
  candidateSignals: readonly (string | undefined)[],
): void {
  for (const signal of candidateSignals) {
    const trimmedSignal = signal?.trim();
    // Blank optional fields cannot identify the user's task, so they are excluded before stable de-duplication.
    if (trimmedSignal) concreteSignals.push(trimmedSignal);
  }
}

/** Add signals from failed setup, agent, and harness checks without promoting passing evidence. */
function appendFailedAuditCheckSignals(
  concreteSignals: string[],
  auditReport: AuditReport,
): void {
  // Setup, agent, and harness failures stay in report order so repeated launches explain matches consistently.
  for (const scope of [
    auditReport.scopes.setup,
    auditReport.scopes.agent,
    auditReport.scopes.harness,
  ]) {
    // A scope without checks behaves like an empty list, while each available failed check can target a prior incident.
    for (const check of scope?.checks ?? []) {
      // Passing checks do not describe work the user needs help with, so they cannot influence retrieval.
      if (check.status !== "fail") continue;
      appendConcreteAuditSignals(concreteSignals, [
        check.id,
        check.name,
        check.failure?.check,
        check.failure?.message,
        check.failure?.evidence,
        check.failure?.howToFix,
      ]);
    }
  }
}

/** Add audit finding signals; stable order keeps drift before content and preserves order within each group. */
function appendAuditFindingSignals(
  concreteSignals: string[],
  auditReport: AuditReport,
): void {
  // Drift findings target prior incidents by changed generated path or audit message.
  for (const finding of auditReport.drift?.findings ?? []) {
    appendConcreteAuditSignals(concreteSignals, [
      finding.path,
      finding.message,
    ]);
  }
  // Content findings add their rule, path, message, and suggested correction in report order.
  for (const finding of auditReport.content?.findings ?? []) {
    appendConcreteAuditSignals(concreteSignals, [
      finding.rule,
      finding.path,
      finding.message,
      finding.suggestion,
    ]);
  }
}

/**
 * Collect concrete, audit-owned retrieval signals without accepting or storing user task prose.
 *
 * A quality mode is only added when a failed check or finding supplies a concrete check, path, or failure class. A generic mode label by itself
 * deliberately leaves retrieval on its original ranking.
 *
 * @param auditReport - deterministic audit evidence already rendered elsewhere in the quality prompt
 * @param qualityMode - controlled prompt mode used only as supporting context for concrete evidence
 * @returns ephemeral signal strings in report order; empty when the audit has no targeted work
 */
function qualityLearningLoopTaskSignals(
  auditReport: AuditReport | null,
  qualityMode: QualityMode,
): string[] {
  // Without audit evidence there is no grounded user problem to target, so selection keeps its original ranking.
  if (!auditReport) return [];
  const concreteSignals: string[] = [];
  appendFailedAuditCheckSignals(concreteSignals, auditReport);
  appendAuditFindingSignals(concreteSignals, auditReport);

  // A clean or evidence-free audit keeps prompt bytes and ranking identical to the non-targeted baseline.
  if (concreteSignals.length === 0) return [];
  return [qualityMode, ...new Set(concreteSignals)];
}
