// goat-flow-hook-version: 1.17.0
/**
 * Owns bounded execution and recovery for a managed hook.
 *
 * The launcher captures output, enforces deadlines, and renders one provider-visible result when a hook stalls, floods output, or exits unexpectedly.
 * Use this module when the coding agent must receive a bounded outcome instead of waiting on child processes.
 */
import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";

const VERIFIED_CODEX_STOP_MODE = "codex:post-turn:goat-flow.hook-result.v1:turn-stop:1:75000";
const STOP_INPUT_LIMIT_BYTES = 1_048_576; // Cap: accepts a native Stop payload, including any long final message it carries, without an unbounded wait or buffer.
const STOP_RECOVERY_FAILURE_CODE_LIMIT = 64; // Cap: leaves room for the recovery explanation inside the user's provider reply.
const STOP_RECOVERY_RECORD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // Cap: no Stop cycle lasts a week, so older sibling records are stale.

/** Validate the native Stop identity once, before a missing scanner or broken adapter can bypass recovery.
 *
 * Error behavior: malformed input and read failures recover to invalid context, keeping the user's turn blocked.
 * Side effects: consumes bounded host stdin; accepted bytes are retained unchanged for the scanner.
 *
 * @param {string} responseMode - registered mode; other modes keep their existing lifecycle behavior
 * @param {string} projectRoot - selected project; an inaccessible root cannot establish a safe cycle
 * @param {NodeJS.ReadableStream} inputStream - original host bytes; empty input is invalid in this verified mode
 * @returns {Promise<object | null>} accepted context and unchanged input, invalid context, or null for an unverified mode
 */
export async function readManagedStopContext(responseMode, projectRoot, inputStream = process.stdin) {
  // Other provider modes retain their established scanner-owned re-entry contract.
  if (responseMode !== VERIFIED_CODEX_STOP_MODE) return null;
  const deadlineAt = Date.now() + 75_000;
  const acceptedInput = await new Promise((resolveInput) => {
    const inputChunks = [];
    let inputBytes = 0;
    let hasFinished = false;
    const inputDeadline = setTimeout(() => finishInput(null), 75_000);
    /** Finish reading once; null means the host could not supply a bounded Stop payload.
     *
     * @param {Buffer | null} input - Original bytes, or null after a flood, read error or deadline.
     * @returns {void} No value; releases listeners before the user receives a response.
     */
    function finishInput(input) {
      // A late EOF after a rejected payload cannot start another scan.
      if (hasFinished) return;
      hasFinished = true;
      clearTimeout(inputDeadline);
      inputStream.removeListener("data", receiveInput);
      inputStream.removeListener("end", endInput);
      inputStream.removeListener("error", failInput);
      // A rejected input must not leave the launcher waiting for more host bytes.
      if (input === null) inputStream.destroy?.();
      resolveInput(input);
    }
    /** Retain original bytes until EOF; an oversized Stop cannot identify the user's turn.
     *
     * @param {Buffer | string} chunk - Host bytes; empty data changes nothing.
     * @returns {void} No value; exceeding the cap ends validation.
     */
    function receiveInput(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      inputBytes += bytes.length;
      // A provider input flood is invalid context, never an exhausted recovery allowance.
      if (inputBytes > STOP_INPUT_LIMIT_BYTES) return finishInput(null);
      inputChunks.push(bytes);
    }
    /** Complete the original payload after the provider closes its input.
     *
     * @returns {void} No value; an empty buffer is rejected during field validation.
     */
    function endInput() { finishInput(Buffer.concat(inputChunks)); }
    /** Reject a truncated host payload rather than running the user's scanner with guessed identity.
     *
     * @returns {void} No value; a read error has no accepted bytes.
     */
    function failInput() { finishInput(null); }
    inputStream.on("data", receiveInput);
    inputStream.once("end", endInput);
    inputStream.once("error", failInput);
  });
  try {
    // Missing or empty bytes mean this registered Stop has no verified user-cycle context.
    if (acceptedInput === null || acceptedInput.length === 0) return { state: "invalid" };
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(acceptedInput));
    const hasValidIdentity = [payload?.session_id, payload?.turn_id].every((identity) =>
      typeof identity === "string" && identity.trim().length > 0 && Buffer.byteLength(identity) <= 512);
    // A wrong event, missing turn or guessed active flag must stay blocking.
    if (!hasValidIdentity || payload.hook_event_name !== "Stop" || typeof payload.stop_hook_active !== "boolean") {
      return { state: "invalid" };
    }
    const canonicalProjectRoot = realpathSync(projectRoot);
    const cycleKey = createHash("sha256").update(JSON.stringify([
      "codex", canonicalProjectRoot, payload.session_id, payload.turn_id,
    ])).digest("hex");
    return { state: "valid", acceptedInput, projectRoot: canonicalProjectRoot, cycleKey, isContinuation: payload.stop_hook_active, deadlineAt };
  } catch {
    // For example, a provider may truncate its Stop JSON while closing the user's turn.
    return { state: "invalid" };
  }
}

/** Read or exclusively create one private allowance record; never repair foreign, linked or corrupt state.
 *
 * Side effects: writes one owned record because concurrent deliveries must share the same allowance.
 * Error behavior: swallows unsafe or failed state access into an unavailable warning for the user.
 *
 * @param {object} stopContext - validated project and cycle hashes; missing context is rejected by the caller
 * @param {string} failureKey - fixed infrastructure identity; empty would obscure which retry was issued
 * @returns {"retry-scheduled" | "exhausted" | "state-unavailable"} one allowance, retained exhaustion, or unsafe state
 */
