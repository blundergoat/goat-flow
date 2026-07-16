/**
 * Integration tests for `goat-flow stats` and `goat-flow stats --check`.
 * Exercises the extractor + report + render pipeline end-to-end against
 * temp-dir fixtures so the live repo's learning-loop content does not leak in.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { assertExists } from "../helpers/assert-exists.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFS } from "../../src/cli/facts/fs.js";
import {
  extractFootgunFacts,
  extractLearningLoopEntries,
  extractLessonsFacts,
} from "../../src/cli/facts/shared/learning-loop.js";
import {
  buildDecisionsSection,
  buildStatsReport,
  checkStats,
} from "../../src/cli/stats/stats.js";
import {
  renderStatsText,
  renderStatsJson,
  renderStatsMarkdown,
} from "../../src/cli/stats/render.js";
import type {
  LoadedConfig,
  GoatFlowConfig,
} from "../../src/cli/config/types.js";

/**
 * Build valid selected-project config for one stats scenario.
 * Use targeted overrides when the test needs a different path; empty overrides keep user defaults.
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

/**
 * Build a disposable project with the memory buckets a stats user would inspect.
 * Use when a test needs real filesystem extraction; absent decisions create an empty directory.
 */
function makeFixtureRepo(spec: {
  footguns: Record<string, string>;
  lessons: Record<string, string>;
  decisions?: Record<string, string>;
}): string {
  const fixtureProjectRoot = mkdtempSync(join(tmpdir(), "goatflow-stats-"));
  const footgunDirectory = join(
    fixtureProjectRoot,
    ".goat-flow/learning-loop/footguns",
  );
  const lessonDirectory = join(
    fixtureProjectRoot,
    ".goat-flow/learning-loop/lessons",
  );
  const decisionDirectory = join(
    fixtureProjectRoot,
    ".goat-flow/learning-loop/decisions",
  );
  mkdirSync(footgunDirectory, { recursive: true });
  mkdirSync(lessonDirectory, { recursive: true });
  mkdirSync(decisionDirectory, { recursive: true });
  // Each footgun fixture becomes a real bucket the selected-project extractor can discover.
  for (const [bucketFilename, bucketContent] of Object.entries(spec.footguns)) {
    writeFileSync(join(footgunDirectory, bucketFilename), bucketContent);
  }
  // Each lesson fixture becomes a real bucket the stats user would see.
  for (const [bucketFilename, bucketContent] of Object.entries(spec.lessons)) {
    writeFileSync(join(lessonDirectory, bucketFilename), bucketContent);
  }
  // Omitted decisions model a user project with an empty but valid decision directory.
  const decisionFixtures = spec.decisions ?? {};
  // Each decision fixture becomes a real ADR row for structure validation.
  for (const [decisionFilename, decisionContent] of Object.entries(
    decisionFixtures,
  )) {
    writeFileSync(join(decisionDirectory, decisionFilename), decisionContent);
  }
  return fixtureProjectRoot;
}

const pinnedNow = new Date("2026-04-18T12:00:00Z");
const disposableProjectDirectories: string[] = [];

after(() => {
  // Every temporary project is removed so the test runner leaves no user-visible workspace debris.
  for (const disposableProjectDirectory of disposableProjectDirectories) {
    rmSync(disposableProjectDirectory, { recursive: true, force: true });
  }
});

/**
 * Load a complete stats report from one seeded project fixture.
 * Use when tests need the same extraction and report path a CLI user triggers.
 */
function loadReport(spec: Parameters<typeof makeFixtureRepo>[0]) {
  const fixtureProjectRoot = makeFixtureRepo(spec);
  disposableProjectDirectories.push(fixtureProjectRoot);
  const projectFiles = createFS(fixtureProjectRoot);
  const configState = stubConfig();
  return buildStatsReport({
    footguns: extractFootgunFacts(projectFiles, configState, pinnedNow),
    lessons: extractLessonsFacts(projectFiles, configState, pinnedNow),
    decisions: buildDecisionsSection(
      projectFiles,
      configState.config.decisions.path,
    ),
    learningLoopEntries: extractLearningLoopEntries(projectFiles, configState),
  });
}

/**
 * Load a stats report for a project whose memory directories are absent.
 * Use when a test verifies the setup failure a user sees before goat-flow initialization.
 */
