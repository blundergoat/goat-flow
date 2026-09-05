/**
 * Inspect the selected project's guidance for prose, readiness, and evidence problems shown by audit.
 *
 * Curated documents and installed skills receive prose checks; learning-loop buckets omit vague-word warnings.
 * Additional Markdown receives readiness and semantic-anchor checks, with local working artifacts excluded.
 *
 * Fence, heading, and anchor parsers preserve source line numbers so each finding points to the text the author can repair.
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
 * Describe one prose pattern and the finding shown to the document's author.
 *
 * Each rule has a stable audit identifier, severity, and message builder for a matching source line.
 * The prose scanner applies these rules outside fenced blocks and skips table header labels.
 */
interface PatternRule {
  rule: string;
  // Compiled regex (case-insensitive, word-boundary handled inside the pattern).
  pattern: RegExp;
  severity: ContentSeverity;
  // Turn the matched wording into the explanation displayed beside its source line.
  message: (match: string, line: string) => string;
  // Optional replacement builder in the rule descriptor; undefined means no replacement wording is supplied.
  suggestion?: (match: string, line: string) => string | undefined;
}

/**
 * Choose whether audit flags vague wording on this documentation surface.
 *
 * Full mode includes vague-word checks for current guidance.
 * Restricted mode omits those warnings from incident prose while retaining the other applicable checks.
 */
type ScanMode = "full" | "restricted";

// Curated guidance receives full prose checks; learning-loop buckets and ADR files are discovered separately.
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
  // Discover ADR files separately so a newly added decision is covered without changing this target list.
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

// Incident prose skips vague-word warnings; the other applicable detectors still inspect every readable bucket.
const LEARNING_LOOP_DIRS = [
  ".goat-flow/learning-loop/footguns/",
  ".goat-flow/learning-loop/lessons/",
  ".goat-flow/learning-loop/patterns/",
] as const;

const VAGUE_TERMS: { term: string; suggestion: (line: string) => string }[] = [
  {
    term: "properly",
    // Ask the author for a concrete format or standard, using formatting advice when the source mentions format or style.
    suggestion: (line) =>
      /format|style/i.test(line)
        ? "Specify the exact format or style guide (e.g. 'Follow Prettier defaults' or 'Use 2-space indentation')."
        : "Be specific about the expected format or standard (e.g. 'Use 2-space indentation' instead of 'Format properly').",
  },
  {
    term: "correctly",
    // Ask the author to define a measurable result readers can verify.
    suggestion: (_line) =>
      "Define what 'correct' means with measurable criteria.",
  },
  {
    term: "appropriately",
    // Ask the author to connect a specific situation with its expected response.
    suggestion: (_line) =>
      "Describe the specific situation and the expected response.",
  },
];

const GENERIC_INSTRUCTIONS: PatternRule[] = [
  {
    rule: "generic-best-practices",
    pattern: /follow\s+best\s+practices/i,
    severity: "warning",
    // Tell the author which unnamed practice needs a concrete instruction.
    message: () =>
      "Avoid generic 'follow best practices'. Be specific about which practice applies here.",
  },
  {
    rule: "generic-good-code",
    pattern: /write\s+good\s+code/i,
    severity: "warning",
    // Ask for standards readers can apply when the instruction only requests good code.
    message: () =>
      "Avoid vague 'write good code'. Be specific about the standards the reader must meet.",
  },
  {
    rule: "generic-correct",
    pattern: /do\s+it\s+correctly/i,
    severity: "warning",
    // Request measurable criteria for an instruction that gives no test of success.
    message: () =>
      "Avoid generic 'do it correctly'. Define what correct means with measurable criteria.",
  },
  {
    rule: "generic-common-sense",
    pattern: /use\s+common\s+sense/i,
    severity: "warning",
    // Ask for explicit instructions when the author relies on the reader's common sense.
    message: () =>
      "Avoid 'use common sense'. Document the specific decision criteria the reader should apply.",
  },
  {
    rule: "generic-be-careful",
    pattern: /be\s+careful/i,
    severity: "warning",
    // Ask the author to name the risk and the checks readers can use to avoid it.
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
    // Identify a reminder that does not tell the reader what action to perform.
    message: (match) =>
      `"${match}" without "to <verb>" has no action. State what the reader must do.`,
  },
  {
    rule: "non-actionable-important",
    pattern: /it'?s\s+important(?!\s+to\s+)/i,
    severity: "info",
    // Ask the author to replace an importance claim with the action the reader needs.
    message: () =>
      '"it\'s important" without "to <verb>" leaves the expected action unspecified.',
  },
  {
    rule: "non-actionable-should-know",
    pattern: /you\s+should\s+know(?!\s+that\s+)/i,
    severity: "info",
    // Ask for a concrete instruction when the author only says what readers should know.
    message: () =>
      '"you should know" without "that <fact>" has no propositional content.',
  },
];

