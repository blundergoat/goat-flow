/**
 * Locks provider documentation, live capture, trust, effective-state, and result contracts.
 * Use these fixtures before dashboard or setup claims change, and when a hook result
 * must stay visible across native, compatibility, or provider-adapter boundaries.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
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
import {
  adaptHookResultForProvider,
  decodeHookResultOutput,
} from "../../workflow/hooks/hook-provider-adapters.mjs";
import {
  CLEAN_GRUFF_CONTRACT_ENVELOPE,
  cleanupHookTestDirs,
  FINDING_GRUFF_CONTRACT_ENVELOPE,
  makeEditedGruffContractProject,
  makeRoot,
  readMigratedGruffResult,
  runMigratedHook,
  sampleGruffEditPayload,
  writeContractGruffBinary,
} from "./gruff-code-quality-smoke.helpers.js";
import {
  FORCE_BASH3_ENV_KEY,
  HOOK_PATH,
  TEST_API_TOKEN,
  buildStopPayload,
  runHook,
  withCommandShim,
  withTempRepo,
  writeFile,
} from "./post-turn-safety-hook.helpers.js";

const SUPPORT_CHECK_DATE = new Date("2026-08-09T12:00:00.000Z");
const TURN_STOP_EVENT: HookLifecycleEvent = "turn-stop";
const FRESH_DOCUMENTATION_STATE: HookProviderDocumentationState =
  "fresh-supported";
const FRESH_CAPTURE_STATE: HookProviderCaptureState = "fresh-supported";
const DELIVERED_RESPONSE_CHANNELS: HookProviderResponseChannel[] = [
  "stdout-json",
  "model-context",
];
const STOP_SCANNER_VARIANTS = [
  { displayName: "native scanner", forceBash3Fallback: "0" },
  { displayName: "Bash 3 compatibility scanner", forceBash3Fallback: "1" },
] as const;
const GRUFF_RESULT_FIXTURES = [
  {
    label: "clean analysis",
    envelope: CLEAN_GRUFF_CONTRACT_ENVELOPE,
    behavior: {},
    environment: {},
    outcome: "pass",
    reasonCode: "completed-clean",
    expectedFindingCodes: [],
  },
  {
    label: "reported finding",
    envelope: FINDING_GRUFF_CONTRACT_ENVELOPE,
    behavior: {},
    environment: {},
    outcome: "advisory",
    reasonCode: "findings-reported",
    expectedFindingCodes: ["size.file-length", "naming.short"],
  },
  {
    label: "invalid response",
    envelope: "not-json",
    behavior: {},
    environment: {},
    outcome: "incomplete",
    reasonCode: "output-invalid",
    expectedFindingCodes: ["analyzer-response-invalid"],
  },
  {
    label: "failed analyzer",
    envelope: "",
    behavior: { exitStatus: 7, standardError: "dependency crashed" },
    environment: {},
    outcome: "unavailable",
    reasonCode: "hook-unavailable",
    expectedFindingCodes: ["analyzer-failed"],
  },
  {
    label: "timed-out analyzer",
    envelope: CLEAN_GRUFF_CONTRACT_ENVELOPE,
    behavior: { delaySeconds: 2 },
    environment: { GRUFF_CODE_QUALITY_TIMEOUT_SECONDS: "1" },
    outcome: "incomplete",
    reasonCode: "execution-timeout",
    expectedFindingCodes: ["analyzer-timeout"],
  },
] as const;

after(cleanupHookTestDirs);

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

  describe("configured Gruff result delivery", () => {
    // Named cases show users whether analysis passed, found debt, failed, or timed out.
    for (const resultFixture of GRUFF_RESULT_FIXTURES) {
      // Fixture purpose: runs one analyzer state; Invariant: bounded result fields stay deterministic.
      it(`reports ${resultFixture.label} with a bounded result`, () => {
        const projectRoot = makeEditedGruffContractProject(
          resultFixture.envelope,
          resultFixture.behavior,
        );
        const hookResult = readMigratedGruffResult(
          runMigratedHook(
            projectRoot,
            sampleGruffEditPayload(),
            "/usr/bin:/bin",
            resultFixture.environment,
          ),
        );

        assert.equal(
          hookResult.outcome,
          resultFixture.outcome,
          resultFixture.label,
        );
        assert.equal(
          hookResult.reasonCode,
          resultFixture.reasonCode,
          resultFixture.label,
        );
        const userVisibleFindingCodes = (
          hookResult.findings as Array<{
            code: string;
          }>
        ).map((finding) => finding.code);
        // An empty expected list means clean analysis leaves the user's UI free of detail rows.
        assert.deepEqual(
          userVisibleFindingCodes,
          resultFixture.expectedFindingCodes,
          resultFixture.label,
        );
      });
    }

    const prerequisiteFixtures = [
      {
        label: "missing config",
        /** Side effects: installs only the analyzer so users see which config they still need. */
        prepareProject(projectRoot: string) {
          writeContractGruffBinary(projectRoot, CLEAN_GRUFF_CONTRACT_ENVELOPE);
        },
        findingCode: "analyzer-config-missing",
      },
      {
        label: "ambiguous config",
        /** Side effects: writes both config names so users must choose one source of truth. */
        prepareProject(projectRoot: string) {
          writeContractGruffBinary(projectRoot, CLEAN_GRUFF_CONTRACT_ENVELOPE);
          writeFileSync(join(projectRoot, ".gruff-ts.yaml"), "rules: {}\n");
          writeFileSync(join(projectRoot, ".gruff-ts.yml"), "rules: {}\n");
        },
        findingCode: "analyzer-config-ambiguous",
      },
      {
        label: "missing binary",
        /** Side effects: writes only config so users see the matching analyzer is absent. */
        prepareProject(projectRoot: string) {
          writeFileSync(join(projectRoot, ".gruff-ts.yaml"), "rules: {}\n");
        },
        findingCode: "analyzer-binary-missing",
      },
      {
        label: "unsupported capability",
        /** Writes an older analyzer and config so users see why JSON feedback is unavailable. */
        prepareProject(projectRoot: string) {
          const analyzerDirectoryPath = join(projectRoot, "bin");
          mkdirSync(analyzerDirectoryPath, { recursive: true });
          const analyzerPath = join(analyzerDirectoryPath, "gruff-ts");
          writeFileSync(
            analyzerPath,
            '#!/usr/bin/env bash\n# A user may still have a pre-JSON analyzer on PATH after enabling Gruff.\nif [[ "$1" == "analyse" && "$2" == "--help" ]]; then printf "Usage: gruff analyse FILE\\n"; fi\nexit 0\n',
          );
          chmodSync(analyzerPath, 0o755);
          writeFileSync(join(projectRoot, ".gruff-ts.yaml"), "rules: {}\n");
        },
        findingCode: "analyzer-capability-unsupported",
      },
    ] as const;

    // Each named test tells users which missing prerequisite they must repair.
    for (const prerequisiteFixture of prerequisiteFixtures) {
      // This case creates a disposable project and writes only the selected setup files.
      it(`reports ${prerequisiteFixture.label} as unavailable`, () => {
        const projectRoot = makeRoot();
        mkdirSync(join(projectRoot, "src"), { recursive: true });
        writeFileSync(join(projectRoot, "src", "sample.ts"), "a\nb\nc\n");
        prerequisiteFixture.prepareProject(projectRoot);
        const hookResult = readMigratedGruffResult(
          runMigratedHook(
            projectRoot,
            sampleGruffEditPayload(),
            "/usr/bin:/bin",
          ),
        );

        assert.equal(
          hookResult.outcome,
          "unavailable",
          prerequisiteFixture.label,
        );
        assert.equal(
          hookResult.reasonCode,
          "hook-unavailable",
          prerequisiteFixture.label,
        );
        assert.equal(
          (hookResult.findings as Array<{ code: string }>)[0]?.code,
          prerequisiteFixture.findingCode,
          prerequisiteFixture.label,
        );
      });
    }

    const expectedProviderFields = [
      { provider: "claude", pattern: /"hookSpecificOutput"/u },
      { provider: "codex", pattern: /"additionalContext"/u },
      { provider: "copilot", pattern: /^\{"additionalContext"/u },
    ] as const;

    // Each provider case names the host translation users receive after an edit.
    for (const providerFixture of expectedProviderFields) {
      // Fixture purpose: creates an edit and runs Gruff; Invariant: provider output keeps the finding.
      it(`adapts one Gruff finding for ${providerFixture.provider}`, () => {
        const projectRoot = makeEditedGruffContractProject(
          FINDING_GRUFF_CONTRACT_ENVELOPE,
        );
        const hookResult = readMigratedGruffResult(
          runMigratedHook(
            projectRoot,
            sampleGruffEditPayload(),
            "/usr/bin:/bin",
            {},
            providerFixture.provider,
          ),
        );
        const providerResult = adaptHookResultForProvider(
          hookResult,
          providerFixture.provider,
          "post-tool",
        );

        assert.equal(providerResult.state, "adapted", providerFixture.provider);
        // Empty provider output means the editing user received no Gruff feedback.
        assert.match(providerResult.stdout ?? "", providerFixture.pattern);
      });
    }

    // This case creates an edited project and proves runnable input cannot imply feedback.
    it("keeps Antigravity Gruff feedback unsupported", () => {
      const antigravityProjectRoot = makeEditedGruffContractProject(
        FINDING_GRUFF_CONTRACT_ENVELOPE,
      );
      const antigravityResult = readMigratedGruffResult(
        runMigratedHook(
          antigravityProjectRoot,
          sampleGruffEditPayload(),
          "/usr/bin:/bin",
          {},
          "antigravity",
        ),
      );
      assert.deepEqual(
        adaptHookResultForProvider(
          antigravityResult,
          "antigravity",
          "post-tool",
        ),
        {
          state: "unsupported",
          reason: "Antigravity PostToolUse cannot deliver hook feedback",
        },
      );
    });
  });

  describe("configured Stop result delivery", () => {
    it("owns elapsed timing before emitting a managed Stop result", () => {
      const projectRoot = makeRoot();
      const hookExecution = runHook(
        projectRoot,
        {
          GOAT_FLOW_HOOK_RESULT_PROTOCOL: "goat-flow.hook-result.v1",
          GOAT_FLOW_HOOK_PROVIDER: "codex",
          GOAT_FLOW_HOOK_EVENT: "turn-stop",
          GOAT_FLOW_HOOK_PROVIDER_MODE: "managed",
          GOAT_FLOW_HOOK_ADAPTER_VERSION: "1",
          SECONDS: "-1",
        },
        "invalid-json",
      );

      assert.equal(hookExecution.status, 0, hookExecution.stderr);
      const decodedResult = decodeHookResultOutput(hookExecution.stdout);
      assert.equal(decodedResult.state, "valid", JSON.stringify(decodedResult));
      assert.equal(decodedResult.result.outcome, "incomplete");
      assert.equal(decodedResult.result.reasonCode, "input-invalid");
      assert.ok(
        Number.isInteger(decodedResult.result.execution.durationMs) &&
          decodedResult.result.execution.durationMs >= 0,
      );
    });

    for (const scannerVariant of STOP_SCANNER_VARIANTS) {
      it(`bounds a managed non-Git Stop root with the ${scannerVariant.displayName}`, () => {
        const forceBash3Fallback = scannerVariant.forceBash3Fallback;
        const projectRoot = makeRoot();
        const sessionIdentifier = `non-git-session-${forceBash3Fallback}`;
        const stateDirectory = join(projectRoot, ".goat-flow", "scratchpad");
        // List the state files present right now, so an assertion reads current disk truth rather than a cached snapshot.
        const statePaths = (): string[] =>
          existsSync(stateDirectory)
            ? readdirSync(stateDirectory)
                .filter((entry) =>
                  entry.startsWith("post-turn-safety-reentry-v1"),
                )
                .map((entry) => join(stateDirectory, entry))
            : [];
        const managedEnvironment = {
          GOAT_FLOW_HOOK_RESULT_PROTOCOL: "goat-flow.hook-result.v1",
          GOAT_FLOW_HOOK_PROVIDER: "codex",
          GOAT_FLOW_HOOK_EVENT: "turn-stop",
          GOAT_FLOW_HOOK_PROVIDER_MODE: "managed",
          GOAT_FLOW_HOOK_ADAPTER_VERSION: "1",
          [FORCE_BASH3_ENV_KEY]: forceBash3Fallback,
        };

        writeFile(
          projectRoot,
          ".goat-flow/hooks/post-turn-safety.sh",
          readFileSync(HOOK_PATH, "utf8"),
        );

        const directResult = runHook(
          projectRoot,
          { [FORCE_BASH3_ENV_KEY]: forceBash3Fallback },
          "",
        );
        assert.equal(directResult.status, 2, directResult.stderr);
        assert.deepEqual(statePaths(), []);

        const firstResult = runHook(
          projectRoot,
          managedEnvironment,
          buildStopPayload(sessionIdentifier, false),
        );
        assert.equal(firstResult.status, 0, firstResult.stderr);
        const firstEnvelope = JSON.parse(firstResult.stdout);
        assert.equal(firstEnvelope.outcome, "incomplete");
        assert.equal(firstEnvelope.reasonCode, "coverage-incomplete");
        const writtenStatePaths = statePaths();
        assert.equal(writtenStatePaths.length, 1);
        assert.equal(
          statSync(writtenStatePaths[0] as string).mode & 0o777,
          0o600,
        );

        const reentryResult = runHook(
          projectRoot,
          managedEnvironment,
          buildStopPayload(sessionIdentifier, true),
        );
        assert.equal(reentryResult.status, 0, reentryResult.stderr);
        const reentryEnvelope = JSON.parse(reentryResult.stdout);
        assert.equal(reentryEnvelope.outcome, "incomplete");
        assert.equal(reentryEnvelope.reasonCode, "bounded-reentry-ended");
        assert.match(reentryResult.stderr, /no clean scan was recorded/iu);
        assert.deepEqual(statePaths(), []);
      });
    }

    // Each named case creates a temporary Git repo and runs the selected shell scanner.
    for (const scannerVariant of STOP_SCANNER_VARIANTS) {
      // This case writes user files and re-entry state while hook subprocesses exercise recovery.
      it(`bounds repeated Stop failures with the ${scannerVariant.displayName}`, () => {
        const forceBash3Fallback = scannerVariant.forceBash3Fallback;
        withTempRepo((projectRoot) => {
          const sessionIdentifier = `fixture-session-${forceBash3Fallback}`;
          const reentryStateDirectory = join(
            projectRoot,
            ".goat-flow/scratchpad",
          );
          // State is keyed per session so concurrent sessions cannot clobber one another,
          // so the record is located by its stable prefix rather than one fixed filename.
          const reentryStatePaths = (): string[] =>
            existsSync(reentryStateDirectory)
              ? readdirSync(reentryStateDirectory)
                  .filter((entry) =>
                    entry.startsWith("post-turn-safety-reentry-v1"),
                  )
                  .map((entry) => join(reentryStateDirectory, entry))
              : [];
          writeFile(projectRoot, "settings.env", "API_KEY=your_api_key_here\n");

          withCommandShim("wc", "exit 2", (commandShimEnvironment) => {
            const firstFailure = runHook(
              projectRoot,
              {
                ...commandShimEnvironment,
                [FORCE_BASH3_ENV_KEY]: forceBash3Fallback,
              },
              buildStopPayload(sessionIdentifier, false),
            );
            assert.equal(firstFailure.status, 2, firstFailure.stderr);
            const writtenStatePaths = reentryStatePaths();
            assert.equal(writtenStatePaths.length, 1);
            const reentryStatePath = writtenStatePaths[0] as string;
            assert.equal(statSync(reentryStatePath).mode & 0o777, 0o600);
            assert.equal(
              readFileSync(reentryStatePath, "utf8").includes(
                sessionIdentifier,
              ),
              false,
            );
            // The per-session filename must carry the hash, never the raw session identifier.
            assert.equal(reentryStatePath.includes(sessionIdentifier), false);

            // Example: the user edits the file after a failed scan and introduces a real token.
            writeFile(
              projectRoot,
              "settings.env",
              `API_KEY=${TEST_API_TOKEN}\n`,
            );
            const changedFinding = runHook(
              projectRoot,
              { [FORCE_BASH3_ENV_KEY]: forceBash3Fallback },
              buildStopPayload(sessionIdentifier, true),
            );
            assert.equal(changedFinding.status, 2, changedFinding.stderr);
            assert.match(changedFinding.stderr, /API token/u);

            writeFile(
              projectRoot,
              "settings.env",
              "API_KEY=your_api_key_here\n",
            );
            const fixedResult = runHook(
              projectRoot,
              { [FORCE_BASH3_ENV_KEY]: forceBash3Fallback },
              buildStopPayload(sessionIdentifier, true),
            );
            assert.equal(fixedResult.status, 0, fixedResult.stderr);

            const repeatedFirstFailure = runHook(
              projectRoot,
              {
                ...commandShimEnvironment,
                [FORCE_BASH3_ENV_KEY]: forceBash3Fallback,
              },
              buildStopPayload(sessionIdentifier, false),
            );
            assert.equal(
              repeatedFirstFailure.status,
              2,
              repeatedFirstFailure.stderr,
            );
            const repeatedActiveFailure = runHook(
              projectRoot,
              {
                ...commandShimEnvironment,
                [FORCE_BASH3_ENV_KEY]: forceBash3Fallback,
              },
              buildStopPayload(sessionIdentifier, true),
            );
            assert.equal(
              repeatedActiveFailure.status,
              0,
              repeatedActiveFailure.stderr,
            );
            assert.match(
              repeatedActiveFailure.stderr,
              /ending repeated Stop.*infrastructure failure/iu,
            );
            assert.deepEqual(reentryStatePaths(), []);
          });
        });
      });
    }

    // Each named case writes a token fixture and runs the provider-managed shell result path.
    for (const scannerVariant of STOP_SCANNER_VARIANTS) {
      it(`emits neutral Stop results with the ${scannerVariant.displayName}`, () => {
        const forceBash3Fallback = scannerVariant.forceBash3Fallback;
        const managedCodexResultEnvironment = {
          GOAT_FLOW_HOOK_RESULT_PROTOCOL: "goat-flow.hook-result.v1",
          GOAT_FLOW_HOOK_PROVIDER: "codex",
          GOAT_FLOW_HOOK_EVENT: "turn-stop",
          GOAT_FLOW_HOOK_PROVIDER_MODE: "managed",
          GOAT_FLOW_HOOK_ADAPTER_VERSION: "1",
        };

        withTempRepo((projectRoot) => {
          const sessionIdentifier = `managed-result-session-${forceBash3Fallback}`;
          writeFile(projectRoot, "settings.env", `API_KEY=${TEST_API_TOKEN}\n`);
          const findingResult = runHook(
            projectRoot,
            {
              ...managedCodexResultEnvironment,
              [FORCE_BASH3_ENV_KEY]: forceBash3Fallback,
            },
            buildStopPayload(sessionIdentifier, false),
          );
          assert.equal(findingResult.status, 0, findingResult.stderr);
          const findingEnvelope = JSON.parse(findingResult.stdout);
          assert.equal(findingEnvelope.outcome, "block");
          assert.equal(findingEnvelope.reasonCode, "policy-blocked");
          // Missing finding detail would leave the user with no reason for the block.
          assert.match(
            findingEnvelope.findings[0]?.message ?? "",
            /API token/u,
          );
          assert.equal(findingEnvelope.findings[0]?.target, "settings.env");

          writeFile(projectRoot, "settings.env", "API_KEY=your_api_key_here\n");
          withCommandShim("wc", "exit 2", (commandShimEnvironment) => {
            const incompleteEnvironment = {
              ...commandShimEnvironment,
              ...managedCodexResultEnvironment,
              [FORCE_BASH3_ENV_KEY]: forceBash3Fallback,
            };
            const firstIncompleteResult = runHook(
              projectRoot,
              incompleteEnvironment,
              buildStopPayload(sessionIdentifier, false),
            );
            assert.equal(
              firstIncompleteResult.status,
              0,
              firstIncompleteResult.stderr,
            );
            const firstIncompleteEnvelope = JSON.parse(
              firstIncompleteResult.stdout,
            );
            assert.equal(firstIncompleteEnvelope.outcome, "incomplete");
            assert.equal(
              firstIncompleteEnvelope.reasonCode,
              "coverage-incomplete",
            );

            const boundedReentryResult = runHook(
              projectRoot,
              incompleteEnvironment,
              buildStopPayload(sessionIdentifier, true),
            );
            assert.equal(
              boundedReentryResult.status,
              0,
              boundedReentryResult.stderr,
            );
            const boundedReentryEnvelope = JSON.parse(
              boundedReentryResult.stdout,
            );
            assert.equal(boundedReentryEnvelope.outcome, "incomplete");
            assert.equal(
              boundedReentryEnvelope.reasonCode,
              "bounded-reentry-ended",
            );
            assert.match(
              boundedReentryResult.stderr,
              /no clean scan was recorded/iu,
            );
          });
        });
      });
    }
  });
});
