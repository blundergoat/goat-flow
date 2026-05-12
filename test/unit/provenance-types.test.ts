/**
 * Unit tests for M05 provenance schema validator.
 *
 * The `source_type: "unknown"` + required `reason` contract is the critique-locked
 * M11 escape hatch. Must be mechanically enforced so back-fill work can't
 * silently ship without-reason unknowns.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { validateProvenance } from "../../src/cli/audit/provenance-types.js";
import type { CheckEvidence } from "../../src/cli/audit/provenance-types.js";
import { CONTENT_QUALITY_EVIDENCE } from "../../src/cli/audit/check-content-quality.js";
import { FACTUAL_CLAIMS_EVIDENCE } from "../../src/cli/audit/check-factual-claims.js";
import { SNAPSHOT_CLAIMS_EVIDENCE } from "../../src/cli/audit/check-snapshot-claims.js";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";
import { createFS } from "../../src/cli/facts/fs.js";

describe("validateProvenance", () => {
  it("accepts a well-formed spec entry", () => {
    const e: CheckEvidence = {
      source_type: "spec",
      source_urls: ["https://example.com/spec"],
      verified_on: "2026-04-17",
      normative_level: "MUST",
    };
    assert.deepEqual(validateProvenance(e), []);
  });

  it("rejects source_type 'unknown' without a reason", () => {
    const e: CheckEvidence = {
      source_type: "unknown",
      source_urls: [],
      verified_on: "2026-04-17",
      normative_level: "BEST_PRACTICE",
    };
    const errs = validateProvenance(e);
    assert.equal(errs.length, 1);
    assert.match(errs[0]!, /unknown.*reason/i);
  });

  it("accepts source_type 'unknown' with a non-empty reason", () => {
    const e: CheckEvidence = {
      source_type: "unknown",
      source_urls: [],
      verified_on: "2026-04-17",
      normative_level: "BEST_PRACTICE",
      reason: "Pre-dates v1.1.0 cleanup, original evidence not preserved.",
    };
    assert.deepEqual(validateProvenance(e), []);
  });

  it("rejects unknown with an empty-string reason", () => {
    const e: CheckEvidence = {
      source_type: "unknown",
      source_urls: [],
      verified_on: "2026-04-17",
      normative_level: "BEST_PRACTICE",
      reason: "   ",
    };
    assert.equal(validateProvenance(e).length, 1);
  });

  it("rejects a malformed verified_on date", () => {
    const e: CheckEvidence = {
      source_type: "spec",
      source_urls: ["https://example.com"],
      verified_on: "April 17 2026",
      normative_level: "MUST",
    };
    assert.match(validateProvenance(e)[0]!, /verified_on/);
  });

  it("accepts incident-typed evidence with only evidence_paths", () => {
    const e: CheckEvidence = {
      source_type: "incident",
      source_urls: [],
      verified_on: "2026-04-17",
      normative_level: "MUST",
      evidence_paths: [".goat-flow/lessons/verification.md"],
    };
    assert.deepEqual(validateProvenance(e), []);
  });

  it("accepts evidence split into framework and target path bases", () => {
    const e: CheckEvidence = {
      source_type: "incident",
      source_urls: [],
      verified_on: "2026-05-06",
      normative_level: "MUST",
      framework_evidence_paths: [".goat-flow/footguns/auditor.md"],
      target_evidence_paths: ["CLAUDE.md"],
    };
    assert.deepEqual(validateProvenance(e), []);
  });

  it("rejects non-unknown source_type with neither urls nor evidence_paths", () => {
    const e: CheckEvidence = {
      source_type: "spec",
      source_urls: [],
      verified_on: "2026-04-17",
      normative_level: "MUST",
    };
    const errs = validateProvenance(e);
    assert.ok(errs.length >= 1);
    assert.match(errs[0]!, /source_url|evidence_path/i);
  });

  it("rejects missing evidence_paths when a filesystem resolver is provided", () => {
    const e: CheckEvidence = {
      source_type: "incident",
      source_urls: [],
      verified_on: "2026-04-18",
      normative_level: "MUST",
      evidence_paths: ["workflow/setup/definitely-missing.md"],
    };
    const errs = validateProvenance(e, () => false);
    assert.ok(errs.some((err) => err.includes("evidence_path does not exist")));
  });
});

describe("M05 check evidence constants validate", () => {
  it("CONTENT_QUALITY_EVIDENCE satisfies the schema", () => {
    assert.deepEqual(validateProvenance(CONTENT_QUALITY_EVIDENCE), []);
  });

  it("FACTUAL_CLAIMS_EVIDENCE satisfies the schema", () => {
    assert.deepEqual(validateProvenance(FACTUAL_CLAIMS_EVIDENCE), []);
  });

  it("SNAPSHOT_CLAIMS_EVIDENCE satisfies the schema", () => {
    assert.deepEqual(validateProvenance(SNAPSHOT_CLAIMS_EVIDENCE), []);
  });

  it("all 35 registered build and harness checks satisfy the schema", () => {
    const checks = [...SETUP_CHECKS, ...AGENT_CHECKS, ...HARNESS_CHECKS];
    assert.equal(checks.length, 35);
    for (const check of checks) {
      assert.deepEqual(
        validateProvenance(check.provenance),
        [],
        `check ${check.id} has invalid provenance`,
      );
    }
  });

  it("all registered checks point at evidence paths that exist on disk", () => {
    const checks = [...SETUP_CHECKS, ...AGENT_CHECKS, ...HARNESS_CHECKS];
    const fs = createFS(resolve(import.meta.dirname, "..", ".."));
    for (const check of checks) {
      assert.deepEqual(
        validateProvenance(check.provenance, fs.exists),
        [],
        `check ${check.id} points at missing evidence`,
      );
    }
  });
});
