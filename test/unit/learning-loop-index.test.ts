/**
 * Unit tests for the learning-loop index generator: parse-bucket section/ADR parsing (active
 * entries in, resolved entries out, mechanical hook extraction) and format-index rendering
 * (unified row schema, generated frontmatter, determinism). Fixtures live in a temp dir so the
 * live repo's learning-loop content never leaks into assertions.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFS } from "../../src/cli/facts/fs.js";
import { generateIndexes } from "../../src/cli/learning-loop-index/generate.js";
import { parseBucket } from "../../src/cli/learning-loop-index/parse-bucket.js";
import type { IndexBucket } from "../../src/cli/learning-loop-index/parse-bucket.js";
import { formatIndex } from "../../src/cli/learning-loop-index/format-index.js";

const FOOTGUNS_DIR = ".goat-flow/learning-loop/footguns/";
const LESSONS_DIR = ".goat-flow/learning-loop/lessons/";
const PATTERNS_DIR = ".goat-flow/learning-loop/patterns/";
const DECISIONS_DIR = ".goat-flow/learning-loop/decisions/";

const FOOTGUN_BUCKET = `---
category: hooks
last_reviewed: 2026-06-01
---

## Footgun: Active trap with symptoms

**Status:** active | **Created:** 2026-05-01 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The guard blocks every Bash call. Later sentences must not leak into the hook.

**Prevention:** Do the thing.

## Footgun: Resolved-by-status trap

**Status:** resolved | **Created:** 2026-05-02 | **Resolved:** 2026-05-03 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Old problem.

## Footgun: Second active trap with a "quoted" title

**Status:** active | **Created:** 2026-05-04 | **Evidence:** OBSERVED

No symptoms label here, so the hook falls back to this paragraph.

## Resolved Entries

## Footgun: Resolved-by-position trap

**Status:** active | **Created:** 2026-05-05 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Below the marker, must be skipped even with active status.
`;

const LESSON_BUCKET = `---
category: agent-behavior
last_reviewed: 2026-06-01
---

## Lesson: Agents must read before writing

**Created:** 2026-05-10

**What happened:** The agent edited a file it never read. The fix was re-reading.

**Prevention:** Read first.

## Lesson: "Double check" means read the files again

**Created:** 2026-05-11

**What happened:** A quote-first title used to collapse the anchor to a bare kind prefix.

**Prevention:** Keep the full heading for quote-first titles.

## Lesson: "Don't say 'trust me'" keeps anchors safe

**Created:** 2026-05-12

**What happened:** A mixed-quote title used to break the generated search payload.

**Prevention:** Escape quote payloads in the formatter.

## Lesson: Heading-only paragraphs are not summaries

### Evidence

The generated hook must use this meaningful prose.
`;

const PATTERN_BUCKET = `---
category: architecture
last_reviewed: 2026-06-01
---

## Pattern: Sentinel merge for layered config

**Context:** A CLI overrides values across N config layers. Use a sentinel.

**Approach:** Define UNSET and skip it during merge.
`;

const ADR_FILE = `# ADR-001: Adopt the sentinel merge

**Status:** Superseded by ADR-002
**Date:** 2026-05-20
**Superseded:** 2026-06-01

## Context

Layered config dropped falsy values.

## Decision

Adopt the UNSET sentinel merge for every config layer. A second sentence to drop.

## Reversibility

Two-way door.
`;

/**
 * One run-on hook with no sentence break, used to pin the truncation cap. Every agent reads a whole
 * INDEX before working, so an uncapped hook is a direct retrieval tax - this fixture fails loudly if
 * the cap is ever raised back without a deliberate decision.
 */
const LONG_HOOK_BUCKET = `---
category: long-hook
last_reviewed: 2026-06-01
---

## Lesson: Run-on hook gets truncated

**Status:** active | **Created:** 2026-05-01

**What happened:** ${"alpha bravo ".repeat(30)}omega
`;

