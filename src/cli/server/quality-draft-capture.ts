/**
 * Own quality-report persistence when a Claude reporting agent stages a draft (ADR-044).
 * Repeated size/mtime observations protect changing files on WSL2 and network filesystems.
 * Filesystem claims serialize server processes; shutdown touches only claims this process owns.
 */
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { persistQualityReportText } from "../quality/quality-command.js";
import { recordEvidenceEvent } from "../evidence/envelope.js";
import type { EvidencePayload } from "../evidence/envelope.js";
import { redactEvidenceText } from "../evidence/redaction.js";
import {
  acquireQualityDraftClaim,
  isQualityDraftClaimOwned,
  qualityDraftNameFromOwnershipMarker,
  refreshQualityDraftClaim,
  rejectStaleQualityDraftClaim,
  releaseQualityDraftClaim,
} from "./quality-draft-claims.js";
import type { QualityDraftClaim } from "./quality-draft-claims.js";
import {
  assertQualityCaptureReceiptAvailable,
  hasValidTerminalQualityReceipt,
  replaceUnsafeQualityReceiptWithRejection,
  writeQualityCaptureReceipt,
} from "./quality-draft-receipts.js";
import type { QualityCaptureReceipt } from "./quality-draft-receipts.js";
import { ensureQualityDraftStagingDirectory } from "./quality-draft-staging.js";

export { ensureQualityDraftStagingDirectory } from "./quality-draft-staging.js";

/** Draft filenames the poller will process; anything else in staging is ignored. */
const DRAFT_NAME_PATTERN = /^goat-quality-draft-[A-Za-z0-9_-]{1,64}\.json$/u;
/** Reject drafts larger than this; a valid report is far smaller. */
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
/** Default poll cadence and required mtime quiet period before processing. */
const DEFAULT_INTERVAL_MS = 750;
const DEFAULT_STABLE_MS = 500;
/** Claims older than this are rejected instead of replayed after an owner crash. */
const DEFAULT_CLAIM_STALE_MS = 5 * 60 * 1000;

/**
 * Translate shared quality-save failures into capture outcomes the reporting agent can read.
 * Use only inside the dashboard-owned persistence path; the exit code preserves CLI parity.
 * The error message is later reduced to a bounded, secret-free receipt diagnostic.
 */
class QualityCaptureError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = "QualityCaptureError";
  }
}

/**
 * Public acquisition contract for one project-owned quality staging directory.
 * The resolved project root is the sharing key, so every holder uses the same owner boundary.
 */
export interface QualityDraftCaptureOptions {
  /** Report owner project root whose staging directory is watched. */
  projectRoot: string;
  /** Poll cadence override; tests use short intervals. */
  intervalMs?: number;
  /** Required mtime quiet period before a draft is read; zero disables the gate. */
  stableMs?: number;
  /** Claim age after which a crashed owner is rejected; tests use zero for stale fixtures. */
  claimStaleMs?: number;
}

/**
 * Live capture handle held by exactly one terminal session.
 * Invariant: each handle releases one root holder, and repeated disposal cannot release a sibling.
 */
export interface QualityDraftCapture {
  /** Absolute staging directory this capture watches. */
  stagingDir: string;
  /**
   * Release this session's hold; safe to call more than once.
   * The poller keeps running until every in-process holder releases it.
   * Teardown never removes unowned shared drafts, so another server process keeps its pending state.
   */
  dispose(): void;
  /** Process eligible drafts immediately; exposed for deterministic tests. */
  processNow(): Promise<void>;
}

/** The one poller per project root that every holder on that root shares. */
interface RootCapture {
  stagingDir: string;
  /** Process every currently eligible draft while preserving single-poller ordering. */
  processNow(): Promise<void>;
  /** Stop polling and clean only claims this process can prove it owns. */
  shutdown(): void;
}

/**
 * Live pollers keyed by resolved project root.
 *
 * Module-level because the staging directory is contended per root across all
 * dashboard sessions in this server process, not per session.
 */
