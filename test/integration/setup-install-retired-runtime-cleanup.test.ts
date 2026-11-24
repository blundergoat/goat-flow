/** Exercise retirement against saved release bytes, real files and preserved user choices. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { getAgentProfile } from "../../src/cli/agents/registry.js";
import type { AgentId } from "../../src/cli/types.js";
import {
  makeTempProject,
  PROJECT_ROOT,
  runCliInstaller,
} from "./setup-install.helpers.js";
import {
  createManagedInstallStateRow,
  writeManagedInstallStateV2,
  readManagedInstallStateFacade,
} from "../../src/cli/managed-setup-state.js";
import { hashFile } from "../../src/cli/managed-setup-write-set.js";
import {
  applyRetirementPreview,
  inspectRuntimeRetirement,
  removeRetiredRuntimeFile,
  retiredRuntimePaths,
  retiredRuntimeReferences,
  forgetAbsentRetiredRows,
} from "../../src/cli/installer/retired-runtime.js";
import { syncHookStates } from "../../src/cli/server/hook-registrar.js";
import {
  buildManagedSetupPreview,
  type ManagedSetupPreviewFile,
} from "../../src/cli/managed-setup-preview.js";

const ENTRY = ".goat-flow/hooks/deny-dangerous.sh";
const LIBRARY = ".goat-flow/hooks/deny-dangerous/guard-runtime.sh";

function write(project: string, path: string, bytes: string | Buffer): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), bytes);
}

/** Tagged bytes establish the old package identity rather than guessing a historical script. */
function released(path: string): Buffer {
  const result = spawnSync("git", ["show", `v1.18.0:workflow/hooks/${path}`], {
    cwd: PROJECT_ROOT,
  });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

function fixture() {
  const project = makeTempProject();
  write(project, ENTRY, released("deny-dangerous.sh"));
  write(project, LIBRARY, released("deny-dangerous/guard-runtime.sh"));
  const files = [ENTRY, LIBRARY].map((path) =>
    createManagedInstallStateRow({
      path,
      expectedSha256: hashFile(join(project, path)),
      provenance: { kind: "verified-install", goatFlowVersion: "1.18.0" },
    }),
  );
  writeManagedInstallStateV2(project, {
    schemaVersion: "goat-flow.install-state.v2",
    files,
    receipts: [],
  });
  return {
    project,
    expected: readManagedInstallStateFacade(project).expectedHashes,
  };
}

describe("stored-baseline runtime retirement", () => {
  it("Sync removes matching owned per-agent copies while preserving edited and unclassified copies", () => {
    const project = makeTempProject();
    const install = runCliInstaller(project, "--agent", "claude");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const paths = [
      ".claude/hooks/deny-dangerous.sh",
      ".claude/hooks/deny-git-mutations.sh",
      ".claude/hooks/post-turn-safety.sh",
    ] as const;
    for (const path of paths)
      write(project, path, released(path.slice(path.lastIndexOf("/") + 1)));
    const facade = readManagedInstallStateFacade(project);
    assert.ok(facade.state);
    writeManagedInstallStateV2(project, {
      ...facade.state,
      files: [
        ...facade.state.files,
        ...paths.slice(0, 2).map((path) =>
          createManagedInstallStateRow({
            path,
            expectedSha256: hashFile(join(project, path)),
            provenance: { kind: "verified-install", goatFlowVersion: "1.18.0" },
          }),
        ),
      ],
    });
    write(project, paths[1], "locally edited legacy policy\n");
    syncHookStates(project);
    assert.equal(existsSync(join(project, paths[0])), false);
    assert.equal(
      readFileSync(join(project, paths[1]), "utf8"),
      "locally edited legacy policy\n",
    );
    assert.ok(existsSync(join(project, paths[2])));
    assert.ok(existsSync(join(project, ".goat-flow/hooks/deny-dangerous.mjs")));
    assert.deepEqual(
      readManagedInstallStateFacade(project).state?.receipts,
      facade.state.receipts,
    );
  });

  it("keeps the list inactive for runtime files still shipped by the package", () => {
    const shipped = new Set(retiredRuntimePaths(new Set()));
    assert.deepEqual(retiredRuntimePaths(shipped), []);
  });

  it("removes only matching stored release bytes and preserves edited or unclassified files", () => {
    const { project, expected } = fixture();
    write(project, LIBRARY, "locally edited runtime\n");
    const unclassified = ".goat-flow/hooks/gruff-code-quality.sh";
    write(project, unclassified, released("gruff-code-quality.sh"));
    const retirement = inspectRuntimeRetirement(project, expected, new Set());
    assert.deepEqual(
      retirement.filter((file) => file.canRemove).map((file) => file.path),
      [ENTRY],
    );
    for (const file of retirement.filter((row) => row.canRemove))
      removeRetiredRuntimeFile(project, file);
    assert.equal(existsSync(join(project, ENTRY)), false);
    assert.equal(
      readFileSync(join(project, LIBRARY), "utf8"),
      "locally edited runtime\n",
    );
    assert.ok(existsSync(join(project, unclassified)));
  });

  it("keeps registrations and dependencies while a runtime customization awaits migration consent", () => {
    const { project, expected } = fixture();
    write(project, ENTRY, "locally edited entrypoint\n");
    const registration = JSON.stringify({
      hooks: { PreToolUse: [{ command: `bash "${ENTRY}"` }] },
    });
    write(project, ".claude/settings.json", registration);
    const files: ManagedSetupPreviewFile[] = [];
    applyRetirementPreview(project, files, expected, new Set(), {
      namedPaths: [],
      shouldReplaceAllManagedConflicts: false,
      shouldReplaceNamedUserOwned: false,
    });
    assert.equal(
      files.find((file) => file.path === ENTRY)?.authority,
      "withheld",
    );
    const library = inspectRuntimeRetirement(project, expected, new Set()).find(
      (file) => file.path === LIBRARY,
    );
    assert.ok(library?.canRemove);
    assert.throws(
      () => removeRetiredRuntimeFile(project, library),
      /migration is incomplete/u,
    );
    assert.equal(
      readFileSync(join(project, ".claude/settings.json"), "utf8"),
      registration,
    );
    assert.ok(existsSync(join(project, LIBRARY)));

    const approved: ManagedSetupPreviewFile[] = [];
    applyRetirementPreview(project, approved, expected, new Set(), {
      namedPaths: [ENTRY],
      shouldReplaceAllManagedConflicts: false,
      shouldReplaceNamedUserOwned: false,
    });
    assert.equal(
      approved.find((file) => file.path === ENTRY)?.authority,
      "granted-path",
    );
    write(
      project,
      ".claude/settings.json",
      JSON.stringify({
        hooks: {
          PreToolUse: [{ command: "node .goat-flow/hooks/deny-dangerous.mjs" }],
        },
      }),
    );
    removeRetiredRuntimeFile(project, library);
    assert.equal(existsSync(join(project, LIBRARY)), false);
    assert.equal(
      readFileSync(join(project, ENTRY), "utf8"),
      "locally edited entrypoint\n",
    );
  });

  it("rechecks current bytes before removal and retires orphan rows without inventing receipts", () => {
    const { project, expected } = fixture();
    const retirement = inspectRuntimeRetirement(project, expected, new Set());
    const entry = retirement.find((file) => file.path === ENTRY);
    assert.ok(entry);
    write(project, ENTRY, "changed after review\n");
    assert.throws(
      () => removeRetiredRuntimeFile(project, entry),
      /changed before cleanup/u,
    );
    const library = retirement.find((file) => file.path === LIBRARY);
    assert.ok(library);
    removeRetiredRuntimeFile(project, library);
    const state = readManagedInstallStateFacade(project).state;
    assert.ok(state);
    const retired = forgetAbsentRetiredRows(project, state, new Set());
    assert.deepEqual(
      retired.files.map((file) => file.path),
      [ENTRY],
    );
    assert.deepEqual(retired.receipts, state.receipts);
  });
});

const PROVIDERS: readonly AgentId[] = [
  "claude",
  "codex",
  "antigravity",
  "copilot",
];
/** A short deny command naming the retired Bash entrypoint; real pre-upgrade launchers name the same file, which is all the dependency check matches. */
const RETIRED_DENY_COMMAND = `bash ${ENTRY}`;
const STATE_DIRECTORY = ".goat-flow/state/install";
const STATE_BACKUP = ".goat-flow/state/install-before-upgrade";

/** Add the retired deny row to one provider config in that provider's own shape; writes the config as an older release left it. */
function seedRetiredRegistration(project: string, agent: AgentId): void {
  const configPath = join(project, getAgentProfile(agent).hookConfigFile ?? "");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  // Antigravity keys each managed hook as one top-level definition.
  if (agent === "antigravity") {
    const definition = config["deny-dangerous"] as { PreToolUse: unknown[] };
    definition.PreToolUse.push({
      matcher: "run_command",
      hooks: [{ type: "command", command: RETIRED_DENY_COMMAND, timeout: 30 }],
    });
  } else if (agent === "copilot") {
    // Copilot keeps dual-shell command rows directly under camel-case events.
    const hooks = config.hooks as Record<string, unknown[]>;
    hooks.preToolUse.push({
      type: "command",
      bash: RETIRED_DENY_COMMAND,
      powershell: RETIRED_DENY_COMMAND,
      timeoutSec: 30,
    });
  } else {
    // Claude and Codex nest runnable commands below matcher groups per event.
    const hooks = config.hooks as Record<string, unknown[]>;
    hooks.PreToolUse.push({
      matcher: "Bash",
      hooks: [{ type: "command", command: RETIRED_DENY_COMMAND }],
    });
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

let multiAgentSeedPath: string | undefined;

/**
 * Build one four-agent project in the state an older release left: every provider config still names the retired Bash
 * entrypoint, its released bytes are on disk with saved hashes, and config names the earlier release.
 *
 * @returns a fresh copy of that project, so each agent order starts from identical bytes
 */
function multiAgentProject(): string {
  if (multiAgentSeedPath === undefined) {
    const seed = makeTempProject();
    for (const agent of PROVIDERS) {
      const install = runCliInstaller(seed, "--agent", agent);
      assert.equal(install.status, 0, install.stderr || install.stdout);
    }
    for (const agent of PROVIDERS) seedRetiredRegistration(seed, agent);
    write(seed, ENTRY, released("deny-dangerous.sh"));
    write(seed, LIBRARY, released("deny-dangerous/guard-runtime.sh"));
    const state = readManagedInstallStateFacade(seed).state;
    assert.ok(state);
    writeManagedInstallStateV2(seed, {
      ...state,
      files: [
        ...state.files,
        ...[ENTRY, LIBRARY].map((path) =>
          createManagedInstallStateRow({
            path,
            expectedSha256: hashFile(join(seed, path)),
            provenance: { kind: "verified-install", goatFlowVersion: "1.18.0" },
          }),
        ),
      ],
    });
    const configPath = join(seed, ".goat-flow/config.yaml");
    writeFileSync(
      configPath,
      readFileSync(configPath, "utf8").replace(
        /^version: .*$/mu,
        'version: "1.18.0"',
      ),
    );
    multiAgentSeedPath = seed;
  }
  const project = makeTempProject();
  cpSync(multiAgentSeedPath, project, { recursive: true });
  return project;
}

/** Hash every project file outside local state and logs, so a repeated install proves it changed nothing. */
function projectFileHashes(project: string): Map<string, string> {
  const hashes = new Map<string, string>();
  // Recurse through one directory, hashing each file it reads.
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(project, absolute);
      // Receipts and logs record each run by design; they are not project content.
      if (path === ".goat-flow/state" || path === ".goat-flow/logs") continue;
      if (entry.isDirectory()) walk(absolute);
      else
        hashes.set(
          path,
          createHash("sha256").update(readFileSync(absolute)).digest("hex"),
        );
    }
  };
  walk(project);
  return hashes;
}

/** Read every file below one state folder, keyed by its path inside that folder. */
function stateFolderBytes(
  project: string,
  folder: string,
): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(join(project, folder)))
    files.set(name, readFileSync(join(project, folder, name), "utf8"));
  return files;
}

