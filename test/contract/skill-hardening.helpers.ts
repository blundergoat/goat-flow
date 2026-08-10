/**
 * Shared readers and assertions for the installed-skill contract suites.
 * Every contract group asks the same question in a different place: does the guidance a user
 * actually receives still say what it must? These helpers read installed files exactly as an
 * agent or the dashboard would, slice out the section under test, and assert across all four
 * install roots at once so a rule cannot pass on one mirror while another has drifted.
 *
 * Reading the installed copy rather than parsed metadata is the point. A contract that checked
 * a manifest would keep passing while the wording a user reads went stale.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");
export const INSTALLED_SKILL_ROOTS = [
  "workflow/skills",
  ".claude/skills",
  ".agents/skills",
  ".github/skills",
] as const;

/**
 * Loads one project file exactly as an agent or UI consumer receives it.
 * Use this when a contract depends on the installed wording, not parsed metadata.
 *
 * @param projectRelativePath - repo-relative path to read; the installed copy, not a template
 * @returns the file contents verbatim; a missing file throws, because a contract asserting
 *   about guidance that is not installed has already failed
 */
export function readProjectFile(projectRelativePath: string): string {
  return readFileSync(resolve(REPOSITORY_ROOT, projectRelativePath), "utf-8");
}

/**
 * Extracts one Markdown H2 section so a UI-facing rule cannot pass by matching an example elsewhere.
 * A missing section means the installed workflow can no longer orient the user as documented.
 *
 * @param projectRelativePath - installed file to read, exactly as a user's agent would
 * @param sectionHeading - H2 heading to isolate, without the leading hashes
 * @returns the section body; an empty string means the heading is absent, which callers assert
 *   against rather than silently passing
 */
export function readMarkdownSection(
  projectRelativePath: string,
  sectionHeading: string,
): string {
  const documentBody = readProjectFile(projectRelativePath);
  const sectionMarker = `## ${sectionHeading}`;
  const lines = documentBody.split(/\r?\n/u);
  let sectionStartIndex = -1;
  let sectionEndIndex = lines.length;
  let activeFence: "`" | "~" | null = null;

  for (const [lineIndex, line] of lines.entries()) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      const fenceCharacter = fenceMatch[1][0] as "`" | "~";
      if (activeFence === null) {
        activeFence = fenceCharacter;
      } else if (activeFence === fenceCharacter) {
        activeFence = null;
      }
      continue;
    }

    if (activeFence !== null) continue;

    if (sectionStartIndex === -1 && line === sectionMarker) {
      sectionStartIndex = lineIndex;
      continue;
    }

    if (sectionStartIndex !== -1 && /^##\s+/u.test(line)) {
      sectionEndIndex = lineIndex;
      break;
    }
  }

  // A missing heading means users cannot reach the promised workflow section.
  assert.notEqual(
    sectionStartIndex,
    -1,
    `${projectRelativePath} missing ${sectionMarker}`,
  );

  return lines.slice(sectionStartIndex, sectionEndIndex).join("\n");
}

/**
 * Builds every installed path for a skill so each supported agent sees the same workflow.
 * Use this whenever a safety rule must remain identical across agent integrations.
 *
 * @param skillName - skill directory name, such as `goat-review`
 * @returns one SKILL.md path per install root; never empty, so a contract always asserts
 *   against every mirror rather than passing on whichever one it happened to read
 */
export function installedSkillPaths(skillName: string): string[] {
  // Each installation root represents a user-visible agent integration.
  return INSTALLED_SKILL_ROOTS.map(
    (skillRoot) => `${skillRoot}/${skillName}/SKILL.md`,
  );
}

/**
 * Builds every installed path for one progressive skill reference.
 *
 * @param skillName - skill directory that owns the reference
 * @param referencePath - path inside the skill, such as `references/rubric-examples.md`
 * @returns one path per install root, so drift in a single mirror still fails the contract
 */
export function installedSkillReferencePaths(
  skillName: string,
  referencePath: string,
): string[] {
  return INSTALLED_SKILL_ROOTS.map(
    (skillRoot) => `${skillRoot}/${skillName}/${referencePath}`,
  );
}

/**
 * Applies one contract to every user-facing target while preserving its failure label.
 * Use this for mirror parity rather than accepting one correct installation as enough.
 */
export function assertForEachTarget<T>(
  contractTargets: readonly T[],
  verifyTarget: (contractTarget: T) => void,
): void {
  // Every target must pass because users can invoke the workflow from any installed agent.
  for (const contractTarget of contractTargets) {
    verifyTarget(contractTarget);
  }
}

