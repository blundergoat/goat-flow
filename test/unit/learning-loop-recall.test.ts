/**
 * Unit coverage for anchor-driven learning-loop recall.
 *
 * Fixtures use real files and the shared read-only filesystem adapter so citation resolution,
 * active-entry filtering, path normalization, grouping, ordering, and output caps exercise the
 * same contracts as the CLI without reading or changing this repository's live learning loop.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

const CITATION_PATH = "src/cli/facts/shared/reference-paths.ts";
const SECOND_CITATION_PATH = "src/cli/facts/shared/learning-loop-common.ts";
const CITATION_NEEDLE = "shorthand for a deeply nested file";
const SECOND_CITATION_NEEDLE = "confirm the literal string still appears";
const CITATION_SOURCE = ".goat-flow/learning-loop/footguns/citations.md";
const REAL_CITATION_HEADING =
  "## Footgun: Regex-shaped search needles pass only while their file path is unresolvable";
// Copy observed evidence, then perturb only its disposable targets or citation paths.
const realFootgunBucket = readFileSync(
  new URL(
    "../../.goat-flow/learning-loop/footguns/learning-loop-extraction.md",
    import.meta.url,
  ),
  "utf8",
);
const realCitationEntry = realFootgunBucket
  .slice(realFootgunBucket.indexOf(REAL_CITATION_HEADING))
  .split("\n---\n")[0];
const realCitationTarget = readFileSync(
  new URL(`../../${CITATION_PATH}`, import.meta.url),
  "utf8",
);
const realSecondCitationTarget = readFileSync(
  new URL(`../../${SECOND_CITATION_PATH}`, import.meta.url),
  "utf8",
);

/**
 * Copy a real two-citation entry and its targets into a disposable project.
 * Side effect: writes a temporary fixture tree; the caller removes it in finally.
 */
function makeCitationFixture(
  targetContent: string | null = realCitationTarget,
  entryContent = realCitationEntry,
): string {
  const root = makeFixtureRepo();
  mkdirSync(join(root, "src/cli/facts/shared"), { recursive: true });
  writeFileSync(
    join(root, CITATION_SOURCE),
    `---\ncategory: recall\nlast_reviewed: 2026-10-02\n---\n\n${entryContent}`,
  );
  if (targetContent !== null) {
    writeFileSync(join(root, CITATION_PATH), targetContent);
  }
  writeFileSync(join(root, SECOND_CITATION_PATH), realSecondCitationTarget);
  return root;
}

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

> Historical record. These lessons are no longer active.

- **Prose-style resolved lesson** (resolved 2026-08-25) - \`src/core/file.ts\` (search: \`export const coreMarker\`) was cited by history that must not attach to the entry above.

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

  it("uses filesystem identity for case aliases without folding a case-sensitive filesystem", () => {
    const differentlyCasedPath = "SRC/Core/File.ts";
    assert.equal(
      collectLearningLoopRecall(
        { ...fs, samePathIdentity: (left, right) => left === right },
        BUCKET_PATHS,
        [differentlyCasedPath],
      ).totalMatches,
      0,
    );

    const caseInsensitiveFs = {
      ...fs,
      samePathIdentity: (leftPath: string, rightPath: string) =>
        leftPath.toLowerCase() === rightPath.toLowerCase(),
    };
    const aliased = collectLearningLoopRecall(caseInsensitiveFs, BUCKET_PATHS, [
      differentlyCasedPath,
    ]);
    assert.equal(aliased.totalMatches, 3);
    assert.deepEqual(aliased.paths, [differentlyCasedPath]);
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

  // Fixture purpose: a stored heading and decision carry ANSI color, hyperlink, and bell controls while citing a real fixture path.
  // Side effects: writes and removes one disposable learning-loop project.
  it("escapes repository-controlled terminal sequences in text output", () => {
    const controlRoot = makeFixtureRepo();
    const escape = "\u001b";
    const bell = "\u0007";
    const controlEntry = `---
category: recall-controls
last_reviewed: 2026-08-30
---

## Lesson: ${escape}[31mPainted${escape}[0m heading\u202eTXT\u2066

**Status:** active | **Created:** 2026-08-30
**Decision changed:** ${escape}]8;;https://example.invalid${bell}linked${escape}]8;;${bell}

**Evidence:** \`src/core/file.ts\` (search: \`export const coreMarker\`).
`;
    writeFileSync(
      join(controlRoot, BUCKET_PATHS.lessons, "terminal-controls.md"),
      controlEntry,
    );

    try {
      const result = collectLearningLoopRecall(
        createFS(controlRoot),
        BUCKET_PATHS,
        ["src/core/file.ts"],
      );
      const text = formatLearningLoopRecall(result, "text");
      const json = formatLearningLoopRecall(result, "json");

      assert.doesNotMatch(text, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u);
      assert.match(text, /\\u001b\[31mPainted\\u001b\[0m/u);
      assert.match(text, /\\u0007linked/u);
      assert.doesNotMatch(
        text,
        /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u,
      );
      assert.match(text, /\\u202eTXT\\u2066/u);
      assert.equal(
        (
          JSON.parse(json) as { matches: Array<{ heading: string }> }
        ).matches.some((match) => match.heading.includes(escape)),
        true,
        "JSON retains the machine-readable repository value",
      );
    } finally {
      rmSync(controlRoot, { recursive: true, force: true });
    }
  });
});

