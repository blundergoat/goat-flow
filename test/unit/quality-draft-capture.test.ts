/**
 * Unit tests for the dashboard-owned staged-draft quality persistence
 * capture (ADR-044): draft acceptance, every rejection class, receipt
 * contents, filename filtering, dispose-time sweep, and handle hygiene.
 *
 * Most processing is driven through `processNow()` with `stableMs: 0`; changing-writer
 * regressions use repeated size/mtime observations without wall-clock waits. The
 * interval itself is unref'd and cleared by dispose, which the leak-sensitive terminal
 * test lesson requires this suite to prove.
 */
import { after, describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  futimesSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureQualityDraftStagingDirectory,
  startQualityDraftCapture,
} from "../../src/cli/server/quality-draft-capture.js";
import type { QualityDraftCapture } from "../../src/cli/server/quality-draft-capture.js";
import { runConcurrentQualityWorkers } from "../helpers/concurrent-quality-workers.js";

const PACKAGE_VERSION = (
  JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
).version;
const QUALITY_IGNORE_RULES = [
  ".goat-flow/logs/quality/*.json",
  ".goat-flow/logs/quality/staging/",
  ".goat-flow/logs/events/*.jsonl",
  "",
].join("\n");

/**
 * Report a POSIX-only fixture as skipped when the suite runs on Windows.
 *
 * Keeping the runtime skip here rather than inline in each test states the
 * platform contract once, and keeps a conditional platform guard from reading
 * like a committed focused/skipped test at the call site.
 *
 * @param testContext - Running test context used to record the skip reason.
 * @param reason - Why the fixture cannot express its contract on Windows.
 * @returns True when the caller must return early because the test was skipped.
 */
