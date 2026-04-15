/**
 * Critique command tests - prompt generation, payload contract, audit embedding.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { parseCLIArgs } from "../../src/cli/cli.js";
import { composeCritique } from "../../src/cli/prompt/compose-critique.js";
import { runAudit } from "../../src/cli/audit/audit.js";
import { createFS } from "../../src/cli/facts/fs.js";

// ---------------------------------------------------------------------------
// Test 1: critique without --agent exits with usage error
// ---------------------------------------------------------------------------
describe("critique requires --agent", () => {
  it("parses critique command without agent as null agent", () => {
    const parsed = parseCLIArgs(["critique", "."]);
    assert.equal(parsed.command, "critique");
    assert.equal(parsed.agent, null, "agent should be null when not provided");
    // The CLI handler checks for null agent and throws CLIError - tested at integration level
  });
});

// ---------------------------------------------------------------------------
// Test 2: critique --agent claude produces prompt output (not empty, not a score)
// ---------------------------------------------------------------------------
describe("critique produces prompt output", () => {
  it("generates non-empty prompt text without scores", () => {
    const result = composeCritique({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.equal(result.command, "critique");
    assert.equal(result.agent, "claude");
    assert.ok(result.prompt.length > 100, "Prompt should be substantial");
    assert.ok(
      result.prompt.includes("# GOAT Flow Critique - Claude Code"),
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
describe("critique prompt content", () => {
  it("states critique is strictly read-only", () => {
    const result = composeCritique({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.ok(
      result.prompt.includes("READ-ONLY CRITIQUE MODE."),
      "Should explicitly mark critique mode as read-only",
    );
    assert.ok(
      result.prompt.includes(
        "DO NOT EDIT ANY FILES. ONLY READ, INSPECT, AND REPORT.",
      ),
      "Should end with a strong do-not-edit instruction",
    );
    assert.ok(
      result.prompt.includes("Do NOT run write commands or apply patches."),
      "Should forbid write commands and patches",
    );
    assert.ok(
      !result.prompt.includes("milestone task files"),
      "Should not ask critique to create milestone task files",
    );
  });

  it("contains skill testing section", () => {
    const result = composeCritique({
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
      result.prompt.includes("/goat-sbao"),
      "Should reference goat-sbao skill",
    );
    assert.ok(
      result.prompt.includes("/goat-security"),
      "Should reference goat-security skill",
    );
    assert.ok(
      result.prompt.includes("/goat-test"),
      "Should reference goat-test skill",
    );
    assert.ok(
      result.prompt.includes(
        "ask for a milestone/task breakdown in the response only",
      ),
      "Should keep goat-plan probe read-only",
    );
  });

  it("contains ratings request with sub-scores", () => {
    const result = composeCritique({
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
});

// ---------------------------------------------------------------------------
// Test 4: Generated prompt contains audit summary when audit data is available
// ---------------------------------------------------------------------------
describe("critique with audit data", () => {
  it("includes audit summary in prompt", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const auditReport = runAudit(fs, projectPath, {
      agentFilter: "claude",
      harness: true,
    });

    const result = composeCritique({
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
    const result = composeCritique({
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
describe("critique payload contract", () => {
  it("has required fields", () => {
    const result = composeCritique({
      agent: "codex",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.equal(result.command, "critique");
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
