/**
 * Top-level orchestration of the skill-quality scoring pipeline. Wires the stages together -
 * classify the artifact, detect its semantic shape, compose its scoring surface, run every metric,
 * then derive a recommendation - and returns the assembled SkillQualityReport.
 *
 * Three entry points sit at different I/O levels: `scoreContent` is pure (content passed in, no
 * disk read) for uploads and pastes; `scoreArtifact` reads one artifact from disk first; and
 * `scoreAllArtifacts` walks the inventory and scores everything. Keep `scoreContent` the shared
 * core so disk-backed and in-memory scoring stay identical.
 */
import {
  loadQualityConfig,
  profileMaxForSubtype,
  type QualityConfig,
} from "./quality-config.js";
import {
  composeArtifactContent,
  discoverArtifacts,
  readArtifactContent,
  stripYamlFrontmatter,
} from "./skill-quality-content.js";
import {
  classifyArtifact,
  detectArtifactShape,
} from "./skill-quality-classification.js";
import { ALL_METRICS } from "./skill-quality-metrics.js";
import { deriveRecommendation } from "./skill-quality-recommendation.js";
import type {
  ArtifactEntry,
  ComposeOptions,
  MetricInput,
  SkillQualityReport,
} from "./skill-quality-types.js";

const VAGUE_AUTHORING_PATTERNS = [
  { label: "as appropriate", pattern: /\bas appropriate\b/i },
  { label: "as needed", pattern: /\bas needed\b/i },
  { label: "where possible", pattern: /\bwhere possible\b/i },
  { label: "if useful", pattern: /\bif useful\b/i },
  { label: "etc.", pattern: /\betc\./i },
] as const;
const ACTIONABLE_VAGUE_CONTEXT_PATTERN =
  /\b(?:when|unless|before|after|because|until|only if|only for|owned by|owner:|responsible|requires?|trigger(?:ed)? by)\b/i;

/**
 * Finds vague prose that leaves a skill author without a trigger, condition, or owner.
 * The dashboard uses these strings as advisory fit notes; scores remain unchanged.
 */
