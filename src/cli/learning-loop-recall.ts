/**
 * Locates active learning-loop entries by the concrete repository paths in their semantic anchors.
 *
 * Recall is deliberately a bounded locator: it reuses the shipped entry-section and `(search: ...)`
 * parsers, returns headings plus small metadata, and never inlines entry bodies or writes files.
 */
import { posix as pathPosix } from "node:path";
import { CLIError } from "./cli-error.js";
import type { ParsedCLI } from "./cli-types.js";
import { loadConfig } from "./config/reader.js";
import { createFS } from "./facts/fs.js";
import { evaluateSearchAnchors } from "./facts/shared/search-anchors.js";
import {
  INDEX_BUCKETS,
  parseActiveBucketSections,
  resolveIndexBucketPaths,
  type IndexBucket,
} from "./learning-loop-index/parse-bucket.js";
import type { ReadonlyFS } from "./types.js";

/** Default terminal/JSON listing bound; overflow remains visible in the result metadata. */
const LEARNING_LOOP_RECALL_LIMIT = 25;

/** One active entry whose canonical evidence citations matched a requested path. */
interface LearningLoopRecallMatch {
  bucket: IndexBucket;
  sourcePath: string;
  heading: string;
  status: string;
  decisionChanged: string | null;
  matchedPaths: string[];
}

/** Stable, timestamp-free recall result used by both text and JSON renderers. */
export interface LearningLoopRecallResult {
  paths: string[];
  totalMatches: number;
  shownMatches: number;
  overflowCount: number;
  limit: number;
  matches: LearningLoopRecallMatch[];
}

/** Canonical operand plus the exact-versus-directory match policy derived for it. */
interface RecallOperand {
  path: string;
  isDirectory: boolean;
}

/** Compare POSIX-shaped paths without locale-dependent collation. */
function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Normalize one caller path without letting it escape the selected project.
 * Error behavior: throws CLIError with exit code 2 for empty, absolute, or escaping paths.
 *
 * @param rawPath - file or directory operand exactly as the caller supplied it
 * @returns normalized POSIX-shaped project-relative path
 */
function normalizeRecallPath(rawPath: string): string {
  const slashPath = rawPath.trim().replace(/\\/g, "/");
  const normalized = pathPosix.normalize(slashPath);
  if (
    slashPath.length === 0 ||
    pathPosix.isAbsolute(normalized) ||
    /^(?:[A-Za-z]:|\/\/)/u.test(slashPath) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new CLIError(
      `recall path must stay relative to the selected project: ${rawPath}`,
      2,
    );
  }
  // `path.posix.normalize` preserves a trailing slash, but matching appends its own directory separator.
  return normalized === "." ? normalized : normalized.replace(/\/+$/u, "");
}

/**
 * Normalize and classify user operands before examining citations.
 * Invariant: each sorted path appears once, with directory intent retained from any duplicate.
 * Error behavior: throws CLIError when no operand exists or one path is unsafe.
 *
 * @param fs - read-only selected-project filesystem used to identify existing directories
 * @param rawPaths - file or directory operands exactly as the caller supplied them
 * @returns canonical operands sorted by project-relative path
 */
function prepareRecallOperands(
  fs: ReadonlyFS,
  rawPaths: readonly string[],
): RecallOperand[] {
  if (rawPaths.length === 0) {
    throw new CLIError(
      "recall requires at least one file or directory path.",
      2,
    );
  }
  const operands = new Map<string, RecallOperand>();
  for (const rawPath of rawPaths) {
    const path = normalizeRecallPath(rawPath);
    const isDirectory =
      rawPath.endsWith("/") ||
      rawPath.endsWith("\\") ||
      fs.isReadableDirectory(path);
    const existing = operands.get(path);
    operands.set(path, {
      path,
      isDirectory: isDirectory || existing?.isDirectory === true,
    });
  }
  return [...operands.values()].sort((left, right) =>
    compareStable(left.path, right.path),
  );
}

/** Return whether a cited file is exactly named or lies beneath a named directory. */
function matchesOperand(citedPath: string, operand: RecallOperand): boolean {
  if (!operand.isDirectory) return citedPath === operand.path;
  if (operand.path === ".") return true;
  return citedPath === operand.path || citedPath.startsWith(`${operand.path}/`);
}

/**
 * Collect active entries whose canonical semantic anchors cite any requested file or directory.
 *
 * @param fs - read-only filesystem rooted at the selected project
 * @param bucketPaths - configured project-relative paths for all learning-loop buckets
 * @param rawPaths - user-supplied project-relative files or directories
 * @param limit - maximum entries included in the rendered result; totals always cover every match
 * @returns deterministic, body-free recall metadata ordered by source path then heading
 * @throws CLIError when no safe operand exists or the result limit is not a positive integer
 */
