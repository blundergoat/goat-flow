/**
 * Renderers for AuditReport: text (terminal), json (stable schema), markdown (PR comments).
 */
import type {
  AuditConcernKey,
  AuditReport,
  AuditScope,
  ContentReport,
  DriftReport,
} from "./types.js";

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
  for (const f of scope.failures) {
    lines.push(`  ${RED}x ${f.check}: ${f.message}${RESET}`);
    if (f.howToFix) {
      lines.push(`    ${CYAN}-> ${f.howToFix}${RESET}`);
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

/** Render the full audit report in the terminal text format. */
export function renderAuditText(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`${BOLD}GOAT Flow Audit: ${report.target}${RESET}`);
  lines.push("");

  // Build scopes
  lines.push(renderTextScope("GOAT Flow Setup", report.scopes.setup));
  lines.push("");
  lines.push(renderTextScope("Agent Setup", report.scopes.agent));
  lines.push("");

  lines.push(`Result: ${statusBadge(report.status)}`);

  // Harness completeness concerns
  if (report.concerns && report.scopes.harness) {
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
      if (concern.recommendations.length > 0) {
        for (let i = 0; i < concern.recommendations.length; i++) {
          lines.push(`    ${YELLOW}-> ${concern.recommendations[i]}${RESET}`);
          if (concern.howToFix[i]) {
            lines.push(`       ${CYAN}Fix: ${concern.howToFix[i]}${RESET}`);
          }
        }
      }
      lines.push("");
    }
  } else {
    lines.push(
      `${DIM}Tip: Run with --harness for AI harness completeness checks across 5 concerns.${RESET}`,
    );
  }

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
  for (const f of content.findings) {
    const color = f.severity === "warning" ? RED : YELLOW;
    const loc = f.line !== undefined ? `${f.path}:${f.line}` : f.path;
    lines.push(
      `  ${color}${f.severity.toUpperCase()} [${f.rule}] ${loc}${RESET}`,
    );
    lines.push(`    ${DIM}${f.message}${RESET}`);
    if (f.suggestion) {
      lines.push(`    ${CYAN}-> ${f.suggestion}${RESET}`);
    }
  }
}

/** Map a skill-dir path prefix to an install-goat-flow.sh --agent target.
 *  Returns null when the path doesn't match a known satellite-agent dir. */
function pathToAgentLabel(path: string): string | null {
  if (path.startsWith(".agents/skills/")) return "codex";
  if (path.startsWith(".gemini/skills/")) return "gemini";
  if (path.startsWith(".claude/skills/")) return "claude";
  if (path.startsWith(".github/skills/")) return "copilot";
  return null;
}

/** Render drift findings in the terminal text format. */
function renderTextDriftFindings(drift: DriftReport, lines: string[]): void {
  if (drift.findings.length === 0) {
    lines.push(`  ${DIM}No drift detected.${RESET}`);
    return;
  }
  for (const f of drift.findings) {
    const tag =
      f.kind === "content"
        ? "drift"
        : f.kind === "missing"
          ? "missing"
          : f.kind === "deprecated"
            ? "deprecated"
            : "orphan";
    lines.push(`  ${RED}x [${tag}] ${f.path}${RESET}`);
    lines.push(`    ${DIM}${f.message}${RESET}`);
  }
  const staleAgents = new Set<string>();
  for (const f of drift.findings) {
    if (f.kind !== "deprecated") continue;
    const agent = pathToAgentLabel(f.path);
    if (agent !== null) staleAgents.add(agent);
  }
  if (staleAgents.size > 0) {
    const agentList = [...staleAgents].sort().join(" / ");
    lines.push(
      `  ${DIM}Multi-agent drift: run \`install-goat-flow.sh . --agent ${agentList}\` to migrate the remaining agent(s).${RESET}`,
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
  for (const f of scope.failures) {
    lines.push(`- :x: **${f.check}**: ${f.message}`);
    if (f.howToFix) {
      lines.push(`  - *Fix:* ${f.howToFix}`);
    }
  }
  return lines.join("\n");
}

/** Render harness concerns in markdown. */
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
    for (let i = 0; i < concern.recommendations.length; i++) {
      lines.push(`- *Recommendation:* ${concern.recommendations[i]}`);
      if (concern.howToFix[i]) {
        lines.push(`  - *Fix:* ${concern.howToFix[i]}`);
      }
    }
    lines.push("");
  }
}

/** Render drift findings in markdown. */
function renderMdDrift(drift: DriftReport, lines: string[]): void {
  lines.push("");
  lines.push(
    `## Skill Template Drift: ${mdScopeStatus(drift.status)} (${drift.checked} comparison(s))`,
  );
  if (drift.findings.length === 0) {
    lines.push("");
    lines.push("No drift detected.");
  } else {
    for (const f of drift.findings) {
      lines.push(`- :x: **[${f.kind}]** \`${f.path}\` - ${f.message}`);
    }
  }
  lines.push("");
}

/** Render content-check findings in markdown. */
function renderMdContent(content: ContentReport, lines: string[]): void {
  lines.push("");
  lines.push(
    `## Cold-Path Content Lint: ${mdScopeStatus(content.status)} (${content.warnings} warning(s), ${content.infos} info, ${content.filesScanned} file(s) scanned)`,
  );
  if (content.findings.length === 0) {
    lines.push("");
    lines.push("No content issues detected.");
  } else {
    for (const f of content.findings) {
      const loc = f.line !== undefined ? `${f.path}:${f.line}` : f.path;
      lines.push(
        `- :x: **${f.severity.toUpperCase()} [${f.rule}]** \`${loc}\` - ${f.message}`,
      );
      if (f.suggestion) lines.push(`  - *Fix:* ${f.suggestion}`);
    }
  }
  lines.push("");
}

/** Render the full audit report in markdown. */
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
