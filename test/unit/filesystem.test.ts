/**
 * Exercises the read-only filesystem view used by audit and setup commands.
 * Use these tests when path, glob, or directory-readiness behavior changes so
 * selected-project reports remain deterministic without changing user files.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFS } from "../../src/cli/facts/fs.js";

/**
 * Write one fixture file and its parents to model what a project user saved.
 *
 * @param root - temporary project root; empty is never supplied by these tests
 * @param path - project-relative fixture path; empty would target the root and is invalid
 * @param content - saved text; empty models a valid zero-byte file
 * @returns resolves after the fixture is visible to the filesystem adapter
 */
async function write(root: string, path: string, content = ""): Promise<void> {
  const fullPath = join(root, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

/**
 * Run one filesystem journey in an isolated project and always remove it afterward.
 *
 * @param init - creates the user's starting files; an empty project is allowed
 * @param run - inspects the initialized project through the production adapter
 * @returns resolves after inspection and cleanup complete
 */
async function withTempProject(
  init: (root: string) => Promise<void>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "goat-flow-fs-tests-"));
  try {
    await init(root);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("createFS directory readiness", () => {
  // A user restoring local state can have an empty directory, a same-named file, or no path at all.
  it("distinguishes readable directories from files and missing paths", async () => {
    await withTempProject(
      async (root) => {
        await mkdir(join(root, ".goat-flow", "logs", "sessions"), {
          recursive: true,
        });
        await write(root, ".goat-flow/plans", "not a directory");
      },
      async (root) => {
        const fs = createFS(root);

        assert.equal(fs.isReadableDirectory(".goat-flow/logs/sessions"), true);
        assert.equal(fs.isReadableDirectory(".goat-flow/plans"), false);
        assert.equal(fs.isReadableDirectory(".goat-flow/missing"), false);
        assert.deepEqual(fs.listDir(".goat-flow/plans"), []);
      },
    );
  });
});

describe("createFS glob support", () => {
  it("caches exact glob results without exposing mutable cache arrays", async () => {
    await withTempProject(
      async (root) => {
        await write(root, "src/app.ts");
        await write(root, "src/worker.ts");
      },
      async (root) => {
        const fs = createFS(root);
        const first = fs.glob("src/**/*.ts");
        first.push("src/fake.ts");

        assert.deepEqual(fs.glob("src/**/*.ts").sort(), [
          "src/app.ts",
          "src/worker.ts",
        ]);
      },
    );
  });

  it("uses the same ignored-directory behavior for glob and existsGlob", async () => {
    await withTempProject(
      async (root) => {
        await write(root, "src/app.ts");
        await write(root, "node_modules/pkg/ignored.ts");
        await write(root, "dist/out/ignored.ts");
        await write(root, "scripts/run.sh");
      },
      async (root) => {
        const fs = createFS(root);

        assert.deepEqual(fs.glob("**/*.ts"), ["src/app.ts"]);
        assert.equal(fs.existsGlob("**/*.ts"), true);
        assert.equal(fs.existsGlob("**/*.sh"), true);
        assert.equal(fs.existsGlob("**/*.go"), false);
      },
    );
  });
});
