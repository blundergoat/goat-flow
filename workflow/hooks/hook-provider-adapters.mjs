// goat-flow-hook-version: 1.15.1
/**
 * Decodes bounded provider-neutral hook results and renders one host response.
 * Use at the managed launcher boundary after a migrated hook finishes, so users
 * receive the response shape their agent understands without detector code
 * learning provider protocols or presenting incomplete work as a clean pass.
 */

export const HOOK_RESULT_SCHEMA = "goat-flow.hook-result.v1";
export const HOOK_RESULT_FINDING_LIMIT = 20; // Cap: matches both shipped hook finding limits.
export const HOOK_RESULT_OUTPUT_LIMIT_BYTES = 10_000; // Cap: fits Copilot's smallest feedback channel.
export const HOOK_RESULT_ADAPTER_VERSION = "1";
const HOOK_EVENTS = new Set(["pre-tool", "post-tool", "turn-stop"]);
const HOOK_OUTCOMES = new Set([
  "pass",
  "block",
  "advisory",
  "incomplete",
  "unavailable",
]);
const HOOK_REASON_CODES = new Set([
  "completed-clean",
  "bounded-reentry-ended",
  "policy-blocked",
  "findings-reported",
  "coverage-incomplete",
  "hook-disabled",
  "provider-unsupported",
  "hook-unavailable",
  "execution-timeout",
  "input-invalid",
  "output-invalid",
  "adapter-delivery-failed",
]);
const HOOK_COVERAGE_STATES = new Set(["complete", "partial", "none"]);
const HOOK_PROVIDERS = new Set(["claude", "codex", "antigravity", "copilot"]);
const HOOK_RESPONSE_KINDS = new Set(["policy", "gruff", "post-turn"]);
const HOOK_RESULT_PROTOCOLS = new Set(["legacy", HOOK_RESULT_SCHEMA]);
const HOOK_LAUNCH_MODE_PART_COUNT = 6; // Contract: provider, response, result, event, adapter, deadline.
const POLICY_LAUNCHER_DEADLINE_MS = 25_000; // Ceiling: keeps startup failure inside a 30-second host limit.
const FEEDBACK_LAUNCHER_DEADLINE_MS = 75_000; // Ceiling: keeps feedback inside a 90-second host limit.
const LEGACY_HOOK_LAUNCH_CONTRACTS = new Map([
  ["policy", ["claude", "policy", "pre-tool", POLICY_LAUNCHER_DEADLINE_MS]],
  [
    "antigravity",
    ["antigravity", "policy", "pre-tool", POLICY_LAUNCHER_DEADLINE_MS],
  ],
  ["copilot", ["copilot", "policy", "pre-tool", POLICY_LAUNCHER_DEADLINE_MS]],
  ["gruff", ["claude", "gruff", "post-tool", FEEDBACK_LAUNCHER_DEADLINE_MS]],
  [
    "post-turn",
    ["claude", "post-turn", "turn-stop", FEEDBACK_LAUNCHER_DEADLINE_MS],
  ],
]);

/**
 * Decode the registered host, event, result protocol, adapter, and launcher deadline.
 * Use before launch; invalid modes return null so user work fails visibly.
 *
 * @param {string} hookResponseMode - generated mode; empty text cannot identify a safe host contract
 * @returns {{providerIdentifier: string, responseKind: string, resultProtocol: string, hookEvent: string, adapterVersion: string, launcherDeadlineMs: number} | null} launch contract, or null for invalid input
 */
