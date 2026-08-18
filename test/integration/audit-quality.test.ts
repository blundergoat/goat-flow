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
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";
import { runAudit } from "../../src/cli/audit/audit.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { createFS } from "../../src/cli/facts/fs.js";
import { extractSharedFacts } from "../../src/cli/facts/shared/index.js";
import type {
  AuditConcernKey,
  AuditReport,
} from "../../src/cli/audit/types.js";
import type { AgentId } from "../../src/cli/types.js";
import {
  makeCtx,
  makeSharedFacts,
  stubConfig,
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
// Audit this repository once per option shape, so the suite measures real output rather than a fixture's idea of it.
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

describe("audit against a project from a newer goat-flow release", () => {
  it("reports version skew without older-template agent or drift findings", () => {
    const futureVersion = "999.0.0";
    const base = createFS(PROJECT_ROOT);
    const fs = {
      ...base,
      readFile: (path: string) => {
        const content = base.readFile(path);
        if (content === null) return null;
        if (
          path === ".goat-flow/config.yaml" ||
          path.startsWith(".agents/skills/") ||
          path.startsWith(".goat-flow/hooks/")
        ) {
          return content.replaceAll(AUDIT_VERSION, futureVersion);
        }
        return content;
      },
    };

    const report = runAudit(fs, PROJECT_ROOT, {
      agentFilter: "codex",
      harness: false,
      checkDrift: true,
      checkContent: true,
      denyMechanismEvidenceLevel: "static",
    });

    const setupFailures = report.scopes.setup.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.id);
    assert.deepEqual(setupFailures, ["config-version", "hook-version"]);
    for (const id of ["agent-skills", "agent-guardrails"]) {
      const check = report.scopes.agent.checks.find(
        (candidate) => candidate.id === id,
      );
      assertExists(check);
      assert.equal(check.status, "skipped");
      assert.equal(check.failure, undefined);
    }
    assert.equal(report.drift, null);
    assert.equal(report.content, null);
  });
});

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
      path: "docs/coding-standards/git-commit-message.md",
      requiredPath: "docs/coding-standards/git-commit-message.md",
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
      /docs\/coding-standards\/git-commit-message\.md/,
    );
  });

  it("fails when commit guidance is only in a legacy .github location", () => {
    assert.ok(commitGuidanceCheck, "commit-guidance check must exist");
    const shared = makeSharedFacts();
    shared.gitCommitInstructions = {
      exists: false,
      path: null,
      requiredPath: "docs/coding-standards/git-commit-message.md",
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
      /belongs at docs\/coding-standards\/git-commit-message\.md/,
    );
    assert.match(
      result.howToFix?.join("\n") ?? "",
      /\.github\/git-commit-instructions\.md/,
    );
  });

  it("accepts the former docs path from real project facts", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-commit-guidance-"));
    try {
      await mkdir(join(root, ".git"));
      const guidanceDir = join(root, "docs", "coding-standards");
      await mkdir(guidanceDir, { recursive: true });
      await writeFile(
        join(guidanceDir, "git-commit.md"),
        "# Existing Commit Rules\n",
      );

      const report = runAudit(createFS(root), root, {
        agentFilter: null,
        harness: true,
      });
      const result = report.scopes.harness?.checks.find(
        (check) => check.id === "commit-guidance",
      );

      assert.ok(result, "commit-guidance audit result must exist");
      assert.equal(result.status, "pass");
      assert.equal(result.failure, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips commit guidance when the target has no .git", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-no-git-guidance-"));
    try {
      const report = runAudit(createFS(root), root, {
        agentFilter: null,
        harness: true,
      });
      const result = report.scopes.harness?.checks.find(
        (check) => check.id === "commit-guidance",
      );

      assert.ok(result, "commit-guidance audit result must exist");
      assert.equal(result.status, "skipped");
      assert.equal(result.failure, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefers the new docs path when both accepted guides exist", () => {
    const preferredPath = "docs/coding-standards/git-commit-message.md";
    const compatiblePath = "docs/coding-standards/git-commit.md";
    /** Read the detected commit-guide facts for one controlled set of existing paths. */
    const factsFor = (paths: string[]) =>
      extractSharedFacts(
        stubFS({
          exists: (path) => paths.includes(path),
        }),
        stubConfig(),
      ).gitCommitInstructions;

    assert.deepEqual(factsFor([compatiblePath]), {
      exists: true,
      path: compatiblePath,
      requiredPath: preferredPath,
      misplacedPaths: [],
    });
    assert.deepEqual(factsFor([compatiblePath, preferredPath]), {
      exists: true,
      path: preferredPath,
      requiredPath: preferredPath,
      misplacedPaths: [],
    });
  });

  it("accepts either docs path in the Copilot instruction bridge", () => {
    const agentInstructionCheck = AGENT_CHECKS.find(
      (check) => check.id === "agent-instruction",
    );
    assert.ok(agentInstructionCheck, "agent-instruction check must exist");
    const instructionPath = ".github/copilot-instructions.md";

    for (const guidePath of [
      "docs/coding-standards/git-commit-message.md",
      "docs/coding-standards/git-commit.md",
    ]) {
      const instructionContent = `## Commit Messages\n\nSee \`${guidePath}\`.\n`;
      const baseAgent = stubAgentFacts();
      const result = agentInstructionCheck.run(
        makeCtx({
          agentFilter: "copilot",
          agents: [
            stubAgentFacts({
              agent: PROFILES.copilot,
              instruction: {
                ...baseAgent.instruction,
                content: instructionContent,
              },
            }),
          ],
          fs: stubFS({
            exists: (path) =>
              path === ".git" || path === ".github" || path === instructionPath,
            readFile: (path) =>
              path === instructionPath ? instructionContent : null,
          }),
        }),
      );

      assert.equal(result, null, `Copilot should accept ${guidePath}`);
    }
  });

  it("skips the Copilot commit bridge when the target has no .git", () => {
    const agentInstructionCheck = AGENT_CHECKS.find(
      (check) => check.id === "agent-instruction",
    );
    assert.ok(agentInstructionCheck, "agent-instruction check must exist");
    const instructionPath = ".github/copilot-instructions.md";
    const instructionContent = "# Copilot Instructions\n";
    const baseAgent = stubAgentFacts();
    const result = agentInstructionCheck.run(
      makeCtx({
        agentFilter: "copilot",
        agents: [
          stubAgentFacts({
            agent: PROFILES.copilot,
            instruction: {
              ...baseAgent.instruction,
              content: instructionContent,
            },
          }),
        ],
        fs: stubFS({
          exists: (path) => path === ".github" || path === instructionPath,
          readFile: (path) =>
            path === instructionPath ? instructionContent : null,
        }),
      }),
    );

    assert.equal(result, null);
  });

  it("requires the Copilot commit bridge inside a Git project", () => {
    const agentInstructionCheck = AGENT_CHECKS.find(
      (check) => check.id === "agent-instruction",
    );
    assert.ok(agentInstructionCheck, "agent-instruction check must exist");
    const instructionPath = ".github/copilot-instructions.md";
    const instructionContent = "# Copilot Instructions\n";
    const baseAgent = stubAgentFacts();
    const result = agentInstructionCheck.run(
      makeCtx({
        agentFilter: "copilot",
        agents: [
          stubAgentFacts({
            agent: PROFILES.copilot,
            instruction: {
              ...baseAgent.instruction,
              content: instructionContent,
            },
          }),
        ],
        fs: stubFS({
          exists: (path) =>
            path === ".git" || path === ".github" || path === instructionPath,
          readFile: (path) =>
            path === instructionPath ? instructionContent : null,
        }),
      }),
    );

    assert.match(result?.message ?? "", /must reference/u);
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

  it("reports an unreadable session-log listing without aborting the audit", () => {
    const check = HARNESS_CHECKS.find((c) => c.id === "session-logs");
    assert.ok(check, "session-logs check must exist");
    const result = check.run(
      makeCtx({
        fs: stubFS({
          listDir: () => {
            throw new Error("fixture list failure");
          },
        }),
      }),
    );

    assert.equal(result.status, "fail");
    assert.match(result.findings.join("\n"), /could not be listed/u);
    assert.match(result.recommendations.join("\n"), /Restore read access/u);
    assert.match(
      result.howToFix?.join("\n") ?? "",
      /Check directory permissions/u,
    );
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
