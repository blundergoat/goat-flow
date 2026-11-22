/** The reviewed 1.19.0 cleanup list becomes active only as its package files retire. */
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

const RETIRED_RUNTIME_NAMES = [
  "deny-dangerous.sh",
  "deny-git-mutations.sh",
  "post-turn-safety.sh",
  "gruff-code-quality.sh",
  "run-with-bash.mjs",
  "deny-dangerous/guard-runtime.sh",
  "deny-dangerous/patterns-shell.sh",
  "deny-dangerous/patterns-paths.sh",
  "deny-dangerous/patterns-writes.sh",
  "deny-dangerous/deny-dangerous-self-test.sh",
] as const;

/** A filename alone never authorizes removal: current package membership and stored hashes also participate. */
export function retiredRuntimePaths(
  packagePaths: ReadonlySet<string>,
): string[] {
  return RETIRED_RUNTIME_NAMES.map((name) => `.goat-flow/hooks/${name}`).filter(
    (path) => !packagePaths.has(path),
  );
}

export interface RuntimeRetirementFile {
  path: string;
  expectedSha256: string | null;
  canRemove: boolean;
  needsMigrationReview: boolean;
}

/** Read only regular provider configs; unsafe paths remain the normal preview's admission responsibility. */
function hasRetiredRegistration(
  project: string,
  retired: readonly string[],
): boolean {
  const names = retired.map((path) =>
    basename(path).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
  );
  if (names.length === 0) return false;
  const pattern = new RegExp(
    `(?:^|[\\s"'=\\\\/])(?:${names.join("|")})(?=$|[\\s"';|&),])`,
    "u",
  );
  for (const agent of getAgentProfiles()) {
    if (!agent.hookConfigFile) continue;
    const evidence = readManagedTargetEvidence(project, agent.hookConfigFile);
    if (evidence.status === "missing") continue;
    if (evidence.status !== "regular") return true;
    try {
      const content: unknown = JSON.parse(
        readFileSync(join(project, agent.hookConfigFile), "utf8"),
      );
      if (containsRetiredRuntime(content, pattern)) return true;
    } catch {
      return true;
    }
  }
  return false;
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
  const isRegistered = hasRetiredRegistration(project, retired);
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

/** Recheck the saved hash immediately before deleting an eligible retired file. */
export function removeRetiredRuntimeFile(
  project: string,
  file: RuntimeRetirementFile,
): void {
  const current = readManagedTargetEvidence(project, file.path);
  if (current.status === "missing") return;
  if (
    hasRetiredRegistration(
      project,
      RETIRED_RUNTIME_NAMES.map((name) => `.goat-flow/hooks/${name}`),
    )
  ) {
    throw new Error(
      "Runtime migration is incomplete: a provider still references the retired runtime. Its dependencies were preserved.",
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

/** Drop proven, now-absent orphan rows while leaving existing receipts byte-for-byte intact. */
export function retireRuntimeRows(
  project: string,
  state: ManagedInstallStateV2,
  packagePaths: ReadonlySet<string>,
): ManagedInstallStateV2 {
  const retired = new Set(retiredRuntimePaths(packagePaths));
  const referenced = new Set(
    state.receipts.flatMap((receipt) => receipt.files.map((file) => file.path)),
  );
  const files = state.files.filter(
    (row) =>
      !retired.has(row.path) ||
      referenced.has(row.path) ||
      readManagedTargetEvidence(project, row.path).status !== "missing",
  );
  return { ...state, files };
}

/** Add only the approved runtime retirements to the existing public preview. */
export function applyRuntimeRetirementPreview(
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
    let row = files.find((file) => file.path === retired.path);
    if (!row) {
      const target = readManagedTargetEvidence(project, retired.path);
      row = {
        path: retired.path,
        ownership: "system-owned",
        state: "removed",
        action: "preserve",
        reason: "",
        oldExpectedSha256: retired.expectedSha256,
        currentStatus: target.status,
        currentSha256: target.sha256,
        newExpectedSha256: null,
        authority: "not-required",
      };
      files.push(row);
    }
    if (retired.needsMigrationReview) {
      row.state = "both-changed";
      row.action = "migrate";
      row.reason =
        "A registered retired runtime has local or unclassified bytes. Review switching its registration before retiring dependencies; the local file will be preserved.";
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
    } else if (retired.canRemove) {
      row.action = "remove";
      row.reason =
        "Retired runtime bytes match the stored managed baseline and can be removed after registration migration.";
    } else {
      row.reason =
        "Retired runtime has edited or unclassified bytes; preserve the file.";
    }
  }
}
