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
} from "../../src/cli/stats/render.js";
import type {
  LoadedConfig,
  GoatFlowConfig,
} from "../../src/cli/config/types.js";

/** Build a valid loaded config because stats fixtures only need a few targeted overrides. */
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
      planGuard: {
        enabled: true,
        searchPaths: [".goat-flow/plans"],
        maxDepth: 3,
        stalenessDays: 14,
        planFile: null,
      },
      ...overrides,
    },
    warnings: [],
    errors: [],
    parseError: null,
  };
}

/** Build a throw-away repo containing footgun + lesson buckets and return its root path. */
function makeFixtureRepo(spec: {
  footguns: Record<string, string>;
  lessons: Record<string, string>;
  decisions?: Record<string, string>;
}): string {
  const root = mkdtempSync(join(tmpdir(), "goatflow-stats-"));
  const footgunsDir = join(root, ".goat-flow/learning-loop/footguns");
  const lessonsDir = join(root, ".goat-flow/learning-loop/lessons");
  const decisionsDir = join(root, ".goat-flow/learning-loop/decisions");
  mkdirSync(footgunsDir, { recursive: true });
  mkdirSync(lessonsDir, { recursive: true });
  mkdirSync(decisionsDir, { recursive: true });
  for (const [name, body] of Object.entries(spec.footguns)) {
    writeFileSync(join(footgunsDir, name), body);
  }
  for (const [name, body] of Object.entries(spec.lessons)) {
    writeFileSync(join(lessonsDir, name), body);
  }
  for (const [name, body] of Object.entries(spec.decisions ?? {})) {
    writeFileSync(join(decisionsDir, name), body);
  }
  return root;
}

const pinnedNow = new Date("2026-04-18T12:00:00Z");
const disposables: string[] = [];

after(() => {
  for (const dir of disposables) rmSync(dir, { recursive: true, force: true });
});

/** Load a stats report from a seeded learning-loop fixture repo. */
function loadReport(spec: Parameters<typeof makeFixtureRepo>[0]) {
  const root = makeFixtureRepo(spec);
  disposables.push(root);
  const fs = createFS(root);
  const config = stubConfig();
  return buildStatsReport({
    footguns: extractFootgunFacts(fs, config, pinnedNow),
    lessons: extractLessonsFacts(fs, config, pinnedNow),
    decisions: buildDecisionsSection(fs, config.config.decisions.path),
  });
}

/** Load a stats report when the learning-loop directories are absent. */
function loadReportWithoutLoopDirs() {
  const root = mkdtempSync(join(tmpdir(), "goatflow-stats-missing-"));
  disposables.push(root);
  const fs = createFS(root);
  const config = stubConfig();
  return buildStatsReport({
    footguns: extractFootgunFacts(fs, config, pinnedNow),
    lessons: extractLessonsFacts(fs, config, pinnedNow),
    decisions: buildDecisionsSection(fs, config.config.decisions.path),
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
});

describe("goat-flow stats --check", () => {
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
    assert.equal(verdict.warnings.length, 0);
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
    assert.equal(verdict.warnings.length, 0);
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
