/**
 * Unit tests for the learning-loop frontmatter + freshness extension.
 * Covers parseFrontmatterFields, computeFreshness, and the per-file diagnostics
 * now surfaced for missing/invalid last_reviewed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertExists } from "../helpers/assert-exists.ts";
import {
  computeFreshness as computeFreshnessFromLearningLoop,
  extractFootgunFacts,
  extractLessonsFacts,
  parseFrontmatterFields as parseFrontmatterFieldsFromLearningLoop,
} from "../../src/cli/facts/shared/learning-loop.js";
import { extractSharedFacts } from "../../src/cli/facts/shared/index.js";
import {
  computeFreshness,
  parseFrontmatterFields,
} from "../../src/cli/facts/shared/learning-loop-common.js";
import { extractLearningLoopEntries } from "../../src/cli/facts/shared/learning-loop-entries.js";
import {
  collectFootgunStructureDiagnostics,
  splitFootgunSections,
} from "../../src/cli/facts/shared/learning-loop-sections.js";
import type { ReadonlyFS } from "../../src/cli/types.js";
import type {
  LoadedConfig,
  GoatFlowConfig,
} from "../../src/cli/config/types.js";

/**
 * Build selected-project memory files and directories for one extraction scenario.
 * Use when tests need exact missing-file, empty-directory, or readable-content behavior.
 */
function stubFS(
  projectFileContents: Record<string, string>,
  readableDirectories: Record<string, string[]>,
): ReadonlyFS {
  return {
    exists: (projectPath) =>
      Object.prototype.hasOwnProperty.call(projectFileContents, projectPath) ||
      Object.prototype.hasOwnProperty.call(readableDirectories, projectPath),
    // A missing fixture file is unreadable to the selected-project extractor.
    readFile: (projectPath) => projectFileContents[projectPath] ?? null,
    // A missing fixture file has no user-visible lines to count.
    lineCount: (projectPath) =>
      projectFileContents[projectPath] === undefined
        ? 0
        : projectFileContents[projectPath]!.split("\n").length,
    readJson: () => null,
    isReadableDirectory: (projectPath) =>
      Object.prototype.hasOwnProperty.call(readableDirectories, projectPath),
    // An absent directory lists no entries instead of inventing memory rows for users.
    listDir: (projectPath) => readableDirectories[projectPath] ?? [],
    isExecutable: () => false,
    glob: () => [],
    existsGlob: () => false,
  };
}

/**
 * Build valid selected-project config for one learning-loop fact scenario.
 * Use targeted overrides for alternate paths; empty overrides keep the standard user layout.
 * The full shape exists because extraction requires canonical config; fixed defaults isolate failures.
 */
function stubConfig(overrides: Partial<GoatFlowConfig> = {}): LoadedConfig {
  return {
    exists: true,
    valid: true,
    config: {
      version: "1.2.3",
      footguns: { path: ".goat-flow/learning-loop/footguns/" },
      lessons: { path: ".goat-flow/learning-loop/lessons/" },
      decisions: { path: ".goat-flow/learning-loop/decisions/" },
      plans: { path: ".goat-flow/plans/" },
      logs: { path: ".goat-flow/logs/" },
      agents: null,
      skills: { install: "all" },
      lineLimits: { target: 125, limit: 150 },
      toolchain: {
        test: [],
        lint: [],
        build: [],
        package: [],
        format: [],
      },
      userRole: "developer",
      telemetry: false,
      learningLoop: { autoCapture: { enabled: false, targets: [] } },
      knownGaps: [],
      skillOverrides: {},
      harness: { acknowledge: [] },
      terminal: { idleTimeoutMinutes: 480 },
      hooks: {},
      ...overrides,
    },
    warnings: [],
    errors: [],
    parseError: null,
  };
}

