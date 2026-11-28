/**
 * Pin goat-critique's planning-intake entry: an interview that settles a plan's open choices without weakening artifact critique.
 *
 * Users get short, adaptive questions and a plan written from their answers, while a concrete artifact still gets the full
 * delegated critique. Live behaviour is proven by registered skill trials, not by these checks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assertForEachTarget,
  assertMatchesAll,
  readMarkdownSection,
  readProjectFile,
} from "./skill-hardening.helpers.js";

const CRITIQUE_ROOTS = [
  "workflow/skills/goat-critique",
  ".agents/skills/goat-critique",
  ".claude/skills/goat-critique",
  ".github/skills/goat-critique",
] as const;

const DISPATCHER_PATHS = [
  "workflow/skills/goat/SKILL.md",
  ".agents/skills/goat/SKILL.md",
  ".claude/skills/goat/SKILL.md",
  ".github/skills/goat/SKILL.md",
] as const;

const CONVENTIONS_PATHS = [
  "workflow/skills/reference/skill-conventions.md",
  ".goat-flow/skill-docs/skill-conventions.md",
] as const;

describe("goat-critique planning intake", () => {
  it("selects intake only for planning requests and keeps artifact critique fully delegated", () => {
    // Every installed copy is what a user's agent loads, so each must separate intake from critique.
    assertForEachTarget(CRITIQUE_ROOTS, (root) => {
      const skillPath = `${root}/SKILL.md`;
      assertMatchesAll(
        readMarkdownSection(skillPath, "Planning Intake"),
        [
          /A request to be interviewed for a plan, or to check an existing plan for stale facts, selects planning intake instead of critique/iu,
          /spawns no critics, gives no critique verdict and hands answers to goat-plan/iu,
          /read `references\/interactive-intake\.md` and follow it/iu,
          /ask one short question before assuming plan-writing authority/iu,
          /A concrete artifact with no planning request goes to Step 0 for full delegated critique/iu,
        ],
        skillPath,
      );
      // Every sub-agent, forked or not, hands the critique lifecycle back to the host before Phase 1.
      assertMatchesAll(
        readMarkdownSection(skillPath, "Step 0 - Intake"),
        [
          /goat-critique runs only full delegated mode/iu,
          /Any sub-agent, including a forked sub-agent, returns control before Phase 1/iu,
          /it never spawns the critics itself/iu,
        ],
        skillPath,
      );
      // The single-mode rules govern critique; an unscoped absolute would contradict the intake entry.
      assertMatchesAll(
        readMarkdownSection(skillPath, "Constraints"),
        [
          /Critique MUST run in one mode: full delegated/iu,
          /IS consent to spawn sub-agents and the full protocol for critique/iu,
        ],
        skillPath,
      );
    });
  });

  it("asks adaptive batches of short choices and never answers for the user", () => {
    const canonical = readProjectFile(
      "workflow/skills/goat-critique/references/interactive-intake.md",
    );
    assertForEachTarget(CRITIQUE_ROOTS, (root) => {
      const referencePath = `${root}/references/interactive-intake.md`;
      const content = readProjectFile(referencePath);
      assert.equal(
        content,
        canonical,
        `${referencePath} drifted from the canonical reference`,
      );
      assertMatchesAll(
        readMarkdownSection(referencePath, "Ask"),
        [
          /Skip every point the request, brief, plan or earlier answers already settle/iu,
          /three to five questions per message, normally five to twenty in total/iu,
          /there is no minimum/iu,
          /three short choices, the recommended one first and marked, and room for the user's own answer/iu,
          /Never guess a blocking choice to fill the gap; list it as open/iu,
          /A preselected or unsubmitted default is not an answer/iu,
          /return the current batch as the final answer and stop\. Never answer for the user/iu,
        ],
        referencePath,
      );
      assert.match(
        content,
        /Never open with a question about which depth to use/iu,
        referencePath,
      );
    });
  });

  it("checks an existing plan's facts without critiquing it", () => {
    assertForEachTarget(CRITIQUE_ROOTS, (root) => {
      const referencePath = `${root}/references/interactive-intake.md`;
      assertMatchesAll(
        readMarkdownSection(referencePath, "Check an Existing Plan"),
        [
          /This is a quick factual pass, not a critique/iu,
          /Resolve every cited path and search anchor against the current revision/iu,
          /Recompute stated totals from their parts/iu,
          /Compare dated facts and named dependencies with today's date and the plan folder/iu,
          /leave correct facts alone/iu,
          /When the user requests no questions, list open choices and stop/iu,
          /If the request did not ask for updates, also ask whether to apply them/iu,
          /The named plan's files are the only update target/iu,
        ],
        referencePath,
      );
    });
  });

  it("hands answers to goat-plan without widening authority", () => {
    assertForEachTarget(CRITIQUE_ROOTS, (root) => {
      const referencePath = `${root}/references/interactive-intake.md`;
      assertMatchesAll(
        readMarkdownSection(referencePath, "Hand Off to goat-plan"),
        [
          /each still-open choice, marked open/iu,
          /the write authority the request already carries, plus any update the user's reply explicitly approved/iu,
          /\*\*Writes forbidden:\*\* Read-Only Analysis, even with a named destination/iu,
          /\*\*A new plan with a named destination and write authority:\*\* File-Write mode at that destination/iu,
          /\*\*An existing plan:\*\* Named-File Update of the checked files when the request asks for updates or the user's reply explicitly approves them; otherwise Read-Only Analysis/iu,
          /\*\*Otherwise:\*\* Read-Only Analysis, with the plan presented inline/iu,
          /Answers to choice questions never widen authority; only an explicit approval in the user's reply adds an update/iu,
          /A plan-only request stops after the plan is delivered, and nothing is implemented/iu,
        ],
        referencePath,
      );
    });
  });

  it("registers the intake reference", () => {
    const manifest = JSON.parse(readProjectFile("workflow/manifest.json")) as {
      skills: { references: Record<string, string[]> };
    };
    assert.ok(
      manifest.skills.references["goat-critique"].includes(
        "references/interactive-intake.md",
      ),
      "manifest misses goat-critique references/interactive-intake.md",
    );
  });
});

describe("planning intake outside the critique skill", () => {
  it("exempts critique intake from the shared three-question default", () => {
    // The shared default still governs other skills; only critique intake gets the larger adaptive budget.
    assertForEachTarget(CONVENTIONS_PATHS, (conventionsPath) => {
      assertMatchesAll(
        readMarkdownSection(conventionsPath, "Adaptive Step 0"),
        [
          /no more than three per message or three rounds/iu,
          /goat-critique planning intake uses its own adaptive budget, normally five to twenty questions in batches of three to five/iu,
        ],
        conventionsPath,
      );
    });
  });

  it("routes planning interviews to goat-critique", () => {
    assertForEachTarget(DISPATCHER_PATHS, (dispatcherPath) => {
      assert.match(
        readMarkdownSection(dispatcherPath, "Route Map"),
        /\| Multi-perspective critique; planning interview \| `\/goat-critique` \|/iu,
        dispatcherPath,
      );
    });
  });

  it("records planning intake as an amendment to the full-mode decision", () => {
    const adrPath =
      ".goat-flow/learning-loop/decisions/ADR-021-goat-critique-full-mode-only.md";
    assertMatchesAll(
      readMarkdownSection(adrPath, "Decision"),
      [
        /goat-critique runs in one mode: full delegated/iu,
        /Planning intake is a separate entry, not a critique mode/iu,
        /spawns no critics, gives no critique verdict and hands the answers to goat-plan/iu,
      ],
      adrPath,
    );
  });

  it("describes planning intake in the public skill guide", () => {
    const docsPath = "docs/skills.md";
    assertMatchesAll(
      readMarkdownSection(docsPath, "/goat-critique"),
      [
        /\*\*Planning intake\*\*/iu,
        /checks the plan's cited paths and search anchors against the current code, recomputes its totals from their parts and compares its dates and dependencies with today and the plan folder/iu,
      ],
      docsPath,
    );
  });
});
