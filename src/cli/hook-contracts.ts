/**
 * Defines the hook evidence and result contracts used by CLI and dashboard surfaces.
 * Use before a screen claims provider support or an adapter translates a hook result.
 * Documentation, live delivery, installed state, and scenario proof stay separate so
 * users never see an unavailable or incomplete hook presented as clean coverage.
 */
import type { AgentId } from "./types.js";

export const HOOK_PROVIDER_EVIDENCE_SCHEMA =
  "goat-flow.hook-provider-evidence.v1";
export const HOOK_RESULT_SCHEMA = "goat-flow.hook-result.v1";
export const HOOK_RESULT_FINDING_LIMIT = 20; // Cap: matches both shipped hook limits across agent UIs.
export const HOOK_RESULT_OUTPUT_LIMIT_BYTES = 10_000; // Cap: fits Copilot's smallest documented feedback channel.

/** Provider-neutral lifecycle points shown consistently across hook screens. */
export type HookLifecycleEvent = "pre-tool" | "post-tool" | "turn-stop";

/** Dated official documentation that may describe support without proving delivery. */
export interface HookProviderDocumentationEvidence {
  sourceUrl: string;
  checkedAt: string;
  expiresAt: string;
  isSupportDeclared: boolean;
}

/** Provider channels a later capture can observe without retaining raw payload values. */
export type HookProviderResponseChannel =
  "stdout-json" | "stderr" | "exit-code" | "provider-ui" | "model-context";

/** One live provider capture for an exact version, mode, source, event, and trust state. */
export interface HookProviderCaptureEvidence {
  providerVersion: string;
  providerMode: string;
  hookVersion: string;
  adapterVersion: string;
  configurationSource: "managed" | "user" | "project" | "plugin" | "session";
  trustState: "trusted" | "untrusted" | "unknown";
  capturedAt: string;
  expiresAt: string;
  supportOutcome: "supported" | "unsupported" | "inconclusive";
  observedPayloadFields: string[];
  responseChannels: HookProviderResponseChannel[];
  resultDelivery: "delivered" | "not-delivered" | "not-tested";
  timeoutBehavior: "completed" | "timed-out" | "not-tested";
  continuationBehavior:
    "continued" | "stopped" | "not-applicable" | "not-tested";
  modelResultVisibility:
    "visible" | "not-visible" | "not-applicable" | "not-tested";
}

/** Versioned evidence record for one provider, mode, event, and canonical tool combination. */
export interface HookProviderEvidenceRecord {
  schema: typeof HOOK_PROVIDER_EVIDENCE_SCHEMA;
  provider: AgentId;
  canonicalEvent: HookLifecycleEvent;
  providerEventName: string;
  canonicalToolName?: string;
  documentation?: HookProviderDocumentationEvidence;
  capture?: HookProviderCaptureEvidence;
}

/** Documentation state shown before live provider support is considered. */
export type HookProviderDocumentationState =
  "absent" | "fresh-supported" | "fresh-unsupported" | "stale";

/** Live-capture state that gates whether a provider capability can be used. */
export type HookProviderCaptureState =
  | "absent"
  | "fresh-supported"
  | "fresh-unsupported"
  | "stale"
  | "untrusted"
  | "inconclusive";

/** Provider evidence assessment consumed by setup, audit, and dashboard state. */
export interface HookProviderEvidenceAssessment {
  documentation: HookProviderDocumentationState;
  capture: HookProviderCaptureState;
}

/**
 * Decide whether dated evidence can still back a support label shown to users.
 * Use before documentation or capture advances a hook toward effective coverage.
 *
 * @param expiresAt - ISO expiry from the evidence record; empty or invalid text means users see stale evidence
 * @param currentDate - time of the support check; an invalid date cannot establish fresh evidence
 * @returns `true` when the record is expired or invalid, so support remains unverified
 */
function hookEvidenceHasExpired(expiresAt: string, currentDate: Date): boolean {
  const expiryMilliseconds = Date.parse(expiresAt);
  const currentMilliseconds = currentDate.getTime();

  // Invalid dates cannot justify a fresh support badge for the user.
  if (Number.isNaN(expiryMilliseconds) || Number.isNaN(currentMilliseconds)) {
    return true;
  }

  // Evidence remains fresh through its expiry instant, then asks for a new check.
  return expiryMilliseconds < currentMilliseconds;
}

/**
 * Classify current provider documentation without treating it as runtime delivery.
 * Use when a support screen explains whether an event is documented, absent, or stale.
 *
 * @param documentation - official-source record; `undefined` means no provider claim is available to users
 * @param currentDate - time of the support check; an invalid value makes the record stale
 * @returns documentation state; `absent` means the UI must not infer provider support
 */
