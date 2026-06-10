/**
 * Unit tests for terminal image upload validation, limits, and persistence.
 */
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

/** Symlink with EPERM-skip for Windows hosts that block unprivileged symlinks. */
function symlinkOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
  type?: "dir" | "file" | "junction",
): boolean {
  try {
    symlinkSync(target, link, type);
    return true;
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === "EPERM"
    ) {
      testContext.skip(
        "Skipped: host blocks unprivileged symlinks (Windows without Developer Mode)",
      );
      return false;
    }
    throw err;
  }
}

import {
  buildAttachmentNote,
  decodeUploadFile,
  detectImageExtension,
  persistUploads,
  sanitizeUploadFilename,
  TERMINAL_UPLOAD_MAX_FILES,
  uploadDirForSession,
} from "../../src/cli/server/terminal-uploads.js";

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF_HEADER = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
]);
type UploadDecodeResult = ReturnType<typeof decodeUploadFile>;
type DecodedUpload = Extract<UploadDecodeResult, { ok: true }>;
type UploadDecodeFailure = Extract<UploadDecodeResult, { ok: false }>;

/** Build a minimal binary image with a chosen signature and padded body. */
function makeFakeImage(header: Buffer, bodyBytes = 32): Buffer {
  return Buffer.concat([header, Buffer.alloc(bodyBytes, 0xff)]);
}

/** Return a decoded upload after asserting the payload was accepted. */
function assertUploadOk(result: UploadDecodeResult): DecodedUpload {
  assert.equal(result.ok, true);
  return result as DecodedUpload;
}

/** Return a decoded upload failure after asserting the payload was rejected. */
function assertUploadFailure(result: UploadDecodeResult): UploadDecodeFailure {
  assert.equal(result.ok, false);
  return result as UploadDecodeFailure;
}

describe("sanitizeUploadFilename", () => {
  it("strips path components", () => {
    const result = sanitizeUploadFilename("../../etc/passwd.png");
    assert.equal(result.base, "passwd");
    assert.equal(result.ext, ".png");
  });

  it("normalizes case and rejects unknown extensions", () => {
    assert.equal(sanitizeUploadFilename("hello.PNG").ext, ".png");
    assert.equal(sanitizeUploadFilename("note.txt").ext, "");
    assert.equal(sanitizeUploadFilename("script.exe").ext, "");
  });

  it("replaces unsafe chars in the base", () => {
    const result = sanitizeUploadFilename("a b/c$%@.png");
    assert.equal(result.base, "c___");
    assert.equal(result.ext, ".png");
  });

  it("falls back to a default base when name has no usable chars", () => {
    const result = sanitizeUploadFilename(".png");
    assert.equal(result.base, "image");
    assert.equal(result.ext, ".png");
  });
});

describe("detectImageExtension", () => {
  it("recognizes PNG", () => {
    assert.equal(detectImageExtension(makeFakeImage(PNG_HEADER)), ".png");
  });
  it("recognizes JPEG", () => {
    assert.equal(detectImageExtension(makeFakeImage(JPEG_HEADER)), ".jpg");
  });
  it("recognizes GIF", () => {
    assert.equal(detectImageExtension(makeFakeImage(GIF_HEADER)), ".gif");
  });
  it("recognizes WEBP", () => {
    assert.equal(detectImageExtension(makeFakeImage(WEBP_HEADER)), ".webp");
  });
  it("rejects non-image bytes", () => {
    assert.equal(
      detectImageExtension(Buffer.from("Hello world, this is text")),
      null,
    );
  });
});

describe("decodeUploadFile", () => {
  it("accepts a valid base64-encoded PNG", () => {
    const png = makeFakeImage(PNG_HEADER);
    const result = decodeUploadFile("photo.png", png.toString("base64"));
    const decoded = assertUploadOk(result);
    assert.equal(decoded.sanitized.ext, ".png");
    assert.equal(decoded.bytes.length, png.length);
  });

  it("rejects an unsupported extension", () => {
    const result = decodeUploadFile(
      "note.txt",
      Buffer.from("hi").toString("base64"),
    );
    assert.match(assertUploadFailure(result).reason, /Unsupported extension/);
  });

  it("rejects content whose magic bytes do not match any supported format", () => {
    const result = decodeUploadFile(
      "fake.png",
      Buffer.from("plain text payload").toString("base64"),
    );
    assert.match(assertUploadFailure(result).reason, /supported image format/);
  });

  it("trusts magic bytes over a misleading extension", () => {
    const png = makeFakeImage(PNG_HEADER);
    const result = decodeUploadFile("trick.gif", png.toString("base64"));
    // .gif extension passes sanitize because it is in the allowed set, but
    // the bytes are PNG. The decoder rewrites the saved extension to match.
    assert.equal(assertUploadOk(result).sanitized.ext, ".png");
  });

  it("rejects an empty payload", () => {
    const result = decodeUploadFile("photo.png", "");
    assert.equal(result.ok, false);
  });
});