function loadReportWithoutLoopDirs() {
  const fixtureProjectRoot = mkdtempSync(
    join(tmpdir(), "goatflow-stats-missing-"),
  );
  disposableProjectDirectories.push(fixtureProjectRoot);
  const projectFiles = createFS(fixtureProjectRoot);
  const configState = stubConfig();
  return buildStatsReport({
    footguns: extractFootgunFacts(projectFiles, configState, pinnedNow),
    lessons: extractLessonsFacts(projectFiles, configState, pinnedNow),
    decisions: buildDecisionsSection(
      projectFiles,
      configState.config.decisions.path,
    ),
  });
}

describe("goat-flow stats - happy path", () => {
  it("reports per-bucket freshness and live entry counts", () => {
    const expectedFootgunEntries = 2;
    const expectedLessonFreshnessDays = 30;
    const report = loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Evidence:** ACTUAL_MEASURED\n\nBody with `src/alpha.ts` ref.\n\n## Footgun: beta\n\n**Evidence:** ACTUAL_MEASURED\n\nBody.\n",
      },
      lessons: {
        "verification.md":
          "---\ncategory: verification\nlast_reviewed: 2026-03-19\n---\n\n## Lesson: gamma\n\nBody.\n",
      },
    });

    assert.equal(report.footguns.totalEntries, expectedFootgunEntries);
    assert.equal(report.footguns.buckets[0].freshnessBand, "fresh");
    assert.equal(report.footguns.buckets[0].freshnessDays, 0);
    assert.equal(report.lessons.totalEntries, 1);
    assert.equal(
      report.lessons.buckets[0].freshnessDays,
      expectedLessonFreshnessDays,
    );
    assert.equal(report.lessons.buckets[0].freshnessBand, "fresh");

    const text = renderStatsText(report);
    assert.ok(text.includes("Footguns"));
    assert.ok(text.includes("hooks.md"));
    assert.ok(text.includes("verification.md"));

    const json = JSON.parse(renderStatsJson(report));
    assert.equal(json.footguns.totalEntries, expectedFootgunEntries);
  });

  it("recognizes the three canonical footgun evidence labels", () => {
    const fixtureProjectRoot = makeFixtureRepo({
      footguns: {
        "evidence.md":
          "---\ncategory: evidence\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: measured\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n\n- `src/measured.ts` (search: `measured`) - reproduced.\n\n## Footgun: observed\n\n**Status:** active | **Evidence:** OBSERVED\n\n- `src/observed.ts` (search: `observed`) - read directly.\n\n## Footgun: external\n\n**Status:** active | **Evidence:** EXTERNAL_REFERENCE\n\n- `docs/external.md` (search: `external`) - cited source with local applicability.\n",
      },
      lessons: {},
    });
    disposableProjectDirectories.push(fixtureProjectRoot);

    const facts = extractFootgunFacts(
      createFS(fixtureProjectRoot),
      stubConfig(),
      pinnedNow,
    );
    assert.equal(facts.entryCount, 3);
    assert.equal(facts.labelCount, 3);
    assert.equal(facts.hasEvidenceLabels, true);

    const invalidFixtureRoot = makeFixtureRepo({
      footguns: {
        "legacy.md":
          "---\ncategory: legacy\nlast_reviewed: 2026-04-18\n---\n\n# Legacy footgun\n\n**Evidence type:** HYPOTHETICAL_EXAMPLE\n\nBody.\n",
      },
      lessons: {},
    });
    disposableProjectDirectories.push(invalidFixtureRoot);
    const invalidFacts = extractFootgunFacts(
      createFS(invalidFixtureRoot),
      stubConfig(),
      pinnedNow,
    );
    assert.equal(invalidFacts.labelCount, 0);
    assert.equal(invalidFacts.hasEvidenceLabels, false);

    const multiLabelFixtureRoot = makeFixtureRepo({
      footguns: {
        "copied-template.md":
          "---\ncategory: copied-template\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: copied all labels\n\n**Evidence:** ACTUAL_MEASURED | OBSERVED | EXTERNAL_REFERENCE\n\nBody.\n",
      },
      lessons: {},
    });
    disposableProjectDirectories.push(multiLabelFixtureRoot);
    const multiLabelFacts = extractFootgunFacts(
      createFS(multiLabelFixtureRoot),
      stubConfig(),
      pinnedNow,
    );
    assert.equal(multiLabelFacts.labelCount, 0);
    assert.equal(multiLabelFacts.hasEvidenceLabels, false);
  });
});

