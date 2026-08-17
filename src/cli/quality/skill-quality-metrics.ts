/**
 * The rubric: one MetricScorer per scoring dimension (trigger clarity, workflow completeness, gate quality, evidence/testability, cold-start
 * executability, token cost, tool dependencies, write risk, and skill-vs-reference fit), plus the `ALL_METRICS` list the scorer runs in order.
 *
 * Each scorer is a pure function of its MetricInput, runs the artifact text through regex/heading heuristics, and routes its raw score through
 * `finalizeMetric` for subtype-specific capping - so a dimension that does not apply to a subtype reports `n/a`, not a low score.
 * Some scorers attach promote/demote/meta signals that feed recommendations without changing the numeric total.
 *
 * The heuristics are deliberately conservative (calibrated against the in-tree `.claude/skills` corpus) to keep false positives low; they are
 * advisory tips, not hard deductions, where noted.
 */
import { compilePatternList, type QualityConfig } from "./quality-config.js";
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

/** Boundary-command labels, tolerant of a mode qualifier. A skill may scope a
 *  command to one of its modes - goat-debug ships `**ALWAYS in Diagnose mode:**`
 *  so Investigate mode is not bound by a diagnosis-only rule - and the triplet
 *  still earns exclusion credit because all three commands are present. The
 *  in-tree contract accepts the same qualified form (`test/contract/skill-hardening-shared-1.test.ts`
 *  (search: `keeps canonical skill boundaries explicit and route-focused`)), so
 *  scoring the bare label only would report a false negative on a deliberately
 *  scoped boundary. Matching stays line-local: the qualifier cannot cross a `*`
 *  or a newline, so one command's label cannot absorb the next. */
const BOUNDARY_NEVER_RE = /\*\*NEVER\b[^*\n]*:\*\*/i;
const BOUNDARY_ALWAYS_RE = /\*\*ALWAYS\b[^*\n]*:\*\*/i;
const BOUNDARY_DEFER_TO_RE = /\*\*DEFER TO\b[^*\n]*:\*\*/i;

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

/**
 * Score how clearly a skill tells the reader when to invoke it, and when not to.
 *
 * A dispatcher is judged on its Route Map instead of an exclusion list, because routing between skills is its entire job.
 *
 * @param content - raw artifact text
 * @param subtype - detected skill subtype, which decides whether a Route Map or an exclusion list is expected
 * @param notes - accumulator appended to in place; each push is one gap the user will see under the metric
 * @returns the points earned; zero means none of the trigger signals were present
 */
/**
 * Score the boundary signal that tells a reader when *not* to reach for this skill.
 *
 * A dispatcher is judged on its Route Map instead, because routing between skills is its whole job and it has no exclusion list to carry.
 *
 * @param content - raw artifact text
 * @param subtype - detected skill subtype, which selects the Route Map bar or the exclusion-list bar
 * @param notes - accumulator appended to in place; each push is one gap the user will see under the metric
 * @returns 5 when the boundary is present, 0 when it is missing
 */
