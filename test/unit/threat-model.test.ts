/**
 * Protects the static agent/tool threat artifact reviewers attach to PRs or releases.
 * Use these fixtures when threat surfaces, evidence labels, verdicts, or CLI rendering change.
 * The suite proves report construction only; it never executes a target hook or external agent.
 */
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildAgentEnforcementCapability } from "../../src/cli/audit/enforcement.js";
import {
  buildThreatModelReport,
  collectThreatModelReport,
  renderThreatModelJson,
  renderThreatModelText,
} from "../../src/cli/diagnostics/threat-model.js";
import type { AgentFacts, AgentId } from "../../src/cli/types.js";
import { stubAgentFacts } from "../fixtures/projects/index.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");

/** Build one threat report from the same static enforcement facts the audit shows users. */
function threatReportFor(agentFacts: AgentFacts) {
  return buildThreatModelReport({
    projectPath: "/fixture",
    agentFacts: [agentFacts],
    enforcement: [
      buildAgentEnforcementCapability(agentFacts, {
        denyMechanismEvidenceLevel: "present-only",
      }),
    ],
  });
}

/** Return one named surface so fixture failures identify the user-visible posture that drifted. */
function threatSurface(
  report: ReturnType<typeof threatReportFor>,
  surfaceId: string,
) {
  const surface = report.agents[0]?.surfaces.find(
    (candidate) => candidate.id === surfaceId,
  );
  assert.ok(surface, `expected ${surfaceId} threat surface`);
  return surface;
}

/** Spawns the public command so parsing, collection, rendering, and stdout stay integrated. */
function runThreatModelCommand(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, "diagnostics", "threat-model", ...args],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
}

