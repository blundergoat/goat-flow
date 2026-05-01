/**
 * Context concern: Is the agent's map accurate and structurally complete?
 * 4 deterministic checks (instruction size, execution loop, doc paths,
 * instruction sections). Content-quality judgments (e.g. footgun evidence
 * currency) live in the `quality` assessment prompt, not here.
 */
import type { AuditContext, HarnessCheck } from "../types.js";
import type { CheckEvidence } from "../provenance-types.js";
import { getRequiredInstructionSections } from "../../manifest/manifest.js";
import { pass, fail, extractBacktickPaths } from "./helpers.js";

/** The execution-loop section label the manifest declares. Used by
 *  `executionLoopPresent` to find the heading regex. Change here only if the
 *  label itself changes; the regex is derived from the manifest, not literal. */
const EXECUTION_LOOP_LABEL = "Execution Loop";

const VERIFIED_ON = "2026-04-18";

/** Return the context provenance. */
function contextProvenance(
  type: HarnessCheck["type"],
  paths: string[],
  sourceType: CheckEvidence["source_type"] = "spec",
): CheckEvidence {
  return {
    source_type: sourceType,
    source_urls: [],
    verified_on: VERIFIED_ON,
    normative_level:
      type === "integrity"
        ? "MUST"
        : type === "advisory"
          ? "SHOULD"
          : "BEST_PRACTICE",
    evidence_paths: paths,
  };
}

const instructionLineCount: HarnessCheck = {
  id: "instruction-line-count",
  name: "Instruction file size",
  concern: "context",
  type: "advisory",
  provenance: contextProvenance("advisory", [
    "docs/harness-audit.md",
    "CLAUDE.md",
    "AGENTS.md",
    "GEMINI.md",
    ".github/copilot-instructions.md",
  ]),
  /** Run the Instruction file size check. */
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    let anyFail = false;
    for (const af of ctx.agents) {
      if (!af.instruction.exists) {
        findings.push(`${af.agent.id}: no instruction file`);
        recs.push(`Create ${af.agent.instructionFile}`);
        fixes.push(
          `Create ${af.agent.instructionFile} by running \`goat-flow setup\`.`,
        );
        anyFail = true;
        continue;
      }
      const lines = af.instruction.lineCount;
      const limit = ctx.config.config.lineLimits.limit;
      if (lines > limit) {
        findings.push(
          `${af.agent.id}: ${lines} lines (exceeds hard limit ${limit})`,
        );
        recs.push(`Reduce ${af.agent.instructionFile} below ${limit} lines`);
        fixes.push(
          `Reduce ${af.agent.instructionFile} to under ${limit} lines by moving verbose sections to .goat-flow/ docs.`,
        );
        anyFail = true;
      } else {
        findings.push(`${af.agent.id}: ${lines} lines (within limit ${limit})`);
      }
    }
    if (anyFail) return fail(findings, recs, fixes);
    return pass(findings);
  },
};

const executionLoopPresent: HarnessCheck = {
  id: "execution-loop-present",
  name: "Execution loop present",
  concern: "context",
  type: "advisory",
  provenance: contextProvenance("advisory", [
    "docs/harness-audit.md",
    "CLAUDE.md",
    "AGENTS.md",
    "GEMINI.md",
    ".github/copilot-instructions.md",
  ]),
  /** Run the Execution loop present check. */
  run: (ctx) => {
    const headingEntry = getRequiredInstructionSections().find(
      (s) => s.label === EXECUTION_LOOP_LABEL,
    );
    if (!headingEntry) {
      // Manifest doesn't require Execution Loop - nothing to enforce here.
      return pass([
        `manifest declares no "${EXECUTION_LOOP_LABEL}" section; check skipped`,
      ]);
    }
    const stepWords = ["read", "scope", "act", "verify"];
    const findings: string[] = [];
    const recs: string[] = [];
    let anyFail = false;

    for (const af of ctx.agents) {
      if (!af.instruction.exists || !af.instruction.content) {
        findings.push(`${af.agent.id}: no instruction file to check`);
        anyFail = true;
        continue;
      }
      const content = af.instruction.content;
      const headingFound = headingEntry.pattern.test(content);
      if (!headingFound) {
        findings.push(
          `${af.agent.id}: no "${EXECUTION_LOOP_LABEL}" heading detected`,
        );
        recs.push(
          `Add a "${EXECUTION_LOOP_LABEL}" heading with READ → SCOPE → ACT → VERIFY steps to ${af.agent.instructionFile}`,
        );
        anyFail = true;
        continue;
      }
      // Heading present - verify the four step words actually appear under it.
      const lower = content.toLowerCase();
      const foundSteps = stepWords.filter((s) => lower.includes(s));
      const missingSteps = stepWords.filter((s) => !foundSteps.includes(s));
      if (missingSteps.length === 0) {
        findings.push(`${af.agent.id}: execution loop has all 4 steps`);
      } else {
        findings.push(
          `${af.agent.id}: execution loop heading present but missing step words (${missingSteps.join(", ")})`,
        );
      }
    }
    if (anyFail)
      return fail(findings, recs, [
        `Add an "${EXECUTION_LOOP_LABEL}" heading with READ, SCOPE, ACT, VERIFY steps to the instruction file.`,
      ]);
    return pass(findings);
  },
};