const rootCaptures = new Map<
  string,
  { capture: RootCapture; holders: number }
>();

/** Map persistence failures to bounded diagnostics that cannot quote draft text. */
function captureRejectionDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("quality save: expected one JSON report")) {
    return "quality capture: draft contains no JSON report.";
  }
  if (message.startsWith("quality save: invalid JSON")) {
    return "quality capture: draft contains invalid JSON.";
  }
  if (message.startsWith("quality save: schema error:")) {
    return "quality capture: draft failed schema validation.";
  }
  if (message.includes("report.project_path")) {
    return "quality capture: draft failed report ownership validation.";
  }
  if (message.startsWith("quality save: report version")) {
    return "quality capture: draft failed report version validation.";
  }
  return "quality capture: draft could not be persisted.";
}

/** Delete one draft, swallowing unlink errors as the safe fallback when dispose and processing race. */
function removeDraft(stagingDir: string, draftName: string): void {
  try {
    unlinkSync(join(stagingDir, draftName));
  } catch {
    /* already gone */
  }
}

/** Shared paths and timing used while one root poller processes drafts. */
interface RootCaptureContext {
  projectRoot: string;
  stagingDir: string;
  stableMs: number;
  claimStaleMs: number;
}
/** Mutable poller state shared by direct calls, timer polls, and finalization. */
interface RootCaptureState {
  isDisposed: boolean;
  isBusy: boolean;
  observations: Map<string, DraftObservation>;
  ownedClaims: Map<string, QualityDraftClaim>;
}

/** Size and mtime pair used to prove one candidate stayed unchanged across polls. */
interface DraftObservation {
  mtimeMs: number;
  size: number;
}
/** Eligible draft metadata captured before receipt reservation and content reads. */
interface StableDraft extends DraftObservation {
  path: string;
}

/** Record one bounded capture event; recorder failures use a silent fallback so persistence survives. */
function recordCaptureEvent(
  context: RootCaptureContext,
  eventType: "quality.persisted" | "quality.rejected",
  payload: EvidencePayload,
): void {
  try {
    recordEvidenceEvent({
      producer: "quality-draft-capture",
      actor: "server",
      eventType,
      projectRoot: context.projectRoot,
      payload,
    });
  } catch {
    // Persistence already succeeded or failed independently, so evidence loss cannot change its outcome.
    return;
  }
}

/** Read one stable regular draft; missing, unreadable, or still-changing paths use a null fallback. */
function readStableDraft(
  context: RootCaptureContext,
  state: RootCaptureState,
  draftName: string,
): StableDraft | null {
  const path = join(context.stagingDir, draftName);
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    // A missing or unreadable candidate is retried only if a later poll can see it safely.
    state.observations.delete(draftName);
    return null;
  }
  // Symlinks and non-files never enter the report persistence pipeline.
  if (!stats.isFile()) {
    state.observations.delete(draftName);
    return null;
  }
  const observation = { mtimeMs: stats.mtimeMs, size: stats.size };
  if (context.stableMs > 0) {
    const previous = state.observations.get(draftName);
    state.observations.set(draftName, observation);
    // A draft still inside its quiet window may be partially written, so leave it for the next poll.
    if (Date.now() - observation.mtimeMs < context.stableMs) return null;
    if (
      previous === undefined ||
      previous.mtimeMs !== observation.mtimeMs ||
      previous.size !== observation.size
    ) {
      return null;
    }
  }
  return { path, ...observation };
}

/** Confirm a draft did not change between its eligibility stat and completed read. */
function draftStillMatches(
  state: RootCaptureState,
  draftName: string,
  draft: StableDraft,
): boolean {
  try {
    const stats = lstatSync(draft.path);
    const matches =
      stats.isFile() &&
      stats.size === draft.size &&
      stats.mtimeMs === draft.mtimeMs;
    if (!matches) {
      state.observations.set(draftName, {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      });
    }
    return matches;
  } catch {
    state.observations.delete(draftName);
    return false;
  }
}

