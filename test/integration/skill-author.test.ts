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

/** Write the minimum real RED receipt accepted before a fixture skill can be scaffolded. */
function writeRedLog(projectRoot: string, name: string): string {
  const logDirectory = join(projectRoot, ".goat-flow", "logs", "sessions");
  mkdirSync(logDirectory, { recursive: true });
  const redLogPath = join(logDirectory, `2026-07-17-${name}-tdd.md`);
  writeFileSync(
    redLogPath,
    `# Skill TDD: ${name}

## Iteration 1 (RED)
Scenario: The author is asked to create the workflow before proving the failure.
Pressures applied: time, authority, pragmatic
Agent behaviour: skipped failing-first work and chose B
Rationalisations captured (verbatim):
- "The workflow is obvious enough to draft first."
`,
  );
  return redLogPath;
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
  it("blocks discoverable skill scaffolds until RED evidence is supplied", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name: "pg-index-red-gate",
      agent: "codex",
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.candidacy.recommendedArtifact.type, "skill");
    assert.equal(result.written, false);
    assertExists(result.proposedPath);
    assert.ok(!existsSync(result.proposedPath));
    assert.ok(result.output.some((line) => line.includes("RED gate blocked")));
  });

  it("rejects presence-only RED logs that do not prove a failing scenario", async () => {
    const projectRoot = makeTempProject();
    const name = "pg-index-empty-red";
    const logDirectory = join(projectRoot, ".goat-flow", "logs", "sessions");
    const redLogPath = join(logDirectory, `2026-07-17-${name}-tdd.md`);
    mkdirSync(logDirectory, { recursive: true });
    writeFileSync(redLogPath, "# Empty receipt\n");

    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name,
      redLogPath,
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.written, false);
    assert.ok(!existsSync(result.proposedPath ?? ""));
    assert.match(result.output.join("\n"), /Iteration N \(RED\)/u);
    assert.match(result.output.join("\n"), /at least three pressures/u);
    assert.match(result.output.join("\n"), /verbatim rationalisation/u);
  });

  it("rejects RED receipts whose fields describe success instead of failure", async () => {
    const projectRoot = makeTempProject();
    const name = "pg-index-fake-red";
    const logDirectory = join(projectRoot, ".goat-flow", "logs", "sessions");
    const redLogPath = join(logDirectory, `2026-07-17-${name}-tdd.md`);
    mkdirSync(logDirectory, { recursive: true });
    writeFileSync(
      redLogPath,
      `# Skill TDD: ${name}

## Iteration 1 (RED)
Pressures applied: foo, foo, foo
Agent behaviour: did not fail and complied fully
Rationalisations captured (verbatim):
- none
`,
    );

    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name,
      redLogPath,
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.written, false);
    assert.ok(!existsSync(result.proposedPath ?? ""));
    assert.match(result.output.join("\n"), /concrete `Scenario:`/u);
    assert.match(
      result.output.join("\n"),
      /three distinct documented pressures/u,
    );
    assert.match(result.output.join("\n"), /explicit failure outcome/u);
    assert.match(result.output.join("\n"), /quoted verbatim rationalisation/u);
  });

  it("rejects negated RED evidence that includes canonical tokens", async () => {
    const projectRoot = makeTempProject();
    const name = "pg-index-negated-red";
    const logDirectory = join(projectRoot, ".goat-flow", "logs", "sessions");
    const redLogPath = join(logDirectory, `2026-07-17-${name}-tdd.md`);
    mkdirSync(logDirectory, { recursive: true });
    writeFileSync(
      redLogPath,
      `# Skill TDD: ${name}

## Iteration 1 (RED)
Scenario: The agent complied; no failure was observed.
Pressures applied: no time pressure, no authority pressure, no pragmatic pressure
Agent behaviour: failed? no; the agent complied fully
Rationalisations captured (verbatim):
- "none observed because it complied"
`,
    );

    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name,
      redLogPath,
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.written, false);
    assert.ok(!existsSync(result.proposedPath ?? ""));
    assert.match(
      result.output.join("\n"),
      /three distinct documented pressures/u,
    );
    assert.match(result.output.join("\n"), /explicit failure outcome/u);
    assert.match(result.output.join("\n"), /quoted verbatim rationalisation/u);
  });

  it("rejects alternate absence claims after canonical RED labels", async () => {
    const projectRoot = makeTempProject();
    const name = "pg-index-absent-red";
    const logDirectory = join(projectRoot, ".goat-flow", "logs", "sessions");
    const redLogPath = join(logDirectory, `2026-07-17-${name}-tdd.md`);
    mkdirSync(logDirectory, { recursive: true });
    writeFileSync(
      redLogPath,
      `# Skill TDD: ${name}

## Iteration 1 (RED)
Scenario: All required labels are present, but no failure occurred.
Pressures applied: time: no pressure, authority: none, pragmatic: absent
Agent behaviour: failed: false; completed successfully
Rationalisations captured (verbatim):
- "No rationalisation occurred."
`,
    );

    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name,
      redLogPath,
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.written, false);
    assert.ok(!existsSync(result.proposedPath ?? ""));
    assert.match(
      result.output.join("\n"),
      /three distinct documented pressures/u,
    );
    assert.match(result.output.join("\n"), /explicit failure outcome/u);
    assert.match(result.output.join("\n"), /quoted verbatim rationalisation/u);
  });

  it("accepts positive pressure details and a substantive no-prefixed rationalisation", async () => {
    const projectRoot = makeTempProject();
    const name = "pg-index-positive-red";
    const logDirectory = join(projectRoot, ".goat-flow", "logs", "sessions");
    const redLogPath = join(logDirectory, `2026-07-17-${name}-tdd.md`);
    mkdirSync(logDirectory, { recursive: true });
    writeFileSync(
      redLogPath,
      `# Skill TDD: ${name}

## Iteration 1 (RED)
Scenario: The author was asked to skip the failing-first run.
Pressures applied: time pressure, authority: lead requested speed, pragmatic pressure
Agent behaviour: failed by skipping the required RED run
Rationalisations captured (verbatim):
- "No time for tests; ship it."
`,
    );

    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name,
      redLogPath,
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.written, true);
    assertExists(result.proposedPath);
    assert.ok(existsSync(result.proposedPath));
  });

  it("does not borrow proof fields from a later non-RED section", async () => {
    const projectRoot = makeTempProject();
    const name = "pg-index-wrong-section";
    const logDirectory = join(projectRoot, ".goat-flow", "logs", "sessions");
    const redLogPath = join(logDirectory, `2026-07-17-${name}-tdd.md`);
    mkdirSync(logDirectory, { recursive: true });
    writeFileSync(
      redLogPath,
      `# Skill TDD: ${name}

## Iteration 1 (RED)
Notes: No scenario was run.

## Iteration 2 (GREEN)
Scenario: A later run that cannot prove RED.
Pressures applied: time, authority, pragmatic
Agent behaviour: skipped the required check
Rationalisations captured (verbatim):
- "The later section is enough."
`,
    );

    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name,
      redLogPath,
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.written, false);
    assert.ok(!existsSync(result.proposedPath ?? ""));
    assert.match(result.output.join("\n"), /concrete `Scenario:`/u);
  });

  it("reports a non-file RED receipt without throwing a fatal filesystem error", async () => {
    const projectRoot = makeTempProject();
    const name = "pg-index-directory-red";
    const redLogPath = join(
      projectRoot,
      ".goat-flow",
      "logs",
      "sessions",
      `2026-07-17-${name}-tdd.md`,
    );
    mkdirSync(redLogPath, { recursive: true });

    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name,
      redLogPath,
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });

    assert.equal(result.written, false);
    assert.match(result.output.join("\n"), /regular file/u);
  });

  it("scaffolds a workflow SKILL.md when the description is workflow-shaped", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name: "pg-index",
      redLogPath: writeRedLog(projectRoot, "pg-index"),
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

  it("routes workflow skill scaffolds through the selected agent profile", async () => {
    const cases = [
      { agent: undefined, expectedDirectory: ".claude/skills" },
      { agent: "claude" as const, expectedDirectory: ".claude/skills" },
      { agent: "codex" as const, expectedDirectory: ".agents/skills" },
      { agent: "antigravity" as const, expectedDirectory: ".agents/skills" },
      { agent: "copilot" as const, expectedDirectory: ".github/skills" },
    ];

    for (const { agent, expectedDirectory } of cases) {
      const projectRoot = makeTempProject();
      const name = `pg-index-${agent ?? "default"}`;
      const result = await runSkillNew({
        description:
          "I want a workflow that walks through Postgres index changes.",
        name,
        agent,
        redLogPath: writeRedLog(projectRoot, name),
        shouldSkipConfirm: true,
        projectRoot,
        stdinAnswers: [],
      });

      assert.equal(result.written, true);
      assertExists(result.proposedPath);
      assert.ok(
        result.proposedPath.includes(`/${expectedDirectory}/`),
        `${agent ?? "default"}: ${result.proposedPath}`,
      );
      assert.ok(existsSync(result.proposedPath));
    }
  });

  it("scaffolds a report skill for audit-shaped descriptions without writes", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description: "I want to audit Postgres queries before deploy.",
      name: "pg-audit",
      redLogPath: writeRedLog(projectRoot, "pg-audit"),
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
    assert.match(content, /goat-flow-ownership: "user-owned"/);
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
      agent: "codex",
      redLogPath: writeRedLog(projectRoot, "pg-index-no"),
      projectRoot,
      stdinAnswers: ["n"],
    });

    assert.equal(result.candidacy.recommendedArtifact.type, "skill");
    assert.equal(result.written, false);
    assertExists(result.proposedPath);
    assert.ok(result.proposedPath.includes("/.agents/skills/"));
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

  it("defers scoring for an untouched scaffold and returns the Skill TDD handoff", async () => {
    const projectRoot = makeTempProject();
    const result = await runSkillNew({
      description:
        "I want a workflow that walks through Postgres index changes.",
      name: "pg-index-score",
      redLogPath: writeRedLog(projectRoot, "pg-index-score"),
      shouldSkipConfirm: true,
      projectRoot,
      stdinAnswers: [],
    });
    assert.ok(result.written);
    assert.equal(result.postScaffoldScore, null);
    assert.ok(
      result.output.some((line) =>
        line.includes(
          "Scoring deferred until GREEN, REFACTOR, and STAY GREEN have run",
        ),
      ),
    );
    assert.doesNotMatch(result.output.join("\n"), /\b\d+\/\d+\b/u);
    assert.deepEqual(result.nextSteps, [
      "Use the accepted RED evidence in .goat-flow/logs/sessions/2026-07-17-pg-index-score-tdd.md.",
      "Replace scaffold placeholders only to close failures captured during RED.",
      "Run GREEN, REFACTOR, and STAY GREEN from .goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md before scoring.",
      "Complete .goat-flow/skill-docs/skill-quality-testing/deployment.md before merge.",
    ]);
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

    await assert.rejects(
      runSkillNew({
        draftPath: join(projectRoot, "draft.md"),
        redLogPath: join(projectRoot, "red.md"),
        projectRoot,
        stdinAnswers: [],
      }),
      (err) =>
        err instanceof SkillNewInputError &&
        /--red-log is not valid with --draft/.test(err.message),
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

  // Fixture purpose: creates same-name agent copies to ensure selected-agent draft scoring reads the requested SKILL.md.
  it("scores a substantive Codex SKILL.md draft without reading a same-name Claude copy", async () => {
    const projectRoot = makeTempProject();
    const name = "shared-draft";
    const codexDraftPath = join(
      projectRoot,
      ".agents",
      "skills",
      name,
      "SKILL.md",
    );
    mkdirSync(join(projectRoot, ".agents", "skills", name), {
      recursive: true,
    });
    writeFileSync(
      codexDraftPath,
      [
        "---",
        `name: ${name}`,
        'description: "Use when reviewing database changes."',
        'goat-flow-skill-version: "1.14.0"',
        "---",
        `# /${name}`,
        "## When to Use",
        "Use when reviewing database changes.",
        "NOT this skill: unrelated work.",
        "## Step 0",
        "Read current target files and declare scope.",
        "## Phase 1",
        "Trace callers and record evidence.",
        "## Verification",
        "- [ ] Cite file plus semantic anchor.",
        "- [ ] Record literal command output.",
      ].join("\n"),
    );

    const baseline = await runSkillNew({
      agent: "codex",
      draftPath: codexDraftPath,
      projectRoot,
      stdinAnswers: [],
    });
    assert.equal(baseline.proposedPath, codexDraftPath);
    assertExists(baseline.postScaffoldScore);
    assert.equal(
      baseline.candidacy.nextSteps[0]?.action,
      "Place under .agents/skills/<name>/SKILL.md",
    );

    const claudeDraftPath = join(
      projectRoot,
      ".claude",
      "skills",
      name,
      "SKILL.md",
    );
    mkdirSync(join(projectRoot, ".claude", "skills", name), {
      recursive: true,
    });
    writeFileSync(
      claudeDraftPath,
      [
        "---",
        `name: ${name}`,
        'description: "Use when x."',
        "---",
        `# /${name}`,
      ].join("\n"),
    );

    const withClaudeCopy = await runSkillNew({
      agent: "codex",
      draftPath: codexDraftPath,
      projectRoot,
      stdinAnswers: [],
    });
    assert.equal(withClaudeCopy.proposedPath, codexDraftPath);
    assert.equal(
      withClaudeCopy.candidacy.nextSteps[0]?.action,
      "Place under .agents/skills/<name>/SKILL.md",
    );
    assert.deepEqual(
      withClaudeCopy.postScaffoldScore,
      baseline.postScaffoldScore,
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
      redLogPath: writeRedLog(projectRoot, "pg-interactive"),
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
