/**
 * Protects action-first reading order for learning entries used by INDEX-first retrieval.
 * Run this contract after adding or reordering active footguns or lessons.
 * Resolved entries stay outside it because the canonical index parser filters them.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFS } from "../../src/cli/facts/fs.js";
import {
  firstLearningEntryBodyParagraph,
  parseActiveBucketSections,
  type ActiveLearningLoopSection,
  type IndexBucket,
} from "../../src/cli/learning-loop-index/parse-bucket.js";

/** Render bounded, grep-ready failure evidence without flooding test output. */
function failureMessage(
  bucket: IndexBucket,
  total: number,
  noncompliant: ActiveLearningLoopSection[],
): string {
  const visible = noncompliant
    .slice(0, 20)
    .map((section) => `${section.sourcePath} (search: "${section.heading}")`);
  const omitted = noncompliant.length - visible.length;
  if (omitted > 0) visible.push(`... ${omitted} more`);
  return `${bucket}: ${noncompliant.length}/${total} entries are not Prevention-first\n${visible.join("\n")}`;
}

describe("learning-loop entry body order", () => {
  const projectFiles = createFS(process.cwd());

  for (const bucket of ["footguns", "lessons"] as const) {
    it(`keeps every retrievable ${bucket} entry Prevention-first`, () => {
      const sections = parseActiveBucketSections(
        projectFiles,
        `.goat-flow/learning-loop/${bucket}/`,
        bucket,
      );
      const noncompliant = sections.filter(
        (section) =>
          !firstLearningEntryBodyParagraph(section).startsWith(
            "**Prevention:**",
          ),
      );

      assert.equal(
        noncompliant.length,
        0,
        failureMessage(bucket, sections.length, noncompliant),
      );
    });
  }
});
