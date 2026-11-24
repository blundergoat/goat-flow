/** Retired-file cleanup: classify each path in the shared retired table, preview its outcome, delete proven files and forget their records. */
import { readFileSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentProfiles } from "../agents/registry.js";
import {
  resolveAuthorityDecision,
  type ManagedSetupAuthority,
} from "../managed-setup-authority.js";
import type { ManagedSetupPreviewFile } from "../managed-setup-preview.js";
import type { ManagedInstallStateV2 } from "../managed-setup-state.js";
import { readManagedTargetEvidence } from "../managed-setup-write-set.js";
import type { AgentId } from "../types.js";
import {
  isUserOwnedPlaybook,
  keptRetiredFileAdvice,
  RENAMED_PLAYBOOKS,
  RETIRED_PATHS,
  RETIRED_RUNTIME_PATHS,
} from "../retired-paths.js";

/** Shown for a recorded retired path whose file is already gone. */
const ABSENT_REASON =
  "The file is already gone; install forgets its install-state record.";

/**
 * Explain a forced deletion. A retired hook file waits until no provider runs the retired hooks; a playbook goes in this install.
 *
 * @param path - retired path `--force-path` named
 * @returns the preview reason for that row
 */
function forcedReason(path: string): string {
  const timing = RETIRED_RUNTIME_PATHS.includes(path)
    ? " once no provider runs the retired hooks"
    : "";
  return `--force-path names this edited file, so install deletes it${timing}; restore it from Git history if needed.`;
}

/** A filename alone never authorizes removal: current package membership and stored hashes also participate. */
export function retiredRuntimePaths(
  packagePaths: ReadonlySet<string>,
): string[] {
  return RETIRED_RUNTIME_PATHS.filter((path) => !packagePaths.has(path));
}

export interface RuntimeRetirementFile {
  path: string;
  expectedSha256: string | null;
  canRemove: boolean;
  needsMigrationReview: boolean;
}

/** One provider config that still runs, or may run, a retired runtime file. */
export interface RetiredRuntimeReference {
  agent: AgentId;
  path: string;
}

/**
 * List provider configs that still name a retired runtime file. Unsafe or unparsable configs are listed too,
 * because unreadable JSON is not evidence that the dependency is gone.
 *
 * Error behavior: never throws; a JSON parse error is caught and reports that config as still dependent.
 *
 * @param project - selected project root whose provider configs are read
 * @param retired - retired runtime paths; only their file names are matched against decoded command strings
 * @returns each config that still depends on a retired file, in registry order; empty means none does
 */
function retiredRegistrationConfigs(
  project: string,
  retired: readonly string[],
): RetiredRuntimeReference[] {
  const names = retired.map((path) =>
    basename(path).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
  );
  // With no retired names to match, no provider can depend on one.
  if (names.length === 0) return [];
  const pattern = new RegExp(
    `(?:^|[\\s"'=\\\\/])(?:${names.join("|")})(?=$|[\\s"';|&),])`,
    "u",
  );
  return getAgentProfiles().flatMap((agent) => {
    const path = agent.hookConfigFile;
    // A provider without a hook config cannot register a runtime file.
    if (!path) return [];
    const evidence = readManagedTargetEvidence(project, path);
    // An absent config registers nothing.
    if (evidence.status === "missing") return [];
    const reference = [{ agent: agent.id, path }];
    // A linked, non-regular or unreadable config cannot be inspected safely, so it keeps its dependency.
    if (evidence.status !== "regular") return reference;
    try {
      const content: unknown = JSON.parse(
        readFileSync(join(project, path), "utf8"),
      );
      return containsRetiredRuntime(content, pattern) ? reference : [];
    } catch {
      // Malformed JSON may still run the retired file, so it keeps its dependency.
      return reference;
    }
  });
}

/**
 * List provider configs that still depend on a retired runtime file that is still on disk, whether or not the package ships it again.
 * Install uses this to leave retired files in place until the last provider moves off them.
 *
 * @param project - selected project root whose provider configs are read
 * @returns configs still depending on the retired runtime; empty means no retired file remains or every provider has moved off it
 */
export function retiredRuntimeReferences(
  project: string,
): RetiredRuntimeReference[] {
  const retired = RETIRED_RUNTIME_PATHS;
  // With no retired file left, nothing waits for cleanup; an unreadable config alone must not report a pending runtime.
  if (
    retired.every(
      (path) => readManagedTargetEvidence(project, path).status === "missing",
    )
  )
    return [];
  return retiredRegistrationConfigs(project, retired);
}

/** Inspect decoded command strings so JSON-escaped quotes cannot hide a dependency. */
function containsRetiredRuntime(value: unknown, pattern: RegExp): boolean {
  if (typeof value === "string") return pattern.test(value);
  return (
    value !== null &&
    typeof value === "object" &&
    Object.values(value).some((entry) => containsRetiredRuntime(entry, pattern))
  );
}

