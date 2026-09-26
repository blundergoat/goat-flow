/**
 * Verifies the milestone effort grammar shared by `plans export` and `plans check`, including forecasts, task entries, Actuals, and category sums.
 *
 * Keeps legacy absence warning-free while proving malformed user input produces actionable diagnostics.
 * Grammar cases run in memory; forecast-record export cases use disposable plans through the real CLI.
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

/** Contract fixture: explicit inputs isolate preservation from estimator fitting. */
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

/** Build a scoped authoring fixture; optional receipt time is synthetic contract data. */
function forecastBodyFixture(
  document: unknown,
  includeRemaining = false,
): string {
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
  const start = "2026-09-13T00:01:00Z",
    end = "2026-09-13T00:02:00Z";
  // Whole-work fixtures have no elapsed time; remaining-work fixtures start after a synthetic closed receipt row.
  const receipt = includeRemaining
    ? [
        "## Timing Receipt",
        "",
        "**Receipt state:** paused",
        "",
        "| Segment | Category | Start UTC / epoch | End UTC / epoch | Seconds | State |",
        "|---|---|---|---|---:|---|",
        `| M01-S01 | product | ${start} / ${Date.parse(start) / 1000} | ${end} / ${Date.parse(end) / 1000} | 60 | closed |`,
        "",
      ].join("\n")
    : "";
  return `${body}\nForecast method: contextual-v1\n\n${receipt}## Forecast records\n\n\`\`\`json\n${JSON.stringify(document, null, 2)}\n\`\`\`\n`;
}

/** Contract fixture: append remaining work at a closed receipt boundary without changing the original forecast. */
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

