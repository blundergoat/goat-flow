/**
 * Cold-path content quality linting over truth-bearing prose: instruction files, installed skills, and canonical docs.
 * Logic is ported inline from cclint and agnix, because the project accepts no new runtime dependencies.
 *
 * Three detector families run over every scanned file:
 *
 * - Vague terms, a conservative three-word subset: `properly`, `correctly`, `appropriately`. INFO severity.
 * - Generic instructions, five cclint patterns such as "follow best practices". WARNING severity.
 * - Non-actionable statements, three cclint patterns such as a bare "remember" with no "to". INFO severity.
 *
 * One shared `inCodeBlock` state machine skips fenced blocks for all three families, which is the bug both cclint rules had.
 */
import type { AuditContext } from "./types.js";
import type { ContentFinding, ContentSeverity } from "./types.js";
import { getSkillNames } from "../constants.js";
import { getInstalledSkillRoots, getSkillFiles } from "../manifest/manifest.js";
import {
  maskInlineCodeSpansOnLine,
  maskNonRenderedMarkdown,
} from "../rendered-markdown.js";
import {
  advanceMarkdownFenceState,
  evaluateSearchAnchors,
  type MarkdownFence,
} from "../facts/shared/search-anchors.js";
import { STANDALONE_PLAYBOOK_FILES } from "./skill-docs-contract.js";

/**
 * Regex detector descriptor for one prose-quality rule.
 *
 * The matcher only sees one non-code-block line at a time, so each rule owns
 * both the stable audit id and the remediation text needed for that local hit.
 */
interface PatternRule {
  rule: string;
  /** Compiled regex (case-insensitive, word-boundary handled inside the pattern). */
  pattern: RegExp;
  severity: ContentSeverity;
  message: (match: string, line: string) => string;
  suggestion?: (match: string, line: string) => string | undefined;
}

/**
 * Scan mode for a target.
 *
 * - `full`: all three detector families, for surfaces that must read as current instruction.
 * - `restricted`: generic-instruction and non-actionable only, for learning-loop surfaces whose incident prose
 *   legitimately uses vague-adjacent words such as "projects that correctly omitted those fields".
 */
type ScanMode = "full" | "restricted";

/** Static target scope for full content-quality checks: truth-bearing prose.
 *  Learning-loop buckets (footguns/lessons) and ADR files are resolved
 *  separately at scan time - see LEARNING_LOOP_DIRS and listDecisionMarkdown. */
const STATIC_QUALITY_TARGETS = [
  // Hot-path instruction files
  "CLAUDE.md",
  "AGENTS.md",
  ".github/copilot-instructions.md",
  // Canonical docs
  ".goat-flow/architecture.md",
  ".goat-flow/code-map.md",
  ".goat-flow/glossary.md",
  // Shared meta references (composed into every skill)
  ".goat-flow/skill-docs/README.md",
  ".goat-flow/skill-docs/skill-preamble.md",
  ".goat-flow/skill-docs/skill-conventions.md",
  // Standalone playbooks (loaded on-demand by skills/agents)
  ".goat-flow/skill-docs/playbooks/README.md",
  ...STANDALONE_PLAYBOOK_FILES,
  ".goat-flow/skill-docs/skill-quality-testing/README.md",
  ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
  ".goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md",
  ".goat-flow/skill-docs/skill-quality-testing/deployment.md",
  // Public docs
  "docs/cli.md",
  "docs/skills.md",
  "docs/audit-and-quality.md",
  // ADR index. ADR-NNN files are discovered dynamically so new decisions do
  // not fall out of content-quality coverage.
  ".goat-flow/learning-loop/decisions/README.md",
  ".goat-flow/learning-loop/decisions/INDEX.md",
  // Setup templates
  "workflow/setup/01-system-overview.md",
  "workflow/setup/02-instruction-file.md",
  "workflow/setup/03-install-skills.md",
  "workflow/setup/04-architecture-code-map.md",
  "workflow/setup/05-customise-to-project.md",
  "workflow/setup/06-final-verification.md",
  "workflow/setup/agents/claude.md",
  "workflow/setup/agents/codex.md",
  "workflow/setup/agents/antigravity.md",
  "workflow/setup/agents/copilot.md",
  "workflow/setup/reference/ADR-000-template.md",
  "workflow/setup/reference/execution-loop.md",
  "workflow/setup/reference/footguns-readme.md",
  "workflow/setup/reference/lessons-readme.md",
  "workflow/setup/reference/reference-coding-guidelines.md",
  "workflow/setup/reference/reference-polish.md",
  "workflow/setup/reference/plans-readme.md",
  "workflow/setup/reference/scratchpad-readme.md",
] as const;

