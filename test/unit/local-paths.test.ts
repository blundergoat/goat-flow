/**
 * Unit tests for local path validation and symlink escape protection.
 */
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  LocalPathValidationError,
  resolveLocalStatePath,
  resolveValidatedLocalStatePath,
  validateLocalPath,
} from "../../src/cli/server/local-paths.js";

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

function assertLocalPathError(
  fn: () => unknown,
  validationClass: LocalPathValidationError["validationClass"],
): void {
  assert.throws(
    fn,
    (err) =>
      err instanceof LocalPathValidationError &&
      err.validationClass === validationClass &&
      !err.message.includes(resolve("/tmp")),
  );
}

describe("validateLocalPath", () => {
  it("allows child scratch projects outside home", () => {
    const root = mkdtempSync(join(tmpdir(), "gf-local-path-"));
    try {
      const result = validateLocalPath(root, "terminal-cwd");
      assert.equal(result.path, root);
      assert.equal(result.realPath, root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects missing paths and files when a directory is required", () => {
    const root = mkdtempSync(join(tmpdir(), "gf-local-path-"));
    try {
      assertLocalPathError(
        () => validateLocalPath(join(root, "missing"), "project-read"),
        "missing",
      );
      const filePath = join(root, "file.txt");
      writeFileSync(filePath, "not a directory\n");
      assertLocalPathError(
        () => validateLocalPath(filePath, "project-read"),
        "not-directory",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks exact system roots for project and terminal purposes", () => {
    if (process.platform === "win32") return;

    assertLocalPathError(
      () => validateLocalPath("/tmp", "terminal-cwd"),
      "blocked-root",
    );
    assertLocalPathError(
      () => validateLocalPath("/", "project-read"),
      "blocked-root",
    );
  });

  it("keeps passive browse permissive for system roots", () => {
    if (process.platform === "win32") return;

    const result = validateLocalPath("/", "browse");
    assert.equal(result.path, resolve("/"));
  });

  it("rejects symlinks that resolve into blocked roots for terminal use", (testContext) => {
    if (process.platform === "win32") return;

    const root = mkdtempSync(join(tmpdir(), "gf-local-path-"));
    const link = join(root, "etc-link");
    try {
      if (!symlinkOrSkip(testContext, "/etc", link, "dir")) return;
      assertLocalPathError(
        () => validateLocalPath(link, "terminal-cwd"),
        "blocked-root",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveLocalStatePath", () => {
  it("resolves writes under the selected project's .goat-flow tree", () => {
    const root = mkdtempSync(join(tmpdir(), "gf-local-state-"));
    try {
      assert.equal(
        resolveLocalStatePath(root, "logs/uploads/sess1", "upload"),
        join(root, ".goat-flow", "logs", "uploads", "sess1"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves writes from an already validated project path", () => {
    const root = mkdtempSync(join(tmpdir(), "gf-local-state-"));
    try {
      const project = validateLocalPath(root, "upload");
      assert.equal(
        resolveValidatedLocalStatePath(project, "logs/uploads/sess2"),
        join(root, ".goat-flow", "logs", "uploads", "sess2"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows a project root symlink when the real target is allowed", (testContext) => {
    const root = mkdtempSync(join(tmpdir(), "gf-local-state-real-"));
    const linkParent = mkdtempSync(join(tmpdir(), "gf-local-state-link-"));
    const link = join(linkParent, "project-link");
    try {
      if (!symlinkOrSkip(testContext, root, link, "dir")) return;
      assert.equal(
        resolveLocalStatePath(link, "tasks/.active"),
        join(link, ".goat-flow", "tasks", ".active"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(linkParent, { recursive: true, force: true });
    }
  });

  // Fixture purpose: writes a symlinked state path to cover escape rejection.
  it("rejects state paths that escape through symlinked components", (testContext) => {
    const root = mkdtempSync(join(tmpdir(), "gf-local-state-"));
    const outside = mkdtempSync(join(tmpdir(), "gf-local-state-outside-"));
    try {
      mkdirSync(join(root, ".goat-flow"), { recursive: true });
      if (
        !symlinkOrSkip(
          testContext,
          outside,
          join(root, ".goat-flow", "logs"),
          "dir",
        )
      ) {
        return;
      }

      assertLocalPathError(
        () => resolveLocalStatePath(root, "logs/uploads/sess1", "upload"),
        "state-path-escape",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
