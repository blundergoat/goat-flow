/**
 * Replays configured Gruff and post-turn commands with fixed offline payloads.
 *
 * Use when a user verifies whether the exact command in agent config returns a recognized result without launching a provider model or retaining hook
 * output.
 * Shared report contracts remain in the deny-runtime evidence module.
 */
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

import { getAgentProfiles } from "./agents/registry.js";
import type { HookScenario } from "./cli-types.js";
import { AUDIT_VERSION } from "./constants.js";
import {
  recordEvidenceEvent,
  type AppendEvidenceEnvelopeResult,
  type CreateEvidenceEnvelopeInput,
} from "./evidence/envelope.js";
import { HOOK_VERIFICATION_CONTRACTS } from "./hook-verification-contracts.js";
import {
  agentHookSpawnDescriptor,
  buildAgentHookDescriptor,
  type AgentHookHandlerDescriptor,
} from "./server/agent-hook-command.js";
import type { AgentHookRegistrationIssue } from "./server/agent-hook-writer.js";
import { readAllHookStates } from "./server/hook-registrar.js";
import { getHookSpec } from "./server/hooks-registry.js";
import type { AgentId } from "./types.js";

/** Versioned result shape shared by deny and configured feedback proof. */
export const REPORT_SCHEMA = "goat-flow.hook-runtime-report.v1";
export const MANAGED_HOOK_PROOF_LEVEL =
  HOOK_VERIFICATION_CONTRACTS["deny-hook"].evidenceLevel;
/** Evidence level for replay through the exact command shown in user config. */
const CONFIGURED_HOOK_PROOF_LEVEL =
  HOOK_VERIFICATION_CONTRACTS["gruff-hook"].evidenceLevel;
/** Probe timeout. Rationale: five seconds loads local hooks but bounds stalled checkout code. */
export const PROBE_TIMEOUT_MS = 5_000; // Cap: bounds stalled project hook code.
/** Output cap. Rationale: sixteen kilobytes retains one diagnostic without unbounded text. */
export const PROBE_OUTPUT_CAP_BYTES = 16_384;

/** Final classification shown to terminal users and machine consumers. */
type HookRuntimeVerdict =
  "pass" | "fail" | "unsupported" | "not-configured" | "error";

/** Stable explanation codes that avoid exposing captured hook diagnostics. */
export type HookRuntimeReasonCode =
  | "expected-observation"
  | "unexpected-observation"
  | "agent-hook-unsupported"
  | "hook-disabled"
  | "hook-not-installed"
  | "event-mismatch"
  | "matcher-mismatch"
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
 * @param isEnabled - false means the user intentionally disabled the hook
 * @param installed - false means no exact registration and managed files are ready
 * @param scriptPath - managed script path; null means no runnable local target
 * @returns first stable reason code, or null when local execution may continue
 */
export function managedHookReasonCode(
  isSupported: boolean,
  isEnabled: boolean,
  installed: boolean,
  scriptPath: string | null,
): HookRuntimeReasonCode | null {
  // Unsupported agents cannot receive this managed PreToolUse hook.
  if (!isSupported) return "agent-hook-unsupported";
  // A disabled hook is intentionally absent from the user's active policy.
  if (!isEnabled) return "hook-disabled";
  // Missing registration, script, or policy files means no checkout proof can run.
  if (!installed || scriptPath === null) return "hook-not-installed";
  return null;
}

/** Preserve exact configured registration drift when it prevents a replay. */
function configuredRegistrationReasonCode(
  isSupported: boolean,
  isEnabled: boolean,
  registrationIssue: AgentHookRegistrationIssue | null,
): HookRuntimeReasonCode | null {
  // Provider support and user intent take precedence over stale registration detail.
  if (!isSupported || !isEnabled) return null;
  if (
    registrationIssue === "event-mismatch" ||
    registrationIssue === "matcher-mismatch"
  ) {
    return registrationIssue;
  }
  return null;
}

/** Host-owned Windows paths the managed launcher consumes for discovery and cleanup. */
const WINDOWS_MANAGED_ENVIRONMENT_KEYS = [
  "SystemRoot",
  "WINDIR",
  "ProgramFiles",
  "ProgramW6432",
  "ProgramFiles(x86)",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
] as const;

/** Copy only present values from an environment allowlist. */
function selectEnvironmentValues(
  environment: NodeJS.ProcessEnv,
  variableNames: ReadonlyArray<string>,
): NodeJS.ProcessEnv {
  const selectedEnvironment: NodeJS.ProcessEnv = {};
  for (const variableName of variableNames) {
    const hostPath = environment[variableName];
    // Blank values do not identify a usable host directory.
    if (hostPath) selectedEnvironment[variableName] = hostPath;
  }
  return selectedEnvironment;
}

/**
 * Select the first non-empty host variable from an ordered allowlist.
 *
 * @param environment - host variables to inspect without forwarding wholesale
 * @param variableNames - ordered aliases for the same launcher input
 * @param fallback - inert value used when every alias is absent
 * @returns first usable allowlisted value, or the supplied fallback
 */
function firstEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  variableNames: ReadonlyArray<string>,
  fallback: string,
): string {
  for (const variableName of variableNames) {
    const hostValue = environment[variableName];
    // The first present alias wins, matching normal process-environment lookup precedence.
    if (hostValue) return hostValue;
  }
  return fallback;
}

/**
 * Select the temporary directory used by the managed launcher and its timeout cleanup.
 *
 * @param projectPath - inert final fallback for Windows hosts without temp variables
 * @param environment - host variables to inspect through the platform allowlist
 * @param platform - host platform selecting Windows aliases or the POSIX default
 * @returns a non-empty temporary directory path
 */
function managedTemporaryDirectory(
  projectPath: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32") {
    return firstEnvironmentValue(
      environment,
      ["TMPDIR", "TEMP", "TMP"],
      projectPath,
    );
  }
  return firstEnvironmentValue(environment, ["TMPDIR"], "/tmp");
}

/**
 * Build the minimal environment used by bounded local hook proof.
 * Use so verification does not forward unrelated user or agent secrets.
 *
 * @param projectPath - selected checkout; empty text becomes the inert HOME fallback
 * @param environment - host variables to filter; defaults to the current process environment
 * @param platform - host platform selecting the Windows-only locator variables
 * @returns required process variables; values are never null or empty after fallback
 */
export function managedHookEnvironment(
  projectPath: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  // Missing user environment fields receive inert local defaults rather than secret-bearing fallbacks.
  const managedEnvironment: NodeJS.ProcessEnv = {
    PATH: firstEnvironmentValue(environment, ["PATH", "Path"], "/usr/bin:/bin"),
    HOME: firstEnvironmentValue(environment, ["HOME"], projectPath),
    TMPDIR: managedTemporaryDirectory(projectPath, environment, platform),
    LANG: "C",
    LC_ALL: "C",
  };
  // Windows launcher discovery and timeout cleanup need only these host-owned path variables.
  if (platform === "win32") {
    Object.assign(
      managedEnvironment,
      selectEnvironmentValues(environment, WINDOWS_MANAGED_ENVIRONMENT_KEYS),
      {
        PATHEXT: firstEnvironmentValue(
          environment,
          ["PATHEXT"],
          ".COM;.EXE;.BAT;.CMD",
        ),
      },
    );
  }
  return managedEnvironment;
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

/** Local state required before an exact registered feedback handler may run. */
interface ManagedConfiguredHookState {
  isSupported: boolean;
  enabled: boolean;
  installed: boolean;
  isCurrentVersionInstalled: boolean;
  isTrusted: boolean;
  scriptPath: string | null;
  configuredHandler: AgentHookHandlerDescriptor | null;
  probeTimeoutMs: number;
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
    id: HOOK_VERIFICATION_CONTRACTS["post-turn-hook"].requiredScenarioIds[0],
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
    id: HOOK_VERIFICATION_CONTRACTS["post-turn-hook"].requiredScenarioIds[1],
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
    id: HOOK_VERIFICATION_CONTRACTS["gruff-hook"].requiredScenarioIds[0],
    label: "Missing tool identity remains incomplete",
    expected: "incomplete",
    payload: JSON.stringify({ tool_input: {} }),
    acceptedObservations: ["incomplete"],
  },
  {
    id: HOOK_VERIFICATION_CONTRACTS["gruff-hook"].requiredScenarioIds[1],
    label: "A non-source edit produces explicit not-applicable feedback",
    expected: "advisory",
    payload: JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "README.md" },
    }),
    acceptedObservations: ["finding"],
  },
  {
    id: HOOK_VERIFICATION_CONTRACTS["gruff-hook"].requiredScenarioIds[2],
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
  return HOOK_VERIFICATION_CONTRACTS[scenarioGroup].hookId;
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
      configuredHandler: null,
      probeTimeoutMs: PROBE_TIMEOUT_MS,
      reasonCode: "hook-registry-missing",
    };
  }
  const agentHookState = hookState.agents[request.agent];
  const configuredHandler =
    agentHookState.installed && agentProfile.hooksDir !== null
      ? buildAgentHookDescriptor(request.agent, agentProfile.hooksDir, hookSpec)
      : null;
  return {
    isSupported: agentHookState.supported,
    enabled: hookState.enabled,
    installed: agentHookState.installed,
    isCurrentVersionInstalled: agentHookState.isCurrentVersionInstalled,
    isTrusted: agentHookState.isTrusted,
    scriptPath: agentHookState.scriptPath,
    configuredHandler,
    // The hook's own registered deadline is the budget its script was written against; the fast
    // classifier cap would fail a Gruff or post-turn scan that is still legitimately working.
    probeTimeoutMs:
      hookSpec.timeoutSec === undefined
        ? PROBE_TIMEOUT_MS
        : hookSpec.timeoutSec * 1000,
    reasonCode:
      configuredRegistrationReasonCode(
        agentHookState.supported,
        hookState.enabled,
        agentHookState.registrationIssue,
      ) ??
      managedHookReasonCode(
        agentHookState.supported,
        hookState.enabled,
        agentHookState.installed,
        agentHookState.scriptPath,
      ),
  };
}

