/** Decision-bucket markdown classification shared by stats and fact extractors. */

/** Non-ADR markdown files that legitimately live in `.goat-flow/learning-loop/decisions/`. */
export const DECISION_META_FILES = new Set(["README.md", "INDEX.md"]);

/**
 * Return true for ADR decision records, excluding README/INDEX metadata files.
 * Use when separating real decision records from bucket metadata while counting or extracting facts from `.goat-flow/learning-loop/decisions/`.
 *
 * @param fileName - Base file name (not a full path) to classify.
 * @returns `true` when the file is a `.md` decision record, `false` for the
 *   README/INDEX metadata files in {@link DECISION_META_FILES} or non-markdown.
 */
export function isDecisionRecordMarkdown(fileName: string): boolean {
  return fileName.endsWith(".md") && !DECISION_META_FILES.has(fileName);
}
