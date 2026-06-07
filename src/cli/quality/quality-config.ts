/**
 * Configuration layer for the deterministic skill-quality scoring engine.
 *
 * Goat-flow ships with `DEFAULT_QUALITY_CONFIG` calibrated against the in-tree
 * 12-artifact corpus. Consumer projects override pieces via
 * `.goat-flow/config.yaml` under the top-level `quality` section.
 *
 * Zero-config behaviour (no `quality` section in config) is identical to the
 * older hardcoded defaults; fixtures still pass without any project
 * override.
 */
import { loadConfig } from "../config/reader.js";
import { getAgentProfiles } from "../agents/registry.js";

/** Top-level artifact categories that the skill-quality engine scores. */
export type ArtifactKind = "skill" | "shared-reference";

/** Discovery provenance preserved in reports so mirrors and templates stay distinct. */
export type ArtifactSource =
  | "workflow"
  | "installed"
  | "agent-mirror"
  | "github-mirror"
  | "shared-reference";

/** Rubric subtype selected after detection; each subtype owns a separate score profile. */
export type ArtifactSubtype =
  | "workflow"
  | "dispatcher"
  | "report"
  | "playbook"
  | "index"
  | "meta";

/** Stable metric keys used by scoring output, fixtures, and config overrides. */
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

/** Directory to crawl plus the source label carried into artifact reports. */
interface WalkRoot {
  dir: string;
  source: ArtifactSource;
}

/** Ordered matching rules that assign an artifact to a rubric subtype. */
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

/** Detection rule and metric weights for one artifact subtype. */
interface SubtypeProfile {
  /** Detection rules in priority order; first matching subtype wins. */
  detection: SubtypeDetection;
  /** Per-metric max scores for this subtype. */
  profile: Record<MetricName, number>;
  /** Human-readable description of when this subtype applies. */
  notes: string;
}

/** Shared-reference composition settings used before an artifact is scored. */
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

/** Configurable regex vocabulary for the gate-quality metric. */
interface GateVocabularyConfig {
  /** Patterns that count as a verification-gate signal (+5 points). */
  verificationGate: string[];
  /** Patterns that count as an explicit pass/fail signal (+3 points). */
  explicitPass: string[];
  /** Patterns that count as a human-stop signal (+2 points). */
  humanStop: string[];
}

/** Normalized quality configuration after defaults and user YAML are merged. */
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

/** Goat-flow's calibrated defaults. Mirrors the legacy hardcoded values exactly. */
export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  walkRoots: {
    skills: [
      { dir: ".claude/skills", source: "installed" },
      { dir: ".agents/skills", source: "agent-mirror" },
      { dir: ".github/skills", source: "github-mirror" },
      { dir: "workflow/skills", source: "workflow" },
    ],
    references: [
      { dir: ".goat-flow/skill-docs", source: "shared-reference" },
      { dir: ".goat-flow/skill-docs/playbooks", source: "shared-reference" },
      {
        dir: ".goat-flow/skill-docs/skill-quality-testing",
        source: "shared-reference",
      },
    ],
  },
  composition: {
    skillPreamblePath: ".goat-flow/skill-docs/skill-preamble.md",
    skillConventionsPath: ".goat-flow/skill-docs/skill-conventions.md",
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
    "browser-use|page-capture|Playwright\\s+MCP|\\bbrowser_(?:navigate|snapshot|click|type|fill_form|evaluate|resize|wait_for|network_requests|console_messages)\\b|\\bmcp__[A-Za-z0-9_]+\\b|\\bgh\\b",
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
        headingPatterns: [
          "##\\s+Availability Check",
          "##\\s+.*Workflow",
          "##\\s+(Environment|Prerequisites|Common Gotchas|Quick Reference)\\b",
          "\\bbrowser_(?:navigate|snapshot|click|type|fill_form|evaluate|resize|wait_for|network_requests|console_messages)\\b",
          "\\bPlaywright\\s+MCP\\b",
          "\\bmcp__[A-Za-z0-9_]+\\b",
        ],
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
        headingPatterns: [
          "##\\s+Step 0\\b",
          "\\bCHECKPOINT\\b",
          "\\b(Read-Only|File-Write|Implement)\\b",
        ],
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
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    Array.isArray(candidate) === false
  );
}