function recordStopRecoveryAllowance(stopContext, failureKey) {
  let stateDescriptor = null;
  try {
    // Native Windows has no POSIX owner or mode bits, so null leaves ownership to the workspace ACLs that other Stop modes already rely on.
    // For example, Codex Desktop on Windows working on a WSL checkout over \\wsl.localhost still receives its one retry.
    const ownerId = process.getuid?.() ?? (process.platform === "win32" ? null : undefined);
    // Another host without an ownership check receives an unavailable warning instead of a guessed retry.
    if (ownerId === undefined) return "state-unavailable";
    const statePath = prepareStopRecoveryStatePath(stopContext, ownerId);
    // Unsafe parent directories cannot hold a trustworthy allowance for this user.
    if (statePath === null) return "state-unavailable";
    const openedAllowance = openStopRecoveryAllowance(stopContext, statePath);
    // Missing or unsafe state cannot authorize another retry for the user's active turn.
    if (openedAllowance === null) return "state-unavailable";
    stateDescriptor = openedAllowance.descriptor;
    // Only an exclusively created initial record spends this turn allowance for the first time.
    if (openedAllowance.isNewRecord) {
      writeFileSync(stateDescriptor, JSON.stringify({ version: 1, cycleKey: stopContext.cycleKey, failureKey, retrySpent: true }) + "\n");
      // Pruning runs only while this cycle writes its own record, so a read-only continuation never deletes anything.
      pruneStaleStopRecoveryRecords(statePath, ownerId);
      return "retry-scheduled";
    }
    return stopRecoveryRecordIsSafe(stateDescriptor, ownerId, stopContext.cycleKey) ? "exhausted" : "state-unavailable";
  } catch {
    // For example, the user may lose access to scratchpad or another tool may truncate its recovery record.
    return "state-unavailable";
  } finally {
    // No open record handle should keep the user's project busy after delivery.
    if (stateDescriptor !== null) closeSync(stateDescriptor);
  }
}

/** Open retained state or exclusively create the first allowance for this user's turn.
 *
 * Side effects: opens a record; the caller writes new state and closes the returned handle.
 * Error behavior: ordinary missing/unsafe state returns null; unexpected read-open errors reach the caller's unavailable fallback.
 *
 * @param {object} stopContext - Verified cycle; an active continuation cannot create missing state.
 * @param {string} statePath - Owned, contained record path; empty cannot identify an allowance.
 * @returns {{descriptor: number, isNewRecord: boolean} | null} Open handle, or null when the user must repair unavailable state.
 */
function openStopRecoveryAllowance(stopContext, statePath) {
  try {
    const statePathShape = lstatSync(statePath);
    // Special or linked files cannot authorize recovery and must not block the user's wait.
    if (!statePathShape.isFile() || statePathShape.isSymbolicLink()) return null;
    return { descriptor: openSync(statePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK), isNewRecord: false };
  } catch (error) {
    // For example, an active callback may arrive without its initial record after the user cleared scratchpad.
    if (error.code !== "ENOENT" || stopContext.isContinuation) return null;
  }
  try {
    return { descriptor: openSync(statePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600),
      isNewRecord: true };
  } catch (error) {
    // Simultaneous initial callbacks share one record; a permissions failure keeps state unavailable.
    if (error.code !== "EEXIST") return null;
    return { descriptor: openSync(statePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK), isNewRecord: false };
  }
}

/** Confirm retained state belongs to this user and proves this exact turn already spent its allowance.
 *
 * Error behavior: malformed or unreadable records reach the caller's unavailable-state warning.
 *
 * @param {number} stateDescriptor - Open record handle; the caller owns its cleanup.
 * @param {number | null} ownerId - Current OS owner; null on native Windows, where workspace ACLs replace the owner and mode checks.
 * @param {string} cycleKey - Verified turn hash; an empty or mismatched hash cannot establish exhaustion.
 * @returns {boolean} True for a private, complete matching record; false leaves state unavailable.
 */
function stopRecoveryRecordIsSafe(stateDescriptor, ownerId, cycleKey) {
  const stateShape = fstatSync(stateDescriptor);
  // A hard link, foreign owner, shared mode or oversized record cannot authorize release of the user's turn.
  if (!stateShape.isFile() || stateShape.nlink !== 1 || stateShape.size > 512 ||
      (ownerId !== null && (stateShape.uid !== ownerId || (stateShape.mode & 0o777) !== 0o600))) return false;
  const record = JSON.parse(readFileSync(stateDescriptor, "utf8"));
  return record.version === 1 && record.cycleKey === cycleKey && record.retrySpent === true &&
    typeof record.failureKey === "string" && /^[a-f0-9]{64}$/u.test(record.failureKey) && Object.keys(record).length === 4;
}

/** Establish private, owned directories before the launcher records the user's allowance.
 *
 * Side effects: creates missing managed directories; existing safe directories stay intact.
 * Error behavior: throws filesystem failures to the caller's unavailable-state fallback.
 *
 * @param {object} stopContext - Verified project and cycle; missing context is rejected before calling.
 * @param {number | null} ownerId - Current OS owner; null on native Windows, where workspace ACLs replace the owner and mode checks.
 * @returns {string | null} Owned record path, or null when a substituted directory makes recovery unavailable.
 */
function prepareStopRecoveryStatePath(stopContext, ownerId) {
  let stateDirectory = stopContext.projectRoot;
  // Each managed parent must belong to this user; a linked scratchpad must never redirect a state write.
  for (const directoryName of [".goat-flow", "scratchpad"]) {
    stateDirectory = join(stateDirectory, directoryName);
    try { mkdirSync(stateDirectory, { mode: 0o700 }); } catch (error) {
      // Existing directories are normal after install; a permission failure leaves recovery unavailable.
      if (error.code !== "EEXIST") throw error;
    }
    const directoryShape = lstatSync(stateDirectory);
    // A substituted, linked or shared-writable directory could replace the user's allowance record; Windows junctions read as links.
    if (!directoryShape.isDirectory() || directoryShape.isSymbolicLink() ||
        (ownerId !== null && (directoryShape.uid !== ownerId || (directoryShape.mode & 0o022) !== 0))) return null;
  }
  return join(stateDirectory, `post-turn-launcher-recovery-v1-${stopContext.cycleKey}.state`);
}