export function decodeHookLaunchContract(hookResponseMode) {
  const legacyContractParts =
    LEGACY_HOOK_LAUNCH_CONTRACTS.get(hookResponseMode);
  // Existing installed launchers keep their exact behavior until normal sync rewrites them.
  if (legacyContractParts !== undefined) {
    const [providerIdentifier, responseKind, hookEvent, launcherDeadlineMs] =
      legacyContractParts;
    return {
      providerIdentifier,
      responseKind,
      resultProtocol: "legacy",
      hookEvent,
      adapterVersion: "legacy",
      launcherDeadlineMs,
    };
  }

  const modeParts = hookResponseMode.split(":");
  // A partial or extended mode could route a result through the wrong host response.
  if (modeParts.length !== HOOK_LAUNCH_MODE_PART_COUNT) return null;
  const [
    providerIdentifier,
    responseKind,
    resultProtocol,
    hookEvent,
    adapterVersion,
    deadlineText,
  ] = modeParts;
  const launcherDeadlineMs = Number(deadlineText);
  const hasAdapterVersion = adapterVersion.length > 0;
  const hasFiniteDeadline =
    Number.isSafeInteger(launcherDeadlineMs) && launcherDeadlineMs > 0;

  // Unknown or empty fields cannot establish which response the user's host will interpret.
  if (
    !HOOK_PROVIDERS.has(providerIdentifier) ||
    !HOOK_RESPONSE_KINDS.has(responseKind) ||
    !HOOK_RESULT_PROTOCOLS.has(resultProtocol) ||
    !HOOK_EVENTS.has(hookEvent) ||
    !hasAdapterVersion ||
    !hasFiniteDeadline
  ) {
    return null;
  }

  return {
    providerIdentifier,
    responseKind,
    resultProtocol,
    hookEvent,
    adapterVersion,
    launcherDeadlineMs,
  };
}

/**
 * Retain one child-output chunk without exceeding the shared provider limit.
 * Use only for migrated results; false tells the launcher to stop the hook.
 *
 * @param {object} capturedHookOutput - retained stdout/stderr; empty fields mean no child output yet
 * @param {"stdout" | "stderr"} outputStreamName - child channel; empty text cannot select a safe destination
 * @param {Buffer | string} outputChunk - next bytes; an empty chunk leaves retained output unchanged
 * @returns {boolean} true while combined output remains within the limit
 */
export function appendBoundedHookOutput(
  capturedHookOutput,
  outputStreamName,
  outputChunk,
) {
  const nextStreamOutput =
    capturedHookOutput[outputStreamName] + String(outputChunk);
  const nextCombinedOutputBytes = Buffer.byteLength(
    outputStreamName === "stdout"
      ? nextStreamOutput + capturedHookOutput.stderr
      : capturedHookOutput.stdout + nextStreamOutput,
    "utf8",
  );
  // More output could overflow the host channel, so the over-limit chunk is discarded.
  if (nextCombinedOutputBytes > HOOK_RESULT_OUTPUT_LIMIT_BYTES) return false;
  capturedHookOutput[outputStreamName] = nextStreamOutput;
  return true;
}

/**
 * Check whether decoded JSON has named fields instead of a null or array shape.
 * Use before reading child-owned output that may be malformed or user-edited.
 *
 * @param {unknown} candidateValue - decoded value; null or arrays cannot form an envelope
 * @returns {candidateValue is Record<string, unknown>} true for a readable record, never null
 */
function isPlainRecord(candidateValue) {
  return (
    candidateValue !== null &&
    typeof candidateValue === "object" &&
    !Array.isArray(candidateValue)
  );
}

/**
 * Check whether a contract label contains text a status screen can explain.
 * Use for identifiers and messages; blank text would leave the user without context.
 *
 * @param {unknown} candidateText - possible label; null, non-text, or whitespace is empty to users
 * @returns {candidateText is string} true when trimmed text is available for the UI
 */
function hasUserFacingText(candidateText) {
  return typeof candidateText === "string" && candidateText.trim().length > 0;
}

/**
 * Build one rejected decode result with a practical user-facing reason.
 * Use whenever child output cannot safely reach a provider adapter.
 *
 * @param {string} userFacingReason - rejection detail; empty text would hide why the hook failed
 * @returns {{state: "invalid", reason: string}} invalid result; reason is never empty
 */
function invalidHookOutput(userFacingReason) {
  return { state: "invalid", reason: userFacingReason };
}

/**
 * Validate counted coverage before the UI reports scanned or skipped work.
 * Use so fractional, negative, or contradictory totals never look trustworthy.
 *
 * @param {unknown} candidateCoverage - decoded coverage; null or missing means no scan proof exists
 * @returns {string | null} first failure, or null when every count and label agrees
 */
