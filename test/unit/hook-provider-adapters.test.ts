/**
 * Locks the runtime boundary that turns one neutral hook result into host output.
 * Use these fixtures before migrating a detector, so malformed or incomplete
 * child output cannot become a clean badge and provider-specific feedback stays
 * bounded, model-visible where supported, and blocking where required.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOOK_RESULT_ADAPTER_VERSION,
  HOOK_RESULT_FINDING_LIMIT as RUNTIME_FINDING_LIMIT,
  HOOK_RESULT_OUTPUT_LIMIT_BYTES as RUNTIME_OUTPUT_LIMIT_BYTES,
  HOOK_RESULT_SCHEMA as RUNTIME_RESULT_SCHEMA,
  adaptHookResultForProvider,
  decodeHookResultOutput,
} from "../../workflow/hooks/hook-provider-adapters.mjs";
import {
  HOOK_RESULT_FINDING_LIMIT,
  HOOK_RESULT_OUTPUT_LIMIT_BYTES,
  HOOK_RESULT_SCHEMA,
  type HookLifecycleEvent,
  type HookResultEnvelope,
  type HookResultOutcome,
} from "../../src/cli/hook-contracts.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";
import type { AgentId } from "../../src/cli/types.js";

/**
 * Build one complete neutral result for the provider and lifecycle under test.
 * Use when a fixture needs to isolate output parsing or final host translation.
 *
 * @param providerIdentifier - registered host; empty text cannot identify an adapter
 * @param hookEvent - registered lifecycle point; empty text cannot select host behavior
 * @param hookOutcome - user-visible meaning; an absent value cannot form a result
 * @returns complete result; an empty findings list means reason-code-only feedback
 */
function providerHookResult(
  providerIdentifier: AgentId,
  hookEvent: HookLifecycleEvent,
  hookOutcome: HookResultOutcome,
): HookResultEnvelope {
  const isCompleteResult = hookOutcome === "pass";
  return {
    schema: HOOK_RESULT_SCHEMA,
    hookId: "fixture-hook",
    event: hookEvent,
    outcome: hookOutcome,
    coverage: {
      status: isCompleteResult ? "complete" : "partial",
      attemptedUnits: 2,
      completedUnits: isCompleteResult ? 2 : 1,
      skippedUnits: isCompleteResult ? 0 : 1,
    },
    reasonCode:
      hookOutcome === "pass" ? "completed-clean" : "coverage-incomplete",
    // Empty findings make these fixtures prove the reason-code fallback shown to the user.
    findings: [],
    execution: {
      hookVersion: "1.15.1",
      provider: providerIdentifier,
      providerMode: "fixture",
      adapterName: `${providerIdentifier}-${hookEvent}`,
      adapterVersion: HOOK_RESULT_ADAPTER_VERSION,
      durationMs: 12,
    },
  };
}

/**
 * Decode a typed fixture through the same string boundary used by a child hook.
 * Use before adapter assertions so tests cannot bypass runtime JSON validation.
 * Error behavior: throws the parser reason when a supposedly valid fixture is rejected.
 *
 * @param hookResult - complete fixture; null or malformed values belong in rejection tests
 * @returns decoded result object; a rejection fails the fixture with its user-facing reason
 */
function decodeFixtureResult(hookResult: HookResultEnvelope) {
  const decodedResult = decodeHookResultOutput(JSON.stringify(hookResult));
  assert.equal(decodedResult.state, "valid");
  // A valid state always carries the decoded object; an empty result would be a parser defect.
  if (decodedResult.state !== "valid") {
    throw new Error(decodedResult.reason);
  }
  return decodedResult.result;
}

