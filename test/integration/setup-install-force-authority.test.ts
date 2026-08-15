/**
 * Proof that install authority stays as narrow as the user made it.
 * Four authorities exist: a named path, all managed conflicts, the bare alias for the second,
 * and named user-owned replacement. Each fixture checks both halves - what the authority
 * permits, and the neighbouring content it must leave alone - because an override that
 * quietly widens is the failure this milestone exists to prevent.
 * These run the public CLI against disposable targets, so the assertions are about the
 * user's project after the command, never about internal state.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  makeTempProject,
  recordStaleBaselineHashes,
  runCliInstaller,
} from "./setup-install.helpers.js";

/** Two managed READMEs whose templates are independent, so one conflict cannot mask the other. */
const FIRST_CONFLICT_PATH = ".goat-flow/logs/quality/README.md";
const SECOND_CONFLICT_PATH = ".goat-flow/logs/review/README.md";

/** A seeded user-owned policy file, the only ownership `--force-user-owned` can reach. */
const USER_OWNED_PATH = ".goat-flow/security-policy.md";

/** One preview row as the JSON contract publishes it. */
interface PreviewRow {
  path: string;
  ownership: string;
  state: string;
  authority: string;
}

/** A disposable target holding two managed conflicts and one edited user-owned file. */
interface ConflictedTarget {
  projectPath: string;
  localBytes: string;
  userOwnedBytes: string;
}

/**
 * Install Codex, then create two managed conflicts and one edited user-owned file.
 * Use as the shared starting point so each authority is measured against identical state.
 * This writes into a disposable target created by `makeTempProject`.
 *
 * @returns the target root plus the exact bytes each unauthorized path must still hold
 */
function conflictedTarget(): ConflictedTarget {
  const projectPath = makeTempProject();
  const firstInstall = runCliInstaller(projectPath, "--agent", "codex");
  assert.equal(
    firstInstall.status,
    0,
    firstInstall.stderr || firstInstall.stdout,
  );

  const localBytes = "local bytes under a changed template\n";
  writeFileSync(join(projectPath, FIRST_CONFLICT_PATH), localBytes);
  writeFileSync(join(projectPath, SECOND_CONFLICT_PATH), localBytes);
  recordStaleBaselineHashes(projectPath, "codex", [
    FIRST_CONFLICT_PATH,
    SECOND_CONFLICT_PATH,
  ]);

  const userOwnedBytes = "# Team security policy\n\nKeep this rule.\n";
  writeFileSync(join(projectPath, USER_OWNED_PATH), userOwnedBytes);

  return { projectPath, localBytes, userOwnedBytes };
}

/** Read the dry-run rows for one target under the same authority apply would use. */
function previewRows(
  projectPath: string,
  ...authority: string[]
): PreviewRow[] {
  const preview = runCliInstaller(
    projectPath,
    "--agent",
    "codex",
    "--dry-run",
    "--format",
    "json",
    ...authority,
  );
  const report = JSON.parse(preview.stdout) as { files: PreviewRow[] };
  return report.files;
}

/** Read one row's authority decision, failing by path when the preview omits it. */
function authorityFor(rows: PreviewRow[], path: string): string {
  const row = rows.find((candidate) => candidate.path === path);
  assert.ok(row, `preview must list ${path}`);
  return row.authority;
}