function coverageFailureReason(candidateCoverage) {
  // Missing or array-shaped coverage cannot explain what the hook examined for the user.
  if (!isPlainRecord(candidateCoverage))
    return "coverage is missing or invalid";

  // An unknown label could make skipped work appear complete on a status screen.
  if (!HOOK_COVERAGE_STATES.has(candidateCoverage.status)) {
    return "coverage status is invalid";
  }

  const userContentCounts = [
    candidateCoverage.attemptedUnits,
    candidateCoverage.completedUnits,
    candidateCoverage.skippedUnits,
  ];
  const hasInvalidUserContentCount = userContentCounts.some(
    (userContentCount) =>
      !Number.isInteger(userContentCount) || userContentCount < 0,
  );

  // Invalid counts cannot tell the user how much declared work actually completed.
  if (hasInvalidUserContentCount) {
    return "coverage counts must be non-negative integers";
  }

  // Completed and skipped units cannot exceed the work the hook said it attempted.
  if (
    candidateCoverage.completedUnits + candidateCoverage.skippedUnits >
    candidateCoverage.attemptedUnits
  ) {
    return "coverage counts exceed attempted units";
  }

  // A complete badge must mean every attempted unit finished and none were skipped.
  if (
    candidateCoverage.status === "complete" &&
    (candidateCoverage.completedUnits !== candidateCoverage.attemptedUnits ||
      candidateCoverage.skippedUnits !== 0)
  ) {
    return "complete coverage must finish every attempted unit";
  }

  // Null means the coverage layer is safe for the result screen to use.
  return null;
}

/**
 * Validate one bounded finding before an agent or user sees it.
 * Use so a malformed analyzer item cannot break the final provider response.
 *
 * @param {unknown} candidateFinding - decoded finding; null or empty fields cannot form UI detail
 * @returns {boolean} true when required text exists and an optional target is usable
 */
function findingIsValid(candidateFinding) {
  // A finding must be an object with a code and explanation the user can act on.
  if (
    !isPlainRecord(candidateFinding) ||
    !hasUserFacingText(candidateFinding.code) ||
    !hasUserFacingText(candidateFinding.message)
  ) {
    return false;
  }

  // An omitted target is valid; an empty or non-text target would render a broken location.
  if (
    candidateFinding.target !== undefined &&
    !hasUserFacingText(candidateFinding.target)
  ) {
    return false;
  }

  return true;
}

/**
 * Validate execution identity shown when users inspect which adapter produced a result.
 * Use so provider mismatches and missing versions remain explicit instead of guessed.
 *
 * @param {unknown} candidateExecution - decoded metadata; null means the producing hook is unknown
 * @returns {string | null} first failure, or null when execution identity is complete
 */
function executionFailureReason(candidateExecution) {
  // Missing execution metadata leaves the user unable to identify the producing hook or adapter.
  if (!isPlainRecord(candidateExecution))
    return "execution metadata is missing";

  const requiredExecutionLabels = [
    candidateExecution.hookVersion,
    candidateExecution.providerMode,
    candidateExecution.adapterName,
    candidateExecution.adapterVersion,
  ];

  // Empty versions or names make stale and current adapter results indistinguishable.
  if (!requiredExecutionLabels.every(hasUserFacingText)) {
    return "execution metadata contains an empty label";
  }

  // An unknown provider cannot select a safe host response contract.
  if (!HOOK_PROVIDERS.has(candidateExecution.provider)) {
    return "execution provider is invalid";
  }

  // Negative or fractional timing cannot describe the user's observed hook run.
  if (
    !Number.isInteger(candidateExecution.durationMs) ||
    candidateExecution.durationMs < 0
  ) {
    return "execution duration must be a non-negative integer";
  }

  // Null means the adapter identity is complete enough to show and compare.
  return null;
}

/**
 * Validate the decoded envelope fields that protect user-visible result meaning.
 * Use after JSON parsing and before provider-specific translation.
 *
 * @param {Record<string, unknown>} candidateResult - decoded object; required fields may still be empty
 * @returns {string | null} first contract failure, or null when the result is adapter-safe
 */
