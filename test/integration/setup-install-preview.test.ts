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
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  canonicalManagedInstallStateBytes,
  createManagedInstallStateRow,
  type ManagedInstallStateV2,
} from "../../src/cli/managed-setup-state.js";
import { getTemplatePath } from "../../src/cli/paths.js";
import {
  makeTempProject,
  runCliInstaller,
  symlinkDirectoryOrSkip,
  symlinkFileOrSkip,
} from "./setup-install.helpers.js";

const CODEX_GOAT_CLARITY_PATH = ".agents/skills/goat-clarity/SKILL.md";
const MANAGED_INSTALL_STATE_PATH =
  ".goat-flow/install-state/managed.json" as const;

/**
 * Read, mutate, and canonically replace the disposable project's v2 state fixture.
 * Filesystem side effects: rewrites only managed.json inside the supplied temporary target.
 * Error behavior: schema-invalid fixture mutations throw during canonical serialization.
 */
function mutateManagedInstallState(
  projectPath: string,
  mutation: (state: ManagedInstallStateV2) => void,
): void {
  const statePath = join(projectPath, MANAGED_INSTALL_STATE_PATH);
  const state = JSON.parse(
    readFileSync(statePath, "utf-8"),
  ) as ManagedInstallStateV2;
  mutation(state);
  writeFileSync(statePath, canonicalManagedInstallStateBytes(state));
}

/**
 * Remove goat-clarity's canonical row while retaining its stale receipt reference.
 * Filesystem side effects: rewrites only the disposable project's managed.json fixture.
 * Invariant: the next preview sees a loaded baseline that never owned the existing clarity path.
 */
function downgradeManagedStateToSevenCodexSkills(projectPath: string): void {
  mutateManagedInstallState(projectPath, (state) => {
    const originalFileCount = state.files.length;
    state.files = state.files.filter(
      (file) => file.path !== CODEX_GOAT_CLARITY_PATH,
    );
    assert.equal(
      state.files.length,
      originalFileCount - 1,
      "the installed baseline must contain goat-clarity before the fixture removes it",
    );
  });
}

/**
 * Replace selected canonical row hashes while retaining prior receipt generations.
 * Filesystem side effects: rewrites only the disposable project's managed.json fixture.
 * Invariant: each named path becomes a valid changed-package row and its prior receipt becomes stale.
 */