/** A registered runtime customization needs review before its registration or dependencies change. */
export function inspectRuntimeRetirement(
  project: string,
  expected: ReadonlyMap<string, string>,
  packagePaths: ReadonlySet<string>,
): RuntimeRetirementFile[] {
  const retired = retiredRuntimePaths(packagePaths);
  const isRegistered = retiredRegistrationConfigs(project, retired).length > 0;
  return retired.flatMap((path) => {
    const target = readManagedTargetEvidence(project, path);
    const expectedSha256 = expected.get(path) ?? null;
    if (target.status === "missing" && expectedSha256 === null) return [];
    const canRemove =
      target.status === "regular" &&
      expectedSha256 !== null &&
      target.sha256 === expectedSha256;
    return [
      {
        path,
        expectedSha256,
        canRemove,
        needsMigrationReview:
          isRegistered && target.status !== "missing" && !canRemove,
      },
    ];
  });
}

/**
 * Recheck the saved hash immediately before deleting an eligible retired file.
 *
 * @param project - selected project root containing the retired file
 * @param file - one retirement row; only a row whose current bytes still match its saved hash is deleted
 * @throws Error when any provider config still references the retired runtime, or the file changed after review; bytes are preserved
 */
export function removeRetiredRuntimeFile(
  project: string,
  file: RuntimeRetirementFile,
): void {
  const current = readManagedTargetEvidence(project, file.path);
  if (current.status === "missing") return;
  const references = retiredRuntimeReferences(project);
  // Install checks for remaining providers before calling; for other callers, such as hook sync, this guard stops a deletion that would break one.
  if (references.length > 0) {
    throw new Error(
      `Runtime migration is incomplete: ${references.map((reference) => reference.path).join(", ")} still reference the retired runtime. Its dependencies were preserved.`,
    );
  }
  if (
    !file.canRemove ||
    current.status !== "regular" ||
    current.sha256 !== file.expectedSha256
  ) {
    throw new Error(
      `Retired runtime changed before cleanup: ${file.path}. Existing bytes were preserved.`,
    );
  }
  unlinkSync(join(project, file.path));
}

/**
 * Forget retired paths whose files are gone: drop each one's row and every receipt reference to it, so later previews stop listing it.
 * Only a stale receipt can name a retired path, because a current receipt lists only paths this package ships; it stays stale.
 *
 * @param project - selected project root whose retired files are checked on disk
 * @param state - shared install state about to be written
 * @param packagePaths - paths the current package ships; a retired path shipped again is kept
 * @returns the state without those rows and references; every other row and receipt is unchanged
 */
export function forgetAbsentRetiredRows(
  project: string,
  state: ManagedInstallStateV2,
  packagePaths: ReadonlySet<string>,
): ManagedInstallStateV2 {
  const forgotten = new Set(
    RETIRED_PATHS.filter(
      (path) =>
        !packagePaths.has(path) &&
        readManagedTargetEvidence(project, path).status === "missing",
    ),
  );
  return {
    ...state,
    files: state.files.filter((row) => !forgotten.has(row.path)),
    receipts: state.receipts.map((receipt) => ({
      ...receipt,
      files: receipt.files.filter((file) => !forgotten.has(file.path)),
    })),
  };
}

/** Find the preview row for one retired path, adding a system-owned `removed` row when the baseline did not list it. */
function retirementPreviewRow(
  project: string,
  files: ManagedSetupPreviewFile[],
  path: string,
  expectedSha256: string | null,
): ManagedSetupPreviewFile {
  const existing = files.find((file) => file.path === path);
  // The baseline-only pass already listed this recorded path.
  if (existing) return existing;
  const target = readManagedTargetEvidence(project, path);
  const row: ManagedSetupPreviewFile = {
    path,
    ownership: "system-owned",
    state: "removed",
    action: "preserve",
    reason: "",
    oldExpectedSha256: expectedSha256,
    currentStatus: target.status,
    currentSha256: target.sha256,
    newExpectedSha256: null,
    authority: "not-required",
  };
  files.push(row);
  return row;
}

/**
 * Keep an edited or unrecorded retired file, unless `--force-path` names that exact path, which deletes it instead.
 * `--force-managed` alone never deletes edited bytes.
 *
 * @param row - preview row for a retired file that is on disk and not proven unedited
 * @param authority - every authority the user supplied
 * @param keptReason - what keeping the file means for the user
 */
function keepOrForceRetiredFile(
  row: ManagedSetupPreviewFile,
  authority: ManagedSetupAuthority,
  keptReason: string,
): void {
  const isNamed = authority.namedPaths.includes(row.path);
  // A linked or unreadable path is never deleted, however it is named.
  if (row.currentStatus !== "regular") {
    row.action = "preserve";
    row.authority = isNamed ? "refused-path-safety" : "not-required";
    row.reason = keptReason;
    return;
  }
  // Only the exact path authorizes deleting edited bytes.
  if (isNamed) {
    row.action = "remove";
    row.authority = "granted-path";
    row.reason = forcedReason(row.path);
    return;
  }
  row.action = "preserve";
  row.authority = "not-required";
  row.reason = keptReason;
}