/** Remove this user's week-old allowance records so a long-lived project does not keep one file for every past failure.
 *
 * Side effects: unlinks only owned, single-link regular records older than the retention window; the record for the current cycle stays.
 * Error behavior: swallows every filesystem failure, because cleanup must never change the Stop result the user is about to receive.
 *
 * @param {string} currentStatePath - Record just created for this cycle; it is never a removal candidate.
 * @param {number | null} ownerId - Current OS owner whose records may go; null on native Windows, where the workspace ACLs decide.
 * @returns {number} Removed record count, including removals made before a filesystem failure ended cleanup early.
 */
function pruneStaleStopRecoveryRecords(currentStatePath, ownerId) {
  const stateDirectory = dirname(currentStatePath);
  const staleBefore = Date.now() - STOP_RECOVERY_RECORD_RETENTION_MS;
  let removedRecordCount = 0;
  try {
    for (const recordName of readdirSync(stateDirectory)) {
      const recordPath = join(stateDirectory, recordName);
      // Only this launcher's own hash-named records are candidates; everything else in scratchpad belongs to the user.
      if (!/^post-turn-launcher-recovery-v1-[a-f0-9]{64}\.state$/u.test(recordName) || recordPath === currentStatePath) continue;
      const recordShape = lstatSync(recordPath);
      // A recent, linked, foreign or non-regular entry is left for its owner or for the safety checks that read it.
      if (!recordShape.isFile() || recordShape.nlink !== 1 || (ownerId !== null && recordShape.uid !== ownerId) ||
          recordShape.mtimeMs >= staleBefore) continue;
      unlinkSync(recordPath);
      removedRecordCount += 1;
    }
  } catch {
    // For example, a concurrent delivery may remove the same stale record first; whatever remains waits for the next new cycle.
    return removedRecordCount;
  }
  return removedRecordCount;
}

/** Apply the accepted infrastructure exception after each fresh scan, preserving findings and declared coverage gaps.
 *
 * @param {object} hookResult - validated neutral result; pass and genuine blocks never consume this allowance
 * @param {object | null} stopContext - verified native context; null retains the previous provider contract
 * @returns {object} result with one retry or visible terminal recovery metadata; incomplete coverage never becomes pass
 */
export function applyManagedStopRecovery(hookResult, stopContext) {
  // Only the verified Codex Stop lifecycle and explicitly classified infrastructure can use this exception.
  if (stopContext?.state !== "valid" || hookResult.execution.provider !== "codex" || hookResult.event !== "turn-stop" ||
      !["unavailable", "incomplete"].includes(hookResult.outcome) || hookResult.execution.failureClass !== "infrastructure") return hookResult;
  const failureKey = createHash("sha256").update(JSON.stringify([
    hookResult.reasonCode, hookResult.execution.failureClass, hookResult.execution.output?.failureStage ?? "none",
    hookResult.findings.map((finding) => [finding.code, finding.message]),
  ])).digest("hex");
  const recoveryState = recordStopRecoveryAllowance(stopContext, failureKey);
  const recoveredResult = {
    ...hookResult,
    execution: { ...hookResult.execution, recovery: { state: recoveryState, failureCode: hookResult.reasonCode } },
  };
  // The first failure requests one retry while keeping its actual unavailable coverage.
  if (recoveryState === "retry-scheduled") return recoveredResult;
  // Unsafe state is a separate unavailable warning; it does not pretend the retry allowance was exhausted.
  if (recoveryState === "state-unavailable") return { ...recoveredResult, outcome: "unavailable" };
  return { ...recoveredResult, outcome: "incomplete", reasonCode: "bounded-reentry-ended" };
}

/** Render the verified Codex terminal recovery warning without overriding another matching hook's block.
 *
 * @param {object} hookResult - classified unavailable result; empty context cannot authorize a warning
 * @returns {string | null} complete warning JSON, or null when the result must retain its ordinary block
 */
export function codexStopRecoveryWarning(hookResult) {
  const recovery = hookResult.execution.recovery;
  // A scheduled retry, genuine finding or another provider retains its ordinary enforcement response.
  if (hookResult.execution.provider !== "codex" || !["unavailable", "incomplete"].includes(hookResult.outcome) ||
      !["exhausted", "state-unavailable"].includes(recovery?.state)) return null;
  const classification = recovery.state === "exhausted" ? "bounded-reentry-ended" : "state-unavailable";
  const output = hookResult.execution.output;
  const outputSummary = output
    ? ` Output: ${output.areByteCountsExact ? "exact" : "at least"} ${output.stdoutBytes} stdout / ${output.stderrBytes} stderr bytes; stage ${output.failureStage ?? "completed"}; limits ${output.envelopeLimitBytes}/${output.stderrRetentionLimitBytes}/${output.stderrFloodLimitBytes}/${output.providerLimitBytes} bytes.`
    : "";
  return JSON.stringify({ systemMessage: `post-turn-safety: ${classification} (${recovery.failureCode}); no clean scan was recorded; coverage ${hookResult.coverage.status}. Repair hook infrastructure and retry the check.${outputSummary}` }) + "\n";
}

