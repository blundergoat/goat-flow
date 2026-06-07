/**
 * Audit scoring model: how acknowledged vs unacknowledged advisory failures affect a concern's status and
 * scope.failures, the CheckResult/structured-details contract for dashboard consumers, deny-covers-secrets
 * pass/fail conditions, and that each renderer (json, markdown, sarif, text) handles details consistently.
 */
import {
  INSTRUCTION_FILES,
  PROFILES,
  RATIONALISATIONS_PREAMBLE,
  assert,
  assertExists,
  completeInstruction,
  computeHarness,
  describe,
  it,
  makeCtx,
  makeReportWithDetails,
  parseCLIArgs,
  renderAuditJson,
  renderAuditMarkdown,
  renderAuditSarif,
  renderAuditText,
  stubAgentFacts,
  stubConfig,
  stubFS,
} from "./helpers.js";

describe("Audit scoring model", () => {
  it("acknowledge silences exactly the listed id, not other advisories", () => {
    // Craft a scenario where two advisory checks fail and acknowledge only one.
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({
      config: stubConfig({
        harness: { acknowledge: ["deny-blocks-pipe-to-shell"] },
        instruction_file_line_target: 40,
        instruction_file_line_limit: 45,
      }),
      agents: [stubAgentFacts({ hooks })],
    });
    const { concerns } = computeHarness(ctx);
    // constraints fail is acknowledged → pass. instruction-line-count (advisory
    // under context) will also fail because the stub instruction file is 50
    // lines vs a 45-line limit - NOT acknowledged → context.status fail.
    assert.equal(concerns.constraints.status, "pass");
    assert.equal(concerns.constraints.advisoryAcknowledged, 1);
    assert.equal(concerns.context.status, "fail");
    assert.ok(concerns.context.advisoryFail >= 1);
  });
});

describe("Audit scoring model", () => {
  it("acknowledged advisory does not add to scope.failures", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({
      config: stubConfig({
        harness: { acknowledge: ["deny-blocks-pipe-to-shell"] },
      }),
      agents: [stubAgentFacts({ hooks })],
    });
    const { scope } = computeHarness(ctx);
    assert.ok(
      !scope.failures.some((f) =>
        f.check.toLowerCase().includes("pipe-to-shell"),
      ),
      `Acknowledged advisory should not appear in scope.failures: ${JSON.stringify(scope.failures)}`,
    );
  });
});

describe("Audit scoring model", () => {
  it("acknowledged advisory fail does NOT flip the owning concern's status", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({
      config: stubConfig({
        harness: { acknowledge: ["deny-blocks-pipe-to-shell"] },
      }),
      agents: [stubAgentFacts({ hooks })],
    });
    const { concerns } = computeHarness(ctx);
    assert.equal(concerns.constraints.status, "pass");
    assert.equal(concerns.constraints.advisoryFail, 0);
    assert.equal(concerns.constraints.advisoryAcknowledged, 1);
  });
});

describe("Audit scoring model", () => {
  it("advisory failure emits WHY-not-integrity evidence with the check id", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({ agents: [stubAgentFacts({ hooks })] });
    const { scope } = computeHarness(ctx);
    const advisory = scope.checks.find(
      (c) => c.id === "deny-blocks-pipe-to-shell",
    )!;
    assertExists(
      advisory.failure,
      "advisory failure should have a failure obj",
    );
    assert.ok(
      advisory.failure.evidence?.includes("Advisory"),
      `evidence should explain advisory framing: ${advisory.failure.evidence}`,
    );
    assert.ok(
      advisory.failure.evidence?.includes("deny-blocks-pipe-to-shell"),
      `evidence should reference the check id: ${advisory.failure.evidence}`,
    );
  });
});

describe("Audit scoring model", () => {
  it("audit details flag defaults on and can strip structured payloads", () => {
    const parsed = parseCLIArgs(["audit", ".", "--no-audit-details"]);
    assert.equal(parsed.auditDetails, false);
    assert.throws(
      () => parseCLIArgs(["quality", ".", "--no-audit-details"]),
      /--no-audit-details is only valid for the audit command/,
    );
  });
});

