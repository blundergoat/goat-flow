/**
 * Builds the source-aligned Markdown view used by CLI validators.
 * Users can include fenced, indented, raw-HTML, or commented examples without those
 * examples being mistaken for live report fields, while visible text keeps its offsets.
 */
/** Mutable state for non-rendered Markdown that can span source lines. */
interface MarkdownMaskState {
  fenceCharacter: string;
  fenceLength: number;
  inIndentedCode: boolean;
  inHtmlComment: boolean;
  rawHtmlClosingPattern: RegExp | null;
  rawHtmlUntilBlank: boolean;
  previousRenderedLineWasHeading: boolean;
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
  // Markdown treats indentation after prose as wrapping, but a heading is a
  // block boundary and may be followed immediately by an indented code block.
  if (
    !state.previousRenderedLineWasBlank &&
    !state.previousRenderedLineWasHeading
  ) {
    return false;
  }

  state.inIndentedCode = true;
  return true;
}

/** Return whether one visible line is an ATX or setext heading boundary. */
function isMarkdownHeading(line: string): boolean {
  const comparableLine = line.endsWith("\r") ? line.slice(0, -1) : line;
  return (
    /^ {0,3}#{1,6}(?:[\t ]+|$)/u.test(comparableLine) ||
    /^ {0,3}(?:=+|-+)[\t ]*$/u.test(comparableLine)
  );
}

/** Return the next balanced inline-code span on one source line. */
function countPrecedingBackslashes(line: string, index: number): number {
  let count = 0;
  for (let cursor = index - 1; line[cursor] === "\\"; cursor -= 1) {
    count += 1;
  }
  return count;
}

/** Return the first position after one contiguous backtick delimiter. */
function backtickRunEnd(line: string, startIndex: number): number {
  let endIndex = startIndex;
  while (line[endIndex] === "`") endIndex += 1;
  return endIndex;
}

/** Find the end of the next unescaped backtick run with the requested length. */
function findClosingBacktickRun(
  line: string,
  startIndex: number,
  delimiterLength: number,
): number {
  let closerStart = startIndex;
  while (closerStart < line.length) {
    closerStart = line.indexOf("`", closerStart);
    if (closerStart < 0) return -1;
    const closerEnd = backtickRunEnd(line, closerStart);
    const isEscaped = countPrecedingBackslashes(line, closerStart) % 2 === 1;
    if (!isEscaped && closerEnd - closerStart === delimiterLength) {
      return closerEnd;
    }
    closerStart = closerEnd;
  }
  return -1;
}

/** Return the next balanced inline-code span on one source line. */
function findInlineCodeSpan(
  line: string,
  startIndex: number,
): { start: number; end: number } | null {
  let openerStart = startIndex;
  while (openerStart < line.length) {
    openerStart = line.indexOf("`", openerStart);
    if (openerStart < 0) return null;
    if (countPrecedingBackslashes(line, openerStart) % 2 === 1) {
      openerStart += 1;
      continue;
    }

    const openerEnd = backtickRunEnd(line, openerStart);
    const delimiterLength = openerEnd - openerStart;
    const closerEnd = findClosingBacktickRun(line, openerEnd, delimiterLength);
    if (closerEnd >= 0) {
      return { start: openerStart, end: closerEnd };
    }

    openerStart = openerEnd;
  }
  return null;
}

const RAW_HTML_BLOCK_TAGS =
  /^(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)$/iu;

/** Consume one line when a raw HTML block was opened earlier. */
function continuesRawHtmlBlock(
  comparableLine: string,
  state: MarkdownMaskState,
): boolean {
  if (state.rawHtmlClosingPattern) {
    if (state.rawHtmlClosingPattern.test(comparableLine)) {
      state.rawHtmlClosingPattern = null;
    }
    return true;
  }

  if (state.rawHtmlUntilBlank) {
    if (comparableLine.trim().length === 0) {
      state.rawHtmlUntilBlank = false;
      return false;
    }
    return true;
  }

  return false;
}

/** Open a raw script-like HTML block when this line starts one. */
function opensRawTagBlock(
  comparableLine: string,
  state: MarkdownMaskState,
): boolean {
  const tag = comparableLine.match(
    /^ {0,3}<(script|pre|style|textarea)(?:[\t >]|$)/iu,
  )?.[1];
  if (!tag) return false;
  const closingPattern = new RegExp(`<\\/${tag}\\s*>`, "iu");
  if (!closingPattern.test(comparableLine)) {
    state.rawHtmlClosingPattern = closingPattern;
  }
  return true;
}

/** Return the end marker for a declaration-like raw HTML block opener. */
function rawMarkerClosingPattern(marker: string): RegExp {
  if (marker === "<?") return /\?>/u;
  if (marker === "<![CDATA[") return /\]\]>/u;
  return />/u;
}

