/**
 * Exercise hook migration and failed write-claim cleanup in disposable projects.
 *
 * Use when Sync changes provider detection or recovery guidance shown by the CLI and dashboard.
 * Real files and the public inspection command prove that repair stays within the selected project.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { pathWriteClaimInspectCommand } from "../../src/cli/claims-command.js";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { agentHookSpawnDescriptor } from "../../src/cli/server/agent-hook-command.js";
import {
  createManagedInstallStateRow,
  writeManagedInstallStateV2,
} from "../../src/cli/managed-setup-state.js";
import { readPolicyChoices } from "../../workflow/hooks/hook-policy-state.cjs";
import {
  acquirePathWriteClaims,
  releasePathWriteClaims,
} from "../../src/cli/path-write-claim.js";
import { HookManagedInstallationError } from "../../src/cli/server/hook-managed-installation.js";
import {
  executeHookChange,
  PreparedHookChange,
} from "../../src/cli/server/hook-operation.js";
import {
  syncHookStates,
  applyHookState,
} from "../../src/cli/server/hook-registrar.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");
const V1_16_0_COMMIT = "839fc59624034408e632617af0f8e9e273c37a49";

/**
 * Install the complete pinned v1.16.0 package into a disposable Codex project before reviewing its upgrade.
 * Writes only beneath the test workspace; package dependencies stay outside the target project.
 *
 * @param workspace - existing temporary directory owned and removed by the caller
 * @returns installed project path; installer or archive failure stops the test before recovery assertions
 */
function installArchivedCodexProject(workspace: string): string {
  const packageRoot = join(workspace, "v1.16.0");
  const projectPath = join(workspace, "selected project");
  const archivePath = join(workspace, "v1.16.0.tar");
  fs.mkdirSync(packageRoot);
  fs.mkdirSync(projectPath);
  const archive = spawnSync(
    "git",
    ["archive", V1_16_0_COMMIT, "--output", archivePath],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  assert.equal(archive.status, 0, archive.stderr);
  const unpack = spawnSync("tar", ["-xf", archivePath, "-C", packageRoot], {
    encoding: "utf8",
  });
  assert.equal(unpack.status, 0, unpack.stderr);
  fs.symlinkSync(
    join(REPOSITORY_ROOT, "node_modules"),
    join(packageRoot, "node_modules"),
    "dir",
  );
  const install = spawnSync(
    "bash",
    [
      join(packageRoot, "workflow/install-goat-flow.sh"),
      projectPath,
      "--agent",
      "codex",
    ],
    { cwd: packageRoot, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(install.status, 0, install.stderr || install.stdout);
  assert.equal(
    JSON.parse(fs.readFileSync(join(packageRoot, "package.json"), "utf8"))
      .version,
    "1.16.0",
  );
  assert.ok(fs.existsSync(join(projectPath, ".agents/skills/goat/SKILL.md")));
  assert.ok(
    fs.existsSync(
      join(projectPath, ".goat-flow/hooks/deny-dangerous/patterns-writes.sh"),
    ),
  );
  assert.equal(fs.existsSync(join(projectPath, "node_modules")), false);
  return projectPath;
}

/**
 * Replay a saved Codex command with inert tool-request text, as a session would after its project is upgraded.
 * Spawns the configured launcher; the proposed shell command is input to the policy and is never executed.
 *
 * @param projectPath - selected installed project whose saved choices the launcher must read
 * @param command - non-empty command captured from that project's hook registration
 *
 * @param proposedCommand - shell request being classified, including benign and policy-denied controls
 * @returns completed process evidence; null status indicates termination rather than an allow or deny result
 */
function replaySavedCodexCommand(
  projectPath: string,
  command: string,
  proposedCommand: string,
) {
  const launch = agentHookSpawnDescriptor({ form: "shell", command });
  return spawnSync(launch.command, launch.args, {
    cwd: projectPath,
    encoding: "utf8",
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: proposedCommand },
    }),
    timeout: 30_000,
  });
}

/**
 * Capture the configured policy command before a user changes settings or upgrades the selected project.
 *
 * @param projectPath - installed Codex project containing the registration to preserve
 *
 * @param hookId - policy required by this version; an absent registration fails rather than inventing a handler
 * @returns non-empty command saved from disk, ready for exact replay after the next user action
 */
