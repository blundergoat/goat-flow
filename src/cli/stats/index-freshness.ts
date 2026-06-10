/**
 * The `index-fresh` collector behind `goat-flow stats --check`: detects when a generated
 * learning-loop INDEX.md no longer matches its bucket content. Freshness is decided by re-running
 * the generator in memory and string-comparing against the on-disk file - content comparison, not
 * mtimes, because mtimes false-stale after checkout/restore and are not portable. A missing
 * INDEX.md is reported as `missing` (advisory - a fresh install must not fail CI before the first
 * `goat-flow index` run); a missing bucket directory is `no-bucket` and never reported.
 */
import { formatIndex } from "../learning-loop-index/format-index.js";
import {
  INDEX_BUCKETS,
  parseBucket,
  type IndexBucket,
} from "../learning-loop-index/parse-bucket.js";
import type { ReadonlyFS } from "../types.js";

/**
 * Freshness verdict for one bucket index: `fresh` (on-disk matches regeneration), `stale`
 * (content drift - blocking), `missing` (bucket exists, INDEX.md absent - advisory), or
 * `no-bucket` (directory absent - skipped entirely).
 */
type IndexFreshnessState = "fresh" | "stale" | "missing" | "no-bucket";

/** One bucket's index-freshness result consumed by `checkStats` and the stats renderers. */
export interface IndexFreshness {
  bucket: IndexBucket;
  dirPath: string;
  indexPath: string;
  state: IndexFreshnessState;
}

/** Build the INDEX.md path inside a bucket directory regardless of trailing-slash config style. */
function indexPathFor(dirPath: string): string {
  return `${dirPath.replace(/\/$/, "")}/INDEX.md`;
}

/**
 * Compute index freshness for all four learning-loop buckets.
 *
 * @param fs - read-only filesystem adapter rooted at the target project
 * @param paths - bucket-keyed directory paths, normally from `resolveIndexBucketPaths`
 * @returns one freshness record per bucket in stable INDEX_BUCKETS order
 */
export function collectIndexFreshness(
  fs: ReadonlyFS,
  paths: Record<IndexBucket, string>,
): IndexFreshness[] {
  return INDEX_BUCKETS.map((bucket) => {
    const dirPath = paths[bucket];
    const indexPath = indexPathFor(dirPath);
    if (!fs.exists(dirPath)) {
      return { bucket, dirPath, indexPath, state: "no-bucket" as const };
    }
    const onDisk = fs.readFile(indexPath);
    if (onDisk === null) {
      return { bucket, dirPath, indexPath, state: "missing" as const };
    }
    const expected = formatIndex(bucket, parseBucket(fs, dirPath, bucket));
    // CRLF-normalize so a Windows autocrlf checkout does not read as permanent staleness.
    const state =
      onDisk.replace(/\r\n/g, "\n") === expected ? "fresh" : "stale";
    return { bucket, dirPath, indexPath, state };
  });
}
