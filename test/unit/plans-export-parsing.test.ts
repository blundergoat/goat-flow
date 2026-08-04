/**
 * How a written milestone becomes an export record: which fields parse, which absences
 * warn, and how effort lines, timing receipts, and forecast ranges survive the round trip.
 * Runs the real CLI and parser against written fixtures, so failures read as the author's
 * terminal output rather than as internals.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMilestoneMarkdown } from "../../src/cli/plans-export.js";
import {
  completeMilestoneBody,
  writePlanFixture,
  runPlansExport,
} from "./plans-export.helpers.js";

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
    assert.ok(record.warnings.includes("task 1: estimate not parseable"));
    assert.ok(record.warnings.includes("task 2: estimate not parseable"));
    assert.ok(record.tasks.every((task) => !("estimateMinutes" in task)));
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

  it("parses an optional forecast range in headline units", () => {
    const record = parseMilestoneMarkdown(
      [
        "# M02: Range-carrying milestone",
        "",
        "**Status:** in-progress",
        "**Effort estimate:** ~25 min agent-time (17 product / 6 proof / 2 other)",
        "**Forecast range:** 10-60 agent-time minutes on one recorded-unpaused milestone timeline; likely 25; low confidence because no same-shape measured sample exists",
        "",
      ].join("\n"),
      "M02-range.md",
    );

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

  it("preserves optional forecast ranges in JSON and Markdown exports", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-range-"));
    const planPath = join(temporaryRoot, "1.15.0");
    const body = completeMilestoneBody().replace(
      "## Scope Discipline",
      [
        "**Effort estimate:** ~25 min agent-time (17 product / 6 proof / 2 other)",
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
      const records = JSON.parse(jsonResult.stdout) as Array<{
        effort: {
          forecastRange?: {
            lowMinutes: number;
            likelyMinutes: number;
            highMinutes: number;
          };
        };
      }>;
      assert.deepEqual(records[0]?.effort.forecastRange, {
        lowMinutes: 10,
        likelyMinutes: 25,
        highMinutes: 60,
        rationale:
          "low confidence because no same-shape measured sample exists",
      });
      assert.match(markdownResult.stdout, /\*\*Forecast range:\*\* 10-60/u);
      assert.match(markdownResult.stdout, /likely 25/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: a user pastes a token into forecast reasoning, then previews both export formats.
   * Process/filesystem side effects: spawns the CLI and writes only one temporary milestone.
   */
  it("redacts forecast rationale from JSON and Markdown previews", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-range-"));
    const planPath = join(temporaryRoot, "1.15.0");
    const fakeToken = ["ghp", "r".repeat(36)].join("_");
    const milestoneBody = completeMilestoneBody().replace(
      "## Scope Discipline",
      [
        "**Effort estimate:** ~25 min agent-time (17 product / 6 proof / 2 other)",
        `**Forecast range:** 10-60 agent-time minutes on one recorded-unpaused milestone timeline; likely 25; ${fakeToken}`,
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