const DECISIONS_DIR = ".goat-flow/learning-loop/decisions/";

/**
 * Learning-loop buckets, scanned in restricted mode.
 *
 * Symptoms, Why, and Evidence sections describe past incidents and legitimately use words like "correctly", so
 * vague-term checks would fire on honest prose; the other two detectors still apply to Prevention blocks.
 */
const LEARNING_LOOP_DIRS = [
  ".goat-flow/learning-loop/footguns/",
  ".goat-flow/learning-loop/lessons/",
  ".goat-flow/learning-loop/patterns/",
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
    // `note` dropped from cclint's term list - too many false positives on goat-flow's own docs: label usage (`Note:`), direct-object verbs (`note
    // them`, `Note what X`) all match cclint's `(?!\s+to\s+)` guard but are legitimate instructions.
    // `remember | keep in mind | don't forget` retain the non-actionable signal without the label clash.
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
 * Legacy v1.0 six-step Execution Loop drift.
 * Matches only the arrow-sequence declaration, not incidental historical prose mentioning CLASSIFY or LOG.
 *
 * Every reviewed v1.2 consumer shipped AGENTS.md with the six-step loop while CLAUDE.md used the four-step one.
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

const PROMPT_WRAPPER_RESIDUE: PatternRule[] = [
  {
    rule: "prompt-wrapper-residue",
    pattern: /<\/?(?:content|invoke)\b[^>]*>/i,
    severity: "warning",
    /** Build the prompt wrapper residue finding message. */
    message: (match) =>
      `Prompt wrapper residue "${match}" found in committed prose. Remove model/invocation wrapper tags from repository content.`,
  },
];

const STALE_SKILL_PLAYBOOKS_PATH: PatternRule[] = [
  {
    rule: "stale-skill-playbooks-path",
    pattern:
      /\.goat-flow\/skill-playbooks\/|(?<!skill-docs\/)skill-playbooks\//i,
    severity: "warning",
    /** Build the stale skill-playbooks path finding message. */
    message: () =>
      "Stale skill-playbooks path found. Current installed playbooks live under .goat-flow/skill-docs/playbooks/; workflow templates live under workflow/skills/playbooks/.",
  },
];

const HISTORICAL_REFERENCE_DIRS = [DECISIONS_DIR, ...LEARNING_LOOP_DIRS];

/** Preserve old paths in learning-loop history while rejecting them in active guidance. */
function shouldScanStaleSkillPlaybooksPath(path: string): boolean {
  return !HISTORICAL_REFERENCE_DIRS.some((dir) => path.startsWith(dir));
}

/** Headings that explicitly advertise unanswered readiness work. */
const READINESS_SECTION_HEADING =
  /\b(?:open|pending|unresolved)\s+(?:questions?|issues?)\b/i;

/** One rendered Markdown heading that can open or close a readiness section. */
interface ReadinessHeading {
  level: number;
  text: string;
}

/**
 * Read one `#`-style heading the way a reader sees it rendered.
 *
 * Used while scanning for readiness sections, so an author's "Open Questions" heading is recognised whether or not
 * they left a few spaces in front of it.
 *
 * @param line - one line of the document being audited
 * @returns the heading level and visible text, or null when the line is ordinary prose and the audit moves on; it
 *   reads the line and writes nothing, so re-running an audit never changes the document
 */
function parseAtxHeading(line: string): ReadinessHeading | null {
  // Up to three leading spaces still render as a heading, so an indented "## Open Questions" the
  // author sees on screen must be scanned rather than skipped as plain text.
  const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  // Not a heading line at all, so there is no section boundary here.
  if (!match?.[1]) return null;
  // Hash marks with no text after them, which readers see as an empty heading.
  if (match[2] === undefined) return null;
  return { level: match[1].length, text: match[2] };
}

/** Parse one setext underline with its preceding visible heading text. */
function parseSetextHeading(
  line: string,
  previousLine: string,
): ReadinessHeading | null {
  const underline = /^ {0,3}(=+|-+)[\t ]*$/.exec(line)?.[1];
  if (!underline) return null;
  const text = previousLine.trim();
  if (text.length === 0) return null;
  return { level: underline[0] === "=" ? 1 : 2, text };
}

/** Track whether the current Markdown position belongs to a readiness section. */
function nextReadinessHeadingLevel(
  line: string,
  nextLine: string,
  currentLevel: number | null,
): number | null {
  const heading = parseAtxHeading(line) ?? parseSetextHeading(nextLine, line);
  if (heading === null) return currentLevel;
  if (READINESS_SECTION_HEADING.test(heading.text)) return heading.level;
  if (currentLevel !== null && heading.level <= currentLevel) return null;
  return currentLevel;
}

/**
 * Find the placeholder a user left behind in a readiness answer, if there is one.
 *
 * Use when checking a readiness section, so an unfinished answer such as a to-do note, "???", or a bare "Answer:"
 * is raised back to the author instead of shipping as though it were real.
 *
 * Backticked text is masked before matching, so an author who writes about such markers as an example is not
 * accused of leaving one behind.
 *
 * @param line - one line from a readiness section, exactly as the author wrote it
 * @returns the marker text to show the author; `null` means the line is properly filled in
 *   and nothing is reported for it
 */
function unresolvedContentMarker(line: string): string | null {
  const markerText = maskInlineCodeSpansOnLine(line);
  const todoMarker = /\b(?:TBD|TODO)\b/i.exec(markerText);

  // The author parked the answer with a to-do marker, so name it back to them.
  if (todoMarker) return todoMarker[0];

  // "???" is the other placeholder authors leave when they mean to come back to it.
  if (markerText.includes("???")) return "???";

  const normalized = line
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\|\s*/, "")
    .replace(/\s*\|$/, "")
    .trim();
  if (/^(?:\*\*|__)?Answer(?:\*\*|__)?\s*:\s*(?:\*\*|__)?$/i.test(normalized)) {
    return "empty Answer:";
  }
  return null;
}