function savedCodexPolicyCommand(projectPath: string, hookId: string): string {
  const config = JSON.parse(
    fs.readFileSync(join(projectPath, ".codex/hooks.json"), "utf8"),
  );
  const handler = config.hooks.PreToolUse.flatMap(
    (group: { hooks: { command: string }[] }) => group.hooks,
  ).find((entry: { command: string }) =>
    entry.command.includes(`${hookId}.sh`),
  );
  assert.ok(handler, `The installed version must register ${hookId}`);
  assert.equal(typeof handler.command, "string");
  return handler.command;
}

/**
 * Create a temporary installed project with old ownership bytes; the caller removes it after the test.
 * A pristine fixture records those bytes; a diverged fixture leaves the prior hash so the user must also approve replacing a local edit.
 */
function mixedPolicyProject(isPristine: boolean): string {
  const projectPath = fs.mkdtempSync(join(tmpdir(), "hook-policy-upgrade-"));
  fs.mkdirSync(join(projectPath, ".claude"));
  fs.writeFileSync(join(projectPath, ".claude/settings.json"), "{}");
  syncHookStates(projectPath);
  fs.writeFileSync(
    join(projectPath, ".goat-flow/config.yaml"),
    "hooks: {deny-dangerous: {enabled: true}, deny-git-mutations: {enabled: false}}\n",
  );
  const ownershipPath = ".goat-flow/hooks/deny-dangerous/guard-runtime.sh";
  const oldBytes = "# previous package ownership fixture\n";
  fs.writeFileSync(join(projectPath, ownershipPath), oldBytes);
  // A prior package install can be pristine while still needing policy review; local edits retain their separate replacement conflict.
  if (isPristine) {
    const statePath = join(
      projectPath,
      ".goat-flow/state/install/managed.json",
    );
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const row = state.files.find(
      (file: { path: string }) => file.path === ownershipPath,
    );
    assert.ok(row);
    Object.assign(
      row,
      createManagedInstallStateRow({
        path: row.path,
        expectedSha256: createHash("sha256").update(oldBytes).digest("hex"),
        provenance: row.provenance,
      }),
    );
    writeManagedInstallStateV2(projectPath, state);
  }
  return projectPath;
}

/** Capture every target file so refusal proves no changes to config, registrations, history or lock state. */
function projectFiles(projectPath: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(projectPath, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => [
        join(entry.parentPath, entry.name).slice(projectPath.length + 1),
        fs.readFileSync(join(entry.parentPath, entry.name)).toString("base64"),
      ]),
  );
}

/**
 * Capture the server response shown when Sync requires the user's review.
 *
 * @returns structured refusal details; missing details or successful Sync fail the test because consent was not enforced
 */
function policyRefusal(
  action: () => unknown,
): NonNullable<HookManagedInstallationError["details"]> {
  try {
    action();
  } catch (error) {
    // A mixed upgrade reaches the same structured response consumed by the dashboard, including an exact confirmation identity.
    assert.ok(error instanceof HookManagedInstallationError);
    assert.ok(error.details);
    return error.details;
  }
  assert.fail("Expected hook review refusal");
}

