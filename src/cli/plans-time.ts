/**
 * Prospective timing for goat-plan milestones. The milestone-local receipt is the validation authority;
 * evidence-envelope events are best-effort transition diagnostics and are never read back here.
 * Users start, pause, recover, and finalize timing inside the milestone they selected.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";
import {
  recordEvidenceEvent,
  type AppendEvidenceEnvelopeResult,
} from "./evidence/envelope.js";
import { renderActualLine } from "./plans-effort.js";
import {
  latestRecordedTimingEpoch,
  parseTimingReceiptMarkdown,
  renderTimingReceiptMarkdown,
  summarizeTimingReceipt,
  type PlanTimeCategory,
  type PlanTimingReceipt,
  type PlanTimingReceiptState,
  type PlanTimingSegment,
} from "./plans-time-receipt.js";
import {
  maskNonRenderedMarkdown,
  readRenderedMarkdownFieldValues,
} from "./rendered-markdown.js";

/** Stable CLI errors that tell users how to recover without echoing milestone content. */
const TIMING_ERROR = {
  nonNegativeEpoch: "Timing needs a non-negative whole epoch second.",
  unsupportedDate: "Timing timestamp is outside the supported date range.",
  outsidePlans:
    "Milestone must be inside a project .goat-flow/plans directory.",
  escapingPath: "Milestone path escapes its .goat-flow/plans directory.",
  multipleReceipts: "Milestone has multiple Timing Receipt sections.",
  missingEstimate: "Milestone needs an Effort estimate before Actual.",
  concurrentEdit: "Milestone changed during timing; retry the transition.",
  multipleOpen: "Timing Receipt has more than one open segment.",
  historyClock: "System clock predates timing history; wait before starting.",
  emptyFinalization: "Cannot finalize before recording a timing segment.",
  openClock: "System clock moved backwards in the open span; discard it.",
} as const;
const RECEIPT_ATX = /^ {0,3}##[ \t]+Timing Receipt(?:[ \t]+#+)?[ \t]*$/gimu;
const LEVEL_TWO_ATX = /^ {0,3}##(?:[ \t]+|$)/mu;

export {
  allocateTimingMinutes,
  parseTimingReceiptMarkdown,
} from "./plans-time-receipt.js";
export type {
  PlanTimingReceipt,
  PlanTimingSummary,
} from "./plans-time-receipt.js";

/** User-facing timing operations; stop options distinguish pause from recovery/finalization. */
export type PlanTimeTransition =
  | { action: "start"; category: PlanTimeCategory }
  | { action: "stop"; finalize?: boolean; discardOpen?: boolean }
  | { action: "status" };

/** Result returned to the CLI after the milestone write and event attempt. */
export interface PlanTimeCommandResult {
  action: PlanTimeTransition["action"];
  milestonePath: string;
  projectRoot: string;
  receipt: PlanTimingReceipt;
  event: AppendEvidenceEnvelopeResult;
}

/** Verified project and destination identity used for one atomic milestone write. */
interface PlanFileContext {
  milestonePath: string;
  projectRoot: string;
  plansRoot: string;
  fileStats: Stats;
}

/** Source offsets and readable body for the milestone's one rendered receipt section. */
interface ReceiptSection {
  body: string;
  headingStart: number;
  sectionEnd: number;
}

/** Canonical UTC and epoch forms captured from the same system-clock instant. */
interface TimingStamp {
  iso: string;
  epochSeconds: number;
}

/** Updated receipt plus the optional category copied into diagnostic event metadata. */
interface ReceiptTransitionResult {
  receipt: PlanTimingReceipt;
  eventCategory: PlanTimeCategory | null;
}

/** Test-only callback that simulates a user saving immediately before milestone replacement. */
type BeforeMilestoneReplacement = () => void;

/** Convert an epoch second into the canonical UTC form written to receipts.
 * @throws CLIError - when the supplied instant cannot be represented safely
 */