describe("parseFrontmatterFields", () => {
  it("keeps the learning-loop facade parser export aligned with the implementation", () => {
    assert.equal(
      parseFrontmatterFieldsFromLearningLoop,
      parseFrontmatterFields,
    );
  });

  it("returns an empty object for an empty block", () => {
    assert.deepEqual(parseFrontmatterFields(""), {});
  });

  it("extracts a single key-value pair", () => {
    assert.deepEqual(parseFrontmatterFields("category: hooks"), {
      category: "hooks",
    });
  });

  it("extracts multiple fields preserving order-independent access", () => {
    const fields = parseFrontmatterFields(
      "category: setup\nlast_reviewed: 2026-04-18",
    );
    assert.equal(fields.category, "setup");
    assert.equal(fields.last_reviewed, "2026-04-18");
  });

  it("trims trailing whitespace around values", () => {
    assert.equal(
      parseFrontmatterFields("last_reviewed: 2026-04-18   ").last_reviewed,
      "2026-04-18",
    );
  });

  it("ignores blank lines and non-key-value lines", () => {
    const fields = parseFrontmatterFields(
      "\n# comment-like line\ncategory: skills\n",
    );
    assert.deepEqual(fields, { category: "skills" });
  });
});

describe("splitFootgunSections", () => {
  it("extracts footgun sections and reports invalid evidence shape", () => {
    const body = [
      "## Footgun: missing evidence",
      "",
      "**Status:** active",
      "",
      "Body with no measured evidence marker.",
    ].join("\n");

    const sections = splitFootgunSections(body);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]?.title, "missing evidence");
    assert.deepEqual(
      collectFootgunStructureDiagnostics(
        ".goat-flow/learning-loop/footguns/example.md",
        body,
      ),
      [
        '.goat-flow/learning-loop/footguns/example.md active footgun "missing evidence" missing file:line or (search: ...) evidence',
      ],
    );
  });
});

describe("computeFreshness", () => {
  const today = new Date("2026-04-18T12:00:00Z");

  it("keeps the learning-loop facade freshness export aligned with the implementation", () => {
    assert.equal(computeFreshnessFromLearningLoop, computeFreshness);
  });

  it("returns unknown when last_reviewed is null", () => {
    assert.deepEqual(computeFreshness(null, today), {
      days: null,
      band: "unknown",
    });
  });

  it("returns unknown for a non-YYYY-MM-DD string", () => {
    assert.deepEqual(computeFreshness("2026-04-18T00:00:00Z", today), {
      days: null,
      band: "unknown",
    });
  });

  it("classifies today as fresh with 0 days", () => {
    assert.deepEqual(computeFreshness("2026-04-18", today), {
      days: 0,
      band: "fresh",
    });
  });

  it("classifies a 30-day old review as fresh", () => {
    assert.deepEqual(computeFreshness("2026-03-19", today), {
      days: 30,
      band: "fresh",
    });
  });

  it("classifies a 31-day old review as aging", () => {
    assert.deepEqual(computeFreshness("2026-03-18", today), {
      days: 31,
      band: "aging",
    });
  });

  it("classifies a 91-day old review as stale", () => {
    assert.deepEqual(computeFreshness("2026-01-17", today), {
      days: 91,
      band: "stale",
    });
  });

  it("clamps future dates to zero days", () => {
    const { days, band } = computeFreshness("2027-01-01", today);
    assert.equal(days, 0);
    assert.equal(band, "fresh");
  });
});