function scoreSkillBoundarySignal(
  content: string,
  subtype: string,
  notes: string[],
): number {
  // A dispatcher routes between skills, so its Route Map is the boundary rather than an exclusion list.
  if (subtype === "dispatcher") {
    if (hasSection(content, /##\s+Route Map/i)) return 5;
    notes.push("dispatcher missing Route Map for trigger disambiguation");
    return 0;
  }
  const hasBoundaryCommands =
    hasSection(content, /##\s+Boundary Commands/i) &&
    BOUNDARY_NEVER_RE.test(content) &&
    BOUNDARY_ALWAYS_RE.test(content) &&
    BOUNDARY_DEFER_TO_RE.test(content);
  const hasExclusion =
    /NOT this skill/i.test(content) ||
    /If the user names a skill explicitly/i.test(content) ||
    hasBoundaryCommands;
  if (hasExclusion) return 5;
  notes.push('missing "NOT this skill" exclusion list');
  return 0;
}

/**
 * Score how clearly a skill tells the reader when to invoke it, and when not to.
 *
 * This is what stops a user installing eight skills and never knowing which one a given task should reach for.
 *
 * @param content - raw artifact text
 * @param subtype - detected skill subtype, passed through to the boundary check
 * @param notes - accumulator appended to in place; each push is one gap the user will see under the metric
 * @returns the points earned; zero means none of the trigger signals were present
 */
function scoreSkillTriggerClarity(
  content: string,
  subtype: string,
  notes: string[],
): number {
  let score = 0;
  const hasFrontmatterDesc = /^---[\s\S]*?description:\s*".+"[\s\S]*?---/m.test(
    content,
  );
  const hasWhenToUse =
    hasSection(content, /##\s+When to Use/i) || /\bUse when\b/i.test(content);

  if (hasFrontmatterDesc) score += 5;
  else notes.push("missing frontmatter description");
  if (hasWhenToUse) score += 5;
  else notes.push('missing "When to Use" signal');
  score += scoreSkillBoundarySignal(content, subtype, notes);

  // A description that recounts the workflow reads as documentation, so the user never learns when to reach for the skill.
  if (hasFrontmatterDesc && descriptionSummarizesWorkflow(content)) {
    notes.push(
      "description summarizes workflow rather than triggering conditions",
    );
  }
  return score;
}

/**
 * Score how clearly a reference tells the reader when to load it and what it needs to be usable.
 *
 * Meta and index references are exempt from the Availability Check, because neither invokes a tool that could be missing.
 *
 * @param content - raw artifact text
 * @param subtype - detected reference subtype, which decides whether an Availability Check is required
 * @param notes - accumulator appended to in place; each push is one gap the user will see under the metric
 * @returns the points earned; zero means neither a purpose nor an availability signal was found
 */
function scoreReferenceTriggerClarity(
  content: string,
  subtype: string,
  notes: string[],
): number {
  let score = 0;
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
  return score;
}

/**
 * Scores whether users can identify when to invoke the artifact and where adjacent work belongs.
 *
 * Skills and references are scored by different rules, because a skill needs an exclusion boundary while a reference needs a purpose statement.
 *
 * @param input - the artifact, its raw content, and its detected subtype
 * @returns the scored metric; a perfect score notes clear triggers instead of listing gaps
 */
const triggerClarity: MetricScorer = (input) => {
  const { artifact, rawContent: content, subtype } = input;
  const notes: string[] = [];
  const score =
    artifact.kind === "skill"
      ? scoreSkillTriggerClarity(content, subtype, notes)
      : scoreReferenceTriggerClarity(content, subtype, notes);

  return finalizeMetric(
    input,
    "trigger-clarity",
    score,
    notes.length > 0 ? notes.join("; ") : "clear trigger definition",
  );
};

/**
 * Score whether a skill lays out a workflow a reader could actually follow start to finish.
 *
 * A dispatcher is judged only on its Route Map, since it routes to other skills rather than carrying phases of its own.
 *
 * @param content - raw artifact text
 * @param subtype - detected skill subtype, which decides whether phases or a Route Map are expected
 * @param config - quality config supplying the human-stop vocabulary that counts as a checkpoint
 * @param notes - accumulator appended to in place; each push is one gap the user will see under the metric
 * @returns the points earned; zero means no intake, phases, or checkpoint were found
 */
function scoreSkillWorkflowCompleteness(
  content: string,
  subtype: string,
  config: QualityConfig,
  notes: string[],
): number {
  let score = 0;
  {
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
  }
  return score;
}

/**
 * Score whether a reference lays out enough structure to be followed without its author present.
 *
 * Playbooks are held to a stricter bar than other references, because they are meant to be executed rather than consulted.
 *
 * @param content - raw artifact text
 * @param subtype - detected reference subtype, which selects the playbook bar or the lighter one
 * @param notes - accumulator appended to in place; each push is one gap the user will see under the metric
 * @returns the points earned; zero means no workflow, troubleshooting, or section structure was found
 */
/** The structural signals both reference bars are scored against, read once so each bar just weighs them. */
interface ReferenceStructureSignals {
  hasWorkflow: boolean;
  hasTroubleshooting: boolean;
  hasVerificationGate: boolean;
  hasBoundaryLanguage: boolean;
  sectionCount: number;
}

/**
 * Read the structural signals a reference is judged on, before either bar decides what they are worth.
 *
 * @param content - raw artifact text
 * @returns the signals; every false means the reference carries none of the structure a reader would look for
 */
function readReferenceStructure(content: string): ReferenceStructureSignals {
  return {
    hasWorkflow:
      hasSection(content, /##\s+.*Workflow/i) ||
      hasSection(content, /##\s+Steps/i) ||
      hasSection(content, /###\s+Step\s+\d/i),
    hasTroubleshooting:
      hasSection(content, /Troubleshoot/i) || hasSection(content, /Fallback/i),
    hasVerificationGate: hasSection(
      content,
      /##\s+(Verification Gate|Verification|Acceptance)/i,
    ),
    hasBoundaryLanguage:
      hasSection(content, /##\s+(Boundary|Scope|When to Load|When to Use)/i) ||
      /\b(In scope|Out of scope|Do not use when|read-only)\b/i.test(content),
    sectionCount: countHeadings(content, 2),
  };
}

/**
 * Score a playbook, which is meant to be executed and so must carry a gate and a fallback of its own.
 *
 * @param signals - structural signals read from the artifact
 * @param notes - accumulator appended to in place; each push is one gap the user will see
 * @returns the points earned across the five playbook expectations
 */
function scorePlaybookStructure(
  signals: ReferenceStructureSignals,
  notes: string[],
): number {
  let score = 0;
  if (signals.hasWorkflow) score += 3;
  else notes.push("no workflow/steps section");
  if (signals.hasTroubleshooting) score += 3;
  else notes.push("no troubleshooting/fallback");
  if (signals.hasVerificationGate) score += 3;
  else notes.push("missing verification gate");
  if (signals.hasBoundaryLanguage) score += 3;
  else notes.push("missing boundary language");
  if (signals.sectionCount >= 4) score += 3;
  else notes.push(`only ${signals.sectionCount} top-level sections`);
  return score;
}

/**
 * Score a non-playbook reference, which is consulted rather than executed and so is held to a lighter bar.
 *
 * Index and meta references are exempt from the workflow and troubleshooting expectations, because neither describes a procedure.
 *
 * @param signals - structural signals read from the artifact
 * @param subtype - detected reference subtype, which decides the exemptions
 * @param notes - accumulator appended to in place; each push is one gap the user will see
 * @returns the points earned across the three general expectations
 */
function scoreGeneralReferenceStructure(
  signals: ReferenceStructureSignals,
  subtype: string,
  notes: string[],
): number {
  let score = 0;
  if (signals.hasWorkflow || subtype === "index" || subtype === "meta") {
    score += 5;
  } else notes.push("no workflow/steps section");
  if (signals.hasTroubleshooting || subtype === "meta") score += 5;
  else notes.push("no troubleshooting/fallback");
  if (signals.sectionCount >= 3) score += 5;
  else notes.push(`only ${signals.sectionCount} top-level sections`);
  return score;
}

/**
 * Score whether a reference lays out enough structure to be followed without its author present.
 *
 * Playbooks are held to a stricter bar than other references, because they are meant to be executed rather than consulted.
 *
 * @param content - raw artifact text
 * @param subtype - detected reference subtype, which selects the playbook bar or the lighter one
 * @param notes - accumulator appended to in place; each push is one gap the user will see under the metric
 * @returns the points earned; zero means the reference carries none of the expected structure
 */
function scoreReferenceWorkflowCompleteness(
  content: string,
  subtype: string,
  notes: string[],
): number {
  const signals = readReferenceStructure(content);
  return subtype === "playbook"
    ? scorePlaybookStructure(signals, notes)
    : scoreGeneralReferenceStructure(signals, subtype, notes);
}

/**
 * Scores whether the artifact lays out a workflow a reader could follow without asking its author.
 *
 * Skills and references are scored separately, because a skill is expected to carry phases while a reference is expected to carry structure.
 *
 * @param input - the artifact, its raw content, its subtype, and the quality config
 * @returns the scored metric; a perfect score notes a complete workflow instead of listing gaps
 */
const workflowCompleteness: MetricScorer = (input) => {
  const { artifact, rawContent: content, subtype, config } = input;
  const notes: string[] = [];
  const score =
    artifact.kind === "skill"
      ? scoreSkillWorkflowCompleteness(content, subtype, config, notes)
      : scoreReferenceWorkflowCompleteness(content, subtype, notes);

  return finalizeMetric(
    input,
    "workflow-completeness",
    score,
    notes.length > 0 ? notes.join("; ") : "complete workflow",
  );
};

/**
 * Scores whether the artifact tells a reader how work is checked and where a human must intervene.
 * The three signals are additive and drawn from configured vocabulary rather than fixed wording, so a project can rename its gates without losing the
 * score.
 *
 * @param input - composed artifact content plus the quality config supplying gate vocabulary
 * @returns the scored metric; a perfect score notes "strong gates" instead of listing gaps
 */
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

/**
 * Scores whether claims in the artifact can be checked: tagged evidence, a gate, and stable anchors.
 * Semantic anchors count rather than line numbers, because a line reference goes stale on the next edit and cannot be re-verified later.
 *
 * @param input - composed artifact content
 * @returns the scored metric; a perfect score notes "strong evidence contract" instead of gaps
 */
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

/**
 * Score whether a skill tells an agent what to read and what constraints apply before it starts acting.
 *
 * This is the difference between a skill an agent can pick up cold and one that assumes context from a previous session.
 *
 * @param content - raw artifact text
 * @param notes - accumulator appended to in place; each push is one gap the user will see under the metric
 * @returns the points earned across the intake and operating-context expectations
 */
function scoreSkillColdStart(content: string, notes: string[]): number {
  let score = 0;
  const hasIntake =
    /\bRead First\b/i.test(content) ||
    /\bread\b.*\bbefore\b/i.test(content) ||
    /\bcontext\b.*\bsetup\b/i.test(content) ||
    /\bload\b.*\bbefore\b/i.test(content) ||
    /\bread\b.*\b(?:files|docs|references|context)\b/i.test(content) ||
    hasSection(
      content,
      /##\s+(Step 0|Read First|Prerequisites|Inputs?|Context|Before You Start)/i,
    );
  const hasOperatingContext =
    /\bprerequisites?\b|\brequires?\b|\bassumptions?\b|\binputs?\b|\bdependencies\b|\bavailable\b|before acting|before proceeding/i.test(
      content,
    ) ||
    /\bmodes?\b|\bscope\b|\bconstraints?\b|\ballowed\b|\bapproval\b|\bread-only\b|\bfile-write\b/i.test(
      content,
    );

  if (hasIntake) score += 5;
  else notes.push("no Read First or context setup");
  if (hasOperatingContext) score += 5;
  else notes.push("no prerequisites or operating context");
  return score;
}

/**
 * Score whether a reference states what it is for and what it needs before a reader can rely on it.
 *
 * @param content - raw artifact text
 * @param notes - accumulator appended to in place; each push is one gap the user will see under the metric
 * @returns the points earned across the purpose and prerequisite expectations
 */
function scoreReferenceColdStart(content: string, notes: string[]): number {
  let score = 0;
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
  return score;
}

/**
 * Scores whether the artifact can be picked up cold, without context carried over from an earlier session.
 *
 * Skills and references are judged differently: a skill must say what to read and what constrains it, while a reference
 * must say what it is for and what it depends on.
 *
 * @param input - the artifact and its raw content
 * @returns the scored metric; a perfect score notes a good cold start instead of listing gaps
 */
const coldStartExecutability: MetricScorer = (input) => {
  const { artifact, rawContent: content } = input;
  const notes: string[] = [];
  const score =
    artifact.kind === "skill"
      ? scoreSkillColdStart(content, notes)
      : scoreReferenceColdStart(content, notes);

  return finalizeMetric(
    input,
    "cold-start",
    score,
    notes.length > 0 ? notes.join("; ") : "good cold-start",
  );
};

/**
 * Scores the context cost of loading the artifact, from its own size and its sub-references.
 *
 * Size is banded rather than scaled, so an artifact only loses points when it crosses a threshold a reader would actually feel.
 * More than five sub-references costs an extra penalty, because each one is a separate load the consumer pays for.
 *
 * @param input - raw artifact content, project root, and artifact record used to count references
 * @returns the scored metric; the note always states the estimated token count
 */
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

/**
 * Scores how safely the artifact depends on external tools.
 * An artifact that references no tool scores full marks rather than being penalised for a contract it does not need; only one that names a tool must
 * also show an availability check and a fallback.
 *
 * @param input - composed artifact content plus the config supplying the tool-keyword pattern
 * @returns the scored metric; artifacts with no tool reference note "no tool dependencies"
 */
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

/**
 * Scores how well the artifact bounds its own write authority, starting from a clean 10.
 * Skills and references are judged differently on purpose: a skill is expected to declare modes and an escalation gate, while a reference is only
 * penalised for implying writes it should never make.
 *
 * @param input - artifact record and composed content
 * @returns the scored metric; the score is floored by `finalizeMetric` rather than here
 */
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

/** The structural evidence weighed when deciding whether an artifact is filed as the right kind. */
interface IdentityFitInput {
  subtype?: string;
  skillSignals: number;
  refSignals: number;
  signals?: { hasRouteMap: boolean; hasQuickScan: boolean };
}

/**
 * Report whether a skill carries the one section that identifies its subtype outright.
 *
 * A dispatcher is identified by its Route Map and a report by its Quick Scan Path, so neither needs the intake and mode
 * structure a workflow skill is judged on.
 *
 * @param input - the subtype and the hallmark section flags read from the artifact
 * @returns true when the subtype's hallmark section is present
 */
function hasSkillHallmarkSection(input: IdentityFitInput): boolean {
  if (input.subtype === "dispatcher")
    return input.signals?.hasRouteMap === true;
  if (input.subtype === "report") return input.signals?.hasQuickScan === true;
  return false;
}

/**
 * Score how well an artifact filed as a skill actually looks like one, and flag it when it does not.
 *
 * Dispatchers and reports are recognised by their own hallmark section rather than the general signal count, because
 * neither carries the intake and mode structure a workflow skill does.
 *
 * A workflow skill showing strong reference signals is demoted in score, since that is the shape that should have been
 * filed under skill-docs rather than installed as an invocable skill.
 *
 * @param input - the subtype, the two signal counts, and the hallmark section flags
 * @param resultSignals - UI signals mutated in place, so the Skills tab can offer a promote or demote action
 * @param notes - accumulator appended to in place; each push is one thing the user will see explained
 * @returns the fit score out of 10
 */
function scoreSkillIdentityFit(
  input: IdentityFitInput,
  resultSignals: MetricSignals,
  notes: string[],
): number {
  let score: number;
  if (hasSkillHallmarkSection(input) || input.skillSignals >= 3) {
    score = 10;
  } else if (input.skillSignals >= 2) {
    score = 7;
    notes.push("weak skill identity - missing some structural signals");
  } else {
    score = 3;
    resultSignals.shouldDemote = true;
    notes.push("artifact lacks skill structure - may belong in skill-docs/");
  }
  // A workflow skill that reads like a reference is the case worth telling the user about.
  if (input.refSignals >= 3 && input.subtype === "workflow") {
    score = Math.max(0, score - 3);
    resultSignals.shouldDemote = true;
    notes.push("strong reference signals - consider demoting to reference");
  }
  return score;
}

/**
 * Score how well an artifact filed as a reference actually looks like one, and flag it when it looks like a skill.
 *
 * @param input - the two signal counts
 * @param resultSignals - UI signals mutated in place, so the Skills tab can offer a promote action
 * @param notes - accumulator appended to in place; each push is one thing the user will see explained
 * @returns the fit score out of 10
 */
function scoreReferenceIdentityFit(
  input: IdentityFitInput,
  resultSignals: MetricSignals,
  notes: string[],
): number {
  let score: number;
  if (input.refSignals >= 3) {
    score = 10;
  } else if (input.refSignals >= 2) {
    score = 7;
    notes.push("adequate reference identity");
  } else {
    score = 5;
    notes.push("reference lacks typical structural signals");
  }
  // A reference carrying skill structure is probably something the user meant to install as a skill.
  if (input.skillSignals >= 3) {
    score = Math.max(0, score - 3);
    resultSignals.shouldPromote = true;
    notes.push("strong skill signals - consider promoting to skill");
  }
  return score;
}

/**
 * Scores whether an artifact is filed as the right kind, and suggests promoting or demoting it when it is not.
 *
 * This is what surfaces the "you installed this as a skill but it reads like a reference" advice in the Skills tab, which
 * matters because an artifact in the wrong place is either never invoked or invoked when it should not be.
 *
 * Meta and index references score full marks outright, since neither is user-invocable and neither should be promoted.
 *
 * @param input - the artifact, its raw content, and its detected subtype
 * @returns the scored metric, carrying any promote or demote signal for the UI to act on
 */
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
    score = scoreSkillIdentityFit(
      { subtype, skillSignals, refSignals, signals },
      resultSignals,
      notes,
    );
  } else {
    score = scoreReferenceIdentityFit(
      { skillSignals, refSignals },
      resultSignals,
      notes,
    );
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
