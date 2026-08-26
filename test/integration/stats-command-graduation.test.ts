/** Integration coverage for stats graduation-candidate normalization and rendering. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkStats } from "../../src/cli/stats/stats.js";
import {
  renderStatsJson,
  renderStatsMarkdown,
  renderStatsText,
} from "../../src/cli/stats/render.js";
import { loadReport } from "./stats-command.helpers.js";

describe("goat-flow stats - graduation candidates", () => {
  /** Fixture spanning legacy markers, canonical markers, declared totals, and resolved entries. */
  function loadRecurrenceReport() {
    return loadReport({
      footguns: {
        "a-tie.md":
          '---\ncategory: tie\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: zeta tie\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n**Incident count:** 3\n\nEvidence: `.goat-flow/learning-loop/footguns/a-tie.md` (search: "## Footgun: zeta tie").\n\n## Footgun: eta tie\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n**Incident count:** 3\n\nEvidence: `.goat-flow/learning-loop/footguns/a-tie.md` (search: "## Footgun: eta tie").\n',
        "consolidated.md":
          '---\ncategory: consolidated\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: consolidated history\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n**Incident count:** 8\n**Latest occurrence:** 2026-04-17\n\nEvidence: `.goat-flow/learning-loop/footguns/consolidated.md` (search: "## Footgun: consolidated history").\n',
        "hooks.md":
          '---\ncategory: hooks\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: alpha\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n\nEvidence: `.goat-flow/learning-loop/footguns/hooks.md` (search: "## Footgun: alpha").\n\n**Recurrence update (2026-04-17):** happened again after recording.\n\n## Footgun: undercounted\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n**Incident count:** 2\n\nEvidence: `.goat-flow/learning-loop/footguns/hooks.md` (search: "## Footgun: undercounted").\n\n**Recurrence 2026-04-16:** first recorded recurrence.\n\n**Repeat incident (2026-04-17):** second recorded recurrence.\n\n## Footgun: declared one-off\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n**Incident count:** 1\n\nEvidence: `.goat-flow/learning-loop/footguns/hooks.md` (search: "## Footgun: declared one-off").\n\n## Resolved Entries\n\n## Footgun: closed trap\n\n**Status:** resolved | **Created:** 2026-04-01 | **Resolved:** 2026-04-02 | **Evidence:** ACTUAL_MEASURED\n\nBody.\n\n**Recurrence update (2026-04-01):** recurred before the fix landed.\n',
      },
      lessons: {
        "verification.md":
          "---\ncategory: verification\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: beta\n\nBody.\n\n**Recurrence 2026-04-10:** first repeat.\n\n**Second recurrence (2026-04-15):** second repeat.\n\n## Lesson: quiet\n\nBody mentions recurrences without a line-start recurrence label.\n",
      },
    });
  }

  it("normalizes active candidates without hiding stronger recurrence evidence", () => {
    const report = loadRecurrenceReport();
    const expectedFootgunCandidateCount = 5;

    assert.equal(
      report.footguns.totalGraduationCandidates,
      expectedFootgunCandidateCount,
    );
    assert.deepEqual(report.footguns.buckets[1].graduationCandidates, [
      {
        title: "consolidated history",
        recurrenceCount: 0,
        declaredIncidentCount: 8,
        incidentCount: 8,
        hasIncidentCountDivergence: false,
      },
    ]);
    assert.deepEqual(report.footguns.buckets[2].graduationCandidates, [
      {
        title: "alpha",
        recurrenceCount: 1,
        declaredIncidentCount: null,
        incidentCount: 2,
        hasIncidentCountDivergence: false,
      },
      {
        title: "undercounted",
        recurrenceCount: 2,
        declaredIncidentCount: 2,
        incidentCount: 3,
        hasIncidentCountDivergence: true,
      },
    ]);
    assert.equal(report.lessons.totalGraduationCandidates, 1);
    assert.deepEqual(report.lessons.buckets[0].graduationCandidates, [
      {
        title: "beta",
        recurrenceCount: 2,
        declaredIncidentCount: null,
        incidentCount: 3,
        hasIncidentCountDivergence: false,
      },
    ]);
    assert.ok(
      report.footguns.buckets.every((bucket) =>
        bucket.graduationCandidates.every(
          (candidate) => candidate.title !== "declared one-off",
        ),
      ),
    );
  });

  it("ranks rendered candidates by effective incidents with deterministic ties", () => {
    const report = loadRecurrenceReport();

    const text = renderStatsText(report);
    assert.ok(text.includes("Graduation candidates"));
    assert.ok(text.includes("hooks.md :: alpha (2 incidents)"));
    assert.ok(text.includes("verification.md :: beta (3 incidents)"));
    assert.ok(
      text.includes(
        "hooks.md :: undercounted (3 incidents; declared 2, 2 recurrence labels)",
      ),
    );
    assert.ok(
      !text.includes("closed trap"),
      "resolved entries must not surface as graduation candidates",
    );
    const expectedFootgunRows = [
      "    - consolidated.md :: consolidated history (8 incidents)",
      "    - a-tie.md :: eta tie (3 incidents)",
      "    - a-tie.md :: zeta tie (3 incidents)",
      "    - hooks.md :: undercounted (3 incidents; declared 2, 2 recurrence labels)",
      "    - hooks.md :: alpha (2 incidents)",
    ];
    const renderedCandidateRows = text
      .split("\n")
      .filter((line) => line.startsWith("    - "));
    assert.deepEqual(
      renderedCandidateRows.slice(0, expectedFootgunRows.length),
      expectedFootgunRows,
    );

    const markdown = renderStatsMarkdown(report);
    assert.ok(markdown.includes("**Graduation candidates**"));
    assert.ok(markdown.includes("verification.md :: beta (3 incidents)"));
  });

  it("preserves raw and normalized counts in JSON", () => {
    const json = JSON.parse(renderStatsJson(loadRecurrenceReport()));
    const undercounted = json.footguns.buckets
      .flatMap(
        (bucket: { graduationCandidates: Array<Record<string, unknown>> }) =>
          bucket.graduationCandidates,
      )
      .find(
        (candidate: { title?: string }) => candidate.title === "undercounted",
      );

    assert.deepEqual(undercounted, {
      title: "undercounted",
      recurrenceCount: 2,
      declaredIncidentCount: 2,
      incidentCount: 3,
      hasIncidentCountDivergence: true,
    });
  });

  it("recognizes every recurrence-label shape measured in the repository", () => {
    const report = loadReport({
      footguns: {},
      lessons: {
        "marker-shapes.md":
          "---\ncategory: marker-shapes\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: all marker shapes\n\n**Recurrence update (2026-04-01):** legacy singular.\n\n**Recurrence updates (2026-04-02):** legacy plural.\n\n**Recurrence 2026-04-03:** canonical date.\n\n**Recurrence (2026-04-04):** parenthesized date.\n\n**Recurrence:** bare singular.\n\n**Recurrences:** bare plural.\n\n**Repeat incident (2026-04-05):** alternate incident label.\n\n**Same-day recurrence (2026-04-06):** session grouping.\n\n**Third recurrence on Windows:** descriptive legacy label.\n",
      },
    });

    assert.deepEqual(report.lessons.buckets[0].graduationCandidates, [
      {
        title: "all marker shapes",
        recurrenceCount: 9,
        declaredIncidentCount: null,
        incidentCount: 10,
        hasIncidentCountDivergence: false,
      },
    ]);
  });

  it("does not promote prevention or no-recurrence metadata", () => {
    const report = loadReport({
      footguns: {},
      lessons: {
        "non-incidents.md":
          "---\ncategory: non-incidents\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: prevention metadata\n\n**No recurrence:** verified after the repair.\n\n**Recurrence prevention:** keep the focused regression.\n",
      },
    });

    assert.deepEqual(report.lessons.buckets[0].graduationCandidates, []);
  });

  it("keeps recurrence candidates report-only without optional-metadata warning noise", () => {
    const verdict = checkStats(loadRecurrenceReport());
    assert.equal(verdict.status, "pass", JSON.stringify(verdict.findings));
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
