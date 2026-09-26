/**
 * Unit tests for evidence-envelope validation, redaction, writing, and tailing.
 */
import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  appendEvidenceEnvelope,
  createEvidenceEnvelope,
  tailEvidenceEvents,
  validateEvidenceEnvelope,
} from "../../src/cli/evidence/envelope.js";
import type {
  EvidenceEnvelope,
  EvidenceEventKind,
} from "../../src/cli/evidence/envelope.js";
import { redactEvidenceText } from "../../src/cli/evidence/redaction.js";
import { runConcurrentQualityWorkers } from "../helpers/concurrent-quality-workers.js";

/**
 * Hardlink `existingPath` to `linkPath`, or report the test as skipped when the
 * host filesystem refuses hardlinks.
 *
 * Stating the host-capability contract in one helper keeps a runtime capability
 * guard from reading like a committed focused or skipped test at the call site.
 *
 * @param testContext - Running test context used to record the skip reason.
 * @param existingPath - Existing file the hardlink should point at.
 * @param linkPath - Hardlink path this fixture writes.
 * @returns True when the caller must return early because the host filesystem
 *   blocks hardlinks; throws any error that is not a hardlink-capability refusal.
 */
function skipWhenHardlinksUnsupported(
  testContext: TestContext,
  existingPath: string,
  linkPath: string,
): boolean {
  try {
    linkSync(existingPath, linkPath);
    return false;
  } catch (error) {
    if (
      error instanceof Error &&
      ["EACCES", "EPERM", "EXDEV"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      testContext.skip("Skipped: host filesystem blocks hardlinks");
      return true;
    }
    throw error;
  }
}

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

const CURRENT_EVENT_KINDS = {
  "terminal.create": "terminal.create",
  "terminal.delete": "terminal.delete",
  "terminal.upload": "terminal.upload",
  "terminal.send": "terminal.send",
  "prompt.launch": "prompt.launch",
  "prompt.send": "prompt.send",
  "audit.exec": "audit.exec",
  "audit.run": "audit.run",
  "setup.prompt": "setup.prompt",
  "quality.prompt": "quality.prompt",
  "quality.persisted": "quality.persisted",
  "quality.rejected": "quality.rejected",
  "index.regenerate": "index.regenerate",
  "project.save": "project.save",
  "project.remove": "project.remove",
  "project.switch": "project.switch",
  "hook.verify": "hook.verify",
} satisfies Record<EvidenceEventKind, EvidenceEventKind>;

const FORBIDDEN_RAW_PAYLOAD_KEYS = [
  "prompt",
  "output",
  "terminal_output",
  "terminal_scrollback",
  "scrollback",
  "upload_content",
  "upload_data",
  "screenshot",
  "raw_json",
  "raw_html",
  "raw_tool_output",
  "tool_output",
] as const;

/** Check framework-relative evidence paths against the live repo root. */
function frameworkPathExists(path: string): boolean {
  return existsSync(join(PROJECT_ROOT, path));
}

/** Run one filesystem scenario in an isolated project and remove it afterward. */
function withTempProject<T>(scenario: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-evidence-"));
  try {
    return scenario(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Create a symlink, or skip when the host blocks unprivileged link fixtures.
 * It swallows that platform failure into a skip rather than a red test.
 */
function symlinkOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
  type?: "dir",
): boolean {
  try {
    symlinkSync(target, link, type);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      testContext.skip(
        "Skipped: host blocks unprivileged symlinks (Windows without Developer Mode)",
      );
      return false;
    }
    throw error;
  }
}

/** Return the validation message a producer sees after attempting to persist raw local evidence. */
function rawPayloadValidationMessage(
  eventType: EvidenceEventKind,
  forbiddenKey: (typeof FORBIDDEN_RAW_PAYLOAD_KEYS)[number],
): string {
  const envelope = createEvidenceEnvelope({
    eventType,
    actor: "server",
    projectRoot: PROJECT_ROOT,
    timestamp: "2026-05-17T01:02:03.000Z",
    payload: {
      producer_metadata: { [forbiddenKey]: "sensitive fixture value" },
    },
  });

  return validateEvidenceEnvelope(envelope)[0] ?? "";
}

describe("EvidenceEnvelope", () => {
  it("adapts CheckEvidence and validates runtime envelope fields", () => {
    const envelope = createEvidenceEnvelope({
      eventType: "audit.run",
      actor: "server",
      projectRoot: PROJECT_ROOT,
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
      eventType: "quality.prompt",
      actor: "server",
      projectRoot: PROJECT_ROOT,
      timestamp: "2026-05-17T01:02:03.000Z",
      payload: { prompt: "raw prompt text" },
    });

    assert.match(
      validateEvidenceEnvelope(envelope)[0] ?? "",
      /prompt.*redacted/i,
    );
  });

  describe("raw payload boundary", () => {
    // Each named case tells maintainers exactly which forbidden producer field regressed.
    for (const forbiddenKey of FORBIDDEN_RAW_PAYLOAD_KEYS) {
      // A representative event proves nested producer metadata follows the key policy.
      it(`rejects raw ${forbiddenKey} metadata`, () => {
        assert.match(
          rawPayloadValidationMessage("audit.run", forbiddenKey),
          new RegExp(`${forbiddenKey}.*redacted`, "iu"),
        );
      });
    }

    // Each named event case makes a future union addition visible in focused test output.
    for (const eventType of Object.values(CURRENT_EVENT_KINDS)) {
      // One representative forbidden key proves the event cannot bypass shared validation.
      it(`applies raw-content validation to ${eventType}`, () => {
        assert.match(
          rawPayloadValidationMessage(eventType, "raw_tool_output"),
          /raw_tool_output.*redacted/iu,
        );
      });
    }
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
      eventType: "prompt.launch",
      actor: "server",
      projectRoot: PROJECT_ROOT,
      timestamp: "2026-05-17T01:02:03.000Z",
      payload: { prompt: redacted },
    });
    assert.deepEqual(validateEvidenceEnvelope(envelope), []);
  });

  it("appends JSONL events and tails the newest validated envelopes", () => {
    withTempProject((root) => {
      const first = createEvidenceEnvelope({
        eventType: "audit.run",
        actor: "server",
        projectRoot: root,
        timestamp: "2026-05-17T00:00:00.000Z",
        payload: { status: "fail" },
      });
      const second = createEvidenceEnvelope({
        eventType: "quality.prompt",
        actor: "server",
        projectRoot: root,
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

  it("buckets daily event files by the process-local calendar date", () => {
    withTempProject((root) => {
      const childSource = `
        import { appendEvidenceEnvelope, createEvidenceEnvelope } from "./src/cli/evidence/envelope.js";
        const [projectRoot, timestamp] = process.argv.slice(1);
        const envelope = createEvidenceEnvelope({
          eventType: "plan.time",
          actor: "cli",
          projectRoot,
          timestamp,
        });
        const result = appendEvidenceEnvelope(projectRoot, envelope);
        process.stdout.write(JSON.stringify({ path: result.path, verifiedOn: envelope.verified_on }));
      `;
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          childSource,
          root,
          "2026-08-25T19:29:04.000Z",
        ],
        {
          cwd: PROJECT_ROOT,
          encoding: "utf-8",
          env: { ...process.env, TZ: "Australia/Melbourne" },
        },
      );

      assert.equal(child.status, 0, child.stderr);
      assert.deepEqual(JSON.parse(child.stdout), {
        path: join(root, ".goat-flow", "logs", "events", "2026-08-26.jsonl"),
        verifiedOn: "2026-08-25",
      });
    });
  });

  it("accepts concurrent event-directory creation only when the winner made a real directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-evidence-race-"));
    try {
      const outcomes = await runConcurrentQualityWorkers(
        "append-evidence",
        root,
      );

      assert.equal(outcomes.length, 2);
      assert.equal(outcomes[0]?.result.ok, true, JSON.stringify(outcomes[0]));
      assert.equal(outcomes[1]?.result.ok, true, JSON.stringify(outcomes[1]));
      const eventsDirectory = lstatSync(
        join(root, ".goat-flow", "logs", "events"),
      );
      assert.equal(eventsDirectory.isDirectory(), true);
      assert.equal(eventsDirectory.isSymbolicLink(), false);
      const events = tailEvidenceEvents(root, 10);
      assert.equal(events.length, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps append failures non-fatal", () => {
    withTempProject((root) => {
      mkdirSync(join(root, ".goat-flow", "logs"), { recursive: true });
      writeFileSync(join(root, ".goat-flow", "logs", "events"), "file");
      const warnings: string[] = [];
      const envelope = createEvidenceEnvelope({
        eventType: "audit.run",
        actor: "server",
        projectRoot: root,
        timestamp: "2026-05-17T00:00:00.000Z",
        payload: { status: "pass" },
      });

      const result = appendEvidenceEnvelope(root, envelope, {
        onWarning: (message) => warnings.push(message),
      });

      assert.equal(result.ok, false);
      assert.match(
        result.error ?? "",
        /EEXIST|ENOTDIR|not a directory|project-local directory/i,
      );
      assert.match(warnings[0] ?? "", /failed to append event/i);
    });
  });

  // Covers a symlinked events directory, because appending must never let writes escape the project.
  it("rejects a symlinked events directory without writing outside the project", (testContext) => {
    withTempProject((root) => {
      const outsideDirectory = mkdtempSync(
        join(tmpdir(), "goat-flow-evidence-outside-"),
      );
      try {
        mkdirSync(join(root, ".goat-flow", "logs"), { recursive: true });
        if (
          !symlinkOrSkip(
            testContext,
            outsideDirectory,
            join(root, ".goat-flow", "logs", "events"),
            "dir",
          )
        ) {
          return;
        }
        const envelope = createEvidenceEnvelope({
          eventType: "hook.verify",
          actor: "cli",
          projectRoot: root,
          timestamp: "2026-05-17T00:00:00.000Z",
          payload: { status: "unsupported" },
        });

        const result = appendEvidenceEnvelope(root, envelope, {
          onWarning: () => undefined,
        });

        assert.equal(result.ok, false);
        assert.deepEqual(readdirSync(outsideDirectory), []);
      } finally {
        rmSync(outsideDirectory, { recursive: true, force: true });
      }
    });
  });

  // Covers a symlinked daily event file, because appending writes must never change the symlink target.
  it("rejects a symlinked daily event file without changing its target", (testContext) => {
    withTempProject((root) => {
      const outsideDirectory = mkdtempSync(
        join(tmpdir(), "goat-flow-evidence-victim-"),
      );
      try {
        const eventsDirectory = join(root, ".goat-flow", "logs", "events");
        const victimPath = join(outsideDirectory, "victim.jsonl");
        mkdirSync(eventsDirectory, { recursive: true });
        writeFileSync(victimPath, "keep\n", "utf-8");
        if (
          !symlinkOrSkip(
            testContext,
            victimPath,
            join(eventsDirectory, "2026-05-17.jsonl"),
          )
        ) {
          return;
        }
        const envelope = createEvidenceEnvelope({
          eventType: "audit.run",
          actor: "server",
          projectRoot: root,
          timestamp: "2026-05-17T00:00:00.000Z",
          payload: { status: "pass" },
        });

        const result = appendEvidenceEnvelope(root, envelope, {
          onWarning: () => undefined,
        });

        assert.equal(result.ok, false);
        assert.equal(readFileSync(victimPath, "utf-8"), "keep\n");
      } finally {
        rmSync(outsideDirectory, { recursive: true, force: true });
      }
    });
  });

  // Covers a hardlinked daily event file, because appending writes must never change its peer.
  it("rejects a hardlinked daily event file without changing its peer", (testContext) => {
    withTempProject((root) => {
      const eventsDirectory = join(root, ".goat-flow", "logs", "events");
      const victimPath = join(root, "victim.jsonl");
      mkdirSync(eventsDirectory, { recursive: true });
      writeFileSync(victimPath, "keep\n", "utf-8");
      if (
        skipWhenHardlinksUnsupported(
          testContext,
          victimPath,
          join(eventsDirectory, "2026-05-17.jsonl"),
        )
      ) {
        return;
      }
      const envelope = createEvidenceEnvelope({
        eventType: "audit.run",
        actor: "server",
        projectRoot: root,
        timestamp: "2026-05-17T00:00:00.000Z",
        payload: { status: "pass" },
      });

      const result = appendEvidenceEnvelope(root, envelope, {
        onWarning: () => undefined,
      });

      assert.equal(result.ok, false);
      assert.equal(readFileSync(victimPath, "utf-8"), "keep\n");
    });
  });
});