describe("goat-flow stats - graduation candidates", () => {
  /** Fixture with recurrence markers on one active footgun, one resolved footgun, and one lesson. */
  function loadRecurrenceReport() {
    return loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n\nBody with `src/alpha.ts` ref.\n\n**Recurrence update (2026-04-17):** happened again after recording.\n\n## Resolved Entries\n\n## Footgun: closed trap\n\n**Status:** resolved | **Created:** 2026-04-01 | **Resolved:** 2026-04-02 | **Evidence:** ACTUAL_MEASURED\n\nBody.\n\n**Recurrence update (2026-04-01):** recurred before the fix landed.\n",
      },
      lessons: {
        "verification.md":
          "---\ncategory: verification\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: beta\n\nBody.\n\n**Recurrence update (2026-04-10):** first repeat.\n\n**Recurrence update (2026-04-15):** second repeat.\n\n## Lesson: quiet\n\nBody without recurrences.\n",
      },
    });
  }

  it("lists active entries with recurrence updates and skips resolved entries", () => {
    const report = loadRecurrenceReport();

    assert.equal(report.footguns.totalGraduationCandidates, 1);
    assert.deepEqual(report.footguns.buckets[0].graduationCandidates, [
      { title: "alpha", recurrenceCount: 1 },
    ]);
    assert.equal(report.lessons.totalGraduationCandidates, 1);
    assert.deepEqual(report.lessons.buckets[0].graduationCandidates, [
      { title: "beta", recurrenceCount: 2 },
    ]);
  });

  it("renders candidates in text and markdown with per-entry recurrence counts", () => {
    const report = loadRecurrenceReport();

    const text = renderStatsText(report);
    assert.ok(text.includes("Graduation candidates"));
    assert.ok(text.includes("hooks.md :: alpha (1 recurrence)"));
    assert.ok(text.includes("verification.md :: beta (2 recurrences)"));
    assert.ok(
      !text.includes("closed trap"),
      "resolved entries must not surface as graduation candidates",
    );

    const markdown = renderStatsMarkdown(report);
    assert.ok(markdown.includes("**Graduation candidates**"));
    assert.ok(markdown.includes("verification.md :: beta (2 recurrences)"));
  });

  it("keeps recurrence candidates report-only without optional-metadata warning noise", () => {
    const verdict = checkStats(loadRecurrenceReport());
    assert.equal(verdict.status, "pass");
    assert.deepEqual(verdict.findings, []);
    assert.equal(
      verdict.warnings.filter((warning) => warning.rule === "memory-quality")
        .length,
      0,
      "missing optional guidance must not turn every legacy bucket into a warning",
    );
  });

  it("renders no graduation section when no entry has recurrence updates", () => {
    const report = loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n\nBody with `src/alpha.ts` ref.\n",
      },
      lessons: {
        "verification.md":
          "---\ncategory: verification\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: beta\n\nBody.\n",
      },
    });
    assert.equal(report.footguns.totalGraduationCandidates, 0);
    assert.equal(report.lessons.totalGraduationCandidates, 0);
    assert.ok(!renderStatsText(report).includes("Graduation candidates"));
    assert.ok(!renderStatsMarkdown(report).includes("Graduation candidates"));
  });
});

