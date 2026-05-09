/**
 * Configuration layer for the deterministic skill-quality scoring engine.
 *
 * Goat-flow ships with `DEFAULT_QUALITY_CONFIG` calibrated against the in-tree
 * 12-artifact corpus. Consumer projects override pieces via
 * `.goat-flow/config.yaml` under the top-level `quality` section.
 *
 * Zero-config behaviour (no `quality` section in config) is identical to the
 * pre-M08 hardcoded defaults; M07 fixtures still pass without any project
 * override.
 */
import { loadConfig } from "../config/reader.js";

export type ArtifactKind = "skill" | "shared-reference";
export type ArtifactSource =
  | "workflow"
  | "installed"
  | "agent-mirror"
  | "github-mirror"
  | "shared-reference";
export type ArtifactSubtype =
  | "workflow"
  | "dispatcher"
  | "report"
  | "playbook"
  | "index"
  | "meta";
export type MetricName =
  | "trigger-clarity"
  | "workflow-completeness"
  | "gate-quality"
  | "evidence-testability"
  | "cold-start"
  | "token-cost"
  | "tool-deps"
  | "write-risk"
  | "skill-reference-fit";

interface WalkRoot {
  dir: string;
  source: ArtifactSource;
}

export interface SubtypeDetection {
  /** Artifact kinds this subtype applies to. Empty array = any. */
  kinds: ArtifactKind[];
  /** Exact artifact-name matches that route to this subtype. */
  namePatterns: string[];
  /** Heading-style regex sources (case-insensitive). Any match counts. */
  headingPatterns: string[];
  /** Heading-style regex sources that veto this subtype if present. */
  mustNotHave: string[];
}

interface SubtypeProfile {
  /** Detection rules in priority order; first matching subtype wins. */
  detection: SubtypeDetection;
  /** Per-metric max scores for this subtype. */
  profile: Record<MetricName, number>;
  /** Human-readable description of when this subtype applies. */
  notes: string;
}

interface CompositionConfig {
  /** Path to the shared preamble loaded by every skill (relative to project root). */
  skillPreamblePath: string | null;
  /** Path to the shared conventions appended when SKILL.md mentions it. */
  skillConventionsPath: string | null;
  /** Regex source for matching skill-local references (capture group 1 = relative path). */
  skillReferencePattern: string;
  /** Hard cap on total composed-content size; excess is truncated with a fit note. */
  maxComposedBytes: number;
}

interface GateVocabularyConfig {
  /** Patterns that count as a verification-gate signal (+5 points). */
  verificationGate: string[];
  /** Patterns that count as an explicit pass/fail signal (+3 points). */
  explicitPass: string[];
  /** Patterns that count as a human-stop signal (+2 points). */
  humanStop: string[];
}

export interface QualityConfig {
  /** Walk roots for artifact discovery, in priority order. */
  walkRoots: { skills: WalkRoot[]; references: WalkRoot[] };
  composition: CompositionConfig;
  /** Hard cap on bytes read per artifact; excess is truncated with a fit note. */
  maxArtifactBytes: number;
  gateVocabulary: GateVocabularyConfig;
  /** Single regex source compiled into the tool-dependency scorer. */
  toolKeywordsRegex: string;
  /** Subtype profiles indexed by subtype name. Order in this object is detection priority. */
  subtypes: Record<ArtifactSubtype, SubtypeProfile>;
  /** Path to the in-tree expected-scores fixture. */
  fixturePath: string;
  /** Additional fixtures consumer projects may declare. */
  additionalFixtures: string[];
}

