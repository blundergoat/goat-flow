/**
 * Context concern: Is the agent's map accurate and structurally complete?
 * 3 deterministic integrity checks (instruction size, execution loop, doc paths).
 * Content-quality judgments (e.g. footgun evidence currency) live in critique,
 * not here.
 */
import type { AuditContext, HarnessCheck } from "../types.js";
import { pass, fail, extractBacktickPaths } from "./helpers.js";

const instructionLineCount: HarnessCheck = {
  id: "instruction-line-count",
  name: "Instruction file size",
  concern: "context",
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
  run: (ctx) => {
    const steps = ["read", "scope", "act", "verify"];
    const findings: string[] = [];
    const recs: string[] = [];
    let anyFail = false;

    for (const af of ctx.agents) {
      if (!af.instruction.exists || !af.instruction.content) {
        findings.push(`${af.agent.id}: no instruction file to check`);
        anyFail = true;
        continue;
      }
      const lower = af.instruction.content.toLowerCase();
      const found = steps.filter((s) => lower.includes(s));
      const missing = steps.filter((s) => !found.includes(s));

      if (missing.length === 0) {
        findings.push(`${af.agent.id}: execution loop has all 4 steps`);
      } else if (found.length >= 2) {
        findings.push(
          `${af.agent.id}: execution loop found ${found.length}/4 steps (missing ${missing.join(", ")})`,
        );
      } else {
        findings.push(`${af.agent.id}: no execution loop detected`);
        recs.push(
          `Add a READ → SCOPE → ACT → VERIFY execution loop to ${af.agent.instructionFile}`,
        );
        anyFail = true;
      }
    }
    if (anyFail)
      return fail(findings, recs, [
        "Add an execution loop section with READ, SCOPE, ACT, VERIFY steps to the instruction file.",
      ]);
    return pass(findings);
  },
};

/** Consolidated: router-table-resolves + architecture-refs-resolve + doc-paths-resolve + architecture-exists */
function checkAllDocPaths(ctx: AuditContext) {
  let totalPaths = 0;
  let resolvedCount = 0;
  const findings: string[] = [];

  // Router table paths
  for (const af of ctx.agents) {
    totalPaths += af.router.paths.length;
    resolvedCount += af.router.resolved;
    if (af.router.unresolved.length > 0) {
      findings.push(
        `${af.agent.id}: ${af.router.unresolved.length} dead router paths`,
      );
    }
  }

  // Architecture doc
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
    "docs/audit-and-critique.md",
  ];
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
  run: (ctx) => {
    const { totalPaths, resolvedCount, findings } = checkAllDocPaths(ctx);

    if (totalPaths === 0) {
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

export const CONTEXT_CHECKS: HarnessCheck[] = [
  instructionLineCount,
  executionLoopPresent,
  docPathsResolve,
];