/** Open a raw declaration-like HTML block when this line starts one. */
function opensRawMarkerBlock(
  comparableLine: string,
  state: MarkdownMaskState,
): boolean {
  const markerBlock = comparableLine.match(
    /^ {0,3}(<\?|<!\[CDATA\[|<![A-Z])/u,
  )?.[1];
  if (!markerBlock) return false;
  const closingPattern = rawMarkerClosingPattern(markerBlock);
  if (!closingPattern.test(comparableLine)) {
    state.rawHtmlClosingPattern = closingPattern;
  }
  return true;
}

/** Open a blank-terminated block for one CommonMark block-level HTML tag. */
function opensBlankTerminatedHtmlBlock(
  comparableLine: string,
  state: MarkdownMaskState,
): boolean {
  const blockTag = comparableLine.match(
    /^ {0,3}<\/?([A-Za-z][\w-]*)(?:[\t ]|\/?>|$)/u,
  )?.[1];
  if (!blockTag) return false;
  if (!RAW_HTML_BLOCK_TAGS.test(blockTag)) return false;
  state.rawHtmlUntilBlank = true;
  return true;
}

/** Return whether Markdown renders this source line as a raw HTML block. */
function isRawHtmlBlockLine(line: string, state: MarkdownMaskState): boolean {
  const comparableLine = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (continuesRawHtmlBlock(comparableLine, state)) return true;
  if (opensRawTagBlock(comparableLine, state)) return true;
  if (opensRawMarkerBlock(comparableLine, state)) return true;
  return opensBlankTerminatedHtmlBlock(comparableLine, state);
}

/** Record the rendered-line state needed to classify the next source line. */
function recordRenderedLine(
  visibleLine: string,
  canBeHeading: boolean,
  state: MarkdownMaskState,
): string {
  state.previousRenderedLineWasHeading =
    canBeHeading && isMarkdownHeading(visibleLine);
  state.previousRenderedLineWasBlank = visibleLine.trim().length === 0;
  return visibleLine;
}

/** Mask one Markdown source line and update cross-line parsing state. */
function maskMarkdownSourceLine(
  sourceLine: string,
  state: MarkdownMaskState,
): string {
  if (state.inHtmlComment) {
    return recordRenderedLine(maskHtmlComments(sourceLine, state), true, state);
  }
  if (state.fenceCharacter.length > 0) {
    isFencedLine(sourceLine, state);
    return recordRenderedLine(maskCharacters(sourceLine), false, state);
  }
  if (state.rawHtmlClosingPattern || state.rawHtmlUntilBlank) {
    if (isRawHtmlBlockLine(sourceLine, state)) {
      return recordRenderedLine(maskCharacters(sourceLine), false, state);
    }
  }
  if (isFencedLine(sourceLine, state)) {
    return recordRenderedLine(maskCharacters(sourceLine), false, state);
  }
  if (isRawHtmlBlockLine(sourceLine, state)) {
    return recordRenderedLine(maskCharacters(sourceLine), false, state);
  }
  if (isIndentedCodeLine(sourceLine, state)) {
    return recordRenderedLine(maskCharacters(sourceLine), false, state);
  }

  return recordRenderedLine(maskHtmlComments(sourceLine, state), true, state);
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
    const inlineCode = findInlineCodeSpan(line, cursor);
    // HTML-like text inside a balanced code span is visible code, not a comment.
    if (inlineCode && (openIndex < 0 || inlineCode.start < openIndex)) {
      rendered += line.slice(cursor, inlineCode.end);
      cursor = inlineCode.end;
      continue;
    }
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
 * Mask fenced or indented code, raw HTML, and HTML comments without changing layout.
 * Structural Markdown consumers can match this view and safely reuse offsets
 * against the original source without promoting examples into live metadata.
 *
 * @param content - Raw Markdown source to mask.
 * @returns The same source with non-structural examples and comments blanked out,
 *   identical in length and line count so caller offsets stay valid.
 */
export function maskNonRenderedMarkdown(content: string): string {
  const state: MarkdownMaskState = {
    fenceCharacter: "",
    fenceLength: 0,
    inIndentedCode: false,
    inHtmlComment: false,
    rawHtmlClosingPattern: null,
    rawHtmlUntilBlank: false,
    previousRenderedLineWasHeading: false,
    previousRenderedLineWasBlank: true,
  };
  // An empty report has no visible validation fields and keeps an empty source view.
  const sourceLines = content.match(/[^\n]*(?:\n|$)/gu) ?? [];
  // Process each line so users see validation against rendered report content only.
  return sourceLines
    .map((segment) => {
      const lineHasNewline = segment.endsWith("\n");
      const sourceLine = lineHasNewline ? segment.slice(0, -1) : segment;
      const visibleLine = maskMarkdownSourceLine(sourceLine, state);
      return lineHasNewline ? `${visibleLine}\n` : visibleLine;
    })
    .join("");
}
