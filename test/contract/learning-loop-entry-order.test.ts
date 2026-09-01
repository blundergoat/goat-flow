/**
 * Protects action-first reading order for learning entries used by INDEX-first retrieval.
 * Run this contract after adding or reordering active footguns or lessons.
 * Resolved entries stay outside it because the canonical index parser filters them.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFS } from "../../src/cli/facts/fs.js";
import {
  parseActiveBucketSections,
  type ActiveLearningLoopSection,
  type IndexBucket,
} from "../../src/cli/learning-loop-index/parse-bucket.js";

const METADATA_LABELS = new Set([
  "Status",
  "Created",
  "Updated",
  "Resolved",
  "Date",
  "Superseded",
  "Related",
  "Decision changed",
  "Trigger phase",
  "Caught at",
  "Incident count",
  "Latest occurrence",
  "Reason",
  "hallucination-risk",
  "Merged",
]);

/** Return true when one paragraph contains only entry-schema metadata lines. */
function isMetadataParagraph(paragraph: string): boolean {
  return paragraph
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .every((line) => {
      const label = /^\*\*([^*\n]+):\*\*/u.exec(line)?.[1];
      return label !== undefined && METADATA_LABELS.has(label);
    });
}

/** Read the first non-metadata body paragraph from one active indexed entry. */
function firstBodyParagraph(section: ActiveLearningLoopSection): string {
  const [, ...bodyLines] = section.content.split("\n");
  const paragraphs = bodyLines
    .join("\n")
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  while (paragraphs[0] && isMetadataParagraph(paragraphs[0])) {
    paragraphs.shift();
  }
  return paragraphs[0] ?? "";
}

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
        (section) => !firstBodyParagraph(section).startsWith("**Prevention:**"),
      );

      assert.equal(
        noncompliant.length,
        0,
        failureMessage(bucket, sections.length, noncompliant),
      );
    });
  }
});
