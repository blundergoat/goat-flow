/**
 * Exercise hook migration and failed write-claim cleanup in disposable projects.
 *
 * Use when Sync changes provider detection or recovery guidance shown by the CLI and dashboard.
 * Real files and the public inspection command prove that repair stays within the selected project.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { pathWriteClaimInspectCommand } from "../../src/cli/claims-command.js";
import { PROFILES } from "../../src/cli/detect/agents.js";
import {
  acquirePathWriteClaims,
  releasePathWriteClaims,
} from "../../src/cli/path-write-claim.js";
import { HookManagedInstallationError } from "../../src/cli/server/hook-managed-installation.js";
import {
  executeHookChange,
  PreparedHookChange,
} from "../../src/cli/server/hook-operation.js";
import { syncHookStates } from "../../src/cli/server/hook-registrar.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");

describe("hook sync migration and claim recovery", () => {
  // Each former provider folder must migrate without opting the user into the other providers.
  for (const [agentId, legacyDirectory] of [
    ["claude", ".claude/hooks"],
    ["codex", ".codex/hooks"],
    ["antigravity", ".agents/hooks"],
    ["copilot", ".github/hooks"],
  ] as const) {
    it(`migrates only the ${agentId} provider with legacy hook residue`, () => {
      const projectPath = fs.mkdtempSync(join(tmpdir(), "hook-migration-"));
      try {
        const legacyScript = join(legacyDirectory, "deny-dangerous.sh");
        const officialScript = fs.readFileSync(
          join(REPOSITORY_ROOT, "workflow/hooks/deny-dangerous.sh"),
          "utf8",
        );
        fs.mkdirSync(join(projectPath, legacyDirectory), { recursive: true });
        fs.writeFileSync(join(projectPath, legacyScript), officialScript);

        syncHookStates(projectPath);

        assert.equal(fs.existsSync(join(projectPath, legacyScript)), false);
        assert.deepEqual(
          // A profile without a hook config cannot appear as an installed hook provider.
          Object.values(PROFILES)
            .filter(
              (profile) =>
                profile.hookConfigFile !== null &&
                fs.existsSync(join(projectPath, profile.hookConfigFile)),
            )
            .map((profile) => profile.id),
          [agentId],
        );
        assert.deepEqual(
          fs.readFileSync(
            join(projectPath, ".goat-flow/hooks/deny-dangerous.sh"),
            "utf8",
          ),
          officialScript,
        );
      } finally {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    });
  }

  // Cleanup can fail after admission is refused or after files change; both outcomes need usable inspection commands.
  for (const failureStage of ["admission", "apply"] as const) {
    it(`prints working inspection commands when claim cleanup fails during ${failureStage}`, (testContext) => {
      const projectPath = fs.realpathSync(
        fs.mkdtempSync(join(tmpdir(), "hook recovery 'quoted'-")),
      );
      const changedFile = "notes.txt";
      // A competing writer stops admission before any destination changes; the apply case has no competing writer.
      const competingClaim =
        failureStage === "admission"
          ? acquirePathWriteClaims(projectPath, [
              {
                targetPath: changedFile,
                expectedIdentity: { state: "missing" },
              },
            ])
          : undefined;
      const originalUnlink = fs.unlinkSync;
      const blockedCleanup = testContext.mock.method(
        fs,
        "unlinkSync",
        (path) => {
          // Lost delete permission strands only this fixture's claims, as a failed Sync can on a user's project.
          if (
            String(path).startsWith(join(projectPath, ".goat-flow/state/locks"))
          ) {
            throw Object.assign(new Error("fixture claim cleanup denied"), {
              code: "EACCES",
            });
          }
          return originalUnlink(path);
        },
      );
      try {
        let failure: HookManagedInstallationError | undefined;
        try {
          executeHookChange(() => {
            const change = new PreparedHookChange(projectPath, {
              kind: "sync",
            });
            change.replaceText(changedFile, "Hook change completed.\n");
            return change;
          });
        } catch (error) {
          // Denied claim removal reaches callers as repair guidance even when file writes already succeeded.
          assert.ok(error instanceof HookManagedInstallationError);
          failure = error;
        }
        blockedCleanup.mock.restore();
        assert.ok(failure?.details);
        assert.equal(failure.details.code, "hook-claim-release-failed");
        assert.deepEqual(
          failure.details.changedPaths,
          failureStage === "apply" ? [changedFile] : [],
        );
        assert.equal(
          fs.existsSync(join(projectPath, changedFile)),
          failureStage === "apply",
        );
        const recovery = failure.details.recovery ?? "";
        assert.match(recovery, /goat-flow claims inspect/u);
        assert.doesNotMatch(recovery, /goat-flow writes/u);
        assert.ok(failure.details.paths.length > 0);
        // Every reported target must be inspectable without removing its claim or changing a hook file.
        for (const targetPath of failure.details.paths) {
          assert.ok(
            recovery.includes(
              pathWriteClaimInspectCommand(projectPath, targetPath),
            ),
          );
          const inspection = spawnSync(
            process.execPath,
            [
              "--import",
              "tsx",
              join(REPOSITORY_ROOT, "src/cli/cli.ts"),
              "claims",
              "inspect",
              projectPath,
              "--target",
              targetPath,
              "--format",
              "json",
            ],
            { cwd: REPOSITORY_ROOT, encoding: "utf8" },
          );
          assert.equal(
            inspection.status,
            0,
            inspection.stderr || inspection.stdout,
          );
          const report = JSON.parse(inspection.stdout);
          assert.equal(report.status, "present");
          assert.equal(report.projectRoot, projectPath);
          assert.equal(report.targetPath, targetPath);
          assert.equal(fs.existsSync(report.markerPath), true);
        }
      } finally {
        blockedCleanup.mock.restore();
        // Only the admission case owns an additional competing claim, released before the disposable project is removed.
        if (competingClaim) releasePathWriteClaims(competingClaim);
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    });
  }
});
