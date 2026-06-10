/**
 * Unit tests for the `index-fresh` stats check: collectIndexFreshness state detection across all
 * four learning-loop buckets (fresh / stale / missing / no-bucket) and its integration into
 * checkStats (stale = blocking finding, missing = advisory warning). Fixtures live in a temp dir
 * so the live repo's generated indexes never leak into assertions.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFS } from "../../src/cli/facts/fs.js";
import {
  parseBucket,
  type IndexBucket,
} from "../../src/cli/learning-loop-index/parse-bucket.js";
import { formatIndex } from "../../src/cli/learning-loop-index/format-index.js";
import {
  collectIndexFreshness,
  type IndexFreshness,
} from "../../src/cli/stats/index-freshness.js";
import {
  buildStatsReport,
  checkStats,
  type BucketSection,
} from "../../src/cli/stats/stats.js";
import type { SharedFacts } from "../../src/cli/types.js";

const BUCKET_PATHS: Record<IndexBucket, string> = {
  footguns: ".goat-flow/learning-loop/footguns/",
  lessons: ".goat-flow/learning-loop/lessons/",
  patterns: ".goat-flow/learning-loop/patterns/",
  decisions: ".goat-flow/learning-loop/decisions/",
};
const INDEX_BUCKET_COUNT = 4;

const BUCKET_CONTENT: Record<IndexBucket, [string, string]> = {
  footguns: [
    "hooks.md",
    "---\ncategory: hooks\nlast_reviewed: 2026-06-01\n---\n\n## Footgun: A trap\n\n**Status:** active | **Created:** 2026-05-01 | **Evidence:** ACTUAL_MEASURED\n\n**Symptoms:** It bites.\n",
  ],
  lessons: [
    "agent.md",
    "---\ncategory: agent\nlast_reviewed: 2026-06-01\n---\n\n## Lesson: A lesson\n\n**Created:** 2026-05-01\n\n**What happened:** Something went wrong.\n",
  ],
  patterns: [
    "arch.md",
    "---\ncategory: arch\nlast_reviewed: 2026-06-01\n---\n\n## Pattern: A pattern\n\n**Context:** When layering configs.\n",
  ],
  decisions: [
    "ADR-001-a-decision.md",
    "# ADR-001: A decision\n\n**Status:** Accepted\n**Date:** 2026-05-01\n\n## Context\n\nWhy.\n\n## Decision\n\nDo the thing.\n\n## Reversibility\n\nTwo-way door.\n",
  ],
};

/** Write a temp filesystem repo with all four buckets and freshly generated INDEX.md files; returns its root. */
function makeFreshRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "goatflow-indexfresh-"));
  const fs = createFS(root);
  for (const [bucket, dirPath] of Object.entries(BUCKET_PATHS)) {
    const [file, content] = BUCKET_CONTENT[bucket as IndexBucket];
    mkdirSync(join(root, dirPath), { recursive: true });
    writeFileSync(join(root, dirPath, file), content);
    writeFileSync(
      join(root, dirPath, "INDEX.md"),
      formatIndex(
        bucket as IndexBucket,
        parseBucket(fs, dirPath, bucket as IndexBucket),
      ),
    );
  }
  return root;
}

/** Index a freshness list by bucket for direct state assertions. */
function byBucket(entries: IndexFreshness[]): Record<string, IndexFreshness> {
  return Object.fromEntries(entries.map((entry) => [entry.bucket, entry]));
}

/** Minimal passing learning-loop section so checkStats verdicts isolate the index rules. */
function cleanSection(path: string): BucketSection {
  return {
    path,
    exists: true,
    totalEntries: 1,
    totalStaleRefs: 0,
    totalInvalidLineRefs: 0,
    bands: { fresh: 1, aging: 0, stale: 0, unknown: 0 },
    buckets: [],
    formatDiagnostic: null,
  };
}

/** Wrap index freshness entries in a stats report whose other sections are clean. */
function reportWith(indexes: IndexFreshness[]) {
  return {
    footguns: cleanSection(BUCKET_PATHS.footguns),
    lessons: cleanSection(BUCKET_PATHS.lessons),
    indexes,
  };
}