const DEFAULT_PROFILES: Record<ArtifactSubtype, Record<MetricName, number>> = {
  workflow: {
    "trigger-clarity": 15,
    "workflow-completeness": 15,
    "gate-quality": 10,
    "evidence-testability": 10,
    "cold-start": 10,
    "token-cost": 10,
    "tool-deps": 10,
    "write-risk": 10,
    "skill-reference-fit": 10,
  },
  dispatcher: {
    "trigger-clarity": 15,
    "workflow-completeness": 5,
    "gate-quality": 0,
    "evidence-testability": 10,
    "cold-start": 10,
    "token-cost": 10,
    "tool-deps": 10,
    "write-risk": 0,
    "skill-reference-fit": 10,
  },
  report: {
    "trigger-clarity": 15,
    "workflow-completeness": 10,
    "gate-quality": 10,
    "evidence-testability": 10,
    "cold-start": 10,
    "token-cost": 10,
    "tool-deps": 10,
    "write-risk": 0,
    "skill-reference-fit": 10,
  },
  playbook: {
    "trigger-clarity": 15,
    "workflow-completeness": 15,
    "gate-quality": 0,
    "evidence-testability": 10,
    "cold-start": 10,
    "token-cost": 10,
    "tool-deps": 10,
    "write-risk": 0,
    "skill-reference-fit": 10,
  },
  meta: {
    "trigger-clarity": 10,
    "workflow-completeness": 5,
    "gate-quality": 5,
    "evidence-testability": 10,
    "cold-start": 0,
    "token-cost": 10,
    "tool-deps": 0,
    "write-risk": 0,
    "skill-reference-fit": 10,
  },
  index: {
    "trigger-clarity": 10,
    "workflow-completeness": 10,
    "gate-quality": 0,
    "evidence-testability": 10,
    "cold-start": 5,
    "token-cost": 10,
    "tool-deps": 5,
    "write-risk": 0,
    "skill-reference-fit": 10,
  },
};

/** Goat-flow's calibrated defaults. Mirrors M07's hardcoded values exactly. */
export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  walkRoots: {
    skills: [
      { dir: ".claude/skills", source: "installed" },
      { dir: ".agents/skills", source: "agent-mirror" },
      { dir: ".github/skills", source: "github-mirror" },
      { dir: "workflow/skills", source: "workflow" },
    ],
    references: [
      { dir: ".goat-flow/skill-reference", source: "shared-reference" },
      { dir: ".goat-flow/skill-playbooks", source: "shared-reference" },
    ],
  },
  composition: {
    skillPreamblePath: ".goat-flow/skill-reference/skill-preamble.md",
    skillConventionsPath: ".goat-flow/skill-reference/skill-conventions.md",
    skillReferencePattern: "references\\/([^\\s)`\"']+\\.md)",
    maxComposedBytes: 32 * 1024,
  },
  maxArtifactBytes: 256 * 1024,
  gateVocabulary: {
    verificationGate: [
      "verification gate",
      "exit criteria",
      "testing gate",
      "proof gate",
      "BLOCKING GATE",
      "CHECKPOINT",
      "\\- \\[ \\]",
    ],
    explicitPass: [
      "pass[/ ]fail",
      "exit on",
      "must pass",
      "evidence.*required",
    ],
    humanStop: [
      "BLOCKING GATE",
      "Human Verification",
      "approval",
      "CHECKPOINT",
    ],
  },
  toolKeywordsRegex:
    "browser-use|page-capture|command -v|\\bwhich\\s+(command|binary|tool|cli)\\b|\\bnpm\\b|\\bbash\\b|\\bgit\\b|\\bpython\\b|\\bnode\\b|\\bgh\\b|\\bgoat-flow\\b(?!-skill-version)|node --import tsx",
  subtypes: {
    meta: {
      detection: {
        kinds: ["shared-reference"],
        namePatterns: ["skill-preamble", "skill-conventions"],
        headingPatterns: [],
        mustNotHave: [],
      },
      profile: DEFAULT_PROFILES.meta,
      notes: "Shared meta-reference loaded by every skill at runtime.",
    },
    index: {
      detection: {
        kinds: ["shared-reference"],
        namePatterns: ["skill-quality-testing"],
        headingPatterns: [],
        mustNotHave: [],
      },
      profile: DEFAULT_PROFILES.index,
      notes: "Index reference; routes to sibling files in a subdirectory.",
    },
    playbook: {
      detection: {
        kinds: ["shared-reference"],
        namePatterns: [],
        headingPatterns: [],
        mustNotHave: [],
      },
      profile: DEFAULT_PROFILES.playbook,
      notes: "Tool playbook; documents capability and availability check.",
    },
    dispatcher: {
      detection: {
        kinds: ["skill"],
        namePatterns: ["goat"],
        headingPatterns: ["##\\s+Route Map"],
        mustNotHave: [],
      },
      profile: DEFAULT_PROFILES.dispatcher,
      notes: "Dispatcher skill; routes to other skills with no own execution.",
    },
    report: {
      detection: {
        kinds: ["skill"],
        namePatterns: ["goat-security"],
        headingPatterns: ["##\\s+Quick Scan Path", "##\\s+Audit Mode"],
        mustNotHave: ["##\\s+Step 0"],
      },
      profile: DEFAULT_PROFILES.report,
      notes: "Reporting-only skill; assesses without writes.",
    },
    workflow: {
      detection: {
        kinds: ["skill"],
        namePatterns: [],
        headingPatterns: [],
        mustNotHave: [],
      },
      profile: DEFAULT_PROFILES.workflow,
      notes: "Workflow skill with Step 0 / phases / gates / mode system.",
    },
  },
  fixturePath: "test/fixtures/skill-quality/expected-scores.json",
  additionalFixtures: [],
};

