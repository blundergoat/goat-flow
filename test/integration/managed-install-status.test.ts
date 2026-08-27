/**
 * Exercise the managed-install evidence shown by the real status command.
 *
 * These fixtures keep text and JSON on one vocabulary so stale or ambiguous
 * local state can never silently select an installed agent.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createManagedInstallStateRow,
  managedInstallStateV2Path,
  readManagedInstallStateFacade,
  writeManagedInstallStateV2,
} from "../../src/cli/managed-setup-state.js";
import {
  PROJECT_ROOT,
  makeTempProject,
  runCliInstaller,
} from "./setup-install.helpers.js";

const CLI_ENTRY = join(PROJECT_ROOT, "src", "cli", "cli.ts");
const ORPHAN_PATH = ".goat-flow/retired-orphan.md";
const SHARED_PATH = "AGENTS.md";

type EvidenceStatus =
  | "confirmed"
  | "stale"
  | "legacy-unconfirmed"
  | "malformed-blocking"
  | "conflicting"
  | "cutover-incompatible"
  | "orphan";

/** Public evidence-entry fields asserted through the status process boundary. */
interface EvidenceEntry {
  status: EvidenceStatus;
  subjects: {
    agents: string[];
    paths: string[];
  };
  canSelectInstalledAgent: boolean;
  reason: string;
  recovery: string | null;
}

/** Minimal public status JSON envelope required by this process contract. */
interface StatusJson {
  managedInstallEvidence?: {
    schemaVersion: "goat-flow.managed-install-evidence.v1";
    baselineStatus: string;
    entries: EvidenceEntry[];
  };
}

/** Side effect: spawns status through the public TypeScript CLI entry point and captures its process result. */
function runStatus(projectPath: string, format: "json" | "text") {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, "status", projectPath, "--format", format],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    },
  );
}

/** Parse status JSON and require the managed evidence envelope. */
function readEvidence(
  projectPath: string,
): StatusJson["managedInstallEvidence"] {
  const result = runStatus(projectPath, "json");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as StatusJson;
  assert.ok(
    report.managedInstallEvidence,
    `managed evidence missing from ${result.stdout}`,
  );
  return report.managedInstallEvidence;
}

/** Find the sole entry with one status, failing with the complete report when absent. */
function evidenceEntry(
  report: NonNullable<StatusJson["managedInstallEvidence"]>,
  status: EvidenceStatus,
): EvidenceEntry {
  const entries = report.entries.filter((entry) => entry.status === status);
  assert.equal(
    entries.length,
    1,
    `expected one ${status} entry, got ${JSON.stringify(report, null, 2)}`,
  );
  return entries[0]!;
}

/** Install one verified Codex fixture and require its receipt publication. */
function installedCodexProject(): string {
  const projectPath = makeTempProject();
  const install = runCliInstaller(projectPath, "--agent", "codex");
  assert.equal(install.status, 0, install.stderr || install.stdout);
  const facade = readManagedInstallStateFacade(projectPath);
  assert.equal(facade.source, "v2");
  assert.ok(
    facade.state?.receipts.some((receipt) => receipt.agent === "codex"),
    "public install must publish a Codex receipt",
  );
  return projectPath;
}

/**
 * Write one canonical v1 baseline without running the v2 public lifecycle.
 * Side effect: creates the fixture's install-state directory and writes its agent JSON file.
 * Invariant: the fixture contains one known-agent observation for the shared managed path.
 */
function writeLegacyState(
  projectPath: string,
  agent: "antigravity" | "codex",
  expectedSha256: string,
): void {
  const stateDirectory = join(projectPath, ".goat-flow", "install-state");
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(
    join(stateDirectory, `${agent}.json`),
    `${JSON.stringify(
      {
        schemaVersion: "goat-flow.install-state.v1",
        agent,
        goatFlowVersion: "1.16.0",
        files: [{ path: SHARED_PATH, expectedSha256 }],
      },
      null,
      2,
    )}\n`,
  );
}

