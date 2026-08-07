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
  pendingListContinuationIndent: number | null;
  inHtmlComment: boolean;
  inlineCodeDelimiterLength: number;
  rawHtmlClosingPattern: RegExp | null;
  inRawHtmlUntilBlank: boolean;
  previousRenderedLineWasParagraph: boolean;
  previousRenderedLineWasHeading: boolean;
  previousRenderedLineWasBlank: boolean;
}

/** Replace visible source characters while retaining offsets and line endings. */
function maskCharacters(content: string): string {
  return content.replace(/[^\r\n]/gu, " ");
}

/** Remove the carriage return from one CRLF-derived source line. */
function comparableMarkdownLine(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Return whether a backtick opener carries an info string CommonMark rejects. */
function hasInvalidBacktickFenceInfo(
  opening: string,
  infoString: string,
): boolean {
  return opening[0] === "`" && infoString.includes("`");
}

/** Return whether one raw line opens or closes a fenced code block. */
function isFencedLine(line: string, state: MarkdownMaskState): boolean {
  const comparableLine = comparableMarkdownLine(line);
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

  const openingMatch = comparableLine.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
  const opening = openingMatch?.[1];
  // A normal user-facing line leaves fenced-block state unchanged.
  if (!opening) return false;
  // Backticks are forbidden in a backtick fence's info string. The line stays
  // visible Markdown instead of opening a block that masks later evidence.
  if (hasInvalidBacktickFenceInfo(opening, openingMatch[2] ?? "")) {
    return false;
  }
  state.fenceCharacter = opening[0] ?? "";
  state.fenceLength = opening.length;
  return true;
}

/** Count source columns, expanding tabs at CommonMark's four-column tab stops. */
function markdownColumnWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    width += character === "\t" ? 4 - (width % 4) : 1;
  }
  return width;
}

/** Return the source-column indent that continues one visible list item. */
function listContinuationIndent(line: string): number | null {
  const marker = comparableMarkdownLine(line).match(
    /^( {0,3})(?:[*+-]|\d{1,9}[.)])[ \t]{1,4}(?=\S)/u,
  );
  return marker ? markdownColumnWidth(marker[0]) : null;
}

/** Return whether list indentation leaves this source line as visible prose. */
function isVisibleListContinuation(
  line: string,
  state: MarkdownMaskState,
): boolean {
  const listIndent = state.pendingListContinuationIndent;
  if (listIndent === null) return false;
  const indentation = line.match(/^[ \t]*/u)?.[0] ?? "";
  const indentationWidth = markdownColumnWidth(indentation);
  return indentationWidth >= listIndent && indentationWidth < listIndent + 4;
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
  // List indentation is stripped before leaf blocks are classified. Four source
  // spaces can therefore be visible prose even though four relative spaces are code.
  if (isVisibleListContinuation(line, state)) return false;
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
): { start: number; end: number; delimiterLength: number } | null {
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
      return { start: openerStart, end: closerEnd, delimiterLength };
    }

    openerStart = openerEnd;
  }
  return null;
}

/**
 * Hide backticked examples on one line so a validator reads only the user's real text.
 * Use when a check scans a single report line and a user has written something like
 * `Status: done` as an example - without this, that example is read as a live field.
 *
 * @param line - one source line as the user typed it; an empty line has no examples to
 *   hide and comes back unchanged, so the caller sees the same blank line
 * @returns the line with example text blanked to spaces and every other character kept
 *   in place, so positions the user sees still line up with the original
 */
export function maskInlineCodeSpansOnLine(line: string): string {
  let cursor = 0;
  let masked = "";
  while (cursor < line.length) {
    const inlineCode = findInlineCodeSpan(line, cursor);
    if (!inlineCode) {
      masked += line.slice(cursor);
      break;
    }
    masked += line.slice(cursor, inlineCode.start);
    masked += maskCharacters(line.slice(inlineCode.start, inlineCode.end));
    cursor = inlineCode.end;
  }
  return masked;
}

/** Find the next HTML comment opener whose less-than sign is not escaped. */
function findUnescapedHtmlCommentOpener(
  line: string,
  startIndex: number,
): number {
  let openIndex = line.indexOf("<!--", startIndex);
  while (openIndex >= 0) {
    if (countPrecedingBackslashes(line, openIndex) % 2 === 0) {
      return openIndex;
    }
    openIndex = line.indexOf("<!--", openIndex + 4);
  }
  return -1;
}