describe("mixed policy upgrade consent", () => {
  // The same policy change needs independent replacement approval only when the installed bytes are locally modified.
  for (const isPristine of [true, false]) {
    it(`requires exact policy consent with ${isPristine ? "zero conflicts" : "separate replacement consent"}`, (t) => {
      const projectPath = mixedPolicyProject(isPristine);
      t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
      const before = projectFiles(projectPath);
      const review = policyRefusal(() => syncHookStates(projectPath));
      assert.equal(review.code, "hook-policy-review-required");
      assert.equal(review.replacementAvailable, !isPristine);
      assert.equal(review.policyReview?.original["deny-git-mutations"], false);
      assert.deepEqual(projectFiles(projectPath), before);
      const identity = review.confirmationIdentity;
      assert.equal(
        policyRefusal(() =>
          syncHookStates(projectPath, {
            replace: true,
            confirmationIdentity: identity,
          }),
        ).code,
        "hook-policy-review-required",
      );
      assert.deepEqual(projectFiles(projectPath), before);
      // Accepting ownership alone cannot discard local changes; a pristine prior package needs no replacement checkbox.
      if (!isPristine) {
        policyRefusal(() =>
          syncHookStates(projectPath, {
            acceptPolicyChange: true,
            confirmationIdentity: identity,
          }),
        );
        assert.deepEqual(projectFiles(projectPath), before);
      }
      syncHookStates(projectPath, {
        acceptPolicyChange: true,
        ...(isPristine ? {} : { replace: true }),
        confirmationIdentity: identity,
      });
      assert.equal(readPolicyChoices(projectPath)["deny-git-mutations"], false);
      const after = projectFiles(projectPath);
      syncHookStates(projectPath);
      assert.deepEqual(projectFiles(projectPath), after);
    });
  }

  it("rejects stale choices even after conflicts and policy review disappear", (t) => {
    const projectPath = mixedPolicyProject(true);
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
    const review = policyRefusal(() => syncHookStates(projectPath));
    fs.writeFileSync(
      join(projectPath, ".goat-flow/config.yaml"),
      "hooks: {deny-dangerous: {enabled: true}, deny-git-mutations: {enabled: true}}\n",
    );
    const before = projectFiles(projectPath);
    assert.equal(
      policyRefusal(() =>
        syncHookStates(projectPath, {
          acceptPolicyChange: true,
          confirmationIdentity: review.confirmationIdentity,
        }),
      ).code,
      "hook-review-stale",
    );
    assert.deepEqual(projectFiles(projectPath), before);
    syncHookStates(projectPath);
  });

  it("requires review when a toggle enters mixed choices during an ownership upgrade", (t) => {
    const projectPath = mixedPolicyProject(true);
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
    fs.writeFileSync(
      join(projectPath, ".goat-flow/config.yaml"),
      "hooks: {deny-dangerous: {enabled: true}, deny-git-mutations: {enabled: true}}\n",
    );
    const before = projectFiles(projectPath);
    const review = policyRefusal(() =>
      applyHookState("deny-git-mutations", false, projectPath),
    );
    assert.equal(review.code, "hook-policy-review-required");
    assert.equal(review.policyReview?.requested["deny-git-mutations"], false);
    assert.deepEqual(projectFiles(projectPath), before);
  });
});