/**
 * Install each provider in one order and check every step's exit, pending notice, retired files and backup.
 *
 * @returns the retired runtime paths still on disk after the last install; empty means cleanup finished
 */
function upgradeAgentByAgent(order: readonly AgentId[]): string[] {
  const project = multiAgentProject();
  const stateBefore = stateFolderBytes(project, STATE_DIRECTORY);
  for (const [index, agent] of order.entries()) {
    const install = runCliInstaller(project, "--agent", agent);
    const output = `${install.stdout}\n${install.stderr}`;
    assert.equal(install.status, 0, output);
    assert.doesNotMatch(output, /Fatal error/u);
    assert.match(output, new RegExp(`Install verified for ${agent}\\b`, "u"));
    // The first install changes the release, so it alone saves the pre-upgrade state and prints how to restore it.
    if (index === 0) assert.match(output, /install-before-upgrade/u);
    else assert.doesNotMatch(output, /install-before-upgrade/u);
    assert.deepEqual(stateFolderBytes(project, STATE_BACKUP), stateBefore);
    const remaining = order.slice(index + 1);
    // Retired files stay until the last provider stops using them, and the summary names each provider still to install.
    if (remaining.length > 0) {
      assert.ok(existsSync(join(project, ENTRY)), `${agent}: entry kept`);
      assert.ok(existsSync(join(project, LIBRARY)), `${agent}: library kept`);
      assert.match(output, /Runtime cleanup pending/u);
      for (const pending of remaining) {
        assert.ok(
          output.includes(getAgentProfile(pending).hookConfigFile ?? ""),
          `${agent}: names ${pending}'s config`,
        );
        assert.match(output, new RegExp(`--agent ${pending}\\b`, "u"));
      }
    } else {
      assert.equal(existsSync(join(project, ENTRY)), false);
      assert.equal(existsSync(join(project, LIBRARY)), false);
      assert.doesNotMatch(output, /Runtime cleanup pending/u);
    }
  }
  // Repeating the final command with the same options finds nothing left to change.
  const before = projectFileHashes(project);
  const repeat = runCliInstaller(project, "--agent", order.at(-1) ?? "claude");
  assert.equal(repeat.status, 0, `${repeat.stdout}\n${repeat.stderr}`);
  assert.deepEqual(projectFileHashes(project), before);
  return [ENTRY, LIBRARY].filter((path) => existsSync(join(project, path)));
}

