/**
 * Unit coverage for anchor-driven learning-loop recall.
 *
 * Fixtures use real files and the shared read-only filesystem adapter so citation resolution,
 * active-entry filtering, path normalization, grouping, ordering, and output caps exercise the
 * same contracts as the CLI without reading or changing this repository's live learning loop.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFS } from "../../src/cli/facts/fs.js";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import {
  collectLearningLoopRecall,
  formatLearningLoopRecall,
  handleLearningLoopRecallCommand,
} from "../../src/cli/learning-loop-recall.js";
import type { IndexBucket } from "../../src/cli/learning-loop-index/parse-bucket.js";

const BUCKET_PATHS: Record<IndexBucket, string> = {
  footguns: ".goat-flow/learning-loop/footguns/",
  lessons: ".goat-flow/learning-loop/lessons/",
  patterns: ".goat-flow/learning-loop/patterns/",
  decisions: ".goat-flow/learning-loop/decisions/",
};
const ACTIVE_FIXTURE_MATCH_COUNT = 4;

const LESSONS = `---
category: recall
last_reviewed: 2026-08-24
---

## Lesson: Exact file and multiple paths

**Status:** active | **Created:** 2026-08-24
**Decision changed:** Load every entry that cites any named implementation path.

**What happened:** This body is routing evidence, not recall output.

**Evidence:** \`src/core/file.ts\` (search: \`export const coreMarker\`) and \`src/other.ts\` (search: \`export const otherMarker\`).

## Lesson: Directory operand

**Created:** 2026-08-24

**What happened:** A directory should match cited files beneath it.

**Evidence:** \`src/server/terminal.ts\` (search: \`export const terminalMarker\`).

## Lesson: Resolved status is excluded

**Status:** resolved | **Created:** 2026-08-24

**What happened:** Historical material stays out of active recall.

**Evidence:** \`src/core/file.ts\` (search: \`export const coreMarker\`).

## Lesson: Entry without a citation

**Created:** 2026-08-24

**What happened:** No evidence anchor appears here.

## Resolved Entries

## Lesson: Resolved position is excluded

**Status:** active | **Created:** 2026-08-24

**What happened:** Entries below the marker are historical.

**Evidence:** \`src/core/file.ts\` (search: \`export const coreMarker\`).
`;

const FOOTGUNS = `---
category: recall
last_reviewed: 2026-08-24
---

## Footgun: Multiple entries cite one path

**Status:** active | **Created:** 2026-08-24 | **Evidence:** OBSERVED
**Decision changed:** Check every matching entry rather than stopping at the first file hit.

**Symptoms:** One cited path has more than one warning.

**Evidence:** \`src/core/file.ts\` (search: \`export const coreMarker\`).
`;

const PATTERNS = `---
category: recall
last_reviewed: 2026-08-24
---

## Pattern: No citation means no recall match

**Context:** Some entries contain only general guidance.

**Approach:** Keep them available through the generated INDEX.
`;

const DECISION = `# ADR-001: Recall accepted decisions

**Status:** Accepted
**Date:** 2026-08-24
**Decision changed:** Accepted decisions retain their declared status in recall output.

## Context

Path-based recall needs decision evidence too.

## Decision

Reuse the shipped anchor grammar.

**Evidence:** \`src/core/file.ts\` (search: \`export const coreMarker\`).
`;

/**
 * Create an isolated project whose citations resolve through the production anchor evaluator.
 * Side effect: writes a temporary fixture tree that the suite-level `after` hook removes.
 *
 * @returns absolute path to the temporary project root
 */
function makeFixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "goatflow-recall-"));
  for (const path of [
    ...Object.values(BUCKET_PATHS),
    "src/core",
    "src/server",
  ]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  writeFileSync(join(root, BUCKET_PATHS.lessons, "recall.md"), LESSONS);
  writeFileSync(join(root, BUCKET_PATHS.footguns, "recall.md"), FOOTGUNS);
  writeFileSync(join(root, BUCKET_PATHS.patterns, "recall.md"), PATTERNS);
  writeFileSync(
    join(root, BUCKET_PATHS.decisions, "ADR-001-recall.md"),
    DECISION,
  );
  writeFileSync(
    join(root, "src/core/file.ts"),
    "export const coreMarker = true;\n",
  );
  writeFileSync(
    join(root, "src/other.ts"),
    "export const otherMarker = true;\n",
  );
  writeFileSync(
    join(root, "src/server/terminal.ts"),
    "export const terminalMarker = true;\n",
  );
  writeFileSync(join(root, "LICENSE"), "fixture license\n");
  return root;
}

