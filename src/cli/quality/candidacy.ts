/**
 * Candidacy check: given a draft markdown or a description, recommend what
 * kind of artifact the author should create — skill, reference, instruction-
 * file rule, learning-loop entry, CLI command, or "don't create."
 *
 * Runs BEFORE the structural quality rubric. The rubric answers "is this
 * artifact well-built?"; the candidacy check answers "should this artifact
 * exist as a skill at all?"
 *
 * v1 is deterministic. Heuristics for drafts (heading + length signals) and
 * for descriptions (keyword + intent matching). LLM-assisted candidacy for
 * borderline drafts/descriptions is deferred (see M08 task list).
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

interface CandidacyNextStep {
  action: string;
  template?: string;
}

export interface CandidacyResult {
  recommendedArtifact: RecommendedArtifact;
  /** 0-1 confidence in the recommendation. */
  confidence: number;
  reasoning: string[];
  nextSteps: CandidacyNextStep[];
}

const MIN_DRAFT_LINES_FOR_SKILL = 30;

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

// eslint-disable-next-line complexity -- decision tree exhausts artifact-type signals (skill, reference, learning-loop, instruction-file, do-not-create) in priority order; splitting reduces readability
function analyzeDraft(
  content: string,
  suggestedName?: string,
): CandidacyResult {
  const signals = inspectDraft(content, suggestedName);
  const reasoning: string[] = [];

  // Strong skill signals
  if (signals.hasStep0 && signals.hasVerification) {
    reasoning.push("has both ## Step 0 and ## Verification headings");
    return {
      recommendedArtifact: { type: "skill", subtype: "workflow" },
      confidence: 0.9,
      reasoning,
      nextSteps: [
        {
          action: "Place under .claude/skills/<name>/SKILL.md",
          template: "workflow",
        },
        { action: "Run skill-quality scoring after drafting" },
      ],
    };
  }
  if (signals.hasRouteMap && !signals.hasStep0) {
    reasoning.push("has ## Route Map without ## Step 0");
    return {
      recommendedArtifact: { type: "skill", subtype: "dispatcher" },
      confidence: 0.85,
      reasoning,
      nextSteps: [
        {
          action: "Place under .claude/skills/<name>/SKILL.md",
          template: "dispatcher",
        },
      ],
    };
  }
  if (
    (signals.hasQuickScan || signals.hasAuditMode) &&
    !signals.hasFileWriteMode
  ) {
    reasoning.push(
      "has Quick Scan / Audit Mode markers and no File-Write mode",
    );
    return {
      recommendedArtifact: { type: "skill", subtype: "report" },
      confidence: 0.85,
      reasoning,
      nextSteps: [
        {
          action: "Place under .claude/skills/<name>/SKILL.md",
          template: "report",
        },
      ],
    };
  }

  // Reference signals
  if (signals.hasAvailabilityCheck) {
    reasoning.push("has Availability Check section");
    return {
      recommendedArtifact: { type: "reference", subtype: "playbook" },
      confidence: 0.85,
      reasoning,
      nextSteps: [
        {
          action: "Place under .goat-flow/skill-playbooks/<name>.md",
          template: "playbook",
        },
      ],
    };
  }
  if (signals.hasIndexHints) {
    reasoning.push("looks like an index/router for sibling references");
    return {
      recommendedArtifact: { type: "reference", subtype: "index" },
      confidence: 0.7,
      reasoning,
      nextSteps: [
        {
          action: "Place under .goat-flow/skill-playbooks/<name>.md",
          template: "index",
        },
      ],
    };
  }

  // Learning-loop signals (name-based)
  if (signals.startsWithIncident) {
    reasoning.push("name or H1 matches incident/postmortem/lesson pattern");
    return {
      recommendedArtifact: { type: "learning-loop", subtype: "lesson" },
      confidence: 0.85,
      reasoning,
      nextSteps: [
        {
          action: "Place under .goat-flow/lessons/<category>.md",
        },
      ],
    };
  }
  if (signals.startsWithFootgun) {
    reasoning.push("name or H1 matches footgun pattern");
    return {
      recommendedArtifact: { type: "learning-loop", subtype: "footgun" },
      confidence: 0.85,
      reasoning,
      nextSteps: [{ action: "Place under .goat-flow/footguns/<category>.md" }],
    };
  }
  if (signals.startsWithADR && signals.hasADRStructure) {
    reasoning.push("ADR-NNN name with Decision/Context/Consequences structure");
    return {
      recommendedArtifact: { type: "learning-loop", subtype: "decision" },
      confidence: 0.9,
      reasoning,
      nextSteps: [
        {
          action: "Place under .goat-flow/decisions/ADR-NNN-<title>.md",
        },
      ],
    };
  }

  // Short rule-shaped content
  if (
    signals.lineCount < MIN_DRAFT_LINES_FOR_SKILL &&
    signals.hasRuleVocabulary
  ) {
    reasoning.push(
      `${signals.lineCount} lines with MUST/always/never vocabulary`,
    );
    return {
      recommendedArtifact: {
        type: "instruction-file",
        reason: "rule-shaped",
      },
      confidence: 0.75,
      reasoning,
      nextSteps: [
        {
          action: "Add to CLAUDE.md or AGENTS.md as a rule line",
        },
      ],
    };
  }
  if (signals.lineCount < 5) {
    reasoning.push(`only ${signals.lineCount} lines of content`);
    return {
      recommendedArtifact: {
        type: "do-not-create",
        reason: "no-clear-intent",
      },
      confidence: 0.6,
      reasoning,
      nextSteps: [
        {
          action: "Provide more detail before deciding artifact type",
        },
      ],
    };
  }

  // Low-confidence fallback: needs human review
  reasoning.push("no decisive structural signal found");
  return {
    recommendedArtifact: {
      type: "do-not-create",
      reason: "no-clear-intent",
    },
    confidence: 0.4,
    reasoning,
    nextSteps: [
      {
        action:
          "Add canonical headings (Step 0, Route Map, Availability Check, etc.) to clarify intent",
      },
    ],
  };
}

interface DescriptionTokens {
  text: string;
  lower: string;
}

function tokenize(text: string): DescriptionTokens {
  return { text, lower: text.toLowerCase() };
}

function matchSkillIntent(tokens: DescriptionTokens): CandidacyResult | null {
  const { lower } = tokens;
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
            "Place under .goat-flow/skill-playbooks/<name>.md with an Availability Check section",
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
      nextSteps: [{ action: "Add to .goat-flow/lessons/<category>.md" }],
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
      nextSteps: [{ action: "Add to .goat-flow/footguns/<category>.md" }],
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
        { action: "Add an ADR under .goat-flow/decisions/ADR-NNN-<title>.md" },
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
    /\b(one.?(?:shot|time)|deterministic|same way every time)\b/.test(lower) &&
    !/\b(decision|gate|approve)\b/.test(lower)
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
    matchSkillIntent,
    matchReferenceIntent,
    matchInstructionRuleIntent,
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
 * Run the candidacy check against either a markdown draft or a free-text
 * description. Returns a recommended artifact type and the reasoning behind
 * the recommendation.
 *
 * The optional `config` parameter is reserved for future per-project
 * heuristic overrides (currently the v1 heuristics are project-independent).
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
