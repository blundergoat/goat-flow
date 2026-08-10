/**
 * Replays configured Gruff and post-turn commands with fixed offline payloads.
 * Use when a user verifies whether the exact command in agent config returns a
 * recognized result without launching a provider model or retaining hook output.
 * Shared report contracts remain in the deny-runtime evidence module.
 */
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

import { getAgentProfiles } from "./agents/registry.js";
import type { HookScenario } from "./cli-types.js";
import {
  recordEvidenceEvent,
  type AppendEvidenceEnvelopeResult,
  type CreateEvidenceEnvelopeInput,
} from "./evidence/envelope.js";
import { buildAgentHookCommand } from "./server/agent-hook-writer.js";
import { readAllHookStates } from "./server/hook-registrar.js";
import { getHookSpec } from "./server/hooks-registry.js";
import type { AgentId } from "./types.js";

/** Versioned result shape shared by deny and configured feedback proof. */
export const REPORT_SCHEMA = "goat-flow.hook-runtime-report.v1";
export const MANAGED_HOOK_PROOF_LEVEL = "managed-hook-classifier";
/** Evidence level for replay through the exact command shown in user config. */
export const CONFIGURED_HOOK_PROOF_LEVEL = "configured-hook-command";
/** Probe timeout. Rationale: five seconds loads local hooks but bounds stalled checkout code. */
export const PROBE_TIMEOUT_MS = 5_000; // Cap: bounds stalled project hook code.
/** Output cap. Rationale: sixteen kilobytes retains one diagnostic without unbounded text. */
export const PROBE_OUTPUT_CAP_BYTES = 16_384;

/** Final classification shown to terminal users and machine consumers. */
export type HookRuntimeVerdict =
  "pass" | "fail" | "unsupported" | "not-configured" | "error";

/** Stable explanation codes that avoid exposing captured hook diagnostics. */
export type HookRuntimeReasonCode =
  | "expected-observation"
  | "unexpected-observation"
  | "agent-hook-unsupported"
  | "hook-disabled"
  | "hook-not-installed"
  | "target-marked-untrusted"
  | "hook-registry-missing"
  | "probe-timed-out"
  | "hook-unavailable"
  | "probe-execution-error"
  | "evidence-write-failed";

/** Expected user-visible outcome declared by one fixed offline scenario. */
export type HookProbeExpected =
  "blocked" | "allowed" | "typed-result" | "incomplete" | "advisory";
/** Observed bounded outcome after a managed command returns. */
export type HookProbeObserved =
  | "blocked"
  | "allowed"
  | "clean"
  | "finding"
  | "incomplete"
  | "unavailable"
  | "not-run"
  | "error";

/** Bounded child-process result used only for local classification. */
export interface HookProbeExecution {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  hasSpawnError: boolean;
}

/** One user-visible scenario result without command or output content. */
export interface HookRuntimeScenarioResult {
  id: string;
  label: string;
  expected: HookProbeExpected;
  observed: HookProbeObserved;
  verdict: HookRuntimeVerdict;
  evidenceLevel:
    typeof MANAGED_HOOK_PROOF_LEVEL | typeof CONFIGURED_HOOK_PROOF_LEVEL;
  durationMs: number;
  reasonCode: HookRuntimeReasonCode;
  wasEvidenceRecorded: boolean;
}

/** Counted verdicts used by terminal summaries and CI JSON. */
export interface HookRuntimeSummary {
  pass: number;
  fail: number;
  unsupported: number;
  notConfigured: number;
  error: number;
}

/** Versioned report returned after all fixed deny-hook scenarios are classified. */
export interface HookRuntimeReport {
  schema: typeof REPORT_SCHEMA;
  status: "pass" | "fail";
  command: "hooks.verify";
  projectPath: string;
  agent: AgentId;
  hookId: string;
  scenarioGroup: HookScenario;
  evidenceLimit: string;
  summary: HookRuntimeSummary;
  scenarios: HookRuntimeScenarioResult[];
}

/**
 * Choose the first registrar-owned state reason users can act on.
 * Use before either proof path decides whether a hook may run.
 *
 * @param isSupported - false means the selected provider cannot host this hook
 * @param enabled - false means the user intentionally disabled the hook
 * @param installed - false means no exact registration and managed files are ready
 * @param scriptPath - managed script path; null means no runnable local target
 * @returns first stable reason code, or null when local execution may continue
 */
