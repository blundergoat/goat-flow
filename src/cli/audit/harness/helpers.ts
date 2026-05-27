/**
 * Shared helpers for harness completeness checks (deterministic pass/fail).
 */
import type { HarnessCheckDetails, HarnessCheckResult } from "../types.js";
import type { ReadonlyFS } from "../../types.js";

/**
 * Build a passing harness-check result with the same report shape every check uses.
 *
 * @param findings - Evidence strings that explain what the check confirmed.
 * @param details - Optional structured details rendered by callers that need more than prose.
 * @returns Harness result with no recommendations because the check passed.
 */
export function pass(
  findings: string[],
  details?: HarnessCheckDetails,
): HarnessCheckResult {
  return details
    ? { status: "pass", findings, recommendations: [], details }
    : { status: "pass", findings, recommendations: [] };
}

/**
 * Build a failing harness-check result with recommendations.
 *
 * @param findings - Evidence strings that explain what failed.
 * @param recommendations - Human-facing next actions for repairing the harness.
 * @param howToFix - Optional command-level repair steps when the fix is mechanical.
 * @param details - Optional structured details rendered by callers that need more than prose.
 * @returns Harness result that keeps evidence, recommendations, and repair steps separate.
 */
export function fail(
  findings: string[],
  recommendations: string[],
  howToFix?: string[],
  details?: HarnessCheckDetails,
): HarnessCheckResult {
  return {
    status: "fail",
    findings,
    recommendations,
    ...(howToFix ? { howToFix } : {}),
    ...(details ? { details } : {}),
  };
}

/**
 * Classify backtick tokens that are technical prose, not local repo paths.
 *
 * The harness only verifies path existence, so this filter is intentionally
 * conservative because package names, URLs, globs, and home paths would create
 * noisy false positives rather than useful cross-reference failures.
 */
function isNonRepoPathToken(path: string): boolean {
  const hasSyntax =
    path.includes("://") ||
    path.includes("*") ||
    path.includes("(") ||
    path.includes("<") ||
    path.includes(">");
  const isExternalPath =
    path.startsWith("/") ||
    path.startsWith("~/") ||
    path.includes(" ") ||
    /^@[a-z0-9._-]+\/[a-z0-9._/-]+$/i.test(path);
  return hasSyntax || isExternalPath || !looksRepoRelativePath(path);
}

/** Return true when a token has the shape of a repo-relative path. */
function looksRepoRelativePath(path: string): boolean {
  return (
    /^(?:\.|src\/|app\/|apps\/|lib\/|libs\/|docs\/|test\/|tests\/|scripts\/|workflow\/|config\/|packages\/|web-components\/|\.github\/|\.goat-flow\/|\.claude\/|\.codex\/|\.agents\/)/i.test(
      path,
    ) || /\/[^/]+\.[a-z0-9]+$/i.test(path)
  );
}

/**
 * Extract repo-looking file paths from markdown backticks.
 *
 * This is an existence-signal helper, not an ownership or agent-context check;
 * callers that need stronger semantics must layer those checks on top.
 *
 * @param content - Markdown content to scan.
 * @returns Backtick tokens that look like repo-relative paths.
 */
export function extractBacktickPaths(content: string): string[] {
  const paths: string[] = [];
  for (const match of content.matchAll(/`([^`]+)`/g)) {
    const path = match[1];
    if (path === undefined) continue;
    const isRootLineRef = /^[a-z0-9._-]+\.[a-z0-9]+:\d+$/i.test(path);
    if (isRootLineRef) {
      paths.push(path);
      continue;
    }
    if (isNonRepoPathToken(path)) continue;
    const isNestedPath = path.includes("/");
    if (!isNestedPath) continue;
    paths.push(path);
  }
  return paths;
}

/**
 * Collect markdown files from a shallow documentation tree.
 *
 * Missing directories and non-directory children are swallowed because harness
 * checks treat absent optional buckets as empty sets, not audit crashes.
 *
 * @param fs - Read-only filesystem view rooted at the audited project.
 * @param dir - Directory to scan for markdown files and one level of children.
 * @returns Repo-relative markdown file paths in the scanned tree.
 */
export function collectMarkdownFiles(
  fs: Pick<ReadonlyFS, "listDir">,
  dir: string,
): string[] {
  const mdFiles: string[] = [];
  let entries: string[];
  try {
    entries = fs.listDir(dir);
  } catch {
    return mdFiles;
  }
  // One level of descent is enough for the current docs layout and keeps the scan
  // deterministic for tests instead of walking arbitrarily deep trees.
  for (const entry of entries) {
    const entryPath = `${dir}/${entry}`;
    if (entry.endsWith(".md")) {
      mdFiles.push(entryPath);
    } else {
      try {
        for (const childEntry of fs.listDir(entryPath)) {
          if (childEntry.endsWith(".md")) {
            mdFiles.push(`${entryPath}/${childEntry}`);
          }
        }
      } catch {
        // Not a directory, skip
      }
    }
  }
  return mdFiles;
}
