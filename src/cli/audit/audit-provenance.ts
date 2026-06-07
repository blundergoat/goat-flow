/**
 * Provenance helpers for audit checks. Two jobs live here: classifying a check's evidence paths into
 * framework-truth versus target-project buckets (so renderers can label where evidence came from),
 * and validating, once per process, that every registered check's provenance still resolves on disk.
 * The framework/target split exists because goat-flow audits a target project but its own docs are
 * the canonical truth for some checks; the two must not be conflated in evidence output.
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

/** Classify evidence paths that describe goat-flow framework truth rather than target-project files. */
function isFrameworkEvidencePath(path: string): boolean {
  return (
    FRAMEWORK_EVIDENCE_PATHS.has(path) ||
    FRAMEWORK_EVIDENCE_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

/** Deduplicate strings while preserving order for stable evidence output. */
function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Add explicit framework/target path-base labels to a check's evidence while preserving the legacy
 * flat `evidence_paths`. Each path is classified by prefix and folded into `framework_evidence_paths`
 * or `target_evidence_paths`; duplicates are dropped but original order is preserved. Returns the
 * input untouched when there are no evidence paths, so callers can apply it unconditionally.
 *
 * @param provenance - a check's evidence record; its `evidence_paths` are split, existing labelled
 *   arrays are merged with the newly classified paths rather than overwritten
 * @returns the same evidence with framework/target arrays added; the original object when no paths exist
 */
export function labelEvidencePathBases(
  provenance: CheckEvidence,
): CheckEvidence {
  const paths = provenance.evidence_paths ?? [];
  if (paths.length === 0) return provenance;

  const frameworkPaths = paths.filter(isFrameworkEvidencePath);
  const targetPaths = paths.filter((path) => !isFrameworkEvidencePath(path));
  return {
    ...provenance,
    ...(frameworkPaths.length > 0
      ? {
          framework_evidence_paths: unique([
            ...(provenance.framework_evidence_paths ?? []),
            ...frameworkPaths,
          ]),
        }
      : {}),
    ...(targetPaths.length > 0
      ? {
          target_evidence_paths: unique([
            ...(provenance.target_evidence_paths ?? []),
            ...targetPaths,
          ]),
        }
      : {}),
  };
}

/** Process-level guard so the cross-check validation below runs at most once per process. */
let provenanceValidated = false;

/**
 * Validate provenance on every registered check against the target project or package root.
 *
 * In packaged installs, `evidence_paths` pointing at framework-repo docs
 * (`.goat-flow/learning-loop/footguns/*`, `.goat-flow/learning-loop/lessons/*`, `docs/*`) can't be
 * resolved because those files aren't in `package.json` `files`. Skip the
 * existence check there - the paths are human-readable pointers for future
 * maintainers, not runtime contracts. In dev mode we keep the check so
 * stale provenance surfaces in preflight.
 *
 * Throws an Error listing every offending `checkId: reason` when any registered check's provenance
 * is invalid (in dev, that includes evidence paths that resolve neither in the target FS nor in the
 * template root). Runs at most once per process and is a no-op on subsequent calls.
 *
 * @param fs - readonly FS for the target project; used in dev mode to existence-test evidence paths
 *   before falling back to the packaged template root, and ignored entirely in packaged installs
 */
export function validateRegisteredCheckProvenance(fs: ReadonlyFS): void {
  if (provenanceValidated) return;
  const checks = [...SETUP_CHECKS, ...AGENT_CHECKS, ...HARNESS_CHECKS];
  const errors: string[] = [];
  const pathExists = isPackagedInstall()
    ? undefined
    : (p: string) => fs.exists(p) || existsSync(getTemplatePath(p));
  for (const check of checks) {
    for (const error of validateProvenance(check.provenance, pathExists)) {
      errors.push(`${check.id}: ${error}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Invalid audit check provenance:\n- ${errors.join("\n- ")}`,
    );
  }
  provenanceValidated = true;
}