export function managedHookReasonCode(
  isSupported: boolean,
  enabled: boolean,
  installed: boolean,
  scriptPath: string | null,
): HookRuntimeReasonCode | null {
  // Unsupported agents cannot receive this managed PreToolUse hook.
  if (!isSupported) return "agent-hook-unsupported";
  // A disabled hook is intentionally absent from the user's active policy.
  if (!enabled) return "hook-disabled";
  // Missing registration, script, or policy files means no checkout proof can run.
  if (!installed || scriptPath === null) return "hook-not-installed";
  return null;
}

/**
 * Build the minimal environment used by bounded local hook proof.
 * Use so verification does not forward unrelated user or agent secrets.
 *
 * @param projectPath - selected checkout; empty text becomes the inert HOME fallback
 * @returns required process variables; values are never null or empty after fallback
 */
export function managedHookEnvironment(projectPath: string): NodeJS.ProcessEnv {
  // Missing user environment fields receive inert local defaults rather than secret-bearing fallbacks.
  const executablePath = process.env.PATH ?? "/usr/bin:/bin";
  const homeDirectory = process.env.HOME ?? projectPath;
  const temporaryDirectory = process.env.TMPDIR ?? "/tmp";
  return {
    PATH: executablePath,
    HOME: homeDirectory,
    TMPDIR: temporaryDirectory,
    LANG: "C",
    LC_ALL: "C",
  };
}

/**
 * Count every user-visible verdict without hiding skipped proof behind passes.
 * Use when either scenario group assembles terminal and JSON summaries.
 *
 * @param scenarios - classified rows; empty input returns zero for every verdict
 * @returns complete verdict totals; no bucket is null or omitted
 */
export function summarizeScenarioResults(
  scenarios: HookRuntimeScenarioResult[],
): HookRuntimeSummary {
  const summary: HookRuntimeSummary = {
    pass: 0,
    fail: 0,
    unsupported: 0,
    notConfigured: 0,
    error: 0,
  };
  // Each scenario contributes to exactly one user-visible verdict bucket.
  for (const scenario of scenarios) {
    switch (scenario.verdict) {
      case "pass":
        summary.pass += 1;
        break;
      case "fail":
        summary.fail += 1;
        break;
      case "unsupported":
        summary.unsupported += 1;
        break;
      case "not-configured":
        summary.notConfigured += 1;
        break;
      case "error":
        summary.error += 1;
        break;
    }
  }
  return summary;
}

/**
 * Record metadata-only proof without mixing writer diagnostics into CLI output.
 * Use after one bounded scenario has a user-visible verdict.
 *
 * @param input - evidence envelope fields; empty payloads remain valid metadata events
 * @returns append result; a failed result means durable proof was not recorded
 */
export function recordHookRuntimeEvidence(
  input: CreateEvidenceEnvelopeInput,
): AppendEvidenceEnvelopeResult {
  return recordEvidenceEvent(input, { onWarning: () => undefined });
}

/** Fixed payload and accepted typed outcomes for one non-policy configured-command replay. */
interface ConfiguredHookScenario {
  id: string;
  label: string;
  expected: HookProbeExpected;
  payload: string;
  acceptedObservations: HookProbeObserved[];
}

/** Local state required before an exact registered feedback command may run. */
interface ManagedConfiguredHookState {
  isSupported: boolean;
  enabled: boolean;
  installed: boolean;
  isCurrentVersionInstalled: boolean;
  isTrusted: boolean;
  scriptPath: string | null;
  configuredCommand: string | null;
  reasonCode: HookRuntimeReasonCode | null;
}

/** Request for the post-turn or Gruff configured-command groups. */
export interface ConfiguredHookRuntimeRequest {
  projectPath: string;
  agent: AgentId;
  scenarioGroup: Exclude<HookScenario, "deny-hook">;
  isTargetUntrusted: boolean;
}

const POST_TURN_HOOK_SCENARIOS: readonly ConfiguredHookScenario[] = [
  {
    id: "valid-stop-result",
    label: "Valid Stop input returns one recognized safety result",
    expected: "typed-result",
    payload: JSON.stringify({
      session_id: "goat-flow-configured-hook-verification",
      stop_hook_active: false,
      hook_event_name: "Stop",
    }),
    acceptedObservations: ["clean", "finding", "incomplete"],
  },
  {
    id: "invalid-stop-input",
    label: "Wrong-event input remains an incomplete Stop result",
    expected: "incomplete",
    payload: JSON.stringify({
      session_id: "goat-flow-configured-hook-verification",
      stop_hook_active: false,
      hook_event_name: "PostToolUse",
    }),
    acceptedObservations: ["incomplete"],
  },
];