function skipOnWindows(testContext: TestContext, reason: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  testContext.skip(reason);
  return true;
}

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

  /**
   * Writes and tracks one temporary project root so capture cleanup runs after the suite.
   * Use for every capture test that needs a disposable project the dashboard could have selected.
   *
   * @returns the new project root path; every caller gets a distinct directory
   */
  function makeRoot(ignoreRules: string | null = QUALITY_IGNORE_RULES): string {
    const root = mkdtempSync(join(tmpdir(), "goat-quality-capture-"));
    roots.push(root);
    execFileSync("git", ["-C", root, "init", "--quiet"]);
    if (ignoreRules !== null) {
      writeFileSync(join(root, ".gitignore"), ignoreRules);
    }
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

  it("rejects stable invalid JSON before the reporting session closes", async () => {
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

  // Covers pre-existing symlink and multiply linked receipt destinations: writes both and expects refusal.
  it("refuses pre-existing symlink and multiply linked receipt destinations", async (testContext) => {
    if (
      skipOnWindows(testContext, "Link fixtures require POSIX link semantics")
    ) {
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

    assert.equal(
      existsSync(
        join(capture.stagingDir, "goat-quality-draft-claude-ccc333.json"),
      ),
      false,
    );
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

    assert.equal(
      existsSync(
        join(capture.stagingDir, "goat-quality-draft-claude-ddd444.json"),
      ),
      false,
    );
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

  // Covers files outside the draft name contract plus symlinked drafts: writes them and expects them ignored.
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

  /**
   * Keep a changing report private until two observations agree.
   * Fixture purpose: writes partial then valid JSON to model an agent replacing its draft.
   */
  it("waits for a changing draft before processing the completed report", async () => {
    const root = makeRoot();
    const capture = startQualityDraftCapture({
      projectRoot: root,
      intervalMs: 60_000,
      stableMs: 500,
    });
    captures.push(capture);
    const draftPath = join(
      capture.stagingDir,
      "goat-quality-draft-claude-ggg777.json",
    );
    writeFileSync(draftPath, "{}");
    const quietTimestamp = new Date(Date.now() - 2_000);
    utimesSync(draftPath, quietTimestamp, quietTimestamp);

    // Example: the reporting agent has created the file but has not finished replacing its contents.
    await capture.processNow();
    assert.equal(existsSync(draftPath), true);

    writeFileSync(draftPath, validReport(root));
    utimesSync(draftPath, quietTimestamp, quietTimestamp);
    await capture.processNow();
    assert.equal(existsSync(draftPath), true);

    await capture.processNow();
    const receipt = readReceipt(capture.stagingDir, "ggg777");
    assert.equal(receipt.ok, true);
  });

  it("preserves a draft while its open writer is still changing it", async () => {
    const root = makeRoot();
    const capture = startQualityDraftCapture({
      projectRoot: root,
      intervalMs: 60_000,
      stableMs: 500,
    });
    captures.push(capture);
    const draftPath = join(
      capture.stagingDir,
      "goat-quality-draft-claude-paused111.json",
    );
    const raw = validReport(root);
    const split = Math.floor(raw.length / 2);
    const descriptor = openSync(draftPath, "w", 0o600);
    writeSync(descriptor, raw.slice(0, split));
    const old = new Date(Date.now() - 2_000);
    futimesSync(descriptor, old, old);

    await capture.processNow();

    assert.equal(existsSync(draftPath), true);
    assert.equal(
      existsSync(
        join(capture.stagingDir, "goat-quality-result-claude-paused111.json"),
      ),
      false,
    );

    // Example: Claude resumes its paused file write and appends the rest of the report.
    writeSync(descriptor, raw.slice(split));
    futimesSync(descriptor, old, old);
    await capture.processNow();
    closeSync(descriptor);
    await capture.processNow();

    assert.equal(existsSync(draftPath), false);
    assert.equal(readReceipt(capture.stagingDir, "paused111").ok, true);
  });

  it("rejects a finalized report when its exact filename is not ignored", async () => {
    const root = makeRoot(".goat-flow/logs/quality/staging/\n");
    const capture = makeCapture(root);
    const draftPath = join(
      capture.stagingDir,
      "goat-quality-draft-claude-final-ignore.json",
    );
    writeFileSync(draftPath, validReport(root));

    await capture.processNow();

    assert.equal(existsSync(draftPath), false);
    assert.equal(readReceipt(capture.stagingDir, "final-ignore").ok, false);
    assert.deepStrictEqual(
      readdirSync(join(root, ".goat-flow", "logs", "quality")).filter((name) =>
        /^\d.*\.json$/u.test(name),
      ),
      [],
    );
  });

  /**
   * A process-local shutdown cannot prove another server stopped writing the shared root.
   * Fixture purpose: writes unobserved drafts, then proves dispose leaves them for a safe poll.
   * Invariant: disposing an unowned observer cannot delete project-wide draft state.
   */
  it("does not sweep unobserved shared drafts on dispose", async () => {
    const root = makeRoot();
    const capture = startQualityDraftCapture({
      projectRoot: root,
      intervalMs: 60_000,
      stableMs: 500,
    });
    captures.push(capture);
    writeFileSync(
      join(capture.stagingDir, "goat-quality-draft-claude-iii999.json"),
      "{}",
    );
    writeFileSync(
      join(capture.stagingDir, "goat-quality-draft-claude-jjj000.json"),
      validReport(root),
    );

    capture.dispose();
    capture.dispose();
    await capture.processNow();

    const remaining = readdirSync(capture.stagingDir).sort();
    assert.deepStrictEqual(remaining, [
      "goat-quality-draft-claude-iii999.json",
      "goat-quality-draft-claude-jjj000.json",
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

  it("persists one draft once across independent server processes", async () => {
    const root = makeRoot();
    const stagingDir = ensureQualityDraftStagingDirectory(root);
    writeFileSync(
      join(stagingDir, "goat-quality-draft-claude-cross-process.json"),
      validReport(root),
    );

    await runConcurrentQualityWorkers("persist-draft", root);

    const persisted = readdirSync(
      join(root, ".goat-flow", "logs", "quality"),
    ).filter((entry) => /^\d.*\.json$/u.test(entry));
    assert.equal(
      persisted.length,
      1,
      `one cross-process draft must yield one report, got ${persisted.join(", ")}`,
    );
    assert.equal(readReceipt(stagingDir, "cross-process").ok, true);
    assert.deepStrictEqual(
      readdirSync(stagingDir).filter((entry) =>
        /goat-quality-(?:draft|claim|reap)-/u.test(entry),
      ),
      [],
    );
  });

  /** Fixture purpose: writes a late snapshot that cannot replace the winner's receipt. */
  it("preserves a terminal receipt when a late claimant saw the old draft", async () => {
    const root = makeRoot();
    const capture = makeCapture(root);
    const nonce = "late-claimant";
    const draftPath = join(
      capture.stagingDir,
      `goat-quality-draft-claude-${nonce}.json`,
    );
    const receiptPath = join(
      capture.stagingDir,
      `goat-quality-result-claude-${nonce}.json`,
    );
    const terminalReceipt = {
      ok: true,
      reportPath: join(root, ".goat-flow", "logs", "quality", "winner.json"),
    };
    writeFileSync(draftPath, validReport(root));
    writeFileSync(receiptPath, `${JSON.stringify(terminalReceipt, null, 2)}\n`);

    await capture.processNow();

    assert.equal(existsSync(draftPath), false);
    assert.deepStrictEqual(
      JSON.parse(readFileSync(receiptPath, "utf8")),
      terminalReceipt,
    );
    assert.deepStrictEqual(
      readdirSync(join(root, ".goat-flow", "logs", "quality")).filter((entry) =>
        /^\d.*\.json$/u.test(entry),
      ),
      [],
    );
  });

  it("does not remove another process's live claim or draft on child shutdown", async () => {
    const root = makeRoot();
    const stagingDir = ensureQualityDraftStagingDirectory(root);
    const nonce = "live-owner";
    const draftPath = join(
      stagingDir,
      `goat-quality-draft-claude-${nonce}.json`,
    );
    const claimPath = join(
      stagingDir,
      `goat-quality-claim-claude-${nonce}.json`,
    );
    writeFileSync(draftPath, validReport(root));
    writeFileSync(
      claimPath,
      `${JSON.stringify({ owner: "a".repeat(32), pid: 123, claimed_at: new Date().toISOString() })}\n`,
    );

    await runConcurrentQualityWorkers("dispose-observer", root, 1);

    assert.equal(existsSync(draftPath), true);
    assert.equal(existsSync(claimPath), true);
    assert.equal(
      existsSync(join(stagingDir, `goat-quality-result-claude-${nonce}.json`)),
      false,
    );
  });

  /** Fixture purpose: writes stale ownership that rejects without a second report. */
  it("rejects a stale claim instead of replaying its draft", async () => {
    const root = makeRoot();
    const capture = startQualityDraftCapture({
      projectRoot: root,
      intervalMs: 60_000,
      stableMs: 0,
      claimStaleMs: 0,
    });
    captures.push(capture);
    const nonce = "stale-owner";
    const draftPath = join(
      capture.stagingDir,
      `goat-quality-draft-claude-${nonce}.json`,
    );
    const claimPath = join(
      capture.stagingDir,
      `goat-quality-claim-claude-${nonce}.json`,
    );
    writeFileSync(draftPath, validReport(root));
    writeFileSync(
      claimPath,
      `${JSON.stringify({ owner: "b".repeat(32), pid: 456, claimed_at: "2026-08-03T00:00:00.000Z" })}\n`,
    );

    await capture.processNow();

    assert.equal(existsSync(draftPath), false);
    assert.equal(existsSync(claimPath), false);
    assert.equal(
      readReceipt(capture.stagingDir, nonce).error,
      "quality capture: stale draft claim rejected to prevent duplicate persistence.",
    );
    assert.deepStrictEqual(
      readdirSync(join(root, ".goat-flow", "logs", "quality")).filter((entry) =>
        /^\d.*\.json$/u.test(entry),
      ),
      [],
    );
  });

  // Covers a project reached by real path and symlink: writes via each and expects one shared capture.
  it("shares one capture across real-path and symlink aliases", async (testContext) => {
    if (
      skipOnWindows(
        testContext,
        "Directory symlink fixtures require Windows Developer Mode",
      )
    ) {
      return;
    }
    const parent = makeRoot();
    const realRoot = join(parent, "real");
    const aliasRoot = join(parent, "alias");
    mkdirSync(realRoot);
    execFileSync("git", ["-C", realRoot, "init", "--quiet"]);
    writeFileSync(join(realRoot, ".gitignore"), QUALITY_IGNORE_RULES);
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