/**
 * Bounded state returned after a managed hook reaches its first terminal event.
 *
 * @typedef {object} CapturedHookProcessResult
 * @property {number | null} status - child exit code; null means no trustworthy status arrived
 * @property {boolean} timedOut - true when the user's configured deadline ended the hook
 * @property {Error | null} launchError - startup failure; null means the child started or no startup error was reported
 * @property {string} stdout - bounded captured output; empty means feedback relay or no child output
 * @property {string} stderr - bounded captured diagnostic; empty means the child reported no error text
 * @property {boolean} hasExceededOutputLimit - true when feedback was stopped before it could flood the coding agent
 * @property {object | undefined} output - raw-byte measurements; absent means no captured child stream arrived
 * @property {boolean} hasInvalidUtf8Output - true when damaged child text cannot prove a completed scan
 */

/**
 * Provider-facing result prepared after launcher-owned validation or delivery work.
 *
 * @typedef {object} ProviderLauncherDelivery
 * @property {"delivered" | "unavailable"} state - whether the coding agent received a valid provider response
 * @property {number} [exitCode] - provider status; absent when adaptation could not produce a response
 * @property {string} [reason] - practical failure reason; absent after successful delivery
 * @property {string} stdout - bounded provider output; empty when delivery is unavailable or intentionally silent
 * @property {string} stderr - bounded diagnostic; empty when no human-only detail exists
 */

export const HOOK_RESULT_OUTPUT_LIMIT_BYTES = 10_000; // Cap: fits Copilot's smallest feedback channel.
export const HOOK_RESULT_ENVELOPE_LIMIT_BYTES = 65_536; // Cap: retains scan detail independently of the final provider reply.
export const HOOK_STDERR_RETENTION_LIMIT_BYTES = 4096; // Cap: keeps actionable diagnostics without repeating a large scan.
export const HOOK_STDERR_FLOOD_LIMIT_BYTES = 1_048_576; // Cap: stops a diagnostic flood while ordinary excess is drained.
const capturedStreamStates = new WeakMap();

/** Validate optional recovery, output and omission facts before they reach an agent or status screen.
 *
 * @param {object} hookResult - Neutral envelope; absent optional metadata retains the legacy contract.
 * @returns {string | null} Visible rejection reason, or null when supplied facts are coherent.
 */
export function hookResultMetadataFailureReason(hookResult) {

  const execution = hookResult.execution;
  // Only the fixed infrastructure label can qualify an unavailable Stop for bounded recovery.
  if (execution.failureClass !== undefined && execution.failureClass !== "infrastructure") return "execution failure class is invalid";
  return stopRecoveryMetadataFailureReason(hookResult) ?? hookOutputMetadataFailureReason(hookResult) ?? findingSummaryFailureReason(hookResult);
}

/** Reject recovery facts that could release a genuine finding or misstate an exhausted turn.
 *
 * @param {object} hookResult - Neutral result; absent optional facts preserve the legacy contract.
 * @returns {string | null} Rejection reason, or null when supplied facts agree.
 */
function stopRecoveryMetadataFailureReason(hookResult) {
  const execution = hookResult.execution;
  const recovery = execution.recovery;
  // Older results carry no recovery facts and retain their existing outcome.
  if (recovery === undefined) return null;
  // Supplied recovery must belong to an incomplete Codex Stop, with a stable underlying failure classification.
  if (!stopRecoveryShapeIsValid(recovery) ||
      execution.failureClass !== "infrastructure" || execution.provider !== "codex" || hookResult.event !== "turn-stop" ||
      !["unavailable", "incomplete"].includes(hookResult.outcome)) return "execution recovery metadata is invalid";
  return stopRecoveryOutcomeFailureReason(hookResult, recovery);
}

/** Keep an exhausted or inaccessible retry distinct from a clean safety scan.
 *
 * @param {object} hookResult - Neutral Stop result whose recovery shape has already been checked.
 * @param {object} recovery - Validated retry state; retry-scheduled has no terminal-outcome constraint.
 * @returns {string | null} Rejection reason, or null when the visible outcome matches that retry state.
 */
function stopRecoveryOutcomeFailureReason(hookResult, recovery) {
  // A spent allowance ends with incomplete coverage and its explicit terminal reason.
  if (recovery.state === "exhausted" &&
      (hookResult.outcome !== "incomplete" || hookResult.reasonCode !== "bounded-reentry-ended"))
    return "execution recovery outcome is invalid";
  // Inaccessible state cannot claim exhaustion or a successful scan.
  if (recovery.state === "state-unavailable" && hookResult.outcome !== "unavailable") return "execution recovery outcome is invalid";
  return null;
}

/** Check the recovery record before its state can affect the user turn.
 *
 * @param {unknown} recovery - Untrusted optional record; null cannot describe a retry.
 * @returns {boolean} True when the state and fixed failure code have the supported shape.
 */
function stopRecoveryShapeIsValid(recovery) {
  // Damaged metadata cannot authorize the agent to end its safety retry.
  if (recovery === null || typeof recovery !== "object") return false;
  return typeof recovery.state === "string" && ["retry-scheduled", "exhausted", "state-unavailable"].includes(recovery.state) &&
    typeof recovery.failureCode === "string" && recovery.failureCode.length <= STOP_RECOVERY_FAILURE_CODE_LIMIT &&
    /^[a-z]+(?:-[a-z]+)*$/u.test(recovery.failureCode);
}

/** Check raw-byte facts before the user sees an exact or lower-bound output summary.
 *
 * @param {object} hookResult - Neutral result; absent optional facts preserve the legacy contract.
 * @returns {string | null} Rejection reason, or null when supplied facts agree.
 */
function hookOutputMetadataFailureReason(hookResult) {
  // Outer and aggregate child measurements name their own byte stage; either may be absent for older hooks.
  for (const output of [hookResult.execution.output, hookResult.execution.childOutput]) {
    // Counts and limits describe bytes, with exact totals reserved for normally completed child streams.
    if (output !== undefined && !hookOutputShapeIsValid(output)) return "execution output metadata is invalid";
  }
  return null;
}

