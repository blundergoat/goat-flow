/**
 * Contract test: verification routing boundaries (ADR-045).
 * Pins:
 *  - goat-qa quick-mode trigger no longer claims raw "verify" (now "verify coverage").
 *  - skill-preamble.md routes "verification planning" to /goat-qa (not bare "verification").
 *  - every canonical goat-* skill template references the Proof Gate.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

const CANONICAL_SKILLS = [
  "goat",
  "goat-debug",
  "goat-plan",
  "goat-review",
  "goat-critique",
  "goat-security",
  "goat-qa",
];

describe("verification routing boundaries (ADR-045)", () => {
  it("goat-qa does not claim raw 'verify' in its quick-mode trigger", () => {
    const content = readFileSync(
      resolve(PROJECT_ROOT, "workflow/skills/goat-qa/SKILL.md"),
      "utf-8",
    );
    const triggerLine = content
      .split("\n")
      .find((l) => l.includes("Standard mode (quick depth)"));
    assert.ok(triggerLine, "goat-qa should have a Standard-mode trigger line");
    assert.doesNotMatch(
      triggerLine!,
      /"verify"/,
      'goat-qa Standard-mode trigger must not contain bare quoted "verify" (use "verify coverage" instead) — see ADR-045',
    );
  });

  it("skill-preamble.md routes 'verification planning' to /goat-qa, not bare 'verification'", () => {
    const content = readFileSync(
      resolve(PROJECT_ROOT, ".goat-flow/skill-preamble.md"),
      "utf-8",
    );
    assert.match(
      content,
      /verification planning → \/goat-qa/,
      "preamble routing must read 'verification planning → /goat-qa' (ADR-045)",
    );
    assert.doesNotMatch(
      content,
      /coverage, verification → \/goat-qa/,
      "preamble routing must not use bare 'verification' as a goat-qa route (ADR-045)",
    );
  });

  it("every canonical goat-* skill template references the Proof Gate", () => {
    for (const skill of CANONICAL_SKILLS) {
      const content = readFileSync(
        resolve(PROJECT_ROOT, `workflow/skills/${skill}/SKILL.md`),
        "utf-8",
      );
      assert.match(
        content,
        /Proof Gate/,
        `${skill} SKILL.md must reference the Proof Gate (ADR-045)`,
      );
    }
  });
});
