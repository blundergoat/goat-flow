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
      (e) => e.title,
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

  it("cuts the search anchor before an embedded double quote", () => {
    const entries = parseBucket(fs, FOOTGUNS_DIR, "footguns");
    assert.equal(entries[1]?.anchor, "## Footgun: Second active trap with a");
    assert.equal(
      entries[1]?.hook,
      "No symptoms label here, so the hook falls back to this paragraph.",
    );
  });

  it("parses lesson entries with hooks from What happened", () => {
    const entries = parseBucket(fs, LESSONS_DIR, "lessons");
    assert.equal(entries.length, 3);
    assert.equal(entries[0]?.title, "Agents must read before writing");
    assert.equal(entries[0]?.hook, "The agent edited a file it never read.");
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
      "Superseded by ADR-002, 2026-06-01 - Adopt the UNSET sentinel merge for every config layer.",
    );
  });

  it("returns an empty list for a missing bucket directory", () => {
    assert.deepEqual(
      parseBucket(fs, ".goat-flow/learning-loop/nope/", "lessons"),
      [],
    );
  });
});

describe("formatIndex", () => {
  const root = makeFixtureRepo();
  const fs = createFS(root);
  after(() => rmSync(root, { recursive: true, force: true }));

  // Anchors normally wrap in double quotes; quote-first titles keep their
  // embedded quotes and switch/escape wrappers as needed (M04, 1.13.0).
  const ROW_SCHEMA =
    /^- \[[^\]]+\]\([^)]+\.md\) \(search: ("(?:[^"\\]|\\.)+"|'[^']*"[^']*')\) - .+$/;

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
