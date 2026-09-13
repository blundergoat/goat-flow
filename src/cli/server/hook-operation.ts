/**
 * Protects files when a user selects Sync or changes a hook on the Hooks page or CLI.
 *
 * Preparation captures the complete change before asking about replacement or acquiring shared write claims.
 * Apply keeps those claims through file verification and hook-history publication, and reports partial changes honestly.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { pathWriteClaimInspectCommand } from "../claims-command.js";
import { AUDIT_VERSION } from "../constants.js";
import {
  prepareManagedInstallStateForApply,
  readManagedSetupV2Baseline,
  recordManagedHookAfterVerification,
} from "../managed-setup-preview.js";
import {
  acquirePathWriteClaims,
  PathWriteClaimError,
  readPathWriteTargetIdentity,
  releasePathWriteClaims,
  type PathWriteClaimReleaseResult,
  type PathWriteTargetIdentity,
} from "../path-write-claim.js";
import { KNOWN_AGENT_IDS } from "../types.js";
import { projectIsAheadOfCli } from "../version-compare.js";
import {
  HookManagedInstallationError,
  type HookReplacementConflict,
} from "./hook-managed-installation.js";
import { writeFileAtomic } from "./safe-exec.js";

/** The user's action; a toggle binds its selected hook and desired choice to the review. */
export type HookChangeIntent =
  { kind: "sync" } | { kind: "toggle"; hookId: string; enabled: boolean };

/** Explicit approval of the exact replacement list; absence requests an ordinary safe change. */
export interface HookReplacementConfirmation {
  replace?: boolean;
  confirmationIdentity?: string;
}

/** One captured destination; an absent replacement means inspect and claim without changing it. */
interface HookDestination {
  path: string;
  originalIdentity: PathWriteTargetIdentity;
  originalText: string | null;
  originalMode: number;
  replacement?: string | null;
  replacementMode?: number;
  officialHash?: string;
  hookIds: Set<string>;
  priority: number;
}

const STATE_DIRECTORY = ".goat-flow/state/install/";
const STATE_PATHS = [
  `${STATE_DIRECTORY}managed.json`,
  ...KNOWN_AGENT_IDS.map((agent) => `${STATE_DIRECTORY}${agent}.json`),
];

/**
 * Hash exact captured or incoming bytes so a later request cannot silently change the user's reviewed replacement.
 */
function contentHash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Compare captured existence and bytes; an absent file cannot match a file created since review. */
function sameIdentity(
  left: PathWriteTargetIdentity,
  right: PathWriteTargetIdentity,
): boolean {
  // A user may create or delete a hook after opening confirmation, which requires a fresh review.
  if (left.state === "missing" || right.state === "missing")
    return left.state === right.state;
  return left.sha256 === right.sha256;
}

/** Compare the permissions the operating system supports; Windows chmod controls writability, while POSIX also controls execution. */
function samePermissions(actualMode: number, expectedMode: number): boolean {
  const permissionMask = process.platform === "win32" ? 0o200 : 0o777;
  return (actualMode & permissionMask) === (expectedMode & permissionMask);
}

/**
 * Explain failed claim cleanup with read-only inspection commands for the selected project.
 * Use when Sync leaves claims behind; inspection never treats a claim as abandoned or removes it.
 *
 * @param projectPath - physical project root captured before claim acquisition
 * @param message - original refusal or completed-write message retained beside recovery guidance
 *
 * @param unreleased - nonempty cleanup failures whose targets need inspection
 * @param changedPaths - files already changed; empty means no hook destination changed
 *
 * @returns a failed operation with one quoted inspection command per affected target
 */
function hookClaimReleaseFailure(
  projectPath: string,
  message: string,
  unreleased: PathWriteClaimReleaseResult[],
  changedPaths: string[],
): HookManagedInstallationError {
  const paths = unreleased.map((result) => result.targetPath);
  return new HookManagedInstallationError(
    `${message} Some write claims could not be released; inspect them before retrying.`,
    500,
    {
      code: "hook-claim-release-failed",
      paths,
      hookIds: [],
      replacementAvailable: false,
      changedPaths,
      recovery: [
        "Inspect these write claims before retrying:",
        ...paths.map((path) => pathWriteClaimInspectCommand(projectPath, path)),
      ].join("\n"),
    },
  );
}