function findVagueLanguageAdvisories(content: string): string[] {
  const proseLines = stripYamlFrontmatter(content).split("\n");
  const advisoryNotes: string[] = [];
  let readingCodeFence = false;

  // Each prose line maps to the guidance a skill author sees in the quality panel.
  for (
    let proseLineIndex = 0;
    proseLineIndex < proseLines.length;
    proseLineIndex += 1
  ) {
    // An absent array entry means the user supplied an empty final line.
    const currentProseLine = proseLines[proseLineIndex] ?? "";

    // Code fences show literal examples, so their wording must not create authoring advice.
    if (/^\s*```/.test(currentProseLine)) {
      readingCodeFence = !readingCodeFence;
      continue;
    }

    // Literal sample content is not an instruction the user must make actionable.
    if (readingCodeFence) {
      continue;
    }

    const vaguePhrase = VAGUE_AUTHORING_PATTERNS.find(({ pattern }) =>
      pattern.test(currentProseLine),
    );

    // A line without one of the calibrated phrases needs no advisory.
    if (!vaguePhrase) {
      continue;
    }

    const currentLineWithoutVaguePhrase = currentProseLine.replace(
      vaguePhrase.pattern,
      "",
    );
    // A missing next line means the vague phrase has no follow-on condition.
    const nextProseLine = proseLines[proseLineIndex + 1] ?? "";
    const userFacingContext = `${currentLineWithoutVaguePhrase} ${nextProseLine}`;

    // A nearby trigger, condition, or owner tells the user exactly when the advice applies.
    if (ACTIONABLE_VAGUE_CONTEXT_PATTERN.test(userFacingContext)) {
      continue;
    }

    advisoryNotes.push(
      `advisory vague-language: unconditioned "${vaguePhrase.label}" in prose line ${proseLineIndex + 1}; add a same-line or next-line trigger, condition, or owner`,
    );
  }

  return advisoryNotes;
}

/**
 * Score raw content against the rubric without reading any file from disk.
 * Used by both `scoreArtifact` (which reads first) and `evaluateContent`
 * (which gets content from an upload or paste).
 *
 * @param projectRoot - absolute project root; used for path-relative composition, not as a read key.
 * @param artifact - inventory record being scored; its kind/path drive classification and composition.
 * @param rawContent - the artifact text to score; supplied by the caller, never re-read here.
 * @param config - resolved quality config providing subtype profiles, caps, and composition sources.
 * @param preReadNotes - notes from an earlier disk read (e.g. truncation) prepended to `fitNotes`.
 * @param options - composition toggles; pass `scanDisk: false` for uploads so sibling files are not read.
 * @returns the full report - score, capped metric rows, classification, shape, and recommendation;
 *   `shapeMismatch` true means the content shape differs from the scored subtype and needs review.
 */
export function scoreContent(
  projectRoot: string,
  artifact: ArtifactEntry,
  rawContent: string,
  config: QualityConfig,
  preReadNotes: string[] = [],
  options: ComposeOptions = {},
): SkillQualityReport {
  const classification = classifyArtifact(artifact, rawContent, config);
  const subtype = classification.detectedSubtype;
  const shape = detectArtifactShape(artifact, rawContent);
  const profileMax = profileMaxForSubtype(config, subtype);
  const composed = composeArtifactContent(
    projectRoot,
    artifact,
    rawContent,
    config,
    options,
  );
  const metricInput: MetricInput = {
    rawContent: composed.raw,
    composedContent: composed.composed,
    artifact,
    subtype,
    profileMax,
    projectRoot,
    config,
  };
  const metrics = ALL_METRICS.map((scorer) => scorer(metricInput));

  const totalScore = metrics.reduce(
    (scoreSum, metric) => scoreSum + metric.score,
    0,
  );
  const maxTotalScore = metrics.reduce(
    (maximumSum, metric) => maximumSum + metric.maxScore,
    0,
  );
  const { recommendation, fitNotes } = deriveRecommendation(
    artifact,
    metrics,
    totalScore,
    maxTotalScore,
    classification,
    shape,
  );
  const vagueLanguageAdvisories =
    artifact.kind === "skill" || subtype === "playbook"
      ? findVagueLanguageAdvisories(composed.raw)
      : [];

  return {
    artifact,
    totalScore,
    maxTotalScore,
    profileMax,
    subtype,
    detectedShape: shape.detectedShape,
    shapeConfidence: shape.confidence,
    shapeMismatch: shape.detectedShape !== subtype,
    classification,
    recommendation,
    metrics,
    composedFrom: composed.sources,
    fitNotes: [
      ...preReadNotes,
      ...composed.notes,
      ...vagueLanguageAdvisories,
      ...fitNotes,
    ],
  };
}

/**
 * Scores one installed artifact for the dashboard's user-facing quality detail.
 * @param projectRoot - project whose installed artifact and quality config are read
 * @param artifact - artifact selected by the user; its path identifies the file to score
 * @param config - resolved project rubric; defaults preserve zero-config behavior
 * @returns the current report, including advisory notes; an unreadable file scores as empty input.
 */
export function scoreArtifact(
  projectRoot: string,
  artifact: ArtifactEntry,
  config: QualityConfig = loadQualityConfig(projectRoot),
): SkillQualityReport {
  const raw = readArtifactContent(projectRoot, artifact, config);
  return scoreContent(projectRoot, artifact, raw.content, config, raw.notes);
}

/**
 * Scores every discovered artifact for inventory and release-wide quality views.
 * @param projectRoot - project whose complete quality inventory the user requested
 * @param config - resolved project rubric applied consistently to every artifact
 * @returns all current reports; an empty inventory means the user has no discoverable artifacts.
 */
export function scoreAllArtifacts(
  projectRoot: string,
  config: QualityConfig = loadQualityConfig(projectRoot),
): SkillQualityReport[] {
  return discoverArtifacts(projectRoot, config).map((artifact) =>
    scoreArtifact(projectRoot, artifact, config),
  );
}
