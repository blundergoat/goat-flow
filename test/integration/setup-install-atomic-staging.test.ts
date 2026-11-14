/** Exercise Node filesystem failures and races without shell-command substitutes. */
import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import {
  copyInstallerFile,
  writeInstallerFile,
  transformInstallerFile,
} from "../../src/cli/installer/atomic-files.js";
import { moveInstallerFile } from "../../src/cli/installer/migrations.js";
import { makeTempProject } from "./setup-install.helpers.js";

const ORIGINAL = Buffer.from("previous managed bytes\n");

/** Restore the real filesystem before another case owns the fixture. */
afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
});

/** Existing bytes and an empty staging set are the recovery contract. */
function preserved(project: string): void {
  assert.deepEqual(fs.readFileSync(join(project, "target")), ORIGINAL);
  assert.deepEqual(
    fs
      .readdirSync(project)
      .filter((name) => name.startsWith(".goat-flow-stage.")),
    [],
  );
}

function target(): string {
  const project = makeTempProject();
  fs.writeFileSync(join(project, "target"), ORIGINAL);
  return project;
}

/** Inject the failure in the operation the Node writer actually calls. */
function fail(
  operation: "copyFileSync" | "mkdtempSync" | "renameSync",
  code: string,
): void {
  mock.method(fs, operation, () => {
    throw Object.assign(new Error(`injected ${code}`), { code });
  });
  syncBuiltinESMExports();
}

describe("installer atomic staging", () => {
  it("atomically replaces an existing supported system file without leaving staging artifacts", () => {
    const project = target();
    writeInstallerFile(project, "target", "complete replacement");
    assert.equal(
      fs.readFileSync(join(project, "target"), "utf8"),
      "complete replacement",
    );
    assert.deepEqual(fs.readdirSync(project), ["target"]);
    assert.throws(
      () =>
        writeInstallerFile(project, "target", "racing seed", {
          createOnly: true,
        }),
      /atomic create failed/u,
    );
    assert.equal(
      fs.readFileSync(join(project, "target"), "utf8"),
      "complete replacement",
    );
  });

  it("preserves the previous destination and cleans staging when payload copy fails", () => {
    const project = target();
    fail("copyFileSync", "EIO");
    assert.throws(
      () => copyInstallerFile(project, "target", join(project, "target")),
      /staging copy failed/u,
    );
    preserved(project);
  });

  it("refuses a raced payload symlink without overwriting its target", () => {
    const project = target();
    const outside = target();
    const originalCopy = fs.copyFileSync;
    mock.method(
      fs,
      "copyFileSync",
      (source: fs.PathLike, payload: fs.PathLike, mode?: number) => {
        fs.symlinkSync(join(outside, "target"), payload);
        originalCopy(source, payload, mode);
      },
    );
    syncBuiltinESMExports();
    assert.throws(
      () => copyInstallerFile(project, "target", join(project, "target")),
      /staging copy failed/u,
    );
    preserved(project);
    preserved(outside);
  });

  it("preserves the previous destination when staging directory creation fails", () => {
    const project = target();
    fail("mkdtempSync", "EACCES");
    assert.throws(
      () => writeInstallerFile(project, "target", "new"),
      /could not create adjacent staging directory/u,
    );
    preserved(project);
  });

  it("preserves the previous destination and cleans partial staging after interruption", () => {
    const project = target();
    mock.method(fs, "copyFileSync", (_source: string, payload: string) => {
      fs.writeFileSync(payload, "partial payload");
      throw Object.assign(new Error("interrupted copy"), { code: "EINTR" });
    });
    syncBuiltinESMExports();
    assert.throws(
      () => copyInstallerFile(project, "target", join(project, "target")),
      /staging copy failed/u,
    );
    preserved(project);
  });

  it("stops without a non-atomic fallback when adjacent rename fails", () => {
    const project = target();
    fail("renameSync", "EXDEV");
    assert.throws(
      () => writeInstallerFile(project, "target", "new"),
      /no non-atomic fallback/u,
    );
    preserved(project);
  });

  it("blocks symlinked destination parents even when force is supplied", () => {
    const project = target();
    const outside = target();
    fs.symlinkSync(outside, join(project, "redirect"), "junction");
    assert.throws(
      () => writeInstallerFile(project, "redirect/target", "new"),
      /symlink/u,
    );
    preserved(outside);
  });

  it("blocks a symlinked goat-flow root before creating outside directories", () => {
    const project = makeTempProject();
    const outside = target();
    fs.symlinkSync(outside, join(project, ".goat-flow"), "junction");
    assert.throws(
      () => writeInstallerFile(project, ".goat-flow/child/target", "new"),
      /symlink/u,
    );
    preserved(outside);
    assert.equal(fs.existsSync(join(outside, "child")), false);
  });

  it("keeps config bytes intact when an atomic transform rename fails", () => {
    const project = target();
    fail("renameSync", "EXDEV");
    assert.throws(
      () => transformInstallerFile(project, "target", () => "changed"),
      /atomic replacement failed/u,
    );
    preserved(project);
  });

  it("keeps a legacy source intact when atomic migration rename is unavailable", () => {
    const project = target();
    mock.method(fs, "linkSync", () => {
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    });
    syncBuiltinESMExports();
    assert.throws(
      () => moveInstallerFile(project, "target", "new/target", () => {}),
      /atomic migration rename failed/u,
    );
    preserved(project);
    assert.equal(fs.existsSync(join(project, "new/target")), false);
  });
});
