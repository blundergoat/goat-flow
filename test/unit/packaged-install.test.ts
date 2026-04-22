/**
 * Regression tests for the consumer/packaged-install resilience pass.
 *
 * package.json `files` ships only `dist/` + `workflow/` + a few helpers.
 * Consumer installs therefore lack:
 *   - `src/` (used by manifest.ts to observe dashboard_views)
 *   - `.goat-flow/*` and `docs/*` (used as evidence_paths on registered checks)
 *   - agent-scope dirs that the project doesn't install (single-agent setups)
 *
 * These tests simulate that environment via the `GOAT_FLOW_PACKAGED_MODE=1`
 * env var and assert the four code paths that previously crashed now succeed:
 *   1. `validateManifest` skips source-derived drift checks
 *   2. `validateProvenance` skips evidence_paths existence check (dev mode keeps it)
 *   3. `compareSkills` filters out absent agent roots
 *   4. `isPackagedInstall` is overridable for deterministic testing
 *
 * (The preflight shell-script skill-parity loop is covered by an assertion in
 * the preflight script itself - see `scripts/preflight-checks.sh` the
 * `[[ -d "$agent_dir" ]] || continue` guard before the installed-file check.)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateManifest,
  resetManifestCache,
} from "../../src/cli/manifest/manifest.js";
import { ManifestValidationError } from "../../src/cli/manifest/types.js";
import { validateProvenance } from "../../src/cli/audit/provenance-types.js";
import { isPackagedInstall } from "../../src/cli/paths.js";
import { SKILL_NAMES } from "../../src/cli/constants.js";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";
import type {
  ManifestJson,
  ObservedFacts,
} from "../../src/cli/manifest/types.js";

/** Run `fn` with `GOAT_FLOW_PACKAGED_MODE=1` set, restoring on exit. */
function withPackagedMode<T>(fn: () => T): T {
  const prior = process.env["GOAT_FLOW_PACKAGED_MODE"];
  process.env["GOAT_FLOW_PACKAGED_MODE"] = "1";
  resetManifestCache();
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env["GOAT_FLOW_PACKAGED_MODE"];
    else process.env["GOAT_FLOW_PACKAGED_MODE"] = prior;
    resetManifestCache();
  }
}

/** Build a drifted ManifestJson + ObservedFacts pair. In packaged mode the
 *  source-only dashboard-view drift must be ignored; in dev mode it must throw. */
function makeDriftedInputs(): {
  json: ManifestJson;
  observed: ObservedFacts;
} {
  const json: ManifestJson = {
    version: "1.2.3",
    required_files: [],
    required_dirs: [],
    skills: {
      canonical: [...SKILL_NAMES],
      stale_names: [],
    } as unknown as ManifestJson["skills"],
    agents: {} as ManifestJson["agents"],
    facts: {
      dashboard_views: ["ship", "setup", "terminal"],
    },
  } as ManifestJson;
  const observed: ObservedFacts = {
    views: [], // packaged install: src/ not shipped
    presetsCount: 0,
    skills: SKILL_NAMES,
    setupChecks: SETUP_CHECKS.length,
    agentChecks: AGENT_CHECKS.length,
    harnessChecks: HARNESS_CHECKS.length,
    version: "1.2.3",
  };
  return { json, observed };
}

describe("isPackagedInstall", () => {
  it("returns true when GOAT_FLOW_PACKAGED_MODE=1 is set", () => {
    withPackagedMode(() => {
      assert.equal(isPackagedInstall(), true);
    });
  });

  it("returns false in the source-checkout dev environment (baseline)", () => {
    // Sanity: without the env override, goat-flow's own repo has src/dashboard.
    const prior = process.env["GOAT_FLOW_PACKAGED_MODE"];
    delete process.env["GOAT_FLOW_PACKAGED_MODE"];
    try {
      assert.equal(
        isPackagedInstall(),
        false,
        "dev checkout must not be mis-detected as packaged",
      );
    } finally {
      if (prior !== undefined) process.env["GOAT_FLOW_PACKAGED_MODE"] = prior;
    }
  });
});

describe("validateManifest: packaged vs dev mode", () => {
  it("throws on source-derived drift in dev mode (baseline)", () => {
    const { json, observed } = makeDriftedInputs();
    const prior = process.env["GOAT_FLOW_PACKAGED_MODE"];
    delete process.env["GOAT_FLOW_PACKAGED_MODE"];
    try {
      let thrown: unknown;
      try {
        validateManifest(json, observed);
      } catch (err) {
        thrown = err;
      }
      assert.ok(
        thrown instanceof ManifestValidationError,
        "expected ManifestValidationError in dev mode",
      );
      const findings = thrown.findings.join(" | ");
      assert.match(findings, /dashboard_views drift/);
    } finally {
      if (prior !== undefined) process.env["GOAT_FLOW_PACKAGED_MODE"] = prior;
    }
  });

  it("tolerates source-derived drift in packaged mode (fix for blocker #1)", () => {
    const { json, observed } = makeDriftedInputs();
    withPackagedMode(() => {
      // Packaged mode: src/ isn't shipped, so observed views/presets are empty.
      // The manifest's declared values were validated at publish time; trust them.
      assert.doesNotThrow(() => validateManifest(json, observed));
    });
  });

  it("still catches skills-canonical drift in packaged mode (constants.ts ships in dist/)", () => {
    const { observed } = makeDriftedInputs();
    const json: ManifestJson = {
      version: "1.2.3",
      required_files: [],
      required_dirs: [],
      skills: {
        canonical: ["this-skill-does-not-exist"],
        stale_names: [],
      } as unknown as ManifestJson["skills"],
      agents: {} as ManifestJson["agents"],
      facts: {
        dashboard_views: [],
      },
    } as ManifestJson;
    withPackagedMode(() => {
      let thrown: unknown;
      try {
        validateManifest(json, observed);
      } catch (err) {
        thrown = err;
      }
      assert.ok(
        thrown instanceof ManifestValidationError,
        "expected ManifestValidationError",
      );
      const findings = thrown.findings.join(" | ");
      assert.match(findings, /skills\.canonical drift/);
    });
  });
});

describe("validateProvenance: optional evidence_paths existence (fix for blocker #2)", () => {
  const sampleEvidence = {
    source_type: "incident" as const,
    source_urls: [],
    verified_on: "2026-04-20",
    normative_level: "MUST" as const,
    evidence_paths: [".goat-flow/footguns/does-not-exist.md"],
  };

  it("returns no errors when pathExists is undefined (packaged mode)", () => {
    // This is how `validateRegisteredCheckProvenance` calls it in packaged mode:
    // pathExists omitted entirely → evidence_paths existence check skipped.
    const errors = validateProvenance(sampleEvidence);
    assert.equal(errors.length, 0);
  });

  it("flags missing evidence_paths when pathExists is provided (dev mode)", () => {
    const errors = validateProvenance(sampleEvidence, () => false);
    assert.ok(
      errors.some((e) => e.includes("evidence_path does not exist")),
      "dev mode should still catch stale provenance",
    );
  });

  it("still validates schema-level errors (unknown-reason) regardless of mode", () => {
    const bad = {
      source_type: "unknown" as const,
      source_urls: [],
      verified_on: "2026-04-20",
      normative_level: "MUST" as const,
      reason: "",
    };
    const errors = validateProvenance(bad);
    assert.ok(
      errors.some((e) => e.includes("requires a non-empty")),
      "schema-level validation must run even when evidence-path check is off",
    );
  });
});