const GRUFF_HOOK_SCENARIOS: readonly ConfiguredHookScenario[] = [
  {
    id: "unsupported-tool-input",
    label: "Unsupported tool input remains incomplete",
    expected: "incomplete",
    payload: JSON.stringify({ tool_name: "Read", tool_input: {} }),
    acceptedObservations: ["incomplete"],
  },
  {
    id: "non-source-edit",
    label: "A non-source edit produces explicit not-applicable feedback",
    expected: "advisory",
    payload: JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "README.md" },
    }),
    acceptedObservations: ["finding"],
  },
  {
    id: "source-dependency-result",
    label:
      "A source edit reports its available, incomplete, or clean analyzer result",
    expected: "typed-result",
    payload: JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "goat-flow-hook-verify-missing.ts" },
    }),
    acceptedObservations: ["clean", "finding", "incomplete", "unavailable"],
  },
];

/** Map a configured scenario group to the registry hook whose exact command must run. */
function hookIdForConfiguredScenario(
  scenarioGroup: Exclude<HookScenario, "deny-hook">,
): "post-turn-safety" | "gruff-code-quality" {
  // The Stop group owns repository safety; the remaining group owns edit feedback.
  if (scenarioGroup === "post-turn-hook") return "post-turn-safety";
  return "gruff-code-quality";
}

/** Return the fixed scenario set selected explicitly by the terminal or CI user. */
function configuredScenarios(
  scenarioGroup: Exclude<HookScenario, "deny-hook">,
): readonly ConfiguredHookScenario[] {
  // Stop verification uses bounded provider context and never invents changed content.
  if (scenarioGroup === "post-turn-hook") return POST_TURN_HOOK_SCENARIOS;
  return GRUFF_HOOK_SCENARIOS;
}

/** Read one exact managed command without treating shared files as agent registration. */
function readManagedConfiguredHookState(
  request: ConfiguredHookRuntimeRequest,
): ManagedConfiguredHookState {
  const hookId = hookIdForConfiguredScenario(request.scenarioGroup);
  const hookState = readAllHookStates(request.projectPath).find(
    (candidateHook) => candidateHook.id === hookId,
  );
  const hookSpec = getHookSpec(hookId);
  const agentProfile = getAgentProfiles().find(
    (knownAgent) => knownAgent.id === request.agent,
  );
  // Missing registry metadata is an internal error rather than proof that the agent is unsupported.
  if (!hookState || hookSpec === null || !agentProfile) {
    return {
      isSupported: false,
      enabled: false,
      installed: false,
      isCurrentVersionInstalled: false,
      isTrusted: false,
      scriptPath: null,
      configuredCommand: null,
      reasonCode: "hook-registry-missing",
    };
  }
  const agentHookState = hookState.agents[request.agent];
  const configuredCommand =
    agentHookState.installed && agentProfile.hooksDir !== null
      ? buildAgentHookCommand(request.agent, agentProfile.hooksDir, hookSpec)
      : null;
  return {
    isSupported: agentHookState.supported,
    enabled: hookState.enabled,
    installed: agentHookState.installed,
    isCurrentVersionInstalled: agentHookState.isCurrentVersionInstalled,
    isTrusted: agentHookState.isTrusted,
    scriptPath: agentHookState.scriptPath,
    configuredCommand,
    reasonCode: managedHookReasonCode(
      agentHookState.supported,
      hookState.enabled,
      agentHookState.installed,
      agentHookState.scriptPath,
    ),
  };
}

/** Execute one fixed payload through the exact command the selected agent configuration names. */
function executeConfiguredFeedbackProbe(
  projectPath: string,
  configuredCommand: string,
  scenario: ConfiguredHookScenario,
): HookProbeExecution {
  const startedAt = performance.now();
  const execution = spawnSync("bash", ["-c", configuredCommand], {
    cwd: projectPath,
    encoding: "utf-8",
    env: managedHookEnvironment(projectPath),
    input: scenario.payload,
    shell: false,
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROBE_OUTPUT_CAP_BYTES,
  });
  return {
    exitCode: execution.status,
    stdout: execution.stdout,
    stderr: execution.stderr,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    timedOut:
      (execution.error as NodeJS.ErrnoException | undefined)?.code ===
      "ETIMEDOUT",
    hasSpawnError: execution.error !== undefined,
  };
}

