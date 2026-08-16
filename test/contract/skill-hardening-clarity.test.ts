/**
 * Contracts for goat-clarity's bounded code-remediation workflow.
 * The source is read directly so the first run fails until the canonical skill exists.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertForEachTarget,
  installedSkillPaths,
  installedSkillReferencePaths,
  readMarkdownSection,
  readProjectFile,
} from "./skill-hardening.helpers.js";

const SKILL_PATH = "workflow/skills/goat-clarity/SKILL.md";
const SCOPE_REFERENCE_PATH =
  "workflow/skills/goat-clarity/references/target-scope-and-evidence.md";
const clarityGuidance = readProjectFile(SKILL_PATH);

/**
 * Match load-bearing phrases without coupling contracts to Markdown wrapping or capitalisation.
 *
 * @param guidance - user-facing guidance under contract
 * @param sourcePath - repository-relative path used in assertion failures
 * @param requiredPhrases - phrases that the installed workflow must retain
 */
function assertGuidanceIncludesAll(
  guidance: string,
  sourcePath: string,
  requiredPhrases: readonly string[],
): void {
  const normalizedGuidance = guidance.replace(/\s+/gu, " ").toLowerCase();

  for (const requiredPhrase of requiredPhrases) {
    const normalizedPhrase = requiredPhrase.replace(/\s+/gu, " ").toLowerCase();
    assert.ok(
      normalizedGuidance.includes(normalizedPhrase),
      `${sourcePath}: missing ${requiredPhrase}`,
    );
  }
}

/** Match load-bearing phrases in the canonical goat-clarity skill. */
function assertIncludesAll(requiredPhrases: readonly string[]): void {
  assertGuidanceIncludesAll(clarityGuidance, SKILL_PATH, requiredPhrases);
}

