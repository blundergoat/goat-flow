/** Mutable state for non-rendered Markdown that can span source lines. */
interface MarkdownMaskState {
  fenceCharacter: string;
  fenceLength: number;
  inHtmlComment: boolean;
}

/** Replace visible source characters while retaining offsets and line endings. */
function maskCharacters(content: string): string {
  return content.replace(/[^\r\n]/gu, " ");
}

/** Return whether one raw line opens or closes a fenced code block. */
function isFencedLine(line: string, state: MarkdownMaskState): boolean {
  const comparableLine = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (state.fenceCharacter.length > 0) {
    const closingPattern = new RegExp(
      `^ {0,3}${state.fenceCharacter}{${state.fenceLength},}\\s*$`,
      "u",
    );
    if (closingPattern.test(comparableLine)) {
      state.fenceCharacter = "";
      state.fenceLength = 0;
    }
    return true;
  }

  const opening = comparableLine.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
  if (!opening) return false;
  state.fenceCharacter = opening[0] ?? "";
  state.fenceLength = opening.length;
  return true;
}

/** Mask HTML comments on one non-fenced line, including multiline comments. */
function maskHtmlComments(line: string, state: MarkdownMaskState): string {
  let cursor = 0;
  let rendered = "";
  while (cursor < line.length) {
    if (state.inHtmlComment) {
      const closeIndex = line.indexOf("-->", cursor);
      const commentEnd = closeIndex < 0 ? line.length : closeIndex + 3;
      rendered += maskCharacters(line.slice(cursor, commentEnd));
      cursor = commentEnd;
      if (closeIndex < 0) break;
      state.inHtmlComment = false;
      continue;
    }

    const openIndex = line.indexOf("<!--", cursor);
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
 * Mask fenced code and HTML comments without changing source length or newlines.
 * Structural Markdown consumers can match this view and safely reuse offsets
 * against the original source without promoting examples into live metadata.
 */
export function maskNonRenderedMarkdown(content: string): string {
  const state: MarkdownMaskState = {
    fenceCharacter: "",
    fenceLength: 0,
    inHtmlComment: false,
  };
  return (content.match(/[^\n]*(?:\n|$)/gu) ?? [])
    .map((segment) => {
      const hasNewline = segment.endsWith("\n");
      const line = hasNewline ? segment.slice(0, -1) : segment;
      const isFence = !state.inHtmlComment && isFencedLine(line, state);
      const rendered = isFence
        ? maskCharacters(line)
        : maskHtmlComments(line, state);
      return hasNewline ? `${rendered}\n` : rendered;
    })
    .join("");
}
