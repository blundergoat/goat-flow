/**
 * Context concern: Is the agent's map accurate and structurally complete?
 * 5 deterministic checks (instruction size, execution loop, doc paths,
 * instruction sections, boundary guidance). Content-quality judgments (e.g. footgun evidence
 * currency) live in the `quality` assessment prompt, not here.
 */
import type {
  AuditContext,
  HarnessCheck,
  HarnessCheckDetails,
} from "../types.js";
import type { CheckEvidence } from "../provenance-types.js";
import { getRequiredInstructionSections } from "../../manifest/manifest-json.js";
import { pass, fail, extractBacktickPaths } from "./helpers.js";

/** The execution-loop section label the manifest declares. Used by
 *  `executionLoopPresent` to find the heading regex. Change here only if the
 *  label itself changes; the regex is derived from the manifest, not literal. */
const EXECUTION_LOOP_LABEL = "Execution Loop";

const VERIFIED_ON = "2026-04-18";

const CONTROLLING_WORKSPACE_PATTERNS = [
  /\bcontrolling\s+(?:goat-flow\s+)?workspace\b/i,
  /\bframework\s+workspace\b/i,
  /\bgoat-flow\s+controlling\s+workspace\b/i,
];

const TARGET_WORKSPACE_PATTERNS = [
  /\bselected\s+target\b/i,
  /\btarget\s+project\b/i,
  /\bproject-specific\s+(?:harness\s+)?content\b/i,
];

const BOUNDARY_HEADING_PATTERN = /\bworkspace\s+boundary\b/i;
const CORE_DOC_FILES = [
  "CONTRIBUTING.md",
  ".goat-flow/code-map.md",
  ".goat-flow/glossary.md",
  "docs/cli.md",
  "docs/audit-and-quality.md",
];

/** One unresolved documentation path plus the file that referenced it. */
interface UnresolvedDocPath {
  ref: string;
  source: string;
}

/** Resolution summary for one documentation source file. */
interface DocPathResolution {
  resolved: number;
  findings: string[];
  unresolved: UnresolvedDocPath[];
}

/** Mutable aggregate carried across router, architecture, and core-doc checks. */
interface DocPathAccumulator {
  totalPaths: number;
  resolvedCount: number;
  findings: string[];
  unresolved: UnresolvedDocPath[];
  /**
   * Set when a canonical doc is missing outright; fails the check even when
   * every counted path resolves, so the finding cannot be balanced away.
   */
  hasHardFailure: boolean;
}

/** Escape text for dynamic regex construction. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Return the markdown section body under a heading label.
 *
 * The helper reads only the provided string; RegExp cursors are local so section
 * detection cannot mutate audit context or project files.
 */
function markdownSectionByLabel(content: string, label: string): string | null {
  const headingPattern = new RegExp(
    `^(?<marks>#{1,6})\\s+${escapeRegex(label)}\\b.*$`,
    "im",
  );
  const heading = headingPattern.exec(content);
  if (!heading?.groups?.marks) return null;

  const level = heading.groups.marks.length;
  const start = heading.index + heading[0].length;
  const nextHeadingPattern = /^#{1,6}\s+.*$/gm;
  nextHeadingPattern.lastIndex = start;

  let end = content.length;
  for (const nextHeading of content.matchAll(nextHeadingPattern)) {
    const marks = /^#+/.exec(nextHeading[0])?.[0] ?? "";
    if (marks.length <= level) {
      end = nextHeading.index;
      break;
    }
  }

  return content.slice(start, end).trim();
}

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
  evidenceKind: "structural",
  provenance: contextProvenance("advisory", [
    "docs/harness-audit.md",
    "CLAUDE.md",
    "AGENTS.md",
    ".github/copilot-instructions.md",
  ]),
  /** Run the Instruction file size check. */
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    const lineCounts: NonNullable<HarnessCheckDetails["lineCounts"]> = [];
    let hasLineCountFailure = false;
    const limit = ctx.config.config.lineLimits.limit;
    const target = ctx.config.config.lineLimits.target;
    for (const agentFacts of ctx.agents) {
      if (!agentFacts.instruction.exists) {
        findings.push(`${agentFacts.agent.id}: no instruction file`);
        recs.push(`Create ${agentFacts.agent.instructionFile}`);
        fixes.push(
          `Create ${agentFacts.agent.instructionFile} by running \`goat-flow setup\`.`,
        );
        lineCounts.push({
          agent: agentFacts.agent.id,
          actual: 0,
          target,
          hardLimit: limit,
        });
        hasLineCountFailure = true;
        continue;
      }
      const lines = agentFacts.instruction.lineCount;
      lineCounts.push({
        agent: agentFacts.agent.id,
        actual: lines,
        target,
        hardLimit: limit,
      });
      if (lines > limit) {
        findings.push(
          `${agentFacts.agent.id}: ${lines} lines (exceeds hard limit ${limit})`,
        );
        recs.push(
          `Reduce ${agentFacts.agent.instructionFile} below ${limit} lines`,
        );
        fixes.push(
          `Reduce ${agentFacts.agent.instructionFile} to under ${limit} lines by moving verbose sections to .goat-flow/ docs.`,
        );
        hasLineCountFailure = true;
      } else {
        findings.push(
          `${agentFacts.agent.id}: ${lines} lines (within limit ${limit})`,
        );
      }
    }
    if (hasLineCountFailure) return fail(findings, recs, fixes, { lineCounts });
    return pass(findings, { lineCounts });
  },
};