describe("pending retired runtime references", () => {
  // Writes an unparsable peer config into a temp project; reports it only while a retired file still exists.
  it("lists an unreadable config only while a retired runtime file remains", () => {
    const project = makeTempProject();
    write(project, ".agents/hooks.json", "{ not json\n");
    assert.deepEqual(retiredRuntimeReferences(project), []);
    write(project, ENTRY, released("deny-dangerous.sh"));
    assert.deepEqual(retiredRuntimeReferences(project), [
      { agent: "antigravity", path: ".agents/hooks.json" },
    ]);
  });
});

describe("agent-by-agent upgrade from the retired runtime", () => {
  // Spawns four installs into a copied fixture; the first install writes the pre-upgrade state backup.
  it("finishes every install in registry order and removes retired files once", () => {
    assert.deepEqual(upgradeAgentByAgent(PROVIDERS), []);
  });

  // Spawns the same installs in reverse, so the last provider to move off the runtime differs.
  it("finishes every install in reverse order and removes retired files once", () => {
    assert.deepEqual(upgradeAgentByAgent([...PROVIDERS].reverse()), []);
  });
});

const EDITED = ".goat-flow/hooks/deny-dangerous/patterns-shell.sh";
const STALE_PLAYBOOK = ".goat-flow/skill-docs/playbooks/writing-style.md";

