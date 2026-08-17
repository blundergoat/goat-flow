/**
 * Candidacy check: given a draft markdown or a description, recommend what kind of artifact the author should create - skill, reference, instruction-
 * file rule, learning-loop entry, CLI command, or "don't create."
 *
 * Runs BEFORE the structural quality rubric.
 * The rubric answers "is this artifact well-built?"; the candidacy check answers "should this artifact exist as a skill at all?"
 *
 * v1 is deterministic.
 * Heuristics for drafts (heading + length signals) and for descriptions (keyword + intent matching).
 * LLM-assisted candidacy for borderline drafts/descriptions is handled by the skill-quality rubric.
 */
import type { ArtifactSubtype, QualityConfig } from "./quality-config.js";
import { DEFAULT_QUALITY_CONFIG } from "./quality-config.js";

type CandidacyInputDraft = {
  kind: "draft";
  content: string;
  suggestedName?: string;
};
type CandidacyInputDescription = { kind: "description"; text: string };
type CandidacyInput = CandidacyInputDraft | CandidacyInputDescription;

type RecommendedArtifact =
  | { type: "skill"; subtype: ArtifactSubtype }
  | {
      type: "reference";
      subtype: Extract<ArtifactSubtype, "playbook" | "index" | "meta">;
    }
  | {
      type: "instruction-file";
      reason: "too-short" | "rule-shaped" | "constraint";
    }
  | {
      type: "learning-loop";
      subtype: "lesson" | "footgun" | "decision" | "pattern";
    }
  | { type: "cli-command" }
  | {
      type: "do-not-create";
      reason: "one-time-task" | "already-exists" | "no-clear-intent";
    };

/** Follow-up action shown to authors after the candidacy recommendation. */
interface CandidacyNextStep {
  action: string;
  template?: string;
}

/** Deterministic recommendation plus evidence for which artifact type should be created. */
export interface CandidacyResult {
  recommendedArtifact: RecommendedArtifact;
  /** 0-1 confidence in the recommendation. */
  confidence: number;
  reasoning: string[];
  nextSteps: CandidacyNextStep[];
}

const MIN_DRAFT_LINES_FOR_SKILL = 30;

/** Boolean structure signals extracted from draft content before routing. */
interface DraftSignals {
  hasStep0: boolean;
  hasVerification: boolean;
  hasRouteMap: boolean;
  hasQuickScan: boolean;
  hasAuditMode: boolean;
  hasAvailabilityCheck: boolean;
  hasFileWriteMode: boolean;
  hasIndexHints: boolean;
  hasRuleVocabulary: boolean;
  lineCount: number;
  startsWithIncident: boolean;
  startsWithFootgun: boolean;
  startsWithADR: boolean;
  hasADRStructure: boolean;
}

/** Extract deterministic structure signals from a draft before artifact routing. */
function inspectDraft(content: string, suggestedName?: string): DraftSignals {
  const lower = content.toLowerCase();
  const lines = content.split("\n");
  const name = (suggestedName ?? "").toLowerCase();
  return {
    hasStep0: /^##\s+step 0/im.test(content),
    hasVerification: /^##\s+verification/im.test(content),
    hasRouteMap: /^##\s+route map/im.test(content),
    hasQuickScan: /^##\s+quick scan path/im.test(content),
    hasAuditMode: /^##\s+audit mode/im.test(content),
    hasAvailabilityCheck: /availability check/i.test(content),
    hasFileWriteMode: /file-write/i.test(content),
    hasIndexHints:
      /which file to load/i.test(content) ||
      /sibling.*directory/i.test(content) ||
      /routing table/i.test(lower),
    hasRuleVocabulary: /\bMUST\b|\bMUST NOT\b|\balways\b|\bnever\b/i.test(
      content,
    ),
    lineCount: lines.length,
    startsWithIncident:
      /^(incident|postmortem|lesson)-/i.test(name) ||
      /^#\s+(incident|postmortem|lesson)/im.test(content),
    startsWithFootgun:
      /^footgun-/i.test(name) || /^#\s+footgun/im.test(content),
    startsWithADR: /^adr-\d+/i.test(name),
    hasADRStructure:
      /^##\s+(decision|context|consequences)/im.test(content) &&
      /^##\s+context/im.test(content),
  };
}

