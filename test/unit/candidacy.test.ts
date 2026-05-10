import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runCandidacyCheck } from "../../src/cli/quality/candidacy.js";

describe("runCandidacyCheck — draft mode", () => {
  it("recommends skill (workflow) when ## Step 0 and ## Verification are present", () => {
    const result = runCandidacyCheck({
      kind: "draft",
      content: [
        "# /something",
        "## Step 0",
        "Read context.",
        "## Phase 1",
        "Do work.",
        "## Verification",
        "- [ ] evidence required.",
      ].join("\n"),
    });
    assert.equal(result.recommendedArtifact.type, "skill");
    if (result.recommendedArtifact.type === "skill") {
      assert.equal(result.recommendedArtifact.subtype, "workflow");
    }
    assert.ok(result.confidence >= 0.8);
  });

  it("recommends skill (dispatcher) when ## Route Map is present without Step 0", () => {
    const result = runCandidacyCheck({
      kind: "draft",
      content: ["# /goat-thing", "## Route Map", "Routes go here."].join("\n"),
    });
    assert.equal(result.recommendedArtifact.type, "skill");
    if (result.recommendedArtifact.type === "skill") {
      assert.equal(result.recommendedArtifact.subtype, "dispatcher");
    }
  });

  it("recommends skill (report) for Quick Scan Path / Audit Mode without File-Write", () => {
    const result = runCandidacyCheck({
      kind: "draft",
      content: [
        "# /audit-thing",
        "## When to Use",
        "Use when reviewing.",
        "## Quick Scan Path",
        "Scan procedure.",
      ].join("\n"),
    });
    assert.equal(result.recommendedArtifact.type, "skill");
    if (result.recommendedArtifact.type === "skill") {
      assert.equal(result.recommendedArtifact.subtype, "report");
    }
  });

  it("recommends reference (playbook) when Availability Check is present", () => {
    const result = runCandidacyCheck({
      kind: "draft",
      content: [
        "# Browser Use",
        "## Availability Check",
        "Run command -v browser-use.",
      ].join("\n"),
    });
    assert.equal(result.recommendedArtifact.type, "reference");
    if (result.recommendedArtifact.type === "reference") {
      assert.equal(result.recommendedArtifact.subtype, "playbook");
    }
    assert.ok(
      result.nextSteps.some((step) =>
        step.action.includes(".goat-flow/skill-playbooks/<name>.md"),
      ),
    );
  });

  it("recommends reference (index) when content has 'which file to load'", () => {
    const result = runCandidacyCheck({
      kind: "draft",
      content: [
        "# Skill Quality Testing",
        "## Which file to load",
        "deployment.md for deploy concerns; rubrics.md for grading.",
      ].join("\n"),
    });
    assert.equal(result.recommendedArtifact.type, "reference");
    if (result.recommendedArtifact.type === "reference") {
      assert.equal(result.recommendedArtifact.subtype, "index");
    }
    assert.ok(
      result.nextSteps.some((step) =>
        step.action.includes(".goat-flow/skill-playbooks/<name>.md"),
      ),
    );
  });

  it("recommends learning-loop (lesson) for incident-named drafts", () => {
    const result = runCandidacyCheck({
      kind: "draft",
      content:
        "# incident-2026-05-09\n\nWe shipped a regression because tests passed locally but not in CI.",
      suggestedName: "incident-2026-05-09",
    });
    assert.equal(result.recommendedArtifact.type, "learning-loop");
    if (result.recommendedArtifact.type === "learning-loop") {
      assert.equal(result.recommendedArtifact.subtype, "lesson");
    }
  });

  it("recommends learning-loop (footgun) for footgun-named drafts", () => {
    const result = runCandidacyCheck({
      kind: "draft",
      content: "# footgun: empty config\n\nDo not assume null = unset.",
      suggestedName: "footgun-empty-config",
    });
    assert.equal(result.recommendedArtifact.type, "learning-loop");
    if (result.recommendedArtifact.type === "learning-loop") {
      assert.equal(result.recommendedArtifact.subtype, "footgun");
    }
  });

  it("recommends learning-loop (decision) for ADR-named drafts with structure", () => {
    const result = runCandidacyCheck({
      kind: "draft",
      content: [
        "# ADR-042: Use deterministic IDs",
        "## Context",
        "Random IDs caused flaky tests.",
        "## Decision",
        "Always derive IDs from path.",
        "## Consequences",
        "Tests are stable but renaming files affects IDs.",
      ].join("\n"),
      suggestedName: "ADR-042-deterministic-ids",
    });
    assert.equal(result.recommendedArtifact.type, "learning-loop");
    if (result.recommendedArtifact.type === "learning-loop") {
      assert.equal(result.recommendedArtifact.subtype, "decision");
    }
  });

  it("recommends instruction-file for short rule-shaped drafts", () => {
    const result = runCandidacyCheck({
      kind: "draft",
      content:
        "MUST never commit secrets. MUST always use environment variables.",
    });
    assert.equal(result.recommendedArtifact.type, "instruction-file");
    if (result.recommendedArtifact.type === "instruction-file") {
      assert.equal(result.recommendedArtifact.reason, "rule-shaped");
    }
  });

  it("recommends do-not-create for very short content with no signal", () => {
    const result = runCandidacyCheck({
      kind: "draft",
      content: "TBD",
    });
    assert.equal(result.recommendedArtifact.type, "do-not-create");
  });

  it("recommends do-not-create with low confidence when no decisive signal exists", () => {
    const result = runCandidacyCheck({
      kind: "draft",
      content: [
        "# Some thing",
        "",
        "Some prose without canonical headings.",
        "More prose continuing the prose theme.",
        "And more prose for filler.",
        "Even more prose to push past the line minimum.",
        "And yet more prose continuing on without canonical signals.",
      ].join("\n"),
    });
    assert.equal(result.recommendedArtifact.type, "do-not-create");
    assert.ok(result.confidence < 0.5);
  });
});

