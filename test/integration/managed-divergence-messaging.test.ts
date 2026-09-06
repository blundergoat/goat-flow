/**
 * Check that Audit, Hooks and skill repair guidance agree about managed-file history.
 *
 * Disposable baselines distinguish safe package upgrades from local edits and missing history.
 * Real CLI and filesystem cases verify refusal, confirmed replacement, concurrent writers and partial-write recovery.
 */
import assert from "node:assert/strict";
import fileSystem from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  PreparedHookChange,
  executeHookChange,
} from "../../src/cli/server/hook-operation.js";
import {
  acquirePathWriteClaims,
  readPathWriteTargetIdentity,
  releasePathWriteClaims,
} from "../../src/cli/path-write-claim.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  linkSync,
  readdirSync,
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
  createManagedInstallStateRow,
  readManagedInstallStateFacade,
  writeManagedInstallStateV2,
} from "../../src/cli/managed-setup-state.js";
import {
  readAllHookStates,
  applyHookState,
  HookRegistrarError,
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
 * Record a previous Claude installation's exact file hash in a disposable project for drift comparisons.
 * Writes only that fixture's legacy state; the stored hash comes from the supplied previous-install bytes.
 *
 * @param projectPath - disposable fixture root that owns the local state
 * @param managedPath - safe project-relative managed destination
 *
 * @param expectedContent - exact bytes attributed to the previous install
 * @returns nothing after the fixture baseline is persisted
 */
function writeClaudeBaseline(
  projectPath: string,
  managedPath: string,
  expectedContent: string,
): void {
  writeLegacyBaseline(projectPath, "claude", managedPath, expectedContent);
}

/**
 * Write a provider's legacy file evidence in the disposable project before testing shared-history migration.
 * Writes change only its state filename and provider ID; the baseline row shape must remain identical.
 */
function writeLegacyBaseline(
  projectPath: string,
  agent: "antigravity" | "claude",
  managedPath: string,
  expectedContent: string,
): void {
  const baselinePath = join(
    projectPath,
    ".goat-flow",
    "install-state",
    `${agent}.json`,
  );
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(
    baselinePath,
    `${JSON.stringify(
      {
        schemaVersion: "goat-flow.install-state.v1",
        agent,
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

/**
 * Record supplied fixture bytes as one verified shared row without claiming a full install.
 * Writes only the fixture's managed.json; its expected hash must match the supplied bytes.
 */
function writeCanonicalBaseline(
  projectPath: string,
  managedPath: string,
  expectedContent: string,
): void {
  const row = createManagedInstallStateRow({
    path: managedPath,
    expectedSha256: sha256(expectedContent),
    provenance: {
      kind: "verified-install",
      goatFlowVersion: "1.16.0",
    },
  });
  writeManagedInstallStateV2(projectPath, {
    schemaVersion: "goat-flow.install-state.v2",
    files: [row],
    receipts: [],
  });
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
   * Fixture purpose: prove drift direction comes from the canonical row for every selected runtime.
   *
   * Side effects: writes v2 state plus one contradictory retained v1 file inside a disposable project.
   * Invariant: both filters report the v2 row's verified provenance and never consult the retained v1 hash.
   */
  it("uses one provenance-bearing v2 hook baseline for every agent", () => {
    const projectPath = setupFixture();
    try {
      writeHookFixtures(projectPath);
      const managedPath = ".goat-flow/hooks/deny-dangerous.sh";
      const installedPath = join(projectPath, managedPath);
      const previousTemplate =
        "#!/usr/bin/env bash\n# previous managed hook version\n";
      writeFileSync(installedPath, previousTemplate);
      writeCanonicalBaseline(projectPath, managedPath, previousTemplate);

      // Retained v1 evidence deliberately points at the incoming bytes; a per-agent fallback would misclassify the local file as diverged.
      writeClaudeBaseline(projectPath, managedPath, HOOK_STUB);

      // Changing the displayed provider must not change whether a shared file is safely behind.
      for (const agentFilter of ["claude", "antigravity"] as const) {
        const report = checkDrift({
          fs: createFS(projectPath),
          projectPath,
          templateRoot: projectPath,
          agentFilter,
        });
        const finding = report.findings.find(
          (candidate) => candidate.path === managedPath,
        );
        assert.ok(finding, `${agentFilter} audit must report the older hook`);
        assert.match(finding.message, /behind/u);
        assert.match(finding.message, /verified install 1\.16\.0/u);
        assert.doesNotMatch(finding.message, /diverged/u);
      }
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: keep audit's global legacy-bootstrap refusal byte-for-byte aligned with preview evidence.
   *
   * Filesystem side effects: creates, rewrites, and removes only disposable legacy state and hook fixture files.
   * Invariant: selected-agent input changes neither the blocking status nor the diagnostic text.
   */
  it("reports conflicting and malformed bootstrap evidence consistently with preview", () => {
    const projectPath = setupFixture();
    try {
      writeHookFixtures(projectPath);
      const managedPath = ".goat-flow/hooks/post-turn-safety.sh";
      writeLegacyBaseline(projectPath, "claude", managedPath, "claude bytes\n");
      writeLegacyBaseline(
        projectPath,
        "antigravity",
        managedPath,
        "antigravity bytes\n",
      );

      // Both selected providers must expose the same conflicting history before any repair is offered.
      for (const agentFilter of ["claude", "antigravity"] as const) {
        const preview = buildManagedSetupPreview(projectPath, agentFilter);
        assert.equal(preview.baselineStatus, "conflicting");
        const previewEvidence = preview.limits.find((limit) =>
          limit.startsWith("Install state is conflicting:"),
        );
        assert.ok(previewEvidence);
        const report = checkDrift({
          fs: createFS(projectPath),
          projectPath,
          templateRoot: projectPath,
          agentFilter,
        });
        const auditEvidence = report.findings.find(
          (finding) => finding.path === ".goat-flow/install-state",
        );
        assert.equal(auditEvidence?.message, previewEvidence);
      }

      writeFileSync(
        join(projectPath, ".goat-flow", "install-state", "antigravity.json"),
        "{\n",
      );
      const preview = buildManagedSetupPreview(projectPath, "claude");
      assert.equal(preview.baselineStatus, "malformed-blocking");
      const previewEvidence = preview.limits.find((limit) =>
        limit.startsWith("Install state is malformed-blocking:"),
      );
      assert.ok(previewEvidence);
      const report = checkDrift({
        fs: createFS(projectPath),
        projectPath,
        templateRoot: projectPath,
        agentFilter: "claude",
      });
      const auditEvidence = report.findings.find(
        (finding) => finding.path === ".goat-flow/install-state",
      );
      assert.equal(auditEvidence?.message, previewEvidence);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: prove one real baseline drives consistent audit, list, and sync outcomes.
   *
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
      writeCanonicalBaseline(hookProjectPath, hookManagedPath, currentTemplate);
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
      writeCanonicalBaseline(hookProjectPath, hookManagedPath, oldHookContent);
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
   *
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
      // Give each installed mirror a local edit so repair guidance must protect all user copies.
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
      // Every affected skill must offer reviewable install guidance before replacing a local mirror.
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

/**
 * Create a disposable project for a whole-operation refusal case, then remove it even when an assertion fails.
 * The callback can change only its fixture; this helper creates and deletes that temporary directory.
 */
function withAdmissionProject(scenario: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-hook-admission-"));
  try {
    scenario(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe("guarded hook admission", () => {
  // Admission must protect every destination, including cleanup after a late blocker.
  for (const blocker of [
    "unknown-content",
    "invalid-provider-config",
    "unsafe-state-target",
    "newer-late-file",
    "linked-late-file",
  ]) {
    it(`refuses ${blocker} before changing any hook destination`, () => {
      withAdmissionProject((root) => {
        mkdirSync(join(root, ".claude"), { recursive: true });
        mkdirSync(join(root, ".goat-flow/hooks"), { recursive: true });
        writeFileSync(
          join(root, ".claude/settings.json"),
          blocker === "invalid-provider-config" ? "{broken" : "{}\n",
        );
        writeFileSync(
          join(root, ".goat-flow/config.yaml"),
          "hooks:\n  deny-dangerous:\n    enabled: true\nplan-guard:\n  enabled: true\n",
        );
        writeFileSync(
          join(root, ".goat-flow/hooks/plan-checkbox-guard.sh"),
          "retired hook\n",
        );
        // This fixture represents a user's differing hook file whose installation history is missing.
        if (blocker === "unknown-content") {
          writeFileSync(
            join(root, ".goat-flow/hooks/deny-dangerous.sh"),
            "local hook with no baseline\n",
          );
        }
        // A directory at a late state destination must block earlier queued hook changes.
        if (blocker === "unsafe-state-target") {
          mkdirSync(join(root, ".goat-flow/install-state/copilot.json"), {
            recursive: true,
          });
        }
        // Stop is prepared after the policy hooks, so a late blocker must preserve their earlier queued changes too.
        if (blocker === "newer-late-file") {
          writeFileSync(
            join(root, ".goat-flow/hooks/post-turn-safety.sh"),
            "#!/usr/bin/env bash\n# goat-flow-hook-version: 999.0.0\n",
          );
        }
        // A local hard link cannot authorize overwriting both names through one managed destination.
        if (blocker === "linked-late-file") {
          const localCopy = join(root, "linked-hook-fixture.sh");
          writeFileSync(localCopy, "local hook bytes\n");
          linkSync(
            localCopy,
            join(root, ".goat-flow/hooks/post-turn-safety.sh"),
          );
        }
        const before = hookDestinationSnapshot(root);
        assert.throws(() => syncHookStates(root));
        assert.deepEqual(hookDestinationSnapshot(root), before);
      });
    });
  }
});

/** Capture exact destination bytes; claim coordination is outside the refusal guarantee. */
function hookDestinationSnapshot(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  /** Walk only the disposable project so refusal assertions can compare all managed file bytes. */
  function readDirectory(directory: string): void {
    // Capture every destination in the disposable project before and after a refused operation.
    for (const entry of readdirSync(join(root, directory), {
      withFileTypes: true,
    })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      // Write-claim markers coordinate writers and are outside the managed-destination no-change guarantee.
      if (path === ".goat-flow/write-claims") continue;
      // Nested hook files must participate in the exact-byte refusal comparison.
      if (entry.isDirectory()) readDirectory(path);
      else snapshot[path] = readFileSync(join(root, path)).toString("base64");
    }
  }
  readDirectory("");
  return snapshot;
}

describe("guarded hook sync", () => {
  it("requires a fresh exact review for changed files, choices, and toggle intent", () => {
    const projectPath = createClaudeProject();
    try {
      const hookPath = join(
        projectPath,
        ".goat-flow/hooks/deny-dangerous/guard-runtime.sh",
      );
      const official = readFileSync(hookPath, "utf-8");
      writeFileSync(hookPath, `${official}\n# local change\n`);
      const review = captureReplacementReview(() =>
        syncHookStates(projectPath),
      );
      assert.deepEqual(review.conflicts?.[0]?.hookIds, [
        "deny-dangerous",
        "deny-git-mutations",
      ]);
      assert.equal(review.conflicts?.[0]?.reason, "diverged");

      const configPath = join(projectPath, ".goat-flow/config.yaml");
      const changedConfig = `${readFileSync(configPath, "utf-8")}\n# changed since review\n`;
      writeFileSync(configPath, changedConfig);
      assert.equal(
        captureReplacementReview(() =>
          syncHookStates(projectPath, {
            replace: true,
            confirmationIdentity: review.confirmationIdentity,
          }),
        ).code,
        "hook-review-stale",
      );
      assert.equal(readFileSync(configPath, "utf-8"), changedConfig);

      const refreshed = captureReplacementReview(() =>
        syncHookStates(projectPath),
      );
      assert.equal(
        captureReplacementReview(() =>
          applyHookState("deny-dangerous", true, projectPath, {
            replace: true,
            confirmationIdentity: refreshed.confirmationIdentity,
          }),
        ).code,
        "hook-review-stale",
      );
      writeFileSync(hookPath, `${official}\n# another local save\n`);
      assert.equal(
        captureReplacementReview(() =>
          syncHookStates(projectPath, {
            replace: true,
            confirmationIdentity: refreshed.confirmationIdentity,
          }),
        ).code,
        "hook-review-stale",
      );

      const current = captureReplacementReview(() =>
        syncHookStates(projectPath),
      );
      const hookRows = syncHookStates(projectPath, {
        replace: true,
        confirmationIdentity: current.confirmationIdentity,
      });
      assert.equal(readFileSync(hookPath, "utf-8"), official);
      assert.ok(
        hookRows.every(
          (hook) => hook.enabled === (hook.id !== "gruff-code-quality"),
        ),
      );
      const stateBytes = readFileSync(
        join(projectPath, ".goat-flow/install-state/managed.json"),
        "utf-8",
      );
      syncHookStates(projectPath);
      assert.equal(
        readFileSync(
          join(projectPath, ".goat-flow/install-state/managed.json"),
          "utf-8",
        ),
        stateBytes,
      );
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  // The fixture writes missing-history files and runs the CLI: differing local bytes require review, while bundled copies can be adopted.
  it("refuses differing unknown files through the real CLI and safely adopts identical copies", () => {
    const projectPath = createClaudeProject();
    try {
      rmSync(join(projectPath, ".goat-flow/install-state"), {
        recursive: true,
        force: true,
      });
      const hookPath = join(
        projectPath,
        ".goat-flow/hooks/post-turn-safety.sh",
      );
      const official = readFileSync(hookPath, "utf-8");
      writeFileSync(hookPath, `${official}\n# unknown local content\n`);
      const review = captureReplacementReview(() =>
        syncHookStates(projectPath),
      );
      assert.equal(review.conflicts?.[0]?.reason, "unclassified");
      const cli = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          join(import.meta.dirname, "../../src/cli/cli.ts"),
          "hooks",
          "sync",
          projectPath,
        ],
        {
          encoding: "utf-8",
          timeout: 30_000,
        },
      );
      assert.equal(cli.status, 1, cli.stderr);
      assert.match(cli.stderr, /dashboard Hooks page/u);
      assert.equal(
        readFileSync(hookPath, "utf-8"),
        `${official}\n# unknown local content\n`,
      );
      writeFileSync(hookPath, official);
      syncHookStates(projectPath);
      assert.equal(
        readManagedInstallStateFacade(projectPath).state?.receipts.length,
        0,
      );
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("keeps overlapping claims intact across real CLI hook sync and public install refusals", () => {
    const projectPath = createClaudeProject();
    const targetPath = ".goat-flow/install-state/managed.json";
    const claim = acquirePathWriteClaims(projectPath, [
      {
        targetPath,
        expectedIdentity: readPathWriteTargetIdentity(projectPath, targetPath),
      },
    ]);
    try {
      const stateBefore = readFileSync(join(projectPath, targetPath), "utf-8");
      // Both public commands must refuse the same claim before reaching their different apply paths.
      for (const command of [
        ["hooks", "sync", projectPath],
        ["install", projectPath, "--agent", "claude", "--force-managed"],
      ]) {
        const result = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            join(import.meta.dirname, "../../src/cli/cli.ts"),
            ...command,
          ],
          {
            encoding: "utf-8",
            timeout: 30_000,
          },
        );
        assert.equal(result.status, 1, `${command[0]}: ${result.stderr}`);
        assert.match(result.stderr, /owns|busy/u, command[0]);
        assert.equal(
          readFileSync(join(projectPath, targetPath), "utf-8"),
          stateBefore,
          command[0],
        );
      }
    } finally {
      assert.ok(
        releasePathWriteClaims(claim).every(
          (result) => result.status === "released",
        ),
      );
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  // Check failures during file replacement and history publication because users need accurate recovery for both.
  for (const failurePoint of [
    "runtime-copy",
    "baseline-publication",
  ] as const) {
    it(`reports partial changes after ${failurePoint} fails and recovers on retry`, (context) => {
      const projectPath = createClaudeProject();
      const scriptPath = ".goat-flow/hooks/deny-dangerous.sh";
      const otherPath = ".goat-flow/hooks/deny-git-mutations.sh";
      const baselinePath = join(
        projectPath,
        ".goat-flow/install-state/managed.json",
      );
      const official = readFileSync(join(projectPath, scriptPath), "utf-8");
      const originalRename = fileSystem.renameSync;
      try {
        const baseline = readManagedInstallStateFacade(projectPath).state;
        assert.ok(baseline);
        // These two older package files are pristine relative to their captured baseline.
        for (const path of [scriptPath, otherPath]) {
          const oldBytes = "#!/usr/bin/env bash\n# earlier package file\n";
          writeFileSync(join(projectPath, path), oldBytes);
          const row = baseline.files.find(
            (candidate) => candidate.path === path,
          );
          assert.ok(row);
          Object.assign(
            row,
            createManagedInstallStateRow({
              path,
              expectedSha256: sha256(oldBytes),
              provenance: {
                kind: "verified-install",
                goatFlowVersion: "1.16.0",
              },
            }),
          );
        }
        writeManagedInstallStateV2(projectPath, baseline);
        const beforeState = readFileSync(baselinePath, "utf-8");
        const rejectedPath =
          failurePoint === "runtime-copy"
            ? join(projectPath, otherPath)
            : baselinePath;
        const rename = context.mock.method(
          fileSystem,
          "renameSync",
          (source, destination) => {
            // Simulate an OS rename failure at one real persistence boundary after earlier hook writes have completed.
            if (String(destination) === rejectedPath)
              throw Object.assign(new Error("fixture rename denied"), {
                code: "EACCES",
              });
            return originalRename(source, destination);
          },
        );
        syncBuiltinESMExports();
        assert.throws(
          () => syncHookStates(projectPath),
          (error: unknown) => {
            assert.ok(error instanceof HookRegistrarError);
            assert.equal(error.details?.code, "hook-apply-failed");
            assert.ok(error.details.changedPaths?.includes(scriptPath));
            return true;
          },
        );
        assert.equal(
          readFileSync(join(projectPath, scriptPath), "utf-8"),
          official,
        );
        assert.equal(readFileSync(baselinePath, "utf-8"), beforeState);
        rename.mock.restore();
        syncBuiltinESMExports();
        syncHookStates(projectPath);
        const recovered = readManagedInstallStateFacade(projectPath).state;
        assert.equal(
          recovered?.files.find((row) => row.path === scriptPath)
            ?.expectedSha256,
          sha256(official),
        );
        assert.deepEqual(recovered?.receipts, baseline.receipts);
      } finally {
        fileSystem.renameSync = originalRename;
        syncBuiltinESMExports();
        rmSync(projectPath, { recursive: true, force: true });
      }
    });
  }
});

/** Capture the replacement list a user would review; a missing or non-replaceable conflict fails the fixture immediately. */
function captureReplacementReview(
  action: () => unknown,
): NonNullable<HookRegistrarError["details"]> {
  let review: HookRegistrarError["details"];
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof HookRegistrarError);
    assert.equal(error.statusCode, 409);
    assert.equal(error.details?.replacementAvailable, true);
    assert.match(error.details.confirmationIdentity ?? "", /^[a-f0-9]{64}$/u);
    review = error.details;
    return true;
  });
  assert.ok(review);
  return review;
}