describe("extractFootgunFacts freshness integration", () => {
  const fixtureDir = ".goat-flow/learning-loop/footguns/";
  const pinnedNow = new Date("2026-04-18T12:00:00Z");

  it("produces per-bucket freshness and no diagnostics when frontmatter is complete", () => {
    const fs = stubFS(
      {
        [`${fixtureDir}hooks.md`]:
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: example\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n\nBody with `src/index.ts` evidence.\n",
      },
      { [fixtureDir]: ["hooks.md"] },
    );
    const facts = extractFootgunFacts(fs, stubConfig(), pinnedNow);
    assert.equal(facts.buckets.length, 1);
    const bucket = facts.buckets[0]!;
    assert.equal(bucket.lastReviewed, "2026-04-18");
    assert.equal(bucket.freshnessDays, 0);
    assert.equal(bucket.freshnessBand, "fresh");
    assert.equal(facts.formatDiagnostic, null);
  });

  it("flags missing last_reviewed in the format diagnostic and marks the bucket unknown", () => {
    const fs = stubFS(
      {
        [`${fixtureDir}hooks.md`]:
          "---\ncategory: hooks\n---\n\n## Footgun: example\n\nBody.\n",
      },
      { [fixtureDir]: ["hooks.md"] },
    );
    const facts = extractFootgunFacts(fs, stubConfig(), pinnedNow);
    assert.equal(facts.buckets[0]!.lastReviewed, null);
    assert.equal(facts.buckets[0]!.freshnessBand, "unknown");
    assert.ok(
      facts.formatDiagnostic !== null &&
        facts.formatDiagnostic.includes("missing frontmatter last_reviewed"),
      `expected missing-last_reviewed diagnostic, got: ${facts.formatDiagnostic}`,
    );
  });

  it("flags an invalid last_reviewed format as a diagnostic", () => {
    const fs = stubFS(
      {
        [`${fixtureDir}hooks.md`]:
          "---\ncategory: hooks\nlast_reviewed: April 18 2026\n---\n\n## Footgun: example\n\nBody.\n",
      },
      { [fixtureDir]: ["hooks.md"] },
    );
    const facts = extractFootgunFacts(fs, stubConfig(), pinnedNow);
    assert.equal(facts.buckets[0]!.lastReviewed, null);
    assert.ok(
      facts.formatDiagnostic !== null &&
        facts.formatDiagnostic.includes("invalid last_reviewed format"),
    );
  });
});

describe("extractLessonsFacts freshness + placeholder filtering", () => {
  const fixtureDir = ".goat-flow/learning-loop/lessons/";
  const pinnedNow = new Date("2026-04-18T12:00:00Z");

  it("does not treat placeholder paths as stale refs", () => {
    const fs = stubFS(
      {
        [`${fixtureDir}agent-behavior.md`]:
          "---\ncategory: agent-behavior\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: placeholders\n\nPaths like `workflow/...` or `.goat-flow/history/<date>-<agent>.json` are not refs.\n",
      },
      { [fixtureDir]: ["agent-behavior.md"] },
    );
    const facts = extractLessonsFacts(fs, stubConfig(), pinnedNow);
    assert.deepEqual(facts.staleRefs, []);
    assert.equal(facts.buckets[0]!.staleRefs.length, 0);
  });

  it("filters strikethrough refs from stale-ref reporting", () => {
    const fs = stubFS(
      {
        [`${fixtureDir}verification.md`]:
          "---\ncategory: verification\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: history\n\n~~`docs/gone.md`~~ once existed.\n",
      },
      { [fixtureDir]: ["verification.md"] },
    );
    const facts = extractLessonsFacts(fs, stubConfig(), pinnedNow);
    assert.deepEqual(facts.staleRefs, []);
  });

  it("does not flag gitignored-by-design paths as stale (.goat-flow/plans, scratchpad, logs)", () => {
    // .goat-flow/plans/*, scratchpad/*, and logs/* are intentionally gitignored
    // per .goat-flow/plans/.gitignore - they're local session state. Lessons
    // reference them as navigation pointers, not committed artifacts. On CI
    // (fresh checkout) they don't exist, so treating absence as stale
    // false-positived the learning-loop schema check until this guard landed.
    const fs = stubFS(
      {
        [`${fixtureDir}verification.md`]:
          "---\ncategory: verification\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: nav\n\nPriors at a local task file, workspace at `.goat-flow/scratchpad/notes.md`, log at `.goat-flow/logs/sessions/old.md`.\n",
      },
      { [fixtureDir]: ["verification.md"] },
    );
    const facts = extractLessonsFacts(fs, stubConfig(), pinnedNow);
    assert.deepEqual(facts.staleRefs, []);
  });

  it("flags a lesson search anchor pointing at a gitignored plans path", () => {
    // Narrative mentions of local-state paths stay exempt (previous test);
    // the `(search: ...)` durable-evidence grammar does not.
    const fs = stubFS(
      {
        [`${fixtureDir}verification.md`]:
          "---\ncategory: verification\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: anchored to plan\n\nEvidence anchors: `.goat-flow/plans/1.12.0/M01-spike.md` (search: `run-tests`).\n",
      },
      { [fixtureDir]: ["verification.md"] },
    );
    const facts = extractLessonsFacts(fs, stubConfig(), pinnedNow);
    assert.deepEqual(facts.staleRefs, [
      ".goat-flow/plans/1.12.0/M01-spike.md (gitignored path used as durable evidence anchor)",
    ]);
  });
});

