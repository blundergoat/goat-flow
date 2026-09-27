/**
 * Checks learning-loop citations so maintainers can find evidence that moved or disappeared.
 *
 * The content audit applies the same citation rules to guidance and accepted decisions:
 * - Ignore struck text and fenced examples while preserving the author's line numbers.
 * - Extract file paths and search needles, then check literal matches in the selected project.
 * - Use path policy from reference-paths.ts and return valid or stale citation verdicts.
 */
import { posix as pathPosix } from "node:path";
import type { ReadonlyFS } from "../../types.js";
import {
  isCheckableForStaleness,
  isFileRef,
  isIntentionallyGitignored,
  type ReferenceValidationOptions,
} from "./reference-paths.js";

/**
 * File tokens and search needles in citation order.
 *
 * Match the author's citation in one of three forms:
 * - Combined path and needle in one parenthesis group (groups 1-3), including the comma between them.
 * - A bare file token (group 4) that a following search anchor may use.
 * - A standalone search anchor (groups 5-6) whose target depends on the preceding text.
 */
const SEARCH_CITATION_TOKEN_REGEX =
  /\(\s*`([^`]+)`\s*,\s*search:\s*(?:`([^`]+)`|"((?:\\.|[^"\\])*)")\s*\)|`((?:[^`]+\.[a-zA-Z0-9]{1,10}|\.[a-zA-Z0-9_-]+))`|\(search:\s*(?:`([^`]+)`|"((?:\\.|[^"\\])*)")\)/g;

/** One concrete `(search: ...)` citation after filesystem validation. */
export interface SearchAnchorEvaluation {
  filePath: string;
  needle: string;
  line: number;
  status: "valid" | "stale";
  reason: "missing-file" | "missing-needle" | "gitignored-path" | null;
  diagnostic: string | null;
}

/**
 * A citation extracted from the author's text before checking its target file.
 * SearchAnchorEvaluation adds the result of checking whether that evidence still exists.
 */
interface SearchAnchorCitation {
  filePath: string;
  needle: string;
  line: number;
}

/** One active CommonMark-style fenced code block. */
export interface MarkdownFence {
  character: "`" | "~";
  length: number;
}

/** Exclude evidence the author struck through while keeping findings aligned with the original line numbers. */
function maskStrikethroughPreservingLines(content: string): string {
  return content.replace(/~~[\s\S]*?~~/g, (span) =>
    span.replace(/[^\r\n]/g, " "),
  );
}

/** Detect an invalid fence opener so ordinary author text is not hidden from citation checks. */
function hasInvalidBacktickFenceInfo(
  fenceMarker: string,
  remainder: string,
): boolean {
  return fenceMarker[0] === "`" && remainder.includes("`");
}

/** Recognize when the author's fenced example ends so later prose can be checked again. */
function closesMarkdownFence(
  fenceMarker: string,
  remainder: string,
  activeFence: MarkdownFence,
): boolean {
  return (
    fenceMarker[0] === activeFence.character &&
    fenceMarker.length >= activeFence.length &&
    /^[ \t]*$/.test(remainder)
  );
}

/**
 * Track whether a line belongs to the author's fenced example before scanning it for citations.
 * This reads the supplied state and returns the next state without changing the document or the caller's state object.
 *
 * @param line - the author's next line; an empty line keeps the current prose or fenced-example state
 * @param activeFence - current example fence; null means ordinary prose, whose citations are checked
 * @returns next fence state and marker flag; a null activeFence means the next line is outside any fenced example
 */
export function advanceMarkdownFenceState(
  line: string,
  activeFence: MarkdownFence | null,
): { activeFence: MarkdownFence | null; isFenceLine: boolean } {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  const fenceMarker = match?.[1];
  // A line without a fence marker keeps the author's current prose or example context.
  if (fenceMarker === undefined) return { activeFence, isFenceLine: false };

  const character = fenceMarker[0] as "`" | "~";
  // A marker with no trailing text has an empty info string, which is valid when opening or closing an example.
  const remainder = match?.[2] ?? "";
  // Outside an example, a valid opening fence starts a region whose citations must be ignored.
  if (activeFence === null) {
    // A backtick inside the opener's info string makes it ordinary text; hiding it would conceal citations the author can see.
    if (hasInvalidBacktickFenceInfo(fenceMarker, remainder)) {
      return { activeFence: null, isFenceLine: false };
    }
    return {
      activeFence: { character, length: fenceMarker.length },
      isFenceLine: true,
    };
  }

  // A matching closing marker returns the author to ordinary prose, where evidence citations count again.
  if (closesMarkdownFence(fenceMarker, remainder, activeFence)) {
    return { activeFence: null, isFenceLine: true };
  }
  return { activeFence, isFenceLine: false };
}

/** Hide the author's fenced examples from citation checks while preserving the line numbers shown in findings. */
function maskMarkdownFencesPreservingLines(content: string): string {
  const visibleLines: string[] = [];
  // Each document begins in ordinary prose; a fence changes which following lines can supply evidence.
  let activeFence: MarkdownFence | null = null;

  // Carry the example boundary across lines so a multiline code sample never becomes live evidence.
  for (const line of content.split(/\r?\n/)) {
    const fenceState = advanceMarkdownFenceState(line, activeFence);
    activeFence = fenceState.activeFence;
    visibleLines.push(
      fenceState.isFenceLine || activeFence !== null
        ? line.replace(/./g, " ")
        : line,
    );
  }

  return visibleLines.join("\n");
}

/**
 * Normalize a search needle so an author can wrap a citation across lines without changing the literal it names.
 * Decode escapes only in quoted needles; backtick needles keep literal backslashes.
 *
 * @param rawNeedle - the needle exactly as captured between the citation's backticks or quotes
 * @param isQuoted - whether double quotes, rather than literal Markdown backticks, delimit the needle
 * @returns the literal string to look for in the cited file
 */
function normalizeCitationNeedle(rawNeedle: string, isQuoted: boolean): string {
  const literal = isQuoted ? rawNeedle.replace(/\\(["\\])/g, "$1") : rawNeedle;
  return literal.replace(/\s*\r?\n\s*/g, " ");
}

/** Find the source line to show a maintainer for a citation; line numbers start at one, as they do in an editor. */
function lineNumberAtOffset(content: string, offset: number): number {
  let line = 1;
  // Count only text before the citation so its finding points at the line the maintainer needs to edit.
  for (let index = 0; index < offset; index++) {
    // Each preceding newline advances the editor line reported for this citation.
    if (content[index] === "\n") line++;
  }
  return line;
}

/** Read a combined path-and-needle citation; null means it lacks a usable file target or search text. */
function combinedCitationAt(
  match: RegExpMatchArray,
  content: string,
  matchIndex: number,
): SearchAnchorCitation | null {
  const combinedPath = match[1];
  const rawNeedle = match[2] ?? match[3];
  // Both the target and the search text are needed before this part of the author's prose can become a citation.
  if (combinedPath === undefined || rawNeedle === undefined) return null;
  // A label that is not a file reference must not send the audit looking for an invented target.
  if (!isFileRef(combinedPath)) return null;
  return {
    filePath: combinedPath,
    needle: normalizeCitationNeedle(rawNeedle, match[3] !== undefined),
    line: lineNumberAtOffset(content, matchIndex),
  };
}

/** Keep a citation's preceding file target only while the intervening prose still connects them; null means no target can be inferred. */
function activeFilePathAfterGap(
  gap: string,
  isAwaitingDirectSearch: boolean,
  activeFilePath: string | null,
): string | null {
  // The first anchor may follow its file path across a period or line wrap, but not across unrelated prose or a paragraph break.
  if (isAwaitingDirectSearch) {
    return /^[ \t]*\.?[ \t]*(?:\n[ \t]*)?$/.test(gap) ? activeFilePath : null;
  }
  // Later anchors can share a target within one sentence; a new sentence or line ends that association.
  return /\n|[.!?](?:\s|$)/.test(gap) ? null : activeFilePath;
}

/** Collect the author's visible citations, including chained needles, without guessing targets from unrelated sentences. */
function extractVisibleSearchAnchorCitations(
  content: string,
): SearchAnchorCitation[] {
  const citations: SearchAnchorCitation[] = [];
  // Until a file token appears, standalone search text has no evidence target to check.
  let activeFilePath: string | null = null;
  let isAwaitingDirectSearch = false;
  let previousTokenEnd = 0;

  // Read citations in author order so each standalone needle can use only a preceding, still-connected target.
  for (const match of content.matchAll(
    new RegExp(SEARCH_CITATION_TOKEN_REGEX.source, "g"),
  )) {
    const matchIndex = match.index;
    const tokenEnd = matchIndex + match[0].length;

    // A combined citation already names its target; it must not lend that target to a later standalone anchor.
    if (match[1] !== undefined) {
      const combined = combinedCitationAt(match, content, matchIndex);
      // Keep only a complete citation; malformed combined text remains ordinary prose.
      if (combined !== null) citations.push(combined);
      activeFilePath = null;
      isAwaitingDirectSearch = false;
      previousTokenEnd = tokenEnd;
      continue;
    }

    const filePath = match[4];
    // A new file token replaces the prior target, so the next anchor follows the file the author most recently named.
    if (filePath !== undefined) {
      activeFilePath = isFileRef(filePath) ? filePath : null;
      isAwaitingDirectSearch = activeFilePath !== null;
      previousTokenEnd = tokenEnd;
      continue;
    }

    activeFilePath = activeFilePathAfterGap(
      content.slice(previousTokenEnd, matchIndex),
      isAwaitingDirectSearch,
      activeFilePath,
    );
    const rawNeedle = match[5] ?? match[6];
    // Record an anchor only when the author's text supplies both a connected target and a search needle.
    if (activeFilePath !== null && rawNeedle !== undefined) {
      citations.push({
        filePath: activeFilePath,
        needle: normalizeCitationNeedle(rawNeedle, match[6] !== undefined),
        line: lineNumberAtOffset(content, matchIndex),
      });
    }
    isAwaitingDirectSearch = false;
    previousTokenEnd = tokenEnd;
  }
  return citations;
}

/** Prepare the author's prose for evidence checks by excluding struck citations and fenced examples. */
function extractSearchAnchorCitations(content: string): SearchAnchorCitation[] {
  const withoutStrikethrough = maskStrikethroughPreservingLines(content);
  return extractVisibleSearchAnchorCitations(
    maskMarkdownFencesPreservingLines(withoutStrikethrough),
  );
}

/** Check that the author named one file; glob patterns and template paths cannot identify evidence to verify. */
function isConcreteSearchAnchorPath(filePath: string): boolean {
  return isFileRef(filePath) && !/[*?{}<>]|\.\.\./.test(filePath);
}

/** Keep the author's citation alongside its failure reason so the audit can show exactly which evidence needs repair. */
function staleSearchAnchorEvaluation(
  anchor: SearchAnchorCitation,
  reason: "missing-file" | "missing-needle" | "gitignored-path",
  diagnostic: string,
): SearchAnchorEvaluation {
  return { ...anchor, status: "stale", reason, diagnostic };
}

/** Resolve local citations from the skill or document folder; null retains the project-root interpretation, with no filesystem reads. */
function localSearchAnchorCandidate(
  filePath: string,
  sourcePath: string,
): string | null {
  const skillRoot = /^(.+\/skills\/[^/]+)(?:\/|$)/.exec(sourcePath)?.[1];
  // A skill author may cite its own reference pack without repeating the installed skill directory.
  if (
    skillRoot !== undefined &&
    (filePath.startsWith("references/") || filePath === "SKILL.md")
  ) {
    return pathPosix.join(skillRoot, filePath);
  }
  // Only explicit relative paths follow the document's folder; other citations keep their project-root meaning.
  return filePath.startsWith("./") || filePath.startsWith("../")
    ? pathPosix.join(pathPosix.dirname(sourcePath), filePath)
    : null;
}

/** Detect citations outside the selected project so an author's evidence cannot make the audit inspect another workspace. */
function isEscapedSearchAnchorPath(path: string): boolean {
  return (
    pathPosix.isAbsolute(path) ||
    /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(path) ||
    path.split(/[\\/]/u).includes("..")
  );
}

/** Resolve the author's citation to a project path; null rejects an escape, and a missing sourcePath means project-root references only. */
function resolveSearchAnchorPath(
  filePath: string,
  sourcePath: string | undefined,
): string | null {
  // Without the citing document's path, there is no local folder from which to resolve a relative citation.
  const relativeCandidate =
    sourcePath === undefined
      ? null
      : localSearchAnchorCandidate(filePath, sourcePath);
  // A citation with no explicit local interpretation keeps the path the author supplied.
  const normalized = pathPosix.normalize(relativeCandidate ?? filePath);
  return isEscapedSearchAnchorPath(normalized) ? null : normalized;
}

/** Validate one parsed citation for the content audit; null means policy excludes it, not that the author's evidence was verified. */
function evaluateSearchAnchor(
  fs: ReadonlyFS,
  anchor: SearchAnchorCitation,
  options: ReferenceValidationOptions,
): SearchAnchorEvaluation | null {
  // Placeholder paths and globs do not name one file whose evidence can be checked.
  if (!isConcreteSearchAnchorPath(anchor.filePath)) return null;
  const resolvedPath = resolveSearchAnchorPath(
    anchor.filePath,
    options.sourcePath,
  );
  // Reject a path escape before reading files, even when the author expressed it relative to the citing document.
  if (resolvedPath === null) return null;
  const resolvedAnchor = {
    ...anchor,
    filePath: resolvedPath,
  };
  // Local plans and logs may disappear in another checkout, so they cannot serve as durable evidence for a published lesson.
  if (isIntentionallyGitignored(resolvedAnchor.filePath)) {
    return staleSearchAnchorEvaluation(
      resolvedAnchor,
      "gitignored-path",
      `${resolvedAnchor.filePath} (gitignored path used as durable evidence anchor)`,
    );
  }
  // Skip targets outside the freshness policy rather than presenting an unsupported check as a valid citation.
  if (!isCheckableForStaleness(resolvedAnchor.filePath, fs)) return null;

  const diagnostic = `${resolvedAnchor.filePath} (search: \`${resolvedAnchor.needle}\`)`;
  // A removed or mistyped target normally leaves the author with a stale citation to repair.
  if (!fs.exists(resolvedAnchor.filePath)) {
    // External-repository evidence may be absent locally; callers must opt in before that absence can be skipped.
    if (options.allowMissingFiles === true) return null;
    return staleSearchAnchorEvaluation(
      resolvedAnchor,
      "missing-file",
      diagnostic,
    );
  }
  const fileContent = fs.readFile(resolvedAnchor.filePath);
  // An unreadable target provides no verifiable text, so the audit reports the citation as stale.
  if (fileContent === null) {
    return staleSearchAnchorEvaluation(
      resolvedAnchor,
      "missing-needle",
      diagnostic,
    );
  }
  // The file still exists, but the quoted text has moved or changed; the author needs a current semantic anchor.
  if (!fileContent.includes(resolvedAnchor.needle)) {
    return staleSearchAnchorEvaluation(
      resolvedAnchor,
      "missing-needle",
      diagnostic,
    );
  }
  // The target and literal both exist, so this citation needs no stale reason or repair diagnostic.
  return {
    ...resolvedAnchor,
    status: "valid",
    reason: null,
    diagnostic: null,
  };
}

/**
 * Check the author's visible citations against the selected project, using the same rules for guidance and accepted decisions.
 *
 * Callers may opt to skip missing external-repository files; placeholder paths and globs are always excluded.
 *
 * @param fs - read-only filesystem used to open the files the user cited
 * @param content - the author's entry text; empty text or no checkable citations produces no results
 * @param options - evidence policy; omission requires every checkable target to exist locally or be reported as stale
 * @returns valid or stale results for checkable citations; an empty list means no citation verdicts, not that all evidence passed
 */
export function evaluateSearchAnchors(
  fs: ReadonlyFS,
  content: string,
  options: ReferenceValidationOptions = {},
): SearchAnchorEvaluation[] {
  const evaluations: SearchAnchorEvaluation[] = [];
  // Evaluate each visible citation independently so one stale pointer cannot hide the remaining results from the author.
  for (const anchor of extractSearchAnchorCitations(content)) {
    const evaluation = evaluateSearchAnchor(fs, anchor, options);
    // Excluded citations have no verdict; do not count them as evidence the audit verified.
    if (evaluation !== null) evaluations.push(evaluation);
  }
  return evaluations;
}