/** Narrow unknown values to plain object records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value) === false
  );
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === "string");
}

function mergeWalkRoot(value: unknown, fallback: WalkRoot[]): WalkRoot[] {
  if (!Array.isArray(value)) return fallback;
  const result: WalkRoot[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      result.push({ dir: entry, source: "installed" });
      continue;
    }
    if (!isRecord(entry)) continue;
    const dir = entry.dir;
    const source = entry.source ?? "installed";
    if (typeof dir !== "string" || typeof source !== "string") continue;
    result.push({ dir, source: source as ArtifactSource });
  }
  return result.length > 0 ? result : fallback;
}

function mergeComposition(
  value: unknown,
  fallback: CompositionConfig,
): CompositionConfig {
  if (!isRecord(value)) return fallback;
  return {
    skillPreamblePath:
      typeof value["skill-preamble-path"] === "string"
        ? value["skill-preamble-path"]
        : value["skill-preamble-path"] === null
          ? null
          : fallback.skillPreamblePath,
    skillConventionsPath:
      typeof value["skill-conventions-path"] === "string"
        ? value["skill-conventions-path"]
        : value["skill-conventions-path"] === null
          ? null
          : fallback.skillConventionsPath,
    skillReferencePattern:
      typeof value["skill-reference-pattern"] === "string"
        ? value["skill-reference-pattern"]
        : fallback.skillReferencePattern,
    maxComposedBytes:
      typeof value["max-composed-bytes"] === "number" &&
      value["max-composed-bytes"] > 0
        ? value["max-composed-bytes"]
        : fallback.maxComposedBytes,
  };
}

function mergeGateVocabulary(
  value: unknown,
  fallback: GateVocabularyConfig,
): GateVocabularyConfig {
  if (!isRecord(value)) return fallback;
  return {
    verificationGate:
      stringArray(value["verification-gate"]) ?? fallback.verificationGate,
    explicitPass: stringArray(value["explicit-pass"]) ?? fallback.explicitPass,
    humanStop: stringArray(value["human-stop"]) ?? fallback.humanStop,
  };
}

function mergeSubtypeDetection(
  value: unknown,
  fallback: SubtypeDetection,
): SubtypeDetection {
  if (!isRecord(value)) return fallback;
  const kinds = stringArray(value.kinds);
  return {
    kinds: kinds ? (kinds as ArtifactKind[]) : fallback.kinds,
    namePatterns: stringArray(value["name-patterns"]) ?? fallback.namePatterns,
    headingPatterns:
      stringArray(value["heading-patterns"]) ?? fallback.headingPatterns,
    mustNotHave: stringArray(value["must-not-have"]) ?? fallback.mustNotHave,
  };
}

function mergeSubtypeProfile(
  value: unknown,
  fallback: SubtypeProfile,
): SubtypeProfile {
  if (!isRecord(value)) return fallback;
  const profile: Record<MetricName, number> = { ...fallback.profile };
  if (isRecord(value.profile)) {
    for (const key of Object.keys(profile) as MetricName[]) {
      const v = value.profile[key];
      if (typeof v === "number" && v >= 0) profile[key] = v;
    }
  }
  return {
    detection: mergeSubtypeDetection(value.detection, fallback.detection),
    profile,
    notes: typeof value.notes === "string" ? value.notes : fallback.notes,
  };
}

function mergeSubtypes(
  value: unknown,
  fallback: Record<ArtifactSubtype, SubtypeProfile>,
): Record<ArtifactSubtype, SubtypeProfile> {
  if (!isRecord(value)) return fallback;
  const merged: Record<ArtifactSubtype, SubtypeProfile> = { ...fallback };
  for (const key of Object.keys(merged) as ArtifactSubtype[]) {
    if (key in value) {
      merged[key] = mergeSubtypeProfile(value[key], fallback[key]);
    }
  }
  return merged;
}

/**
 * Merge a raw quality config (read from YAML) on top of `DEFAULT_QUALITY_CONFIG`.
 * Returns the original defaults if the input is null or invalid.
 */
