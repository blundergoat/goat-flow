/** Upgrade contracts use real directories and the public installer in disposable projects. */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { migrateLegacyLocalState } from "../../src/cli/local-state-migration.js";
import { readManagedInstallStateFacade } from "../../src/cli/managed-setup-state.js";
import {
  acquirePathWriteClaims,
  inspectPathWriteClaim,
  PathWriteClaimError,
  releasePathWriteClaims,
  removeConfirmedAbandonedPathWriteClaim,
} from "../../src/cli/path-write-claim.js";
import {
  makeTempProject,
  symlinkDirectoryOrSkip,
} from "./setup-install.helpers.js";

/** Create disposable legacy directories and write opaque records to exercise byte-preserving relocation. */
function legacyProject(): string {
  const root = makeTempProject();
  mkdirSync(join(root, ".goat-flow/install-state"), { recursive: true });
  mkdirSync(join(root, ".goat-flow/write-claims"));
  writeFileSync(
    join(root, ".goat-flow/install-state/managed.json"),
    "preserved evidence\n",
  );
  return root;
}

describe("local operational-state directory migration", () => {
  for (const file of ["codex.json", "managed.json"]) {
    it(`reports malformed legacy ${file} at its existing location`, () => {
      const root = makeTempProject();
      mkdirSync(join(root, ".goat-flow/install-state"), { recursive: true });
      const path = `.goat-flow/install-state/${file}`;
      writeFileSync(join(root, path), "invalid JSON\n");
      const result = readManagedInstallStateFacade(root);
      assert.equal(result.status, "malformed-blocking");
      assert.deepEqual(result.affectedPaths, [path]);
      assert.equal(existsSync(join(root, ".goat-flow/state")), false);
    });
  }

  it("reads a legacy v1 baseline before migration and preserves it at the new path", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".goat-flow/install-state"), { recursive: true });
    const bytes = `${JSON.stringify({ schemaVersion: "goat-flow.install-state.v1", agent: "codex", goatFlowVersion: "1.16.0", files: [] }, null, 2)}\n`;
    writeFileSync(join(root, ".goat-flow/install-state/codex.json"), bytes);
    const before = readManagedInstallStateFacade(root);
    assert.equal(before.status, "loaded", before.error ?? "");
    assert.equal(before.source, "legacy-bootstrap");
    assert.equal(existsSync(join(root, ".goat-flow/state")), false);
    assert.equal(migrateLegacyLocalState(root), true);
    assert.deepEqual(readManagedInstallStateFacade(root), before);
    assert.equal(
      readFileSync(join(root, ".goat-flow/state/install/codex.json"), "utf8"),
      bytes,
    );
    assert.equal(existsSync(join(root, ".goat-flow/install-state")), false);
  });

  it("moves complete installation records byte-for-byte and removes both old paths", () => {
    const root = legacyProject();
    writeFileSync(
      join(root, ".goat-flow/install-state/codex.json"),
      "cutover marker bytes\n",
    );
    assert.equal(migrateLegacyLocalState(root), true);
    assert.equal(
      readFileSync(join(root, ".goat-flow/state/install/managed.json"), "utf8"),
      "preserved evidence\n",
    );
    assert.equal(
      readFileSync(join(root, ".goat-flow/state/install/codex.json"), "utf8"),
      "cutover marker bytes\n",
    );
    assert.equal(existsSync(join(root, ".goat-flow/install-state")), false);
    assert.equal(existsSync(join(root, ".goat-flow/write-claims")), false);
    assert.deepEqual(readdirSync(join(root, ".goat-flow/state/locks")), []);
    assert.equal(migrateLegacyLocalState(root), false);
  });

  for (const directory of [
    ".goat-flow/write-claims",
    ".goat-flow/state/locks",
  ]) {
    it(`refuses outstanding claims in ${directory} before moving any installation evidence`, () => {
      const root = legacyProject();
      // The new namespace can exist after an interrupted migration of another directory.
      if (directory.endsWith("state/locks")) {
        mkdirSync(join(root, ".goat-flow/state"));
        renameSync(
          join(root, ".goat-flow/write-claims"),
          join(root, directory),
        );
      }
      const marker = join(root, directory, "outstanding.claim");
      writeFileSync(marker, "owner evidence\n");
      assert.throws(
        () => migrateLegacyLocalState(root),
        /outstanding write claims/u,
      );
      assert.equal(readFileSync(marker, "utf8"), "owner evidence\n");
      assert.equal(existsSync(join(root, ".goat-flow/state/install")), false);
      assert.equal(
        readFileSync(
          join(root, ".goat-flow/install-state/managed.json"),
          "utf8",
        ),
        "preserved evidence\n",
      );
    });
  }

  it("refuses two installation directories instead of selecting or overwriting a baseline", () => {
    const root = legacyProject();
    mkdirSync(join(root, ".goat-flow/state/install"), { recursive: true });
    writeFileSync(
      join(root, ".goat-flow/state/install/managed.json"),
      "other evidence\n",
    );
    assert.throws(() => migrateLegacyLocalState(root), /Both .* exist/u);
    assert.equal(
      readManagedInstallStateFacade(root).status,
      "malformed-blocking",
    );
    assert.equal(
      readFileSync(join(root, ".goat-flow/state/install/managed.json"), "utf8"),
      "other evidence\n",
    );
    assert.equal(
      readFileSync(join(root, ".goat-flow/install-state/managed.json"), "utf8"),
      "preserved evidence\n",
    );
  });

  it("resumes after the installation directory moved but before the empty locks directory moved", () => {
    const root = legacyProject();
    mkdirSync(join(root, ".goat-flow/state"));
    renameSync(
      join(root, ".goat-flow/install-state"),
      join(root, ".goat-flow/state/install"),
    );
    assert.equal(migrateLegacyLocalState(root), true);
    assert.equal(existsSync(join(root, ".goat-flow/write-claims")), false);
    assert.equal(
      readFileSync(join(root, ".goat-flow/state/install/managed.json"), "utf8"),
      "preserved evidence\n",
    );
  });

  it("refuses a linked state ancestor without writing outside the project", (context) => {
    const root = legacyProject();
    const outside = makeTempProject();
    if (
      !symlinkDirectoryOrSkip(context, outside, join(root, ".goat-flow/state"))
    )
      return;
    assert.throws(
      () => migrateLegacyLocalState(root),
      /state must be a project-local directory/u,
    );
    assert.deepEqual(readdirSync(outside), []);
    assert.equal(
      existsSync(join(root, ".goat-flow/install-state/managed.json")),
      true,
    );
  });

  it("blocks legacy write admission while retaining explicit claim inspection and recovery", () => {
    const root = makeTempProject();
    const requests = [
      { targetPath: "notes.md", expectedIdentity: { state: "missing" } },
    ] as const;
    const batch = acquirePathWriteClaims(root, requests);
    const inspection = inspectPathWriteClaim(root, "notes.md");
    assert.ok(inspection);
    const bytes = readFileSync(inspection.markerPath);
    releasePathWriteClaims(batch);
    renameSync(
      join(root, ".goat-flow/state/locks"),
      join(root, ".goat-flow/write-claims"),
    );
    writeFileSync(
      join(
        root,
        ".goat-flow/write-claims",
        inspection.markerPath.split(/[\\/]/u).at(-1)!,
      ),
      bytes,
    );
    assert.throws(
      () => acquirePathWriteClaims(root, requests),
      (error: unknown) =>
        error instanceof PathWriteClaimError &&
        error.reason === "migration-required",
    );
    assert.equal(existsSync(join(root, ".goat-flow/state/locks")), false);
    const legacy = inspectPathWriteClaim(root, "notes.md");
    assert.ok(legacy);
    assert.equal(removeConfirmedAbandonedPathWriteClaim(legacy), "removed");
    assert.equal(migrateLegacyLocalState(root), true);
    const nextBatch = acquirePathWriteClaims(root, requests);
    assert.equal(releasePathWriteClaims(nextBatch)[0]?.status, "released");
  });
});