describe("skill hardening contracts: goat-clarity", () => {
  it("keeps four selectors and adds documentation as an explicit mode", () => {
    assertIncludesAll([
      "/goat-clarity <GitHub PR URL>",
      "/goat-clarity uncommitted files",
      "/goat-clarity <folder path>",
      "/goat-clarity <file path>",
      "/goat-clarity documentation <GitHub PR URL | uncommitted files | folder | file>",
      "documentation is a mode over the same four selectors, not a fifth selector",
      "a bare documentation path never becomes writable",
      "exactly one supported selector",
      "ask for one selector when none is supplied",
      "refuse multiple or ambiguous selectors",
    ]);
  });

  it("classifies every selected unit before freezing write authority", () => {
    assertIncludesAll([
      "source code",
      "test source",
      "human documentation",
      "agent-control or protected",
      "generated, binary, or unsupported",
      "most restrictive applicable class wins",
      "classification ambiguity fails closed",
      "context-only documentation is always read-only",
      "agent-control surfaces are never style-remediated",
      "Agent-control includes instruction files, skills, playbooks, shared agent references, prompt templates, workflow plans, machine-readable manifests or schemas, and hook or agent-generated control output",
    ]);
  });

  it("protects test meaning while allowing bounded clarity edits", () => {
    assertIncludesAll([
      "test-source comments and private names",
      "assertions, fixtures, snapshots, expected output, test level, coverage, and meaning remain protected",
    ]);
  });

  it("reports test-value dispositions without mutating test meaning", () => {
    assertIncludesAll([
      "test-value pass",
      "For a PR or uncommitted selector, assess every added, removed, or materially changed test case",
      "For a folder or file selector, assess every test case in selected test-source units",
      "four-part value gate",
      "plausible regression",
      "user or business impact",
      "current overlap",
      "stable observable contract",
      "KEEP",
      "CONSOLIDATE",
      "MOVE LEVEL",
      "PRUNE CANDIDATE",
      "UNRESOLVED",
      "one row per assessed existing test",
      "assessed_existing = KEEP + CONSOLIDATE + MOVE LEVEL + PRUNE CANDIDATE + UNRESOLVED",
      "report-only",
      "no replacement is required",
      "keep the original until replacement coverage passes",
    ]);

    const targetEvidence = readProjectFile(SCOPE_REFERENCE_PATH);
    assertGuidanceIncludesAll(targetEvidence, SCOPE_REFERENCE_PATH, [
      "test-case manifest checkpoint",
      "Before broader clarity diagnosis, enumerate every in-scope test case",
      "expected case count",
      "no more than 20 cases",
      "filter provider data before it reaches the evidence response",
      "batch_expected = KEEP + CONSOLIDATE + MOVE LEVEL + PRUNE CANDIDATE + UNRESOLVED",
      "every case must reconcile",
      "reserve the final provider lookup for head-drift revalidation",
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
      "Formatter check:",
      "Formatter write:",
      "membership drift",
    ]);
  });

  it("fails closed on unsupported path state and keeps remote PR diagnosis read-only", () => {
    assertIncludesAll([
      "unmerged state",
      "direct symlink selector",
      "never follow symlinks",
      "zero eligible source files",
      "outside the repository",
      "binary or generated",
      "PR_FEEDBACK_NOT_CHECKED",
    ]);

    const targetEvidence = readProjectFile(SCOPE_REFERENCE_PATH);
    assertGuidanceIncludesAll(targetEvidence, SCOPE_REFERENCE_PATH, [
      "remote report-only",
      "local repository or head does not match",
      "writable paths are empty",
      "provider repository, base, and head identifiers",
      "revalidate the PR head",
      "formatter proof `NOT_CHECKED`",
      "runtime verification `NOT_RUN`",
      "matching local repository and head before mutation",
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

  it("does not invent catch explanations to satisfy comment coverage", () => {
    assertIncludesAll([
      "never add a catch comment merely because a catch exists",
      "exact cause and next reader-visible state",
      "leave it comment-free",
      "record the evidence gap",
    ]);
  });

  it("keeps safe edits separate from scope expansion", () => {
    assertIncludesAll([
      "Safe apply",
      "Scope v2",
      "exact writable paths for an already-permitted clarity operation",
      "one public or exported identifier rename",
      "mechanical reference updates",
      "signature shape",
      "persisted data",
      "compatibility or migration",
      "test meaning",
      "Target Scope Snapshot v2",
      "wait for explicit approval",
      "preserve observable behaviour",
      "whitespace-only churn",
    ]);
  });

  it("keeps permanent prohibitions global after Scope v2 approval", () => {
    const boundaryCommands = readMarkdownSection(
      SKILL_PATH,
      "Boundary Commands",
    );
    assertGuidanceIncludesAll(boundaryCommands, SKILL_PATH, [
      "in every scope",
      "behaviour",
      "signature shape",
      "serialization",
      "persisted data",
      "compatibility or migration",
      "test meaning",
      "a public or exported contract",
      "except the one Scope v2 identifier-spelling exception",
      "Git state",
      "remote state",
    ]);
    assert.doesNotMatch(
      boundaryCommands,
      /under the initial scope/iu,
      `${SKILL_PATH}: permanent prohibitions cannot expire after Snapshot v1`,
    );
  });

  it("keeps Scope v2 blocking for delegated runs", () => {
    assertIncludesAll([
      "Scope v2 remains a blocking human gate in sub-agent mode",
      "return to the invoking agent without writes",
      "freeze Target Scope Snapshot v2 before mutation",
    ]);

    for (const conventionsPath of [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ]) {
      assertGuidanceIncludesAll(
        readProjectFile(conventionsPath),
        conventionsPath,
        [
          "goat-clarity Scope v2",
          "MUST remain blocking even in sub-agent mode",
        ],
      );
    }
  });

  it("routes owners from a closed per-unit matrix", () => {
    assertIncludesAll([
      "per-unit owner routing matrix",
      "load an owner only when at least one classified unit meets its condition",
      "do not load every clarity owner unconditionally",
      "naming-and-placement.md",
      "code-comments.md",
      "gruff-code-quality.md",
      "test-selection.md",
      "writing-style.md",
      ".goat-flow/glossary.md",
    ]);
    assert.doesNotMatch(
      clarityGuidance,
      /After project authority, load these owners/iu,
      `${SKILL_PATH}: unconditional owner loading must not return`,
    );
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

  it("binds PR authority to the repository containing the invocation", () => {
    assertIncludesAll([
      "repository root resolved from the invocation working directory",
      "never search parent, child, sibling, scratchpad, or cached repositories",
      "matching local repository and head before mutation",
      "remote report-only",
    ]);
  });

  it("freezes repository formatter commands and proof before mutation", () => {
    assert.match(
      clarityGuidance,
      /Target Scope Snapshot[\s\S]*Baseline proof:[^\n]*\nFormatter check:[^\n]*\nFormatter write:[^\n]*[\s\S]*\*\*CHECKPOINT:\*\*/u,
      `${SKILL_PATH}: formatter commands must be part of the pre-mutation snapshot`,
    );

    assertIncludesAll([
      "resolve the exact repository-owned formatter check and write commands",
      "run the frozen formatter check before mutation",
      "rerun the frozen formatter check before typecheck, tests, or Gruff",
      "never substitutes for formatter proof",
    ]);
  });

  it("uses drift-safe selector inventories and content identity", () => {
    const targetEvidence = readProjectFile(SCOPE_REFERENCE_PATH);
    assertGuidanceIncludesAll(targetEvidence, SCOPE_REFERENCE_PATH, [
      "reconcile the complete paginated PR path count",
      "NUL-delimited",
      "never parse paths by newline",
      "bound recursive folder inventory to the canonical selected directory",
      "a file selector remains exactly one canonical file",
      "content digest",
      "file type",
      "containment",
      "before every edit batch",
      "drift stops mutation",
    ]);
  });

  it("discovers formatter capability without executing discovery candidates", () => {
    const targetEvidence = readProjectFile(SCOPE_REFERENCE_PATH);
    assertGuidanceIncludesAll(targetEvidence, SCOPE_REFERENCE_PATH, [
      "formatter discovery is read-only",
      "never execute a package resolver, package manager, formatter, or project script merely to discover a command",
      "READY",
      "NOT_FOUND",
      "AMBIGUOUS",
      "preserve repository-owned flags",
      "scope the command to formatter-owned writable paths",
    ]);
  });

  it("separates command status from claim verdict", () => {
    const targetEvidence = readProjectFile(SCOPE_REFERENCE_PATH);
    assertGuidanceIncludesAll(targetEvidence, SCOPE_REFERENCE_PATH, [
      "Command status",
      "PASS | FAIL | NOT_RUN | UNAVAILABLE",
      "Claim verdict",
      "VERIFIED | REFUTED | NOT_CHECKED",
      "a passing command never makes an untested claim verified",
      "Shared proof-class tag",
      "OBSERVED | INFERRED | UNVERIFIED | HUMAN-PENDING",
    ]);
  });

  it("reconciles separate like-unit ledgers without fixing presentation", () => {
    const targetEvidence = readProjectFile(SCOPE_REFERENCE_PATH);
    assertGuidanceIncludesAll(targetEvidence, SCOPE_REFERENCE_PATH, [
      "selected-unit ledger",
      "changed-span ledger",
      "command-evidence ledger",
      "diagnosed finding or explicitly reported formatter-owned reflow",
      "never add unlike units",
      "receipt meanings are stable but headings and presentation may vary",
      "no JSON schema is promised",
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
      "Formatter proof:",
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
      "receipt without Formatter proof is incomplete",
      "Agent: <claude | codex | antigravity | copilot>",
      "Selector: <github-pr | uncommitted | folder | file>",
    ]);
  });

  it("keeps the skill, reference, manifest, and public documentation aligned", () => {
    assertForEachTarget(installedSkillPaths("goat-clarity"), (skillPath) => {
      assert.equal(readProjectFile(skillPath), clarityGuidance, skillPath);
    });

    const targetEvidence = readProjectFile(SCOPE_REFERENCE_PATH);
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-clarity",
        "references/target-scope-and-evidence.md",
      ),
      (referencePath) => {
        assert.equal(
          readProjectFile(referencePath),
          targetEvidence,
          referencePath,
        );
      },
    );

    const manifest = JSON.parse(readProjectFile("workflow/manifest.json")) as {
      skills: { references: Record<string, string[]> };
    };
    assert.deepEqual(manifest.skills.references["goat-clarity"], [
      "references/target-scope-and-evidence.md",
    ]);

    const publicGuidance = readMarkdownSection(
      "docs/skills.md",
      "/goat-clarity",
    );
    assertGuidanceIncludesAll(publicGuidance, "docs/skills.md", [
      "/goat-clarity documentation <GitHub PR URL | uncommitted files | folder | file>",
      "most restrictive applicable class wins",
      "one public/exported identifier rename plus mechanical references",
      "selected-unit, changed-span, and command-evidence ledgers",
      "remote report-only",
      "test-selection record",
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