/** Check measured byte facts before a reply describes output as exact, shortened or interrupted.
 *
 * @param {unknown} output - Untrusted measurement; null cannot describe a completed child stream.
 * @returns {boolean} True when counts, stage and limits match the managed capture contract.
 */
function hookOutputShapeIsValid(output) {
  // Missing stream facts cannot justify byte counts shown beside a user safety result.
  if (output === null || typeof output !== "object") return false;
  const expectedLimits = {
    envelopeLimitBytes: HOOK_RESULT_ENVELOPE_LIMIT_BYTES, stderrRetentionLimitBytes: HOOK_STDERR_RETENTION_LIMIT_BYTES,
    stderrFloodLimitBytes: HOOK_STDERR_FLOOD_LIMIT_BYTES, providerLimitBytes: HOOK_RESULT_OUTPUT_LIMIT_BYTES,
  };
  return Object.entries(expectedLimits).every(([name, limit]) => output[name] === limit) &&
    [output.stdoutBytes, output.stderrBytes].every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0) &&
    typeof output.areByteCountsExact === "boolean" && typeof output.isStderrTruncated === "boolean" &&
    (output.failureStage === undefined || typeof output.failureStage === "string" && ["envelope", "diagnostic-flood"].includes(output.failureStage));
}

/** Keep omitted findings distinct from skipped coverage and count each omission once.
 *
 * @param {object} hookResult - Neutral result; absent optional facts preserve the legacy contract.
 * @returns {string | null} Rejection reason, or null when supplied facts agree.
 */
function findingSummaryFailureReason(hookResult) {
  const summary = hookResult.summary;
  // Omitted findings count once at their owning stage; skipped files remain coverage gaps instead.
  if (summary !== undefined && (summary === null || typeof summary !== "object" ||
      ![summary.detectedFindings, summary.envelopeOmittedFindings, summary.presentationOmittedFindings]
        .every((count) => Number.isSafeInteger(count) && count >= 0) ||
      summary.detectedFindings !== hookResult.findings.length + summary.envelopeOmittedFindings + summary.presentationOmittedFindings ||
      summary.areDetailsShortened !== undefined && typeof summary.areDetailsShortened !== "boolean")) return "result summary metadata is invalid";
  return null;
}

/** Shorten one finding detail at a UTF-8 boundary without cutting serialized JSON.
 *
 * @param {string} userDetail - Human detail; empty text remains empty.
 * @param {number} maximumBytes - Retained prefix budget; zero retains no detail.
 * @returns {string} Original detail or a readable shortened prefix with an ellipsis.
 */
export function shortenHookDetail(userDetail, maximumBytes) {
  const detailBytes = Buffer.from(userDetail);
  // Ordinary finding detail stays unchanged in the agent's reply.
  if (detailBytes.length <= maximumBytes) return userDetail;
  return new StringDecoder("utf8").write(detailBytes.subarray(0, Math.max(0, maximumBytes - 3))) + "…";
}

/** Fit a scanner result into its internal envelope while preserving its decision and coverage.
 *
 * Invariant: detected omissions count once; incomplete infrastructure explanations are not safety findings.
 *
 * @param {object} hookResult - Scanner result; empty findings retain reason-only feedback.
 * @returns {object} Bounded result with separate retained and omitted finding counts.
 */
export function compactHookResultEnvelope(hookResult) {
  // Infrastructure explanations and skipped units are not detected safety findings.
  if (hookResult.summary === undefined && hookResult.outcome !== "block") return hookResult;
  const allFindings = hookResult.findings;
  const priorOmissions = hookResult.summary?.envelopeOmittedFindings ?? 0;
  const retainedFindings = allFindings.slice(0, 20);
  let result = { ...hookResult, findings: retainedFindings, summary: {
    detectedFindings: hookResult.summary?.detectedFindings ?? allFindings.length + priorOmissions,
    envelopeOmittedFindings: priorOmissions + allFindings.length - retainedFindings.length,
    presentationOmittedFindings: 0,
  } };
  // Long filenames or messages can consume the envelope even when the finding count is bounded.
  if (Buffer.byteLength(JSON.stringify(result) + "\n") > HOOK_RESULT_ENVELOPE_LIMIT_BYTES) {
    result = { ...result, findings: result.findings.map((finding) => ({
      ...finding, code: shortenHookDetail(finding.code, 256), message: shortenHookDetail(finding.message, 1024),
      ...(finding.target === undefined ? {} : { target: shortenHookDetail(finding.target, 1024) }),
    })), summary: { ...result.summary, areDetailsShortened: true } };
  }
  return result;
}

/**
 * Retain hook output without letting diagnostics discard the user's completed scan.
 *
 * Side effects: counts raw bytes and appends decoded text; managed streams use independent ceilings while legacy policy retains its shared cap.
 *
 * @param {object} capturedHookOutput - retained streams; managed=true selects separate budgets, while an absent flag retains legacy capture
 * @param {"stdout" | "stderr"} outputStreamName - channel receiving the next chunk
 * @param {Buffer | string} outputChunk - next child bytes
 * @returns {boolean} false when the next chunk would exceed the limit; the caller stops the hook.
 */