function stampFromEpoch(epochSeconds: number): TimingStamp {
  // Invalid test or system time cannot become trustworthy user-visible evidence.
  if (!Number.isSafeInteger(epochSeconds) || epochSeconds < 0) {
    throw new CLIError(TIMING_ERROR.nonNegativeEpoch, 2);
  }
  const instant = new Date(epochSeconds * 1000);
  // An out-of-range date cannot be shown consistently in the receipt UI.
  if (Number.isNaN(instant.valueOf())) {
    throw new CLIError(TIMING_ERROR.unsupportedDate, 2);
  }
  return {
    iso: instant.toISOString().replace(".000Z", "Z"),
    epochSeconds,
  };
}

/** Locate the lexical `.goat-flow/plans` ancestor without following it. */
function locatePlansRoot(milestonePath: string): string | null {
  let cursor = dirname(milestonePath);
  for (;;) {
    if (
      basename(cursor) === "plans" &&
      basename(dirname(cursor)) === ".goat-flow"
    ) {
      return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

/** Read one selected path component without accepting missing or inaccessible entries.
 * @throws CLIError - when the selected path component cannot be inspected
 */
function requiredPathStats(path: string, label: string): Stats {
  try {
    return lstatSync(path);
  } catch (error) {
    // Example: the user selected a milestone and another tool moved it before Start.
    throw new CLIError(
      `Cannot inspect ${label}: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
}

/** Require the milestone filename shape accepted by the planning workflow.
 * @throws CLIError - when the selected document is not an M*.md milestone
 */
function requireMilestoneFilename(milestonePath: string): void {
  // A non-milestone document must not receive timing fields through this command.
  if (!/^M\d.*\.md$/iu.test(basename(milestonePath)))
    throw new CLIError("plans time requires an M*.md milestone file.", 2);
}

/** Resolve the containing plans directory or explain the required project layout.
 * @throws CLIError - when the milestone is outside a containing `.goat-flow/plans` tree
 */
function requirePlansRoot(milestonePath: string): string {
  const plansRoot = locatePlansRoot(milestonePath);
  // Without a containing plan tree, the command cannot identify the selected project safely.
  if (plansRoot === null) {
    throw new CLIError(TIMING_ERROR.outsidePlans, 2);
  }
  return plansRoot;
}

/** Reject a milestone path that does not remain below the resolved plans directory. */
function requireNestedMilestone(
  plansRoot: string,
  milestonePath: string,
): void {
  const nestedPath = relative(plansRoot, milestonePath);
  // Escaping the selected plan tree would let one project rewrite another file.
  if (
    nestedPath.length === 0 ||
    nestedPath === ".." ||
    nestedPath.startsWith(`..${sep}`)
  ) {
    throw new CLIError(TIMING_ERROR.escapingPath, 2);
  }
}

/** Require a real project directory before inspecting the user's milestone path.
 * @throws CLIError - when the project root is redirected or is not a directory
 */
function requireProjectDirectory(projectRoot: string): void {
  const projectStats = requiredPathStats(
    projectRoot,
    "containing project root",
  );
  // A redirected root would make the selected project identity ambiguous.
  if (projectStats.isSymbolicLink())
    throw new CLIError("Containing project root must not be a symlink.", 2);
  // A non-directory cannot contain the planning workspace shown to the user.
  if (!projectStats.isDirectory())
    throw new CLIError("Containing project root must be a directory.", 2);
}

/** Validate one milestone path component and return whether it is the destination. */
function validateMilestoneComponent(
  stats: Stats,
  isDestination: boolean,
): void {
  // Redirected parents or files could move a timing write outside the selected project.
  if (stats.isSymbolicLink()) {
    throw new CLIError(
      `${isDestination ? "Milestone file" : "Milestone parent"} must not be a symlink.`,
      2,
    );
  }
  // The final file must keep one stable identity for the adjacent atomic replacement.
  if (isDestination && (!stats.isFile() || stats.nlink !== 1)) {
    throw new CLIError(
      "Milestone destination must be a single-link regular file.",
      2,
    );
  }
  // Every earlier component must remain a real directory in the selected plan tree.
  if (!isDestination && !stats.isDirectory()) {
    throw new CLIError("Every milestone parent must be a real directory.", 2);
  }
}

/** Inspect each component without following redirects and return destination identity. */
function inspectMilestonePath(
  projectRoot: string,
  milestonePath: string,
): Stats {
  const pathParts = relative(projectRoot, milestonePath).split(sep);
  let cursor = projectRoot;
  // Each component is inspected in order so no symlinked parent can hide the destination.
  for (const [index, part] of pathParts.entries()) {
    cursor = join(cursor, part);
    const isDestination = index === pathParts.length - 1;
    const stats = requiredPathStats(
      cursor,
      isDestination ? "milestone file" : "milestone parent",
    );
    validateMilestoneComponent(stats, isDestination);
    // The final component supplies the identity checked again immediately before rename.
    if (isDestination) return stats;
  }
  throw new CLIError("Milestone path has no destination component.", 2);
}

/** Resolve one nested milestone while rejecting redirected or linked destinations. */
function resolvePlanFileContext(inputPath: string): PlanFileContext {
  const milestonePath = resolve(inputPath);
  requireMilestoneFilename(milestonePath);
  const plansRoot = requirePlansRoot(milestonePath);
  requireNestedMilestone(plansRoot, milestonePath);
  const projectRoot = dirname(dirname(plansRoot));
  requireProjectDirectory(projectRoot);
  const fileStats = inspectMilestonePath(projectRoot, milestonePath);
  return { milestonePath, projectRoot, plansRoot, fileStats };
}

/** Find the one rendered Timing Receipt section while preserving source offsets.
 * @throws CLIError - when the milestone contains more than one rendered receipt section
 */
function findReceiptSection(content: string): ReceiptSection | null {
  const masked = maskNonRenderedMarkdown(content);
  const headings = Array.from(masked.matchAll(RECEIPT_ATX));
  if (headings.length > 1) throw new CLIError(TIMING_ERROR.multipleReceipts, 2);
  const heading = headings[0];
  if (heading?.index === undefined) return null;
  const bodyStart = heading.index + heading[0].length;
  const nextHeadingOffset = masked.slice(bodyStart).search(LEVEL_TWO_ATX);
  const sectionEnd =
    nextHeadingOffset >= 0 ? bodyStart + nextHeadingOffset : content.length;
  return {
    body: content.slice(bodyStart, sectionEnd).trim(),
    headingStart: heading.index,
    sectionEnd,
  };
}

/** Replace or insert the rendered receipt before the milestone's first body section. */
function writeReceiptSection(
  content: string,
  receipt: PlanTimingReceipt,
): string {
  const rendered = `## Timing Receipt\n\n${renderTimingReceiptMarkdown(receipt)}\n\n`;
  const existing = findReceiptSection(content);
  if (existing) {
    return `${content.slice(0, existing.headingStart)}${rendered}${content.slice(existing.sectionEnd)}`;
  }
  const firstSection = maskNonRenderedMarkdown(content).match(LEVEL_TWO_ATX);
  if (firstSection?.index !== undefined) {
    return `${content.slice(0, firstSection.index)}${rendered}${content.slice(firstSection.index)}`;
  }
  return `${content.trimEnd()}\n\n${rendered}`;
}

/** Replace the one live Actual field, or insert it after the effort estimate.
 * @throws CLIError - when the milestone has ambiguous Actual fields or no estimate anchor
 */
function writeActualField(content: string, actualLine: string): string {
  const masked = maskNonRenderedMarkdown(content);
  const matches = Array.from(
    masked.matchAll(/^(?:\*\*Actual:\*\*|Actual:).*$/gimu),
  );
  if (matches.length > 1) {
    throw new CLIError("Milestone contains multiple Actual fields.", 2);
  }
  const existing = matches[0];
  if (existing?.index !== undefined) {
    return `${content.slice(0, existing.index)}${actualLine}${content.slice(existing.index + existing[0].length)}`;
  }
  const effort = masked.match(
    /^(?:\*\*Effort estimate:\*\*|Effort estimate:).*$/imu,
  );
  if (effort?.index === undefined) {
    throw new CLIError(TIMING_ERROR.missingEstimate, 2);
  }
  const insertion = effort.index + effort[0].length;
  return `${content.slice(0, insertion)}\n${actualLine}${content.slice(insertion)}`;
}

/**
 * Atomically replace one milestone after checking that a normal editor did not save a newer version.
 * The identity/content recheck covers cooperative local edits, not a hostile actor swapping an ancestor
 * after that final check; the adjacent temporary file keeps successful dashboard reads all-or-nothing.
 *
 * @param initialContext - verified milestone identity captured before reading; never null after path admission
 * @param milestoneContentAtRead - exact content used for the transition; empty means the user selected an empty milestone
 * @param updatedMilestoneContent - generated receipt and Actual content; never empty after a valid transition
 * @param beforeMilestoneReplacement - test-only editor-save simulation; omitted in the user-facing CLI flow
 * @returns nothing; success replaces the milestone, while an error leaves the user's selected file unchanged
 */
function writeMilestoneAtomically(
  initialContext: PlanFileContext,
  milestoneContentAtRead: string,
  updatedMilestoneContent: string,
  beforeMilestoneReplacement?: BeforeMilestoneReplacement,
): void {
  const tempPath = join(
    dirname(initialContext.milestonePath),
    `.${basename(initialContext.milestonePath)}.plans-time-${process.pid}-${randomUUID()}`,
  );
  let descriptor: number | null = null;
  try {
    descriptor = openSync(tempPath, "wx", 0o600);
    fchmodSync(descriptor, initialContext.fileStats.mode & 0o777);
    writeFileSync(descriptor, updatedMilestoneContent, "utf-8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    // Tests use this seam to reproduce a user saving in another editor at the last safe moment.
    beforeMilestoneReplacement?.();
    const currentContext = resolvePlanFileContext(initialContext.milestonePath);
    const destinationIdentityChanged =
      currentContext.fileStats.dev !== initialContext.fileStats.dev ||
      currentContext.fileStats.ino !== initialContext.fileStats.ino;
    const destinationContentChanged =
      readFileSync(currentContext.milestonePath, "utf-8") !==
      milestoneContentAtRead;
    // Atomic and in-place editor saves both mean the user's newer file must win.
    if (destinationIdentityChanged || destinationContentChanged)
      throw new CLIError(TIMING_ERROR.concurrentEdit, 2);
    // This cooperative check does not pin ancestor handles against a hostile swap before rename.
    renameSync(tempPath, initialContext.milestonePath);
  } catch (error) {
    // Example: the user saves in another editor, or the disk rejects the temporary write.
    // A null descriptor means the temporary file was already closed before this failure.
    if (descriptor !== null) closeSync(descriptor);
    // A failed transition must not leave a hidden temporary file beside the user's milestone.
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw error;
  }
}

/** Return the sole open segment, rejecting a corrupted multi-open receipt.
 * @throws CLIError - when the receipt contains more than one active span
 */
function readOpenSegment(receipt: PlanTimingReceipt): PlanTimingSegment | null {
  const openSegments = receipt.segments.filter(
    (segment) => segment.state === "open",
  );
  if (openSegments.length > 1) {
    throw new CLIError(TIMING_ERROR.multipleOpen, 2);
  }
  return openSegments[0] ?? null;
}

/** Generate the next stable segment id after the highest canonical suffix. */
function nextSegmentId(
  milestonePath: string,
  segments: readonly PlanTimingSegment[],
): string {
  const milestoneId = basename(milestonePath).match(/^M\d+/iu)?.[0] ?? "M";
  const prefix = `${milestoneId.toUpperCase()}-S`;
  const suffixPattern = new RegExp(`^${prefix}(\\d+)$`, "iu");
  let highestSuffix = 0;
  for (const segment of segments) {
    const suffix = Number(segment.id.match(suffixPattern)?.[1]);
    if (Number.isSafeInteger(suffix) && suffix > highestSuffix) {
      highestSuffix = suffix;
    }
  }
  return `${prefix}${String(highestSuffix + 1).padStart(2, "0")}`;
}

/** Parse an existing receipt or initialize paused state for the user's first Start.
 * @throws CLIError - when the embedded receipt cannot be parsed or validated
 */
function readReceipt(content: string): PlanTimingReceipt {
  const section = findReceiptSection(content);
  if (!section) return { state: "paused", segments: [] };
  const warnings: string[] = [];
  const receipt = parseTimingReceiptMarkdown(section.body, warnings);
  if (!receipt || warnings.length > 0) {
    throw new CLIError(
      `Timing Receipt is invalid: ${warnings.join("; ") || "missing receipt"}.`,
      2,
    );
  }
  return receipt;
}

/** Apply one pure receipt transition and return the category used by its event. */
function transitionReceipt(
  receipt: PlanTimingReceipt,
  transition: Exclude<PlanTimeTransition, { action: "status" }>,
  stamp: TimingStamp,
  milestonePath: string,
): ReceiptTransitionResult {
  const openSegment = readOpenSegment(receipt);
  if (transition.action === "start") {
    return startReceipt(
      receipt,
      openSegment,
      transition.category,
      stamp,
      milestonePath,
    );
  }
  return stopReceipt(receipt, openSegment, transition, stamp);
}

/** Add one open span, dropping any old final summary while preserving raw history. */
function startReceipt(
  receipt: PlanTimingReceipt,
  openSegment: PlanTimingSegment | null,
  category: PlanTimeCategory,
  stamp: TimingStamp,
  milestonePath: string,
): ReceiptTransitionResult {
  // Starting twice would create two clocks the user cannot stop independently.
  if (openSegment)
    throw new CLIError("Timing Receipt already has an open segment.", 2);
  const latestHistoryEpoch = latestRecordedTimingEpoch(receipt.segments);
  // A Start before visible history would overlap work and make the receipt impossible to verify.
  if (latestHistoryEpoch !== null && stamp.epochSeconds < latestHistoryEpoch)
    throw new CLIError(TIMING_ERROR.historyClock, 2);
  const next: PlanTimingSegment = {
    id: nextSegmentId(milestonePath, receipt.segments),
    category,
    startIso: stamp.iso,
    startEpochSeconds: stamp.epochSeconds,
    endIso: null,
    endEpochSeconds: null,
    seconds: null,
    state: "open",
    discardedAtIso: null,
    discardedAtEpochSeconds: null,
  };
  return {
    receipt: {
      state: receipt.state === "incomplete" ? "incomplete" : "active",
      segments: [...receipt.segments, next],
    },
    eventCategory: category,
  };
}

/** Close, discard, pause, or finalize the sole open span. */
function stopReceipt(
  receipt: PlanTimingReceipt,
  openSegment: PlanTimingSegment | null,
  transition: Extract<PlanTimeTransition, { action: "stop" }>,
  stamp: TimingStamp,
): ReceiptTransitionResult {
  validateStopTransition(receipt, openSegment, transition, stamp);
  const segments = receipt.segments.map((segment) =>
    updateStoppedSegment(segment, openSegment, transition, stamp),
  );
  const isIncomplete = receiptWillBeIncomplete(receipt, transition, segments);
  if (transition.finalize && !isIncomplete) {
    return {
      receipt: {
        state: "finalized",
        segments,
        summary: summarizeTimingReceipt(segments),
      },
      eventCategory: openSegment?.category ?? null,
    };
  }
  return {
    receipt: {
      state: isIncomplete ? "incomplete" : "paused",
      segments,
    },
    eventCategory: openSegment?.category ?? null,
  };
}

/** Reject contradictory recovery, empty finalization, and backwards clocks before mutation. */
function validateStopTransition(
  receipt: PlanTimingReceipt,
  openSegment: PlanTimingSegment | null,
  transition: Extract<PlanTimeTransition, { action: "stop" }>,
  stamp: TimingStamp,
): void {
  // Contradictory flags cannot tell the user whether the running span should count or be discarded.
  if (transition.discardOpen && transition.finalize)
    throw new CLIError("--discard-open and --finalize cannot be combined.", 2);
  // Finalizing before Start would publish a measured zero even though no clock ever ran.
  if (transition.finalize && receipt.segments.length === 0) {
    throw new CLIError(TIMING_ERROR.emptyFinalization, 2);
  }
  // A normal Stop needs the active span the user expects it to close.
  if (!openSegment && !transition.finalize)
    throw new CLIError("Timing Receipt has no open segment to stop.", 2);
  // Finalizing an already paused nonempty receipt is valid and needs no active-span clock check.
  if (!openSegment) return;

  // Discard derives no duration, so skipping clock order preserves rollback recovery.
  if (transition.discardOpen) return;
  if (stamp.epochSeconds >= openSegment.startEpochSeconds) return;
  throw new CLIError(TIMING_ERROR.openClock, 2);
}

/** Preserve incomplete state after any discarded span. */
function receiptWillBeIncomplete(
  receipt: PlanTimingReceipt,
  transition: Extract<PlanTimeTransition, { action: "stop" }>,
  segments: readonly PlanTimingSegment[],
): boolean {
  if (receipt.state === "incomplete") return true;
  if (transition.discardOpen === true) return true;
  return segments.some((segment) => segment.state === "discarded");
}

/** Transform only the matching open segment, preserving every earlier raw span. */
function updateStoppedSegment(
  segment: PlanTimingSegment,
  openSegment: PlanTimingSegment | null,
  transition: Extract<PlanTimeTransition, { action: "stop" }>,
  stamp: TimingStamp,
): PlanTimingSegment {
  if (segment !== openSegment) return segment;
  if (transition.discardOpen) {
    return {
      ...segment,
      state: "discarded",
      discardedAtIso: stamp.iso,
      discardedAtEpochSeconds: stamp.epochSeconds,
    };
  }
  return {
    ...segment,
    endIso: stamp.iso,
    endEpochSeconds: stamp.epochSeconds,
    seconds: stamp.epochSeconds - segment.startEpochSeconds,
    state: "closed",
  };
}

/** Render the Actual state derived by finalization or interruption recovery. */
function actualForReceipt(
  previousState: PlanTimingReceiptState,
  transition: Exclude<PlanTimeTransition, { action: "status" }>,
  receipt: PlanTimingReceipt,
): string | null {
  if (transition.action === "start" && previousState === "finalized") {
    return "**Actual:** _";
  }
  if (receipt.state === "finalized" && receipt.summary) {
    return renderActualLine({
      state: "measured",
      totalMinutes: receipt.summary.totalMinutes,
      split: receipt.summary.minutes,
      reason: `receipt ${receipt.summary.totalSeconds} recorded-unpaused seconds`,
    });
  }
  if (receipt.state === "incomplete") {
    return renderActualLine({
      state: "incomplete",
      reason: "receipt contains a discarded open span",
    });
  }
  return null;
}

/** Attempt bounded diagnostic metadata only after the receipt write succeeds. */
function recordTimingEvent(
  context: PlanFileContext,
  transition: Exclude<PlanTimeTransition, { action: "status" }>,
  receipt: PlanTimingReceipt,
  category: PlanTimeCategory | null,
  stamp: TimingStamp,
): AppendEvidenceEnvelopeResult {
  return recordEvidenceEvent(
    {
      producer: "plans-time",
      eventType: "plan.time",
      actor: "cli",
      projectRoot: context.projectRoot,
      timestamp: stamp.iso,
      payload: {
        action: transition.action,
        category,
        receipt_state: receipt.state,
        segment_count: receipt.segments.length,
        finalized_total_seconds: receipt.summary?.totalSeconds ?? null,
      },
    },
    { onWarning: () => undefined },
  );
}

/** Safely apply one user timing action; optional clocks and callbacks support deterministic tests.
 * @param milestoneInputPath - milestone selected by the user; empty or invalid paths are rejected
 * @param transition - requested timing action; status reads without writing or recording an event
 * @param nowEpochSeconds - system-clock instant; omitted means capture the current whole second
 * @param beforeMilestoneReplacement - test-only editor-save simulation; omitted for user commands
 * @returns the verified project, updated receipt, and best-effort diagnostic event result
 * @throws CLIError - when the path, receipt, transition, clock, or atomic write is invalid
 */
export function applyPlanTimeTransition(
  milestoneInputPath: string,
  transition: PlanTimeTransition,
  nowEpochSeconds?: number,
  beforeMilestoneReplacement?: BeforeMilestoneReplacement,
): PlanTimeCommandResult {
  const context = resolvePlanFileContext(milestoneInputPath);
  const content = readFileSync(context.milestonePath, "utf-8");

  // Start is available only while the milestone shows one active execution state to the user.
  if (transition.action === "start") {
    const milestoneStatuses = readRenderedMarkdownFieldValues(
      content,
      "Status",
    );
    // Missing, competing, empty, or inactive values leave no trustworthy execution state.
    const hasOneActiveMilestoneStatus =
      milestoneStatuses.length === 1 &&
      ["in-progress", "testing-gate"].includes(
        milestoneStatuses[0]?.toLowerCase() ?? "",
      );
    // Without one active state, no new clock starts; later receipt recovery remains available.
    if (!hasOneActiveMilestoneStatus) {
      throw new CLIError(
        "Timing Start requires exactly one rendered Status field set to `in-progress` or `testing-gate`.",
        2,
      );
    }
  }

  const receipt = readReceipt(content);

  // Status lets the author inspect existing evidence without changing the milestone or its clock.
  if (transition.action === "status") {
    // Without recorded work, there is no receipt state for the command to show.
    if (receipt.segments.length === 0) {
      throw new CLIError("Milestone has no Timing Receipt yet.", 2);
    }
    return {
      action: transition.action,
      milestonePath: context.milestonePath,
      projectRoot: context.projectRoot,
      receipt,
      event: { ok: true, path: null },
    };
  }

  // User commands omit the deterministic test clock and use the current whole second.
  const transitionEpochSeconds =
    nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const stamp = stampFromEpoch(transitionEpochSeconds);
  const transitioned = transitionReceipt(
    receipt,
    transition,
    stamp,
    context.milestonePath,
  );
  let nextContent = writeReceiptSection(content, transitioned.receipt);
  const actualLine = actualForReceipt(
    receipt.state,
    transition,
    transitioned.receipt,
  );
  // Finalize or discard updates the Actual line the author reads beside the estimate.
  if (actualLine) nextContent = writeActualField(nextContent, actualLine);
  writeMilestoneAtomically(
    context,
    content,
    nextContent,
    beforeMilestoneReplacement,
  );
  const event = recordTimingEvent(
    context,
    transition,
    transitioned.receipt,
    transitioned.eventCategory,
    stamp,
  );
  return {
    action: transition.action,
    milestonePath: context.milestonePath,
    projectRoot: context.projectRoot,
    receipt: transitioned.receipt,
    event,
  };
}

/** Render timing output according to the shared CLI format field. */
function renderPlanTimeResult(
  options: ParsedCLI,
  result: PlanTimeCommandResult,
): string {
  if (options.format === "json") return JSON.stringify(result, null, 2);
  if (options.format === "markdown") {
    return [
      `**Action:** ${result.action}`,
      `**Milestone:** ${result.milestonePath}`,
      `**Receipt state:** ${result.receipt.state}`,
      `**Segments:** ${result.receipt.segments.length}`,
      `**Event recorded:** ${result.event.ok ? "yes" : "no"}`,
    ].join("\n");
  }
  return [
    `action: ${result.action}`,
    `milestone: ${result.milestonePath}`,
    `receipt: ${result.receipt.state}`,
    `segments: ${result.receipt.segments.length}`,
    `event: ${result.event.ok ? "recorded" : "not recorded"}`,
  ].join("\n");
}

/** Dispatch parsed `plans time` fields into the safe timing transition.
 * @param options - parsed CLI request; absent timing fields produce a usage error
 * @throws CLIError - when the action or its required category is missing or invalid
 */
export function handlePlansTimeCommand(options: ParsedCLI): void {
  const action = options.plansTimeAction;
  if (action === null) {
    throw new CLIError("plans time requires start, stop, or status.", 2);
  }
  let transition: PlanTimeTransition;
  if (action === "start") {
    if (options.plansTimeCategory === null) {
      throw new CLIError("plans time start requires --category.", 2);
    }
    transition = { action, category: options.plansTimeCategory };
  } else if (action === "stop") {
    transition = {
      action,
      finalize: options.plansTimeFinalize,
      discardOpen: options.plansTimeDiscardOpen,
    };
  } else {
    transition = { action };
  }
  const result = applyPlanTimeTransition(options.projectPath, transition);
  if (!result.event.ok && result.event.error) {
    console.error(`warning: timing receipt saved; ${result.event.error}`);
  }
  writeOutput(options, renderPlanTimeResult(options, result));
}
