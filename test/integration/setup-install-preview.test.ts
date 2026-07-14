/**
 * Public CLI proof for managed setup preview and overwrite admission control.
 * These disposable targets reproduce first install, local managed edits, explicit
 * override, and JSON preview behavior without changing the controlling workspace.
 * Users should see conflicts before any installer mutation occurs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { getTemplatePath } from "../../src/cli/paths.js";
import { makeTempProject, runCliInstaller } from "./setup-install.helpers.js";

describe("managed setup preview", () => {
  it("reports a fresh target without writing any project files", () => {
    const projectPath = makeTempProject();
    const result = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--dry-run",
      "--format",
      "json",
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      schemaVersion: string;
      coverage: string;
      verdict: string;
      files: Array<{
        path: string;
        ownership: string;
        state: string;
        action: string;
        reason: string;
        currentStatus: string;
        newExpectedSha256: string | null;
      }>;
    };
    assert.equal(report.schemaVersion, "goat-flow.managed-setup-preview.v1");
    assert.equal(report.coverage, "managed-template-files");
    assert.equal(report.verdict, "ready");
    assert.equal(
      report.files.some((file) => file.state === "added"),
      true,
    );
    assert.equal(
      report.files.every(
        (file) =>
          file.path.length > 0 &&
          !file.path.startsWith("/") &&
          file.ownership === "system-owned" &&
          file.state === "added" &&
          file.action === "create" &&
          file.reason.length > 0 &&
          file.currentStatus === "missing" &&
          /^[a-f0-9]{64}$/u.test(file.newExpectedSha256 ?? ""),
      ),
      true,
    );
    assert.equal(
      report.files.some(
        (file) => file.path === ".goat-flow/hooks/deny-dangerous.sh",
      ),
      true,
    );
    assert.equal(
      report.files.some((file) => file.path === ".agents/skills/goat/SKILL.md"),
      true,
    );
    const repeatedResult = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--dry-run",
      "--format",
      "json",
    );
    assert.equal(repeatedResult.status, 0, repeatedResult.stderr);
    assert.equal(repeatedResult.stdout, result.stdout);
    assert.deepEqual(readdirSync(projectPath), []);
  });

  it("renders stable text actions and reasons without writing target files", () => {
    const projectPath = makeTempProject();
    const result = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--dry-run",
      "--format",
      "text",
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Verdict: ready/u);
    assert.match(result.stdout, /Coverage: managed-template-files/u);
    assert.match(
      result.stdout,
      /create\s+\.goat-flow\/hooks\/deny-dangerous\.sh \[added\] - The current goat-flow package adds this managed file\./u,
    );
    assert.deepEqual(readdirSync(projectPath), []);
  });

  it("records hash-only state after a successful CLI install", () => {
    const projectPath = makeTempProject();
    const result = runCliInstaller(projectPath, "--agent", "codex");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const statePath = join(
      projectPath,
      ".goat-flow",
      "install-state",
      "codex.json",
    );
    assert.equal(existsSync(statePath), true);
    const state = readFileSync(statePath, "utf-8");
    assert.match(state, /goat-flow\.install-state\.v1/u);
    assert.doesNotMatch(state, new RegExp(projectPath, "u"));
  });

  it("blocks a local managed edit until the user supplies force", () => {
    const projectPath = makeTempProject();
    const firstInstall = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(
      firstInstall.status,
      0,
      firstInstall.stderr || firstInstall.stdout,
    );
    const managedReadmePath = join(
      projectPath,
      ".goat-flow",
      "logs",
      "quality",
      "README.md",
    );
    const localEdit = "keep this local managed edit\n";
    writeFileSync(managedReadmePath, localEdit);

    const blockedInstall = runCliInstaller(projectPath, "--agent", "codex");
    assert.notEqual(blockedInstall.status, 0);
    assert.match(blockedInstall.stderr, /local-edited/u);
    assert.equal(readFileSync(managedReadmePath, "utf-8"), localEdit);

    const forcedInstall = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--force",
    );
    assert.equal(
      forcedInstall.status,
      0,
      forcedInstall.stderr || forcedInstall.stdout,
    );
    assert.notEqual(readFileSync(managedReadmePath, "utf-8"), localEdit);
  });

  it("keeps dry-run state unchanged after a local managed edit", () => {
    const projectPath = makeTempProject();
    const firstInstall = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(
      firstInstall.status,
      0,
      firstInstall.stderr || firstInstall.stdout,
    );
    const managedReadmePath = join(
      projectPath,
      ".goat-flow",
      "logs",
      "quality",
      "README.md",
    );
    const statePath = join(
      projectPath,
      ".goat-flow",
      "install-state",
      "codex.json",
    );
    writeFileSync(managedReadmePath, "preview-only local edit\n");
    const stateBefore = readFileSync(statePath, "utf-8");

    const preview = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--dry-run",
      "--format",
      "json",
    );

    assert.notEqual(preview.status, 0);
    const report = JSON.parse(preview.stdout) as {
      verdict: string;
      files: Array<{ path: string; state: string }>;
    };
    assert.equal(report.verdict, "blocked");
    assert.equal(
      report.files.some(
        (file) =>
          file.path === ".goat-flow/logs/quality/README.md" &&
          file.state === "local-edited",
      ),
      true,
    );
    assert.equal(
      readFileSync(managedReadmePath, "utf-8"),
      "preview-only local edit\n",
    );
    assert.equal(readFileSync(statePath, "utf-8"), stateBefore);
  });

  /**
   * This fixture writes and removes disposable target directories around a managed symlink.
   * It reproduces redirected install risk and proves admission preserves outside-project bytes.
   */
  it("blocks symlinked managed parents even when force is supplied", () => {
    const projectPath = makeTempProject();
    const redirectedDirectory = makeTempProject();
    const redirectedReadmePath = join(redirectedDirectory, "README.md");
    const managedQualityParent = join(
      projectPath,
      ".goat-flow",
      "logs",
      "quality",
    );
    try {
      mkdirSync(join(projectPath, ".goat-flow", "logs"), { recursive: true });
      writeFileSync(
        redirectedReadmePath,
        readFileSync(
          getTemplatePath("workflow/setup/reference/quality-readme.md"),
        ),
      );
      symlinkSync(redirectedDirectory, managedQualityParent, "dir");
      const redirectedBytesBefore = readFileSync(redirectedReadmePath);

      const preview = runCliInstaller(
        projectPath,
        "--agent",
        "codex",
        "--dry-run",
        "--format",
        "json",
      );
      assert.notEqual(preview.status, 0);
      const report = JSON.parse(preview.stdout) as {
        verdict: string;
        files: Array<{
          path: string;
          state: string;
          currentStatus: string;
          reason: string;
        }>;
      };
      const redirectedManagedFile = report.files.find(
        (file) => file.path === ".goat-flow/logs/quality/README.md",
      );
      assert.equal(report.verdict, "blocked");
      assert.equal(redirectedManagedFile?.state, "unmanaged");
      assert.equal(redirectedManagedFile?.currentStatus, "non-regular");
      assert.match(
        redirectedManagedFile?.reason ?? "",
        /symlink or non-regular/u,
      );

      const forcedInstall = runCliInstaller(
        projectPath,
        "--agent",
        "codex",
        "--force",
      );
      assert.notEqual(forcedInstall.status, 0);
      assert.match(forcedInstall.stderr, /--force cannot bypass path safety/u);
      assert.deepEqual(
        readFileSync(redirectedReadmePath),
        redirectedBytesBefore,
      );
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
      rmSync(redirectedDirectory, { recursive: true, force: true });
    }
  });
});
