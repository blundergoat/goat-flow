/**
 * Verification concern: Can the agent verify its own work honestly?
 * 4 checks: hooks-registered, commit-guidance, evidence-before-claims,
 * post-turn-hook-integrity.
 */
import type {
  AuditContext,
  HarnessCheck,
  HarnessCheckDetails,
} from "../types.js";
import type { CheckEvidence } from "../provenance-types.js";
import { pass, fail } from "./helpers.js";

const VERIFIED_ON = "2026-04-18";
const EVIDENCE_BEFORE_CLAIMS_VERIFIED_ON = "2026-05-16";
const RED_FLAGS_SECTION = "Hallucination red-flags";
const RED_FLAG_CLAUSES = [
  "Checks passed",
  "Completion",
  "Fix verification",
  "Hedged claims",
] as const;
const RATIONALISATIONS_PATH = ".goat-flow/skill-reference/skill-preamble.md";
const RATIONALISATIONS_HEADING = "Rationalisations to reject";

function verificationDetails(
  ctx: AuditContext,
  reasonForAgent: (agent: AuditContext["agents"][number]) => {
    reason: string;
    expected?: string;
    actual?: string;
  },
): HarnessCheckDetails {
  return {
    verification: ctx.agents.map((agent) => ({
      agent: agent.agent.id,
      ...reasonForAgent(agent),
    })),
  };
}

/** Return the verification provenance. */
function verificationProvenance(
  type: HarnessCheck["type"],
  paths: string[],
  sourceType: CheckEvidence["source_type"] = "spec",
  verifiedOn = VERIFIED_ON,
): CheckEvidence {
  return {
    source_type: sourceType,
    source_urls: [],
    verified_on: verifiedOn,
    normative_level:
      type === "integrity"
        ? "MUST"
        : type === "advisory"
          ? "SHOULD"
          : "BEST_PRACTICE",
    evidence_paths: paths,
  };
}

const hooksRegistered: HarnessCheck = {
  id: "hooks-registered",
  name: "Hook registrations in sync",
  concern: "verification",
  type: "integrity",
  provenance: verificationProvenance(
    "integrity",
    [
      "docs/harness-audit.md",
      ".goat-flow/footguns/hooks.md",
      ".goat-flow/footguns/auditor.md",
    ],
    "incident",
  ),
  /** Run the Hook registrations in sync check. */
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    let hasHookRegistrationMismatch = false;
    const details = verificationDetails(ctx, (agentFacts) => {
      if (
        agentFacts.hooks.postTurnRegistered &&
        !agentFacts.hooks.postTurnExists
      ) {
        return {
          reason: "post-turn hook registered but file missing",
          expected: "registered hook file exists",
          actual: "registered without file",
        };
      }
      if (
        agentFacts.hooks.postTurnExists &&
        !agentFacts.hooks.postTurnRegistered
      ) {
        return {
          reason: "post-turn hook file exists but is not registered",
          expected: "existing hook is registered",
          actual: "file present, registration missing",
        };
      }
      return {
        reason: "hook registrations and files are in sync",
        expected: "registration and file state match",
        actual: "in sync",
      };
    });
    for (const agentFacts of ctx.agents) {
      if (
        agentFacts.hooks.postTurnRegistered &&
        !agentFacts.hooks.postTurnExists
      ) {
        findings.push(
          `${agentFacts.agent.id}: post-turn hook registered but file missing`,
        );
        recs.push("Create the registered post-turn hook file");
        fixes.push(
          `Create the post-turn hook file at the path specified in ${agentFacts.agent.settingsFile}.`,
        );
        hasHookRegistrationMismatch = true;
      }
      if (
        agentFacts.hooks.postTurnExists &&
        !agentFacts.hooks.postTurnRegistered
      ) {
        findings.push(
          `${agentFacts.agent.id}: post-turn hook file exists but not registered`,
        );
        recs.push("Register the post-turn hook in agent settings");
        fixes.push(
          `Register the post-turn hook in ${agentFacts.agent.settingsFile}.`,
        );
        hasHookRegistrationMismatch = true;
      }
    }
    if (hasHookRegistrationMismatch)
      return fail(findings, recs, fixes, details);
    return pass(["Hook registrations and files are in sync"], details);
  },
};