describe("agent tool threat model", () => {
  // A configured deny setup shows observed restrictions without inventing unmeasured network or logging safety.
  it("classifies restricted and unknown surfaces from existing local facts", () => {
    const baseAgentFacts = stubAgentFacts();
    const configuredAgentFacts = stubAgentFacts({
      hooks: {
        ...baseAgentFacts.hooks,
        denyBlocksPipeToShell: true,
      },
      // The split hook fact is canonical even when the legacy direct-text deny summary is false.
      deny: { gitCommitBlocked: false, gitPushBlocked: false },
    });
    const report = threatReportFor(configuredAgentFacts);

    assert.equal(threatSurface(report, "shell").status, "restricted");
    assert.equal(threatSurface(report, "push").status, "restricted");
    assert.equal(threatSurface(report, "secret-path").status, "restricted");
    assert.equal(threatSurface(report, "network").status, "unknown");
    assert.equal(threatSurface(report, "file-write").status, "unknown");
    assert.equal(threatSurface(report, "audit-log").status, "unknown");
    assert.equal(report.agents[0]?.verdict, "evidence-incomplete");
  });

  // A present agent with no usable deny hook is a permissive posture, not an unknown or passing setup.
  it("classifies missing and permissive hook fixtures as attention required", () => {
    const baseAgentFacts = stubAgentFacts();
    const permissiveAgentFacts = stubAgentFacts({
      hooks: {
        ...baseAgentFacts.hooks,
        denyExists: false,
        denyHasBlocks: false,
        denyBlocksRmRf: false,
        denyBlocksGitPush: false,
        denyBlocksChmod: false,
        denyBlocksPipeToShell: false,
        denyIsRegistered: false,
        readDenyCoversSecrets: false,
        bashDenyCoversSecrets: false,
      },
      deny: { gitCommitBlocked: false, gitPushBlocked: false },
    });
    const report = threatReportFor(permissiveAgentFacts);

    assert.equal(threatSurface(report, "shell").status, "permissive");
    assert.equal(threatSurface(report, "push").status, "permissive");
    assert.equal(threatSurface(report, "secret-path").status, "permissive");
    assert.equal(report.agents[0]?.verdict, "attention-required");
  });

  // This fixture covers a selected agent whose local setup was never installed.
  it("marks an agent with no local setup surfaces as not configured", () => {
    const baseAgentFacts = stubAgentFacts();
    const absentAgentFacts = stubAgentFacts({
      instruction: {
        exists: false,
        content: null,
        lineCount: 0,
        sections: new Map(),
      },
      settings: {
        exists: false,
        valid: true,
        parsed: null,
        hasDenyPatterns: false,
      },
      skills: {
        ...baseAgentFacts.skills,
        installedDirs: [],
        found: [],
        missing: [],
        hasDispatcher: false,
      },
      hooks: {
        ...baseAgentFacts.hooks,
        denyExists: false,
        denyIsRegistered: false,
      },
    });
    const report = threatReportFor(absentAgentFacts);

    assert.equal(report.agents[0]?.isConfigured, false);
    assert.equal(report.agents[0]?.verdict, "not-configured");
    assert.deepEqual(
      report.agents[0]?.surfaces.map((surface) => surface.status),
      Array.from({ length: 6 }, () => "not-configured"),
    );
  });

  // An unrecognised runtime cannot inherit protection from a supported agent's manifest profile.
  it("marks unsupported local enforcement surfaces without treating them as safe", () => {
    const baseAgentFacts = stubAgentFacts();
    const unsupportedAgentFacts = stubAgentFacts({
      agent: {
        ...baseAgentFacts.agent,
        id: "custom-agent" as AgentId,
        name: "Custom Agent",
        denyMechanism: null,
        denyHookFile: null,
        hookEvents: null,
      },
      hooks: {
        ...baseAgentFacts.hooks,
        denyExists: false,
        denyIsRegistered: false,
      },
      deny: { gitCommitBlocked: false, gitPushBlocked: false },
    });
    const report = threatReportFor(unsupportedAgentFacts);

    assert.equal(threatSurface(report, "shell").status, "unsupported");
    assert.equal(threatSurface(report, "push").status, "unsupported");
    assert.equal(threatSurface(report, "secret-path").status, "unsupported");
    assert.equal(report.agents[0]?.verdict, "evidence-incomplete");
  });

  // Structured and text renderers retain evidence anchors while omitting raw settings values.
  it("renders stable evidence without reading or printing secret contents", () => {
    const fakeCredential = ["threat", "fixture", "credential"].join("-");
    const baseAgentFacts = stubAgentFacts();
    const report = threatReportFor(
      stubAgentFacts({
        hooks: {
          ...baseAgentFacts.hooks,
          denyBlocksPipeToShell: true,
        },
        deny: { gitCommitBlocked: true, gitPushBlocked: true },
        settings: {
          ...baseAgentFacts.settings,
          parsed: { credential: fakeCredential },
        },
      }),
    );
    const json = renderThreatModelJson(report);
    const text = renderThreatModelText(report);

    assert.equal(JSON.parse(json).schema, "goat-flow.threat-model.v1");
    assert.doesNotMatch(json, new RegExp(fakeCredential, "u"));
    assert.match(json, /workflow\/manifest\.json/iu);
    assert.match(text, /Static posture only/iu);
    assert.match(text, /evidence-incomplete/iu);
  });

  // Writes a disposable filesystem fixture whose executable-looking project files must stay inert.
  it("does not execute target scripts or hooks while collecting posture", () => {
    const targetRoot = mkdtempSync(join(tmpdir(), "goat-flow-threat-model-"));
    const executionMarker = join(targetRoot, "target-code-executed");
    const denyHookDirectory = join(targetRoot, ".goat-flow", "hooks");
    // A user may inspect a project whose test script and deny hook can both change local files.
    mkdirSync(denyHookDirectory, { recursive: true });
    writeFileSync(
      join(targetRoot, "AGENTS.md"),
      "# Fixture agent instructions\n",
      "utf-8",
    );
    writeFileSync(
      join(targetRoot, "package.json"),
      JSON.stringify({ scripts: { test: `touch ${executionMarker}` } }),
      "utf-8",
    );
    writeFileSync(
      join(denyHookDirectory, "deny-dangerous.sh"),
      `#!/usr/bin/env bash\ntouch ${executionMarker}\n`,
      "utf-8",
    );

    try {
      const report = collectThreatModelReport(targetRoot, "codex");

      assert.equal(existsSync(executionMarker), false);
      assert.equal(report.execution.targetCodeExecuted, false);
      assert.equal(report.execution.targetHooksExecuted, false);
      assert.equal(report.execution.projectCommandsExecuted, false);
      assert.equal(report.execution.secretContentsRead, false);
    } finally {
      rmSync(targetRoot, { recursive: true, force: true });
    }
  });

  // The real command returns machine-readable static posture without running target hooks.
  it("emits clean JSON through the diagnostics CLI", () => {
    const result = runThreatModelCommand(
      ".",
      "--agent",
      "codex",
      "--format",
      "json",
    );
    const parsed = JSON.parse(result.stdout) as {
      schema: string;
      execution: {
        targetCodeExecuted: boolean;
        targetHooksExecuted: boolean;
        projectCommandsExecuted: boolean;
        secretContentsRead: boolean;
      };
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(parsed.schema, "goat-flow.threat-model.v1");
    assert.equal(parsed.execution.targetCodeExecuted, false);
    assert.equal(parsed.execution.targetHooksExecuted, false);
    assert.equal(parsed.execution.projectCommandsExecuted, false);
    assert.equal(parsed.execution.secretContentsRead, false);
  });
});