const executionLoopPresent: HarnessCheck = {
  id: "execution-loop-present",
  name: "Execution loop structural smoke",
  concern: "context",
  type: "advisory",
  evidenceKind: "structural",
  provenance: contextProvenance("advisory", [
    "docs/harness-audit.md",
    "CLAUDE.md",
    "AGENTS.md",
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
    const executionLoop: NonNullable<HarnessCheckDetails["executionLoop"]> = [];
    let hasExecutionLoopFailure = false;

    for (const agentFacts of ctx.agents) {
      if (!agentFacts.instruction.exists || !agentFacts.instruction.content) {
        findings.push(`${agentFacts.agent.id}: no instruction file to check`);
        executionLoop.push({
          agent: agentFacts.agent.id,
          found: false,
          sectionLabel: EXECUTION_LOOP_LABEL,
          missingSteps: stepWords,
        });
        hasExecutionLoopFailure = true;
        continue;
      }
      const content = agentFacts.instruction.content;
      const executionLoopSection = markdownSectionByLabel(
        content,
        EXECUTION_LOOP_LABEL,
      );
      if (
        !headingEntry.pattern.test(content) ||
        executionLoopSection === null
      ) {
        findings.push(
          `${agentFacts.agent.id}: no "${EXECUTION_LOOP_LABEL}" heading detected`,
        );
        recs.push(
          `Add a "${EXECUTION_LOOP_LABEL}" heading with READ → SCOPE → ACT → VERIFY steps to ${agentFacts.agent.instructionFile}`,
        );
        executionLoop.push({
          agent: agentFacts.agent.id,
          found: false,
          sectionLabel: EXECUTION_LOOP_LABEL,
          missingSteps: stepWords,
        });
        hasExecutionLoopFailure = true;
        continue;
      }
      // Heading present - verify the four step words actually appear under it.
      const lower = executionLoopSection.toLowerCase();
      const missingSteps = stepWords.filter((s) => !lower.includes(s));
      if (missingSteps.length === 0) {
        findings.push(`${agentFacts.agent.id}: execution loop has all 4 steps`);
        executionLoop.push({
          agent: agentFacts.agent.id,
          found: true,
          sectionLabel: EXECUTION_LOOP_LABEL,
          missingSteps: [],
        });
      } else {
        findings.push(
          `${agentFacts.agent.id}: execution loop heading present but missing step words inside the section (${missingSteps.join(", ")})`,
        );
        recs.push(
          `Add READ, SCOPE, ACT, VERIFY steps under the "${EXECUTION_LOOP_LABEL}" heading in ${agentFacts.agent.instructionFile}`,
        );
        executionLoop.push({
          agent: agentFacts.agent.id,
          found: true,
          sectionLabel: EXECUTION_LOOP_LABEL,
          missingSteps,
        });
        hasExecutionLoopFailure = true;
      }
    }
    if (hasExecutionLoopFailure)
      return fail(
        findings,
        recs,
        [
          `Add an "${EXECUTION_LOOP_LABEL}" heading with READ, SCOPE, ACT, VERIFY steps to the instruction file.`,
        ],
        { executionLoop },
      );
    return pass(findings, { executionLoop });
  },
};

/** Local-state paths are intentionally gitignored and may be absent on clean checkouts. */
function isGitignoredLocalStatePath(path: string): boolean {
  return (
    path === ".goat-flow/dashboard-state.json" ||
    path === ".goat-flow/project-id" ||
    path.startsWith(".goat-flow/plans/") ||
    path.startsWith(".goat-flow/scratchpad/") ||
    path.startsWith(".goat-flow/logs/")
  );
}

/**
 * Resolve one backtick path reference from a documentation file.
 *
 * Line-number tokens report as unresolved even when the base file exists
 * because semantic anchors are the durable contract for learning-loop docs.
 */
function resolveDocPath(
  ctx: AuditContext,
  source: string,
  path: string,
): { resolved: true } | { resolved: false; finding: string; ref: string } {
  const lineRef = /^(?<file>.+\.[a-z0-9]+):\d+$/i.exec(path);
  if (lineRef?.groups?.file && ctx.fs.exists(lineRef.groups.file)) {
    return {
      resolved: false,
      ref: path,
      finding: `${source}: line-number path \`${path}\` is brittle; use \`${lineRef.groups.file}\` plus a semantic anchor`,
    };
  }
  if (isGitignoredLocalStatePath(path) || ctx.fs.exists(path)) {
    return { resolved: true };
  }
  return {
    resolved: false,
    ref: path,
    finding: `${source}: unresolved \`${path}\``,
  };
}

/**
 * Count resolved paths from one source file while preserving all diagnostics.
 *
 * @param ctx - audit context whose filesystem resolves the target project
 * @param source - file that contained the backtick path references
 * @param paths - path references extracted from that source
 * @returns per-source resolution counts, findings, and unresolved references
 */
function countResolvedPaths(
  ctx: AuditContext,
  source: string,
  paths: string[],
): DocPathResolution {
  const findings: string[] = [];
  const unresolved: UnresolvedDocPath[] = [];
  let resolved = 0;

  for (const path of paths) {
    const result = resolveDocPath(ctx, source, path);
    if (result.resolved) {
      resolved++;
    } else {
      findings.push(result.finding);
      unresolved.push({ ref: result.ref, source });
    }
  }

  return { resolved, findings, unresolved };
}

/** Mutate the doc-path accumulator with one source file's resolution result. */
function addDocPathResolution(
  accumulator: DocPathAccumulator,
  pathCount: number,
  resolution: DocPathResolution,
): void {
  accumulator.totalPaths += pathCount;
  accumulator.resolvedCount += resolution.resolved;
  accumulator.findings.push(...resolution.findings);
  accumulator.unresolved.push(...resolution.unresolved);
}

/** Mutate the accumulator with router-table paths already collected from agent facts. */
function collectRouterDocPaths(
  ctx: AuditContext,
  accumulator: DocPathAccumulator,
): void {
  for (const agentFacts of ctx.agents) {
    accumulator.totalPaths += agentFacts.router.paths.length;
    accumulator.resolvedCount += agentFacts.router.resolved;
    if (agentFacts.router.unresolved.length === 0) continue;
    accumulator.findings.push(
      `${agentFacts.agent.id}: ${agentFacts.router.unresolved.length} dead router paths`,
    );
    for (const ref of agentFacts.router.unresolved) {
      accumulator.unresolved.push({
        ref,
        source: agentFacts.agent.instructionFile,
      });
    }
  }
}

/** Mutate the accumulator with architecture.md path checks and its pass diagnostic. */
function collectArchitectureDocPaths(
  ctx: AuditContext,
  accumulator: DocPathAccumulator,
): void {
  if (!ctx.facts.shared.architecture.exists) {
    accumulator.findings.push("architecture.md does not exist");
    accumulator.hasHardFailure = true;
    return;
  }
  const content = ctx.fs.readFile(".goat-flow/architecture.md");
  if (!content) return;
  const paths = extractBacktickPaths(content);
  const resolution = countResolvedPaths(
    ctx,
    ".goat-flow/architecture.md",
    paths,
  );
  addDocPathResolution(accumulator, paths.length, resolution);
  if (resolution.findings.length === 0) {
    accumulator.findings.push(
      `All ${paths.length} architecture.md path references resolve`,
    );
  }
}

/** Mutate the accumulator with the curated core docs path checks. */
function collectCoreDocPaths(
  ctx: AuditContext,
  accumulator: DocPathAccumulator,
): void {
  for (const file of CORE_DOC_FILES) {
    const content = ctx.fs.readFile(file);
    if (!content) continue;
    const paths = extractBacktickPaths(content);
    const resolution = countResolvedPaths(ctx, file, paths);
    addDocPathResolution(accumulator, paths.length, resolution);
  }
}

/**
 * Consolidate router, architecture, and core-doc path validation.
 *
 * This reads only the audited project's filesystem and reports diagnostics
 * instead of throwing because context integrity should return every stale path
 * in one pass. The shape is branch-heavy to preserve the old check boundaries:
 * router-table paths, architecture presence, architecture refs, and curated
 * docs all feed one dashboard detail payload.
 */
function checkAllDocPaths(ctx: AuditContext) {
  const accumulator: DocPathAccumulator = {
    totalPaths: 0,
    resolvedCount: 0,
    findings: [],
    unresolved: [],
    hasHardFailure: false,
  };
  collectRouterDocPaths(ctx, accumulator);
  collectArchitectureDocPaths(ctx, accumulator);
  collectCoreDocPaths(ctx, accumulator);
  return accumulator;
}

const docPathsResolve: HarnessCheck = {
  id: "doc-paths-resolve",
  name: "Documentation paths resolve",
  concern: "context",
  type: "integrity",
  evidenceKind: "structural",
  provenance: contextProvenance(
    "integrity",
    [
      "docs/harness-audit.md",
      ".goat-flow/learning-loop/footguns/docs-and-crossrefs.md",
      ".goat-flow/learning-loop/lessons/verification.md",
    ],
    "incident",
  ),
  /** Run the Documentation paths resolve check. */
  run: (ctx) => {
    const { totalPaths, resolvedCount, findings, unresolved, hasHardFailure } =
      checkAllDocPaths(ctx);
    const details = { docPaths: { totalPaths, resolvedCount, unresolved } };

    // A missing canonical doc fails outright - resolved-path counts from other
    // sources must not balance the finding away.
    if (hasHardFailure) {
      return fail(
        findings,
        [
          "Fix missing docs and add backtick-quoted file paths for drift detection",
        ],
        undefined,
        details,
      );
    }
    if (totalPaths === 0) {
      return pass(
        ["No file path references found in docs to validate"],
        details,
      );
    }
    if (resolvedCount === totalPaths) {
      return pass([`All ${totalPaths} doc file paths resolve`], details);
    }
    return fail(
      findings,
      ["Update stale paths in docs to match current file locations"],
      [
        "Update or remove dead paths in router table, architecture.md, and doc files.",
      ],
      details,
    );
  },
};

const instructionSectionsPresent: HarnessCheck = {
  id: "instruction-sections-present",
  name: "Instruction sections structural smoke",
  concern: "context",
  type: "advisory",
  evidenceKind: "structural",
  provenance: contextProvenance("advisory", [
    "docs/harness-audit.md",
    "src/cli/prompt/compose-quality.ts",
    "CLAUDE.md",
    "AGENTS.md",
    ".github/copilot-instructions.md",
  ]),
  /** Run the Instruction file required sections check. */
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    const sections: NonNullable<HarnessCheckDetails["sections"]> = [];
    let hasInstructionSectionFailure = false;
    const requiredSections = getRequiredInstructionSections();
    const required = requiredSections.map((s) => s.label);
    for (const agentFacts of ctx.agents) {
      if (!agentFacts.instruction.exists || !agentFacts.instruction.content) {
        findings.push(`${agentFacts.agent.id}: no instruction file to check`);
        sections.push({
          agent: agentFacts.agent.id,
          required,
          present: [],
          missing: required,
        });
        hasInstructionSectionFailure = true;
        continue;
      }
      const content = agentFacts.instruction.content;
      const missing = requiredSections
        .filter(({ pattern }) => !pattern.test(content))
        .map(({ label }) => label);
      const present = required.filter((label) => !missing.includes(label));
      sections.push({ agent: agentFacts.agent.id, required, present, missing });
      if (missing.length === 0) {
        findings.push(
          `${agentFacts.agent.id}: all ${requiredSections.length} required sections present`,
        );
      } else {
        findings.push(
          `${agentFacts.agent.id}: missing sections - ${missing.join(", ")}`,
        );
        recs.push(
          `Add the missing hot-path sections to ${agentFacts.agent.instructionFile}: ${missing.join(", ")}`,
        );
        fixes.push(
          `Add level-2 (or deeper) headings for ${missing.join(", ")} to ${agentFacts.agent.instructionFile}. Skeleton overlays are not sufficient for hot-path contract.`,
        );
        hasInstructionSectionFailure = true;
      }
    }
    if (hasInstructionSectionFailure)
      return fail(findings, recs, fixes, { sections });
    return pass(findings, { sections });
  },
};

