/**
 * Write-side wrapper around the learning-loop index generator: parses every bucket and writes the
 * rendered INDEX.md files to disk. Shared by the `goat-flow index` command and the post-install
 * step so both produce identical files. Buckets whose directory is absent are skipped (never
 * created) so projects that adopted only part of the learning loop stay untouched.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadonlyFS } from "../types.js";
import { formatIndex } from "./format-index.js";
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
      return { bucket, indexRelPath, entryCount: null };
    }
    const entries = parseBucket(fs, dirPath, bucket);
    writeFileSync(
      join(projectPath, indexRelPath),
      formatIndex(bucket, entries),
    );
    return { bucket, indexRelPath, entryCount: entries.length };
  });
}