function resultEnvelopeFailureReason(candidateResult) {
  // A different schema may carry meanings this launcher version does not understand.
  if (candidateResult.schema !== HOOK_RESULT_SCHEMA) {
    return "result schema is missing or unsupported";
  }

  // A blank hook identifier cannot tell the user which protection produced the result.
  if (!hasUserFacingText(candidateResult.hookId)) {
    return "hook identifier is empty";
  }

  // Unknown events or outcomes could route a block through the wrong provider behavior.
  if (!HOOK_EVENTS.has(candidateResult.event)) return "hook event is invalid";
  // Unknown outcomes cannot be weakened into a pass or advisory by guesswork.
  if (!HOOK_OUTCOMES.has(candidateResult.outcome)) {
    return "hook outcome is invalid";
  }

  // A stable reason code lets audit and UI wording evolve without losing meaning.
  if (!HOOK_REASON_CODES.has(candidateResult.reasonCode)) {
    return "result reason code is invalid";
  }

  const coverageReason = coverageFailureReason(candidateResult.coverage);
  // A concrete coverage failure keeps incomplete work out of a clean badge.
  if (coverageReason !== null) return coverageReason;

  // Findings must be one bounded list so provider output cannot flood the agent context.
  if (!Array.isArray(candidateResult.findings)) {
    return "findings must be an array";
  }
  // More than the shared cap becomes an invalid result instead of silently dropping detail.
  if (candidateResult.findings.length > HOOK_RESULT_FINDING_LIMIT) {
    return `findings exceed the ${HOOK_RESULT_FINDING_LIMIT}-item limit`;
  }
  // One malformed detail could make the complete provider response unusable.
  if (!candidateResult.findings.every(findingIsValid)) {
    return "one or more findings are invalid";
  }

  const executionReason = executionFailureReason(candidateResult.execution);
  // A concrete execution failure prevents an unidentified adapter from claiming delivery.
  if (executionReason !== null) return executionReason;

  const candidateCoverage = candidateResult.coverage;
  // Only complete declared coverage can produce the clean state users rely on.
  if (
    candidateResult.outcome === "pass" &&
    candidateCoverage.status !== "complete"
  ) {
    return "pass requires complete coverage";
  }

  // Null means every minimum envelope invariant is safe for provider translation.
  return null;
}

/**
 * Decode one child result without accepting extra text, multiple objects, or oversized output.
 * Use when a migrated hook finishes; legacy hooks bypass this parser until their registry flips.
 * Error behavior: returns one bounded invalid reason and never throws malformed JSON.
 *
 * @param {string} childStandardOutput - complete captured stdout; empty output means no envelope arrived
 * @returns {{state: "valid", result: Record<string, unknown>} | {state: "invalid", reason: string}} bounded decode result; never empty
 */
export function decodeHookResultOutput(childStandardOutput) {
  // A large result could consume or overflow the provider feedback channel before validation.
  if (
    Buffer.byteLength(childStandardOutput, "utf8") >
    HOOK_RESULT_OUTPUT_LIMIT_BYTES
  ) {
    return invalidHookOutput(
      `result output exceeds the ${HOOK_RESULT_OUTPUT_LIMIT_BYTES}-byte limit`,
    );
  }

  const normalizedChildOutput = childStandardOutput.trim();
  // For example, an old hook may exit cleanly without emitting the new envelope at all.
  if (normalizedChildOutput.length === 0) {
    return invalidHookOutput("result output is empty");
  }

  let decodedChildResult;
  try {
    decodedChildResult = JSON.parse(normalizedChildOutput);
  } catch {
    // For example, a legacy hook may print a finding line before JSON and make the result ambiguous.
    return invalidHookOutput("result output is not one JSON object");
  }

  // Null, an array, or a scalar cannot contain the named result fields the UI needs.
  if (!isPlainRecord(decodedChildResult)) {
    return invalidHookOutput("result output is not a JSON object");
  }

  const resultFailureReason = resultEnvelopeFailureReason(decodedChildResult);
  // The first exact contract failure explains why migration cannot treat this run as current.
  if (resultFailureReason !== null) {
    return invalidHookOutput(resultFailureReason);
  }

  return { state: "valid", result: decodedChildResult };
}

/**
 * Render bounded findings and coverage into one concise message for the active agent.
 * Use after validation so every line belongs to a known hook result the user can inspect.
 * Invariant: findings retain input order and coverage always precedes their detail.
 *
 * @param {Record<string, unknown>} hookResult - validated result; empty findings use its reason code
 * @returns {string} non-empty feedback text for any non-pass result
 */
