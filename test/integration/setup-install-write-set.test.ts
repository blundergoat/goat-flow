/**
 * Proves the dry-run preview is a complete superset of what an install writes, and that
 * repeating install, sync, disable, or enable leaves the selected target byte-stable.
 * These fixtures run the public CLI against disposable targets and compare content
 * snapshots, so an undisclosed write or a non-converging hook toggle fails by path name.
 * Removals stay outside the compared set by contract; the preview declares that limit.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { getAgentProfiles } from "../../src/cli/agents/registry.js";
import type { AgentProfile } from "../../src/cli/types.js";
import { PROJECT_ROOT, makeTempProject } from "./setup-install.helpers.js";

/** Managed script whose registration count proves enable and disable converged. */
const MANAGED_DENY_SCRIPT = "deny-dangerous.sh";

/**
 * Command for the planted row. It names no goat-flow path, because a row that reuses the
 * managed launcher is owned content the registrar is right to converge away.
 */
const USER_HOOK_COMMAND = "node user-round-trip-hook.js";

/** Top-level hook-config key a user could add; every operation must leave it untouched. */
const USER_CONFIG_MARKER = "userOwnedRoundTripMarker";

/** Container every provider except Antigravity shares between managed and user hook rows. */
const SHARED_HOOKS_KEY = "hooks";

/** Top-level block name for the planted hook when the provider keys blocks by hook id. */
const USER_HOOK_BLOCK = "user-round-trip";

/** Content of one target tree keyed by project-relative POSIX path. */
type ProjectSnapshot = Map<string, string>;

/** Paths whose content changed and paths that disappeared between two snapshots. */
interface SnapshotDelta {
  written: string[];
  deleted: string[];
}

/**
 * Record the content of every file under one target so later writes are detectable.
 * Symlinks and other non-regular entries are recorded by kind rather than hashed, because
 * a redirected destination must be visible as a change without following it.
 *
 * @param root - disposable target root to walk; an empty directory yields an empty snapshot
 * @param current - directory being visited during recursion; defaults to the root itself
 * @param into - accumulator shared across recursion; defaults to a fresh map
 * @returns one entry per file found; never null
 */
function snapshotProject(
  root: string,
  current: string = root,
  into: ProjectSnapshot = new Map(),
): ProjectSnapshot {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolutePath = join(current, entry.name);
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    if (entry.isDirectory()) {
      snapshotProject(root, absolutePath, into);
      continue;
    }
    // A symlink or device node is evidence in itself and must never be read through.
    if (!lstatSync(absolutePath).isFile()) {
      into.set(relativePath, "non-regular");
      continue;
    }
    into.set(
      relativePath,
      createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
    );
  }
  return into;
}

/**
 * Compare two snapshots of one target and report what an operation changed.
 * A rewrite with identical bytes is deliberately invisible: users judge an install by
 * the content they end up with, not by inode churn from atomic replacement.
 *
 * @param before - snapshot captured immediately before the operation
 * @param after - snapshot captured immediately after the operation
 * @returns sorted written and deleted path lists; both empty means the operation was a no-op
 */
function snapshotDelta(
  before: ProjectSnapshot,
  after: ProjectSnapshot,
): SnapshotDelta {
  const written = [...after]
    .filter(([path, content]) => before.get(path) !== content)
    .map(([path]) => path);
  const deleted = [...before.keys()].filter((path) => !after.has(path));
  return { written: written.sort(), deleted: deleted.sort() };
}

/**
 * Run the public CLI against a disposable target exactly as a user would.
 * Spawns a node subprocess; the command may write into the target it is given.
 *
 * @param args - full argument vector after the CLI entrypoint, starting with the command
 * @returns the spawnSync result carrying status, stdout, and stderr
 */
function runCli(...args: string[]) {
  return spawnSync(
    "node",
    ["--import", "tsx", join(PROJECT_ROOT, "src", "cli", "cli.ts"), ...args],
    { cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 60000 },
  );
}

/**
 * Run one CLI command and assert it succeeded, so a later assertion cannot pass vacuously.
 *
 * @param label - human-readable step name reported when the command fails
 * @param args - full argument vector after the CLI entrypoint
 */
function runCliStep(label: string, ...args: string[]): void {
  const result = runCli(...args);
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
}

/**
 * Read the dry-run write set for one target and agent without changing the target.
 * Asserting the published schema and coverage here keeps every later subset comparison
 * honest: a preview that silently narrowed its coverage would otherwise still pass.
 *
 * @param projectPath - disposable target root to preview
 * @param agent - selected agent whose managed mirror and configs are previewed
 * @returns every project-relative path the preview discloses; never empty for a supported agent
 */
function previewWritePaths(projectPath: string, agent: string): Set<string> {
  const preview = runCli(
    "install",
    projectPath,
    "--agent",
    agent,
    "--dry-run",
    "--format",
    "json",
  );
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const report = JSON.parse(preview.stdout) as {
    schemaVersion: string;
    coverage: string;
    files: Array<{ path: string }>;
  };
  assert.equal(report.schemaVersion, "goat-flow.managed-setup-preview.v2");
  assert.equal(report.coverage, "install-write-set");
  return new Set(report.files.map((file) => file.path));
}

