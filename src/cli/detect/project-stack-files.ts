/**
 * Small read-only filesystem predicates shared by the project-stack detectors: "does any of these candidate paths/globs exist" and "read the first
 * one that does".
 * They exist so each detector row can be a plain list of alternatives (any-of semantics) without every caller re-writing the same loop.
 */
import type { ReadonlyFS } from "../types.js";

/**
 * Report whether at least one of the candidate paths exists. Used to match a
 * detector row whose paths are alternatives (any one present is a hit).
 *
 * @param fs - read-only filesystem adapter for the target project
 * @param paths - exact path alternatives; an empty list is never a match
 * @returns true once any path exists; false when none do
 */
export function hasAnyPath(fs: ReadonlyFS, paths: readonly string[]): boolean {
  return paths.some((path) => fs.exists(path));
}

/**
 * Report whether at least one of the candidate globs matches a file, without
 * materializing every match. Used for detector rows keyed on glob alternatives.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @param globs - glob alternatives in goat-flow's relative glob syntax
 * @returns true once any glob matches at least one file; false otherwise
 */
export function hasAnyGlob(fs: ReadonlyFS, globs: readonly string[]): boolean {
  return globs.some((pattern) => fs.existsGlob(pattern));
}

/**
 * Read the first candidate path that exists, in list order, so callers can list
 * config-file alternatives most-specific first and take the first hit.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @param paths - path alternatives tried in order; order encodes precedence
 * @returns the first readable file's contents, or null when none exist or are readable
 */
export function readFirstExistingFile(
  fs: ReadonlyFS,
  paths: readonly string[],
): string | null {
  for (const path of paths) {
    const content = fs.readFile(path);
    if (content !== null) return content;
  }
  return null;
}
