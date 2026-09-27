/**
 * Generate learning-loop INDEX.md files from bucket content for CLI, dashboard, install, and learn flows.
 * Existing buckets are regenerated; absent buckets stay untouched.
 *
 * Public regeneration claims every index path so another cooperating writer cannot overwrite newer entries.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadonlyFS } from "../types.js";
import {
  listMarkdownEntries,
  parseMarkdownFrontmatter,
} from "../facts/shared/learning-loop-common.js";
import { formatIndex } from "./format-index.js";
import {
  acquirePathWriteClaims,
  readPathWriteTargetIdentity,
  releasePathWriteClaims,
} from "../path-write-claim.js";
import {
  INDEX_BUCKETS,
  parseBucket,
  type IndexBucket,
} from "./parse-bucket.js";

/** Outcome of one bucket's generation pass; `entryCount` is null when the bucket was skipped. */
export interface GeneratedIndex {
  bucket: IndexBucket;
  /** POSIX-shaped project-relative INDEX.md path, safe for user-visible output on Windows. */
  indexRelPath: string;
  entryCount: number | null;
  /** Named content gaps that keep a source file unreachable through INDEX-first retrieval. */
  diagnostics: string[];
}

/** Entry heading required for each non-ADR bucket file to participate in generated retrieval. */
const ENTRY_HEADING = {
  footguns: "Footgun",
  lessons: "Lesson",
  patterns: "Pattern",
} as const;

/** Find non-empty bucket files whose grammar cannot produce any generated index row. */
function unindexedContentDiagnostics(
  fs: ReadonlyFS,
  dirPath: string,
  bucket: IndexBucket,
): string[] {
  if (bucket === "decisions") return [];
  const kind = ENTRY_HEADING[bucket];
  const entryHeading = new RegExp(`^##\\s+${kind}:\\s+\\S`, "mu");
  return listMarkdownEntries(fs, dirPath).files.flatMap((file) => {
    const { body } = parseMarkdownFrontmatter(file.content);
    if (body.trim().length === 0 || entryHeading.test(body)) return [];
    return [
      `[unindexed-bucket-content] ${file.path} has body content but no ## ${kind}: entry`,
    ];
  });
}

/**
 * Regenerate INDEX.md for every learning-loop bucket that exists in the target project.
 *
 * @param projectPath - absolute target project root used to resolve write destinations
 * @param fs - read-only filesystem adapter rooted at the same project, used for parsing
 * @param bucketPaths - bucket-keyed relative directory paths, normally from `resolveIndexBucketPaths`
 * @returns one result per bucket in stable order; skipped buckets carry `entryCount: null`
 */
export function generateIndexes(
  projectPath: string,
  fs: ReadonlyFS,
  bucketPaths: Record<IndexBucket, string>,
): GeneratedIndex[] {
  return INDEX_BUCKETS.map((bucket) => {
    const dirPath = bucketPaths[bucket];
    const indexRelPath = `${dirPath.replace(/\/$/, "")}/INDEX.md`;
    if (!fs.exists(dirPath)) {
      return { bucket, indexRelPath, entryCount: null, diagnostics: [] };
    }
    const entries = parseBucket(fs, dirPath, bucket);
    const diagnostics = unindexedContentDiagnostics(fs, dirPath, bucket);
    writeFileSync(
      join(projectPath, indexRelPath),
      formatIndex(bucket, entries),
    );
    return { bucket, indexRelPath, entryCount: entries.length, diagnostics };
  });
}

/**
 * Hold all four index claims when a user runs `index` or regenerates indexes from the dashboard.
 * If every bucket is absent, return skipped results; a bucket appearing later needs a fresh run.
 *
 * @param projectPath - selected target project root
 * @param fs - read-only adapter used to parse bucket content
 * @param bucketPaths - configured project-relative bucket directories
 * @returns results in bucket order; absent buckets have `entryCount: null`
 * @throws PathWriteClaimError when an index is busy or changes before admission; generation and cleanup failures also propagate
 */
export function generateIndexesWithClaims(
  projectPath: string,
  fs: ReadonlyFS,
  bucketPaths: Record<IndexBucket, string>,
): GeneratedIndex[] {
  // No bucket existed at admission, so leave a newly appearing bucket for the next run instead of writing without a claim.
  if (!INDEX_BUCKETS.some((bucket) => fs.exists(bucketPaths[bucket]))) {
    return INDEX_BUCKETS.map((bucket) => ({
      bucket,
      indexRelPath: `${bucketPaths[bucket].replace(/\/+$/u, "")}/INDEX.md`,
      entryCount: null,
      diagnostics: [],
    }));
  }
  const targetPaths = INDEX_BUCKETS.map(
    (bucket) => `${bucketPaths[bucket].replace(/\/+$/u, "")}/INDEX.md`,
  );
  const claims = acquirePathWriteClaims(
    projectPath,
    targetPaths.map((targetPath) => ({
      targetPath,
      expectedIdentity: readPathWriteTargetIdentity(projectPath, targetPath),
    })),
  );
  let generationError: unknown = null;
  try {
    return generateIndexes(projectPath, fs, bucketPaths);
  } catch (error) {
    // A parse or write failure still releases claims before the caller reports it to the user.
    generationError = error;
    throw error;
  } finally {
    const unreleased = releasePathWriteClaims(claims).filter(
      (result) => result.status !== "released",
    );
    // A completed write cannot report success while any index claim still needs operator attention.
    if (unreleased.length > 0) {
      const diagnostic = `Index generation could not confirm claim release for ${unreleased.map((result) => result.targetPath).join(", ")}. Inspect .goat-flow/state/locks before retrying.`;
      // Keep the original generation error primary, while still reporting that claim cleanup was uncertain.
      if (generationError !== null) console.error(diagnostic);
      else throw new Error(diagnostic);
    }
  }
}
