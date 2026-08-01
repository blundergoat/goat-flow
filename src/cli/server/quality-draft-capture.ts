/**
 * Dashboard-owned quality report persistence for enforced Claude reporting
 * sessions (ADR-044).
 *
 * Claude Code 2.1.220's permission rules cannot authorize the multi-line
 * heredoc `quality save` command (measured in plan M06), so enforced sessions
 * never persist reports themselves. Instead the agent writes ONE draft JSON
 * into a gitignored staging directory with its file tool, and this module -
 * running inside the dashboard server process - validates, redacts, revalidates,
 * and persists the draft through the same `quality save` core as the CLI,
 * deletes the draft, and writes a receipt file the agent can read to confirm
 * the outcome.
 *
 * Polling (not fs.watch) is deliberate: watch events are unreliable on WSL2
 * and network filesystems. The poller requires repeated size/mtime observations
 * and retains parse failures until the last writer exits, so a paused writer is
 * never mistaken for a completed invalid draft.
 *
 * Ownership is per project root, not per session: the staging directory is
 * shared by every session on a root, so one reference-counted poller owns it
 * and each session holds a handle. Every session MUST dispose its handle when
 * it ends (see the cleanup-layering footgun); the last release clears the timer
 * and sweeps leftover drafts, so no unredacted draft outlives the last session
 * that could still be writing one.
 */
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  isQualityPersistencePathIgnored,
  persistQualityReportText,
} from "../quality/quality-command.js";
import { recordEvidenceEvent } from "../evidence/envelope.js";
import type { EvidencePayload } from "../evidence/envelope.js";
import { redactEvidenceText, scrubDurableText } from "../evidence/redaction.js";

/** Draft filenames the poller will process; anything else in staging is ignored. */
const DRAFT_NAME_PATTERN = /^goat-quality-draft-[A-Za-z0-9_-]{1,64}\.json$/u;
/** Prefixes used to derive the receipt filename from a draft filename. */
const DRAFT_NAME_PREFIX = "goat-quality-draft-";
const RESULT_NAME_PREFIX = "goat-quality-result-";
/** Exact local directory whose descendants may briefly contain raw quality text. */
const STAGING_RELATIVE_PATH = ".goat-flow/logs/quality/staging/";
/** Reject drafts larger than this; a valid report is far smaller. */
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
/** Default poll cadence and required mtime quiet period before processing. */
const DEFAULT_INTERVAL_MS = 750;
const DEFAULT_STABLE_MS = 500;

/** Error type satisfying the `quality save` core's injected CLIError contract. */
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
}

/** Live capture handle held by exactly one terminal session. */
export interface QualityDraftCapture {
  /** Absolute staging directory this capture watches. */
  stagingDir: string;
  /**
   * Release this session's hold; safe to call more than once. The poller keeps
   * running - and leftover drafts survive - until every holder on the root has
   * released, so one session ending cannot delete another's pending draft.
   */
  dispose(): void;
  /** Process eligible drafts immediately; exposed for tests and shutdown flushes. */
  processNow(): Promise<void>;
}

