/**
 * Verify the private staging-directory boundary for dashboard quality reports.
 * Fixtures cover ignore proof, POSIX permissions, and simultaneous server
 * creation so a race cannot redirect raw draft content through a link or file.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { TestContext } from "node:test";

import { ensureQualityDraftStagingDirectory } from "../../src/cli/server/quality-draft-capture.js";
import { runConcurrentQualityWorkers } from "../helpers/concurrent-quality-workers.js";

const QUALITY_IGNORE_RULES = [
  ".goat-flow/logs/quality/*.json",
  ".goat-flow/logs/quality/staging/",
  ".goat-flow/logs/events/*.jsonl",
  "",
].join("\n");

/** Report a POSIX-permission fixture as skipped on Windows. */
function skipOnWindows(testContext: TestContext, reason: string): boolean {
  if (process.platform !== "win32") return false;
  testContext.skip(reason);
  return true;
}

describe("quality draft staging", () => {
  const roots: string[] = [];

  /** Writes a temporary Git project whose ignore rules decide whether staging may exist. */
  function makeRoot(ignoreRules: string | null = QUALITY_IGNORE_RULES): string {
    const root = mkdtempSync(join(tmpdir(), "goat-quality-staging-"));
    roots.push(root);
    execFileSync("git", ["-C", root, "init", "--quiet"]);
    if (ignoreRules !== null) {
      writeFileSync(join(root, ".gitignore"), ignoreRules);
    }
    return root;
  }

  after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it("creates the staging directory chain with a 0700 leaf", () => {
    const root = makeRoot();
    const stagingDir = ensureQualityDraftStagingDirectory(root);
    assert.equal(
      stagingDir,
      join(root, ".goat-flow", "logs", "quality", "staging"),
    );
    assert.equal(lstatSync(stagingDir).mode & 0o777, 0o700);
    assert.equal(ensureQualityDraftStagingDirectory(root), stagingDir);
  });

  it("accepts a concurrent winner only after rechecking a real directory", async () => {
    const root = makeRoot();

    const outcomes = await runConcurrentQualityWorkers("ensure-staging", root);

    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[0]?.result.isDirectory, true);
    assert.equal(outcomes[0]?.result.isSymlink, false);
    assert.equal(outcomes[1]?.result.isDirectory, true);
    assert.equal(outcomes[1]?.result.isSymlink, false);
    const staging = lstatSync(
      join(root, ".goat-flow", "logs", "quality", "staging"),
    );
    assert.equal(staging.isDirectory(), true);
    assert.equal(staging.isSymbolicLink(), false);
  });

  it("fails before creating staging when its exact path is not ignored", () => {
    const root = makeRoot(null);

    assert.throws(
      () => ensureQualityDraftStagingDirectory(root),
      /staging\/.*must be gitignored before capture starts/u,
    );
    assert.equal(existsSync(join(root, ".goat-flow")), false);
  });

  it("rejects a symlinked staging ancestor without writing through it", (testContext) => {
    if (
      skipOnWindows(
        testContext,
        "Directory symlink fixtures require Windows Developer Mode",
      )
    ) {
      return;
    }
    const root = makeRoot();
    const outside = mkdtempSync(join(tmpdir(), "goat-quality-outside-"));
    roots.push(outside);
    symlinkSync(outside, join(root, ".goat-flow"), "dir");

    assert.throws(
      () => ensureQualityDraftStagingDirectory(root),
      /must be a real project-local directory/u,
    );
    assert.equal(existsSync(join(outside, "logs")), false);
  });

  it("tightens an existing permissive staging directory to 0700", (testContext) => {
    if (
      skipOnWindows(
        testContext,
        "POSIX mode bits are not enforceable on Windows",
      )
    ) {
      return;
    }
    const root = makeRoot();
    const stagingDir = ensureQualityDraftStagingDirectory(root);
    chmodSync(stagingDir, 0o777);

    ensureQualityDraftStagingDirectory(root);

    assert.equal(lstatSync(stagingDir).mode & 0o777, 0o700);
  });
});
