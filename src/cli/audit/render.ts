/**
 * Renders audit results for terminal users, stable JSON consumers, and Markdown summaries.
 * Use this file when output wording or machine-readable audit fields change.
 * Enforcement output keeps status beside proof strength so runner comparisons remain honest.
 */
import type {
  AgentEnforcementCapability,
  EnforcementCapabilityStatus,
} from "./enforcement.js";
import type {
  AuditConcernKey,
  AuditReport,
  AuditScope,
  ContentReport,
  DriftReport,
} from "./types.js";
export { renderAuditSarif } from "./sarif.js";

// === Text renderer ===

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/** Render a colored status badge for terminal output. */
function statusBadge(status: "pass" | "fail" | "skipped"): string {
  if (status === "skipped") return `${YELLOW}SKIP${RESET}`;
  return status === "pass" ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
}

const ENFORCEMENT_STATUS_LABELS: Record<EnforcementCapabilityStatus, string> = {
  hard: "HARD",
  limited: "LIMITED",
  soft: "SOFT",
  missing: "MISSING",
  unknown: "UNKNOWN",
};

/** Render a non-gating enforcement status label. */
function enforcementStatus(status: EnforcementCapabilityStatus): string {
  // Hard local protection is the strongest result shown to terminal users.
  if (status === "hard")
    return `${GREEN}${ENFORCEMENT_STATUS_LABELS[status]}${RESET}`;
  // Missing protection is actionable and uses the terminal failure color.
  if (status === "missing") {
    return `${RED}${ENFORCEMENT_STATUS_LABELS[status]}${RESET}`;
  }
  // Limited and soft protection remain visible without looking equivalent to hard enforcement.
  if (status === "limited" || status === "soft") {
    return `${YELLOW}${ENFORCEMENT_STATUS_LABELS[status]}${RESET}`;
  }
  return `${DIM}${ENFORCEMENT_STATUS_LABELS[status]}${RESET}`;
}

/** Render the proof class and source beside a capability status for direct runner comparison. */
function enforcementEvidence(
  capability: AgentEnforcementCapability["capabilities"][number],
): string {
  return `[assurance: ${capability.assurance}; source: ${capability.sources.join(", ")}]`;
}

