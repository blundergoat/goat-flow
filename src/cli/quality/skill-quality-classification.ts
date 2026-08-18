/**
 * Subtype classification for skill-quality scoring: given an artifact and its content, score it against every candidate subtype (name patterns,
 * heading patterns, must-not-have vetoes) and pick the dominant match, with a confidence figure that signals how clearly it won.
 *
 * Two independent passes live here.
 * The scoring pass (`classifyArtifact`) selects the profile that drives the rubric; a separate semantic shape pass exists to catch misfiled artifacts
 * whose content does not match the profile they were scored under.
 *
 * Detection order is fixed per kind so higher-priority subtypes win ties deterministically.
 */
import type {
  ArtifactSubtype,
  QualityConfig,
  SubtypeDetection,
} from "./quality-config.js";
import { hasSection } from "./skill-quality-content.js";
import type {
  ArtifactEntry,
  ClassificationResult,
  ShapeDetectionResult,
} from "./skill-quality-types.js";

const SUBTYPE_NAME_MATCH_SCORE = 5; // Threshold: name match outweighs two heading hits so canonical skills keep their calibrated subtype.
const SUBTYPE_HEADING_MATCH_SCORE = 2;
const SUBTYPE_FALLBACK_SCORE = 1;
const FALLBACK_ONLY_CONFIDENCE = 0.3;

/**
 * Raw subtype score with the reasoning used to explain the winning profile.
 */
interface SubtypeMatchScore {
  subtype: ArtifactSubtype;
  score: number;
  reasoning: string[];
}

/**
 * Detect fallback-only matches so confidence stays visibly low.
 */
function isFallbackOnlyMatch(match: SubtypeMatchScore): boolean {
  return (
    match.score === SUBTYPE_FALLBACK_SCORE &&
    match.reasoning.some((reason) => reason.includes("fallback"))
  );
}

/**
 * Say how clearly the winning subtype beat the runner-up, which is what tells a reviewer whether to trust the classification.
 *
 * @param top - highest-scoring subtype match
 * @param second - next-best match; `undefined` means nothing else scored at all, which reads as an unopposed win
 * @returns confidence between 0 and 1, shown beside the subtype in the Skills tab
 */
function subtypeConfidence(
  top: SubtypeMatchScore,
  second: SubtypeMatchScore | undefined,
): number {
  if (isFallbackOnlyMatch(top)) return FALLBACK_ONLY_CONFIDENCE;
  return second === undefined ? 1 : top.score / (top.score + second.score);
}

/**
 * Score a single subtype's detection against an artifact. Returns 0 when the
 * subtype is incompatible (wrong kind or vetoed by a `mustNotHave` heading).
 *
 * Scoring rules:
 *  - Name match: +SUBTYPE_NAME_MATCH_SCORE (unconditional - preserves the
 *    OR semantics where `goat-security` is a report regardless of Step 0).
 *  - Heading match: +SUBTYPE_HEADING_MATCH_SCORE per match, vetoed by
 *    `mustNotHave`. Heading-only matches that trigger `mustNotHave` return 0.
 *  - Empty rules (fallback subtype): SUBTYPE_FALLBACK_SCORE so the fallback
 *    always matches with low confidence.
 */

/**
 * Add up the score for every detection heading present in the artifact.
 *
 * Each matching heading counts, so an artifact carrying several of a subtype's hallmark sections scores higher than one
 * carrying a single heading by coincidence.
 *
 * Side effect: appends one reasoning line per match, which is what the Skills tab shows as evidence for the classification.
 *
 * @param headingPatterns - the subtype's heading patterns
 * @param content - raw artifact text
 * @param reasoning - accumulator appended to in place
 * @returns the total heading score; zero means no hallmark heading was found
 */
function scoreHeadingMatches(
  headingPatterns: readonly string[],
  content: string,
  reasoning: string[],
): number {
  let score = 0;
  for (const pattern of headingPatterns) {
    if (new RegExp(pattern, "i").test(content)) {
      score += SUBTYPE_HEADING_MATCH_SCORE;
      reasoning.push(`heading "${pattern}" present`);
    }
  }
  return score;
}

/**
 * Find the first must-not-have pattern present in the artifact, which disqualifies a heading-only match.
 *
 * @param vetoes - the subtype's must-not-have patterns
 * @param content - raw artifact text
 * @returns the matching veto pattern, or null when none applies
 */
