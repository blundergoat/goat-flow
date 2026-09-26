/**
 * Live review file capture: snapshot hashing streams without a size limit, anchor byte reads stay bounded, and a parent
 * directory swapped for a symlink around the open cannot supply bytes from outside the reviewed project.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { liveBytes, liveState } from "../../src/cli/review-validate-anchors.js";

/**
 * Create a disposable real-path project root with one selected file.
 * Filesystem side effects: creates a temp directory under the OS temp root and writes `dir/file.txt`; callers remove it.
 *
 * @param content - bytes written to `dir/file.txt`
 * @returns the real path of the new project root
 */
function makeProject(content: Buffer | string): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(join(os.tmpdir(), "goat-flow-review-live-")),
  );
  fs.mkdirSync(join(root, "dir"));
  fs.writeFileSync(join(root, "dir", "file.txt"), content);
  return root;
}

describe("review live file capture", () => {
  it("streams snapshot hashes past the anchor read limit but refuses oversized anchor bytes", () => {
    // One byte past the 64 MiB live anchor limit (src/cli/review-validate-anchors.ts, search: LIVE_ANCHOR_READ_LIMIT_BYTES).
    const content = Buffer.alloc(64 * 1024 * 1024 + 1, 0x61);
    const root = makeProject(content);
    try {
      assert.deepEqual(liveState(root, "dir/file.txt"), {
        kind: "file",
        from: "live",
        mode: "100644",
        sha256: createHash("sha256").update(content).digest("hex"),
      });
      assert.throws(
        () => liveBytes(root, "dir/file.txt"),
        /selected live anchor file exceeds 67108864 bytes/u,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: reproduce the review-bot race deterministically by swapping `dir/` for a symlink to an outside
   * folder only while the selected file is opened, then restoring it before the post-read containment walk.
   * Filesystem side effects: renames, symlinks, and restores `dir/` inside disposable temp roots that the test removes.
   * Invariant: both snapshot capture and anchor reads throw instead of returning the outside file's bytes or hash.
   */
  it("refuses bytes read through a parent swapped for a symlink around the open", (test) => {
    const root = makeProject("in-project bytes\n");
    const outside = fs.realpathSync(
      fs.mkdtempSync(join(os.tmpdir(), "goat-flow-review-outside-")),
    );
    fs.writeFileSync(join(outside, "file.txt"), "outside bytes\n");
    const parent = join(root, "dir");
    const aside = join(root, "dir-aside");
    try {
      try {
        fs.symlinkSync(outside, join(root, "probe"), "dir");
        fs.unlinkSync(join(root, "probe"));
      } catch (error) {
        // Windows without Developer Mode forbids unprivileged symlinks; the race needs one.
        if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
        test.skip("host blocks unprivileged symlinks");
        return;
      }
      const realOpenSync = fs.openSync;
      // Swap the parent only for the selected file's open, then restore it so the path walk looks clean again.
      test.mock.method(
        fs,
        "openSync",
        (...args: Parameters<typeof fs.openSync>) => {
          if (args[0] !== join(parent, "file.txt"))
            return realOpenSync(...args);
          fs.renameSync(parent, aside);
          fs.symlinkSync(outside, parent, "dir");
          try {
            return realOpenSync(...args);
          } finally {
            fs.unlinkSync(parent);
            fs.renameSync(aside, parent);
          }
        },
      );
      syncBuiltinESMExports();

      assert.throws(
        () => liveState(root, "dir/file.txt"),
        /selected live file was replaced while reading/u,
      );
      assert.throws(
        () => liveBytes(root, "dir/file.txt"),
        /selected live file was replaced while reading/u,
      );
    } finally {
      test.mock.restoreAll();
      syncBuiltinESMExports();
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