/** Scan only explicit readiness sections, ignoring examples in fenced blocks. */
function scanUnresolvedReadiness(path: string, text: string): ContentFinding[] {
  const findings: ContentFinding[] = [];
  // Reuse the rendered Markdown view so commented-out headings and fenced
  // examples cannot change which later lines count as readiness answers.
  const lines = maskNonRenderedMarkdown(text).split(/\r?\n/);
  let readinessHeadingLevel: number | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    readinessHeadingLevel = nextReadinessHeadingLevel(
      line,
      lines[index + 1] ?? "",
      readinessHeadingLevel,
    );
    if (readinessHeadingLevel !== null) {
      applyUnresolvedContentMarker(line, index + 1, path, findings);
    }
  }

  return findings;
}

/**
 * Add one blocking content finding for a marker inside a readiness section.
 * Side effect: mutates the caller's `findings` array in place rather than returning a new list.
 * Error behavior: throws nothing; a line with no marker is reported as nothing at all.
 *
 * @param line - source line to inspect for an unresolved marker
 * @param lineNumber - 1-based line number recorded on any finding
 * @param path - repo-relative source path used in findings
 * @param findings - accumulator appended to in place; left untouched when the line is clean
 * @returns nothing; the result is the appended finding, if any
 */
function applyUnresolvedContentMarker(
  line: string,
  lineNumber: number,
  path: string,
  findings: ContentFinding[],
): void {
  const marker = unresolvedContentMarker(line);
  if (marker === null) return;
  findings.push({
    severity: "warning",
    rule: "unresolved-content-marker",
    path,
    line: lineNumber,
    message: `Unresolved readiness marker "${marker}" remains in an open, pending, or unresolved questions section.`,
    suggestion:
      "Answer the question, remove the marker, or move genuine implementation work to the task tracker.",
  });
}

/** Detect a Markdown table separator row, e.g. `| --- | :---: | ---: |`.
 *  A header row is identified by being immediately followed by such a separator;
 *  cells in header rows are column labels, not instructional prose. */