describe("Audit scoring model", () => {
  it("CheckResult carries type, acknowledged, and provenance fields", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({
      config: stubConfig({
        harness: { acknowledge: ["deny-blocks-pipe-to-shell"] },
      }),
      agents: [stubAgentFacts({ hooks })],
    });
    const { scope } = computeHarness(ctx);
    const advisory = scope.checks.find(
      (c) => c.id === "deny-blocks-pipe-to-shell",
    )!;
    assert.equal(advisory.type, "advisory");
    assert.equal(advisory.acknowledged, true);
    assert.equal(advisory.displayStatus, "warn");
    assert.equal(advisory.impact, "score-only");
    assert.equal(advisory.provenance.normative_level, "SHOULD");
    const docs = scope.checks.find((c) => c.id === "doc-paths-resolve")!;
    assert.equal(docs.type, "integrity");
    assert.equal(docs.acknowledged, undefined);
    assert.equal(docs.displayStatus, "pass");
    assert.equal(docs.impact, "none");
    assert.equal(docs.evidenceKind, "structural");
    assert.equal(docs.provenance.normative_level, "MUST");
    assert.ok(
      docs.provenance.framework_evidence_paths?.includes(
        "docs/harness-audit.md",
      ),
      "framework evidence paths should be labelled separately from target paths",
    );
  });
});

describe("Audit scoring model", () => {
  it("deny-covers-secrets fails when settings Read deny is present but Bash hook lacks direct literal secret-path blocking", () => {
    // Models the settings-deny gap: settings.json has Read(**/.env*) etc., but the Bash
    // deny hook still allows `cat .env` / `source .env`. The harness must fail
    // on this even though the old check classified the agent as "covered".
    const hooks = {
      ...stubAgentFacts().hooks,
      readDenyCoversSecrets: true,
      bashDenyCoversSecrets: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({ agents: [stubAgentFacts({ hooks })] });
    const { scope } = computeHarness(ctx);
    const secrets = scope.checks.find((c) => c.id === "deny-covers-secrets");
    assert.ok(secrets, "deny-covers-secrets check should be present");
    assert.equal(
      secrets.status,
      "fail",
      "deny-covers-secrets must fail when Bash hook has no direct literal secret-path blocking",
    );
  });
});

describe("Audit scoring model", () => {
  it("deny-covers-secrets passes when both settings Read deny and Bash hook block direct literal secret paths", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      readDenyCoversSecrets: true,
      bashDenyCoversSecrets: true,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({ agents: [stubAgentFacts({ hooks })] });
    const { scope } = computeHarness(ctx);
    const secrets = scope.checks.find((c) => c.id === "deny-covers-secrets");
    assert.equal(secrets?.status, "pass");
  });
});

describe("Audit scoring model", () => {
  it("harness check results carry structured details for dashboard consumers", () => {
    const ctx = makeCtx();
    const { scope } = computeHarness(ctx);
    const checksWithoutDetails = scope.checks
      .filter((check) => check.details === undefined)
      .map((check) => check.id);

    assert.deepEqual(checksWithoutDetails, []);

    const docs = scope.checks.find((c) => c.id === "doc-paths-resolve")!;
    assert.deepEqual(docs.details?.docPaths, {
      totalPaths: 0,
      resolvedCount: 0,
      unresolved: [],
    });

    const lineCounts = scope.checks.find(
      (c) => c.id === "instruction-line-count",
    )!;
    assert.deepEqual(lineCounts.details?.lineCounts, [
      {
        agent: "claude",
        actual: 100,
        target: 125,
        hardLimit: 150,
      },
    ]);

    const denySecrets = scope.checks.find(
      (c) => c.id === "deny-covers-secrets",
    )!;
    assert.deepEqual(denySecrets.details?.denyMatrix?.[0], {
      agent: "claude",
      missingPatterns: [],
      extraPatterns: [],
      hookRegistered: true,
    });

    const hooks = scope.checks.find((c) => c.id === "hooks-registered")!;
    assert.deepEqual(hooks.details?.verification?.[0], {
      agent: "claude",
      reason: "hook registrations and files are in sync",
      expected: "registration and file state match",
      actual: "in sync",
    });

    const recovery = scope.checks.find((c) => c.id === "session-logs")!;
    assert.deepEqual(recovery.details?.recovery?.[0], {
      agent: "claude",
      dir: ".goat-flow/logs/sessions",
      fileCount: 0,
    });

    const feedback = scope.checks.find((c) => c.id === "feedback-loop-active")!;
    assert.deepEqual(feedback.details?.freshness?.[0], {
      agent: "claude",
      fresh: 0,
      aging: 0,
      stale: 0,
    });

    const parsed = JSON.parse(renderAuditJson(makeReportWithDetails(scope)));
    assert.equal(
      parsed.scopes.harness.checks.some(
        (check: { details?: unknown }) => check.details !== undefined,
      ),
      true,
    );
  });
});

