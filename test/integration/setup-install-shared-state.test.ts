/**
 * Public-process contract for one path-keyed managed install baseline.
 *
 * The decision rows keep migration edge cases visible beside the fixtures that
 * reproduce selected-agent drift and concurrent installation. Hook files are
 * copied and compared as inert bytes; this suite never executes hook payloads.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";

import {
  PROJECT_ROOT,
  makeTempProject,
  recordStaleBaselineHashes,
  runCliInstaller,
} from "./setup-install.helpers.js";

const SHARED_HOOK_PATH = ".goat-flow/hooks/run-with-bash.mjs";
const SHARED_SKILL_PATH = ".agents/skills/goat/SKILL.md";
const CLAUDE_SKILL_PATH = ".claude/skills/goat/SKILL.md";
const MANAGED_STATE_PATH = ".goat-flow/install-state/managed.json";

/** One stable outcome the shared-state design must preserve. */
interface DecisionRow {
  id: string;
  evidence: "reported" | "contract";
  outcome: string;
}

/**
 * Decision table used to derive ADR-064. `reported` rows come from the
 * 1.15.1-to-1.16.0 consumer report; `contract` rows are labelled design cases,
 * not claims that the current implementation already exhibits the outcome.
 */
const SHARED_STATE_DECISIONS: readonly DecisionRow[] = [
  {
    id: "observed-pristine-shared-hook",
    evidence: "reported",
    outcome:
      "Use the one path row selected by global migration; an agent-local stale hash cannot create both-changed.",
  },
  {
    id: "observed-locally-patched-hook",
    evidence: "reported",
    outcome:
      "Keep the patch as local-preserved when the canonical row still names the incoming template bytes.",
  },
  {
    id: "shared-agent-skill",
    evidence: "contract",
    outcome:
      "Store one .agents/skills path row and let both Codex and Antigravity receipts reference its generation.",
  },
  {
    id: "unique-agent-path",
    evidence: "contract",
    outcome:
      "Retain the unique .claude/skills path row when another agent installs; only Claude's receipt references it.",
  },
  {
    id: "reverse-agent-order",
    evidence: "contract",
    outcome:
      "Antigravity-then-Claude and Claude-then-Antigravity serialize identical managed state.",
  },
  {
    id: "equal-version-disagreement",
    evidence: "contract",
    outcome:
      "Block the global bootstrap when equal-precedence legacy versions give one path different hashes.",
  },
  {
    id: "unrankable-version-disagreement",
    evidence: "contract",
    outcome:
      "Block the global bootstrap when disagreeing hashes cannot be ordered by semantic version.",
  },
  {
    id: "selected-malformed-v1",
    evidence: "contract",
    outcome:
      "Report malformed-blocking and refuse bootstrap for every selected agent.",
  },
  {
    id: "unselected-malformed-v1",
    evidence: "contract",
    outcome:
      "Report the same malformed-blocking refusal; selection never hides a known legacy file.",
  },
  {
    id: "receipt-invalidation",
    evidence: "contract",
    outcome:
      "A package, path-set, missing-row, or referenced-generation change makes the hashless receipt stale.",
  },
  {
    id: "concurrent-public-installs",
    evidence: "contract",
    outcome:
      "Exactly one process mutates; the contender fails before its first target write and never waits or steals.",
  },
] as const;

/** One path classification from the public JSON preview. */
interface PreviewRow {
  path: string;
  state: string;
}

/** Public preview fields consumed by the cross-agent assertions. */
interface PreviewReport {
  verdict: string;
  baselineStatus: string;
  files: PreviewRow[];
}

/** One canonical v2 path/hash authority row. */
interface ManagedStateRow {
  path: string;
  expectedSha256: string;
  generation: string;
  provenance:
    | { kind: "verified-install"; goatFlowVersion: string }
    | {
        kind: "legacy-v1-bootstrap";
        observations: Array<{ agent: string; goatFlowVersion: string }>;
      };
}

/** One hashless agent receipt bound to canonical row generations. */
interface ManagedStateReceipt {
  agent: string;
  goatFlowVersion: string;
  files: Array<{ path: string; generation: string }>;
}

/**
 * Persisted v2 state shape exercised through public installs.
 * Invariant: one sorted row owns each path hash and receipts contain references only.
 */
interface ManagedStateV2 {
  schemaVersion: string;
  files: ManagedStateRow[];
  receipts: ManagedStateReceipt[];
}

