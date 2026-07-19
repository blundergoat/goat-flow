/**
 * Audit JSON contract for users and tools reading build-only or harness reports.
 * It protects the fields the dashboard renders and the assurance caveats automation consumes.
 * Use these checks when audit output changes so structural PASS is not mistaken for runtime proof.
 */
import { assert, assertExists, describe, getRepoAudit, it } from "./helpers.js";

type AuditReport = ReturnType<typeof getRepoAudit>;

/**
 * Assert build-only setup and agent scopes keep the JSON consumer contract.
 *
 * @param report - required repository audit; an absent report means no JSON contract can be checked
 */
function assertBuildScopeShape(report: AuditReport): void {
  // Both setup panels keep the same status and failure-list shape for dashboard users.
  (["setup", "agent"] as const).forEach((scope) => {
    const scopeReport = report.scopes[scope];
    assert.ok(
      ["pass", "fail"].includes(scopeReport.status),
      `${scope}.status should be pass or fail`,
    );
    assert.ok(
      Array.isArray(scopeReport.failures),
      `${scope}.failures should be an array`,
    );
  });
}

/**
 * Assert harness concerns expose the fields dashboard clients render.
 *
 * @param report - required harness report; absent concerns mean harness mode was not requested
 */
function assertHarnessConcernShape(report: AuditReport): void {
  // Every concern card exposes the same fields so clients can render them without special cases.
  (
    [
      "context",
      "constraints",
      "verification",
      "recovery",
      "feedback_loop",
    ] as const
  ).forEach((key) => {
    assertExists(report.concerns);
    const concern = report.concerns[key];
    assert.ok(
      concern.status === "pass" || concern.status === "fail",
      `${key}.status should be pass or fail`,
    );
    assert.ok(
      Array.isArray(concern.findings),
      `${key}.findings should be an array`,
    );
    assert.ok(
      Array.isArray(concern.limits),
      `${key}.limits should be an array`,
    );
    assert.ok(
      Array.isArray(concern.recommendations),
      `${key}.recommendations should be an array`,
    );
    assert.ok(
      Array.isArray(concern.howToFix),
      `${key}.howToFix should be an array`,
    );
  });
}

/** Assert JSON distinguishes structural completeness from project execution and resumability evidence. */
function assertHarnessAssuranceContract(report: AuditReport): void {
  assertExists(report.concerns);
  assert.ok(
    report.concerns.verification.limits.includes(
      "This audit inspected verification guidance and hook configuration; it did not execute project build, test, lint, typecheck, or format commands.",
    ),
  );
  assert.ok(
    report.concerns.recovery.limits.includes(
      "Recovery storage is available, but this audit did not validate the current objective, completed work, last verification, next action, or end-to-end resumability.",
    ),
  );

  const recoveryCheckIds = new Set(["milestone-tracking", "session-logs"]);
  const recoveryChecks = report.scopes.harness?.checks.filter((check) =>
    recoveryCheckIds.has(check.id),
  );
  assert.deepEqual(
    recoveryChecks?.map((check) => [check.evidenceKind, check.assurance]),
    [
      ["structural", "limited"],
      ["structural", "limited"],
    ],
  );
}

describe("audit JSON contract", () => {
  it("has correct shape for build-only mode", () => {
    const report = getRepoAudit({ agentFilter: "claude", harness: false });

    // Top-level keys
    assert.equal(report.command, "audit");
    assert.equal(report.harness, false);
    assert.ok(["pass", "fail"].includes(report.status));

    // Scopes structure
    assertBuildScopeShape(report);

    // Harness scope null in build-only mode
    assert.equal(
      report.scopes.harness,
      null,
      "harness scope should be null without --harness",
    );

    // Concerns null in build-only mode
    assert.equal(
      report.concerns,
      null,
      "concerns should be null without --harness",
    );

    // Overall
    assert.ok(["pass", "fail"].includes(report.overall.status));
  });

  it("has correct shape for harness mode", () => {
    const report = getRepoAudit({ agentFilter: "claude", harness: true });

    assert.equal(report.harness, true);
    assert.notEqual(report.scopes.harness, null);
    assertExists(report.concerns);

    assertHarnessConcernShape(report);
    assertHarnessAssuranceContract(report);

    assert.ok(["pass", "fail"].includes(report.overall.status));
  });
});

// ---------------------------------------------------------------------------
// Test 7: build failure howToFix - footguns check includes actionable fix
// ---------------------------------------------------------------------------
