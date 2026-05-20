/**
 * Composes a structured quality-assessment prompt for a selected agent.
 * Embeds live audit results when available.
 */
import type { AgentId, SharedFacts } from "../types.js";
import type { AuditReport, AuditConcernKey } from "../audit/types.js";
import type { QualityHistoryEntry } from "../quality/history.js";
import { loadManifest } from "../manifest/manifest.js";
import { getAgentProfile } from "../agents/registry.js";
import { getPackageVersion } from "../paths.js";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { QUALITY_REPORT_KIND, type QualityMode } from "../quality/schema.js";
import type { SkillQualityReport } from "../quality/skill-quality.js";
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
 */
function toShellProjectPath(projectPath: string, sub: string): string {
  const normalized = projectPath.replace(/\\/g, "/");
  const isUnc = normalized.startsWith("//");
  const joined = posix.join(normalized, sub);
  return isUnc && !joined.startsWith("//") ? "/" + joined : joined;
}

interface QualityInput {
  agent: AgentId;
  projectPath: string;
  auditReport: AuditReport | null;
  auditUnavailableReason?: AuditUnavailableReason;
  priorReport?: QualityHistoryEntry | null;
  qualityMode?: QualityMode;
  selectedProjectPath?: string;
  runDate?: string;
  sharedFacts?: SharedFacts | null;
}

type AuditUnavailableReason = "audit-failed" | "fast-cache-only";

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

/** Render a Bash single-quoted literal so generated snippets do not expand `$` or backticks. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Infer the report scope from the project package metadata. */
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

  return lines.join("\n");
}

/** Render the summary text returned when no audit report is embedded. */
function renderAuditUnavailableSummary(reason: AuditUnavailableReason): string {
  if (reason === "fast-cache-only") {
    return "Audit data not loaded (fast cache-only mode had no cached report).";
  }
  return "Audit data unavailable (audit could not complete).";
}

/** Render the heading used when no audit report is embedded. */
function renderAuditUnavailableHeading(reason: AuditUnavailableReason): string {
  if (reason === "fast-cache-only") {
    return "**Audit: NOT LOADED (FAST CACHE-ONLY MODE)**";
  }
  return "**Audit: UNAVAILABLE**";
}

