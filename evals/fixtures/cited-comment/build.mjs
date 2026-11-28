/** Builds a synthetic version of the comment citation that broke the audit. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const citedSourcePath = "src/skill-stub.mjs";
export const citedCommentAnchor = "Write canonical skill stubs";
const citationHeading = "A cleanup broke a comment citation";

const fixtureFiles = {
  "AGENTS.md": `# Skill stub project

Labelled synthetic input for a saved skill eval. Before editing, search the relevant learning-loop index and read matched entries from this project. The fixture uses no formatter. Run the existing checks with \`node --test\` when required.
`,
  [citedSourcePath]: `/**
 * ${citedCommentAnchor} for a given skill name.
 * The name supplied by the caller is used as the name in the generated heading.
 * @param {string} name - Name of the skill.
 */
export function canonicalSkillStub(name) {
  return \`# \${name}\\n\`;
}
`,
  "test/skill-stub.test.mjs": `import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalSkillStub } from "../src/skill-stub.mjs";

test("writes the skill name as a heading", () => {
  assert.equal(canonicalSkillStub("goat-plan"), "# goat-plan\\n");
});
`,
  ".goat-flow/learning-loop/lessons/INDEX.md": `# Lesson index

- [${citationHeading}](comment-citations.md) (search: "## Lesson: ${citationHeading}") - Check referenced anchors before editing comments.
`,
  ".goat-flow/learning-loop/lessons/comment-citations.md": `# Comment citations

## Lesson: ${citationHeading}

This is a synthetic fixture based on the recorded audit failure after a cited comment was reworded.

**Prevention:** Preserve a cited anchor when shortening its surrounding comment. Evidence: \`${citedSourcePath}\` (search: "${citedCommentAnchor}").
`,
};

/**
 * Writes the example code, its existing test, and a searchable local citation.
 * @param {string} project - Disposable sample project root.
 */
export function buildCitedComment(project) {
  for (const [name, contents] of Object.entries(fixtureFiles)) {
    const file = join(project, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents, { flag: "wx" });
  }
}

/**
 * Separates the top JSDoc from all bytes outside that comment for comparison.
 * @param {string} source - Contents of the fixture source file.
 */
function selectedComment(source) {
  const [comment] = /^\/\*\*[\s\S]*?\*\//u.exec(source) ?? [];
  return comment ? { comment, rest: source.slice(comment.length) } : null;
}

/**
 * Compares the selected JSDoc and the fixture bytes the task protects.
 * @param {object} before - Project file digests captured at preparation.
 * @param {object} after - Project file digests captured at collection.
 * @param {string} originalSource - Prepared source bytes.
 * @param {string} currentSource - Source after the sample, or empty if absent.
 */
export function compareCitedComment(
  before,
  after,
  originalSource,
  currentSource,
) {
  const original = selectedComment(originalSource);
  const current = selectedComment(currentSource);
  return {
    clarityAnchorPreserved:
      current?.comment.includes(citedCommentAnchor) === true,
    clarityOtherBytesPreserved:
      current !== null &&
      original !== null &&
      current.rest === original.rest &&
      isDeepStrictEqual(before, {
        ...after,
        [citedSourcePath]: before[citedSourcePath],
      }),
  };
}
