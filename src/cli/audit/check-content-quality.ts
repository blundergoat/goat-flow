/**
 * Cold-path content quality linting (M05 § 1).
 *
 * Three detector families, all running on truth-bearing prose (instruction
 * files, installed skills, canonical docs). Ports logic inline from cclint
 * and agnix (per Assumption "no new runtime deps"):
 *
 *   - Vague-term detection (3-term conservative subset: `properly`,
 *     `correctly`, `appropriately`). INFO severity.
 *   - Generic-instruction detection (5 cclint regex patterns, e.g.
 *     "follow best practices"). WARNING severity.
 *   - Non-actionable statement detection (3 cclint regex patterns with
 *     negative lookaheads, e.g. bare "remember" without "to"). INFO.
 *
 * Both cclint code-block-skipping bugs are fixed here (ContentOrganizationRule
 * and ContentAppropriatenessRule both leak fenced-block content into their
 * matchers). A single `inCodeBlock` state machine is shared across all three
 * detector families — toggled on lines starting with ``` (after trimming).
 */
import type { AuditContext } from "./types.js";
import type { ContentFinding, ContentSeverity } from "./types.js";
import type { CheckEvidence } from "./provenance-types.js";
import { SKILL_NAMES } from "../constants.js";
import { getInstalledSkillRoots, getSkillFiles } from "../manifest/manifest.js";

interface PatternRule {
  rule: string;
  /** Compiled regex (case-insensitive, word-boundary handled inside the pattern). */
  pattern: RegExp;
  severity: ContentSeverity;
  message: (match: string, line: string) => string;
  suggestion?: (match: string, line: string) => string | undefined;
}

/** Scan mode for a target.
 *  - "full": all three detector families (vague-term, generic-instruction, non-actionable).
 *  - "restricted": generic-instruction + non-actionable only. Used for
 *    learning-loop surfaces (footguns/lessons), whose historical-incident
 *    prose legitimately uses vague-adjacent words ("projects that correctly
 *    omitted those fields"). The narrow generic and non-actionable patterns
 *    rarely false-positive on historical prose; vague-term does. */
type ScanMode = "full" | "restricted";

/** Target scope for full content-quality checks: truth-bearing prose.
 *  Learning-loop buckets (footguns/lessons) are resolved separately at scan
 *  time and get restricted-mode treatment — see LEARNING_LOOP_DIRS. */
const QUALITY_TARGETS = [
  // Hot-path instruction files
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  ".github/copilot-instructions.md",
  // Canonical docs
  ".goat-flow/architecture.md",
  ".goat-flow/code-map.md",
  ".goat-flow/glossary.md",
  ".goat-flow/patterns.md",
  // Shared skill doctrine
  ".goat-flow/skill-reference/skill-preamble.md",
  ".goat-flow/skill-reference/skill-conventions.md",
  ".goat-flow/skill-reference/skill-quality-testing.md",
  // Public docs
  "docs/cli.md",
  "docs/skills.md",
  "docs/audit-and-quality.md",
  // ADRs
  ".goat-flow/decisions/README.md",
  ".goat-flow/decisions/ADR-001-remove-confusion-log.md",
  ".goat-flow/decisions/ADR-002-replace-preflight-with-security-skill.md",
  ".goat-flow/decisions/ADR-003-reference-based-setup-prompts.md",
  ".goat-flow/decisions/ADR-004-config-file-and-directory-learning-loop.md",
  ".goat-flow/decisions/ADR-005-no-implementation-skill.md",
  ".goat-flow/decisions/ADR-006-autonomous-skill-mode.md",
  ".goat-flow/decisions/ADR-007-extract-skill-conventions.md",
  ".goat-flow/decisions/ADR-008-instruction-budget-constraint.md",
  ".goat-flow/decisions/ADR-009-skill-consolidation.md",
  ".goat-flow/decisions/ADR-010-setup-file-ownership.md",
  ".goat-flow/decisions/ADR-011-critique-mob-core-features.md",
  ".goat-flow/decisions/ADR-012-quality-checks-expansion.md",
  ".goat-flow/decisions/ADR-013-remove-scanner-system.md",
  ".goat-flow/decisions/ADR-014-optional-project-calibration-config.md",
  ".goat-flow/decisions/ADR-015-remove-stop-lint-from-core.md",
  ".goat-flow/decisions/ADR-016-cold-path-truth-maintenance.md",
  ".goat-flow/decisions/ADR-017-active-plan-marker.md",
  ".goat-flow/decisions/ADR-018-no-goat-verify-skill.md",
  ".goat-flow/decisions/ADR-019-rename-sbao-to-critique-and-test-to-qa.md",
  ".goat-flow/decisions/ADR-020-add-copilot-cli.md",
  // Setup templates
  "workflow/setup/01-system-overview.md",
  "workflow/setup/02-instruction-file.md",
  "workflow/setup/03-install-skills.md",
  "workflow/setup/04-architecture-code-map.md",
  "workflow/setup/05-customise-to-project.md",
  "workflow/setup/06-final-verification.md",
  "workflow/setup/agents/claude.md",
  "workflow/setup/agents/codex.md",
  "workflow/setup/agents/gemini.md",
  "workflow/setup/agents/copilot.md",
  "workflow/setup/reference/ADR-000-template.md",
  "workflow/setup/reference/execution-loop.md",
  "workflow/setup/reference/footguns-readme.md",
  "workflow/setup/reference/lessons-readme.md",
  "workflow/setup/reference/reference-coding-guidelines.md",
  "workflow/setup/reference/reference-polish.md",
  "workflow/setup/reference/scratchpad-readme.md",
  "workflow/setup/reference/tasks-readme.md",
] as const;