/** Render the fallback note used when audit data is unavailable. */
function renderDegradedNote(reason: AuditUnavailableReason): string {
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

function qualityModeLabel(mode: QualityMode): string {
  if (mode === "process") return "Process";
  if (mode === "harness") return "Harness Engineering";
  if (mode === "skills") return "Skills";
  return "Agent Installation";
}

function qualityModeTargetScope(mode: QualityMode): string {
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

function focusedQualityModePrompt(
  mode: Exclude<QualityMode, "agent-setup">,
  agent?: AgentId,
) {
  if (mode === "process") {
    const agentAuditCmd = agent
      ? `node --import tsx src/cli/cli.ts audit . --agent ${agent} --harness --check-drift --format json`
      : "node --import tsx src/cli/cli.ts audit . --check-drift --format json";
    return [
      "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. Do not use /goat-review or any goat skill as the wrapper for this assessment; this prompt is the full assessment contract. You may read files, run read-only validation commands, and write normal gitignored reporting/local-state artifacts if the runner requires them. In this contract, gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes; do not report them as read-only violations.",
      "",
      "Assess the goat-flow framework process in the controlling workspace: instruction files, .goat-flow/config.yaml, .goat-flow/architecture.md, .goat-flow/code-map.md, .goat-flow/skill-reference/, .goat-flow/skill-playbooks/, workflow/setup/, workflow/manifest.json, installed skill mirrors, hooks, quality prompt modes, and validation scripts.",
      "",
      `Grounding commands to run or explicitly mark skipped: git status --short --untracked-files=all; node --import tsx src/cli/cli.ts stats . --check; ${agentAuditCmd}; node --import tsx src/cli/cli.ts audit . --check-content --format json; bash scripts/preflight-checks.sh. Command output wins over prose.`,
      "",
      "Use grep-first retrieval for .goat-flow/footguns/, .goat-flow/lessons/, and .goat-flow/decisions/. Do not broad-load those directories.",
      "",
      "Assessment checklist: Pre-check Results; Findings ordered by severity; What works; What is weak or ceremonial; Contradictions and false paths; Top 5 improvements; What was not verified. Use this checklist to decide the saved JSON scores and findings. Each saved finding's detail/evidence fields must include action type, exact file or semantic-anchor evidence, why it matters, and a verification command that would prove the fix.",
    ].join("\n");
  }

  if (mode === "skills") {
    return [
      "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. Do not use /goat-critique, /goat-review, or any other goat skill as the wrapper for this assessment; this prompt is the full assessment contract. You may read files, run read-only commands, and write normal gitignored reporting/local-state artifacts if the runner requires them. In this contract, gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes; do not report them as read-only violations.",
      "",
      "Assess all seven goat-flow skills: /goat, /goat-debug, /goat-plan, /goat-review, /goat-critique, /goat-security, and /goat-qa. Use .goat-flow/skill-playbooks/skill-quality-testing.md plus the relevant files under .goat-flow/skill-playbooks/skill-quality-testing/. Read the workflow template SKILL.md files and installed mirrors under .claude/skills/, .agents/skills/, and .github/skills/ where relevant.",
      "",
      "Method rule: prefer live skill invocation only when the runner supports it safely. If live invocation or delegated/sub-agent calls are unavailable, perform a file-grounded protocol run against SKILL.md and label the evidence limit. Never imply a dry run is bulletproof TDD evidence.",
      "",
      "For each skill, output exactly these fields: Method used; Evidence limit; Worked; Failed/confusing; Useless ceremony; RED scenario; GREEN result; minimal REFACTOR; Verification command or grep that would prove the fix. Do not stop after one skill and do not ask which skill.",
      "",
      "After the seven sections, output: Cross-skill patterns; Top 5 skill/system improvements with file or semantic-anchor evidence and expected impact; What was not tested. Prioritize actionable improvements over praise.",
    ].join("\n");
  }

  return [
    "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. Do not use /goat-review or any goat skill as the wrapper for this assessment; this prompt is the full assessment contract. You may read files, run read-only validation commands, and write normal gitignored reporting/local-state artifacts if the runner requires them. In this contract, gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes; do not report them as read-only violations.",
    "",
    "Assess whether the selected target project's agent harness is actually usable, not only structurally present. Focus on context loading, constraint safety, verification evidence, recovery paths, feedback-loop durability, and whether instructions distinguish the controlling goat-flow workspace from the selected target.",
    "",
    "Grounding commands to run or explicitly mark skipped: git status --short --untracked-files=all; node --import tsx src/cli/cli.ts audit . --harness --format json from the controlling workspace when applicable; node --import tsx src/cli/cli.ts stats . --check when the selected target is a goat-flow installation. Command output wins over prose.",
    "",
    "Read next: target instruction files, local agent settings/hooks, .goat-flow/config.yaml when present, .goat-flow/skill-reference/ and .goat-flow/skill-playbooks/ when present, controlling-workspace harness code under src/cli/audit/harness/, and any dashboard terminal/runner context text that affects selected-target execution.",
    "",
    "Output sections: Harness Scorecard; Findings ordered by severity; Concern-by-concern analysis; False positive and false negative risks; Top 5 improvements; What was not verified. For each deterministic harness concern (Context, Constraints, Verification, Recovery, Feedback Loop), state what works, what fails or is weak, exact file or semantic-anchor evidence, and a verification command that would prove the fix.",
    "",
    "Do not treat a structural PASS as quality PASS. If a score or check claims completeness, verify what behavior it actually proves.",
  ].join("\n");
}

const WRITE_POLICY_MARKERS = ["write", "no-write", "read-only"] as const;
const LOCAL_ARTIFACT_MARKERS = [
  "gitignored",
  "local artifact",
  "local-state",
  ".goat-flow/logs",
  ".goat-flow/tasks",
  "critique snapshot",
  "scratchpad",
  "quality report",
  "session log",
  "task-local",
] as const;

// M07: quality prompts may request semantic anchors for durable follow-up, but
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

function renderPriorFindingSummary(summary: string): string {
  return summary.replace(
    /\bstrict no-write\b/gi,
    "tracked-file write restriction",
  );
}

/** Escape Markdown table cell content emitted from scorer details. */
function markdownTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function renderPriorReportContext(
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

function renderBoundedLearningLoopContext(
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

function appendFocusedReportContract(
  lines: string[],
  input: {
    agent: AgentId;
    projectPath: string;
    auditStatus: QualityPayload["auditStatus"];
    qualityMode: QualityMode;
    priorReport: QualityHistoryEntry | null;
    runDate: string;
  },
): void {
  lines.push("---");
  lines.push("");
  lines.push("### Write the JSON report");
  lines.push("");
  lines.push(
    "Do **not** emit the JSON as a fenced block in your reply. Write it as a file to `.goat-flow/logs/quality/` - that path is gitignored and expected. No tracked-file writes or implementation edits are permitted.",
  );
  lines.push("");
  lines.push("**Filename format:** `YYYY-MM-DD-HHMM-<agent>-<rand5>.json`");
  lines.push("");
  lines.push("```bash");
  lines.push('STAMP="$(date +"%Y-%m-%d-%H%M")"');
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
  lines.push(
    `    { "type": "framework_flaw", "severity": "MAJOR", "file": ".goat-flow/architecture.md", "line": null, "summary": "One-line finding summary", "detail": "Why it matters", "evidence_quality": "OBSERVED", "evidence_method": "static-analysis", "delta_tag": ${input.priorReport ? '"new"' : "null"} }`,
  );
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
    "- `evidence_quality` is REQUIRED on every finding. Allowed values: `OBSERVED` or `INFERRED`.",
  );
  lines.push(
    "- `evidence_method` is REQUIRED on every finding. Allowed values: `runtime-probe`, `static-analysis`, or `mixed`.",
  );
  lines.push(
    "- Runtime-backed findings SHOULD include compact evidence fields when useful: `evidence_command`, `evidence_exit_code`, `evidence_summary`, `evidence_warning_count`, and `evidence_excerpt`. Keep these single-line and concise; do not paste raw terminal blocks.",
  );
  lines.push(
    `- \`quality_mode\` is REQUIRED for new reports generated from this prompt. Use \`${jsonString(input.qualityMode)}\` for this ${qualityModeLabel(input.qualityMode)} assessment.`,
  );
  lines.push(
    `- \`prior_report_id\` must be ${input.priorReport ? `\`${input.priorReport.id}\`` : "`null`"} for this run. This makes \`delta_tag\` traceable to the same-agent baseline.`,
  );
  if (input.priorReport) {
    lines.push(
      '- `delta_tag` is REQUIRED on every current finding and must be either `"new"` or `"persisted"`.',
    );
  } else {
    lines.push(
      "- `delta_tag` must be `null` or omitted when no prior report context exists.",
    );
  }
  lines.push("- Do NOT include an `id` field.");
  lines.push(
    "- Do NOT include extra top-level keys or extra finding keys outside this contract.",
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
    "**End of response:** After validate passes, confirm in prose with a single line: `Wrote quality report to .goat-flow/logs/quality/<your-filename>.json`. Do not include the JSON inline in your reply.",
  );
}

function composeFocusedQuality(
  input: QualityInput,
  qualityMode: Exclude<QualityMode, "agent-setup">,
): QualityPayload {
  const {
    agent,
    projectPath,
    auditReport,
    priorReport = null,
    selectedProjectPath,
    runDate = formatLocalDate(),
  } = input;
  const profile = getAgentProfile(agent);
  const auditStatus: QualityPayload["auditStatus"] = auditReport
    ? auditReport.status
    : "unavailable";
  const label = qualityModeLabel(qualityMode);
  const lines: string[] = [];

  lines.push(`# GOAT Flow ${label} Assessment - ${profile.name}`);
  lines.push("");
  lines.push(focusedQualityModePrompt(qualityMode, agent));
  lines.push("");
  lines.push("Quality mode scope:");
  lines.push(`- Mode: ${label}`);
  lines.push(`- Project path: \`${projectPath}\``);
  if (selectedProjectPath && selectedProjectPath !== projectPath) {
    lines.push(`- Selected target project: \`${selectedProjectPath}\``);
  }
  lines.push(`- Scope rule: ${qualityModeTargetScope(qualityMode)}`);
  lines.push(`- Selected quality target agent: ${agent}`);
  lines.push(
    "- Keep this assessment read-only unless the user explicitly asks for edits.",
  );
  lines.push("");
  lines.push(renderPriorReportContext(priorReport, qualityMode));
  lines.push("");
  const learningLoopContext = renderBoundedLearningLoopContext(
    input.sharedFacts,
    qualityMode,
  );
  if (learningLoopContext) {
    lines.push(learningLoopContext);
    lines.push("");
  }
  appendFocusedReportContract(lines, {
    agent,
    projectPath,
    auditStatus,
    qualityMode,
    priorReport,
    runDate,
  });

  return {
    command: "quality",
    agent,
    auditStatus,
    auditSummary: `${label}: ${qualityModeTargetScope(qualityMode)}`,
    prompt: lines.join("\n"),
  };
}

/** Render the per-subtype Examples dimension criteria for the Semantic
 *  Dimensions section. Playbook/index subtypes weight Examples higher; meta
 *  subtype permits an explicit `n/a` with justification. */
function renderExamplesDimensionCriteria(subtype: string): string[] {
  const lines: string[] = [];
  lines.push(
    "  - Are examples concrete (real values, real expected output) or hypothetical placeholders?",
  );
  lines.push("  - Do examples show edge cases, not just the happy path?");
  lines.push(
    "  - Are BAD/GOOD pairs, labelled counter-examples, or expected-output annotations present where the artifact enforces a convention?",
  );
  if (subtype === "workflow") {
    lines.push(
      "  - Workflow subtype: is at least one full phase walked through with real artifacts (file path + action + expected outcome)?",
    );
  } else if (subtype === "playbook" || subtype === "index") {
    lines.push(
      `  - **${subtype} subtype: weight Examples HIGHER.** Playbooks and indexes live or die by examples; treat thin example coverage as a deduction even if other dimensions are strong.`,
    );
  } else if (subtype === "meta") {
    lines.push(
      "  - Meta subtype: Examples may legitimately be `n/a`. If you mark it n/a, justify why (the artifact is a contract loaded by skills, not a procedure that needs runnable examples) and exclude it from `semanticMax`.",
    );
  }
  return lines;
}

function appendComposedFromInstruction(
  lines: string[],
  report: SkillQualityReport,
  kindLower: string,
): void {
  const { artifact, composedFrom } = report;
  if (composedFrom.length === 0) {
    lines.push(
      `Assess the ${kindLower} artifact at \`${artifact.path}\`. The engine composed no additional files (single-file scoring path); read this file in full before scoring.`,
    );
    return;
  }
  const exampleReferenced =
    composedFrom.find((s) => s.startsWith("references/")) ??
    composedFrom.find((s) => s !== artifact.name && !/^SKILL\.md$/i.test(s)) ??
    composedFrom[composedFrom.length - 1];
  const exampleClause = exampleReferenced
    ? ` Structural signals from referenced files count toward your assessment: content documented in \`${exampleReferenced}\` is part of the ${kindLower}, not bonus material.`
    : "";
  lines.push(
    `Assess the ${kindLower} **${artifact.name}**. Read every file in **Composed from** below — the engine composes ${composedFrom.length} file${composedFrom.length === 1 ? "" : "s"} into the runtime surface (\`${composedFrom.join("`, `")}\`).${exampleClause}`,
  );
  lines.push("");
  lines.push(
    'If a `composition truncated` fit note appears below, the composed bundle is incomplete. Read the actual files listed in **Composed from** directly when context allows; otherwise note the skipped files in the final "What was not verified" section.',
  );
}

/** Compose a focused quality prompt for a single skill or reference artifact.
 *  After M09, the prompt requires four scored semantic dimensions, an
 *  anti-bias preamble, an explicit per-file `composedFrom` reading
 *  instruction, a focus/scope probe, a final gate decision, and a fenced JSON
 *  block summarising the verdict. */
export function composeArtifactQualityPrompt(
  report: SkillQualityReport,
): string {
  const {
    artifact,
    totalScore,
    maxTotalScore,
    subtype,
    recommendation,
    metrics,
    composedFrom,
    fitNotes,
  } = report;
  const kindLabel = artifact.kind === "skill" ? "Skill" : "Shared Reference";
  const kindLower = kindLabel.toLowerCase();
  const pct =
    maxTotalScore > 0 ? Math.round((totalScore / maxTotalScore) * 100) : 0;

  const lines: string[] = [];
  lines.push(`# ${kindLabel} Quality Review: ${artifact.name}`);
  lines.push("");
  lines.push(
    "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. This prompt is the full assessment contract. You may read files and run read-only commands.",
  );
  lines.push("");
  appendComposedFromInstruction(lines, report, kindLower);
  lines.push("");

  lines.push("## Deterministic Baseline");
  lines.push("");
  lines.push(`- **Artifact:** ${artifact.name} (${kindLabel})`);
  lines.push(`- **Path:** \`${artifact.path}\``);
  lines.push(`- **Subtype:** ${subtype}`);
  if (report.shapeMismatch) {
    lines.push(
      `- **Detected shape:** ${report.detectedShape} (${Math.round(report.shapeConfidence * 100)}% confidence)`,
    );
  }
  lines.push(`- **Score:** ${totalScore}/${maxTotalScore} (${pct}%)`);
  lines.push(`- **Recommendation:** ${recommendation}`);
  if (composedFrom.length > 0) {
    lines.push(`- **Composed from:** ${composedFrom.join(", ")}`);
  }
  lines.push("");

  lines.push("### Metric Breakdown");
  lines.push("");
  lines.push("| Metric | Score | Severity | Detail |");
  lines.push("|--------|-------|----------|--------|");
  for (const m of metrics) {
    lines.push(
      `| ${markdownTableCell(m.label)} | ${m.score}/${m.maxScore} | ${m.severity} | ${markdownTableCell(m.detail)} |`,
    );
  }
  lines.push("");

  if (fitNotes.length > 0) {
    lines.push("### Fit Notes");
    lines.push("");
    for (const note of fitNotes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  lines.push("## Anti-Bias Guidance");
  lines.push("");
  lines.push(
    'Score against absolute criteria, not relative to other artifacts you have reviewed. Do not let one strong dimension halo over a weak one — score each dimension independently. Recent sections of the file should not weigh more than earlier ones; read everything before scoring. If you are tempted to round up because the artifact "seems okay," round down — leniency is the most common failure mode of this rubric.',
  );
  lines.push("");

  lines.push("## Semantic Dimensions");
  lines.push("");
  lines.push(
    'Score each applicable dimension on a 1-5 scale. For every dimension provide: (a) the score, (b) one sentence of evidence, (c) the lowest-quality span supporting any deduction, cited as `path/file (search: "semantic-anchor")`. If a dimension is legitimately `n/a` for this subtype, mark it `n/a`, justify why, and exclude it from `semanticMax`.',
  );
  lines.push("");
  lines.push("- **Clarity (1-5)** — instruction precision, imperative voice,");
  lines.push(
    "  ambiguity, technical-term grounding. Can a fresh reader execute the workflow without guessing?",
  );
  lines.push("- **Examples (1-5)** —");
  for (const line of renderExamplesDimensionCriteria(subtype)) {
    lines.push(line);
  }
  lines.push(
    '- **Focus (1-5)** — single purpose vs kitchen-sink. Apply the "describe in one sentence" test: if the artifact\'s purpose needs three clauses joined by AND, focus is weak.',
  );
  lines.push(
    "- **Coherence (1-5)** — does the bundle (SKILL.md + references) tell one coherent story, or do parts contradict, drift, or duplicate?",
  );
  lines.push("");
  lines.push(
    "Compute `semanticTotal`, `semanticMax` (default `/20` across the four dimensions; subtract any `n/a` dimension's max), and `semanticPct = semanticTotal / semanticMax`.",
  );
  lines.push("");

  lines.push("## Your Assessment");
  lines.push("");
  lines.push(
    "After the structured semantic scoring above, deepen the assessment with these questions:",
  );
  lines.push("");
  lines.push(
    `1. **Classification challenge:** Is \`${recommendation}\` the right recommendation? If the artifact is currently a ${kindLower}, should it be reclassified? Provide evidence.`,
  );
  lines.push(
    "2. **Metric verification:** For each metric scored below max, is the deduction justified? Are there structural signals the static scorer missed?",
  );
  lines.push(
    "3. **Quality gaps:** What quality issues exist that the deterministic metrics do not capture (e.g., misleading instructions, outdated references, unclear boundaries)?",
  );
  lines.push(
    "4. **Top 3 improvements:** Actionable changes with file path and semantic anchor evidence. **Each improvement must cite the dimension it addresses; if a deduction has no improvement listed, that is itself a finding.**",
  );
  lines.push(
    "5. **What was not verified:** State any aspects you could not assess from a file read.",
  );
  lines.push(
    '6. **Scope check:** Write a one-sentence summary of what this artifact does. If you cannot, that is a Clarity finding (record in semantic dimensions). If your sentence describes 3+ distinct concerns ("formats code AND evaluates it AND documents it"), recommend splitting and propose the boundaries. Note: this answers "is the scope right within the assigned subtype?" — distinct from the structural `consider-reclassifying` recommendation, which answers "is the subtype right?"',
  );
  lines.push("");

  lines.push("## Final Gate");
  lines.push("");
  lines.push(
    "Return one of `ship` / `revise` / `block` based on the deterministic recommendation, the semantic percentage, and per-dimension floors:",
  );
  lines.push("");
  lines.push(
    "- **ship** — deterministic recommendation is `keep-skill` OR `reference-playbook`, AND `semanticPct >= 0.8`, AND no applicable dimension scores below 3.",
  );
  lines.push(
    "- **revise** — deterministic recommendation is `keep-skill` / `reference-playbook` AND (`semanticPct < 0.8` OR any applicable dimension < 3); OR deterministic recommendation is `consider-revision` AND `semanticPct >= 0.5` AND no applicable dimension equals 1.",
  );
  lines.push(
    "- **block** — deterministic recommendation is `needs-human-review` / `retire` / `consider-reclassifying`; OR `semanticPct < 0.5`; OR any applicable dimension equals 1.",
  );
  lines.push("");
  lines.push(
    "The deterministic recommendation is the structural floor. You may override it (e.g. gate `block` when the engine said `keep-skill`) only with explicit reasoning that cites specific evidence the engine missed.",
  );
  lines.push("");

  lines.push("## Required JSON Verdict");
  lines.push("");
  lines.push(
    "End your response with a fenced ```json``` block matching this schema. The block must be the final content; the dashboard parses it best-effort.",
  );
  lines.push("");
  lines.push("```json");
  lines.push("{");
  lines.push('  "semanticScores": {');
  lines.push('    "clarity": 4,');
  lines.push('    "examples": 3,');
  lines.push('    "focus": 5,');
  lines.push('    "coherence": 4,');
  lines.push('    "total": 16,');
  lines.push('    "max": 20');
  lines.push("  },");
  lines.push('  "gateDecision": "revise",');
  lines.push(
    '  "gateRationale": "Examples score 3/5; only one realistic scenario shown.",',
  );
  lines.push('  "blockers": [],');
  lines.push('  "improvements": [');
  lines.push("    {");
  lines.push('      "dimension": "examples",');
  lines.push('      "priority": "high",');
  lines.push(
    '      "action": "Add 2 concrete scenarios showing expected output for the ambiguous-input case (cite file + semantic anchor)."',
  );
  lines.push("    }");
  lines.push("  ]");
  lines.push("}");
  lines.push("```");

  return lines.join("\n");
}

/** Compose the quality review prompt. */
// eslint-disable-next-line complexity -- prompt assembly branches on audit availability and split hook-config surfaces
export function composeQuality(input: QualityInput): QualityPayload {
  const {
    agent,
    projectPath,
    auditReport,
    auditUnavailableReason = "audit-failed",
    priorReport = null,
    qualityMode = "agent-setup",
    runDate = formatLocalDate(),
  } = input;

  if (qualityMode !== "agent-setup") {
    return composeFocusedQuality(input, qualityMode);
  }

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
    : renderAuditUnavailableSummary(auditUnavailableReason);

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
    "REPORTING-ONLY ASSESSMENT MODE. Do NOT edit, create, rename, move, or delete any tracked files. Do NOT apply patches or implement fixes. Do NOT use /goat-review or any goat skill as the wrapper for this assessment; this prompt is the full assessment contract. Gitignored local artifacts written by validation tools or normal reporting workflows (e.g. `dist/`, `node_modules/`, `.claude/worktrees/`, `.goat-flow/logs/**`, `.goat-flow/scratchpad/**`, `.goat-flow/tasks/**`) are fine - they don't change the repo's committed state and do not count as writes for this assessment contract. This prompt also instructs you to write your final JSON report to `.goat-flow/logs/quality/<filename>.json`.",
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
    "5. **Shared meta references** (under `.goat-flow/skill-reference/`) - skill-preamble.md (loaded every skill invocation), skill-conventions.md (loaded on full-depth). **Standalone playbooks** (under `.goat-flow/skill-playbooks/`) - browser-use.md and page-capture.md for browser evidence capture, skill-quality-testing.md index plus skill-quality-testing/tdd-iteration.md, skill-quality-testing/adversarial-framing.md, and skill-quality-testing/deployment.md (full-depth authoring methodology split across an index and three topical files per ADR-023; load the topical file matching your skill type).",
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
    '- Session logs (`.goat-flow/logs/sessions/*.md`), critique snapshots (`.goat-flow/logs/critiques/*.md`), scratchpad notes, and task/milestone files (`.goat-flow/tasks/`, scoped by the `.goat-flow/tasks/.active` marker - see ADR-017) are **intentionally gitignored**. They are local workspace artifacts, not committed content. This is by design - session logs should never be in version control. If the instruction file\'s DoD references session logs, it means "write them locally for the current agent\'s continuity," not "commit them." When evaluating skills, do NOT flag writes to these gitignored paths as a design flaw or write-safety violation - a skill writing to `.goat-flow/logs/` or `.goat-flow/tasks/` is normal working-state behavior.',
  );
  lines.push(
    "- `.goat-flow/tasks/.active` is an advisory local pointer, not a setup invariant. Missing `.active`, or `.active` naming a missing subdir, is normal local churn when work completes, users switch projects, or a project does not use goat-flow task files. Do NOT report this by itself as a setup-quality finding; evaluate whether `/goat` and `/goat-plan` handle the fallback gracefully.",
  );
  lines.push(
    "- Unchecked task or milestone checkboxes, milestone status fields, roadmap files, and task-file completion percentages are local workflow state. Do NOT report them as quality findings by themselves. Only report task-file issues when they cause an observed skill behavior failure, such as ignoring explicit user intent or corrupting task files.",
  );
  lines.push(
    "- `toolchain` and `ask_first` fields in `config.yaml` were removed from the base setup in v1.1.0 (see ADR-014). A lean config.yaml with version and skills is correct - not a gap; legacy `agents:` entries are ignored.",
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
    lines.push(renderAuditUnavailableHeading(auditUnavailableReason));
    lines.push(renderDegradedNote(auditUnavailableReason));
  }
  lines.push("");

  lines.push(renderPriorReportContext(priorReport, qualityMode));
  lines.push("");
  const learningLoopContext = renderBoundedLearningLoopContext(
    input.sharedFacts,
    qualityMode,
  );
  if (learningLoopContext) {
    lines.push(learningLoopContext);
    lines.push("");
  }

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
    lines.push(`bash ${denyHookFile} --self-test=smoke`);
  } else {
    lines.push("#    This agent has no on-disk deny hook script to self-test.");
  }
  lines.push("");
  lines.push("# 3. Quick structural checks");
  lines.push(
    `wc -l ${instructionFile}                          # target: about 125 lines; hard limit: 150`,
  );
  lines.push(
    `ls ${skillsDir}/                                  # expect ${skillFacts.total} goat-flow skill directories`,
  );
  lines.push(
    "cat .goat-flow/config.yaml                        # minimal valid config: version and skills; legacy agents is ignored; line-limits/toolchain are optional calibration only",
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
    "- `.goat-flow/code-map.md`, `.goat-flow/glossary.md`, `.goat-flow/patterns/` (if they exist)",
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
    '- Pick 3-5 footgun entries from `.goat-flow/footguns/`. For each: (a) grep for the cited semantic anchor (function name, unique string, or `(search: "pattern")`) - does the code still exhibit the described behavior? (b) Is the `Status` field (active/resolved) accurate? An entry marked `active` that describes fixed behavior is a stale entry - report it. (c) Do the semantic anchors resolve to the described code?',
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
    "3. **`/goat-plan`** - ask for a milestone/task breakdown inline, then try a bare `.goat-flow/tasks/<name>` path. The bare path must produce read-only orientation only. If it writes milestone files despite inline/reporting-only/path-only input, report the mode confusion; do not frame gitignored task-file writes as committed-state read-only violations.",
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
    "1. **Version tags:** Do all installed SKILL.md files have a `goat-flow-skill-version` header, and do all installed reference docs have a `goat-flow-reference-version` header? Do they match the config.yaml version?",
  );
  lines.push(
    "2. **Truncation or corruption:** Do the installed skill files look complete? Are there any signs of truncation, merging, or adaptation that broke the structure? (Skills should be installed verbatim from templates - they should NOT be adapted.)",
  );
  lines.push(
    '3. **Depth choice coherence:** Evaluate one skill with "quick" and one with "full" in reporting-only mode. Is the experience meaningfully different?',
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
  lines.push(
    "Do NOT recommend adding quick/lite/reduced modes to any skill. Skill mode decisions (e.g. goat-critique being full-delegated-only) are ADR-decided architectural choices, not gaps to fill. See `.goat-flow/decisions/ADR-021-goat-critique-full-mode-only.md`.",
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

  lines.push("### Write the JSON report");
  lines.push("");
  lines.push(
    "Do **not** emit the JSON as a fenced block in your reply. Write it as a file to `.goat-flow/logs/quality/` - that path is gitignored and expected. No tracked-file writes or implementation edits are permitted.",
  );
  lines.push("");
  lines.push(
    "**CRITICAL:** After writing the file, verify it was saved by running `ls -la .goat-flow/logs/quality/` and confirming the file appears with non-zero size. If missing, retry the write. A quality report that exists only in conversation history is invisible to `goat-flow quality history` and `goat-flow quality diff`.",
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
  lines.push(
    `QUALITY_DIR=${shellSingleQuote(toShellProjectPath(projectPath, ".goat-flow/logs/quality"))}`,
  );
  lines.push(`FILE="\${QUALITY_DIR}/\${STAMP}-${agent}-\${RAND}.json"`);
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
  lines.push(`  "agent": ${jsonString(agent)},`);
  lines.push(`  "project_path": ${jsonString(projectPath)},`);
  lines.push(`  "run_date": ${jsonString(runDate)},`);
  lines.push(`  "audit_status": ${jsonString(auditStatus)},`);
  lines.push(`  "scope": ${jsonString(inferQualityScope(projectPath))},`);
  lines.push(`  "rubric_version": ${jsonString(getPackageVersion())},`);
  lines.push(`  "quality_mode": ${jsonString(qualityMode)},`);
  lines.push(
    `  "prior_report_id": ${priorReport ? jsonString(priorReport.id) : "null"},`,
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
  lines.push("    {");
  lines.push(
    '      "type": "setup_quality", "severity": "MAJOR", "file": ".goat-flow/architecture.md", "line": null,',
  );
  lines.push(
    `      "summary": "One-line finding summary", "detail": "Why it matters; include a semantic anchor when the evidence should survive as a durable learning-loop artifact.", "evidence_quality": "OBSERVED", "evidence_method": "static-analysis", "delta_tag": ${priorReport ? '"new"' : "null"}`,
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
    "- Runtime-backed findings SHOULD include compact evidence fields when useful: `evidence_command` (the command), `evidence_exit_code` (integer), `evidence_summary` (literal pass/fail or warning summary), `evidence_warning_count` (integer), and `evidence_excerpt` (short single-line excerpt). Do not paste raw terminal blocks into JSON.",
  );
  lines.push(
    '- `scope` is REQUIRED at top level. Set `framework-self` if you detect this is the goat-flow repo itself (heuristic: `package.json` contains `"name": "@blundergoat/goat-flow"`). Otherwise set `consumer`.',
  );
  lines.push(
    `- \`rubric_version\` is REQUIRED at top level; copy the template value (\`"${getPackageVersion()}"\`). The Rating bands section above is the rubric - future readers use this version tag to trace which band anchors produced your scores.`,
  );
  lines.push(
    `- \`quality_mode\` is REQUIRED for new reports generated from this prompt. Use \`${jsonString(qualityMode)}\` for this ${qualityModeLabel(qualityMode)} assessment.`,
  );
  lines.push(
    `- \`prior_report_id\` must be ${priorReport ? `\`${priorReport.id}\`` : "`null`"} for this run. This makes \`delta_tag\` traceable to the same-agent baseline and prevents readers from treating \`new\` as newly introduced without a diff.`,
  );
  lines.push(
    "- `line` must be a positive integer OR `null`. Never `0`. For file-wide findings with no specific line, use `null`.",
  );
  lines.push(
    "- Live review findings should cite `file` + semantic anchor after re-reading the cited file and anchor. Durable footguns, lessons, patterns, and decisions must use file paths plus semantic anchors rather than line numbers.",
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
    "- Do NOT include extra top-level keys or extra finding keys outside this contract. Unknown keys are rejected.",
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
