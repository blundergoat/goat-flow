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

import { getTemplatePath } from "../../src/cli/paths.js";
import {
  downgradeCodexBaselineToSevenSkills,
  makeTempProject,
  recordStaleBaselineHashes,
  runCliInstaller,
  symlinkDirectoryOrSkip,
} from "./setup-install.helpers.js";

const CODEX_GOAT_CLARITY_PATH = ".agents/skills/goat-clarity/SKILL.md";

/** One preview row as the JSON contract publishes it. */
interface PreviewRow {
  path: string;
  ownership: string;
  state: string;
  action: string;
  reason: string;
  currentStatus: string;
  newExpectedSha256: string | null;
}

/** Every row on a fresh target names a safe relative path with an explained absent destination. */
function isSafeFreshTargetRow(file: PreviewRow): boolean {
  return (
    file.path.length > 0 &&
    !file.path.startsWith("/") &&
    file.reason.length > 0 &&
    file.currentStatus === "missing"
  );
}

/** An exact-copy template on a fresh target is created from a package hash. */
function isFreshTemplateCreate(file: PreviewRow): boolean {
  return (
    file.state === "added" &&
    file.action === "create" &&
    /^[a-f0-9]{64}$/u.test(file.newExpectedSha256 ?? "")
  );
}

/** A non-template destination declares user or generated ownership and carries no template hash. */
function isProjectWriteRow(file: PreviewRow): boolean {
  return (
    (file.ownership === "user-owned" || file.ownership === "generated") &&
    file.newExpectedSha256 === null
  );
}

/**
 * Assert the preview lists one path, optionally with the exact fields the user must see.
 *
 * @param files - every row the preview reported for this target
 * @param expected - path to find plus any row fields that must match it
 */
