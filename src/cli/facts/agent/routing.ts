/**
 * Router fact extraction - collects referenced paths from instruction file sections.
 */
import type { AgentFacts, ReadonlyFS } from "../../types.js";
import { extractSection } from "./instruction.js";

/** Return true if a string contains '/' or '.', suggesting a file path. */
function looksLikePath(s: string): boolean {
  return s.includes("/") || s.includes(".");
}

/** Return true if a string contains glob or template characters. */
function hasGlobChars(s: string): boolean {
  return s.includes("*") || s.includes("{");
}

/** Add a discovered path once without duplicating earlier matches. */
export function pushUniquePath(paths: string[], path: string): void {
  if (paths.includes(path) === false) {
    paths.push(path);
  }
}

/** Collect paths matching a regex pattern, filtered by a validation predicate. */
function collectMatchedPaths(
  content: string,
  pattern: RegExp,
  isValid: (path: string) => boolean,
  paths: string[],
): void {
  for (const match of content.matchAll(pattern)) {
    const path = match[1];
    if (path === undefined) continue;
    if (!isValid(path)) continue;
    pushUniquePath(paths, path);
  }
}

/** Treat backtick-wrapped router references as paths only when they look local and literal. */
function isRouterBacktickPath(path: string): boolean {
  return !hasGlobChars(path) && looksLikePath(path);
}

/** Treat markdown link targets as router paths only when they look local and literal. */
function isRouterLinkPath(path: string): boolean {
  return !hasGlobChars(path) && !path.startsWith("http") && looksLikePath(path);
}

/** Extract all file/directory paths referenced in the Router Table section. */
function extractRouterPaths(content: string): string[] {
  /** Accumulated list of discovered router paths */
  const paths: string[] = [];
  /** Content of the router section extracted from the instruction file */
  const routerSection = extractSection(content, "router");
  if (routerSection == null) return paths;

  collectMatchedPaths(routerSection, /`([^`]+)`/g, isRouterBacktickPath, paths);
  collectMatchedPaths(routerSection, /\]\(([^)]+)\)/g, isRouterLinkPath, paths);

  return paths;
}

/** Resolve referenced paths against the filesystem, counting hits and misses. */
function resolveReferencedPaths(
  fs: ReadonlyFS,
  paths: string[],
): {
  resolved: number;
  unresolved: string[];
} {
  let resolved = 0;
  const unresolved: string[] = [];

  for (const path of paths) {
    if (fs.exists(path)) {
      resolved++;
    } else {
      unresolved.push(path);
    }
  }

  return { resolved, unresolved };
}

/** Extract router table facts: paths found and their resolution status. */
export function extractRouterFacts(
  fs: ReadonlyFS,
  content: string | null,
): AgentFacts["router"] {
  const paths = content !== null ? extractRouterPaths(content) : [];
  const resolution = resolveReferencedPaths(fs, paths);

  return {
    exists: paths.length > 0,
    paths,
    resolved: resolution.resolved,
    unresolved: resolution.unresolved,
  };
}

// settingsLocal extraction removed - personal preference file, not a project quality signal.
// askFirst extraction removed - ask_first config field removed from CLI (ADR-039).

// ─── Composer ────────────────────────────────────────────────────────