const RAW_BLOCK_TAG_NAMES =
  /^(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)$/iu;
const COMPLETE_TAG_LINE =
  /^ {0,3}(?:<\/[A-Za-z][A-Za-z0-9-]*[\t ]*>|<[A-Za-z][A-Za-z0-9-]*(?:[\t ]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[\t ]*=[\t ]*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*[\t ]*\/?>)[\t ]*$/u;

/**
 * Return whether a line opens raw HTML, a comment, or another HTML-like block.
 *
 * Split out of {@link interruptsInlineCodeParagraph} so each function stays
 * inside the project complexity budget. Expects the carriage return already
 * trimmed, since the caller compares against `\n`-normalised text.
 *
 * @param comparableLine - one source line with any trailing `\r` removed
 * @returns true when the line starts an HTML-like block
 */
function startsHtmlLikeBlock(comparableLine: string): boolean {
  if (/^ {0,3}(?:<!--|<\?|<!\[CDATA\[|<![A-Z])/u.test(comparableLine)) {
    return true;
  }
  if (
    /^ {0,3}<(?:script|pre|style|textarea)(?:[\t >]|$)/iu.test(comparableLine)
  ) {
    return true;
  }
  const blockTag = comparableLine.match(
    /^ {0,3}<\/?([A-Za-z][\w-]*)(?:[\t ]|\/?>|$)/u,
  )?.[1];
  return blockTag !== undefined && RAW_BLOCK_TAG_NAMES.test(blockTag);
}

/** Return whether a later source line starts a block that ends inline parsing. */
function interruptsInlineCodeParagraph(line: string): boolean {
  const comparableLine = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (comparableLine.trim().length === 0) return true;
  if (isMarkdownHeading(comparableLine)) return true;
  if (/^ {0,3}(?:`{3,}|~{3,}|>)/u.test(comparableLine)) return true;
  if (/^ {0,3}(?:[*+-][\t ]+|\d{1,9}[.)][\t ]+)/u.test(comparableLine)) {
    return true;
  }
  if (/^ {0,3}\[[^\]]+\]:/u.test(comparableLine)) return true;
  return startsHtmlLikeBlock(comparableLine);
}

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

  if (state.inRawHtmlUntilBlank) {
    if (comparableLine.trim().length === 0) {
      state.inRawHtmlUntilBlank = false;
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
  if (!RAW_BLOCK_TAG_NAMES.test(blockTag)) return false;
  state.inRawHtmlUntilBlank = true;
  return true;
}

/** Open a CommonMark type-7 tag block without interrupting visible prose. */
function opensTypeSevenHtmlBlock(
  comparableLine: string,
  state: MarkdownMaskState,
): boolean {
  if (state.previousRenderedLineWasParagraph) return false;
  if (!COMPLETE_TAG_LINE.test(comparableLine)) return false;
  state.inRawHtmlUntilBlank = true;
  return true;
}

/** Return whether Markdown renders this source line as a raw HTML block. */
function isRawHtmlBlockLine(line: string, state: MarkdownMaskState): boolean {
  const comparableLine = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (continuesRawHtmlBlock(comparableLine, state)) return true;
  if (opensRawTagBlock(comparableLine, state)) return true;
  if (opensRawMarkerBlock(comparableLine, state)) return true;
  if (opensBlankTerminatedHtmlBlock(comparableLine, state)) return true;
  return opensTypeSevenHtmlBlock(comparableLine, state);
}

/** Record the rendered-line state needed to classify the next source line. */
function recordRenderedLine(
  visibleLine: string,
  canBeHeading: boolean,
  state: MarkdownMaskState,
): string {
  const lineIsBlank = visibleLine.trim().length === 0;
  const lineIsHeading = canBeHeading && isMarkdownHeading(visibleLine);
  const nextListIndent = canBeHeading
    ? listContinuationIndent(visibleLine)
    : null;
  if (nextListIndent !== null) {
    state.pendingListContinuationIndent = nextListIndent;
  } else if (!lineIsBlank || !canBeHeading) {
    state.pendingListContinuationIndent = null;
  }
  state.previousRenderedLineWasHeading = lineIsHeading;
  state.previousRenderedLineWasBlank = lineIsBlank;
  state.previousRenderedLineWasParagraph =
    canBeHeading && !lineIsBlank && !lineIsHeading;
  return visibleLine;
}

/** Mask one Markdown source line and update cross-line parsing state. */
function maskMarkdownSourceLine(
  sourceLine: string,
  state: MarkdownMaskState,
  inlineCodeSource: string,
): string {
  if (state.inlineCodeDelimiterLength > 0) {
    return recordRenderedLine(
      maskHtmlComments(sourceLine, state, inlineCodeSource),
      true,
      state,
    );
  }
  if (state.inHtmlComment) {
    return recordRenderedLine(
      maskHtmlComments(sourceLine, state, inlineCodeSource),
      true,
      state,
    );
  }
  if (state.fenceCharacter.length > 0) {
    isFencedLine(sourceLine, state);
    return recordRenderedLine(maskCharacters(sourceLine), false, state);
  }
  if (state.rawHtmlClosingPattern || state.inRawHtmlUntilBlank) {
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

  return recordRenderedLine(
    maskHtmlComments(sourceLine, state, inlineCodeSource),
    true,
    state,
  );
}

/**
 * Consume the part of a line still covered by a span an earlier line opened.
 *
 * Split out of {@link maskHtmlComments} so each function stays inside the
 * project complexity budget. Mutates `state` when the open span closes on this
 * line, so call it once per cursor position and honour the returned cursor
 * rather than recomputing one. Returns null when nothing is open, which is the
 * signal for the caller to scan this line from scratch.
 *
 * @param line - the source line being masked
 * @param cursor - offset into `line` where masking resumes
 * @param state - mask state carried across lines; updated when a span closes
 * @returns the text to append, the next cursor, and whether the line is
 *   exhausted; null when no span was open
 */
function consumeOpenMarkdownSpan(
  line: string,
  cursor: number,
  state: MarkdownMaskState,
): { text: string; nextCursor: number; stop: boolean } | null {
  // A code span opened on an earlier line keeps comment-like text visible.
  if (state.inlineCodeDelimiterLength > 0) {
    const closerEnd = findClosingBacktickRun(
      line,
      cursor,
      state.inlineCodeDelimiterLength,
    );
    if (closerEnd < 0) {
      return {
        text: maskCharacters(line.slice(cursor)),
        nextCursor: line.length,
        stop: true,
      };
    }
    state.inlineCodeDelimiterLength = 0;
    return {
      text: maskCharacters(line.slice(cursor, closerEnd)),
      nextCursor: closerEnd,
      stop: false,
    };
  }

  // A comment opened on an earlier line hides text until this user-facing example ends.
  if (state.inHtmlComment) {
    const closeIndex = line.indexOf("-->", cursor);
    const commentEnd = closeIndex < 0 ? line.length : closeIndex + 3;
    const text = maskCharacters(line.slice(cursor, commentEnd));
    // Without a close marker, the rest of this source line remains non-rendered.
    if (closeIndex < 0) {
      return { text, nextCursor: commentEnd, stop: true };
    }
    state.inHtmlComment = false;
    return { text, nextCursor: commentEnd, stop: false };
  }

  return null;
}

/**
 * Return whether a code span starts before the next comment opener on a line.
 *
 * Split out of {@link maskHtmlComments} so each function stays inside the
 * project complexity budget. A span starting at or past `lineLength` began on a
 * later line of the same paragraph, so it cannot mask anything here.
 *
 * @param inlineCode - the next balanced span found in the paragraph source
 * @param openIndex - offset of the next unescaped `<!--`, or -1 when none
 * @param lineLength - length of the single line being masked
 * @returns true when the span, not the comment opener, comes first
 */
function codeSpanPrecedesCommentOpener(
  inlineCode: { start: number },
  openIndex: number,
  lineLength: number,
): boolean {
  if (inlineCode.start >= lineLength) return false;
  return openIndex < 0 || inlineCode.start < openIndex;
}

/** Mask HTML comments on one non-fenced line, including multiline comments. */
function maskHtmlComments(
  line: string,
  state: MarkdownMaskState,
  inlineCodeSource: string,
): string {
  let cursor = 0;
  let rendered = "";
  // Walk the line so visible prose around a comment retains its original position.
  while (cursor < line.length) {
    const resumed = consumeOpenMarkdownSpan(line, cursor, state);
    if (resumed) {
      rendered += resumed.text;
      cursor = resumed.nextCursor;
      if (resumed.stop) break;
      continue;
    }

    const openIndex = findUnescapedHtmlCommentOpener(line, cursor);
    const inlineCode = findInlineCodeSpan(inlineCodeSource, cursor);
    // HTML-like text inside a balanced code span is visible code, not a comment.
    if (
      inlineCode &&
      codeSpanPrecedesCommentOpener(inlineCode, openIndex, line.length)
    ) {
      if (inlineCode.end > line.length) {
        rendered += line.slice(cursor, inlineCode.start);
        rendered += maskCharacters(line.slice(inlineCode.start));
        state.inlineCodeDelimiterLength = inlineCode.delimiterLength;
        break;
      }
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
 * Blank out every example in a report so checks only read what the user actually wrote.
 * Use before validating any user-authored Markdown - a plan, review, or quality report -
 * so a fenced sample, an indented snippet, or a commented-out draft is never mistaken for
 * a real field the user filled in.
 *
 * The scan is line-by-line with a lookahead rather than a simple regex because Markdown
 * lets a user open a backticked example on one line and close it several lines later, and
 * because every character must keep its position: callers report problems back to the user
 * by offset, so replacing examples with same-length spaces is what keeps "line 12, column
 * 30" pointing at the place the user is actually looking at.
 *
 * @param content - the report exactly as the user saved it; empty content has nothing to
 *   check, so an empty view comes back and the caller reports no findings rather than an error
 * @returns the same text with examples and comments blanked to spaces, identical in length
 *   and line count, so any position the caller shows the user still matches their file
 */
export function maskNonRenderedMarkdown(content: string): string {
  const state: MarkdownMaskState = {
    fenceCharacter: "",
    fenceLength: 0,
    inIndentedCode: false,
    pendingListContinuationIndent: null,
    inHtmlComment: false,
    inlineCodeDelimiterLength: 0,
    rawHtmlClosingPattern: null,
    inRawHtmlUntilBlank: false,
    previousRenderedLineWasParagraph: false,
    previousRenderedLineWasHeading: false,
    previousRenderedLineWasBlank: true,
  };
  // An empty report has no visible validation fields and keeps an empty source view.
  const sourceLines = content.match(/[^\n]*(?:\n|$)/gu) ?? [];
  // Process each line so users see validation against rendered report content only.
  return sourceLines
    .map((segment, lineIndex) => {
      const lineHasNewline = segment.endsWith("\n");
      const sourceLine = lineHasNewline ? segment.slice(0, -1) : segment;
      let inlineCodeSource = sourceLine;
      if (sourceLine.includes("`")) {
        for (
          let nextLineIndex = lineIndex + 1;
          nextLineIndex < sourceLines.length;
          nextLineIndex += 1
        ) {
          const nextSegment = sourceLines[nextLineIndex] ?? "";
          const nextLine = nextSegment.endsWith("\n")
            ? nextSegment.slice(0, -1)
            : nextSegment;
          if (interruptsInlineCodeParagraph(nextLine)) break;
          inlineCodeSource += `\n${nextLine}`;
        }
      }
      const visibleLine = maskMarkdownSourceLine(
        sourceLine,
        state,
        inlineCodeSource,
      );
      return lineHasNewline ? `${visibleLine}\n` : visibleLine;
    })
    .join("");
}

/**
 * Read every visible Markdown field value in source order.
 * Use when a CLI action must ignore examples and decide whether the user's live field is unique.
 *
 * @param content - Markdown exactly as the user saved it; empty means no field is available
 * @param fieldLabel - label shown in the milestone; empty means there is no field to match
 * @returns trimmed visible values; empty means the field is absent from rendered Markdown
 */
export function readRenderedMarkdownFieldValues(
  content: string,
  fieldLabel: string,
): string[] {
  // Without a label, the CLI cannot identify a user-facing field safely.
  if (fieldLabel.trim().length === 0) return [];

  const escapedFieldLabel = fieldLabel.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const fieldPattern = new RegExp(
    `^(?:\\*\\*${escapedFieldLabel}:\\*\\*|${escapedFieldLabel}:)[\\t ]*(.*?)[\\t ]*$`,
    "gimu",
  );
  // A visible field with no value stays empty so the caller can explain what the user must fill in.
  return Array.from(
    maskNonRenderedMarkdown(content).matchAll(fieldPattern),
    (fieldMatch) => fieldMatch[1]?.trim() ?? "",
  );
}
