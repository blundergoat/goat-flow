/**
 * The rubric: one MetricScorer per scoring dimension (trigger clarity, workflow completeness, gate
 * quality, evidence/testability, cold-start executability, token cost, tool dependencies, write
 * risk, and skill-vs-reference fit), plus the `ALL_METRICS` list the scorer runs in order.
 *
 * Each scorer is a pure function of its MetricInput, runs the artifact text through regex/heading
 * heuristics, and routes its raw score through `finalizeMetric` for subtype-specific capping - so a
 * dimension that does not apply to a subtype reports `n/a`, not a low score. Some scorers attach
 * promote/demote/meta signals that feed recommendations without changing the numeric total. The
 * heuristics are deliberately conservative (calibrated against the in-tree `.claude/skills` corpus)
 * to keep false positives low; they are advisory tips, not hard deductions, where noted.
 */
import { compilePatternList } from "./quality-config.js";
import {
  countHeadings,
  countSubReferences,
  estimateTokens,
  hasSection,
  stripYamlFrontmatter,
} from "./skill-quality-content.js";
import {
  finalizeMetric,
  type MetricScorer,
  type MetricSignals,
} from "./skill-quality-types.js";

/** Workflow-summary detection for skill descriptions. Sourced from the prime
 *  writing-skills corpus (search: `Testing revealed that when a description
 *  summarizes`): when a description names *what the skill does internally*
 *  (procedural verbs, "X then Y" connectives) rather than *when to trigger*,
 *  agents tend to follow the description and skip the skill body. Detected as
 *  a yellow signal only - emits a tip via the trigger-clarity detail string;
 *  never deducts score. Verb list narrowed to keep <10% false-positive rate
 *  on the in-tree `.claude/skills` corpus. */
const WORKFLOW_VERB_RE =
  /\b(dispatches?|implements?(?:ing|ed)?|executes?(?:ing|ed)?|generates?|runs?|produces?|creates?|builds?|refactors?|writes?)\b/i;
const WORKFLOW_CONNECTIVE_RE = /\b(then|between)\b/i;

/**
 * Reads frontmatter descriptions to detect workflow summaries that make agents skip the skill body.
 */
function descriptionSummarizesWorkflow(content: string): boolean {
  const match = /^---[\s\S]*?description:\s*"([^"]+)"[\s\S]*?---/m.exec(
    content,
  );
  if (!match) return false;
  const description = match[1];
  if (!description) return false;
  const stripped = description.replace(/^Use when [^,.;-]*[,.;-]?\s*/i, "");
  return (
    WORKFLOW_VERB_RE.test(stripped) || WORKFLOW_CONNECTIVE_RE.test(stripped)
  );
}

