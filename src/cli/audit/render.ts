/**
 * Renderers for AuditReport: text (terminal), json (stable schema), markdown (PR comments).
 */
import type { AuditConcernKey, AuditReport, AuditScope } from "./types.js";

// === Text renderer ===

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function statusBadge(status: "pass" | "fail"): string {
  return status === "pass" ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
}

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

  return lines.join("\n");
}

// === JSON renderer ===

export function renderAuditJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

// === Markdown renderer ===

function mdScopeStatus(status: "pass" | "fail"): string {
  return status === "pass" ? "PASS" : "FAIL";
}

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

export function renderAuditMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# GOAT Flow Audit: ${report.target}`);
  lines.push("");
  lines.push(`**Result: ${mdScopeStatus(report.status)}**`);
  lines.push("");

  lines.push(renderMdScope("GOAT Flow Setup", report.scopes.setup));
  lines.push("");
  lines.push(renderMdScope("Agent Setup", report.scopes.agent));

  if (!report.concerns) {
    lines.push(
      "> Tip: Run with --harness for AI harness completeness checks across 5 concerns.",
    );
    lines.push("");
  }

  if (report.concerns && report.scopes.harness) {
    lines.push("");
    lines.push(
      `## AI Harness Completeness: ${mdScopeStatus(report.scopes.harness.status)}`,
    );
    lines.push("");

    for (const key of Object.keys(report.concerns) as AuditConcernKey[]) {
      const concern = report.concerns[key];
      const label = CONCERN_LABELS[key];
      lines.push(`### ${label}: ${mdScopeStatus(concern.status)}`);
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

  return lines.join("\n");
}
