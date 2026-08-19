/**
 * Checks whether the user's `.gitignore` covers the entries that keep secrets and local settings out of version control.
 *
 * This is a small check with a large consequence: a missing `.env` line is how a user's credentials end up committed.
 *
 * CI workflow validation deliberately lives outside this module, because how a project runs CI is its own choice rather than a goat-flow requirement.
 */
import type { SharedFacts, ReadonlyFS } from "../../types.js";

/** Gitignore entries that every project must include for secret protection. */
const REQUIRED_GITIGNORE_ENTRIES = [".env", "settings.local.json"];

/**
 * Extract `.gitignore` presence and required-entry coverage.
 *
 * @param fs - project filesystem adapter used to read `.gitignore`
 * @returns gitignore coverage facts consumed by shared harness checks
 */
export function extractGitignoreFacts(
  fs: ReadonlyFS,
): SharedFacts["gitignore"] {
  const content = fs.readFile(".gitignore");
  return {
    exists: content !== null,
    hasRequiredEntries:
      content !== null &&
      REQUIRED_GITIGNORE_ENTRIES.every((entry) => content.includes(entry)),
  };
}