function renderHookResultMessage(hookResult) {
  const findingLines = hookResult.findings.map((finding) => {
    const findingTarget = finding.target ? ` ${finding.target}` : "";
    return `- [${finding.code}]${findingTarget} ${finding.message}`;
  });
  const fallbackReason = String(hookResult.reasonCode).replaceAll("-", " ");
  // No findings still needs a useful explanation, such as an unavailable dependency or timeout.
  const resultDetails =
    findingLines.length > 0 ? findingLines : [`- ${fallbackReason}`];
  const coverage = hookResult.coverage;
  const coverageSummary = `Coverage: ${coverage.completedUnits}/${coverage.attemptedUnits} completed; ${coverage.skippedUnits} skipped.`;
  const outcomeLabel = String(hookResult.outcome).toUpperCase();
  return [
    `${hookResult.hookId}: ${outcomeLabel}`,
    coverageSummary,
    ...resultDetails,
  ].join("\n");
}

/**
 * Build one JSON stdout response while enforcing the lowest supported feedback ceiling.
 * Use after selecting a provider shape; oversized feedback becomes unavailable, never truncated.
 *
 * @param {Record<string, unknown>} providerResponse - exact host object; empty object means clean/no feedback
 * @returns {{state: "adapted", exitCode: 0, stdout: string, stderr: ""} | {state: "invalid", reason: string}} provider output or a bounded failure
 */
function jsonProviderOutput(providerResponse) {
  const providerStandardOutput = `${JSON.stringify(providerResponse)}\n`;
  // A response beyond the shared ceiling could be dropped or rejected by the user's host.
  if (
    Buffer.byteLength(providerStandardOutput, "utf8") >
    HOOK_RESULT_OUTPUT_LIMIT_BYTES
  ) {
    return invalidHookOutput(
      `adapted response exceeds the ${HOOK_RESULT_OUTPUT_LIMIT_BYTES}-byte limit`,
    );
  }
  return {
    state: "adapted",
    exitCode: 0,
    stdout: providerStandardOutput,
    stderr: "",
  };
}

/**
 * Build a clean response without inventing feedback after complete coverage passes.
 * Use when the hook has no finding and the provider should continue normally.
 *
 * @param {string} providerIdentifier - active host; empty text cannot select its clean shape
 * @param {string} hookEvent - canonical event; empty text cannot select lifecycle behavior
 * @returns {{state: "adapted", exitCode: 0, stdout: string, stderr: ""} | {state: "invalid", reason: string}} clean provider result
 */
function adaptCleanResult(providerIdentifier, hookEvent) {
  // Antigravity requires an explicit allow decision before a user's tool can run.
  if (providerIdentifier === "antigravity" && hookEvent === "pre-tool") {
    return jsonProviderOutput({ decision: "allow" });
  }
  // Antigravity documents an empty object as the complete PostToolUse response.
  if (providerIdentifier === "antigravity" && hookEvent === "post-tool") {
    return jsonProviderOutput({});
  }
  // Antigravity and Copilot use an explicit allow shape when a clean stop may finish.
  if (
    hookEvent === "turn-stop" &&
    (providerIdentifier === "antigravity" || providerIdentifier === "copilot")
  ) {
    return jsonProviderOutput({ decision: "allow" });
  }
  return { state: "adapted", exitCode: 0, stdout: "", stderr: "" };
}

/**
 * Translate a pre-tool result into the permission response the active host expects.
 * Use before a proposed tool runs so blocks and unavailable policy never become approval.
 *
 * @param {Record<string, unknown>} hookResult - validated non-pass result; findings may be empty
 * @param {string} providerIdentifier - active host; empty text cannot select a permission schema
 * @param {string} userFacingMessage - bounded explanation; empty text would hide the decision reason
 * @returns {ReturnType<typeof jsonProviderOutput>} provider permission response
 */
function adaptPreToolResult(hookResult, providerIdentifier, userFacingMessage) {
  const mustDenyTool = ["block", "incomplete", "unavailable"].includes(
    hookResult.outcome,
  );
  // Antigravity uses top-level allow or deny decisions for the pending tool.
  if (providerIdentifier === "antigravity") {
    return jsonProviderOutput({
      decision: mustDenyTool ? "deny" : "allow",
      reason: userFacingMessage,
    });
  }
  // Copilot uses its permissionDecision fields for the same user-visible gate.
  if (providerIdentifier === "copilot") {
    return jsonProviderOutput({
      permissionDecision: mustDenyTool ? "deny" : "allow",
      permissionDecisionReason: userFacingMessage,
    });
  }
  // Claude and Codex share the current hookSpecificOutput permission shape.
  return jsonProviderOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: mustDenyTool ? "deny" : "allow",
      permissionDecisionReason: userFacingMessage,
    },
  });
}