function findMatchingVeto(
  vetoes: readonly string[],
  content: string,
): string | null {
  return vetoes.find((veto) => new RegExp(veto, "i").test(content)) ?? null;
}

/**
 * Score how well one artifact matches a single candidate subtype, from its name, its headings, and the shapes that rule the subtype out.
 *
 * @param artifact - artifact being classified, supplying the name hints
 * @param content - artifact text, which carries the heading evidence
 * @param detection - signals configured for this subtype
 * @param subtype - subtype being scored
 * @returns the score plus the reasons behind it; a vetoed subtype scores zero rather than a weak positive
 */
function scoreSubtypeMatch(
  artifact: ArtifactEntry,
  content: string,
  detection: SubtypeDetection,
  subtype: ArtifactSubtype,
): SubtypeMatchScore {
  const reasoning: string[] = [];
  if (detection.kinds.length > 0 && !detection.kinds.includes(artifact.kind)) {
    return { subtype, score: 0, reasoning };
  }

  if (
    detection.namePatterns.length === 0 &&
    detection.headingPatterns.length === 0
  ) {
    reasoning.push(`fallback for kind=${artifact.kind}`);
    return { subtype, score: SUBTYPE_FALLBACK_SCORE, reasoning };
  }

  const nameMatched = detection.namePatterns.includes(artifact.name);
  let score = 0;
  if (nameMatched) {
    score += SUBTYPE_NAME_MATCH_SCORE;
    reasoning.push(`name "${artifact.name}" in name-patterns`);
  }

  const headingScore = scoreHeadingMatches(
    detection.headingPatterns,
    content,
    reasoning,
  );
  score += headingScore;

  // Nothing matched, so this subtype is simply not a candidate for the artifact.
  if (score === 0) return { subtype, score: 0, reasoning };

  // A heading-only match is the weak case, so a must-not-have veto is allowed to overturn it.
  if (!nameMatched && headingScore > 0) {
    const veto = findMatchingVeto(detection.mustNotHave, content);
    if (veto !== null) {
      reasoning.push(`vetoed by must-not-have "${veto}"`);
      return { subtype, score: 0, reasoning };
    }
  }

  return { subtype, score, reasoning };
}

const REFERENCE_DETECTION_ORDER: ArtifactSubtype[] = [
  "meta",
  "index",
  "playbook",
];
const SKILL_DETECTION_ORDER: ArtifactSubtype[] = [
  "dispatcher",
  "report",
  "workflow",
];

/**
 * Classify an artifact across all candidate subtypes.
 * The detected subtype is the highest-scoring match; confidence is `top / (top + second)` to communicate how dominant the leading subtype is.
 *
 * @param artifact - inventory record; its `kind` selects the fixed subtype detection order.
 * @param content - raw artifact text matched against name/heading patterns and must-not-have vetoes.
 * @param config - quality config supplying each subtype's detection rules and profiles.
 * @returns the winning subtype with confidence and the ranked alternatives kept for reviewer
 *   context; confidence near 0.3 flags a fallback-only match that needs human subtype review.
 */
export function classifyArtifact(
  artifact: ArtifactEntry,
  content: string,
  config: QualityConfig,
): ClassificationResult {
  const order =
    artifact.kind === "shared-reference"
      ? REFERENCE_DETECTION_ORDER
      : SKILL_DETECTION_ORDER;

  const matches = order
    .map((subtype) =>
      scoreSubtypeMatch(
        artifact,
        content,
        config.subtypes[subtype].detection,
        subtype,
      ),
    )
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0) {
    const fallback =
      artifact.kind === "shared-reference" ? "playbook" : "workflow";
    return {
      detectedSubtype: fallback,
      confidence: 0,
      alternatives: [],
      reasoning: [
        `no subtype matched ${artifact.id}; using ${fallback} as fallback`,
      ],
    };
  }

  const top = matches[0];
  if (!top) {
    const fallback =
      artifact.kind === "shared-reference" ? "playbook" : "workflow";
    return {
      detectedSubtype: fallback,
      confidence: 0,
      alternatives: [],
      reasoning: ["unreachable: empty match list after pre-filter"],
    };
  }
  const rest = matches.slice(1);
  const second = rest[0];
  const confidence = subtypeConfidence(top, second);
  const reasoning = [
    `detected ${top.subtype} (score ${top.score}): ${top.reasoning.join("; ")}`,
    ...rest.map(
      (m) =>
        `also matched ${m.subtype} (score ${m.score}): ${m.reasoning.join("; ")}`,
    ),
  ];
  return {
    detectedSubtype: top.subtype,
    confidence,
    alternatives: rest.map(({ subtype, score }) => ({ subtype, score })),
    reasoning,
  };
}