function classifyProviderDocumentation(
  documentation: HookProviderDocumentationEvidence | undefined,
  currentDate: Date,
): HookProviderDocumentationState {
  // No official record means the UI can only show that support is unverified.
  if (!documentation) return "absent";

  // Expired documentation prompts re-checking instead of preserving a timeless claim.
  if (hookEvidenceHasExpired(documentation.expiresAt, currentDate)) {
    return "stale";
  }

  // A current provider statement can describe support without proving the hook fired.
  if (documentation.isSupportDeclared) return "fresh-supported";

  // Current documentation that denies support keeps the event unavailable.
  return "fresh-unsupported";
}

/**
 * Classify live capture while keeping trust, age, and delivery failures visible.
 * Use before setup or audit treats a provider event as live-supported.
 *
 * @param capture - exact provider capture; `undefined` means no runtime proof exists for this combination
 * @param currentDate - time of the support check; an invalid value makes the capture stale
 * @returns capture state; only `fresh-supported` may advance toward effective coverage
 */
function classifyProviderCapture(
  capture: HookProviderCaptureEvidence | undefined,
  currentDate: Date,
): HookProviderCaptureState {
  // Without a capture, documented support remains an unverified user-facing claim.
  if (!capture) return "absent";

  // Unreviewed checkout or provider config cannot establish trusted hook behavior.
  if (capture.trustState !== "trusted") return "untrusted";

  // An expired provider/version observation asks the user to re-run live verification.
  if (hookEvidenceHasExpired(capture.expiresAt, currentDate)) return "stale";

  // A supported capture counts only when the intended result reached its destination.
  if (
    capture.supportOutcome === "supported" &&
    capture.resultDelivery === "delivered"
  ) {
    return "fresh-supported";
  }

  // A current negative capture keeps the provider unavailable without looking broken.
  if (capture.supportOutcome === "unsupported") return "fresh-unsupported";

  // Any other live result lacks enough delivery proof for a support claim.
  return "inconclusive";
}

/**
 * Assess documentation and live capture as independent provider-evidence layers.
 * Use when a user opens setup, audit, or hook status after provider metadata changes.
 *
 * @param evidenceRecord - versioned provider record; missing optional evidence keeps that layer `absent`
 * @param currentDate - time used for expiry; invalid dates make present evidence stale
 * @returns separate documentation and capture states; neither field is empty
 */
export function assessHookProviderEvidence(
  evidenceRecord: HookProviderEvidenceRecord,
  currentDate: Date,
): HookProviderEvidenceAssessment {
  return {
    documentation: classifyProviderDocumentation(
      evidenceRecord.documentation,
      currentDate,
    ),
    capture: classifyProviderCapture(evidenceRecord.capture, currentDate),
  };
}

/** Facts that move one selected hook from desired configuration to verified user coverage. */
export interface HookEffectiveStateFacts {
  isDesired: boolean;
  providerDocumentation: HookProviderDocumentationState;
  providerCapture: HookProviderCaptureState;
  isRegistered: boolean;
  isCurrentVersionInstalled: boolean;
  isTrusted: boolean;
  hasObservedRun: boolean;
  hasDeliveredResult: boolean;
  isScenarioVerified: boolean;
}

/** Status and severity rendered for one hook/provider combination. */
export interface HookEffectiveState {
  status:
    | "disabled"
    | "provider-undocumented"
    | "provider-documentation-stale"
    | "provider-documented-unsupported"
    | "provider-capture-absent"
    | "provider-capture-stale"
    | "provider-capture-untrusted"
    | "provider-capture-inconclusive"
    | "provider-live-unsupported"
    | "not-registered"
    | "installation-stale"
    | "runtime-untrusted"
    | "not-observed"
    | "result-undelivered"
    | "scenario-unverified"
    | "effective";
  severity: "neutral" | "warning" | "danger" | "success";
}

/**
 * Choose the first provider-evidence gap a hook status screen must explain.
 * Use before install checks so documentation never substitutes for a live result.
 *
 * @param stateFacts - current provider facts; absent or stale layers keep support unverified
 * @returns provider status, or `undefined` when the UI may continue to install checks
 */
