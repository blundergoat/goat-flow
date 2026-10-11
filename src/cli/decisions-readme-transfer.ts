/** Recognise released decisions guides during the one-path transfer from user to system ownership. */
import type {
  ManagedSetupBaselineStatus,
  ManagedSetupPreviewFile,
} from "./managed-setup-preview.js";
import {
  readManagedTargetEvidence,
  type ManagedTargetEvidence,
} from "./managed-setup-write-set.js";

/** The sole absent-baseline ownership exception; other managed paths retain their existing rules. */
export const DECISIONS_README_PATH =
  ".goat-flow/learning-loop/decisions/README.md";
const LEGACY_GUIDE_PATH = ".goat-flow/decisions/README.md";

// SHA-256 of exact workflow/setup/reference/decisions-readme.md bytes in released Git tags.
// Deduplicated across every available release containing that template; older releases without it provide no recognition evidence.
// Runtime recognition needs neither Git nor a network connection. Unknown bytes need named-path authority for replacement.
const RELEASED_GUIDE_HASHES = new Set([
  // v1.2.4, v1.2.5, v1.3.0, v1.3.1
  "7beba601f67ca66ad30f21420dcf3f3b689d1ccd2517a4d0b4c6c78bb9c979c4",
  // v1.3.2, v1.4.0-v1.4.3, v1.5.0, v1.6.0-v1.6.4
  "21e06a539b8d186bc671d86ec9e5842bc2293bb6c1509adafee60bcf9569dd22",
  // v1.7.0, v1.8.0, v1.9.0
  "96c0cbc824c69b87f1dc8d8a74eb2726038bed7515a13e591d88ba82bf68f712",
  // v1.9.1
  "ebab7a2d496ae5eaf12d35ad4fa47a9928389757611cb57c6a77714486ce011d",
  // v1.10.0, v1.10.1
  "b9505d8bf7daf9720310ddf18da148a22a3e921d38db930d49b4b47c4e6cf6fc",
  // v1.11.0, v1.12.0, v1.12.1, v1.13.0, v1.13.1, v1.14.0
  "9619fa29d39a61d29055acd42d003c27d13772105852f92f455ec5062346836f",
  // v1.15.0, v1.15.1, v1.16.0
  "87f8a7f5db0ffc65e40ede6e601d973a1b5e1672dd974ada66a7018add30672c",
  // v1.17.0
  "76b2f239b4f80bda387c48429860a6cc3b3ca7b591e2ced174ae3207feb30b50",
]);

/**
 * Decide whether this inherited guide can refresh or must remain local until named-path adoption.
 * Missing history is not a package baseline; only a safe regular file and valid or absent history qualify.
 *
 * @param path - selected managed destination; every other path returns null
 * @param projectPath - selected project, inspected for a guide awaiting legacy-folder migration
 * @param oldHash - recorded package baseline; a present hash keeps ordinary managed-file rules
 * @param target - current destination; when missing, inspect the guide awaiting folder migration
 * @param newHash - current package hash; matching bytes and retired templates need no transfer
 * @param baselineStatus - malformed or conflicting history never gains replacement authority
 * @param namedPaths - explicit replacement targets; broad force is deliberately not an input
 * @returns transfer presentation, or null when ordinary classification owns the path
 * @throws when an inherited legacy guide cannot be read safely before migration
 */
export function readDecisionsReadmeTransfer(
  path: string,
  projectPath: string,
  oldHash: string | null,
  target: ManagedTargetEvidence,
  newHash: string | null,
  baselineStatus: ManagedSetupBaselineStatus,
  namedPaths: readonly string[],
): ManagedSetupPreviewFile | null {
  if (
    path !== DECISIONS_README_PATH ||
    oldHash !== null ||
    newHash === null ||
    !["missing", "loaded", "cutover-incompatible"].includes(baselineStatus)
  )
    return null;

  const inherited = readInheritedGuide(projectPath, target);
  // A missing guide is a fresh install; current package bytes need no transfer exception.
  if (inherited === null || inherited.sha256 === newHash) return null;
  const presentation = describeInheritedGuide(
    inherited.sha256,
    namedPaths.includes(path),
  );
  return {
    ...presentation,
    path,
    ownership: "system-owned",
    action:
      presentation.state === "local-preserved"
        ? "none"
        : target.status === "missing"
          ? "create"
          : "replace",
    reason:
      target.status === "missing"
        ? `The guide at ${LEGACY_GUIDE_PATH} will move here. ${presentation.reason}`
        : presentation.reason,
    oldExpectedSha256: oldHash,
    currentStatus: target.status,
    currentSha256: target.sha256,
    newExpectedSha256: newHash,
  };
}

/**
 * Inspect the guide before Bash moves its folder; null leaves fresh or unsafe destinations to ordinary preview handling.
 *
 * @throws when the legacy source exists but is redirected, non-regular or unreadable
 */
function readInheritedGuide(
  projectPath: string,
  target: ManagedTargetEvidence,
): ManagedTargetEvidence | null {
  if (target.status === "regular") return target;
  // Ordinary preview handling owns unsafe destinations; only an absent destination can inherit the old guide.
  if (target.status !== "missing") return null;
  const inherited = readManagedTargetEvidence(projectPath, LEGACY_GUIDE_PATH);
  if (inherited.status === "missing") return null;
  if (inherited.status !== "regular") {
    throw new Error(
      `Legacy decisions guide ${LEGACY_GUIDE_PATH} must be a safe readable regular file before installation.`,
    );
  }
  return inherited;
}

/** Keep unknown inherited bytes unless the user names this guide for replacement. */
function describeInheritedGuide(
  currentHash: string | null,
  isNamed: boolean,
): Pick<ManagedSetupPreviewFile, "state" | "reason" | "authority"> {
  if (currentHash !== null && RELEASED_GUIDE_HASHES.has(currentHash)) {
    return {
      state: "adopted",
      authority: "not-required",
      reason:
        "This inherited decisions guide exactly matches a released template. Install refreshes it and records the verified package baseline.",
    };
  }
  if (isNamed) {
    return {
      state: "adopted",
      authority: "granted-path",
      reason:
        "The named path authorizes replacing this inherited decisions guide with the current package template.",
    };
  }
  return {
    state: "local-preserved",
    authority: "not-required",
    reason: `Install keeps this inherited decisions guide without recording a package baseline. To replace it, use --force-path ${DECISIONS_README_PATH}; broad force does not adopt it.`,
  };
}