/**
 * Build a claude project as a pre-1.17.0 release left it: per-agent v1 records only, a registered retired runtime with two unedited
 * files and one edited file, and config naming the earlier release.
 * Side effects: writes a temp project, spawns the source install into it, then rewrites its hook config, install state and config.
 *
 * @returns the project; the fixture contract is that every v1 hash matches the bytes that release installed, so only the edited file differs
 */
function olderRecordsProject(): string {
  const project = makeTempProject();
  const install = runCliInstaller(project, "--agent", "claude");
  assert.equal(install.status, 0, install.stderr || install.stdout);
  seedRetiredRegistration(project, "claude");
  write(project, ENTRY, released("deny-dangerous.sh"));
  write(project, LIBRARY, released("deny-dangerous/guard-runtime.sh"));
  write(project, EDITED, released("deny-dangerous/patterns-shell.sh"));
  const state = readManagedInstallStateFacade(project).state;
  assert.ok(state);
  const files = [
    ...state.files.map(({ path, expectedSha256 }) => ({
      path,
      expectedSha256,
    })),
    ...[ENTRY, LIBRARY, EDITED].map((path) => ({
      path,
      expectedSha256: hashFile(join(project, path)),
    })),
  ];
  write(project, EDITED, "# locally edited shell policy\n");
  // Older releases kept only per-agent records, so the shared file and every cutover marker go.
  for (const name of readdirSync(join(project, STATE_DIRECTORY)))
    rmSync(join(project, STATE_DIRECTORY, name));
  write(
    project,
    `${STATE_DIRECTORY}/claude.json`,
    `${JSON.stringify({ schemaVersion: "goat-flow.install-state.v1", agent: "claude", goatFlowVersion: "1.16.0", files }, null, 2)}\n`,
  );
  const configPath = join(project, ".goat-flow/config.yaml");
  writeFileSync(
    configPath,
    readFileSync(configPath, "utf8").replace(
      /^version: .*$/mu,
      'version: "1.16.0"',
    ),
  );
  return project;
}

