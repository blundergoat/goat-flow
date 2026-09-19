/**
 * Label where audit evidence comes from so users can find the right source.
 *
 * Framework guidance resolves in the goat-flow package; installed project evidence resolves in the selected target.
 * Registry validation checks evidence metadata once per process and, in development, rejects stale source paths.
 */
import { existsSync } from "node:fs";
import type { ReadonlyFS } from "../types.js";
import { getTemplatePath, isPackagedInstall } from "../paths.js";
import { AGENT_CHECKS } from "./check-agent-setup.js";
import { SETUP_CHECKS } from "./check-goat-flow.js";
import { HARNESS_CHECKS } from "./harness/index.js";
import { validateProvenance, type CheckEvidence } from "./provenance-types.js";

const FRAMEWORK_EVIDENCE_PREFIXES = [
  "workflow/",
  "docs/",
  ".goat-flow/learning-loop/footguns/",
  ".goat-flow/learning-loop/lessons/",
  ".goat-flow/learning-loop/decisions/",
  ".goat-flow/skill-docs/",
  ".goat-flow/skill-docs/playbooks/",
];

const FRAMEWORK_EVIDENCE_PATHS = new Set([
  "README.md",
  ".goat-flow/architecture.md",
  ".goat-flow/code-map.md",
  ".goat-flow/glossary.md",
]);

// Classify evidence paths that describe goat-flow framework truth rather than target-project files.
function isFrameworkEvidencePath(path: string): boolean {
  return (
    FRAMEWORK_EVIDENCE_PATHS.has(path) ||
    FRAMEWORK_EVIDENCE_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

// Deduplicate strings while preserving order for stable evidence output.
function uniqueEvidencePaths(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Label evidence as framework guidance or target-project content for report links, keeping the original flat paths.
 * Merge existing labels in their original order and remove duplicates within each labelled list.
 *
 * @param provenance - check evidence to label; missing or empty evidence_paths leaves the original record untouched
 * @returns - labelled evidence with existing labels retained, or the original record when no paths need classification
 */
export function labelEvidencePathBases(
  provenance: CheckEvidence,
): CheckEvidence {
  // Missing path metadata means this check has no source links to classify.
  const paths = provenance.evidence_paths ?? [];
  // An empty path list leaves any evidence metadata already supplied by the check untouched.
  if (paths.length === 0) return provenance;

  const frameworkPaths = paths.filter(isFrameworkEvidencePath);
  const targetPaths = paths.filter((path) => !isFrameworkEvidencePath(path));
  return {
    ...provenance,
    // Add framework links only when this check cites framework files; retain any labels supplied by the check.
    ...(frameworkPaths.length > 0
      ? {
          framework_evidence_paths: uniqueEvidencePaths([
            ...(provenance.framework_evidence_paths ?? []),
            ...frameworkPaths,
          ]),
        }
      : {}),
    // Target links point users at their own project; missing prior labels simply start a new list.
    ...(targetPaths.length > 0
      ? {
          target_evidence_paths: uniqueEvidencePaths([
            ...(provenance.target_evidence_paths ?? []),
            ...targetPaths,
          ]),
        }
      : {}),
  };
}

// Process-level guard so the cross-check validation below runs at most once per process.
let provenanceValidated = false;

/**
 * Reject invalid evidence metadata before audit findings reach the user; throws with every check ID and reason.
 *
 * Development also verifies source paths; packaged installs omit that check because contributor guidance is not shipped.
 * Successful validation is reused for the rest of the process.
 *
 * @param fs - target filesystem checked before the package root in development; packaged installs do not consult it
 */
export function validateRegisteredCheckProvenance(fs: ReadonlyFS): void {
  // Later reports reuse the registry validation already completed by this process.
  if (provenanceValidated) return;
  const checks = [...SETUP_CHECKS, ...AGENT_CHECKS, ...HARNESS_CHECKS];
  const errors: string[] = [];
  // Installed packages omit some contributor guidance, so absent source files must not block their audits.
  const pathExists = isPackagedInstall()
    ? undefined
    : (evidencePath: string) =>
        fs.exists(evidencePath) || existsSync(getTemplatePath(evidencePath));
  // Validate the entire registry so the developer receives all broken evidence records in one error.
  for (const check of checks) {
    // Prefix each issue with the check ID so the developer can repair the source of the affected finding.
    for (const error of validateProvenance(check.provenance, pathExists)) {
      errors.push(`${check.id}: ${error}`);
    }
  }
  // Broken registry evidence prevents a report from presenting unsupported claims as traceable findings.
  if (errors.length > 0) {
    throw new Error(
      `Invalid audit check provenance:\n- ${errors.join("\n- ")}`,
    );
  }
  provenanceValidated = true;
}