function isTableSeparatorLine(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

/**
 * Apply a PatternRule array to a line, accumulating any matches into findings.
 * Side effect: mutates the caller's `findings` array in place rather than returning a new list.
 * Error behavior: throws nothing; a rule that does not match is reported as nothing at all.
 *
 * @param rules - rules applied in order; every matching rule contributes its own finding
 * @param line - source line to match against
 * @param lineNumber - 1-based line number recorded on any finding
 * @param path - repo-relative source path used in findings
 * @param findings - accumulator appended to in place; left untouched when no rule matches
 * @returns nothing; the result is whatever was appended
 */
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

/**
 * Apply vague-term detection to a line, in full mode only.
 * Side effect: mutates the caller's `findings` array in place rather than returning a new list.
 * Error behavior: throws nothing; a line with no vague term is reported as nothing at all.
 *
 * @param line - source line to match against every configured vague term
 * @param lineNumber - 1-based line number recorded on any finding
 * @param path - repo-relative source path used in findings
 * @param findings - accumulator appended to in place; left untouched when no term matches
 * @returns nothing; the result is whatever was appended
 */
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
  applyPatternRules(PROMPT_WRAPPER_RESIDUE, line, lineNumber, path, findings);
  if (shouldScanStaleSkillPlaybooksPath(path)) {
    applyPatternRules(
      STALE_SKILL_PLAYBOOKS_PATH,
      line,
      lineNumber,
      path,
      findings,
    );
  }
  if (!path.startsWith("workflow/setup/")) {
    applyPatternRules(LEGACY_EXECUTION_LOOP, line, lineNumber, path, findings);
  }
}

/**
 * Scan one file, skipping fenced code blocks before applying prose detectors.
 *
 * Pass `mode: "restricted"` for learning-loop files to skip vague-term checks on incident prose while still
 * rejecting generic instructions.
 *
 * @param path - repo-relative path used in emitted findings and mode-specific rules
 * @param text - Markdown or instruction-file content to scan
 * @param mode - detector set to apply for the target surface
 * @returns findings outside fenced code blocks; it throws nothing, so every problem is reported as a finding and an
 *   empty array means the prose passed every enabled detector
 */
export function scanContentQuality(
  path: string,
  text: string,
  mode: ScanMode = "full",
): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const lines = text.split(/\r?\n/);
  let activeFence: MarkdownFence | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fenceState = advanceMarkdownFenceState(line, activeFence);
    activeFence = fenceState.activeFence;
    if (fenceState.isFenceLine || activeFence !== null) continue;
    if (line.includes("|") && isTableSeparatorLine(lines[i + 1] ?? "")) {
      continue;
    }
    scanLine(line, i + 1, path, findings, mode);
  }
  findings.push(...scanUnresolvedReadiness(path, text));
  return findings;
}

/**
 * Find moved literal anchors on current guidance surfaces.
 *
 * Missing files remain owned by path-integrity checks.
 *
 * An existing target with a missing needle is unambiguous drift, including in accepted ADR evidence: a historical
 * decision still needs a grep-resolvable pointer to its live proof.
 */
function scanSemanticAnchorQuality(
  ctx: AuditContext,
  path: string,
  text: string,
): ContentFinding[] {
  return evaluateSearchAnchors(ctx.fs, text, {
    allowMissingFiles: true,
    sourcePath: path,
  })
    .filter(
      (evaluation) =>
        evaluation.status === "stale" && evaluation.reason === "missing-needle",
    )
    .map((evaluation) => ({
      severity: "warning" as const,
      rule: "stale-semantic-anchor",
      path,
      line: evaluation.line,
      message: `Semantic anchor "${evaluation.needle}" no longer appears in ${evaluation.filePath}.`,
      suggestion:
        "Update the cited path or literal needle to a current grep-resolvable anchor.",
    }));
}

/**
 * List current ADR files in a deterministic order.
 *
 * ADR content is a stable truth surface, and discovering `ADR-NNN-*.md` files at runtime keeps new decisions inside content-quality coverage without
 * requiring a second hard-coded target list.
 */
function listDecisionMarkdown(ctx: AuditContext): string[] {
  if (!ctx.fs.exists(DECISIONS_DIR)) return [];
  return ctx.fs
    .listDir(DECISIONS_DIR)
    .filter((name) => /^ADR-\d{3}-.+\.md$/.test(name))
    .sort()
    .map((name) => `${DECISIONS_DIR}${name}`);
}

/**
 * Resolve the full scan target list.
 *
 * The target set is assembled here because static truth surfaces, current ADRs, and every installed skill file are maintained by different setup
 * paths; a single de-duped resolver avoids coverage drift between those sources.
 */
function resolveTargets(ctx: AuditContext): string[] {
  const targets = new Set<string>([
    ...STATIC_QUALITY_TARGETS,
    ...listDecisionMarkdown(ctx),
  ]);
  // Every installed copy of every canonical skill file is a quality target -
  // this is what makes `goat-flow audit` inspect the skills the user's agents
  // actually load, not just the templates.
  for (const agentDir of getInstalledSkillRoots()) {
    for (const name of getSkillNames()) {
      for (const relativeFile of getSkillFiles(name)) {
        targets.add(`${agentDir}/${name}/${relativeFile}`);
      }
    }
  }
  return [...targets];
}

