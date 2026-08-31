/**
 * Managed setup preview contract tests for the nine user-visible drift states.
 * These fixtures keep classification independent from filesystem setup so failures
 * tell users whether local edits, package changes, or missing baselines caused a block.
 * State serialization checks also ensure continuation data stays hash-only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildInstallerInvocation } from "../../src/cli/install-invocation.js";
import {
  buildManagedSetupPreview,
  classifyManagedSetupFile,
  managedSetupChangeDirection,
  managedSetupPreviewForInstallerLaunch,
  managedInstallStatePath,
  prepareManagedInstallStateForApply,
  writeManagedInstallState,
  type ManagedSetupFileState,
  type ManagedSetupPreview,
} from "../../src/cli/managed-setup-preview.js";
import {
  canonicalManagedInstallStateBytes,
  createManagedInstallStateRow,
  managedInstallStateV2Path,
  readManagedInstallStateFacade,
  writeManagedInstallStateV2,
  type ManagedInstallStateV2,
} from "../../src/cli/managed-setup-state.js";
import { getTemplatePath } from "../../src/cli/paths.js";

const OLD_EXPECTED_HASH = "a".repeat(64);
const CURRENT_FILE_HASH = "b".repeat(64);
const NEW_EXPECTED_HASH = "c".repeat(64);

/** One three-way hash combination and the state users should see for it. */
interface ClassificationFixture {
  name: string;
  oldExpectedSha256: string | null;
  currentSha256: string | null;
  newExpectedSha256: string | null;
  expectedState: ManagedSetupFileState;
}

const CLASSIFICATION_FIXTURES: ClassificationFixture[] = [
  {
    name: "unchanged",
    oldExpectedSha256: OLD_EXPECTED_HASH,
    currentSha256: NEW_EXPECTED_HASH,
    newExpectedSha256: NEW_EXPECTED_HASH,
    expectedState: "unchanged",
  },
  {
    name: "local-preserved",
    oldExpectedSha256: OLD_EXPECTED_HASH,
    currentSha256: CURRENT_FILE_HASH,
    newExpectedSha256: OLD_EXPECTED_HASH,
    expectedState: "local-preserved",
  },
  {
    name: "template-changed",
    oldExpectedSha256: OLD_EXPECTED_HASH,
    currentSha256: OLD_EXPECTED_HASH,
    newExpectedSha256: NEW_EXPECTED_HASH,
    expectedState: "template-changed",
  },
  {
    name: "both-changed",
    oldExpectedSha256: OLD_EXPECTED_HASH,
    currentSha256: CURRENT_FILE_HASH,
    newExpectedSha256: NEW_EXPECTED_HASH,
    expectedState: "both-changed",
  },
  {
    name: "added",
    oldExpectedSha256: null,
    currentSha256: null,
    newExpectedSha256: NEW_EXPECTED_HASH,
    expectedState: "added",
  },
  {
    name: "removed",
    oldExpectedSha256: OLD_EXPECTED_HASH,
    currentSha256: CURRENT_FILE_HASH,
    newExpectedSha256: null,
    expectedState: "removed",
  },
  {
    name: "missing",
    oldExpectedSha256: OLD_EXPECTED_HASH,
    currentSha256: null,
    newExpectedSha256: NEW_EXPECTED_HASH,
    expectedState: "missing",
  },
  {
    name: "adopted pre-baseline file",
    oldExpectedSha256: null,
    currentSha256: CURRENT_FILE_HASH,
    newExpectedSha256: NEW_EXPECTED_HASH,
    expectedState: "adopted",
  },
];