describe("hook sync migration and claim recovery", () => {
  // Writes a complete old install to prove saved-handler recovery preserves user rows and other projects, with deterministic repeated Sync.
  it("recovers a full v1.16.0 installation through reviewed Sync and saved Codex handlers", (t) => {
    // This archived Codex registration predates the Windows override; its local replay proves the non-Windows path only.
    if (process.platform === "win32") {
      t.skip("The v1.16.0 saved command fixture requires a non-Windows shell");
      return;
    }
    const archiveAvailable = spawnSync(
      "git",
      ["cat-file", "-e", `${V1_16_0_COMMIT}^{commit}`],
      { cwd: REPOSITORY_ROOT },
    );
    // A shallow source archive may omit release history; report the missing fixture instead of silently using current bytes.
    if (archiveAvailable.status !== 0) {
      t.skip("Pinned v1.16.0 commit is absent from local Git history");
      return;
    }
    const workspace = fs.mkdtempSync(join(tmpdir(), "hook-full-upgrade-"));
    t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
    const projectPath = installArchivedCodexProject(workspace);
    const otherProjectPath = join(workspace, "other project");
    fs.mkdirSync(otherProjectPath);
    fs.writeFileSync(
      join(otherProjectPath, "notes.txt"),
      "Other selected project remains untouched.\n",
    );
    const otherBefore = projectFiles(otherProjectPath);
    const configPath = join(projectPath, ".codex/hooks.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    // v1.16.0 has one general policy; the separate Git policy is added by the upgrade.
    const archivedGeneralCommand = savedCodexPolicyCommand(
      projectPath,
      "deny-dangerous",
    );
    assert.equal(
      replaySavedCodexCommand(projectPath, archivedGeneralCommand, "git status")
        .status,
      0,
    );
    assert.equal(
      replaySavedCodexCommand(
        projectPath,
        archivedGeneralCommand,
        "git commit -m blocked",
      ).status,
      2,
    );
    config.hooks.PreToolUse.push({
      matcher: "Bash",
      hooks: [{ type: "command", command: "echo preserved-user-hook" }],
    });
    fs.writeFileSync(configPath, JSON.stringify(config));
    const before = projectFiles(projectPath);
    policyRefusal(() => applyHookState("deny-dangerous", false, projectPath));
    assert.deepEqual(projectFiles(projectPath), before);
    const review = policyRefusal(() => syncHookStates(projectPath));
    assert.equal(review.code, "hook-replacement-required");
    assert.ok(review.paths.includes(".goat-flow/hooks/run-with-bash.mjs"));
    assert.deepEqual(projectFiles(projectPath), before);
    syncHookStates(projectPath, {
      replace: true,
      confirmationIdentity: review.confirmationIdentity,
    });
    const savedHandlers = new Map([
      ["deny-dangerous", archivedGeneralCommand],
      [
        "deny-git-mutations",
        savedCodexPolicyCommand(projectPath, "deny-git-mutations"),
      ],
    ]);
    // Each switch must take effect through its saved handler while the sibling remains enabled.
    for (const [hookId, blockedCommand] of [
      ["deny-dangerous", "rm -rf /"],
      ["deny-git-mutations", "git commit -m blocked"],
    ]) {
      const savedCommand = savedHandlers.get(hookId);
      assert.ok(savedCommand);
      assert.equal(
        replaySavedCodexCommand(projectPath, savedCommand, blockedCommand)
          .status,
        2,
      );
      applyHookState(hookId, false, projectPath);
      const disabled = replaySavedCodexCommand(
        projectPath,
        savedCommand,
        blockedCommand,
      );
      assert.equal(disabled.status, 0, disabled.stderr);
      assert.equal(disabled.stdout, "");
      assert.equal(disabled.stderr, "");
      const sibling =
        hookId === "deny-dangerous" ? "deny-git-mutations" : "deny-dangerous";
      assert.equal(readPolicyChoices(projectPath)[sibling], true);
      const disabledBytes = projectFiles(projectPath);
      syncHookStates(projectPath);
      const syncedBytes = projectFiles(projectPath);
      const oldConfig = JSON.parse(
        Buffer.from(disabledBytes[".codex/hooks.json"], "base64").toString(),
      );
      const syncedConfig = JSON.parse(
        Buffer.from(syncedBytes[".codex/hooks.json"], "base64").toString(),
      );
      // Compare registration content; the registrar unit case separately checks that policy toggles retain exact file bytes.
      for (const registration of [oldConfig, syncedConfig]) {
        registration.hooks.PreToolUse.sort((left: unknown, right: unknown) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
      }
      assert.deepEqual(syncedConfig, oldConfig);
      assert.deepEqual(
        {
          ...syncedBytes,
          ".codex/hooks.json": disabledBytes[".codex/hooks.json"],
        },
        disabledBytes,
      );
      assert.equal(
        replaySavedCodexCommand(projectPath, savedCommand, blockedCommand)
          .status,
        0,
      );
      syncHookStates(projectPath);
      assert.deepEqual(projectFiles(projectPath), syncedBytes);
      applyHookState(hookId, true, projectPath);
      assert.equal(
        replaySavedCodexCommand(projectPath, savedCommand, blockedCommand)
          .status,
        2,
      );
      assert.equal(
        replaySavedCodexCommand(projectPath, savedCommand, "git status").status,
        0,
      );
    }
    // Public installation must retain the registrations already reviewed during Sync.
    const reviewedRegistrations = fs.readFileSync(configPath, "utf8");
    const installArgs = [
      "--import",
      "tsx",
      "src/cli/cli.ts",
      "install",
      projectPath,
      "--agent",
      "codex",
    ];
    const preview = spawnSync(
      process.execPath,
      [...installArgs, "--dry-run", "--format", "json"],
      {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
      },
    );
    assert.equal(preview.status, 1, preview.stderr);
    const replacementArgs = JSON.parse(preview.stdout)
      .files.filter(
        (file: { authority: string }) => file.authority === "withheld",
      )
      .flatMap((file: { path: string }) => ["--force-path", file.path]);
    // Replacement permission and ordinary install must both refuse an unreviewed protection change.
    for (const authorityArgs of [replacementArgs, []]) {
      const installed = spawnSync(
        process.execPath,
        [...installArgs, ...authorityArgs],
        {
          cwd: REPOSITORY_ROOT,
          encoding: "utf8",
        },
      );
      assert.equal(installed.status, 0, installed.stdout + installed.stderr);
      assert.equal(fs.readFileSync(configPath, "utf8"), reviewedRegistrations);
      assert.equal(readPolicyChoices(projectPath)["deny-dangerous"], true);
      assert.equal(readPolicyChoices(projectPath)["deny-git-mutations"], true);
    }
    assert.ok(
      fs.readFileSync(configPath, "utf8").includes("preserved-user-hook"),
    );
    assert.deepEqual(projectFiles(otherProjectPath), otherBefore);
    // Upgrading the selected Codex project must not enroll providers the user has never installed.
    for (const configFile of [
      ".claude/settings.json",
      ".agents/hooks.json",
      ".github/hooks/hooks.json",
    ]) {
      assert.equal(fs.existsSync(join(projectPath, configFile)), false);
    }
  });

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

describe("saved Gruff choices across the supported upgrade", () => {
  /**
   * Runs one public CLI command against the disposable project, as a project owner upgrading from a terminal would.
   * It spawns the repository's own CLI; every write stays inside the selected project.
   *
   * @param cliArguments - command words after `goat-flow`, including the project path
   * @returns nothing; a failed command stops the test with the CLI's own output
   */
  function runPublicCli(cliArguments: string[]): void {
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(REPOSITORY_ROOT, "src/cli/cli.ts"),
        ...cliArguments,
      ],
      { cwd: REPOSITORY_ROOT, encoding: "utf8", timeout: 120_000 },
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
  }

  // Writes a 1.16.0-shaped project whose owner turned Gruff off and named an analyzer, then upgrades it through the public CLI.
  it("keeps a Gruff opt-out and its analyzer override through install, Sync and a later enable", (t) => {
    const projectPath = fs.mkdtempSync(join(tmpdir(), "gruff-saved-choice-"));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
    fs.mkdirSync(join(projectPath, ".claude"));
    fs.mkdirSync(join(projectPath, ".goat-flow"));
    fs.writeFileSync(join(projectPath, ".claude/settings.json"), "{}\n");
    const configPath = join(projectPath, ".goat-flow/config.yaml");
    fs.writeFileSync(
      configPath,
      [
        'version: "1.16.0"',
        "hooks:",
        "  deny-dangerous:",
        "    enabled: true",
        "  gruff-code-quality:",
        "    enabled: false",
        "    binaries:",
        "      ts: tools/gruff-ts",
        "",
      ].join("\n"),
    );
    const savedGruffBlock =
      /gruff-code-quality:\n {4}enabled: (true|false)\n {4}binaries:\n {6}ts: tools\/gruff-ts\n/u;
    /**
     * Counts how often Claude's settings name the Gruff script, so a kept opt-out shows as zero handlers.
     *
     * @returns the number of registered Gruff handlers; zero while the project keeps Gruff off
     */
    const gruffRegistrationCount = (): number =>
      fs
        .readFileSync(join(projectPath, ".claude/settings.json"), "utf8")
        .split("gruff-code-quality.sh").length - 1;

    runPublicCli(["install", projectPath, "--agent", "claude"]);
    runPublicCli(["hooks", "sync", projectPath]);
    const upgradedConfig = fs.readFileSync(configPath, "utf8");
    // The install must have rewritten the saved version, so the choices below survived a real upgrade.
    assert.match(upgradedConfig, /^version: "(?!1\.16\.0")[^"]+"$/mu);
    assert.equal(savedGruffBlock.exec(upgradedConfig)?.[1], "false");
    assert.equal(gruffRegistrationCount(), 0);

    runPublicCli(["hooks", "enable", "gruff-code-quality", projectPath]);
    const enabledConfig = fs.readFileSync(configPath, "utf8");
    assert.equal(savedGruffBlock.exec(enabledConfig)?.[1], "true");
    assert.ok(gruffRegistrationCount() > 0);
  });
});
