/**
 * Unit tests for the read-only filesystem adapter.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFS } from "../../src/cli/facts/fs.js";

/** Writes fixture files while creating parent directories as needed. */
async function write(root: string, path: string, content = ""): Promise<void> {
  const fullPath = join(root, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

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