/** One routing rule: the structural signal that fires it, why it fired, and the verdict it produces. */
interface CandidacyRule {
  matches: (signals: DraftSignals) => boolean;
  explain: (signals: DraftSignals) => string;
  verdict: Omit<CandidacyResult, "reasoning">;
}

/**
 * The draft-routing rules, in priority order: the first match wins.
 *
 * Order is the contract here. Skill signals are checked before reference signals, and both before the name-based
 * learning-loop patterns, because a draft that carries real skill structure should be routed on that structure even when
 * its filename happens to look like an incident note.
 */
const CANDIDACY_RULES: readonly CandidacyRule[] = [
  {
    matches: (signals) => signals.hasStep0 && signals.hasVerification,
    explain: () => "has both ## Step 0 and ## Verification headings",
    verdict: {
      recommendedArtifact: { type: "skill", subtype: "workflow" },
      confidence: 0.9,
      nextSteps: [
        {
          action: "Place under .claude/skills/<name>/SKILL.md",
          template: "workflow",
        },
        { action: "Run skill-quality scoring after drafting" },
      ],
    },
  },
  {
    matches: (signals) => signals.hasRouteMap && !signals.hasStep0,
    explain: () => "has ## Route Map without ## Step 0",
    verdict: {
      recommendedArtifact: { type: "skill", subtype: "dispatcher" },
      confidence: 0.85,
      nextSteps: [
        {
          action: "Place under .claude/skills/<name>/SKILL.md",
          template: "dispatcher",
        },
      ],
    },
  },
  {
    matches: (signals) =>
      (signals.hasQuickScan || signals.hasAuditMode) &&
      !signals.hasFileWriteMode,
    explain: () => "has Quick Scan / Audit Mode markers and no File-Write mode",
    verdict: {
      recommendedArtifact: { type: "skill", subtype: "report" },
      confidence: 0.85,
      nextSteps: [
        {
          action: "Place under .claude/skills/<name>/SKILL.md",
          template: "report",
        },
      ],
    },
  },
  {
    matches: (signals) => signals.hasAvailabilityCheck,
    explain: () => "has Availability Check section",
    verdict: {
      recommendedArtifact: { type: "reference", subtype: "playbook" },
      confidence: 0.85,
      nextSteps: [
        {
          action: "Place under .goat-flow/skill-docs/playbooks/<name>.md",
          template: "playbook",
        },
      ],
    },
  },
  {
    matches: (signals) => signals.hasIndexHints,
    explain: () => "looks like an index/router for sibling references",
    verdict: {
      recommendedArtifact: { type: "reference", subtype: "index" },
      confidence: 0.7,
      nextSteps: [
        {
          action: "Place under .goat-flow/skill-docs/playbooks/<name>.md",
          template: "index",
        },
      ],
    },
  },
  {
    matches: (signals) => signals.startsWithIncident,
    explain: () => "name or H1 matches incident/postmortem/lesson pattern",
    verdict: {
      recommendedArtifact: { type: "learning-loop", subtype: "lesson" },
      confidence: 0.85,
      nextSteps: [
        {
          action: "Place under .goat-flow/learning-loop/lessons/<category>.md",
        },
      ],
    },
  },
  {
    matches: (signals) => signals.startsWithFootgun,
    explain: () => "name or H1 matches footgun pattern",
    verdict: {
      recommendedArtifact: { type: "learning-loop", subtype: "footgun" },
      confidence: 0.85,
      nextSteps: [
        {
          action: "Place under .goat-flow/learning-loop/footguns/<category>.md",
        },
      ],
    },
  },
  {
    matches: (signals) => signals.startsWithADR && signals.hasADRStructure,
    explain: () => "ADR-NNN name with Decision/Context/Consequences structure",
    verdict: {
      recommendedArtifact: { type: "learning-loop", subtype: "decision" },
      confidence: 0.9,
      nextSteps: [
        {
          action:
            "Place under .goat-flow/learning-loop/decisions/ADR-NNN-<title>.md",
        },
      ],
    },
  },
  {
    matches: (signals) =>
      signals.lineCount < MIN_DRAFT_LINES_FOR_SKILL &&
      signals.hasRuleVocabulary,
    explain: (signals) =>
      `${signals.lineCount} lines with MUST/always/never vocabulary`,
    verdict: {
      recommendedArtifact: { type: "instruction-file", reason: "rule-shaped" },
      confidence: 0.75,
      nextSteps: [{ action: "Add to CLAUDE.md or AGENTS.md as a rule line" }],
    },
  },
  {
    matches: (signals) => signals.lineCount < 5,
    explain: (signals) => `only ${signals.lineCount} lines of content`,
    verdict: {
      recommendedArtifact: { type: "do-not-create", reason: "no-clear-intent" },
      confidence: 0.6,
      nextSteps: [
        { action: "Provide more detail before deciding artifact type" },
      ],
    },
  },
];

