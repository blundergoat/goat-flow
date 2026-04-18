/**
 * Quality command tests - prompt generation, payload contract, audit embedding.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { parseCLIArgs } from "../../src/cli/cli.js";
import { composeQuality } from "../../src/cli/prompt/compose-quality.js";
import { runAudit } from "../../src/cli/audit/audit.js";
import { createFS } from "../../src/cli/facts/fs.js";
import type { QualityHistoryEntry } from "../../src/cli/quality/history.js";

// ---------------------------------------------------------------------------
// Test 1: quality without --agent exits with usage error
// ---------------------------------------------------------------------------
describe("quality requires --agent", () => {
  it("parses quality command without agent as null agent", () => {
    const parsed = parseCLIArgs(["quality", "."]);
    assert.equal(parsed.command, "quality");
    assert.equal(parsed.agent, null, "agent should be null when not provided");
    // The CLI handler checks for null agent and throws CLIError - tested at integration level
  });
});

// ---------------------------------------------------------------------------
// Test 2: quality --agent claude produces prompt output (not empty, not a score)
// ---------------------------------------------------------------------------
describe("quality produces prompt output", () => {
  it("generates non-empty prompt text without scores", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.equal(result.command, "quality");
    assert.equal(result.agent, "claude");
    assert.ok(result.prompt.length > 100, "Prompt should be substantial");
    assert.ok(
      result.prompt.includes("# GOAT Flow Quality Assessment - Claude Code"),
      "Should have title with agent name",
    );
    // Must NOT contain percentage scores or grades
    assert.ok(
      !result.prompt.includes("Score: ") && !result.prompt.includes("Grade: "),
      "Prompt should not present itself as a score or verdict",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3: Generated prompt contains skill testing section and ratings request
// ---------------------------------------------------------------------------
describe("quality prompt content", () => {
  it("states the assessment is strictly read-only", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.ok(
      result.prompt.includes("READ-ONLY ASSESSMENT MODE."),
      "Should explicitly mark assessment mode as read-only",
    );
    assert.ok(
      result.prompt.includes(
        "DO NOT EDIT ANY FILES. ONLY READ, INSPECT, AND REPORT.",
      ),
      "Should end with a strong do-not-edit instruction",
    );
    assert.ok(
      result.prompt.includes("Do NOT apply patches."),
      "Should forbid patches",
    );
    assert.ok(
      result.prompt.includes("tracked files"),
      "Should scope the restriction to tracked files (gitignored build output is allowed)",
    );
    assert.ok(
      result.prompt.includes("gitignored"),
      "Should explicitly carve out gitignored build directories as permitted writes",
    );
    assert.ok(
      !result.prompt.includes("milestone task files"),
      "Should not ask assessment to create milestone task files",
    );
  });

  it("contains skill testing section", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.ok(
      result.prompt.includes("Skill testing"),
      "Should contain skill testing section",
    );
    assert.ok(
      result.prompt.includes("/goat-debug"),
      "Should reference goat-debug skill",
    );
    assert.ok(
      result.prompt.includes("/goat-plan"),
      "Should reference goat-plan skill",
    );
    assert.ok(
      result.prompt.includes("/goat-review"),
      "Should reference goat-review skill",
    );
    assert.ok(
      result.prompt.includes("/goat-critique"),
      "Should reference goat-critique skill",
    );
    assert.ok(
      result.prompt.includes("/goat-security"),
      "Should reference goat-security skill",
    );
    assert.ok(
      result.prompt.includes("/goat-qa"),
      "Should reference goat-qa skill",
    );
    assert.ok(
      result.prompt.includes(
        "ask for a milestone/task breakdown in the response only",
      ),
      "Should keep goat-plan probe read-only",
    );
  });

  it("uses generic legacy task-state wording without naming removed files", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });
    const removedLegacyNames = [
      "to" + "do.md",
      "han" + "doff.md",
      "han" + "doff-template.md",
    ];

    assert.ok(
      result.prompt.includes(
        "No legacy task-state residue from pre-v1.1 workflows?",
      ),
      "Should use generic wording for the pre-check",
    );
    assert.ok(
      result.prompt.includes("removed legacy task-state surfaces"),
      "Should use generic wording for stale-concept checks",
    );
    assert.ok(
      removedLegacyNames.every((name) => !result.prompt.includes(name)),
      "Should not mention the removed filenames in the live quality prompt",
    );
  });

  it("contains ratings request with sub-scores", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.ok(
      result.prompt.includes("### Ratings"),
      "Should contain ratings section",
    );
    assert.ok(
      result.prompt.includes("Setup: __/100"),
      "Should request setup rating",
    );
    assert.ok(
      result.prompt.includes("System: __/100"),
      "Should request system rating",
    );
    assert.ok(
      result.prompt.includes("Accuracy __/25"),
      "Should have accuracy sub-score",
    );
    assert.ok(
      result.prompt.includes("Usefulness __/25"),
      "Should have usefulness sub-score",
    );
  });

  it("includes prior-report context and json contract guidance when history exists", () => {
    const priorReport: QualityHistoryEntry = {
      id: "2026-04-15-claude",
      path: "/tmp/test-project/.goat-flow/logs/quality/2026-04-15-claude.json",
      date: "2026-04-15",
      agent: "claude",
      suffix: 1,
      report: {
        report_kind: "goat-flow-quality-report",
        goat_flow_version: "1.2.0",
        agent: "claude",
        project_path: "/tmp/test-project",
        run_date: "2026-04-15",
        audit_status: "pass",
        scores: {
          setup: {
            total: 80,
            accuracy: 20,
            relevance: 20,
            completeness: 20,
            friction: 20,
          },
          system: {
            total: 75,
            usefulness: 20,
            signal_to_noise: 20,
            adaptability: 20,
            learnability: 15,
          },
        },
        findings: [
          {
            id: "framework_flaw:src-cli-prompt-compose-quality-ts:600",
            type: "framework_flaw",
            severity: "BLOCKER",
            file: "src/cli/prompt/compose-quality.ts",
            line: 600,
            summary: "Prompt still asks for resolved findings",
            detail: "Resolved findings belong in diff output.",
            evidence_quality: "OBSERVED",
            delta_tag: "new",
          },
        ],
      },
    };

    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
      priorReport,
      runDate: "2026-04-18",
    });

    assert.ok(
      result.prompt.includes(
        "Latest same-agent report: `2026-04-15-claude` (2026-04-15)",
      ),
      "Should surface prior-report identity and date",
    );
    assert.ok(
      result.prompt.includes("Do NOT emit `resolved` in current findings"),
      "Should keep resolved in derived diff output",
    );
    assert.ok(
      result.prompt.includes(
        '`delta_tag` is REQUIRED on every current finding and must be either `"new"` or `"persisted"`.',
      ),
      "Should tighten the JSON contract when prior history exists",
    );
    assert.ok(
      result.prompt.includes('"report_kind": "goat-flow-quality-report"'),
      "Should embed the report_kind-driven JSON contract",
    );
    assert.ok(
      result.prompt.includes('"run_date": "2026-04-18"'),
      "Should freeze the requested run date in the JSON contract example",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4: Generated prompt contains audit summary when audit data is available
// ---------------------------------------------------------------------------
describe("quality with audit data", () => {
  it("includes audit summary in prompt", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const auditReport = runAudit(fs, projectPath, {
      agentFilter: "claude",
      harness: true,
    });

    const result = composeQuality({
      agent: "claude",
      projectPath,
      auditReport,
    });

    assert.equal(result.auditStatus, auditReport.status);
    assert.ok(
      result.prompt.includes("## Audit Summary"),
      "Should contain audit summary section",
    );
    assert.ok(result.prompt.includes("Setup"), "Should mention setup scope");
    assert.ok(
      result.prompt.includes("Agent Setup"),
      "Should mention agent setup scope",
    );
  });

  it("includes degraded context note when audit is unavailable", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/nonexistent",
      auditReport: null,
    });

    assert.equal(result.auditStatus, "unavailable");
    assert.ok(
      result.prompt.includes("UNAVAILABLE"),
      "Should indicate audit is unavailable",
    );
    assert.ok(
      result.prompt.includes("audit could not complete"),
      "Should include degraded context note",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 5: Machine-readable payload has correct shape
// ---------------------------------------------------------------------------
describe("quality payload contract", () => {
  it("has required fields", () => {
    const result = composeQuality({
      agent: "codex",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.equal(result.command, "quality");
    assert.equal(result.agent, "codex");
    assert.ok(
      ["pass", "fail", "unavailable"].includes(result.auditStatus),
      "auditStatus should be pass, fail, or unavailable",
    );
    assert.ok(
      typeof result.auditSummary === "string",
      "auditSummary should be string",
    );
    assert.ok(typeof result.prompt === "string", "prompt should be string");
    assert.ok(result.prompt.length > 0, "prompt should not be empty");
  });
});