/**
 * Translate post-tool feedback without weakening a block or pretending an unsupported host delivered it.
 * Use after edits or commands so findings reach the model on the same turn where supported.
 *
 * @param {Record<string, unknown>} hookResult - validated non-pass result; a block must remain enforceable
 * @param {string} providerIdentifier - active host; empty text cannot select a feedback schema
 * @param {string} userFacingMessage - bounded model feedback; empty text would hide the result
 * @returns {ReturnType<typeof jsonProviderOutput> | {state: "unsupported", reason: string}} provider feedback or explicit unsupported state
 */
function adaptPostToolResult(
  hookResult,
  providerIdentifier,
  userFacingMessage,
) {
  // Antigravity's current PostToolUse contract accepts only {}, so feedback cannot be delivered.
  if (providerIdentifier === "antigravity") {
    return {
      state: "unsupported",
      reason: "Antigravity PostToolUse cannot deliver hook feedback",
    };
  }
  // Copilot can add context but cannot preserve a provider-neutral blocking decision here.
  if (providerIdentifier === "copilot") {
    // A block without host enforcement must stay unsupported instead of becoming advice.
    if (hookResult.outcome === "block") {
      return {
        state: "unsupported",
        reason: "Copilot postToolUse cannot preserve a blocking hook result",
      };
    }
    return jsonProviderOutput({ additionalContext: userFacingMessage });
  }

  const providerResponse = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: userFacingMessage,
    },
  };
  // Claude and Codex preserve a blocking post-tool result with top-level decision fields.
  if (hookResult.outcome === "block") {
    providerResponse.decision = "block";
    providerResponse.reason = userFacingMessage;
  }
  return jsonProviderOutput(providerResponse);
}

/**
 * Translate a stop failure into one bounded continuation request for the active host.
 * Use when safety findings or incomplete coverage mean the user's turn cannot finish cleanly.
 *
 * @param {Record<string, unknown>} hookResult - validated non-pass result; advisory cannot force continuation
 * @param {string} providerIdentifier - active host; empty text cannot select a stop schema
 * @param {string} userFacingMessage - bounded continuation reason; empty text would hide required work
 * @returns {ReturnType<typeof jsonProviderOutput> | {state: "unsupported", reason: string}} stop response or explicit unsupported state
 */
function adaptStopResult(hookResult, providerIdentifier, userFacingMessage) {
  // One exact repeated infrastructure failure may end loudly without relabelling incomplete coverage as a pass.
  if (
    hookResult.outcome === "incomplete" &&
    hookResult.reasonCode === "bounded-reentry-ended"
  ) {
    return adaptCleanResult(providerIdentifier, "turn-stop");
  }
  // An advisory at turn end has no shared non-blocking delivery contract across supported hosts.
  if (hookResult.outcome === "advisory") {
    return {
      state: "unsupported",
      reason:
        "turn-stop advisory delivery is not supported by the shared adapter",
    };
  }
  // Antigravity calls the forced next turn a continue decision.
  if (providerIdentifier === "antigravity") {
    return jsonProviderOutput({
      decision: "continue",
      reason: userFacingMessage,
    });
  }
  // Claude, Codex, and Copilot call the same forced continuation a block decision.
  return jsonProviderOutput({ decision: "block", reason: userFacingMessage });
}

/**
 * Translate one validated neutral result into the exact active-provider response.
 * Use only at the final launcher boundary; unsupported combinations remain visibly unavailable.
 *
 * @param {Record<string, unknown>} hookResult - validated envelope; null or malformed values must be decoded first
 * @param {string} providerIdentifier - registered host; empty or mismatched text rejects delivery
 * @param {string} expectedHookEvent - registered canonical event; empty or mismatched text rejects delivery
 * @returns {{state: "adapted", exitCode: 0, stdout: string, stderr: ""} | {state: "invalid" | "unsupported", reason: string}} bounded provider result; never empty
 */