/**
 * Decide what a draft should become, from its structure alone.
 *
 * A user reaches this by running `quality candidacy` on a file they have written but not yet filed, asking whether it is a
 * skill, a reference, a learning-loop entry, or something that belongs as one line in an instruction file.
 *
 * The first matching rule wins, so the table order is the routing policy; nothing matching means the draft carries no
 * decisive signal and the verdict is deliberately low-confidence rather than a guess.
 *
 * @param content - the draft text being routed
 * @param suggestedName - filename hint used by the name-based rules; omitted just skips those signals
 * @returns the recommendation, its confidence, the reasoning shown to the user, and the next steps to take
 */
function analyzeDraft(
  content: string,
  suggestedName?: string,
): CandidacyResult {
  const signals = inspectDraft(content, suggestedName);
  const matchedRule = CANDIDACY_RULES.find((rule) => rule.matches(signals));
  // A decisive structural signal fired, so the user gets a concrete placement rather than advice to add headings.
  if (matchedRule) {
    return {
      ...matchedRule.verdict,
      reasoning: [matchedRule.explain(signals)],
    };
  }

  return {
    recommendedArtifact: { type: "do-not-create", reason: "no-clear-intent" },
    confidence: 0.4,
    reasoning: ["no decisive structural signal found"],
    nextSteps: [
      {
        action:
          "Add canonical headings (Step 0, Route Map, Availability Check, etc.) to clarify intent",
      },
    ],
  };
}

/** Original and normalized description text used by reusable intent matchers. */
interface DescriptionTokens {
  text: string;
  lower: string;
}

/** Preserve both original and lowercase description text for intent matchers. */
function tokenize(text: string): DescriptionTokens {
  return { text, lower: text.toLowerCase() };
}

/** Detect whether description terms imply a reusable skill workflow. */
function matchSkillIntent(tokens: DescriptionTokens): CandidacyResult | null {
  const { lower } = tokens;
  const wantsGoatMode =
    /\bgoat-[a-z0-9-]+\b.*\bmode\b/.test(lower) ||
    /\bmode\b.*\bgoat-[a-z0-9-]+\b/.test(lower);
  const wantsWorkflow =
    /\b(workflow|protocol|process)\b/.test(lower) ||
    /\b(?:plan|implement|execute|run)\b/.test(lower);
  const wantsAudit = /\baudit|review|assess|check|inspect|scan|verify\b/.test(
    lower,
  );
  const wantsDispatch =
    /\bdispatch|route|orchestrate|coordinate|delegate\b/.test(lower);
  const writesFiles =
    /\b(write|create|edit|modify|generate|produce|update)\b/.test(lower);

  if (wantsGoatMode) {
    return {
      recommendedArtifact: { type: "skill", subtype: "workflow" },
      confidence: 0.8,
      reasoning: ["description changes a goat-* skill mode"],
      nextSteps: [
        {
          action:
            "Edit the existing goat-* skill template and installed mirrors; keep Step 0, gates, and verification aligned",
        },
      ],
    };
  }
  if (wantsDispatch && !wantsWorkflow) {
    return {
      recommendedArtifact: { type: "skill", subtype: "dispatcher" },
      confidence: 0.7,
      reasoning: [
        'description mentions dispatch/route vocabulary without "workflow"',
      ],
      nextSteps: [
        { action: "Scaffold a dispatcher SKILL.md with a Route Map section" },
      ],
    };
  }
  if (wantsAudit && !writesFiles) {
    return {
      recommendedArtifact: { type: "skill", subtype: "report" },
      confidence: 0.75,
      reasoning: ["description mentions audit/review without write actions"],
      nextSteps: [
        {
          action:
            "Scaffold a report-style SKILL.md with Quick Scan Path and no File-Write mode",
        },
      ],
    };
  }
  if (wantsWorkflow) {
    return {
      recommendedArtifact: { type: "skill", subtype: "workflow" },
      confidence: 0.7,
      reasoning: ["description mentions workflow / protocol / execute"],
      nextSteps: [
        {
          action:
            "Scaffold a workflow SKILL.md with Step 0, phases, and Verification gates",
        },
      ],
    };
  }
  return null;
}

