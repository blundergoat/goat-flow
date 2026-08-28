/**
 * How a written milestone becomes an export record: which fields parse, which absences warn, and which planning fields survive the round trip.
 * Runs the real CLI and parser against written fixtures, so failures match the terminal guidance an author sees.
 * Lifecycle cases also prove those visible fields govern whether milestone timing can start.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMilestoneMarkdown } from "../../src/cli/plans-export.js";
import { applyPlanTimeTransition } from "../../src/cli/plans-time.js";
import {
  completeMilestoneBody,
  writePlanFixture,
  runPlansExport,
} from "./plans-export.helpers.js";

/** Visible lifecycle variants that must refuse a new user timing session. */
const TIMING_START_REJECTION_CASES = [
  ["a missing", []],
  ["a duplicate", ["in-progress", "testing-gate"]],
  ["an unknown", ["reviewing"]],
  ["a not-started", ["not-started"]],
  ["a human-wait", ["human-verification-pending"]],
  ["a blocked", ["blocked"]],
  ["an abandoned", ["abandoned"]],
  ["a complete", ["complete"]],
] as const;

describe("plans export: milestone parsing", () => {
  // A complete plan keeps every gate and checkbox future issue adapters need.
  it("parses complete milestone fields without warnings", () => {
    const record = parseMilestoneMarkdown(
      completeMilestoneBody(),
      "M42-portable-plan.md",
    );

    assert.equal(record.title, "M42: Portable plan");
    assert.equal(record.status, "in-progress");
    assert.equal(record.dependencies, "M08; M07");
    assert.equal(record.objective, "safe objective");
    assert.match(record.scopeMarkdown, /Export local artifacts/u);
    assert.match(record.boundaryMarkdown, /No remote writes/u);
    assert.deepEqual(record.tasks, [
      { isChecked: true, text: "Parse the plan." },
      { isChecked: false, text: "Export the body." },
    ]);
    assert.match(record.verificationMarkdown, /Run focused tests/u);
    assert.match(record.exitCriteriaMarkdown, /verification evidence/u);
    assert.match(record.stopMarkdown, /loses required context/u);
    assert.deepEqual(record.warnings, []);
  });

  // Exceptional milestones export one canonical current-state explanation beside Status.
  it("parses a canonical status reason without warning", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M43: Waiting on provider evidence",
        "",
        "**Status:** blocked",
        "**Status reason:** The provider capture must show the callback before work can resume.",
        "",
      ].join("\n"),
      "M43-waiting-on-provider-evidence.md",
    );

    assert.equal(
      record.statusReason,
      "The provider capture must show the callback before work can resume.",
    );
    assert.doesNotMatch(record.warnings.join("\n"), /Status reason|Abandoned/u);
  });

  // Historical abandoned snapshots remain readable, but canonical input is the sole authority when both labels exist.
  it("warns on legacy, blank, duplicate, and competing status reasons", () => {
    const legacy = parseMilestoneMarkdown(
      [
        "# M44: Historical abandonment",
        "",
        "**Status:** abandoned",
        "**Abandoned:** Human approved stopping after the premise failed.",
        "",
      ].join("\n"),
      "M44-historical-abandonment.md",
    );
    const competing = parseMilestoneMarkdown(
      [
        "# M45: Competing reasons",
        "",
        "**Status:** abandoned",
        "**Status reason:** Canonical decision text.",
        "**Status reason:** Duplicate canonical text.",
        "**Abandoned:** Legacy decision text.",
        "",
      ].join("\n"),
      "M45-competing-reasons.md",
    );
    const blank = parseMilestoneMarkdown(
      [
        "# M46: Blank reason",
        "",
        "**Status:** blocked",
        "**Status reason:**",
        "",
      ].join("\n"),
      "M46-blank-reason.md",
    );
    const staleLegacy = parseMilestoneMarkdown(
      [
        "# M47: Resumed work",
        "",
        "**Status:** in-progress",
        "**Abandoned:** This old decision must not become the current reason.",
        "",
      ].join("\n"),
      "M47-resumed-work.md",
    );

    assert.equal(
      legacy.statusReason,
      "Human approved stopping after the premise failed.",
    );
    assert.ok(
      legacy.warnings.includes(
        "legacy Abandoned field supplied; use Status reason",
      ),
    );
    assert.equal(competing.statusReason, "Canonical decision text.");
    assert.ok(
      competing.warnings.includes("multiple Status reason values supplied"),
    );
    assert.ok(
      competing.warnings.includes("conflicting status reason representations"),
    );
    assert.equal(blank.statusReason, "");
    assert.ok(blank.warnings.includes("blank Status reason supplied"));
    assert.equal(staleLegacy.statusReason, "");
    assert.ok(
      staleLegacy.warnings.includes(
        "legacy Abandoned field supplied; use Status reason",
      ),
    );
  });

  // A partial plan remains portable but tells users exactly which verification context is absent.
  it("exports missing optional fields as explicit warnings", () => {
    const record = parseMilestoneMarkdown(
      "# M43: Partial plan\n",
      "M43-partial-plan.md",
    );

    assert.equal(record.status, "unknown");
    assert.equal(record.objective, "Partial plan");
    assert.deepEqual(record.tasks, []);
    assert.ok(record.warnings.includes("missing status"));
    assert.ok(record.warnings.includes("missing proof"));
    assert.ok(record.warnings.includes("missing exit criteria"));
    assert.ok(record.warnings.includes("missing stop/rescope"));
    assert.ok(!record.warnings.includes("missing dependencies"));
    assert.ok(!record.warnings.includes("missing objective"));
    assert.ok(!record.warnings.includes("missing boundary notes"));
  });

  /** CommonMark-indented titles remain the visible issue title after optional closing markers. */
  it("parses rendered milestone title variants", () => {
    const record = parseMilestoneMarkdown(
      "   # M44: Indented milestone #\n",
      "M44-indented-milestone.md",
    );

    assert.equal(record.title, "M44: Indented milestone");
    assert.equal(record.objective, "Indented milestone");
  });

  // Handoff-grade milestones use a `## Objective` section and bare `Status:` line.
  it("parses section-style objectives and plain status lines", () => {
    const record = parseMilestoneMarkdown(
      [
        "# Milestone 01: Prove refresh-token rotation",
        "Status: not-started",
        "",
        "## Objective",
        "",
        "Prove the provider issues rotated refresh tokens.",
        "",
        "## Tasks",
        "",
        "- [ ] [RISKY] Verify rotation",
        "",
      ].join("\n"),
      "M01-prove-rotation.md",
    );

    assert.equal(record.status, "not-started");
    assert.equal(
      record.objective,
      "Prove the provider issues rotated refresh tokens.",
    );
    assert.ok(!record.warnings.includes("missing status"));
    assert.ok(!record.warnings.includes("missing objective"));
  });

  it("parses the canonical Proof and Stop shape without conditional-absence warnings", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M01: Users stay signed in",
        "",
        "**Status:** not-started",
        "**Effort estimate:** ~10 min agent-time (7 product / 2 proof / 1 other)",
        "**Plan/admin overhead:** 1 min other",
        "",
        "## Scope",
        "Refresh existing sessions.",
        "",
        "## Tasks",
        "- [ ] Persist the rotated token. (est: 7 min product)",
        "",
        "## Proof",
        "- [ ] Session survives refresh → focused test passes. [automated] (est: 2 min proof)",
        "",
        "### Commands",
        "| Purpose | Command |",
        "|---|---|",
        "| Focused | `npm test -- refresh` |",
        "",
        "## Exit criteria",
        "The session remains valid after refresh.",
        "",
        "## Stop / rescope",
        "Stop if the provider does not rotate tokens.",
        "",
      ].join("\n"),
      "M01-users-stay-signed-in.md",
    );

    assert.equal(record.objective, "Users stay signed in");
    assert.match(record.verificationMarkdown, /Session survives refresh/u);
    assert.equal(record.testingGateItems.length, 1);
    assert.doesNotMatch(record.testingGateItems[0]?.text ?? "", /Commands/u);
    assert.match(record.stopMarkdown, /provider does not rotate/u);
    assert.deepEqual(record.warnings, []);
  });

  it("parses compact Exit with an embedded stop condition", () => {
    const record = parseMilestoneMarkdown(
      [
        "# Fix the parser mismatch",
        "",
        "**Status:** not-started",
        "**Scope:** accept the compact plan shape",
        "",
        "## Tasks",
        "- [ ] Accept canonical Exit.",
        "",
        "## Proof",
        "- [ ] Compact plan → strict parser accepts it. [contract]",
        "",
        "## Exit",
        "- The compact plan parses without warnings.",
        "- Stop/rescope if the parser needs a second stop representation.",
        "",
      ].join("\n"),
      "M01-fix-parser-mismatch.md",
    );

    assert.equal(record.objective, "Fix the parser mismatch");
    assert.match(record.exitCriteriaMarkdown, /parses without warnings/u);
    assert.match(record.stopMarkdown, /Stop\/rescope if the parser needs/u);
    assert.deepEqual(record.warnings, []);
  });

  it("preserves complementary legacy stop sections and flags competing canonical aliases", () => {
    const legacy = parseMilestoneMarkdown(
      [
        "# M01: Legacy stops",
        "",
        "## Kill criteria",
        "Kill when the provider contract fails.",
        "",
        "## STOP conditions",
        "Stop before crossing the auth boundary.",
        "",
      ].join("\n"),
      "M01-legacy-stops.md",
    );
    const conflicting = parseMilestoneMarkdown(
      [
        "# M02: Conflicting aliases",
        "",
        "**Objective:** First outcome",
        "",
        "## Objective",
        "Different outcome",
        "",
        "## Proof",
        "- [ ] Canonical proof",
        "",
        "## Testing Gate",
        "- [ ] Legacy proof",
        "",
        "## Stop / rescope",
        "Canonical stop.",
        "",
        "## Kill criteria",
        "Legacy kill.",
        "",
        "## Scope",
        "Canonical scope.",
        "",
        "## Scope Discipline",
        "Legacy scope.",
        "",
        "## Tasks",
        "- [ ] First task.",
        "",
        "## Tasks",
        "- [ ] Duplicate task.",
        "",
        "## Exit criteria",
        "First exit.",
        "",
        "## Exit Criteria",
        "Duplicate exit.",
        "",
      ].join("\n"),
      "M02-conflicting-aliases.md",
    );

    assert.match(legacy.stopMarkdown, /provider contract fails/u);
    assert.match(legacy.stopMarkdown, /auth boundary/u);
    assert.ok(
      conflicting.warnings.includes("conflicting objective representations"),
    );
    assert.ok(
      conflicting.warnings.includes("conflicting proof representations"),
    );
    assert.ok(
      conflicting.warnings.includes("conflicting stop representations"),
    );
    assert.ok(
      conflicting.warnings.includes("conflicting scope representations"),
    );
    assert.ok(
      conflicting.warnings.includes("conflicting task representations"),
    );
    assert.ok(
      conflicting.warnings.includes(
        "conflicting exit criteria representations",
      ),
    );
  });

  // The worked-example notation from goat-plan's reference: task, testing-gate,
  // mid-proof, and plan/admin estimates rebuild every category in the headline.
  it("parses every counted work item from the worked-example shape", () => {
    const firstRiskyTaskMinutes = 8;
    const validationTaskMinutes = 4;
    const testingGateItemMinutes = 2;
    const midProofItemMinutes = 1;
    const record = parseMilestoneMarkdown(
      [
        "# M01: Estimated milestone",
        "Status: not-started",
        "Effort estimate: ~25 min agent-time (18 product / 5 proof / 2 other)",
        "Plan/admin overhead: 2 min other",
        "",
        "## Tasks",
        "",
        "- [ ] [RISKY] Verify rotation (est: 8 min product)",
        "- [ ] [RISKY] Confirm atomic replace (est: 6 min product)",
        "- [ ] [CORE] Add persistence path (est: 4 min product)",
        "",
        "## Testing Gate",
        "",
        "### Static / Contract Check",
        "",
        "- [ ] `npm run typecheck` exits 0 (est: 2 min proof)",
        "",
        "### Manual",
        "",
        "- [ ] Refresh an expiring session; expected: token rotates (est: 2 min proof)",
        "",
        "## Mid-implementation proof",
        "",
        "- [ ] Run the focused refresh smoke check after persistence edits (est: 1 min proof)",
        "",
      ].join("\n"),
      "M01-estimated.md",
    );

    assert.deepEqual(record.effort, {
      totalMinutes: 25,
      split: { product: 18, proof: 5, other: 2 },
    });
    assert.equal(record.tasks[0]?.estimateMinutes, firstRiskyTaskMinutes);
    assert.equal(record.tasks[0]?.estimateCategory, "product");
    assert.equal(record.tasks[2]?.estimateMinutes, validationTaskMinutes);
    // Task ests must sum to the split's product component (18 = 8 + 6 + 4).
    assert.deepEqual(record.taskEstimateTotals, {
      product: 18,
      proof: 0,
      other: 0,
    });
    assert.equal(
      record.testingGateItems[0]?.estimateMinutes,
      testingGateItemMinutes,
    );
    assert.equal(
      record.testingGateItems[1]?.estimateMinutes,
      testingGateItemMinutes,
    );
    assert.equal(record.midProofItems[0]?.estimateMinutes, midProofItemMinutes);
    assert.deepEqual(record.planAdminEstimate, {
      estimateMinutes: 2,
      estimateCategory: "other",
    });
    assert.deepEqual(record.workEstimateTotals, {
      product: 18,
      proof: 5,
      other: 2,
    });
    assert.ok(
      !record.warnings.some((warning) => warning.includes("estimate")),
      record.warnings.join("; "),
    );
  });

  // Real milestone tasks wrap across indented continuation lines with the est
  // entry at the block's end - discovered when `plans check` flagged its own plan.
  it("parses est entries at the end of wrapped multi-line tasks", () => {
    const expectedTaskCount = 2;
    const wrappedParserTaskMinutes = 12;
    const wrappedWiringTaskMinutes = 8;
    const record = parseMilestoneMarkdown(
      [
        "# M04: Wrapped tasks",
        "Effort estimate: ~20 min agent-time (20 product / 0 proof / 0 other)",
        "",
        "## Tasks",
        "",
        "- [ ] [RISKY] Extend the parser to extract the effort line - total minutes,",
        "      category split, optional Actual - accepting bold and bare label forms",
        "      (est: 12 min product)",
        "- [ ] [CORE] Wire the record fields through render and redaction",
        "      (est: 8 min product)",
        "",
      ].join("\n"),
      "M04-wrapped.md",
    );

    assert.equal(record.tasks.length, expectedTaskCount);
    assert.equal(record.tasks[0]?.estimateMinutes, wrappedParserTaskMinutes);
    assert.equal(record.tasks[1]?.estimateMinutes, wrappedWiringTaskMinutes);
    assert.deepEqual(record.taskEstimateTotals, {
      product: 20,
      proof: 0,
      other: 0,
    });
    assert.ok(!record.warnings.some((warning) => warning.includes("estimate")));
  });

  // A user's nested rationale remains part of exported task text but cannot hide the parent task's estimate or create another work unit.
  it("preserves nested task prose without counting it as estimated work", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M04: Explain risky work",
        "Status: not-started",
        "Effort estimate: ~3 min agent-time (3 product / 0 proof / 0 other)",
        "",
        "## Tasks",
        "- [ ] [RISKY] Attempt the settings edit. (est: 3 min product)",
        "  - M01 records why this exact edit was denied.",
        "",
      ].join("\n"),
      "M04-nested-prose.md",
    );

    assert.equal(record.tasks.length, 1);
    assert.match(record.tasks[0]?.text ?? "", /M01 records why/u);
    assert.equal(record.tasks[0]?.estimateMinutes, 3);
    assert.deepEqual(record.taskEstimateTotals, {
      product: 3,
      proof: 0,
      other: 0,
    });
  });

  it("uses visual columns to exclude a tab-indented nested checkbox", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M04: Mixed indentation",
        "Status: not-started",
        "Effort estimate: ~3 min agent-time (3 product / 0 proof / 0 other)",
        "",
        "## Tasks",
        "  - [ ] Parent work stays canonical. (est: 3 min product)",
        "\t- [ ] Nested work is supporting detail only.",
        "",
      ].join("\n"),
      "M04-mixed-indentation.md",
    );

    assert.equal(record.tasks.length, 1);
    assert.match(record.tasks[0]?.text ?? "", /Parent work stays canonical/u);
    assert.equal(record.tasks[0]?.estimateMinutes, 3);
  });

  it("ignores nested list markers hidden inside fenced task examples", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M04: Fenced task example",
        "Status: not-started",
        "Effort estimate: ~3 min agent-time (3 product / 0 proof / 0 other)",
        "",
        "## Tasks",
        "- [ ] Explain the parser with a fenced example.",
        "  ```markdown",
        "  - example list item",
        "  ```",
        "  Finish the actual task. (est: 3 min product)",
        "",
      ].join("\n"),
      "M04-fenced-task-example.md",
    );

    assert.equal(record.tasks.length, 1);
    assert.equal(record.tasks[0]?.estimateMinutes, 3);
    assert.ok(
      !record.warnings.some((warning) => warning.includes("estimate")),
      record.warnings.join("; "),
    );
  });

  // Estimate-less plans predate the notation and must stay entirely noise-free.
  it("keeps legacy milestones free of effort fields and warnings", () => {
    const record = parseMilestoneMarkdown(
      completeMilestoneBody(),
      "M42-portable-plan.md",
    );

    assert.ok(!("effort" in record));
    assert.ok(!("taskEstimateTotals" in record));
    assert.ok(record.tasks.every((task) => !("estimateMinutes" in task)));
    assert.deepEqual(record.warnings, []);
  });

  // Drifted notation warns with fixed strings (no user text) and never throws.
  it("flags malformed estimate notation as warnings without failing", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M03: Drifted notation",
        "Effort estimate: about a day",
        "",
        "## Tasks",
        "",
        "- [ ] First thing (est: soon)",
        "- [ ] Second thing (est: 5 min docs)",
        "",
      ].join("\n"),
      "M03-drifted.md",
    );

    assert.ok(!("effort" in record));
    assert.ok(record.warnings.includes("effort estimate not parseable"));
    assert.ok(
      record.warnings.includes(
        'task 1: estimate not parseable; expected "(est: <minutes> min <product|proof|other>)"; received "(est: soon)"',
      ),
    );
    assert.ok(
      record.warnings.includes(
        'task 2: estimate not parseable; expected "(est: <minutes> min <product|proof|other>)"; received "(est: 5 min docs)"',
      ),
    );
    assert.ok(record.tasks.every((task) => !("estimateMinutes" in task)));
  });

  // JSON-safe diagnostics show the received text without passing a pasted terminal escape sequence through to the user's terminal.
  it("escapes terminal control characters in received estimate values", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M03: Control-safe diagnostics",
        "Status: not-started",
        "Effort estimate: ~1 min agent-time (0 product / 0 proof / 1 other)",
        "Plan/admin overhead: \u001b[31mtwo min other",
        "",
      ].join("\n"),
      "M03-control-safe.md",
    );
    const adminWarning =
      record.warnings.find((warning) =>
        warning.startsWith("plan/admin overhead estimate not parseable"),
      ) ?? "";

    assert.doesNotMatch(adminWarning, /\u001b/u);
    assert.match(adminWarning, /\\u001b\[31m/u);
  });

  it("ignores fenced metadata, headings, and checklist examples", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M01: Live milestone",
        "```markdown",
        "Status: complete",
        "Effort estimate: ~999 min agent-time (999 product / 0 proof / 0 other)",
        "## Tasks",
        "- [x] Example task (est: 999 min product)",
        "```",
        "Status: not-started",
        "Effort estimate: ~2 min agent-time (1 product / 1 proof / 0 other)",
        "",
        "## Tasks",
        "- [ ] Live task (est: 1 min product)",
        "",
        "## Proof",
        "- [ ] Live proof (est: 1 min proof)",
        "",
      ].join("\n"),
      "M01-live.md",
    );

    assert.equal(record.status, "not-started");
    assert.equal(record.effort?.totalMinutes, 2);
    assert.deepEqual(
      record.tasks.map((task) => task.text),
      ["Live task (est: 1 min product)"],
    );
    assert.deepEqual(
      record.testingGateItems.map((item) => item.text),
      ["Live proof (est: 1 min proof)"],
    );
    assert.ok(!record.warnings.includes("multiple Status values supplied"));
  });

  it("ignores metadata, headings, and checklists inside HTML comments", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M01: Live milestone",
        "<!--",
        "Status: complete",
        "## Tasks",
        "- [x] Hidden example (est: 999 min product)",
        "-->",
        "Status: not-started",
        "Effort estimate: ~2 min agent-time (1 product / 1 proof / 0 other)",
        "",
        "## Tasks",
        "- [ ] Live task (est: 1 min product)",
        "",
        "## Proof",
        "- [ ] Live proof (est: 1 min proof)",
        "",
      ].join("\n"),
      "M01-live.md",
    );

    assert.equal(record.status, "not-started");
    assert.deepEqual(
      record.tasks.map((task) => task.text),
      ["Live task (est: 1 min product)"],
    );
    assert.ok(!record.warnings.includes("multiple Status values supplied"));
  });

  // Handoff-grade milestones carry machine-readable estimate and Actual fields.
  it("parses a bold effort line with a separate structured Actual", () => {
    const plannedTotalMinutes = 44;
    const record = parseMilestoneMarkdown(
      [
        "# M02: Actual-carrying milestone",
        "",
        "**Status:** in-progress",
        "**Effort estimate:** ~44 min agent-time (34 product / 7 proof / 3 other)",
        "**Actual:** ~51 min agent-time (39 product / 9 proof / 3 other) - one extra proof cycle",
        "",
      ].join("\n"),
      "M02-actual.md",
    );

    assert.equal(record.effort?.totalMinutes, plannedTotalMinutes);
    assert.deepEqual(record.effort?.split, { product: 34, proof: 7, other: 3 });
    assert.deepEqual(record.effort?.actual, {
      state: "retrospective",
      totalMinutes: 51,
      split: { product: 39, proof: 9, other: 3 },
      reason: "one extra proof cycle",
    });
  });

  /**
   * Fixture purpose: a finalized receipt must survive both export formats.
   * Both previews use one fixture because format choice must not change timing authority.
   * Filesystem side effects: writes one temporary plan and reads CLI previews.
   */
  it("preserves finalized timing receipts in JSON and Markdown exports", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-receipt-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const productSeconds = 61;
    const proofSeconds = 59;
    const recordedSeconds = productSeconds + proofSeconds;
    const receipt = [
      "## Timing Receipt",
      "",
      "**Receipt state:** finalized",
      `**Recorded seconds:** ${recordedSeconds} total (${productSeconds} product / ${proofSeconds} proof / 0 other)`,
      "**Allocated minutes:** 2 total (1 product / 1 proof / 0 other)",
      "",
      "| Segment | Category | Start UTC / epoch | End UTC / epoch | Seconds | State |",
      "|---|---|---|---|---:|---|",
      "| M42-S01 | product | 1970-01-01T00:01:40Z / 100 | 1970-01-01T00:02:41Z / 161 | 61 | closed |",
      "| M42-S02 | proof | 1970-01-01T00:03:20Z / 200 | 1970-01-01T00:04:19Z / 259 | 59 | closed |",
      "",
    ].join("\n");
    const body = completeMilestoneBody().replace(
      "## Scope Discipline",
      `${receipt}## Scope Discipline`,
    );
    writePlanFixture(planPath, body);

    try {
      const jsonResult = runPlansExport(planPath, "--format", "json");
      const markdownResult = runPlansExport(planPath, "--format", "markdown");

      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      assert.equal(markdownResult.status, 0, markdownResult.stderr);
      const records = JSON.parse(jsonResult.stdout) as Array<{
        timingReceipt: { state: string; summary: { totalSeconds: number } };
        timingReceiptMarkdown: string;
      }>;
      assert.equal(records[0]?.timingReceipt.state, "finalized");
      assert.equal(
        records[0]?.timingReceipt.summary.totalSeconds,
        recordedSeconds,
      );
      assert.match(records[0]?.timingReceiptMarkdown ?? "", /M42-S02/u);
      assert.match(markdownResult.stdout, /## Timing Receipt/u);
      assert.match(markdownResult.stdout, /120 recorded-unpaused|120 total/u);
      assert.match(markdownResult.stdout, /M42-S02/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("parses an optional forecast basis and range in headline units", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M02: Range-carrying milestone",
        "",
        "**Status:** in-progress",
        "**Effort estimate:** ~25 min agent-time (17 product / 6 proof / 2 other)",
        "**Forecast basis:** 10 agent work units; 0.5-2.5-10 min/unit low-likely-high; source: cold-start prior",
        "**Forecast range:** 10-60 agent-time minutes on one recorded-unpaused milestone timeline; likely 25; low confidence because no same-shape measured sample exists",
        "",
      ].join("\n"),
      "M02-range.md",
    );

    assert.deepEqual(record.effort?.forecastBasis, {
      agentWorkUnits: 10,
      lowMinutesPerUnit: 0.5,
      likelyMinutesPerUnit: 2.5,
      highMinutesPerUnit: 10,
      source: "cold-start prior",
    });
    assert.deepEqual(record.effort?.forecastRange, {
      lowMinutes: 10,
      likelyMinutes: 25,
      highMinutes: 60,
      rationale: "low confidence because no same-shape measured sample exists",
    });
  });
  // Absence is the legacy and in-flight default, so it must stay silent rather than warn.
  it("keeps milestones without a forecast range free of range fields and warnings", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M02: Point-estimate milestone",
        "",
        "**Status:** in-progress",
        "**Effort estimate:** ~25 min agent-time (17 product / 6 proof / 2 other)",
        "",
      ].join("\n"),
      "M02-point.md",
    );

    assert.equal(record.effort?.forecastRange, undefined);
    assert.deepEqual(
      record.warnings.filter((warning) => warning.includes("forecast")),
      [],
    );
  });

  /**
   * Fixture purpose: an optional forecast must survive both export formats.
   * Both previews use one fixture because format choice must not change the user's forecast.
   * Filesystem side effects: writes one temporary plan and reads CLI previews.
   */
  it("preserves optional forecast bases and ranges in JSON and Markdown exports", () => {
    const plannedAgentWorkUnits = 10;
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-range-"));
    const planPath = join(temporaryRoot, "1.15.0");
    const body = completeMilestoneBody().replace(
      "## Scope Discipline",
      [
        "**Effort estimate:** ~25 min agent-time (17 product / 6 proof / 2 other)",
        "**Forecast basis:** 10 agent work units; 0.5-2.5-10 min/unit low-likely-high; source: cold-start prior",
        "**Forecast range:** 10-60 agent-time minutes on one recorded-unpaused milestone timeline; likely 25; low confidence because no same-shape measured sample exists",
        "",
        "## Scope Discipline",
      ].join("\n"),
    );
    writePlanFixture(planPath, body);

    try {
      const jsonResult = runPlansExport(planPath, "--format", "json");
      const markdownResult = runPlansExport(planPath, "--format", "markdown");

      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      assert.equal(markdownResult.status, 0, markdownResult.stderr);
      const records = JSON.parse(jsonResult.stdout) as ReturnType<
        typeof parseMilestoneMarkdown
      >[];
      const forecastBasis = records[0]?.effort.forecastBasis;
      assert.equal(forecastBasis?.agentWorkUnits, plannedAgentWorkUnits);
      assert.equal(forecastBasis?.source, "cold-start prior");
      assert.deepEqual(records[0]?.effort.forecastRange, {
        lowMinutes: 10,
        likelyMinutes: 25,
        highMinutes: 60,
        rationale:
          "low confidence because no same-shape measured sample exists",
      });
      assert.match(
        markdownResult.stdout,
        /\*\*Forecast basis:\*\* 10 agent work units/u,
      );
      assert.match(markdownResult.stdout, /\*\*Forecast range:\*\* 10-60/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: a user pastes a token into forecast reasoning, then previews both export formats.
   * Process/filesystem side effects: spawns the CLI and writes only one temporary milestone.
   */
  it("redacts forecast-basis source text from JSON and Markdown previews", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-range-"));
    const planPath = join(temporaryRoot, "1.15.0");
    const fakeToken = ["ghp", "r".repeat(36)].join("_");
    const milestoneBody = completeMilestoneBody().replace(
      "## Scope Discipline",
      [
        "**Effort estimate:** ~25 min agent-time (17 product / 6 proof / 2 other)",
        `**Forecast basis:** 10 agent work units; 0.5-2.5-10 min/unit low-likely-high; source: ${fakeToken}`,
        "**Forecast range:** 10-60 agent-time minutes on one recorded-unpaused milestone timeline; likely 25; uncalibrated",
        "",
        "## Scope Discipline",
      ].join("\n"),
    );
    writePlanFixture(planPath, milestoneBody);

    try {
      const jsonPreview = runPlansExport(planPath, "--format", "json");
      const markdownPreview = runPlansExport(planPath, "--format", "markdown");

      assert.equal(jsonPreview.status, 0, jsonPreview.stderr);
      assert.equal(markdownPreview.status, 0, markdownPreview.stderr);
      assert.doesNotMatch(jsonPreview.stdout, new RegExp(fakeToken, "u"));
      assert.doesNotMatch(markdownPreview.stdout, new RegExp(fakeToken, "u"));
      assert.match(jsonPreview.stdout, /\[REDACTED:token\]/u);
      assert.match(markdownPreview.stdout, /\[REDACTED:token\]/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: a malformed forecast may echo pasted text, but previews must still redact a token before it reaches the user or a file.
   * Process/filesystem side effects: spawns both preview formats and writes only one temporary source milestone.
   */
  it("redacts received values inside malformed-field warnings", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-warning-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const fakeToken = ["ghp", "w".repeat(36)].join("_");
    const milestoneBody = completeMilestoneBody().replace(
      "## Scope Discipline",
      [
        `**Forecast basis:** 10 agent work units at 0.5-2.5-10 min/unit; source: ${fakeToken}`,
        "",
        "## Scope Discipline",
      ].join("\n"),
    );
    writePlanFixture(planPath, milestoneBody);

    try {
      const jsonPreview = runPlansExport(planPath, "--format", "json");
      const markdownPreview = runPlansExport(planPath, "--format", "markdown");

      assert.equal(jsonPreview.status, 0, jsonPreview.stderr);
      assert.equal(markdownPreview.status, 0, markdownPreview.stderr);
      assert.doesNotMatch(jsonPreview.stdout, new RegExp(fakeToken, "u"));
      assert.doesNotMatch(markdownPreview.stdout, new RegExp(fakeToken, "u"));
      assert.match(
        jsonPreview.stdout,
        /forecast basis not parseable.*\[REDACTED:token\]/u,
      );
      assert.match(
        markdownPreview.stdout,
        /forecast basis not parseable.*\[REDACTED:token\]/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // A body without its milestone heading is malformed because an issue title cannot be inferred safely.
  it("rejects milestone markdown without a title", () => {
    assert.throws(
      () =>
        parseMilestoneMarkdown("**Status:** not-started\n", "M44-malformed.md"),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "PlansExportInputError" &&
        error.message.includes("M44-malformed.md") &&
        error.message.includes("top-level title"),
    );
  });
});

describe("plans time: rendered lifecycle admission", () => {
  // Each case names the lifecycle problem the author must resolve before starting new work.
  for (const [caseName, milestoneStatuses] of TIMING_START_REJECTION_CASES) {
    /**
     * Fixture purpose: lifecycle drift must not start a clock or rewrite the user's milestone.
     * Filesystem side effects: writes and re-reads one temporary milestone for each status case.
     */
    it(`rejects Start with ${caseName} milestone status`, () => {
      const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-time-"));
      const planPath = join(
        temporaryRoot,
        "target",
        ".goat-flow",
        "plans",
        "status-admission",
      );
      const sourceFile = "M01-status-admission.md";
      const milestonePath = join(planPath, sourceFile);
      // Each supplied token becomes a live field, including duplicates a merge may leave.
      const milestoneBody = [
        "# M01: Status admission",
        ...milestoneStatuses.map((status) => `**Status:** ${status}`),
      ].join("\n");
      writePlanFixture(planPath, milestoneBody, sourceFile);
      const milestoneBeforeStart = readFileSync(milestonePath, "utf-8");

      try {
        assert.throws(
          () =>
            applyPlanTimeTransition(
              milestonePath,
              { action: "start", category: "product" },
              100,
            ),
          /exactly one rendered Status field set to `in-progress` or `testing-gate`/u,
        );
        assert.equal(
          readFileSync(milestonePath, "utf-8"),
          milestoneBeforeStart,
        );
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }
});
