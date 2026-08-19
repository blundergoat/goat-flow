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
import { STANDALONE_PLAYBOOK_FILES } from "../../src/cli/audit/skill-docs-contract.js";
import { evaluateSearchAnchors } from "../../src/cli/facts/shared/search-anchors.js";
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

  it("does not close a backtick fence when a tilde fence appears inside it", () => {
    const expectedOutsideBlockLine = 5;
    const text = [
      "```markdown",
      "~~~",
      "follow best practices",
      "```",
      "Follow best practices here.",
    ].join("\n");
    const findings = scanContentQuality("x.md", text).filter(
      (finding) => finding.severity === "warning",
    );

    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.line, expectedOutsideBlockLine);
  });

  it("does not close a long fence with a shorter matching delimiter", () => {
    const text = ["````markdown", "```", "follow best practices", "````"].join(
      "\n",
    );

    const findings = scanContentQuality("x.md", text);

    assert.equal(
      findings.length,
      0,
      "a shorter backtick run remains content inside the longer fence",
    );
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

describe("scanContentQuality: unresolved readiness markers", () => {
  it("flags unresolved markers inside an explicit open-questions section", () => {
    const findings = scanContentQuality(
      "docs/proposal.md",
      [
        "## Open Questions",
        "- TBD",
        "- TODO: choose the persistence model",
        "- ???",
        "- Answer:",
      ].join("\n"),
    ).filter((finding) => finding.rule === "unresolved-content-marker");

    // One finding per placeholder the author left behind: TBD, the to-do line, ???, and the
    // bare "Answer:" with nothing after it.
    const placeholdersLeftInFixture = 4;

    assert.equal(findings.length, placeholdersLeftInFixture);
    assert.ok(
      findings.every((finding) => finding.severity === "warning"),
      "every unresolved readiness marker must block a green content result",
    );
  });

  it("does not treat ordinary TODO prose, fenced examples, or answered questions as unresolved readiness", () => {
    const findings = scanContentQuality(
      "docs/proposal.md",
      [
        "TODO is valid historical prose outside a readiness section.",
        "## Open Questions",
        "- Answer: Use the existing filesystem adapter.",
        "```markdown",
        "- TBD",
        "- Answer:",
        "```",
        "## Decision",
        "The remaining TODO belongs to implementation tracking.",
      ].join("\n"),
    );

    assert.equal(
      findings.filter((finding) => finding.rule === "unresolved-content-marker")
        .length,
      0,
    );
  });

  it("recognizes a setext open-questions heading", () => {
    const findings = scanContentQuality(
      "docs/proposal.md",
      ["Open Questions", "--------------", "- TODO: choose storage"].join("\n"),
    );

    assert.equal(
      findings.filter((finding) => finding.rule === "unresolved-content-marker")
        .length,
      1,
    );
  });

  it("recognizes an indented open-questions heading the way CommonMark renders it", () => {
    // Up to three leading spaces still form an ATX heading in CommonMark, so
    // an indented readiness section must be scanned, not silently skipped.
    const findings = scanContentQuality(
      "docs/proposal.md",
      ["  ## Open Questions", "- TODO: choose storage"].join("\n"),
    );

    assert.equal(
      findings.filter((finding) => finding.rule === "unresolved-content-marker")
        .length,
      1,
    );
  });

  it("closes readiness before scanning a setext heading title", () => {
    const findings = scanContentQuality(
      "docs/proposal.md",
      ["## Open Questions", "Resolved TODO", "-------------", "All done"].join(
        "\n",
      ),
    );

    assert.equal(
      findings.filter((finding) => finding.rule === "unresolved-content-marker")
        .length,
      0,
    );
  });

  it("ignores readiness headings hidden inside HTML comments", () => {
    const findings = scanContentQuality(
      "docs/proposal.md",
      ["<!--", "## Open Questions", "-->", "- TODO: ordinary task"].join("\n"),
    );

    assert.equal(
      findings.filter((finding) => finding.rule === "unresolved-content-marker")
        .length,
      0,
    );
  });

  it("keeps content visible after an invalid backtick fence opener", () => {
    const findings = scanContentQuality(
      "docs/proposal.md",
      [
        "```markdown`invalid",
        "## Open Questions",
        "- TODO: choose storage",
      ].join("\n"),
    );

    assert.equal(
      findings.filter((finding) => finding.rule === "unresolved-content-marker")
        .length,
      1,
    );
  });

  it("ignores readiness markers that appear only inside inline code", () => {
    const findings = scanContentQuality(
      "docs/proposal.md",
      [
        "## Open Questions",
        "- Answer: Does the literal `TODO` token remain supported? Yes.",
        "- Answer: Does the literal `???` token remain supported? Yes.",
      ].join("\n"),
    );

    assert.equal(
      findings.filter((finding) => finding.rule === "unresolved-content-marker")
        .length,
      0,
    );
  });

  it("still flags a visible readiness marker after inline code", () => {
    const findings = scanContentQuality(
      "docs/proposal.md",
      [
        "## Open Questions",
        "- Answer: The literal `TODO` token is supported. TODO: decide removal timing.",
      ].join("\n"),
    );

    assert.equal(
      findings.filter((finding) => finding.rule === "unresolved-content-marker")
        .length,
      1,
    );
  });

  it("flags an empty Answer label when the colon is inside strong emphasis", () => {
    const findings = scanContentQuality(
      "docs/proposal.md",
      ["## Open Questions", "- **Answer:**"].join("\n"),
    );

    assert.ok(
      findings.some((finding) => finding.rule === "unresolved-content-marker"),
    );
  });
});

describe("semantic anchor path boundaries", () => {
  it("does not inspect absolute or parent-traversal citation paths", () => {
    const inspectedPaths: string[] = [];
    const fs = stubFS({
      exists: (path) => {
        inspectedPaths.push(path);
        return true;
      },
      readFile: (path) => {
        inspectedPaths.push(path);
        return "needle";
      },
    });

    const evaluations = evaluateSearchAnchors(
      fs,
      [
        "`../../outside.txt` (search: `needle`)",
        "`/tmp/outside.txt` (search: `needle`)",
        "`..\\\\outside.txt` (search: `needle`)",
        "`C:\\\\outside.txt` (search: `needle`)",
      ].join("\n"),
    );

    assert.deepEqual(evaluations, []);
    assert.deepEqual(inspectedPaths, []);
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
  const PROMPT_WRAPPER_RESIDUE_TAG_COUNT = 4;

  it("flags content/invoke wrapper tags as WARNING", () => {
    const findings = scanContentQuality(
      ".goat-flow/learning-loop/decisions/INDEX.md",
      '# Decisions Index\n\n<content>\n</content>\n<invoke name="x">\n</invoke>',
    );

    const residue = findings.filter(
      (finding) => finding.rule === "prompt-wrapper-residue",
    );
    assert.equal(residue.length, PROMPT_WRAPPER_RESIDUE_TAG_COUNT);
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

describe("scanContentQuality: stale skill-playbooks path", () => {
  it("flags legacy installed playbook paths in active prose", () => {
    const findings = scanContentQuality(
      "AGENTS.md",
      "Read .goat-flow/skill-playbooks/browser-use.md before browser work.",
    );

    const stale = findings.find(
      (finding) => finding.rule === "stale-skill-playbooks-path",
    );
    assertExists(stale, "expected stale skill-playbooks path finding");
    assert.equal(stale.severity, "warning");
  });

  it("allows current installed and workflow template playbook paths", () => {
    const findings = scanContentQuality(
      "AGENTS.md",
      [
        "Read .goat-flow/skill-docs/playbooks/browser-use.md.",
        "Mirror workflow templates under workflow/skills/playbooks/browser-use.md.",
      ].join("\n"),
    );

    assert.equal(
      findings.filter(
        (finding) => finding.rule === "stale-skill-playbooks-path",
      ).length,
      0,
    );
  });

  it("allows historical legacy path references in learning-loop records", () => {
    // A historical record naming a removed path is legitimate, so the scanner must not report it as a stale reference.
    const assertHistoricalPathAllowed = (path: string): void => {
      const findings = scanContentQuality(
        path,
        "Historical record: .goat-flow/skill-playbooks/browser-use.md",
      );

      assert.equal(
        findings.filter(
          (finding) => finding.rule === "stale-skill-playbooks-path",
        ).length,
        0,
        `${path} should preserve historical stale-path evidence`,
      );
    };

    assertHistoricalPathAllowed(
      ".goat-flow/learning-loop/decisions/ADR-023-reference-pack-budget-tiers.md",
    );
    assertHistoricalPathAllowed(
      ".goat-flow/learning-loop/footguns/docs-and-crossrefs.md",
    );
    assertHistoricalPathAllowed(".goat-flow/learning-loop/lessons/setup.md");
    assertHistoricalPathAllowed(
      ".goat-flow/learning-loop/patterns/workflow.md",
    );
  });
});

describe("runContentQualityChecks: target discovery", () => {
  it("fails stale semantic anchors in current guidance and accepted ADRs", () => {
    const glossaryPath = ".goat-flow/glossary.md";
    const targetPath = "src/cli/current.ts";
    const decisionsDir = ".goat-flow/learning-loop/decisions/";
    const decisionPath = `${decisionsDir}ADR-001-history.md`;
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) =>
          [glossaryPath, targetPath, decisionsDir, decisionPath].includes(path),
        listDir: (path) =>
          path === decisionsDir ? ["ADR-001-history.md"] : [],
        readFile: (path) => {
          if (path === glossaryPath) {
            return `Current pointer: \`${targetPath}\` (search: \`retiredSymbol\`).`;
          }
          if (path === decisionPath) {
            return `Historical evidence: \`${targetPath}\` (search: \`retiredHistoricalSymbol\`).`;
          }
          if (path === targetPath)
            return "export const currentSymbol = true;\n";
          return null;
        },
      }),
    });

    const result = runContentQualityChecks(ctx);
    const staleAnchors = result.findings.filter(
      (finding) => finding.rule === "stale-semantic-anchor",
    );

    assert.equal(staleAnchors.length, 2);
    assert.deepEqual(
      staleAnchors.map((finding) => finding.path).sort(),
      [decisionPath, glossaryPath].sort(),
    );
    assert.ok(
      staleAnchors.some((finding) =>
        /retiredHistoricalSymbol/u.test(finding.message),
      ),
    );
  });

  it("validates every chained search needle against the preceding target file", () => {
    const glossaryPath = ".goat-flow/glossary.md";
    const targetPath = "src/cli/current.ts";
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) => [glossaryPath, targetPath].includes(path),
        readFile: (path) => {
          if (path === glossaryPath) {
            return `Current pointers: \`${targetPath}\` (search: \`currentSymbol\`), (search: \`retiredSibling\`).`;
          }
          if (path === targetPath)
            return "export const currentSymbol = true;\n";
          return null;
        },
      }),
    });

    const staleAnchors = runContentQualityChecks(ctx).findings.filter(
      (finding) => finding.rule === "stale-semantic-anchor",
    );

    assert.equal(staleAnchors.length, 1);
    assert.match(staleAnchors[0]?.message ?? "", /retiredSibling/u);
  });

  it("validates a direct search citation split across adjacent lines", () => {
    const glossaryPath = ".goat-flow/glossary.md";
    const targetPath = "src/cli/current.ts";
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) => [glossaryPath, targetPath].includes(path),
        readFile: (path) => {
          if (path === glossaryPath) {
            return [
              `Current pointer: \`${targetPath}\``,
              "(search: `retiredMultilineSymbol`).",
            ].join("\n");
          }
          if (path === targetPath)
            return "export const currentSymbol = true;\n";
          return null;
        },
      }),
    });

    const staleAnchors = runContentQualityChecks(ctx).findings.filter(
      (finding) => finding.rule === "stale-semantic-anchor",
    );

    assert.equal(staleAnchors.length, 1);
    assert.match(staleAnchors[0]?.message ?? "", /retiredMultilineSymbol/u);
  });

  it("resolves skill-local semantic-anchor targets from the citing file", () => {
    const skillPath = ".agents/skills/goat-review/SKILL.md";
    const targetPath = ".agents/skills/goat-review/references/examples.md";
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) => [skillPath, targetPath].includes(path),
        readFile: (path) => {
          if (path === skillPath) {
            return "Read `references/examples.md` (search: `retiredSkillAnchor`).";
          }
          if (path === targetPath) return "# Examples\n\n## Current Anchor\n";
          return null;
        },
      }),
    });

    const staleAnchors = runContentQualityChecks(ctx).findings.filter(
      (finding) => finding.rule === "stale-semantic-anchor",
    );

    assert.equal(staleAnchors.length, 1);
    assert.equal(staleAnchors[0]?.path, skillPath);
    assert.match(staleAnchors[0]?.message ?? "", new RegExp(targetPath));
  });

  it("runs readiness and semantic checks across discovered Markdown", () => {
    const publicDoc = "docs/harness-audit.md";
    const localPlan = ".goat-flow/plans/_done/review/README.md";
    const customLogReadme = ".goat-flow/logs/custom/README.md";
    const privateToolDoc = ".tools/report.md";
    const antigravitySessionDoc = ".antigravitycli/session/report.md";
    const targetPath = "src/cli/current.ts";
    const localArtifacts = [
      localPlan,
      customLogReadme,
      privateToolDoc,
      antigravitySessionDoc,
    ];
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) =>
          [publicDoc, ...localArtifacts, targetPath].includes(path),
        glob: (pattern) =>
          pattern === "**/*.md" ? [publicDoc, ...localArtifacts] : [],
        readFile: (path) => {
          if (path === publicDoc) {
            return [
              "## Open Questions",
              "- **Answer:**",
              `Evidence: \`${targetPath}\` (search: \`retiredPublicAnchor\`).`,
            ].join("\n");
          }
          if (localArtifacts.includes(path)) {
            return `\`${targetPath}\` (search: \`ignoredLocalAnchor\`)`;
          }
          if (path === targetPath)
            return "export const currentSymbol = true;\n";
          return null;
        },
      }),
    });

    const findings = runContentQualityChecks(ctx).findings;

    assert.ok(
      findings.some((finding) => finding.rule === "unresolved-content-marker"),
    );
    assert.ok(
      findings.some((finding) => finding.rule === "stale-semantic-anchor"),
    );
    assert.ok(
      findings.every((finding) => !localArtifacts.includes(finding.path)),
    );
  });

  it("does not guess a target for an unqualified search anchor in a new sentence", () => {
    const glossaryPath = ".goat-flow/glossary.md";
    const targetPath = "src/cli/current.ts";
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) => [glossaryPath, targetPath].includes(path),
        readFile: (path) => {
          if (path === glossaryPath) {
            return `Current pointer: \`${targetPath}\` (search: \`currentSymbol\`). Self-test (search: \`separateTargetNeedle\`).`;
          }
          if (path === targetPath)
            return "export const currentSymbol = true;\n";
          return null;
        },
      }),
    });

    const staleAnchors = runContentQualityChecks(ctx).findings.filter(
      (finding) => finding.rule === "stale-semantic-anchor",
    );

    assert.equal(staleAnchors.length, 0);
  });

  it("validates root dotfile search anchors", () => {
    const glossaryPath = ".goat-flow/glossary.md";
    const targetPath = ".gitignore";
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) => [glossaryPath, targetPath].includes(path),
        readFile: (path) => {
          if (path === glossaryPath) {
            return `Ignore policy: \`${targetPath}\` (search: \`missingIgnoreRule\`).`;
          }
          if (path === targetPath) return "_temp\nnode_modules\n";
          return null;
        },
      }),
    });

    const staleAnchors = runContentQualityChecks(ctx).findings.filter(
      (finding) => finding.rule === "stale-semantic-anchor",
    );

    assert.equal(staleAnchors.length, 1);
    assert.match(staleAnchors[0]?.message ?? "", /missingIgnoreRule/u);
  });

  it("ignores semantic-anchor examples inside fenced code blocks", () => {
    const glossaryPath = ".goat-flow/glossary.md";
    const targetPath = "src/cli/current.ts";
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) => [glossaryPath, targetPath].includes(path),
        readFile: (path) => {
          if (path === glossaryPath) {
            return [
              "```markdown",
              `\`${targetPath}\` (search: \`exampleOnlyNeedle\`)`,
              "```",
            ].join("\n");
          }
          if (path === targetPath)
            return "export const currentSymbol = true;\n";
          return null;
        },
      }),
    });

    const result = runContentQualityChecks(ctx);
    assert.equal(
      result.findings.filter(
        (finding) => finding.rule === "stale-semantic-anchor",
      ).length,
      0,
    );
  });

  it("scans every registered standalone playbook", () => {
    const registeredPlaybooks = new Set<string>(STANDALONE_PLAYBOOK_FILES);
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) => registeredPlaybooks.has(path),
        readFile: (path) =>
          registeredPlaybooks.has(path) ? "Follow best practices." : null,
      }),
    });

    const result = runContentQualityChecks(ctx);
    const scannedPlaybooks = new Set(
      result.findings
        .filter((finding) => finding.rule === "generic-best-practices")
        .map((finding) => finding.path),
    );

    assert.equal(result.filesScanned, STANDALONE_PLAYBOOK_FILES.length);
    assert.deepStrictEqual(scannedPlaybooks, registeredPlaybooks);
  });

  it("flags stale skill-playbooks paths in active instruction surfaces", () => {
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) => path === "AGENTS.md",
        readFile: (path) =>
          path === "AGENTS.md"
            ? "Read .goat-flow/skill-playbooks/browser-use.md."
            : null,
      }),
    });

    const result = runContentQualityChecks(ctx);

    assert.ok(
      result.findings.some(
        (finding) =>
          finding.path === "AGENTS.md" &&
          finding.rule === "stale-skill-playbooks-path",
      ),
      "active instruction files must not point at the retired installed playbook path",
    );
  });

  it("does not scan migration-only script paths as active prose", () => {
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) => path === "workflow/install-goat-flow.sh",
        readFile: (path) =>
          path === "workflow/install-goat-flow.sh"
            ? 'migrate_dir_no_overwrite ".goat-flow/skill-playbooks" ".goat-flow/skill-docs/playbooks"'
            : null,
      }),
    });

    const result = runContentQualityChecks(ctx);

    assert.equal(result.filesScanned, 0);
    assert.equal(result.findings.length, 0);
  });

  it("does not flag stale paths in current ADR history", () => {
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) =>
          path === ".goat-flow/learning-loop/decisions/" ||
          path ===
            ".goat-flow/learning-loop/decisions/ADR-023-reference-pack-budget-tiers.md",
        listDir: (path) =>
          path === ".goat-flow/learning-loop/decisions/"
            ? ["ADR-023-reference-pack-budget-tiers.md"]
            : [],
        readFile: (path) =>
          path ===
          ".goat-flow/learning-loop/decisions/ADR-023-reference-pack-budget-tiers.md"
            ? "Historical split: .goat-flow/skill-playbooks/browser-use.md."
            : null,
      }),
    });

    const result = runContentQualityChecks(ctx);

    assert.equal(
      result.findings.filter(
        (finding) => finding.rule === "stale-skill-playbooks-path",
      ).length,
      0,
    );
  });

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