/**
 * Reserve a draft receipt destination before persistence.
 * A collision removes the draft and records the bounded rejection instead of overwriting local state.
 */
function reserveCaptureReceipt(
  context: RootCaptureContext,
  draftName: string,
): boolean {
  try {
    assertQualityCaptureReceiptAvailable(context.stagingDir, draftName);
    return true;
  } catch {
    // A completed receipt is another owner's terminal outcome, not a collision
    // to rewrite. The claimant may remove only the duplicate draft it acquired.
    if (hasValidTerminalQualityReceipt(context.stagingDir, draftName)) {
      removeDraft(context.stagingDir, draftName);
      return false;
    }
    // A stale or unsafe receipt blocks this run; replace only its staging entry with a rejection.
    removeDraft(context.stagingDir, draftName);
    const receiptAvailable = replaceUnsafeQualityReceiptWithRejection(
      context.stagingDir,
      draftName,
    );
    recordCaptureEvent(context, "quality.rejected", {
      draft: draftName,
      error: "quality capture: receipt destination already existed.",
      receipt: receiptAvailable ? "replaced" : "unavailable",
    });
    return false;
  }
}

/**
 * Writes one receipt and records a bounded fallback event if the destination becomes unavailable.
 *
 * @param context - project-owned capture paths; missing paths make receipt writing fail closed
 * @param draftName - source draft identity; empty names cannot satisfy the draft contract
 * @param receipt - redacted success or rejection receipt; absent fields are omitted from disk
 * @param eventType - evidence classification used only when the receipt write fails
 * @param fallbackPayload - bounded evidence retained when no receipt can be written
 * @returns true after a durable receipt; false after the fallback event
 */
function writeReceiptOrRecordFallback(
  context: RootCaptureContext,
  draftName: string,
  receipt: QualityCaptureReceipt,
  eventType: "quality.persisted" | "quality.rejected",
  fallbackPayload: EvidencePayload,
): boolean {
  try {
    writeQualityCaptureReceipt(context.stagingDir, draftName, receipt);
    return true;
  } catch {
    // The event keeps a bounded outcome when the user cannot receive a durable receipt.
    recordCaptureEvent(context, eventType, fallbackPayload);
    return false;
  }
}

/** Reject one oversized draft after deleting its unredacted staging copy. */
function rejectOversizedDraft(
  context: RootCaptureContext,
  draftName: string,
): void {
  removeDraft(context.stagingDir, draftName);
  const message = `quality capture: draft exceeds the ${MAX_DRAFT_BYTES} byte limit.`;
  const receiptWritten = writeReceiptOrRecordFallback(
    context,
    draftName,
    { ok: false, error: message },
    "quality.rejected",
    {
      draft: draftName,
      error: "quality capture: receipt unavailable.",
    },
  );
  // Receipt failure was already captured as evidence, so no second rejection event is needed.
  if (!receiptWritten) return;
  recordCaptureEvent(context, "quality.rejected", {
    draft: draftName,
    error: message,
  });
}

/** Record successful persistence after deleting the source draft and writing its receipt. */
function recordPersistedDraft(
  context: RootCaptureContext,
  draftName: string,
  reportPath: string,
): void {
  removeDraft(context.stagingDir, draftName);
  const receiptWritten = writeReceiptOrRecordFallback(
    context,
    draftName,
    { ok: true, reportPath },
    "quality.persisted",
    {
      draft: draftName,
      report_path: reportPath,
      receipt: "unavailable",
    },
  );
  // Receipt failure already carries the persisted report path in evidence.
  if (!receiptWritten) return;
  recordCaptureEvent(context, "quality.persisted", {
    draft: draftName,
    report_path: reportPath,
  });
}