describe("hook operation recovery boundaries", () => {
  it("reviews non-UTF-8 local hook bytes without mistaking their encoding for an editor race", () => {
    const projectPath = createClaudeProject();
    try {
      const path = join(projectPath, ".goat-flow/hooks/deny-dangerous.sh");
      const official = readFileSync(path);
      const edited = Buffer.concat([
        official,
        Buffer.from([10, 35, 32, 255, 10]),
      ]);
      writeFileSync(path, edited);
      const review = captureReplacementReview(() =>
        syncHookStates(projectPath),
      );
      assert.equal(review.conflicts?.[0]?.reason, "diverged");
      assert.deepEqual(readFileSync(path), edited);
      syncHookStates(projectPath, {
        replace: true,
        confirmationIdentity: review.confirmationIdentity,
      });
      assert.deepEqual(readFileSync(path), official);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("rebuilds under claims and refuses an external save before applying another queued destination", () => {
    const projectPath = createClaudeProject();
    try {
      const configPath = join(projectPath, ".goat-flow/config.yaml");
      const userSave = `${readFileSync(configPath, "utf-8")}\n# saved during admission\n`;
      const providerPath = join(projectPath, ".claude/settings.json");
      const providerBefore = readFileSync(providerPath, "utf-8");
      let preparationCount = 0;
      assert.throws(
        () =>
          executeHookChange(() => {
            preparationCount += 1;
            // This controlled editor save happens after the first plan acquires claims but before the second plan reads its evidence.
            if (preparationCount === 2) writeFileSync(configPath, userSave);
            const operation = new PreparedHookChange(projectPath, {
              kind: "sync",
            });
            operation.replaceText(".goat-flow/config.yaml", "hooks: {}\n");
            operation.replaceText(".claude/settings.json", "{}\n");
            return operation;
          }),
        (error: unknown) => {
          assert.ok(error instanceof HookRegistrarError);
          assert.equal(error.details?.code, "hook-review-stale");
          return true;
        },
      );
      assert.equal(preparationCount, 2);
      assert.equal(readFileSync(configPath, "utf-8"), userSave);
      assert.equal(readFileSync(providerPath, "utf-8"), providerBefore);
      syncHookStates(projectPath);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("leaves a receipt-free checkpoint after interrupted cutover and recovers through public install", (context) => {
    const projectPath = createClaudeProject();
    const originalRename = fileSystem.renameSync;
    try {
      rmSync(join(projectPath, ".goat-flow/install-state"), {
        recursive: true,
        force: true,
      });
      const markerPath = join(
        projectPath,
        ".goat-flow/install-state/copilot.json",
      );
      const rename = context.mock.method(
        fileSystem,
        "renameSync",
        (source, destination) => {
          // A filesystem permission failure can interrupt the last marker after canonical history has already been published.
          if (String(destination) === markerPath)
            throw Object.assign(new Error("fixture marker rename denied"), {
              code: "EACCES",
            });
          return originalRename(source, destination);
        },
      );
      syncBuiltinESMExports();
      assert.throws(
        () => syncHookStates(projectPath),
        (error: unknown) => {
          assert.ok(error instanceof HookRegistrarError);
          assert.equal(error.details?.code, "hook-apply-failed");
          assert.ok(
            error.details.changedPaths?.includes(
              ".goat-flow/install-state/managed.json",
            ),
          );
          return true;
        },
      );
      const checkpoint = readManagedInstallStateFacade(projectPath).state;
      assert.ok(checkpoint);
      assert.deepEqual(checkpoint.receipts, []);
      rename.mock.restore();
      syncBuiltinESMExports();
      assert.throws(
        () => syncHookStates(projectPath),
        /cutover markers are incomplete/u,
      );
      const installed = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          join(import.meta.dirname, "../../src/cli/cli.ts"),
          "install",
          projectPath,
          "--agent",
          "claude",
          "--force-managed",
        ],
        { encoding: "utf-8", timeout: 30_000 },
      );
      assert.equal(installed.status, 0, installed.stderr || installed.stdout);
      syncHookStates(projectPath);
      assert.ok(
        readManagedInstallStateFacade(projectPath).state?.receipts.length,
      );
    } finally {
      fileSystem.renameSync = originalRename;
      syncBuiltinESMExports();
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
