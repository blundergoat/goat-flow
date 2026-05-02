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
 * detector families - toggled on lines starting with ``` (after trimming).
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

/** Static target scope for full content-quality checks: truth-bearing prose.
 *  Learning-loop buckets (footguns/lessons) and ADR files are resolved
 *  separately at scan time - see LEARNING_LOOP_DIRS and listDecisionMarkdown. */
const STATIC_QUALITY_TARGETS = [
  // Hot-path instruction files
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  ".github/copilot-instructions.md",
  // Canonical docs
  ".goat-flow/architecture.md",
  ".goat-flow/code-map.md",
  ".goat-flow/glossary.md",
  // Shared skill doctrine
  ".goat-flow/skill-reference/skill-preamble.md",
  ".goat-flow/skill-reference/skill-conventions.md",
  ".goat-flow/skill-reference/browser-use.md",
  ".goat-flow/skill-reference/page-capture.md",
  ".goat-flow/skill-reference/skill-quality-testing.md",
  ".goat-flow/skill-reference/skill-quality-testing/tdd-iteration.md",
  ".goat-flow/skill-reference/skill-quality-testing/adversarial-framing.md",
  ".goat-flow/skill-reference/skill-quality-testing/deployment.md",
  // Public docs
  "docs/cli.md",
  "docs/skills.md",
  "docs/audit-and-quality.md",
  // ADR index. ADR-NNN files are discovered dynamically so new decisions do
  // not fall out of content-quality coverage.
  ".goat-flow/decisions/README.md",
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

const DECISIONS_DIR = ".goat-flow/decisions/";

/** Learning-loop buckets. Scanned in restricted mode (no vague-term checks)
 *  because the Symptoms/Why/Evidence sections describe past incidents and
 *  legitimately use words like "correctly"/"properly". Generic-instruction and
 *  non-actionable detectors still apply - those patterns should never appear
 *  in actionable Prevention blocks. */
const LEARNING_LOOP_DIRS = [
  ".goat-flow/footguns/",
  ".goat-flow/lessons/",
  ".goat-flow/patterns/",
] as const;

const VAGUE_TERMS: { term: string; suggestion: (line: string) => string }[] = [
  {
    term: "properly",
    /** Build the "properly" suggestion. */
    suggestion: (line) =>
      /format|style/i.test(line)
        ? "Specify the exact format or style guide (e.g. 'Follow Prettier defaults' or 'Use 2-space indentation')."
        : "Be specific about the expected format or standard (e.g. 'Use 2-space indentation' instead of 'Format properly').",
  },
  {
    term: "correctly",
    /** Build the "correctly" suggestion. */
    suggestion: (_line) =>
      "Define what 'correct' means with measurable criteria.",
  },
  {
    term: "appropriately",
    /** Build the "appropriately" suggestion. */
    suggestion: (_line) =>
      "Describe the specific situation and the expected response.",
  },
];

const GENERIC_INSTRUCTIONS: PatternRule[] = [
  {
    rule: "generic-best-practices",
    pattern: /follow\s+best\s+practices/i,
    severity: "warning",
    /** Build the generic best practices finding message. */
    message: () =>
      "Avoid generic 'follow best practices'. Be specific about which practice applies here.",
  },
  {
    rule: "generic-good-code",
    pattern: /write\s+good\s+code/i,
    severity: "warning",
    /** Build the generic good code finding message. */
    message: () =>
      "Avoid vague 'write good code'. Be specific about the standards the reader must meet.",
  },
  {
    rule: "generic-correct",
    pattern: /do\s+it\s+correctly/i,
    severity: "warning",
    /** Build the generic correct finding message. */
    message: () =>
      "Avoid generic 'do it correctly'. Define what correct means with measurable criteria.",
  },
  {
    rule: "generic-common-sense",
    pattern: /use\s+common\s+sense/i,
    severity: "warning",
    /** Build the generic common sense finding message. */
    message: () =>
      "Avoid 'use common sense'. Document the specific decision criteria the reader should apply.",
  },
  {
    rule: "generic-be-careful",
    pattern: /be\s+careful/i,
    severity: "warning",
    /** Build the generic be careful finding message. */
    message: () =>
      "Instead of 'be careful', specify the exact risk and mitigation.",
  },
];

const NON_ACTIONABLE: PatternRule[] = [
  {
    // `note` dropped from cclint's term list - too many false positives on
    // goat-flow's own docs: label usage (`Note:`), direct-object verbs
    // (`note them`, `Note what X`) all match cclint's `(?!\s+to\s+)` guard
    // but are legitimate instructions. `remember | keep in mind | don't
    // forget` retain the non-actionable signal without the label clash.
    rule: "non-actionable-remember",
    pattern: /(?:\bremember\b|\bkeep in mind\b|\bdon'?t forget\b)(?!\s+to\s+)/i,
    severity: "info",
    /** Build the non actionable remember finding message. */
    message: (match) =>
      `"${match}" without "to <verb>" has no action. State what the reader must do.`,
  },
  {
    rule: "non-actionable-important",
    pattern: /it'?s\s+important(?!\s+to\s+)/i,
    severity: "info",
    /** Build the non actionable important finding message. */
    message: () =>
      '"it\'s important" without "to <verb>" leaves the expected action unspecified.',
  },
  {
    rule: "non-actionable-should-know",
    pattern: /you\s+should\s+know(?!\s+that\s+)/i,
    severity: "info",
    /** Build the non actionable should know finding message. */
    message: () =>
      '"you should know" without "that <fact>" has no propositional content.',
  },
];

