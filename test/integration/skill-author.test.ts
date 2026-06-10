/**
 * Integration tests for `goat-flow skill new` filesystem output and input validation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSkillNew, SkillNewInputError } from "../../src/cli/skill-author.js";
import { assertExists } from "../helpers/assert-exists.ts";

type SkillNewResult = Awaited<ReturnType<typeof runSkillNew>>;

/** Create an isolated project root for skill-author write tests. */
function makeTempProject(): string {
  return mkdtempSync(join(tmpdir(), "goat-flow-skill-author-"));
}

/**
 * Assert skill-author recommended a skill subtype.
 *
 * @param result - result returned by the skill-author command helper
 * @param subtype - subtype the recommendation must carry
 */
function assertRecommendedSkillSubtype(
  result: SkillNewResult,
  subtype: "workflow" | "report",
): void {
  assert.deepEqual(result.candidacy.recommendedArtifact, {
    type: "skill",
    subtype,
  });
}

/**
 * Assert skill-author recommended a reference subtype.
 *
 * @param result - result returned by the skill-author command helper
 * @param subtype - subtype the recommendation must carry
 */
function assertRecommendedReferenceSubtype(
  result: SkillNewResult,
  subtype: "playbook",
): void {
  assert.deepEqual(result.candidacy.recommendedArtifact, {
    type: "reference",
    subtype,
  });
}

describe("skill new - description mode", () => {
  it("scaffolds a workflow SKILL.md when the description is workflow-shaped", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name: "pg-index",
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.candidacy.recommendedArtifact.type, "skill");
    assert.equal(result.written, true);
    assertExists(result.proposedPath);
    assert.ok(
      result.proposedPath?.endsWith(".claude/skills/pg-index/SKILL.md"),
    );
    assert.ok(existsSync(result.proposedPath));

    const content = readFileSync(result.proposedPath, "utf-8");
    assert.match(content, /name: pg-index/);
    assert.match(content, /## Step 0/);
    assert.match(content, /## Verification/);
  });

  it("scaffolds a report skill for audit-shaped descriptions without writes", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description: "I want to audit Postgres queries before deploy.",
      name: "pg-audit",
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.candidacy.recommendedArtifact.type, "skill");
    assertRecommendedSkillSubtype(result, "report");
    assert.ok(result.written);
    assertExists(result.proposedPath);
    const content = readFileSync(result.proposedPath, "utf-8");
    assert.match(content, /## Quick Scan Path/);
  });

  it("scaffolds a playbook for documenting how to use a tool", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description:
        "I want to document how to use the lefthook pre-commit tool.",
      name: "lefthook",
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assertRecommendedReferenceSubtype(result, "playbook");
    assert.ok(result.written);
    assert.ok(
      result.proposedPath?.endsWith(
        ".goat-flow/skill-docs/playbooks/lefthook.md",
      ),
    );
    assertExists(result.proposedPath);
    const content = readFileSync(result.proposedPath, "utf-8");
    assert.match(content, /goat-flow-reference-version:/);
    assert.match(content, /## Availability Check/);
    assert.match(content, /## Boundary/);
    assert.match(content, /## Verification Gate/);
  });

  it("does NOT write when candidacy returns a non-skill recommendation", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description: "I want to capture a lesson from a recent CI incident.",
      name: "ci-incident",
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.candidacy.recommendedArtifact.type, "learning-loop");
    assert.equal(result.written, false);
    assert.equal(result.proposedPath, null);
    assert.ok(result.output.some((line) => line.includes("learning-loop")));
  });

  it("does NOT write for one-line descriptions with no clear intent", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description: "Hello.",
      name: "hello",
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.candidacy.recommendedArtifact.type, "do-not-create");
    assert.equal(result.written, false);
  });

  it("respects user n at the confirmation prompt", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name: "pg-index-no",
      projectRoot,
      stdinAnswers: ["n"],
    });

    assert.equal(result.candidacy.recommendedArtifact.type, "skill");
    assert.equal(result.written, false);
    assertExists(result.proposedPath);
    assert.ok(!existsSync(result.proposedPath));
  });

  it("rejects invalid skill names", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description: "I want a workflow.",
      name: "Bad Name With Spaces",
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.written, false);
    assert.ok(result.output.some((line) => line.includes("Invalid name")));
  });

  it("scoring after scaffold lands within the workflow profile bounds", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name: "pg-index-score",
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });
    assert.ok(result.written);
    assertExists(result.postScaffoldScore);
    assert.ok(result.postScaffoldScore.totalScore > 0);
    assert.ok(
      result.postScaffoldScore.totalScore <=
        result.postScaffoldScore.profileMax,
    );
  });

  it("rejects mixed description, draft, and interactive input modes", async () => {
    const projectRoot = makeTempProject();
    await assert.rejects(
      runSkillNew({
        description: "I want a workflow that walks through deploys.",
        draftPath: join(projectRoot, "draft.md"),
        shouldUseInteractivePrompt: true,
        projectRoot,
        stdinAnswers: [],
      }),
      (err) =>
        err instanceof SkillNewInputError &&
        /exactly one input mode/.test(err.message),
    );
  });
});