// Match retired arrow-sequence steps without flagging ordinary mentions of CLASSIFY or LOG in historical prose.
const LEGACY_EXECUTION_LOOP: PatternRule[] = [
  {
    rule: "legacy-execution-loop-classify",
    pattern: /\bREAD\s*(?:→|-+>)\s*CLASSIFY\s*(?:→|-+>)\s*SCOPE\b/i,
    severity: "warning",
    // Point an author using the retired CLASSIFY sequence to the current execution-loop reference.
    message: () =>
      "Legacy v1.0 Execution Loop detected (READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG). The v1.2 loop is four steps: READ → SCOPE → ACT → VERIFY. Rewrite per workflow/setup/reference/execution-loop.md.",
  },
  {
    rule: "legacy-execution-loop-trailing-log",
    pattern: /\bVERIFY\s*(?:→|-+>)\s*LOG\b/i,
    severity: "warning",
    // Explain which retired trailing step the author must remove from the declared execution loop.
    message: () =>
      "Legacy 'VERIFY → LOG' step detected. The v1.2 Execution Loop ends at VERIFY; session logging is finalised at step-06, not as an inline loop step.",
  },
];

const PROMPT_WRAPPER_RESIDUE: PatternRule[] = [
  {
    rule: "prompt-wrapper-residue",
    pattern: /<\/?(?:content|invoke)\b[^>]*>/i,
    severity: "warning",
    // Identify pasted invocation tags so the author can remove them from repository prose.
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
    // Give authors the current installed and template locations for an obsolete playbook path.
    message: () =>
      "Stale skill-playbooks path found. Current installed playbooks live under .goat-flow/skill-docs/playbooks/; workflow templates live under workflow/skills/playbooks/.",
  },
];

const HISTORICAL_REFERENCE_DIRS = [DECISIONS_DIR, ...LEARNING_LOOP_DIRS];

// Preserve old paths in learning-loop history while rejecting them in active guidance.
function shouldScanStaleSkillPlaybooksPath(path: string): boolean {
  return !HISTORICAL_REFERENCE_DIRS.some((dir) => path.startsWith(dir));
}

// Headings that explicitly advertise unanswered readiness work.
const READINESS_SECTION_HEADING =
  /\b(?:open|pending|unresolved)\s+(?:questions?|issues?)\b/i;

/**
 * Record the visible title and depth used to track a readiness section.
 *
 * A matching title opens the section whose unfinished answers audit reports.
 * The depth lets a later peer or parent heading end that section.
 */
interface ReadinessHeading {
  level: number;
  text: string;
}

/**
 * Read a hash-prefixed heading to locate the author's open or unresolved questions section.
 *
 * @param line - source line; empty text provides no heading
 * @returns heading depth and visible text, or null when no usable heading was parsed; reads the line without changing the document
 */
function parseAtxHeading(line: string): ReadinessHeading | null {
  // An author can indent "## Open Questions" by up to three spaces and still create a heading readers see.
  const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  // Not a heading line at all, so there is no section boundary here.
  if (!match?.[1]) return null;
  // Without captured heading text, the caller has no section title to match.
  if (match[2] === undefined) return null;
  return { level: match[1].length, text: match[2] };
}

/**
 * Read an underline and its preceding title to identify another way authors can mark a readiness section.
 *
 * @param line - potential underline; empty or unmatched text supplies no heading boundary
 * @param previousLine - preceding visible title; empty or whitespace-only text supplies no heading
 * @returns heading depth and title, or null when this pair does not form a recognized heading
 */
function parseSetextHeading(
  line: string,
  previousLine: string,
): ReadinessHeading | null {
  const underline = /^ {0,3}(=+|-+)[\t ]*$/.exec(line)?.[1];
  // Without a recognized underline, this pair does not open or close a readiness section.
  if (!underline) return null;
  const text = previousLine.trim();
  // An empty preceding line provides no section title for audit to recognize.
  if (text.length === 0) return null;
  return { level: underline[0] === "=" ? 1 : 2, text };
}

/**
 * Track whether the current source line belongs to an open or unresolved questions section.
 *
 * @param line - current source line; ordinary prose retains the current section
 * @param nextLine - possible setext underline; empty at end of file supplies no underlined heading
 * @param currentLevel - active readiness depth; null means the scan is outside such a section
 * @returns active readiness depth, or null when no readiness section applies
 */