function classifyProviderEvidenceState(
  stateFacts: HookEffectiveStateFacts,
): HookEffectiveState | undefined {
  // Missing provider documentation leaves desired support unverified.
  if (stateFacts.providerDocumentation === "absent") {
    return { status: "provider-undocumented", severity: "warning" };
  }

  // Old provider documentation asks for a source re-check before setup proceeds.
  if (stateFacts.providerDocumentation === "stale") {
    return { status: "provider-documentation-stale", severity: "warning" };
  }

  // A current provider statement that excludes the event keeps the hook unavailable.
  if (stateFacts.providerDocumentation === "fresh-unsupported") {
    return { status: "provider-documented-unsupported", severity: "warning" };
  }

  // An untrusted live capture is dangerous because its result cannot justify execution.
  if (stateFacts.providerCapture === "untrusted") {
    return { status: "provider-capture-untrusted", severity: "danger" };
  }

  // Documentation without a live capture cannot become an effective support claim.
  if (stateFacts.providerCapture === "absent") {
    return { status: "provider-capture-absent", severity: "warning" };
  }

  // An expired capture asks the user to re-verify the exact provider combination.
  if (stateFacts.providerCapture === "stale") {
    return { status: "provider-capture-stale", severity: "warning" };
  }

  // A capture that did not prove delivery remains explicitly inconclusive.
  if (stateFacts.providerCapture === "inconclusive") {
    return { status: "provider-capture-inconclusive", severity: "warning" };
  }

  // A current negative capture prevents registration from implying support.
  if (stateFacts.providerCapture === "fresh-unsupported") {
    return { status: "provider-live-unsupported", severity: "warning" };
  }

  // No provider gap means the UI can continue through local install and runtime checks.
  return undefined;
}

/**
 * Choose the first local install or trust gap shown after provider support is proven.
 * Use when setup explains why a supported hook is not ready in this checkout.
 *
 * @param stateFacts - current project facts; false values identify the first local gap
 * @returns install status, or `undefined` when the UI may continue to runtime checks
 */
function classifyInstalledHookState(
  stateFacts: HookEffectiveStateFacts,
): HookEffectiveState | undefined {
  // A supported provider event still needs a registration in the selected project.
  if (!stateFacts.isRegistered) {
    return { status: "not-registered", severity: "warning" };
  }

  // An outdated or incomplete install cannot run the hook version the UI describes.
  if (!stateFacts.isCurrentVersionInstalled) {
    return { status: "installation-stale", severity: "warning" };
  }

  // Untrusted installed code is a danger state even when its configuration is current.
  if (!stateFacts.isTrusted) {
    return { status: "runtime-untrusted", severity: "danger" };
  }

  // No install gap means the UI can continue to observed runtime and result checks.
  return undefined;
}

/**
 * Choose the first runtime or delivery gap shown after a trusted hook is installed.
 * Use when audit explains whether the selected project received verified protection.
 *
 * @param stateFacts - observed runtime facts; false values identify missing user coverage
 * @returns runtime status, or `undefined` when every remaining user gate is proven
 */
function classifyObservedHookState(
  stateFacts: HookEffectiveStateFacts,
): HookEffectiveState | undefined {
  // A current registration without an observed run remains unverified for this project.
  if (!stateFacts.hasObservedRun) {
    return { status: "not-observed", severity: "warning" };
  }

  // A running hook whose result never reached its destination gives false assurance.
  if (!stateFacts.hasDeliveredResult) {
    return { status: "result-undelivered", severity: "danger" };
  }

  // Delivery without the expected allow, block, or feedback scenario still needs proof.
  if (!stateFacts.isScenarioVerified) {
    return { status: "scenario-unverified", severity: "warning" };
  }

  // No runtime gap means the UI can show the complete effective state.
  return undefined;
}

/**
 * Choose the first unmet support gate and the severity a user should see.
 * Use across setup, audit, and dashboard views so no surface skips a proof layer.
 *
 * @param stateFacts - desired and observed hook facts; false values keep users at the first unmet gate
 * @returns actionable status and severity; `effective` is returned only when every gate is satisfied
 */
export function classifyHookEffectiveState(
  stateFacts: HookEffectiveStateFacts,
): HookEffectiveState {
  // A user-disabled hook is neutral because no coverage was requested.
  if (!stateFacts.isDesired) return { status: "disabled", severity: "neutral" };

  const providerEvidenceState = classifyProviderEvidenceState(stateFacts);

  // A provider gap stops setup before local registration can imply coverage.
  if (providerEvidenceState) return providerEvidenceState;

  const installedHookState = classifyInstalledHookState(stateFacts);

  // A local install gap explains why provider support is not active in this checkout.
  if (installedHookState) return installedHookState;

  const observedHookState = classifyObservedHookState(stateFacts);

  // A runtime gap prevents the UI from showing a complete protection state.
  if (observedHookState) return observedHookState;

  // Every provider, install, trust, delivery, and scenario gate is proven.
  return { status: "effective", severity: "success" };
}

/** Provider-independent outcome produced before the final host adapter runs. */
export type HookResultOutcome =
  "pass" | "block" | "advisory" | "incomplete" | "unavailable";

/** Stable user-facing reasons shared by blocking, advisory, and diagnostic hooks. */
export type HookResultReasonCode =
  | "completed-clean"
  | "policy-blocked"
  | "findings-reported"
  | "coverage-incomplete"
  | "hook-disabled"
  | "provider-unsupported"
  | "hook-unavailable"
  | "execution-timeout"
  | "input-invalid"
  | "output-invalid"
  | "adapter-delivery-failed";