/** Classify one Stop response without retaining repository findings or provider payload text. */
function classifyPostTurnProbe(
  execution: HookProbeExecution,
): HookProbeObserved {
  // A timeout or spawn error means the configured command produced no bounded result.
  if (
    execution.timedOut ||
    execution.hasSpawnError ||
    execution.exitCode === null
  ) {
    return "error";
  }
  const capturedProcessText = `${execution.stdout}\n${execution.stderr}`;
  // Launcher startup failures are unavailable rather than valid safety-scan outcomes.
  if (/hook unavailable|managed root unavailable/iu.test(capturedProcessText)) {
    return "unavailable";
  }
  // Invalid input or incomplete coverage must stay distinct from a clean Stop result.
  if (/scan incomplete|invalid Stop payload/iu.test(capturedProcessText)) {
    return "incomplete";
  }
  // A concrete content finding asks the coding agent to continue fixing the user's change.
  if (
    /fix or remove the flagged changed content|post-turn-safety: .* at /iu.test(
      capturedProcessText,
    )
  ) {
    return "finding";
  }
  // A quiet zero exit is the hook's complete clean result for the selected checkout.
  if (execution.exitCode === 0) return "clean";
  return "error";
}

/** Classify one migrated Gruff provider response by its bounded outcome wording. */
function classifyGruffProbe(execution: HookProbeExecution): HookProbeObserved {
  // A timeout or spawn error means no provider-safe result reached the configured boundary.
  if (
    execution.timedOut ||
    execution.hasSpawnError ||
    execution.exitCode === null
  ) {
    return "error";
  }
  const capturedProcessText = `${execution.stdout}\n${execution.stderr}`;
  // The adapter renders unavailable dependencies and launcher failures with this outcome class.
  if (
    /gruff-code-quality: UNAVAILABLE|hook unavailable|analyzer-config-missing|analyzer-binary-missing/iu.test(
      capturedProcessText,
    )
  ) {
    return "unavailable";
  }
  // Invalid payload or partial scope must remain visibly incomplete in model-facing feedback.
  if (
    /gruff-code-quality: INCOMPLETE|input-invalid|coverage-incomplete|unsupported-tool-payload/iu.test(
      capturedProcessText,
    )
  ) {
    return "incomplete";
  }
  // Not-applicable and analyzer findings are both explicit advisory feedback, never clean proof.
  if (
    /gruff-code-quality: ADVISORY|analysis-not-applicable|findings-reported/iu.test(
      capturedProcessText,
    )
  ) {
    return "finding";
  }
  // A quiet zero exit is the provider adapter's complete clean response.
  if (execution.exitCode === 0 && capturedProcessText.trim() === "") {
    return "clean";
  }
  return "error";
}

/** Turn one configured command execution into a metadata-only user scenario result. */
function completedConfiguredScenarioResult(
  scenarioGroup: Exclude<HookScenario, "deny-hook">,
  scenario: ConfiguredHookScenario,
  execution: HookProbeExecution,
): HookRuntimeScenarioResult {
  const observed =
    scenarioGroup === "post-turn-hook"
      ? classifyPostTurnProbe(execution)
      : classifyGruffProbe(execution);
  const didMatchExpectation = scenario.acceptedObservations.includes(observed);
  return {
    id: scenario.id,
    label: scenario.label,
    expected: scenario.expected,
    observed,
    verdict: didMatchExpectation ? "pass" : "fail",
    evidenceLevel: CONFIGURED_HOOK_PROOF_LEVEL,
    durationMs: execution.durationMs,
    reasonCode: didMatchExpectation
      ? "expected-observation"
      : "unexpected-observation",
    wasEvidenceRecorded: false,
  };
}

/** Build skipped configured-command rows when support, setup, currentness, or trust is absent. */
function skippedConfiguredScenarioResults(
  scenarios: readonly ConfiguredHookScenario[],
  verdict: "unsupported" | "not-configured" | "error",
  reasonCode: HookRuntimeReasonCode,
): HookRuntimeScenarioResult[] {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    expected: scenario.expected,
    observed: "not-run",
    verdict,
    evidenceLevel: CONFIGURED_HOOK_PROOF_LEVEL,
    durationMs: 0,
    reasonCode,
    wasEvidenceRecorded: false,
  }));
}

