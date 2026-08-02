/**
 * Builds the source-aligned Markdown view used by CLI validators.
 * Users can include fenced, indented, or commented examples without those examples
 * being mistaken for live report fields, while visible text keeps its original offsets.
 */
/** Mutable state for non-rendered Markdown that can span source lines. */
interface MarkdownMaskState {
  fenceCharacter: string;
  fenceLength: number;
  inIndentedCode: boolean;
  inHtmlComment: boolean;
  previousRenderedLineWasBlank: boolean;
}

/** Replace visible source characters while retaining offsets and line endings. */
function maskCharacters(content: string): string {
  return content.replace(/[^\r\n]/gu, " ");
}

/** Return whether one raw line opens or closes a fenced code block. */
function isFencedLine(line: string, state: MarkdownMaskState): boolean {
  const comparableLine = line.endsWith("\r") ? line.slice(0, -1) : line;
  // An open fence keeps every example line hidden until its matching close marker.
  if (state.fenceCharacter.length > 0) {
    const closingPattern = new RegExp(
      `^ {0,3}${state.fenceCharacter}{${state.fenceLength},}\\s*$`,
      "u",
    );
    // The closing marker is part of the example, then the next line becomes visible again.
    if (closingPattern.test(comparableLine)) {
      state.fenceCharacter = "";
      state.fenceLength = 0;
    }
    return true;
  }

  const opening = comparableLine.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
  // A normal user-facing line leaves fenced-block state unchanged.
  if (!opening) return false;
  state.fenceCharacter = opening[0] ?? "";
  state.fenceLength = opening.length;
  return true;
}

/** Return whether Markdown renders this source line inside an indented code block. */
function isIndentedCodeLine(line: string, state: MarkdownMaskState): boolean {
  const lineIsBlank = line.trim().length === 0;
  // A blank line keeps an open example together but cannot start one for the user.
  if (lineIsBlank) return state.inIndentedCode;

  const lineIsIndented = /^(?: {4,}|\t)/u.test(line);
  // Visible text ends any earlier indented example and resumes normal validation.
  if (!lineIsIndented) {
    state.inIndentedCode = false;
    return false;
  }

  // Once an example starts, each indented line stays hidden until visible text resumes.
  if (state.inIndentedCode) return true;
  // Markdown treats indentation after visible prose as wrapping, such as a task estimate.
  if (!state.previousRenderedLineWasBlank) return false;

  state.inIndentedCode = true;
  return true;
}

/** Mask HTML comments on one non-fenced line, including multiline comments. */
function maskHtmlComments(line: string, state: MarkdownMaskState): string {
  let cursor = 0;
  let rendered = "";
  // Walk the line so visible prose around a comment retains its original position.
  while (cursor < line.length) {
    // A comment opened on an earlier line hides text until this user-facing example ends.
    if (state.inHtmlComment) {
      const closeIndex = line.indexOf("-->", cursor);
      const commentEnd = closeIndex < 0 ? line.length : closeIndex + 3;
      rendered += maskCharacters(line.slice(cursor, commentEnd));
      cursor = commentEnd;
      // Without a close marker, the rest of this source line remains non-rendered.
      if (closeIndex < 0) break;
      state.inHtmlComment = false;
      continue;
    }

    const openIndex = line.indexOf("<!--", cursor);
    // With no later comment, the remaining prose is visible to report validation.
    if (openIndex < 0) {
      rendered += line.slice(cursor);
      break;
    }
    rendered += line.slice(cursor, openIndex);
    state.inHtmlComment = true;
    cursor = openIndex;
  }
  return rendered;
}

/**
 * Mask fenced or indented code and HTML comments without changing source layout.
 * Structural Markdown consumers can match this view and safely reuse offsets
 * against the original source without promoting examples into live metadata.
 *
 * @param content - Raw Markdown source to mask.
 * @returns The same source with non-rendered examples and comments blanked out,
 *   identical in length and line count so caller offsets stay valid.
 */
export function maskNonRenderedMarkdown(content: string): string {
  const state: MarkdownMaskState = {
    fenceCharacter: "",
    fenceLength: 0,
    inIndentedCode: false,
    inHtmlComment: false,
    previousRenderedLineWasBlank: true,
  };
  // An empty report has no visible validation fields and keeps an empty source view.
  const sourceLines = content.match(/[^\n]*(?:\n|$)/gu) ?? [];
  // Process each line so users see validation against rendered report content only.
  return sourceLines
    .map((segment) => {
      const lineHasNewline = segment.endsWith("\n");
      const sourceLine = lineHasNewline ? segment.slice(0, -1) : segment;
      const isFence = !state.inHtmlComment && isFencedLine(sourceLine, state);
      const isIndentedExample =
        !state.inHtmlComment &&
        !isFence &&
        isIndentedCodeLine(sourceLine, state);
      const visibleLine =
        isFence || isIndentedExample
          ? maskCharacters(sourceLine)
          : maskHtmlComments(sourceLine, state);
      state.previousRenderedLineWasBlank = visibleLine.trim().length === 0;
      return lineHasNewline ? `${visibleLine}\n` : visibleLine;
    })
    .join("");
}
