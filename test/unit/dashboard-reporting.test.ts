/**
 * Unit tests for dashboard report enrichment paths that depend on filesystem-backed learning-loop state.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichDashboardReport } from "../../src/cli/server/dashboard-reporting.js";

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
});