function recordStaleManagedStateHashes(
  projectPath: string,
  managedPaths: readonly string[],
): void {
  mutateManagedInstallState(projectPath, (state) => {
    for (const managedPath of managedPaths) {
      const rowIndex = state.files.findIndex(
        (file) => file.path === managedPath,
      );
      assert.notEqual(
        rowIndex,
        -1,
        `${managedPath} must appear in managed state`,
      );
      const row = state.files[rowIndex];
      assert.ok(row);
      state.files[rowIndex] = createManagedInstallStateRow({
        path: row.path,
        expectedSha256: "0".repeat(64),
        provenance: row.provenance,
      });
    }
  });
}

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
      limits: string[];
    };
    assert.equal(report.schemaVersion, "goat-flow.managed-setup-preview.v2");
    assert.equal(report.coverage, "install-write-set");
    assert.equal(report.verdict, "ready");
    assert.equal(
      report.files.some((file) => file.state === "added"),
      true,
    );
    assert.equal(report.files.every(isSafeFreshTargetRow), true);
    // The preview tells users which guarantees they lose when they bypass the public CLI.
    assert.equal(
      report.limits.includes(
        "Direct workflow/install-goat-flow.sh execution skips CLI admission, post-write verification, and install-state recording.",
      ),
      true,
    );
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
    // The helper announces the remaining CLI work before this public path records the user's verified baseline.
    assert.match(
      result.stdout,
      /The public goat-flow CLI verifies managed files and records install state after this helper exits\./u,
    );
    const statePath = join(projectPath, MANAGED_INSTALL_STATE_PATH);
    assert.equal(existsSync(statePath), true);
    const state = readFileSync(statePath, "utf-8");
    assert.match(state, /goat-flow\.install-state\.v2/u);
    assert.match(state, /"agent": "codex"/u);
    assert.doesNotMatch(state, new RegExp(projectPath, "u"));
    assert.match(
      readFileSync(
        join(projectPath, ".goat-flow", "install-state", "codex.json"),
        "utf-8",
      ),
      /goat-flow\.install-state\.v1-cutover/u,
    );
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
      existsSync(join(projectPath, MANAGED_INSTALL_STATE_PATH)),
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
    downgradeManagedStateToSevenCodexSkills(projectPath);
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
    downgradeManagedStateToSevenCodexSkills(projectPath);
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
    recordStaleManagedStateHashes(projectPath, [
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
    recordStaleManagedStateHashes(projectPath, [
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
    assert.doesNotMatch(installedHookConfig, /post-turn-safety\.sh/u);
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
    const statePath = join(projectPath, MANAGED_INSTALL_STATE_PATH);
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
   * Fixture purpose: supplies two existing user files whose narrow install migrations are pending.
   * Filesystem side effects: previews without writes, then applies both edits in a disposable target.
   */
  it("previews settings and gitignore migrations that apply performs", () => {
    const projectPath = makeTempProject();
    const codexSettingsPath = join(projectPath, ".codex", "config.toml");
    const gitignorePath = join(projectPath, ".gitignore");
    mkdirSync(join(projectPath, ".codex"), { recursive: true });
    const settingsBefore = [
      'model = "gpt-5"',
      "",
      "[features]",
      "codex_hooks = true",
      "",
    ].join("\n");
    const gitignoreBefore = "dist/\n";
    writeFileSync(codexSettingsPath, settingsBefore);
    writeFileSync(gitignorePath, gitignoreBefore);

    const preview = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--dry-run",
      "--format",
      "json",
    );
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const report = JSON.parse(preview.stdout) as { files: PreviewRow[] };
    assertPreviewLists(report.files, {
      path: ".codex/config.toml",
      state: "user-migrated",
      action: "migrate",
    });
    assert.match(
      report.files.find((file) => file.path === ".codex/config.toml")?.reason ??
        "",
      /deprecated codex_hooks/u,
    );
    assertPreviewLists(report.files, {
      path: ".gitignore",
      state: "user-migrated",
      action: "migrate",
    });
    assert.match(
      report.files.find((file) => file.path === ".gitignore")?.reason ?? "",
      /appends the node_modules\//u,
    );
    assert.equal(readFileSync(codexSettingsPath, "utf-8"), settingsBefore);
    assert.equal(readFileSync(gitignorePath, "utf-8"), gitignoreBefore);

    const apply = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(apply.status, 0, apply.stderr || apply.stdout);
    const settingsAfter = readFileSync(codexSettingsPath, "utf-8");
    assert.match(settingsAfter, /^hooks = true$/mu);
    assert.doesNotMatch(settingsAfter, /codex_hooks/u);
    assert.equal(
      readFileSync(gitignorePath, "utf-8"),
      "dist/\nnode_modules/\n",
    );
  });

  /**
   * Fixture purpose: removes one managed Codex registration while retaining a user-owned field.
   * Filesystem side effects: rewrites a disposable hook config, previews it, then applies reconciliation.
   */
  it("previews the hook-config reconciliation that apply performs", () => {
    const projectPath = makeTempProject();
    const firstInstall = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(
      firstInstall.status,
      0,
      firstInstall.stderr || firstInstall.stdout,
    );
    const hooksPath = join(projectPath, ".codex", "hooks.json");
    const hooksConfig = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
      hooks?: Record<string, unknown[]>;
      userInterface?: { statusMessage: string };
    };
    hooksConfig.hooks ??= {};
    delete hooksConfig.hooks.PreToolUse;
    hooksConfig.userInterface = { statusMessage: "keep this user field" };
    writeFileSync(hooksPath, `${JSON.stringify(hooksConfig, null, 2)}\n`);
    const beforePreview = readFileSync(hooksPath, "utf-8");

    const preview = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--dry-run",
      "--format",
      "json",
    );
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    assert.equal(readFileSync(hooksPath, "utf-8"), beforePreview);
    const report = JSON.parse(preview.stdout) as { files: PreviewRow[] };
    const hooksRow = report.files.find(
      (file) => file.path === ".codex/hooks.json",
    );

    const apply = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(apply.status, 0, apply.stderr || apply.stdout);
    const reconciledHooks = readFileSync(hooksPath, "utf-8");
    assert.match(reconciledHooks, /deny-dangerous\.sh/u);
    assert.match(reconciledHooks, /keep this user field/u);
    assert.equal(hooksRow?.state, "user-migrated");
    assert.equal(hooksRow?.action, "migrate");
    assert.match(hooksRow?.reason ?? "", /restore.*deny-dangerous/u);
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

      const namedInstall = runCliInstaller(
        projectPath,
        "--agent",
        "codex",
        "--force-path",
        ".goat-flow/logs/quality/README.md",
      );
      assert.notEqual(namedInstall.status, 0);
      assert.match(namedInstall.stderr, /path safety/u);
      assert.doesNotMatch(namedInstall.stderr, /needs no authority/u);
      assert.deepEqual(
        readFileSync(redirectedReadmePath),
        redirectedBytesBefore,
      );
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
      rmSync(redirectedDirectory, { recursive: true, force: true });
    }
  });

  // Fixture purpose: writes and hard-links disposable files, then runs install to prove admission protects the outside inode.
  it("blocks a multiply linked generated target before any install write", () => {
    const projectPath = makeTempProject();
    const outsideDirectory = makeTempProject();
    const outsideIndexPath = join(outsideDirectory, "outside-index.md");
    const managedIndexPath = join(
      projectPath,
      ".goat-flow",
      "learning-loop",
      "lessons",
      "INDEX.md",
    );
    mkdirSync(join(projectPath, ".goat-flow", "learning-loop", "lessons"), {
      recursive: true,
    });
    writeFileSync(outsideIndexPath, "outside bytes must survive\n");
    linkSync(outsideIndexPath, managedIndexPath);

    const install = runCliInstaller(projectPath, "--agent", "codex");

    assert.notEqual(install.status, 0);
    assert.match(install.stderr, /no authority bypasses path safety/u);
    assert.equal(
      readFileSync(outsideIndexPath, "utf-8"),
      "outside bytes must survive\n",
    );
    assert.equal(
      existsSync(join(projectPath, ".agents", "skills", "goat", "SKILL.md")),
      false,
      "admission must stop before the installer creates an unrelated file",
    );
  });

  // Fixture purpose: redirects a user-owned file to prove admission blocks before unrelated writes.
  it("blocks an unsafe user-owned target before any install write", (testContext) => {
    const projectPath = makeTempProject();
    const outsideDirectory = makeTempProject();
    const outsideGitignorePath = join(outsideDirectory, "outside.gitignore");
    writeFileSync(outsideGitignorePath, "outside ignore bytes\n");
    if (
      !symlinkFileOrSkip(
        testContext,
        outsideGitignorePath,
        join(projectPath, ".gitignore"),
      )
    ) {
      return;
    }

    const install = runCliInstaller(projectPath, "--agent", "codex");

    assert.notEqual(install.status, 0);
    assert.equal(
      readFileSync(outsideGitignorePath, "utf-8"),
      "outside ignore bytes\n",
    );
    assert.equal(
      existsSync(join(projectPath, ".agents", "skills", "goat", "SKILL.md")),
      false,
      "one unsafe project-write row must block every later installer write",
    );
    assert.match(install.stderr, /no authority bypasses path safety/u);
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