describe("retired files recorded by an older release", () => {
  // Writes a v1-record project and spawns setup and two installs; the preview, output and saved state show delete, keep and forced delete.
  it("removes unedited files on the first upgrade and an edited one only when --force-path names it", () => {
    const project = olderRecordsProject();
    const actions = new Map(
      buildManagedSetupPreview(project, "claude").files.map((file) => [
        file.path,
        file.action,
      ]),
    );
    assert.equal(actions.get(ENTRY), "remove");
    assert.equal(actions.get(LIBRARY), "remove");
    assert.equal(actions.get(EDITED), "migrate");
    const setup = spawnSync(
      "node",
      [
        "--import",
        "tsx",
        join(PROJECT_ROOT, "src/cli/cli.ts"),
        "setup",
        project,
        "--agent",
        "claude",
      ],
      { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    assert.match(
      setup.stdout,
      /Old goat-flow files on disk now: .*patterns-shell\.sh/u,
    );
    const refused = runCliInstaller(project, "--agent", "claude");
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(
      refused.stderr,
      /--force-path <path> switches its registration and deletes the file/u,
    );

    const upgrade = runCliInstaller(
      project,
      "--agent",
      "claude",
      "--force-managed",
    );
    assert.equal(upgrade.status, 0, upgrade.stderr || upgrade.stdout);
    assert.equal(existsSync(join(project, ENTRY)), false);
    assert.equal(existsSync(join(project, LIBRARY)), false);
    assert.equal(
      readFileSync(join(project, EDITED), "utf8"),
      "# locally edited shell policy\n",
    );
    assert.match(upgrade.stdout, new RegExp(`${EDITED} \\(kept: edited`, "u"));
    assert.match(upgrade.stdout, new RegExp(`--force-path ${EDITED}`, "u"));
    assert.match(
      upgrade.stdout,
      new RegExp(`Old goat-flow files kept:\\n  ${EDITED}: `, "u"),
    );

    const forced = runCliInstaller(
      project,
      "--agent",
      "claude",
      "--force-path",
      EDITED,
    );
    assert.equal(forced.status, 0, forced.stderr || forced.stdout);
    assert.equal(existsSync(join(project, EDITED)), false);
    assert.match(forced.stdout, /restore it from Git history/u);
    assert.doesNotMatch(forced.stdout, /Old goat-flow files kept:/u);
    // The same command again names a file that is already gone; it warns and continues.
    const repeated = runCliInstaller(
      project,
      "--agent",
      "claude",
      "--force-path",
      EDITED,
    );
    assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
    assert.match(repeated.stderr, /needs no authority/u);
    const rows = readManagedInstallStateFacade(project).state?.files ?? [];
    assert.deepEqual(
      rows.filter((row) => [ENTRY, LIBRARY, EDITED].includes(row.path)),
      [],
    );
  });

  // Adds rows for absent retired files and points a stale peer receipt at them; one install must forget both everywhere.
  it("forgets absent retired paths in shared state and in every receipt", () => {
    const project = makeTempProject();
    for (const agent of ["claude", "codex"] as const) {
      const install = runCliInstaller(project, "--agent", agent);
      assert.equal(install.status, 0, install.stderr || install.stdout);
    }
    const state = readManagedInstallStateFacade(project).state;
    assert.ok(state);
    const absent = [ENTRY, STALE_PLAYBOOK].map((path) =>
      createManagedInstallStateRow({
        path,
        expectedSha256: "0".repeat(64),
        provenance: { kind: "verified-install", goatFlowVersion: "1.18.0" },
      }),
    );
    writeManagedInstallStateV2(project, {
      ...state,
      files: [...state.files, ...absent],
      receipts: state.receipts.map((receipt) =>
        receipt.agent === "codex"
          ? {
              ...receipt,
              goatFlowVersion: "1.18.0",
              files: [
                ...receipt.files,
                ...absent.map(({ path, generation }) => ({ path, generation })),
              ],
            }
          : receipt,
      ),
    });

    const install = runCliInstaller(project, "--agent", "claude");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const after = readManagedInstallStateFacade(project).state;
    assert.ok(after);
    const absentPaths = absent.map(({ path }) => path);
    assert.deepEqual(
      after.files.filter((row) => absentPaths.includes(row.path)),
      [],
    );
    assert.deepEqual(
      after.receipts.flatMap((receipt) =>
        receipt.files.filter((file) => absentPaths.includes(file.path)),
      ),
      [],
    );
  });
});