/** Collect every hook row inside one parsed config whose command or args name a script. */
function hookRowsNaming(configValue: unknown, scriptName: string): unknown[] {
  if (Array.isArray(configValue)) {
    return configValue.flatMap((nested) => hookRowsNaming(nested, scriptName));
  }
  if (configValue === null || typeof configValue !== "object") return [];
  const configEntry = configValue as Record<string, unknown>;
  const runnableText = [
    configEntry.command,
    configEntry.bash,
    configEntry.powershell,
    ...(Array.isArray(configEntry.args) ? configEntry.args : []),
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  // A row that names the script is counted once; its own children cannot add a second row.
  if (runnableText.includes(scriptName)) return [configEntry];
  return Object.values(configEntry).flatMap((nested) =>
    hookRowsNaming(nested, scriptName),
  );
}

/**
 * Rewrite every runnable field inside one cloned structure so it names no goat-flow path.
 * Borrowing the managed structure keeps the planted content valid for whichever provider
 * grammar the agent uses, without this fixture hard-coding four different config shapes.
 */
function asUserOwnedContent(managedContent: unknown): unknown {
  const userContent = JSON.parse(JSON.stringify(managedContent)) as unknown;
  for (const clonedRow of hookRowsNaming(userContent, MANAGED_DENY_SCRIPT)) {
    const runnableRow = clonedRow as Record<string, unknown>;
    // Structured exec-form operands name goat-flow's managed script and launcher.
    delete runnableRow.args;
    for (const runnableField of ["command", "bash", "powershell"]) {
      if (typeof runnableRow[runnableField] === "string") {
        runnableRow[runnableField] = USER_HOOK_COMMAND;
      }
    }
    // A row with no runnable field could not represent a user hook at all.
    runnableRow.command ??= USER_HOOK_COMMAND;
  }
  return userContent;
}

/** Locate the managed deny row as a key-and-index path from the config root. */
function findManagedRowPath(
  configValue: unknown,
  path: Array<string | number> = [],
): Array<string | number> | null {
  if (Array.isArray(configValue)) {
    for (const [index, nested] of configValue.entries()) {
      const foundInElement = findManagedRowPath(nested, [...path, index]);
      if (foundInElement) return foundInElement;
    }
    return null;
  }
  if (configValue === null || typeof configValue !== "object") return null;
  const configEntry = configValue as Record<string, unknown>;
  // A row naming the script ends the search; its children cannot own a shallower path.
  if (hookRowsNaming(configEntry, MANAGED_DENY_SCRIPT).includes(configEntry)) {
    return path;
  }
  for (const [key, nested] of Object.entries(configEntry)) {
    const foundInValue = findManagedRowPath(nested, [...path, key]);
    if (foundInValue) return foundInValue;
  }
  return null;
}

/** Follow one key-and-index path from the config root to the value it names. */
function resolveConfigPath(
  configValue: unknown,
  path: Array<string | number>,
): unknown {
  return path.reduce<unknown>(
    (value, key) => (value as Record<string | number, unknown>)[key],
    configValue,
  );
}

/**
 * Return whatever unrelated hook content this fixture planted, in either provider shape.
 * Antigravity keys every hook block by hook id, so a user's own hook is a sibling top-level
 * block; the other providers share one `hooks` container, so a user's hook is a sibling row.
 */
function readUserHookContent(config: Record<string, unknown>): unknown {
  return config[USER_HOOK_BLOCK] ?? hookRowsNaming(config, USER_HOOK_COMMAND);
}

/**
 * Add unrelated hook content and one unrelated top-level key to the installed hook config.
 * Use before toggling hooks so convergence has real user content to preserve. The content is
 * planted beside goat-flow's own block, never inside it, because a row placed inside a managed
 * block is owned content the registrar is right to converge away.
 * This writes the disposable target's hook config, so call it only on a fixture
 * project created by `makeTempProject`.
 *
 * @param hookConfigPath - absolute path of the installed agent hook config
 * @returns the planted content, for later identity comparison
 */
function plantUserHookContent(hookConfigPath: string): unknown {
  const config = JSON.parse(readFileSync(hookConfigPath, "utf-8")) as Record<
    string,
    unknown
  >;
  const managedPath = findManagedRowPath(config);
  assert.ok(
    managedPath !== null && managedPath.length > 0,
    `${hookConfigPath} must register the managed deny hook before planting user content`,
  );
  if (managedPath[0] === SHARED_HOOKS_KEY) {
    // The first numeric step names the element the provider's shared event array holds.
    const elementPosition = managedPath.findIndex(
      (step) => typeof step === "number",
    );
    const eventRows = resolveConfigPath(
      config,
      managedPath.slice(0, elementPosition),
    ) as unknown[];
    eventRows.push(
      asUserOwnedContent(eventRows[managedPath[elementPosition] as number]),
    );
  } else {
    config[USER_HOOK_BLOCK] = asUserOwnedContent(
      config[managedPath[0] as string],
    );
  }
  config[USER_CONFIG_MARKER] = "preserve";
  writeFileSync(hookConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  return readUserHookContent(config);
}

/** Read one installed hook config and report how many rows name the managed deny script. */
function managedDenyRowCount(hookConfigPath: string): number {
  const config = JSON.parse(readFileSync(hookConfigPath, "utf-8")) as unknown;
  return hookRowsNaming(config, MANAGED_DENY_SCRIPT).length;
}

/**
 * Assert one CLI operation repeated with identical arguments changes nothing the second time.
 *
 * @param projectPath - disposable target the operation runs against
 * @param label - human-readable step name reported when the repeat writes
 * @param args - full argument vector after the CLI entrypoint
 */
function assertRepeatIsNoOp(
  projectPath: string,
  label: string,
  ...args: string[]
): void {
  runCliStep(`${label} (first run)`, ...args);
  const beforeRepeat = snapshotProject(projectPath);
  runCliStep(`${label} (repeat run)`, ...args);
  const delta = snapshotDelta(beforeRepeat, snapshotProject(projectPath));
  assert.deepEqual(
    delta,
    { written: [], deleted: [] },
    `a repeated ${label} must leave the target unchanged`,
  );
}

/** Install one agent into a fresh disposable target and return its root. */
function installedTarget(agentProfile: AgentProfile): string {
  const projectPath = makeTempProject();
  runCliStep(
    `${agentProfile.id} install`,
    "install",
    projectPath,
    "--agent",
    agentProfile.id,
  );
  return projectPath;
}

describe("install write set", () => {
  const supportedAgentProfiles = getAgentProfiles();

  // Separate names make the failing agent visible in TAP output and CI summaries.
  for (const agentProfile of supportedAgentProfiles) {
    it(`${agentProfile.id} previews every path a fresh install writes`, () => {
      const projectPath = makeTempProject();
      const previewedPaths = previewWritePaths(projectPath, agentProfile.id);
      const before = snapshotProject(projectPath);

      runCliStep(
        `${agentProfile.id} install`,
        "install",
        projectPath,
        "--agent",
        agentProfile.id,
      );

      const delta = snapshotDelta(before, snapshotProject(projectPath));
      // A vacuous pass would hide a preview that simply lists nothing.
      assert.ok(
        delta.written.length > 0,
        `${agentProfile.id} install must write files for this proof to mean anything`,
      );
      assert.deepEqual(
        delta.written.filter((path) => !previewedPaths.has(path)),
        [],
        `${agentProfile.id} install wrote paths the dry-run never disclosed`,
      );
      assert.deepEqual(
        delta.deleted,
        [],
        `${agentProfile.id} first install must not remove target files`,
      );
    });

    it(`${agentProfile.id} converges install, sync, disable, and enable`, () => {
      const projectPath = installedTarget(agentProfile);
      assert.ok(agentProfile.hookConfigFile);
      const hookConfigPath = join(projectPath, agentProfile.hookConfigFile);
      const plantedUserContent = plantUserHookContent(hookConfigPath);

      assertRepeatIsNoOp(
        projectPath,
        `${agentProfile.id} install`,
        "install",
        projectPath,
        "--agent",
        agentProfile.id,
      );
      assertRepeatIsNoOp(
        projectPath,
        `${agentProfile.id} hooks sync`,
        "hooks",
        "sync",
        projectPath,
      );

      assertRepeatIsNoOp(
        projectPath,
        `${agentProfile.id} hooks disable`,
        "hooks",
        "disable",
        "deny-dangerous",
        projectPath,
      );
      assert.equal(
        managedDenyRowCount(hookConfigPath),
        0,
        `${agentProfile.id} disable must leave no managed deny registration`,
      );

      // A managed refresh must not resurrect a registration the user switched off.
      const beforeDisabledInstall = snapshotProject(projectPath);
      runCliStep(
        `${agentProfile.id} install while disabled`,
        "install",
        projectPath,
        "--agent",
        agentProfile.id,
      );
      assert.deepEqual(
        snapshotDelta(beforeDisabledInstall, snapshotProject(projectPath)),
        { written: [], deleted: [] },
        `${agentProfile.id} install must not rewrite a disabled hook state`,
      );
      assert.equal(managedDenyRowCount(hookConfigPath), 0);

      assertRepeatIsNoOp(
        projectPath,
        `${agentProfile.id} hooks enable`,
        "hooks",
        "enable",
        "deny-dangerous",
        projectPath,
      );
      assert.equal(
        managedDenyRowCount(hookConfigPath),
        1,
        `${agentProfile.id} enable must leave exactly one managed deny registration`,
      );

      const finalConfig = JSON.parse(
        readFileSync(hookConfigPath, "utf-8"),
      ) as Record<string, unknown>;
      assert.deepEqual(
        readUserHookContent(finalConfig),
        plantedUserContent,
        `${agentProfile.id} toggles must preserve the user's own hook content`,
      );
      assert.equal(
        finalConfig[USER_CONFIG_MARKER],
        "preserve",
        `${agentProfile.id} toggles must preserve unrelated hook-config keys`,
      );
    });
  }
});