describe("skill new - draft mode", () => {
  // Fixture purpose: writes a draft skill file to cover expected-location validation.
  it("validates a workflow draft against its expected location", async () => {
    const projectRoot = makeTempProject();
    const draftPath = join(projectRoot, "draft.md");
    writeFileSync(
      draftPath,
      [
        "---",
        "name: draft",
        'description: "Draft skill."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /draft",
        "## When to Use",
        "Use when testing.",
        "NOT this skill: unrelated work.",
        "## Step 0",
        "Read context.",
        "## Phase 1",
        "Do work.",
        "## Verification",
        "- [ ] evidence required.",
      ].join("\n"),
    );

    const result = await runSkillNew({
      draftPath,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.candidacy.recommendedArtifact.type, "skill");
    assert.equal(result.written, false, "draft mode never writes");
    assert.ok(
      result.output.some((line) => line.includes("Suggested move")),
      "draft is at draft.md, expected location is .claude/skills/draft/SKILL.md",
    );
  });

  it("redirects an incident-named draft to the learning-loop", async () => {
    const projectRoot = makeTempProject();
    const draftPath = join(projectRoot, "incident-2026-05-09.md");
    writeFileSync(
      draftPath,
      "# incident-2026-05-09\n\nWe shipped a regression because tests passed locally but not in CI.",
    );

    const result = await runSkillNew({
      draftPath,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.candidacy.recommendedArtifact.type, "learning-loop");
    assert.equal(result.written, false);
    assert.equal(result.proposedPath, null);
  });

  // Fixture purpose: writes a playbook-shaped draft to the filesystem so draft mode suggests the playbook route.
  it("suggests moving playbook-looking drafts under skill-docs playbooks", async () => {
    const projectRoot = makeTempProject();
    const draftPath = join(projectRoot, ".claude", "skills", "playwright.md");
    mkdirSync(join(projectRoot, ".claude", "skills"), { recursive: true });
    const playbookDraftFixture = [
      "# Playwright E2E",
      "## Availability Check",
      "Run command -v playwright.",
      "## Workflow",
      "Capture browser evidence.",
    ].join("\n");
    writeFileSync(draftPath, playbookDraftFixture);

    const result = await runSkillNew({
      draftPath,
      projectRoot,
      stdinAnswers: [],
    });

    assertRecommendedReferenceSubtype(result, "playbook");
    assert.equal(result.written, false);
    assert.ok(
      result.output.some((line) =>
        line.includes(".goat-flow/skill-docs/playbooks/playwright.md"),
      ),
      "playbook-looking drafts should get a move suggestion to skill-docs/playbooks",
    );
  });

  it("returns an error message for a missing draft path", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      draftPath: join(projectRoot, "does-not-exist.md"),
      projectRoot,
      stdinAnswers: [],
    });
    assert.equal(result.written, false);
    assert.ok(
      result.output.some((line) => line.includes("Draft file not found")),
    );
  });
});

describe("skill new - interactive mode", () => {
  it("prompts for description and name in interactive mode", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      shouldUseInteractivePrompt: true,
      projectRoot,
      // First answer = description; second = name; third = confirm.
      stdinAnswers: [
        "I want a workflow that walks through Postgres index changes.",
        "pg-interactive",
        "y",
      ],
    });

    assert.equal(result.candidacy.recommendedArtifact.type, "skill");
    assert.equal(result.written, true);
    assert.ok(
      result.proposedPath?.endsWith(".claude/skills/pg-interactive/SKILL.md"),
    );
  });

  it("aborts when the description is empty", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      shouldUseInteractivePrompt: true,
      projectRoot,
      stdinAnswers: [""],
    });
    assert.equal(result.written, false);
    assert.equal(result.candidacy.recommendedArtifact.type, "do-not-create");
  });
});
