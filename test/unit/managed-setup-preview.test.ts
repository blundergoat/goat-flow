/**
 * Managed setup preview contract tests for the eight user-visible drift states.
 * These fixtures keep classification independent from filesystem setup so failures
 * tell users whether local edits, package changes, or missing baselines caused a block.
 * State serialization checks also ensure continuation data stays hash-only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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

import {
  buildManagedSetupPreview,
  classifyManagedSetupFile,
  managedInstallStatePath,
  writeManagedInstallState,
  type ManagedSetupFileState,
  type ManagedSetupPreview,
} from "../../src/cli/managed-setup-preview.js";
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
    name: "local-edited",
    oldExpectedSha256: OLD_EXPECTED_HASH,
    currentSha256: CURRENT_FILE_HASH,
    newExpectedSha256: OLD_EXPECTED_HASH,
    expectedState: "local-edited",
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
    name: "unmanaged",
    oldExpectedSha256: null,
    currentSha256: CURRENT_FILE_HASH,
    newExpectedSha256: NEW_EXPECTED_HASH,
    expectedState: "unmanaged",
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
});

describe("managed install state", () => {
  /** This fixture writes the stable schema and hash-only fingerprint baseline users receive after install. */
  it("writes only relative paths and hashes for the next user preview", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-preview-state-"));
    const preview: ManagedSetupPreview = {
      schemaVersion: "goat-flow.managed-setup-preview.v1",
      coverage: "managed-template-files",
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
      schemaVersion: "goat-flow.managed-setup-preview.v1",
      coverage: "managed-template-files",
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
      assert.equal(preview.baselineStatus, "invalid");
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

/** Write one target-controlled baseline body for invalid-state preview tests. */
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
      expectedLimit: "Install state is not valid JSON.",
    },
    {
      name: "wrong schema",
      body: JSON.stringify({
        schemaVersion: "wrong",
        agent: "codex",
        goatFlowVersion: "1.13.1",
        files: [],
      }),
      expectedLimit: "Install state schema must be goat-flow.install-state.v1.",
    },
    {
      name: "agent mismatch",
      body: JSON.stringify({
        schemaVersion: "goat-flow.install-state.v1",
        agent: "claude",
        goatFlowVersion: "1.13.1",
        files: [],
      }),
      expectedLimit: "Install state agent must be codex.",
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
      expectedLimit: "Install state contains duplicate path AGENTS.md.",
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
        assert.equal(preview.baselineStatus, "invalid");
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
