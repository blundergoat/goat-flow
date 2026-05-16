/**
 * Verification concern: Can the agent verify its own work honestly?
 * 4 checks: hooks-registered, commit-guidance, evidence-before-claims,
 * post-turn-hook-integrity.
 */
import type { AuditContext, HarnessCheck } from "../types.js";
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
    let anyFail = false;
    for (const af of ctx.agents) {
      if (af.hooks.postTurnRegistered && !af.hooks.postTurnExists) {
        findings.push(
          `${af.agent.id}: post-turn hook registered but file missing`,
        );
        recs.push("Create the registered post-turn hook file");
        fixes.push(
          `Create the post-turn hook file at the path specified in ${af.agent.settingsFile}.`,
        );
        anyFail = true;
      }
      if (af.hooks.postTurnExists && !af.hooks.postTurnRegistered) {
        findings.push(
          `${af.agent.id}: post-turn hook file exists but not registered`,
        );
        recs.push("Register the post-turn hook in agent settings");
        fixes.push(`Register the post-turn hook in ${af.agent.settingsFile}.`);
        anyFail = true;
      }
    }
    if (anyFail) return fail(findings, recs, fixes);
    return pass(["Hook registrations and files are in sync"]);
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
    if (guidance.exists) {
      return pass([`Commit guidance found at ${guidance.path}`]);
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
      );
    }
    return fail(
      ["No commit guidance detected"],
      [`Add commit conventions to ${guidance.requiredPath}`],
      [`Create ${guidance.requiredPath} with this project's commit rules.`],
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
      ".goat-flow/lessons/verification-review.md",
      ".goat-flow/lessons/agent-behavior-trust.md",
    ],
    "incident",
    EVIDENCE_BEFORE_CLAIMS_VERIFIED_ON,
  ),
  /** Run the Evidence-before-claims guard check. */
  run: (ctx) => {
    const findings: string[] = [];
    const preamble = ctx.fs.readFile(RATIONALISATIONS_PATH);
    if (preamble === null) {
      findings.push(`${RATIONALISATIONS_PATH}: file missing`);
    } else if (!preamble.includes(RATIONALISATIONS_HEADING)) {
      findings.push(
        `${RATIONALISATIONS_PATH}: missing ${RATIONALISATIONS_HEADING}`,
      );
    }

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
      );
    }
    if (presentInstructionFiles === 0) {
      return pass([
        "No agent instruction files present for red-flags coverage",
      ]);
    }
    return pass([
      `${presentInstructionFiles} present instruction file(s) include evidence-before-claims coverage`,
    ]);
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
    let anyHook = false;

    for (const af of ctx.agents) {
      if (!af.hooks.postTurnExists) continue;
      anyHook = true;

      if (af.hooks.postTurnHasValidation) {
        findings.push(`${af.agent.id}: post-turn hook runs validation`);
      } else {
        findings.push(`${af.agent.id}: post-turn hook has no validation logic`);
      }

      if (af.hooks.postTurnSwallowsFailures) {
        findings.push(
          `${af.agent.id}: post-turn hook always exits 0 (advisory mode)`,
        );
      } else if (af.hooks.postTurnHasValidation) {
        findings.push(
          `${af.agent.id}: post-turn hook reports failures honestly`,
        );
      }
    }

    if (!anyHook) {
      return fail(
        ["No post-turn hooks installed; no hook-based validation evidence"],
        [
          "Install a project-specific post-turn validation hook only if this project needs automatic post-action checks",
        ],
      );
    }
    if (
      findings.some(
        (finding) =>
          finding.includes("no validation logic") ||
          finding.includes("always exits 0"),
      )
    ) {
      return fail(findings, [
        "Make post-turn validation hooks run meaningful checks and report failures honestly, or leave them uninstalled",
      ]);
    }
    return pass(findings);
  },
};

export const VERIFICATION_CHECKS: HarnessCheck[] = [
  hooksRegistered,
  commitGuidance,
  evidenceBeforeClaims,
  postTurnHookIntegrity,
];