/** Record a persistence rejection after deleting and redacting the source draft. */
function recordRejectedDraft(
  context: RootCaptureContext,
  draftName: string,
  rawText: string,
  error: unknown,
): void {
  removeDraft(context.stagingDir, draftName);
  const message = captureRejectionDiagnostic(error);
  const redactedDraft = redactEvidenceText("quality draft", rawText);
  const receiptWritten = writeReceiptOrRecordFallback(
    context,
    draftName,
    { ok: false, error: message },
    "quality.rejected",
    {
      draft: draftName,
      error: "quality capture: receipt unavailable.",
      raw_json: redactedDraft,
    },
  );
  // Receipt failure already carries the redacted rejection in evidence.
  if (!receiptWritten) return;
  recordCaptureEvent(context, "quality.rejected", {
    draft: draftName,
    error: message,
    raw_json: redactedDraft,
  });
}

/** Write the bounded terminal outcome selected by the stale-claim fence. */
function recordStaleDraftClaimRejection(
  context: RootCaptureContext,
  state: RootCaptureState,
  draftName: string,
): void {
  const message =
    "quality capture: stale draft claim rejected to prevent duplicate persistence.";
  // A prior receipt is already a terminal outcome; reserve handles it without persistence.
  if (reserveCaptureReceipt(context, draftName)) {
    removeDraft(context.stagingDir, draftName);
    const receiptWritten = writeReceiptOrRecordFallback(
      context,
      draftName,
      { ok: false, error: message },
      "quality.rejected",
      {
        draft: draftName,
        error: "quality capture: stale claim receipt unavailable.",
      },
    );
    if (receiptWritten) {
      recordCaptureEvent(context, "quality.rejected", {
        draft: draftName,
        error: message,
      });
    }
  }
  state.observations.delete(draftName);
}

/** Acquire the project-wide claim required before reading one stable draft. */
function acquireDraftClaim(
  context: RootCaptureContext,
  state: RootCaptureState,
  draftName: string,
): QualityDraftClaim | null {
  const claim = acquireQualityDraftClaim({
    stagingDir: context.stagingDir,
    draftName,
    staleMs: context.claimStaleMs,
    rejectStaleDraft: () => {
      recordStaleDraftClaimRejection(context, state, draftName);
    },
  });
  if (claim === null) return null;
  state.ownedClaims.set(draftName, claim);
  return claim;
}

/** Release only this process's claim and forget its in-memory ownership record. */
function releaseDraftClaim(
  state: RootCaptureState,
  claim: QualityDraftClaim,
): void {
  const recorded = state.ownedClaims.get(claim.draftName);
  if (recorded?.token === claim.token) {
    state.ownedClaims.delete(claim.draftName);
  }
  releaseQualityDraftClaim(claim);
}

/** Reject only drafts still bound to claims owned by this process during teardown. */
function rejectOwnedClaimsAtShutdown(
  context: RootCaptureContext,
  state: RootCaptureState,
): void {
  for (const claim of [...state.ownedClaims.values()]) {
    if (!isQualityDraftClaimOwned(claim)) {
      state.ownedClaims.delete(claim.draftName);
      continue;
    }
    const message =
      "quality capture: owning server stopped before persistence.";
    if (reserveCaptureReceipt(context, claim.draftName)) {
      removeDraft(context.stagingDir, claim.draftName);
      writeReceiptOrRecordFallback(
        context,
        claim.draftName,
        { ok: false, error: message },
        "quality.rejected",
        {
          draft: claim.draftName,
          error: "quality capture: shutdown receipt unavailable.",
        },
      );
    }
    releaseDraftClaim(state, claim);
  }
}

/** Reject an oversized owned draft only after its lease and receipt remain available. */
function rejectOwnedOversizedDraft(
  context: RootCaptureContext,
  state: RootCaptureState,
  draftName: string,
  claim: QualityDraftClaim,
): void {
  if (!refreshQualityDraftClaim(claim)) return;
  if (!reserveCaptureReceipt(context, draftName)) return;
  rejectOversizedDraft(context, draftName);
  state.observations.delete(draftName);
}