/** Return only string entries from a user-provided array; invalid containers fall back. */
function stringArray(candidate: unknown): string[] | null {
  if (!Array.isArray(candidate)) return null;
  return candidate.filter(
    (entry): entry is string => typeof entry === "string",
  );
}

/** Validate regex sources; RegExp syntax errors use a `false` fallback instead of failing scoring. */
function isValidRegexSource(source: string, flags = "i"): boolean {
  try {
    new RegExp(source, flags);
    return true;
  } catch {
    return false;
  }
}

/** Merge a regex-source array while dropping invalid expressions individually. */
function regexArray(candidatePatterns: unknown, fallback: string[]): string[] {
  const strings = stringArray(candidatePatterns);
  if (strings === null) return fallback;
  return strings.filter((source) => isValidRegexSource(source));
}

/** Normalize string and object walk-root entries into source-tagged crawl roots. */
function mergeWalkRoot(rawRoots: unknown, fallback: WalkRoot[]): WalkRoot[] {
  if (!Array.isArray(rawRoots)) return fallback;
  const result: WalkRoot[] = [];
  for (const entry of rawRoots) {
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
  rawComposition: unknown,
  fallback: CompositionConfig,
): CompositionConfig {
  if (!isRecord(rawComposition)) return fallback;
  return {
    skillPreamblePath:
      typeof rawComposition["skill-preamble-path"] === "string"
        ? rawComposition["skill-preamble-path"]
        : rawComposition["skill-preamble-path"] === null
          ? null
          : fallback.skillPreamblePath,
    skillConventionsPath:
      typeof rawComposition["skill-conventions-path"] === "string"
        ? rawComposition["skill-conventions-path"]
        : rawComposition["skill-conventions-path"] === null
          ? null
          : fallback.skillConventionsPath,
    skillReferencePattern:
      typeof rawComposition["skill-reference-pattern"] === "string" &&
      isValidRegexSource(rawComposition["skill-reference-pattern"], "g")
        ? rawComposition["skill-reference-pattern"]
        : fallback.skillReferencePattern,
    maxComposedBytes:
      typeof rawComposition["max-composed-bytes"] === "number" &&
      rawComposition["max-composed-bytes"] > 0
        ? rawComposition["max-composed-bytes"]
        : fallback.maxComposedBytes,
  };
}

function mergeGateVocabulary(
  rawVocabulary: unknown,
  fallback: GateVocabularyConfig,
): GateVocabularyConfig {
  if (!isRecord(rawVocabulary)) return fallback;
  return {
    verificationGate: regexArray(
      rawVocabulary["verification-gate"],
      fallback.verificationGate,
    ),
    explicitPass: regexArray(
      rawVocabulary["explicit-pass"],
      fallback.explicitPass,
    ),
    humanStop: regexArray(rawVocabulary["human-stop"], fallback.humanStop),
  };
}

function mergeSubtypeDetection(
  rawDetection: unknown,
  fallback: SubtypeDetection,
): SubtypeDetection {
  if (!isRecord(rawDetection)) return fallback;
  const kinds = stringArray(rawDetection.kinds);
  return {
    kinds: kinds ? (kinds as ArtifactKind[]) : fallback.kinds,
    namePatterns:
      stringArray(rawDetection["name-patterns"]) ?? fallback.namePatterns,
    headingPatterns: regexArray(
      rawDetection["heading-patterns"],
      fallback.headingPatterns,
    ),
    mustNotHave: regexArray(
      rawDetection["must-not-have"],
      fallback.mustNotHave,
    ),
  };
}

function mergeSubtypeProfile(
  rawProfile: unknown,
  fallback: SubtypeProfile,
): SubtypeProfile {
  if (!isRecord(rawProfile)) return fallback;
  const profile: Record<MetricName, number> = { ...fallback.profile };
  if (isRecord(rawProfile.profile)) {
    for (const key of Object.keys(profile) as MetricName[]) {
      const scoreValue = rawProfile.profile[key];
      if (typeof scoreValue === "number" && scoreValue >= 0) {
        profile[key] = scoreValue;
      }
    }
  }
  return {
    detection: mergeSubtypeDetection(rawProfile.detection, fallback.detection),
    profile,
    notes:
      typeof rawProfile.notes === "string" ? rawProfile.notes : fallback.notes,
  };
}

function mergeSubtypes(
  rawSubtypes: unknown,
  fallback: Record<ArtifactSubtype, SubtypeProfile>,
): Record<ArtifactSubtype, SubtypeProfile> {
  if (!isRecord(rawSubtypes)) return fallback;
  const merged: Record<ArtifactSubtype, SubtypeProfile> = { ...fallback };
  for (const key of Object.keys(merged) as ArtifactSubtype[]) {
    if (key in rawSubtypes) {
      merged[key] = mergeSubtypeProfile(rawSubtypes[key], fallback[key]);
    }
  }
  return merged;
}

/** Read installed agent profiles so default skill roots follow the current manifest. */
function manifestSkillWalkRoots(): WalkRoot[] {
  const roots = new Map<string, ArtifactSource>();
  for (const profile of getAgentProfiles()) {
    if (!roots.has(profile.skillsDir)) {
      roots.set(profile.skillsDir, profile.skillSource);
    }
  }
  roots.set("workflow/skills", "workflow");
  return Array.from(roots, ([dir, source]) => ({ dir, source }));
}

/** Clone calibrated defaults and replace hardcoded skill roots with manifest-derived roots. */
function defaultQualityConfig(): QualityConfig {
  const defaults = cloneQualityConfig(DEFAULT_QUALITY_CONFIG);
  defaults.walkRoots.skills = manifestSkillWalkRoots();
  return defaults;
}

/**
 * Merge a raw quality config (read from YAML) on top of `DEFAULT_QUALITY_CONFIG`.
 *
 * Each section falls back independently because project YAML is user-authored:
 * one invalid override should not discard unrelated valid rubric settings.
 *
 * @param raw - Parsed `quality` block from `.goat-flow/config.yaml`.
 * @returns Normalized quality config with defaults filled in for missing or invalid fields.
 */
export function mergeQualityConfig(raw: unknown): QualityConfig {
  if (!isRecord(raw)) return defaultQualityConfig();
  const defaults = defaultQualityConfig();
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
      typeof raw["tool-keywords-regex"] === "string" &&
      isValidRegexSource(raw["tool-keywords-regex"])
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

/**
 * Deep-clone a quality config so callers can mutate nested arrays safely.
 *
 * @param config - Normalized quality config to clone.
 * @returns Independent copy with no shared mutable arrays or nested objects.
 */
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
 *
 * @param projectRoot - Project root that may contain `.goat-flow/config.yaml`.
 * @returns Normalized quality config for the project.
 */
export function loadQualityConfig(projectRoot: string): QualityConfig {
  const loaded = loadConfig(projectRoot);
  const raw = (loaded.config as { quality?: unknown }).quality;
  return mergeQualityConfig(raw);
}

/**
 * Compile an array of regex sources into a single OR'd RegExp.
 *
 * @param patterns - Valid regex sources to combine.
 * @returns Case-insensitive matcher, or a never-match regex when the list is empty.
 */
export function compilePatternList(patterns: string[]): RegExp {
  if (patterns.length === 0) {
    return /(?!)/; // never matches
  }
  return new RegExp(patterns.join("|"), "i");
}

/**
 * Compute the maximum possible score for a subtype profile.
 *
 * @param config - Normalized quality config containing subtype profiles.
 * @param subtype - Subtype whose metric weights should be summed.
 * @returns Sum of all metric maxima for the subtype.
 */
export function profileMaxForSubtype(
  config: QualityConfig,
  subtype: ArtifactSubtype,
): number {
  return Object.values(config.subtypes[subtype].profile).reduce(
    (sum, value) => sum + value,
    0,
  );
}
