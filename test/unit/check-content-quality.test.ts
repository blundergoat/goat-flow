/**
 * Unit tests for content-quality detection.
 *
 * Fixes pinned:
 *  - cclint ContentOrganizationRule.ts:163-166 bug: fence-line skip without
 *    state tracking - goat-flow must track `inCodeBlock`.
 *  - cclint ContentAppropriatenessRule.ts:110-125 bug: no code-block guard
 *    at all - goat-flow applies the same `inCodeBlock` state.
 *  - `note` dropped from cclint's non-actionable term list (too-high FP
 *    rate on goat-flow's docs: label usage and direct-object verbs).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runContentQualityChecks,
  scanContentQuality,
} from "../../src/cli/audit/check-content-quality.js";
import { makeCtx, stubFS } from "../fixtures/projects/index.js";
import { assertExists } from "../helpers/assert-exists.ts";

describe("scanContentQuality: vague terms", () => {
  it("flags 'properly' as INFO", () => {
    const findings = scanContentQuality("x.md", "Handle errors properly.");
    const vague = findings.find((f) => f.rule === "vague-term");
    assertExists(vague, "expected vague-term finding");
    assert.equal(vague.severity, "info");
    assert.match(vague.message, /properly/);
    assert.ok(vague.suggestion, "should include suggestion");
  });

  it("does not flag 'properly' inside a fenced code block", () => {
    const text = [
      "Some prose.",
      "```",
      "Handle errors properly.",
      "```",
      "More prose.",
    ].join("\n");
    const findings = scanContentQuality("x.md", text);
    assert.equal(
      findings.length,
      0,
      `expected no findings inside code block, got: ${JSON.stringify(findings)}`,
    );
  });

  it("context-aware suggestion for format/style", () => {
    const findings = scanContentQuality("x.md", "Format the file properly.");
    const vague = findings.find((f) => f.rule === "vague-term");
    assertExists(vague, "expected vague-term finding");
    assertExists(
      vague.suggestion,
      "vague-term finding should carry a suggestion",
    );
    assert.match(vague.suggestion, /Prettier|style guide|indentation/i);
  });
});

describe("scanContentQuality: generic instructions", () => {
  it("flags 'follow best practices' as WARNING", () => {
    const findings = scanContentQuality("x.md", "Follow best practices.");
    const generic = findings.find((f) => f.rule === "generic-best-practices");
    assertExists(generic, "expected generic-best-practices finding");
    assert.equal(generic.severity, "warning");
  });

  it("flags 'be careful' as WARNING", () => {
    const findings = scanContentQuality("x.md", "Be careful with paths.");
    const generic = findings.find((f) => f.rule === "generic-be-careful");
    assertExists(generic, "expected generic-be-careful finding");
    assert.equal(generic.severity, "warning");
  });

  it("does not flag generic patterns inside a code block", () => {
    const text = [
      "Real prose.",
      "```bash",
      "# Follow best practices",
      "echo 'be careful'",
      "```",
      "End.",
    ].join("\n");
    const findings = scanContentQuality("x.md", text);
    assert.equal(findings.length, 0);
  });
});

describe("scanContentQuality: non-actionable patterns", () => {
  it("flags bare 'remember' as INFO", () => {
    const findings = scanContentQuality(
      "x.md",
      "Remember: paths are absolute.",
    );
    const nonActionableFinding = findings.find(
      (finding) => finding.rule === "non-actionable-remember",
    );
    assertExists(
      nonActionableFinding,
      "expected non-actionable-remember finding",
    );
    assert.equal(nonActionableFinding.severity, "info");
  });

  it("does not flag 'remember to run tests' (has 'to <verb>')", () => {
    const findings = scanContentQuality(
      "x.md",
      "Remember to run tests before pushing.",
    );
    assert.equal(
      findings.filter((f) => f.rule === "non-actionable-remember").length,
      0,
    );
  });

  it("does not flag 'Note:' label usage", () => {
    const findings = scanContentQuality(
      "x.md",
      "Note: this is a warning aside.",
    );
    assert.equal(
      findings.filter((f) => f.rule === "non-actionable-remember").length,
      0,
    );
  });

  it("does not flag 'note them' direct-object verb", () => {
    const findings = scanContentQuality(
      "x.md",
      "Find the failures and note them.",
    );
    assert.equal(
      findings.filter((f) => f.rule === "non-actionable-remember").length,
      0,
    );
  });

  it("does not flag 'remember' in a Markdown table header row", () => {
    const text = [
      "| Tool | Rule | Mechanic to remember |",
      "|---|---|---|",
      "| gruff-ts | rule-x | filter on field y, not z |",
    ].join("\n");
    const findings = scanContentQuality("x.md", text);
    assert.equal(
      findings.filter((f) => f.rule === "non-actionable-remember").length,
      0,
      "table header cells are column labels, not instructional prose",
    );
  });

  it("still flags 'remember' in a table data row", () => {
    const text = [
      "| Col1 | Col2 |",
      "|---|---|",
      "| foo | remember the answer |",
    ].join("\n");
    const findings = scanContentQuality("x.md", text);
    assert.equal(
      findings.filter((f) => f.rule === "non-actionable-remember").length,
      1,
      "data-row prose is in scope; only the header row is skipped",
    );
  });

  it("flags 'it's important' without 'to <verb>'", () => {
    const findings = scanContentQuality(
      "x.md",
      "It's important that readers pay attention.",
    );
    const nonActionableFinding = findings.find(
      (finding) => finding.rule === "non-actionable-important",
    );
    assert.ok(nonActionableFinding);
  });
});

describe("scanContentQuality: code-block state tracking", () => {
  it("resumes matching after a closed code block", () => {
    const expectedOutsideBlockLine = 5;
    const text = [
      "```",
      "follow best practices",
      "```",
      "",
      "Follow best practices here.",
    ].join("\n");
    const findings = scanContentQuality("x.md", text);
    const warnings = findings.filter((f) => f.severity === "warning");
    assert.equal(
      warnings.length,
      1,
      "only the outside-block occurrence should match",
    );
    assert.equal(warnings[0]!.line, expectedOutsideBlockLine);
  });

  it("handles nested pseudo-fences correctly (single toggle per fence line)", () => {
    const expectedOutsideBlockLine = 4;
    const text = ["```", "properly", "```", "properly"].join("\n");
    const findings = scanContentQuality("x.md", text);
    assert.equal(findings.length, 1, "one finding outside the block");
    assert.equal(findings[0]!.line, expectedOutsideBlockLine);
  });
});

describe("scanContentQuality: restricted mode (learning-loop surfaces)", () => {
  it("skips vague-term checks in restricted mode", () => {
    const text =
      "The test was handling it correctly before the regression landed.";
    const findings = scanContentQuality(
      ".goat-flow/learning-loop/footguns/x.md",
      text,
      "restricted",
    );
    assert.equal(
      findings.filter((f) => f.rule === "vague-term").length,
      0,
      "vague-term should be skipped on historical incident prose",
    );
  });

  it("still flags generic-instruction patterns in restricted mode", () => {
    const findings = scanContentQuality(
      ".goat-flow/learning-loop/lessons/x.md",
      "Follow best practices when recovering from this.",
      "restricted",
    );
    assert.ok(
      findings.some((f) => f.rule === "generic-best-practices"),
      "generic patterns should still apply in restricted mode",
    );
  });

  it("still flags non-actionable patterns in restricted mode", () => {
    const findings = scanContentQuality(
      ".goat-flow/learning-loop/footguns/x.md",
      "Remember: the repo uses strict mode.",
      "restricted",
    );
    assert.ok(
      findings.some((f) => f.rule === "non-actionable-remember"),
      "non-actionable patterns should still apply in restricted mode",
    );
  });
});

describe("scanContentQuality: legacy execution loop", () => {
  it("flags 'READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG' as WARNING", () => {
    const findings = scanContentQuality(
      "AGENTS.md",
      "## Default Execution Loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG",
    );
    const legacy = findings.find(
      (f) => f.rule === "legacy-execution-loop-classify",
    );
    assertExists(legacy, "expected legacy-execution-loop-classify finding");
    assert.equal(legacy.severity, "warning");
    assert.match(legacy.message, /v1\.2 loop is four steps/);
  });

  it("flags 'VERIFY → LOG' alone as WARNING even without CLASSIFY context", () => {
    const findings = scanContentQuality(
      "AGENTS.md",
      "Close the loop at VERIFY → LOG.",
    );
    const legacy = findings.find(
      (f) => f.rule === "legacy-execution-loop-trailing-log",
    );
    assertExists(legacy, "expected legacy-execution-loop-trailing-log finding");
    assert.equal(legacy.severity, "warning");
  });

  it("flags ASCII arrows 'READ -> CLASSIFY -> SCOPE'", () => {
    const findings = scanContentQuality(
      "AGENTS.md",
      "## Default Execution Loop: READ -> CLASSIFY -> SCOPE -> ACT -> VERIFY -> LOG",
    );
    assert.ok(
      findings.some((f) => f.rule === "legacy-execution-loop-classify"),
      "ASCII -> arrow variant should still trigger detection",
    );
  });

  it("does NOT flag the v1.2 four-step loop", () => {
    const findings = scanContentQuality(
      "CLAUDE.md",
      "## Execution Loop: READ → SCOPE → ACT → VERIFY",
    );
    assert.equal(
      findings.filter((f) => f.rule.startsWith("legacy-execution-loop")).length,
      0,
      "four-step loop must not trigger the legacy-loop detectors",
    );
  });

  it("does NOT flag historical prose mentioning CLASSIFY without arrow sequence", () => {
    const findings = scanContentQuality(
      ".goat-flow/learning-loop/lessons/execution-loop.md",
      "The pre-v1.2 loop included a CLASSIFY step that was absorbed into SCOPE.",
      "restricted",
    );
    assert.equal(
      findings.filter((f) => f.rule === "legacy-execution-loop-classify")
        .length,
      0,
      "prose-only mention of CLASSIFY without the arrow sequence must not fire",
    );
  });

  it("does not flag inside a fenced code block", () => {
    const text = [
      "Real prose.",
      "```",
      "READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG",
      "```",
      "End.",
    ].join("\n");
    const findings = scanContentQuality("AGENTS.md", text);
    assert.equal(
      findings.filter((f) => f.rule.startsWith("legacy-execution-loop")).length,
      0,
      "fenced-code-block guard must keep the detector silent",
    );
  });
});

describe("scanContentQuality: prompt wrapper residue", () => {
  it("flags content/invoke wrapper tags as WARNING", () => {
    const findings = scanContentQuality(
      ".goat-flow/learning-loop/decisions/INDEX.md",
      '# Decisions Index\n\n<content>\n</content>\n<invoke name="x">\n</invoke>',
    );

    const residue = findings.filter(
      (finding) => finding.rule === "prompt-wrapper-residue",
    );
    assert.equal(residue.length, 4);
    assert.equal(residue[0]!.severity, "warning");
  });

  it("does not flag wrapper tag examples inside fenced code blocks", () => {
    const findings = scanContentQuality(
      "docs/example.md",
      ["```", "</content>", "</invoke>", "```"].join("\n"),
    );

    assert.equal(
      findings.filter((finding) => finding.rule === "prompt-wrapper-residue")
        .length,
      0,
    );
  });
});

describe("runContentQualityChecks: target discovery", () => {
  it("discovers current ADR files instead of relying on a hard-coded ADR list", () => {
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) =>
          path === ".goat-flow/learning-loop/decisions/" ||
          path ===
            ".goat-flow/learning-loop/decisions/ADR-025-block-all-git-push.md",
        listDir: (path) =>
          path === ".goat-flow/learning-loop/decisions/"
            ? [
                "README.md",
                "ADR-023-reference-pack-budget-tiers.md",
                "ADR-024-semantic-anchors-over-line-numbers.md",
                "ADR-025-block-all-git-push.md",
              ]
            : [],
        readFile: (path) =>
          path ===
          ".goat-flow/learning-loop/decisions/ADR-025-block-all-git-push.md"
            ? "Follow best practices when blocking pushes."
            : null,
      }),
    });

    const result = runContentQualityChecks(ctx);

    assert.ok(
      result.findings.some(
        (finding) =>
          finding.path ===
            ".goat-flow/learning-loop/decisions/ADR-025-block-all-git-push.md" &&
          finding.rule === "generic-best-practices",
      ),
      "new ADR files must be scanned without updating a manual target list",
    );
  });

  it("scans the decisions INDEX so prompt wrapper residue cannot hide there", () => {
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) =>
          path === ".goat-flow/learning-loop/decisions/INDEX.md",
        readFile: (path) =>
          path === ".goat-flow/learning-loop/decisions/INDEX.md"
            ? "</content>"
            : null,
      }),
    });

    const result = runContentQualityChecks(ctx);

    assert.ok(
      result.findings.some(
        (finding) =>
          finding.path === ".goat-flow/learning-loop/decisions/INDEX.md" &&
          finding.rule === "prompt-wrapper-residue",
      ),
      "decision index metadata must stay inside content-quality coverage",
    );
  });
});