/** Return whether instruction text distinguishes controlling workspace from selected target. */
function boundaryGuidancePresent(content: string): boolean {
  if (BOUNDARY_HEADING_PATTERN.test(content)) return true;
  return (
    CONTROLLING_WORKSPACE_PATTERNS.some((pattern) => pattern.test(content)) &&
    TARGET_WORKSPACE_PATTERNS.some((pattern) => pattern.test(content))
  );
}

const boundaryGuidancePresentCheck: HarnessCheck = {
  id: "boundary-guidance-present",
  name: "Workspace boundary guidance structural smoke",
  concern: "context",
  type: "advisory",
  evidenceKind: "structural",
  provenance: contextProvenance("advisory", [
    "docs/harness-audit.md",
    ".goat-flow/learning-loop/decisions/ADR-026-keep-workspace-boundary-path-agnostic.md",
    "CLAUDE.md",
    "AGENTS.md",
    ".github/copilot-instructions.md",
  ]),
  /** Run the Workspace boundary guidance present check. */
  run: (ctx) => {
    const findings: string[] = [];
    const missing: string[] = [];
    const boundary: NonNullable<HarnessCheckDetails["boundary"]> = [];

    for (const agentFacts of ctx.agents) {
      if (!agentFacts.instruction.exists || !agentFacts.instruction.content) {
        findings.push(`${agentFacts.agent.id}: no instruction file to check`);
        missing.push(
          `${agentFacts.agent.id} (${agentFacts.agent.instructionFile})`,
        );
        boundary.push({
          agent: agentFacts.agent.id,
          controllingWorkspace: false,
          targetWorkspace: false,
          boundaryHeading: false,
        });
        continue;
      }
      const content = agentFacts.instruction.content;
      const controllingWorkspace = CONTROLLING_WORKSPACE_PATTERNS.some((p) =>
        p.test(content),
      );
      const targetWorkspace = TARGET_WORKSPACE_PATTERNS.some((p) =>
        p.test(content),
      );
      const boundaryHeading = BOUNDARY_HEADING_PATTERN.test(content);
      boundary.push({
        agent: agentFacts.agent.id,
        controllingWorkspace,
        targetWorkspace,
        boundaryHeading,
      });
      if (boundaryGuidancePresent(content)) {
        findings.push(
          `${agentFacts.agent.id}: instruction file distinguishes controlling workspace from selected target`,
        );
      } else {
        findings.push(
          `${agentFacts.agent.id}: instruction file has no workspace boundary guidance`,
        );
        missing.push(
          `${agentFacts.agent.id} (${agentFacts.agent.instructionFile})`,
        );
      }
    }

    if (missing.length === 0) return pass(findings, { boundary });

    const missingText = missing.join(", ");
    return fail(
      findings,
      [
        `Add path-agnostic workspace boundary guidance to every audited agent instruction file missing it: ${missingText}`,
      ],
      [
        `Add wording that distinguishes the controlling goat-flow workspace from the selected target project in ${missingText}; do not hardcode machine-specific absolute paths.`,
      ],
      { boundary },
    );
  },
};

export const CONTEXT_CHECKS: HarnessCheck[] = [
  instructionLineCount,
  executionLoopPresent,
  docPathsResolve,
  instructionSectionsPresent,
  boundaryGuidancePresentCheck,
];
