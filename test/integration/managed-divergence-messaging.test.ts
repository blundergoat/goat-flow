/**
 * Cross-surface proof for managed-file drift direction and repair truthfulness.
 * These fixtures use real install baselines so audit, hook status, hook sync,
 * and skill doctor expose their different evidence units without guessing.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { getAgentProfiles } from "../../src/cli/agents/registry.js";
import { checkDrift } from "../../src/cli/audit/check-drift.js";
import { createFS } from "../../src/cli/facts/fs.js";
import { buildManagedSetupPreview } from "../../src/cli/managed-setup-preview.js";
import {
  readAllHookStates,
  syncHookStates,
} from "../../src/cli/server/hook-registrar.js";
import {
  renderSkillDoctorText,
  runSkillDoctor,
} from "../../src/cli/skill-doctor.js";
import type { CanonicalSkillRead } from "../../src/cli/skill-doctor.js";
import {
  HOOK_STUB,
  setupFixture,
  writeHookFixtures,
} from "./audit-drift.helpers.js";

/** Hash exact managed bytes using the same SHA-256 representation as install state. */
function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Write one valid Claude baseline row into a disposable project.
 * Filesystem side effects: creates or replaces the fixture's Claude install-state file.
 * Invariant: the stored hash represents the exact fixture bytes named by the relative path.
 *
 * @param projectPath - disposable fixture root that owns the local state
 * @param managedPath - safe project-relative managed destination
 * @param expectedContent - exact bytes attributed to the previous install
 * @returns nothing after the fixture baseline is persisted
 */
