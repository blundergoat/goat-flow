/**
 * Proves a commit review still captures exact bytes when its tree holds more blob data than one buffered Git read.
 * Slow suite: the fixture hashes more than 128 MiB of highly compressible content.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  capture,
  repository,
  revision,
} from "../unit/review-validate.helpers.js";

/** Rationale: 70 MiB per file, because two exceed the former 128 MiB single-read limit and each exceeds the 64 MiB batch budget. */
const LARGE_FILE_BYTES = 70 * 1024 * 1024;

/**
 * Build one large file body from a repeated line so Git stores it cheaply.
 *
 * @param label - text that makes this body a distinct blob
 * @returns file contents of at least {@link LARGE_FILE_BYTES} bytes
 */
function largeContents(label: string): string {
  const line = `${label} review fixture line\n`;
  return line.repeat(Math.ceil(LARGE_FILE_BYTES / line.length));
}

describe("review snapshot of a large tree", () => {
  it("captures every file of a commit whose blobs exceed one buffered read", (test) => {
    const { root, base } = repository(test);
    const files = {
      "large-a.txt": largeContents("first"),
      "large-b.txt": largeContents("second"),
      "small.txt": "small\n",
    };
    const head = revision(root, files, [base]);

    const { inventory } = capture(root, {
      kind: "commit",
      commit: head,
      parent: null,
    }).authority;

    for (const [path, contents] of Object.entries(files)) {
      const captured = inventory.find((entry) => entry.path === path)?.new;
      assert.equal(
        captured?.kind === "file" ? captured.sha256 : captured,
        createHash("sha256").update(contents).digest("hex"),
        path,
      );
    }
  });
});
