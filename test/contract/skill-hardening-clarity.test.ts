/**
 * Check the scope, evidence, and write rules used by goat-clarity.
 *
 * The contracts read canonical guidance and shared conventions so edits remain bounded by the user’s selected files and intent.
 * Use them when changing clarity intake, delegated work, verification, or its completion receipt.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertForEachTarget,
  installedSkillPaths,
  installedSkillReferencePaths,
  readMarkdownSection,
  readMarkdownSubsection,
  readProjectFile,
} from "./skill-hardening.helpers.js";

const SKILL_PATH = "workflow/skills/goat-clarity/SKILL.md";
const SCOPE_REFERENCE_PATH =
  "workflow/skills/goat-clarity/references/target-scope-and-evidence.md";
const SHARED_PREAMBLE_PATH = "workflow/skills/reference/skill-preamble.md";
// Both shared axes enumerate exactly four tokens: OBSERVED/INFERRED/UNVERIFIED/HUMAN-PENDING and RUNTIME/CONTRACT-GREP/STATIC/NOT-REPRODUCED.
const SHARED_VOCABULARY_TOKEN_COUNT = 4;
const clarityGuidance = readProjectFile(SKILL_PATH);

/**
 * Read the shared vocabulary in definition order so every skill reports the same evidence labels.
 * A renamed or reordered owner token makes a stale consumer fail this contract.
 *
 * @param ownerRegion - one vocabulary's defining text; empty text or missing bold tokens provides no labels
 * @returns labels in definition order; an empty list means the owner supplied no vocabulary to compare
 */
function readOwnerVocabulary(ownerRegion: string): string[] {
  return [...ownerRegion.matchAll(/\*\*([A-Z][A-Z-]+)/gu)].map(
    (tokenMatch) => tokenMatch[1],
  );
}

/**
 * Match required instructions while allowing harmless Markdown wrapping and capitalization changes.
 *
 * @param guidance - agent instructions under contract; empty text fails any required safeguard
 * @param sourcePath - repository-relative path used in assertion failures
 * @param requiredPhrases - instructions the workflow must retain; an empty list performs no checks
 */
function assertGuidanceIncludesAll(
  guidance: string,
  sourcePath: string,
  requiredPhrases: readonly string[],
): void {
  const normalizedGuidance = guidance.replace(/\s+/gu, " ").toLowerCase();

  // Require each instruction independently so one retained phrase cannot hide another missing safeguard.
  for (const requiredPhrase of requiredPhrases) {
    const normalizedPhrase = requiredPhrase.replace(/\s+/gu, " ").toLowerCase();
    assert.ok(
      normalizedGuidance.includes(normalizedPhrase),
      `${sourcePath}: missing ${requiredPhrase}`,
    );
  }
}

/**
 * Check the canonical clarity instructions before an agent uses them for the user's selected target.
 *
 * @param requiredPhrases - required safeguards; an empty list checks no instructions
 */
function assertIncludesAll(requiredPhrases: readonly string[]): void {
  assertGuidanceIncludesAll(clarityGuidance, SKILL_PATH, requiredPhrases);
}

/**
 * Keep the four documentation write-authority rules in first-match order.
 * A report request must withhold writes before the later documentation-keyword rule can grant them.
 *
 * @param sourcePath - repository-relative skill path named in assertion failures
 * @param guidance - normalized lowercase skill text; missing rules, including an empty document, fail the contract
 */
function assertRulePrecedence(sourcePath: string, guidance: string): void {
  const rules: readonly (readonly [string, string])[] = [
    ["explicit write intent", "explicit update/edit/fix instruction grants it"],
    [
      "explicit report intent",
      "explicit report/review/check request withholds it",
    ],
    [
      "documentation keyword",
      "`documentation` keyword before the target grants it",
    ],
    ["unanswered fallback", "defaulting to report only when unanswered"],
  ];
  const offsets = rules.map(([label, phrase]) => {
    const offset = guidance.indexOf(phrase);
    assert.ok(offset >= 0, `${sourcePath}: missing the ${label} rule`);
    return [label, offset] as const;
  });
  // Compare adjacent authority rules so the first applicable user intent controls whether the agent may write.
  for (let index = 1; index < offsets.length; index += 1) {
    const [previousLabel, previousOffset] = offsets[index - 1]!;
    const [label, offset] = offsets[index]!;
    assert.ok(
      previousOffset < offset,
      `${sourcePath}: ${previousLabel} must be resolved before ${label}`,
    );
  }
}