/** Consolidated: router-table-resolves + architecture-refs-resolve + doc-paths-resolve + architecture-exists */
function checkAllDocPaths(ctx: AuditContext) {
  let totalPaths = 0;
  let resolvedCount = 0;
  const findings: string[] = [];

  // Router tables enumerate the docs and directories the agent is expected to consult,
  // so dead entries here are a high-signal context failure.
  for (const af of ctx.agents) {
    totalPaths += af.router.paths.length;
    resolvedCount += af.router.resolved;
    if (af.router.unresolved.length > 0) {
      findings.push(
        `${af.agent.id}: ${af.router.unresolved.length} dead router paths`,
      );
    }
  }

  // architecture.md is canonical and gets separate reporting instead of being folded
  // into the generic doc-file loop below.
  if (!ctx.facts.shared.architecture.exists) {
    findings.push("architecture.md does not exist");
  } else {
    const content = ctx.fs.readFile(".goat-flow/architecture.md");
    if (content) {
      const paths = extractBacktickPaths(content);
      totalPaths += paths.length;
      const unresolved = paths.filter((p) => !ctx.fs.exists(p));
      resolvedCount += paths.length - unresolved.length;
      if (unresolved.length > 0) {
        findings.push(`${unresolved.length} stale paths in architecture.md`);
      } else {
        findings.push(
          `All ${paths.length} architecture.md path references resolve`,
        );
      }
    }
  }

  // Other doc files
  const docFiles = [
    "CONTRIBUTING.md",
    ".goat-flow/code-map.md",
    "docs/cli.md",
    "docs/audit-and-quality.md",
  ];
  // Keep this list curated and deterministic. The goal is to validate the core docs
  // goat-flow owns, not recursively scan every user-authored markdown file.
  for (const file of docFiles) {
    const content = ctx.fs.readFile(file);
    if (!content) continue;
    const paths = extractBacktickPaths(content);
    totalPaths += paths.length;
    const unresolved = paths.filter((p) => !ctx.fs.exists(p));
    resolvedCount += paths.length - unresolved.length;
    if (unresolved.length > 0) {
      findings.push(`${unresolved.length} stale paths in ${file}`);
    }
  }

  return { totalPaths, resolvedCount, findings };
}

const docPathsResolve: HarnessCheck = {
  id: "doc-paths-resolve",
  name: "Documentation paths resolve",
  concern: "context",
  type: "integrity",
  provenance: contextProvenance(
    "integrity",
    [
      "docs/harness-audit.md",
      ".goat-flow/footguns/docs-and-crossrefs.md",
      ".goat-flow/lessons/verification.md",
    ],
    "incident",
  ),
  /** Run the Documentation paths resolve check. */
  run: (ctx) => {
    const { totalPaths, resolvedCount, findings } = checkAllDocPaths(ctx);

    if (totalPaths === 0) {
      // Missing files still produce findings even when there were no path literals to inspect.
      if (findings.length > 0) {
        return fail(findings, [
          "Fix missing docs and add backtick-quoted file paths for drift detection",
        ]);
      }
      return pass(["No file path references found in docs to validate"]);
    }
    if (resolvedCount === totalPaths) {
      return pass([`All ${totalPaths} doc file paths resolve`]);
    }
    return fail(
      findings,
      ["Update stale paths in docs to match current file locations"],
      [
        "Update or remove dead paths in router table, architecture.md, and doc files.",
      ],
    );
  },
};

const instructionSectionsPresent: HarnessCheck = {
  id: "instruction-sections-present",
  name: "Instruction file required sections",
  concern: "context",
  type: "advisory",
  provenance: contextProvenance("advisory", [
    "docs/harness-audit.md",
    "src/cli/prompt/compose-quality.ts",
    "CLAUDE.md",
    "AGENTS.md",
    "GEMINI.md",
    ".github/copilot-instructions.md",
  ]),
  /** Run the Instruction file required sections check. */
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    let anyFail = false;

    const requiredSections = getRequiredInstructionSections();
    for (const af of ctx.agents) {
      if (!af.instruction.exists || !af.instruction.content) {
        findings.push(`${af.agent.id}: no instruction file to check`);
        anyFail = true;
        continue;
      }
      const content = af.instruction.content;
      const missing = requiredSections
        .filter(({ pattern }) => !pattern.test(content))
        .map(({ label }) => label);
      if (missing.length === 0) {
        findings.push(
          `${af.agent.id}: all ${requiredSections.length} required sections present`,
        );
      } else {
        findings.push(
          `${af.agent.id}: missing sections - ${missing.join(", ")}`,
        );
        recs.push(
          `Add the missing hot-path sections to ${af.agent.instructionFile}: ${missing.join(", ")}`,
        );
        fixes.push(
          `Add level-2 (or deeper) headings for ${missing.join(", ")} to ${af.agent.instructionFile}. Skeleton overlays are not sufficient for hot-path contract.`,
        );
        anyFail = true;
      }
    }
    if (anyFail) return fail(findings, recs, fixes);
    return pass(findings);
  },
};

export const CONTEXT_CHECKS: HarnessCheck[] = [
  instructionLineCount,
  executionLoopPresent,
  docPathsResolve,
  instructionSectionsPresent,
];
