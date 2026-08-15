/**
 * Contracts for goat-clarity's bounded code-remediation workflow.
 * The source is read directly so the first run fails until the canonical skill exists.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readProjectFile } from "./skill-hardening.helpers.js";

const SKILL_PATH = "workflow/skills/goat-clarity/SKILL.md";
const clarityGuidance = readProjectFile(SKILL_PATH);

/**
 * Match load-bearing phrases without coupling the contract to Markdown wrapping or capitalisation.
 *
 * @param requiredPhrases - phrases that the installed workflow must retain
 */
function assertIncludesAll(requiredPhrases: readonly string[]): void {
  const normalizedGuidance = clarityGuidance
    .replace(/\s+/gu, " ")
    .toLowerCase();

  for (const requiredPhrase of requiredPhrases) {
    const normalizedPhrase = requiredPhrase.replace(/\s+/gu, " ").toLowerCase();
    assert.ok(
      normalizedGuidance.includes(normalizedPhrase),
      `${SKILL_PATH}: missing ${requiredPhrase}`,
    );
  }
}

describe("skill hardening contracts: goat-clarity", () => {
  it("accepts exactly four direct selector forms", () => {
    assertIncludesAll([
      "/goat-clarity <GitHub PR URL>",
      "/goat-clarity uncommitted files",
      "/goat-clarity <folder path>",
      "/goat-clarity <file path>",
      "exactly one supported selector",
      "ask for one selector when none is supplied",
      "refuse multiple or ambiguous selectors",
    ]);
  });

  it("freezes selector authority before any write", () => {
    assertIncludesAll([
      "Target Scope Snapshot",
      "Identity:",
      "Writable paths:",
      "Exclusions:",
      "Unknowns:",
      "Read-only context:",
      "Baseline proof:",
      "membership drift",
    ]);
  });

  it("fails closed on unsupported repository and path state", () => {
    assertIncludesAll([
      "unmerged state",
      "direct symlink selector",
      "never follow symlinks",
      "zero eligible source files",
      "outside the repository",
      "binary or generated",
      "local repository and head",
      "PR_FEEDBACK_NOT_CHECKED",
    ]);
  });

  it("loads project authority and every clarity owner", () => {
    assertIncludesAll([
      "Project authority",
      "code-comments.md",
      "naming-and-placement.md",
      "gruff-code-quality.md",
      "test-selection.md",
      "writing-style.md",
      ".goat-flow/glossary.md",
      "Naming and placement before comments",
    ]);
  });

  it("binds naming and comments to verified reader consequences", () => {
    assertIncludesAll([
      "UI, caller, or operator reader",
      "domain, repository, or infrastructure layer",
      "verify what each name promises",
      "local or private rename",
      "journey anchors",
      "branch, loop, and null/empty consequences",
      "catch cause and next visible state",
      "current contract, never history",
      "compliant incumbent",
    ]);
  });

  it("requires an evidence-backed defect before rewriting an incumbent", () => {
    assertIncludesAll([
      "name the incumbent's concrete false, missing, or misleading claim",
      "preference for different synonyms",
      "keep its bytes",
    ]);
  });

  it("keeps safe edits separate from scope expansion", () => {
    assertIncludesAll([
      "Safe apply",
      "Scope v2",
      "new writable path",
      "public or exported",
      "signature, serialization, behaviour, compatibility, or test change",
      "wait for explicit approval",
      "preserve observable behaviour",
      "whitespace-only churn",
    ]);
  });

  it("keeps pull-request evidence read-only and untrusted", () => {
    assertIncludesAll([
      "untrusted claims",
      "authenticated, read-only GitHub access",
      "never change branch, index, worktree membership, or remote state",
      "checkout, stage, commit, push, fetch, reset",
      "edit, comment, review, merge, close, reopen, or mark ready",
    ]);
  });

  it("returns a complete but proportional remediation receipt", () => {
    for (const receiptLabel of [
      "Agent:",
      "Selector:",
      "Snapshot:",
      "Write paths:",
      "Modified:",
      "Compliant unchanged:",
      "Deferred:",
      "Excluded:",
      "Inaccessible:",
      "NOT_CHECKED:",
      "Verification:",
      "Summary:",
    ]) {
      assert.match(clarityGuidance, new RegExp(receiptLabel, "u"), SKILL_PATH);
    }

    assertIncludesAll([
      "every selected unit",
      "no diagnosed findings",
      "compact summary",
      "literal verification results",
      "Agent: <claude | codex | antigravity | copilot>",
      "Selector: <github-pr | uncommitted | folder | file>",
    ]);
  });

  it("routes adjacent work without becoming a review or redesign skill", () => {
    assertIncludesAll([
      "goat-review",
      "goat-debug",
      "goat-qa",
      "goat-security",
      "goat-plan",
    ]);

    assert.doesNotMatch(
      clarityGuidance,
      /ADR-[0-9]{3}|skill-goat-clarity(?:_v[0-9]+)?|\.goat-flow\/(?:plans|scratchpad)\//iu,
      `${SKILL_PATH}: source-specific planning or product history leaked into the skill`,
    );
  });
});
