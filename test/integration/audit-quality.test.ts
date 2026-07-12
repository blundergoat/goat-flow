/**
 * Exercises the user-visible `goat-flow audit --harness` concern contract.
 * Use these integration checks when setup or harness evidence changes so a
 * project owner never receives a passing score for unusable local storage.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertExists } from "../helpers/assert-exists.ts";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";
import { runAudit } from "../../src/cli/audit/audit.js";
import { createFS } from "../../src/cli/facts/fs.js";
import type {
  AuditConcernKey,
  AuditReport,
} from "../../src/cli/audit/types.js";
import type { AgentId } from "../../src/cli/types.js";
import {
  makeCtx,
  makeSharedFacts,
  stubFS,
  stubAgentFacts,
} from "../fixtures/projects/index.js";

// ---------------------------------------------------------------------------
// Cached repo audits - this file runs 4 audits against the goat-flow repo
// itself (1× build-only, 3× harness). Each audit is ~6–12s; lazy-caching by
// (agent, harness) key prevents repeats. Tests must treat reports as read-only.
// ---------------------------------------------------------------------------
const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const cachedRepoAudits = new Map<string, AuditReport>();
function getRepoAudit(opts: {
  agentFilter: AgentId | null;
  harness: boolean;
}): AuditReport {
  const key = `${opts.agentFilter}|${opts.harness}`;
  let report = cachedRepoAudits.get(key);
  if (report === undefined) {
    report = runAudit(createFS(PROJECT_ROOT), PROJECT_ROOT, opts);
    cachedRepoAudits.set(key, report);
  }
  return report;
}

// ---------------------------------------------------------------------------
// Harness concerns produce pass/fail status
// ---------------------------------------------------------------------------
/** Assert harness concerns use only dashboard-supported status values. */
function assertConcernStatusesAreTerminal(
  concerns: NonNullable<ReturnType<typeof getRepoAudit>["concerns"]>,
): void {
  for (const key of Object.keys(concerns) as AuditConcernKey[]) {
    const status = concerns[key].status;
    assert.ok(
      status === "pass" || status === "fail",
      `${key} status ${status} should be pass or fail`,
    );
  }
}

describe("harness concern statuses", () => {
  it("all concern statuses are pass or fail", () => {
    const report = getRepoAudit({ agentFilter: "claude", harness: true });

    assertExists(report.concerns);
    assertConcernStatusesAreTerminal(report.concerns);
  });
});

// ---------------------------------------------------------------------------
// Harness mode never changes build exit code when all scopes pass
// ---------------------------------------------------------------------------
describe("harness does not affect build-only result", () => {
  it("same build scope status with and without harness", () => {
    const buildOnly = getRepoAudit({ agentFilter: "claude", harness: false });
    const withHarness = getRepoAudit({ agentFilter: "claude", harness: true });

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

  it("passes when commit guidance is in the docs canonical path", () => {
    assert.ok(commitGuidanceCheck, "commit-guidance check must exist");
    const shared = makeSharedFacts();
    shared.gitCommitInstructions = {
      exists: true,
      path: "docs/coding-standards/git-commit.md",
      requiredPath: "docs/coding-standards/git-commit.md",
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
      /docs\/coding-standards\/git-commit\.md/,
    );
  });

  it("fails when commit guidance is only in a legacy .github location", () => {
    assert.ok(commitGuidanceCheck, "commit-guidance check must exist");
    const shared = makeSharedFacts();
    shared.gitCommitInstructions = {
      exists: false,
      path: null,
      requiredPath: "docs/coding-standards/git-commit.md",
      misplacedPaths: [".github/git-commit-instructions.md"],
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
      /belongs at docs\/coding-standards\/git-commit\.md/,
    );
    assert.match(
      result.howToFix?.join("\n") ?? "",
      /\.github\/git-commit-instructions\.md/,
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
          },
        }),
      ],
    });
    const result = denyRegisteredCheck.run(ctx);
    assert.equal(result.status, "pass");
  });

  it("fails when registered path still points at a legacy per-agent deny hook", () => {
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
    assert.equal(result.status, "fail");
    const finding = result.findings.find((f) => f.includes("does not match"));
    assert.ok(finding, "should report path mismatch");
    assert.ok(finding.includes(".claude/hooks/deny-dangerous.sh"));
    assert.ok(finding.includes(".goat-flow/hooks/deny-dangerous.sh"));
  });
});