export function appendBoundedHookOutput(
  capturedHookOutput,
  outputStreamName,
  outputChunk,
) {
  let streamState = capturedStreamStates.get(capturedHookOutput);
  // A fresh capture counts original bytes so a split character cannot change the user's result.
  if (streamState === undefined) {
    streamState = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8"), stdoutBytes: 0, stderrBytes: 0, stderrRetainedBytes: 0, stdoutChunks: [] };
    capturedStreamStates.set(capturedHookOutput, streamState);
  }
  const chunkBytes = Buffer.isBuffer(outputChunk) ? outputChunk : Buffer.from(outputChunk);
  streamState[`${outputStreamName}Bytes`] += chunkBytes.length;
  const isManagedResult = capturedHookOutput.managed === true;
  // Legacy policy output retains its original shared ceiling and fail-closed behavior.
  if (!isManagedResult && streamState.stdoutBytes + streamState.stderrBytes > HOOK_RESULT_OUTPUT_LIMIT_BYTES) return false;
  capturedHookOutput.output = {
    envelopeLimitBytes: HOOK_RESULT_ENVELOPE_LIMIT_BYTES, stderrRetentionLimitBytes: HOOK_STDERR_RETENTION_LIMIT_BYTES,
    stderrFloodLimitBytes: HOOK_STDERR_FLOOD_LIMIT_BYTES, providerLimitBytes: HOOK_RESULT_OUTPUT_LIMIT_BYTES,
    stdoutBytes: streamState.stdoutBytes, stderrBytes: streamState.stderrBytes,
    areByteCountsExact: false, isStderrTruncated: isManagedResult && streamState.stderrBytes > HOOK_STDERR_RETENTION_LIMIT_BYTES,
  };
  // An oversized envelope or diagnostic flood leaves this scan unavailable, even if JSON arrived earlier.
  if (isManagedResult && (streamState.stdoutBytes > HOOK_RESULT_ENVELOPE_LIMIT_BYTES || streamState.stderrBytes > HOOK_STDERR_FLOOD_LIMIT_BYTES)) {
    capturedHookOutput.output.failureStage = outputStreamName === "stdout" ? "envelope" : "diagnostic-flood";
    return false;
  }
  let retainedBytes = chunkBytes;
  // Retained original stdout supports strict validation after EOF, without treating chunk boundaries as damaged text.
  if (outputStreamName === "stdout") streamState.stdoutChunks.push(chunkBytes);
  // Diagnostic excess is drained and counted; only its bounded prefix is shown to the user.
  if (isManagedResult && outputStreamName === "stderr") {
    retainedBytes = chunkBytes.subarray(0, Math.max(0, HOOK_STDERR_RETENTION_LIMIT_BYTES - streamState.stderrRetainedBytes));
    streamState.stderrRetainedBytes += retainedBytes.length;
  }
  capturedHookOutput[outputStreamName] += streamState[outputStreamName].write(retainedBytes);
  return true;
}

const MANAGED_HOOK_IDENTIFIERS_BY_RESPONSE_KIND = new Map([
  ["policy", "deny-dangerous"],
  ["gruff", "gruff-code-quality"],
  ["post-turn", "post-turn-safety"],
]);

/**
 * Select a safe user wait below the registered host deadline.
 * Use before launch so invalid overrides cannot leave the coding agent waiting indefinitely.
 * Reject only unusable waits; an empty override uses the ceiling and a larger override is clamped to keep policy available.
 *
 * @param {number} timeoutCeiling - validated host deadline; zero or missing values are rejected earlier
 * @param {NodeJS.ProcessEnv} hookEnvironment - hook settings; missing or empty uses the ceiling, while a larger override is clamped
 * @returns {number | null} timeout in milliseconds, or null when the user override is not a whole number of milliseconds of at least 1
 */
export function resolveHookLaunchTimeoutMs(timeoutCeiling, hookEnvironment) {
  const configuredUserTimeout =
    hookEnvironment.GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS;
  // `export VAR=` arrives as "" rather than undefined; both mean "use the mode ceiling", which stays below host limits.
  if (configuredUserTimeout === undefined || configuredUserTimeout === "") {
    return timeoutCeiling;
  }
  // Only a plain decimal is a wait; signs, spaces, and fractions are ambiguous.
  if (!/^[0-9]+$/u.test(configuredUserTimeout)) return null;
  const configuredTimeoutMilliseconds = Number(configuredUserTimeout);
  // Zero would time out before the hook starts, so it cannot bound the user's wait.
  if (configuredTimeoutMilliseconds < 1) return null;
  // A larger override cannot exceed the bounded host contract; the ceiling is the closest safe wait.
  return Math.min(configuredTimeoutMilliseconds, timeoutCeiling);
}

/**
 * Explain a rejected timeout override so the user can repair one setting instead of reading launcher source.
 * Use only after resolveHookLaunchTimeoutMs returned null for the same ceiling and environment.
 *
 * @param {number} timeoutCeiling - validated host deadline named as the accepted maximum
 * @param {NodeJS.ProcessEnv} hookEnvironment - hook settings whose override was rejected; a missing value is reported as ""
 * @returns {string} failure reason naming the variable, the supplied value, and the accepted range
 */
export function describeInvalidHookLaunchTimeout(
  timeoutCeiling,
  hookEnvironment,
) {
  const configuredUserTimeout =
    hookEnvironment.GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS ?? "";
  return `hook timeout configuration is invalid: GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS=${JSON.stringify(configuredUserTimeout)} must be a whole number of milliseconds from 1 to ${timeoutCeiling}`;
}

/**
 * Build one bounded internal failure while retaining available child diagnostics.
 * Use when validation or provider adaptation cannot produce a host response.
 *
 * @param {string} userFacingReason - practical failure reason; empty text would hide the cause
 * @param {string} childStandardError - bounded child detail; empty means no diagnostic arrived
 * @returns {{state: "unavailable", reason: string, stdout: "", stderr: string}} unavailable response; reason is never empty
 */
function unavailableLauncherDelivery(userFacingReason, childStandardError) {
  return {
    state: "unavailable",
    reason: userFacingReason,
    stdout: "",
    stderr: childStandardError,
  };
}

