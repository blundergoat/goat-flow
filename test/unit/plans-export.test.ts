/**
 * Verifies portable milestone exports from parsing through CLI persistence.
 * Users can preview redacted JSON or Markdown without writes, then explicitly
 * materialize generated files while existing output remains protected.
 * Fixtures cover complete, partial, and malformed goat-plan milestones.
 */
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import { parseMilestoneMarkdown } from "../../src/cli/plans-export.js";
import { maskNonRenderedMarkdown } from "../../src/cli/rendered-markdown.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");

/** Build a full milestone body with every field users expect in an exported issue. */
function completeMilestoneBody(secretValue = "safe objective"): string {
  return `# M42: Portable plan

**Status:** in-progress
**Depends on:** M08; M07
**Objective:** ${secretValue}

## Scope Discipline

- Export local artifacts.

## Boundary Gate

- No remote writes.

## Tasks

- [x] Parse the plan.
- [ ] Export the body.

## Verification Gate

- [ ] Run focused tests.

## Exit Criteria

- Export keeps verification evidence.

## STOP conditions

- Stop if export loses required context.
`;
}

/** Write one plan fixture so CLI tests exercise the same filesystem shape users select. */
function writePlanFixture(
  planPath: string,
  body: string,
  sourceFile = "M42-portable-plan.md",
): void {
  mkdirSync(planPath, { recursive: true });
  writeFileSync(join(planPath, sourceFile), body, "utf-8");
}

/** Spawn the real CLI so parser, dispatch, redaction, and filesystem behavior stay integrated. */
function runPlansExport(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, "plans", "export", ...args],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
}

/** Create a symlink, or skip the test on hosts that forbid unprivileged links. */
function symlinkOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
): boolean {
  try {
    symlinkSync(target, link);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      testContext.skip(
        "Skipped: host blocks unprivileged symlinks (Windows without Developer Mode)",
      );
      return false;
    }
    throw error;
  }
}

/** Create a hardlink, or skip when the host filesystem does not support it. */
function hardlinkOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
): boolean {
  try {
    linkSync(target, link);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      ["EACCES", "EPERM", "EXDEV"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      testContext.skip("Skipped: host filesystem blocks hardlinks");
      return false;
    }
    throw error;
  }
}