describe("collectLearningLoopRecall", () => {
  const root = makeFixtureRepo();
  const fs = createFS(root);
  after(() => rmSync(root, { recursive: true, force: true }));

  it("normalizes ./ operands, returns every citing entry, and excludes resolved entries", () => {
    const result = collectLearningLoopRecall(fs, BUCKET_PATHS, [
      "./src/core/file.ts",
    ]);

    assert.deepEqual(result.paths, ["src/core/file.ts"]);
    assert.equal(result.totalMatches, 3);
    assert.equal(result.overflowCount, 0);
    assert.deepEqual(
      result.matches.map((match) => [
        match.sourcePath,
        match.heading,
        match.status,
      ]),
      [
        [
          ".goat-flow/learning-loop/decisions/ADR-001-recall.md",
          "# ADR-001: Recall accepted decisions",
          "Accepted",
        ],
        [
          ".goat-flow/learning-loop/footguns/recall.md",
          "## Footgun: Multiple entries cite one path",
          "active",
        ],
        [
          ".goat-flow/learning-loop/lessons/recall.md",
          "## Lesson: Exact file and multiple paths",
          "active",
        ],
      ],
    );
    assert.deepEqual(
      result.matches.map((match) => match.matchedPaths),
      [["src/core/file.ts"], ["src/core/file.ts"], ["src/core/file.ts"]],
    );
  });

  it("matches a directory beneath it and groups multiple cited paths under one entry", () => {
    const directoryResult = collectLearningLoopRecall(fs, BUCKET_PATHS, [
      "src/server",
    ]);
    assert.deepEqual(
      directoryResult.matches.map((match) => match.heading),
      ["## Lesson: Directory operand"],
    );
    assert.deepEqual(directoryResult.matches[0]?.matchedPaths, [
      "src/server/terminal.ts",
    ]);
    const trailingSeparatorResult = collectLearningLoopRecall(
      fs,
      BUCKET_PATHS,
      ["src/server/"],
    );
    assert.deepEqual(trailingSeparatorResult.paths, ["src/server"]);
    assert.deepEqual(
      trailingSeparatorResult.matches.map((match) => match.heading),
      ["## Lesson: Directory operand"],
    );

    const multiPathResult = collectLearningLoopRecall(fs, BUCKET_PATHS, [
      "src/other.ts",
      "src/core/file.ts",
    ]);
    const lesson = multiPathResult.matches.find((match) =>
      match.heading.endsWith("Exact file and multiple paths"),
    );
    assert.deepEqual(multiPathResult.paths, [
      "src/core/file.ts",
      "src/other.ts",
    ]);
    assert.deepEqual(lesson?.matchedPaths, [
      "src/core/file.ts",
      "src/other.ts",
    ]);
  });

  it("rejects absolute, parent-escaping, and Windows drive-relative operands", () => {
    for (const unsafePath of [
      "/outside",
      "../outside",
      "C:\\outside",
      "C:outside",
      "\\\\server\\share",
    ]) {
      assert.throws(
        () => collectLearningLoopRecall(fs, BUCKET_PATHS, [unsafePath]),
        /recall path must stay relative to the selected project/,
        unsafePath,
      );
    }
  });

  it("returns an explicit zero-hit result and caps output with a named overflow", () => {
    const zero = collectLearningLoopRecall(fs, BUCKET_PATHS, ["LICENSE"]);
    assert.equal(zero.totalMatches, 0);
    assert.equal(
      formatLearningLoopRecall(zero, "text"),
      "No active learning-loop entries cite: LICENSE",
    );

    const capped = collectLearningLoopRecall(fs, BUCKET_PATHS, ["src"], 2);
    assert.equal(capped.totalMatches, ACTIVE_FIXTURE_MATCH_COUNT);
    assert.equal(capped.matches.length, 2);
    assert.equal(capped.overflowCount, 2);
    assert.match(
      formatLearningLoopRecall(capped, "text"),
      /2 more matching entries not shown \(limit 2\)\./,
    );
  });

  it("renders deterministic JSON metadata without inlining entry bodies", () => {
    const result = collectLearningLoopRecall(fs, BUCKET_PATHS, [
      "src/core/file.ts",
    ]);
    const first = formatLearningLoopRecall(result, "json");
    const second = formatLearningLoopRecall(result, "json");

    assert.equal(first, second);
    const parsed = JSON.parse(first) as {
      command: string;
      matches: Array<{ decisionChanged: string | null }>;
    };
    assert.equal(parsed.command, "recall");
    assert.equal(
      parsed.matches.at(-1)?.decisionChanged,
      "Load every entry that cites any named implementation path.",
    );
    assert.doesNotMatch(first, /This body is routing evidence/);
  });
});

describe("recall CLI parsing", () => {
  it("keeps every operand while the selected project stays at the current directory", () => {
    const parsed = parseCLIArgs([
      "recall",
      "./src/core/file.ts",
      "src/server",
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "recall");
    assert.equal(parsed.projectPath, process.cwd());
    assert.deepEqual(parsed.recallPaths, ["./src/core/file.ts", "src/server"]);
    assert.equal(parsed.format, "json");
    assert.equal(parsed.output, null);
  });

  it("rejects missing operands and every write-capable or unsupported output form", () => {
    assert.throws(
      () => parseCLIArgs(["recall"]),
      /recall requires at least one file or directory path/,
    );
    assert.throws(
      () => parseCLIArgs(["recall", "src", "--output", "recall.json"]),
      /recall is read-only and does not support --output/,
    );
    assert.throws(
      () => parseCLIArgs(["recall", "src", "--format", "markdown"]),
      /recall supports only text or json output/,
    );
  });

  it("rejects invalid project config before choosing fallback buckets", () => {
    const invalidRoot = makeFixtureRepo();
    writeFileSync(
      join(invalidRoot, ".goat-flow/config.yaml"),
      'version: "999.invalid"\n',
    );
    const options = {
      ...parseCLIArgs(["recall", "src"]),
      projectPath: invalidRoot,
    };

    try {
      assert.throws(
        () => handleLearningLoopRecallCommand(options),
        /Cannot recall with invalid \.goat-flow\/config\.yaml/u,
      );
    } finally {
      rmSync(invalidRoot, { recursive: true, force: true });
    }
  });
});