/** Render the advisory enforcement matrix in terminal text format. */
function renderEnforcementMatrix(matrix: AgentEnforcementCapability[]): string {
  const lines: string[] = [];
  lines.push(
    `${BOLD}Agent Enforcement Matrix:${RESET}  ${DIM}advisory local evidence; not provider support; does not affect audit status${RESET}`,
  );
  lines.push("");
  // Each runner gets a separate section so users can compare unequal guardrail evidence directly.
  for (const agent of matrix) {
    lines.push(`  ${CYAN}${agent.name}${RESET}`);
    // Every visible status stays adjacent to its assurance class and concrete evidence source.
    for (const capability of agent.capabilities) {
      lines.push(
        `    ${enforcementStatus(capability.status)} ${capability.label} ${enforcementEvidence(capability)}: ${capability.summary}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** Render one audit scope in the terminal text format. */
function renderTextScope(name: string, scope: AuditScope): string {
  const lines: string[] = [];
  lines.push(
    `${name}:${" ".repeat(Math.max(1, 24 - name.length))}${statusBadge(scope.status)}`,
  );
  for (const [key, value] of Object.entries(scope.summary)) {
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    lines.push(
      `  ${label}:${" ".repeat(Math.max(1, 22 - label.length))}${value}`,
    );
  }
  for (const failure of scope.failures) {
    lines.push(`  ${RED}x ${failure.check}: ${failure.message}${RESET}`);
    if (failure.howToFix) {
      lines.push(`    ${CYAN}-> ${failure.howToFix}${RESET}`);
    }
  }
  return lines.join("\n");
}

const CONCERN_LABELS: Record<AuditConcernKey, string> = {
  context: "Context",
  constraints: "Constraints",
  verification: "Verification",
  recovery: "Recovery",
  feedback_loop: "Feedback Loop",
};

/**
 * Append the stable harness concern summary used by terminal output.
 *
 * This branch structure is intentional because the no-harness tip, concern
 * order, and recommendation/fix pairing are part of the public output contract;
 * structured `details` stay out of prose to preserve JSON/SARIF-only semantics.
 */
function renderHarnessConcerns(report: AuditReport, lines: string[]): void {
  if (!report.concerns || !report.scopes.harness) {
    lines.push(
      `${DIM}Tip: Run with --harness for AI harness completeness checks across 5 concerns.${RESET}`,
    );
    return;
  }

  lines.push("");
  lines.push(
    `${BOLD}AI Harness Completeness:${RESET}  ${statusBadge(report.scopes.harness.status)}`,
  );
  lines.push("");

  for (const key of Object.keys(report.concerns) as AuditConcernKey[]) {
    const concern = report.concerns[key];
    const label = CONCERN_LABELS[key];
    const badge = statusBadge(concern.status);
    lines.push(`  ${CYAN}${label}${RESET}  ${badge}`);
    for (const finding of concern.findings) {
      lines.push(`    ${DIM}${finding}${RESET}`);
    }
    for (const limit of concern.limits) {
      lines.push(`    ${YELLOW}Limit: ${limit}${RESET}`);
    }
    for (let i = 0; i < concern.recommendations.length; i++) {
      lines.push(`    ${YELLOW}-> ${concern.recommendations[i]}${RESET}`);
      if (concern.howToFix[i]) {
        lines.push(`       ${CYAN}Fix: ${concern.howToFix[i]}${RESET}`);
      }
    }
    lines.push("");
  }
}

/**
 * Render the full audit report in the terminal text format.
 *
 * @param report - Audit report produced by `runAudit` or `runAuditBatch`.
 * @returns Human-readable terminal output with ANSI status labels.
 */
export function renderAuditText(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`${BOLD}GOAT Flow Audit: ${report.target}${RESET}`);
  lines.push("");

  lines.push(renderTextScope("GOAT Flow Setup", report.scopes.setup));
  lines.push("");
  lines.push(renderTextScope("Agent Setup", report.scopes.agent));
  lines.push("");

  lines.push(`Result: ${statusBadge(report.status)}`);

  const enforcement = Array.isArray(report.enforcement)
    ? report.enforcement
    : [];
  if (enforcement.length > 0) {
    lines.push("");
    lines.push(renderEnforcementMatrix(enforcement));
  }

  renderHarnessConcerns(report, lines);

  if (report.drift) {
    lines.push("");
    lines.push(
      `${BOLD}Skill Template Drift:${RESET}  ${statusBadge(report.drift.status)}  ${DIM}(${report.drift.checked} comparison(s))${RESET}`,
    );
    lines.push("");
    renderTextDriftFindings(report.drift, lines);
  }

  if (report.content) {
    lines.push("");
    lines.push(
      `${BOLD}Cold-Path Content Lint:${RESET}  ${statusBadge(report.content.status)}  ${DIM}(${report.content.warnings} warning(s), ${report.content.infos} info, ${report.content.filesScanned} file(s) scanned)${RESET}`,
    );
    lines.push("");
    renderTextContentFindings(report.content, lines);
  }

  return lines.join("\n");
}

/** Render content-check findings in the terminal text format. */
function renderTextContentFindings(
  content: ContentReport,
  lines: string[],
): void {
  if (content.findings.length === 0) {
    lines.push(`  ${DIM}No content issues detected.${RESET}`);
    return;
  }
  for (const finding of content.findings) {
    const color = finding.severity === "warning" ? RED : YELLOW;
    const loc =
      finding.line !== undefined
        ? `${finding.path}:${finding.line}`
        : finding.path;
    lines.push(
      `  ${color}${finding.severity.toUpperCase()} [${finding.rule}] ${loc}${RESET}`,
    );
    lines.push(`    ${DIM}${finding.message}${RESET}`);
    if (finding.suggestion) {
      lines.push(`    ${CYAN}-> ${finding.suggestion}${RESET}`);
    }
  }
}

/** Map a skill-dir path prefix to a goat-flow install --agent target.
 *  Returns null when the path doesn't match a known satellite-agent dir. */
function pathToAgentLabel(path: string): string | null {
  // `.agents/skills/` is shared by codex and antigravity; codex is the
  // default install target for repair suggestions.
  if (path.startsWith(".agents/skills/")) return "codex";
  if (path.startsWith(".claude/skills/")) return "claude";
  if (path.startsWith(".github/skills/")) return "copilot";
  return null;
}

/**
 * Render drift findings in the terminal text format.
 *
 * The tag vocabulary is a stable user-facing contract, and the second pass is
 * intentional because deprecated skills need one combined repair hint per
 * agent rather than one repeated hint per finding.
 */
function renderTextDriftFindings(drift: DriftReport, lines: string[]): void {
  if (drift.findings.length === 0) {
    lines.push(`  ${DIM}No drift detected.${RESET}`);
    return;
  }
  for (const finding of drift.findings) {
    const tag =
      finding.kind === "content"
        ? "drift"
        : finding.kind === "missing"
          ? "missing"
          : finding.kind === "deprecated"
            ? "deprecated"
            : "orphan";
    lines.push(`  ${RED}x [${tag}] ${finding.path}${RESET}`);
    lines.push(`    ${DIM}${finding.message}${RESET}`);
  }
  const staleAgents = new Set<string>();
  for (const finding of drift.findings) {
    if (finding.kind !== "deprecated") continue;
    const agent = pathToAgentLabel(finding.path);
    if (agent !== null) staleAgents.add(agent);
  }
  if (staleAgents.size > 0) {
    const agentList = [...staleAgents].sort().join(" / ");
    lines.push(
      `  ${DIM}Multi-agent drift: run \`goat-flow install . --agent <agent>\` for each stale agent (${agentList}).${RESET}`,
    );
  }
}

// === JSON renderer ===

export function renderAuditJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

// === Markdown renderer ===

function mdScopeStatus(status: "pass" | "fail"): string {
  return status === "pass" ? "PASS" : "FAIL";
}

/** Render one audit scope in markdown. */
function renderMdScope(name: string, scope: AuditScope): string {
  const lines: string[] = [];
  lines.push(`### ${name}: ${mdScopeStatus(scope.status)}`);
  for (const [key, value] of Object.entries(scope.summary)) {
    lines.push(`- **${key}**: ${value}`);
  }
  for (const failure of scope.failures) {
    lines.push(`- :x: **${failure.check}**: ${failure.message}`);
    if (failure.howToFix) {
      lines.push(`  - *Fix:* ${failure.howToFix}`);
    }
  }
  return lines.join("\n");
}

/**
 * Render harness concerns in markdown.
 *
 * Markdown preserves the same stable concern order and summary contract as the
 * terminal renderer because PR comments and terminal output need comparable
 * failure/recommendation ordering.
 */
function renderMdHarnessConcerns(report: AuditReport, lines: string[]): void {
  if (!report.concerns || !report.scopes.harness) {
    lines.push(
      "> Tip: Run with --harness for AI harness completeness checks across 5 concerns.",
    );
    lines.push("");
    return;
  }
  lines.push("");
  lines.push(
    `## AI Harness Completeness: ${mdScopeStatus(report.scopes.harness.status)}`,
  );
  lines.push("");
  for (const key of Object.keys(report.concerns) as AuditConcernKey[]) {
    const concern = report.concerns[key];
    lines.push(`### ${CONCERN_LABELS[key]}: ${mdScopeStatus(concern.status)}`);
    for (const finding of concern.findings) {
      lines.push(`- ${finding}`);
    }
    for (const limit of concern.limits) {
      lines.push(`- *Limit:* ${limit}`);
    }
    for (let i = 0; i < concern.recommendations.length; i++) {
      lines.push(`- *Recommendation:* ${concern.recommendations[i]}`);
      if (concern.howToFix[i]) {
        lines.push(`  - *Fix:* ${concern.howToFix[i]}`);
      }
    }
    lines.push("");
  }
}

/**
 * Render drift findings in markdown using stable finding-kind labels.
 *
 * The `[kind] path - message` shape is the public markdown contract for drift
 * reports, matching the data model without exposing terminal-only repair hints.
 */
function renderMdDrift(drift: DriftReport, lines: string[]): void {
  lines.push("");
  lines.push(
    `## Skill Template Drift: ${mdScopeStatus(drift.status)} (${drift.checked} comparison(s))`,
  );
  if (drift.findings.length === 0) {
    lines.push("");
    lines.push("No drift detected.");
  } else {
    for (const finding of drift.findings) {
      lines.push(
        `- :x: **[${finding.kind}]** \`${finding.path}\` - ${finding.message}`,
      );
    }
  }
  lines.push("");
}

/**
 * Render content-check findings in markdown using stable severity/rule labels.
 *
 * The location and suggestion shape is a public contract with content-quality
 * consumers, so markdown keeps the same diagnostic fields as terminal output.
 */
function renderMdContent(content: ContentReport, lines: string[]): void {
  lines.push("");
  lines.push(
    `## Cold-Path Content Lint: ${mdScopeStatus(content.status)} (${content.warnings} warning(s), ${content.infos} info, ${content.filesScanned} file(s) scanned)`,
  );
  if (content.findings.length === 0) {
    lines.push("");
    lines.push("No content issues detected.");
  } else {
    for (const finding of content.findings) {
      const loc =
        finding.line !== undefined
          ? `${finding.path}:${finding.line}`
          : finding.path;
      lines.push(
        `- :x: **${finding.severity.toUpperCase()} [${finding.rule}]** \`${loc}\` - ${finding.message}`,
      );
      if (finding.suggestion) lines.push(`  - *Fix:* ${finding.suggestion}`);
    }
  }
  lines.push("");
}

/**
 * Render the full audit report in markdown.
 *
 * @param report - Audit report produced by `runAudit` or `runAuditBatch`.
 * @returns Markdown suitable for PR comments and copied audit summaries.
 */
export function renderAuditMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# GOAT Flow Audit: ${report.target}`);
  lines.push("");
  lines.push(`**Result: ${mdScopeStatus(report.status)}**`);
  lines.push("");
  lines.push(renderMdScope("GOAT Flow Setup", report.scopes.setup));
  lines.push("");
  lines.push(renderMdScope("Agent Setup", report.scopes.agent));
  renderMdHarnessConcerns(report, lines);
  if (report.drift) renderMdDrift(report.drift, lines);
  if (report.content) renderMdContent(report.content, lines);
  return lines.join("\n");
}