describe("install force authority", () => {
  it("withholds every conflict when no authority is supplied", () => {
    const target = conflictedTarget();

    const rows = previewRows(target.projectPath);
    assert.equal(authorityFor(rows, FIRST_CONFLICT_PATH), "withheld");
    assert.equal(authorityFor(rows, SECOND_CONFLICT_PATH), "withheld");

    const blocked = runCliInstaller(target.projectPath, "--agent", "codex");
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /--force-path/u);
    assert.equal(
      readFileSync(join(target.projectPath, FIRST_CONFLICT_PATH), "utf-8"),
      target.localBytes,
    );
  });

  it("admits only the named path and still blocks on the other", () => {
    const target = conflictedTarget();

    const rows = previewRows(
      target.projectPath,
      "--force-path",
      FIRST_CONFLICT_PATH,
    );
    assert.equal(authorityFor(rows, FIRST_CONFLICT_PATH), "granted-path");
    assert.equal(authorityFor(rows, SECOND_CONFLICT_PATH), "withheld");

    const partial = runCliInstaller(
      target.projectPath,
      "--agent",
      "codex",
      "--force-path",
      FIRST_CONFLICT_PATH,
    );
    assert.notEqual(
      partial.status,
      0,
      "one named path cannot admit a second conflict",
    );
    assert.equal(
      readFileSync(join(target.projectPath, SECOND_CONFLICT_PATH), "utf-8"),
      target.localBytes,
    );
  });

  // Named per flag so a failure reports which authority broke, not just "one of them".
  for (const authorityFlag of ["--force-managed", "--force"]) {
    it(`replaces every managed conflict under ${authorityFlag}`, () => {
      const target = conflictedTarget();

      const rows = previewRows(target.projectPath, authorityFlag);
      assert.equal(authorityFor(rows, FIRST_CONFLICT_PATH), "granted-managed");
      assert.equal(authorityFor(rows, SECOND_CONFLICT_PATH), "granted-managed");

      const forced = runCliInstaller(
        target.projectPath,
        "--agent",
        "codex",
        authorityFlag,
      );
      assert.equal(forced.status, 0, forced.stderr || forced.stdout);
      assert.notEqual(
        readFileSync(join(target.projectPath, FIRST_CONFLICT_PATH), "utf-8"),
        target.localBytes,
      );
      // Managed authority reaches system-owned conflicts only; user content is a separate decision.
      assert.equal(
        readFileSync(join(target.projectPath, USER_OWNED_PATH), "utf-8"),
        target.userOwnedBytes,
      );
    });
  }

  it("never replaces user-owned content under managed authority alone", () => {
    const target = conflictedTarget();

    const rows = previewRows(
      target.projectPath,
      "--force-managed",
      "--force-path",
      USER_OWNED_PATH,
    );
    // Naming a user-owned path without the user-owned flag authorizes nothing for it.
    assert.equal(authorityFor(rows, USER_OWNED_PATH), "not-required");
  });

  it("replaces one named user-owned file when both authorities name it", () => {
    const target = conflictedTarget();

    const rows = previewRows(
      target.projectPath,
      "--force-managed",
      "--force-user-owned",
      "--force-path",
      USER_OWNED_PATH,
    );
    assert.equal(authorityFor(rows, USER_OWNED_PATH), "granted-user-owned");

    const replaced = runCliInstaller(
      target.projectPath,
      "--agent",
      "codex",
      "--force-managed",
      "--force-user-owned",
      "--force-path",
      USER_OWNED_PATH,
    );
    assert.equal(replaced.status, 0, replaced.stderr || replaced.stdout);
    assert.notEqual(
      readFileSync(join(target.projectPath, USER_OWNED_PATH), "utf-8"),
      target.userOwnedBytes,
      "the named user-owned file must be re-seeded from its template",
    );
    // The user's config was never named, so it keeps every byte.
    assert.match(
      readFileSync(
        join(target.projectPath, ".goat-flow", "config.yaml"),
        "utf-8",
      ),
      /post-turn-safety/u,
    );
  });

  it("rejects a named path that matches no conflict", () => {
    const target = conflictedTarget();

    const mistyped = runCliInstaller(
      target.projectPath,
      "--agent",
      "codex",
      "--force-path",
      ".goat-flow/logs/quality/READM.md",
    );

    assert.notEqual(mistyped.status, 0);
    assert.match(mistyped.stderr, /names no path in this preview/u);
    assert.equal(
      readFileSync(join(target.projectPath, FIRST_CONFLICT_PATH), "utf-8"),
      target.localBytes,
      "a rejected authority must leave every conflict untouched",
    );
  });

  it("rejects a broad user-owned override with no named path", () => {
    const target = conflictedTarget();

    const broad = runCliInstaller(
      target.projectPath,
      "--agent",
      "codex",
      "--force-user-owned",
    );

    assert.equal(broad.status, 2, broad.stderr);
    assert.match(broad.stderr, /requires at least one --force-path/u);
  });
});
