/**
 * Locks the bounded provider-neutral result passed from hooks to host adapters.
 * Use these checks when a hook adds outcomes or coverage detail, so users cannot
 * receive a clean badge for skipped work or an unreadable wall of findings.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOOK_RESULT_FINDING_LIMIT,
  HOOK_RESULT_OUTPUT_LIMIT_BYTES,
  HOOK_RESULT_SCHEMA,
  validateHookResultEnvelope,
  type HookResultCoverage,
  type HookResultEnvelope,
  type HookResultExecution,
  type HookResultFinding,
  type HookResultOutcome,
  type HookResultReasonCode,
} from "../../src/cli/hook-contracts.js";

/**
 * Build a complete clean result with overrides for one user-visible contract case.
 * Use when a fixture needs to isolate outcome, coverage, or finding bounds.
 *
 * @param resultOverrides - changed result fields; empty means a complete clean pass
 * @returns versioned hook result; an empty findings list means no detail is shown to the user
 */
function completeHookResult(
  resultOverrides: Partial<HookResultEnvelope> = {},
): HookResultEnvelope {
  const completeUserCoverage: HookResultCoverage = {
    status: "complete",
    attemptedUnits: 2,
    completedUnits: 2,
    skippedUnits: 0,
  };
  const completedCleanReason: HookResultReasonCode = "completed-clean";
  // An empty finding list means the clean UI needs no detail rows.
  const userVisibleFindings: HookResultFinding[] = [];
  const providerExecution: HookResultExecution = {
    hookVersion: "1.15.1",
    provider: "claude",
    providerMode: "interactive",
    adapterName: "claude-stop",
    adapterVersion: "1",
    durationMs: 12,
  };

  return {
    schema: HOOK_RESULT_SCHEMA,
    hookId: "post-turn-safety",
    event: "turn-stop",
    outcome: "pass",
    coverage: completeUserCoverage,
    reasonCode: completedCleanReason,
    findings: userVisibleFindings,
    execution: providerExecution,
    ...resultOverrides,
  };
}

/**
 * Confirm one non-pass outcome remains valid before a provider adapter translates it.
 * Use so each user-visible meaning has a direct assertion without a test loop.
 *
 * @param userVisibleOutcome - result meaning under test; an absent outcome cannot form an envelope
 * @returns nothing; a validation message fails the named outcome contract
 */
function assertHookOutcomeRemainsValid(
  userVisibleOutcome: HookResultOutcome,
): void {
  assert.deepEqual(
    validateHookResultEnvelope(
      completeHookResult({ outcome: userVisibleOutcome }),
    ),
    [],
  );
}

describe("hook result contract", () => {
  // Complete declared coverage lets the user rely on a clean pass.
  it("accepts a complete pass", () => {
    assert.deepEqual(validateHookResultEnvelope(completeHookResult()), []);
  });

  // Skipped work remains incomplete instead of producing a clean badge.
  it("rejects pass when coverage is partial", () => {
    const validationMessages = validateHookResultEnvelope(
      completeHookResult({
        coverage: {
          status: "partial",
          attemptedUnits: 2,
          completedUnits: 1,
          skippedUnits: 1,
        },
      }),
    );

    assert.ok(validationMessages.includes("pass requires complete coverage"));
  });

  // Every blocking, feedback, and failure meaning survives the neutral contract unchanged.
  it("preserves block, advisory, incomplete, and unavailable outcomes", () => {
    assertHookOutcomeRemainsValid("block");
    assertHookOutcomeRemainsValid("advisory");
    assertHookOutcomeRemainsValid("incomplete");
    assertHookOutcomeRemainsValid("unavailable");
  });

  // More than 20 findings becomes a bounded summary instead of flooding the user's context.
  it("rejects findings beyond the shared display cap", () => {
    // One extra finding proves the validator rejects the first over-limit result.
    const overLimitFindings = Array.from(
      { length: HOOK_RESULT_FINDING_LIMIT + 1 },
      (_, findingIndex) => ({
        code: `finding-${findingIndex + 1}`,
        message: "Bounded contract fixture",
      }),
    );
    const validationMessages = validateHookResultEnvelope(
      completeHookResult({ findings: overLimitFindings }),
    );

    assert.ok(
      validationMessages.includes(
        `findings exceed the ${HOOK_RESULT_FINDING_LIMIT}-item limit`,
      ),
    );
  });

  // A result larger than the smallest host channel stays unavailable instead of being truncated.
  it("rejects an oversized result envelope", () => {
    const validationMessages = validateHookResultEnvelope(
      completeHookResult({
        findings: [
          {
            code: "oversized-result",
            message: "x".repeat(HOOK_RESULT_OUTPUT_LIMIT_BYTES),
          },
        ],
      }),
    );

    assert.ok(
      validationMessages.includes(
        `result exceeds the ${HOOK_RESULT_OUTPUT_LIMIT_BYTES}-byte limit`,
      ),
    );
  });

  // A complete label cannot hide a skipped unit from the user.
  it("rejects inconsistent complete coverage counts", () => {
    const validationMessages = validateHookResultEnvelope(
      completeHookResult({
        coverage: {
          status: "complete",
          attemptedUnits: 2,
          completedUnits: 1,
          skippedUnits: 1,
        },
      }),
    );

    assert.ok(
      validationMessages.includes(
        "complete coverage must finish every attempted unit",
      ),
    );
  });
});
