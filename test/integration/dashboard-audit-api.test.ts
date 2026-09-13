/**
 * Exercise the real dashboard Audit and Hooks endpoints against disposable projects.
 *
 * Check displayed report fields, cache freshness and read-only summaries across supported providers.
 * Hook POST cases verify request admission, exact replacement review and unchanged bytes after refusal.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import {
  assert,
  assertAuditScope,
  assertDashboardReport,
  AUDIT_VERSION,
  baseUrl,
  childProcess,
  commitDashboardCacheProject,
  describe,
  expectRecord,
  fetchJson,
  getAgentProfileMap,
  getKnownAgentIds,
  it,
  join,
  makeDashboardCacheProject,
  MISSING_PATH,
  mkdtemp,
  originalExecFileSync,
  performance,
  PROJECT_PATH,
  rm,
  runGit,
  setEnv,
  syncBuiltinESMExports,
  tmpdir,
  writeProjectFile,
} from "./dashboard-server.helpers.js";
import type { AgentId } from "../../src/cli/types.js";
describe("dashboard /api/audit", () => {
  /** Read dashboard profile spans from an endpoint response body. */
  function getProfileSpans(body: unknown): Record<string, unknown>[] {
    const report = expectRecord(body, "Profiled dashboard report");
    const profile = expectRecord(report._profile, "Dashboard profile");
    assert.equal(
      Array.isArray(profile.spans),
      true,
      "Dashboard profile spans should be an array",
    );
    return (profile.spans as unknown[]).map((spanEntry, index) =>
      expectRecord(spanEntry, `Dashboard profile spans[${index}]`),
    );
  }

  /** Count profile spans by name so tests can assert dashboard-summary batching. */
  function spanCount(spans: Record<string, unknown>[], name: string): number {
    return spans.filter((spanEntry) => spanEntry.name === name).length;
  }

  // Request one audit with profiling on, so the test can assert the span labels a developer sees in the timing panel.
  async function fetchProfiledAudit(
    projectPath: string,
    suffix = "",
  ): Promise<{
    ms: number;
    body: Record<string, unknown>;
  }> {
    const start = performance.now();
    const { res, body } = await fetchJson(
      `/api/audit?path=${encodeURIComponent(
        projectPath,
      )}&quality=true&profile=true${suffix}`,
    );
    const elapsedMs = performance.now() - start;
    assert.equal(res.status, 200);
    return {
      ms: elapsedMs,
      body: expectRecord(body, "Profiled audit response"),
    };
  }

  // Reduce a response to the keys the dashboard actually renders, so an added internal field cannot break the assertion.
  function dashboardReportSurface(
    report: Record<string, unknown>,
  ): Record<string, unknown> {
    const scopes = expectRecord(report.scopes, "Dashboard report scopes");
    const agentScores = (report.agentScores as unknown[]).map(
      (score, index) => {
        const entry = expectRecord(
          score,
          `Dashboard report agentScores[${index}]`,
        );
        const agent = expectRecord(
          entry.agent,
          `Dashboard report agentScores[${index}].agent`,
        );
        const harness =
          entry.harness === null
            ? null
            : expectRecord(
                entry.harness,
                `Dashboard report agentScores[${index}].harness`,
              );
        return {
          id: entry.id,
          hasAgent: Boolean(entry.agent),
          hasHarness: entry.harness !== null,
          hasConcerns: entry.concerns !== null,
          agentStatus: agent.status,
          harnessStatus: harness?.status ?? null,
        };
      },
    );
    return {
      status: report.status,
      target: report.target,
      overall: expectRecord(report.overall, "Dashboard report overall").status,
      hookCoverage: expectRecord(
        report.hookCoverage,
        "Dashboard report hookCoverage",
      ).status,
      setup: expectRecord(scopes.setup, "Dashboard report scopes.setup").status,
      agent: expectRecord(scopes.agent, "Dashboard report scopes.agent").status,
      harness: expectRecord(scopes.harness, "Dashboard report scopes.harness")
        .status,
      agentScores,
      hasLearningLoop: Object.prototype.hasOwnProperty.call(
        report,
        "learningLoop",
      ),
      hasRecentLessons: Object.prototype.hasOwnProperty.call(
        report,
        "recentLessons",
      ),
    };
  }

  /** Assert each dashboard agent score keeps the shape consumed by Home, Setup, and Quality views. */
  function dashboardScoresById(
    report: ReturnType<typeof assertDashboardReport>,
  ): Map<string, Record<string, unknown>> {
    const agentScores = report.agentScores as unknown[];
    assert.ok(agentScores.length > 0, "Dashboard report should include agents");
    const scoresById = new Map<string, Record<string, unknown>>();
    // Every agent card must retain the fields used by Home, Setup and Quality.
    for (const [index, score] of agentScores.entries()) {
      const entry = expectRecord(score, "Dashboard report agent score");
      const id = String(entry.id);
      scoresById.set(id, entry);
      assert.ok(getKnownAgentIds().includes(id as AgentId));
      assert.equal(entry.name, getAgentProfileMap()[id as AgentId].name);
      assertAuditScope(entry.agent, "Dashboard report agentScores[].agent");
      const enforcement = expectRecord(
        entry.enforcement,
        "Dashboard report agentScores[].enforcement",
      );
      assert.equal(enforcement.agent, id);
      assert.ok(
        Array.isArray(enforcement.capabilities),
        "Dashboard report should include enforcement capabilities",
      );
      // Null means this agent has no harness score; a present score must follow the displayed audit shape.
      if (entry.harness !== null) {
        assertAuditScope(
          entry.harness,
          `Dashboard report agentScores[${index}].harness`,
        );
      }
    }
    return scoresById;
  }

  /** Assert required agent ids are present without hiding the missing id in a bulk comparison. */
  function assertAgentScoresInclude(
    scoresById: Map<string, Record<string, unknown>>,
    ids: readonly string[],
  ): void {
    // Name each missing provider so a disappearing dashboard card produces an actionable failure.
    for (const id of ids) {
      assert.ok(scoresById.has(id), `Dashboard report should include ${id}`);
    }
  }

  /** Assert profiled summary responses preserve the per-agent dashboard surfaces. */
  function assertDashboardSummaryAgentCards(
    report: ReturnType<typeof assertDashboardReport>,
  ): void {
    const agentScores = report.agentScores as unknown[];
    assert.ok(
      agentScores.length > 0,
      "Dashboard summary should preserve per-agent cards",
    );
    // Every summary card needs agent, harness and concern evidence for its readiness display.
    for (const [index, score] of agentScores.entries()) {
      const entry = expectRecord(
        score,
        `Dashboard report agentScores[${index}]`,
      );
      assertAuditScope(
        entry.agent,
        `Dashboard report agentScores[${index}].agent`,
      );
      assertAuditScope(
        entry.harness,
        `Dashboard report agentScores[${index}].harness`,
      );
      assert.notEqual(
        entry.concerns,
        null,
        `Dashboard report agentScores[${index}].concerns should be present`,
      );
    }
  }

  it("includes all supported agents even when config lists one", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-dashboard-agents-"));
    try {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        `version: "${AUDIT_VERSION}"\nagents:\n  - claude\nskills:\n  install: all\n`,
      );
      await writeProjectFile(
        root,
        "CLAUDE.md",
        "# CLAUDE.md\n\n## Execution Loop\nREAD SCOPE ACT VERIFY\n\n## Router Table\n",
      );

      const { res, body } = await fetchJson(
        `/api/audit?path=${encodeURIComponent(root)}&quality=true&fresh=true`,
      );
      assert.equal(res.status, 200);
      const report = assertDashboardReport(body);
      assert.equal(report.status, "fail");
      const scopes = expectRecord(report.scopes, "Dashboard report scopes");
      const aggregateAgent = expectRecord(
        scopes.agent,
        "Dashboard aggregate agent scope",
      );
      assert.match(
        JSON.stringify(aggregateAgent),
        /Supported agent instruction files missing: codex \(AGENTS\.md\), antigravity \(AGENTS\.md\), copilot \(\.github\/copilot-instructions\.md\)/,
      );

      const agentScores = report.agentScores as unknown[];
      const scoreIds = agentScores.map((score, index) =>
        String(expectRecord(score, `Supported-agent score[${index}]`).id),
      );
      assert.deepEqual(scoreIds, ["claude", "codex", "antigravity", "copilot"]);

      const scoresById = dashboardScoresById(report);
      assertAgentScoresInclude(scoresById, [
        "claude",
        "codex",
        "antigravity",
        "copilot",
      ]);
      const codex = expectRecord(scoresById.get("codex"), "Codex score");
      const codexAgent = expectRecord(codex.agent, "Codex agent scope");
      assert.equal(codexAgent.status, "fail");
      assert.match(JSON.stringify(codexAgent), /Missing: codex \(AGENTS\.md\)/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("invalidates cached dashboard audits after instruction, hook, and lesson edits", async () => {
    const project = await makeDashboardCacheProject();
    const restoreEnv = setEnv({
      GOAT_FLOW_PACKAGED_MODE: "1",
      GOAT_FLOW_AUDIT_PROFILE: "1",
    });
    try {
      await fetchProfiledAudit(project.root, "&fresh=true");
      assert.equal((await fetchProfiledAudit(project.root)).body.cached, true);

      await writeProjectFile(project.root, "AGENTS.md", "# AGENTS.md\nBravo\n");
      const afterInstruction = await fetchProfiledAudit(project.root);
      assert.equal(afterInstruction.body.cached, false);
      assert.equal(
        spanCount(getProfileSpans(afterInstruction.body), "runAuditBatch"),
        1,
      );
      assert.equal((await fetchProfiledAudit(project.root)).body.cached, true);

      await writeProjectFile(
        project.root,
        ".goat-flow/hooks/deny-dangerous.sh",
        "#!/usr/bin/env bash\nexit 1\n",
      );
      const afterHook = await fetchProfiledAudit(project.root);
      assert.equal(afterHook.body.cached, false);
      assert.equal(
        spanCount(getProfileSpans(afterHook.body), "runAuditBatch"),
        1,
      );
      assert.equal((await fetchProfiledAudit(project.root)).body.cached, true);

      // Both new policy inputs must invalidate cached reports even when an edit preserves file size.
      for (const policyPath of [
        ".goat-flow/hooks/deny-git-mutations.sh",
        ".goat-flow/hooks/deny-dangerous/guard-runtime.sh",
      ]) {
        await writeProjectFile(project.root, policyPath, "# policy AAAA\n");
        await fetchProfiledAudit(project.root);
        assert.equal(
          (await fetchProfiledAudit(project.root)).body.cached,
          true,
        );
        await writeProjectFile(project.root, policyPath, "# policy BBBB\n");
        const afterPolicyEdit = await fetchProfiledAudit(project.root);
        assert.equal(afterPolicyEdit.body.cached, false, policyPath);
        assert.equal(
          spanCount(getProfileSpans(afterPolicyEdit.body), "runAuditBatch"),
          1,
        );
      }

      await writeProjectFile(
        project.root,
        ".goat-flow/learning-loop/lessons/cache.md",
        "# Lesson: Cache\nAAAA\n",
      );
      await fetchProfiledAudit(project.root);
      await writeProjectFile(
        project.root,
        ".goat-flow/learning-loop/lessons/cache.md",
        "# Lesson: Cache\nBBBB\n",
      );
      const afterLesson = await fetchProfiledAudit(project.root);
      assert.equal(afterLesson.body.cached, false);
      assert.equal(
        spanCount(getProfileSpans(afterLesson.body), "runAuditBatch"),
        1,
      );
    } finally {
      restoreEnv();
      await project.cleanup();
    }
  });

  it("keeps the dashboard audit cache as a gitignored local artifact", async () => {
    const project = await makeDashboardCacheProject();
    const restoreEnv = setEnv({
      GOAT_FLOW_PACKAGED_MODE: "1",
      GOAT_FLOW_AUDIT_PROFILE: "1",
    });
    try {
      commitDashboardCacheProject(project.root);

      const fresh = await fetchProfiledAudit(project.root, "&fresh=true");
      assert.equal(fresh.body.cached, false);
      assert.equal((await fetchProfiledAudit(project.root)).body.cached, true);

      const status = runGit(project.root, [
        "status",
        "--short",
        "--untracked-files=all",
      ]);
      assert.equal(status, "");
    } finally {
      restoreEnv();
      await project.cleanup();
    }
  });

  it("returns 400 with JSON for a nonexistent project path", async () => {
    const { res, body } = await fetchJson(
      `/api/audit?path=${encodeURIComponent(MISSING_PATH)}`,
    );
    assert.equal(res.status, 400);

    const error = expectRecord(body, "Audit error");
    assert.equal(typeof error.error, "string");
  });

  it("returns a full dashboard report shape", async () => {
    const { res, body } = await fetchJson(
      `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 200);

    const report = assertDashboardReport(body);
    const scoresById = dashboardScoresById(report);
    assertAgentScoresInclude(scoresById, ["claude", "codex", "copilot"]);
  });

  it("returns the same effective hook states from audit and Hooks APIs", async () => {
    const auditResponse = await fetchJson(
      `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}&fresh=true`,
    );
    const hooksResponse = await fetchJson(
      `/api/hooks?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(auditResponse.res.status, 200);
    assert.equal(hooksResponse.res.status, 200);

    const dashboardReport = assertDashboardReport(auditResponse.body);
    const auditCoverage = expectRecord(
      dashboardReport.hookCoverage,
      "Dashboard report hookCoverage",
    );
    const hooksPayload = expectRecord(hooksResponse.body, "Hooks response");

    assert.equal(dashboardReport.status, "pass");
    assert.equal(auditCoverage.status, "warning");
    assert.deepEqual(auditCoverage.hooks, hooksPayload.hooks);
  });

  it("serves cache hits under budget without rerunning audit computation", async () => {
    const project = await makeDashboardCacheProject();
    const restoreEnv = setEnv({
      GOAT_FLOW_PACKAGED_MODE: "1",
      GOAT_FLOW_AUDIT_PROFILE: "1",
    });
    try {
      const fresh = await fetchProfiledAudit(project.root, "&fresh=true");
      assert.equal(fresh.body.cached, false);
      assert.ok(fresh.ms < 5000, `fresh audit took ${fresh.ms.toFixed(3)}ms`);

      const cached = await fetchProfiledAudit(project.root);
      assert.equal(cached.body.cached, true);
      assert.ok(cached.ms < 500, `cached audit took ${cached.ms.toFixed(3)}ms`);
      const spans = getProfileSpans(cached.body);
      assert.equal(spanCount(spans, "cache read"), 1);
      assert.equal(
        spanCount(spans, "runAuditBatch"),
        0,
        "cache hit should not run audit computation",
      );
    } finally {
      restoreEnv();
      await project.cleanup();
    }
  });

  it("with quality=true avoids deny hook self-tests during dashboard summary loads", async () => {
    let selfTestCalls = 0;
    childProcess.execFileSync = ((file, args, options) => {
      // Opening a summary must not execute the selected project's hook self-tests.
      if (
        Array.isArray(args) &&
        args.some((arg) => String(arg).startsWith("--self-test"))
      ) {
        selfTestCalls += 1;
        throw new Error(
          "dashboard summary should not run deny hook self-tests",
        );
      }
      return originalExecFileSync(file, args, options);
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();

    try {
      const { res } = await fetchJson(
        `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}&quality=true`,
      );
      assert.equal(res.status, 200);
      assert.equal(
        selfTestCalls,
        0,
        "dashboard summary should not run deny hook self-tests",
      );
    } finally {
      childProcess.execFileSync = originalExecFileSync;
      syncBuiltinESMExports();
    }
  });

  it("with quality=true includes harness concerns", async () => {
    const { res, body } = await fetchJson(
      `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}&quality=true`,
    );
    assert.equal(res.status, 200);

    const report = assertDashboardReport(body);
    const agentScores = report.agentScores as unknown[];
    const claude = agentScores
      .map((score) => expectRecord(score, "Dashboard report agent score"))
      .find((score) => score.id === "claude");

    assert.ok(claude, "Dashboard report should include Claude");
    assert.notEqual(
      claude.concerns,
      null,
      "Harness concerns should be present",
    );

    const concerns = expectRecord(
      claude.concerns,
      "Dashboard report agentScores[].concerns",
    );
    // Every concern card receives the arrays it needs before Home or Quality chooses what to show.
    for (const concern of Object.values(concerns)) {
      const entry = expectRecord(concern, "Harness concern");
      assert.match(String(entry.status), /^(pass|fail)$/);
      assert.equal(typeof entry.score, "number");
      assert.ok(Array.isArray(entry.findings));
      assert.ok(Array.isArray(entry.limits));
      assert.ok(Array.isArray(entry.recommendations));
      assert.ok(Array.isArray(entry.howToFix));
    }

    const verification = expectRecord(
      concerns.verification,
      "Dashboard Verification concern",
    );
    const recovery = expectRecord(
      concerns.recovery,
      "Dashboard Recovery concern",
    );
    assert.ok(
      (verification.limits as unknown[]).some((limit) =>
        String(limit).includes("did not execute project build, test, lint"),
      ),
    );
    assert.ok(
      (recovery.limits as unknown[]).some((limit) =>
        String(limit).includes("end-to-end resumability"),
      ),
    );
  });

  it("does not execute selected-project hook launcher in /api/audit", async () => {
    const project = await makeDashboardCacheProject();
    const markerPath = join(project.root, "launcher-executed.marker");
    try {
      // Install the real shared policy dependencies so the HTTP case inspects a complete hook installation.
      for (const hookFile of [
        "deny-git-mutations.sh",
        "deny-dangerous/guard-runtime.sh",
      ]) {
        await writeProjectFile(
          project.root,
          `.goat-flow/hooks/${hookFile}`,
          readFileSync(join(PROJECT_PATH, "workflow/hooks", hookFile), "utf8"),
        );
      }
      // The selected project configures a launcher that records execution before delegating to the managed script. A passive per-agent audit must
      // never run it: the audited checkout's config is untrusted input.
      await writeProjectFile(
        project.root,
        ".codex/hooks.json",
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  {
                    type: "command",
                    command: `touch "${markerPath}"; bash .goat-flow/hooks/deny-dangerous.sh`,
                  },
                  {
                    type: "command",
                    command: `touch "${markerPath}"; bash .goat-flow/hooks/deny-git-mutations.sh`,
                  },
                ],
              },
            ],
          },
        }),
      );

      const { res, body } = await fetchJson(
        `/api/audit?path=${encodeURIComponent(project.root)}&agent=codex&quality=true&fresh=true`,
      );
      assert.equal(res.status, 200);
      assert.equal(
        existsSync(markerPath),
        false,
        "passive /api/audit must not execute the selected project's configured hook launcher",
      );

      const report = assertDashboardReport(body);
      const codex = (report.agentScores as unknown[])
        .map((score) => expectRecord(score, "Dashboard report agent score"))
        .find((score) => score.id === "codex");
      assert.ok(codex, "per-agent audit should include the codex score");
      const enforcement = expectRecord(codex.enforcement, "Codex enforcement");
      const selfTest = (enforcement.capabilities as unknown[])
        .map((entry) => expectRecord(entry, "Codex enforcement capability"))
        .find((entry) => entry.id === "hook-self-test");
      assert.ok(selfTest, "enforcement should report the hook-self-test row");
      assert.equal(selfTest.status, "limited");
      assert.equal(selfTest.assurance, "static-local");
      assert.match(
        String(selfTest.summary),
        /runtime self-test was skipped/,
        "static evidence copy should say the runtime self-test was skipped",
      );
    } finally {
      await project.cleanup();
    }
  });

  it("with quality=true uses dashboard-summary facts without changing the shared report surface", async () => {
    const restoreEnv = setEnv({ GOAT_FLOW_AUDIT_PROFILE: "1" });
    try {
      const baseline = await fetchJson(
        `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}&quality=true&fresh=true`,
      );
      assert.equal(baseline.res.status, 200);
      const baselineReport = assertDashboardReport(baseline.body);

      const profiled = await fetchJson(
        `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}&quality=true&fresh=true&profile=true`,
      );
      assert.equal(profiled.res.status, 200);
      const profiledReport = assertDashboardReport(profiled.body);

      assert.deepEqual(
        dashboardReportSurface(profiledReport),
        dashboardReportSurface(baselineReport),
        "Profiled summary route should preserve the Home/Setup/Quality report surface",
      );

      assertDashboardSummaryAgentCards(profiledReport);

      const spans = getProfileSpans(profiled.body);
      assert.equal(
        spanCount(spans, "detectStack"),
        0,
        "dashboard-summary route should not call detectStack",
      );
      assert.equal(
        spanCount(spans, "aggregate facts"),
        1,
        "dashboard-summary route should extract project-wide facts once",
      );
      assert.equal(
        spanCount(spans, "per-agent facts"),
        0,
        "dashboard-summary route should reuse shared facts for agent cards",
      );
    } finally {
      restoreEnv();
    }
  });
});

