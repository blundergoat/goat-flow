/**
 * Public CLI proof for managed setup preview and overwrite admission control.
 * These disposable targets reproduce first install, local managed edits, explicit
 * override, and JSON preview behavior without changing the controlling workspace.
 * Users should see conflicts before any installer mutation occurs.
 */
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
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

import { dispatchCommand } from "../../src/cli/cli-handlers.js";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import { getTemplatePath } from "../../src/cli/paths.js";
import { makeTempProject, runCliInstaller } from "./setup-install.helpers.js";

/** Create a directory symlink, or skip when the host forbids the fixture. */
function symlinkDirectoryOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
): boolean {
  try {
    symlinkSync(target, link, "dir");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      testContext.skip(
        "Skipped: host blocks unprivileged symlinks (Windows without Developer Mode)",
      );
      return false;
    }
    throw error;
  }
}

describe("managed setup preview", () => {
  /** Contract: Windows preview and install share one Bash blocker before target writes. */
  it("blocks Windows dry-run and install with the same missing-Bash result", async (testContext) => {
    const projectPath = makeTempProject();
    const reportDirectory = makeTempProject();
    const reportPath = join(reportDirectory, "windows-preview.json");
    const originalPlatform = Object.getOwnPropertyDescriptor(
      process,
      "platform",
    );
    const originalExitCode = process.exitCode;
    const originalPath = process.env.PATH;
    assert.ok(originalPlatform);
    testContext.mock.method(console, "error", () => undefined);
    // Native Windows CI may have Git Bash installed; unit discovery tests cover that host directly.
    if (originalPlatform.value === "win32") {
      testContext.skip(
        "POSIX-only simulation of a Windows host without Git Bash",
      );
      return;
    }

    try {
      Object.defineProperty(process, "platform", {
        ...originalPlatform,
        value: "win32",
      });
      // An empty PATH reproduces the reported user state without finding a host Bash by accident.
      process.env.PATH = "";
      process.exitCode = undefined;
      await dispatchCommand(
        parseCLIArgs([
          "install",
          projectPath,
          "--agent",
          "claude",
          "--dry-run",
          "--format",
          "json",
          "--output",
          reportPath,
        ]),
      );

      const report = JSON.parse(readFileSync(reportPath, "utf-8")) as {
        verdict: string;
        limits: string[];
      };
      assert.equal(process.exitCode, 1);
      assert.equal(report.verdict, "blocked");
      const prerequisitePrefix = "Install prerequisite failed: ";
      const prerequisiteLimit = report.limits.find((limit) =>
        limit.startsWith(prerequisitePrefix),
      );
      assert.ok(prerequisiteLimit);
      const dryRunFailure = prerequisiteLimit.slice(prerequisitePrefix.length);
      assert.match(
        dryRunFailure,
        /Windows-compatible Bash, but none was found/u,
      );

      // Clearing the preview exit lets the real path expose its own matching CLI error.
      process.exitCode = undefined;
      await assert.rejects(
        dispatchCommand(
          parseCLIArgs(["install", projectPath, "--agent", "claude"]),
        ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, dryRunFailure);
          return true;
        },
      );
      assert.deepEqual(readdirSync(projectPath), []);
    } finally {
      Object.defineProperty(process, "platform", originalPlatform);
      process.exitCode = originalExitCode;
      // A missing original PATH stays missing instead of becoming the string "undefined".
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });

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

  /**
   * Fixture reproduces a target installed before install-state existed: a
   * differing system-owned file with no baseline. The upgrade must adopt and
   * refresh it without --force, then writes a baseline for the next run.
   */
  it("adopts pre-baseline managed files instead of blocking the upgrade", () => {
    const projectPath = makeTempProject();
    const managedReadmePath = join(
      projectPath,
      ".goat-flow",
      "logs",
      "quality",
      "README.md",
    );
    const legacyBody = "older-package readme body\n";
    mkdirSync(join(projectPath, ".goat-flow", "logs", "quality"), {
      recursive: true,
    });
    writeFileSync(managedReadmePath, legacyBody);

    const dryRun = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--dry-run",
      "--format",
      "json",
    );
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    const report = JSON.parse(dryRun.stdout) as {
      verdict: string;
      files: Array<{ path: string; state: string; action: string }>;
    };
    assert.equal(report.verdict, "warning");
    const adoptedFile = report.files.find(
      (file) => file.path === ".goat-flow/logs/quality/README.md",
    );
    assert.equal(adoptedFile?.state, "adopted");
    assert.equal(adoptedFile?.action, "replace");

    const upgrade = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(upgrade.status, 0, upgrade.stderr || upgrade.stdout);
    assert.notEqual(
      readFileSync(managedReadmePath, "utf-8"),
      legacyBody,
      "the adopted file must be refreshed to the current package bytes",
    );
    assert.equal(
      existsSync(
        join(projectPath, ".goat-flow", "install-state", "codex.json"),
      ),
      true,
      "the first managed upgrade must record a baseline",
    );
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
  it("blocks symlinked managed parents even when force is supplied", (testContext) => {
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
      if (
        !symlinkDirectoryOrSkip(
          testContext,
          redirectedDirectory,
          managedQualityParent,
        )
      ) {
        return;
      }
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

  // Covers a symlinked baseline under --force: writes it; the install must be blocked before any write.
  it("blocks an invalid symlinked install-state baseline under force before writes", (testContext) => {
    const projectPath = makeTempProject();
    const redirectedStatePath = makeTempProject();
    try {
      mkdirSync(join(projectPath, ".goat-flow"), { recursive: true });
      writeFileSync(
        join(redirectedStatePath, "codex.json"),
        `${JSON.stringify({
          schemaVersion: "goat-flow.install-state.v1",
          agent: "codex",
          goatFlowVersion: "1.13.1",
          files: [],
        })}\n`,
        "utf-8",
      );
      if (
        !symlinkDirectoryOrSkip(
          testContext,
          redirectedStatePath,
          join(projectPath, ".goat-flow", "install-state"),
        )
      ) {
        return;
      }

      const forcedInstall = runCliInstaller(
        projectPath,
        "--agent",
        "codex",
        "--force",
      );

      assert.notEqual(forcedInstall.status, 0);
      assert.match(forcedInstall.stderr, /--force cannot bypass path safety/u);
      assert.equal(
        existsSync(join(projectPath, ".agents", "skills", "goat", "SKILL.md")),
        false,
        "invalid baseline state must block before any managed destination changes",
      );
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
      rmSync(redirectedStatePath, { recursive: true, force: true });
    }
  });
});