const SHAPE_DETECTION_ORDER: ArtifactSubtype[] = [
  "dispatcher",
  "report",
  "workflow",
  "playbook",
  "index",
  "meta",
];

const MIN_SHAPE_SCORE = 3; // Threshold: one strong signal or two heading signals required before shape mismatch can fire.

/**
 * Count pattern hits when repeated tool or step references are meaningful signals.
 */
function countRegexMatches(content: string, pattern: RegExp): number {
  return Array.from(content.matchAll(pattern)).length;
}

/**
 * Add up the signals that fired for one subtype and keep their labels, so the reviewer can see why a file was classified the way it was.
 *
 * @param subtype - subtype these signals belong to
 * @param signals - triples of whether the signal fired, its weight, and its reader-facing label
 * @returns the summed score with one reason per fired signal; no fired signal yields a zero score and no reasons
 */
function scoreFromSignals(
  subtype: ArtifactSubtype,
  signals: Array<[boolean, number, string]>,
): SubtypeMatchScore {
  let score = 0;
  const reasoning: string[] = [];
  for (const [matched, value, reason] of signals) {
    if (!matched) continue;
    score += value;
    reasoning.push(reason);
  }
  return { subtype, score, reasoning };
}

// eslint-disable-next-line complexity -- intentional because semantic shape has separate signal sets per supported subtype; splitting would obscure the scoring table
function scoreShapeMatch(
  artifact: ArtifactEntry,
  content: string,
  subtype: ArtifactSubtype,
): SubtypeMatchScore {
  const hasStepZero = hasSection(content, /##\s+Step 0/i);
  const hasCheckpoint = /\bCHECKPOINT\b/i.test(content);
  const hasModeSystem =
    /\b(?:Read-Only|File-Write)\b|\bPlan\b.*\bmode\b|\bImplement\b.*\bmode\b/i.test(
      content,
    );
  const hasPhaseHeadings = /^##\s+Phase\s+\d/im.test(content);
  const hasSkillVersion = /goat-flow-skill-version/i.test(content);
  const hasFrontmatterName = /^---[\s\S]*?name:\s*.+[\s\S]*?---/m.test(content);
  const browserToolRefs = countRegexMatches(
    content,
    /\bbrowser_[A-Za-z0-9_]+\b/g,
  );
  const mcpToolRefs = countRegexMatches(content, /\bmcp__[A-Za-z0-9_]+\b/g);
  const proceduralStepCount = countRegexMatches(
    content,
    /^##\s+Step\s+\d\b/gim,
  );

  if (subtype === "dispatcher") {
    return scoreFromSignals(subtype, [
      [artifact.name === "goat", 5, 'name "goat"'],
      [hasSection(content, /##\s+Route Map/i), 5, "Route Map section"],
      [/\b(?:route|dispatch)\b/i.test(content), 2, "routing language"],
    ]);
  }

  if (subtype === "report") {
    return scoreFromSignals(subtype, [
      [artifact.name === "goat-security", 5, 'name "goat-security"'],
      [
        hasSection(content, /##\s+Quick Scan Path/i) ||
          hasSection(content, /##\s+Audit Mode/i),
        4,
        "report/audit heading",
      ],
      [
        /\b(?:reporting-only|read-only)\b/i.test(content),
        2,
        "report-only language",
      ],
      [
        /\b(?:finding|OBSERVED|INFERRED)\b/i.test(content),
        2,
        "finding evidence terms",
      ],
    ]);
  }

  if (subtype === "workflow") {
    return scoreFromSignals(subtype, [
      [hasStepZero, 3, "Step 0 intake"],
      [hasCheckpoint, 3, "CHECKPOINT gates"],
      [hasModeSystem, 2, "mode system"],
      [hasPhaseHeadings, 2, "phase headings"],
      [hasSkillVersion, 1, "skill version header"],
      [hasFrontmatterName, 1, "skill frontmatter name"],
      [
        /\b(?:Verification|Proof Gate|Testing Gate)\b/i.test(content),
        2,
        "verification language",
      ],
    ]);
  }

  if (subtype === "playbook") {
    return scoreFromSignals(subtype, [
      [hasSection(content, /##\s+Environment/i), 2, "Environment section"],
      [
        hasSection(content, /##\s+Prerequisites/i) ||
          hasSection(content, /##\s+Availability Check/i),
        2,
        "prerequisite or availability section",
      ],
      [
        hasSection(content, /##\s+Common Gotchas/i) ||
          hasSection(content, /Troubleshoot|Fallback/i),
        2,
        "troubleshooting/gotchas",
      ],
      [hasSection(content, /##\s+Quick Reference/i), 2, "Quick Reference"],
      [
        browserToolRefs + mcpToolRefs >= 2 || /Playwright\s+MCP/i.test(content),
        3,
        "repeated browser/MCP tool references",
      ],
      [proceduralStepCount >= 2, 2, "procedural Step N headings"],
      [
        /\btool\b.*\bprotocol\b|\bobservation\b.*\bworkflow\b|\bcapture\b.*\bworkflow\b|\bInteraction Workflow\b/i.test(
          content,
        ),
        2,
        "tool/playbook workflow language",
      ],
    ]);
  }

  if (subtype === "index") {
    return scoreFromSignals(subtype, [
      [artifact.name === "skill-quality-testing", 5, "known index name"],
      [
        /Which file to load|Cross-references/i.test(content),
        3,
        "index routing",
      ],
      [/index/i.test(artifact.name), 2, "index name"],
    ]);
  }

  return scoreFromSignals(subtype, [
    [
      artifact.name === "skill-preamble" ||
        artifact.name === "skill-conventions",
      6,
      "known meta-reference name",
    ],
    [/goat-flow-reference-version/i.test(content), 2, "reference version"],
    [
      /loaded by every skill|shared conventions/i.test(content),
      2,
      "meta language",
    ],
  ]);
}

/**
 * Work out what kind of artifact a file actually is, so the Skills tab scores it against the right profile.
 *
 * A user can paste or install anything, so the shape is inferred from the content rather than trusted from the filename or directory.
 *
 * Ranking is a stable contract: candidates below the minimum score are dropped before sorting, so a weak partial match never wins by default.
 *
 * @param artifact - the discovered artifact, supplying its path and kind as weak hints
 * @param content - the artifact's text, which is the real evidence for the decision
 * @returns the detected shape and its confidence; no confident match falls back to the generic shape rather than guessing
 */
export function detectArtifactShape(
  artifact: ArtifactEntry,
  content: string,
): ShapeDetectionResult {
  const matches = SHAPE_DETECTION_ORDER.map((subtype) =>
    scoreShapeMatch(artifact, content, subtype),
  )
    .filter((match) => match.score >= MIN_SHAPE_SCORE)
    .sort((a, b) => b.score - a.score);

  const top = matches[0];
  // Nothing scored above the floor, so the artifact keeps a neutral shape rather than being labelled from a guess.
  if (!top) {
    const fallback =
      artifact.kind === "shared-reference" ? "playbook" : "workflow";
    return {
      detectedShape: fallback,
      confidence: 0,
      alternatives: [],
      reasoning: [
        `no semantic shape matched ${artifact.id} above MIN_SHAPE_SCORE=${MIN_SHAPE_SCORE}; using ${fallback} as fallback`,
      ],
    };
  }

  const rest = matches.slice(1);
  const second = rest[0];
  return {
    detectedShape: top.subtype,
    confidence: subtypeConfidence(top, second),
    alternatives: rest.map(({ subtype, score }) => ({ subtype, score })),
    reasoning: [
      `detected ${top.subtype} shape (score ${top.score}): ${top.reasoning.join("; ")}`,
      ...rest.map(
        (m) =>
          `also matched ${m.subtype} shape (score ${m.score}): ${m.reasoning.join("; ")}`,
      ),
    ],
  };
}