describe("managed setup classification", () => {
  // Each row represents what a user sees after editing, upgrading, deleting, or first installing.
  for (const fixture of CLASSIFICATION_FIXTURES) {
    it(`classifies ${fixture.name}`, () => {
      assert.equal(
        classifyManagedSetupFile({
          oldExpectedSha256: fixture.oldExpectedSha256,
          currentSha256: fixture.currentSha256,
          newExpectedSha256: fixture.newExpectedSha256,
        }),
        fixture.expectedState,
      );
    });
  }

  it("maps M02 states to one behind-versus-diverged repair direction", () => {
    assert.equal(managedSetupChangeDirection("template-changed"), "behind");
    assert.equal(managedSetupChangeDirection("both-changed"), "diverged");
    assert.equal(managedSetupChangeDirection("local-preserved"), "diverged");
    assert.equal(managedSetupChangeDirection("unchanged"), "current");
    assert.equal(managedSetupChangeDirection("adopted"), "unclassified");
  });

  it("treats an already-converged target as unchanged without baseline state", () => {
    assert.equal(
      classifyManagedSetupFile({
        oldExpectedSha256: null,
        currentSha256: NEW_EXPECTED_HASH,
        newExpectedSha256: NEW_EXPECTED_HASH,
      }),
      "unchanged",
    );
  });

  /**
   * Fixture writes the first CLI install into a target set up before
   * install-state existed: a differing regular managed file must warn and
   * refresh, never block the whole upgrade behind --force.
   */
  it("adopts a pre-baseline differing managed file with a warning verdict", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-adopt-"));
    const managedDirectory = join(projectPath, ".goat-flow", "logs", "quality");
    try {
      mkdirSync(managedDirectory, { recursive: true });
      writeFileSync(
        join(managedDirectory, "README.md"),
        "older-package readme body\n",
        "utf-8",
      );
      const preview = buildManagedSetupPreview(projectPath, "codex");
      const managedFile = preview.files.find(
        (file) => file.path === ".goat-flow/logs/quality/README.md",
      );

      assert.equal(managedFile?.state, "adopted");
      assert.equal(managedFile?.action, "replace");
      assert.equal(preview.baselineStatus, "missing");
      assert.equal(preview.verdict, "warning");
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});

describe("managed setup prerequisites", () => {
  /** Contract: preview and install share the blocker while the input stays unchanged. */
  it("blocks dry-run with the same launch failure the real install would report", () => {
    const preview: ManagedSetupPreview = {
      schemaVersion: "goat-flow.managed-setup-preview.v2",
      coverage: "install-write-set",
      agent: "claude",
      goatFlowVersion: "1.15.0",
      baselineStatus: "missing",
      verdict: "ready",
      limits: [],
      files: [],
    };
    const installerLaunch = buildInstallerInvocation({
      scriptPath: "C:\\package\\workflow\\install-goat-flow.sh",
      projectPath: "C:\\Users\\Example\\project",
      agent: "claude",
      installerFlags: [],
      platform: "win32",
      windowsBashCandidates: [],
    });

    const blocked = managedSetupPreviewForInstallerLaunch(
      preview,
      installerLaunch,
    );

    assert.ok(!installerLaunch.ok, "Expected missing Windows Bash");
    assert.equal(blocked.verdict, "blocked");
    assert.equal(
      blocked.limits.includes(
        `Install prerequisite failed: ${installerLaunch.error}`,
      ),
      true,
    );
    assert.equal(preview.verdict, "ready");
  });
});

describe("managed install state", () => {
  /** This fixture writes the stable schema and hash-only fingerprint baseline users receive after install. */
  it("writes only relative paths and hashes for the next user preview", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-preview-state-"));
    const preview: ManagedSetupPreview = {
      schemaVersion: "goat-flow.managed-setup-preview.v2",
      coverage: "install-write-set",
      agent: "codex",
      goatFlowVersion: "1.13.1",
      baselineStatus: "missing",
      verdict: "ready",
      limits: ["Config migrations are outside this managed-template preview."],
      files: [
        {
          path: ".goat-flow/hooks/deny-dangerous.sh",
          ownership: "system-owned",
          state: "added",
          action: "create",
          reason: "The managed template is not installed yet.",
          oldExpectedSha256: null,
          currentStatus: "missing",
          currentSha256: null,
          newExpectedSha256: NEW_EXPECTED_HASH,
        },
      ],
    };

    try {
      writeManagedInstallState(projectPath, preview);
      const statePath = managedInstallStatePath(projectPath, "codex");
      const serializedState = readFileSync(statePath, "utf-8");
      assert.match(serializedState, /goat-flow\.install-state\.v1/u);
      assert.match(serializedState, new RegExp(NEW_EXPECTED_HASH, "u"));
      assert.doesNotMatch(serializedState, new RegExp(projectPath, "u"));
      assert.doesNotMatch(serializedState, /The managed template/u);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  /** This fixture writes through the baseline contract and proves redirected storage receives nothing. */
  it("refuses a target-controlled symlink for the install-state directory", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-preview-state-"));
    const redirectedStatePath = mkdtempSync(
      join(tmpdir(), "goat-flow-preview-redirect-"),
    );
    const preview: ManagedSetupPreview = {
      schemaVersion: "goat-flow.managed-setup-preview.v2",
      coverage: "install-write-set",
      agent: "codex",
      goatFlowVersion: "1.13.1",
      baselineStatus: "missing",
      verdict: "ready",
      limits: [],
      files: [],
    };

    try {
      mkdirSync(join(projectPath, ".goat-flow"), { recursive: true });
      symlinkSync(
        redirectedStatePath,
        join(projectPath, ".goat-flow", "install-state"),
      );
      assert.throws(
        () => writeManagedInstallState(projectPath, preview),
        /.goat-flow\/install-state must be a project-local directory/u,
      );
      assert.deepEqual(readdirSync(redirectedStatePath), []);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
      rmSync(redirectedStatePath, { recursive: true, force: true });
    }
  });

  /**
   * This fixture writes a symlinked temp entry, then proves the preview still
   * writes baseline bytes to the real destination. The redirect must fail even
   * when an attacker pre-plants the temp path, so the victim file outside the
   * project stays untouched.
   */
  it("never writes baseline bytes through a pre-planted temp symlink", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-preview-state-"));
    const victimPath = join(
      mkdtempSync(join(tmpdir(), "goat-flow-preview-victim-")),
      "victim.json",
    );
    const preview: ManagedSetupPreview = {
      schemaVersion: "goat-flow.managed-setup-preview.v2",
      coverage: "install-write-set",
      agent: "codex",
      goatFlowVersion: "1.13.1",
      baselineStatus: "missing",
      verdict: "ready",
      limits: [],
      files: [
        {
          path: ".goat-flow/hooks/deny-dangerous.sh",
          ownership: "system-owned",
          state: "added",
          action: "create",
          reason: "The managed template is not installed yet.",
          oldExpectedSha256: null,
          currentStatus: "missing",
          currentSha256: null,
          newExpectedSha256: NEW_EXPECTED_HASH,
        },
      ],
    };

    try {
      mkdirSync(join(projectPath, ".goat-flow", "install-state"), {
        recursive: true,
      });
      writeFileSync(victimPath, "untouched\n", "utf-8");
      const statePath = managedInstallStatePath(projectPath, "codex");
      // An untrusted checkout can pre-plant the deterministic temp name.
      symlinkSync(victimPath, `${statePath}.tmp-${process.pid}`);

      writeManagedInstallState(projectPath, preview);

      assert.equal(
        readFileSync(victimPath, "utf-8"),
        "untouched\n",
        "the symlink target must never receive baseline bytes",
      );
      const stateStats = lstatSync(statePath);
      assert.ok(
        stateStats.isFile(),
        "recorded baseline must be a regular file",
      );
      assert.match(
        readFileSync(statePath, "utf-8"),
        /goat-flow\.install-state\.v1/u,
      );
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
      rmSync(join(victimPath, ".."), { recursive: true, force: true });
    }
  });

  /**
   * This fixture writes and removes a valid baseline behind a target-controlled directory symlink.
   * It proves the baseline invariant: outside-project hashes are invalid and preview blocks.
   */
  it("rejects a valid baseline behind a symlinked install-state directory", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-preview-state-"));
    const redirectedStatePath = mkdtempSync(
      join(tmpdir(), "goat-flow-preview-redirect-"),
    );
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
      symlinkSync(
        redirectedStatePath,
        join(projectPath, ".goat-flow", "install-state"),
      );

      const preview = buildManagedSetupPreview(projectPath, "codex");
      assert.equal(preview.baselineStatus, "malformed-blocking");
      assert.equal(preview.verdict, "blocked");
      assert.equal(
        preview.limits.some((limit) =>
          limit.includes(
            ".goat-flow/install-state must be a project-local directory.",
          ),
        ),
        true,
      );
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
      rmSync(redirectedStatePath, { recursive: true, force: true });
    }
  });
});