/** Translate unsafe paths and competing writes into a repairable refusal without exposing file contents. */
function refusedHookChange(error: unknown): HookManagedInstallationError {
  // A structured hook conflict already explains the decision the user can make.
  if (error instanceof HookManagedInstallationError) {
    return error.details
      ? error
      : new HookManagedInstallationError(error.message, error.statusCode, {
          code: "hook-change-refused",
          paths: [],
          hookIds: [],
          replacementAvailable: false,
        });
  }
  // Another installer or a linked destination must stop Sync before it changes a project file.
  if (error instanceof PathWriteClaimError) {
    return new HookManagedInstallationError(error.message, 409, {
      code: "hook-change-refused",
      paths: [error.targetPath],
      hookIds: [],
      replacementAvailable: false,
    });
  }
  return new HookManagedInstallationError(
    "Hook changes could not be prepared. Repair the project hook configuration and install-state evidence, then retry.",
    409,
    {
      code: "hook-change-refused",
      paths: [],
      hookIds: [],
      replacementAvailable: false,
    },
  );
}

/**
 * Holds the exact files and choices behind one Sync or Enable/Disable request.
 *
 * The registrar prepares this plan entirely in memory so a late invalid file cannot follow an earlier write.
 * Missing history permits identical or missing official files; differing files require a matching replacement review.
 */
export class PreparedHookChange {
  readonly projectPath: string;
  readonly destinations = new Map<string, HookDestination>();
  readonly baseline: ReturnType<typeof readManagedSetupV2Baseline>;

  /**
   * Capture the selected project's complete shared history before preparing any writes.
   * Every provider marker participates in review identity; invalid history throws and requires install recovery.
   *
   * @param projectPath - selected project; missing or inaccessible roots refuse the action
   * @param intent - requested sync or explicit toggle, included in replacement confirmation
   */
  constructor(
    projectPath: string,
    readonly intent: HookChangeIntent,
  ) {
    this.projectPath = realpathSync(projectPath);
    // Every agent's marker matters even when the user is syncing a different provider.
    for (const path of STATE_PATHS) this.capture(path);
    this.baseline = readManagedSetupV2Baseline(this.projectPath);
    // A broken or interrupted history needs public-install recovery, never a replacement override.
    if (
      this.baseline.status !== "missing" &&
      this.baseline.status !== "loaded"
    ) {
      throw new HookManagedInstallationError(
        `${this.baseline.error ?? "Managed install history is unavailable."} Repair install-state evidence with goat-flow install before syncing hooks.`,
        409,
        {
          code: "hook-change-refused",
          paths: STATE_PATHS,
          hookIds: [],
          replacementAvailable: false,
        },
      );
    }
  }

  /**
   * Capture a safe file's bytes and permissions for the user's pending hook action.
   * Missing files remain create-only targets; unsafe paths, unreadable bytes or an intervening edit throw before apply.
   *
   * @param path - registry-derived project-relative destination; empty or escaping paths are rejected
   * @returns captured bytes and permissions; null text means no file currently exists
   */
  private capture(path: string): HookDestination {
    const captured = this.destinations.get(path);
    // Several hooks share a runtime file, so they must share one original snapshot too.
    if (captured) return captured;
    const originalIdentity = readPathWriteTargetIdentity(
      this.projectPath,
      path,
    );
    const originalBytes =
      originalIdentity.state === "present"
        ? readFileSync(join(this.projectPath, path))
        : null;
    const originalText = originalBytes?.toString("utf-8") ?? null;
    // An editor save during preparation invalidates this snapshot before it can become replacement authority.
    if (
      originalBytes !== null &&
      (originalIdentity.state !== "present" ||
        contentHash(originalBytes) !== originalIdentity.sha256)
    ) {
      throw new HookManagedInstallationError(
        `Hook file changed while preparing sync: ${path}. Retry to review its current bytes.`,
        409,
      );
    }
    const destination: HookDestination = {
      path,
      originalIdentity,
      originalText,
      originalMode:
        originalText === null
          ? 0o600
          : lstatSync(join(this.projectPath, path)).mode & 0o777,
      hookIds: new Set(),
      priority: 1,
    };
    this.destinations.set(path, destination);
    return destination;
  }

