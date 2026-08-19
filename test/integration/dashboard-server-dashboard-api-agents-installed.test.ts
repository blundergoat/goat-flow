/**
 * Dashboard /api/agents/installed detection: normalizeAgentVersionOutput strips trailing
 * punctuation and maps empty output to null, the default (non-fresh) route stays passive and never
 * spawns runner --version probes, and the response lists every known agent id and name.
 */
import {
  assert,
  childProcess,
  describe,
  expectRecord,
  fetchJson,
  getAgentProfileMap,
  getKnownAgentIds,
  it,
  normalizeAgentVersionOutput,
  originalExecFileSync,
  syncBuiltinESMExports,
} from "./dashboard-server.helpers.js";
import { normalizeAgentVersionOutput as normalizeAgentVersionOutputFromRoutes } from "../../src/cli/server/dashboard-routes.js";

describe("dashboard /api/agents/installed", () => {
  it("keeps the dashboard routes version-normalizer export aligned with the implementation", () => {
    assert.equal(
      normalizeAgentVersionOutputFromRoutes,
      normalizeAgentVersionOutput,
    );
  });

  it("normalizes trailing punctuation from one-line version output", () => {
    assert.equal(
      normalizeAgentVersionOutput("GitHub Copilot CLI 1.0.34.\n"),
      "GitHub Copilot CLI 1.0.34",
    );
    assert.equal(
      normalizeAgentVersionOutput("codex 1.2.3-beta.1\n"),
      "codex 1.2.3-beta.1",
    );
    assert.equal(normalizeAgentVersionOutput("\n"), null);
  });

  it("does not execute runner --version probes unless fresh detection is requested", async () => {
    let versionCalls = 0;
    childProcess.execFileSync = ((file, args, options) => {
      if (Array.isArray(args) && args.includes("--version")) {
        versionCalls += 1;
        throw new Error("default agent detection should be passive");
      }
      return originalExecFileSync(file, args, options);
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();

    try {
      const { res } = await fetchJson("/api/agents/installed");
      assert.equal(res.status, 200);
      assert.equal(versionCalls, 0);
    } finally {
      childProcess.execFileSync = originalExecFileSync;
      syncBuiltinESMExports();
    }
  });

  it("returns the supported agent list", async () => {
    const { res, body } = await fetchJson("/api/agents/installed");
    assert.equal(res.status, 200);

    const payload = expectRecord(body, "Agent detection response");
    assert.ok(Array.isArray(payload.agents));
    assert.equal(
      (payload.agents as unknown[]).length,
      getKnownAgentIds().length,
    );
    const ids = (payload.agents as Array<Record<string, unknown>>).map(
      (agent) => String(agent.id),
    );
    const names = (payload.agents as Array<Record<string, unknown>>).map(
      (agent) => String(agent.name),
    );
    assert.deepEqual(ids.sort(), [...getKnownAgentIds()].sort());
    assert.deepEqual(
      names.sort(),
      getKnownAgentIds()
        .map((id) => getAgentProfileMap()[id].name)
        .sort(),
    );
  });
});