describe("uploadDirForSession", () => {
  it("composes a path inside the target's .goat-flow/logs/uploads/<id>/", () => {
    // `absPath` is filesystem-shape (host-native separators, drive letter on
    // Windows for absolute POSIX inputs). `relPath` is POSIX-shape so the UI
    // renders consistently across platforms.
    const target = mkdtempSync(join(tmpdir(), "gf-upload-proj-"));
    try {
      const dir = uploadDirForSession(target, "abc123");
      assert.equal(
        dir.absPath,
        resolvePath(target, ".goat-flow/logs/uploads/abc123"),
      );
      assert.equal(dir.relPath, ".goat-flow/logs/uploads/abc123");
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("rejects session ids that contain unsafe characters", () => {
    assert.throws(
      () => uploadDirForSession("/tmp/proj", "../escape"),
      /Invalid session id/,
    );
    assert.throws(
      () => uploadDirForSession("/tmp/proj", "abc/def"),
      /Invalid session id/,
    );
    assert.throws(
      () => uploadDirForSession("/tmp/proj", ""),
      /Invalid session id/,
    );
  });

  // Fixture purpose: writes a symlinked upload path to cover escape rejection.
  it("rejects upload paths that escape through symlinked components", (testContext) => {
    const target = mkdtempSync(join(tmpdir(), "gf-upload-target-"));
    const outside = mkdtempSync(join(tmpdir(), "gf-upload-outside-"));
    try {
      mkdirSync(join(target, ".goat-flow", "logs"), { recursive: true });
      if (
        !symlinkOrSkip(
          testContext,
          outside,
          join(target, ".goat-flow", "logs", "uploads"),
          "dir",
        )
      ) {
        return;
      }

      assert.throws(
        () => uploadDirForSession(target, "sess1"),
        /Local path validation failed \(state-path\): state path escape/,
      );
      assert.equal(existsSync(join(outside, "sess1")), false);
    } finally {
      rmSync(target, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("persistUploads", () => {
  it("writes accepted PNGs to the upload directory and rejects non-images", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "gf-upload-test-"));
    try {
      const dir = uploadDirForSession(tempDir, "sess1");
      const png = makeFakeImage(PNG_HEADER);
      const text = Buffer.from("not an image");
      const result = persistUploads(dir, [
        { name: "good.png", data: png.toString("base64") },
        { name: "bad.txt", data: text.toString("base64") },
      ]);

      assert.equal(result.accepted.length, 1);
      assert.equal(result.rejected.length, 1);
      assert.equal(result.accepted[0]?.originalName, "good.png");
      assert.match(
        result.accepted[0]?.savedRelPath ?? "",
        /^\.goat-flow\/logs\/uploads\/sess1\/.*\.png$/u,
      );
      assert.equal(result.rejected[0]?.originalName, "bad.txt");

      const savedPath = result.accepted[0]?.savedAbsPath ?? "";
      const stat = statSync(savedPath);
      assert.equal(stat.size, png.length);
      const onDisk = readFileSync(savedPath);
      assert.deepEqual(new Uint8Array(onDisk), new Uint8Array(png));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not create the upload directory when every file is rejected", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "gf-upload-test-"));
    try {
      const dir = uploadDirForSession(tempDir, "sess2");
      const result = persistUploads(dir, [
        { name: "bad.txt", data: Buffer.from("hi").toString("base64") },
      ]);
      assert.equal(result.accepted.length, 0);
      assert.equal(result.rejected.length, 1);
      assert.throws(() => statSync(dir.absPath), /ENOENT/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("buildAttachmentNote", () => {
  it("returns empty string when nothing was accepted", () => {
    assert.equal(buildAttachmentNote([]), "");
  });

  it("renders a single attachment on one line", () => {
    const note = buildAttachmentNote([
      {
        originalName: "a.png",
        savedName: "x-a.png",
        savedAbsPath: "/abs/x-a.png",
        savedRelPath: ".goat-flow/logs/uploads/s/x-a.png",
        bytes: 100,
      },
    ]);
    assert.equal(note, "Attached image: .goat-flow/logs/uploads/s/x-a.png\n");
  });

  it("renders multiple attachments as an indented list", () => {
    const note = buildAttachmentNote([
      {
        originalName: "a.png",
        savedName: "x-a.png",
        savedAbsPath: "/abs/x-a.png",
        savedRelPath: ".goat-flow/logs/uploads/s/x-a.png",
        bytes: 100,
      },
      {
        originalName: "b.png",
        savedName: "y-b.png",
        savedAbsPath: "/abs/y-b.png",
        savedRelPath: ".goat-flow/logs/uploads/s/y-b.png",
        bytes: 100,
      },
    ]);
    assert.equal(
      note,
      "Attached images:\n  .goat-flow/logs/uploads/s/x-a.png\n  .goat-flow/logs/uploads/s/y-b.png\n",
    );
  });
});

describe("upload count limit", () => {
  it("exposes the documented max-files constant", () => {
    const expectedUploadMaxFiles = 5;
    assert.equal(TERMINAL_UPLOAD_MAX_FILES, expectedUploadMaxFiles);
  });
});
