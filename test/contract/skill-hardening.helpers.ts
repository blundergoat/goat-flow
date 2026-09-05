/**
 * Read skill guidance and apply shared contracts across the canonical and installed copies.
 *
 * Tests inspect the wording agents receive so a correct copy cannot hide drift in another supported integration.
 * Use these helpers for section checks, prompt presets, evidence anchors, and guidance-size limits.
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
 * Read the exact project file a guidance contract needs; missing or unreadable files throw.
 *
 * @param projectRelativePath - repository-relative guidance path; callers choose the canonical or installed copy they need
 * @returns file contents verbatim, including an empty string for an empty file
 */
export function readProjectFile(projectRelativePath: string): string {
  return readFileSync(resolve(REPOSITORY_ROOT, projectRelativePath), "utf-8");
}

/**
 * Reads the project file to find the requested H2 section while ignoring headings inside fenced examples.
 * A missing heading throws because the agent cannot find the promised workflow guidance.
 *
 * @param projectRelativePath - installed file to read, exactly as a user's agent would
 * @param sectionHeading - H2 heading to isolate, without the leading hashes
 * @returns the heading and its section text up to the next H2; a heading with no body is still returned
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

  // Walk the document in reading order to isolate the section an agent would find outside examples.
  for (const [lineIndex, line] of lines.entries()) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line);
    // Fence markers change whether following headings are live guidance or example text.
    if (fenceMatch) {
      const fenceCharacter = fenceMatch[1][0] as "`" | "~";
      // With no open fence, this marker starts an example whose headings must be ignored.
      if (activeFence === null) {
        activeFence = fenceCharacter;
      } else if (
        // A matching marker returns the reader to the surrounding guidance.
        activeFence === fenceCharacter
      ) {
        activeFence = null;
      }
      continue;
    }

    // Ignore fenced examples so quoted headings cannot satisfy a missing workflow section.
    if (activeFence !== null) continue;

    // The first matching live H2 starts the requested section, including its heading.
    if (sectionStartIndex === -1 && line === sectionMarker) {
      sectionStartIndex = lineIndex;
      continue;
    }

    // The next live H2 ends this section before unrelated guidance can satisfy its contract.
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
 * Require every pattern in one guidance file so missing instructions produce a named contract failure.
 *
 * @param content - installed guidance text to inspect
 * @param patterns - required wording patterns; an empty list performs no checks
 * @param sourcePath - assertion label naming the inspected source
 */
export function assertMatchesAll(
  content: string,
  patterns: readonly RegExp[],
  sourcePath: string,
): void {
  // Every required instruction must appear; one matching pattern cannot compensate for a missing rule.
  for (const pattern of patterns) {
    assert.match(content, pattern, `${sourcePath}: missing ${pattern}`);
  }
}

/**
 * Read one H3 subsection so a contract checks the relevant guidance rather than another section.
 *
 * @param sectionBody - Markdown H2 body that contains the subsection
 * @param subsectionHeading - H3 heading to isolate, without leading hashes
 * @param sourcePath - assertion label naming the inspected source
 * @returns text after the heading up to the next H3, possibly empty; a missing heading throws
 */
