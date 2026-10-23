/** Exercise retirement against saved release bytes, real files and preserved user choices. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  makeTempProject,
  PROJECT_ROOT,
  runCliInstaller,
} from "./setup-install.helpers.js";
import {
  createManagedInstallStateRow,
  writeManagedInstallStateV2,
  readManagedInstallStateFacade,
} from "../../src/cli/managed-setup-state.js";
import { hashFile } from "../../src/cli/managed-setup-write-set.js";
import {
  applyRuntimeRetirementPreview,
  inspectRuntimeRetirement,
  removeRetiredRuntimeFile,
  retiredRuntimePaths,
  retireRuntimeRows,
} from "../../src/cli/installer/retired-runtime.js";
import { syncHookStates } from "../../src/cli/server/hook-registrar.js";
import type { ManagedSetupPreviewFile } from "../../src/cli/managed-setup-preview.js";

const ENTRY = ".goat-flow/hooks/deny-dangerous.sh";
const LIBRARY = ".goat-flow/hooks/deny-dangerous/guard-runtime.sh";

function write(project: string, path: string, bytes: string | Buffer): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), bytes);
}

/** Tagged bytes establish the old package identity rather than guessing a historical script. */
function released(path: string): Buffer {
  const result = spawnSync("git", ["show", `v1.18.0:workflow/hooks/${path}`], {
    cwd: PROJECT_ROOT,
  });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

function fixture() {
  const project = makeTempProject();
  write(project, ENTRY, released("deny-dangerous.sh"));
  write(project, LIBRARY, released("deny-dangerous/guard-runtime.sh"));
  const files = [ENTRY, LIBRARY].map((path) =>
    createManagedInstallStateRow({
      path,
      expectedSha256: hashFile(join(project, path)),
      provenance: { kind: "verified-install", goatFlowVersion: "1.18.0" },
    }),
  );
  writeManagedInstallStateV2(project, {
    schemaVersion: "goat-flow.install-state.v2",
    files,
    receipts: [],
  });
  return {
    project,
    expected: readManagedInstallStateFacade(project).expectedHashes,
  };
}

describe("stored-baseline runtime retirement", () => {
  it("Sync removes matching owned per-agent copies while preserving edited and unclassified copies", () => {
    const project = makeTempProject();
    const install = runCliInstaller(project, "--agent", "claude");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const paths = [
      ".claude/hooks/deny-dangerous.sh",
      ".claude/hooks/deny-git-mutations.sh",
      ".claude/hooks/post-turn-safety.sh",
    ] as const;
    for (const path of paths)
      write(project, path, released(path.slice(path.lastIndexOf("/") + 1)));
    const facade = readManagedInstallStateFacade(project);
    assert.ok(facade.state);
    writeManagedInstallStateV2(project, {
      ...facade.state,
      files: [
        ...facade.state.files,
        ...paths.slice(0, 2).map((path) =>
          createManagedInstallStateRow({
            path,
            expectedSha256: hashFile(join(project, path)),
            provenance: { kind: "verified-install", goatFlowVersion: "1.18.0" },
          }),
        ),
      ],
    });
    write(project, paths[1], "locally edited legacy policy\n");
    syncHookStates(project);
    assert.equal(existsSync(join(project, paths[0])), false);
    assert.equal(
      readFileSync(join(project, paths[1]), "utf8"),
      "locally edited legacy policy\n",
    );
    assert.ok(existsSync(join(project, paths[2])));
    assert.ok(existsSync(join(project, ".goat-flow/hooks/deny-dangerous.mjs")));
    assert.deepEqual(
      readManagedInstallStateFacade(project).state?.receipts,
      facade.state.receipts,
    );
  });

  it("keeps the list inactive for runtime files still shipped by the package", () => {
    const shipped = new Set(retiredRuntimePaths(new Set()));
    assert.deepEqual(retiredRuntimePaths(shipped), []);
  });

  it("removes only matching stored release bytes and preserves edited or unclassified files", () => {
    const { project, expected } = fixture();
    write(project, LIBRARY, "locally edited runtime\n");
    const unclassified = ".goat-flow/hooks/gruff-code-quality.sh";
    write(project, unclassified, released("gruff-code-quality.sh"));
    const retirement = inspectRuntimeRetirement(project, expected, new Set());
    assert.deepEqual(
      retirement.filter((file) => file.canRemove).map((file) => file.path),
      [ENTRY],
    );
    for (const file of retirement.filter((row) => row.canRemove))
      removeRetiredRuntimeFile(project, file);
    assert.equal(existsSync(join(project, ENTRY)), false);
    assert.equal(
      readFileSync(join(project, LIBRARY), "utf8"),
      "locally edited runtime\n",
    );
    assert.ok(existsSync(join(project, unclassified)));
  });

  it("keeps registrations and dependencies while a runtime customization awaits migration consent", () => {
    const { project, expected } = fixture();
    write(project, ENTRY, "locally edited entrypoint\n");
    const registration = JSON.stringify({
      hooks: { PreToolUse: [{ command: `bash "${ENTRY}"` }] },
    });
    write(project, ".claude/settings.json", registration);
    const files: ManagedSetupPreviewFile[] = [];
    applyRuntimeRetirementPreview(project, files, expected, new Set(), {
      namedPaths: [],
      shouldReplaceAllManagedConflicts: false,
      shouldReplaceNamedUserOwned: false,
    });
    assert.equal(
      files.find((file) => file.path === ENTRY)?.authority,
      "withheld",
    );
    const library = inspectRuntimeRetirement(project, expected, new Set()).find(
      (file) => file.path === LIBRARY,
    );
    assert.ok(library?.canRemove);
    assert.throws(
      () => removeRetiredRuntimeFile(project, library),
      /migration is incomplete/u,
    );
    assert.equal(
      readFileSync(join(project, ".claude/settings.json"), "utf8"),
      registration,
    );
    assert.ok(existsSync(join(project, LIBRARY)));

    const approved: ManagedSetupPreviewFile[] = [];
    applyRuntimeRetirementPreview(project, approved, expected, new Set(), {
      namedPaths: [ENTRY],
      shouldReplaceAllManagedConflicts: false,
      shouldReplaceNamedUserOwned: false,
    });
    assert.equal(
      approved.find((file) => file.path === ENTRY)?.authority,
      "granted-path",
    );
    write(
      project,
      ".claude/settings.json",
      JSON.stringify({
        hooks: {
          PreToolUse: [{ command: "node .goat-flow/hooks/deny-dangerous.mjs" }],
        },
      }),
    );
    removeRetiredRuntimeFile(project, library);
    assert.equal(existsSync(join(project, LIBRARY)), false);
    assert.equal(
      readFileSync(join(project, ENTRY), "utf8"),
      "locally edited entrypoint\n",
    );
  });

  it("rechecks current bytes before removal and retires orphan rows without inventing receipts", () => {
    const { project, expected } = fixture();
    const retirement = inspectRuntimeRetirement(project, expected, new Set());
    const entry = retirement.find((file) => file.path === ENTRY);
    assert.ok(entry);
    write(project, ENTRY, "changed after review\n");
    assert.throws(
      () => removeRetiredRuntimeFile(project, entry),
      /changed before cleanup/u,
    );
    const library = retirement.find((file) => file.path === LIBRARY);
    assert.ok(library);
    removeRetiredRuntimeFile(project, library);
    const state = readManagedInstallStateFacade(project).state;
    assert.ok(state);
    const retired = retireRuntimeRows(project, state, new Set());
    assert.deepEqual(
      retired.files.map((file) => file.path),
      [ENTRY],
    );
    assert.deepEqual(retired.receipts, state.receipts);
  });
});