// Every obligation a milestone-examples reference must state before a plan author can
// trust an Actual: how to record time, how to stop it, and how each Actual state reads.
export const TIMING_OBLIGATION_CHECKS = [
  /goat-flow plans time start/u,
  /--finalize/u,
  /--discard-open/u,
  /Stop before every human wait/u,
  /Delegated or parallel-agent effort is disclosed separately/u,
  /`measured:/u,
  /`retrospective:/u,
  /`unavailable:/u,
  /`incomplete:/u,
  /round likely\/headline/u,
  /cold-start prior/u,
];

/**
 * Resolve every `path` (search: `anchor`) citation in a skill bundle against its target file.
 * Use when a skill points a reader at another document: a citation that no longer matches
 * sends the agent to text that is not there, which reads as a missing instruction.
 *
 * Anchors naming `<target-project>` are consumer-project placeholders, not files in this
 * checkout, so they are counted and skipped rather than resolved.
 *
 * @param reviewRoot - bundle root used to resolve `SKILL.md` and `references/` citations
 * @param bundlePaths - files to scan; an empty list returns zero counts and proves nothing,
 *   which the caller guards by asserting the checked count is above zero
 * @returns how many anchors resolved and how many placeholders were exempted
 */
export function verifyNamedAnchorsResolve(
  reviewRoot: string,
  bundlePaths: readonly string[],
): { anchorsChecked: number; placeholderAnchors: number } {
  const namedAnchorPattern = /`([^`\n]+)`\s*\(search:\s*`([^`]+)`\)/gu;
  let anchorsChecked = 0;
  let placeholderAnchors = 0;

  for (const sourcePath of bundlePaths) {
    const source = readProjectFile(sourcePath);
    for (const anchorMatch of source.matchAll(namedAnchorPattern)) {
      const citedPath = anchorMatch[1];
      const anchor = anchorMatch[2];
      // A consumer-project placeholder cannot resolve here, so it is exempted, not failed.
      if (citedPath.includes("<target-project>")) {
        placeholderAnchors += 1;
        continue;
      }

      const targetPath =
        citedPath === "SKILL.md"
          ? `${reviewRoot}/SKILL.md`
          : citedPath.startsWith("references/")
            ? `${reviewRoot}/${citedPath}`
            : citedPath;
      assert.match(
        readProjectFile(targetPath),
        new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
        `${sourcePath}: ${citedPath} missing search anchor ${anchor}`,
      );
      anchorsChecked += 1;
    }
  }

  return { anchorsChecked, placeholderAnchors };
}

/**
 * Confirm one milestone-examples section documents every timing and forecast obligation.
 * Use per installed harness: an author reading only their own agent's copy must still be
 * told how to record, stop, and disclose milestone time.
 *
 * @param effortEstimates - the reference's Effort Estimates section text
 * @param referencePath - path reported on failure, so the failing harness copy is named
 */
export function assertTimingObligationsDocumented(
  effortEstimates: string,
  referencePath: string,
): void {
  // A harness missing any one of these would emit Actuals that look measured but rest on nothing.
  for (const obligation of TIMING_OBLIGATION_CHECKS) {
    assert.match(effortEstimates, obligation, referencePath);
  }
}

/**
 * Counts user-facing skill guidance without YAML frontmatter, matching ADR-023.
 * Use this to prevent a workflow from becoming too large for agents to apply reliably.
 *
 * @param projectRelativePath - installed guidance file to measure
 * @returns word count of the body only; frontmatter is excluded because it is metadata the
 *   user never reads and would otherwise inflate every file against its budget
 */
export function countSkillBodyWords(projectRelativePath: string): number {
  const skillBody = readProjectFile(projectRelativePath).replace(
    /^---\n[\s\S]*?\n---\n?/,
    "",
  );

  // Empty whitespace segments are not words a user or agent must process.
  return skillBody.split(/\s+/).filter(Boolean).length;
}

/**
 * Wordings that must never appear in installed skill guidance.
 * Each names a retired rule that once told an agent to seek extra consent before delegating.
 * They are assembled from fragments so this file does not itself contain the banned phrase and
 * trip the very contracts that search for it.
 */
export const forbiddenCodexExceptionPattern = new RegExp(
  "Exception: on C" + "odex",
);

/** Retired wording that required explicit delegation consent on one agent. */
export const forbiddenCodexConsentPattern = new RegExp(
  ["C", "odex requires ", "explicit user ", "delegation ", "consent"].join(""),
);

/** Retired wording that asked an agent to confirm consent before spawning sub-agents. */
export const forbiddenDelegationPromptPattern = new RegExp(
  ["confirm ", "delegation ", "consent once ", "before spawning"].join(""),
);
