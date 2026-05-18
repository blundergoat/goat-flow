/**
 * Context concern: Is the agent's map accurate and structurally complete?
 * 5 deterministic checks (instruction size, execution loop, doc paths,
 * instruction sections, boundary guidance). Content-quality judgments (e.g. footgun evidence
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

/** Escape text for dynamic regex construction. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Return the markdown section body under a heading label. */
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
    "GEMINI.md",
    ".github/copilot-instructions.md",
  ]),
  /** Run the Instruction file size check. */
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    const lineCounts: NonNullable<
      import("../types.js").HarnessCheckDetails["lineCounts"]
    > = [];
    let anyFail = false;
    const limit = ctx.config.config.lineLimits.limit;
    const target = ctx.config.config.lineLimits.target;
    for (const af of ctx.agents) {
      if (!af.instruction.exists) {
        findings.push(`${af.agent.id}: no instruction file`);
        recs.push(`Create ${af.agent.instructionFile}`);
        fixes.push(
          `Create ${af.agent.instructionFile} by running \`goat-flow setup\`.`,
        );
        lineCounts.push({
          agent: af.agent.id,
          actual: 0,
          target,
          hardLimit: limit,
        });
        anyFail = true;
        continue;
      }
      const lines = af.instruction.lineCount;
      lineCounts.push({
        agent: af.agent.id,
        actual: lines,
        target,
        hardLimit: limit,
      });
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
    if (anyFail) return fail(findings, recs, fixes, { lineCounts });
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
    const executionLoop: NonNullable<
      import("../types.js").HarnessCheckDetails["executionLoop"]
    > = [];
    let anyFail = false;

    for (const af of ctx.agents) {
      if (!af.instruction.exists || !af.instruction.content) {
        findings.push(`${af.agent.id}: no instruction file to check`);
        executionLoop.push({
          agent: af.agent.id,
          found: false,
          sectionLabel: EXECUTION_LOOP_LABEL,
          missingSteps: stepWords,
        });
        anyFail = true;
        continue;
      }
      const content = af.instruction.content;
      const executionLoopSection = markdownSectionByLabel(
        content,
        EXECUTION_LOOP_LABEL,
      );
      if (
        !headingEntry.pattern.test(content) ||
        executionLoopSection === null
      ) {
        findings.push(
          `${af.agent.id}: no "${EXECUTION_LOOP_LABEL}" heading detected`,
        );
        recs.push(
          `Add a "${EXECUTION_LOOP_LABEL}" heading with READ → SCOPE → ACT → VERIFY steps to ${af.agent.instructionFile}`,
        );
        executionLoop.push({
          agent: af.agent.id,
          found: false,
          sectionLabel: EXECUTION_LOOP_LABEL,
          missingSteps: stepWords,
        });
        anyFail = true;
        continue;
      }
      // Heading present - verify the four step words actually appear under it.
      const lower = executionLoopSection.toLowerCase();
      const missingSteps = stepWords.filter((s) => !lower.includes(s));
      if (missingSteps.length === 0) {
        findings.push(`${af.agent.id}: execution loop has all 4 steps`);
        executionLoop.push({
          agent: af.agent.id,
          found: true,
          sectionLabel: EXECUTION_LOOP_LABEL,
          missingSteps: [],
        });
      } else {
        findings.push(
          `${af.agent.id}: execution loop heading present but missing step words inside the section (${missingSteps.join(", ")})`,
        );
        recs.push(
          `Add READ, SCOPE, ACT, VERIFY steps under the "${EXECUTION_LOOP_LABEL}" heading in ${af.agent.instructionFile}`,
        );
        executionLoop.push({
          agent: af.agent.id,
          found: true,
          sectionLabel: EXECUTION_LOOP_LABEL,
          missingSteps,
        });
        anyFail = true;
      }
    }
    if (anyFail)
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

/** Consolidated: router-table-resolves + architecture-refs-resolve + doc-paths-resolve + architecture-exists */
function checkAllDocPaths(ctx: AuditContext) {
  let totalPaths = 0;
  let resolvedCount = 0;
  const findings: string[] = [];
  const unresolved: { ref: string; source: string }[] = [];

  const countResolvedPaths = (file: string, paths: string[]) => {
    let resolved = 0;
    const localFindings: string[] = [];
    for (const path of paths) {
      const lineRef = /^(?<file>.+\.[a-z0-9]+):\d+$/i.exec(path);
      if (lineRef?.groups?.file && ctx.fs.exists(lineRef.groups.file)) {
        localFindings.push(
          `${file}: line-number path \`${path}\` is brittle; use \`${lineRef.groups.file}\` plus a semantic anchor`,
        );
        unresolved.push({ ref: path, source: file });
        continue;
      }
      if (ctx.fs.exists(path)) resolved++;
      else {
        localFindings.push(`${file}: unresolved \`${path}\``);
        unresolved.push({ ref: path, source: file });
      }
    }
    return { resolved, findings: localFindings };
  };

  // Router tables enumerate the docs and directories the agent is expected to consult,
  // so dead entries here are a high-signal context failure.
  for (const af of ctx.agents) {
    totalPaths += af.router.paths.length;
    resolvedCount += af.router.resolved;
    if (af.router.unresolved.length > 0) {
      findings.push(
        `${af.agent.id}: ${af.router.unresolved.length} dead router paths`,
      );
      for (const ref of af.router.unresolved) {
        unresolved.push({ ref, source: af.agent.instructionFile });
      }
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
      const resolved = countResolvedPaths(".goat-flow/architecture.md", paths);
      resolvedCount += resolved.resolved;
      if (resolved.findings.length > 0) {
        findings.push(...resolved.findings);
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
    ".goat-flow/glossary.md",
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
    const resolved = countResolvedPaths(file, paths);
    resolvedCount += resolved.resolved;
    if (resolved.findings.length > 0) findings.push(...resolved.findings);
  }

  return { totalPaths, resolvedCount, findings, unresolved };
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
      ".goat-flow/footguns/docs-and-crossrefs.md",
      ".goat-flow/lessons/verification.md",
    ],
    "incident",
  ),
  /** Run the Documentation paths resolve check. */
  run: (ctx) => {
    const { totalPaths, resolvedCount, findings, unresolved } =
      checkAllDocPaths(ctx);
    const details = { docPaths: { totalPaths, resolvedCount, unresolved } };

    if (totalPaths === 0) {
      // Missing files still produce findings even when there were no path literals to inspect.
      if (findings.length > 0) {
        return fail(
          findings,
          ["Fix missing docs and add backtick-quoted file paths for drift detection"],
          undefined,
          details,
        );
      }
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
    "GEMINI.md",
    ".github/copilot-instructions.md",
  ]),
  /** Run the Instruction file required sections check. */
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    const sections: NonNullable<
      import("../types.js").HarnessCheckDetails["sections"]
    > = [];
    let anyFail = false;

    const requiredSections = getRequiredInstructionSections();
    const required = requiredSections.map((s) => s.label);
    for (const af of ctx.agents) {
      if (!af.instruction.exists || !af.instruction.content) {
        findings.push(`${af.agent.id}: no instruction file to check`);
        sections.push({
          agent: af.agent.id,
          required,
          present: [],
          missing: required,
        });
        anyFail = true;
        continue;
      }
      const content = af.instruction.content;
      const missing = requiredSections
        .filter(({ pattern }) => !pattern.test(content))
        .map(({ label }) => label);
      const present = required.filter((label) => !missing.includes(label));
      sections.push({ agent: af.agent.id, required, present, missing });
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
    if (anyFail) return fail(findings, recs, fixes, { sections });
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
    ".goat-flow/lessons/auditor-and-rubric.md",
    "CLAUDE.md",
    "AGENTS.md",
    "GEMINI.md",
    ".github/copilot-instructions.md",
  ]),
  /** Run the Workspace boundary guidance present check. */
  run: (ctx) => {
    const findings: string[] = [];
    const missing: string[] = [];
    const boundary: NonNullable<
      import("../types.js").HarnessCheckDetails["boundary"]
    > = [];

    for (const af of ctx.agents) {
      if (!af.instruction.exists || !af.instruction.content) {
        findings.push(`${af.agent.id}: no instruction file to check`);
        missing.push(`${af.agent.id} (${af.agent.instructionFile})`);
        boundary.push({
          agent: af.agent.id,
          controllingWorkspace: false,
          targetWorkspace: false,
          boundaryHeading: false,
        });
        continue;
      }
      const content = af.instruction.content;
      const controllingWorkspace = CONTROLLING_WORKSPACE_PATTERNS.some((p) =>
        p.test(content),
      );
      const targetWorkspace = TARGET_WORKSPACE_PATTERNS.some((p) =>
        p.test(content),
      );
      const boundaryHeading = BOUNDARY_HEADING_PATTERN.test(content);
      boundary.push({
        agent: af.agent.id,
        controllingWorkspace,
        targetWorkspace,
        boundaryHeading,
      });
      if (boundaryGuidancePresent(content)) {
        findings.push(
          `${af.agent.id}: instruction file distinguishes controlling workspace from selected target`,
        );
      } else {
        findings.push(
          `${af.agent.id}: instruction file has no workspace boundary guidance`,
        );
        missing.push(`${af.agent.id} (${af.agent.instructionFile})`);
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
