/**
 * Unit tests for M08 evidence-envelope validation, redaction, writing, and tailing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  appendEvidenceEnvelope,
  createEvidenceEnvelope,
  tailEvidenceEvents,
  validateEvidenceEnvelope,
  type EvidenceEnvelope,
} from "../../src/cli/evidence/envelope.js";
import { redactEvidenceText } from "../../src/cli/evidence/redaction.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

/** Check framework-relative evidence paths against the live repo root. */
function frameworkPathExists(path: string): boolean {
  return existsSync(join(PROJECT_ROOT, path));
}

function withTempProject<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-evidence-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("EvidenceEnvelope", () => {
  it("adapts CheckEvidence and validates runtime envelope fields", () => {
    const envelope = createEvidenceEnvelope({
      eventKind: "audit.run",
      actor: "server",
      projectPath: PROJECT_ROOT,
      timestamp: "2026-05-17T01:02:03.000Z",
      payload: { status: "pass", cached: false },
    });

    assert.equal(envelope.source_type, "spec");
    assert.equal(envelope.verified_on, "2026-05-17");
    assert.equal(envelope.normative_level, "BEST_PRACTICE");
    assert.deepEqual(
      validateEvidenceEnvelope(envelope, frameworkPathExists),
      [],
    );
  });

  it("rejects raw sensitive payload fields unless they are redacted", () => {
    const envelope = createEvidenceEnvelope({
      eventKind: "quality.prompt",
      actor: "server",
      projectPath: PROJECT_ROOT,
      timestamp: "2026-05-17T01:02:03.000Z",
      payload: { prompt: "raw prompt text" },
    });

    assert.match(
      validateEvidenceEnvelope(envelope)[0] ?? "",
      /prompt.*redacted/i,
    );
  });

  it("redacts sensitive text as hash plus byte length", () => {
    const raw = "launch this prompt";
    const redacted = redactEvidenceText("terminal launch prompt", raw);

    assert.equal(redacted.kind, "redacted");
    assert.equal(redacted.label, "terminal launch prompt");
    assert.equal(redacted.length, Buffer.byteLength(raw, "utf-8"));
    assert.match(redacted.sha256, /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify(redacted), /launch this prompt/);

    const envelope = createEvidenceEnvelope({
      eventKind: "prompt.launch",
      actor: "server",
      projectPath: PROJECT_ROOT,
      timestamp: "2026-05-17T01:02:03.000Z",
      payload: { prompt: redacted },
    });
    assert.deepEqual(validateEvidenceEnvelope(envelope), []);
  });

  it("appends JSONL events and tails the newest validated envelopes", () => {
    withTempProject((root) => {
      const first = createEvidenceEnvelope({
        eventKind: "audit.run",
        actor: "server",
        projectPath: root,
        timestamp: "2026-05-17T00:00:00.000Z",
        payload: { status: "fail" },
      });
      const second = createEvidenceEnvelope({
        eventKind: "quality.prompt",
        actor: "server",
        projectPath: root,
        timestamp: "2026-05-17T00:01:00.000Z",
        payload: { prompt: redactEvidenceText("quality prompt", "secret") },
      });

      const firstResult = appendEvidenceEnvelope(root, first);
      const secondResult = appendEvidenceEnvelope(root, second);
      assert.equal(firstResult.ok, true);
      assert.equal(secondResult.ok, true);
      assert.ok(secondResult.path);
      assert.match(readFileSync(secondResult.path, "utf-8"), /quality\.prompt/);

      const tailed = tailEvidenceEvents(root, 1);
      assert.equal(tailed.length, 1);
      assert.equal(tailed[0]?.event_kind, "quality.prompt");
      assert.deepEqual(
        validateEvidenceEnvelope(tailed[0] as EvidenceEnvelope),
        [],
      );
    });
  });

  it("keeps append failures non-fatal", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".goat-flow", "logs"), { recursive: true });
      writeFileSync(join(root, ".goat-flow", "logs", "events"), "file");
      const warnings: string[] = [];
      const envelope = createEvidenceEnvelope({
        eventKind: "audit.run",
        actor: "server",
        projectPath: root,
        timestamp: "2026-05-17T00:00:00.000Z",
        payload: { status: "pass" },
      });

      const result = appendEvidenceEnvelope(root, envelope, {
        onWarning: (message) => warnings.push(message),
      });

      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /EEXIST|ENOTDIR|not a directory/i);
      assert.match(warnings[0] ?? "", /failed to append event/i);
    });
  });
});
