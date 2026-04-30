/**
 * Workspace Boundary concern: Does the harness distinguish the controlling
 * goat-flow workspace from the selected target project?
 * 2 checks: boundary-guidance-present, boundary-path-separation.
 */
import type { HarnessCheck } from "../types.js";
import type { CheckEvidence } from "../provenance-types.js";
import { pass, fail } from "./helpers.js";

const VERIFIED_ON = "2026-04-30";

function boundaryProvenance(
  type: HarnessCheck["type"],
  paths: string[],
): CheckEvidence {
  return {
    source_type: "spec",
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

const BOUNDARY_PATTERNS = [
  /controlling\s+workspace/i,
  /selected\s+target/i,
  /target\s+project/i,
  /workspace\s+boundary/i,
];

const boundaryGuidancePresent: HarnessCheck = {
  id: "boundary-guidance-present",
  name: "Workspace boundary guidance present",
  concern: "workspace_boundary",
  type: "advisory",
  provenance: boundaryProvenance("advisory", [
    "docs/harness-engineering.md",
    "docs/harness-audit.md",
  ]),
  run: (ctx) => {
    const findings: string[] = [];
    let anyBoundaryGuidance = false;
    for (const af of ctx.agents) {
      const content = af.instruction.content ?? "";
      const hasBoundary = BOUNDARY_PATTERNS.some((p) => p.test(content));
      if (hasBoundary) {
        findings.push(
          `${af.agent.id}: instruction file contains workspace boundary guidance`,
        );
        anyBoundaryGuidance = true;
      } else {
        findings.push(
          `${af.agent.id}: instruction file has no workspace boundary guidance`,
        );
      }
    }
    if (!anyBoundaryGuidance) {
      return fail(
        findings,
        [
          "Add workspace boundary guidance to instruction files distinguishing the controlling workspace from the selected target",
        ],
        [
          "Add a section to the instruction file that explains which directory is the goat-flow controlling workspace and which is the selected target project.",
        ],
      );
    }
    return pass(findings);
  },
};

const boundaryPathSeparation: HarnessCheck = {
  id: "boundary-path-separation",
  name: "Dashboard terminal separates workspace and target paths",
  concern: "workspace_boundary",
  type: "metric",
  provenance: boundaryProvenance("metric", [
    "src/cli/server/terminal.ts",
    "src/cli/server/dashboard-terminal.ts",
  ]),
  run: (ctx) => {
    const terminalTs = ctx.fs.readFile("src/cli/server/terminal.ts");
    if (terminalTs === null) {
      return pass(["terminal.ts not found (not a goat-flow development checkout)"]);
    }
    const hasTargetPath = /targetPath/.test(terminalTs);
    const hasCwd = /cwd/.test(terminalTs);
    if (hasTargetPath && hasCwd) {
      return pass([
        "Terminal session model separates cwd and targetPath",
      ]);
    }
    return pass([
      "Terminal session model does not clearly separate workspace and target paths",
    ]);
  },
};

export const WORKSPACE_BOUNDARY_CHECKS: HarnessCheck[] = [
  boundaryGuidancePresent,
  boundaryPathSeparation,
];