describe("plans export: forecast context", () => {
  it("rejects a whole-work forecast issued exactly when the first receipt starts", () => {
    const document = remainingForecastFixture();
    document.records[0]!.issuedAt = "2026-09-13T00:01:00Z";
    const parsed = parseMilestoneMarkdown(
      forecastBodyFixture(document, true),
      "M01-context.md",
    );
    assert.equal(parsed.forecastContext?.method, null);
    assert.match(
      parsed.warnings.join("\n"),
      /whole-work forecasts must be issued before/u,
    );
  });

  it("checks completed additions and removed checklist items against remaining forecast identities", () => {
    const valid = forecastBodyFixture(remainingForecastFixture(), true);
    assert.equal(
      parseMilestoneMarkdown(valid, "M01-context.md").forecastContext?.method,
      "contextual-v1",
    );
    for (const body of [
      valid.replace(
        "## Tasks",
        "## Tasks\n\n- [x] Unregistered extra work. (est: 2 min product)",
      ),
      valid.replace("- [ ] Export context. (est: 2 min product)", ""),
    ]) {
      const parsed = parseMilestoneMarkdown(body, "M01-context.md");
      assert.equal(parsed.forecastContext?.method, null);
      assert.match(
        parsed.warnings.join("\n"),
        /live work items|remain in the live checklist/u,
      );
    }
  });
  /** Regression contract: stripping a selector must not expose a hidden heading or task.
   * Uses temporary plans and real checker/export processes; removes only those fixtures. */
  it("keeps multiline comments attached to forecast methods hidden", () => {
    const document = forecastDocumentFixture();
    const root = mkdtempSync(join(tmpdir(), "goat-flow-context-comment-"));
    try {
      for (const separator of [" ", "\n"]) {
        const body = forecastBodyFixture(document).replace(
          "Forecast method: contextual-v1",
          `Forecast method: contextual-v1${separator}<!--\n## Forecast records\n## Tasks\n- [ ] Hidden task. (est: 9 min product)\n-->`,
        );
        const parsed = parseMilestoneMarkdown(body, "M01-context.md");
        assert.deepEqual(parsed.warnings, []);
        assert.equal(parsed.forecastContext?.method, "contextual-v1");
        assert.equal(parsed.tasks.length, 2);
        assert.deepEqual(parsed.forecastContext.document, document);
        writePlanFixture(root, body, "M01-context.md");
        for (const flags of [[], ["--strict"]]) {
          const checked = runPlansCheck(root, ...flags);
          assert.equal(checked.status, 0, checked.stdout + checked.stderr);
        }
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

  /** Regression contract: equal counts cannot substitute a reopened or replacement task for saved residual work.
   * Uses real checker processes on temporary plans, with progress and appended-revision controls. */
  it("binds remaining work to saved identities before accepting matching totals", () => {
    const document = remainingForecastFixture();
    const body = forecastBodyFixture(document, true);
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
      for (const invalid of [reopened, replacement, duplicated]) {
        const parsed = parseMilestoneMarkdown(invalid, "M01-context.md");
        assert.equal(parsed.forecastContext?.method, null);
        assert.match(
          parsed.warnings.join("\n"),
          /live work items must uniquely match/u,
        );
        assert.deepEqual(parsed.forecastContext?.document, document);
        writePlanFixture(root, invalid, "M01-context.md");
        for (const flags of [[], ["--strict"]]) {
          const checked = runPlansCheck(root, ...flags);
          assert.equal(checked.status, 1, checked.stdout + checked.stderr);
          assert.match(
            checked.stdout + checked.stderr,
            /live work items must uniquely match/u,
          );
        }
      }
      for (const valid of [
        body,
        body.replaceAll("- [ ]", "- [x]"),
        validRevision,
      ]) {
        const parsed = parseMilestoneMarkdown(valid, "M01-context.md");
        assert.deepEqual(parsed.warnings, []);
        assert.equal(parsed.forecastContext?.method, "contextual-v1");
        assert.deepEqual(
          parsed.forecastContext.document?.records[0],
          document.records[0],
        );
        writePlanFixture(root, valid, "M01-context.md");
        const checked = runPlansCheck(root, "--strict");
        assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Contract: zero-time human rows do not supply identity; duplicate saved descriptions cannot disambiguate scope. */
  it("requires unambiguous saved descriptions and binds counted admin work", () => {
    const ambiguous = remainingForecastFixture();
    ambiguous.records[0]!.items[0]!.description = "Export context.";
    const rejected = parseMilestoneMarkdown(
      forecastBodyFixture(ambiguous, true),
      "M01-context.md",
    );
    assert.equal(rejected.forecastContext?.method, null);
    assert.match(
      rejected.warnings.join("\n"),
      /live work items must uniquely match/u,
    );

    const document = forecastDocumentFixture();
    const admin = document.records[0]!.items[2]!;
    admin.description = "Plan/admin overhead";
    admin.category = "other";
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
    assert.deepEqual(accepted.warnings, []);
    assert.equal(accepted.forecastContext?.method, "contextual-v1");
    assert.deepEqual(accepted.forecastContext.document, document);
  });

  /** Fixture purpose: preserve originals and receipt-bound revisions across both real export formats.
   * Filesystem/process side effects: writes a temporary plan, spawns previews and removes the fixture. */
  it("round-trips original and remaining forecasts without changing their source", () => {
    const document = remainingForecastFixture();
    const body = forecastBodyFixture(document, true);
    const parsed = parseMilestoneMarkdown(body, "M01-context.md");
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.forecastContext?.method, "contextual-v1");
    assert.deepEqual(parsed.forecastContext?.document, document);
    const root = mkdtempSync(join(tmpdir(), "goat-flow-context-export-"));
    try {
      writePlanFixture(root, body, "M01-context.md");
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
      assert.deepEqual(roundTrip.warnings, []);
      assert.deepEqual(roundTrip.forecastContext?.document, document);
      // Six minutes is the fixture's issued whole-work point; the smaller remaining forecast must not replace it.
      assert.equal(roundTrip.effort?.totalMinutes, 6);
      assert.equal(roundTrip.timingReceipt?.segments[0]?.seconds, 60);
      assert.equal(readFileSync(join(root, "M01-context.md"), "utf8"), body);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Proves the real checker separates the issued headline from a revised remaining allocation.
   * Side effects: writes temporary plan files, runs CLI checks and removes the fixture directory.
   */
  it("checks revised remaining allocations without charging them to the original headline", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-context-check-"));
    const document = remainingForecastFixture();
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
      const progressed = parseMilestoneMarkdown(
        body.replaceAll("- [ ]", "- [x]"),
        "M01-progressed.md",
      );
      assert.deepEqual(progressed.warnings, []);
      // The original six-minute headline remains visible after all tasks are checked off.
      assert.equal(progressed.effort?.totalMinutes, 6);
      assert.equal(
        progressed.forecastContext?.document?.records[1]?.range.likelyMinutes,
        8,
      );
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

  /** Proves malformed provenance, revisions and receipt boundaries cannot activate advice. Contract fixtures stay in memory. */
  it("rejects changed originals, broken revision links and invalid receipt cutoffs", () => {
    const validBody = forecastBodyFixture(remainingForecastFixture(), true);
    const cases = [
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
    for (const [body, diagnostic] of cases) {
      const parsed = parseMilestoneMarkdown(body, "M01-invalid.md");
      assert.equal(parsed.forecastContext?.method, null, diagnostic.source);
      assert.match(parsed.warnings.join("\n"), diagnostic);
    }
  });

  /**
   * Proves invalid opt-in fails both compatibility modes instead of silently enabling advice.
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
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // A malformed opt-in must stay diagnosable rather than selecting a model.
  it("distinguishes absent, invalid, duplicate and unsupported forecast metadata", () => {
    const absent = parseMilestoneMarkdown(
      completeMilestoneBody(),
      "M01-legacy.md",
    );
    assert.equal(Object.hasOwn(absent, "forecastContext"), false);
    const body = forecastBodyFixture(forecastDocumentFixture());
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
    const hidden =
      completeMilestoneBody() +
      "\n\`\`\`md\nForecast method: contextual-v1\n## Forecast records\n{}\n\`\`\`\n";
    assert.equal(
      parseMilestoneMarkdown(hidden, "M01-hidden.md").forecastContext,
      undefined,
    );
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

  /** Fixture purpose: nested context and rejected raw input cross the same readable redaction boundary.
   * Filesystem/process side effects: writes temporary fixtures and runs both CLI previews. */
  it("scrubs context strings in JSON and Markdown while preserving numerical inputs", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-context-redaction-"));
    const marker = ["ghp", "q".repeat(36)].join("_");
    const document = forecastDocumentFixture();
    document.records[0]!.reason = marker;
    document.records[0]!.items[0]!.description = marker;
    document.records[0]!.basis.source = marker;
    document.records[0]!.selectionReason = marker;
    try {
      // Scrubbing must protect both usable records and unsupported raw input an author still needs to inspect.
      for (const schemaVersion of [1, 2]) {
        // A pasted JSON escape must receive the same protection as the plain credential markers in the other fields.
        writePlanFixture(
          root,
          forecastBodyFixture({ ...document, schemaVersion })
            .replace(marker, "\\u0067" + marker.slice(1))
            .replace("- [ ] Parse context.", `- [ ] ${marker}`),
        );
        // A credential marker must stay private whether the author previews structured JSON or readable Markdown.
        for (const format of ["json", "markdown"]) {
          const result = runPlansExport(root, "--format", format);
          assert.equal(result.status, 0, result.stderr);
          assert.ok(!result.stdout.includes(marker));
          assert.match(result.stdout, /\[REDACTED:token\]/u);
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
            !JSON.stringify(decoded).includes(marker),
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
            );
          }
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

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
    assert.deepEqual(warnings, []);
  });

  /** Proves users can inspect and re-render the countable basis behind a forecast. No filesystem or process state changes. */
  it("parses and renders the countable basis behind a forecast", () => {
    const warnings: string[] = [];
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
    assert.equal(
      effort?.forecastBasis
        ? renderForecastBasisLine(effort.forecastBasis)
        : "",
      "**Forecast basis:** 12 agent work units; 0.5-2.5-10 min/unit low-likely-high; source: cold-start prior",
    );
    assert.deepEqual(warnings, []);
  });

  /** Proves an unreadable basis tells the author both the accepted grammar and received text. No filesystem or process state changes. */
  it("warns when a supplied forecast basis cannot be counted", () => {
    const warnings: string[] = [];

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
    const effort = parseEffortLineValue(
      "~44 min agent-time (34 product / 7 proof / 3 other) | **Actual:** ~51 min agent-time (39 product / 9 proof / 3 other) - one extra proof cycle",
      warnings,
    );

    assert.deepEqual(effort?.actual, {
      state: "retrospective",
      totalMinutes: 51,
      split: { product: 39, proof: 9, other: 3 },
      reason: "one extra proof cycle",
    });
    assert.deepEqual(warnings, []);
  });

  /** Proves a separately authored Actual has the same user-visible structure as an inline one. No filesystem or process state changes. */
  it("parses a separate structured Actual field", () => {
    const warnings: string[] = [];
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
    assert.deepEqual(warnings, []);
  });

  /** Proves each supported Actual state preserves the evidence level the author selected. No filesystem or process state changes. */
  it("parses explicit measured, retrospective, unavailable, and incomplete states", () => {
    const warnings: string[] = [];

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
    assert.deepEqual(warnings, []);
  });

  /** Proves legacy empty effort stays silent while visible drift gives the author a warning. No filesystem or process state changes. */
  it("treats an empty value as legacy silence and drifted text as a warning", () => {
    const warnings: string[] = [];

    assert.equal(parseEffortLineValue("", warnings), undefined);
    assert.deepEqual(warnings, []);

    assert.equal(parseEffortLineValue("about a day", warnings), undefined);
    assert.deepEqual(warnings, ["effort estimate not parseable"]);
  });

  /** Proves extra text cannot make a partial estimate look valid to the user. No filesystem or process state changes. */
  it("rejects trailing estimate text instead of accepting a valid prefix", () => {
    const warnings: string[] = [];

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
    const unsafe = "9007199254740992";
    const effortWarnings: string[] = [];
    const splitWarnings: string[] = [];
    const actualWarnings: string[] = [];
    const taskWarnings: string[] = [];
    const adminWarnings: string[] = [];

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
    const effort = parseEffortLineValue(
      "~10 min agent-time (7 product / 2 proof / 1 other)",
      warnings,
      "about half an hour",
    );

    assert.equal(effort?.actual, undefined);
    assert.deepEqual(warnings, ["actual effort not parseable"]);
  });

  /** Proves valid task estimates parse while drifted entries show authors the exact repair shape. No filesystem or process state changes. */
  it("parses well-formed task est entries and warns on drifted ones", () => {
    const warnings: string[] = [];

    assert.deepEqual(
      readTaskEstimate("Build the parser (est: 8 min product)", 0, warnings),
      { estimateMinutes: 8, estimateCategory: "product" },
    );
    assert.deepEqual(
      readTaskEstimate("Plain task without entry", 1, warnings),
      {},
    );
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
    assert.deepEqual(readPlanAdminEstimate("", warnings), {});
    assert.deepEqual(readPlanAdminEstimate("2 min proof", warnings), {});
    assert.deepEqual(warnings, [
      'plan/admin overhead estimate not parseable; expected "<minutes> min other"; received "2 min proof"',
    ]);
  });

  /** Proves category totals reflect only tasks with estimates and stay absent for an unestimated list. No filesystem or process state changes. */
  it("sums estimates by category and stays absent without any", () => {
    assert.equal(sumTaskEstimates([{}, {}]), undefined);
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
    assert.equal(
      renderActualLine({
        state: "unavailable",
        reason: "timing was never started",
      }),
      "**Actual:** unavailable: timing was never started",
    );
  });
});
