/**
 * Unit tests for dashboard report enrichment paths that depend on filesystem-backed learning-loop state.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichDashboardReport } from "../../src/cli/server/dashboard-reporting.js";

/**
 * Build a minimal all-passing audit report because enrichment tests should only
 * set the fields they exercise.
 *
 * @returns A minimal report object accepted by `enrichDashboardReport`.
 */
function minimalReport(): Parameters<typeof enrichDashboardReport>[0] {
  return {
    status: "pass",
    target: "/repo",
    overall: { status: "pass" },
    scopes: {
      setup: { status: "pass", checks: [], failures: [], summary: {} },
      agent: { status: "pass", checks: [], failures: [], summary: {} },
      harness: { status: "pass", checks: [], failures: [], summary: {} },
    },
    agentScores: [],
    learningLoop: null,
    recentLessons: [],
  } as Parameters<typeof enrichDashboardReport>[0];
}

describe("dashboard reporting", () => {
  // Fixture purpose: writes learning-loop lessons to cover the post-M04 path.
  it("reads recent lessons from the post-M04 learning-loop path", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-dashboard-report-"));
    try {
      const lessonsDir = join(root, ".goat-flow", "learning-loop", "lessons");
      mkdirSync(lessonsDir, { recursive: true });
      writeFileSync(
        join(lessonsDir, "verification.md"),
        [
          "---",
          "category: verification",
          "last_reviewed: 2026-06-07",
          "---",
          "",
          "## Lesson: Verify the new path",
          "",
          "**Status:** active | **Created:** 2026-06-07",
          "",
        ].join("\n"),
      );

      const enriched = enrichDashboardReport(minimalReport(), root, true);

      assert.equal(enriched.recentLessons[0]?.title, "Verify the new path");
      assert.equal(
        enriched.recentLessons[0]?.path,
        ".goat-flow/learning-loop/lessons/verification.md",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Fixture purpose: writes temp learning-loop files on disk so one stale generated index plus one missing index covers Home's freshness counts.
  it("includes generated-index freshness in the learning-loop summary", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-dashboard-report-"));
    try {
      const footgunsDir = join(root, ".goat-flow", "learning-loop", "footguns");
      const lessonsDir = join(root, ".goat-flow", "learning-loop", "lessons");
      mkdirSync(footgunsDir, { recursive: true });
      mkdirSync(lessonsDir, { recursive: true });
      writeFileSync(
        join(footgunsDir, "runtime.md"),
        [
          "---",
          "category: runtime",
          "last_reviewed: 2026-06-10",
          "---",
          "",
          "## Footgun: Stale dashboard index",
          "",
          "**Status:** active | **Created:** 2026-06-10 | **Evidence:** unit fixture",
          "",
          "**Symptoms:** Home should report stale generated indexes.",
          "",
        ].join("\n"),
      );
      writeFileSync(join(footgunsDir, "INDEX.md"), "stale index\n");

      const enriched = enrichDashboardReport(minimalReport(), root, true);
      const learningLoop = enriched.learningLoop;
      assert.ok(learningLoop);
      const footgunIndex = learningLoop.indexes.find(
        (entry) => entry.bucket === "footguns",
      );

      assert.equal(footgunIndex?.state, "stale");
      assert.equal(learningLoop.indexStaleCount, 1);
      assert.equal(learningLoop.indexMissingCount, 1);
      assert.equal(learningLoop.status, "needs-review");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