/** Write a throw-away filesystem repo containing all four learning-loop buckets and return its root. */
function makeFixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "goatflow-llindex-"));
  for (const dir of [FOOTGUNS_DIR, LESSONS_DIR, PATTERNS_DIR, DECISIONS_DIR]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, FOOTGUNS_DIR, "hooks.md"), FOOTGUN_BUCKET);
  writeFileSync(
    join(root, FOOTGUNS_DIR, "README.md"),
    "## Footgun: <template>\n",
  );
  writeFileSync(join(root, LESSONS_DIR, "agent-behavior.md"), LESSON_BUCKET);
  writeFileSync(join(root, LESSONS_DIR, "long-hook.md"), LONG_HOOK_BUCKET);
  writeFileSync(join(root, PATTERNS_DIR, "architecture.md"), PATTERN_BUCKET);
  writeFileSync(
    join(root, DECISIONS_DIR, "ADR-001-adopt-sentinel.md"),
    ADR_FILE,
  );
  writeFileSync(join(root, DECISIONS_DIR, "README.md"), "# Decisions\n");
  writeFileSync(join(root, DECISIONS_DIR, "notes.md"), "# Not an ADR\n");
  return root;
}

describe("parseBucket", () => {
  const root = makeFixtureRepo();
  const fs = createFS(root);
  after(() => rmSync(root, { recursive: true, force: true }));

  it("includes active footguns and skips resolved-by-status, resolved-by-position, and README", () => {
    const titles = parseBucket(fs, FOOTGUNS_DIR, "footguns").map(
      (entry) => entry.title,
    );
    assert.deepEqual(titles, [
      "Active trap with symptoms",
      'Second active trap with a "quoted" title',
    ]);
  });

  it("extracts the footgun hook from the first Symptoms sentence only", () => {
    const [entry] = parseBucket(fs, FOOTGUNS_DIR, "footguns");
    assert.equal(entry?.hook, "The guard blocks every Bash call.");
    assert.equal(entry?.sourceFile, "hooks.md");
    assert.equal(entry?.anchor, "## Footgun: Active trap with symptoms");
  });

  it("extracts declared dates and byte-derived reading costs", () => {
    const [footgun] = parseBucket(fs, FOOTGUNS_DIR, "footguns");
    const lessons = parseBucket(fs, LESSONS_DIR, "lessons");
    const datedLesson = lessons.find(
      (entry) => entry.title === "Agents must read before writing",
    );
    const undatedLesson = lessons.find(
      (entry) => entry.title === "Heading-only paragraphs are not summaries",
    );
    const [decision] = parseBucket(fs, DECISIONS_DIR, "decisions");

    assert.deepEqual(
      [footgun?.declaredDate, footgun?.approxTokenEstimate],
      ["2026-05-01", 60],
    );
    assert.deepEqual(
      [datedLesson?.declaredDate, datedLesson?.approxTokenEstimate],
      ["2026-05-10", 50],
    );
    assert.deepEqual(
      [undatedLesson?.declaredDate, undatedLesson?.approxTokenEstimate],
      [null, 30],
    );
    assert.deepEqual(
      [decision?.declaredDate, decision?.approxTokenEstimate],
      ["2026-06-01", 70],
    );
  });

  it("cuts the search anchor before an embedded double quote", () => {
    const entries = parseBucket(fs, FOOTGUNS_DIR, "footguns");
    assert.equal(entries[1]?.anchor, "## Footgun: Second active trap with a");
    assert.equal(
      entries[1]?.hook,
      "No symptoms label here, so the hook falls back to this paragraph.",
    );
  });

  it("parses lesson entries with hooks from What happened", () => {
    // Scoped to its own fixture file so adding a bucket to LESSONS_DIR cannot
    // break an assertion that is really about one file's parse result.
    const entries = parseBucket(fs, LESSONS_DIR, "lessons").filter(
      (entry) => entry.sourceFile === "agent-behavior.md",
    );
    assert.equal(entries[0]?.title, "Agents must read before writing");
    assert.equal(entries[0]?.hook, "The agent edited a file it never read.");
    const headingOnlyEntry = entries.find(
      (entry) => entry.title === "Heading-only paragraphs are not summaries",
    );
    assert.equal(
      headingOnlyEntry?.hook,
      "The generated hook must use this meaningful prose.",
    );
  });

  it("truncates a run-on hook at a word boundary within the retrieval cap", () => {
    const entry = parseBucket(fs, LESSONS_DIR, "lessons").find(
      (candidate) => candidate.sourceFile === "long-hook.md",
    );
    assert.ok(entry, "expected the long-hook bucket to produce an entry");
    // The cap is a retrieval-cost budget, not a formatting preference: assert the
    // bound rather than an exact string so wording changes don't churn the test.
    assert.ok(
      entry.hook.length <= 100,
      `hook exceeded the cap at ${entry.hook.length} chars`,
    );
    assert.ok(entry.hook.endsWith("…"), "truncated hook must signal the cut");
    assert.ok(
      !entry.hook.includes("alpha bra…"),
      "truncation must fall on a word boundary, not mid-word",
    );
  });

  it("keeps the full heading as the anchor for quote-first titles", () => {
    const entries = parseBucket(fs, LESSONS_DIR, "lessons");
    // A quote-first title must NOT collapse to the shared `## Lesson:` prefix.
    assert.equal(
      entries[1]?.anchor,
      '## Lesson: "Double check" means read the files again',
    );
  });

  it("parses pattern entries with hooks from Context", () => {
    const entries = parseBucket(fs, PATTERNS_DIR, "patterns");
    assert.equal(entries.length, 1);
    assert.equal(
      entries[0]?.hook,
      "A CLI overrides values across N config layers.",
    );
  });

  it("parses ADR files with verbatim status and first Decision sentence, skipping non-ADR files", () => {
    const entries = parseBucket(fs, DECISIONS_DIR, "decisions");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.title, "ADR-001: Adopt the sentinel merge");
    assert.equal(entries[0]?.anchor, "# ADR-001: Adopt the sentinel merge");
    assert.equal(
      entries[0]?.hook,
      "Superseded by ADR-002 - Adopt the UNSET sentinel merge for every config layer.",
    );
  });

  it("returns an empty list for a missing bucket directory", () => {
    assert.deepEqual(
      parseBucket(fs, ".goat-flow/learning-loop/nope/", "lessons"),
      [],
    );
  });

  // Fixture purpose: writes a prose-only learning file and regenerates its bucket so content
  // that INDEX-first retrieval cannot reach produces a stable, machine-readable diagnostic.
  it("diagnoses body content that produces no index rows", () => {
    const diagnosticRoot = mkdtempSync(join(tmpdir(), "goatflow-llgap-"));
    try {
      mkdirSync(join(diagnosticRoot, LESSONS_DIR), { recursive: true });
      writeFileSync(
        join(diagnosticRoot, LESSONS_DIR, "legacy.md"),
        "---\ncategory: legacy\nlast_reviewed: 2026-06-01\n---\n\nThis prose has no indexed lesson heading.\n",
      );
      const results = generateIndexes(
        diagnosticRoot,
        createFS(diagnosticRoot),
        {
          footguns: FOOTGUNS_DIR,
          lessons: LESSONS_DIR,
          patterns: PATTERNS_DIR,
          decisions: DECISIONS_DIR,
        },
      );
      const lessons = results.find((result) => result.bucket === "lessons");

      assert.deepEqual(lessons?.diagnostics, [
        "[unindexed-bucket-content] .goat-flow/learning-loop/lessons/legacy.md has body content but no ## Lesson: entry",
      ]);
    } finally {
      rmSync(diagnosticRoot, { recursive: true, force: true });
    }
  });
});