/** Captured terminal result from one asynchronously running public install. */
interface AsyncInstallResult {
  agent: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Parse one public JSON preview and retain its subprocess diagnostics on failure. */
function preview(projectPath: string, agent: string): PreviewReport {
  const result = runCliInstaller(
    projectPath,
    "--agent",
    agent,
    "--dry-run",
    "--format",
    "json",
  );
  assert.ok(result.stdout, result.stderr);
  return JSON.parse(result.stdout) as PreviewReport;
}

/** Return one public preview row, failing with its project-relative path. */
function previewRow(report: PreviewReport, path: string): PreviewRow {
  const row = report.files.find((candidate) => candidate.path === path);
  assert.ok(row, `preview must list ${path}`);
  return row;
}

/**
 * Replace only version metadata in one valid legacy fixture.
 * Filesystem side effects: rewrites that disposable project's selected v1 state file.
 */
function setLegacyVersion(
  projectPath: string,
  agent: string,
  goatFlowVersion: string,
): void {
  const statePath = join(
    projectPath,
    ".goat-flow",
    "install-state",
    `${agent}.json`,
  );
  const state = JSON.parse(readFileSync(statePath, "utf-8")) as {
    goatFlowVersion: string;
  };
  state.goatFlowVersion = goatFlowVersion;
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

/** Install two legacy agents so migration cases start with real public state. */
function installedLegacyPair(): string {
  const projectPath = makeTempProject();
  for (const agent of ["codex", "antigravity"]) {
    const result = runCliInstaller(projectPath, "--agent", agent);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  return projectPath;
}

/** Read one canonical v2 state file after a public install. */
function readManagedState(projectPath: string): {
  bytes: string;
  state: ManagedStateV2;
} {
  const statePath = join(projectPath, MANAGED_STATE_PATH);
  assert.equal(
    existsSync(statePath),
    true,
    "public install must publish the project-wide managed-state file",
  );
  const bytes = readFileSync(statePath, "utf-8");
  return { bytes, state: JSON.parse(bytes) as ManagedStateV2 };
}

/**
 * Install the two public agents in one order and verify the final v2 shape.
 * Side effects: writes only inside a disposable project registered for teardown.
 * Invariant: shared and unique managed paths each have exactly one canonical row.
 */
function stateAfterInstallOrder(
  order: readonly ["antigravity" | "claude", "antigravity" | "claude"],
): string {
  const projectPath = makeTempProject();
  for (const agent of order) {
    const result = runCliInstaller(projectPath, "--agent", agent);
    assert.equal(
      result.status,
      0,
      `${order.join(" then ")}: ${result.stderr || result.stdout}`,
    );
  }

  const { bytes, state } = readManagedState(projectPath);
  assert.equal(state.schemaVersion, "goat-flow.install-state.v2");
  assert.equal(bytes, `${JSON.stringify(state, null, 2)}\n`);
  assert.deepEqual(
    state.files.map((row) => row.path),
    [...state.files.map((row) => row.path)].sort(),
  );
  assert.equal(
    new Set(state.files.map((row) => row.path)).size,
    state.files.length,
  );
  for (const requiredPath of [
    SHARED_HOOK_PATH,
    SHARED_SKILL_PATH,
    CLAUDE_SKILL_PATH,
  ]) {
    assert.equal(
      state.files.some((row) => row.path === requiredPath),
      true,
      `${requiredPath} must have exactly one project-wide row`,
    );
  }
  assert.deepEqual(
    state.receipts.map((receipt) => receipt.agent),
    ["antigravity", "claude"],
  );
  return bytes;
}

/** Hash the exact canonical row identity used by ADR-064 generations. */
function managedRowGeneration(row: ManagedStateRow): string {
  return createHash("sha256")
    .update("goat-flow.install-state.row-generation.v1\0")
    .update(row.path)
    .update("\0")
    .update(row.expectedSha256)
    .update("\0")
    .update(JSON.stringify(row.provenance))
    .digest("hex");
}

/**
 * Start the public TypeScript CLI without a shell and collect its output.
 * Side effects: spawns an install process that may write only to the supplied fixture.
 */
function runCliInstallerAsync(
  projectPath: string,
  agent: string,
  environment: NodeJS.ProcessEnv,
): Promise<AsyncInstallResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        join(PROJECT_ROOT, "src", "cli", "cli.ts"),
        "install",
        projectPath,
        "--agent",
        agent,
      ],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, ...environment },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => {
      resolve({ agent, status, stdout, stderr });
    });
  });
}

/**
 * Wait for one fixture marker without relying on an arbitrary fixed delay.
 * Error behavior: throws after the bounded timeout instead of hanging the suite.
 */