const commitGuidance: HarnessCheck = {
  id: "commit-guidance",
  name: "Commit guidance present",
  concern: "verification",
  type: "advisory",
  provenance: verificationProvenance("advisory", [
    "docs/harness-audit.md",
    ".github/git-commit-instructions.md",
  ]),
  /** Run the Commit guidance present check. */
  run: (ctx) => {
    const guidance = ctx.facts.shared.gitCommitInstructions;
    const details = verificationDetails(ctx, () => ({
      reason: guidance.exists
        ? "commit guidance present"
        : guidance.misplacedPaths.length > 0
          ? "commit guidance misplaced"
          : "commit guidance missing",
      expected: guidance.requiredPath,
      actual:
        guidance.path ??
        (guidance.misplacedPaths.length > 0
          ? guidance.misplacedPaths.join(", ")
          : "missing"),
    }));
    if (guidance.exists) {
      return pass([`Commit guidance found at ${guidance.path}`], details);
    }
    if (guidance.misplacedPaths.length > 0) {
      return fail(
        [
          `Commit guidance belongs at ${guidance.requiredPath} when .github/ exists`,
        ],
        [`Move commit conventions to ${guidance.requiredPath}`],
        [
          `Create ${guidance.requiredPath} and move or copy the content from ${guidance.misplacedPaths.join(", ")}.`,
        ],
        details,
      );
    }
    return fail(
      ["No commit guidance detected"],
      [`Add commit conventions to ${guidance.requiredPath}`],
      [`Create ${guidance.requiredPath} with this project's commit rules.`],
      details,
    );
  },
};

/** Return unique manifest-backed instruction file paths for this project. */
function instructionFilePaths(ctx: AuditContext): string[] {
  const paths = new Set<string>();
  for (const agent of Object.values(ctx.structure.agents)) {
    if (agent.instruction_file) paths.add(agent.instruction_file);
  }
  for (const agentFacts of ctx.agents) {
    paths.add(agentFacts.agent.instructionFile);
  }
  return [...paths];
}