/**
 * Write one complete legacy v1 baseline into a disposable project.
 * Filesystem side effects: creates the state directory and replaces only the named fixture file.
 * Invariant: the body matches the canonical legacy writer shape used by global bootstrap.
 */
function writeLegacyStateFixture(
  projectPath: string,
  agent: "claude" | "codex" | "antigravity" | "copilot",
  goatFlowVersion: string,
  files: Array<{ path: string; expectedSha256: string }>,
): void {
  const statePath = managedInstallStatePath(projectPath, agent);
  mkdirSync(join(projectPath, ".goat-flow", "install-state"), {
    recursive: true,
  });
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schemaVersion: "goat-flow.install-state.v1",
        agent,
        goatFlowVersion,
        files: [...files].sort((left, right) =>
          left.path.localeCompare(right.path),
        ),
      },
      null,
      2,
    )}\n`,
  );
}

/** Read one disposable marker body so each agent assertion remains independently named. */
function readCutoverMarkerFixture(
  projectPath: string,
  agent: "claude" | "codex" | "antigravity" | "copilot",
): unknown {
  return JSON.parse(
    readFileSync(managedInstallStatePath(projectPath, agent), "utf-8"),
  ) as unknown;
}

describe("managed install state v2 facade", () => {
  /**
   * Fixture purpose: two agent files share paths but disagree only where release precedence resolves history.
   * Side effects: writes legacy state in one disposable project; the facade itself remains read-only.
   * Invariant: bootstrap output has no selected-agent input and never publishes managed.json.
   */
  it("bootstraps every legacy agent into one selection-independent state", () => {
    const firstProjectPath = mkdtempSync(
      join(tmpdir(), "goat-flow-v2-bootstrap-"),
    );
    const reverseProjectPath = mkdtempSync(
      join(tmpdir(), "goat-flow-v2-bootstrap-reverse-"),
    );
    const sharedPath = ".agents/skills/goat/SKILL.md";
    const rankedPath = ".goat-flow/hooks/run-with-bash.mjs";
    const codexOnlyPath = ".codex/config.toml";
    const antigravityOnlyPath = ".agents/hooks.json";
    const codexFiles = [
      { path: sharedPath, expectedSha256: OLD_EXPECTED_HASH },
      { path: rankedPath, expectedSha256: NEW_EXPECTED_HASH },
      { path: codexOnlyPath, expectedSha256: OLD_EXPECTED_HASH },
    ];
    const antigravityFiles = [
      { path: sharedPath, expectedSha256: OLD_EXPECTED_HASH },
      { path: rankedPath, expectedSha256: CURRENT_FILE_HASH },
      { path: antigravityOnlyPath, expectedSha256: CURRENT_FILE_HASH },
    ];
    try {
      writeLegacyStateFixture(firstProjectPath, "codex", "1.16.0", codexFiles);
      writeLegacyStateFixture(
        firstProjectPath,
        "antigravity",
        "1.15.1",
        antigravityFiles,
      );
      writeLegacyStateFixture(
        reverseProjectPath,
        "antigravity",
        "1.15.1",
        antigravityFiles,
      );
      writeLegacyStateFixture(
        reverseProjectPath,
        "codex",
        "1.16.0",
        codexFiles,
      );

      const result = readManagedInstallStateFacade(firstProjectPath);
      const reverseResult = readManagedInstallStateFacade(reverseProjectPath);

      assert.equal(result.status, "loaded");
      assert.equal(result.source, "legacy-bootstrap");
      assert.equal(reverseResult.status, "loaded");
      assert.equal(result.canonicalBytes, reverseResult.canonicalBytes);
      assert.equal(result.expectedHashes.get(sharedPath), OLD_EXPECTED_HASH);
      assert.equal(result.expectedHashes.get(rankedPath), NEW_EXPECTED_HASH);
      assert.equal(result.expectedHashes.get(codexOnlyPath), OLD_EXPECTED_HASH);
      assert.equal(
        result.expectedHashes.get(antigravityOnlyPath),
        CURRENT_FILE_HASH,
      );
      const sharedRow = result.state?.files.find(
        (row) => row.path === sharedPath,
      );
      const rankedRow = result.state?.files.find(
        (row) => row.path === rankedPath,
      );
      assert.deepEqual(sharedRow?.provenance, {
        kind: "legacy-v1-bootstrap",
        observations: [
          { agent: "antigravity", goatFlowVersion: "1.15.1" },
          { agent: "codex", goatFlowVersion: "1.16.0" },
        ],
      });
      assert.deepEqual(rankedRow?.provenance, {
        kind: "legacy-v1-bootstrap",
        observations: [{ agent: "codex", goatFlowVersion: "1.16.0" }],
      });
      assert.equal(
        existsSync(managedInstallStateV2Path(firstProjectPath)),
        false,
        "a read-only bootstrap must not publish managed.json",
      );
      assert.equal(
        existsSync(managedInstallStateV2Path(reverseProjectPath)),
        false,
        "a read-only bootstrap must not publish managed.json",
      );
    } finally {
      rmSync(firstProjectPath, { recursive: true, force: true });
      rmSync(reverseProjectPath, { recursive: true, force: true });
    }
  });

  it("accepts agreeing legacy hashes even when their versions are unrankable", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-v2-agreeing-"));
    try {
      writeLegacyStateFixture(projectPath, "codex", "release-blue", [
        { path: "AGENTS.md", expectedSha256: OLD_EXPECTED_HASH },
      ]);
      writeLegacyStateFixture(projectPath, "antigravity", "release-green", [
        { path: "AGENTS.md", expectedSha256: OLD_EXPECTED_HASH },
      ]);

      const result = readManagedInstallStateFacade(projectPath);
      assert.equal(result.status, "loaded");
      assert.deepEqual(result.state?.files[0]?.provenance, {
        kind: "legacy-v1-bootstrap",
        observations: [
          { agent: "antigravity", goatFlowVersion: "release-green" },
          { agent: "codex", goatFlowVersion: "release-blue" },
        ],
      });
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: preserve the historical v1 writer's locale-sorted row order at migration.
   * Side effects: writes one production-shaped v1 baseline inside a disposable project.
   * Invariant: a baseline emitted by the supported predecessor is valid bootstrap evidence.
   */
  it("bootstraps a baseline written by the v1 state writer", () => {
    const projectPath = mkdtempSync(
      join(tmpdir(), "goat-flow-v2-real-legacy-"),
    );
    try {
      const preview = buildManagedSetupPreview(projectPath, "codex");
      writeManagedInstallState(projectPath, preview);

      const result = readManagedInstallStateFacade(projectPath);
      assert.equal(result.status, "loaded", result.error ?? "");
      assert.equal(result.source, "legacy-bootstrap");
      assert.deepEqual(result.legacyAgents, ["codex"]);
      assert.ok(result.expectedHashes.size > 0);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: apply one clean v1 inventory through the claimed cutover helper.
   * Filesystem side effects: publishes managed.json and replaces all four disposable v1 paths with canonical markers.
   * Invariant: the imported agent is migrated, absent agents remain hashless, and the bootstrap carries no receipt.
   */
  it("publishes receipt-free v2 state before canonical cutover markers", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-v2-cutover-"));
    try {
      writeLegacyStateFixture(projectPath, "codex", "1.16.0", [
        { path: "AGENTS.md", expectedSha256: OLD_EXPECTED_HASH },
      ]);

      prepareManagedInstallStateForApply(projectPath);

      const facade = readManagedInstallStateFacade(projectPath);
      assert.equal(facade.status, "loaded");
      assert.equal(facade.source, "v2");
      assert.deepEqual(facade.state?.receipts, []);
      assert.deepEqual(readCutoverMarkerFixture(projectPath, "claude"), {
        schemaVersion: "goat-flow.install-state.v1-cutover",
        agent: "claude",
        managedState: "managed.json",
        legacyEvidence: "absent",
      });
      assert.deepEqual(readCutoverMarkerFixture(projectPath, "codex"), {
        schemaVersion: "goat-flow.install-state.v1-cutover",
        agent: "codex",
        managedState: "managed.json",
        legacyEvidence: "migrated",
      });
      assert.deepEqual(readCutoverMarkerFixture(projectPath, "antigravity"), {
        schemaVersion: "goat-flow.install-state.v1-cutover",
        agent: "antigravity",
        managedState: "managed.json",
        legacyEvidence: "absent",
      });
      assert.deepEqual(readCutoverMarkerFixture(projectPath, "copilot"), {
        schemaVersion: "goat-flow.install-state.v1-cutover",
        agent: "copilot",
        managedState: "managed.json",
        legacyEvidence: "absent",
      });
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: block the first marker's private temp path after a clean v1 inventory resolves.
   * Filesystem side effects: leaves only the recoverable receipt-free managed.json half of cutover inside the disposable project.
   * Invariant: marker failure happens after state publication and before any receipt can appear.
   */
  it("leaves a recoverable receipt-free bootstrap when marker publication fails", () => {
    const projectPath = mkdtempSync(
      join(tmpdir(), "goat-flow-v2-cutover-failure-"),
    );
    try {
      writeLegacyStateFixture(projectPath, "codex", "1.16.0", [
        { path: "AGENTS.md", expectedSha256: OLD_EXPECTED_HASH },
      ]);
      mkdirSync(
        `${managedInstallStatePath(projectPath, "claude")}.tmp-${process.pid}`,
      );

      assert.throws(() => prepareManagedInstallStateForApply(projectPath));

      const facade = readManagedInstallStateFacade(projectPath);
      assert.equal(facade.status, "loaded");
      assert.equal(facade.source, "v2");
      assert.deepEqual(facade.state?.receipts, []);
      assert.match(
        readFileSync(managedInstallStatePath(projectPath, "codex"), "utf-8"),
        /goat-flow\.install-state\.v1/u,
      );
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  for (const conflict of [
    {
      name: "equal ranked versions disagree",
      leftVersion: "1.16.0",
      rightVersion: "1.16.0",
    },
    {
      name: "equal numeric precedence versions disagree",
      leftVersion: "1.016.0",
      rightVersion: "1.16.0",
    },
    {
      name: "unrankable versions disagree",
      leftVersion: "release-blue",
      rightVersion: "release-green",
    },
  ]) {
    it(`blocks a global legacy bootstrap when ${conflict.name}`, () => {
      const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-v2-conflict-"));
      try {
        writeLegacyStateFixture(projectPath, "codex", conflict.leftVersion, [
          { path: "AGENTS.md", expectedSha256: OLD_EXPECTED_HASH },
        ]);
        writeLegacyStateFixture(
          projectPath,
          "antigravity",
          conflict.rightVersion,
          [{ path: "AGENTS.md", expectedSha256: CURRENT_FILE_HASH }],
        );

        const result = readManagedInstallStateFacade(projectPath);
        assert.equal(result.status, "conflicting");
        assert.equal(result.state, null);
        assert.deepEqual([...result.expectedHashes], []);
      } finally {
        rmSync(projectPath, { recursive: true, force: true });
      }
    });
  }

  it("blocks a bootstrap when an unselected legacy file is malformed", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-v2-malformed-"));
    try {
      writeLegacyStateFixture(projectPath, "codex", "1.16.0", []);
      mkdirSync(join(projectPath, ".goat-flow", "install-state"), {
        recursive: true,
      });
      writeFileSync(
        managedInstallStatePath(projectPath, "antigravity"),
        "not json\n",
      );

      const result = readManagedInstallStateFacade(projectPath);
      assert.equal(result.status, "malformed-blocking");
      assert.equal(result.state, null);
      assert.doesNotMatch(result.error ?? "", new RegExp(projectPath, "u"));
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: persist one valid row beside missing-row and mismatched-generation receipt references.
   * Side effects: atomically writes managed.json inside a disposable project.
   * Invariant: stale evidence cannot invalidate or replace the row's authoritative hash.
   */
  it("writes canonical v2 bytes and classifies missing or mismatched receipt rows as stale", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-v2-state-"));
    const row = createManagedInstallStateRow({
      path: ".goat-flow/hooks/run-with-bash.mjs",
      expectedSha256: NEW_EXPECTED_HASH,
      provenance: {
        kind: "verified-install",
        goatFlowVersion: "1.16.0",
      },
    });
    const state: ManagedInstallStateV2 = {
      schemaVersion: "goat-flow.install-state.v2",
      files: [row],
      receipts: [
        {
          agent: "claude",
          goatFlowVersion: "1.16.0",
          files: [
            {
              path: ".claude/skills/goat/SKILL.md",
              generation: OLD_EXPECTED_HASH,
            },
          ],
        },
        {
          agent: "codex",
          goatFlowVersion: "1.16.0",
          files: [{ path: row.path, generation: OLD_EXPECTED_HASH }],
        },
      ],
    };
    try {
      writeManagedInstallStateV2(projectPath, state);
      const serializedState = readFileSync(
        managedInstallStateV2Path(projectPath),
        "utf-8",
      );
      assert.equal(serializedState, canonicalManagedInstallStateBytes(state));

      const result = readManagedInstallStateFacade(projectPath);
      assert.equal(result.status, "loaded");
      assert.equal(result.source, "v2");
      assert.deepEqual(result.staleReceiptAgents, ["claude", "codex"]);
      assert.equal(result.expectedHashes.get(row.path), NEW_EXPECTED_HASH);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("derives identical row generations from equivalent legacy observations", () => {
    const first = createManagedInstallStateRow({
      path: ".agents/skills/goat/SKILL.md",
      expectedSha256: OLD_EXPECTED_HASH,
      provenance: {
        kind: "legacy-v1-bootstrap",
        observations: [
          { agent: "codex", goatFlowVersion: "1.16.0" },
          { agent: "antigravity", goatFlowVersion: "1.15.1" },
        ],
      },
    });
    const second = createManagedInstallStateRow({
      path: first.path,
      expectedSha256: first.expectedSha256,
      provenance: {
        kind: "legacy-v1-bootstrap",
        observations: [
          { agent: "antigravity", goatFlowVersion: "1.15.1" },
          { agent: "codex", goatFlowVersion: "1.16.0" },
        ],
      },
    });

    assert.deepEqual(first, second);
    assert.equal(
      first.generation,
      "4908c2bc1fae9aade34927d55d8b01a76437d4467f8a5b7a1311ee805192799d",
    );
  });

  const validV2Row = createManagedInstallStateRow({
    path: "AGENTS.md",
    expectedSha256: OLD_EXPECTED_HASH,
    provenance: {
      kind: "verified-install",
      goatFlowVersion: "1.16.0",
    },
  });
  const invalidV2StateFixtures: Array<{ name: string; state: unknown }> = [
    {
      name: "duplicate path rows",
      state: {
        schemaVersion: "goat-flow.install-state.v2",
        files: [validV2Row, validV2Row],
        receipts: [],
      },
    },
    {
      name: "unsafe row paths",
      state: {
        schemaVersion: "goat-flow.install-state.v2",
        files: [{ ...validV2Row, path: "../AGENTS.md" }],
        receipts: [],
      },
    },
    {
      name: "invalid expected hashes",
      state: {
        schemaVersion: "goat-flow.install-state.v2",
        files: [{ ...validV2Row, expectedSha256: "invalid" }],
        receipts: [],
      },
    },
    {
      name: "row generations that do not match row identity",
      state: {
        schemaVersion: "goat-flow.install-state.v2",
        files: [{ ...validV2Row, generation: NEW_EXPECTED_HASH }],
        receipts: [],
      },
    },
    {
      name: "invalid provenance",
      state: {
        schemaVersion: "goat-flow.install-state.v2",
        files: [
          {
            ...validV2Row,
            provenance: { kind: "verified-install", goatFlowVersion: "" },
          },
        ],
        receipts: [],
      },
    },
    {
      name: "unsafe receipt paths",
      state: {
        schemaVersion: "goat-flow.install-state.v2",
        files: [validV2Row],
        receipts: [
          {
            agent: "codex",
            goatFlowVersion: "1.16.0",
            files: [
              {
                path: "../AGENTS.md",
                generation: validV2Row.generation,
              },
            ],
          },
        ],
      },
    },
    {
      name: "terminal controls in receipt versions",
      state: {
        schemaVersion: "goat-flow.install-state.v2",
        files: [validV2Row],
        receipts: [
          {
            agent: "codex",
            goatFlowVersion: "1.16.0\u001b[2J",
            files: [],
          },
        ],
      },
    },
  ];

  // Each table row protects one schema boundary and reports its own fixture name on failure.
  for (const fixture of invalidV2StateFixtures) {
    it(`blocks ${fixture.name} in v2 state`, () => {
      const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-v2-invalid-"));
      try {
        mkdirSync(join(projectPath, ".goat-flow", "install-state"), {
          recursive: true,
        });
        writeFileSync(
          managedInstallStateV2Path(projectPath),
          `${JSON.stringify(fixture.state, null, 2)}\n`,
        );
        assert.equal(
          readManagedInstallStateFacade(projectPath).status,
          "malformed-blocking",
        );
      } finally {
        rmSync(projectPath, { recursive: true, force: true });
      }
    });
  }

  /**
   * Fixture purpose: prove byte-level canonicality independently from logical schema validity.
   * Filesystem side effects: writes one non-canonical managed.json in a disposable project.
   * Invariant: equivalent parsed fields cannot authorize replacement under different bytes.
   */
  it("blocks non-canonical v2 bytes", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-v2-invalid-"));
    try {
      mkdirSync(join(projectPath, ".goat-flow", "install-state"), {
        recursive: true,
      });
      writeFileSync(
        managedInstallStateV2Path(projectPath),
        JSON.stringify({
          schemaVersion: "goat-flow.install-state.v2",
          files: [validV2Row],
          receipts: [],
        }),
      );
      assert.equal(
        readManagedInstallStateFacade(projectPath).status,
        "malformed-blocking",
        "valid logical state with non-canonical bytes must not authorize writes",
      );
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});

/** Writes one target-controlled baseline body for invalid-state preview tests. */
function writeInvalidStateFixture(
  projectPath: string,
  serializedState: string,
): void {
  const statePath = managedInstallStatePath(projectPath, "codex");
  mkdirSync(join(projectPath, ".goat-flow", "install-state"), {
    recursive: true,
  });
  writeFileSync(statePath, serializedState, "utf-8");
}

describe("invalid managed install state", () => {
  const invalidStateFixtures = [
    {
      name: "malformed JSON",
      body: "super-secret-invalid-json",
      expectedLimit: "Legacy install state for codex is not valid JSON.",
    },
    {
      name: "wrong schema",
      body: JSON.stringify({
        schemaVersion: "wrong",
        agent: "codex",
        goatFlowVersion: "1.13.1",
        files: [],
      }),
      expectedLimit:
        "Legacy install state schema for codex must be goat-flow.install-state.v1.",
    },
    {
      name: "agent mismatch",
      body: JSON.stringify({
        schemaVersion: "goat-flow.install-state.v1",
        agent: "claude",
        goatFlowVersion: "1.13.1",
        files: [],
      }),
      expectedLimit: "Legacy install state agent must be codex.",
    },
    {
      name: "unsafe path",
      body: JSON.stringify({
        schemaVersion: "goat-flow.install-state.v1",
        agent: "codex",
        goatFlowVersion: "1.13.1",
        files: [{ path: "../secret", expectedSha256: OLD_EXPECTED_HASH }],
      }),
      expectedLimit:
        "Install state paths must be safe repository-relative paths.",
    },
    {
      name: "duplicate path",
      body: JSON.stringify({
        schemaVersion: "goat-flow.install-state.v1",
        agent: "codex",
        goatFlowVersion: "1.13.1",
        files: [
          { path: "AGENTS.md", expectedSha256: OLD_EXPECTED_HASH },
          { path: "AGENTS.md", expectedSha256: CURRENT_FILE_HASH },
        ],
      }),
      expectedLimit:
        "Legacy install state for codex contains duplicate path AGENTS.md.",
    },
  ];

  // Each corrupt baseline must block without leaking its raw body into the report.
  for (const fixture of invalidStateFixtures) {
    // Writes only a disposable baseline file, then removes the fixture after the read-only preview.
    it(`blocks ${fixture.name}`, () => {
      const projectPath = mkdtempSync(
        join(tmpdir(), "goat-flow-invalid-state-"),
      );
      try {
        writeInvalidStateFixture(projectPath, fixture.body);
        const preview = buildManagedSetupPreview(projectPath, "codex");
        assert.equal(preview.baselineStatus, "malformed-blocking");
        assert.equal(preview.verdict, "blocked");
        assert.equal(
          preview.limits.some((limit) => limit.includes(fixture.expectedLimit)),
          true,
        );
        assert.doesNotMatch(
          JSON.stringify(preview),
          /super-secret-invalid-json/u,
        );
        assert.doesNotMatch(
          JSON.stringify(preview),
          new RegExp(projectPath, "u"),
        );
      } finally {
        rmSync(projectPath, { recursive: true, force: true });
      }
    });
  }

  /** This fixture writes a managed symlink whose matching destination bytes must not authorize overwrite. */
  it("treats a managed target symlink as unmanaged instead of hashing its destination", () => {
    const projectPath = mkdtempSync(
      join(tmpdir(), "goat-flow-target-symlink-"),
    );
    const managedDirectory = join(projectPath, ".goat-flow", "logs", "quality");
    const managedPath = join(managedDirectory, "README.md");
    try {
      // The symlink points at the real template, proving byte equality cannot hide a non-regular target.
      mkdirSync(managedDirectory, { recursive: true });
      symlinkSync(
        getTemplatePath("workflow/setup/reference/quality-readme.md"),
        managedPath,
      );
      const preview = buildManagedSetupPreview(projectPath, "codex");
      const managedFile = preview.files.find(
        (file) => file.path === ".goat-flow/logs/quality/README.md",
      );
      assert.equal(managedFile?.state, "unmanaged");
      assert.equal(managedFile?.currentStatus, "non-regular");
      assert.match(managedFile?.reason ?? "", /symlink or non-regular/u);
      assert.equal(preview.verdict, "blocked");
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