  /**
   * Read the prepared text so successive provider changes compose without rereading the project.
   *
   * @param path - admitted project-relative config or hook path
   * @returns latest prepared text; null means missing or scheduled for removal
   */
  readText(path: string): string | null {
    const destination = this.capture(path);
    return destination.replacement === undefined
      ? destination.originalText
      : destination.replacement;
  }

  /**
   * Queue a complete config or ignore file; no disk change occurs during preparation.
   *
   * @param path - registry-derived destination
   *
   * @param text - complete replacement; an empty string intentionally keeps an empty file
   * @param priority - lower values publish first; provider registrations precede runnable files
   */
  replaceText(path: string, text: string, priority = 1): void {
    const destination = this.capture(path);
    destination.replacement = text;
    destination.priority = priority;
  }

  /**
   * Queue bundled bytes for an enabled hook, or fill missing dependencies for a disabled hook.
   * Existing disabled-only files stay untouched; a newer installed version throws even when replacement was approved.
   *
   * @param path - managed hook destination
   * @param text - exact bundled script bytes decoded as UTF-8
   *
   * @param hookIds - every hook sharing the file, for the user's replacement list
   * @param isEnabled - an enabled owner requires current bytes; false only fills a missing file
   */
  copyOfficial(
    path: string,
    text: string,
    hookIds: readonly string[],
    isEnabled: boolean,
  ): void {
    const destination = this.capture(path);
    // Shared repair affects every owning row, including a sibling the user did not toggle.
    for (const hookId of hookIds) destination.hookIds.add(hookId);
    // Disabling removes execution authority while preserving the user's existing inert edits.
    if (!isEnabled && destination.originalText !== null) return;
    const installedVersion = destination.originalText?.match(
      /goat-flow-hook-version:\s*([0-9]+\.[0-9]+\.[0-9]+)/u,
    )?.[1];
    // An older CLI must never downgrade a newer guard, even after the user confirms replacement.
    if (
      installedVersion &&
      projectIsAheadOfCli(installedVersion, AUDIT_VERSION)
    ) {
      throw new HookManagedInstallationError(
        `Refusing to overwrite ${path}: the installed hook is newer than this CLI (${AUDIT_VERSION}). Re-run with a matching goat-flow release.`,
        409,
        {
          code: "hook-change-refused",
          paths: [path],
          hookIds: [...destination.hookIds].sort(),
          replacementAvailable: false,
        },
      );
    }
    destination.replacement = text;
    destination.officialHash = contentHash(text);
    destination.replacementMode = 0o755;
    destination.priority = 2;
  }

  /**
   * Queue an exact owned legacy file for removal after current hooks are ready.
   *
   * @param path - one registry-owned retired file; missing files remain successful no-ops
   */
  removeOwned(path: string): void {
    const destination = this.capture(path);
    destination.replacement = null;
    destination.priority = 3;
  }

  /** Return stable ordering so equivalent Sync reviews produce the same confirmation identity. */
  sortedDestinations(): HookDestination[] {
    return [...this.destinations.values()].sort((left, right) =>
      Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
    );
  }

  /**
   * Bind the user's review to the project, action, complete destination set, permissions and incoming bundle.
   * Equivalent sorted evidence yields the same identity; any relevant change requires a fresh review.
   */
  confirmationIdentity(): string {
    return contentHash(
      JSON.stringify({
        project: this.projectPath,
        version: AUDIT_VERSION,
        intent: this.intent,
        destinations: this.sortedDestinations().map((destination) => ({
          path: destination.path,
          original: destination.originalIdentity,
          mode: destination.originalMode,
          replacement:
            destination.replacement === undefined
              ? "preserve"
              : destination.replacement === null
                ? "remove"
                : contentHash(destination.replacement),
          officialHash: destination.officialHash,
          replacementMode: destination.replacementMode,
          hookIds: [...destination.hookIds].sort(),
          priority: destination.priority,
        })),
      }),
    );
  }

