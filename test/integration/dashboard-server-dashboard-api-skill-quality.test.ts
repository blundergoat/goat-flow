/**
 * Dashboard /api/skill-quality endpoint: returns the project's artifact inventory (shared
 * references regardless of selected agent, drawing skill artifacts from the selected runner's
 * skills directory), scores a valid artifact with metrics and a prompt, and returns 404 for an
 * unknown artifact id or 400 when the artifact or agent param is missing.
 */
import {
  assert,
  describe,
  expectRecord,
  fetchJson,
  it,
  join,
  mkdtemp,
  PROJECT_PATH,
  rm,
  tmpdir,
  writeProjectFile,
} from "./dashboard-server.helpers.js";
describe("dashboard /api/skill-quality", () => {
  it("returns artifact inventory for the project", async () => {
    const { res, body } = await fetchJson(
      `/api/skill-quality/inventory?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude`,
    );
    assert.equal(res.status, 200);
    const payload = expectRecord(body, "Skill quality inventory");
    assert.ok(Array.isArray(payload.artifacts));
    const artifacts = payload.artifacts as Array<Record<string, unknown>>;
    assert.ok(
      artifacts.length >= 12,
      `expected at least 12 artifacts (skills + shared references), got ${artifacts.length}`,
    );
    assert.ok(artifacts.some((a) => a.kind === "skill"));
    assert.ok(artifacts.some((a) => a.kind === "shared-reference"));
    assert.ok(artifacts.some((a) => a.id === "skill:goat-plan"));
    assert.ok(artifacts.some((a) => a.id === "reference:browser-use"));
    assert.ok(artifacts.some((a) => a.id === "reference:skill-preamble"));
  });

  it("returns shared references regardless of selected agent", async () => {
    const { res, body } = await fetchJson(
      `/api/skill-quality/inventory?path=${encodeURIComponent(PROJECT_PATH)}&agent=codex`,
    );
    assert.equal(res.status, 200);
    const payload = expectRecord(body, "Skill quality inventory");
    const artifacts = payload.artifacts as Array<Record<string, unknown>>;
    assert.ok(artifacts.some((a) => a.id === "reference:browser-use"));
    assert.ok(artifacts.some((a) => a.id === "reference:skill-preamble"));
  });

  it("uses the selected runner skills directory for inventory", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-skill-runner-"));
    try {
      await writeProjectFile(
        root,
        ".claude/skills/claude-only/SKILL.md",
        "# Claude\n",
      );
      await writeProjectFile(
        root,
        ".agents/skills/codex-only/SKILL.md",
        "# Codex\n",
      );

      const { res, body } = await fetchJson(
        `/api/skill-quality/inventory?path=${encodeURIComponent(root)}&agent=codex`,
      );
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Skill quality inventory");
      const artifacts = payload.artifacts as Array<Record<string, unknown>>;
      assert.ok(artifacts.some((a) => a.id === "skill:codex-only"));
      assert.ok(!artifacts.some((a) => a.id === "skill:claude-only"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scores a valid artifact with metrics and prompt", async () => {
    const { res, body } = await fetchJson(
      `/api/skill-quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude&artifact=skill:goat-plan`,
    );
    assert.equal(res.status, 200);
    const payload = expectRecord(body, "Skill quality report");
    assert.equal(
      (payload.artifact as Record<string, unknown>).id,
      "skill:goat-plan",
    );
    assert.ok(typeof payload.totalScore === "number");
    assert.ok(typeof payload.maxTotalScore === "number");
    assert.equal(payload.subtype, "workflow");
    const expectedWorkflowProfileMax = 100;
    assert.equal(payload.profileMax, expectedWorkflowProfileMax);
    assert.ok(Array.isArray(payload.composedFrom));
    assert.ok(typeof payload.recommendation === "string");
    assert.ok(Array.isArray(payload.metrics));
    assert.ok(typeof payload.prompt === "string");
    assert.match(String(payload.prompt), /Quality Review/);
  });

  it("returns 404 for unknown artifact id", async () => {
    const { res, body } = await fetchJson(
      `/api/skill-quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude&artifact=skill:nonexistent`,
    );
    assert.equal(res.status, 404);
    const payload = expectRecord(body, "Skill quality 404");
    assert.match(String(payload.error), /not found/);
  });

  it("returns 400 when artifact param is missing", async () => {
    const { res } = await fetchJson(
      `/api/skill-quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude`,
    );
    assert.equal(res.status, 400);
  });

  it("returns 400 when agent param is missing", async () => {
    const { res } = await fetchJson(
      `/api/skill-quality/inventory?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 400);
  });
});
