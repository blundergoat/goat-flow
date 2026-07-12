/**
 * Verifies the consumer journey from goat-flow installation to a saved quality report.
 * Use when setup, audit, harness, quality-prompt, or report-schema behavior changes.
 * The public CLI always runs from the controlling workspace while every project action targets
 * a disposable consumer, preventing framework files from being mistaken for target evidence.
 * Cleanup checks preserve a pre-existing user marker on both successful and failed scenarios.
 */
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import type { QualityMode } from "../../src/cli/quality/schema-types.js";

const CONTROLLING_WORKSPACE = resolve(import.meta.dirname, "..", "..");
const CLI_ENTRY_PATH = join(CONTROLLING_WORKSPACE, "src", "cli", "cli.ts");
const QUALITY_REPORT_IDENTIFIER = "2026-07-12-0101-codex-abc12";
const USER_OWNED_MARKER = "user-owned fixture content\n";
const QUALITY_MODES: readonly QualityMode[] = [
  "agent-setup",
  "process",
  "harness",
  "skills",
];

/** Audit fields the consumer lifecycle needs to distinguish target, agent, harness, and drift results. */
interface ConsumerAuditResult {
  status: string;
  target: string;
  harness: boolean;
  scopes: {
    setup: { status: string };
    agent: { status: string };
    harness: { status: string };
  };
  drift: { status: string };
}

/** Quality payload returned by the public CLI; an empty prompt is never useful to the selected agent. */
interface ConsumerQualityPayload {
  prompt: string;
  auditStatus: string;
}

/**
 * Run one public CLI action from the controlling workspace against an explicit target.
 * Use this instead of importing internals so the test covers the entry point users execute.
 *
 * @param commandArguments - CLI words after `cli.ts`; empty means show the default help path
 * @returns completed process output; null status means the CLI was killed before it could answer
 */
function runPublicCli(
  commandArguments: readonly string[],
): SpawnSyncReturns<string> {
  // The fixed source entry keeps the controlling workspace separate from the target path in argv.
  return spawnSync(
    "node",
    ["--import", "tsx", CLI_ENTRY_PATH, ...commandArguments],
    {
      cwd: CONTROLLING_WORKSPACE,
      encoding: "utf-8",
      timeout: 30_000,
    },
  );
}

/**
 * Require one CLI action to finish successfully before its output is trusted as user evidence.
 * Use after setup, audit, prompt, and validation calls so failures show their real diagnostics.
 *
 * @param result - public CLI result; null status means no usable answer reached the user
 * @param userAction - non-empty action name shown when the assertion fails
 * @returns no value; an assertion error reports stderr or stdout when the action failed
 */
function assertCliSucceeded(
  result: SpawnSyncReturns<string>,
  userAction: string,
): void {
  assert.equal(
    result.status,
    0,
    `${userAction} failed:\n${result.stderr || result.stdout}`,
  );
}

/**
 * Parse one JSON CLI response after its process succeeds.
 * Use for audit and quality payloads; it throws when empty or malformed output cannot drive the UI.
 *
 * @param result - successful CLI result whose stdout must contain one JSON document
 * @returns parsed object; never null because malformed or empty output throws
 */
function parseCliJson<ResultShape>(
  result: SpawnSyncReturns<string>,
): ResultShape {
  return JSON.parse(result.stdout) as ResultShape;
}

/**
 * Write the project-owned outputs that the setup prompt normally asks a coding agent to author.
 * Use only in this external-agent-free fixture after the real installer and setup prompt have run.
 * It writes four selected-target documents and never changes the controlling workspace.
 *
 * @param consumerTargetPath - selected consumer receiving adapted docs; empty is never valid
 * @returns no value after the instruction, architecture, code map, and glossary are present
 */