describe("extractFootgunFacts search-anchor staleness", () => {
  const fixtureDir = ".goat-flow/learning-loop/footguns/";
  const pinnedNow = new Date("2026-04-19T12:00:00Z");

  it("flags a search anchor whose needle no longer appears in the referenced file", () => {
    const fs = stubFS(
      {
        [`${fixtureDir}quality.md`]:
          '---\ncategory: quality\nlast_reviewed: 2026-04-19\n---\n\n## Footgun: stale\n\n**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED\n\n- `src/cli/cli.ts` (search: `qualitySubcommand === "capture"`) - retired handler\n',
        "src/cli/cli.ts":
          "// handlers for 'history' and 'diff' only; capture removed in v1.2.0\n",
      },
      { [fixtureDir]: ["quality.md"] },
    );
    const facts = extractFootgunFacts(fs, stubConfig(), pinnedNow);
    assert.ok(
      facts.staleRefs.some((ref) =>
        ref.includes('qualitySubcommand === "capture"'),
      ),
      `expected stale search anchor in ${JSON.stringify(facts.staleRefs)}`,
    );
  });

  it("flags a double-quoted search anchor whose needle no longer appears", () => {
    const fs = stubFS(
      {
        [`${fixtureDir}quality.md`]:
          '---\ncategory: quality\nlast_reviewed: 2026-04-19\n---\n\n## Footgun: stale quoted\n\n**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED\n\n- `src/cli/cli.ts` (search: "qualitySubcommand === \\"capture\\"") - retired handler\n',
        "src/cli/cli.ts":
          "// handlers for 'history' and 'diff' only; capture removed in v1.2.0\n",
      },
      { [fixtureDir]: ["quality.md"] },
    );
    const facts = extractFootgunFacts(fs, stubConfig(), pinnedNow);
    assert.ok(
      facts.staleRefs.some((ref) =>
        ref.includes('qualitySubcommand === "capture"'),
      ),
      `expected stale double-quoted search anchor in ${JSON.stringify(facts.staleRefs)}`,
    );
  });

  it("does not flag a search anchor whose needle still appears", () => {
    const fs = stubFS(
      {
        [`${fixtureDir}quality.md`]:
          "---\ncategory: quality\nlast_reviewed: 2026-04-19\n---\n\n## Footgun: live\n\n**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED\n\n- `src/cli/quality/history.ts` (search: `No saved quality history`) - handler\n",
        "src/cli/quality/history.ts":
          "return `No saved quality history${scope}.`;\n",
      },
      { [fixtureDir]: ["quality.md"] },
    );
    const facts = extractFootgunFacts(fs, stubConfig(), pinnedNow);
    assert.deepEqual(facts.staleRefs, []);
  });

  it("flags bare Evidence anchors paths whose files no longer exist", () => {
    const fs = stubFS(
      {
        [`${fixtureDir}auditor.md`]:
          "---\ncategory: auditor\nlast_reviewed: 2026-04-19\n---\n\n## Footgun: stale bare anchor\n\n**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED\n\n**Evidence anchors:** `src/cli/missing.ts`\n",
      },
      { [fixtureDir]: ["auditor.md"] },
    );
    const facts = extractFootgunFacts(fs, stubConfig(), pinnedNow);
    assert.deepEqual(facts.staleRefs, ["src/cli/missing.ts"]);
  });

  it("flags file-line evidence that lacks a semantic anchor", () => {
    const fs = stubFS(
      {
        [`${fixtureDir}quality.md`]:
          "---\ncategory: quality\nlast_reviewed: 2026-04-19\n---\n\n## Footgun: line only\n\n**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED\n\n- `src/cli/cli.ts:1` - fragile evidence\n",
        "src/cli/cli.ts": "console.log('ok');\n",
      },
      { [fixtureDir]: ["quality.md"] },
    );
    const facts = extractFootgunFacts(fs, stubConfig(), pinnedNow);
    assert.deepEqual(facts.invalidLineRefs, [
      "src/cli/cli.ts:1 (missing semantic anchor)",
    ]);
  });

  it("flags a gitignored plans path used as a search anchor even when the file exists", () => {
    // The never-anchor-to-local-state invariant (footguns/auditor.md): plan
    // files vanish on clean checkouts, so they can never be durable evidence.
    // Local existence must not suppress the violation.
    const fs = stubFS(
      {
        [`${fixtureDir}quality.md`]:
          "---\ncategory: quality\nlast_reviewed: 2026-04-19\n---\n\n## Footgun: plans anchor\n\n**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED\n\nEvidence anchors: `.goat-flow/plans/1.9.0/M00-cleanup.md` (search: `setup-bloat`).\n",
        ".goat-flow/plans/1.9.0/M00-cleanup.md": "setup-bloat threshold\n",
      },
      { [fixtureDir]: ["quality.md"] },
    );
    const facts = extractFootgunFacts(fs, stubConfig(), pinnedNow);
    assert.deepEqual(facts.staleRefs, [
      ".goat-flow/plans/1.9.0/M00-cleanup.md (gitignored path used as durable evidence anchor)",
    ]);
  });

  it("flags a gitignored path on a bare Evidence anchors line", () => {
    const fs = stubFS(
      {
        [`${fixtureDir}auditor.md`]:
          "---\ncategory: auditor\nlast_reviewed: 2026-04-19\n---\n\n## Footgun: local log anchor\n\n**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED\n\n**Evidence anchors:** `.goat-flow/logs/quality/2026-04-19-codex-abcde.json`\n",
      },
      { [fixtureDir]: ["auditor.md"] },
    );
    const facts = extractFootgunFacts(fs, stubConfig(), pinnedNow);
    assert.deepEqual(facts.staleRefs, [
      ".goat-flow/logs/quality/2026-04-19-codex-abcde.json (gitignored path used as durable evidence anchor)",
    ]);
  });
});