function matchReferenceIntent(
  tokens: DescriptionTokens,
): CandidacyResult | null {
  const { lower } = tokens;
  const wantsReferenceArtifact =
    /\b(playbook|runbook|standards?|guidance|reference|how-?to)\b/.test(
      lower,
    ) ||
    /\b(document|describe|explain|write)\b.*\b(standards?|guidance|runbook|playbook)\b/.test(
      lower,
    );
  const isSkillModeChange = /\bgoat-[a-z0-9-]+\b.*\bmode\b/.test(lower);
  if (wantsReferenceArtifact && !isSkillModeChange) {
    return {
      recommendedArtifact: { type: "reference", subtype: "playbook" },
      confidence: 0.75,
      reasoning: [
        "description asks for reusable standards/guidance rather than an invocation workflow",
      ],
      nextSteps: [
        {
          action:
            "Place under .goat-flow/skill-docs/playbooks/<name>.md with Availability Check, boundary, workflow, fallback, and verification gate sections",
        },
      ],
    };
  }
  if (
    /\b(document|describe|explain|reference|playbook)\s+(how|the way)/.test(
      lower,
    ) ||
    /\bhow to use\b/.test(lower)
  ) {
    return {
      recommendedArtifact: { type: "reference", subtype: "playbook" },
      confidence: 0.7,
      reasoning: ["description asks to document how to use a tool/capability"],
      nextSteps: [
        {
          action:
            "Place under .goat-flow/skill-docs/playbooks/<name>.md with Availability Check, boundary, workflow, fallback, and verification gate sections",
        },
      ],
    };
  }
  return null;
}

function matchInstructionRuleIntent(
  tokens: DescriptionTokens,
): CandidacyResult | null {
  const { lower } = tokens;
  if (
    /\b(rule|policy|constraint|always|never|must)\b/.test(lower) &&
    !/\bworkflow|process|protocol|step\b/.test(lower)
  ) {
    return {
      recommendedArtifact: {
        type: "instruction-file",
        reason: "rule-shaped",
      },
      confidence: 0.65,
      reasoning: [
        "description sounds like a rule/policy/constraint without procedure",
      ],
      nextSteps: [{ action: "Add the rule to CLAUDE.md or AGENTS.md" }],
    };
  }
  return null;
}