function writeCompletedConsumerSetupFixture(consumerTargetPath: string): void {
  // This fixture represents a user who completed the setup prompt before running their first audit.
  writeFileSync(
    join(consumerTargetPath, "AGENTS.md"),
    `# AGENTS.md - v1.13.1 (2026-07-12)

Consumer lifecycle fixture for setup, audit, and quality command integration.

## Truth Order

User instructions > AGENTS.md > .goat-flow/architecture.md > skills.

## Autonomy Tiers

Always read and verify. Ask before protected changes. Never commit or push.

## Hard Rules

Keep the controlling goat-flow workspace separate from this selected target project.
Use target files for project evidence and controlling-workspace files only for framework behavior.

## Key Resources

Architecture, code map, glossary, skills, hooks, and learning-loop paths live under .goat-flow/.

## Essential Commands

Run goat-flow audit . --agent codex --harness --check-drift before trusting setup.

## Execution Loop: READ -> SCOPE -> ACT -> VERIFY

### READ

Read target evidence before making claims.
Before declaring any tool unavailable, read its playbook in \`.goat-flow/skill-docs/playbooks/\`
and run the documented Availability Check.

### SCOPE

Name the selected target and allowed files.

### ACT

Make only approved target changes.

### VERIFY

Run the command that reproduces the user-visible behavior.

Hallucination red-flags:
1. Checks passed: quote a fresh literal result.
2. Completion: list files changed in this turn.
3. Fix verification: rerun the original reproduction.
4. Hedged claims: mark missing proof unverified.

Apply the Rationalisations to reject table in .goat-flow/skill-docs/skill-preamble.md.

## Definition of Done

Confirm focused checks, path integrity, working notes, and no unapproved boundary change.

## Artifact Routing

Route lessons and footguns to their matching .goat-flow/learning-loop/ directories.

## Router Table

| Resource | Path |
|---|---|
| Architecture | .goat-flow/architecture.md |
| Code map | .goat-flow/code-map.md |
| Glossary | .goat-flow/glossary.md |
| Skills | .agents/skills/ |
| Skill playbooks (tools) | \`.goat-flow/skill-docs/playbooks/\` (README.md index) |
| Footguns | .goat-flow/learning-loop/footguns/ |
| Lessons | .goat-flow/learning-loop/lessons/ |
| Plans | .goat-flow/plans/ |
`,
  );
  writeFileSync(
    join(consumerTargetPath, ".goat-flow", "architecture.md"),
    `# Consumer Fixture Architecture

This selected consumer contains a Codex instruction file, installed goat-flow skills, hooks,
and local learning-loop storage. The controlling goat-flow workspace supplies the CLI and
templates; audit and quality commands read project evidence from this consumer target.
`,
  );
  writeFileSync(
    join(consumerTargetPath, ".goat-flow", "code-map.md"),
    `# Consumer Fixture Code Map

- Agent instructions: AGENTS.md
- Harness configuration: .goat-flow/config.yaml
- Installed skills: .agents/skills/
- Local quality history: .goat-flow/logs/quality/
`,
  );
  writeFileSync(
    join(consumerTargetPath, ".goat-flow", "glossary.md"),
    `# Consumer Fixture Glossary

- Controlling workspace: the goat-flow checkout that runs the CLI and owns framework templates.
- Selected target: this disposable consumer whose setup, audit, and quality evidence is assessed.
`,
  );
}

/**
 * Run a scenario in a disposable consumer while preserving content outside the selected target.
 * Use for success and failure paths so users never lose neighboring files during test cleanup.
 *
 * @param scenario - consumer action sequence; a rejection is rethrown after cleanup
 * @returns no value after the target and its temporary parent have been removed
 */
async function withTemporaryConsumerTarget(
  scenario: (consumerTargetPath: string) => Promise<void>,
): Promise<void> {
  const fixtureWorkspace = mkdtempSync(
    join(tmpdir(), "goat-flow-quality-lifecycle-"),
  );
  const userMarkerPath = join(fixtureWorkspace, "user-owned.txt");
  const consumerTargetPath = join(fixtureWorkspace, "selected-consumer");
  writeFileSync(userMarkerPath, USER_OWNED_MARKER);
  mkdirSync(consumerTargetPath);

  try {
    await scenario(consumerTargetPath);
  } finally {
    // The selected target is test-owned, so cleanup removes its installed files after either outcome.
    let hasRemovedConsumerTarget = false;
    let preservedUserMarker = "";
    try {
      rmSync(consumerTargetPath, { recursive: true, force: true });
      hasRemovedConsumerTarget = !existsSync(consumerTargetPath);
      preservedUserMarker = readFileSync(userMarkerPath, "utf-8");
    } finally {
      // The temporary parent is no longer needed after preservation evidence has been captured.
      rmSync(fixtureWorkspace, { recursive: true, force: true });
    }
    assert.equal(
      hasRemovedConsumerTarget,
      true,
      "temporary consumer target was not removed",
    );
    assert.equal(preservedUserMarker, USER_OWNED_MARKER);
  }
}

