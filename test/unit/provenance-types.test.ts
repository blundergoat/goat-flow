/**
 * Unit tests for provenance schema validator.
 *
 * The `source_type: "unknown"` + required `reason` contract is the critique-locked
 * The escape hatch must be mechanically enforced so back-fill work can't
 * silently ship without-reason unknowns.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { validateProvenance } from "../../src/cli/audit/provenance-types.js";
import type { CheckEvidence } from "../../src/cli/audit/provenance-types.js";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";
import { createFS } from "../../src/cli/facts/fs.js";

type RegisteredCheck =
  | (typeof SETUP_CHECKS)[number]
  | (typeof AGENT_CHECKS)[number]
  | (typeof HARNESS_CHECKS)[number];

/** Return every registered build and harness check with provenance metadata. */
function registeredChecks(): RegisteredCheck[] {
  return [...SETUP_CHECKS, ...AGENT_CHECKS, ...HARNESS_CHECKS];
}

/**
 * Assert registered check provenance satisfies the schema.
 *
 * @param checks - checks whose provenance should be valid without filesystem lookup
 */
function assertChecksHaveValidProvenance(
  checks: ReadonlyArray<RegisteredCheck>,
): void {
  checks.forEach((check) => {
    assert.deepEqual(
      validateProvenance(check.provenance),
      [],
      `check ${check.id} has invalid provenance`,
    );
  });
}

/**
 * Assert registered evidence paths resolve in the repository filesystem.
 *
 * @param checks - checks whose evidence paths should exist on disk
 */
function assertChecksPointAtExistingEvidence(
  checks: ReadonlyArray<RegisteredCheck>,
): void {
  const fs = createFS(resolve(import.meta.dirname, "..", ".."));
  checks.forEach((check) => {
    assert.deepEqual(
      validateProvenance(check.provenance, fs.exists),
      [],
      `check ${check.id} points at missing evidence`,
    );
  });
}

describe("validateProvenance", () => {
  it("accepts a well-formed spec entry", () => {
    const evidence: CheckEvidence = {
      source_type: "spec",
      source_urls: ["https://example.com/spec"],
      verified_on: "2026-04-17",
      normative_level: "MUST",
    };
    assert.deepEqual(validateProvenance(evidence), []);
  });

  it("rejects source_type 'unknown' without a reason", () => {
    const evidence: CheckEvidence = {
      source_type: "unknown",
      source_urls: [],
      verified_on: "2026-04-17",
      normative_level: "BEST_PRACTICE",
    };
    const errs = validateProvenance(evidence);
    assert.equal(errs.length, 1);
    assert.match(errs[0]!, /unknown.*reason/i);
  });

  it("accepts source_type 'unknown' with a non-empty reason", () => {
    const evidence: CheckEvidence = {
      source_type: "unknown",
      source_urls: [],
      verified_on: "2026-04-17",
      normative_level: "BEST_PRACTICE",
      reason: "Pre-dates v1.1.0 cleanup, original evidence not preserved.",
    };
    assert.deepEqual(validateProvenance(evidence), []);
  });

  it("rejects unknown with an empty-string reason", () => {
    const evidence: CheckEvidence = {
      source_type: "unknown",
      source_urls: [],
      verified_on: "2026-04-17",
      normative_level: "BEST_PRACTICE",
      reason: "   ",
    };
    assert.equal(validateProvenance(evidence).length, 1);
  });

  it("rejects a malformed verified_on date", () => {
    const evidence: CheckEvidence = {
      source_type: "spec",
      source_urls: ["https://example.com"],
      verified_on: "April 17 2026",
      normative_level: "MUST",
    };
    assert.match(validateProvenance(evidence)[0]!, /verified_on/);
  });

  it("accepts incident-typed evidence with only evidence_paths", () => {
    const evidence: CheckEvidence = {
      source_type: "incident",
      source_urls: [],
      verified_on: "2026-04-17",
      normative_level: "MUST",
      evidence_paths: [".goat-flow/learning-loop/lessons/verification.md"],
    };
    assert.deepEqual(validateProvenance(evidence), []);
  });

  it("accepts evidence split into framework and target path bases", () => {
    const evidence: CheckEvidence = {
      source_type: "incident",
      source_urls: [],
      verified_on: "2026-05-06",
      normative_level: "MUST",
      framework_evidence_paths: [
        ".goat-flow/learning-loop/footguns/auditor.md",
      ],
      target_evidence_paths: ["CLAUDE.md"],
    };
    assert.deepEqual(validateProvenance(evidence), []);
  });

  it("rejects non-unknown source_type with neither urls nor evidence_paths", () => {
    const evidence: CheckEvidence = {
      source_type: "spec",
      source_urls: [],
      verified_on: "2026-04-17",
      normative_level: "MUST",
    };
    const errs = validateProvenance(evidence);
    assert.ok(errs.length >= 1);
    assert.match(errs[0]!, /source_url|evidence_path/i);
  });

  it("rejects missing evidence_paths when a filesystem resolver is provided", () => {
    const evidence: CheckEvidence = {
      source_type: "incident",
      source_urls: [],
      verified_on: "2026-04-18",
      normative_level: "MUST",
      evidence_paths: ["workflow/setup/definitely-missing.md"],
    };
    const errs = validateProvenance(evidence, () => false);
    assert.ok(errs.some((err) => err.includes("evidence_path does not exist")));
  });
});

describe("check evidence constants validate", () => {
  it("all 37 registered build and harness checks satisfy the schema", () => {
    const checks = registeredChecks();
    const expectedRegisteredCheckCount = 37;
    assert.equal(checks.length, expectedRegisteredCheckCount);
    assertChecksHaveValidProvenance(checks);
  });

  it("all registered checks point at evidence paths that exist on disk", () => {
    assertChecksPointAtExistingEvidence(registeredChecks());
  });
});
