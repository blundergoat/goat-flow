/**
 * Unit tests for the dashboard-owned staged-draft quality persistence
 * capture (ADR-044): draft acceptance, every rejection class, receipt
 * contents, filename filtering, dispose-time sweep, and handle hygiene.
 *
 * All processing is driven through `processNow()` with `stableMs: 0` so the
 * suite is deterministic and never waits on the poller interval; the interval
 * itself is unref'd and cleared by dispose, which the leak-sensitive terminal
 * test lesson requires this suite to prove.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureQualityDraftStagingDirectory,
  startQualityDraftCapture,
} from "../../src/cli/server/quality-draft-capture.js";
import type { QualityDraftCapture } from "../../src/cli/server/quality-draft-capture.js";

const PACKAGE_VERSION = (
  JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
).version;

/** Build one schema-valid minimal report owned by the given project root. */
function validReport(projectRoot: string): string {
  return JSON.stringify({
    report_kind: "goat-flow-quality-report",
    goat_flow_version: PACKAGE_VERSION,
    agent: "claude",
    project_path: realpathSync(projectRoot),
    run_date: "2026-07-31",
    audit_status: "pass",
    scope: "framework-self",
    rubric_version: PACKAGE_VERSION,
    quality_mode: "skills",
    prior_report_id: null,
    scores: {
      setup: {
        total: 0,
        accuracy: 0,
        relevance: 0,
        completeness: 0,
        friction: 0,
      },
      system: {
        total: 0,
        usefulness: 0,
        signal_to_noise: 0,
        adaptability: 0,
        learnability: 0,
      },
    },
    findings: [],
  });
}

/** Read and parse one staged receipt file. */
function readReceipt(
  stagingDir: string,
  nonce: string,
): { ok: boolean; reportPath?: string; error?: string } {
  return JSON.parse(
    readFileSync(
      join(stagingDir, `goat-quality-result-claude-${nonce}.json`),
      "utf8",
    ),
  ) as { ok: boolean; reportPath?: string; error?: string };
}

describe("quality draft capture", () => {
  const roots: string[] = [];
  const captures: QualityDraftCapture[] = [];

/** Create and track one temporary project root for capture cleanup after the suite. */
function makeRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "goat-quality-capture-"));
    roots.push(root);
    return root;
  }

