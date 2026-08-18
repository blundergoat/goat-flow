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
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeTempProject, runCliInstaller } from "./setup-install.helpers.js";

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
