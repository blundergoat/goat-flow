/**
 * Checks whether setup can trust the selected destination before offering to replace a managed file.
 *
 * A linked file must remain blocked even when its destination exactly matches the shipped template.
 * This fixture uses a disposable project and records an explicit capability skip if the host cannot create links.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { symlinkTestOptions } from "../helpers/symlink-capability.js";
import { buildManagedSetupPreview } from "../../src/cli/managed-setup-preview.js";
import { getTemplatePath } from "../../src/cli/paths.js";

describe("managed setup target path safety", () => {
  /** This fixture writes a managed symlink whose matching destination bytes must not authorize overwrite. */
  it(
    "treats a managed target symlink as unmanaged instead of hashing its destination",
    symlinkTestOptions(),
    () => {
      const projectPath = mkdtempSync(
        join(tmpdir(), "goat-flow-target-symlink-"),
      );
      const managedDirectory = join(
        projectPath,
        ".goat-flow",
        "logs",
        "quality",
      );
      const managedPath = join(managedDirectory, "README.md");
      try {
        // The symlink points at the real template, proving byte equality cannot hide a non-regular target.
        mkdirSync(managedDirectory, { recursive: true });
        symlinkSync(
          getTemplatePath("workflow/setup/reference/quality-readme.md"),
          managedPath,
        );
        const preview = buildManagedSetupPreview(projectPath, "codex");
        const managedFile = preview.files.find(
          (file) => file.path === ".goat-flow/logs/quality/README.md",
        );
        assert.equal(managedFile?.state, "unmanaged");
        assert.equal(managedFile?.currentStatus, "non-regular");
        assert.match(managedFile?.reason ?? "", /symlink or non-regular/u);
        assert.equal(preview.verdict, "blocked");
      } finally {
        rmSync(projectPath, { recursive: true, force: true });
      }
    },
  );
});
