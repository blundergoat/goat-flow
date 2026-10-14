/**
 * Tests the effort notation a plan author writes in a milestone file, as `plans check` validates it and `plans export` previews it.
 * Covers the `Effort estimate:` headline, `(est: ...)` task entries, Actuals, plan/admin overhead, category sums and saved forecast records.
 *
 * What these tests pin down:
 * - A milestone with no effort lines stays warning-free, so plans written before estimates existed keep passing.
 * - Malformed notation or forecast records produce an actionable warning or a failing `plans check`, never a silently wrong total.
 * - Grammar cases parse text in memory; some forecast-record cases also run `plans check` or `plans export` in-process on disposable plans.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMilestoneMarkdown } from "../../src/cli/plans-export.js";
import {
  estimatedMilestoneBody,
  runPlansCheck,
} from "./plans-check.helpers.js";
import {
  completeMilestoneBody,
  writePlanFixture,
  runPlansExport,
} from "./plans-export.helpers.js";

import {
  parseEffortLineValue,
  readPlanAdminEstimate,
  readTaskEstimate,
  renderActualLine,
  renderEffortLine,
  renderForecastBasisLine,
  sumTaskEstimates,
} from "../../src/cli/plans-effort.js";

/**
 * Contract fixture: the saved `## Forecast records` JSON for one whole-work forecast issued before the author started work.
 * Tests edit one field to reproduce an authoring mistake; explicit inputs isolate preservation from estimator fitting.
 *
 * @returns a new schema version 1 document on every call, so a test can mutate it; three one-unit, two-minute items and a 3-6-12 minute range
 */
function forecastDocumentFixture(): NonNullable<
  import("../../src/cli/plans-forecast-context.js").PlanForecastContext["document"]
> {
  return {
    schemaVersion: 1,
    records: [
      {
        id: "F1",
        predecessorId: null,
        reason: "Initial forecast",
        issuedAt: "2026-09-13T00:00:00Z",
        methodVersion: "contextual-v1",
        workState: "fresh-implementation",
        scopeKind: "whole",
        unitRubric: "observable-change-v1",
        items: [
          {
            id: "T1",
            description: "Parse context.",
            category: "product",
            units: 1,
            estimateMinutes: 2,
          },
          {
            id: "T2",
            description: "Export context.",
            category: "product",
            units: 1,
            estimateMinutes: 2,
          },
          {
            id: "P1",
            description: "Verify exports.",
            category: "proof",
            units: 1,
            estimateMinutes: 2,
          },
        ],
        basis: {
          agentWorkUnits: 3,
          lowMinutesPerUnit: 1,
          likelyMinutesPerUnit: 2,
          highMinutesPerUnit: 4,
          source: "contract input",
        },
        range: { lowMinutes: 3, likelyMinutes: 6, highMinutes: 12 },
        quantiles: [10, 90],
        selection: "selected-plan",
        selectionReason: "Matching history is insufficient",
        sourceVersion: "contract-v1",
        sampleCount: 1,
        history: [
          {
            id: "history/M01.md",
            sha256: "a".repeat(64),
            completedAt: "2026-09-12T23:58:00Z",
          },
        ],
        scopeDelta: { added: [], removed: [] },
        receiptCutoff: null,
      },
    ],
  };
}

/**
 * Build the milestone Markdown an author saves after opting into contextual forecasts, ready for `plans check` or `plans export`.
 * Optional receipt time is synthetic contract data, not a measured run.
 *
 * @param document - forecast records serialized into the JSON fence unchecked, so a test can save a malformed or unsupported document
 * @param includeRemaining - true: first task ticked, status in-progress, one closed 60-second receipt row; false: not started, no receipt
 * @returns milestone Markdown with a ~6 minute headline (4 product / 2 proof), two product tasks and one proof task in the Testing Gate
 */
function forecastBodyFixture(
  document: unknown,
  includeRemaining = false,
): string {
  // A remaining-work milestone shows the first task ticked and work in progress; a whole-work milestone has not started.
  const body = estimatedMilestoneBody(
    "Effort estimate: ~6 min agent-time (4 product / 2 proof / 0 other)",
    [
      `- [${includeRemaining ? "x" : " "}] Parse context. (est: 2 min product)`,
      "- [ ] Export context. (est: 2 min product)",
    ],
    {
      status: includeRemaining ? "in-progress" : "not-started",
      forecastBasisLine:
        "Forecast basis: 3 agent work units; 1-2-4 min/unit low-likely-high; source: contract input",
      forecastRangeLine:
        "Forecast range: 3-12 agent-time minutes on one recorded-unpaused milestone timeline; likely 6",
      testingGateLines: ["- [ ] Verify exports. (est: 2 min proof)"],
    },
  );
  const segmentStart = "2026-09-13T00:01:00Z",
    segmentEnd = "2026-09-13T00:02:00Z";
  // Whole-work fixtures have no elapsed time; remaining-work fixtures start after a synthetic closed receipt row.
  // Example: the author timed one minute of product work, ticked the first task and paused the clock.
  const receipt = includeRemaining
    ? [
        "## Timing Receipt",
        "",
        "**Receipt state:** paused",
        "",
        "| Segment | Category | Start UTC / epoch | End UTC / epoch | Seconds | State |",
        "|---|---|---|---|---:|---|",
        `| M01-S01 | product | ${segmentStart} / ${Date.parse(segmentStart) / 1000} | ${segmentEnd} / ${Date.parse(segmentEnd) / 1000} | 60 | closed |`,
        "",
      ].join("\n")
    : "";
  // The method line opts the milestone into contextual forecasts; the records follow it in one JSON fence.
  return `${body}\nForecast method: contextual-v1\n\n${receipt}## Forecast records\n\n\`\`\`json\n${JSON.stringify(document, null, 2)}\n\`\`\`\n`;
}

