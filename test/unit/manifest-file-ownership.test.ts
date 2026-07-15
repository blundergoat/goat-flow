/**
 * Verifies manifest file ownership before installer and audit consumers trust it.
 * Users need every required/optional artifact classified explicitly so updates
 * overwrite only system files, preserve user files, regenerate known outputs,
 * report deprecated paths, and leave external files untouched.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  loadManifest,
  renderManifestMarkdown,
} from "../../src/cli/manifest/manifest.js";
import * as manifestJsonModule from "../../src/cli/manifest/manifest-json.js";
import { ManifestValidationError } from "../../src/cli/manifest/types.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const MANIFEST_PATH = resolve(PROJECT_ROOT, "workflow", "manifest.json");
const OWNERSHIP_CLASSES = new Set([
  "system-owned",
  "user-owned",
  "generated",
  "deprecated",
  "external",
]);

/** Ownership fields exercised by the user-facing manifest contract tests. */
interface OwnershipSpec {
  ownership: string;
  source?: string;
  generator?: string;
}

/** Minimal live-manifest shape needed to verify installer ownership coverage. */
interface OwnershipManifestFixture {
  required_files: string[];
  optional_files: Record<string, string>;
  file_ownership?: Record<string, OwnershipSpec>;
}

/** Read the live JSON as an ownership-focused fixture without weakening production types. */
function readOwnershipManifest(): OwnershipManifestFixture {
  return JSON.parse(
    readFileSync(MANIFEST_PATH, "utf-8"),
  ) as OwnershipManifestFixture;
}

/** Assert every current artifact has a valid class and any declared source exists. */
function assertCurrentOwnershipRecords(
  manifest: OwnershipManifestFixture,
): void {
  const ownershipByPath = manifest.file_ownership;
  assert.ok(ownershipByPath, "workflow manifest must declare file_ownership");
  const optionalPaths = Object.keys(manifest.optional_files).filter(
    (path) => path !== "_note",
  );

  // Every installed or verified artifact needs one policy users can inspect before updating.
  for (const artifactPath of [...manifest.required_files, ...optionalPaths]) {
    const ownership = ownershipByPath[artifactPath];
    assert.ok(ownership, `missing ownership for ${artifactPath}`);
    assert.ok(
      OWNERSHIP_CLASSES.has(ownership.ownership),
      `invalid ownership for ${artifactPath}: ${ownership.ownership}`,
    );

    // Canonical sources must resolve before an installer can safely overwrite or seed a file.
    if (ownership.source) {
      assert.equal(
        existsSync(resolve(PROJECT_ROOT, ownership.source)),
        true,
        `missing ownership source for ${artifactPath}: ${ownership.source}`,
      );
    }
  }
}

describe("manifest file ownership", () => {
  it("classifies every required and optional file with usable behavior metadata", () => {
    assertCurrentOwnershipRecords(readOwnershipManifest());
  });

  it("rejects legacy manifests instead of silently defaulting ownership", () => {
    const validator = Reflect.get(
      manifestJsonModule,
      "validateFileOwnershipSchema",
    );
    assert.equal(typeof validator, "function");
    const legacyManifest = readOwnershipManifest();
    Reflect.deleteProperty(legacyManifest, "file_ownership");

    assert.throws(
      () => Reflect.apply(validator, undefined, [legacyManifest]),
      /file_ownership.*explicit migration/iu,
    );
  });

  it("rejects ownership records without a usable source or generator", () => {
    const validator = Reflect.get(
      manifestJsonModule,
      "validateFileOwnershipSchema",
    );
    const invalidManifest = readOwnershipManifest();
    assert.ok(invalidManifest.file_ownership);
    invalidManifest.file_ownership[".goat-flow/logs/sessions/.gitkeep"] = {
      ownership: "generated",
      generator: "",
    };

    assert.throws(
      () => Reflect.apply(validator, undefined, [invalidManifest]),
      (error: unknown) =>
        error instanceof ManifestValidationError &&
        error.findings.some((finding) =>
          /generated file .* must declare generator/iu.test(finding),
        ),
    );
  });

  it("reports ownership classes and update behavior in the manifest output", () => {
    const output = renderManifestMarkdown(loadManifest());

    assert.match(output, /## File ownership/u);
    assert.match(output, /system-owned.*overwrite/iu);
    assert.match(output, /user-owned.*preserve/iu);
    assert.match(output, /user-owned.*unless `--force` is passed/iu);
    assert.match(output, /generated.*regenerate/iu);
    assert.match(output, /deprecated.*warn/iu);
    assert.match(output, /external.*never overwrite/iu);
  });
});
