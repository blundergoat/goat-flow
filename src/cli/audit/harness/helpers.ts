/**
 * Shared helpers for harness completeness checks (deterministic pass/fail).
 */
import type { HarnessCheckResult } from "../types.js";

export function pass(findings: string[]): HarnessCheckResult {
  return { status: "pass", findings, recommendations: [] };
}

export function fail(
  findings: string[],
  recommendations: string[],
  howToFix?: string[],
): HarnessCheckResult {
  return { status: "fail", findings, recommendations, howToFix };
}

/** Extract backtick-quoted file paths from markdown content. */
export function extractBacktickPaths(content: string): string[] {
  const pattern = /`([^`]*\/[^`]+)`/g;
  const paths: string[] = [];
  let m;
  while ((m = pattern.exec(content))) {
    const p = m[1]!;
    if (p.includes("://") || p.includes("*") || p.includes("(")) continue;
    if (p.startsWith("/") || p.includes(" ")) continue;
    paths.push(p);
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