function nextReadinessHeadingLevel(
  line: string,
  nextLine: string,
  currentLevel: number | null,
): number | null {
  // Try the hash heading first, then an underline on the next line, so both authored heading styles receive coverage.
  const heading = parseAtxHeading(line) ?? parseSetextHeading(nextLine, line);
  // Ordinary prose keeps the current section, allowing its unfinished answers to be reported.
  if (heading === null) return currentLevel;
  // A heading that names open or unresolved work starts a readiness section.
  if (READINESS_SECTION_HEADING.test(heading.text)) return heading.level;
  // A peer or parent heading ends the readiness section; deeper subsections remain part of it.
  if (currentLevel !== null && heading.level <= currentLevel) return null;
  return currentLevel;
}

/**
 * Find a recognized placeholder left in an author's readiness answer.
 * Mask inline code for TODO, TBD, and ??? checks so examples of those markers are not reported as unfinished work.
 *
 * @param line - readiness source line; empty prose alone is not a recognized placeholder
 * @returns marker text for the finding; null means no recognized marker was found, not that the answer is complete
 */
function unresolvedContentMarker(line: string): string | null {
  const markerText = maskInlineCodeSpansOnLine(line);
  const todoMarker = /\b(?:TBD|TODO)\b/i.exec(markerText);

  // The author parked the answer with a to-do marker, so name it back to them.
  if (todoMarker) return todoMarker[0];

  // "???" is the other placeholder authors leave when they mean to come back to it.
  if (markerText.includes("???")) return "???";

  // Strip list and table edges so a bare Answer: field is still recognized in those layouts.
  const normalized = line
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\|\s*/, "")
    .replace(/\s*\|$/, "")
    .trim();
  // An Answer: label with no response leaves the readiness question unresolved.
  if (/^(?:\*\*|__)?Answer(?:\*\*|__)?\s*:\s*(?:\*\*|__)?$/i.test(normalized)) {
    return "empty Answer:";
  }
  return null;
}

// Scan only explicit readiness sections, ignoring examples in fenced blocks.
function scanUnresolvedReadiness(path: string, text: string): ContentFinding[] {
  const findings: ContentFinding[] = [];
  // Mask commented-out text and fenced examples so they cannot open or close the author's visible readiness section.
  const lines = maskNonRenderedMarkdown(text).split(/\r?\n/);
  let readinessHeadingLevel: number | null = null;

  // Inspect visible lines in order so headings determine which later answers receive readiness checks.
  for (let index = 0; index < lines.length; index++) {
    // A missing current or following line contributes empty text, which cannot introduce a readiness heading.
    const line = lines[index] ?? "";
    readinessHeadingLevel = nextReadinessHeadingLevel(
      line,
      lines[index + 1] ?? "",
      readinessHeadingLevel,
    );
    // Only text inside a recognized readiness section contributes an unfinished-answer finding.
    if (readinessHeadingLevel !== null) {
      applyUnresolvedContentMarker(line, index + 1, path, findings);
    }
  }

  return findings;
}

/**
 * Append a readiness warning for the author when this line contains a recognized unfinished answer.
 * Mutates the caller's findings; a line without a marker adds nothing.
 *
 * @param line - source line; empty prose alone produces no marker
 * @param lineNumber - 1-based source location displayed on the finding
 * @param path - source path displayed in audit; empty leaves the repair file unspecified
 * @param findings - accumulator appended to in place; unchanged when no marker is found
 * @returns nothing; any detected marker is represented by the appended finding
 */
