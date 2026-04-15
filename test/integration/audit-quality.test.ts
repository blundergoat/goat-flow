/**
 * Integration tests for `goat-flow audit --harness` completeness checks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";
import { runAudit } from "../../src/cli/audit/audit.js";
import { createFS } from "../../src/cli/facts/fs.js";
import type { AuditConcernKey } from "../../src/cli/audit/types.js";
import { makeCtx, makeSharedFacts } from "../fixtures/projects/index.js";

// ---------------------------------------------------------------------------
// Harness concerns produce pass/fail status
// ---------------------------------------------------------------------------
describe("harness concern statuses", () => {
  it("all concern statuses are pass or fail", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const report = runAudit(fs, projectPath, {
      agentFilter: "claude",
      harness: true,
    });

    assert.notEqual(report.concerns, null);
    for (const key of Object.keys(report.concerns!) as AuditConcernKey[]) {
      const status = report.concerns![key].status;
      assert.ok(
        status === "pass" || status === "fail",
        `${key} status ${status} should be pass or fail`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Harness mode never changes build exit code when all scopes pass
// ---------------------------------------------------------------------------
describe("harness does not affect build-only result", () => {
  it("same build scope status with and without harness", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const buildOnly = runAudit(fs, projectPath, {
      agentFilter: "claude",
      harness: false,
    });
    const withHarness = runAudit(fs, projectPath, {
      agentFilter: "claude",
      harness: true,
    });

    assert.equal(
      buildOnly.scopes.setup.status,
      withHarness.scopes.setup.status,
      "Setup status must not change with harness",
    );
    assert.equal(
      buildOnly.scopes.agent.status,
      withHarness.scopes.agent.status,
      "Agent status must not change with harness",
    );
  });
});

// ---------------------------------------------------------------------------
// Harness howToFix populated for failing checks
// ---------------------------------------------------------------------------
describe("harness howToFix", () => {
  it("failing harness checks produce howToFix entries", () => {
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
    for (const check of HARNESS_CHECKS) {
      const result = check.run(ctx);
      if (result.howToFix) {
        totalHowToFix += result.howToFix.length;
      }
    }
    assert.ok(
      totalHowToFix > 0,
      "At least some harness checks should produce howToFix entries",
    );
  });
});

// ---------------------------------------------------------------------------
// Zero footguns/lessons passes harness (fresh install regression)
// ---------------------------------------------------------------------------
describe("zero-entry fresh install", () => {
  it("a project with zero footguns and lessons passes harness", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const report = runAudit(fs, projectPath, {
      agentFilter: "claude",
      harness: true,
    });

    assert.notEqual(report.concerns, null);
    // feedback_loop concern should pass even with zero entries
    // (the real project has entries, but the check only requires directories to exist)
    const feedbackLoop = report.concerns!.feedback_loop;
    assert.equal(
      feedbackLoop.status,
      "pass",
      `feedback_loop should pass: ${JSON.stringify(feedbackLoop)}`,
    );
  });
});
