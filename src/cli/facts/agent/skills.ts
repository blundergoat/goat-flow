/**
 * Skill fact extraction - inventories installed skills, measures quality signals, and detects unadapted content.
 */
import { readFileSync } from "node:fs";
import type { AgentProfile, AgentFacts, ReadonlyFS } from "../../types.js";
import {
  SKILL_NAMES,
  AUDIT_VERSION as SKILL_VERSION,
} from "../../constants.js";
import { getTemplatePath } from "../../paths.js";
import { extractSection } from "./instruction.js";

/** Compute Jaccard similarity between two strings by comparing word sets. */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(
    a
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const wordsB = new Set(
    b
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 1 : intersection / union;
}

/** Extract the goat-flow-skill-version from YAML frontmatter. */
function extractSkillVersion(content: string): string | null {
  // Match YAML frontmatter between --- delimiters
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter?.[1]) return null;
  const versionMatch = frontmatter[1].match(
    /goat-flow-skill-version:\s*["']?([^"'\n]+)/,
  );
  return versionMatch?.[1]?.trim() ?? null;
}

/** Quality signal counters accumulated across all installed skills. */
interface SkillQualityCounts {
  withStep0: number;
  withHumanGate: number;
  withConstraints: number;
  withPhases: number;
  withConversational: number;
  withChoices: number;
  withOutputFormat: number;
  withSharedConventions: number;
  malformedFenceCount: number;
}

/** Aggregates found/missing skills, version drift, and quality metrics for one agent. */
interface SkillInventory {
  found: string[];
  missing: string[];
  versions: Record<string, string | null>;
  outdatedCount: number;
  quality: SkillQualityCounts;
  adaptCommentCount: number;
}

/** Mapping of quality signal names to their detection regex patterns. */
const SKILL_QUALITY_PATTERNS: Array<{
  key: keyof SkillQualityCounts;
  pattern: RegExp;
}> = [
  {
    key: "withStep0",
    pattern: /step\s*0|gather\s*context|ask.*before|ask\s+the\s+user/i,
  },
  {
    key: "withHumanGate",
    pattern:
      /human\s*gate|blocking\s*gate|wait.*approv|wait.*confirm|do\s+not\s+proceed|does this.*look right|does this.*match/i,
  },
  { key: "withConstraints", pattern: /MUST\s+NOT|MUST\s+/m },
  { key: "withPhases", pattern: /##\s*(Phase|Step)\s+[0-9]/i },
  { key: "withConversational", pattern: /blocking\s*gate|human\s*gate/i },
  {
    key: "withChoices",
    pattern:
      /\(a\)|\(b\)|\(c\)|want me to|offer:|\bquick\b[\s\S]{0,160}\bfull\b|drill into|go deeper|check (?:a|the) (?:related|different)|switch to|adjust scope|redirect the review|proceed to ranking|or close|or adjust|start fresh|update milestones|dig deeper|re-run with/i,
  },
  { key: "withOutputFormat", pattern: /##\s*(Output|Output Format)/i },
  { key: "withSharedConventions", pattern: /^##\s+shared conventions/im },
] as const;

/** Build the zeroed accumulator used while scoring installed skill quality. */
function createSkillQualityCounts(): SkillQualityCounts {
  return {
    withStep0: 0,
    withHumanGate: 0,
    withConstraints: 0,
    withPhases: 0,
    withConversational: 0,
    withChoices: 0,
    withOutputFormat: 0,
    withSharedConventions: 0,
    malformedFenceCount: 0,
  };
}

/** Update skill-quality counters for one installed skill document. */
function updateSkillQualityCounts(
  content: string,
  quality: SkillQualityCounts,
): void {
  for (const check of SKILL_QUALITY_PATTERNS) {
    if (check.key === "withConversational") {
      if (
        /blocking\s*gate|human\s*gate/i.test(content) &&
        /\(a\)|want me to|offer:|\bquick\b[\s\S]{0,160}\bfull\b|drill into|go deeper|switch to|adjust scope|redirect|or close/i.test(
          content,
        )
      ) {
        quality[check.key]++;
      }
      continue;
    }
    if (check.pattern.test(content)) {
      quality[check.key]++;
    }
  }
}

/** Count remaining `<!-- ADAPT: ... -->` markers in a skill file. */
function countAdaptComments(content: string): number {
  return content.match(/<!--\s*ADAPT:/g)?.length ?? 0;
}

/** Count malformed markdown fence blocks (unclosed or improperly nested triple-backtick regions). */
function countMalformedFences(content: string): number {
  const lines = content.split("\n");
  let openFences = 0;
  let malformed = 0;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (openFences > 0) {
        // Closing a fence
        openFences--;
      } else {
        // Opening a fence
        openFences++;
      }
    }
  }
  // Any unclosed fences are malformed
  malformed += openFences;
  return malformed;
}

/** List installed skill directories that contain a `SKILL.md` file. */
function collectInstalledSkillDirs(
  fs: ReadonlyFS,
  agent: AgentProfile,
): string[] {
  return fs
    .listDir(agent.skillsDir)
    .filter((entry) => fs.exists(`${agent.skillsDir}/${entry}/SKILL.md`))
    .sort();
}

/** Analyze one installed skill for version drift and quality signals. */
function analyzeSkillContent(
  skill: string,
  content: string,
  versions: Record<string, string | null>,
  quality: SkillQualityCounts,
): { outdated: boolean; adaptCommentCount: number } {
  const version = extractSkillVersion(content);
  versions[skill] = version;
  updateSkillQualityCounts(content, quality);

  quality.malformedFenceCount += countMalformedFences(content);

  return {
    outdated: version === null || version !== SKILL_VERSION,
    adaptCommentCount: countAdaptComments(content),
  };
}

/** Scan the expected skill set for presence, version drift, and quality signals. */
function scanExpectedSkills(
  fs: ReadonlyFS,
  agent: AgentProfile,
): SkillInventory {
  const found: string[] = [];
  const missing: string[] = [];
  const versions: Record<string, string | null> = {};
  const quality = createSkillQualityCounts();
  let outdatedCount = 0;
  let adaptCommentCount = 0;

  for (const skill of SKILL_NAMES) {
    const skillPath = `${agent.skillsDir}/${skill}/SKILL.md`;
    if (!fs.exists(skillPath)) {
      missing.push(skill);
      continue;
    }

    found.push(skill);
    const skillContent = fs.readFile(skillPath);
    if (!skillContent) continue;

    const analysis = analyzeSkillContent(
      skill,
      skillContent,
      versions,
      quality,
    );
    if (analysis.outdated) outdatedCount++;
    adaptCommentCount += analysis.adaptCommentCount;
  }

  return {
    found,
    missing,
    versions,
    outdatedCount,
    quality,
    adaptCommentCount,
  };
}

/** Count installed skills whose Step 0 section still matches the template too closely. */
function countUnadaptedSkills(
  fs: ReadonlyFS,
  agent: AgentProfile,
  found: string[],
): number {
  let unadaptedCount = 0;

  for (const skill of found) {
    const skillPath = `${agent.skillsDir}/${skill}/SKILL.md`;
    const installed = fs.readFile(skillPath);
    // Templates live in the goat-flow package root, not the project being audited.
    // Use getTemplatePath + readFileSync so this works in user projects too.
    let template: string | null = null;
    try {
      template = readFileSync(
        getTemplatePath(`workflow/skills/${skill}/SKILL.md`),
        "utf-8",
      );
    } catch {
      // Template missing (e.g. custom skill with no goat-flow template) - skip
    }
    if (!installed || !template) continue;

    const installedStep0 = extractSection(installed, "Step 0");
    const templateStep0 = extractSection(template, "Step 0");
    if (
      installedStep0 &&
      templateStep0 &&
      jaccardSimilarity(installedStep0, templateStep0) > 0.9
    ) {
      unadaptedCount++;
    }
  }

  return unadaptedCount;
}

/** Extract skill presence, version drift, and quality facts for one agent. */
export function extractSkillFacts(
  fs: ReadonlyFS,
  agent: AgentProfile,
): AgentFacts["skills"] {
  const installedDirs = collectInstalledSkillDirs(fs, agent);
  const inventory = scanExpectedSkills(fs, agent);
  const unadaptedCount = countUnadaptedSkills(fs, agent, inventory.found);
  const hasDispatcher = fs.exists(`${agent.skillsDir}/goat/SKILL.md`);

  return {
    installedDirs,
    found: inventory.found,
    missing: inventory.missing,
    allPresent: inventory.missing.length === 0,
    versions: inventory.versions,
    outdatedCount: inventory.outdatedCount,
    hasDispatcher,
    quality: {
      ...inventory.quality,
      unadaptedCount,
      adaptCommentCount: inventory.adaptCommentCount,
      total: inventory.found.length,
    },
  };
}