/** Spawns one fixed payload through the exact handler the selected agent configuration names, so verification exercises the user's real command. */
function executeConfiguredFeedbackProbe(
  projectPath: string,
  configuredHandler: AgentHookHandlerDescriptor,
  scenario: ConfiguredHookScenario,
  timeoutMs: number,
): HookProbeExecution {
  const startedAt = performance.now();
  const probe = agentHookSpawnDescriptor(configuredHandler);
  const execution = spawnSync(probe.command, probe.args, {
    cwd: projectPath,
    encoding: "utf-8",
    env: managedHookEnvironment(projectPath),
    input: scenario.payload,
    shell: false,
    timeout: timeoutMs,
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
      framework_version: AUDIT_VERSION,
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
 * Check whether local setup is complete enough to run the user's configured handler.
 * Use before replay so partial installs stay visible as not configured.
 *
 * @param hookState - current local hook links; a null handler means no runnable registration
 * @returns true only when every local link and the configured handler are ready
 */
function configuredHookCanRun(
  hookState: ManagedConfiguredHookState,
): hookState is ManagedConfiguredHookState & {
  configuredHandler: AgentHookHandlerDescriptor;
} {
  // Every local link and the handler itself must be present before user-requested proof can run.
  return (
    hookState.enabled &&
    hookState.installed &&
    hookState.isCurrentVersionInstalled &&
    hookState.isTrusted &&
    hookState.configuredHandler !== null
  );
}

/**
 * Select the runnable or skipped scenario rows shown by hooks verify.
 * Use so the public command keeps one clear reason for every unavailable state.
 *
 * @param request - selected provider and trust choice; never null
 * @param hookState - inspected registration state; a null handler cannot execute
 * @param scenarios - fixed user-visible scenarios; empty input returns no rows
 * @returns complete scenario rows, including skipped outcomes when execution is unsafe
 */
function selectConfiguredScenarioResults(
  request: ConfiguredHookRuntimeRequest,
  hookState: ManagedConfiguredHookState,
  scenarios: readonly ConfiguredHookScenario[],
): HookRuntimeScenarioResult[] {
  // Without explicit trusted-target approval, the checkout command and evidence writes stay blocked.
  if (request.isTargetUntrusted) {
    return skippedConfiguredScenarioResults(
      scenarios,
      "unsupported",
      "target-marked-untrusted",
    );
  }
  // Missing registry metadata is an internal error, not a provider limitation.
  if (hookState.reasonCode === "hook-registry-missing") {
    return skippedConfiguredScenarioResults(
      scenarios,
      "error",
      "hook-registry-missing",
    );
  }
  // Unsupported providers remain explicit and never run a shared file accidentally.
  if (!hookState.isSupported) {
    return skippedConfiguredScenarioResults(
      scenarios,
      "unsupported",
      "agent-hook-unsupported",
    );
  }
  // Disabled, absent, stale, or untrusted setup cannot provide configured-command proof.
  if (!configuredHookCanRun(hookState)) {
    return skippedConfiguredScenarioResults(
      scenarios,
      "not-configured",
      hookState.reasonCode ?? "hook-not-installed",
    );
  }

  const configuredHandler = hookState.configuredHandler;
  // Every fixed payload reaches the exact handler the selected agent will invoke.
  return scenarios.map((scenario) =>
    completedConfiguredScenarioResult(
      request.scenarioGroup,
      scenario,
      executeConfiguredFeedbackProbe(
        request.projectPath,
        configuredHandler,
        scenario,
        hookState.probeTimeoutMs,
      ),
    ),
  );
}

/**
 * Record safe scenario metadata unless the user marked the checkout untrusted.
 * Use after replay so later audit views can distinguish observed proof from a transient result.
 *
 * @param request - selected checkout and trust choice; never null
 * @param hookId - registry hook id; empty text would produce unusable evidence
 * @param scriptPath - managed script path; null records proof without a target-file anchor
 * @param scenarioResults - completed or skipped rows; empty input writes no events
 * @returns rows with durable-evidence flags; unchanged when runtime approval is withheld
 */
function recordConfiguredScenarioResults(
  request: ConfiguredHookRuntimeRequest,
  hookId: string,
  scriptPath: string | null,
  scenarioResults: HookRuntimeScenarioResult[],
): HookRuntimeScenarioResult[] {
  // With runtime approval withheld, suppress every target-local write, including evidence events.
  if (request.isTargetUntrusted) return scenarioResults;
  return scenarioResults.map((scenarioResult) =>
    recordConfiguredScenarioEvidence(
      request,
      hookId,
      scriptPath,
      scenarioResult,
    ),
  );
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
  const scenarioResults = selectConfiguredScenarioResults(
    request,
    hookState,
    scenarios,
  );
  const recordedScenarios = recordConfiguredScenarioResults(
    request,
    hookId,
    hookState.scriptPath,
    scenarioResults,
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