/** Learning-loop buckets. Scanned in restricted mode (no vague-term checks)
 *  because the Symptoms/Why/Evidence sections describe past incidents and
 *  legitimately use words like "correctly"/"properly". Generic-instruction and
 *  non-actionable detectors still apply — those patterns should never appear
 *  in actionable Prevention blocks. */
const LEARNING_LOOP_DIRS = [
  ".goat-flow/footguns/",
  ".goat-flow/lessons/",
] as const;

const VAGUE_TERMS: { term: string; suggestion: (line: string) => string }[] = [
  {
    term: "properly",
    suggestion: (line) =>
      /format|style/i.test(line)
        ? "Specify the exact format or style guide (e.g. 'Follow Prettier defaults' or 'Use 2-space indentation')."
        : "Be specific about the expected format or standard (e.g. 'Use 2-space indentation' instead of 'Format properly').",
  },
  {
    term: "correctly",
    suggestion: (_line) =>
      "Define what 'correct' means with measurable criteria.",
  },
  {
    term: "appropriately",
    suggestion: (_line) =>
      "Describe the specific situation and the expected response.",
  },
];

const GENERIC_INSTRUCTIONS: PatternRule[] = [
  {
    rule: "generic-best-practices",
    pattern: /follow\s+best\s+practices/i,
    severity: "warning",
    message: () =>
      "Avoid generic 'follow best practices'. Be specific about which practice applies here.",
  },
  {
    rule: "generic-good-code",
    pattern: /write\s+good\s+code/i,
    severity: "warning",
    message: () =>
      "Avoid vague 'write good code'. Be specific about the standards the reader must meet.",
  },
  {
    rule: "generic-correct",
    pattern: /do\s+it\s+correctly/i,
    severity: "warning",
    message: () =>
      "Avoid generic 'do it correctly'. Define what correct means with measurable criteria.",
  },
  {
    rule: "generic-common-sense",
    pattern: /use\s+common\s+sense/i,
    severity: "warning",
    message: () =>
      "Avoid 'use common sense'. Document the specific decision criteria the reader should apply.",
  },
  {
    rule: "generic-be-careful",
    pattern: /be\s+careful/i,
    severity: "warning",
    message: () =>
      "Instead of 'be careful', specify the exact risk and mitigation.",
  },
];