describe("Audit scoring model", () => {
  it("no post-turn hook metric lowers verification score without failing the concern", () => {
    const baseFacts = makeCtx().facts;
    const evidenceFiles: Record<string, string> = {
      ".goat-flow/skill-docs/skill-preamble.md": RATIONALISATIONS_PREAMBLE,
      [INSTRUCTION_FILES.claude]: completeInstruction("CLAUDE.md"),
    };
    const ctx = makeCtx({
      facts: {
        ...baseFacts,
        shared: {
          ...baseFacts.shared,
          gitCommitInstructions: {
            exists: true,
            path: "docs/coding-standards/git-commit.md",
            requiredPath: "docs/coding-standards/git-commit.md",
            misplacedPaths: [],
          },
        },
      },
      fs: stubFS({
        readFile: (path) => evidenceFiles[path] ?? null,
      }),
    });
    const { scope, concerns } = computeHarness(ctx);
    const metric = scope.checks.find(
      (c) => c.id === "post-turn-hook-integrity",
    )!;
    const expectedVerificationMetricCount = 2;
    const expectedScoreOnlyVerificationScore = 75;
    assert.equal(metric.status, "fail");
    assert.equal(metric.displayStatus, "warn");
    assert.equal(metric.impact, "score-only");
    assert.match(metric.failure?.evidence ?? "", /Metric/);
    assert.equal(
      concerns.verification.metrics,
      expectedVerificationMetricCount,
    );
    assert.equal(concerns.verification.advisoryFail, 0);
    assert.equal(concerns.verification.status, "pass");
    assert.equal(
      concerns.verification.score,
      expectedScoreOnlyVerificationScore,
    );
    assert.ok(
      concerns.verification.limits.some((limit) =>
        limit.includes("No post-turn hooks installed"),
      ),
      JSON.stringify(concerns.verification.limits),
    );
    assert.ok(
      concerns.verification.recommendations.some((recommendation) =>
        recommendation.includes("project-specific post-turn validation hook"),
      ),
      JSON.stringify(concerns.verification.recommendations),
    );
  });
});

describe("Audit scoring model", () => {
  it("non-json audit renderers ignore structured details", () => {
    const { scope } = computeHarness(makeCtx());
    const reportWithDetails = makeReportWithDetails(scope);
    const reportWithoutDetails = makeReportWithDetails({
      ...scope,
      checks: scope.checks.map((check) => {
        const next = { ...check };
        delete next.details;
        return next;
      }),
    });

    assert.equal(
      renderAuditMarkdown(reportWithDetails),
      renderAuditMarkdown(reportWithoutDetails),
    );
    assert.equal(
      renderAuditText(reportWithDetails),
      renderAuditText(reportWithoutDetails),
    );
    assert.equal(
      renderAuditSarif(reportWithDetails),
      renderAuditSarif(reportWithoutDetails),
    );
  });
});

describe("Audit scoring model", () => {
  it("old audit fixtures without details still render as json", () => {
    const { scope } = computeHarness(makeCtx());
    const reportWithoutDetails = makeReportWithDetails({
      ...scope,
      checks: scope.checks.map((check) => {
        const next = { ...check };
        delete next.details;
        return next;
      }),
    });
    const parsed = JSON.parse(renderAuditJson(reportWithoutDetails));

    assert.equal(
      parsed.scopes.harness.checks.some(
        (check: { details?: unknown }) => check.details !== undefined,
      ),
      false,
    );
  });
});

describe("Audit scoring model", () => {
  it("script-only secret coverage passes with limited assurance", () => {
    const baseHooks = stubAgentFacts().hooks;
    const hooks = {
      ...baseHooks,
      readDenyCoversSecrets: false,
      bashDenyCoversSecrets: true,
      denyBlocksPipeToShell: true,
      denyRegisteredPath: PROFILES.copilot.denyHookFile,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({
      agents: [stubAgentFacts({ agent: PROFILES.copilot, hooks })],
    });
    const { scope, concerns } = computeHarness(ctx);
    const secrets = scope.checks.find((c) => c.id === "deny-covers-secrets");
    const expectedFullConstraintScore = 100;

    assert.equal(secrets?.status, "pass");
    assert.equal(secrets?.displayStatus, "info");
    assert.equal(secrets?.impact, "none");
    assert.equal(secrets?.assurance, "limited");
    assert.equal(concerns.constraints.status, "pass");
    assert.equal(concerns.constraints.score, expectedFullConstraintScore);
    assert.ok(
      concerns.constraints.findings.some((finding) =>
        finding.includes("file-read deny is unavailable"),
      ),
    );
  });
});

describe("Audit scoring model", () => {
  it("unacknowledged advisory fail flips concern.status to fail", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({ agents: [stubAgentFacts({ hooks })] });
    const { concerns } = computeHarness(ctx);
    // deny-blocks-pipe-to-shell is advisory + constraints concern.
    assert.equal(concerns.constraints.status, "fail");
    assert.equal(concerns.constraints.advisoryFail, 1);
    assert.equal(concerns.constraints.advisoryAcknowledged, 0);
  });
});
