/**
 * Regression tests for the two Claude settings gaps audit reports without changing anything: template deny rules a project lacks,
 * listed as notes on a passing check, and missing attribution values, which make the score-only settings-rules-matched check warn.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { HARNESS_CHECKS } from "../../src.js";
import { makeCtx, stubAgentFacts } from "../../fixtures/projects/index.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..", "..");

const template = JSON.parse(
  readFileSync(
    join(PROJECT_ROOT, "workflow/hooks/agent-config/claude.json"),
    "utf8",
  ),
) as {
  permissions: { deny: string[] };
  attribution: Record<string, unknown>;
};

/**
 * Run one harness check against a Claude agent whose settings are the shipped template after one change.
 *
 * @param id - harness check ID
 * @param edit - change applied to a copy of the template settings
 * @returns the check result
 */
function runWithSettings(
  id: string,
  edit: (settings: typeof template) => void,
) {
  const check = HARNESS_CHECKS.find((candidate) => candidate.id === id);
  assert.ok(check, `${id} check must exist`);
  const settings = structuredClone(template);
  edit(settings);
  const ctx = makeCtx({
    agents: [
      stubAgentFacts({
        settings: {
          exists: true,
          valid: true,
          parsed: settings,
          hasDenyPatterns: true,
        },
      }),
    ],
  });
  return check.run(ctx);
}

describe("Claude template deny rules a project lacks", () => {
  it("names each absent template rule on the deny check without changing its outcome", () => {
    const absent = template.permissions.deny.find((rule) =>
      rule.startsWith("Edit("),
    );
    assert.ok(absent, "the template must hold an Edit deny rule");
    const complete = runWithSettings("deny-covers-secrets", () => {});
    const missingOne = runWithSettings("deny-covers-secrets", (settings) => {
      settings.permissions.deny = settings.permissions.deny.filter(
        (rule) => rule !== absent,
      );
    });

    assert.equal(missingOne.status, complete.status);
    assert.ok(
      missingOne.findings.some(
        (finding) =>
          finding.includes(absent) &&
          finding.includes("install never adds rules"),
      ),
      missingOne.findings.join("\n"),
    );
    assert.equal(
      complete.findings.some((finding) =>
        finding.includes("install never adds rules"),
      ),
      false,
    );
  });
});

describe("Claude attribution values", () => {
  it("reports no attribution gap when all three values match the template", () => {
    const result = runWithSettings("settings-rules-matched", () => {});

    assert.equal(
      result.findings.some((finding) => finding.includes("attribution")),
      false,
      result.findings.join("\n"),
    );
  });

  it("warns once for each missing or different attribution value", () => {
    const result = runWithSettings("settings-rules-matched", (settings) => {
      delete settings.attribution.commit;
      settings.attribution.sessionUrl = true;
    });

    assert.equal(result.status, "fail");
    // The check is score-only, so this warning lowers the score and never fails the audit.
    assert.equal(
      HARNESS_CHECKS.find((check) => check.id === "settings-rules-matched")
        ?.failureImpact,
      "score-only",
    );
    assert.deepEqual(
      result.findings.filter((finding) => finding.includes("attribution.")),
      [
        'claude: .claude/settings.json attribution.commit is not "", so Claude adds a co-author line to commits',
        "claude: .claude/settings.json attribution.sessionUrl is not false, so Claude adds a session link",
      ],
    );
  });
});
