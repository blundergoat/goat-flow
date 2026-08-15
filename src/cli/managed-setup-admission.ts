/**
 * Decides whether an install may start, and explains the refusal when it may not.
 * Admission is the last gate before Bash runs, so every refusal here names the exact paths and
 * the narrowest authority that would clear them. Path safety is decided from filesystem evidence
 * and is deliberately unreachable by any flag combination.
 */
import { unmatchedAuthorityPaths } from "./managed-setup-authority.js";
import type { ManagedSetupAuthority } from "./managed-setup-authority.js";
import {
  isBlockingManagedFile,
  type ManagedSetupPreview,
} from "./managed-setup-preview.js";

/**
 * Return concise conflict rows for the normal install error shown before any mutation.
 *
 * @param preview - managed report to summarize; no blocking files yields an empty list
 * @returns user-facing conflict lines; empty means the managed admission gate can proceed
 */
function managedSetupBlockingSummary(preview: ManagedSetupPreview): string[] {
  // Only states requiring user intent belong in the blocking error.
  const blockingFiles = preview.files.filter(isBlockingManagedFile);
  // Each path stays on one line so users can inspect or copy it directly.
  const lines = blockingFiles.map(
    (file) => `${file.path} [${file.state}]: ${file.reason}`,
  );
  // Invalid state may block without producing a path-specific classification row.
  if (preview.baselineStatus === "invalid") {
    lines.push(
      "Install state is invalid; inspect the preview limits for repair evidence.",
    );
  }
  return lines;
}

/**
 * Detect target paths that cannot safely receive any managed write.
 * Use before honoring force so explicit conflict replacement never becomes path redirection.
 */
function hasUnsafeManagedTarget(preview: ManagedSetupPreview): boolean {
  // Only current templates can be written; retired unsafe paths remain preserved without installer access.
  return preview.files.some(
    (file) =>
      file.newExpectedSha256 !== null &&
      (file.currentStatus === "non-regular" ||
        file.currentStatus === "unreadable"),
  );
}

/** Explain why one named path authorized nothing, so the user knows which flag is missing. */
function unmatchedPathReason(
  preview: ManagedSetupPreview,
  namedPath: string,
): string {
  const row = preview.files.find((file) => file.path === namedPath);
  // A path absent from the write set is a typo or belongs to another agent's mirror.
  if (!row) return "--force-path names no path in this preview.";
  // Naming a user-owned path is the common near-miss: the second authority is missing.
  if (row.ownership === "user-owned") {
    return "--force-path names a user-owned file; add --force-user-owned to replace it.";
  }
  return "--force-path names no conflict in this preview; this path needs no authority.";
}

/** List paths whose rows the supplied authority actually granted, for name matching. */
function admittedAuthorityPaths(preview: ManagedSetupPreview): string[] {
  return preview.files
    .filter(
      (file) =>
        file.authority === "granted-path" ||
        file.authority === "granted-user-owned",
    )
    .map((file) => file.path);
}

/**
 * Return a complete pre-write error when the supplied authority does not admit every conflict.
 * A conflict the user never authorized, a named path that matches no admitted row, and any
 * unsafe destination each stop the install before the first byte changes.
 *
 * @param preview - current managed report already resolved against the same authority
 * @param authority - every authority the user supplied; the empty authority admits nothing
 * @returns error text for the CLI, or null when the installer may proceed
 */
export function managedSetupAdmissionFailure(
  preview: ManagedSetupPreview,
  authority: ManagedSetupAuthority,
): string | null {
  const unsafeManagedTarget =
    preview.baselineStatus === "invalid" || hasUnsafeManagedTarget(preview);
  // A named path that matched nothing is a typo or stale instruction, never a silent no-op.
  const unmatchedPaths = unmatchedAuthorityPaths(
    authority,
    admittedAuthorityPaths(preview),
  );
  if (unmatchedPaths.length > 0) {
    return `Managed setup blocked before changes:\n${unmatchedPaths
      .map((path) => `  - ${path}: ${unmatchedPathReason(preview, path)}`)
      .join("\n")}\nRun with --dry-run for the full report.`;
  }
  // Every remaining conflict must carry its own grant before Bash may start.
  const withheldFiles = preview.files.filter(
    (file) => file.authority === "withheld",
  );
  // A ready or warning preview with nothing withheld needs no override.
  if (preview.verdict !== "blocked") return null;
  if (withheldFiles.length === 0 && !unsafeManagedTarget) return null;
  // Every conflict stays on its own bullet so the user can inspect the exact paths first.
  const conflicts = managedSetupBlockingSummary(preview)
    .map((line) => `  - ${line}`)
    .join("\n");
  const nextAction = unsafeManagedTarget
    ? "Repair symlinked, non-regular, or unreadable target paths first; no authority bypasses path safety."
    : "Authorize each conflict with --force-path <path>, or all of them with --force-managed.";
  return `Managed setup blocked before changes:\n${conflicts}\nRun with --dry-run for the full report. ${nextAction}`;
}
