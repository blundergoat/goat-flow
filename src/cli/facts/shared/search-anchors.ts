/**
 * Checks the `(search: "...")` citations a user writes into learning-loop entries.
 * These anchors are how a lesson or footgun points at real code, so this module answers the
 * question the content audit exists to ask: does the text a user cited still exist where they
 * said it does, or has the code moved on and left the note lying?
 *
 * Reading is deliberately layered. Struck-through text and fenced examples are blanked out
 * first - without that, an author writing *about* an anchor inside a code sample would be
 * accused of a broken citation - and the blanking preserves line positions so any finding
 * still points at the line the user is looking at in their editor. Path policy lives in
 * `reference-paths.ts`; this module owns extraction and verdicts.
 */
import { posix as pathPosix } from "node:path";
import type { ReadonlyFS } from "../../types.js";
import {
  isCheckableForStaleness,
  isFileRef,
  isIntentionallyGitignored,
  type ReferenceValidationOptions,
} from "./reference-paths.js";

/** File tokens and search needles in citation order, including chained needles. */
const SEARCH_CITATION_TOKEN_REGEX =
  /`((?:[^`]+\.[a-zA-Z0-9]{1,10}|\.[a-zA-Z0-9_-]+))`|\(search:\s*(?:`([^`]+)`|"((?:\\.|[^"\\])*)")\)/g;

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
 * One `(search: ...)` citation exactly as the user wrote it, before anything is checked.
 * This is the raw shape lifted from their entry text; `SearchAnchorEvaluation` is the same
 * citation after we look on disk and decide whether it still points at anything real.
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

/** Mask struck text without changing line positions used by diagnostics. */
function maskStrikethroughPreservingLines(content: string): string {
  return content.replace(/~~[\s\S]*?~~/g, (span) =>
    span.replace(/[^\r\n]/g, " "),
  );
}

/**
 * Track whether we are inside a fenced example while reading a user's entry line by line.
 * Use when scanning entry text for citations, so an example the user opened with ``` keeps
 * everything beneath it out of the scan until they close it again.
 *
 * @param line - the next line of the user's entry, exactly as they wrote it
 * @param activeFence - fence currently holding the scan open; `null` means we are in the
 *   user's ordinary prose, where citations do count
 * @returns the fence state to carry into the next line, plus whether this line was itself a
 *   fence marker; `activeFence: null` in the result means their example just closed
 */
export function advanceMarkdownFenceState(
  line: string,
  activeFence: MarkdownFence | null,
): { activeFence: MarkdownFence | null; isFenceLine: boolean } {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  const run = match?.[1];
  if (run === undefined) return { activeFence, isFenceLine: false };

  const character = run[0] as "`" | "~";
  if (activeFence === null) {
    return {
      activeFence: { character, length: run.length },
      isFenceLine: true,
    };
  }

  const remainder = match?.[2] ?? "";
  if (
    character === activeFence.character &&
    run.length >= activeFence.length &&
    /^[ \t]*$/.test(remainder)
  ) {
    return { activeFence: null, isFenceLine: true };
  }
  return { activeFence, isFenceLine: false };
}

/** Mask fenced Markdown without shifting the line positions used by diagnostics. */
function maskMarkdownFencesPreservingLines(content: string): string {
  const visibleLines: string[] = [];
  let activeFence: MarkdownFence | null = null;

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

/** Return the one-based line containing a character offset. */
function lineNumberAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index++) {
    if (content[index] === "\n") line++;
  }
  return line;
}

