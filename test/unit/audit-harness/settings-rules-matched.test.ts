/**
 * Regression tests for truthful reporting of inert Claude permission-rule forms.
 * The check must preserve the rule as visible evidence without turning optional
 * cleanup into a scope failure or an automatic rewrite instruction.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HARNESS_CHECKS } from "../../src.js";
import { makeCtx, stubAgentFacts } from "../../fixtures/projects/index.js";

const CLAUDE_PERMISSIONS_URL = "https://code.claude.com/docs/en/permissions";
const settingsRulesMatched = HARNESS_CHECKS.find(
  (check) => check.id === "settings-rules-matched",
);

/** Run the check against one otherwise healthy Claude agent with a stale Write rule. */
function runWriteOnlyCheck() {
  assert.ok(settingsRulesMatched, "settings-rules-matched check must exist");
  return settingsRulesMatched.run(
    makeCtx({
      agents: [
        stubAgentFacts({
          settings: {
            exists: true,
            valid: true,
            parsed: {
              permissions: { deny: ["Write(**/.env)"] },
            },
            hasDenyPatterns: true,
          },
        }),
      ],
    }),
  );
}

describe("settings-rules-matched harness check", () => {
  it("cites the current Claude Code permissions documentation", () => {
    assert.ok(settingsRulesMatched, "settings-rules-matched check must exist");

    assert.equal(settingsRulesMatched.provenance.source_type, "vendor_docs");
    assert.deepEqual(settingsRulesMatched.provenance.source_urls, [
      CLAUDE_PERMISSIONS_URL,
    ]);
    assert.equal(settingsRulesMatched.provenance.verified_on, "2026-08-16");
  });

  it("uses only evidence paths shipped to package consumers", () => {
    assert.ok(settingsRulesMatched, "settings-rules-matched check must exist");

    assert.deepEqual(settingsRulesMatched.provenance.evidence_paths, [
      "docs/harness-audit.md",
      "docs/audit-checks.md",
    ]);
    assert.ok(
      !settingsRulesMatched.provenance.evidence_paths?.includes(
        ".goat-flow/learning-loop/footguns/agent-settings.md",
      ),
    );
  });

  it("qualifies passing evidence to the managed settings file", () => {
    assert.ok(settingsRulesMatched, "settings-rules-matched check must exist");
    const result = settingsRulesMatched.run(
      makeCtx({ agents: [stubAgentFacts()] }),
    );

    assert.deepEqual(result.findings, [
      "claude: managed .claude/settings.json permission rules use matched forms",
    ]);
    assert.doesNotMatch(result.findings.join("\n"), /all permission rules/u);
  });

  it("names the stale rule form actually found", () => {
    const result = runWriteOnlyCheck();
    const message = result.recommendations.join("\n");

    assert.match(message, /Write/u);
  });

  it("does not name absent stale rule forms", () => {
    const result = runWriteOnlyCheck();
    const message = result.recommendations.join("\n");

    assert.doesNotMatch(message, /MultiEdit|NotebookEdit|Glob/u);
  });

  it("emits machine-readable stale-rule details", () => {
    const result = runWriteOnlyCheck();

    assert.deepEqual(result.details?.denyMatrix?.[0]?.extraPatterns, [
      {
        array: "deny",
        rule: "Write(**/.env)",
        tool: "Write",
        reason: "unmatched rule form - Edit(path) covers file edits",
        display:
          "deny: Write(**/.env) (unmatched rule form - Edit(path) covers file edits)",
      },
    ]);
  });

  it("offers deliberate review instead of an automatic rewrite", () => {
    const result = runWriteOnlyCheck();
    const howToFix = result.howToFix?.join("\n") ?? "";

    assert.match(howToFix, /MAY remain as defense-in-depth markers/u);
    assert.match(howToFix, /removed deliberately/u);
    assert.doesNotMatch(howToFix, /Re-run goat-flow setup/u);
    assert.doesNotMatch(howToFix, /rewrite Write\/NotebookEdit\/Glob rules/u);
  });
});