describe("hook provider adapters", () => {
  // Runtime and TypeScript constants must stay identical for installed and dashboard users.
  it("keeps runtime result limits aligned with the typed contract", () => {
    assert.equal(RUNTIME_RESULT_SCHEMA, HOOK_RESULT_SCHEMA);
    assert.equal(RUNTIME_FINDING_LIMIT, HOOK_RESULT_FINDING_LIMIT);
    assert.equal(RUNTIME_OUTPUT_LIMIT_BYTES, HOOK_RESULT_OUTPUT_LIMIT_BYTES);
  });

  /**
   * Proves the launcher can report adapter failure before each coding-agent host times out.
   * Invariant: missing registry metadata fails the bound instead of hiding an unsafe wait.
   */
  it("keeps launcher deadlines below host timeouts", () => {
    const denySpec = getHookSpec("deny-dangerous");
    const gruffSpec = getHookSpec("gruff-code-quality");
    assert.ok(denySpec);
    assert.ok(gruffSpec);
    // Missing deny-hook metadata maps to a failed comparison, not false deadline proof.
    assert.ok(
      (denySpec.deliveryContract?.launcherDeadlineMs ?? Infinity) <
        (denySpec.timeoutSec ?? 0) * 1_000,
    );
    // Missing Gruff metadata likewise fails before users receive an unbounded registration.
    assert.ok(
      (gruffSpec.deliveryContract?.launcherDeadlineMs ?? Infinity) <
        (gruffSpec.timeoutSec ?? 0) * 1_000,
    );
  });

  // A complete clean envelope is the only child output that may become a pass.
  it("decodes one complete bounded result", () => {
    const decodedResult = decodeHookResultOutput(
      JSON.stringify(providerHookResult("claude", "post-tool", "pass")),
    );

    assert.equal(decodedResult.state, "valid");
  });

  // Plain legacy text, concatenated objects, and blank output are ambiguous during migration.
  it("rejects legacy, multiple, and empty child output", () => {
    assert.deepEqual(decodeHookResultOutput("legacy finding"), {
      state: "invalid",
      reason: "result output is not one JSON object",
    });
    assert.deepEqual(decodeHookResultOutput("{}\n{}"), {
      state: "invalid",
      reason: "result output is not one JSON object",
    });
    assert.deepEqual(decodeHookResultOutput(""), {
      state: "invalid",
      reason: "result output is empty",
    });
  });

  // Oversized child output is rejected before JSON parsing can consume the host channel.
  it("rejects child output beyond the shared byte limit", () => {
    const oversizedChildOutput = "x".repeat(HOOK_RESULT_OUTPUT_LIMIT_BYTES + 1);

    assert.deepEqual(decodeHookResultOutput(oversizedChildOutput), {
      state: "invalid",
      reason: `result output exceeds the ${HOOK_RESULT_OUTPUT_LIMIT_BYTES}-byte limit`,
    });
  });

  // Partial coverage cannot produce the clean state the user relies on.
  it("rejects pass when declared coverage is incomplete", () => {
    const incompletePass = providerHookResult("claude", "post-tool", "pass");
    incompletePass.coverage = {
      status: "partial",
      attemptedUnits: 2,
      completedUnits: 1,
      skippedUnits: 1,
    };

    assert.deepEqual(decodeHookResultOutput(JSON.stringify(incompletePass)), {
      state: "invalid",
      reason: "pass requires complete coverage",
    });
  });

  // Fixture covers the documented deny shape for incomplete policy work in each active host.
  it("preserves pre-tool blocking across provider schemas", () => {
    const claudeOutput = adaptHookResultForProvider(
      decodeFixtureResult(
        providerHookResult("claude", "pre-tool", "incomplete"),
      ),
      "claude",
      "pre-tool",
    );
    const codexOutput = adaptHookResultForProvider(
      decodeFixtureResult(
        providerHookResult("codex", "pre-tool", "incomplete"),
      ),
      "codex",
      "pre-tool",
    );
    const antigravityOutput = adaptHookResultForProvider(
      decodeFixtureResult(
        providerHookResult("antigravity", "pre-tool", "incomplete"),
      ),
      "antigravity",
      "pre-tool",
    );
    const copilotOutput = adaptHookResultForProvider(
      decodeFixtureResult(
        providerHookResult("copilot", "pre-tool", "incomplete"),
      ),
      "copilot",
      "pre-tool",
    );

    assert.equal(claudeOutput.state, "adapted");
    assert.match(claudeOutput.stdout ?? "", /"permissionDecision":"deny"/u);
    assert.equal(codexOutput.state, "adapted");
    assert.match(codexOutput.stdout ?? "", /"permissionDecision":"deny"/u);
    assert.equal(antigravityOutput.state, "adapted");
    assert.match(antigravityOutput.stdout ?? "", /"decision":"deny"/u);
    assert.equal(copilotOutput.state, "adapted");
    assert.match(copilotOutput.stdout ?? "", /"permissionDecision":"deny"/u);
  });

  // Fixture covers feedback-bearing host shapes without guessing Antigravity delivery.
  it("adapts post-tool feedback only where the host can deliver it", () => {
    const claudeOutput = adaptHookResultForProvider(
      decodeFixtureResult(
        providerHookResult("claude", "post-tool", "advisory"),
      ),
      "claude",
      "post-tool",
    );
    const codexOutput = adaptHookResultForProvider(
      decodeFixtureResult(providerHookResult("codex", "post-tool", "advisory")),
      "codex",
      "post-tool",
    );
    const copilotOutput = adaptHookResultForProvider(
      decodeFixtureResult(
        providerHookResult("copilot", "post-tool", "advisory"),
      ),
      "copilot",
      "post-tool",
    );
    const antigravityOutput = adaptHookResultForProvider(
      decodeFixtureResult(
        providerHookResult("antigravity", "post-tool", "advisory"),
      ),
      "antigravity",
      "post-tool",
    );

    assert.equal(claudeOutput.state, "adapted");
    assert.match(claudeOutput.stdout ?? "", /"additionalContext"/u);
    assert.equal(codexOutput.state, "adapted");
    assert.match(codexOutput.stdout ?? "", /"additionalContext"/u);
    assert.equal(copilotOutput.state, "adapted");
    assert.match(copilotOutput.stdout ?? "", /^\{"additionalContext"/u);
    assert.deepEqual(antigravityOutput, {
      state: "unsupported",
      reason: "Antigravity PostToolUse cannot deliver hook feedback",
    });
  });

  // A post-tool block stays unsupported when the host offers context but no enforcement field.
  it("does not demote a Copilot post-tool block to advisory context", () => {
    const providerOutput = adaptHookResultForProvider(
      decodeFixtureResult(providerHookResult("copilot", "post-tool", "block")),
      "copilot",
      "post-tool",
    );

    assert.deepEqual(providerOutput, {
      state: "unsupported",
      reason: "Copilot postToolUse cannot preserve a blocking hook result",
    });
  });

  // Fixture covers unavailable stop results in each provider's continuation vocabulary.
  it("preserves blocking stop behavior across provider schemas", () => {
    const claudeOutput = adaptHookResultForProvider(
      decodeFixtureResult(
        providerHookResult("claude", "turn-stop", "unavailable"),
      ),
      "claude",
      "turn-stop",
    );
    const antigravityOutput = adaptHookResultForProvider(
      decodeFixtureResult(
        providerHookResult("antigravity", "turn-stop", "unavailable"),
      ),
      "antigravity",
      "turn-stop",
    );
    const copilotOutput = adaptHookResultForProvider(
      decodeFixtureResult(
        providerHookResult("copilot", "turn-stop", "unavailable"),
      ),
      "copilot",
      "turn-stop",
    );

    assert.equal(claudeOutput.state, "adapted");
    assert.match(claudeOutput.stdout ?? "", /"decision":"block"/u);
    assert.equal(antigravityOutput.state, "adapted");
    assert.match(antigravityOutput.stdout ?? "", /"decision":"continue"/u);
    assert.equal(copilotOutput.state, "adapted");
    assert.match(copilotOutput.stdout ?? "", /"decision":"block"/u);
  });

  // One exact repeated infrastructure failure may end the user's provider loop without becoming a clean scan.
  it("ends a bounded Stop re-entry while retaining its incomplete result", () => {
    const boundedReentryResult: HookResultEnvelope = {
      ...providerHookResult("codex", "turn-stop", "incomplete"),
      reasonCode: "bounded-reentry-ended",
    };
    const providerOutput = adaptHookResultForProvider(
      decodeFixtureResult(boundedReentryResult),
      "codex",
      "turn-stop",
    );

    assert.equal(providerOutput.state, "adapted");
    assert.equal(providerOutput.stdout, "");
  });

  // A fixture cannot claim one host while being delivered through another user's config.
  it("rejects provider and lifecycle mismatches", () => {
    const claudeResult = decodeFixtureResult(
      providerHookResult("claude", "post-tool", "advisory"),
    );

    assert.deepEqual(
      adaptHookResultForProvider(claudeResult, "codex", "post-tool"),
      {
        state: "invalid",
        reason: "result provider does not match the registered host",
      },
    );
    assert.deepEqual(
      adaptHookResultForProvider(claudeResult, "claude", "turn-stop"),
      {
        state: "invalid",
        reason: "result event does not match the registered hook",
      },
    );
  });
});
