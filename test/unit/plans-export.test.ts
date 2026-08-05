/**
 * How exports read a milestone before parsing it: fenced examples, raw HTML, comments, and
 * inline code are blanked without shifting offsets, so an author's examples are never
 * promoted into live export fields.
 * Runs the real CLI and parser against written fixtures, so failures read as the author's
 * terminal output rather than as internals.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import { maskNonRenderedMarkdown } from "../../src/cli/rendered-markdown.js";

describe("plans export: source masking", () => {
  it("masks comments and fences without changing source offsets", () => {
    // Fixture: a comment that opens a fence and a fence that opens a comment, so masking must
    // resolve the overlap without shifting any offset the caller reports back to the author.
    const content = [
      "<!--",
      "```markdown",
      "## Hidden comment fence",
      "-->",
      "## Live after comment",
      "```markdown",
      "<!-- Hidden fence comment",
      "```",
      "## Live after fence",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.equal(masked.length, content.length);
    assert.deepEqual(
      Array.from(masked.matchAll(/\n/gu), (match) => match.index),
      Array.from(content.matchAll(/\n/gu), (match) => match.index),
    );
    for (const visible of ["## Live after comment", "## Live after fence"]) {
      assert.equal(masked.indexOf(visible), content.indexOf(visible));
    }
    assert.doesNotMatch(masked, /Hidden/u);
  });

  it("masks raw HTML blocks without hiding later visible structure", () => {
    const content = [
      "<pre>",
      "## Hidden pre heading",
      "</pre>",
      "",
      "<div>",
      "## Hidden div heading",
      "</div>",
      "",
      "## Live heading",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.equal(masked.length, content.length);
    assert.doesNotMatch(masked, /Hidden/u);
    assert.equal(
      masked.indexOf("## Live heading"),
      content.indexOf("## Live heading"),
    );
  });

  it("masks type-7 custom-tag blocks without hiding later visible structure", () => {
    const content = [
      "<x-review>",
      "## Hidden custom-tag heading",
      "</x-review>",
      "",
      "## Live heading",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.equal(masked.length, content.length);
    assert.doesNotMatch(masked, /Hidden custom-tag/u);
    assert.equal(
      masked.indexOf("## Live heading"),
      content.indexOf("## Live heading"),
    );
  });

  it("keeps a complete custom tag visible when it continues a paragraph", () => {
    const content = [
      "Visible paragraph",
      "<x-review>",
      "## Live heading",
      "",
    ].join("\n");

    assert.equal(maskNonRenderedMarkdown(content), content);
  });

  it("keeps HTML-comment delimiters inside inline code visible", () => {
    const content = [
      "Checked the literal `<!--` token.",
      "## Live before comment",
      "<!-- hidden comment -->",
      "## Live after comment",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    for (const visible of [
      "Checked the literal `<!--` token.",
      "## Live before comment",
      "## Live after comment",
    ]) {
      assert.equal(masked.indexOf(visible), content.indexOf(visible));
    }
    assert.doesNotMatch(masked, /hidden comment/u);
  });

  it("masks multiline inline code without opening an HTML comment", () => {
    const content = [
      "Checked the literal `first line",
      "continued <!-- remains code` token.",
      "## Live after multiline code",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.equal(masked.length, content.length);
    assert.doesNotMatch(masked, /first line|remains code/u);
    assert.equal(
      masked.indexOf("## Live after multiline code"),
      content.indexOf("## Live after multiline code"),
    );
  });

  it("does not carry inline code across an interrupting HTML comment block", () => {
    const content = [
      "An unmatched ` delimiter remains literal.",
      "<!-- hidden block comment",
      "## Hidden comment heading",
      "-->",
      "## Live after comment",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.doesNotMatch(masked, /hidden block|Hidden comment/u);
    assert.equal(
      masked.indexOf("## Live after comment"),
      content.indexOf("## Live after comment"),
    );
  });

  it("tracks a new multiline code span after closing one on the same line", () => {
    const content = [
      "Checked the `first",
      "span` and the `second",
      "span <!-- remains code` token.",
      "## Live after consecutive spans",
      "",
    ].join("\n");

    const masked = maskNonRenderedMarkdown(content);

    assert.equal(masked.length, content.length);
    assert.doesNotMatch(masked, /first|second|remains code/u);
    assert.equal(
      masked.indexOf("## Live after consecutive spans"),
      content.indexOf("## Live after consecutive spans"),
    );
  });

  it("does not open a backtick fence whose info string contains a backtick", () => {
    const content = [
      "```markdown`invalid",
      "## Live after invalid fence",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.equal(
      masked.indexOf("## Live after invalid fence"),
      content.indexOf("## Live after invalid fence"),
    );
  });

  it("keeps backslash-escaped HTML comment openers visible", () => {
    const content = [
      "Checked the visible literal \\<!-- token.",
      "## Live before comment",
      "<!-- hidden comment -->",
      "## Live after comment",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    for (const visible of [
      "Checked the visible literal \\<!-- token.",
      "## Live before comment",
      "## Live after comment",
    ]) {
      assert.equal(masked.indexOf(visible), content.indexOf(visible));
    }
    assert.doesNotMatch(masked, /hidden comment/u);
  });

  it("masks an HTML comment after an escaped backslash", () => {
    const content = [
      "Visible \\\\<!-- hidden even-slash comment --> tail.",
      "## Live after comment",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.doesNotMatch(masked, /hidden even-slash comment/u);
    assert.equal(
      masked.indexOf("## Live after comment"),
      content.indexOf("## Live after comment"),
    );
  });

  it("does not protect HTML comments with escaped backticks", () => {
    const content = [
      "Escaped \\`<!-- hidden comment -->\\` markers.",
      "## Live after comment",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.doesNotMatch(masked, /hidden comment/u);
    assert.equal(
      masked.indexOf("## Live after comment"),
      content.indexOf("## Live after comment"),
    );
  });

  for (const [flag, field] of [
    ["--help", "showHelp"],
    ["--version", "showVersion"],
  ] as const) {
    it(`accepts plans ${flag} without an export path`, () => {
      const parsed = parseCLIArgs(["plans", flag]);
      assert.equal(parsed.command, "plans");
      assert.equal(parsed[field], true);
    });
  }
});
