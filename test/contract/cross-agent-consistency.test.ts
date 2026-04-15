/**
 * Contract tests: cross-surface consistency - versions, skill counts, scope coverage.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SKILL_NAMES } from "../../src/cli/constants.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import { getProjectStructure } from "../../src/cli/paths.js";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";

const BUILD_CHECKS = [...SETUP_CHECKS, ...AGENT_CHECKS];

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

// ---------------------------------------------------------------------------
// Package version matches AUDIT_VERSION
// ---------------------------------------------------------------------------
describe("version alignment", () => {
  it("package.json version matches AUDIT_VERSION", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf-8"),
    );
    assert.equal(
      pkg.version,
      AUDIT_VERSION,
      `package.json (${pkg.version}) must match AUDIT_VERSION (${AUDIT_VERSION})`,
    );
  });
});

// ---------------------------------------------------------------------------
// SKILL_NAMES count matches manifest.json canonical skills
// ---------------------------------------------------------------------------
describe("skill count alignment", () => {
  it("SKILL_NAMES matches manifest.json canonical skills", () => {
    const structure = getProjectStructure();
    const skills = structure.skills as { canonical: string[] } | undefined;
    const canonical = skills?.canonical ?? [];
    assert.deepStrictEqual(
      [...SKILL_NAMES].sort(),
      [...canonical].sort(),
      `SKILL_NAMES (${SKILL_NAMES.length}) must match manifest.json canonical (${canonical.length})`,
    );
  });
});

// ---------------------------------------------------------------------------
// Build checks have unique IDs
// ---------------------------------------------------------------------------
describe("build check IDs", () => {
  it("all build check IDs are unique", () => {
    const ids = BUILD_CHECKS.map((c) => c.id);
    const unique = new Set(ids);
    assert.equal(
      ids.length,
      unique.size,
      `Duplicate build check IDs: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Quality checks cover all 5 concerns
// ---------------------------------------------------------------------------
describe("harness check concern coverage", () => {
  it("harness checks cover all 5 concerns", () => {
    const concerns = new Set(HARNESS_CHECKS.map((c) => c.concern));
    assert.ok(concerns.has("context"), "Should have context checks");
    assert.ok(concerns.has("constraints"), "Should have constraints checks");
    assert.ok(concerns.has("verification"), "Should have verification checks");
    assert.ok(concerns.has("recovery"), "Should have recovery checks");
    assert.ok(
      concerns.has("feedback_loop"),
      "Should have feedback_loop checks",
    );
  });
});