/** The one poller per project root that every holder on that root shares. */
interface RootCapture {
  stagingDir: string;
  /** Process every currently eligible draft while preserving single-poller ordering. */
  processNow(): Promise<void>;
  /** Stop polling, finalize regular drafts, and remove unsafe leftovers. */
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

/** One prospective staging component and its non-following filesystem observation. */
interface InspectedDraftDirectory {
  componentPath: string;
  stats: NonNullable<ReturnType<typeof lstatSync>> | null;
}

/** Inspect every staging component without creating or following a final symlink. */
function inspectQualityDraftDirectories(
  componentPaths: readonly string[],
): InspectedDraftDirectory[] {
  return componentPaths.map((componentPath) => {
    try {
      return { componentPath, stats: lstatSync(componentPath) };
    } catch {
      return { componentPath, stats: null };
    }
  });
}

/** Reject any existing staging component that is not a real directory. */
function assertQualityDraftDirectories(
  components: readonly InspectedDraftDirectory[],
): void {
  for (const component of components) {
    if (component.stats !== null && !component.stats.isDirectory()) {
      throw new Error(
        `quality capture: ${component.componentPath} must be a real project-local directory.`,
      );
    }
  }
}

/** Create missing staging components and enforce the private leaf mode. */
function createQualityDraftDirectories(
  components: readonly InspectedDraftDirectory[],
  stagingPath: string,
): void {
  for (const component of components) {
    if (component.stats === null) {
      mkdirSync(component.componentPath, {
        mode: component.componentPath === stagingPath ? 0o700 : undefined,
      });
    }
    if (
      process.platform !== "win32" &&
      component.componentPath === stagingPath
    ) {
      chmodSync(component.componentPath, 0o700);
      if ((lstatSync(component.componentPath).mode & 0o077) !== 0) {
        throw new Error(
          "quality capture: staging directory must be private (0700).",
        );
      }
    }
  }
}

/**
 * Create the staging directory for one reporting root, component by component.
 *
 * Mirrors the `quality save` directory walk: each component must be a real
 * local directory (no symlinked or file-shadowed segments), and the staging
 * leaf is created `0700` so the redaction window named in ADR-044 is not
 * widened by group/world reads. Call BEFORE building the Claude permission
 * overlay so the `.goat-flow/logs` write allow exists for fresh targets.
 * Existing components are inspected first; Git must then prove the exact
 * staging directory ignored before any missing component is created.
 *
 * @param projectRoot - report owner project root
 * @returns absolute staging directory path
 */
export function ensureQualityDraftStagingDirectory(
  projectRoot: string,
): string {
  const components = [
    join(projectRoot, ".goat-flow"),
    join(projectRoot, ".goat-flow", "logs"),
    join(projectRoot, ".goat-flow", "logs", "quality"),
    join(projectRoot, ".goat-flow", "logs", "quality", "staging"),
  ];
  const inspectedComponents = inspectQualityDraftDirectories(components);
  assertQualityDraftDirectories(inspectedComponents);
  if (!isQualityPersistencePathIgnored(projectRoot, STAGING_RELATIVE_PATH)) {
    throw new Error(
      `quality capture: ${STAGING_RELATIVE_PATH} must be gitignored before capture starts.`,
    );
  }
  createQualityDraftDirectories(
    inspectedComponents,
    components[components.length - 1] as string,
  );
  return components[components.length - 1] as string;
}

/** Resolve the receipt paired with one draft filename. */
function captureReceiptPath(stagingDir: string, draftName: string): string {
  const resultName =
    RESULT_NAME_PREFIX + draftName.slice(DRAFT_NAME_PREFIX.length);
  return join(stagingDir, resultName);
}

/** Refuse any receipt path that existed before this draft was processed. */
function assertCaptureReceiptAvailable(
  stagingDir: string,
  draftName: string,
): void {
  try {
    lstatSync(captureReceiptPath(stagingDir, draftName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("quality capture: cannot inspect receipt destination.");
  }
  throw new Error("quality capture: receipt destination already exists.");
}

/** Write one receipt file beside the processed draft; receipt text is scrubbed. */
function writeCaptureReceipt(
  stagingDir: string,
  draftName: string,
  body: { ok: true; reportPath: string } | { ok: false; error: string },
): void {
  const resultPath = captureReceiptPath(stagingDir, draftName);
  const serialized = scrubDurableText(`${JSON.stringify(body, null, 2)}\n`);
  try {
    writeFileSync(resultPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("quality capture: receipt destination already exists.");
    }
    throw new Error("quality capture: could not write receipt.");
  }
  const stats = lstatSync(resultPath);
  if (!stats.isFile() || stats.nlink !== 1) {
    try {
      unlinkSync(resultPath);
    } catch {
      /* the unsafe receipt path is already gone */
    }
    throw new Error(
      "quality capture: receipt must be a single-link regular file.",
    );
  }
}

/** Replace an unsafe pre-existing receipt entry with one fixed rejection receipt. */
function replacePreexistingReceiptWithRejection(
  stagingDir: string,
  draftName: string,
): boolean {
  const resultPath = captureReceiptPath(stagingDir, draftName);
  try {
    // Unlink removes only the staging entry; symlink and hard-link targets are
    // never opened or truncated. The exclusive writer still closes the race.
    unlinkSync(resultPath);
    writeCaptureReceipt(stagingDir, draftName, {
      ok: false,
      error: "quality capture: receipt destination already existed.",
    });
    return true;
  } catch {
    return false;
  }
}

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
}

/** Mutable poller state shared by direct calls, timer polls, and finalization. */
interface RootCaptureState {
  isDisposed: boolean;
  isBusy: boolean;
  observations: Map<string, DraftObservation>;
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
  finalizing: boolean,
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
  if (!finalizing && context.stableMs > 0) {
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
    assertCaptureReceiptAvailable(context.stagingDir, draftName);
    return true;
  } catch {
    // A pre-existing receipt is user-owned state, so reject the draft without overwriting it.
    removeDraft(context.stagingDir, draftName);
    const receiptAvailable = replacePreexistingReceiptWithRejection(
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
  receipt: { ok: true; reportPath: string } | { ok: false; error: string },
  eventType: "quality.persisted" | "quality.rejected",
  fallbackPayload: EvidencePayload,
): boolean {
  try {
    writeCaptureReceipt(context.stagingDir, draftName, receipt);
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

/**
 * Validate and persist one stable draft with a bounded fallback for every expected failure.
 * The ordered stages stay explicit because receipt reservation must precede durable persistence.
 */
function processCaptureDraft(
  context: RootCaptureContext,
  state: RootCaptureState,
  draftName: string,
  finalizing: boolean,
): void {
  const draft = readStableDraft(context, state, draftName, finalizing);
  // Ineligible drafts remain untouched for a later safe poll or final sweep.
  if (draft === null) return;
  // A receipt collision has already deleted and rejected this draft.
  if (!reserveCaptureReceipt(context, draftName)) return;
  // Oversized input is rejected before its unredacted contents are loaded into memory.
  if (draft.size > MAX_DRAFT_BYTES) {
    if (!finalizing) return;
    rejectOversizedDraft(context, draftName);
    state.observations.delete(draftName);
    return;
  }

  let rawText: string;
  try {
    rawText = readFileSync(draft.path, "utf8");
  } catch {
    // A disappearing or unreadable draft cannot be persisted and may be retried if it reappears.
    return;
  }
  if (!draftStillMatches(state, draftName, draft)) return;

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
    state.observations.delete(draftName);
  } catch (error) {
    // Parse/schema/ownership failures can be a paused writer's partial bytes.
    // Keep them private and retry while any producing session remains alive.
    if (!finalizing) return;
    recordRejectedDraft(context, draftName, rawText, error);
    state.observations.delete(draftName);
  }
}

/**
 * Process one staging-directory snapshot with an empty fallback when the directory read fails.
 * Busy and disposed state prevents overlapping or post-shutdown persistence.
 */
function processCaptureSnapshot(
  context: RootCaptureContext,
  state: RootCaptureState,
  finalizing = false,
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
    // Each visible contract-shaped draft gets one ordered persistence attempt.
    for (const entry of entries) {
      // Unrelated files in staging are user-owned and remain untouched.
      if (!DRAFT_NAME_PATTERN.test(entry)) continue;
      processCaptureDraft(context, state, entry, finalizing);
    }
  } finally {
    state.isBusy = false;
  }
}

/** Remove every contract-shaped draft with a no-op fallback when the directory read fails. */
function sweepCaptureDrafts(stagingDir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(stagingDir);
  } catch {
    // An unavailable directory has no safely enumerable drafts to delete.
    return;
  }
  // Only unredacted draft names are swept; durable receipts survive teardown.
  for (const entry of entries) {
    if (DRAFT_NAME_PATTERN.test(entry)) removeDraft(stagingDir, entry);
  }
}

/**
 * Build the single poller with a next-poll fallback when processing rejects.
 * One root-owned state object is intentional because independent pollers could persist or delete the same draft.
 *
 * @param options - owner root plus optional timing overrides
 * @returns the shared poller; shutdown stops it and sweeps leftover drafts
 */
function createRootCapture(options: QualityDraftCaptureOptions): RootCapture {
  const context: RootCaptureContext = {
    projectRoot: options.projectRoot,
    stagingDir: ensureQualityDraftStagingDirectory(options.projectRoot),
    stableMs: options.stableMs ?? DEFAULT_STABLE_MS,
  };
  const state: RootCaptureState = {
    isDisposed: false,
    isBusy: false,
    observations: new Map(),
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
      // A failed sweep uses the next poll as its retry instead of becoming an unhandled rejection.
    });
  }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref();

  return {
    stagingDir: context.stagingDir,
    processNow,
    /** Stop this root poller once and resolve drafts after their final writer has exited. */
    shutdown(): void {
      // Repeated session teardown must not finalize, sweep, or clear the shared timer twice.
      if (state.isDisposed) return;
      clearInterval(timer);
      try {
        // No session holder remains, so every regular draft can now be read once
        // without a quiet-window delay and either persisted or rejected durably.
        processCaptureSnapshot(context, state, true);
      } finally {
        state.isDisposed = true;
        state.observations.clear();
        sweepCaptureDrafts(context.stagingDir);
      }
    },
  };
}

/**
 * Acquire a capture for one project root, starting the poller on first use.
 *
 * The staging directory is a property of the project root, not of a session:
 * two dashboard sessions on the same project resolve to the same directory. One
 * poller per root is therefore the only safe arrangement - independent pollers
 * would each sweep the shared directory on teardown (destroying a sibling
 * session's pending draft) and could both persist the same draft, because a
 * draft remains visible until persistence and its receipt complete. Holders are counted, and
 * the last release stops the timer and sweeps, so ADR-044's close-time sweep
 * still runs once no session on the root can be writing a draft.
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