/** Return the text following the Hallucination red-flags section marker. */
function redFlagsSection(content: string): string | null {
  const match = content.match(
    /^\s*(?:#{1,6}\s*)?(?:\*\*)?Hallucination red-flags:?(?:\*\*)?\s*$/imu,
  );
  if (!match || match.index === undefined) return null;
  return content.slice(match.index + match[0].length);
}

/** Return true when a red-flags section names one stable clause anchor. */
function hasClause(section: string, clause: string): boolean {
  return new RegExp(`\\b${clause}\\b`, "iu").test(section);
}

/** Return true when the rationalisations pointer appears as a single paragraph. */
function hasRationalisationsPointer(section: string): boolean {
  return section
    .split(/\r?\n\s*\r?\n/u)
    .some(
      (paragraph) =>
        paragraph.includes(RATIONALISATIONS_PATH) &&
        paragraph.includes(RATIONALISATIONS_HEADING),
    );
}

function evidenceBeforeClaimsDetails(
  ctx: AuditContext,
  preambleProblem: string | null,
): HarnessCheckDetails {
  return verificationDetails(ctx, (af) => {
    const content = ctx.fs.readFile(af.agent.instructionFile);
    if (content === null) {
      return {
        reason: "instruction file missing",
        expected: RED_FLAGS_SECTION,
        actual: "missing",
      };
    }
    const section = redFlagsSection(content);
    if (section === null) {
      return {
        reason: preambleProblem
          ? `missing ${RED_FLAGS_SECTION}; ${preambleProblem}`
          : `missing ${RED_FLAGS_SECTION}`,
        expected: RED_FLAGS_SECTION,
        actual: "section missing",
      };
    }
    const missingClauses = RED_FLAG_CLAUSES.filter(
      (clause) => !hasClause(section, clause),
    );
    const missingPointer = !hasRationalisationsPointer(section);
    const gaps = [
      ...missingClauses.map((clause) => `missing ${clause}`),
      ...(missingPointer ? [`missing ${RATIONALISATIONS_PATH} pointer`] : []),
      ...(preambleProblem ? [preambleProblem] : []),
    ];
    return {
      reason:
        gaps.length > 0
          ? gaps.join("; ")
          : "evidence-before-claims coverage present",
      expected: `${RED_FLAGS_SECTION} plus ${RATIONALISATIONS_HEADING} pointer`,
      actual: gaps.length > 0 ? "incomplete" : "present",
    };
  });
}

/** Metric: present instruction files carry the evidence-before-claims guard. */
const evidenceBeforeClaims: HarnessCheck = {
  id: "evidence-before-claims",
  name: "Evidence-before-claims guard",
  concern: "verification",
  type: "metric",
  evidenceKind: "structural",
  provenance: verificationProvenance(
    "metric",
    [
      "CLAUDE.md",
      RATIONALISATIONS_PATH,
      ".goat-flow/lessons/review-feedback.md",
      ".goat-flow/lessons/agent-behavior.md",
    ],
    "incident",
    EVIDENCE_BEFORE_CLAIMS_VERIFIED_ON,
  ),
  /** Run the Evidence-before-claims guard check. */
  run: (ctx) => {
    const findings: string[] = [];
    const preamble = ctx.fs.readFile(RATIONALISATIONS_PATH);
    let preambleProblem: string | null = null;
    if (preamble === null) {
      preambleProblem = `${RATIONALISATIONS_PATH} missing`;
      findings.push(`${RATIONALISATIONS_PATH}: file missing`);
    } else if (!preamble.includes(RATIONALISATIONS_HEADING)) {
      preambleProblem = `${RATIONALISATIONS_PATH} missing ${RATIONALISATIONS_HEADING}`;
      findings.push(
        `${RATIONALISATIONS_PATH}: missing ${RATIONALISATIONS_HEADING}`,
      );
    }
    const details = evidenceBeforeClaimsDetails(ctx, preambleProblem);

    let presentInstructionFiles = 0;
    for (const path of instructionFilePaths(ctx)) {
      const content = ctx.fs.readFile(path);
      if (content === null) continue;
      presentInstructionFiles++;
      const section = redFlagsSection(content);
      if (section === null) {
        findings.push(`${path}: missing ${RED_FLAGS_SECTION} section`);
        continue;
      }
      const missingClauses = RED_FLAG_CLAUSES.filter(
        (clause) => !hasClause(section, clause),
      );
      if (missingClauses.length > 0) {
        findings.push(
          `${path}: ${RED_FLAGS_SECTION} missing ${missingClauses.join(", ")}`,
        );
      }
      if (!hasRationalisationsPointer(section)) {
        findings.push(
          `${path}: ${RED_FLAGS_SECTION} missing pointer to ${RATIONALISATIONS_PATH} (${RATIONALISATIONS_HEADING})`,
        );
      }
    }

    if (findings.length > 0) {
      return fail(
        findings,
        [
          "Restore the evidence-before-claims red-flags block and rationalisations pointer in every present agent instruction file",
        ],
        [
          `Copy the canonical ${RED_FLAGS_SECTION} clauses and the ${RATIONALISATIONS_HEADING} pointer into each present instruction file; restore ${RATIONALISATIONS_PATH} if it is missing or renamed.`,
        ],
        details,
      );
    }
    if (presentInstructionFiles === 0) {
      return pass(
        ["No agent instruction files present for red-flags coverage"],
        details,
      );
    }
    return pass(
      [
        `${presentInstructionFiles} present instruction file(s) include evidence-before-claims coverage`,
      ],
      details,
    );
  },
};

/** Consolidated: hook validation + honest failure reporting (informational) */
const postTurnHookIntegrity: HarnessCheck = {
  id: "post-turn-hook-integrity",
  name: "Post-turn hook integrity",
  concern: "verification",
  type: "metric",
  provenance: verificationProvenance("metric", [
    "docs/harness-audit.md",
    ".goat-flow/footguns/hooks.md",
  ]),
  /** Run the Post-turn hook integrity check. */
  run: (ctx) => {
    const findings: string[] = [];
    let hasPostTurnHook = false;
    const details = verificationDetails(ctx, (agentFacts) => {
      if (!agentFacts.hooks.postTurnExists) {
        return {
          reason: "post-turn hook missing",
          expected: "hook absent or meaningful validation",
          actual: "missing",
        };
      }
      if (!agentFacts.hooks.postTurnHasValidation) {
        return {
          reason: "post-turn hook has no validation logic",
          expected: "meaningful validation",
          actual: "no validation logic",
        };
      }
      if (agentFacts.hooks.postTurnSwallowsFailures) {
        return {
          reason: "post-turn hook always exits 0",
          expected: "validation failures are reported",
          actual: "always exits 0",
        };
      }
      return {
        reason: "post-turn hook reports failures honestly",
        expected: "validation failures are reported",
        actual: "honest failure reporting",
      };
    });

    for (const agentFacts of ctx.agents) {
      if (!agentFacts.hooks.postTurnExists) continue;
      hasPostTurnHook = true;

      if (agentFacts.hooks.postTurnHasValidation) {
        findings.push(`${agentFacts.agent.id}: post-turn hook runs validation`);
      } else {
        findings.push(
          `${agentFacts.agent.id}: post-turn hook has no validation logic`,
        );
      }

      if (agentFacts.hooks.postTurnSwallowsFailures) {
        findings.push(
          `${agentFacts.agent.id}: post-turn hook always exits 0 (advisory mode)`,
        );
      } else if (agentFacts.hooks.postTurnHasValidation) {
        findings.push(
          `${agentFacts.agent.id}: post-turn hook reports failures honestly`,
        );
      }
    }

    if (!hasPostTurnHook) {
      return fail(
        ["No post-turn hooks installed; no hook-based validation evidence"],
        [
          "Install a project-specific post-turn validation hook only if this project needs automatic post-action checks",
        ],
        undefined,
        details,
      );
    }
    if (
      findings.some(
        (finding) =>
          finding.includes("no validation logic") ||
          finding.includes("always exits 0"),
      )
    ) {
      return fail(
        findings,
        [
          "Make post-turn validation hooks run meaningful checks and report failures honestly, or leave them uninstalled",
        ],
        undefined,
        details,
      );
    }
    return pass(findings, details);
  },
};

export const VERIFICATION_CHECKS: HarnessCheck[] = [
  hooksRegistered,
  commitGuidance,
  evidenceBeforeClaims,
  postTurnHookIntegrity,
];
