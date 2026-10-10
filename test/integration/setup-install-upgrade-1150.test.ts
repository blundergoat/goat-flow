/**
 * Regression proof for the measured 1.15.0-to-1.15.1 upgrade failure.
 *
 * A consumer had added project content under a managed README whose package template never changed, and had
 * switched a shipped hook off with an explanatory comment. The upgrade blocked on that one row, and the only escape
 * erased the added content.
 *
 * These fixtures run the public CLI against disposable targets, so the assertions are about what a user's project
 * looks like after the command rather than about internal state.
 */
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  makeTempProject,
  PROJECT_ROOT,
  runCliInstaller,
  runInstaller,
} from "./setup-install.helpers.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";

/** Create a file symlink, or skip when the host forbids the fixture; it swallows that platform failure into a skip rather than a red test. */
function symlinkFileOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
): boolean {
  try {
    symlinkSync(target, link, "file");
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

/** Managed README whose shipped template stayed identical across the measured releases. */
const MANAGED_README_PATH = ".goat-flow/plans/README.md";

/** Line count the measured incident lost; kept exact so a partial loss still fails. */
const PROJECT_NOTE_COUNT = 51;

/** Marker for the last added line, so truncation anywhere in the block is visible. */
const LAST_PROJECT_NOTE = `- project note ${PROJECT_NOTE_COUNT}`;

/** One preview row as the JSON contract publishes it. */
interface PreviewRow {
  path: string;
  ownership: string;
  state: string;
  action: string;
  reason: string;
}

/** Complete state of one disposable consumer target after the measured edits. */
interface MeasuredConsumer {
  projectPath: string;
  managedReadmePath: string;
  configPath: string;
  projectContent: string;
  userConfig: string;
}

/**
 * Install one agent, then reproduce the measured consumer edits on top of it.
 *
 * Installing first is what makes the reproduction faithful: the recorded baseline hash equals the current package
 * template, which is exactly the unchanged-template state.
 *
 * @param agent - agent whose managed mirror is installed before the edits
 * @returns the target's paths plus the exact bytes the upgrade must preserve; it writes into a disposable target
 *   created by `makeTempProject`
 */
function measuredConsumerTarget(agent: string): MeasuredConsumer {
  const projectPath = makeTempProject();
  const firstInstall = runCliInstaller(projectPath, "--agent", agent);
  assert.equal(
    firstInstall.status,
    0,
    firstInstall.stderr || firstInstall.stdout,
  );

  const managedReadmePath = join(projectPath, MANAGED_README_PATH);
  const projectNotes = Array.from(
    { length: PROJECT_NOTE_COUNT },
    (_unused, noteIndex) => `- project note ${noteIndex + 1}`,
  ).join("\n");
  const projectContent = `${readFileSync(managedReadmePath, "utf-8")}\n## Team notes\n\n${projectNotes}\n`;
  writeFileSync(managedReadmePath, projectContent);

  const configPath = join(projectPath, ".goat-flow", "config.yaml");
  const userConfig = readFileSync(configPath, "utf-8")
    .replace(
      "  post-turn-safety:\n    enabled: true",
      "  # Off until the scanner stops flagging our fixtures.\n  post-turn-safety:\n    enabled: false",
    )
    .concat(
      "\n# Local preference kept across upgrades.\nui:\n  density: compact\n",
    );
  writeFileSync(configPath, userConfig);

  return {
    projectPath,
    managedReadmePath,
    configPath,
    projectContent,
    userConfig,
  };
}

/** Read the dry-run write set for one target without changing it. */
function previewRows(projectPath: string, agent: string): PreviewRow[] {
  const preview = runCliInstaller(
    projectPath,
    "--agent",
    agent,
    "--dry-run",
    "--format",
    "json",
  );
  const report = JSON.parse(preview.stdout) as {
    verdict: string;
    files: PreviewRow[];
  };
  return report.files;
}

describe("1.15.0 consumer upgrade", () => {
  it("upgrades without force when only local content diverges", () => {
    const consumer = measuredConsumerTarget("claude");

    const upgrade = runCliInstaller(consumer.projectPath, "--agent", "claude");

    assert.equal(
      upgrade.status,
      0,
      `an unchanged incoming template must not block the upgrade: ${upgrade.stderr}`,
    );
    assert.equal(
      readFileSync(consumer.managedReadmePath, "utf-8"),
      consumer.projectContent,
      "the upgrade must preserve project content under an unchanged template",
    );
  });

  it("reports the unchanged-template row as preserved rather than blocking", () => {
    const consumer = measuredConsumerTarget("claude");

    const rows = previewRows(consumer.projectPath, "claude");
    const managedReadmeRow = rows.find(
      (row) => row.path === MANAGED_README_PATH,
    );

    assert.ok(managedReadmeRow, `preview must list ${MANAGED_README_PATH}`);
    assert.equal(managedReadmeRow.ownership, "system-owned");
    assert.equal(managedReadmeRow.state, "local-preserved");
    assert.equal(managedReadmeRow.action, "none");
    assert.match(managedReadmeRow.reason, /did not change/u);
  });

  it("keeps project content and hook choices through a forced upgrade", () => {
    const consumer = measuredConsumerTarget("claude");

    const forced = runCliInstaller(
      consumer.projectPath,
      "--agent",
      "claude",
      "--force",
    );

    assert.equal(forced.status, 0, forced.stderr || forced.stdout);
    const upgradedReadme = readFileSync(consumer.managedReadmePath, "utf-8");
    assert.ok(
      upgradedReadme.includes(LAST_PROJECT_NOTE),
      "broad force must not erase project content under an unchanged template",
    );
    assert.equal(
      readFileSync(consumer.configPath, "utf-8"),
      consumer.userConfig,
      "broad force must not reset an explicit hook toggle or user config prose",
    );
  });

  it("discloses a config version migration and keeps the rest byte-stable", () => {
    const consumer = measuredConsumerTarget("claude");

    const preview = runCliInstaller(
      consumer.projectPath,
      "--agent",
      "claude",
      "--update-config-version",
      "--dry-run",
      "--format",
      "json",
    );
    assert.equal(preview.status, 0, preview.stderr);
    const configRow = (
      JSON.parse(preview.stdout) as { files: PreviewRow[] }
    ).files.find((row) => row.path === ".goat-flow/config.yaml");
    assert.equal(configRow?.state, "user-migrated");
    assert.equal(configRow.action, "migrate");
    // The row names the edit, because "may change" is not something a user can check afterwards.
    assert.match(configRow.reason, /update the version field/u);
    assert.match(configRow.reason, /byte-stable/u);

    const migrated = runCliInstaller(
      consumer.projectPath,
      "--agent",
      "claude",
      "--update-config-version",
    );
    assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout);

    // Only the version line may differ; the toggle, its comment, and the ui block survive.
    const upgradedConfig = readFileSync(consumer.configPath, "utf-8");
    assert.match(upgradedConfig, /Off until the scanner stops flagging/u);
    assert.match(upgradedConfig, /post-turn-safety:\n {4}enabled: false/u);
    assert.match(upgradedConfig, /density: compact/u);
    assert.equal(
      upgradedConfig.replace(/^version: .*$/mu, ""),
      consumer.userConfig.replace(/^version: .*$/mu, ""),
      "a version migration must change nothing but the version line",
    );
  });

  /**
   * Fixture purpose: prove the preserve rule is scoped to divergent bytes in a regular file.
   * A deleted managed file is repairable template drift, not content the user chose to keep,
   * so it must still block. Filesystem side effects: deletes one managed file in a disposable target.
   */
  it("still blocks a deleted managed target under the same unchanged template", () => {
    const consumer = measuredConsumerTarget("claude");
    const deletedManagedPath = join(
      consumer.projectPath,
      ".goat-flow",
      "logs",
      "quality",
      "README.md",
    );
    rmSync(deletedManagedPath);

    const deletedRow = previewRows(consumer.projectPath, "claude").find(
      (row) => row.path === ".goat-flow/logs/quality/README.md",
    );
    assert.equal(deletedRow?.state, "missing");
    assert.equal(deletedRow.action, "protect");

    const upgrade = runCliInstaller(consumer.projectPath, "--agent", "claude");
    assert.notEqual(
      upgrade.status,
      0,
      "a deleted managed file must still stop the upgrade for a decision",
    );
    assert.match(upgrade.stderr, /missing/u);
  });

  /**
   * Fixture purpose: prove no unchanged-template rule reaches a redirected destination.
   *
   * It writes one managed file as a symlink in a disposable target. A host that refuses unprivileged symlinks
   * throws `EPERM`, which skips this case rather than reporting a policy failure; any other error is rethrown.
   */
  it("still blocks a redirected managed target under the same unchanged template", (testContext) => {
    const consumer = measuredConsumerTarget("claude");
    const redirectedManagedPath = join(
      consumer.projectPath,
      ".goat-flow",
      "logs",
      "quality",
      "README.md",
    );
    const outsideTargetPath = join(makeTempProject(), "outside.md");
    writeFileSync(outsideTargetPath, "bytes outside the selected project\n");
    rmSync(redirectedManagedPath);
    if (
      !symlinkFileOrSkip(testContext, outsideTargetPath, redirectedManagedPath)
    ) {
      return;
    }

    const redirectedRow = previewRows(consumer.projectPath, "claude").find(
      (row) => row.path === ".goat-flow/logs/quality/README.md",
    );
    assert.equal(redirectedRow?.state, "unmanaged");
    assert.equal(redirectedRow.action, "protect");

    const forced = runCliInstaller(
      consumer.projectPath,
      "--agent",
      "claude",
      "--force",
    );
    assert.notEqual(forced.status, 0);
    assert.match(forced.stderr, /path safety/u);
    assert.equal(
      readFileSync(outsideTargetPath, "utf-8"),
      "bytes outside the selected project\n",
    );
  });
});

/**
 * Read disposable target membership, modes and file digests without changing it.
 * Invariant: refused commands preserve the complete snapshot, including registrations and receipts.
 */
function targetSnapshot(root: string, relative = ""): string[] {
  return readdirSync(join(root, relative))
    .sort()
    .flatMap((name) => {
      const path = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(join(root, path));
      const entry = `${path}:${stat.mode}`;
      return stat.isDirectory()
        ? [entry, ...targetSnapshot(root, path)]
        : [
            `${entry}:${createHash("sha256")
              .update(readFileSync(join(root, path)))
              .digest("hex")}`,
          ];
    });
}

/**
 * Exercise patch lag without a production version override or changing this checkout.
 * Filesystem side effects: copy a disposable package, link dependencies and advance its version metadata.
 */
function newerPatchPackage(): { root: string; version: string } {
  const root = makeTempProject();
  for (const path of ["src", "workflow", "package.json"]) {
    assert.equal(existsSync(join(root, path)), false);
    cpSync(join(PROJECT_ROOT, path), join(root, path), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
  symlinkSync(
    join(PROJECT_ROOT, "node_modules"),
    join(root, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const [major, minor, patch] = AUDIT_VERSION.split(".").map(Number);
  const version = `${major}.${minor}.${patch + 2}`;
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ ...metadata, version }),
  );
  return { root, version };
}

describe("install version admission", () => {
  /**
   * Fixture purpose: a newer isolated package exposes automatic patch refresh while local choices and comments stay authoritative.
   * Filesystem and process effects: writes disposable config and runs real preview/apply installations.
   */
  it("refreshes an older patch in preview and apply while preserving config prose and choices", () => {
    const consumer = measuredConsumerTarget("claude");
    const packageFixture = newerPatchPackage();
    const savedConfig = consumer.userConfig.replace(
      /^version:.*$/mu,
      "$& # keep the version comment",
    );
    writeFileSync(consumer.configPath, savedConfig);
    /** Spawns the isolated package's public install CLI; apply writes only to the disposable consumer. */
    const invoke = (...flags: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          join(packageFixture.root, "src/cli/cli.ts"),
          "install",
          consumer.projectPath,
          "--agent",
          "claude",
          ...flags,
        ],
        { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 30_000 },
      );
    const before = targetSnapshot(consumer.projectPath);
    const preview = invoke("--dry-run", "--format", "json");
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const row = JSON.parse(preview.stdout).files.find(
      (file: PreviewRow) => file.path === ".goat-flow/config.yaml",
    );
    assert.equal(row.state, "user-migrated");
    assert.match(row.reason, /update the version field/u);
    assert.deepEqual(targetSnapshot(consumer.projectPath), before);
    const apply = invoke();
    assert.equal(apply.status, 0, apply.stderr || apply.stdout);
    const expected = savedConfig.replace(
      /^version: "[^"]*"/mu,
      `version: "${packageFixture.version}"`,
    );
    assert.equal(readFileSync(consumer.configPath, "utf8"), expected);
    const repeat = invoke();
    assert.equal(repeat.status, 0, repeat.stderr || repeat.stdout);
    assert.equal(readFileSync(consumer.configPath, "utf8"), expected);
  });

  const [major, minor, patch] = AUDIT_VERSION.split(".").map(Number);
  const refusedVersions = [
    {
      name: "newer patch",
      line: `version: "${major}.${minor}.${patch + 1}"`,
      guidance: /newer.*CLI|upgrade.*CLI/iu,
    },
    {
      name: "newer minor",
      line: `version: "${major}.${minor + 1}.0"`,
      guidance: /newer.*CLI|upgrade.*CLI/iu,
    },
    {
      name: "missing",
      line: "# version omitted deliberately",
      guidance: /review.*version/iu,
    },
    {
      name: "malformed",
      line: 'version: "not-a-release"',
      guidance: /review.*version/iu,
    },
    {
      name: "prerelease",
      line: `version: "${AUDIT_VERSION}-rc.1"`,
      guidance: /review.*version/iu,
    },
    {
      name: "unsafe numeric",
      line: 'version: "1.17.9007199254740992"',
      guidance: /review.*version/iu,
    },
    {
      name: "block scalar",
      line: "version: |- # preserve this comment\n  0.0.0",
      guidance: /review.*version/iu,
    },
  ];
  for (const fixture of refusedVersions) {
    it(`refuses ${fixture.name} versions before public or direct target mutations`, () => {
      const consumer = measuredConsumerTarget("claude");
      writeFileSync(
        consumer.configPath,
        consumer.userConfig.replace(/^version:.*$/mu, fixture.line),
      );
      const before = targetSnapshot(consumer.projectPath);
      for (const flags of [[], ["--force", "--update-config-version"]]) {
        const preview = runCliInstaller(
          consumer.projectPath,
          "--agent",
          "claude",
          "--dry-run",
          "--format",
          "json",
          ...flags,
        );
        assert.notEqual(preview.status, 0, fixture.name);
        const report = JSON.parse(preview.stdout);
        assert.equal(report.verdict, "blocked");
        assert.match(report.limits.join(" "), fixture.guidance);
        assert.deepEqual(
          targetSnapshot(consumer.projectPath),
          before,
          "preview preserves every target path",
        );
        const apply = runCliInstaller(
          consumer.projectPath,
          "--agent",
          "claude",
          ...flags,
        );
        assert.notEqual(apply.status, 0, fixture.name);
        assert.match(apply.stderr, fixture.guidance);
        assert.deepEqual(
          targetSnapshot(consumer.projectPath),
          before,
          "apply preserves files, registrations and receipts",
        );
        const direct = runInstaller(
          consumer.projectPath,
          "--agent",
          "claude",
          ...flags,
        );
        assert.notEqual(direct.status, 0, fixture.name);
        assert.match(direct.stderr, fixture.guidance);
        assert.deepEqual(
          targetSnapshot(consumer.projectPath),
          before,
          "direct install preserves every target path",
        );
      }
      const setup = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          join(PROJECT_ROOT, "src/cli/cli.ts"),
          "setup",
          consumer.projectPath,
          "--agent",
          "claude",
          "--apply",
          "--force",
          "--update-config-version",
        ],
        { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 30_000 },
      );
      assert.notEqual(setup.status, 0);
      assert.match(setup.stderr, fixture.guidance);
      assert.deepEqual(
        targetSnapshot(consumer.projectPath),
        before,
        "setup apply preserves every target path",
      );
    });
  }

  it("refreshes an older direct install without resetting config choices", () => {
    const root = makeTempProject();
    const install = runInstaller(root, "--agent", "claude");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const configPath = join(root, ".goat-flow/config.yaml");
    const original = readFileSync(configPath, "utf8").replace(
      /^version:.*$/mu,
      "$& # preserve direct version comment",
    );
    writeFileSync(
      configPath,
      original.replace(/^version: "[^"]*"/mu, 'version: "0.0.0"'),
    );
    const upgrade = runInstaller(root, "--agent", "claude");
    assert.equal(upgrade.status, 0, upgrade.stderr || upgrade.stdout);
    assert.equal(readFileSync(configPath, "utf8"), original);
  });
});