describe("recall citation freshness", () => {
  it("adds valid citation metadata without changing existing fields or text", () => {
    const root = makeCitationFixture();
    try {
      const result = collectLearningLoopRecall(createFS(root), BUCKET_PATHS, [
        CITATION_PATH,
      ]);
      const parsed = JSON.parse(formatLearningLoopRecall(result, "json"));
      const match = parsed.matches[0];
      assert.equal(result.totalMatches, 1);
      assert.deepEqual(match.matchedPaths, [CITATION_PATH]);
      assert.equal(match.sourcePath, CITATION_SOURCE);
      assert.equal(match.heading, REAL_CITATION_HEADING);
      assert.equal(match.status, "active");
      assert.equal(
        match.decisionChanged,
        "Write `(search: ...)` needles as literal substrings copied from the target file; when completing a citation's path, treat its needle as unvalidated and re-run `stats --check` in the same change.",
      );
      assert.equal(match.hasStaleCitations, false);
      assert.deepEqual(match.matchedCitations, [
        {
          filePath: CITATION_PATH,
          needle: CITATION_NEEDLE,
          status: "valid",
          reason: null,
        },
      ]);
      assert.equal(
        formatLearningLoopRecall(result, "text"),
        [
          `Learning-loop recall: 1 active entry cites ${CITATION_PATH}`,
          `- ${CITATION_SOURCE} (search: ${JSON.stringify(REAL_CITATION_HEADING)}) [footguns; active]`,
          `  Decision changed: ${match.decisionChanged}`,
          `  Cites: ${CITATION_PATH}`,
        ].join("\n"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks moved needles beside valid citations and warns before guidance", () => {
    const root = makeCitationFixture(
      realCitationTarget.replace(CITATION_NEEDLE, ""),
    );
    try {
      const fs = createFS(root);
      const result = collectLearningLoopRecall(fs, BUCKET_PATHS, [
        "src/cli/facts/shared",
      ]);
      const match = JSON.parse(formatLearningLoopRecall(result, "json"))
        .matches[0];
      assert.equal(result.totalMatches, 1);
      assert.equal(match.hasStaleCitations, true);
      assert.deepEqual(match.matchedPaths, [
        SECOND_CITATION_PATH,
        CITATION_PATH,
      ]);
      assert.deepEqual(
        match.matchedCitations.map(
          (citation: { status: string; reason: string | null }) => [
            citation.status,
            citation.reason,
          ],
        ),
        [
          ["stale", "missing-needle"],
          ["valid", null],
        ],
      );
      const text = formatLearningLoopRecall(result, "text");
      assert.match(text, /stale: missing-needle/u);
      assert.match(
        text,
        /reread the source before relying on Decision changed/u,
      );
      assert.ok(text.indexOf("reread") < text.indexOf("  Decision changed:"));

      const validOnly = collectLearningLoopRecall(fs, BUCKET_PATHS, [
        SECOND_CITATION_PATH,
      ]);
      assert.equal(
        JSON.parse(formatLearningLoopRecall(validOnly, "json")).matches[0]
          .hasStaleCitations,
        false,
        "unmatched stale evidence does not mark a valid matched citation",
      );
      const capped = collectLearningLoopRecall(fs, BUCKET_PATHS, ["."], 2);
      assert.equal(capped.totalMatches, ACTIVE_FIXTURE_MATCH_COUNT + 1);
      assert.equal(capped.overflowCount, ACTIVE_FIXTURE_MATCH_COUNT - 1);
      assert.equal(capped.matches[1]?.sourcePath, CITATION_SOURCE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a missing file discoverable through exact and directory operands", () => {
    const root = makeCitationFixture(null);
    try {
      for (const operand of [CITATION_PATH, "src/cli/facts/shared/"]) {
        const result = collectLearningLoopRecall(createFS(root), BUCKET_PATHS, [
          operand,
        ]);
        const match = JSON.parse(formatLearningLoopRecall(result, "json"))
          .matches[0];
        assert.equal(result.totalMatches, 1);
        assert.equal(match.hasStaleCitations, true);
        assert.equal(match.matchedCitations[0].reason, "missing-file");
        assert.match(
          formatLearningLoopRecall(result, "text"),
          /stale: missing-file/u,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves distinct citation verdicts when needles share one matched path", () => {
    const root = makeCitationFixture(
      realCitationTarget,
      realCitationEntry.replace(SECOND_CITATION_PATH, CITATION_PATH),
    );
    try {
      const result = collectLearningLoopRecall(createFS(root), BUCKET_PATHS, [
        CITATION_PATH,
      ]);
      const match = JSON.parse(formatLearningLoopRecall(result, "json"))
        .matches[0];
      assert.deepEqual(match.matchedPaths, [CITATION_PATH]);
      assert.equal(match.hasStaleCitations, true);
      assert.deepEqual(
        match.matchedCitations.map(
          (citation: { needle: string; status: string }) => [
            citation.needle,
            citation.status,
          ],
        ),
        [
          [CITATION_NEEDLE, "valid"],
          [SECOND_CITATION_NEEDLE, "stale"],
        ],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Fixture purpose: perturb a real citation to a local plan path so presence cannot imply durable evidence.
  // Side effects: writes a disposable plan target and removes the fixture project in finally.
  it("marks ignored evidence as stale even when its literal text exists", () => {
    const ignoredPath = ".goat-flow/plans/recall-evidence.md";
    const root = makeCitationFixture(
      realCitationTarget,
      realCitationEntry.replace(CITATION_PATH, ignoredPath),
    );
    mkdirSync(join(root, ".goat-flow/plans"), { recursive: true });
    writeFileSync(join(root, ignoredPath), realCitationTarget);
    try {
      const result = collectLearningLoopRecall(createFS(root), BUCKET_PATHS, [
        ignoredPath,
      ]);
      const match = JSON.parse(formatLearningLoopRecall(result, "json"))
        .matches[0];
      assert.equal(match.hasStaleCitations, true);
      assert.equal(match.matchedCitations[0].reason, "gitignored-path");
      assert.match(
        formatLearningLoopRecall(result, "text"),
        /stale: gitignored-path/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