function assertPreviewLists(
  files: PreviewRow[],
  expected: Partial<PreviewRow> & { path: string },
): void {
  const row = files.find((file) => file.path === expected.path);
  assert.ok(row, `preview must list ${expected.path}`);
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(row[field as keyof PreviewRow], value, expected.path);
  }
}

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
      files: PreviewRow[];
    };
    assert.equal(report.schemaVersion, "goat-flow.managed-setup-preview.v2");
    assert.equal(report.coverage, "install-write-set");
    assert.equal(report.verdict, "ready");
    assert.equal(
      report.files.some((file) => file.state === "added"),
      true,
    );
    assert.equal(report.files.every(isSafeFreshTargetRow), true);
    // Every exact-copy template on a fresh target is a create backed by a package hash.
    assert.equal(
      report.files
        .filter((file) => file.ownership === "system-owned")
        .every(isFreshTemplateCreate),
      true,
    );
    // User-owned and generated destinations complete the write set and carry no template hash.
    assert.equal(
      report.files
        .filter((file) => file.ownership !== "system-owned")
        .every(isProjectWriteRow),
      true,
    );
    assertPreviewLists(report.files, {
      path: ".goat-flow/config.yaml",
      ownership: "user-owned",
      state: "user-seeded",
    });
    assertPreviewLists(report.files, {
      path: ".codex/hooks.json",
      ownership: "user-owned",
      action: "create",
    });
    assertPreviewLists(report.files, {
      path: ".goat-flow/hooks/deny-dangerous.sh",
    });
    assertPreviewLists(report.files, { path: ".agents/skills/goat/SKILL.md" });
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
    assert.match(result.stdout, /Coverage: install-write-set/u);
    assert.match(
      result.stdout,
      /create\s+system-owned\s+\.goat-flow\/hooks\/deny-dangerous\.sh \[added\] - The current goat-flow package adds this managed file\./u,
    );
    assert.match(
      result.stdout,
      /create\s+user-owned\s+\.goat-flow\/config\.yaml \[user-seeded\] - Install scaffolds this config once/u,
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
      files: PreviewRow[];
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

  it("upgrades a seven-skill baseline and repeats without drift", () => {
    const projectPath = makeTempProject();
    const firstInstall = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(
      firstInstall.status,
      0,
      firstInstall.stderr || firstInstall.stdout,
    );
    downgradeCodexBaselineToSevenSkills(projectPath);
    const installedClarityPath = join(projectPath, CODEX_GOAT_CLARITY_PATH);
    rmSync(installedClarityPath);

    const upgrade = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(upgrade.status, 0, upgrade.stderr || upgrade.stdout);
    assert.equal(
      readFileSync(installedClarityPath, "utf-8"),
      readFileSync(
        getTemplatePath("workflow/skills/goat-clarity/SKILL.md"),
        "utf-8",
      ),
    );

    const repeatInstall = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(
      repeatInstall.status,
      0,
      repeatInstall.stderr || repeatInstall.stdout,
    );
    const repeatPreview = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--dry-run",
      "--format",
      "json",
    );
    assert.equal(repeatPreview.status, 0, repeatPreview.stderr);
    const report = JSON.parse(repeatPreview.stdout) as {
      verdict: string;
      files: PreviewRow[];
    };
    const clarityFile = report.files.find(
      (file) => file.path === CODEX_GOAT_CLARITY_PATH,
    );
    assert.equal(report.verdict, "ready");
    assert.equal(clarityFile?.state, "unchanged");
    assert.equal(clarityFile?.action, "none");
  });

  it("protects an existing goat-clarity path a loaded baseline never owned", () => {
    const projectPath = makeTempProject();
    const firstInstall = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(
      firstInstall.status,
      0,
      firstInstall.stderr || firstInstall.stdout,
    );
    downgradeCodexBaselineToSevenSkills(projectPath);
    const installedClarityPath = join(projectPath, CODEX_GOAT_CLARITY_PATH);
    const developerOwnedBytes =
      "# Local goat-clarity\n\nKeep this developer-owned skill.\n";
    writeFileSync(installedClarityPath, developerOwnedBytes);

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
      files: PreviewRow[];
    };
    const clarityFile = report.files.find(
      (file) => file.path === CODEX_GOAT_CLARITY_PATH,
    );
    assert.equal(report.verdict, "blocked");
    assert.equal(clarityFile?.state, "unmanaged");
    assert.equal(clarityFile?.action, "protect");
    assert.match(clarityFile?.reason ?? "", /loaded install baseline/u);

    const blockedInstall = runCliInstaller(projectPath, "--agent", "codex");
    assert.notEqual(blockedInstall.status, 0);
    assert.match(blockedInstall.stderr, /goat-clarity/u);
    assert.equal(
      readFileSync(installedClarityPath, "utf-8"),
      developerOwnedBytes,
    );
  });

  it("blocks a changed template over a local edit until the user supplies force", () => {
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
    // Divergent bytes alone are preserved now; a stale baseline makes the package want this path too.
    recordStaleBaselineHashes(projectPath, "codex", [
      ".goat-flow/logs/quality/README.md",
    ]);

    const blockedInstall = runCliInstaller(projectPath, "--agent", "codex");
    assert.notEqual(blockedInstall.status, 0);
    assert.match(blockedInstall.stderr, /both-changed/u);
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

  /** Fixture purpose: force refreshes one edited managed file while preserving user choices and separate cleanup authority.
   * Filesystem side effects: creates and rewrites a disposable project, then spawns the installer subprocess. */
  it("limits force to managed conflicts and preserves user-owned content", () => {
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
    const locallyEditedManagedContent = "force may replace this managed edit\n";
    writeFileSync(managedReadmePath, locallyEditedManagedContent);
    // Only a package template change makes this row a conflict force is allowed to resolve.
    recordStaleBaselineHashes(projectPath, "codex", [
      ".goat-flow/logs/quality/README.md",
    ]);

    const securityPolicyPath = join(
      projectPath,
      ".goat-flow",
      "security-policy.md",
    );
    const userSecurityPolicy =
      "# Team security policy\n\nKeep this project-specific rule.\n";
    writeFileSync(securityPolicyPath, userSecurityPolicy);

    const decisionGuidePath = join(
      projectPath,
      ".goat-flow",
      "learning-loop",
      "decisions",
      "README.md",
    );
    const userDecisionGuide =
      "# Team decisions\n\nKeep this local decision format.\n";
    writeFileSync(decisionGuidePath, userDecisionGuide);

    const configPath = join(projectPath, ".goat-flow", "config.yaml");
    const userConfig = [
      "# User-selected setup remains authoritative during a managed refresh.",
      'version: "local"',
      'project_name: "operator-console"',
      "skills:",
      "  install: all",
      "hooks:",
      "  deny-dangerous:",
      "    enabled: false",
      "  post-turn-safety:",
      "    enabled: true",
      "  gruff-code-quality:",
      "    enabled: false",
      "ui:",
      "  density: compact",
      "",
    ].join("\n");
    writeFileSync(configPath, userConfig);

    const activePlanPath = join(projectPath, ".goat-flow", "plans", ".active");
    mkdirSync(join(projectPath, ".goat-flow", "plans", "9.9.9"), {
      recursive: true,
    });
    const userActivePlan = "manual-plan-selection\n";
    writeFileSync(activePlanPath, userActivePlan);

    const codexSettingsPath = join(projectPath, ".codex", "config.toml");
    const installedCodexSettings = readFileSync(codexSettingsPath, "utf-8");
    const userCodexSettings = [
      installedCodexSettings.trimEnd(),
      "",
      "# Keep this UI preference and its explanation.",
      "[ui]",
      'theme = "high-contrast"',
      "",
    ].join("\n");
    writeFileSync(codexSettingsPath, userCodexSettings);

    const codexHooksPath = join(projectPath, ".codex", "hooks.json");
    const userHookConfig = JSON.parse(
      readFileSync(codexHooksPath, "utf-8"),
    ) as {
      hooks?: Record<string, Array<Record<string, unknown>>>;
      userInterface?: { statusMessage: string };
    };
    userHookConfig.userInterface = { statusMessage: "keep my status" };
    userHookConfig.hooks ??= {};
    userHookConfig.hooks.PreToolUse ??= [];
    userHookConfig.hooks.PreToolUse.push({
      matcher: "UserTool",
      hooks: [{ type: "command", command: "node user-hook.js" }],
    });
    writeFileSync(
      codexHooksPath,
      `${JSON.stringify(userHookConfig, null, 2)}\n`,
    );

    const deprecatedSkillNotePath = join(
      projectPath,
      ".agents",
      "skills",
      "goat-audit",
      "user-notes.md",
    );
    mkdirSync(join(projectPath, ".agents", "skills", "goat-audit"), {
      recursive: true,
    });
    writeFileSync(deprecatedSkillNotePath, "keep until explicit cleanup\n");

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
    assert.notEqual(
      readFileSync(managedReadmePath, "utf-8"),
      locallyEditedManagedContent,
    );
    assert.equal(readFileSync(securityPolicyPath, "utf-8"), userSecurityPolicy);
    assert.equal(readFileSync(decisionGuidePath, "utf-8"), userDecisionGuide);
    assert.equal(readFileSync(configPath, "utf-8"), userConfig);
    assert.equal(readFileSync(activePlanPath, "utf-8"), userActivePlan);
    assert.equal(readFileSync(codexSettingsPath, "utf-8"), userCodexSettings);
    assert.equal(existsSync(deprecatedSkillNotePath), true);

    const installedHookConfig = readFileSync(codexHooksPath, "utf-8");
    assert.match(installedHookConfig, /node user-hook\.js/u);
    assert.match(installedHookConfig, /keep my status/u);
    assert.doesNotMatch(installedHookConfig, /deny-dangerous\.sh/u);
    assert.match(installedHookConfig, /post-turn-safety\.sh/u);
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

    assert.equal(preview.status, 0, preview.stderr);
    const report = JSON.parse(preview.stdout) as {
      verdict: string;
      files: PreviewRow[];
    };
    // Preserved local content is not a conflict, so the preview reads ready and still writes nothing.
    assert.equal(report.verdict, "ready");
    assert.equal(
      report.files.some(
        (file) =>
          file.path === ".goat-flow/logs/quality/README.md" &&
          file.state === "local-preserved",
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
        files: PreviewRow[];
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
      assert.match(forcedInstall.stderr, /no authority bypasses path safety/u);
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
      assert.match(forcedInstall.stderr, /no authority bypasses path safety/u);
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