const LOCAL_MARKDOWN_PREFIXES = [
  ".antigravitycli/",
  ".claude/projects/",
  ".claude/worktrees/",
  ".gemini/projects/",
  ".gemini/worktrees/",
  ".cursor/",
  ".tools/",
  "_temp/",
  "inbox/",
  "logs/",
  "out/",
] as const;

const GOAT_LOCAL_STATE_PREFIXES = [
  ".goat-flow/logs/",
  ".goat-flow/plans/",
  ".goat-flow/scratchpad/",
] as const;

const COMMITTED_LOCAL_STATE_READMES = new Set([
  ".goat-flow/logs/critiques/README.md",
  ".goat-flow/logs/events/README.md",
  ".goat-flow/logs/quality/README.md",
  ".goat-flow/logs/review/README.md",
  ".goat-flow/logs/security/README.md",
  ".goat-flow/logs/sessions/README.md",
  ".goat-flow/plans/README.md",
  ".goat-flow/scratchpad/README.md",
]);

/** Keep only the stable README anchors committed beneath local-state trees. */
function isCommittedLocalStateReadme(path: string): boolean {
  return COMMITTED_LOCAL_STATE_READMES.has(path);
}

/** Exclude local working artifacts from the repository-wide evidence sweep. */
function isLocalMarkdownArtifact(path: string): boolean {
  if (LOCAL_MARKDOWN_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return true;
  }
  if (/^(?:TODO_|docs_).+\.md$/i.test(path)) return true;
  return GOAT_LOCAL_STATE_PREFIXES.some(
    (prefix) => path.startsWith(prefix) && !isCommittedLocalStateReadme(path),
  );
}

/**
 * Discover Markdown not already covered by the curated prose-quality scans.
 * The result is sorted so the audit stays deterministic: glob order varies by filesystem, and an unsorted list would reorder findings between runs on
 * the same unchanged tree.
 *
 * @param ctx - audit context supplying the target filesystem
 * @param scanned - paths the curated scans already covered; these are excluded
 * @returns additional Markdown paths in stable lexicographic order; empty when everything is covered
 */
function resolveAdditionalEvidenceTargets(
  ctx: AuditContext,
  scanned: ReadonlySet<string>,
): string[] {
  return ctx.fs
    .glob("**/*.md")
    .filter((path) => !scanned.has(path) && !isLocalMarkdownArtifact(path))
    .sort();
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

/**
 * Run content-quality checks across the configured documentation targets.
 *
 * Missing files and unreadable targets are skipped; the function reports prose findings for available surfaces instead of failing the whole audit on
 * optional buckets.
 *
 * @param ctx - Audit context containing the read-only project filesystem.
 * @returns Findings plus the count of files that were actually scanned.
 */
export function runContentQualityChecks(ctx: AuditContext): {
  findings: ContentFinding[];
  filesScanned: number;
} {
  const findings: ContentFinding[] = [];
  const scanned = new Set<string>();
  let filesScanned = 0;
  for (const rel of resolveTargets(ctx)) {
    if (!ctx.fs.exists(rel)) continue;
    const text = ctx.fs.readFile(rel);
    if (text === null) continue;
    scanned.add(rel);
    filesScanned++;
    findings.push(...scanContentQuality(rel, text, "full"));
    findings.push(...scanSemanticAnchorQuality(ctx, rel, text));
  }
  for (const dir of LEARNING_LOOP_DIRS) {
    for (const rel of listBucketMarkdown(ctx, dir)) {
      const text = ctx.fs.readFile(rel);
      if (text === null) continue;
      scanned.add(rel);
      filesScanned++;
      findings.push(...scanContentQuality(rel, text, "restricted"));
      findings.push(...scanSemanticAnchorQuality(ctx, rel, text));
    }
  }
  for (const rel of resolveAdditionalEvidenceTargets(ctx, scanned)) {
    const text = ctx.fs.readFile(rel);
    if (text === null) continue;
    scanned.add(rel);
    filesScanned++;
    findings.push(...scanUnresolvedReadiness(rel, text));
    findings.push(...scanSemanticAnchorQuality(ctx, rel, text));
  }
  return { findings, filesScanned };
}