/** Preview each renamed playbook: delete an unedited or forced copy, keep a linked, user-owned or edited one, forget an absent one. */
function applyRenamedPlaybookPreview(
  project: string,
  files: ManagedSetupPreviewFile[],
  expected: ReadonlyMap<string, string>,
  packagePaths: ReadonlySet<string>,
  authority: ManagedSetupAuthority,
): void {
  for (const [path, replacement] of RENAMED_PLAYBOOKS) {
    // A package that ships this path again owns it as a current template.
    if (packagePaths.has(path)) continue;
    previewOldPlaybook(
      project,
      files,
      { path, replacement, expectedSha256: expected.get(path) ?? null },
      authority,
    );
  }
}

/**
 * Add or update the preview row for one old playbook.
 *
 * @param project - selected project root
 * @param files - preview rows; the playbook's row is added or updated in place
 * @param playbook - old path, its replacement, and its recorded hash; null when no record exists
 * @param authority - every authority the user supplied
 */
function previewOldPlaybook(
  project: string,
  files: ManagedSetupPreviewFile[],
  playbook: {
    path: string;
    replacement: string;
    expectedSha256: string | null;
  },
  authority: ManagedSetupAuthority,
): void {
  const { path, replacement, expectedSha256 } = playbook;
  const target = readManagedTargetEvidence(project, path);
  // Neither a file nor a record exists, so there is nothing to show.
  if (target.status === "missing" && expectedSha256 === null) return;
  const row = retirementPreviewRow(project, files, path, expectedSha256);
  // A recorded copy that is already gone only needs its record forgotten.
  if (target.status === "missing") {
    row.action = "none";
    row.reason = ABSENT_REASON;
    return;
  }
  // Explicit user-owned frontmatter keeps the copy, and no flag overrides that.
  if (isUserOwnedTarget(project, path, target.status)) {
    row.action = "preserve";
    row.authority = authority.namedPaths.includes(path)
      ? "refused-replaceability"
      : "not-required";
    row.reason = `This playbook is marked user-owned, so install keeps it; use ${replacement}.`;
    return;
  }
  // Bytes that match the install record are the release's own copy.
  if (target.status === "regular" && target.sha256 === expectedSha256) {
    row.action = "remove";
    row.reason = `The bytes match the install record, so install deletes this old playbook after writing ${replacement}.`;
    return;
  }
  keepOrForceRetiredFile(
    row,
    authority,
    `This old playbook has edited or unrecorded bytes; ${keptRetiredFileAdvice(path, target.status === "regular")}.`,
  );
}

/** Report whether a regular old playbook's frontmatter marks it user-owned; a link or unreadable path is not inspected. */
function isUserOwnedTarget(
  project: string,
  path: string,
  status: string,
): boolean {
  return (
    status === "regular" &&
    isUserOwnedPlaybook(readFileSync(join(project, path), "utf8"))
  );
}

/**
 * Add each retired file's outcome to the public preview, so it predicts exactly what apply deletes, keeps or forgets.
 *
 * @param project - selected project root
 * @param files - preview rows built so far; retired rows are added or updated in place
 * @param expected - recorded hashes from shared or older per-agent install state
 * @param packagePaths - paths the current package ships
 * @param authority - every authority the user supplied
 */
export function applyRetirementPreview(
  project: string,
  files: ManagedSetupPreviewFile[],
  expected: ReadonlyMap<string, string>,
  packagePaths: ReadonlySet<string>,
  authority: ManagedSetupAuthority,
): void {
  for (const retired of inspectRuntimeRetirement(
    project,
    expected,
    packagePaths,
  )) {
    const row = retirementPreviewRow(
      project,
      files,
      retired.path,
      retired.expectedSha256,
    );
    // A recorded file that is already gone only needs its record forgotten.
    if (row.currentStatus === "missing") {
      row.action = "none";
      row.reason = ABSENT_REASON;
    } else if (retired.needsMigrationReview) {
      row.state = "both-changed";
      row.action = "migrate";
      row.reason =
        "A registered retired runtime has local or unclassified bytes. Review switching its registration before retiring dependencies; the local file is kept unless --force-path names it.";
      row.authority = resolveAuthorityDecision(
        {
          path: row.path,
          ownership: "system-owned",
          isConflict: true,
          isPathUnsafe: row.currentStatus !== "regular",
          isReplaceable: true,
        },
        authority,
      );
      // Naming this exact path approves the registration switch and also deletes the edited file once no provider runs the retired hooks.
      if (row.authority === "granted-path") {
        row.action = "remove";
        row.reason = forcedReason(row.path);
      }
    } else if (retired.canRemove) {
      row.action = "remove";
      row.reason =
        "Retired runtime bytes match the stored managed baseline and can be removed after registration migration.";
    } else {
      keepOrForceRetiredFile(
        row,
        authority,
        `This retired hook file has edited or unrecorded bytes; ${keptRetiredFileAdvice(row.path, row.currentStatus === "regular")}.`,
      );
    }
  }
  applyRenamedPlaybookPreview(
    project,
    files,
    expected,
    packagePaths,
    authority,
  );
}