/**
 * Build the smallest valid prior report needed to exercise prompt history and validation.
 * Use after setup to prove the selected consumer owns its local quality history.
 *
 * @param consumerTargetPath - installed target recorded in report history; empty is never valid
 * @returns schema-valid report with no findings; an empty findings list means this fixture found no defects
 */
function consumerQualityReport(consumerTargetPath: string): object {
  return {
    report_kind: "goat-flow-quality-report",
    goat_flow_version: "1.13.1",
    agent: "codex",
    project_path: consumerTargetPath,
    run_date: "2026-07-12",
    audit_status: "pass",
    scope: "consumer",
    rubric_version: "1.13.1",
    quality_mode: "agent-setup",
    prior_report_id: null,
    scores: {
      setup: {
        total: 100,
        accuracy: 25,
        relevance: 25,
        completeness: 25,
        friction: 25,
      },
      system: {
        total: 100,
        usefulness: 25,
        signal_to_noise: 25,
        adaptability: 25,
        learnability: 25,
      },
    },
    findings: [],
  };
}

describe("consumer setup to quality-report lifecycle", () => {
  it("keeps setup, audit, prompts, and report history on the selected consumer", async () => {
    await withTemporaryConsumerTarget(async (consumerTargetPath) => {
      // A user runs install from goat-flow but chooses a different project as the setup target.
      const installResult = runPublicCli([
        "install",
        consumerTargetPath,
        "--agent",
        "codex",
      ]);
      assertCliSucceeded(installResult, "consumer install");

      // Setup remains prompt-driven, so this verifies its target before the fixture supplies adapted outputs.
      const setupPromptResult = runPublicCli([
        "setup",
        consumerTargetPath,
        "--agent",
        "codex",
      ]);
      assertCliSucceeded(setupPromptResult, "consumer setup prompt");
      assert.match(
        setupPromptResult.stdout,
        new RegExp(consumerTargetPath, "u"),
      );
      assert.match(setupPromptResult.stdout, /02-instruction-file\.md/u);
      writeCompletedConsumerSetupFixture(consumerTargetPath);

      // The follow-up audit must describe the selected consumer, not the controlling checkout.
      const auditResult = runPublicCli([
        "audit",
        consumerTargetPath,
        "--agent",
        "codex",
        "--harness",
        "--check-drift",
        "--format",
        "json",
      ]);
      assertCliSucceeded(auditResult, "consumer audit");
      const auditReport = parseCliJson<ConsumerAuditResult>(auditResult);
      assert.equal(auditReport.status, "pass");
      assert.equal(auditReport.target, consumerTargetPath);
      assert.equal(auditReport.harness, true);
      assert.equal(auditReport.scopes.setup.status, "pass");
      assert.equal(auditReport.scopes.agent.status, "pass");
      assert.equal(auditReport.scopes.harness.status, "pass");
      assert.equal(auditReport.drift.status, "pass");

      const qualityDirectory = join(
        consumerTargetPath,
        ".goat-flow",
        "logs",
        "quality",
      );
      const qualityReportPath = join(
        qualityDirectory,
        `${QUALITY_REPORT_IDENTIFIER}.json`,
      );
      writeFileSync(
        qualityReportPath,
        `${JSON.stringify(consumerQualityReport(consumerTargetPath), null, 2)}\n`,
      );

      // Public validation proves the report can enter the consumer's quality history.
      const validationResult = runPublicCli([
        "quality",
        "validate",
        qualityReportPath,
      ]);
      assertCliSucceeded(
        validationResult,
        "consumer quality report validation",
      );
      assert.match(
        validationResult.stdout,
        new RegExp(`OK ${qualityReportPath}`, "u"),
      );
      const installedGitignore = readFileSync(
        join(consumerTargetPath, ".goat-flow", ".gitignore"),
        "utf-8",
      );
      assert.match(installedGitignore, /^logs\/quality\/\*\.json$/mu);

      const expectedScopeContextByMode: Record<QualityMode, RegExp> = {
        "agent-setup": /"scope": "consumer"/u,
        process:
          /Scope rule: controlling goat-flow workspace, plus selected target only when it is a goat-flow installation/u,
        harness:
          /Scope rule: selected target project harness, interpreted from the controlling workspace/u,
        skills:
          /Scope rule: controlling goat-flow workspace skills and shared references/u,
      };
      const expectedAgentContextByMode: Record<QualityMode, RegExp> = {
        "agent-setup": /\*\*Agent:\*\* Codex/u,
        process: /Selected quality target agent: codex/u,
        harness: /Selected quality target agent: codex/u,
        skills: /Selected quality target agent: codex/u,
      };
      const expectedPriorContextByMode: Record<QualityMode, RegExp> = {
        "agent-setup": new RegExp(QUALITY_REPORT_IDENTIFIER, "u"),
        process: /No prior same-agent process quality report exists/u,
        harness: /No prior same-agent harness quality report exists/u,
        skills: /No prior same-agent skills quality report exists/u,
      };
      const expectedPriorIdentifierByMode: Record<QualityMode, RegExp> = {
        "agent-setup": new RegExp(
          `"prior_report_id": "${QUALITY_REPORT_IDENTIFIER}"`,
          "u",
        ),
        process: /"prior_report_id": null/u,
        harness: /"prior_report_id": null/u,
        skills: /"prior_report_id": null/u,
      };
      const expectedDeltaContractByMode: Record<QualityMode, RegExp> = {
        "agent-setup": /"delta_tag": "new"/u,
        process: /"delta_tag": null/u,
        harness: /"delta_tag": null/u,
        skills: /"delta_tag": null/u,
      };

      // Each Quality-page choice must retain the same selected target, agent, destination, and mode scope.
      for (const qualityMode of QUALITY_MODES) {
        const qualityResult = runPublicCli([
          "quality",
          consumerTargetPath,
          "--agent",
          "codex",
          "--mode",
          qualityMode,
          "--format",
          "json",
        ]);
        assertCliSucceeded(qualityResult, `${qualityMode} quality prompt`);
        const qualityPayload =
          parseCliJson<ConsumerQualityPayload>(qualityResult);
        assert.equal(qualityPayload.auditStatus, "pass");
        assert.match(
          qualityPayload.prompt,
          new RegExp(consumerTargetPath, "u"),
        );
        assert.match(
          qualityPayload.prompt,
          expectedAgentContextByMode[qualityMode],
        );
        assert.match(
          qualityPayload.prompt,
          expectedScopeContextByMode[qualityMode],
        );
        assert.match(
          qualityPayload.prompt,
          new RegExp(
            `QUALITY_DIR='${qualityDirectory.replaceAll("\\", "/")}'`,
            "u",
          ),
        );
        assert.match(
          qualityPayload.prompt,
          new RegExp(`"quality_mode": "${qualityMode}"`, "u"),
        );
        assert.match(
          qualityPayload.prompt,
          expectedPriorContextByMode[qualityMode],
        );
        assert.match(
          qualityPayload.prompt,
          expectedPriorIdentifierByMode[qualityMode],
        );
        assert.match(
          qualityPayload.prompt,
          expectedDeltaContractByMode[qualityMode],
        );
      }
    });
  });

  it("cleans the selected consumer after a failed lifecycle action", async () => {
    await assert.rejects(
      withTemporaryConsumerTarget(async (consumerTargetPath) => {
        writeFileSync(
          join(consumerTargetPath, "test-owned.txt"),
          "temporary\n",
        );
        throw new Error("deliberate lifecycle failure");
      }),
      /deliberate lifecycle failure/u,
    );
  });
});
