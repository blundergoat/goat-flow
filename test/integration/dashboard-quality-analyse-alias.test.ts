/**
 * Dashboard /api/quality/analyse deprecated alias: scores a draft through the alias while emitting
 * Deprecation and Link headers (on success and on 400 responses), and returns 405 for non-POST.
 */
import {
  assert,
  describe,
  expectRecord,
  fetchJson,
  it,
} from "./dashboard-server.helpers.js";
describe("dashboard /api/quality/analyse (deprecated alias)", () => {
  const SKILL_DRAFT = [
    "---",
    "name: postgres-index",
    "description: Walk through a Postgres index change with explicit evidence gates.",
    "goat-flow-skill-version: 1.6.0",
    "---",
    "# /postgres-index",
    "",
    "## Step 0",
    "Read CLAUDE.md and the migration file.",
    "",
    "## Phase 1",
    "Plan the index change with downtime estimate.",
    "",
    "## Verification",
    "- [ ] Lock acquisition under 100ms in staging.",
  ].join("\n");

  it("scores via the alias and emits Deprecation + Link headers", async () => {
    const { res, body } = await fetchJson("/api/quality/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: SKILL_DRAFT, kind: "skill" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("deprecation"), "true");
    assert.match(
      String(res.headers.get("link") ?? ""),
      /\/api\/quality\/evaluate.*successor-version/,
    );
    const payload = expectRecord(body, "Alias evaluate result");
    assert.equal(typeof payload.totalScore, "number");
    assert.ok(Array.isArray(payload.metrics));
  });

  it("emits the Deprecation header on alias 400 responses too", async () => {
    const { res } = await fetchJson("/api/quality/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("deprecation"), "true");
  });

  it("returns 405 for non-POST on the alias", async () => {
    const { res } = await fetchJson("/api/quality/analyse");
    assert.equal(res.status, 405);
  });
});
