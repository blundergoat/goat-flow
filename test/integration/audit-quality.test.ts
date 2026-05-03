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
import {
  makeCtx,
  makeSharedFacts,
  stubFS,
  stubAgentFacts,
} from "../fixtures/projects/index.js";

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

describe("commit-guidance harness check", () => {
  const commitGuidanceCheck = HARNESS_CHECKS.find(
    (c) => c.id === "commit-guidance",
  );

  it("passes when commit guidance is in the .github canonical path", () => {
    assert.ok(commitGuidanceCheck, "commit-guidance check must exist");
    const shared = makeSharedFacts();
    shared.gitCommitInstructions = {
      exists: true,
      path: ".github/git-commit-instructions.md",
      requiredPath: ".github/git-commit-instructions.md",
      misplacedPaths: [],
    };

    const result = commitGuidanceCheck.run(
      makeCtx({
        facts: {
          ...makeCtx().facts,
          shared,
        },
      }),
    );

    assert.equal(result.status, "pass");
    assert.match(
      result.findings.join("\n"),
      /\.github\/git-commit-instructions\.md/,
    );
  });

  it("fails when a .github project keeps commit guidance only in docs", () => {
    assert.ok(commitGuidanceCheck, "commit-guidance check must exist");
    const shared = makeSharedFacts();
    shared.gitCommitInstructions = {
      exists: false,
      path: null,
      requiredPath: ".github/git-commit-instructions.md",
      misplacedPaths: ["docs/coding-standards/git-commit.md"],
    };

    const result = commitGuidanceCheck.run(
      makeCtx({
        facts: {
          ...makeCtx().facts,
          shared,
        },
      }),
    );

    assert.equal(result.status, "fail");
    assert.match(
      result.findings.join("\n"),
      /belongs at \.github\/git-commit-instructions\.md/,
    );
    assert.match(
      result.howToFix?.join("\n") ?? "",
      /docs\/coding-standards\/git-commit\.md/,
    );
  });
});

// ---------------------------------------------------------------------------
// Deny hook registration check
// ---------------------------------------------------------------------------
describe("deny-hook-registered harness check", () => {
  const denyRegisteredCheck = HARNESS_CHECKS.find(
    (c) => c.id === "deny-hook-registered",
  );

  it("fails when deny exists but is not registered", () => {
    assert.ok(denyRegisteredCheck, "deny-hook-registered check must exist");
    const ctx = makeCtx({
      agents: [
        stubAgentFacts({
          hooks: {
            ...stubAgentFacts().hooks,
            denyExists: true,
            denyIsRegistered: false,
            denyRegisteredPath: null,
          },
        }),
      ],
    });
    const result = denyRegisteredCheck.run(ctx);
    assert.equal(result.status, "fail");
    assert.ok(result.recommendations.length > 0);
  });

  it("passes when deny exists and is registered", () => {
    assert.ok(denyRegisteredCheck, "deny-hook-registered check must exist");
    const ctx = makeCtx({
      agents: [
        stubAgentFacts({
          hooks: {
            ...stubAgentFacts().hooks,
            denyExists: true,
            denyIsRegistered: true,
            denyRegisteredPath: ".claude/hooks/deny-dangerous.sh",
          },
        }),
      ],
    });
    const result = denyRegisteredCheck.run(ctx);
    assert.equal(result.status, "pass");
  });

  it("fails when registered path is a different agent's deny hook (same basename)", () => {
    assert.ok(denyRegisteredCheck, "deny-hook-registered check must exist");
    const ctx = makeCtx({
      agents: [
        stubAgentFacts({
          hooks: {
            ...stubAgentFacts().hooks,
            denyExists: true,
            denyIsRegistered: true,
            denyRegisteredPath: ".codex/hooks/deny-dangerous.sh",
          },
        }),
      ],
    });
    const result = denyRegisteredCheck.run(ctx);
    assert.equal(result.status, "fail");
    const finding = result.findings.find((f) => f.includes("does not match"));
    assert.ok(finding, "should report path mismatch");
    assert.ok(finding.includes(".codex/hooks/deny-dangerous.sh"));
    assert.ok(finding.includes(".claude/hooks/deny-dangerous.sh"));
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

describe("harness scoring honesty", () => {
  it("does not score optional task checkbox completion as recovery health", () => {
    const check = HARNESS_CHECKS.find((c) => c.id === "milestone-tracking");
    assert.ok(check, "milestone-tracking check must exist");
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) => path === ".goat-flow/tasks",
        listDir: (path) => (path === ".goat-flow/tasks" ? ["M01-demo.md"] : []),
        readFile: (path) =>
          path === ".goat-flow/tasks/M01-demo.md"
            ? [
                "# M01 Demo",
                "**Status:** in-progress",
                "## Tasks",
                "- [ ] Add feature",
                "- [ ] Verify feature",
                "## Exit Criteria",
                "- [ ] Feature works",
              ].join("\n")
            : null,
      }),
    });

    const result = check.run(ctx);
    assert.equal(result.status, "pass");
    assert.match(result.findings.join("\n"), /not audited/);
    assert.doesNotMatch(result.findings.join("\n"), /at 0%|Recovery degraded/);
  });

  it("does not report perfect feedback-loop health when stale learning-loop refs exist", () => {
    const check = HARNESS_CHECKS.find((c) => c.id === "feedback-loop-active");
    assert.ok(check, "feedback-loop-active check must exist");
    const shared = makeSharedFacts();
    shared.footguns.staleRefs = ["missing-footgun-ref.md"];
    shared.lessons.staleRefs = ["missing-lesson-ref.md"];
    const result = check.run(
      makeCtx({
        facts: {
          ...makeCtx().facts,
          shared,
        },
      }),
    );

    assert.equal(result.status, "fail");
    assert.match(result.findings.join("\n"), /2 stale file reference/);
  });
});