describe("dashboard guarded hook actions", () => {
  it("syncs the selected project, requires exact replacement, and returns every affected row", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "goat-flow-hook-api-"));
    try {
      await writeProjectFile(projectPath, ".claude/settings.json", "{}\n");
      const endpoint = `/api/hooks?path=${encodeURIComponent(projectPath)}`;
      const synced = await fetchJson(endpoint, { method: "POST", body: "{}" });
      assert.equal(synced.res.status, 200);
      const rows = expectRecord(synced.body, "Synced hooks").hooks as Array<
        Record<string, unknown>
      >;
      assert.ok(rows.length > 0);
      const toggleEndpoint = `/api/hooks/deny-dangerous/toggle?path=${encodeURIComponent(projectPath)}`;
      const disabled = await fetchJson(toggleEndpoint, {
        method: "POST",
        body: JSON.stringify({ enabled: false }),
      });
      assert.equal(disabled.res.status, 200);
      const disabledBody = expectRecord(disabled.body, "Disabled hook");
      assert.equal(
        expectRecord(disabledBody.hook, "Compatible hook response").enabled,
        false,
      );
      assert.equal((disabledBody.hooks as unknown[]).length, rows.length);

      const sharedPath = join(
        projectPath,
        ".goat-flow/hooks/deny-dangerous/guard-runtime.sh",
      );
      const officialBytes = readFileSync(sharedPath, "utf-8");
      writeFileSync(
        sharedPath,
        `${officialBytes}\n# local hook customization\n`,
      );
      const reviewResponse = await fetchJson(toggleEndpoint, {
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      });
      assert.equal(reviewResponse.res.status, 409);
      const review = expectRecord(reviewResponse.body, "Replacement review");
      assert.equal(review.code, "hook-replacement-required");
      assert.equal(review.replacementAvailable, true);
      assert.deepEqual(review.hookIds, [
        "deny-dangerous",
        "deny-git-mutations",
      ]);
      assert.match(String(review.confirmationIdentity), /^[a-f0-9]{64}$/u);
      const savedChoices = readFileSync(
        join(projectPath, ".goat-flow/config.yaml"),
        "utf-8",
      );

      // A second editor save while the user reviews the dialog must invalidate its earlier approval.
      writeFileSync(sharedPath, `${officialBytes}\n# revised customization\n`);
      const stale = await fetchJson(toggleEndpoint, {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          replace: true,
          confirmationIdentity: review.confirmationIdentity,
        }),
      });
      assert.equal(stale.res.status, 409);
      const freshReview = expectRecord(stale.body, "Fresh replacement review");
      assert.equal(freshReview.code, "hook-review-stale");
      assert.equal(
        readFileSync(join(projectPath, ".goat-flow/config.yaml"), "utf-8"),
        savedChoices,
      );
      const replaced = await fetchJson(toggleEndpoint, {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          replace: true,
          confirmationIdentity: freshReview.confirmationIdentity,
        }),
      });
      assert.equal(replaced.res.status, 200);
      assert.equal(readFileSync(sharedPath, "utf-8"), officialBytes);
      assert.equal(
        expectRecord(
          expectRecord(replaced.body, "Replaced hooks").hook,
          "Enabled hook",
        ).enabled,
        true,
      );
      const refreshed = await fetchJson(endpoint);
      assert.deepEqual(
        expectRecord(replaced.body, "All changed rows").hooks,
        expectRecord(refreshed.body, "Current rows").hooks,
      );
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it("rejects malformed or unauthorized hook writes without changing the selected project", async () => {
    const projectPath = await mkdtemp(
      join(tmpdir(), "goat-flow-hook-request-"),
    );
    try {
      await writeProjectFile(projectPath, ".claude/settings.json", "{}\n");
      const endpoint = `/api/hooks?path=${encodeURIComponent(projectPath)}`;
      const original = hookApiFileSnapshot(projectPath);
      const rejectedRequests = [
        { endpoint, body: "{" },
        { endpoint, body: "[]" },
        {
          endpoint,
          body: JSON.stringify({ paths: [".claude/settings.json"] }),
        },
        { endpoint, body: JSON.stringify({ replace: false }) },
        { endpoint, body: JSON.stringify({ replace: true }) },
        {
          endpoint,
          body: JSON.stringify({
            replace: true,
            confirmationIdentity: "old-review",
          }),
        },
        {
          endpoint: `/api/hooks/deny-dangerous/toggle?path=${encodeURIComponent(projectPath)}`,
          body: JSON.stringify({ enabled: "true" }),
        },
        {
          endpoint: `/api/hooks/%E0%A4%A/toggle?path=${encodeURIComponent(projectPath)}`,
          body: JSON.stringify({ enabled: true }),
        },
      ];
      // Client-supplied paths and incomplete approvals cannot authorize any destination write.
      for (const request of rejectedRequests) {
        const response = await fetchJson(request.endpoint, {
          method: "POST",
          body: request.body,
        });
        assert.equal(response.res.status, 400, request.body);
        assert.deepEqual(
          hookApiFileSnapshot(projectPath),
          original,
          request.body,
        );
      }
      const withoutToken = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        body: "{}",
      });
      assert.equal(withoutToken.status, 403);
      const hostileOrigin = await fetchJson(endpoint, {
        method: "POST",
        body: "{}",
        headers: { Origin: "https://example.invalid" },
      });
      assert.equal(hostileOrigin.res.status, 403);
      const missingTarget = await fetchJson(
        `/api/hooks?path=${encodeURIComponent(MISSING_PATH)}`,
        { method: "POST", body: "{}" },
      );
      assert.equal(missingTarget.res.status, 400);
      assert.deepEqual(hookApiFileSnapshot(projectPath), original);
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it("never offers replacement for newer hook files or invalid install history", async () => {
    const projectPath = await mkdtemp(
      join(tmpdir(), "goat-flow-hook-refusal-"),
    );
    try {
      await writeProjectFile(projectPath, ".claude/settings.json", "{}\n");
      const endpoint = `/api/hooks?path=${encodeURIComponent(projectPath)}`;
      assert.equal(
        (await fetchJson(endpoint, { method: "POST", body: "{}" })).res.status,
        200,
      );
      const hookPath = join(projectPath, ".goat-flow/hooks/deny-dangerous.sh");
      const officialBytes = readFileSync(hookPath, "utf-8");
      writeFileSync(
        hookPath,
        "#!/usr/bin/env bash\n# goat-flow-hook-version: 999.0.0\n",
      );
      const newerSnapshot = hookApiFileSnapshot(projectPath);
      const newer = await fetchJson(endpoint, {
        method: "POST",
        body: JSON.stringify({
          replace: true,
          confirmationIdentity: "0".repeat(64),
        }),
      });
      assert.equal(newer.res.status, 409);
      assert.equal(
        expectRecord(newer.body, "Newer hook refusal").replacementAvailable,
        false,
      );
      assert.deepEqual(hookApiFileSnapshot(projectPath), newerSnapshot);
      writeFileSync(hookPath, officialBytes);
      writeFileSync(
        join(projectPath, ".goat-flow/state/install/managed.json"),
        "{",
      );
      const invalidSnapshot = hookApiFileSnapshot(projectPath);
      const invalid = await fetchJson(endpoint, { method: "POST", body: "{}" });
      assert.equal(invalid.res.status, 409);
      assert.equal(
        expectRecord(invalid.body, "Invalid history refusal")
          .replacementAvailable,
        false,
      );
      assert.deepEqual(hookApiFileSnapshot(projectPath), invalidSnapshot);
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });
});

/** Capture selected-project bytes so a rejected browser request cannot hide a partial config or script write. */
function hookApiFileSnapshot(projectPath: string): Record<string, string> {
  const files: Record<string, string> = {};
  /** Walk only this disposable project; claim markers are coordination state, not admitted hook destinations. */
  function readDirectory(relativePath: string): void {
    // Record each visible destination so a late refusal cannot mask an earlier mutation.
    for (const entry of readdirSync(join(projectPath, relativePath), {
      withFileTypes: true,
    })) {
      const path = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      // Claim creation and owner-checked cleanup may happen during a refused operation.
      if (path === ".goat-flow/state/locks") continue;
      // Descend into fixture folders so a refusal cannot hide a changed nested hook file.
      if (entry.isDirectory()) readDirectory(path);
      else
        files[path] = readFileSync(join(projectPath, path)).toString("base64");
    }
  }
  readDirectory("");
  return files;
}