describe("managed install status evidence", () => {
  it("renders confirmed and orphan evidence in JSON and text", () => {
    const projectPath = installedCodexProject();
    const facade = readManagedInstallStateFacade(projectPath);
    assert.ok(facade.state);
    const orphan = createManagedInstallStateRow({
      path: ORPHAN_PATH,
      expectedSha256: "f".repeat(64),
      provenance: {
        kind: "verified-install",
        goatFlowVersion: "1.16.0",
      },
    });
    const files = [...facade.state.files, orphan].sort((left, right) =>
      Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
    );
    writeManagedInstallStateV2(projectPath, { ...facade.state, files });

    const report = readEvidence(projectPath);
    assert.equal(report.schemaVersion, "goat-flow.managed-install-evidence.v1");
    assert.equal(report.baselineStatus, "loaded");

    const confirmed = evidenceEntry(report, "confirmed");
    assert.deepEqual(confirmed.subjects.agents, ["codex"]);
    assert.deepEqual(confirmed.subjects.paths, []);
    assert.equal(confirmed.canSelectInstalledAgent, true);
    assert.equal(confirmed.recovery, null);

    const orphanEntry = evidenceEntry(report, "orphan");
    assert.deepEqual(orphanEntry.subjects.agents, []);
    assert.deepEqual(orphanEntry.subjects.paths, [ORPHAN_PATH]);
    assert.equal(orphanEntry.canSelectInstalledAgent, false);
    assert.match(orphanEntry.reason, /no .*installed-agent.*authority/iu);
    assert.match(orphanEntry.recovery ?? "", /explicit cleanup contract/iu);
    assert.doesNotMatch(orphanEntry.recovery ?? "", /run:.*--force/iu);

    const text = runStatus(projectPath, "text");
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /Managed install evidence:/u);
    assert.match(text.stdout, /confirmed.*agent=codex/iu);
    assert.match(text.stdout, new RegExp(`orphan.*path=${ORPHAN_PATH}`, "iu"));
    assert.match(text.stdout, /can-select-installed-agent=(?:yes|no)/u);
  });

  it("reports stale receipts and incompatible cutover markers separately", () => {
    const projectPath = installedCodexProject();
    const managedPath = ".agents/skills/goat/SKILL.md";
    writeFileSync(
      join(projectPath, managedPath),
      `${readFileSync(join(projectPath, managedPath), "utf-8")}\nlocal edit\n`,
    );
    writeFileSync(
      join(projectPath, ".goat-flow", "install-state", "codex.json"),
      "replaced by a v1-only writer\n",
    );

    const report = readEvidence(projectPath);
    assert.equal(report.baselineStatus, "cutover-incompatible");

    const stale = evidenceEntry(report, "stale");
    assert.deepEqual(stale.subjects.agents, ["codex"]);
    assert.ok(stale.subjects.paths.includes(managedPath));
    assert.equal(stale.canSelectInstalledAgent, false);
    assert.match(stale.reason, /target bytes|cutover marker/iu);
    assert.match(stale.recovery ?? "", /goat-flow install .* --agent codex/u);
    assert.doesNotMatch(stale.recovery ?? "", /run:.*--force/iu);

    const cutover = evidenceEntry(report, "cutover-incompatible");
    assert.deepEqual(cutover.subjects.agents, ["codex"]);
    assert.deepEqual(cutover.subjects.paths, [
      ".goat-flow/install-state/codex.json",
    ]);
    assert.equal(cutover.canSelectInstalledAgent, false);
    assert.match(cutover.reason, /cannot select .*installed agent/iu);
    assert.match(cutover.recovery ?? "", /goat-flow install .* --agent codex/u);
    assert.doesNotMatch(cutover.recovery ?? "", /run:.*--force/iu);
  });

  it("reports valid v1 evidence as legacy-unconfirmed", () => {
    const projectPath = makeTempProject();
    writeLegacyState(projectPath, "codex", "a".repeat(64));

    const report = readEvidence(projectPath);
    const legacy = evidenceEntry(report, "legacy-unconfirmed");
    assert.deepEqual(legacy.subjects.agents, ["codex"]);
    assert.deepEqual(legacy.subjects.paths, [SHARED_PATH]);
    assert.equal(legacy.canSelectInstalledAgent, false);
    assert.match(legacy.reason, /no v2 receipt.*current.*target bytes/iu);
    assert.match(legacy.recovery ?? "", /goat-flow install .* --agent codex/u);
    assert.doesNotMatch(legacy.recovery ?? "", /run:.*--force/iu);
  });

  it("identifies the malformed legacy agent and evidence path", () => {
    const projectPath = makeTempProject();
    const evidencePath = ".goat-flow/install-state/antigravity.json";
    mkdirSync(join(projectPath, ".goat-flow", "install-state"), {
      recursive: true,
    });
    writeFileSync(join(projectPath, evidencePath), "not json\n");

    const report = readEvidence(projectPath);
    assert.equal(report.baselineStatus, "malformed-blocking");
    const malformed = evidenceEntry(report, "malformed-blocking");
    assert.deepEqual(malformed.subjects.agents, ["antigravity"]);
    assert.deepEqual(malformed.subjects.paths, [evidencePath]);
    assert.equal(malformed.canSelectInstalledAgent, false);
    assert.match(malformed.reason, /blocks every agent/iu);
    assert.match(
      malformed.recovery ?? "",
      /goat-flow status .* --format json/u,
    );
    assert.doesNotMatch(malformed.recovery ?? "", /run:.*--force/iu);
  });

  it("identifies every agent and path in conflicting legacy evidence", () => {
    const projectPath = makeTempProject();
    writeLegacyState(projectPath, "antigravity", "a".repeat(64));
    writeLegacyState(projectPath, "codex", "b".repeat(64));

    const report = readEvidence(projectPath);
    assert.equal(report.baselineStatus, "conflicting");
    const conflicting = evidenceEntry(report, "conflicting");
    assert.deepEqual(conflicting.subjects.agents, ["antigravity", "codex"]);
    assert.deepEqual(conflicting.subjects.paths, [SHARED_PATH]);
    assert.equal(conflicting.canSelectInstalledAgent, false);
    assert.match(conflicting.reason, /cannot select .*installed agent/iu);
    assert.match(conflicting.recovery ?? "", /one verified historical hash/iu);
    assert.match(
      conflicting.recovery ?? "",
      /goat-flow status .* --format json/u,
    );
    assert.doesNotMatch(conflicting.recovery ?? "", /run:.*--force/iu);
  });

  it("keeps malformed v2 evidence scoped to the authoritative state path", () => {
    const projectPath = makeTempProject();
    const evidencePath = ".goat-flow/install-state/managed.json";
    mkdirSync(join(projectPath, ".goat-flow", "install-state"), {
      recursive: true,
    });
    writeFileSync(managedInstallStateV2Path(projectPath), "not json\n");

    const report = readEvidence(projectPath);
    const malformed = evidenceEntry(report, "malformed-blocking");
    assert.deepEqual(malformed.subjects.agents, []);
    assert.deepEqual(malformed.subjects.paths, [evidencePath]);
    assert.match(malformed.reason, /not valid JSON/iu);
  });
});