function writeClaudeBaseline(
  projectPath: string,
  managedPath: string,
  expectedContent: string,
): void {
  const baselinePath = join(
    projectPath,
    ".goat-flow",
    "install-state",
    "claude.json",
  );
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(
    baselinePath,
    `${JSON.stringify(
      {
        schemaVersion: "goat-flow.install-state.v1",
        agent: "claude",
        goatFlowVersion: "1.15.0",
        files: [
          {
            path: managedPath,
            expectedSha256: sha256(expectedContent),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

/** Return one Claude hook row from the public list surface. */
function claudeHookState(projectPath: string, hookId: string) {
  const hook = readAllHookStates(projectPath).find(
    (candidate) => candidate.id === hookId,
  );
  assert.ok(hook, `missing hook state ${hookId}`);
  return hook.agents.claude;
}

/**
 * Create the smallest installed Claude surface the registrar will reconcile.
 * Side effects: creates a temporary Git project and writes current managed hook files.
 *
 * @returns disposable project root; the calling test removes it in finally
 */
function createClaudeProject(): string {
  const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-divergence-"));
  mkdirSync(join(projectPath, ".goat-flow"), { recursive: true });
  mkdirSync(join(projectPath, ".claude"), { recursive: true });
  writeFileSync(
    join(projectPath, ".goat-flow", "config.yaml"),
    'version: "1.15.0"\n',
  );
  writeFileSync(join(projectPath, ".claude", "settings.json"), "{}\n");
  const gitInitialization = spawnSync("git", ["init", "--quiet"], {
    cwd: projectPath,
    encoding: "utf-8",
  });
  assert.equal(gitInitialization.status, 0, gitInitialization.stderr);
  syncHookStates(projectPath);
  return projectPath;
}

describe("managed divergence messaging", () => {
  /**
   * Fixture purpose: prove one real baseline drives consistent audit, list, and sync outcomes.
   * Side effects: writes only inside two disposable projects removed in finally.
   * Invariant: failed destructive sync leaves the locally changed hook byte-identical.
   */
  it("distinguishes behind from diverged and refuses a destructive hook sync", () => {
    const auditProjectPath = setupFixture();
    const hookProjectPath = createClaudeProject();
    try {
      writeHookFixtures(auditProjectPath);
      const auditManagedPath = ".goat-flow/hooks/post-turn-safety.sh";
      const auditInstalledPath = join(auditProjectPath, auditManagedPath);
      const previousTemplate =
        "#!/usr/bin/env bash\n# previous managed hook version\n";

      writeFileSync(auditInstalledPath, previousTemplate);
      writeClaudeBaseline(auditProjectPath, auditManagedPath, previousTemplate);
      const behindReport = checkDrift({
        fs: createFS(auditProjectPath),
        projectPath: auditProjectPath,
        templateRoot: auditProjectPath,
        agentFilter: "claude",
      });
      const behindFinding = behindReport.findings.find(
        (finding) => finding.path === auditManagedPath,
      );
      assert.ok(behindFinding, "audit must report the older managed hook");
      assert.match(behindFinding.message, /behind/u);
      assert.match(behindFinding.message, /run goat-flow hooks sync/u);

      writeClaudeBaseline(auditProjectPath, auditManagedPath, HOOK_STUB);
      writeFileSync(auditInstalledPath, `${HOOK_STUB}# local safety fix\n`);
      const divergedReport = checkDrift({
        fs: createFS(auditProjectPath),
        projectPath: auditProjectPath,
        templateRoot: auditProjectPath,
        agentFilter: "claude",
      });
      const divergedFinding = divergedReport.findings.find(
        (finding) => finding.path === auditManagedPath,
      );
      assert.ok(divergedFinding, "audit must report the locally changed hook");
      assert.match(divergedFinding.message, /diverged/u);
      assert.match(
        divergedFinding.message,
        /sync would overwrite local content/u,
      );
      assert.doesNotMatch(divergedFinding.message, /run goat-flow hooks sync/u);

      const hookManagedPath = ".goat-flow/hooks/post-turn-safety.sh";
      const hookInstalledPath = join(hookProjectPath, hookManagedPath);
      const currentTemplate = readFileSync(hookInstalledPath, "utf-8");
      writeClaudeBaseline(hookProjectPath, hookManagedPath, currentTemplate);
      const localHookContent = `${currentTemplate}\n# local safety fix\n`;
      writeFileSync(hookInstalledPath, localHookContent);

      const divergedHookState = claudeHookState(
        hookProjectPath,
        "post-turn-safety",
      );
      const divergedInstallRow = buildManagedSetupPreview(
        hookProjectPath,
        "claude",
      ).files.find((file) => file.path === hookManagedPath);
      assert.equal(divergedInstallRow?.state, "local-preserved");
      assert.equal(divergedInstallRow?.action, "none");
      assert.match(
        divergedInstallRow?.reason ?? "",
        /full-file replacement would discard it/u,
      );
      assert.equal(
        divergedHookState.installationIssue,
        "installed-content-diverged",
      );
      assert.equal(divergedHookState.repairCommand, null);
      assert.match(
        divergedHookState.repairSummary,
        /sync would overwrite local content/u,
      );
      assert.throws(
        () => syncHookStates(hookProjectPath),
        /Refusing to sync diverged managed hook files/u,
      );
      assert.equal(readFileSync(hookInstalledPath, "utf-8"), localHookContent);

      const oldHookContent =
        "#!/usr/bin/env bash\n# previous installed hook version\n";
      writeFileSync(hookInstalledPath, oldHookContent);
      writeClaudeBaseline(hookProjectPath, hookManagedPath, oldHookContent);
      const behindHookState = claudeHookState(
        hookProjectPath,
        "post-turn-safety",
      );
      const behindInstallRow = buildManagedSetupPreview(
        hookProjectPath,
        "claude",
      ).files.find((file) => file.path === hookManagedPath);
      assert.equal(behindInstallRow?.state, "template-changed");
      assert.equal(behindInstallRow?.action, "replace");
      assert.match(behindInstallRow?.reason ?? "", /refresh is safe/u);
      assert.equal(
        behindHookState.installationIssue,
        "installed-version-behind",
      );
      assert.match(behindHookState.repairCommand ?? "", /hooks sync/u);
      syncHookStates(hookProjectPath);
      assert.notEqual(readFileSync(hookInstalledPath, "utf-8"), oldHookContent);
    } finally {
      rmSync(auditProjectPath, { recursive: true, force: true });
      rmSync(hookProjectPath, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: reproduce one skill delta across every agent mirror and one filtered audit.
   * Filesystem side effects: writes installed skill copies and removes the disposable project in finally.
   * Invariant: doctor counts agent-skill rows while audit retains its selected-agent file scope.
   */
  it("explains why doctor and agent-filtered audit counts differ", () => {
    const projectPath = setupFixture();
    try {
      const skillName = "goat-clarity";
      const sourcePath = `workflow/skills/${skillName}/SKILL.md`;
      const sourceContent = readFileSync(
        join(projectPath, sourcePath),
        "utf-8",
      );
      const agentProfiles = getAgentProfiles();
      const installedPaths = new Set(
        agentProfiles.map(
          (agentProfile) => `${agentProfile.skillsDir}/${skillName}/SKILL.md`,
        ),
      );
      for (const installedPath of installedPaths) {
        writeFileSync(
          join(projectPath, installedPath),
          `${sourceContent}\nLocal mirror drift.\n`,
        );
      }

      const doctorReport = runSkillDoctor({
        projectPath,
        fs: createFS(projectPath),
        agentProfiles,
        canonicalSkillNames: [skillName],
        skillFilter: null,
        readCanonicalSkill: (requestedPath): CanonicalSkillRead => ({
          state: "readable",
          content: readFileSync(join(projectPath, requestedPath), "utf-8"),
        }),
      });
      const auditReport = checkDrift({
        fs: createFS(projectPath),
        projectPath,
        templateRoot: projectPath,
        agentFilter: "claude",
      });
      const claudeSkillFindings = auditReport.findings.filter(
        (finding) =>
          finding.path.replace(/\/+/gu, "/") ===
          `.claude/skills/${skillName}/SKILL.md`,
      );

      assert.equal(claudeSkillFindings.length, 1);
      assert.equal(doctorReport.summary.checked, agentProfiles.length);
      assert.equal(doctorReport.summary.mirrorDrift, agentProfiles.length);
      assert.ok(
        doctorReport.summary.warnings > doctorReport.summary.mirrorDrift,
        "warning messages must remain distinct from differing-file rows",
      );
      assert.match(
        renderSkillDoctorText(doctorReport),
        /Count scope: One SKILL\.md mirror is counted per agent-skill row; warning totals count messages\. Audit may select one agent and also checks declared reference files\./u,
      );
      for (const skill of doctorReport.agents.flatMap(
        (agentResult) => agentResult.skills,
      )) {
        assert.ok(
          skill.remediation.some((command) => /--dry-run/u.test(command)),
        );
        assert.ok(
          skill.remediation.every(
            (command) =>
              !/^goat-flow install <project-path> --agent [a-z]+$/u.test(
                command,
              ),
          ),
        );
      }
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