describe("runCandidacyCheck — description mode", () => {
  it("recommends skill (workflow) for workflow-shaped descriptions", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "I want a workflow that walks through Postgres index changes.",
    });
    assert.equal(result.recommendedArtifact.type, "skill");
  });

  it("does not treat implementation as a workflow keyword", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "implementation notes for onboarding",
    });
    assert.notEqual(result.recommendedArtifact.type, "skill");
  });

  it("does not treat rerun as a workflow keyword", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "rerun a formatter helper",
    });
    assert.notEqual(result.recommendedArtifact.type, "skill");
  });

  it("recommends skill (report) for audit-shaped descriptions without writes", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "I want to audit Postgres queries before deploy.",
    });
    assert.equal(result.recommendedArtifact.type, "skill");
    if (result.recommendedArtifact.type === "skill") {
      assert.equal(result.recommendedArtifact.subtype, "report");
    }
  });

  it("recommends reference (playbook) for documenting how to use a tool", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "I want to document how to use the lefthook pre-commit tool.",
    });
    assert.equal(result.recommendedArtifact.type, "reference");
  });

  it("recommends instruction-file for rule-shaped descriptions", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "I want a rule that says we must never commit secrets.",
    });
    assert.equal(result.recommendedArtifact.type, "instruction-file");
  });

  it("recommends learning-loop (lesson) for incident-shaped descriptions", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "I want to capture a lesson from a recent incident in CI.",
    });
    assert.equal(result.recommendedArtifact.type, "learning-loop");
    if (result.recommendedArtifact.type === "learning-loop") {
      assert.equal(result.recommendedArtifact.subtype, "lesson");
    }
  });

  it("recommends learning-loop (footgun) for footgun-shaped descriptions", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "I want to document a footgun about empty config files.",
    });
    assert.equal(result.recommendedArtifact.type, "learning-loop");
    if (result.recommendedArtifact.type === "learning-loop") {
      assert.equal(result.recommendedArtifact.subtype, "footgun");
    }
  });

  it("recommends learning-loop (decision) for architecture-decision descriptions", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "I want an ADR for our retry strategy.",
    });
    assert.equal(result.recommendedArtifact.type, "learning-loop");
    if (result.recommendedArtifact.type === "learning-loop") {
      assert.equal(result.recommendedArtifact.subtype, "decision");
    }
  });

  it("recommends cli-command for one-shot deterministic tasks", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "I want a deterministic one-shot script that lists stale TODOs.",
    });
    assert.equal(result.recommendedArtifact.type, "cli-command");
  });

  it("recommends do-not-create with low confidence for ambiguous descriptions", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "Hello.",
    });
    assert.equal(result.recommendedArtifact.type, "do-not-create");
    assert.ok(result.confidence < 0.5);
  });

  it("recommends do-not-create for empty descriptions with high confidence", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "   ",
    });
    assert.equal(result.recommendedArtifact.type, "do-not-create");
    assert.ok(result.confidence > 0.9);
  });

  it("does NOT auto-default to skill on unknown intent (regression guard)", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "Just some random text about cats and weather.",
    });
    assert.notEqual(result.recommendedArtifact.type, "skill");
  });
});

describe("runCandidacyCheck — reasoning + nextSteps", () => {
  it("includes at least one reasoning entry for every result", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "I want a workflow.",
    });
    assert.ok(result.reasoning.length >= 1);
  });

  it("includes at least one next step for every result", () => {
    const result = runCandidacyCheck({
      kind: "description",
      text: "I want a workflow.",
    });
    assert.ok(result.nextSteps.length >= 1);
  });
});