/** Record one configured-command verdict without retaining payload, stdout, stderr, or findings. */
function recordConfiguredScenarioEvidence(
  request: ConfiguredHookRuntimeRequest,
  hookId: string,
  scriptPath: string | null,
  result: HookRuntimeScenarioResult,
): HookRuntimeScenarioResult {
  const appendResult = recordHookRuntimeEvidence({
    producer: "hooks-runtime-evidence",
    eventType: "hook.verify",
    actor: "cli",
    projectRoot: request.projectPath,
    payload: {
      hook_id: hookId,
      scenario_group: request.scenarioGroup,
      scenario_id: result.id,
      agent: request.agent,
      expected: result.expected,
      observed: result.observed,
      verdict: result.verdict,
      evidence_level: result.evidenceLevel,
      duration_ms: result.durationMs,
      reason_code: result.reasonCode,
    },
    provenance: {
      reason:
        "Exact configured-command evidence; external agent delivery is not exercised.",
      ...(scriptPath === null ? {} : { target_evidence_paths: [scriptPath] }),
    },
  });
  // A failed local event write prevents the command result from becoming durable evidence.
  if (!appendResult.ok) {
    return {
      ...result,
      verdict: "error",
      reasonCode: "evidence-write-failed",
      wasEvidenceRecorded: false,
    };
  }
  return { ...result, wasEvidenceRecorded: true };
}

/**
 * Replay the selected feedback hook through its exact registered command.
 * Use for explicit post-turn or Gruff verification without launching a model.
 *
 * @param request - selected project, provider, scenario group, and trust choice; never null
 * @returns complete metadata-only report; scenarios remain present when proof cannot run
 */
export function verifyManagedConfiguredHook(
  request: ConfiguredHookRuntimeRequest,
): HookRuntimeReport {
  const hookId = hookIdForConfiguredScenario(request.scenarioGroup);
  const scenarios = configuredScenarios(request.scenarioGroup);
  const hookState = readManagedConfiguredHookState(request);
  let scenarioResults: HookRuntimeScenarioResult[];

  // An untrusted checkout never executes its hook command or writes target-local evidence.
  if (request.isTargetUntrusted) {
    scenarioResults = skippedConfiguredScenarioResults(
      scenarios,
      "unsupported",
      "target-marked-untrusted",
    );
    // Missing registry metadata is an internal error, not a provider limitation.
  } else if (hookState.reasonCode === "hook-registry-missing") {
    scenarioResults = skippedConfiguredScenarioResults(
      scenarios,
      "error",
      "hook-registry-missing",
    );
    // Unsupported providers remain explicit and never run a shared file accidentally.
  } else if (!hookState.isSupported) {
    scenarioResults = skippedConfiguredScenarioResults(
      scenarios,
      "unsupported",
      "agent-hook-unsupported",
    );
    // Disabled, absent, stale, or untrusted local setup cannot provide configured-command proof.
  } else if (
    !hookState.enabled ||
    !hookState.installed ||
    !hookState.isCurrentVersionInstalled ||
    !hookState.isTrusted ||
    hookState.configuredCommand === null
  ) {
    scenarioResults = skippedConfiguredScenarioResults(
      scenarios,
      "not-configured",
      hookState.reasonCode ?? "hook-not-installed",
    );
  } else {
    const configuredCommand = hookState.configuredCommand;
    // Every fixed payload reaches the exact command the selected agent will invoke.
    scenarioResults = scenarios.map((scenario) =>
      completedConfiguredScenarioResult(
        request.scenarioGroup,
        scenario,
        executeConfiguredFeedbackProbe(
          request.projectPath,
          configuredCommand,
          scenario,
        ),
      ),
    );
  }

  const recordedScenarios = request.isTargetUntrusted
    ? scenarioResults
    : scenarioResults.map((scenarioResult) =>
        recordConfiguredScenarioEvidence(
          request,
          hookId,
          hookState.scriptPath,
          scenarioResult,
        ),
      );
  const summary = summarizeScenarioResults(recordedScenarios);
  return {
    schema: REPORT_SCHEMA,
    status:
      summary.pass === recordedScenarios.length && summary.pass > 0
        ? "pass"
        : "fail",
    command: "hooks.verify",
    projectPath: request.projectPath,
    agent: request.agent,
    hookId,
    scenarioGroup: request.scenarioGroup,
    evidenceLimit:
      "Exact configured command and fixed offline inputs only; external agent invocation and model visibility are not exercised.",
    summary,
    scenarios: recordedScenarios,
  };
}
