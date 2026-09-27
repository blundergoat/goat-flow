/**
 * Dashboard /api/quality prompt endpoint: returns 400 without an agent, emits mode-specific quality
 * prompts for a supported agent, uses cache-only audit enrichment when fast=true and reuses cached
 * audits unless fresh=true, and emits a redacted evidence envelope for the generated prompts.
 */
import { existsSync } from "node:fs";
import {
  assert,
  assertValidEmittedEnvelope,
  describe,
  expectRecord,
  fetchJson,
  it,
  join,
  makeDashboardCacheProject,
  mkdtemp,
  PROJECT_PATH,
  readEventEnvelopes,
  rm,
  tmpdir,
  writeProjectFile,
} from "./dashboard-server.helpers.js";
describe("dashboard /api/quality", () => {
  it("returns 400 without agent", async () => {
    const { res } = await fetchJson(
      `/api/quality?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 400);
  });

  it("returns mode-specific quality prompts", async () => {
    const { res, body } = await fetchJson(
      `/api/quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude&mode=skills`,
    );
    assert.equal(res.status, 200);

    const payload = expectRecord(body, "Quality mode response");
    assert.equal(payload.command, "quality");
    assert.equal(payload.agent, "claude");
    assert.match(
      String(payload.prompt),
      /# GOAT Flow Skills Assessment - Claude Code/,
    );
    assert.match(String(payload.prompt), /"quality_mode": "skills"/);
    assert.match(
      String(payload.auditSummary),
      /did not execute project build, test, lint, typecheck, or format commands/,
    );
    assert.match(
      String(payload.prompt),
      /did not execute project build, test, lint, typecheck, or format commands/,
    );
    assert.match(String(payload.auditSummary), /end-to-end resumability/);
    assert.match(String(payload.prompt), /end-to-end resumability/);
  });

  it("names a selected target only when the request sent one", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-quality-no-target-"));
    try {
      const { res, body } = await fetchJson(
        `/api/quality?path=${encodeURIComponent(root)}&agent=claude&mode=process&fast=true`,
      );
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Quality response without target");
      // An omitted target must not fall back to the server's own project and present it as a target the user chose.
      assert.equal(
        String(payload.prompt).includes("Selected target project"),
        false,
        "prompt names a selected target project the request never sent",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps mode evidence under the requested project when a target differs", async () => {
    const owningRoot = await mkdtemp(
      join(tmpdir(), "goat-flow-quality-owner-"),
    );
    const selectedRoot = await mkdtemp(
      join(tmpdir(), "goat-flow-quality-selected-"),
    );
    try {
      const { res, body } = await fetchJson(
        `/api/quality?path=${encodeURIComponent(owningRoot)}` +
          `&target=${encodeURIComponent(selectedRoot)}` +
          `&agent=claude&mode=process&fast=true`,
      );
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Cross-project quality response");
      // Callers resolve mode ownership before the request, so the audit, prior report, and event all belong to `path`.
      assert.ok(
        String(payload.prompt).includes(`- Project path: \`${owningRoot}\``),
        "prompt does not name the requested project as its own root",
      );
      // A reviewer inspecting a second project still needs to see which one they selected.
      assert.ok(
        String(payload.prompt).includes(
          `- Selected target project: \`${selectedRoot}\``,
        ),
        "prompt drops the separately selected target",
      );

      const owningEvents = await readEventEnvelopes(owningRoot);
      const selectedEvents = await readEventEnvelopes(selectedRoot);
      assert.equal(
        owningEvents.length,
        1,
        `expected one event under the requested project, found ${owningEvents.length}`,
      );
      // Recording under the selected target would attribute a controlling-workspace review to the user's project.
      assert.equal(
        selectedEvents.length,
        0,
        `recorded ${selectedEvents.length} event(s) under the selected target`,
      );
    } finally {
      await rm(owningRoot, { recursive: true, force: true });
      await rm(selectedRoot, { recursive: true, force: true });
    }
  });

  it("uses cache-only audit enrichment when fast=true is requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-quality-fast-"));
    try {
      const { res, body } = await fetchJson(
        `/api/quality?path=${encodeURIComponent(root)}&agent=claude&fast=true`,
      );
      assert.equal(res.status, 200);

      const payload = expectRecord(body, "Fast quality response");
      assert.equal(payload.command, "quality");
      assert.equal(payload.agent, "claude");
      assert.equal(payload.auditStatus, "unavailable");
      assert.match(String(payload.prompt), /Audit: NOT LOADED/);
      assert.match(String(payload.prompt), /fast quality prompt/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits a redacted evidence envelope for generated quality prompts", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-quality-events-"));
    try {
      const { res, body } = await fetchJson(
        `/api/quality?path=${encodeURIComponent(root)}&agent=claude&fast=true`,
      );
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Quality event response");
      const prompt = String(payload.prompt);

      const envelopes = await readEventEnvelopes(root);
      const event = envelopes.find(
        (candidate) => candidate.event_kind === "quality.prompt",
      );
      assert.ok(event, "quality prompt request should emit an event envelope");
      assertValidEmittedEnvelope(event);
      assert.equal(JSON.stringify(event).includes(prompt), false);

      const eventPayload = expectRecord(event.payload, "Quality event payload");
      const redactedPrompt = expectRecord(
        eventPayload.prompt,
        "Quality event payload.prompt",
      );
      assert.equal(redactedPrompt.kind, "redacted");
      assert.equal(redactedPrompt.label, "quality prompt");
      assert.equal(typeof redactedPrompt.sha256, "string");
      assert.equal(typeof redactedPrompt.length, "number");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses cached quality audits unless fresh=true is requested", async () => {
    // Issue one quality request and hand back its parsed body for assertions.
    const runQualityRequest = async (
      suffix: string,
    ): Promise<Record<string, unknown>> => {
      const { res, body } = await fetchJson(
        `/api/quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude${suffix}`,
      );
      assert.equal(res.status, 200);
      return expectRecord(body, "Quality cache response");
    };

    const first = await runQualityRequest("&fresh=true");
    const second = await runQualityRequest("");
    const third = await runQualityRequest("&fresh=true");

    assert.equal(first.command, "quality");
    assert.equal(second.command, "quality");
    assert.equal(third.command, "quality");
    assert.equal(first.agent, "claude");
    assert.equal(second.agent, "claude");
    assert.equal(third.agent, "claude");
    assert.equal(first.prompt, second.prompt);
    assert.equal(first.prompt, third.prompt);
    assert.equal(first.auditCacheStatus, "bypass");
    assert.equal(second.auditCacheStatus, "hit");
    assert.equal(third.auditCacheStatus, "bypass");
  });

  it("does not execute selected-project hook launcher in /api/quality", async () => {
    const project = await makeDashboardCacheProject();
    const markerPath = join(project.root, "launcher-executed.marker");
    try {
      // The selected project configures a launcher that records execution
      // before delegating to the managed script. Quality prompt generation is
      // passive on every cache path, so none of miss, hit, or fresh bypass may
      // run the audited checkout's configured command.
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

      // Issue one quality request against this server and hand back its parsed body.
      const requestQuality = async (
        suffix: string,
      ): Promise<Record<string, unknown>> => {
        const { res, body } = await fetchJson(
          `/api/quality?path=${encodeURIComponent(project.root)}&agent=codex${suffix}`,
        );
        assert.equal(res.status, 200);
        return expectRecord(body, "Quality marker response");
      };

      const miss = await requestQuality("");
      assert.equal(miss.auditCacheStatus, "miss");
      assert.equal(
        existsSync(markerPath),
        false,
        "quality audit cache miss must not execute the configured hook launcher",
      );

      const hit = await requestQuality("");
      assert.equal(hit.auditCacheStatus, "hit");
      assert.equal(
        existsSync(markerPath),
        false,
        "quality audit cache hit must not execute the configured hook launcher",
      );

      const bypass = await requestQuality("&fresh=true");
      assert.equal(bypass.auditCacheStatus, "bypass");
      assert.equal(
        existsSync(markerPath),
        false,
        "quality fresh bypass must not execute the configured hook launcher",
      );

      // Schema stays stable while runtime execution is skipped.
      assert.equal(miss.command, "quality");
      assert.equal(miss.agent, "codex");
      assert.equal(typeof miss.prompt, "string");
      assert.ok(String(miss.prompt).length > 100);
    } finally {
      await project.cleanup();
    }
  });

  it("generates quality output for claude", async () => {
    const { res, body } = await fetchJson(
      `/api/quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude`,
    );
    assert.equal(res.status, 200);

    const payload = expectRecord(body, "Quality response");
    assert.equal(payload.command, "quality");
    assert.equal(payload.agent, "claude");
    assert.match(String(payload.auditStatus), /^(pass|fail|unavailable)$/);
    assert.equal(typeof payload.auditSummary, "string");
    assert.equal(typeof payload.prompt, "string");
    assert.ok(String(payload.prompt).length > 100);
  });
});