/**
 * Capture one started hook until it exits, fails, floods output, or reaches its deadline.
 * Keep first-result ownership here because deadline, error, close, and output events can race.
 *
 * @param {import("node:child_process").ChildProcess} hookProcess - started Bash child; missing streams mean startup failed before output pipes opened
 * @param {NodeJS.ProcessEnv} hookEnvironment - hook environment; missing Windows roots allow direct-process cleanup only
 * @param {number} launchTimeout - positive deadline in milliseconds; zero would time out immediately
 * @param {NodeJS.Platform} hostPlatform - active host; empty text cannot select safe tree cleanup
 * @param {Function | null} appendCapturedHookOutput - bounded output writer; null preserves relayed feedback streams
 * @param {Function} stopHookProcessTree - required cleanup callback; missing behavior could strand timed-out user work
 * @returns {Promise<CapturedHookProcessResult>} first terminal result; empty captured streams mean feedback relay or no child output
 */
export function captureHookProcessUntilDeadline(
  hookProcess,
  hookEnvironment,
  launchTimeout,
  hostPlatform,
  appendCapturedHookOutput,
  stopHookProcessTree,
) {
  return new Promise((resolveHookResult) => {
    // A null writer keeps feedback output attached directly to the host.
    const shouldCaptureResult = appendCapturedHookOutput !== null;
    let hasDeliveredHookResult = false;
    let hasHookReachedDeadline = false;
    let hasExceededOutputLimit = false;
    const capturedHookOutput = { stdout: "", stderr: "", managed: hookEnvironment.GOAT_FLOW_HOOK_PROVIDER_MODE === "managed" };
    // A normally closed empty child still has exact zero byte counts; older relay modes need no managed measurement.
    if (capturedHookOutput.managed) capturedHookOutput.output = {
      envelopeLimitBytes: HOOK_RESULT_ENVELOPE_LIMIT_BYTES, stderrRetentionLimitBytes: HOOK_STDERR_RETENTION_LIMIT_BYTES,
      stderrFloodLimitBytes: HOOK_STDERR_FLOOD_LIMIT_BYTES, providerLimitBytes: HOOK_RESULT_OUTPUT_LIMIT_BYTES,
      stdoutBytes: 0, stderrBytes: 0, areByteCountsExact: false, isStderrTruncated: false,
    };

    /**
     * Release launcher-owned pipe handles after a forced terminal result.
     * Use so a descendant that outlives Bash cannot keep the provider-facing Node process open.
     *
     * @returns {void} no value; captured text remains in memory for the provider adapter.
     */
    function releaseHookOutputStreams() {
      // Close both feedback pipes so a surviving descendant cannot keep the user's hook wait open.
      for (const outputStream of [hookProcess.stdout, hookProcess.stderr]) {
        // A child that never opened this pipe has no feedback handle to release.
        if (!outputStream) continue;
        outputStream.removeAllListeners("data");
        outputStream.destroy();
      }
    }

    const launchDeadlineTimer = setTimeout(() => {
      hasHookReachedDeadline = true;
      stopHookProcessTree(hookProcess, hostPlatform, hookEnvironment);
      hookProcess.unref();
      releaseHookOutputStreams();
      // A deadline has no trustworthy exit code or startup error, so the agent gets timeout context.
      deliverHookResult(null, null);
    }, launchTimeout);

    /**
     * Deliver the first terminal result and discard later close or error events.
     * Use when Bash exits or fails so the coding agent receives one response.
     *
     * @param {number | null} hookStatus - hook exit code; null means no user-visible status arrived
     * @param {Error | null} launchError - startup error; null means Bash started successfully
     * @returns {void} no value; resolving the promise resumes the user's agent
     */
    function deliverHookResult(hookStatus, launchError) {
      // A launch error can be followed by close, but the user must receive only the first result.
      if (hasDeliveredHookResult) {
        return;
      }
      hasDeliveredHookResult = true;
      clearTimeout(launchDeadlineTimer);
      const streamState = capturedStreamStates.get(capturedHookOutput);
      // EOF completes split stdout characters; a truncated diagnostic prefix must not invent a partial character.
      if (streamState !== undefined) {
        capturedHookOutput.stdout += streamState.stdout.end();
        // Complete diagnostics may contain a final partial character; truncated prefixes deliberately omit it.
        if (!capturedHookOutput.output?.isStderrTruncated) capturedHookOutput.stderr += streamState.stderr.end();
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(streamState.stdoutChunks));
        } catch {
          // A child can emit damaged UTF-8 after a failed tool write; it cannot become a trustworthy scan result.
          capturedHookOutput.hasInvalidUtf8Output = true;
        }
      }
      // Byte totals are exact only after normal child completion; forced termination may leave unread bytes.
      if (capturedHookOutput.output) capturedHookOutput.output.areByteCountsExact = hookStatus !== null && launchError === null && !hasHookReachedDeadline && !hasExceededOutputLimit;
      resolveHookResult({
        status: hookStatus,
        timedOut: hasHookReachedDeadline,
        launchError,
        stdout: capturedHookOutput.stdout,
        stderr: capturedHookOutput.stderr,
        hasExceededOutputLimit,
        output: capturedHookOutput.output,
        hasInvalidUtf8Output: capturedHookOutput.hasInvalidUtf8Output === true,
      });
    }

    /**
     * Retain one stream chunk or stop the hook before it floods user feedback.
     * Use for both streams; managed diagnostics are drained beyond retention until a flood or deadline ends the scan.
     *
     * @param {"stdout" | "stderr"} outputStreamName - child channel; empty text cannot select storage
     * @param {Buffer | string} outputChunk - emitted bytes; empty content leaves the result unchanged
     * @returns {void} no value; exceeding the limit resolves the launch as unavailable
     */
    function captureHookOutputChunk(outputStreamName, outputChunk) {
      // A second stream event after shutdown cannot add a new user-visible result.
      if (hasExceededOutputLimit) return;
      // A retained chunk keeps the hook running toward its normal result.
      if (
        appendCapturedHookOutput(
          capturedHookOutput,
          outputStreamName,
          outputChunk,
        )
      ) {
        return;
      }
      hasExceededOutputLimit = true;
      stopHookProcessTree(hookProcess, hostPlatform, hookEnvironment);
      hookProcess.unref();
      releaseHookOutputStreams();
      deliverHookResult(null, null);
    }

    // Captured modes retain both child streams; feedback relay listeners are attached by the launcher.
    if (shouldCaptureResult && hookProcess.stdout && hookProcess.stderr) {
      hookProcess.stdout.on("data", (outputChunk) => {
        captureHookOutputChunk("stdout", outputChunk);
      });
      hookProcess.stderr.on("data", (outputChunk) => {
        captureHookOutputChunk("stderr", outputChunk);
      });
    }
    hookProcess.once("error", (launchError) => {
      // A launch failure has no hook exit status for the user.
      deliverHookResult(null, launchError);
    });
    hookProcess.once("close", (hookStatus) => {
      // A normal close has no launch error to show the user.
      deliverHookResult(hookStatus, null);
    });
  });
}