const NON_ACTIONABLE: PatternRule[] = [
  {
    // `note` dropped from cclint's term list — too many false positives on
    // goat-flow's own docs: label usage (`Note:`), direct-object verbs
    // (`note them`, `Note what X`) all match cclint's `(?!\s+to\s+)` guard
    // but are legitimate instructions. `remember | keep in mind | don't
    // forget` retain the non-actionable signal without the label clash.
    rule: "non-actionable-remember",
    pattern: /(?:\bremember\b|\bkeep in mind\b|\bdon'?t forget\b)(?!\s+to\s+)/i,
    severity: "info",
    message: (match) =>
      `"${match}" without "to <verb>" has no action. State what the reader must do.`,
  },
  {
    rule: "non-actionable-important",
    pattern: /it'?s\s+important(?!\s+to\s+)/i,
    severity: "info",
    message: () =>
      '"it\'s important" without "to <verb>" leaves the expected action unspecified.',
  },
  {
    rule: "non-actionable-should-know",
    pattern: /you\s+should\s+know(?!\s+that\s+)/i,
    severity: "info",
    message: () =>
      '"you should know" without "that <fact>" has no propositional content.',
  },
];

export const CONTENT_QUALITY_EVIDENCE: CheckEvidence = {
  source_type: "community",
  source_urls: [
    "https://github.com/blundergoat/cclint#contentappropriatenessrule",
    "https://github.com/blundergoat/cclint#contentorganizationrule",
  ],
  verified_on: "2026-04-17",
  normative_level: "SHOULD",
  evidence_paths: [".goat-flow/lessons/verification.md"],
};

/** One iteration of code-block state: toggled on fence lines, guards all matchers. */
function isFenceLine(line: string): boolean {
  return /^\s*```/.test(line);
}

/** Scan one line for vague, generic, or non-actionable guidance. */
function scanLine(
  line: string,
  lineNumber: number,
  path: string,
  findings: ContentFinding[],
  mode: ScanMode = "full",
): void {
  if (mode === "full") {
    for (const { term, suggestion } of VAGUE_TERMS) {
      const rx = new RegExp(`\\b${term}\\b`, "i");
      const match = rx.exec(line);
      if (match) {
        findings.push({
          severity: "info",
          rule: "vague-term",
          path,
          line: lineNumber,
          message: `Vague term "${match[0]}" — no measurable standard.`,
          suggestion: suggestion(line),
        });
      }
    }
  }
  for (const rule of GENERIC_INSTRUCTIONS) {
    const match = rule.pattern.exec(line);
    if (match) {
      findings.push({
        severity: rule.severity,
        rule: rule.rule,
        path,
        line: lineNumber,
        message: rule.message(match[0], line),
      });
    }
  }
  for (const rule of NON_ACTIONABLE) {
    const match = rule.pattern.exec(line);
    if (match) {
      findings.push({
        severity: rule.severity,
        rule: rule.rule,
        path,
        line: lineNumber,
        message: rule.message(match[0], line),
      });
    }
  }
}

/** Scan one file. Returns zero or more findings, skipping fenced code blocks.
 *  Pass `mode: "restricted"` for learning-loop files to skip vague-term checks
 *  on incident-description prose. */
export function scanContentQuality(
  path: string,
  text: string,
  mode: ScanMode = "full",
): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const lines = text.split(/\r?\n/);
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    scanLine(line, i + 1, path, findings, mode);
  }
  return findings;
}

/** Full list of target paths, including every installed skill SKILL.md. */
function resolveTargets(): string[] {
  const targets: string[] = [...QUALITY_TARGETS];
  for (const agentDir of getInstalledSkillRoots()) {
    for (const name of SKILL_NAMES) {
      for (const relativeFile of getSkillFiles(name)) {
        targets.push(`${agentDir}/${name}/${relativeFile}`);
      }
    }
  }
  return targets;
}

/** List `<dir>/*.md` entries, excluding README.md. Used to pick up learning-loop
 *  buckets without resolving hidden or non-markdown files. */
function listBucketMarkdown(ctx: AuditContext, dir: string): string[] {
  if (!ctx.fs.exists(dir)) return [];
  return ctx.fs
    .listDir(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => `${dir}${name}`);
}

/** Run content-quality checks across the configured documentation targets. */
export function runContentQualityChecks(ctx: AuditContext): {
  findings: ContentFinding[];
  filesScanned: number;
} {
  const findings: ContentFinding[] = [];
  let filesScanned = 0;
  for (const rel of resolveTargets()) {
    if (!ctx.fs.exists(rel)) continue;
    const text = ctx.fs.readFile(rel);
    if (text === null) continue;
    filesScanned++;
    findings.push(...scanContentQuality(rel, text, "full"));
  }
  for (const dir of LEARNING_LOOP_DIRS) {
    for (const rel of listBucketMarkdown(ctx, dir)) {
      const text = ctx.fs.readFile(rel);
      if (text === null) continue;
      filesScanned++;
      findings.push(...scanContentQuality(rel, text, "restricted"));
    }
  }
  return { findings, filesScanned };
}
