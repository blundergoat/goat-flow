/**
 * Dashboard /api/quality prompt endpoint: returns 400 without an agent, emits mode-specific quality
 * prompts for a supported agent, uses cache-only audit enrichment when fast=true and reuses cached
 * audits unless fresh=true, and emits a redacted evidence envelope for the generated prompts.
 */
import {
  assert,
  assertValidEmittedEnvelope,
  describe,
  expectRecord,
  fetchJson,
  it,
  join,
  mkdtemp,
  PROJECT_PATH,
  readEventEnvelopes,
  rm,
  tmpdir,
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

    const data = expectRecord(body, "Quality mode response");
    assert.equal(data.command, "quality");
    assert.equal(data.agent, "claude");
    assert.match(
      String(data.prompt),
      /# GOAT Flow Skills Assessment - Claude Code/,
    );
    assert.match(String(data.prompt), /"quality_mode": "skills"/);
    assert.match(
      String(data.auditSummary),
      /did not execute project build, test, lint, typecheck, or format commands/,
    );
    assert.match(
      String(data.prompt),
      /did not execute project build, test, lint, typecheck, or format commands/,
    );
    assert.match(String(data.auditSummary), /end-to-end resumability/);
    assert.match(String(data.prompt), /end-to-end resumability/);
  });

  it("uses cache-only audit enrichment when fast=true is requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-quality-fast-"));
    try {
      const { res, body } = await fetchJson(
        `/api/quality?path=${encodeURIComponent(root)}&agent=claude&fast=true`,
      );
      assert.equal(res.status, 200);

      const data = expectRecord(body, "Fast quality response");
      assert.equal(data.command, "quality");
      assert.equal(data.agent, "claude");
      assert.equal(data.auditStatus, "unavailable");
      assert.match(String(data.prompt), /Audit: NOT LOADED/);
      assert.match(String(data.prompt), /fast quality prompt/);
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
      const data = expectRecord(body, "Quality event response");
      const prompt = String(data.prompt);

      const envelopes = await readEventEnvelopes(root);
      const event = envelopes.find(
        (candidate) => candidate.event_kind === "quality.prompt",
      );
      assert.ok(event, "quality prompt request should emit an event envelope");
      assertValidEmittedEnvelope(event);
      assert.equal(JSON.stringify(event).includes(prompt), false);

      const payload = expectRecord(event.payload, "Quality event payload");
      const redactedPrompt = expectRecord(
        payload.prompt,
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

  it("generates quality output for claude", async () => {
    const { res, body } = await fetchJson(
      `/api/quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude`,
    );
    assert.equal(res.status, 200);

    const data = expectRecord(body, "Quality response");
    assert.equal(data.command, "quality");
    assert.equal(data.agent, "claude");
    assert.match(String(data.auditStatus), /^(pass|fail|unavailable)$/);
    assert.equal(typeof data.auditSummary, "string");
    assert.equal(typeof data.prompt, "string");
    assert.ok(String(data.prompt).length > 100);
  });
});