function applyUnresolvedContentMarker(
  line: string,
  lineNumber: number,
  path: string,
  findings: ContentFinding[],
): void {
  const marker = unresolvedContentMarker(line);
  // No recognized placeholder means this line adds no readiness warning.
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

// Recognize a table separator so the preceding header row is treated as labels rather than actionable prose.
function isTableSeparatorLine(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

/**
 * Read each configured pattern and append its matching explanation for the document's author.
 * Mutates the caller's findings; nonmatching rules add nothing.
 *
 * @param rules - rules in display order; an empty list adds no findings
 * @param line - source line matched against each rule
 * @param lineNumber - 1-based source location displayed on each finding
 * @param path - source path displayed in audit; empty leaves the repair file unspecified
 * @param findings - accumulator appended to in place; unchanged when no rule matches
 * @returns nothing; matched rules contribute their own appended findings
 */
function applyPatternRules(
  rules: PatternRule[],
  line: string,
  lineNumber: number,
  path: string,
  findings: ContentFinding[],
): void {
  // Apply every selected rule so one source line can explain several distinct repairs.
  for (const rule of rules) {
    const match = rule.pattern.exec(line);
    // A rule that does not match this wording has no repair to suggest.
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
 * Read a full-mode source line for configured vague words and append advice that asks the author for a measurable standard.
 * Mutates the caller's findings once for each configured term present on the line.
 *
 * @param line - source line; empty text matches no configured vague word
 * @param lineNumber - 1-based source location displayed on the finding
 * @param path - source path displayed in audit; empty leaves the repair file unspecified
 * @param findings - accumulator appended to in place; unchanged when no term matches
 * @returns nothing; detected terms contribute their own appended findings
 */
function applyVagueTerms(
  line: string,
  lineNumber: number,
  path: string,
  findings: ContentFinding[],
): void {
  // Check each configured vague word so its finding can offer the corresponding concrete-writing advice.
  for (const { term, suggestion } of VAGUE_TERMS) {
    const rx = new RegExp(`\\b${term}\\b`, "i");
    const match = rx.exec(line);
    // A term absent from this source line needs no vague-word warning.
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

// Apply the prose rules appropriate to current guidance, historical evidence, or setup references.
function scanLine(
  line: string,
  lineNumber: number,
  path: string,
  findings: ContentFinding[],
  mode: ScanMode = "full",
): void {
  // Current guidance receives vague-word warnings; incident prose omits them.
  if (mode === "full") {
    applyVagueTerms(line, lineNumber, path, findings);
  }
  applyPatternRules(GENERIC_INSTRUCTIONS, line, lineNumber, path, findings);
  applyPatternRules(NON_ACTIONABLE, line, lineNumber, path, findings);
  applyPatternRules(PROMPT_WRAPPER_RESIDUE, line, lineNumber, path, findings);
  // Current guidance must use the current playbook path; historical evidence can retain the path it records.
  if (shouldScanStaleSkillPlaybooksPath(path)) {
    applyPatternRules(
      STALE_SKILL_PLAYBOOKS_PATH,
      line,
      lineNumber,
      path,
      findings,
    );
  }
  // Setup references can describe retired loops as migration guidance; other surfaces receive obsolete-loop warnings.
  if (!path.startsWith("workflow/setup/")) {
    applyPatternRules(LEGACY_EXECUTION_LOOP, line, lineNumber, path, findings);
  }
}

/**
 * Scan one document's prose and readiness answers, preserving source locations for the author's repairs.
 * Prose rules skip fenced blocks and table header labels; restricted mode omits vague-word warnings.
 *
 * @param path - source path used in findings and surface-specific rules
 * @param text - Markdown or instruction text; empty content produces no findings
 * @param mode - full includes vague-word warnings; restricted omits those warnings from incident prose
 * @returns detected findings; empty means the enabled rules found nothing, not that every instruction is complete
 */
export function scanContentQuality(
  path: string,
  text: string,
  mode: ScanMode = "full",
): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const lines = text.split(/\r?\n/);
  let activeFence: MarkdownFence | null = null;
  // Visit source lines in order to keep code-fence state and reported repair locations aligned.
  for (let i = 0; i < lines.length; i++) {
    // Missing line text is empty; null fence state means the reader is outside a fenced example.
    const line = lines[i] ?? "";
    const fenceState = advanceMarkdownFenceState(line, activeFence);
    activeFence = fenceState.activeFence;
    // Fence markers and enclosed examples are excluded from prose instructions shown as findings.
    if (fenceState.isFenceLine || activeFence !== null) continue;
    // A following separator makes this row table labels, so its words are not treated as instructions.
    if (line.includes("|") && isTableSeparatorLine(lines[i + 1] ?? "")) {
      continue;
    }
    scanLine(line, i + 1, path, findings, mode);
  }
  findings.push(...scanUnresolvedReadiness(path, text));
  return findings;
}

/**
 * Report a cited literal that no longer appears in an existing evidence target.
 *
 * Missing files remain owned by path-integrity checks.
 * Historical decisions still need resolvable anchors so readers can find their cited proof.
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

// Read current ADR filenames in deterministic order so new decisions receive prose-quality coverage automatically.
function listDecisionMarkdown(ctx: AuditContext): string[] {
  // A project without the decisions directory contributes no ADR targets to this scan.
  if (!ctx.fs.exists(DECISIONS_DIR)) return [];
  return ctx.fs
    .listDir(DECISIONS_DIR)
    .filter((name) => /^ADR-\d{3}-.+\.md$/.test(name))
    .sort()
    .map((name) => `${DECISIONS_DIR}${name}`);
}

/**
 * Collect current guidance, ADRs, and installed skill files into one prose-quality scan list.
 * Deduplicate their paths because separate setup sources can refer to the same document.
 */
function resolveTargets(ctx: AuditContext): string[] {
  const targets = new Set<string>([
    ...STATIC_QUALITY_TARGETS,
    ...listDecisionMarkdown(ctx),
  ]);
  // Include installed skill copies so audit checks the guidance the user's agents load.
  for (const agentDir of getInstalledSkillRoots()) {
    // Each canonical skill contributes its files under this agent's installed skill root.
    for (const name of getSkillNames()) {
      // Include the skill's declared references as well as its main contract in the prose scan.
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

// Keep only the stable README anchors committed beneath local-state trees.
function isCommittedLocalStateReadme(path: string): boolean {
  return COMMITTED_LOCAL_STATE_READMES.has(path);
}

// Exclude local working artifacts from the repository-wide evidence sweep.
function isLocalMarkdownArtifact(path: string): boolean {
  // Agent workspaces, logs, and temporary folders are excluded from project-wide evidence findings.
  if (LOCAL_MARKDOWN_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return true;
  }
  // Top-level TODO_ and docs_ scratch files remain outside the maintained evidence scan.
  if (/^(?:TODO_|docs_).+\.md$/i.test(path)) return true;
  // Keep the maintained README anchors in local-state trees while excluding their working artifacts.
  return GOAT_LOCAL_STATE_PREFIXES.some(
    (prefix) => path.startsWith(prefix) && !isCommittedLocalStateReadme(path),
  );
}

/**
 * Discover additional Markdown for readiness and semantic-anchor checks after curated prose scans.
 * Sort filesystem results to preserve the order of findings across repeated audits.
 *
 * @param ctx - audit context supplying the selected project's filesystem
 * @param scanned - paths already covered; an empty set excludes no previously scanned files
 * @returns additional eligible paths in stable order; empty means no further Markdown was discovered
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

// Read immediate Markdown entries other than README.md so learning-loop buckets receive incident-prose checks.
function listBucketMarkdown(ctx: AuditContext, dir: string): string[] {
  // A missing learning-loop directory supplies no incident buckets to inspect.
  if (!ctx.fs.exists(dir)) return [];
  return ctx.fs
    .listDir(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => `${dir}${name}`);
}

/**
 * Read the configured documentation targets and report prose, readiness, and evidence findings for the author.
 * Missing or unreadable files are skipped, leaving available guidance covered without treating a skipped file as a pass.
 *
 * @param ctx - selected project's read-only filesystem and audit context
 * @returns detected findings and readable-file count; zero files means no target was scanned
 */
export function runContentQualityChecks(ctx: AuditContext): {
  findings: ContentFinding[];
  filesScanned: number;
} {
  const findings: ContentFinding[] = [];
  const scanned = new Set<string>();
  let filesScanned = 0;
  // Scan curated current guidance and installed skills with the full prose rules.
  for (const rel of resolveTargets(ctx)) {
    // A missing target contributes no prose result; other audit checks own missing-file guidance.
    if (!ctx.fs.exists(rel)) continue;
    const text = ctx.fs.readFile(rel);
    // Unreadable content cannot supply findings or count as a scanned document.
    if (text === null) continue;
    scanned.add(rel);
    filesScanned++;
    findings.push(...scanContentQuality(rel, text, "full"));
    findings.push(...scanSemanticAnchorQuality(ctx, rel, text));
  }
  // Check each learning-loop area using the rules appropriate to recorded incidents.
  for (const dir of LEARNING_LOOP_DIRS) {
    // Each discovered incident bucket contributes prose and evidence findings.
    for (const rel of listBucketMarkdown(ctx, dir)) {
      const text = ctx.fs.readFile(rel);
      // A bucket that cannot be read supplies no incident-prose or evidence result.
      if (text === null) continue;
      scanned.add(rel);
      filesScanned++;
      findings.push(...scanContentQuality(rel, text, "restricted"));
      findings.push(...scanSemanticAnchorQuality(ctx, rel, text));
    }
  }
  // Inspect remaining eligible Markdown for unfinished readiness answers and stale evidence anchors.
  for (const rel of resolveAdditionalEvidenceTargets(ctx, scanned)) {
    const text = ctx.fs.readFile(rel);
    // An unreadable additional document contributes no evidence finding or scanned-file count.
    if (text === null) continue;
    scanned.add(rel);
    filesScanned++;
    findings.push(...scanUnresolvedReadiness(rel, text));
    findings.push(...scanSemanticAnchorQuality(ctx, rel, text));
  }
  return { findings, filesScanned };
}