/** Extract direct and same-sentence chained citations from visible Markdown. */
function extractVisibleSearchAnchorCitations(
  content: string,
): SearchAnchorCitation[] {
  const citations: SearchAnchorCitation[] = [];
  let activeFilePath: string | null = null;
  let isAwaitingDirectSearch = false;
  let previousTokenEnd = 0;

  for (const match of content.matchAll(
    new RegExp(SEARCH_CITATION_TOKEN_REGEX.source, "g"),
  )) {
    const matchIndex = match.index;
    const tokenEnd = matchIndex + match[0].length;
    const filePath = match[1];
    if (filePath !== undefined) {
      activeFilePath = isFileRef(filePath) ? filePath : null;
      isAwaitingDirectSearch = activeFilePath !== null;
      previousTokenEnd = tokenEnd;
      continue;
    }

    const gap = content.slice(previousTokenEnd, matchIndex);
    if (isAwaitingDirectSearch) {
      if (!/^[ \t]*(?:\n[ \t]*)?$/.test(gap)) activeFilePath = null;
    } else if (/\n|[.!?](?:\s|$)/.test(gap)) {
      activeFilePath = null;
    }
    const rawNeedle = match[2] ?? match[3];
    if (activeFilePath !== null && rawNeedle !== undefined) {
      citations.push({
        filePath: activeFilePath,
        needle: rawNeedle.replace(/\\(["\\])/g, "$1"),
        line: lineNumberAtOffset(content, matchIndex),
      });
    }
    isAwaitingDirectSearch = false;
    previousTokenEnd = tokenEnd;
  }
  return citations;
}

/** Extract visible semantic-anchor citations while ignoring fenced examples. */
function extractSearchAnchorCitations(content: string): SearchAnchorCitation[] {
  const withoutStrikethrough = maskStrikethroughPreservingLines(content);
  return extractVisibleSearchAnchorCitations(
    maskMarkdownFencesPreservingLines(withoutStrikethrough),
  );
}

/** Return whether a citation identifies one concrete repository file. */
function isConcreteSearchAnchorPath(filePath: string): boolean {
  return isFileRef(filePath) && !/[*?{}<>]|\.\.\./.test(filePath);
}

/** Build one failed semantic-anchor result without duplicating its evidence. */
function staleSearchAnchorEvaluation(
  anchor: SearchAnchorCitation,
  reason: "missing-file" | "missing-needle" | "gitignored-path",
  diagnostic: string,
): SearchAnchorEvaluation {
  return { ...anchor, status: "stale", reason, diagnostic };
}

/** Choose a citing-file-relative candidate only for explicit local path forms. */
function localSearchAnchorCandidate(
  filePath: string,
  sourcePath: string,
): string | null {
  const skillRoot = /^(.+\/skills\/[^/]+)(?:\/|$)/.exec(sourcePath)?.[1];
  if (
    skillRoot !== undefined &&
    (filePath.startsWith("references/") || filePath === "SKILL.md")
  ) {
    return pathPosix.join(skillRoot, filePath);
  }
  return filePath.startsWith("./") || filePath.startsWith("../")
    ? pathPosix.join(pathPosix.dirname(sourcePath), filePath)
    : null;
}

/** Reject a relative citation candidate that normalizes outside the project. */
function isEscapedSearchAnchorPath(path: string): boolean {
  return pathPosix.isAbsolute(path) || path === ".." || path.startsWith("../");
}

/** Resolve the skill-relative citation forms used by installed and source skills. */
function resolveSearchAnchorPath(
  filePath: string,
  sourcePath: string | undefined,
): string {
  if (sourcePath === undefined) return filePath;
  const relativeCandidate = localSearchAnchorCandidate(filePath, sourcePath);
  if (relativeCandidate === null) return filePath;

  const normalized = pathPosix.normalize(relativeCandidate);
  return isEscapedSearchAnchorPath(normalized) ? filePath : normalized;
}

/** Validate one parsed citation, returning null only when policy excludes it. */
function evaluateSearchAnchor(
  fs: ReadonlyFS,
  anchor: SearchAnchorCitation,
  options: ReferenceValidationOptions,
): SearchAnchorEvaluation | null {
  if (!isConcreteSearchAnchorPath(anchor.filePath)) return null;
  const resolvedAnchor = {
    ...anchor,
    filePath: resolveSearchAnchorPath(anchor.filePath, options.sourcePath),
  };
  if (isIntentionallyGitignored(resolvedAnchor.filePath)) {
    return staleSearchAnchorEvaluation(
      resolvedAnchor,
      "gitignored-path",
      `${resolvedAnchor.filePath} (gitignored path used as durable evidence anchor)`,
    );
  }
  if (!isCheckableForStaleness(resolvedAnchor.filePath, fs)) return null;

  const diagnostic = `${resolvedAnchor.filePath} (search: \`${resolvedAnchor.needle}\`)`;
  if (!fs.exists(resolvedAnchor.filePath)) {
    if (options.allowMissingFiles === true) return null;
    return staleSearchAnchorEvaluation(
      resolvedAnchor,
      "missing-file",
      diagnostic,
    );
  }
  const fileContent = fs.readFile(resolvedAnchor.filePath);
  if (fileContent === null) {
    return staleSearchAnchorEvaluation(
      resolvedAnchor,
      "missing-needle",
      diagnostic,
    );
  }
  if (!fileContent.includes(resolvedAnchor.needle)) {
    return staleSearchAnchorEvaluation(
      resolvedAnchor,
      "missing-needle",
      diagnostic,
    );
  }
  return {
    ...resolvedAnchor,
    status: "valid",
    reason: null,
    diagnostic: null,
  };
}

/**
 * Validate visible `(search: ...)` citations against the selected project.
 *
 * Callers that accept evidence from external repositories may ignore missing
 * files while still detecting a moved literal in any target present locally.
 * Placeholder and glob paths are skipped because they do not identify one
 * concrete file. Every selected source document, including accepted ADRs, uses
 * the same literal-resolution contract.
 *
 * @param fs - read-only filesystem used to open the files the user cited
 * @param content - the user's entry text; content with no citations is not an error and
 *   simply yields nothing to report
 * @param options - policy for evidence that may live in another repo; omitted means every
 *   cited file must exist locally or the citation is reported as stale
 * @returns one result per resolvable citation, each marked valid or stale; an empty list
 *   means the user cited nothing checkable, not that everything passed
 */
export function evaluateSearchAnchors(
  fs: ReadonlyFS,
  content: string,
  options: ReferenceValidationOptions = {},
): SearchAnchorEvaluation[] {
  const evaluations: SearchAnchorEvaluation[] = [];
  for (const anchor of extractSearchAnchorCitations(content)) {
    const evaluation = evaluateSearchAnchor(fs, anchor, options);
    if (evaluation !== null) evaluations.push(evaluation);
  }
  return evaluations;
}