/**
 * Legacy v1.0 six-step Execution Loop drift (M19-9a). Matches only the
 * arrow-sequence declaration, not incidental historical prose mentioning
 * CLASSIFY or LOG. All four reviewed v1.2 consumer projects (ambient-scribe,
 * sus-form-detector, blundergoat-platform, rampart) shipped AGENTS.md /
 * GEMINI.md with the legacy six-step loop while CLAUDE.md + skill-preamble.md
 * used the v1.2 four-step. See `.goat-flow/tasks/1.2.0/M19-setup-signal-hardening.md`
 * slice M19-9a.
 */
const LEGACY_EXECUTION_LOOP: PatternRule[] = [
  {
    rule: "legacy-execution-loop-classify",
    pattern: /\bREAD\s*(?:→|-+>)\s*CLASSIFY\s*(?:→|-+>)\s*SCOPE\b/i,
    severity: "warning",
    /** Build the legacy loop CLASSIFY finding message. */
    message: () =>
      "Legacy v1.0 Execution Loop detected (READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG). The v1.2 loop is four steps: READ → SCOPE → ACT → VERIFY. Rewrite per workflow/setup/reference/execution-loop.md.",
  },
  {
    rule: "legacy-execution-loop-trailing-log",
    pattern: /\bVERIFY\s*(?:→|-+>)\s*LOG\b/i,
    severity: "warning",
    /** Build the legacy loop trailing-LOG finding message. */
    message: () =>
      "Legacy 'VERIFY → LOG' step detected. The v1.2 Execution Loop ends at VERIFY; session logging is finalised at step-06, not as an inline loop step.",
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

/** Apply a PatternRule array to a line, accumulating any matches into findings. */
function applyPatternRules(
  rules: PatternRule[],
  line: string,
  lineNumber: number,
  path: string,
  findings: ContentFinding[],
): void {
  for (const rule of rules) {
    const match = rule.pattern.exec(line);
    if (!match) continue;
    findings.push({
      severity: rule.severity,
      rule: rule.rule,
      path,
      line: lineNumber,
      message: rule.message(match[0], line),
    });
  }
}

/** Apply vague-term detection to a line (full mode only). */
function applyVagueTerms(
  line: string,
  lineNumber: number,
  path: string,
  findings: ContentFinding[],
): void {
  for (const { term, suggestion } of VAGUE_TERMS) {
    const rx = new RegExp(`\\b${term}\\b`, "i");
    const match = rx.exec(line);
    if (!match) continue;
    findings.push({
      severity: "info",
      rule: "vague-term",
      path,
      line: lineNumber,
      message: `Vague term "${match[0]}" - no measurable standard.`,
      suggestion: suggestion(line),
    });
  }
}

/** Scan one line for vague, generic, non-actionable, or legacy-loop guidance. */
function scanLine(
  line: string,
  lineNumber: number,
  path: string,
  findings: ContentFinding[],
  mode: ScanMode = "full",
): void {
  if (mode === "full") {
    applyVagueTerms(line, lineNumber, path, findings);
  }
  applyPatternRules(GENERIC_INSTRUCTIONS, line, lineNumber, path, findings);
  applyPatternRules(NON_ACTIONABLE, line, lineNumber, path, findings);
  if (!path.startsWith("workflow/setup/")) {
    applyPatternRules(LEGACY_EXECUTION_LOOP, line, lineNumber, path, findings);
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

/** List current ADR files. */
function listDecisionMarkdown(ctx: AuditContext): string[] {
  if (!ctx.fs.exists(DECISIONS_DIR)) return [];
  return ctx.fs
    .listDir(DECISIONS_DIR)
    .filter((name) => /^ADR-\d{3}-.+\.md$/.test(name))
    .sort()
    .map((name) => `${DECISIONS_DIR}${name}`);
}

/** Full list of target paths, including every installed skill SKILL.md. */
function resolveTargets(ctx: AuditContext): string[] {
  const targets = new Set<string>([
    ...STATIC_QUALITY_TARGETS,
    ...listDecisionMarkdown(ctx),
  ]);
  for (const agentDir of getInstalledSkillRoots()) {
    for (const name of SKILL_NAMES) {
      for (const relativeFile of getSkillFiles(name)) {
        targets.add(`${agentDir}/${name}/${relativeFile}`);
      }
    }
  }
  return [...targets];
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
  for (const rel of resolveTargets(ctx)) {
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