/**
 * Contract fixture: the forecast an author appends after finishing the first task, at a closed receipt boundary, without changing the original.
 * Pair it with `forecastBodyFixture(document, true)`, whose ticked task and 60-second receipt row match this revision.
 *
 * @returns the original whole-work F1 plus a remaining-work F2 that removes T1, keeps T2 and P1, and starts after 60 recorded seconds
 */
function remainingForecastFixture(): ReturnType<
  typeof forecastDocumentFixture
> {
  const document = forecastDocumentFixture();
  const original = document.records[0]!;
  document.records.push({
    ...structuredClone(original),
    id: "F2",
    predecessorId: "F1",
    reason: "First task completed",
    issuedAt: "2026-09-13T00:02:00Z",
    scopeKind: "remaining",
    items: structuredClone(original.items.slice(1)),
    basis: { ...original.basis, agentWorkUnits: 2 },
    range: { lowMinutes: 2, likelyMinutes: 4, highMinutes: 8 },
    scopeDelta: { added: [], removed: ["T1"] },
    receiptCutoff: { segmentId: "M01-S01", recordedSeconds: 60 },
  });
  return document;
}

/**
 * What `plans check` and `plans export` do with saved forecast records once an author adds a `Forecast method:` line to a milestone.
 * Some cases write temporary plans and run `plans check`, `plans export` or both in-process; the rest parse milestone text in memory.
 */