  /**
   * List bundled replacements that would discard differing local bytes without matching pristine history.
   * Missing or identical files need no review; absent baseline rows keep differing bytes explicitly unclassified.
   */
  replacementConflicts(): HookReplacementConflict[] {
    return this.sortedDestinations().flatMap((destination) => {
      // Missing and byte-identical files can be safely installed or adopted without a replacement prompt.
      if (
        !destination.officialHash ||
        destination.originalIdentity.state === "missing" ||
        destination.originalIdentity.sha256 === destination.officialHash
      )
        return [];
      const expectedHash = this.baseline.facade.expectedHashes.get(
        destination.path,
      );
      // A pristine prior package file can advance to this bundle without erasing a local edit.
      if (expectedHash === destination.originalIdentity.sha256) return [];
      return [
        {
          path: destination.path,
          hookIds: [...destination.hookIds].sort(),
          reason:
            expectedHash === undefined
              ? ("unclassified" as const)
              : ("diverged" as const),
        },
      ];
    });
  }

  /**
   * Require exact replacement approval before discarding differing local hook bytes.
   * A supplied stale identity also refuses when the current conflict list is empty, so old approval cannot authorize a new action.
   *
   * @param confirmation - reviewed identity and replacement intent; empty means an ordinary safe request
   * @throws a structured conflict before any destination changes
   */
  assertReplacementApproved(confirmation: HookReplacementConfirmation): void {
    const identity = this.confirmationIdentity();
    const conflicts = this.replacementConflicts();
    const hasConfirmation =
      confirmation.replace !== undefined ||
      confirmation.confirmationIdentity !== undefined;
    const matchesReview =
      confirmation.replace === true &&
      confirmation.confirmationIdentity === identity;
    // Confirmation is valid only for the same files and action; a now-empty conflict list cannot revive an old review.
    if (
      (hasConfirmation && !matchesReview) ||
      (conflicts.length > 0 && !matchesReview)
    ) {
      const isStale = hasConfirmation;
      throw new HookManagedInstallationError(
        isStale
          ? "Hook files or choices changed since review. Review the current files before trying again."
          : `Refusing to sync ${conflicts.every((conflict) => conflict.reason === "diverged") ? "diverged" : "unclassified or diverged"} managed hook files. Use the dashboard Hooks page to review and explicitly replace them with official files.`,
        409,
        {
          code: isStale ? "hook-review-stale" : "hook-replacement-required",
          paths: conflicts.map((conflict) => conflict.path),
          hookIds: [
            ...new Set(conflicts.flatMap((conflict) => conflict.hookIds)),
          ].sort(),
          replacementAvailable: conflicts.length > 0,
          confirmationIdentity: identity,
          conflicts,
        },
      );
    }
  }

  /**
   * List changed destinations after a failed hook action, including partial history bootstrap.
   * Unreadable targets are included for inspection; filesystem errors are caught so recovery can still identify their paths.
   */
  changedPaths(): string[] {
    return this.sortedDestinations()
      .filter((destination) => {
        try {
          const current = readPathWriteTargetIdentity(
            this.projectPath,
            destination.path,
          );
          return (
            !sameIdentity(current, destination.originalIdentity) ||
            (current.state === "present" &&
              (lstatSync(join(this.projectPath, destination.path)).mode &
                0o777) !==
                destination.originalMode)
          );
        } catch {
          // A removed parent or unreadable file after Sync began needs inspection, so include its path in recovery.
          return true;
        }
      })
      .map((destination) => destination.path);
  }