/**
 * Adapt a launcher-owned failure into the same bounded response as hook-owned unavailable work.
 * Use when startup, validation, or a deadline fails before a child envelope can arrive.
 *
 * @param {object | null} providerAdapterRuntime - loaded adapter API; null uses the verified Codex fallback or retains unavailable delivery
 * @param {object} launchContract - decoded host contract; null or empty fields cannot select a response
 * @param {string} unavailableReasonCode - stable failure code; empty text would hide the user outcome
 * @param {string} userFacingReason - practical explanation; empty text would leave feedback unactionable
 * @param {object} failureContext - optional delivery facts; absent facts mean startup produced no child details
 * @param {string} failureContext.childStandardError - bounded child detail; empty means no diagnostic arrived
 *
 * @param {number} failureContext.launcherDurationMs - measured wait; zero means startup failed before useful work
 * @param {string} failureContext.registeredHookIdentifier - affected entrypoint; absent uses the managed response-kind owner
 *
 * @param {object | null} failureContext.stopContext - verified user-cycle context; null retains the previous provider behavior
 * @param {object | undefined} failureContext.outputMeasurement - raw-byte totals; absent means no child stream was captured
 * @returns {ProviderLauncherDelivery} provider response or explicit adaptation failure
 */
export function prepareProviderLauncherUnavailableDelivery(
  providerAdapterRuntime,
  launchContract,
  unavailableReasonCode,
  userFacingReason,
  { childStandardError = "", launcherDurationMs = 0, registeredHookIdentifier, stopContext = null, outputMeasurement = undefined } = {},
) {
  const managedHookIdentifier =
    (launchContract.responseKind === "policy"
      ? registeredHookIdentifier
      : undefined) ??
    MANAGED_HOOK_IDENTIFIERS_BY_RESPONSE_KIND.get(
      launchContract.responseKind,
    ) ??
    "managed-hook";
  let launcherUnavailableResult = {
    schema: "goat-flow.hook-result.v1",
    hookId: managedHookIdentifier,
    event: launchContract.hookEvent,
    outcome: "unavailable",
    coverage: {
      status: "none",
      attemptedUnits: 1,
      completedUnits: 0,
      skippedUnits: 1,
    },
    reasonCode: unavailableReasonCode,
    findings: [
      {
        code: unavailableReasonCode,
        message: shortenHookDetail(userFacingReason, 1024),
      },
    ],
    execution: {
      hookVersion: "managed-launcher",
      provider: launchContract.providerIdentifier,
      providerMode: "managed",
      adapterName: `${launchContract.providerIdentifier}-${launchContract.hookEvent}-launcher`,
      adapterVersion: launchContract.adapterVersion,
      durationMs: launcherDurationMs,
      ...(unavailableReasonCode !== "input-invalid" ? { failureClass: "infrastructure" } : {}),
      ...(outputMeasurement ? { output: outputMeasurement } : {}),
    },
  };
  launcherUnavailableResult = applyManagedStopRecovery(launcherUnavailableResult, stopContext);
  // The verified native response remains available if an interrupted install left the adapter missing.
  if (providerAdapterRuntime === null && stopContext !== null) {
    const warning = codexStopRecoveryWarning(launcherUnavailableResult);
    return {
      state: "delivered", exitCode: 0, stderr: "",
      stdout: warning ?? JSON.stringify({ decision: "block", reason: `post-turn-safety: ${unavailableReasonCode}; ${userFacingReason}; coverage none.` }) + "\n",
    };
  }
  const decodedLauncherResult = providerAdapterRuntime.decodeHookResultOutput(
    JSON.stringify(launcherUnavailableResult),
  );
  // An invalid internal result must stay unavailable instead of reaching the user's host.
  if (decodedLauncherResult.state !== "valid") {
    return unavailableLauncherDelivery(
      decodedLauncherResult.reason,
      childStandardError,
    );
  }
  const providerHookOutput = providerAdapterRuntime.adaptHookResultForProvider(
    decodedLauncherResult.result,
    launchContract.providerIdentifier,
    launchContract.hookEvent,
  );
  // An unsupported host response remains explicit and cannot become silent success.
  if (providerHookOutput.state !== "adapted") {
    return unavailableLauncherDelivery(
      providerHookOutput.reason,
      childStandardError,
    );
  }
  return {
    state: "delivered",
    exitCode: providerHookOutput.exitCode,
    stdout: providerHookOutput.stdout,
    stderr: childStandardError + providerHookOutput.stderr,
  };
}