/** Read and fence one normal-sized owned draft immediately before persistence. */
function prepareOwnedDraftText(
  context: RootCaptureContext,
  state: RootCaptureState,
  draftName: string,
  draft: StableDraft,
  claim: QualityDraftClaim,
): string | null {
  let rawText: string;
  try {
    rawText = readFileSync(draft.path, "utf8");
  } catch {
    return null;
  }
  if (!draftStillMatches(state, draftName, draft)) return null;
  // Refreshing closes the stale-reaper race immediately before the irreversible write.
  if (!refreshQualityDraftClaim(claim)) return null;
  // A terminal receipt created by an earlier owner is preserved. Unsafe receipt
  // shapes still produce the bounded rejection used by the capture contract.
  if (!reserveCaptureReceipt(context, draftName)) return null;
  return rawText;
}

/** Persist or reject a prepared draft, then retire its stability observation. */
function persistPreparedDraft(
  context: RootCaptureContext,
  state: RootCaptureState,
  draftName: string,
  rawText: string,
): void {
  try {
    const reportPath = persistQualityReportText(
      {
        projectPath: context.projectRoot,
        rawText,
        sourceLabel: "draft",
      },
      { CLIError: QualityCaptureError },
    );
    recordPersistedDraft(context, draftName, reportPath);
  } catch (error) {
    // Example: Claude finished malformed JSON; the user needs a rejection receipt without closing.
    recordRejectedDraft(context, draftName, rawText, error);
  }
  state.observations.delete(draftName);
}

/**
 * Validate and persist one stable draft with a bounded fallback for every expected failure.
 * The ordered stages stay explicit because receipt reservation must precede durable persistence.
 */
function processCaptureDraft(
  context: RootCaptureContext,
  state: RootCaptureState,
  draftName: string,
): void {
  const draft = readStableDraft(context, state, draftName);
  // Ineligible drafts remain untouched for a later safe poll.
  if (draft === null) return;
  const claim = acquireDraftClaim(context, state, draftName);
  // Another process owns the claim or is rejecting an abandoned owner.
  if (claim === null) return;
  try {
    // A pre-claim snapshot may outlive another process's completed write. Recheck
    // the acquired draft before consulting or changing its receipt destination.
    if (!draftStillMatches(state, draftName, draft)) return;
    // Oversized input is rejected before its unredacted contents are loaded into memory.
    if (draft.size > MAX_DRAFT_BYTES) {
      rejectOwnedOversizedDraft(context, state, draftName, claim);
      return;
    }

    const rawText = prepareOwnedDraftText(
      context,
      state,
      draftName,
      draft,
      claim,
    );
    if (rawText === null) return;
    persistPreparedDraft(context, state, draftName, rawText);
  } finally {
    releaseDraftClaim(state, claim);
  }
}

/**
 * Process one staging-directory snapshot with an empty fallback when the directory read fails.
 * Busy and disposed state prevents overlapping or post-shutdown persistence.
 */
function processCaptureSnapshot(
  context: RootCaptureContext,
  state: RootCaptureState,
): void {
  // A shared root has exactly one active sweep, and shutdown prevents any new persistence.
  if (state.isBusy || state.isDisposed) return;
  state.isBusy = true;
  try {
    let entries: string[];
    try {
      entries = readdirSync(context.stagingDir);
    } catch {
      // The next poll retries a temporarily unavailable staging directory.
      return;
    }
    const visibleDrafts = new Set(
      entries.filter((entry) => DRAFT_NAME_PATTERN.test(entry)),
    );
    for (const observedName of state.observations.keys()) {
      if (!visibleDrafts.has(observedName)) {
        state.observations.delete(observedName);
      }
    }
    const orphanedOwnership = new Set(
      entries
        .map(qualityDraftNameFromOwnershipMarker)
        .filter(
          (draftName): draftName is string =>
            draftName !== null && !visibleDrafts.has(draftName),
        ),
    );
    // A crash can leave only its owner marker after deleting the draft. Inspect
    // those markers too so a waiting session eventually receives a terminal receipt.
    for (const draftName of orphanedOwnership) {
      rejectStaleQualityDraftClaim({
        stagingDir: context.stagingDir,
        draftName,
        staleMs: context.claimStaleMs,
        rejectStaleDraft: () => {
          recordStaleDraftClaimRejection(context, state, draftName);
        },
      });
    }
    // Each visible contract-shaped draft gets one ordered persistence attempt.
    for (const entry of entries) {
      // Unrelated files in staging are user-owned and remain untouched.
      if (!DRAFT_NAME_PATTERN.test(entry)) continue;
      processCaptureDraft(context, state, entry);
    }
  } finally {
    state.isBusy = false;
  }
}