/** Start and track one capture with deterministic polling disabled for direct test control. */
function makeCapture(root: string): QualityDraftCapture {
    const capture = startQualityDraftCapture({
      projectRoot: root,
      intervalMs: 60_000,
      stableMs: 0,
    });
    captures.push(capture);
    return capture;
  }

  after(() => {
    for (const capture of captures) capture.dispose();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it("creates the staging directory chain with a 0700 leaf", () => {
    const root = makeRoot();
    const stagingDir = ensureQualityDraftStagingDirectory(root);
    assert.equal(
      stagingDir,
      join(root, ".goat-flow", "logs", "quality", "staging"),
    );
    const mode = lstatSync(stagingDir).mode & 0o777;
    assert.equal(mode, 0o700);
    // Idempotent: a second ensure returns the same directory without throwing.
    assert.equal(ensureQualityDraftStagingDirectory(root), stagingDir);
  });

  it("tightens an existing permissive staging directory to 0700", (testContext) => {
    if (process.platform === "win32") {
      testContext.skip("POSIX mode bits are not enforceable on Windows");
      return;
    }
    const root = makeRoot();
    const stagingDir = ensureQualityDraftStagingDirectory(root);
    chmodSync(stagingDir, 0o777);

    ensureQualityDraftStagingDirectory(root);

    assert.equal(lstatSync(stagingDir).mode & 0o777, 0o700);
  });

  it("persists a valid draft, deletes it, and writes an ok receipt", async () => {
    const root = makeRoot();
    const capture = makeCapture(root);
    const draftPath = join(
      capture.stagingDir,
      "goat-quality-draft-claude-aaa111.json",
    );
    writeFileSync(draftPath, validReport(root));

    await capture.processNow();

    assert.equal(existsSync(draftPath), false);
    const receipt = readReceipt(capture.stagingDir, "aaa111");
    assert.equal(receipt.ok, true);
    assert.ok(receipt.reportPath);
    assert.ok(existsSync(receipt.reportPath ?? ""));
    const persisted = JSON.parse(
      readFileSync(receipt.reportPath ?? "", "utf8"),
    ) as { agent: string };
    assert.equal(persisted.agent, "claude");
    assert.match(
      receipt.reportPath ?? "",
      /\.goat-flow\/logs\/quality\/\d{4}-\d{2}-\d{2}-\d{4}-claude-[0-9a-f]{5}\.json$/u,
    );
  });

  it("disables the mtime gate when the stability window is zero", async () => {
    const root = makeRoot();
    const capture = makeCapture(root);
    const draftPath = join(
      capture.stagingDir,
      "goat-quality-draft-claude-future-mtime.json",
    );
    writeFileSync(draftPath, "{}");
    const future = new Date(Date.now() + 60_000);
    utimesSync(draftPath, future, future);

    await capture.processNow();

    assert.equal(existsSync(draftPath), false);
    assert.equal(readReceipt(capture.stagingDir, "future-mtime").ok, false);
  });

  it("rejects invalid JSON with a draft-labelled error and deletes the draft", async () => {
    const root = makeRoot();
    const capture = makeCapture(root);
    const sensitiveValue = ["fixture", "-sensitive", "-value"].join("");
    const sensitivePrefix = sensitiveValue.slice(0, 10);
    const draftPath = join(
      capture.stagingDir,
      "goat-quality-draft-claude-bbb222.json",
    );
    writeFileSync(draftPath, `{"detail":${sensitiveValue}}`);

    await capture.processNow();

    assert.equal(existsSync(draftPath), false);
    const receipt = readReceipt(capture.stagingDir, "bbb222");
    assert.equal(receipt.ok, false);
    assert.equal(
      receipt.error,
      "quality capture: draft contains invalid JSON.",
    );
    assert.equal((receipt.error ?? "").includes(sensitivePrefix), false);

    const eventsDir = join(root, ".goat-flow", "logs", "events");
    const eventText = readdirSync(eventsDir)
      .map((name) => readFileSync(join(eventsDir, name), "utf8"))
      .join("\n");
    assert.equal(eventText.includes(sensitivePrefix), false);
    assert.match(eventText, /"raw_json":\{"kind":"redacted"/u);
  });

  it("refuses pre-existing symlink and multiply linked receipt destinations", async (testContext) => {
    if (process.platform === "win32") {
      testContext.skip("Link fixtures require POSIX link semantics");
      return;
    }
    const root = makeRoot();
    const capture = makeCapture(root);

    const symlinkNonce = "receipt111";
    const symlinkTarget = join(root, "symlink-target.txt");
    const symlinkReceipt = join(
      capture.stagingDir,
      `goat-quality-result-claude-${symlinkNonce}.json`,
    );
    writeFileSync(symlinkTarget, "symlink marker");
    symlinkSync(symlinkTarget, symlinkReceipt);
    writeFileSync(
      join(
        capture.stagingDir,
        `goat-quality-draft-claude-${symlinkNonce}.json`,
      ),
      validReport(root),
    );

    await assert.doesNotReject(capture.processNow());
    assert.equal(readFileSync(symlinkTarget, "utf8"), "symlink marker");
    assert.equal(lstatSync(symlinkReceipt).isFile(), true);
    assert.equal(lstatSync(symlinkReceipt).nlink, 1);
    assert.deepStrictEqual(readReceipt(capture.stagingDir, symlinkNonce), {
      ok: false,
      error: "quality capture: receipt destination already existed.",
    });

    const hardLinkNonce = "receipt222";
    const hardLinkTarget = join(root, "hard-link-target.txt");
    const hardLinkReceipt = join(
      capture.stagingDir,
      `goat-quality-result-claude-${hardLinkNonce}.json`,
    );
    writeFileSync(hardLinkTarget, "hard-link marker");
    linkSync(hardLinkTarget, hardLinkReceipt);
    writeFileSync(
      join(
        capture.stagingDir,
        `goat-quality-draft-claude-${hardLinkNonce}.json`,
      ),
      validReport(root),
    );

    await assert.doesNotReject(capture.processNow());
    assert.equal(readFileSync(hardLinkTarget, "utf8"), "hard-link marker");
    assert.equal(lstatSync(hardLinkReceipt).isFile(), true);
    assert.equal(lstatSync(hardLinkReceipt).nlink, 1);
    assert.deepStrictEqual(readReceipt(capture.stagingDir, hardLinkNonce), {
      ok: false,
      error: "quality capture: receipt destination already existed.",
    });
    const reports = readdirSync(
      join(root, ".goat-flow", "logs", "quality"),
    ).filter((name) => name.endsWith(".json"));
    assert.deepStrictEqual(reports, []);
  });

  it("rejects schema violations through the shared quality save core", async () => {
    const root = makeRoot();
    const capture = makeCapture(root);
    const sensitiveValue = ["fixture", "-schema-key-secret"].join("");
    writeFileSync(
      join(capture.stagingDir, "goat-quality-draft-claude-ccc333.json"),
      JSON.stringify({ [`API_KEY=${sensitiveValue}`]: true }),
    );

    await capture.processNow();

    const receipt = readReceipt(capture.stagingDir, "ccc333");
    assert.equal(receipt.ok, false);
    assert.equal(
      receipt.error,
      "quality capture: draft failed schema validation.",
    );
    const eventText = readdirSync(join(root, ".goat-flow", "logs", "events"))
      .map((name) =>
        readFileSync(join(root, ".goat-flow", "logs", "events", name), "utf8"),
      )
      .join("\n");
    assert.equal(eventText.includes(sensitiveValue), false);
    assert.match(eventText, /"raw_json":\{"kind":"redacted"/u);
  });

  it("rejects a report owned by a different project", async () => {
    const root = makeRoot();
    const otherRoot = makeRoot();
    const capture = makeCapture(root);
    writeFileSync(
      join(capture.stagingDir, "goat-quality-draft-claude-ddd444.json"),
      validReport(otherRoot),
    );

    await capture.processNow();

    const receipt = readReceipt(capture.stagingDir, "ddd444");
    assert.equal(receipt.ok, false);
    assert.equal(
      receipt.error,
      "quality capture: draft failed report ownership validation.",
    );
  });

  it("rejects oversized drafts without reading them", async () => {
    const root = makeRoot();
    const capture = makeCapture(root);
    const draftPath = join(
      capture.stagingDir,
      "goat-quality-draft-claude-eee555.json",
    );
    writeFileSync(draftPath, "x".repeat(2 * 1024 * 1024 + 1));

    await capture.processNow();

    assert.equal(existsSync(draftPath), false);
    const receipt = readReceipt(capture.stagingDir, "eee555");
    assert.equal(receipt.ok, false);
    assert.match(receipt.error ?? "", /byte limit/u);
  });

  it("ignores files outside the draft name contract and symlinked drafts", async () => {
    const root = makeRoot();
    const capture = makeCapture(root);
    const stray = join(capture.stagingDir, "notes.json");
    const badName = join(
      capture.stagingDir,
      "goat-quality-draft-claude-UP$ER.json",
    );
    const linkTarget = join(root, "outside.json");
    const link = join(
      capture.stagingDir,
      "goat-quality-draft-claude-fff666.json",
    );
    writeFileSync(stray, "{}");
    writeFileSync(badName, "{}");
    writeFileSync(linkTarget, validReport(root));
    symlinkSync(linkTarget, link);

    await capture.processNow();

    assert.equal(existsSync(stray), true);
    assert.equal(existsSync(badName), true);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(
      existsSync(
        join(capture.stagingDir, "goat-quality-result-claude-fff666.json"),
      ),
      false,
    );
  });

  it("processes a corrected second draft after a rejection", async () => {
    const root = makeRoot();
    const capture = makeCapture(root);
    writeFileSync(
      join(capture.stagingDir, "goat-quality-draft-claude-ggg777.json"),
      "{}",
    );
    await capture.processNow();
    assert.equal(readReceipt(capture.stagingDir, "ggg777").ok, false);

    writeFileSync(
      join(capture.stagingDir, "goat-quality-draft-claude-hhh888.json"),
      validReport(root),
    );
    await capture.processNow();
    const receipt = readReceipt(capture.stagingDir, "hhh888");
    assert.equal(receipt.ok, true);
  });

  it("sweeps unprocessed drafts on dispose and keeps receipts", async () => {
    const root = makeRoot();
    const capture = makeCapture(root);
    writeFileSync(
      join(capture.stagingDir, "goat-quality-draft-claude-iii999.json"),
      "{}",
    );
    await capture.processNow();
    writeFileSync(
      join(capture.stagingDir, "goat-quality-draft-claude-jjj000.json"),
      validReport(root),
    );

    capture.dispose();
    // Dispose is idempotent and processNow becomes a no-op afterwards.
    capture.dispose();
    await capture.processNow();

    const remaining = readdirSync(capture.stagingDir).sort();
    assert.deepStrictEqual(remaining, [
      "goat-quality-result-claude-iii999.json",
    ]);
  });

  it("keeps a sibling session's draft when one holder disposes", async () => {
    const root = makeRoot();
    const first = makeCapture(root);
    const second = makeCapture(root);
    const draftPath = join(
      second.stagingDir,
      "goat-quality-draft-claude-kkk111.json",
    );
    writeFileSync(draftPath, validReport(root));

    // The staging directory belongs to the root, so one session ending must not
    // sweep a draft another session is still waiting to have persisted.
    first.dispose();

    assert.equal(existsSync(draftPath), true);
    await second.processNow();
    assert.equal(existsSync(draftPath), false);
    assert.equal(readReceipt(second.stagingDir, "kkk111").ok, true);
  });

  it("persists a draft once when two sessions hold the same root", async () => {
    const root = makeRoot();
    const first = makeCapture(root);
    const second = makeCapture(root);
    writeFileSync(
      join(first.stagingDir, "goat-quality-draft-claude-lll222.json"),
      validReport(root),
    );

    // Independent pollers would both read the draft before either deleted it -
    // a draft is removed only after its persist await resolves.
    await Promise.all([first.processNow(), second.processNow()]);

    const persisted = readdirSync(
      join(root, ".goat-flow", "logs", "quality"),
    ).filter((entry) => entry.endsWith(".json"));
    assert.equal(
      persisted.length,
      1,
      `one draft must yield one report, got ${persisted.join(", ")}`,
    );
  });

  it("shares one capture across real-path and symlink aliases", async (testContext) => {
    if (process.platform === "win32") {
      testContext.skip("Directory symlink fixtures require Windows Developer Mode");
      return;
    }
    const parent = makeRoot();
    const realRoot = join(parent, "real");
    const aliasRoot = join(parent, "alias");
    mkdirSync(realRoot);
    symlinkSync(realRoot, aliasRoot, "dir");
    const first = makeCapture(realRoot);
    const second = makeCapture(aliasRoot);
    assert.equal(first.stagingDir, second.stagingDir);
    writeFileSync(
      join(first.stagingDir, "goat-quality-draft-claude-mmm333.json"),
      validReport(realRoot),
    );

    await Promise.all([first.processNow(), second.processNow()]);

    const persisted = readdirSync(
      join(realRoot, ".goat-flow", "logs", "quality"),
    ).filter((entry) => entry.endsWith(".json"));
    assert.equal(persisted.length, 1);
  });
});
