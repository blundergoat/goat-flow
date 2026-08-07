/**
 * Decides which file references in a user's learning-loop entry are worth checking at all.
 * Every staleness check in the audit starts here: it separates real repository paths from
 * URLs, hostnames, and shorthand, and it knows which trees are deliberately local so a clean
 * checkout is never told its own notes are broken.
 *
 * The bias is deliberately conservative. A false "stale reference" on a fresh clone teaches
 * users to distrust the whole content audit, so anything ambiguous is skipped rather than
 * reported. `search-anchors.ts` and `learning-loop-common.ts` both build on these rules so the
 * same citation is judged identically wherever it appears.
 */
import type { ReadonlyFS } from "../../types.js";

/** Matches backtick and double-quoted `(search: ...)` evidence anchors. */
export const SEARCH_ANCHOR_REGEX =
  /`((?:[^`]+\.[a-zA-Z0-9]{1,10}|\.[a-zA-Z0-9_-]+))`\s*\(search:\s*(?:`([^`]+)`|"((?:\\.|[^"\\])*)")\)/g;

/** Reference-validation policy for evidence that may cite an external project. */
export interface ReferenceValidationOptions {
  /** Ignore absent target files while still validating literal needles in targets that exist. */
  allowMissingFiles?: boolean;
  /** Repo-relative document containing the citation, used to resolve skill-local paths. */
  sourcePath?: string;
}

/**
 * Decide whether a backtick-wrapped reference names a real file path rather than a
 * URL or hostname (which share the `host:port` shape). Used to gate staleness
 * checks so a `localhost:3000`-style token is never treated as a missing file.
 *
 * @param filePath - candidate reference text with any trailing `:line` already split off
 * @returns true for paths with a slash or a root-level filename extension; false for URLs, hostnames, and bare extensionless names
 */
export function isFileRef(filePath: string): boolean {
  // Skip hostname/URL patterns (not file references)
  if (
    /^https?:|:\/\//.test(filePath) ||
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(filePath)
  )
    return false;
  // Paths with '/' are clearly file paths
  if (filePath.includes("/")) return true;
  // Root-level files with extensions (e.g., AGENTS.md:42) are valid refs
  // Bare names without extensions (e.g., webpack:123) are ambiguous - skip
  return /\.[a-zA-Z0-9]+$/.test(filePath);
}

/** Paths under these dirs are intentionally gitignored per `.goat-flow/plans/.gitignore`
 *  (milestone files + plan subdirs + `.active` marker are local-session state by
 *  design). Narrative mentions of them in lessons/footguns are navigation pointers,
 *  not resolvable artifacts - treating absence as "stale" false-positives on
 *  any clean checkout or CI run, so body-text references are skipped. The two
 *  durable-evidence grammars (`(search: ...)` anchors and `Evidence anchors:` lines)
 *  are the exception: gitignored paths there violate the never-anchor-to-local-state
 *  invariant regardless of local existence and are flagged as
 *  `gitignored path used as durable evidence anchor`. Keep this list short and specific.
 *
 * @param filePath - repo-relative path the user cited in an entry
 * @returns true when the path is local-session state; a false here only means "not in a
 *   local tree", so the caller still has to check whether the file actually exists
 */
export function isIntentionallyGitignored(filePath: string): boolean {
  // Anchor files (README.md, .gitignore, .gitkeep) under these trees ARE
  // committed by design, so they are legitimate durable anchors and stay
  // subject to normal existence checks.
  if (/(?:^|\/)(README\.md|\.gitignore|\.gitkeep)$/.test(filePath))
    return false;
  return (
    filePath.startsWith(".goat-flow/plans/") ||
    filePath.startsWith(".goat-flow/scratchpad/") ||
    filePath.startsWith(".goat-flow/logs/")
  );
}

/**
 * Check whether the file path is checkable for staleness.
 *
 * @param filePath - repo-relative reference already confirmed to look like a path
 * @param fs - read-only filesystem used to test root-level existence
 * @returns true when absence is meaningful enough to report; false means the reference is
 *   skipped silently, which is what keeps shorthand out of the user's findings list
 */
export function isCheckableForStaleness(
  filePath: string,
  fs: ReadonlyFS,
): boolean {
  if (isIntentionallyGitignored(filePath)) return false;
  if (filePath.includes("/")) return true;
  // If it exists at root, it's checkable regardless of extension
  if (fs.exists(filePath)) return true;
  // A bare source filename that doesn't exist at the repo root is probably
  // shorthand for a deeply nested file; skip it to avoid false positives.
  if (
    /\.(go|ts|tsx|js|jsx|py|php|rs|java|kt|rb|cs|c|cpp|h|hpp|swift|scala)$/i.test(
      filePath,
    )
  )
    return false;
  // Non-source files (AGENTS.md, package.json, etc.) should be at root
  return true;
}
