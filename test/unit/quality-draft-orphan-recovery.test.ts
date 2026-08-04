/** Verify receipt recovery when a quality owner outlives its visible draft. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { startQualityDraftCapture } from "../../src/cli/server/quality-draft-capture.js";

const QUALITY_IGNORE_RULES = [
  ".goat-flow/logs/quality/*.json",
  ".goat-flow/logs/quality/staging/",
  ".goat-flow/logs/events/*.jsonl",
  "",
].join("\n");

/**
 * Create one disposable project whose local quality paths are safely ignored.
 * Use as the starting point for each recovery case, so a case never touches the developer's
 * real project or leaves stray quality artifacts behind in it.
 *
 * Side effects: creates a new temporary directory on disk, runs `git init` inside it, and
 * writes a `.gitignore` there. The caller owns that directory and removes it when done.
 *
 * @returns absolute path of the fresh project root the case should work in
 */
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-quality-orphan-"));
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  writeFileSync(join(root, ".gitignore"), QUALITY_IGNORE_RULES);
  return root;
}

/** Read one terminal rejection paired with the fixture's owner marker. */
function readReceipt(stagingDir: string, nonce: string): { error?: string } {
  return JSON.parse(
    readFileSync(
      join(stagingDir, `goat-quality-result-claude-${nonce}.json`),
      "utf8",
    ),
  ) as { error?: string };
}

describe("quality draft orphan recovery", () => {
  /**
   * Models a crash after draft deletion but before receipt creation. Writes a
   * stale owner marker and removes the complete disposable project afterward.
   */
  it("rejects an orphaned stale claim when its draft is already gone", async () => {
    // Builds the state a user is left in when their quality capture died mid-write: the draft
    // is already gone, but the ownership marker it wrote is still sitting in staging.
    const root = makeRoot();
    const capture = startQualityDraftCapture({
      projectRoot: root,
      intervalMs: 60_000,
      stableMs: 0,
      claimStaleMs: 0,
    });
    const nonce = "orphaned-stale-owner";
    const claimPath = join(
      capture.stagingDir,
      `goat-quality-claim-claude-${nonce}.json`,
    );
    // The marker a dead capture left behind: a real owner id and pid, with a claim timestamp
    // old enough that the zero lease treats it as long expired.
    const staleOwnerMarker = {
      owner: "c".repeat(32),
      pid: 789,
      claimed_at: "2026-08-03T00:00:00.000Z",
    };

    try {
      writeFileSync(claimPath, `${JSON.stringify(staleOwnerMarker)}\n`);
      // A zero lease means immediate expiry even when filesystem timestamp
      // precision places the new marker fractionally ahead of Date.now().
      const futureMtime = new Date(Date.now() + 60_000);
      utimesSync(claimPath, futureMtime, futureMtime);

      await capture.processNow();

      assert.equal(existsSync(claimPath), false);
      assert.equal(
        readReceipt(capture.stagingDir, nonce).error,
        "quality capture: stale draft claim rejected to prevent duplicate persistence.",
      );
      assert.deepStrictEqual(
        readdirSync(join(root, ".goat-flow", "logs", "quality")).filter(
          (entry) => /^\d.*\.json$/u.test(entry),
        ),
        [],
      );
    } finally {
      capture.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Proves a live owner may temporarily have no visible draft. Writes one fresh
   * marker, confirms no receipt, and removes the complete disposable project.
   */
  it("keeps an orphaned live claim while its receipt is still pending", async () => {
    // Builds the state a user is in mid-capture: their run holds the claim and simply has not
    // written a draft yet, so the sweep must leave it alone rather than reclaim it from them.
    const root = makeRoot();
    const capture = startQualityDraftCapture({
      projectRoot: root,
      intervalMs: 60_000,
      stableMs: 0,
    });
    const nonce = "orphaned-live-owner";
    const claimPath = join(
      capture.stagingDir,
      `goat-quality-claim-claude-${nonce}.json`,
    );
    // The marker a still-running capture holds: claimed just now, so the sweep must leave it
    // alone rather than reclaim work the user's run is still doing.
    const liveOwnerMarker = {
      owner: "d".repeat(32),
      pid: 790,
      claimed_at: new Date().toISOString(),
    };

    try {
      writeFileSync(claimPath, `${JSON.stringify(liveOwnerMarker)}\n`);

      await capture.processNow();

      assert.equal(existsSync(claimPath), true);
      assert.equal(
        existsSync(
          join(capture.stagingDir, `goat-quality-result-claude-${nonce}.json`),
        ),
        false,
      );
    } finally {
      capture.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