describe("goat-flow stats --check", () => {
  it("exposes legacy optional metadata in JSON without flooding warnings", () => {
    const report = loadReport({
      footguns: {
        "quality.md":
          "---\ncategory: quality\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: legacy alpha\n\n**Status:** active | **Created:** 2026-04-01 | **Evidence:** ACTUAL_MEASURED\n\n- `.goat-flow/learning-loop/footguns/quality.md` (search: `legacy alpha`) - live anchor.\n\n## Footgun: legacy beta\n\n**Status:** active | **Created:** 2026-04-02 | **Evidence:** ACTUAL_MEASURED\n\n- `.goat-flow/learning-loop/footguns/quality.md` (search: `legacy beta`) - live anchor.\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    const json = JSON.parse(renderStatsJson(report));

    assert.equal(verdict.status, "pass");
    assert.deepEqual(verdict.findings, []);
    assert.equal(
      verdict.warnings.filter((warning) => warning.rule === "memory-quality")
        .length,
      0,
      "optional Decision changed backfill stays visible in JSON, not --check warnings",
    );
    assert.equal(json.learningLoopEntries.length, 2);
    assert.equal(json.learningLoopEntries[0].hasDecisionChangedGuidance, false);
  });

  it("warns on invalid trigger and occurrence order without failing", () => {
    const report = loadReport({
      footguns: {},
      lessons: {
        "verification.md":
          "---\ncategory: verification\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: invalid recurrence metadata\n\n**Created:** 2026-04-10\n**Decision changed:** Re-run the original reproduction before closing.\n**Trigger phase:** DEPLOY\n**Latest occurrence:** 2026-04-09\n\nBody.\n",
      },
    });
    const verdict = checkStats(report);

    assert.equal(verdict.status, "pass");
    assert.deepEqual(verdict.findings, []);
    assert.ok(
      verdict.warnings.some(
        (warning) =>
          warning.rule === "memory-quality" &&
          warning.message.includes('invalid Trigger phase "DEPLOY"') &&
          warning.message.includes(
            "Latest occurrence 2026-04-09 predates Created 2026-04-10",
          ),
      ),
      "expected both metadata issues in the bucket warning",
    );
  });

  it("passes when every bucket has valid last_reviewed and no stale refs", () => {
    const report = loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n\nBody with `src/alpha.ts` ref.\n",
      },
      lessons: {
        "verification.md":
          "---\ncategory: verification\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: beta\n\nBody.\n",
      },
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "pass");
    assert.deepEqual(verdict.findings, []);
  });

  it("passes with warnings for fresh empty learning-loop directories", () => {
    const expectedEmptyLoopWarningCount = 2;
    const report = loadReport({
      footguns: {},
      lessons: {},
    });
    const verdict = checkStats(report);

    assert.equal(verdict.status, "pass");
    assert.deepEqual(verdict.findings, []);
    assert.equal(verdict.warnings.length, expectedEmptyLoopWarningCount);
    assert.ok(
      verdict.warnings.some(
        (warning) =>
          warning.rule === "empty-learning-loop" &&
          warning.message.includes("Footgun directory exists"),
      ),
      "expected an empty footgun-directory warning",
    );
    assert.ok(
      verdict.warnings.some(
        (warning) =>
          warning.rule === "empty-learning-loop" &&
          warning.message.includes("Lesson directory exists"),
      ),
      "expected an empty lesson-directory warning",
    );
  });

  it("fails when learning-loop directories are missing", () => {
    const report = loadReportWithoutLoopDirs();
    const verdict = checkStats(report);

    assert.equal(verdict.status, "fail");
    assert.ok(
      verdict.findings.some(
        (finding) =>
          finding.rule === "format" &&
          finding.message.includes(".goat-flow/learning-loop/footguns"),
      ),
      "expected a missing footgun-directory finding",
    );
    assert.ok(
      verdict.findings.some(
        (finding) =>
          finding.rule === "format" &&
          finding.message.includes(".goat-flow/learning-loop/lessons"),
      ),
      "expected a missing lesson-directory finding",
    );
  });

  it("fails when a bucket is missing last_reviewed", () => {
    const report = loadReport({
      footguns: {
        "hooks.md": "---\ncategory: hooks\n---\n\n## Footgun: alpha\n\nBody.\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    const finding = verdict.findings.find(
      (f) => f.rule === "missing-last-reviewed",
    );
    assertExists(finding, "expected a missing-last-reviewed finding");
    assert.ok(finding.message.includes("hooks.md"));
  });

  it("fails when last_reviewed has an invalid format", () => {
    const report = loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: April 18 2026\n---\n\n## Footgun: alpha\n\nBody.\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    assert.ok(
      verdict.findings.some(
        (f) =>
          f.rule === "missing-last-reviewed" ||
          f.rule === "invalid-last-reviewed",
      ),
      "expected a missing-or-invalid last_reviewed finding",
    );
  });

  it("fails when a bucket contains stale refs", () => {
    const report = loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Evidence:** ACTUAL_MEASURED\n\nSee `src/gone.ts:42` for details.\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    const finding = verdict.findings.find((f) => f.rule === "stale-ref");
    assertExists(finding, "expected a stale-ref finding");
    assert.ok(finding.message.includes("src/gone.ts:42"));
  });

  it("fails when a bucket uses line-number evidence without a semantic anchor", () => {
    const report = loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Evidence:** ACTUAL_MEASURED\n\nSee `.goat-flow/learning-loop/footguns/hooks.md:1` for details.\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    const finding = verdict.findings.find((f) => f.rule === "invalid-line-ref");
    assertExists(finding, "expected an invalid-line-ref finding");
    assert.ok(finding.message.includes("missing semantic anchor"));
  });

  it("fails when an active footgun appears below ## Resolved Entries", () => {
    const report = loadReport({
      footguns: {
        "auditor.md":
          "---\ncategory: auditor\nlast_reviewed: 2026-04-18\n---\n\n## Resolved Entries\n\n## Footgun: misplaced active entry\n\n**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED\n\nBody.\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    assert.ok(
      verdict.findings.some(
        (f) =>
          f.rule === "format" &&
          f.message.includes("below ## Resolved Entries"),
      ),
      "expected an active-below-resolved finding",
    );
  });

  it("fails when a resolved footgun appears above ## Resolved Entries", () => {
    const report = loadReport({
      footguns: {
        "setup.md":
          "---\ncategory: setup\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: misplaced resolved entry\n\n**Status:** resolved | **Created:** 2026-04-18 | **Resolved:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED\n\nBody.\n\n## Resolved Entries\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    assert.ok(
      verdict.findings.some(
        (f) =>
          f.rule === "format" &&
          f.message.includes("above ## Resolved Entries"),
      ),
      "expected a resolved-above-marker finding",
    );
  });

  it("fails when resolved footguns exist without ## Resolved Entries", () => {
    const report = loadReport({
      footguns: {
        "dashboard.md":
          "---\ncategory: dashboard\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: markerless resolved entry\n\n**Status:** resolved | **Created:** 2026-04-18 | **Resolved:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED\n\nBody.\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    assert.ok(
      verdict.findings.some(
        (f) =>
          f.rule === "format" &&
          f.message.includes("no ## Resolved Entries marker"),
      ),
      "expected a missing-resolved-marker finding",
    );
  });

  it("fails when an active footgun relies on retired-file evidence", () => {
    const report = loadReport({
      footguns: {
        "docs-and-crossrefs.md":
          "---\ncategory: docs-and-crossrefs\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: stale evidence\n\n**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED\n\n**Evidence:**\n- `docs/getting-started.md` (file retired in v1.1.0)\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    assert.ok(
      verdict.findings.some(
        (f) =>
          f.rule === "format" &&
          f.message.includes("uses retired-file evidence"),
      ),
      "expected a retired-file-evidence finding",
    );
  });

  it("fails when a footgun has a non-canonical compound status", () => {
    const report = loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Status:** resolved (goat-flow) / active (consumer projects) | **Evidence:** ACTUAL_MEASURED\n\nBody with `src/alpha.ts` ref.\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    assert.ok(
      verdict.findings.some(
        (f) =>
          f.rule === "format" && f.message.includes("non-canonical status"),
      ),
      "expected a non-canonical-status finding",
    );
  });

  it("fails when a footgun is missing its Status field", () => {
    const report = loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Evidence:** ACTUAL_MEASURED\n\nBody with `src/alpha.ts` ref.\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    assert.ok(
      verdict.findings.some(
        (f) =>
          f.rule === "format" && f.message.includes("missing Status field"),
      ),
      "expected a missing-Status-field finding",
    );
  });

  it("fails when a decisions file is not an ADR filename", () => {
    const report = loadReport({
      footguns: {},
      lessons: {},
      decisions: {
        "README.md": "# Decisions\n",
        "foo.md": "broken\n",
      },
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    const finding = verdict.findings.find(
      (f) => f.rule === "decision-filename",
    );
    assertExists(finding, "expected a decision-filename finding");
    assert.ok(finding.message.includes(".goat-flow/plans/"));
    assert.ok(finding.message.includes(".goat-flow/learning-loop/footguns/"));
    assert.ok(finding.message.includes(".goat-flow/scratchpad/"));
  });

  it("keeps custom decisions README advisory while legacy notes fail validation", () => {
    const report = loadReport({
      footguns: {},
      lessons: {},
      decisions: {
        "README.md":
          "# Custom Decisions\n\nThis project keeps local ADR guidance.\n",
        "legacy-note.md": "# Legacy note\n\nTemporary implementation notes.\n",
      },
    });
    const verdict = checkStats(report);

    assert.equal(verdict.status, "fail");
    assert.ok(
      verdict.findings.some(
        (f) =>
          f.rule === "decision-filename" &&
          f.file.endsWith("legacy-note.md") &&
          f.message.includes(".goat-flow/plans/"),
      ),
      "expected legacy decision note to fail with routing guidance",
    );
  });

  it("keeps the decisions INDEX exempt like the README", () => {
    const report = loadReport({
      footguns: {},
      lessons: {},
      decisions: {
        "README.md": "# Decisions\n",
        "INDEX.md":
          "---\ncategory: index\nbucket: decisions\n---\n\n# Decisions Index\n\n- [ADR-001](ADR-001-foo.md)\n",
        "ADR-001-foo.md":
          "# ADR-001: Foo\n\n**Status:** Accepted\n**Date:** 2026-04-29\n\n## Decision\n\nChoose Foo.\n\n## Context\n\nThe forces.\n\n## Failure Mode Comparison\n\n| Option | Failure |\n| --- | --- |\n| Foo | Known |\n",
      },
    });
    const verdict = checkStats(report);

    assert.equal(verdict.status, "pass");
    assert.ok(
      !verdict.findings.some((f) => f.file.endsWith("INDEX.md")),
      "INDEX.md is a hand-maintained meta file and must not trip ADR filename/structure rules",
    );
  });

  it("fails when a valid ADR filename is missing required structure", () => {
    const report = loadReport({
      footguns: {},
      lessons: {},
      decisions: {
        "ADR-002-bar.md":
          "# ADR-002: Bar\n\n**Status:** Accepted\n**Date:** 2026-04-29\n\n## Decision\n\nDo it.\n\n## Consequences\n\nTrade-offs.\n",
        "ADR-003-baz.md":
          "# ADR-003: Baz\n\n**Date:** 2026-04-29\n\n## Context\n\nContext.\n\n## Decision\n\nDecision.\n\n## Consequences\n\nConsequences.\n",
      },
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    assert.ok(
      verdict.findings.some(
        (f) =>
          f.rule === "decision-structure" && f.message.includes("## Context"),
      ),
      "expected missing Context finding",
    );
    assert.ok(
      verdict.findings.some(
        (f) =>
          f.rule === "decision-structure" && f.message.includes("**Status:**"),
      ),
      "expected missing Status finding",
    );
  });

  it("passes valid decision-first and context-first ADRs with richer tradeoff sections", () => {
    const report = loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n\nBody with `src/alpha.ts` ref.\n",
      },
      lessons: {
        "verification.md":
          "---\ncategory: verification\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: beta\n\nBody.\n",
      },
      decisions: {
        "README.md": "# Decisions\n",
        "ADR-001-foo.md":
          "# ADR-001: Foo\n\n**Status:** Accepted\n**Date:** 2026-04-29\n\n## Decision\n\nChoose Foo.\n\n## Context\n\nThe forces.\n\n## Failure Mode Comparison\n\n| Option | Failure |\n| --- | --- |\n| Foo | Known |\n",
        "ADR-004-qux.md":
          "# ADR-004: Qux\n\n**Status:** Accepted\n**Date:** 2026-04-29\n\n## Context\n\nThe forces.\n\n## Decision\n\nChoose Qux.\n\n## Reversibility\n\nTwo-way door.\n",
      },
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "pass");
    assert.deepEqual(verdict.findings, []);
    assert.equal(
      verdict.warnings.filter((warning) => warning.rule === "decision-metadata")
        .length,
      0,
    );
  });

  it("passes when optional ADR metadata is missing", () => {
    const report = loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n\nBody with `src/alpha.ts` ref.\n",
      },
      lessons: {
        "verification.md":
          "---\ncategory: verification\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: beta\n\nBody.\n",
      },
      decisions: {
        "ADR-001-foo.md":
          "# ADR-001: Foo\n\n**Status:** Accepted\n**Date:** 2026-04-29\n\n## Context\n\nThe forces.\n\n## Decision\n\nChoose Foo.\n\n## Consequences\n\nKnown trade-offs.\n",
        "ADR-002-bar.md":
          "# ADR-002: Bar\n\n**Status:** Accepted\n**Date:** 2026-04-29\n**Author(s):** Matt\n**Ticket/Context:** Issue 1\n\n## Context\n\nThe forces.\n\n## Decision\n\nChoose Bar.\n\n## Consequences\n\nKnown trade-offs.\n",
      },
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "pass");
    assert.deepEqual(verdict.findings, []);
    assert.equal(
      verdict.warnings.filter((warning) => warning.rule === "decision-metadata")
        .length,
      0,
    );
  });

  it("fails when an active footgun has no file:line or (search:) evidence", () => {
    const report = loadReport({
      footguns: {
        "hooks.md":
          "---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n\nNo concrete file refs here, just prose.\n",
      },
      lessons: {},
    });
    const verdict = checkStats(report);
    assert.equal(verdict.status, "fail");
    assert.ok(
      verdict.findings.some(
        (f) =>
          f.rule === "format" &&
          f.message.includes("missing file:line or (search: ...) evidence"),
      ),
      "expected a missing-evidence finding",
    );
  });
});