describe("formatIndex", () => {
  const root = makeFixtureRepo();
  const fs = createFS(root);
  after(() => rmSync(root, { recursive: true, force: true }));

  // Anchors normally wrap in double quotes; quote-first titles keep their
  // embedded quotes and switch/escape wrappers as needed. Every row ends with
  // byte-derived cost; the declared date occupies the first suffix slot when present.
  const ROW_SCHEMA =
    /^- \[[^\]]+\]\([^)]+\.md\) \(search: ("(?:[^"\\]|\\.)+"|'[^']*"[^']*')\) - .+ \((?:\d{4}-\d{2}-\d{2}; )?~\d+ tok\)$/;

  it("renders the unified row schema with generated frontmatter for every bucket", () => {
    const buckets: Array<[IndexBucket, string]> = [
      ["footguns", FOOTGUNS_DIR],
      ["lessons", LESSONS_DIR],
      ["patterns", PATTERNS_DIR],
      ["decisions", DECISIONS_DIR],
    ];
    const rendered = buckets.map(([bucket, dir]) => ({
      bucket,
      content: formatIndex(bucket, parseBucket(fs, dir, bucket)),
    }));
    assert.equal(
      rendered.every(({ content }) => /^---\ncategory: index\n/.test(content)),
      true,
    );
    assert.equal(
      rendered.every(({ bucket, content }) =>
        new RegExp(`\nbucket: ${bucket}\n`).test(content),
      ),
      true,
    );
    assert.equal(
      rendered.every(({ content }) => /\ngenerated: true\n/.test(content)),
      true,
    );
    assert.equal(
      rendered.every(({ content }) => !/last_reviewed/.test(content)),
      true,
    );
    const rows = rendered.flatMap(({ bucket, content }) =>
      content
        .split("\n")
        .filter((line) => line.startsWith("- ["))
        .map((row) => `${bucket}: ${row}`),
    );
    assert.equal(rows.length > 0, true);
    assert.equal(
      rows.every((row) => ROW_SCHEMA.test(row.replace(/^[^:]+: /, ""))),
      true,
    );
  });

  it("wraps quote-containing anchors in single quotes in rendered rows", () => {
    const content = formatIndex(
      "lessons",
      parseBucket(fs, LESSONS_DIR, "lessons"),
    );
    assert.match(
      content,
      /\(search: '## Lesson: "Double check" means read the files again'\)/,
    );
  });

  it("escapes mixed quote anchors in rendered rows", () => {
    const content = formatIndex(
      "lessons",
      parseBucket(fs, LESSONS_DIR, "lessons"),
    );
    assert.match(
      content,
      /\(search: "## Lesson: \\"Don't say 'trust me'\\" keeps anchors safe"\)/,
    );
  });

  it("renders declared dates without inventing one for an undated entry", () => {
    const content = formatIndex(
      "lessons",
      parseBucket(fs, LESSONS_DIR, "lessons"),
    );
    const datedRow = content
      .split("\n")
      .find((line) => line.includes("Agents must read before writing"));
    const undatedRow = content
      .split("\n")
      .find((line) =>
        line.includes("Heading-only paragraphs are not summaries"),
      );

    assert.match(datedRow ?? "", /\(2026-05-10; ~50 tok\)$/);
    assert.match(undatedRow ?? "", /\(~30 tok\)$/);
    assert.doesNotMatch(undatedRow ?? "", /\(\d{4}-\d{2}-\d{2};/);
  });

  it("is deterministic across repeated parse+format runs", () => {
    const first = formatIndex(
      "footguns",
      parseBucket(fs, FOOTGUNS_DIR, "footguns"),
    );
    const second = formatIndex(
      "footguns",
      parseBucket(fs, FOOTGUNS_DIR, "footguns"),
    );
    assert.equal(first, second);
  });

  it("renders an explicit no-active-entries marker for an empty bucket", () => {
    assert.match(formatIndex("lessons", []), /_No active entries\._/);
  });
});