export function collectLearningLoopRecall(
  fs: ReadonlyFS,
  bucketPaths: Record<IndexBucket, string>,
  rawPaths: readonly string[],
  limit = LEARNING_LOOP_RECALL_LIMIT,
): LearningLoopRecallResult {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new CLIError("recall result limit must be a positive integer.", 2);
  }
  const operands = prepareRecallOperands(fs, rawPaths);
  const matches = INDEX_BUCKETS.flatMap((bucket) =>
    parseActiveBucketSections(fs, bucketPaths[bucket], bucket),
  )
    .flatMap((section): LearningLoopRecallMatch[] => {
      const matchedPaths = [
        ...new Set(
          evaluateSearchAnchors(fs, section.content, {
            sourcePath: section.sourcePath,
          })
            .map((anchor) => anchor.filePath)
            .filter((path) =>
              operands.some((operand) => matchesOperand(path, operand)),
            ),
        ),
      ].sort(compareStable);
      if (matchedPaths.length === 0) return [];
      return [
        {
          bucket: section.bucket,
          sourcePath: section.sourcePath,
          heading: section.heading,
          status: section.status,
          decisionChanged: section.decisionChanged,
          matchedPaths,
        },
      ];
    })
    .sort(
      (left, right) =>
        compareStable(left.sourcePath, right.sourcePath) ||
        compareStable(left.heading, right.heading),
    );
  const shown = matches.slice(0, limit);
  return {
    paths: operands.map((operand) => operand.path),
    totalMatches: matches.length,
    shownMatches: shown.length,
    overflowCount: matches.length - shown.length,
    limit,
    matches: shown,
  };
}

/** Render one entry as locator metadata without copying its Markdown body. */
function formatTextMatch(match: LearningLoopRecallMatch): string[] {
  return [
    `- ${match.sourcePath} (search: ${JSON.stringify(match.heading)}) [${match.bucket}; ${match.status}]`,
    ...(match.decisionChanged === null
      ? []
      : [`  Decision changed: ${match.decisionChanged}`]),
    `  Cites: ${match.matchedPaths.join(", ")}`,
  ];
}

/**
 * Render deterministic text or the timestamp-free JSON contract consumed by the CLI.
 *
 * @param result - bounded recall result returned by `collectLearningLoopRecall`
 * @param format - terminal text or machine-readable JSON
 * @returns body-free locator output without a trailing newline
 */
export function formatLearningLoopRecall(
  result: LearningLoopRecallResult,
  format: "text" | "json",
): string {
  if (format === "json") {
    return JSON.stringify({ command: "recall", ...result }, null, 2);
  }
  if (result.totalMatches === 0) {
    return `No active learning-loop entries cite: ${result.paths.join(", ")}`;
  }
  const noun = result.totalMatches === 1 ? "entry cites" : "entries cite";
  const lines = [
    `Learning-loop recall: ${result.totalMatches} active ${noun} ${result.paths.join(", ")}`,
    ...result.matches.flatMap(formatTextMatch),
  ];
  if (result.overflowCount > 0) {
    lines.push(
      `${result.overflowCount} more matching entries not shown (limit ${result.limit}).`,
    );
  }
  return lines.join("\n");
}

/**
 * Run read-only recall against the selected project and print its bounded locator result.
 * Error behavior: rejects non-text/JSON formats and any programmatic output path before scanning.
 * The handler intentionally bypasses `writeOutput`; no invocation path can persist recall output.
 *
 * @param options - parsed command options carrying the project root, operands, and output format
 * @throws CLIError when a caller bypasses parser restrictions on format or output paths
 */
export function handleLearningLoopRecallCommand(options: ParsedCLI): void {
  if (options.output !== null) {
    throw new CLIError("recall is read-only and does not support --output.", 2);
  }
  if (options.format !== "text" && options.format !== "json") {
    throw new CLIError("recall supports only text or json output.", 2);
  }
  const fs = createFS(options.projectPath);
  const configState = loadConfig(options.projectPath, fs);
  // Invalid config may contain the user's real bucket paths, so falling back to defaults could hide relevant entries.
  if (!configState.valid) {
    throw new CLIError(
      `Cannot recall with invalid .goat-flow/config.yaml: ${configState.errors.map((error) => error.message).join("; ")}`,
      2,
    );
  }
  const result = collectLearningLoopRecall(
    fs,
    resolveIndexBucketPaths(configState.config),
    options.recallPaths,
  );
  console.log(formatLearningLoopRecall(result, options.format));
}