// ---------------------------------------------------------------------------
// Zero footguns/lessons passes harness (fresh install regression)
// ---------------------------------------------------------------------------
describe("zero-entry fresh install", () => {
  it("a project with zero footguns and lessons passes harness", () => {
    const report = getRepoAudit({ agentFilter: "claude", harness: true });

    assertExists(report.concerns);
    // feedback_loop concern should pass even with zero entries
    // (the real project has entries, but the check only requires directories to exist)
    const feedbackLoop = report.concerns.feedback_loop;
    assert.equal(
      feedbackLoop.status,
      "pass",
      `feedback_loop should pass: ${JSON.stringify(feedbackLoop)}`,
    );
  });

  // A fresh consumer has valid learning-loop directories before its first real incident is recorded.
  it("accepts extractor diagnostics that only report zero learning-loop entries", () => {
    const check = HARNESS_CHECKS.find(
      (candidate) => candidate.id === "feedback-loop-active",
    );
    assert.ok(check, "feedback-loop-active check must exist");
    const sharedFacts = makeSharedFacts();
    sharedFacts.footguns.entryCount = 0;
    sharedFacts.footguns.buckets = [];
    sharedFacts.footguns.formatDiagnostic =
      "Footgun directory exists but contains 0 entries";
    sharedFacts.lessons.entryCount = 0;
    sharedFacts.lessons.buckets = [];
    sharedFacts.lessons.formatDiagnostic =
      "Lesson directory exists but contains 0 entries";

    const result = check.run(
      makeCtx({
        facts: {
          ...makeCtx().facts,
          shared: sharedFacts,
        },
      }),
    );

    assert.equal(result.status, "pass", JSON.stringify(result));
  });
});

describe("harness scoring honesty", () => {
  // A user can restore a file where recovery expects a directory after a broken backup.
  // The fixture writes those invalid paths, audits them, then removes its temporary project.
  it("fails setup and recovery when required storage paths are files", async () => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), "goat-flow-recovery-storage-"),
    );
    try {
      await mkdir(join(projectRoot, ".goat-flow", "logs"), {
        recursive: true,
      });
      await writeFile(
        join(projectRoot, ".goat-flow", "logs", "sessions"),
        "not a directory",
      );
      await writeFile(
        join(projectRoot, ".goat-flow", "plans"),
        "not a directory",
      );
      const auditFileSystem = createFS(projectRoot);
      const sessionSetupCheck = SETUP_CHECKS.find(
        (check) => check.id === "session-logs",
      );
      const sessionRecoveryCheck = HARNESS_CHECKS.find(
        (check) => check.id === "session-logs",
      );
      const milestoneRecoveryCheck = HARNESS_CHECKS.find(
        (check) => check.id === "milestone-tracking",
      );
      assert.ok(sessionSetupCheck, "session-logs setup check must exist");
      assert.ok(sessionRecoveryCheck, "session-logs recovery check must exist");
      assert.ok(
        milestoneRecoveryCheck,
        "milestone-tracking recovery check must exist",
      );

      const setupFinding = sessionSetupCheck.run({ fs: auditFileSystem });
      const sessionResult = sessionRecoveryCheck.run(
        makeCtx({ fs: auditFileSystem }),
      );
      const milestoneResult = milestoneRecoveryCheck.run(
        makeCtx({ fs: auditFileSystem }),
      );

      assert.ok(setupFinding, "a sessions file must fail setup");
      assert.equal(sessionResult.status, "fail");
      assert.equal(milestoneResult.status, "fail");
      assert.match(
        `${sessionResult.findings.join("\n")}\n${milestoneResult.findings.join("\n")}`,
        /not a readable directory/u,
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails session-log recovery when the sessions directory is missing", () => {
    const check = HARNESS_CHECKS.find((c) => c.id === "session-logs");
    assert.ok(check, "session-logs check must exist");
    const result = check.run(
      makeCtx({
        fs: stubFS({
          exists: (path) => path !== ".goat-flow/logs/sessions",
          listDir: () => [],
        }),
      }),
    );

    assert.equal(result.status, "fail");
    assert.match(result.findings.join("\n"), /No session logs directory/);
  });

  it("does not score optional task checkbox completion as recovery health", () => {
    const check = HARNESS_CHECKS.find((c) => c.id === "milestone-tracking");
    assert.ok(check, "milestone-tracking check must exist");
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path) => path === ".goat-flow/plans",
        listDir: (path) =>
          path === ".goat-flow/plans" ? ["Milestone-demo.md"] : [],
        readFile: (path) =>
          path === ".goat-flow/plans/Milestone-demo.md"
            ? [
                "# Milestone Demo",
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
