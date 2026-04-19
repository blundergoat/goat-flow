/**
 * Unit tests for M05 content-quality detection.
 *
 * Fixes pinned:
 *  - cclint ContentOrganizationRule.ts:163-166 bug: fence-line skip without
 *    state tracking — goat-flow must track `inCodeBlock`.
 *  - cclint ContentAppropriatenessRule.ts:110-125 bug: no code-block guard
 *    at all — goat-flow applies the same `inCodeBlock` state.
 *  - `note` dropped from cclint's non-actionable term list (too-high FP
 *    rate on goat-flow's docs: label usage and direct-object verbs).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanContentQuality } from "../../src/cli/audit/check-content-quality.js";

describe("scanContentQuality: vague terms", () => {
  it("flags 'properly' as INFO", () => {
    const findings = scanContentQuality("x.md", "Handle errors properly.");
    const vague = findings.find((f) => f.rule === "vague-term");
    assert.ok(vague, "expected vague-term finding");
    assert.equal(vague!.severity, "info");
    assert.match(vague!.message, /properly/);
    assert.ok(vague!.suggestion, "should include suggestion");
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
    assert.match(vague!.suggestion!, /Prettier|style guide|indentation/i);
  });
});

describe("scanContentQuality: generic instructions", () => {
  it("flags 'follow best practices' as WARNING", () => {
    const findings = scanContentQuality("x.md", "Follow best practices.");
    const generic = findings.find((f) => f.rule === "generic-best-practices");
    assert.ok(generic, "expected generic-best-practices finding");
    assert.equal(generic!.severity, "warning");
  });

  it("flags 'be careful' as WARNING", () => {
    const findings = scanContentQuality("x.md", "Be careful with paths.");
    const generic = findings.find((f) => f.rule === "generic-be-careful");
    assert.ok(generic);
    assert.equal(generic!.severity, "warning");
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
    const na = findings.find((f) => f.rule === "non-actionable-remember");
    assert.ok(na, "expected non-actionable-remember finding");
    assert.equal(na!.severity, "info");
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

  it("flags 'it's important' without 'to <verb>'", () => {
    const findings = scanContentQuality(
      "x.md",
      "It's important that readers pay attention.",
    );
    const na = findings.find((f) => f.rule === "non-actionable-important");
    assert.ok(na);
  });
});

describe("scanContentQuality: code-block state tracking", () => {
  it("resumes matching after a closed code block", () => {
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
    assert.equal(warnings[0]!.line, 5);
  });

  it("handles nested pseudo-fences correctly (single toggle per fence line)", () => {
    const text = ["```", "properly", "```", "properly"].join("\n");
    const findings = scanContentQuality("x.md", text);
    assert.equal(findings.length, 1, "one finding outside the block");
    assert.equal(findings[0]!.line, 4);
  });
});

describe("scanContentQuality: restricted mode (learning-loop surfaces)", () => {
  it("skips vague-term checks in restricted mode", () => {
    const text =
      "The test was handling it correctly before the regression landed.";
    const findings = scanContentQuality(
      ".goat-flow/footguns/x.md",
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
      ".goat-flow/lessons/x.md",
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
      ".goat-flow/footguns/x.md",
      "Remember: the repo uses strict mode.",
      "restricted",
    );
    assert.ok(
      findings.some((f) => f.rule === "non-actionable-remember"),
      "non-actionable patterns should still apply in restricted mode",
    );
  });
});