describe("plans export: forecast context", () => {
  /**
   * Proves a whole-work forecast stamped at the same second as the first receipt segment is rejected; it must be issued before work starts.
   *
   * Example: the author starts the clock and records the original forecast in that same second.
   * Runs in memory.
   */
  it("rejects a whole-work forecast issued exactly when the first receipt starts", () => {
    const document = remainingForecastFixture();
    // Move the original issue time onto the receipt's first segment start, 00:01:00.
    document.records[0]!.issuedAt = "2026-09-13T00:01:00Z";
    const parsed = parseMilestoneMarkdown(
      forecastBodyFixture(document, true),
      "M01-context.md",
    );
    // A null method means the forecast is switched off and the author gets the issue-time diagnostic instead of advice.
    assert.equal(parsed.forecastContext?.method, null);
    assert.match(
      parsed.warnings.join("\n"),
      /whole-work forecasts must be issued before/u,
    );
  });

  /**
   * Proves a remaining-work forecast stops matching when the author ticks off work no forecast lists or deletes a task it still counts.
   *
   * Either change needs an appended revision first.
   * Runs in memory.
   */
  it("checks completed additions and removed checklist items against remaining forecast identities", () => {
    const valid = forecastBodyFixture(remainingForecastFixture(), true);
    // Control: the untouched remaining-work milestone keeps its contextual method.
    assert.equal(
      parseMilestoneMarkdown(valid, "M01-context.md").forecastContext?.method,
      "contextual-v1",
    );
    // Example edits: tick off extra work nobody forecast, or delete the `Export context.` task the forecast still counts.
    for (const body of [
      valid.replace(
        "## Tasks",
        "## Tasks\n\n- [x] Unregistered extra work. (est: 2 min product)",
      ),
      valid.replace("- [ ] Export context. (est: 2 min product)", ""),
    ]) {
      const parsed = parseMilestoneMarkdown(body, "M01-context.md");
      // Each edit switches the forecast off (null method) and names the live-checklist mismatch.
      assert.equal(parsed.forecastContext?.method, null);
      assert.match(
        parsed.warnings.join("\n"),
        /live work items|remain in the live checklist/u,
      );
    }
  });
  /**
   * Regression contract: an HTML comment attached to the `Forecast method:` line must keep its headings and task hidden from check and export.
   *
   * Example: the author parks draft `## Forecast records` and `## Tasks` lines in an HTML comment right after the method.
   * Writes temporary plans and runs the checker and export in-process; removes only those fixtures.
   */
  it("keeps multiline comments attached to forecast methods hidden", () => {
    const document = forecastDocumentFixture();
    const root = mkdtempSync(join(tmpdir(), "goat-flow-context-comment-"));
    try {
      // The comment opener can follow the method on the same line or start the next line; both must stay hidden.
      for (const separator of [" ", "\n"]) {
        const body = forecastBodyFixture(document).replace(
          "Forecast method: contextual-v1",
          `Forecast method: contextual-v1${separator}<!--\n## Forecast records\n## Tasks\n- [ ] Hidden task. (est: 9 min product)\n-->`,
        );
        const parsed = parseMilestoneMarkdown(body, "M01-context.md");
        // No warnings and only the two real tasks: the commented `Hidden task.` is never counted.
        assert.deepEqual(parsed.warnings, []);
        assert.equal(parsed.forecastContext?.method, "contextual-v1");
        assert.equal(parsed.tasks.length, 2);
        assert.deepEqual(parsed.forecastContext.document, document);
        writePlanFixture(root, body, "M01-context.md");
        // Default and `--strict` checks must both pass this milestone with exit 0.
        for (const flags of [[], ["--strict"]]) {
          const checked = runPlansCheck(root, ...flags);
          assert.equal(checked.status, 0, checked.stdout + checked.stderr);
        }
        // The Markdown preview must parse back to the same records without warnings, and the source file stays unchanged.
        const markdown = runPlansExport(root, "--format", "markdown");
        assert.equal(markdown.status, 0, markdown.stderr);
        const roundTrip = parseMilestoneMarkdown(
          markdown.stdout,
          "M01-context.md",
        );
        assert.deepEqual(roundTrip.warnings, []);
        assert.deepEqual(roundTrip.forecastContext?.document, document);
        assert.equal(readFileSync(join(root, "M01-context.md"), "utf8"), body);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Regression contract: matching counts and minutes must not let a reopened, renamed or duplicated task stand in for saved remaining work.
   *
   * Example: the author unticks `Parse context.` and ticks `Export context.`, so totals still match but the work is different.
   * Writes temporary plans and runs the checker in-process, with progress and appended-revision controls.
   */
  it("binds remaining work to saved identities before accepting matching totals", () => {
    const document = remainingForecastFixture();
    const body = forecastBodyFixture(document, true);
    // Three invalid edits: reopen the finished task and tick the open one, rename the open one, or relabel it as a second `Verify exports.` item.
    const reopened = body
      .replace("- [x] Parse context.", "- [ ] Parse context.")
      .replace("- [ ] Export context.", "- [x] Export context.");
    const replacement = body.replace(
      "- [ ] Export context.",
      "- [ ] Replace context.",
    );
    const duplicated = body
      .replace("- [ ] Export context.", "- [ ] Verify exports.")
      .replace(
        "Verify exports. (est: 2 min product)",
        "Verify exports. (est: 2 min proof)",
      );
    // The valid way to reopen work: append revision F3, issued after F2, that adds T1 back and removes T2.
    const revision = structuredClone(document.records[1]!);
    revision.id = "F3";
    revision.predecessorId = "F2";
    revision.reason = "Reopen parser work after export completes";
    revision.issuedAt = "2026-09-13T00:02:01Z";
    revision.items[0] = structuredClone(document.records[0]!.items[0]!);
    revision.scopeDelta = { added: ["T1"], removed: ["T2"] };
    const revised = { ...document, records: [...document.records, revision] };
    const validRevision = forecastBodyFixture(revised, true)
      .replace("- [x] Parse context.", "- [ ] Parse context.")
      .replace("- [ ] Export context.", "- [x] Export context.");
    const root = mkdtempSync(join(tmpdir(), "goat-flow-context-identity-"));
    try {
      // Each invalid edit switches the forecast off (null method) but keeps the saved records readable for repair.
      for (const [variant, invalid] of [
        ["reopened", reopened],
        ["replacement", replacement],
        ["duplicated", duplicated],
      ] as const) {
        const parsed = parseMilestoneMarkdown(invalid, "M01-context.md");
        assert.equal(parsed.forecastContext?.method, null, `${variant} body`);
        assert.match(
          parsed.warnings.join("\n"),
          /live work items must uniquely match/u,
          `${variant} body`,
        );
        assert.deepEqual(
          parsed.forecastContext?.document,
          document,
          `${variant} body`,
        );
        writePlanFixture(root, invalid, "M01-context.md");
        // Saved to disk, the same edit must fail default and `--strict` checks with exit 1 and the identity diagnostic.
        for (const flags of [[], ["--strict"]]) {
          const checked = runPlansCheck(root, ...flags);
          assert.equal(checked.status, 1, checked.stdout + checked.stderr);
          assert.match(
            checked.stdout + checked.stderr,
            /live work items must uniquely match/u,
            `${variant} body ${flags.join(" ")}`,
          );
        }
      }
      // Controls the author can rely on: open tasks, every task ticked, and the appended F3 revision all pass `--strict`.
      for (const [variant, valid] of [
        ["open tasks", body],
        ["all tasks checked", body.replaceAll("- [ ]", "- [x]")],
        ["valid revision", validRevision],
      ] as const) {
        const parsed = parseMilestoneMarkdown(valid, "M01-context.md");
        // No warnings, and the original F1 record survives unchanged in every control.
        assert.deepEqual(parsed.warnings, [], `${variant} body`);
        assert.equal(
          parsed.forecastContext?.method,
          "contextual-v1",
          `${variant} body`,
        );
        assert.deepEqual(
          parsed.forecastContext.document?.records[0],
          document.records[0],
          `${variant} body`,
        );
        writePlanFixture(root, valid, "M01-context.md");
        const checked = runPlansCheck(root, "--strict");
        assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Contract: when two saved items share a description, a live task cannot be matched to one saved item; a zero-minute `[HUMAN]` row needs no saved identity.
   *
   * Plan/admin overhead minutes count as work, so they must match a saved `Plan/admin overhead` item.
   * Runs in memory.
   */
  it("requires unambiguous saved descriptions and binds counted admin work", () => {
    const ambiguous = remainingForecastFixture();
    // Rename saved T1 to `Export context.`, so the live `Export context.` task now matches two saved items.
    ambiguous.records[0]!.items[0]!.description = "Export context.";
    const rejected = parseMilestoneMarkdown(
      forecastBodyFixture(ambiguous, true),
      "M01-context.md",
    );
    // Ambiguity switches the forecast off (null method) with the uniqueness diagnostic.
    assert.equal(rejected.forecastContext?.method, null);
    assert.match(
      rejected.warnings.join("\n"),
      /live work items must uniquely match/u,
    );

    const document = forecastDocumentFixture();
    // Accepted shape: the saved proof item becomes 2 minutes of plan/admin overhead and the proof task becomes a zero-minute human check.
    const adminOverheadItem = document.records[0]!.items[2]!;
    adminOverheadItem.description = "Plan/admin overhead";
    adminOverheadItem.category = "other";
    const body = forecastBodyFixture(document)
      .replace("4 product / 2 proof / 0 other", "4 product / 0 proof / 2 other")
      .replace(
        "- [ ] Verify exports. (est: 2 min proof)",
        "- [ ] [HUMAN] Verify exports. (est: 0 min proof)",
      )
      .replace(
        "Forecast method:",
        "Plan/admin overhead: 2 min other\nForecast method:",
      );
    const accepted = parseMilestoneMarkdown(body, "M01-context.md");
    // No warnings: the overhead line binds to the saved admin item and the zero-minute human row is skipped.
    assert.deepEqual(accepted.warnings, []);
    assert.equal(accepted.forecastContext?.method, "contextual-v1");
    assert.deepEqual(accepted.forecastContext.document, document);
  });

  /**
   * Proves the forecast records an author saved come back unchanged from `plans export --format json` and `--format markdown`, and the milestone file is untouched.
   * Writes a temporary plan, runs both previews in-process and removes the fixture.
   */
  it("round-trips original and remaining forecasts without changing their source", () => {
    const document = remainingForecastFixture();
    const body = forecastBodyFixture(document, true);
    const parsed = parseMilestoneMarkdown(body, "M01-context.md");
    // Control: the source milestone parses with no warnings before anything is exported.
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.forecastContext?.method, "contextual-v1");
    assert.deepEqual(parsed.forecastContext?.document, document);
    const root = mkdtempSync(join(tmpdir(), "goat-flow-context-export-"));
    try {
      writePlanFixture(root, body, "M01-context.md");
      // Both previews must exit 0 and carry the exact records the author saved.
      const json = runPlansExport(root, "--format", "json");
      const markdown = runPlansExport(root, "--format", "markdown");
      assert.equal(json.status, 0, json.stderr);
      assert.equal(markdown.status, 0, markdown.stderr);
      assert.deepEqual(
        JSON.parse(json.stdout)[0].forecastContext.document,
        document,
      );
      const roundTrip = parseMilestoneMarkdown(
        markdown.stdout,
        "M01-context.md",
      );
      // The Markdown preview reads back with no warnings and the same records.
      assert.deepEqual(roundTrip.warnings, []);
      assert.deepEqual(roundTrip.forecastContext?.document, document);
      // Six minutes is the fixture's issued whole-work point; the smaller remaining forecast must not replace it.
      assert.equal(roundTrip.effort?.totalMinutes, 6);
      // The receipt's single 60-second segment survives the round trip too.
      assert.equal(roundTrip.timingReceipt?.segments[0]?.seconds, 60);
      assert.equal(readFileSync(join(root, "M01-context.md"), "utf8"), body);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Proves `plans check` accepts a revised remaining forecast with a larger allocation while the headline keeps the issued 6 minutes.
   *
   * Example: the author finds `Export context.` needs 6 minutes, not 2, and raises both its `(est: ...)` entry and the remaining-work F2 record.
   * Side effects: writes temporary plan files, runs CLI checks and removes the fixture directory.
   */
  it("checks revised remaining allocations without charging them to the original headline", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-context-check-"));
    const document = remainingForecastFixture();
    // Revise F2 so `Export context.` carries 6 minutes and the remaining range becomes 2-8-10.
    const remaining = document.records[1]!;
    remaining.items[0]!.estimateMinutes = 6;
    remaining.basis.likelyMinutesPerUnit = 4;
    remaining.basis.highMinutesPerUnit = 5;
    remaining.range = { lowMinutes: 2, likelyMinutes: 8, highMinutes: 10 };
    const body = forecastBodyFixture(document, true).replace(
      "Export context. (est: 2",
      "Export context. (est: 6",
    );
    try {
      writePlanFixture(root, body, "M01-context.md");
      // Both check modes must accept valid revised work while retaining the issued whole-work headline.
      for (const flags of [[], ["--strict"]]) {
        const result = runPlansCheck(root, ...flags);
        assert.equal(result.status, 0, result.stdout + result.stderr);
      }
      // Example: the author ticks every task; the milestone must still parse with no warnings.
      const progressed = parseMilestoneMarkdown(
        body.replaceAll("- [ ]", "- [x]"),
        "M01-progressed.md",
      );
      assert.deepEqual(progressed.warnings, []);
      // The original six-minute headline remains visible after all tasks are checked off.
      assert.equal(progressed.effort?.totalMinutes, 6);
      // The revised remaining forecast still reports its own likely 8 minutes.
      assert.equal(
        progressed.forecastContext?.document?.records[1]?.range.likelyMinutes,
        8,
      );
      // Raising the live task to 7 minutes overruns the revised product allocation, so the forecast switches off (null method).
      const scopeDrift = parseMilestoneMarkdown(
        body.replace("Export context. (est: 6", "Export context. (est: 7"),
        "M01-drift.md",
      );
      assert.equal(scopeDrift.forecastContext?.method, null);
      assert.match(
        scopeDrift.warnings.join("\n"),
        /live product allocation must fit/u,
      );
      assert.deepEqual(scopeDrift.forecastContext?.document, document);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Proves hand-edited forecast records or headlines cannot switch on advice; each mistake gets its own diagnostic for the author to fix.
   *
   * Example: the author lowers the headline from ~6 to ~4 after the forecast was issued.
   * Contract fixtures stay in memory.
   */
  it("rejects changed originals, broken revision links and invalid receipt cutoffs", () => {
    const validBody = forecastBodyFixture(remainingForecastFixture(), true);
    // Each row is one authoring mistake paired with the diagnostic the author should see for it.
    const malformedRecordCases = [
      [
        validBody.replace(
          '"predecessorId": "F1"',
          '"predecessorId": "missing"',
        ),
        /revisions must link/u,
      ],
      [
        validBody.replace(
          '"removed": [\n          "T1"\n        ]',
          '"removed": []',
        ),
        /scopeDelta must match/u,
      ],
      [
        validBody.replace('"recordedSeconds": 60', '"recordedSeconds": 600'),
        /cutoff seconds must equal/u,
      ],
      [
        validBody.replace('"segmentId": "M01-S01"', '"segmentId": "missing"'),
        /cutoff must identify a closed segment/u,
      ],
      [
        validBody.replace(
          /"receiptCutoff": \{[^}]*\}/u,
          '"receiptCutoff": null',
        ),
        /remaining-work records require a closed/u,
      ],
      [
        validBody.replace("| 60 | closed |", "| _ | open |"),
        /receipt cutoff requires/u,
      ],
      [
        validBody.replace(
          '"issuedAt": "2026-09-13T00:00:00Z"',
          '"issuedAt": "2026-09-13T00:01:30Z"',
        ),
        /whole-work forecasts must be issued before/u,
      ],
      [
        validBody.replace(
          '"completedAt": "2026-09-12T23:58:00Z"',
          '"completedAt": "2026-09-13T00:00:00Z"',
        ),
        /history must complete strictly before/u,
      ],
      [
        validBody.replace(
          '"selection": "selected-plan"',
          '"selection": "context-matched"',
        ),
        /requires known context and at least three/u,
      ],
      [
        validBody.replace("Effort estimate: ~6", "Effort estimate: ~4"),
        /issued headline must retain/u,
      ],
    ] as const;
    // Each malformed record must disable advice and identify the specific authoring error.
    for (const [body, diagnostic] of malformedRecordCases) {
      const parsed = parseMilestoneMarkdown(body, "M01-invalid.md");
      assert.equal(parsed.forecastContext?.method, null, diagnostic.source);
      assert.match(parsed.warnings.join("\n"), diagnostic);
    }
  });

  /**
   * Proves an unknown `Forecast method:` value such as `future-v2` fails both compatibility modes instead of silently enabling advice.
   * Side effects: writes a temporary plan, runs CLI checks and removes the fixture directory.
   */
  it("reports invalid context in both default and strict checks", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-context-invalid-"));
    const body = forecastBodyFixture(forecastDocumentFixture()).replace(
      "Forecast method: contextual-v1",
      "Forecast method: future-v2",
    );
    try {
      writePlanFixture(root, body, "M01-context.md");
      // Neither compatibility mode may turn an unknown method into working advice.
      for (const flags of [[], ["--strict"]]) {
        const result = runPlansCheck(root, ...flags);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(
          result.stdout,
          /forecast context: Forecast method has an unsupported value/u,
          `flags ${flags.join(" ")}`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Proves a malformed opt-in must stay diagnosable rather than selecting a model, while an older milestone gets no forecast context at all.
   *
   * Example: the author types `Forecast method: contextual-v2` or pastes a second records section.
   * Runs in memory.
   */
  it("distinguishes absent, invalid, duplicate and unsupported forecast metadata", () => {
    const absent = parseMilestoneMarkdown(
      completeMilestoneBody(),
      "M01-legacy.md",
    );
    // A milestone written before forecasts existed has no `forecastContext` key, so its export shape is unchanged.
    assert.equal(Object.hasOwn(absent, "forecastContext"), false);
    const body = forecastBodyFixture(forecastDocumentFixture());
    // Malformed declarations: blank or unknown method, duplicate method or records, unsupported schema, weighted units, unknown rubric.
    const invalidCases = [
      [
        body.replace("Forecast method: contextual-v1", "Forecast method:"),
        /Forecast method has an unsupported value/u,
      ],
      [
        body.replace(
          "Forecast method: contextual-v1",
          "Forecast method: contextual-v2",
        ),
        /Forecast method has an unsupported value/u,
      ],
      [body + "\nForecast method: legacy\n", /multiple Forecast method/u],
      [
        body.replace('"schemaVersion": 1', '"schemaVersion": 2'),
        /unsupported.*schemaVersion/u,
      ],
      [body + "\n## Forecast records\n\n{}", /multiple Forecast records/u],
      [
        body.replace('"units": 1', '"units": 2'),
        /weighted units are unsupported/u,
      ],
      [
        body.replace(
          '"unitRubric": "observable-change-v1"',
          '"unitRubric": "unknown-v9"',
        ),
        /unsupported unitRubric/u,
      ],
    ] as const;
    // Invalid declarations remain exportable as evidence, with a diagnostic instead of a silently selected method.
    for (const [invalid, diagnostic] of invalidCases) {
      const record = parseMilestoneMarkdown(invalid, "M01-invalid.md");
      assert.equal(record.forecastContext?.method, null, invalid);
      assert.match(record.warnings.join("\n"), diagnostic);
      assert.ok(record.forecastContext?.recordSections.length);
    }
    // Declarations inside a fenced code block are example text, so the milestone gets no forecast context (undefined).
    const fencedDeclarations =
      completeMilestoneBody() +
      "\n\`\`\`md\nForecast method: contextual-v1\n## Forecast records\n{}\n\`\`\`\n";
    assert.equal(
      parseMilestoneMarkdown(fencedDeclarations, "M01-hidden.md")
        .forecastContext,
      undefined,
    );
    // `Forecast method: legacy` is a valid opt-out: the method reads `legacy` and the saved records still parse.
    const disabled = parseMilestoneMarkdown(
      body.replace("Forecast method: contextual-v1", "Forecast method: legacy"),
      "M01-disabled.md",
    );
    assert.equal(disabled.forecastContext?.method, "legacy");
    assert.deepEqual(
      disabled.forecastContext?.document,
      forecastDocumentFixture(),
    );
  });

  /**
   * Proves a token pasted into forecast text, including raw input of an unsupported schema, must be redacted in JSON and Markdown previews.
   *
   * Example: the author pastes a GitHub-style token into forecast fields and a checklist line, then previews the export.
   * Filesystem/process side effects: writes temporary fixtures and runs both previews in-process.
   */
  it("scrubs context strings in JSON and Markdown while preserving numerical inputs", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-context-redaction-"));
    const pastedToken = ["ghp", "q".repeat(36)].join("_");
    const document = forecastDocumentFixture();
    // Plant the token in the reason, first item description, basis source and selection reason.
    document.records[0]!.reason = pastedToken;
    document.records[0]!.items[0]!.description = pastedToken;
    document.records[0]!.basis.source = pastedToken;
    document.records[0]!.selectionReason = pastedToken;
    try {
      // Scrubbing must protect both usable records and unsupported raw input an author still needs to inspect.
      for (const schemaVersion of [1, 2]) {
        // A pasted JSON escape must receive the same protection as the plain token copies in the other fields.
        writePlanFixture(
          root,
          forecastBodyFixture({ ...document, schemaVersion })
            .replace(pastedToken, "\\u0067" + pastedToken.slice(1))
            .replace("- [ ] Parse context.", `- [ ] ${pastedToken}`),
        );
        // A pasted token must stay private whether the author previews structured JSON or readable Markdown.
        for (const format of ["json", "markdown"]) {
          const result = runPlansExport(root, "--format", format);
          assert.equal(result.status, 0, result.stderr);
          assert.ok(
            !result.stdout.includes(pastedToken),
            `schema ${schemaVersion} ${format}`,
          );
          assert.match(
            result.stdout,
            /\[REDACTED:token\]/u,
            `schema ${schemaVersion} ${format}`,
          );
          // Read each preview back: JSON output is parsed directly, Markdown output goes back through the milestone parser.
          const exported =
            format === "json"
              ? JSON.parse(result.stdout)[0]
              : parseMilestoneMarkdown(result.stdout, "M01-redacted.md");
          const rawSection = exported.forecastContext
            .recordSections[0] as string; // -- rationale: both export paths preserve the authored section text.
          const decoded = JSON.parse(
            rawSection.replace(/^```json\n|\n```$/gu, ""),
          );
          assert.ok(
            !JSON.stringify(decoded).includes(pastedToken),
            `${format}, schema ${schemaVersion}: decoded raw source must be scrubbed`,
          );
          // Supported Markdown must remain a usable forecast after scrubbing; rejected versions stay diagnostic evidence.
          if (format === "markdown" && schemaVersion === 1) {
            const parsed = parseMilestoneMarkdown(
              result.stdout,
              "M01-redacted.md",
            );
            assert.equal(
              parsed.forecastContext?.method,
              "contextual-v1",
              JSON.stringify(parsed.warnings),
            );
            // Scrubbing a pasted token must leave the fixture's six-minute numerical forecast intact.
            assert.equal(
              parsed.forecastContext?.document?.records[0]?.range.likelyMinutes,
              6,
              `schema ${schemaVersion} ${format}`,
            );
          }
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** Effort grammar an author types by hand (headline, forecast basis, Actual, task entries, admin overhead), plus category sums and rendering. */
describe("plans effort notation", () => {
  /** Proves a standard headline gives users the same total and category split they authored. No filesystem or process state changes. */
  it("parses a bare effort value with split and no Actual", () => {
    const warnings: string[] = [];
    const effort = parseEffortLineValue(
      "~25 min agent-time (18 product / 5 proof / 2 other)",
      warnings,
    );

    assert.deepEqual(effort, {
      totalMinutes: 25,
      split: { product: 18, proof: 5, other: 2 },
    });
    // An empty warning list means `plans check` has nothing to report about this headline.
    assert.deepEqual(warnings, []);
  });

  /** Proves users can inspect and re-render the countable basis behind a forecast. No filesystem or process state changes. */
  it("parses and renders the countable basis behind a forecast", () => {
    const warnings: string[] = [];
    // Arguments: the headline, an empty Actual (none recorded), the `Forecast range:` text, then the `Forecast basis:` text.
    const effort = parseEffortLineValue(
      "~30 min agent-time (20 product / 8 proof / 2 other)",
      warnings,
      "",
      "6-120 agent-time minutes on one recorded-unpaused milestone timeline; likely 30; uncalibrated",
      "12 agent work units; 0.5-2.5-10 min/unit low-likely-high; source: cold-start prior",
    );

    assert.deepEqual(effort?.forecastBasis, {
      agentWorkUnits: 12,
      lowMinutesPerUnit: 0.5,
      likelyMinutesPerUnit: 2.5,
      highMinutesPerUnit: 10,
      source: "cold-start prior",
    });
    // A lost basis renders as empty text and fails here; a parsed one must reproduce the bold line the author writes.
    assert.equal(
      effort?.forecastBasis
        ? renderForecastBasisLine(effort.forecastBasis)
        : "",
      "**Forecast basis:** 12 agent work units; 0.5-2.5-10 min/unit low-likely-high; source: cold-start prior",
    );
    // No warnings: both the range and the basis were readable.
    assert.deepEqual(warnings, []);
  });

  /** Proves an unreadable basis tells the author both the accepted grammar and received text. No filesystem or process state changes. */
  it("warns when a supplied forecast basis cannot be counted", () => {
    const warnings: string[] = [];

    // Example: the author describes the basis in prose; the Actual and range arguments are empty, so only the basis is judged.
    parseEffortLineValue(
      "~30 min agent-time (20 product / 8 proof / 2 other)",
      warnings,
      "",
      "",
      "roughly twelve tasks at a few minutes each",
    );

    assert.deepEqual(warnings, [
      'forecast basis not parseable; expected "<units> agent work units; <low>-<likely>-<high> min/unit low-likely-high; source: <source>"; received "roughly twelve tasks at a few minutes each"',
    ]);
  });

  /** Proves an inline Actual remains available for planned-versus-recorded comparison. No filesystem or process state changes. */
  it("parses a structured Actual tail with an optional reason", () => {
    const warnings: string[] = [];
    // Example: the author appends `| **Actual:** ...` to the headline once the milestone is done.
    const effort = parseEffortLineValue(
      "~44 min agent-time (34 product / 7 proof / 3 other) | **Actual:** ~51 min agent-time (39 product / 9 proof / 3 other) - one extra proof cycle",
      warnings,
    );

    // An Actual with no state prefix reads as retrospective, and the text after ` - ` becomes its reason.
    assert.deepEqual(effort?.actual, {
      state: "retrospective",
      totalMinutes: 51,
      split: { product: 39, proof: 9, other: 3 },
      reason: "one extra proof cycle",
    });
    // No warnings: the inline `| **Actual:**` tail parses as cleanly as a separate field.
    assert.deepEqual(warnings, []);
  });

  /** Proves a separately authored Actual has the same user-visible structure as an inline one. No filesystem or process state changes. */
  it("parses a separate structured Actual field", () => {
    const warnings: string[] = [];
    // The third argument is the separate `Actual:` field; this headline carries no inline Actual.
    const effort = parseEffortLineValue(
      "~25 min agent-time (18 product / 5 proof / 2 other)",
      warnings,
      "~35 min agent-time (22 product / 10 proof / 3 other) - rotation needed another check",
    );

    assert.deepEqual(effort?.actual, {
      state: "retrospective",
      totalMinutes: 35,
      split: { product: 22, proof: 10, other: 3 },
      reason: "rotation needed another check",
    });
    // No warnings: the separate field is as readable as the inline form.
    assert.deepEqual(warnings, []);
  });

  /** Proves each supported Actual state preserves the evidence level the author selected. No filesystem or process state changes. */
  it("parses explicit measured, retrospective, unavailable, and incomplete states", () => {
    const warnings: string[] = [];

    // Measured and retrospective Actuals carry minutes and a split; unavailable and incomplete carry only the author's reason.
    assert.deepEqual(
      parseEffortLineValue(
        "~3 min agent-time (1 product / 1 proof / 1 other)",
        warnings,
        "measured: ~2 min agent-time (1 product / 1 proof / 0 other) - receipt 120 recorded-unpaused seconds",
      )?.actual,
      {
        state: "measured",
        totalMinutes: 2,
        split: { product: 1, proof: 1, other: 0 },
        reason: "receipt 120 recorded-unpaused seconds",
      },
    );
    assert.deepEqual(
      parseEffortLineValue(
        "~3 min agent-time (1 product / 1 proof / 1 other)",
        warnings,
        "retrospective: ~4 min agent-time (2 product / 1 proof / 1 other) - timing was not instrumented",
      )?.actual,
      {
        state: "retrospective",
        totalMinutes: 4,
        split: { product: 2, proof: 1, other: 1 },
        reason: "timing was not instrumented",
      },
    );
    assert.deepEqual(
      parseEffortLineValue(
        "~3 min agent-time (1 product / 1 proof / 1 other)",
        warnings,
        "unavailable: timing was never started",
      )?.actual,
      {
        state: "unavailable",
        reason: "timing was never started",
      },
    );
    assert.deepEqual(
      parseEffortLineValue(
        "~3 min agent-time (1 product / 1 proof / 1 other)",
        warnings,
        "incomplete: receipt contains a discarded open span",
      )?.actual,
      {
        state: "incomplete",
        reason: "receipt contains a discarded open span",
      },
    );
    // The shared warning list stays empty across all four states.
    assert.deepEqual(warnings, []);
  });

  /** Proves legacy empty effort stays silent while visible drift gives the author a warning. No filesystem or process state changes. */
  it("treats an empty value as legacy silence and drifted text as a warning", () => {
    const warnings: string[] = [];

    // An empty `Effort estimate:` value is an older milestone: no effort (undefined) and no warning.
    assert.equal(parseEffortLineValue("", warnings), undefined);
    assert.deepEqual(warnings, []);

    // Example: the author writes `about a day`; the effort is dropped and one fixed warning is reported.
    assert.equal(parseEffortLineValue("about a day", warnings), undefined);
    assert.deepEqual(warnings, ["effort estimate not parseable"]);
  });

  /** Proves extra text cannot make a partial estimate look valid to the user. No filesystem or process state changes. */
  it("rejects trailing estimate text instead of accepting a valid prefix", () => {
    const warnings: string[] = [];

    // The whole value is rejected (undefined), so no partial total reaches the check or export.
    assert.equal(
      parseEffortLineValue(
        "~25 min agent-time (18 product / 5 proof / 2 other) surprise",
        warnings,
      ),
      undefined,
    );
    assert.deepEqual(warnings, ["effort estimate not parseable"]);
  });

  /** Proves unsafe minute values cannot become misleading plan totals or checklist estimates. No filesystem or process state changes. */
  it("rejects precision-losing minute values in every effort shape", () => {
    // 2^53, one past Number.MAX_SAFE_INTEGER: minute values this large can no longer be added or compared exactly.
    const unsafe = "9007199254740992";
    // One warning list per shape shows which parser reported each rejection.
    const effortWarnings: string[] = [];
    const splitWarnings: string[] = [];
    const actualWarnings: string[] = [];
    const taskWarnings: string[] = [];
    const adminWarnings: string[] = [];

    // Every shape drops the value: headline and split return no effort (undefined), the Actual is unset, task and admin estimates are empty.
    assert.equal(
      parseEffortLineValue(`~${unsafe} min agent-time`, effortWarnings),
      undefined,
    );
    assert.equal(
      parseEffortLineValue(
        `~10 min agent-time (${unsafe} product / 0 proof / 0 other)`,
        splitWarnings,
      ),
      undefined,
    );
    assert.equal(
      parseEffortLineValue(
        "~10 min agent-time (7 product / 2 proof / 1 other)",
        actualWarnings,
        `~${unsafe} min agent-time`,
      )?.actual,
      undefined,
    );
    assert.deepEqual(
      readTaskEstimate(
        `Unsafe task (est: ${unsafe} min product)`,
        0,
        taskWarnings,
      ),
      {},
    );
    assert.deepEqual(
      readPlanAdminEstimate(`${unsafe} min other`, adminWarnings),
      {},
    );
    // Each parser reports exactly one warning; task and admin warnings quote what the author typed.
    assert.deepEqual(effortWarnings, ["effort estimate not parseable"]);
    assert.deepEqual(splitWarnings, ["effort estimate not parseable"]);
    assert.deepEqual(actualWarnings, ["actual effort not parseable"]);
    assert.deepEqual(taskWarnings, [
      'task 1: estimate not parseable; expected "(est: <minutes> min <product|proof|other>)"; received "(est: 9007199254740992 min product)"',
    ]);
    assert.deepEqual(adminWarnings, [
      'plan/admin overhead estimate not parseable; expected "<minutes> min other"; received "9007199254740992 min other"',
    ]);
  });

  /** Proves vague Actual prose cannot be presented to users as machine-readable evidence. No filesystem or process state changes. */
  it("warns when a supplied Actual is not machine-readable", () => {
    const warnings: string[] = [];
    // Example: the author records `about half an hour` as the Actual.
    const effort = parseEffortLineValue(
      "~10 min agent-time (7 product / 2 proof / 1 other)",
      warnings,
      "about half an hour",
    );

    // The Actual stays unset (undefined) and one fixed warning is reported instead.
    assert.equal(effort?.actual, undefined);
    assert.deepEqual(warnings, ["actual effort not parseable"]);
  });

  /** Proves valid task estimates parse while drifted entries show authors the exact repair shape. No filesystem or process state changes. */
  it("parses well-formed task est entries and warns on drifted ones", () => {
    const warnings: string[] = [];

    // The second argument is the zero-based task index; warnings number tasks from 1, as the author counts them.
    assert.deepEqual(
      readTaskEstimate("Build the parser (est: 8 min product)", 0, warnings),
      { estimateMinutes: 8, estimateCategory: "product" },
    );
    // A task with no `(est: ...)` entry is legacy: an empty result and no warning.
    assert.deepEqual(
      readTaskEstimate("Plain task without entry", 1, warnings),
      {},
    );
    // Example: `(est: soon)` or a `docs` category is drifted notation, so the result is empty and the warning shows the expected shape.
    assert.deepEqual(
      readTaskEstimate("Vague task (est: soon)", 2, warnings),
      {},
    );
    assert.deepEqual(
      readTaskEstimate("Foreign category (est: 5 min docs)", 3, warnings),
      {},
    );
    assert.deepEqual(warnings, [
      'task 3: estimate not parseable; expected "(est: <minutes> min <product|proof|other>)"; received "(est: soon)"',
      'task 4: estimate not parseable; expected "(est: <minutes> min <product|proof|other>)"; received "(est: 5 min docs)"',
    ]);
  });

  /** Proves plan overhead accepts only the category users see as administrative work. No filesystem or process state changes. */
  it("parses plan/admin overhead only as other work", () => {
    const warnings: string[] = [];

    assert.deepEqual(readPlanAdminEstimate("2 min other", warnings), {
      estimateMinutes: 2,
      estimateCategory: "other",
    });
    // An empty `Plan/admin overhead:` value means none was recorded: an empty result and no warning.
    assert.deepEqual(readPlanAdminEstimate("", warnings), {});
    // Overhead filed as proof is rejected with a warning; only `other` counts as admin work.
    assert.deepEqual(readPlanAdminEstimate("2 min proof", warnings), {});
    assert.deepEqual(warnings, [
      'plan/admin overhead estimate not parseable; expected "<minutes> min other"; received "2 min proof"',
    ]);
  });

  /** Proves category totals reflect only tasks with estimates and stay absent for an unestimated list. No filesystem or process state changes. */
  it("sums estimates by category and stays absent without any", () => {
    // No task carries an estimate, so there is no total to show (undefined, not a row of zeros).
    assert.equal(sumTaskEstimates([{}, {}]), undefined);
    // Two product tasks add up to 12 minutes; a category with no tasks reports 0.
    assert.deepEqual(
      sumTaskEstimates([
        { estimateMinutes: 8, estimateCategory: "product" },
        { estimateMinutes: 4, estimateCategory: "product" },
        { estimateMinutes: 5, estimateCategory: "proof" },
      ]),
      { product: 12, proof: 5, other: 0 },
    );
  });

  /** Proves rendered effort and Actual lines match the notation authors copy into milestones. No filesystem or process state changes. */
  it("renders effort back into the notation authors write", () => {
    // The headline line leaves the Actual out; the Actual renders on its own `**Actual:**` line.
    assert.equal(
      renderEffortLine({
        totalMinutes: 25,
        split: { product: 18, proof: 5, other: 2 },
        actual: {
          state: "retrospective",
          totalMinutes: 35,
          split: { product: 22, proof: 10, other: 3 },
          reason: "one extra proof cycle",
        },
      }),
      "**Effort estimate:** ~25 min agent-time (18 product / 5 proof / 2 other)",
    );
    assert.equal(
      renderActualLine({
        state: "retrospective",
        totalMinutes: 35,
        split: { product: 22, proof: 10, other: 3 },
        reason: "one extra proof cycle",
      }),
      "**Actual:** retrospective: ~35 min agent-time (22 product / 10 proof / 3 other) - one extra proof cycle",
    );
    // An unavailable Actual renders only its reason, with no minutes.
    assert.equal(
      renderActualLine({
        state: "unavailable",
        reason: "timing was never started",
      }),
      "**Actual:** unavailable: timing was never started",
    );
  });
});
