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
  it("preserves severity and enforcement in pipe-separated leading metadata", () => {
    const report = loadReport({
      footguns: {},
      lessons: {
        "inline.md":
          "---\ncategory: inline\nlast_reviewed: 2026-04-18\n---\n\n## Lesson: inline fields\n\n**Status:** active | **Severity:** SECURITY | **Enforced-by:** source.ts (search: guard)\n**Incident count:** 2\n\nBody prose.\n",
      },
    });
    const candidate = report.lessons.buckets[0].graduationCandidates[0];
    assert.equal(candidate.severity, "SECURITY");
    assert.equal(candidate.enforcedBy, "source.ts (search: guard)");
    assert.doesNotMatch(renderStatsText(report), /inline.md :: inline fields/u);
    assert.equal(
      renderStatsJson(report).includes(
        '"enforcedBy": "source.ts (search: guard)"',
      ),
      true,
    );
  });
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

  /** Model one report with serious, guarded, routine, and unclassified repeats. */
  function loadRankedReport() {
    const lessonRows = [
      ["correctness bug", 4, "CORRECTNESS"],
      ["integrated docs", 9, "INTEGRATION"],
      ["slow path", 10, "PERFORMANCE"],
      ["naming drift", 11, "STYLE"],
      ["unknown high", 99, ""],
      ["unknown low", 2, ""],
      ["routine correction", 3, "CORRECTNESS"],
      ["routine integration", 3, "INTEGRATION"],
      ["routine performance", 3, "PERFORMANCE"],
      ["routine style", 3, "STYLE"],
    ] as const;
    const lessons = lessonRows
      .map(
        ([title, count, severity]) =>
          `## Lesson: ${title}\n\n**Status:** active\n**Incident count:** ${count}\n${severity ? `**Severity:** ${severity}\n` : ""}\n`,
      )
      .join("\n");
    return loadReport({
      footguns: {
        "a-security.md":
          '---\ncategory: security\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: guarded mutation\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n**Incident count:** 20\n**Severity:** SECURITY\n**Enforced-by:** fixture policy guard\n\nEvidence: `.goat-flow/learning-loop/footguns/a-security.md` (search: "## Footgun: guarded mutation").\n\n## Footgun: dangerous parser\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n**Incident count:** 2\n**Severity:** SECURITY\n\nEvidence: `.goat-flow/learning-loop/footguns/a-security.md` (search: "## Footgun: dangerous parser").\n',
        "b-correctness.md":
          '---\ncategory: correctness\nlast_reviewed: 2026-04-18\n---\n\n## Footgun: tie alpha\n\n**Status:** active | **Evidence:** ACTUAL_MEASURED\n**Incident count:** 5\n**Severity:** CORRECTNESS\n\nEvidence: `.goat-flow/learning-loop/footguns/b-correctness.md` (search: "## Footgun: tie alpha").\n',
      },
      lessons: {
        "all-lessons.md":
          "---\ncategory: lessons\nlast_reviewed: 2026-04-18\n---\n\n" +
          lessons,
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
        severity: null,
        rank: 1,
        enforcedBy: null,
      },
    ]);
    assert.deepEqual(report.footguns.buckets[2].graduationCandidates, [
      {
        title: "undercounted",
        recurrenceCount: 2,
        declaredIncidentCount: 2,
        incidentCount: 3,
        hasIncidentCountDivergence: true,
        severity: null,
        rank: 4,
        enforcedBy: null,
      },
      {
        title: "alpha",
        recurrenceCount: 1,
        declaredIncidentCount: null,
        incidentCount: 2,
        hasIncidentCountDivergence: false,
        severity: null,
        rank: 6,
        enforcedBy: null,
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
        severity: null,
        rank: 5,
        enforcedBy: null,
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

  it("ranks rendered candidates globally by effective incidents with deterministic ties", () => {
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
    const expectedRows = [
      "    - [UNCLASSIFIED] consolidated.md :: consolidated history (8 incidents)",
      "    - [UNCLASSIFIED] a-tie.md :: eta tie (3 incidents)",
      "    - [UNCLASSIFIED] a-tie.md :: zeta tie (3 incidents)",
      "    - [UNCLASSIFIED] hooks.md :: undercounted (3 incidents; declared 2, 2 recurrence labels)",
      "    - [UNCLASSIFIED] verification.md :: beta (3 incidents)",
      "    - [UNCLASSIFIED] hooks.md :: alpha (2 incidents)",
    ];
    const renderedCandidateRows = text
      .split("\n")
      .filter((line) => line.startsWith("    - "));
    assert.deepEqual(
      renderedCandidateRows.slice(0, expectedRows.length),
      expectedRows,
    );

    const markdown = renderStatsMarkdown(report);
    assert.ok(markdown.includes("## Graduation candidates"));
    assert.ok(markdown.includes("verification.md :: beta (3 incidents)"));
  });

  it("ranks both sections by severity and limits the human report to ten unguarded repeats", () => {
    const report = loadRankedReport();
    const text = renderStatsText(report);
    const markdown = renderStatsMarkdown(report);
    const textRows = text
      .split("\n")
      .filter((line) => line.startsWith("    - "));
    const markdownRows = markdown
      .split("\n")
      .filter((line) => line.startsWith("- ") && line.includes(" :: "));

    assert.equal(textRows.length, 10);
    assert.equal(markdownRows.length, 10);
    assert.match(textRows[0] ?? "", /dangerous parser/u);
    assert.match(textRows[1] ?? "", /tie alpha/u);
    assert.match(textRows[4] ?? "", /integrated docs/u);
    assert.match(textRows[9] ?? "", /routine style/u);
    assert.doesNotMatch(text + markdown, /guarded mutation|unknown high/u);
    assert.match(text, /2 more unguarded/u);
    assert.match(text, /1 guarded/u);
    assert.match(text, /2 need classification/u);
    assert.match(markdown, /2 more unguarded/u);

    const json = JSON.parse(renderStatsJson(report));
    const all = [...json.footguns.buckets, ...json.lessons.buckets].flatMap(
      (bucket: { graduationCandidates: Array<Record<string, unknown>> }) =>
        bucket.graduationCandidates,
    );
    assert.equal(all.length, 13);
    assert.deepEqual(
      all
        .map((candidate: { rank: number }) => candidate.rank)
        .sort((a: number, b: number) => a - b),
      Array.from({ length: 13 }, (_, index) => index + 1),
    );
    assert.equal(
      all.find(
        (candidate: { title: string }) =>
          candidate.title === "guarded mutation",
      ).enforcedBy,
      "fixture policy guard",
    );
    assert.equal(
      all.find(
        (candidate: { title: string }) =>
          candidate.title === "dangerous parser",
      ).severity,
      "SECURITY",
    );
    assert.equal(
      all.find(
        (candidate: { title: string }) => candidate.title === "unknown high",
      ).severity,
      null,
    );
    assert.equal(
      all.find(
        (candidate: { title: string }) => candidate.title === "unknown high",
      ).rank,
      12,
    );
    assert.equal(checkStats(report).status, "pass");
  });

  it("treats empty, fenced, and unrecognized metadata as unclassified and unguarded", () => {
    const report = loadReport({
      footguns: {},
      lessons: {
        "optional-metadata.md": `---
category: optional-metadata
last_reviewed: 2026-04-18
---

## Lesson: empty guard

**Incident count:** 2
**Enforced-by:**
**Severity:**

## Lesson: fenced guard

**Incident count:** 3

\`\`\`markdown
**Enforced-by:** fake guard
**Severity:** SECURITY
\`\`\`

## Lesson: invalid severity

**Incident count:** 4
**Severity:** CRITICAL
`,
      },
    });
    const candidates = report.lessons.buckets[0].graduationCandidates;
    assert.deepEqual(
      candidates.map((candidate) => candidate.severity),
      [null, null, null],
    );
    assert.deepEqual(
      candidates.map((candidate) => candidate.enforcedBy),
      [null, null, null],
    );
    assert.match(renderStatsText(report), /empty guard/u);
    assert.match(renderStatsText(report), /fenced guard/u);
    assert.match(renderStatsText(report), /invalid severity/u);
    const verdict = checkStats(report);
    assert.equal(verdict.status, "pass", JSON.stringify(verdict.findings));
  });

  it("keeps metadata-shaped incident prose out of severity and enforcement", () => {
    const report = loadReport({
      footguns: {},
      lessons: {
        "narrative-labels.md": `---
category: narrative-labels
last_reviewed: 2026-04-18
---

## Lesson: apparent guard in incident prose

**Status:** active
**Incident count:** 2

**What happened:** The incident narrative contains a rendered label.

**Severity:** SECURITY
**Enforced-by:** the label is narrative text, not a shipped guard

## Lesson: adjacent body label

**Status:** active
**Incident count:** 2
**Prevention:** Keep the repeat visible.
**Enforced-by:** only a sentence in the incident narrative
`,
      },
    });
    const candidates = report.lessons.buckets[0].graduationCandidates;
    assert.deepEqual(
      candidates.map((candidate) => [candidate.severity, candidate.enforcedBy]),
      [
        [null, null],
        [null, null],
      ],
    );
    assert.match(renderStatsText(report), /apparent guard in incident prose/u);
    assert.match(renderStatsText(report), /adjacent body label/u);
    assert.match(renderStatsText(report), /0 guarded/u);
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
      severity: null,
      rank: 4,
      enforcedBy: null,
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
        severity: null,
        rank: 1,
        enforcedBy: null,
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

  // Fixture purpose: places candidate headings and incident metadata in fences beside one visible recurrence so only rendered evidence is counted.
  it("ignores fenced graduation headings, counts, and recurrence labels", () => {
    const report = loadReport({
      footguns: {},
      lessons: {
        "fenced-incidents.md": `---
category: fenced-incidents
last_reviewed: 2026-04-18
---

\`\`\`markdown
## Lesson: fenced phantom
**Incident count:** 9
**Recurrence 2026-04-01:** fenced recurrence.
\`\`\`

## Lesson: visible recurrence

\`\`\`markdown
**Incident count:** 8
**Recurrence 2026-04-02:** fenced recurrence in a visible entry.
\`\`\`

**Recurrence 2026-04-03:** visible recurrence control.
`,
      },
    });

    assert.deepEqual(report.lessons.buckets[0].graduationCandidates, [
      {
        title: "visible recurrence",
        recurrenceCount: 1,
        declaredIncidentCount: null,
        incidentCount: 2,
        hasIncidentCountDivergence: false,
        severity: null,
        rank: 1,
        enforcedBy: null,
      },
    ]);
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