export function readMarkdownSubsection(
  sectionBody: string,
  subsectionHeading: string,
  sourcePath: string,
): string {
  const marker = `### ${subsectionHeading}`;
  const start = sectionBody.indexOf(marker);
  assert.notEqual(start, -1, `${sourcePath} missing ${marker}`);
  const remainder = sectionBody.slice(start + marker.length);
  const nextHeading = remainder.search(/\n###\s+/u);
  // With no later H3, the requested subsection extends to the end of the supplied section.
  return nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
}

/**
 * Read one dashboard preset field after checking that the preset exists and its value is a string.
 *
 * @param presetId - exact dashboard preset identifier
 * @param field - supported string field to read
 * @returns the selected field, possibly empty; missing presets or non-string fields throw
 */
export function readPresetStringField(
  presetId: string,
  field: "desc" | "prompt",
): string {
  const presets = JSON.parse(
    readProjectFile("src/dashboard/preset-prompts.json"),
  ) as Array<Record<string, unknown>>;
  const preset = presets.find((candidate) => candidate.id === presetId);
  assert.ok(preset, `missing dashboard preset ${presetId}`);
  assert.equal(
    typeof preset[field],
    "string",
    `dashboard preset ${presetId} is missing ${field}`,
  );
  return preset[field] as string;
}

/**
 * Read the prompt text users launch from the selected dashboard preset.
 *
 * @param presetId - exact dashboard preset identifier
 * @returns the preset prompt, possibly empty; missing presets or non-string prompts throw
 */
export function readPresetPrompt(presetId: string): string {
  return readPresetStringField(presetId, "prompt");
}

/**
 * Build paths for every canonical and installed skill copy so contracts catch guidance drift.
 *
 * @param skillName - skill directory name, such as `goat-review`
 * @returns one SKILL.md path per registered root; the fixed root list makes this result nonempty
 */
export function installedSkillPaths(skillName: string): string[] {
  // Each installation root represents a user-visible agent integration.
  return INSTALLED_SKILL_ROOTS.map(
    (skillRoot) => `${skillRoot}/${skillName}/SKILL.md`,
  );
}

/**
 * Build paths for one reference across all registered roots so every agent receives the same guidance.
 *
 * @param skillName - skill directory that owns the reference
 * @param referencePath - path inside the skill, such as `references/rubric-examples.md`
 * @returns one reference path per registered root; the fixed root list makes this result nonempty
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
 * Apply the same contract to every selected guidance copy, preserving each target's failure label.
 *
 * @param contractTargets - guidance targets to check; an empty list runs no assertions
 * @param verifyTarget - contract applied to each target; its failure label names the mirror that failed
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

// Required timing and forecast wording lets plan authors record effort and distinguish measured Actuals from estimates.
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
 * Check that a skill's named evidence anchors lead readers to text that exists.
 *
 * Placeholders beginning with an angle-bracket token are counted separately because their files belong to the eventual target project.
 *
 * @param reviewRoot - bundle root used to resolve `SKILL.md` and `references/` citations
 * @param bundlePaths - files to scan; an empty list returns zero counts, so callers separately require checked anchors
 * @returns resolved and placeholder anchor counts; zero resolved anchors alone proves no citation is valid
 */
export function verifyNamedAnchorsResolve(
  reviewRoot: string,
  bundlePaths: readonly string[],
): { anchorsChecked: number; placeholderAnchors: number } {
  const namedAnchorPattern = /`([^`\n]+)`\s*\(search:\s*`([^`]+)`\)/gu;
  let anchorsChecked = 0;
  let placeholderAnchors = 0;

  // Check citations in every selected guidance file so readers can follow references from any bundle section.
  for (const sourcePath of bundlePaths) {
    const source = readProjectFile(sourcePath);
    // Resolve each named citation independently; one valid destination cannot hide another broken instruction link.
    for (const anchorMatch of source.matchAll(namedAnchorPattern)) {
      const citedPath = anchorMatch[1];
      const anchor = anchorMatch[2];
      // A consumer-project placeholder cannot resolve here, so it is exempted, not failed.
      if (/^<[^>]+>(?:\/.*)?$/u.test(citedPath)) {
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
 * Require the timing and forecast guidance a plan author needs to report trustworthy effort.
 *
 * @param effortEstimates - Effort Estimates section text; empty text fails the required wording checks
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
 * Count guidance words without YAML frontmatter to enforce the skill-body budget in ADR-023.
 *
 * @param projectRelativePath - installed guidance file to measure
 * @returns body word count; empty or whitespace-only bodies count as zero, and frontmatter does not consume the guidance budget
 */
export function countSkillBodyWords(projectRelativePath: string): number {
  const skillBody = readProjectFile(projectRelativePath).replace(
    /^---\n[\s\S]*?\n---\n?/,
    "",
  );

  // Empty whitespace segments are not words a user or agent must process.
  return skillBody.split(/\s+/).filter(Boolean).length;
}

// Reject retired delegation-consent wording in installed guidance.
// Fragments keep this contract fixture from containing the complete phrase that repository checks reject.
export const forbiddenCodexExceptionPattern = new RegExp(
  "Exception: on C" + "odex",
);

// Retired wording that required explicit delegation consent on one agent.
export const forbiddenCodexConsentPattern = new RegExp(
  ["C", "odex requires ", "explicit user ", "delegation ", "consent"].join(""),
);

// Retired wording that asked an agent to confirm consent before spawning sub-agents.
export const forbiddenDelegationPromptPattern = new RegExp(
  ["confirm ", "delegation ", "consent once ", "before spawning"].join(""),
);