describe("skill hardening contracts: goat-clarity", () => {
  it("runs visible learning-loop retrieval before freezing write authority", () => {
    assertForEachTarget(installedSkillPaths("goat-clarity"), (skillPath) => {
      const stepZero = readMarkdownSection(
        skillPath,
        "Step 0 - Resolve Authority and Target",
      );
      assertGuidanceIncludesAll(stepZero, skillPath, [
        "learning-loop retrieval",
        "Relevant prior learnings:",
      ]);
      assert.ok(
        stepZero.indexOf("Relevant prior learnings:") <
          stepZero.indexOf("Target Scope Snapshot"),
        `${skillPath}: learning-loop receipt must precede the frozen scope snapshot`,
      );
    });
  });

  it("accepts one target form and resolves documentation write authority", () => {
    assertIncludesAll([
      "/goat-clarity <GitHub PR URL>",
      "/goat-clarity uncommitted files",
      "/goat-clarity <one or more folder or file paths>",
      "listed paths form one inventory",
      "cannot be combined with paths",
      "ask for a target when none is supplied",
      "refuse an ambiguous or combined selector",
      "human documentation is read-only until write authority resolves by first match",
      "explicit update/edit/fix instruction grants it",
      "explicit report/review/check request withholds it",
      "Report only, or update the documentation?",
      "defaulting to report only when unanswered, including sub-agent mode",
      "without write authority, documentation is diagnosed and reported, never edited",
    ]);
  });

  it("resolves documentation write authority by first match, intent before keyword", () => {
    assertForEachTarget(
      [SKILL_PATH, ...installedSkillPaths("goat-clarity")],
      (skillPath) => {
        const guidance = readProjectFile(skillPath)
          .replace(/\s+/gu, " ")
          .toLowerCase();
        assertRulePrecedence(skillPath, guidance);
        assert.ok(
          guidance.includes("write authority resolves by first match"),
          `${skillPath}: authority resolution does not declare first-match precedence`,
        );
        // The keyword sharing the write-granting clause is what let documentation wording outrank explicit report intent.
        assert.equal(
          guidance.includes("keyword before the target, or an explicit"),
          false,
          `${skillPath}: the documentation keyword still shares the first grant clause`,
        );
      },
    );
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
      "For a PR or uncommitted selector, assess every added, removed, relocated, or materially changed test case",
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
      "Each assessed test gets one row",
      "report-only",
      "no replacement is required",
      "keeps the original until replacement coverage passes",
      "drop, deletion, restore, or replacement candidates",
      "Before assessing cases, load `.goat-flow/skill-docs/playbooks/test-selection.md` (`Decision Record and Handoff`)",
      "disposition meanings and equations",
      "every existing, added, removed, relocated, and materially changed row",
      "missing proof keeps the matching unresolved disposition",
    ]);
    const testSelectionRecord = readMarkdownSection(
      "workflow/skills/playbooks/test-selection.md",
      "Decision Record and Handoff",
    );
    assertGuidanceIncludesAll(testSelectionRecord, "test-selection.md", [
      "assessed_existing = KEEP + CONSOLIDATE + MOVE LEVEL + PRUNE CANDIDATE + UNRESOLVED",
      "assessed_added = ADDED_KEEP + ADDED_CONSOLIDATE + ADDED_MOVE_LEVEL + ADDED_DROP_CANDIDATE + ADDED_UNRESOLVED",
      "assessed_removed = REMOVAL_SUPPORTED + RESTORE + REPLACE + REMOVAL_UNRESOLVED",
      "assessed_materially_changed = KEEP + CONSOLIDATE + MOVE_LEVEL + PRUNE_CANDIDATE + UNRESOLVED",
      "assessed_relocated = RELOCATED",
      "assessed_pr_or_uncommitted = assessed_added + assessed_removed + assessed_materially_changed + assessed_relocated",
    ]);

    const targetEvidence = readProjectFile(SCOPE_REFERENCE_PATH);
    assertGuidanceIncludesAll(targetEvidence, SCOPE_REFERENCE_PATH, [
      "test-case manifest checkpoint",
      "Before broader clarity diagnosis, enumerate every in-scope test case",
      "expected case count",
      "no more than 20 cases",
      "filter provider data before it reaches the evidence response",
      "batch_expected = KEEP + CONSOLIDATE + MOVE LEVEL + PRUNE CANDIDATE + UNRESOLVED",
      "batch_expected = assessed_added + assessed_removed + assessed_materially_changed",
      "baseline/current presence for a PR or uncommitted selector",
      "relocation mapping",
      "case-level anchor and assertion equivalence",
      "Read removed-test evidence from the bound comparison baseline without fetching or materializing it into the worktree",
      "`UNRESOLVED`, `ADDED UNRESOLVED`, or `REMOVAL UNRESOLVED`",
      "drop, deletion, restore, or replacement recommendation",
      "every case must reconcile",
      "reserve the final provider lookup for head-drift revalidation",
    ]);
  });

  it("routes proven comment or private-name-only selectors around case rows", () => {
    assertForEachTarget(installedSkillPaths("goat-clarity"), (skillPath) => {
      const clarityPass = readMarkdownSection(skillPath, "Clarity Pass");
      const testValuePass = readMarkdownSubsection(
        clarityPass,
        "1. Run the test-value pass",
        skillPath,
      );
      assertGuidanceIncludesAll(testValuePass, skillPath, [
        "For a folder or file selector, assess every test case in selected test-source units unless",
        "selector-driven non-semantic lane",
        "comment/private-name-only equivalence",
        "waives only per-case value and disposition rows",
        "otherwise the full case-level manifest and four-part value gate apply",
      ]);
      assert.ok(
        clarityPass.indexOf(testValuePass) <
          clarityPass.indexOf("### 2. Diagnose naming and placement"),
        `${skillPath}: complete applicable case accounting before broader diagnosis`,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-clarity",
        "references/target-scope-and-evidence.md",
      ),
      (referencePath) => {
        const reference = readProjectFile(referencePath);
        assertGuidanceIncludesAll(reference, referencePath, [
          "selector-driven non-semantic lane",
          "explicit folder or file selector",
          "baseline, current bytes, and explicit request",
          "comments or docstrings, or local or private identifier spelling",
          "test case presence, stable identity, title, registration, and parametrized membership",
          "assertions, expectations, snapshots, and failure semantics",
          "fixture values, setup and teardown, mocks, stubs, fakes, data builders, and environment controls",
          "grouping, execution level, skip or focus state, coverage intent, observable output, and user-visible meaning",
          "a change to any preserved item is semantic and forces the full lane",
          "existing PR or uncommitted diff contains a semantic test change",
          "equivalence is uncertain",
          "full case-level manifest and four-part value gate",
          "selected test-source units, selected spans, baseline and current identity, write set, and focused verification command",
          "reconcile every changed span and prove untouched bytes remain untouched",
          "waives only per-case value and disposition rows",
        ]);
      },
    );

    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-clarity"),
      /every test in selected folder or file test-source units.*except.*comment.*private.*name.*only/isu,
      "docs/skills.md",
    );
  });

  it("uses an authority-aware empty-selection gate", () => {
    assertIncludesAll([
      "when no selected unit is source code, test source, or eligible human documentation",
      "Writable only with documentation write authority when the unit is inside the selected inventory",
      "Classify a named file by its content and role, not its directory",
      "a named ignored file stays in inventory with baseline attribution `NOT_CHECKED`",
      "Without documentation write authority, documentation and READMEs are read-only",
      "with it, only eligible selected human prose changes",
      "With documentation write authority, apply the routed human-prose and surface owners only to eligible human documentation",
    ]);
    const emptyReceipt = readMarkdownSection(
      SCOPE_REFERENCE_PATH,
      "No-eligible-unit Receipt",
    );
    assertGuidanceIncludesAll(emptyReceipt, SCOPE_REFERENCE_PATH, [
      "selector and stop reason",
      "classification and outcome counts",
      "protected-byte evidence",
      "clarity assessment `NOT_CHECKED`",
      "zero writes",
      "skip unrelated owners, formatter discovery, and test-value work",
      "omitted discovery is `NOT_CHECKED`, not `NOT_FOUND`",
      "an empty writable set alone does not select this exit",
    ]);
    assert.doesNotMatch(
      clarityGuidance,
      /zero eligible source files/iu,
      `${SKILL_PATH}: retired mode-agnostic empty-selection gate must not return`,
    );
    assert.doesNotMatch(
      clarityGuidance,
      /exactly one supported selector|refuse multiple or ambiguous selectors|a bare documentation path never becomes writable/iu,
      `${SKILL_PATH}: retired single-selector refusal and keyword-only documentation gate must not return`,
    );
  });

  it("freezes selector authority before any write", () => {
    assertIncludesAll([
      "Target Scope Snapshot",
      "Identity:",
      "Documentation writes: <granted | withheld>",
      "Writable paths:",
      "Read-only/protected:",
      "Exclusions:",
      "Unknowns:",
      "Read-only context:",
      "Baseline proof:",
      "Formatter check:",
      "Formatter write:",
      "Formatter capability:",
      "membership drift",
    ]);
    assert.doesNotMatch(
      clarityGuidance,
      /^Exclusions:.*\b(?:protected|context-only)\b/mu,
      `${SKILL_PATH}: protected selection must not also be counted as excluded`,
    );
  });

  it("binds authority provenance and reconciles the frozen inventory", () => {
    assertIncludesAll([
      "Authority:",
      "Reconciliation: inventory",
      "Pre-existing dirty paths:",
    ]);

    const targetEvidence = readProjectFile(SCOPE_REFERENCE_PATH);
    assertGuidanceIncludesAll(targetEvidence, SCOPE_REFERENCE_PATH, [
      "committed, modified, untracked, or absent",
      "current authority bytes",
      "comparison baseline",
      "semantic authority drift",
      "fails closed",
      "literal integers",
      "commit OID equality",
      "branch names are irrelevant",
      "selected inventory paths",
      "unrelated dirty paths",
      "PR_FEEDBACK_OUT_OF_SCOPE",
      "edit batch",
      "scoped to the frozen writable paths",
    ]);
  });

  it("fails closed on unsupported path state and keeps remote PR diagnosis read-only", () => {
    assertIncludesAll([
      "unmerged state",
      "direct symlink selector",
      "never follow symlinks",
      "outside the repository",
      "PR_FEEDBACK_NOT_CHECKED",
    ]);
    assert.match(
      clarityGuidance,
      /Fail closed on[^.]*\bbinary\b[^.]*\bgenerated content\b/isu,
      `${SKILL_PATH}: fail-closed content classes must stay in one sentence`,
    );

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
      "writing-human-facing-prose.md",
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
      "compliant incumbent",
      "Never cite gitignored paths, local state, or removed symbols",
      "durable contract, removal trigger, or verification path",
    ]);
    const historyException =
      /current compatibility obligation or a checkable removal trigger/u;
    assert.match(
      readProjectFile("workflow/skills/playbooks/code-comments.md"),
      historyException,
    );
    assert.match(clarityGuidance.replace(/\s+/gu, " "), historyException);
    assert.doesNotMatch(clarityGuidance, /never history/u);
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

  it("does not rewrite a false comment to normalize defective behaviour", () => {
    assertIncludesAll([
      "Deferred with reason `BLOCKED-ON-BEHAVIOUR`",
      "preserve the comment bytes",
      "route the reproduced defect to `goat-debug`",
      "expected final shape",
      "every applicable rule",
    ]);
  });

  it("keeps safe edits separate from scope expansion", () => {
    const placementDecision = readMarkdownSection(
      SCOPE_REFERENCE_PATH,
      "Placement Decision",
    );
    assertGuidanceIncludesAll(placementDecision, SCOPE_REFERENCE_PATH, [
      "explicit current user instruction identifies the private symbol and destination",
      "wholly inside one frozen writable file",
      "Safe apply",
      "general clarity request or placement diagnosis alone",
      "cross-file or uncertain placement",
      "Scope v2",
      "public or exported identifier",
      "second approval and per-identifier compatibility disclosure",
      "named-argument parameters, serialized fields or keys",
      "goat-plan",
    ]);
    // Every decision point must use the same placement owner before authorizing a user's requested move.
    for (const section of [
      "0.2 Classify selected units",
      "2. Diagnose naming and placement",
      "Safe apply",
      "Scope v2",
    ]) {
      const sectionStart = clarityGuidance.indexOf(` ${section}\n`);
      assert.ok(sectionStart >= 0, `${SKILL_PATH}: missing ${section}`);
      const decisionPoint = clarityGuidance
        .slice(sectionStart)
        .split(/\n#{2,4} /u)[0];
      assert.ok(
        decisionPoint.includes("Placement Decision"),
        `${SKILL_PATH}: ${section} must route placement to its decision table`,
      );
    }
    assertIncludesAll([
      "Safe apply",
      "Scope v2",
      "exact writable paths for an already-permitted clarity operation",
      "enumerated set of public or exported identifier renames",
      "mechanical reference updates",
      "second approval",
      "initial request does not satisfy",
      "every identifier",
      "exact affected writable paths",
      "per-identifier compatibility impact",
      "one approval covers only that disclosed set",
      "explicit user acceptance for each compatibility break",
      "added identifier needs another Scope v2 gate",
      "signature shape",
      "persisted data",
      "test meaning",
      "Target Scope Snapshot v2",
      "wait for explicit approval",
      "preserve observable behaviour",
      "whitespace-only churn",
    ]);

    assertIncludesAll([
      "public or exported parameter name in a language with named arguments",
      "serialized field, payload key, or returned associative key",
      "route it to `goat-plan`",
    ]);

    assert.doesNotMatch(
      clarityGuidance,
      /Scope v2 cannot approve[^.]*compatibility/isu,
      `${SKILL_PATH}: Scope v2 must not contradict the approved compatibility-break exception`,
    );
    assert.doesNotMatch(
      clarityGuidance,
      /(?:one public or exported identifier rename|second public\/exported rename)/iu,
      `${SKILL_PATH}: Scope v2 must not impose a one-rename ceiling`,
    );
  });

  it("keeps the accepted clarity authority aligned with its public contract", () => {
    const authority = readProjectFile(
      ".goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md",
    );
    assertGuidanceIncludesAll(
      authority,
      ".goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md",
      [
        "enumerated set of public or exported identifier spelling changes",
        "second explicit approval",
        "exact write set",
        "per-identifier compatibility impact",
        "approval covers only the disclosed set",
        "explicit user acceptance for each compatibility break",
      ],
    );
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
      "except an approved Scope v2 identifier-spelling set",
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

    // Delegated agents must obey Scope v2 in both copies of the shared conventions.
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
    const stepZero = readMarkdownSection(
      SKILL_PATH,
      "Step 0 - Resolve Authority and Target",
    );
    const classification = stepZero.indexOf("### 0.2 Classify selected units");
    const eligibility = stepZero.indexOf("Fail closed on unmerged state");
    const ownerMatrix = stepZero.indexOf("per-unit owner routing matrix");
    assert.ok(
      classification >= 0 &&
        eligibility > classification &&
        ownerMatrix > eligibility,
      `${SKILL_PATH}: inventory, restrictive classification, and eligibility must precede per-unit routing`,
    );
    assertIncludesAll([
      "per-unit owner routing matrix",
      "load an owner only when at least one classified unit meets its condition",
      "do not load every clarity owner unconditionally",
      "candidate-specific owners stay pending until the first supported candidate",
      "load them before judging that candidate",
      "naming/comment owner reads wait until Snapshot v1 is frozen and applicable case accounting is complete",
      "do not diagnose names or comments while collecting the inventory",
      "accounting completed afterward cannot repair this order",
      "naming-and-placement.md",
      "code-comments.md",
      "gruff-code-quality.md",
      "test-selection.md",
      "writing-human-facing-prose.md",
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
    const snapshotRecords = readMarkdownSection(
      SCOPE_REFERENCE_PATH,
      "Snapshot Records",
    );
    const dependencyAuthority = readMarkdownSubsection(
      snapshotRecords,
      "Authority state",
      SCOPE_REFERENCE_PATH,
    );
    const batchDriftRules = readMarkdownSubsection(
      snapshotRecords,
      "Drift revalidation",
      SCOPE_REFERENCE_PATH,
    );
    assertGuidanceIncludesAll(dependencyAuthority, SCOPE_REFERENCE_PATH, [
      "permissions, surface classification, formatter ownership, and exact commands",
      "even outside the selected inventory",
      "canonical identity, existence/type, current bytes or digest, and provenance",
      "bounded absence/discovery evidence",
      "rediscovery stays within the original scope",
    ]);
    assertGuidanceIncludesAll(batchDriftRules, SCOPE_REFERENCE_PATH, [
      "Recheck these governing inputs and bounded discovery before every batch",
      "unchanged selected bytes or HEAD do not prove they are current",
      "invalidates the old snapshot and command decision",
      "requires rebinding before continuation",
      "unchanged grants need no new approval",
      "Unrelated files are not dependencies",
    ]);
    assertGuidanceIncludesAll(targetEvidence, SCOPE_REFERENCE_PATH, [
      "reconcile the complete paginated PR path count",
      "NUL-delimited",
      "never parse paths by newline",
      "bound recursive folder inventory to the canonical selected directory",
      "One selector may list several folders and files",
      "a file selector remains exactly one canonical file",
      "Deduplicate exact path bytes across the list",
      "A listed ignored file stays in inventory; its baseline attribution is `NOT_CHECKED`",
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
      "complete formatter-capability outcome",
      "current project authority",
      "temporary copy inside the repository is forbidden",
      "owned command with a failed availability check has execution status `UNAVAILABLE`, not capability `NOT_FOUND`",
      "baseline `FAIL` remains recorded even when the final check passes",
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
      "Shared evidence quality",
      "OBSERVED | INFERRED | UNVERIFIED | HUMAN-PENDING",
      "Shared proof class",
      "RUNTIME | CONTRACT-GREP | STATIC | NOT-REPRODUCED",
      "proof class states the method that produced",
      "A claim carries both",
      "literal result, proof class",
    ]);
  });

  // Literal-presence checks on both sides can preserve two contradictory owners, so compare the consumer to the owner.

  it("binds clarity evidence labels to the shared preamble vocabularies", () => {
    const sharedPreamble = readProjectFile(SHARED_PREAMBLE_PATH);
    const evidenceQualityDefinition = /^.*Tag evidence quality.*$/mu.exec(
      sharedPreamble,
    );
    // A missing definition leaves the agent without evidence labels to compare against its report.
    assert.ok(
      evidenceQualityDefinition,
      `${SHARED_PREAMBLE_PATH} must define the shared evidence-quality vocabulary`,
    );

    // Read the quality axis from its defining line; the surrounding section also names a proof class in its claim table.
    const evidenceQualityTokens = readOwnerVocabulary(
      evidenceQualityDefinition[0],
    );
    const proofClassTokens = readOwnerVocabulary(
      readMarkdownSection(SHARED_PREAMBLE_PATH, "Proof Classification"),
    );

    // A shortened owner list would let the agreement checks below pass without comparing anything.
    assert.equal(
      evidenceQualityTokens.length,
      SHARED_VOCABULARY_TOKEN_COUNT,
      SHARED_PREAMBLE_PATH,
    );
    assert.equal(
      proofClassTokens.length,
      SHARED_VOCABULARY_TOKEN_COUNT,
      SHARED_PREAMBLE_PATH,
    );

    const evidenceQualityList = evidenceQualityTokens.join(" | ");
    const proofClassList = proofClassTokens.join(" | ");
    const mislabelledQualityPattern = new RegExp(
      `proof[- ]class[^.]*?\\b(?:${evidenceQualityTokens.join("|")})\\b`,
      "u",
    );

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-clarity",
        "references/target-scope-and-evidence.md",
      ),
      (referencePath) => {
        const statusAndClaimEvidence = readMarkdownSection(
          referencePath,
          "Status and Claim Evidence",
        );

        assert.ok(
          statusAndClaimEvidence.includes(
            `Shared evidence quality: \`${evidenceQualityList}\``,
          ),
          `${referencePath} must label ${evidenceQualityList} as evidence quality`,
        );
        assert.ok(
          statusAndClaimEvidence.includes(
            `Shared proof class: \`${proofClassList}\``,
          ),
          `${referencePath} must route the shared proof class ${proofClassList}`,
        );

        // Quality and method are separate axes, so a quality token under a proof-class label is a contradiction, not a synonym.
        assert.doesNotMatch(
          statusAndClaimEvidence,
          mislabelledQualityPattern,
          `${referencePath} must not present an evidence-quality token as a proof class`,
        );
      },
    );
  });

  it("attributes every mechanical check against an equivalent bound baseline", () => {
    const statusAndClaimEvidence = readMarkdownSection(
      SCOPE_REFERENCE_PATH,
      "Status and Claim Evidence",
    );
    assertGuidanceIncludesAll(statusAndClaimEvidence, SCOPE_REFERENCE_PATH, [
      "Baseline attribution applies to every mechanical check",
      "exact same check",
      "bound comparison baseline bytes",
      "equivalent scope, configuration, and path context",
      "Never write baseline bytes into the worktree",
      "record the attribution `NOT_CHECKED`",
      "A failure reproduced at the comparison baseline is inherited",
      "A failure absent there but present on current bytes was introduced by the current change",
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
      "aggregate spans by file and diagnosed rule",
      "symbol-level evidence",
      "write-classification totals and terminal-outcome totals independently equal the same inventory",
      "protected and context-only units never enter excluded counts",
      "preserved protected requires a byte comparison; clarity assessment stays `NOT_CHECKED`",
      "compliant unchanged requires an applicable clarity assessment with no finding",
      "read-only human prose may be assessed without write permission",
    ]);
  });

  it("returns a complete but proportional remediation receipt", () => {
    // The completion receipt must account for changed, retained, deferred, and unchecked work so the user can review the actual scope.
    for (const receiptLabel of [
      "Agent:",
      "Selector:",
      "Snapshot:",
      "Documentation writes:",
      "Write paths:",
      "Unit totals:",
      "Modified:",
      "Compliant unchanged:",
      "Preserved protected:",
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
      "Agent: <claude | codex | antigravity | copilot>",
      "Selector: <github-pr | uncommitted | paths>",
      "Summary: <paste-ready pull-request summary when requested or needed for headless/sub-agent handoff; otherwise not requested>",
      "A receipt is complete when formatter capability is classified",
      "or deliberately omitted with a reason at the no-eligible-unit exit",
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
      "/goat-clarity path/to/folder path/to/file.ext",
      "Report only, or update the documentation?",
      "most restrictive applicable class wins",
      "naming and comment owners wait until the snapshot is frozen and applicable test-case accounting is complete",
      "private symbol and its destination",
      "wholly inside one frozen writable file",
      "cross-file or uncertain placement still needs second approval",
      "enumerated public/exported identifier renames plus mechanical references",
      "second approval",
      "initial request does not satisfy",
      "every identifier",
      "exact affected writable paths",
      "one approval covers only the disclosed set",
      "explicit user acceptance for each compatibility break",
      "selected-unit, changed-span, and command-evidence ledgers",
      "remote report-only",
      "test-selection record",
      "ADDED KEEP",
      "REMOVAL SUPPORTED",
      "RELOCATED",
      "BLOCKED-ON-BEHAVIOUR",
      "named arguments",
      "formatter capability",
      "classification and outcome totals each reconcile to the inventory",
      "protected preservation does not claim clarity assessment",
      "omitted discovery is not a no-owner result",
      "an unavailable owned command remains `UNAVAILABLE`",
      "PR and uncommitted work",
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