describe("extractLearningLoopEntries", () => {
  it("exposes forward memory metadata while preserving legacy entries", () => {
    const fs = stubFS(
      {
        ".goat-flow/learning-loop/footguns/quality.md":
          "---\ncategory: quality\nlast_reviewed: 2026-07-13\n---\n\n## Footgun: metadata-rich trap\n\n**Status:** active | **Created:** 2026-07-01 | **Updated:** 2026-07-12 | **Evidence:** ACTUAL_MEASURED\n**Decision changed:** Verify the live audit before trusting cached quality state.\n**Trigger phase:** VERIFY\n**Incident count:** 3\n**Latest occurrence:** 2026-07-12\n\n- `src/cli/cli.ts` (search: `quality`) - live anchor.\n",
        ".goat-flow/learning-loop/lessons/legacy.md":
          "---\ncategory: legacy\nlast_reviewed: 2026-07-13\n---\n\n## Lesson: legacy entry\n\n**Created:** 2026-01-10\n\nPreserved without forward metadata.\n",
        "src/cli/cli.ts": "const quality = true;\n",
      },
      {
        ".goat-flow/learning-loop/footguns/": ["quality.md"],
        ".goat-flow/learning-loop/lessons/": ["legacy.md"],
        ".goat-flow/learning-loop/patterns/": [],
        ".goat-flow/learning-loop/decisions/": [],
      },
    );
    const entries = extractLearningLoopEntries(fs, stubConfig());
    const richEntry = entries.find(
      (entry) => entry.title === "metadata-rich trap",
    );
    const legacyEntry = entries.find((entry) => entry.title === "legacy entry");

    assertExists(richEntry, "expected the metadata-rich footgun entry");
    assert.deepEqual(
      {
        heading: richEntry.heading,
        hasDecisionChangedGuidance: richEntry.hasDecisionChangedGuidance,
        triggerPhase: richEntry.triggerPhase,
        incidentCount: richEntry.incidentCount,
        latestOccurrence: richEntry.latestOccurrence,
      },
      {
        heading: "## Footgun: metadata-rich trap",
        hasDecisionChangedGuidance: true,
        triggerPhase: "VERIFY",
        incidentCount: 3,
        latestOccurrence: "2026-07-12",
      },
    );
    assertExists(legacyEntry, "expected the legacy lesson entry");
    assert.deepEqual(
      {
        heading: legacyEntry.heading,
        hasDecisionChangedGuidance: legacyEntry.hasDecisionChangedGuidance,
        triggerPhase: legacyEntry.triggerPhase,
        incidentCount: legacyEntry.incidentCount,
        latestOccurrence: legacyEntry.latestOccurrence,
      },
      {
        heading: "## Lesson: legacy entry",
        hasDecisionChangedGuidance: false,
        triggerPhase: null,
        incidentCount: null,
        latestOccurrence: null,
      },
    );
  });

  it("excludes the decisions INDEX from shared decision counts and prompt entries", () => {
    const fs = stubFS(
      {
        ".goat-flow/learning-loop/decisions/README.md": "# Decisions\n",
        ".goat-flow/learning-loop/decisions/INDEX.md":
          "---\ncategory: index\n---\n\n# Decisions Index\n",
        ".goat-flow/learning-loop/decisions/ADR-001-foo.md":
          "# ADR-001: Foo\n\n**Status:** Accepted\n**Date:** 2026-04-29\n\n## Context\n\nA real decision context.\n\n## Decision\n\nChoose Foo.\n\n## Consequences\n\nKnown trade-offs.\n",
      },
      {
        ".goat-flow/learning-loop/footguns/": [],
        ".goat-flow/learning-loop/lessons/": [],
        ".goat-flow/learning-loop/patterns/": [],
        ".goat-flow/learning-loop/decisions": [
          "README.md",
          "INDEX.md",
          "ADR-001-foo.md",
        ],
        ".goat-flow/learning-loop/decisions/": [
          "README.md",
          "INDEX.md",
          "ADR-001-foo.md",
        ],
      },
    );
    const facts = extractSharedFacts(fs, stubConfig());

    assert.equal(facts.decisions.fileCount, 1);
    assert.deepEqual(
      facts.learningLoopEntries
        .filter((entry) => entry.kind === "decision")
        .map((entry) => entry.sourcePath),
      [".goat-flow/learning-loop/decisions/ADR-001-foo.md"],
    );
  });

  it("preserves resolved footgun status for selector exclusion", () => {
    const fs = stubFS(
      {
        ".goat-flow/learning-loop/footguns/auditor.md":
          "---\ncategory: auditor\nlast_reviewed: 2026-05-16\n---\n\n## Footgun: active trap\n\n**Status:** active | **Created:** 2026-05-16 | **Evidence:** ACTUAL_MEASURED\n\n- `src/cli/cli.ts` (search: `quality`) - evidence.\n\n## Resolved Entries\n\n## Footgun: resolved trap\n\n**Status:** resolved | **Created:** 2026-05-15 | **Resolved:** 2026-05-16 | **Evidence:** ACTUAL_MEASURED\n\nOriginal symptoms.\n",
        "src/cli/cli.ts": "const quality = true;\n",
      },
      {
        ".goat-flow/learning-loop/footguns/": ["auditor.md"],
        ".goat-flow/learning-loop/lessons/": [],
        ".goat-flow/learning-loop/patterns/": [],
        ".goat-flow/learning-loop/decisions/": [],
      },
    );
    const entries = extractLearningLoopEntries(fs, stubConfig());

    assert.equal(
      entries.find((candidate) => candidate.title === "active trap")?.status,
      "active",
    );
    assert.equal(
      entries.find((candidate) => candidate.title === "resolved trap")?.status,
      "resolved",
    );
  });
});