describe("plans export", () => {
  it("masks comments and fences without changing source offsets", () => {
    const content = [
      "<!--",
      "```markdown",
      "## Hidden comment fence",
      "-->",
      "## Live after comment",
      "```markdown",
      "<!-- Hidden fence comment",
      "```",
      "## Live after fence",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.equal(masked.length, content.length);
    assert.deepEqual(
      Array.from(masked.matchAll(/\n/gu), (match) => match.index),
      Array.from(content.matchAll(/\n/gu), (match) => match.index),
    );
    for (const visible of ["## Live after comment", "## Live after fence"]) {
      assert.equal(masked.indexOf(visible), content.indexOf(visible));
    }
    assert.doesNotMatch(masked, /Hidden/u);
  });

  it("masks raw HTML blocks without hiding later visible structure", () => {
    const content = [
      "<pre>",
      "## Hidden pre heading",
      "</pre>",
      "",
      "<div>",
      "## Hidden div heading",
      "</div>",
      "",
      "## Live heading",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.equal(masked.length, content.length);
    assert.doesNotMatch(masked, /Hidden/u);
    assert.equal(
      masked.indexOf("## Live heading"),
      content.indexOf("## Live heading"),
    );
  });

  it("masks type-7 custom-tag blocks without hiding later visible structure", () => {
    const content = [
      "<x-review>",
      "## Hidden custom-tag heading",
      "</x-review>",
      "",
      "## Live heading",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.equal(masked.length, content.length);
    assert.doesNotMatch(masked, /Hidden custom-tag/u);
    assert.equal(
      masked.indexOf("## Live heading"),
      content.indexOf("## Live heading"),
    );
  });

  it("keeps a complete custom tag visible when it continues a paragraph", () => {
    const content = [
      "Visible paragraph",
      "<x-review>",
      "## Live heading",
      "",
    ].join("\n");

    assert.equal(maskNonRenderedMarkdown(content), content);
  });

  it("keeps HTML-comment delimiters inside inline code visible", () => {
    const content = [
      "Checked the literal `<!--` token.",
      "## Live before comment",
      "<!-- hidden comment -->",
      "## Live after comment",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    for (const visible of [
      "Checked the literal `<!--` token.",
      "## Live before comment",
      "## Live after comment",
    ]) {
      assert.equal(masked.indexOf(visible), content.indexOf(visible));
    }
    assert.doesNotMatch(masked, /hidden comment/u);
  });

  it("keeps HTML-comment delimiters inside multiline inline code visible", () => {
    const content = [
      "Checked the literal `first line",
      "continued <!-- remains code` token.",
      "## Live after multiline code",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.equal(masked, content);
  });

  it("does not carry inline code across an interrupting HTML comment block", () => {
    const content = [
      "An unmatched ` delimiter remains literal.",
      "<!-- hidden block comment",
      "## Hidden comment heading",
      "-->",
      "## Live after comment",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.doesNotMatch(masked, /hidden block|Hidden comment/u);
    assert.equal(
      masked.indexOf("## Live after comment"),
      content.indexOf("## Live after comment"),
    );
  });

  it("tracks a new multiline code span after closing one on the same line", () => {
    const content = [
      "Checked the `first",
      "span` and the `second",
      "span <!-- remains code` token.",
      "## Live after consecutive spans",
      "",
    ].join("\n");

    assert.equal(maskNonRenderedMarkdown(content), content);
  });

  it("keeps backslash-escaped HTML comment openers visible", () => {
    const content = [
      "Checked the visible literal \\<!-- token.",
      "## Live before comment",
      "<!-- hidden comment -->",
      "## Live after comment",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    for (const visible of [
      "Checked the visible literal \\<!-- token.",
      "## Live before comment",
      "## Live after comment",
    ]) {
      assert.equal(masked.indexOf(visible), content.indexOf(visible));
    }
    assert.doesNotMatch(masked, /hidden comment/u);
  });

  it("masks an HTML comment after an escaped backslash", () => {
    const content = [
      "Visible \\\\<!-- hidden even-slash comment --> tail.",
      "## Live after comment",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.doesNotMatch(masked, /hidden even-slash comment/u);
    assert.equal(
      masked.indexOf("## Live after comment"),
      content.indexOf("## Live after comment"),
    );
  });

  it("does not protect HTML comments with escaped backticks", () => {
    const content = [
      "Escaped \\`<!-- hidden comment -->\\` markers.",
      "## Live after comment",
      "",
    ].join("\n");
    const masked = maskNonRenderedMarkdown(content);

    assert.doesNotMatch(masked, /hidden comment/u);
    assert.equal(
      masked.indexOf("## Live after comment"),
      content.indexOf("## Live after comment"),
    );
  });

  for (const [flag, field] of [
    ["--help", "showHelp"],
    ["--version", "showVersion"],
  ] as const) {
    it(`accepts plans ${flag} without an export path`, () => {
      const parsed = parseCLIArgs(["plans", flag]);
      assert.equal(parsed.command, "plans");
      assert.equal(parsed[field], true);
    });
  }

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

  // CLI parsing keeps the plan path distinct from the export subcommand users invoked.
  it("parses plans export as a first-class CLI command", () => {
    const planPath = resolve(".goat-flow/plans/1.15.0");
    const parsed = parseCLIArgs([
      "plans",
      "export",
      planPath,
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "plans");
    assert.equal(parsed.plansSubcommand, "export");
    assert.equal(parsed.projectPath, planPath);
    assert.equal(parsed.output, null);
  });

  /**
   * Fixture purpose: reproduce a user previewing a sensitive plan before choosing an output path.
   * Process/filesystem side effects: spawns the CLI and writes only the temporary source milestone.
   */
  it("prints redacted JSON preview without creating export files", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-preview-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const fakeToken = ["ghp", "p".repeat(36)].join("_");
    writePlanFixture(
      planPath,
      completeMilestoneBody(fakeToken),
      `M42-${fakeToken}.md`,
    );

    try {
      const result = runPlansExport(planPath, "--format", "json");

      assert.equal(result.status, 0, result.stderr);
      const records = JSON.parse(result.stdout) as Array<{
        objective: string;
      }>;
      assert.equal(records[0]?.objective, "[REDACTED:token]");
      assert.doesNotMatch(result.stdout, new RegExp(fakeToken, "u"));
      assert.equal(existsSync(join(planPath, "exports")), false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: cover the JSON persistence adapter rather than only its stdout preview.
   * Process/filesystem side effects: spawns the CLI and writes one bundle inside a temp directory.
   */
  it("writes a redacted JSON record bundle to an explicit output file", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-json-"));
    const planPath = join(temporaryRoot, "1.15.0");
    const outputPath = join(temporaryRoot, "exports", "1.15.0.json");
    writePlanFixture(planPath, completeMilestoneBody());

    try {
      const result = runPlansExport(
        planPath,
        "--format",
        "json",
        "--output",
        outputPath,
      );

      assert.equal(result.status, 0, result.stderr);
      const records = JSON.parse(readFileSync(outputPath, "utf-8")) as Array<{
        title: string;
        verificationMarkdown: string;
      }>;
      assert.equal(records[0]?.title, "M42: Portable plan");
      assert.match(records[0]?.verificationMarkdown ?? "", /focused tests/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: cover generated Markdown output and the explicit overwrite contract.
   * Process/filesystem side effects: spawns three CLI runs and writes only inside one temp directory.
   */
  it("writes redacted Markdown and requires force before regeneration", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-markdown-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const outputPath = join(temporaryRoot, "exports");
    const fakeToken = ["npm", "q".repeat(36)].join("_");
    writePlanFixture(planPath, completeMilestoneBody(fakeToken));

    try {
      const firstWrite = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputPath,
      );
      assert.equal(firstWrite.status, 0, firstWrite.stderr);
      const milestoneOutputPath = join(outputPath, "M42-portable-plan.md");
      const firstBody = readFileSync(milestoneOutputPath, "utf-8");
      assert.match(firstBody, /## Proof/u);
      assert.match(firstBody, /\[REDACTED:token\]/u);
      assert.doesNotMatch(firstBody, new RegExp(fakeToken, "u"));

      writeFileSync(milestoneOutputPath, "user-owned replacement\n", "utf-8");
      const refusedWrite = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputPath,
      );
      assert.equal(refusedWrite.status, 2);
      assert.match(refusedWrite.stderr, /already exists.*--force/iu);
      assert.equal(
        readFileSync(milestoneOutputPath, "utf-8"),
        "user-owned replacement\n",
      );

      const forcedWrite = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputPath,
        "--force",
      );
      assert.equal(forcedWrite.status, 0, forcedWrite.stderr);
      assert.match(readFileSync(milestoneOutputPath, "utf-8"), /# M42/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: prove two source names cannot silently overwrite one generated Markdown file.
   * Process/filesystem side effects: spawns the CLI and writes only temporary source milestones.
   */
  it("rejects sanitized Markdown filename collisions before writing", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-filename-collision-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const outputPath = join(temporaryRoot, "exports");
    writePlanFixture(planPath, completeMilestoneBody(), "M01-a!.md");
    writePlanFixture(planPath, completeMilestoneBody(), "M01-a?.md");

    try {
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputPath,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /same export filename.*rename/iu);
      assert.equal(existsSync(outputPath), false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: prove redaction cannot collapse distinct secret-bearing names into one destination.
   * Process/filesystem side effects: spawns the CLI and writes only temporary source milestones.
   */
  it("rejects redaction-induced Markdown filename collisions", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-redaction-collision-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const outputPath = join(temporaryRoot, "exports");
    const firstToken = ["ghp", "a".repeat(36)].join("_");
    const secondToken = ["ghp", "b".repeat(36)].join("_");
    writePlanFixture(planPath, completeMilestoneBody(), `M01-${firstToken}.md`);
    writePlanFixture(
      planPath,
      completeMilestoneBody(),
      `M01-${secondToken}.md`,
    );

    try {
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputPath,
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /same export filename.*redaction/iu);
      assert.equal(existsSync(outputPath), false);
      assert.doesNotMatch(result.stderr, new RegExp(firstToken, "u"));
      assert.doesNotMatch(result.stderr, new RegExp(secondToken, "u"));
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: keep a directory-shaped JSON destination on the user-facing usage path.
   * Process/filesystem side effects: spawns the CLI and creates only temporary directories.
   */
  it("rejects a JSON output directory even with force", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-json-directory-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const outputPath = join(temporaryRoot, "exports");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(outputPath, { recursive: true });

    try {
      const result = runPlansExport(
        planPath,
        "--format",
        "json",
        "--output",
        outputPath,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /JSON --output must be a file/iu);
      assert.doesNotMatch(result.stderr, /EISDIR/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("refuses JSON export through a symlinked parent directory", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const outputParent = join(temporaryRoot, "out");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(redirectedDirectory, { recursive: true });

    try {
      if (!symlinkOrSkip(testContext, redirectedDirectory, outputParent)) {
        return;
      }
      const result = runPlansExport(
        planPath,
        "--format",
        "json",
        "--output",
        join(outputParent, "bundle.json"),
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /real directory or absent/u);
      assert.equal(existsSync(join(redirectedDirectory, "bundle.json")), false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("refuses JSON export through a symlinked intermediate ancestor", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const linkedAncestor = join(temporaryRoot, "linked-ancestor");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(join(redirectedDirectory, "nested"), { recursive: true });

    try {
      if (!symlinkOrSkip(testContext, redirectedDirectory, linkedAncestor)) {
        return;
      }
      const result = runPlansExport(
        planPath,
        "--format",
        "json",
        "--output",
        join(linkedAncestor, "nested", "bundle.json"),
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /real directory or absent/u);
      assert.equal(
        existsSync(join(redirectedDirectory, "nested", "bundle.json")),
        false,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("refuses a hardlinked JSON destination even with force", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const outputPath = join(temporaryRoot, "bundle.json");
    const victimPath = join(temporaryRoot, "victim.txt");
    writePlanFixture(planPath, completeMilestoneBody());
    writeFileSync(victimPath, "keep\n", "utf-8");

    try {
      if (!hardlinkOrSkip(testContext, victimPath, outputPath)) return;
      const result = runPlansExport(
        planPath,
        "--format",
        "json",
        "--output",
        outputPath,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /single-link regular file or absent/u);
      assert.equal(readFileSync(victimPath, "utf-8"), "keep\n");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // A directory shadowing one generated filename must fail before ANY milestone
  // is written; a forced regeneration must never leave a partial bundle.
  it("fails atomically when a forced Markdown destination is a directory", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const outputDirectory = join(temporaryRoot, "out");
    writePlanFixture(planPath, completeMilestoneBody());
    writePlanFixture(planPath, completeMilestoneBody(), "M43-second.md");
    mkdirSync(join(outputDirectory, "M43-second.md"), { recursive: true });

    try {
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputDirectory,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /regular file or absent/u);
      assert.doesNotMatch(result.stderr, /EISDIR/u);
      assert.ok(
        !existsSync(join(outputDirectory, "M42-portable-plan.md")),
        "no partial bundle may be written before the collision fails",
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // A symlinked generated filename must never be followed to an outside file,
  // even when the user authorized replacement with --force.
  it("refuses symlinked Markdown destinations even with force", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const outputDirectory = join(temporaryRoot, "out");
    const victimPath = join(temporaryRoot, "victim.txt");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(victimPath, "keep\n", "utf-8");

    try {
      if (
        !symlinkOrSkip(
          testContext,
          victimPath,
          join(outputDirectory, "M42-portable-plan.md"),
        )
      ) {
        return;
      }
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputDirectory,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /regular file or absent/u);
      assert.equal(
        readFileSync(victimPath, "utf-8"),
        "keep\n",
        "the symlink target must remain untouched",
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("refuses a symlinked Markdown output directory", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const outputDirectory = join(temporaryRoot, "out");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(redirectedDirectory, { recursive: true });

    try {
      if (!symlinkOrSkip(testContext, redirectedDirectory, outputDirectory)) {
        return;
      }
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputDirectory,
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /real directory or absent/u);
      assert.equal(
        existsSync(join(redirectedDirectory, "M42-portable-plan.md")),
        false,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("refuses Markdown export through a symlinked intermediate ancestor", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const linkedAncestor = join(temporaryRoot, "linked-ancestor");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(join(redirectedDirectory, "nested"), { recursive: true });

    try {
      if (!symlinkOrSkip(testContext, redirectedDirectory, linkedAncestor)) {
        return;
      }
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        join(linkedAncestor, "nested", "exports"),
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /real directory or absent/u);
      assert.equal(
        existsSync(
          join(
            redirectedDirectory,
            "nested",
            "exports",
            "M42-portable-plan.md",
          ),
        ),
        false,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
