/**
 * Keep prevention advice first in learning entries returned by INDEX-first retrieval.
 *
 * Run this contract after adding or reordering active footguns and lessons.
 * The shared parser excludes resolved entries because agents no longer retrieve them as active guidance.
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

// Render bounded, grep-ready failure evidence without flooding test output.
function failureMessage(
  bucket: IndexBucket,
  total: number,
  noncompliant: ActiveLearningLoopSection[],
): string {
  const visible = noncompliant
    .slice(0, 20)
    .map((section) => `${section.sourcePath} (search: "${section.heading}")`);
  const omitted = noncompliant.length - visible.length;
  // Show how many additional entries need repair when the failure list exceeds the readable preview.
  if (omitted > 0) visible.push(`... ${omitted} more`);
  return `${bucket}: ${noncompliant.length}/${total} entries are not Prevention-first\n${visible.join("\n")}`;
}

describe("learning-loop entry body order", () => {
  const projectFiles = createFS(process.cwd());

  // Both active incident collections must put the next preventive action before historical explanation.
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
