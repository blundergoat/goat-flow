/** Decision-bucket markdown classification shared by stats and fact extractors. */

/** Non-ADR markdown files that legitimately live in `.goat-flow/learning-loop/decisions/`. */
export const DECISION_META_FILES = new Set(["README.md", "INDEX.md"]);

/** Return true for ADR decision records, excluding README/INDEX metadata files. */
export function isDecisionRecordMarkdown(fileName: string): boolean {
  return fileName.endsWith(".md") && !DECISION_META_FILES.has(fileName);
}