// eslint-disable-next-line complexity -- intentional because exhaustive structural signal scoring keeps each trigger-clarity rule beside its note text
const triggerClarity: MetricScorer = (input) => {
  const { artifact, rawContent: content, subtype } = input;
  let score = 0;
  const notes: string[] = [];

  if (artifact.kind === "skill") {
    const hasFrontmatterDesc =
      /^---[\s\S]*?description:\s*".+"[\s\S]*?---/m.test(content);
    const hasWhenToUse =
      hasSection(content, /##\s+When to Use/i) || /\bUse when\b/i.test(content);
    const hasExclusion =
      /NOT this skill/i.test(content) ||
      /If the user names a skill explicitly/i.test(content);

    if (hasFrontmatterDesc) score += 5;
    else notes.push("missing frontmatter description");
    if (hasWhenToUse) score += 5;
    else notes.push('missing "When to Use" signal');
    if (subtype === "dispatcher") {
      const hasRouteMap = hasSection(content, /##\s+Route Map/i);
      if (hasRouteMap) score += 5;
      else
        notes.push("dispatcher missing Route Map for trigger disambiguation");
    } else if (hasExclusion) {
      score += 5;
    } else {
      notes.push('missing "NOT this skill" exclusion list');
    }

    if (hasFrontmatterDesc && descriptionSummarizesWorkflow(content)) {
      notes.push(
        "description summarizes workflow rather than triggering conditions",
      );
    }
  } else {
    const hasPurpose =
      hasSection(content, /##\s+Purpose/i) ||
      hasSection(content, /##\s+When to (load|use)/i) ||
      /^---[\s\S]*?goat-flow-reference-version/m.test(content);
    if (hasPurpose) score += 10;
    else notes.push("missing purpose or version header");

    const hasAvailCheck = hasSection(content, /Availability Check/i);
    if (hasAvailCheck) score += 5;
    else if (subtype === "meta" || subtype === "index") score += 5;
    else notes.push("missing Availability Check");
  }

  return finalizeMetric(
    input,
    "trigger-clarity",
    score,
    notes.length > 0 ? notes.join("; ") : "clear trigger definition",
  );
};

// eslint-disable-next-line complexity -- intentional because exhaustive structural signal scoring keeps each workflow-completeness rule beside its note text
const workflowCompleteness: MetricScorer = (input) => {
  const { artifact, rawContent: content, subtype, config } = input;
  let score = 0;
  const notes: string[] = [];

  if (artifact.kind === "skill") {
    const hasStepZero = hasSection(content, /##\s+Step 0/i);
    const phaseCount = countHeadings(content, 2) + countHeadings(content, 3);
    const humanStop = compilePatternList(config.gateVocabulary.humanStop);
    const hasCheckpoint = humanStop.test(content);
    const hasRouteMap = hasSection(content, /##\s+Route Map/i);
    const hasQuickScan = hasSection(content, /##\s+Quick Scan Path/i);

    if (subtype === "dispatcher") {
      if (hasRouteMap) score += 5;
      else notes.push("missing dispatcher Route Map");
    } else {
      if (hasStepZero || hasQuickScan) score += 5;
      else notes.push("missing Step 0 intake");
      if (phaseCount >= 4) score += 5;
      else notes.push(`only ${phaseCount} sections (expected 4+)`);
      if (hasCheckpoint || subtype === "report") score += 5;
      else notes.push("no checkpoint or blocking gate stops");
    }
  } else {
    const hasWorkflow =
      hasSection(content, /##\s+.*Workflow/i) ||
      hasSection(content, /##\s+Steps/i) ||
      hasSection(content, /###\s+Step\s+\d/i);
    const hasTroubleshooting =
      hasSection(content, /Troubleshoot/i) || hasSection(content, /Fallback/i);
    const sectionCount = countHeadings(content, 2);

    if (hasWorkflow || subtype === "index" || subtype === "meta") score += 5;
    else notes.push("no workflow/steps section");
    if (hasTroubleshooting || subtype === "meta") score += 5;
    else notes.push("no troubleshooting/fallback");
    if (sectionCount >= 3) score += 5;
    else notes.push(`only ${sectionCount} top-level sections`);
  }

  return finalizeMetric(
    input,
    "workflow-completeness",
    score,
    notes.length > 0 ? notes.join("; ") : "complete workflow",
  );
};

const gateQuality: MetricScorer = (input) => {
  const { composedContent: content, config } = input;
  let score = 0;
  const notes: string[] = [];

  const verificationGate = compilePatternList(
    config.gateVocabulary.verificationGate,
  );
  const explicitPass = compilePatternList(config.gateVocabulary.explicitPass);
  const humanStop = compilePatternList(config.gateVocabulary.humanStop);

  if (verificationGate.test(content)) score += 5;
  else notes.push("no verification gates or checklists");
  if (explicitPass.test(content)) score += 3;
  else notes.push("no explicit pass/fail criteria");
  if (humanStop.test(content)) score += 2;
  else notes.push("no explicit human stop or checkpoint");

  return finalizeMetric(
    input,
    "gate-quality",
    score,
    notes.length > 0 ? notes.join("; ") : "strong gates",
  );
};

const evidenceTestability: MetricScorer = (input) => {
  const content = input.composedContent;
  let score = 0;
  const notes: string[] = [];

  const hasEvidenceTag =
    /\b(?:OBSERVED|INFERRED)\b/i.test(content) ||
    /\bevidence[_-]quality\b/i.test(content);
  const hasEvidenceGate =
    /\bProof Gate\b/i.test(content) ||
    /\bevidence\b.*\brequired\b/i.test(content);
  const hasSemanticAnchors =
    /\(search:\s*"[^"]+"\)/i.test(content) || /search:.*`[^`]+`/i.test(content);

  if (hasEvidenceTag) score += 4;
  else notes.push("no evidence quality tags");
  if (hasEvidenceGate) score += 3;
  else notes.push("no evidence gate");
  if (hasSemanticAnchors) score += 3;
  else notes.push("no semantic anchors");

  return finalizeMetric(
    input,
    "evidence-testability",
    score,
    notes.length > 0 ? notes.join("; ") : "strong evidence contract",
  );
};

// eslint-disable-next-line complexity -- intentional because exhaustive structural signal scoring keeps each cold-start rule beside its note text
const coldStartExecutability: MetricScorer = (input) => {
  const { artifact, rawContent: content } = input;
  let score = 0;
  const notes: string[] = [];

  if (artifact.kind === "skill") {
    const hasReadFirst =
      /\bRead First\b/i.test(content) || /\bread\b.*\bbefore\b/i.test(content);
    const hasContextSetup =
      /\bcontext\b.*\bsetup\b/i.test(content) ||
      /\bload\b.*\bbefore\b/i.test(content) ||
      /\bread\b.*\b(?:files|docs|references|context)\b/i.test(content);
    const hasStartupSection = hasSection(
      content,
      /##\s+(Step 0|Read First|Prerequisites|Inputs?|Context|Before You Start)/i,
    );
    const hasPrereqsOrAssumptions =
      /\bprerequisites?\b|\brequires?\b|\bassumptions?\b|\binputs?\b|\bdependencies\b|\bavailable\b|before acting|before proceeding/i.test(
        content,
      );
    const hasOperatingContext =
      /\bmodes?\b|\bscope\b|\bconstraints?\b|\ballowed\b|\bapproval\b|\bread-only\b|\bfile-write\b/i.test(
        content,
      );

    if (hasReadFirst || hasContextSetup || hasStartupSection) score += 5;
    else notes.push("no Read First or context setup");
    if (hasPrereqsOrAssumptions || hasOperatingContext) score += 5;
    else notes.push("no prerequisites or operating context");
  } else {
    const hasPurpose =
      hasSection(content, /##\s+Purpose/i) ||
      /^This (reference|playbook|document)/im.test(content);
    const hasPrereqs =
      /prerequisite/i.test(content) ||
      /requires?:/i.test(content) ||
      /Availability Check/i.test(content);

    if (hasPurpose) score += 5;
    else notes.push("no clear purpose statement");
    if (hasPrereqs) score += 5;
    else notes.push("no prerequisites or availability check");
  }

  return finalizeMetric(
    input,
    "cold-start",
    score,
    notes.length > 0 ? notes.join("; ") : "good cold-start",
  );
};

const tokenCost: MetricScorer = (input) => {
  const tokens = estimateTokens(input.rawContent);
  const subRefs = countSubReferences(input.projectRoot, input.artifact);
  const notes: string[] = [];

  let score: number;
  if (tokens > 20000) {
    score = 0;
    notes.push(`~${tokens} tokens - very large`);
  } else if (tokens > 10000) {
    score = 3;
    notes.push(`~${tokens} tokens - large`);
  } else if (tokens > 5000) {
    score = 7;
    notes.push(`~${tokens} tokens`);
  } else {
    score = 10;
  }

  if (subRefs > 5) {
    score = Math.max(0, score - 3);
    notes.push(`${subRefs} sub-references loaded`);
  } else if (subRefs > 0) {
    notes.push(`${subRefs} sub-reference(s)`);
  }

  return finalizeMetric(
    input,
    "token-cost",
    score,
    notes.length > 0 ? notes.join("; ") : `~${tokens} tokens`,
  );
};

const toolDependencyHandling: MetricScorer = (input) => {
  const { composedContent, config } = input;
  const content = stripYamlFrontmatter(composedContent);
  let score = 5;
  const notes: string[] = [];

  const hasAvailCheck = /\bAvailability Check\b/i.test(content);
  const hasFallback =
    /\bfallback\b/i.test(content) || /\bif\b.*\bunavailable\b/i.test(content);
  const toolKeywords = new RegExp(config.toolKeywordsRegex, "i");
  const hasToolRef = toolKeywords.test(content);

  if (hasToolRef) {
    if (hasAvailCheck) score += 3;
    else notes.push("references tools without availability check");
    if (hasFallback) score += 2;
    else notes.push("no fallback for tool dependencies");
  } else {
    score = 10;
  }

  return finalizeMetric(
    input,
    "tool-deps",
    score,
    notes.length > 0
      ? notes.join("; ")
      : hasToolRef
        ? "tools handled"
        : "no external tool dependencies",
  );
};

const writeRisk: MetricScorer = (input) => {
  const { artifact, composedContent: content } = input;
  let score = 10;
  const notes: string[] = [];

  if (artifact.kind === "skill") {
    const hasModeSystem =
      /\b(?:Read-Only|File-Write|Plan|Implement)\b/i.test(content) &&
      /\bmode\b/i.test(content);
    const hasEscalation =
      /\bapproval\b/i.test(content) || /\bask\b.*\bbefore\b/i.test(content);

    if (!hasModeSystem) {
      score -= 4;
      notes.push("no read-only vs write mode system");
    }
    if (!hasEscalation) {
      score -= 3;
      notes.push("no escalation gate for writes");
    }
  } else {
    const writesFiles =
      (/\b(?:write|create|modify)\b/i.test(content) ||
        /\bedit\b.*\bfile\b/i.test(content)) &&
      !/\bread-only\b/i.test(content);
    if (writesFiles) {
      score -= 2;
      notes.push("reference mentions file writes");
    }
  }

  return finalizeMetric(
    input,
    "write-risk",
    score,
    notes.length > 0 ? notes.join("; ") : "controlled write risk",
  );
};

// eslint-disable-next-line complexity -- intentional because exhaustive structural signal scoring keeps each skill-vs-reference fit rule beside its note text
const skillReferenceFit: MetricScorer = (input) => {
  const { artifact, rawContent: content, subtype } = input;
  const signals = {
    hasFrontmatterName: /^---[\s\S]*?name:\s*.+[\s\S]*?---/m.test(content),
    hasIntake: hasSection(content, /##\s+Step 0/i),
    hasCheckpoint: /\bCHECKPOINT\b/i.test(content),
    hasModes:
      /\b(?:Read-Only|File-Write)\b|\bPlan\b.*\bmode\b|\bImplement\b.*\bmode\b/i.test(
        content,
      ),
    hasAvailCheck: /\bAvailability Check\b/i.test(content),
    isToolProtocol:
      /\btool\b.*\bprotocol\b|\bobservation\b.*\bworkflow\b|\bcapture\b.*\bworkflow\b/i.test(
        content,
      ),
    hasRefVersion: /goat-flow-reference-version/i.test(content),
    hasSkillVersion: /goat-flow-skill-version/i.test(content),
    hasRouteMap: hasSection(content, /##\s+Route Map/i),
    hasQuickScan: hasSection(content, /##\s+Quick Scan Path/i),
  };

  const skillSignals = [
    signals.hasFrontmatterName,
    signals.hasIntake,
    signals.hasCheckpoint,
    signals.hasModes,
    signals.hasSkillVersion,
  ].filter(Boolean).length;
  const refSignals = [
    signals.hasAvailCheck,
    signals.isToolProtocol,
    signals.hasRefVersion,
    !signals.hasFrontmatterName,
    !signals.hasIntake,
  ].filter(Boolean).length;
  const resultSignals: MetricSignals = {};
  const notes: string[] = [];
  let score: number;

  if (subtype === "meta" || subtype === "index") {
    resultSignals.isMetaReference = true;
    score = 10;
    notes.push(
      subtype === "index"
        ? "index reference; routes to sibling files"
        : "shared meta-reference; not user-invocable",
    );
  } else if (artifact.kind === "skill") {
    if (
      (subtype === "dispatcher" && signals.hasRouteMap) ||
      (subtype === "report" && signals.hasQuickScan)
    ) {
      score = 10;
    } else if (skillSignals >= 3) {
      score = 10;
    } else if (skillSignals >= 2) {
      score = 7;
      notes.push("weak skill identity - missing some structural signals");
    } else {
      score = 3;
      resultSignals.shouldDemote = true;
      notes.push("artifact lacks skill structure - may belong in skill-docs/");
    }
    if (refSignals >= 3 && subtype === "workflow") {
      score = Math.max(0, score - 3);
      resultSignals.shouldDemote = true;
      notes.push("strong reference signals - consider demoting to reference");
    }
  } else {
    if (refSignals >= 3) {
      score = 10;
    } else if (refSignals >= 2) {
      score = 7;
      notes.push("adequate reference identity");
    } else {
      score = 5;
      notes.push("reference lacks typical structural signals");
    }
    if (skillSignals >= 3) {
      score = Math.max(0, score - 3);
      resultSignals.shouldPromote = true;
      notes.push("strong skill signals - consider promoting to skill");
    }
  }

  return finalizeMetric(
    input,
    "skill-reference-fit",
    score,
    notes.length > 0 ? notes.join("; ") : "good fit for current classification",
    resultSignals,
  );
};

export const ALL_METRICS: MetricScorer[] = [
  triggerClarity,
  workflowCompleteness,
  gateQuality,
  evidenceTestability,
  coldStartExecutability,
  tokenCost,
  toolDependencyHandling,
  writeRisk,
  skillReferenceFit,
];