async function waitForPath(path: string, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for ${path}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("one baseline per managed path", () => {
  it("keeps every ADR-064 migration and lifecycle decision in the executable plan", () => {
    const requiredIds = [
      "observed-pristine-shared-hook",
      "observed-locally-patched-hook",
      "shared-agent-skill",
      "unique-agent-path",
      "reverse-agent-order",
      "equal-version-disagreement",
      "unrankable-version-disagreement",
      "selected-malformed-v1",
      "unselected-malformed-v1",
      "receipt-invalidation",
      "concurrent-public-installs",
    ];
    const actualIds = SHARED_STATE_DECISIONS.map((row) => row.id);

    assert.deepEqual(actualIds, requiredIds);
    assert.equal(new Set(actualIds).size, actualIds.length);
    assert.equal(
      SHARED_STATE_DECISIONS.every((row) => row.outcome.length > 0),
      true,
    );
  });

  /**
   * Fixture purpose: one current and one stale agent baseline describe the same
   * shared patched bytes, so selecting an agent must not change overwrite safety.
   * Filesystem side effects: installs and edits inert bytes in one disposable target.
   * Invariant: neither dry-run changes the patched hook or shared skill.
   */
  it("classifies a shared local patch independently of the selected agent", () => {
    const projectPath = installedLegacyPair();
    setLegacyVersion(projectPath, "antigravity", "1.15.1");
    recordStaleBaselineHashes(projectPath, "antigravity", [
      SHARED_HOOK_PATH,
      SHARED_SKILL_PATH,
    ]);

    const patchedHook = `${readFileSync(join(projectPath, SHARED_HOOK_PATH), "utf-8")}\n// project-local verified patch\n`;
    const patchedSkill = `${readFileSync(join(projectPath, SHARED_SKILL_PATH), "utf-8")}\nProject-local skill note.\n`;
    writeFileSync(join(projectPath, SHARED_HOOK_PATH), patchedHook);
    writeFileSync(join(projectPath, SHARED_SKILL_PATH), patchedSkill);

    const codex = preview(projectPath, "codex");
    const antigravity = preview(projectPath, "antigravity");
    assert.equal(previewRow(codex, SHARED_HOOK_PATH).state, "local-preserved");
    assert.equal(previewRow(codex, SHARED_SKILL_PATH).state, "local-preserved");
    assert.equal(
      previewRow(antigravity, SHARED_HOOK_PATH).state,
      "local-preserved",
    );
    assert.equal(
      previewRow(antigravity, SHARED_SKILL_PATH).state,
      "local-preserved",
    );
    assert.equal(codex.verdict, "ready");
    assert.equal(antigravity.verdict, "ready");
    assert.equal(
      readFileSync(join(projectPath, SHARED_HOOK_PATH), "utf-8"),
      patchedHook,
    );
    assert.equal(
      readFileSync(join(projectPath, SHARED_SKILL_PATH), "utf-8"),
      patchedSkill,
    );
  });

  it("serializes identical shared and unique rows in either agent order", () => {
    const antigravityThenClaude = stateAfterInstallOrder([
      "antigravity",
      "claude",
    ]);
    const claudeThenAntigravity = stateAfterInstallOrder([
      "claude",
      "antigravity",
    ]);
    assert.equal(antigravityThenClaude, claudeThenAntigravity);
  });

  for (const migrationCase of [
    {
      name: "equal-version disagreement",
      versions: ["1.16.0", "1.16.0"],
      status: "conflicting",
    },
    {
      name: "unrankable-version disagreement",
      versions: ["release-blue", "release-green"],
      status: "conflicting",
    },
  ] as const) {
    it(`blocks every selected agent on ${migrationCase.name}`, () => {
      const projectPath = installedLegacyPair();
      setLegacyVersion(projectPath, "codex", migrationCase.versions[0]);
      setLegacyVersion(projectPath, "antigravity", migrationCase.versions[1]);
      recordStaleBaselineHashes(projectPath, "antigravity", [SHARED_HOOK_PATH]);

      const codex = preview(projectPath, "codex");
      const antigravity = preview(projectPath, "antigravity");
      assert.equal(codex.baselineStatus, migrationCase.status);
      assert.equal(antigravity.baselineStatus, migrationCase.status);
      assert.equal(codex.verdict, "blocked");
      assert.equal(antigravity.verdict, "blocked");
    });
  }

  it("labels malformed selected legacy state as bootstrap-blocking", () => {
    const projectPath = installedLegacyPair();
    writeFileSync(
      join(projectPath, ".goat-flow", "install-state", "antigravity.json"),
      "not json\n",
    );

    const report = preview(projectPath, "antigravity");
    assert.equal(report.baselineStatus, "malformed-blocking");
    assert.equal(report.verdict, "blocked");
  });

  it("blocks on malformed legacy state when another agent is selected", () => {
    const projectPath = installedLegacyPair();
    writeFileSync(
      join(projectPath, ".goat-flow", "install-state", "antigravity.json"),
      "not json\n",
    );

    const report = preview(projectPath, "codex");
    assert.equal(report.baselineStatus, "malformed-blocking");
    assert.equal(report.verdict, "blocked");
  });

  it("marks a receipt stale when one referenced row generation changes", () => {
    const projectPath = makeTempProject();
    const install = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const { state } = readManagedState(projectPath);
    const hookRow = state.files.find((row) => row.path === SHARED_HOOK_PATH);
    assert.ok(hookRow, `managed state must include ${SHARED_HOOK_PATH}`);
    hookRow.provenance = {
      kind: "verified-install",
      goatFlowVersion: "1.16.1",
    };
    hookRow.generation = managedRowGeneration(hookRow);
    writeFileSync(
      join(projectPath, MANAGED_STATE_PATH),
      `${JSON.stringify(state, null, 2)}\n`,
    );

    const report = preview(projectPath, "codex");
    assert.equal(report.verdict, "ready");
    assert.match(JSON.stringify(report), /stale/u);
  });

  it(
    "lets one concurrent public install mutate and rejects the contender",
    {
      skip: process.platform === "win32" ? "POSIX Bash barrier fixture" : false,
    },
    async () => {
      const projectPath = makeTempProject();
      const fixtureDirectory = join(projectPath, ".public-install-barrier");
      const binaryDirectory = join(fixtureDirectory, "bin");
      const ownerPath = join(fixtureDirectory, "owner");
      const enteredPath = join(fixtureDirectory, "entered");
      const releasePath = join(fixtureDirectory, "release");
      mkdirSync(binaryDirectory, { recursive: true });

      const bashLookup = spawnSync("bash", ["-c", "command -v bash"], {
        encoding: "utf-8",
      });
      assert.equal(bashLookup.status, 0, bashLookup.stderr);
      const realBash = bashLookup.stdout.trim();
      assert.ok(realBash, "fixture requires the Bash executable path");
      const wrapperPath = join(binaryDirectory, "bash");
      writeFileSync(
        wrapperPath,
        [
          `#!${realBash}`,
          "set -euo pipefail",
          'if [[ "${1:-}" == */workflow/install-goat-flow.sh ]]; then',
          '  if (set -o noclobber; : > "$GOAT_FLOW_TEST_OWNER") 2>/dev/null; then',
          '    : > "$GOAT_FLOW_TEST_ENTERED"',
          '    while [[ ! -e "$GOAT_FLOW_TEST_RELEASE" ]]; do',
          "      sleep 0.02",
          "    done",
          "  fi",
          "fi",
          'exec "$GOAT_FLOW_TEST_REAL_BASH" "$@"',
          "",
        ].join("\n"),
      );
      chmodSync(wrapperPath, 0o755);
      const environment = {
        PATH: `${binaryDirectory}${delimiter}${process.env.PATH ?? ""}`,
        GOAT_FLOW_TEST_REAL_BASH: realBash,
        GOAT_FLOW_TEST_OWNER: ownerPath,
        GOAT_FLOW_TEST_ENTERED: enteredPath,
        GOAT_FLOW_TEST_RELEASE: releasePath,
      };

      const installs = (["claude", "antigravity"] as const).map(
        async (agent) =>
          await runCliInstallerAsync(projectPath, agent, environment),
      );
      try {
        await waitForPath(enteredPath);
        await Promise.race([
          installs[0],
          installs[1],
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "No concurrent installer reached a terminal result",
                  ),
                ),
              20_000,
            ),
          ),
        ]);
      } finally {
        writeFileSync(releasePath, "release\n");
      }
      const results = await Promise.all(installs);
      assert.deepEqual(
        results.map((result) => result.status).sort(),
        [0, 1],
        results.map((result) => `${result.agent}=${result.status}`).join(", "),
      );
      const loser = results.find((result) => result.status !== 0);
      assert.ok(loser, "one public install must lose claim contention");
      assert.match(
        loser.stderr,
        /managed install.*(?:busy|claim|another process)/iu,
      );
      const loserSkillPath =
        loser.agent === "claude" ? CLAUDE_SKILL_PATH : SHARED_SKILL_PATH;
      assert.equal(
        existsSync(join(projectPath, loserSkillPath)),
        false,
        "the contender must fail before its first agent-specific target write",
      );
    },
  );
});
