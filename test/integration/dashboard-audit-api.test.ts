/**
 * Dashboard /api/audit report endpoint: returns the full report shape covering all supported
 * agents regardless of config, keeps the audit cache a gitignored local artifact that invalidates
 * after instruction/hook/lesson edits yet serves cache hits under budget, and (with quality=true)
 * folds in harness concerns without running deny-hook self-tests or changing the shared report.
 */
import { existsSync } from "node:fs";
import {
  assert,
  assertAuditScope,
  assertDashboardReport,
  AUDIT_VERSION,
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
      // The selected project configures a launcher that records execution
      // before delegating to the managed script. A passive per-agent audit
      // must never run it: the audited checkout's config is untrusted input.
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
