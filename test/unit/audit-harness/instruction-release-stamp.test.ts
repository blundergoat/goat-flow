/**
 * Checks the warning for a goat-flow release number written into a consumer instruction file's heading.
 *
 * Four of five ports bumped that number by hand on every upgrade; install identity lives in `.goat-flow/config.yaml`, so the stamp only drifts.
 * The headings below are copied from those ports' instruction files.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HARNESS_CHECKS } from "../../src.js";
import {
  makeCtx,
  stubAgentFacts,
  stubFS,
} from "../../fixtures/projects/index.js";

const check = HARNESS_CHECKS.find(
  (candidate) => candidate.id === "instruction-release-stamp",
);

/**
 * Build an audit context for one Claude instruction file with the given heading.
 *
 * @param heading - first line of the instruction file
 * @param packageJson - target `package.json` text; null means the target has none
 * @returns audit context for the stamp check
 */
function ctxWithHeading(heading: string, packageJson: string | null = null) {
  return makeCtx({
    agents: [
      stubAgentFacts({
        instruction: {
          exists: true,
          content: `${heading}\n\nBody.\n`,
          lineCount: 3,
          sections: new Map(),
        },
      }),
    ],
    fs: stubFS({
      readFile: (path) => (path === "package.json" ? packageJson : null),
    }),
  });
}

describe("instruction-release-stamp harness check", () => {
  it("warns without failing the audit", () => {
    assert.ok(check, "instruction-release-stamp check must exist");
    assert.equal(check.concern, "context");
    // A stamp must lower the Context score without failing the audit, so a project's CI keeps passing.
    assert.equal(check.failureImpact, "score-only");
  });

  it("flags a heading that names a goat-flow release", () => {
    assert.ok(check);
    const result = check.run(ctxWithHeading("# gruff-rs - goat-flow 1.19.0"));
    assert.equal(result.status, "fail");
    assert.match(result.findings.join("\n"), /CLAUDE\.md/u);
    assert.match(result.findings.join("\n"), /goat-flow 1\.19\.0/u);
    const fix = (result.howToFix ?? []).join("\n");
    assert.match(fix, /\.goat-flow\/config\.yaml/u);
    assert.match(fix, /review/u);
  });

  // The heading comes from the audited project, so an escape or bidi character must not reach the auditor's terminal.
  it("removes control and bidirectional characters from the echoed heading", () => {
    assert.ok(check);
    const result = check.run(
      ctxWithHeading("# demo - goat-flow 1.19.0 \u001b[2K\u202e"),
    );
    assert.equal(result.status, "fail");
    const findings = result.findings.join("\n");
    assert.doesNotMatch(findings, /[\u001b\u202e]/u);
    assert.match(findings, /goat-flow 1\.19\.0 \[2K/u);
  });

  it("flags the framework header form copied into a consumer file", () => {
    assert.ok(check);
    const result = check.run(
      ctxWithHeading("# AGENTS.md - v1.13.1 (2026-07-13)"),
    );
    assert.equal(result.status, "fail");
  });

  it("keeps a project's own product version", () => {
    assert.ok(check);
    const result = check.run(
      ctxWithHeading("# gruff-go - Go code-quality scanner (v0.6.0)"),
    );
    assert.equal(result.status, "pass");
  });

  it("skips the goat-flow framework checkout, whose headers stay versioned", () => {
    assert.ok(check);
    const ctx = ctxWithHeading(
      "# CLAUDE.md - v1.19.0 (2026-11-22)",
      '{ "name": "@blundergoat/goat-flow" }',
    );
    assert.equal(check.skip?.(ctx), true);
  });
});