describe("collectIndexFreshness", () => {
  const root = makeFreshRepo();
  const fs = createFS(root);
  after(() => rmSync(root, { recursive: true, force: true }));

  it("reports fresh for every bucket immediately after generation", () => {
    const states = collectIndexFreshness(fs, BUCKET_PATHS).map((e) => e.state);
    assert.deepEqual(states, ["fresh", "fresh", "fresh", "fresh"]);
  });

  // Fixture purpose: mutates one bucket per temp repo so every bucket can independently report stale.
  it("reports stale after a bucket entry changes in any of the four buckets", () => {
    for (const [bucket, dirPath] of Object.entries(BUCKET_PATHS)) {
      const stale = makeFreshRepo();
      const [file] = BUCKET_CONTENT[bucket as IndexBucket];
      if (bucket === "decisions") {
        writeFileSync(
          join(stale, dirPath, "ADR-002-second-decision.md"),
          "# ADR-002: Second decision\n\n**Status:** Accepted\n**Date:** 2026-06-02\n\n## Context\n\nWhy.\n\n## Decision\n\nAlso do this.\n\n## Reversibility\n\nTwo-way door.\n",
        );
      } else {
        appendFileSync(
          join(stale, dirPath, file),
          `\n## ${bucket === "footguns" ? "Footgun" : bucket === "lessons" ? "Lesson" : "Pattern"}: Added entry\n\n**Status:** active | **Created:** 2026-06-02 | **Evidence:** OBSERVED\n\n**Symptoms:** New.\n\n**What happened:** New.\n\n**Context:** New.\n`,
        );
      }
      const state = byBucket(
        collectIndexFreshness(createFS(stale), BUCKET_PATHS),
      )[bucket]?.state;
      rmSync(stale, { recursive: true, force: true });
      assert.equal(state, "stale", `${bucket} should be stale`);
    }
  });

  it("reports stale when the on-disk INDEX is hand-edited", () => {
    const edited = makeFreshRepo();
    appendFileSync(
      join(edited, BUCKET_PATHS.decisions, "INDEX.md"),
      '- [Hand-added row](nope.md) (search: "x") - drift\n',
    );
    const state = byBucket(
      collectIndexFreshness(createFS(edited), BUCKET_PATHS),
    )["decisions"]?.state;
    rmSync(edited, { recursive: true, force: true });
    assert.equal(state, "stale");
  });

  it("reports missing when INDEX.md is absent and no-bucket when the directory is absent", () => {
    const partial = makeFreshRepo();
    rmSync(join(partial, BUCKET_PATHS.patterns, "INDEX.md"));
    rmSync(join(partial, BUCKET_PATHS.lessons), { recursive: true });
    const states = byBucket(
      collectIndexFreshness(createFS(partial), BUCKET_PATHS),
    );
    rmSync(partial, { recursive: true, force: true });
    assert.equal(states["patterns"]?.state, "missing");
    assert.equal(states["lessons"]?.state, "no-bucket");
    assert.equal(states["footguns"]?.state, "fresh");
  });

  it("treats a CRLF-converted INDEX checkout as fresh, not stale", () => {
    const crlf = makeFreshRepo();
    const indexPath = join(crlf, BUCKET_PATHS.footguns, "INDEX.md");
    const indexWithLf = formatIndex(
      "footguns",
      parseBucket(createFS(crlf), BUCKET_PATHS.footguns, "footguns"),
    );
    writeFileSync(indexPath, indexWithLf.replace(/\n/g, "\r\n"));
    const state = byBucket(collectIndexFreshness(createFS(crlf), BUCKET_PATHS))[
      "footguns"
    ]?.state;
    rmSync(crlf, { recursive: true, force: true });
    assert.equal(state, "fresh");
  });
});

describe("checkStats index-fresh integration", () => {
  const root = makeFreshRepo();
  const fs = createFS(root);
  after(() => rmSync(root, { recursive: true, force: true }));

  /** Build a complete clean footgun fact section for stats report fixtures. */
  function cleanFootguns(): SharedFacts["footguns"] {
    return {
      path: BUCKET_PATHS.footguns,
      exists: true,
      hasEvidence: true,
      entryCount: 1,
      labelCount: 0,
      hasEvidenceLabels: true,
      dirMentions: new Map(),
      staleRefs: [],
      invalidLineRefs: [],
      duplicateSurfacePaths: [],
      totalRefs: 0,
      validRefs: 0,
      formatDiagnostic: null,
      buckets: [],
    };
  }

  /** Build a complete clean lesson fact section for stats report fixtures. */
  function cleanLessons(): SharedFacts["lessons"] {
    return {
      path: BUCKET_PATHS.lessons,
      exists: true,
      hasEntries: true,
      entryCount: 1,
      staleRefs: [],
      invalidLineRefs: [],
      duplicateSurfacePaths: [],
      formatDiagnostic: null,
      buckets: [],
    };
  }

  it("fails with an index-stale finding when an index drifts", () => {
    const indexes = collectIndexFreshness(fs, BUCKET_PATHS).map((entry) =>
      entry.bucket === "footguns"
        ? { ...entry, state: "stale" as const }
        : entry,
    );
    const verdict = checkStats(reportWith(indexes));
    assert.equal(verdict.status, "fail");
    assert.equal(verdict.findings[0]?.rule, "index-stale");
    assert.match(verdict.findings[0]?.message ?? "", /goat-flow index/);
  });

  it("passes with an index-missing warning when an index was never generated", () => {
    const indexes = collectIndexFreshness(fs, BUCKET_PATHS).map((entry) =>
      entry.bucket === "patterns"
        ? { ...entry, state: "missing" as const }
        : entry,
    );
    const verdict = checkStats(reportWith(indexes));
    assert.equal(verdict.status, "pass");
    assert.equal(verdict.warnings[0]?.rule, "index-missing");
  });

  it("stays silent for no-bucket directories", () => {
    const indexes = collectIndexFreshness(fs, BUCKET_PATHS).map((entry) => ({
      ...entry,
      state: "no-bucket" as const,
    }));
    const verdict = checkStats(reportWith(indexes));
    assert.equal(verdict.status, "pass");
    assert.equal(verdict.warnings.length, 0);
  });

  it("buildStatsReport threads the indexes section through to checkStats", () => {
    const shared = {
      footguns: cleanFootguns(),
      lessons: cleanLessons(),
      indexes: collectIndexFreshness(fs, BUCKET_PATHS),
    };
    const report = buildStatsReport(shared);
    assert.equal(report.indexes?.length, INDEX_BUCKET_COUNT);
    assert.equal(checkStats(report).status, "pass");
  });
});