/** Counted coverage that distinguishes a full clean run from skipped user content. */
export interface HookResultCoverage {
  status: "complete" | "partial" | "none";
  attemptedUnits: number;
  completedUnits: number;
  skippedUnits: number;
}

/** One bounded finding shown to a user or translated into provider feedback. */
export interface HookResultFinding {
  code: string;
  message: string;
  target?: string;
}

/** Execution metadata needed to explain which hook and adapter produced the result. */
export interface HookResultExecution {
  hookVersion: string;
  provider: AgentId;
  providerMode: string;
  adapterName: string;
  adapterVersion: string;
  durationMs: number;
}

/** Versioned provider-neutral result passed to one final provider adapter. */
export interface HookResultEnvelope {
  schema: typeof HOOK_RESULT_SCHEMA;
  hookId: string;
  event: HookLifecycleEvent;
  outcome: HookResultOutcome;
  coverage: HookResultCoverage;
  reasonCode: HookResultReasonCode;
  findings: HookResultFinding[];
  execution: HookResultExecution;
}

/**
 * Confirm coverage counts can describe real units of user content.
 * Use before an adapter displays scanned, completed, or skipped totals.
 *
 * @param coverage - counted hook work; fractional or negative values cannot describe UI totals
 * @returns `true` when every count is a non-negative integer; no count may be empty
 */
function hookCoverageCountsAreValid(coverage: HookResultCoverage): boolean {
  const userContentCounts = [
    coverage.attemptedUnits,
    coverage.completedUnits,
    coverage.skippedUnits,
  ];

  return userContentCounts.every(
    (userContentCount) =>
      Number.isInteger(userContentCount) && userContentCount >= 0,
  );
}

/**
 * Confirm a complete label agrees with the counts a user can inspect.
 * Use before a clean result reaches a provider adapter or dashboard badge.
 *
 * @param coverage - declared and counted work; partial or no coverage needs no complete-count check
 * @returns `true` when the label and counts agree, including non-complete user states
 */
function hookCompleteCoverageMatchesCounts(
  coverage: HookResultCoverage,
): boolean {
  // Partial or absent coverage is validated by its outcome instead of complete-count rules.
  if (coverage.status !== "complete") return true;

  return (
    coverage.completedUnits === coverage.attemptedUnits &&
    coverage.skippedUnits === 0
  );
}

/**
 * Validate the minimum result invariants before an adapter can show or enforce them.
 * Use when a hook finishes so incomplete work cannot be presented to users as a pass.
 *
 * @param hookResult - provider-neutral result; an empty findings list means no bounded detail is shown
 * @returns validation messages; an empty list means the result is safe to hand to an adapter
 */
export function validateHookResultEnvelope(
  hookResult: HookResultEnvelope,
): string[] {
  const validationMessages: string[] = [];

  // A pass badge is truthful only when every declared unit completed.
  if (
    hookResult.outcome === "pass" &&
    hookResult.coverage.status !== "complete"
  ) {
    validationMessages.push("pass requires complete coverage");
  }

  // The shared 20-item cap keeps hook feedback readable in every supported UI.
  if (hookResult.findings.length > HOOK_RESULT_FINDING_LIMIT) {
    validationMessages.push(
      `findings exceed the ${HOOK_RESULT_FINDING_LIMIT}-item limit`,
    );
  }

  // Oversized envelopes may be dropped by the host instead of reaching the user's agent.
  if (
    Buffer.byteLength(JSON.stringify(hookResult), "utf8") >
    HOOK_RESULT_OUTPUT_LIMIT_BYTES
  ) {
    validationMessages.push(
      `result exceeds the ${HOOK_RESULT_OUTPUT_LIMIT_BYTES}-byte limit`,
    );
  }

  // Negative or fractional counts cannot explain scanned and skipped user content.
  if (!hookCoverageCountsAreValid(hookResult.coverage)) {
    validationMessages.push("coverage counts must be non-negative integers");
  }

  // Completed and skipped work cannot exceed what the hook told the user it attempted.
  if (
    hookResult.coverage.completedUnits + hookResult.coverage.skippedUnits >
    hookResult.coverage.attemptedUnits
  ) {
    validationMessages.push("coverage counts exceed attempted units");
  }

  // Complete coverage means every attempted unit finished and none were skipped.
  if (!hookCompleteCoverageMatchesCounts(hookResult.coverage)) {
    validationMessages.push(
      "complete coverage must finish every attempted unit",
    );
  }

  // An empty list lets the final adapter preserve this result for the user.
  return validationMessages;
}