  /**
   * Apply the reviewed files under claims, then publish only verified hook dependencies.
   * I/O or publication failures throw a structured error with the changed paths and repair steps.
   */
  apply(): void {
    const officialFiles = this.sortedDestinations().flatMap((destination) =>
      destination.officialHash
        ? [{ path: destination.path, expectedSha256: destination.officialHash }]
        : [],
    );
    let phase = "preparing install-state";
    try {
      // First sync may need legacy cutover; already-valid v2 markers are not rewritten.
      if (officialFiles.length > 0 && this.baseline.facade.source !== "v2")
        prepareManagedInstallStateForApply(this.projectPath);
      const stateIdentities = STATE_PATHS.map((path) => ({
        path,
        identity: readPathWriteTargetIdentity(this.projectPath, path),
      }));
      phase = "applying hook files";
      const ordered = this.sortedDestinations().sort(
        (left, right) => left.priority - right.priority,
      );
      // Provider registrations become safe before narrower runtime policies can replace older scripts.
      for (const destination of ordered) this.applyDestination(destination);
      phase = "verifying hook files";
      // Every queued file must match its prepared result before any successful history is published.
      for (const destination of ordered) this.verifyDestination(destination);
      phase = "recording verified hook history";
      // A changed marker or baseline must be repaired before Sync can publish history over it.
      for (const state of stateIdentities) {
        // An external edit to install history during apply must block publication of a new verified baseline.
        if (
          !sameIdentity(
            state.identity,
            readPathWriteTargetIdentity(this.projectPath, state.path),
          )
        ) {
          throw new Error("Install-state changed during hook apply.");
        }
      }
      // A disable that preserves all existing files has no new official bytes to record.
      if (officialFiles.length > 0)
        recordManagedHookAfterVerification(this.projectPath, officialFiles);
    } catch {
      // A read-only directory or failed atomic rename can leave earlier files applied; retain that evidence for retry.
      const changedPaths = this.changedPaths();
      throw new HookManagedInstallationError(
        `Hook changes failed while ${phase}. ${changedPaths.length > 0 ? "Some files changed; inspect the listed paths." : "No admitted destination changes were detected."} Repair the filesystem or install-state problem, then retry Sync.`,
        500,
        {
          code: "hook-apply-failed",
          paths: changedPaths,
          hookIds: [],
          replacementAvailable: false,
          changedPaths,
          recovery:
            "Inspect changed paths. Repair filesystem access; use goat-flow install for incomplete cutover, then retry hook sync.",
        },
      );
    }
  }

  /**
   * Publish one queued file while its original identity still matches the selected project.
   * An intervening edit or filesystem failure throws so the caller reports a partial operation instead of success.
   */
  private applyDestination(destination: HookDestination): void {
    // Read-only evidence and state checkpoints have no ordinary file replacement.
    if (destination.replacement === undefined) return;
    const current = readPathWriteTargetIdentity(
      this.projectPath,
      destination.path,
    );
    // An external save after admission must not be silently replaced by the queued bytes.
    if (!sameIdentity(current, destination.originalIdentity))
      throw new Error("Hook destination changed during apply.");
    const absolutePath = join(this.projectPath, destination.path);
    // Retired files are removed by exact name; other errors remain visible as partial apply.
    if (destination.replacement === null) {
      // An already absent retired file needs no deletion during the user's retry.
      if (current.state === "present") unlinkSync(absolutePath);
      return;
    }
    const mode = destination.replacementMode ?? destination.originalMode;
    // A healthy Sync keeps identical bytes and permissions in place.
    if (
      current.state === "present" &&
      current.sha256 === contentHash(destination.replacement) &&
      samePermissions(mode, destination.originalMode)
    )
      return;
    writeFileAtomic(
      absolutePath,
      destination.replacement,
      this.projectPath,
      mode,
    );
    // A restrictive user umask must not leave the newly synced launcher without its required executable permissions.
    chmodSync(absolutePath, mode);
  }

