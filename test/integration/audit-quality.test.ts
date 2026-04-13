/**
 * Integration tests for `goat-flow audit --harness` concern scoring.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { QUALITY_CHECKS } from "../../src/cli/audit/harness-checks.js";
import { runAudit } from "../../src/cli/audit/audit.js";
import { createFS } from "../../src/cli/facts/fs.js";
import type { AuditConcernKey } from "../../src/cli/audit/types.js";
import { makeCtx, makeSharedFacts } from "../fixtures/projects/index.js";

// ---------------------------------------------------------------------------
// Quality concerns produce scores in 0-100 range
// ---------------------------------------------------------------------------
describe("quality concern scores", () => {
  it("all concern scores are 0-100", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const report = runAudit(fs, projectPath, {
      agentFilter: "claude",
      quality: true,
    });

    assert.notEqual(report.concerns, null);
    for (const key of Object.keys(report.concerns!) as AuditConcernKey[]) {
      const score = report.concerns![key].score;
      assert.ok(
        score >= 0 && score <= 100,
        `${key} score ${score} should be 0-100`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Quality mode never changes build exit code
// ---------------------------------------------------------------------------
describe("quality does not affect build result", () => {
  it("same build status with and without quality", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const buildOnly = runAudit(fs, projectPath, {
      agentFilter: "claude",
      quality: false,
    });
    const withQuality = runAudit(fs, projectPath, {
      agentFilter: "claude",
      quality: true,
    });

    assert.equal(
      buildOnly.status,
      withQuality.status,
      "Build status must not change with quality",
    );
    assert.equal(
      buildOnly.scopes.setup.status,
      withQuality.scopes.setup.status,
    );
    assert.equal(
      buildOnly.scopes.harness.status,
      withQuality.scopes.harness.status,
    );
  });
});

// ---------------------------------------------------------------------------
// Quality howToFix populated for failing checks
// ---------------------------------------------------------------------------
describe("quality howToFix", () => {
  it("failing quality checks produce howToFix entries", () => {
    const ctx = makeCtx({
      facts: {
        ...makeCtx().facts,
        shared: {
          ...makeSharedFacts(),
          architecture: { exists: false, lineCount: 0 },
          footguns: {
            ...makeSharedFacts().footguns,
            exists: false,
            entryCount: 0,
          },
        },
      },
    });

    let totalHowToFix = 0;
    for (const check of QUALITY_CHECKS) {
      const result = check.run(ctx);
      if (result.howToFix) {
        totalHowToFix += result.howToFix.length;
      }
    }
    assert.ok(
      totalHowToFix > 0,
      "At least some quality checks should produce howToFix entries",
    );
  });
});