export function mergeQualityConfig(raw: unknown): QualityConfig {
  if (!isRecord(raw)) return cloneQualityConfig(DEFAULT_QUALITY_CONFIG);
  const defaults = cloneQualityConfig(DEFAULT_QUALITY_CONFIG);
  return {
    walkRoots: {
      skills: mergeWalkRoot(
        isRecord(raw["walk-roots"]) ? raw["walk-roots"].skills : undefined,
        defaults.walkRoots.skills,
      ),
      references: mergeWalkRoot(
        isRecord(raw["walk-roots"]) ? raw["walk-roots"].references : undefined,
        defaults.walkRoots.references,
      ),
    },
    composition: mergeComposition(raw.composition, defaults.composition),
    maxArtifactBytes:
      typeof raw["max-artifact-bytes"] === "number" &&
      raw["max-artifact-bytes"] > 0
        ? raw["max-artifact-bytes"]
        : defaults.maxArtifactBytes,
    gateVocabulary: mergeGateVocabulary(
      raw["gate-vocabulary"],
      defaults.gateVocabulary,
    ),
    toolKeywordsRegex:
      typeof raw["tool-keywords-regex"] === "string"
        ? raw["tool-keywords-regex"]
        : defaults.toolKeywordsRegex,
    subtypes: mergeSubtypes(raw.subtypes, defaults.subtypes),
    fixturePath:
      typeof raw["fixture-path"] === "string"
        ? raw["fixture-path"]
        : defaults.fixturePath,
    additionalFixtures:
      stringArray(raw["additional-fixtures"]) ?? defaults.additionalFixtures,
  };
}

/** Deep-clone the default config so callers can mutate it safely. */
export function cloneQualityConfig(config: QualityConfig): QualityConfig {
  return {
    walkRoots: {
      skills: config.walkRoots.skills.map((root) => ({ ...root })),
      references: config.walkRoots.references.map((root) => ({ ...root })),
    },
    composition: { ...config.composition },
    maxArtifactBytes: config.maxArtifactBytes,
    gateVocabulary: {
      verificationGate: [...config.gateVocabulary.verificationGate],
      explicitPass: [...config.gateVocabulary.explicitPass],
      humanStop: [...config.gateVocabulary.humanStop],
    },
    toolKeywordsRegex: config.toolKeywordsRegex,
    subtypes: Object.fromEntries(
      Object.entries(config.subtypes).map(([key, value]) => [
        key,
        {
          detection: {
            kinds: [...value.detection.kinds],
            namePatterns: [...value.detection.namePatterns],
            headingPatterns: [...value.detection.headingPatterns],
            mustNotHave: [...value.detection.mustNotHave],
          },
          profile: { ...value.profile },
          notes: value.notes,
        },
      ]),
    ) as Record<ArtifactSubtype, SubtypeProfile>,
    fixturePath: config.fixturePath,
    additionalFixtures: [...config.additionalFixtures],
  };
}

/**
 * Load `.goat-flow/config.yaml` and return its merged `quality` section,
 * falling back to `DEFAULT_QUALITY_CONFIG` if the file is missing or has
 * no `quality` block.
 */
export function loadQualityConfig(projectRoot: string): QualityConfig {
  const loaded = loadConfig(projectRoot);
  const raw = (loaded.config as { quality?: unknown }).quality;
  return mergeQualityConfig(raw);
}

/** Compile an array of regex sources into a single OR'd RegExp. */
export function compilePatternList(patterns: string[]): RegExp {
  if (patterns.length === 0) {
    return /(?!)/; // never matches
  }
  return new RegExp(patterns.join("|"), "i");
}

/** Compute the profile-max total for a subtype. */
export function profileMaxForSubtype(
  config: QualityConfig,
  subtype: ArtifactSubtype,
): number {
  return Object.values(config.subtypes[subtype].profile).reduce(
    (sum, value) => sum + value,
    0,
  );
}