  /**
   * Check that the selected project's file now has the prepared bytes and permissions, or is absent after removal.
   * A mismatch throws before hook-history publication can claim the change succeeded.
   */
  private verifyDestination(destination: HookDestination): void {
    // Captured choices and canonical-state snapshots are checked separately from copied files.
    if (destination.replacement === undefined) return;
    const expected: PathWriteTargetIdentity =
      destination.replacement === null
        ? { state: "missing" }
        : { state: "present", sha256: contentHash(destination.replacement) };
    // A failed copy or newly changed file cannot count as a verified hook installation.
    const current = readPathWriteTargetIdentity(
      this.projectPath,
      destination.path,
    );
    const expectedMode =
      destination.replacementMode ?? destination.originalMode;
    // Correct bytes without executable permissions still leave the user's hook unable to run.
    const permissionsMatch =
      current.state === "missing" ||
      samePermissions(
        lstatSync(join(this.projectPath, destination.path)).mode,
        expectedMode,
      );
    // A changed byte or permission result means Sync cannot report this file as successfully repaired.
    if (!sameIdentity(expected, current) || !permissionsMatch) {
      throw new Error("Prepared hook result could not be verified.");
    }
  }
}

/**
 * Claim every reviewed destination before Sync writes, retaining the selected root for recovery if partial acquisition cannot unwind.
 * Throws the original admission failure unless cleanup itself needs the user's inspection.
 *
 * @param change - complete reviewed destination inventory for one selected project
 * @returns held claims to release after verification; acquisition failure never returns a partial batch
 */
function acquireHookChangeClaims(change: PreparedHookChange) {
  try {
    return acquirePathWriteClaims(
      change.projectPath,
      change.sortedDestinations().map((destination) => ({
        targetPath: destination.path,
        expectedIdentity: destination.originalIdentity,
      })),
    );
  } catch (error) {
    // A competing installer can refuse admission after earlier claims were created; denied deletion then leaves those claims to inspect.
    if (error instanceof PathWriteClaimError) {
      const unreleased = error.cleanupResults.filter(
        (result) => result.status !== "released",
      );
      // No hook files changed during admission, but failed cleanup still blocks the user's next attempt.
      if (unreleased.length > 0)
        throw hookClaimReleaseFailure(
          change.projectPath,
          error.message,
          unreleased,
          [],
        );
    }
    throw error;
  }
}

/**
 * Run Sync or a toggle under the same cooperative write claims as public install.
 * Rebuild under claims before writing; thrown failures retain repair details, including any claims that could not be released.
 *
 * @param prepare - server-owned inventory builder, rerun under claims before any destination write
 * @param confirmation - exact replacement approval; omitted for safe CLI or initial dashboard requests
 */
export function executeHookChange(
  prepare: () => PreparedHookChange,
  confirmation: HookReplacementConfirmation = {},
): void {
  let reviewed: PreparedHookChange;
  let claims: ReturnType<typeof acquirePathWriteClaims>;
  try {
    reviewed = prepare();
    reviewed.assertReplacementApproved(confirmation);
    claims = acquireHookChangeClaims(reviewed);
  } catch (error) {
    // An invalid provider file or another active installer refuses before Sync reaches its first write.
    throw refusedHookChange(error);
  }
  let failure: HookManagedInstallationError | undefined;
  try {
    const admitted = prepare();
    // Rebuilding under claims catches changed choices, provider selection, or package bytes before apply.
    if (admitted.confirmationIdentity() !== reviewed.confirmationIdentity()) {
      throw new HookManagedInstallationError(
        "Hook files or choices changed during admission. Retry to review current files.",
        409,
        {
          code: "hook-review-stale",
          paths: [],
          hookIds: [],
          replacementAvailable: false,
        },
      );
    }
    admitted.assertReplacementApproved(confirmation);
    admitted.apply();
  } catch (error) {
    // A late edit or I/O failure keeps its specific refusal or partial-change result for the user.
    failure = refusedHookChange(error);
  } finally {
    const unreleased = releasePathWriteClaims(claims).filter(
      (result) => result.status !== "released",
    );
    // Changed ownership must be reported; clearing another writer's marker would weaken the protection.
    if (unreleased.length > 0) {
      failure = hookClaimReleaseFailure(
        reviewed.projectPath,
        failure?.message ?? "Hook files were applied.",
        unreleased,
        reviewed.changedPaths(),
      );
    }
  }
  // Any failed admission, apply, or release keeps the dashboard from displaying a success toast.
  if (failure) throw failure;
}
