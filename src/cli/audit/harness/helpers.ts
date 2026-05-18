/**
 * Shared helpers for harness completeness checks (deterministic pass/fail).
 */
import type { HarnessCheckDetails, HarnessCheckResult } from "../types.js";

/** Build a passing harness-check result. */
export function pass(
  findings: string[],
  details?: HarnessCheckDetails,
): HarnessCheckResult {
  return details
    ? { status: "pass", findings, recommendations: [], details }
    : { status: "pass", findings, recommendations: [] };
}

/** Build a failing harness-check result with recommendations. */
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

/** Return true when a backtick token is technical prose, not a local repo path. */
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
    /^(?:\.|src\/|app\/|apps\/|lib\/|libs\/|docs\/|test\/|tests\/|scripts\/|workflow\/|config\/|packages\/|web-components\/|\.github\/|\.goat-flow\/|\.claude\/|\.codex\/|\.agents\/|\.gemini\/)/i.test(
      path,
    ) || /\/[^/]+\.[a-z0-9]+$/i.test(path)
  );
}

/** Extract backtick-quoted file paths from markdown content. */
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

/** Collect .md files from a directory tree (one level deep). */
export function collectMarkdownFiles(
  fs: { listDir(p: string): string[] },
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
        for (const sf of fs.listDir(entryPath)) {
          if (sf.endsWith(".md")) mdFiles.push(`${entryPath}/${sf}`);
        }
      } catch {
        // Not a directory, skip
      }
    }
  }
  return mdFiles;
}