/**
 * Build the single poller with a next-poll fallback when processing rejects.
 * One root-owned state object is intentional because independent pollers could persist or delete the same draft.
 *
 * @param options - owner root plus optional timing overrides
 * @returns the shared poller; shutdown stops it without sweeping shared drafts
 */
function createRootCapture(options: QualityDraftCaptureOptions): RootCapture {
  const context: RootCaptureContext = {
    projectRoot: options.projectRoot,
    stagingDir: ensureQualityDraftStagingDirectory(options.projectRoot),
    stableMs: options.stableMs ?? DEFAULT_STABLE_MS,
    claimStaleMs: options.claimStaleMs ?? DEFAULT_CLAIM_STALE_MS,
  };
  const state: RootCaptureState = {
    isDisposed: false,
    isBusy: false,
    observations: new Map(),
    ownedClaims: new Map(),
  };

  /** Process eligible drafts immediately through the root-owned single-poller state. */
  const processNow = (): Promise<void> => {
    try {
      processCaptureSnapshot(context, state);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };

  const timer = setInterval(() => {
    void processNow().catch(() => {
      // A failed snapshot uses the next poll as its retry instead of becoming an unhandled rejection.
    });
  }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref();

  return {
    stagingDir: context.stagingDir,
    processNow,
    /** Stop this process's poller without sweeping another process's shared drafts. */
    shutdown(): void {
      // Repeated session teardown must not finalize or clear the shared timer twice.
      if (state.isDisposed) return;
      clearInterval(timer);
      try {
        // A second dashboard process may still be writing or observing the same
        // root, so teardown never acquires or deletes an unowned draft.
        rejectOwnedClaimsAtShutdown(context, state);
      } finally {
        state.isDisposed = true;
        state.observations.clear();
      }
    },
  };
}

/**
 * Acquire a capture for one project root, starting the poller on first use.
 *
 * The staging directory is a property of the project root, not of a session: two dashboard sessions on the same project resolve to the same
 * directory.
 * One in-process poller avoids duplicate local work, while filesystem `wx` claims serialize independent server processes.
 *
 * Holders are counted only to stop the local timer; teardown never sweeps the project-wide staging directory.
 *
 * Timing overrides come from whichever holder starts the poller; later holders
 * on the same root share that cadence.
 *
 * @param options - owner root plus optional timing overrides
 * @returns capture handle; the owning terminal session must dispose it exactly once
 */
export function startQualityDraftCapture(
  options: QualityDraftCaptureOptions,
): QualityDraftCapture {
  const key = realpathSync(resolve(options.projectRoot));
  const canonicalOptions = { ...options, projectRoot: key };
  let entry = rootCaptures.get(key);
  if (entry === undefined) {
    entry = { capture: createRootCapture(canonicalOptions), holders: 0 };
    rootCaptures.set(key, entry);
  } else {
    // A later holder must still see its staging directory exist even if an
    // earlier holder's tree was removed between acquisitions.
    ensureQualityDraftStagingDirectory(key);
  }
  const held = entry;
  held.holders += 1;
  let hasReleased = false;
  return {
    stagingDir: held.capture.stagingDir,
    processNow: () => held.capture.processNow(),
    /** Release this handle once; the last holder shuts down the root-owned poller. */
    dispose(): void {
      // Idempotent per handle: a double dispose must not release a sibling's hold.
      if (hasReleased) return;
      hasReleased = true;
      held.holders -= 1;
      if (held.holders > 0) return;
      rootCaptures.delete(key);
      held.capture.shutdown();
    },
  };
}
