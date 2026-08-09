/**
 * Locks provider documentation, live capture, trust, and effective-state contracts.
 * Use these fixtures when provider docs or runtime observations change, before the
 * dashboard or setup flow can claim that a configured hook protects the user.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOOK_PROVIDER_EVIDENCE_SCHEMA,
  assessHookProviderEvidence,
  classifyHookEffectiveState,
  type HookEffectiveStateFacts,
  type HookLifecycleEvent,
  type HookProviderCaptureEvidence,
  type HookProviderCaptureState,
  type HookProviderDocumentationEvidence,
  type HookProviderDocumentationState,
  type HookProviderEvidenceRecord,
  type HookProviderResponseChannel,
} from "../../src/cli/hook-contracts.js";

const SUPPORT_CHECK_DATE = new Date("2026-08-09T12:00:00.000Z");
const TURN_STOP_EVENT: HookLifecycleEvent = "turn-stop";
const FRESH_DOCUMENTATION_STATE: HookProviderDocumentationState =
  "fresh-supported";
const FRESH_CAPTURE_STATE: HookProviderCaptureState = "fresh-supported";
const DELIVERED_RESPONSE_CHANNELS: HookProviderResponseChannel[] = [
  "stdout-json",
  "model-context",
];

/**
 * Build a documented Codex Stop record without inventing a live provider run.
 * Use when a fixture needs current source evidence while delivery remains absent.
 *
 * @returns provider record whose missing capture means users see unverified delivery
 */
function documentedProviderRecord(): HookProviderEvidenceRecord & {
  documentation: HookProviderDocumentationEvidence;
} {
  return {
    schema: HOOK_PROVIDER_EVIDENCE_SCHEMA,
    provider: "codex",
    canonicalEvent: TURN_STOP_EVENT,
    providerEventName: "Stop",
    documentation: {
      sourceUrl: "https://developers.openai.com/codex/hooks",
      checkedAt: "2026-08-09T00:00:00.000Z",
      expiresAt: "2026-09-08T00:00:00.000Z",
      isSupportDeclared: true,
    },
  };
}

/**
 * Build one fresh trusted capture, with named overrides for the user state under test.
 * Use when a fixture needs to isolate expiry, trust, or result-delivery behavior.
 *
 * @param captureOverrides - changed capture fields; empty means a fresh delivered result
 * @returns complete capture evidence; no field is empty in the default user-success path
 */
function freshProviderCapture(
  captureOverrides: Partial<HookProviderCaptureEvidence> = {},
): HookProviderCaptureEvidence {
  return {
    providerVersion: "1.0.0",
    providerMode: "non-interactive",
    hookVersion: "1.15.1",
    adapterVersion: "1",
    configurationSource: "project",
    trustState: "trusted",
    capturedAt: "2026-08-09T00:00:00.000Z",
    expiresAt: "2026-09-08T00:00:00.000Z",
    supportOutcome: "supported",
    observedPayloadFields: ["hook_event_name", "last_assistant_message"],
    responseChannels: DELIVERED_RESPONSE_CHANNELS,
    resultDelivery: "delivered",
    timeoutBehavior: "completed",
    continuationBehavior: "continued",
    modelResultVisibility: "visible",
    ...captureOverrides,
  };
}

/**
 * Build a fully effective hook state with overrides for one failed user-facing gate.
 * Use when a fixture must prove severity at a specific point in the support chain.
 *
 * @param stateOverrides - facts changed for the scenario; empty means every gate is proven
 * @returns effective-state facts; every default boolean is true and every evidence layer is fresh
 */
function effectiveStateFacts(
  stateOverrides: Partial<HookEffectiveStateFacts> = {},
): HookEffectiveStateFacts {
  return {
    isDesired: true,
    providerDocumentation: FRESH_DOCUMENTATION_STATE,
    providerCapture: FRESH_CAPTURE_STATE,
    isRegistered: true,
    isCurrentVersionInstalled: true,
    isTrusted: true,
    hasObservedRun: true,
    hasDeliveredResult: true,
    isScenarioVerified: true,
    ...stateOverrides,
  };
}

describe("hook provider contracts", () => {
  // Current documentation informs the user but cannot impersonate live delivery.
  it("keeps documented support separate from absent capture", () => {
    const assessment = assessHookProviderEvidence(
      documentedProviderRecord(),
      SUPPORT_CHECK_DATE,
    );

    assert.deepEqual(assessment, {
      documentation: "fresh-supported",
      capture: "absent",
    });
    assert.deepEqual(
      classifyHookEffectiveState(
        effectiveStateFacts({ providerCapture: assessment.capture }),
      ),
      { status: "provider-capture-absent", severity: "warning" },
    );
  });

  // Expired source and runtime evidence tell the user to re-check the provider.
  it("marks dated documentation and capture stale", () => {
    const providerRecord = documentedProviderRecord();
    providerRecord.documentation = {
      ...providerRecord.documentation,
      expiresAt: "2026-08-08T00:00:00.000Z",
    };
    providerRecord.capture = freshProviderCapture({
      expiresAt: "2026-08-08T00:00:00.000Z",
    });

    assert.deepEqual(
      assessHookProviderEvidence(providerRecord, SUPPORT_CHECK_DATE),
      { documentation: "stale", capture: "stale" },
    );
  });

  // An unreviewed provider configuration is dangerous even when a hook was observed.
  it("keeps untrusted capture out of live support", () => {
    const providerRecord = documentedProviderRecord();
    providerRecord.capture = freshProviderCapture({ trustState: "untrusted" });
    const assessment = assessHookProviderEvidence(
      providerRecord,
      SUPPORT_CHECK_DATE,
    );

    assert.equal(assessment.capture, "untrusted");
    assert.deepEqual(
      classifyHookEffectiveState(
        effectiveStateFacts({ providerCapture: assessment.capture }),
      ),
      { status: "provider-capture-untrusted", severity: "danger" },
    );
  });

  // A fired hook without delivered feedback remains inconclusive for the user.
  it("does not promote an undelivered capture to support", () => {
    const providerRecord = documentedProviderRecord();
    providerRecord.capture = freshProviderCapture({
      resultDelivery: "not-delivered",
      modelResultVisibility: "not-visible",
    });

    assert.equal(
      assessHookProviderEvidence(providerRecord, SUPPORT_CHECK_DATE).capture,
      "inconclusive",
    );
  });

  // Only the complete chain earns the success state shown to users.
  it("requires every effective-state gate", () => {
    assert.deepEqual(classifyHookEffectiveState(effectiveStateFacts()), {
      status: "effective",
      severity: "success",
    });
    assert.deepEqual(
      classifyHookEffectiveState(
        effectiveStateFacts({ hasDeliveredResult: false }),
      ),
      { status: "result-undelivered", severity: "danger" },
    );
    assert.deepEqual(
      classifyHookEffectiveState(
        effectiveStateFacts({ isScenarioVerified: false }),
      ),
      { status: "scenario-unverified", severity: "warning" },
    );
    assert.deepEqual(
      classifyHookEffectiveState(effectiveStateFacts({ isDesired: false })),
      { status: "disabled", severity: "neutral" },
    );
  });
});