export function adaptHookResultForProvider(
  hookResult,
  providerIdentifier,
  expectedHookEvent,
) {
  // A provider mismatch could send a valid result through the wrong host protocol.
  if (hookResult.execution.provider !== providerIdentifier) {
    return invalidHookOutput(
      "result provider does not match the registered host",
    );
  }
  // A lifecycle mismatch could turn post-tool feedback into a permission or stop decision.
  if (hookResult.event !== expectedHookEvent) {
    return invalidHookOutput("result event does not match the registered hook");
  }

  // Complete clean coverage continues without inventing a warning or finding.
  if (hookResult.outcome === "pass") {
    return adaptCleanResult(providerIdentifier, expectedHookEvent);
  }

  const userFacingMessage = renderHookResultMessage(hookResult);
  // Pre-tool results decide whether the user's proposed tool may run.
  if (expectedHookEvent === "pre-tool") {
    return adaptPreToolResult(
      hookResult,
      providerIdentifier,
      userFacingMessage,
    );
  }
  // Post-tool results add model-visible feedback only where the host supports it.
  if (expectedHookEvent === "post-tool") {
    return adaptPostToolResult(
      hookResult,
      providerIdentifier,
      userFacingMessage,
    );
  }
  // The remaining canonical event is turn-stop, where failures request continuation.
  return adaptStopResult(hookResult, providerIdentifier, userFacingMessage);
}

/**
 * Build one unavailable delivery while retaining bounded human diagnostics.
 * Use when a migrated result cannot safely reach the active coding agent.
 *
 * @param {string} userFacingReason - failure shown by the launcher; empty text would hide the cause
 * @param {string} childStandardError - bounded hook diagnostics; empty means the child gave no detail
 * @returns {{state: "unavailable", reason: string, stdout: "", stderr: string}} unavailable response; reason is never empty
 */
function unavailableProviderDelivery(userFacingReason, childStandardError) {
  return {
    state: "unavailable",
    reason: userFacingReason,
    stdout: "",
    stderr: childStandardError,
  };
}

/**
 * Validate and adapt one captured result without writing to process streams.
 * Use after migrated hook execution so the launcher can deliver one bounded response.
 *
 * @param {object} hookExecution - captured status and streams; null status or empty streams mean no complete detail arrived
 * @param {object} launchContract - provider, event, and adapter identity; empty fields cannot establish delivery
 * @returns {{state: "delivered", exitCode: number, stdout: string, stderr: string} | {state: "unavailable", reason: string, stdout: "", stderr: string}} final output or explicit failure
 */
export function prepareProviderHookResultDelivery(
  hookExecution,
  launchContract,
) {
  // A child that crossed the shared cap cannot claim a complete or delivered result.
  if (hookExecution.hasExceededOutputLimit) {
    return unavailableProviderDelivery(
      `hook output exceeded the ${HOOK_RESULT_OUTPUT_LIMIT_BYTES}-byte limit`,
      hookExecution.stderr,
    );
  }
  // Envelope hooks exit zero and carry their real outcome inside the neutral result.
  if (hookExecution.status !== 0) {
    return unavailableProviderDelivery(
      "hook exited without a complete result envelope",
      hookExecution.stderr,
    );
  }

  const decodedHookResult = decodeHookResultOutput(hookExecution.stdout);
  // Malformed or legacy stdout during migration becomes an explicit unavailable result.
  if (decodedHookResult.state !== "valid") {
    return unavailableProviderDelivery(
      decodedHookResult.reason,
      hookExecution.stderr,
    );
  }
  // A stale hook cannot use a different adapter identity without asking the user to sync.
  if (
    decodedHookResult.result.execution.adapterVersion !==
    launchContract.adapterVersion
  ) {
    return unavailableProviderDelivery(
      "result adapter version does not match the registered hook",
      hookExecution.stderr,
    );
  }

  const providerHookOutput = adaptHookResultForProvider(
    decodedHookResult.result,
    launchContract.providerIdentifier,
    launchContract.hookEvent,
  );
  // Unsupported and invalid translations stay visible instead of becoming an empty success.
  if (providerHookOutput.state !== "adapted") {
    return unavailableProviderDelivery(
      providerHookOutput.reason,
      hookExecution.stderr,
    );
  }

  return {
    state: "delivered",
    exitCode: providerHookOutput.exitCode,
    stdout: providerHookOutput.stdout,
    stderr: hookExecution.stderr + providerHookOutput.stderr,
  };
}