function matchLearningLoopIntent(
  tokens: DescriptionTokens,
): CandidacyResult | null {
  const { lower } = tokens;
  if (
    /\blearn(?:ed|t)\b.*\b(failure mode|mistake|incident|lesson)\b/.test(
      lower,
    ) ||
    /\bremember|capture|record\b.*\b(mistake|incident|past|lesson)\b/.test(
      lower,
    ) ||
    /\bpost.?mortem\b/.test(lower)
  ) {
    return {
      recommendedArtifact: { type: "learning-loop", subtype: "lesson" },
      confidence: 0.7,
      reasoning: [
        "description references past mistake / incident / postmortem",
      ],
      nextSteps: [
        { action: "Add to .goat-flow/learning-loop/lessons/<category>.md" },
      ],
    };
  }
  if (
    /\b(footgun|trap|gotcha|landmine)\b/.test(lower) ||
    /\b(easy to|tempting to)\b.*\bbut\b/.test(lower)
  ) {
    return {
      recommendedArtifact: { type: "learning-loop", subtype: "footgun" },
      confidence: 0.7,
      reasoning: ["description sounds like a footgun / trap warning"],
      nextSteps: [
        { action: "Add to .goat-flow/learning-loop/footguns/<category>.md" },
      ],
    };
  }
  if (
    /\b(decision record|adr|architecture decision)\b/.test(lower) ||
    /\b(decided|chose)\b.*\b(because|so that)\b/.test(lower)
  ) {
    return {
      recommendedArtifact: { type: "learning-loop", subtype: "decision" },
      confidence: 0.75,
      reasoning: ["description references a design/architecture decision"],
      nextSteps: [
        {
          action:
            "Add an ADR under .goat-flow/learning-loop/decisions/ADR-NNN-<title>.md",
        },
      ],
    };
  }
  return null;
}

function matchCliCommandIntent(
  tokens: DescriptionTokens,
): CandidacyResult | null {
  const { lower } = tokens;
  if (
    /\bgenerate\b.*\b(index|indexes|indices)\b.*\b(markdown|md)\b/.test(
      lower,
    ) ||
    (/\b(one.?(?:shot|time)|deterministic|same way every time)\b/.test(lower) &&
      !/\b(decision|gate|approve)\b/.test(lower))
  ) {
    return {
      recommendedArtifact: { type: "cli-command" },
      confidence: 0.65,
      reasoning: [
        "description mentions one-shot / deterministic / no decisions",
      ],
      nextSteps: [
        { action: "Add as a CLI subcommand or audit check, not a skill" },
      ],
    };
  }
  return null;
}

/** Route a free-form artifact description to the recommended goat-flow artifact type. */
function analyzeDescription(text: string): CandidacyResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      recommendedArtifact: {
        type: "do-not-create",
        reason: "no-clear-intent",
      },
      confidence: 0.95,
      reasoning: ["empty description"],
      nextSteps: [
        { action: "Describe what the artifact should do, then re-run" },
      ],
    };
  }

  const tokens = tokenize(trimmed);
  const matchers = [
    matchLearningLoopIntent,
    matchCliCommandIntent,
    matchInstructionRuleIntent,
    matchReferenceIntent,
    matchSkillIntent,
  ];
  for (const matcher of matchers) {
    const result = matcher(tokens);
    if (result) return result;
  }

  return {
    recommendedArtifact: {
      type: "do-not-create",
      reason: "no-clear-intent",
    },
    confidence: 0.4,
    reasoning: [
      "description does not match any recognized artifact intent (workflow, audit, reference, rule, lesson, footgun, decision, cli-command)",
    ],
    nextSteps: [
      {
        action:
          "Rephrase with one of: 'I want a workflow that...', 'I want to document how to...', 'I want to remember a mistake...', 'I want a rule that...'",
      },
    ],
  };
}

/**
 * Run the candidacy check against either a markdown draft or a free-text description.
 * Returns a recommended artifact type and the reasoning behind the recommendation.
 *
 * The optional `config` parameter is reserved for future per-project
 * heuristic overrides (currently the v1 heuristics are project-independent).
 *
 * @param input - draft markdown or free-text description to classify
 * @param _config - reserved quality config for future project-specific heuristics
 * @returns candidacy recommendation, confidence, reasoning, and next steps
 */
export function runCandidacyCheck(
  input: CandidacyInput,
  _config: QualityConfig = DEFAULT_QUALITY_CONFIG,
): CandidacyResult {
  if (input.kind === "draft") {
    return analyzeDraft(input.content, input.suggestedName);
  }
  return analyzeDescription(input.text);
}
