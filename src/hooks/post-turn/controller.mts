/** Scan only the explicit Git roots a managed non-Git controller lists, using native Node children. */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { PostTurnContext } from "./context.mjs";
import type * as NativeHookSupervisor from "../hook-supervisor.mjs";
import { clearStopReentryState } from "./recovery.mjs";

const resultSchema = "goat-flow.hook-result.v1";
const allowedOutcomes = new Set<unknown>([
  "pass",
  "block",
  "advisory",
  "incomplete",
  "unavailable",
]);
const allowedCoverage = new Set<unknown>(["complete", "partial", "none"]);

interface ControllerIdentity {
  provider: string;
  hookVersion: string;
  adapterVersion: string;
}

interface OutputMeasurement {
  stdoutBytes: number;
  stderrBytes: number;
  areByteCountsExact: boolean;
  isStderrTruncated: boolean;
}

interface ChildFinding {
  code: string;
  message: string;
  target?: string;
}

interface ChildResult {
  schema: string;
  hookId: string;
  event: string;
  outcome: string;
  coverage: {
    status: string;
    attemptedUnits: number;
    completedUnits: number;
    skippedUnits: number;
  };
  reasonCode: string;
  findings: ChildFinding[];
  summary?: { detectedFindings?: number; envelopeOmittedFindings?: number };
  execution: Record<string, unknown> & {
    failureClass?: string;
    output?: OutputMeasurement;
  };
}

interface ChildExecution {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: NodeJS.ErrnoException | undefined;
  launchError?: unknown;
  timedOut?: boolean;
  hasExceededOutputLimit?: boolean;
  hasInvalidUtf8Output?: boolean;
  output?: OutputMeasurement | undefined;
}

interface ManagedRuntime {
  compactHookResultEnvelope(result: unknown): unknown;
  HOOK_RESULT_ENVELOPE_LIMIT_BYTES: number;
  HOOK_STDERR_RETENTION_LIMIT_BYTES: number;
  HOOK_STDERR_FLOOD_LIMIT_BYTES: number;
  HOOK_RESULT_OUTPUT_LIMIT_BYTES: number;
}

interface ControllerSettings {
  identity: ControllerIdentity;
  environment: NodeJS.ProcessEnv;
  scannerScript: string;
  startedAt: number;
  maximumMilliseconds: number;
  childPayload: string;
  managed: {
    runtime: ManagedRuntime;
    supervisor: typeof NativeHookSupervisor;
  } | null;
}

interface ScanUnit {
  name: string;
  root: string;
}

interface NamedResult {
  name: string;
  result: ChildResult;
}

interface ControllerRun {
  status: number;
  stdout: string;
}

export interface ControllerOptions {
  controllerRoot: string;
  parentMigrated: boolean;
  sessionFingerprint: string;
  stopHookActive: boolean;
  hookVersion: string;
  environment: NodeJS.ProcessEnv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// Represent a declared repository that could not be scanned, preserving unavailable coverage for the user.
function syntheticResult(
  identity: ControllerIdentity,
  reasonCode: string,
  message: string,
): ChildResult {
  const isInfrastructure =
    reasonCode === "hook-unavailable" || reasonCode === "execution-timeout";
  return {
    schema: resultSchema,
    hookId: "post-turn-safety",
    event: "turn-stop",
    outcome: isInfrastructure ? "unavailable" : "incomplete",
    coverage: {
      status: "none",
      attemptedUnits: 1,
      completedUnits: 0,
      skippedUnits: 1,
    },
    reasonCode,
    // Whole-child scope uses the same target a real child reports, so aggregation prefixes it once.
    findings: [{ code: reasonCode, message, target: "project" }],
    execution: {
      hookVersion: identity.hookVersion,
      provider: identity.provider,
      providerMode: "controller-child",
      adapterName: `${identity.provider}-turn-stop`,
      adapterVersion: identity.adapterVersion,
      durationMs: 0,
      ...(isInfrastructure ? { failureClass: "infrastructure" } : {}),
    },
  };
}

// Coverage must use the user's complete, partial or unavailable states for exactly one whole repository.
function isValidChildCoverage(coverage: unknown): boolean {
  // Missing coverage facts cannot turn an unscanned repository into completed work.
  if (!isRecord(coverage) || !allowedCoverage.has(coverage.status))
    return false;
  const { attemptedUnits, completedUnits, skippedUnits } = coverage;
  // Repository counts must describe whole scan units, not fractional or missing work.
  if (![attemptedUnits, completedUnits, skippedUnits].every(Number.isInteger))
    return false;
  const completed = completedUnits as number;
  const skipped = skippedUnits as number;
  // This child owns one repository and cannot claim negative work or more than that repository.
  return (
    attemptedUnits === 1 &&
    completed >= 0 &&
    skipped >= 0 &&
    completed + skipped <= 1
  );
}

// Each retained finding needs a readable code, message and any supplied target.
function isValidChildFinding(finding: unknown): boolean {
  return (
    isRecord(finding) &&
    isNonEmptyText(finding.code) &&
    isNonEmptyText(finding.message) &&
    (finding.target === undefined || isNonEmptyText(finding.target))
  );
}

// A response from another hook or event, or without a known decision and reason, cannot explain this repository's result.
function isThisHookDecision(value: Record<string, unknown>): boolean {
  return (
    value.schema === resultSchema &&
    value.hookId === "post-turn-safety" &&
    value.event === "turn-stop" &&
    allowedOutcomes.has(value.outcome) &&
    typeof value.reasonCode === "string"
  );
}

// Accept only the expected scanner contract before a child can contribute coverage or findings.
function isValidChildResult(
  value: unknown,
  identity: ControllerIdentity,
): value is ChildResult {
  // Empty or non-object output cannot describe a completed repository scan.
  if (!isRecord(value) || !isThisHookDecision(value)) return false;
  // The child must supply a bounded finding list before its details reach provider feedback.
  const findings = value.findings;
  if (!Array.isArray(findings) || findings.length > 20) return false;
  const execution = value.execution;
  return (
    isValidChildCoverage(value.coverage) &&
    findings.every(isValidChildFinding) &&
    isRecord(execution) &&
    execution.provider === identity.provider &&
    execution.hookVersion === identity.hookVersion
  );
}

// Name the declared repository beside each finding so the user knows which project needs repair.
function prefixTarget(childName: string, target: string | undefined): string {
  // A project-level finding needs only its declared repository name.
  if (typeof target !== "string" || target === "project") return childName;
  return `${childName}/${target}`;
}

// Read the saved root list with the same YAML semantics as the CLI config reader.
function configuredScanRoots(
  controllerRoot: string,
  yaml: { load(text: string): unknown },
): string[] | null {
  try {
    const config = yaml.load(
      readFileSync(join(controllerRoot, ".goat-flow", "config.yaml"), "utf8"),
    ) as {
      hooks?: Record<string, { "scan-roots"?: unknown } | undefined>;
    } | null;
    const roots = config?.hooks?.["post-turn-safety"]?.["scan-roots"];
    return Array.isArray(roots) &&
      roots.length > 0 &&
      roots.every((root) => isNonEmptyText(root))
      ? (roots as string[])
      : null;
  } catch {
    // Invalid YAML after a user edits config cannot establish scan roots; leave controller coverage unavailable.
    return null;
  }
}

// Parent traversal and other drives cannot widen the user-approved repository set.
function staysInside(relativePath: string): boolean {
  return !(
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  );
}

/** Recognize Windows short-path aliases only when both resolved paths identify one directory. */
function samePhysicalDirectory(left: string | null, right: string): boolean {
  if (left === null) return false;
  if (relative(left, right) === "" && relative(right, left) === "") return true;
  try {
    const leftIdentity = statSync(left, { bigint: true });
    const rightIdentity = statSync(right, { bigint: true });
    return (
      leftIdentity.isDirectory() &&
      rightIdentity.isDirectory() &&
      leftIdentity.ino !== 0n &&
      leftIdentity.dev === rightIdentity.dev &&
      leftIdentity.ino === rightIdentity.ino
    );
  } catch {
    // Missing or unreadable identities cannot establish that two aliases name the same directory.
    return false;
  }
}

// Each root must name a whole Git repository rather than part of a different checkout.
function gitTopLevel(directory: string, maximumMilliseconds: number) {
  const rootLookup = spawnSync(
    "git",
    ["-C", directory, "rev-parse", "--show-toplevel"],
    {
      encoding: "utf8",
      timeout: Math.min(maximumMilliseconds, 5000),
      windowsHide: true,
    },
  );
  // Failed Git lookup cannot establish scanned coverage for this configured root.
  if (rootLookup.error || rootLookup.status !== 0) return null;
  if (rootLookup.stdout.trim().length === 0) return null;
  try {
    return realpathSync(rootLookup.stdout.trim());
  } catch {
    // A repository moved after Git lookup cannot establish a verified root for this scan.
    return null;
  }
}

// Verify one declared repository stays inside the selected controller workspace.
function resolveScanUnit(
  controllerRoot: string,
  configuredRoot: string,
  maximumMilliseconds: number,
): ScanUnit | null {
  // Empty or absolute paths cannot redirect this controller scan outside its selected workspace.
  if (
    configuredRoot.length === 0 ||
    isAbsolute(configuredRoot) ||
    /^[A-Za-z]:[\\/]/u.test(configuredRoot) ||
    /^\\\\/u.test(configuredRoot)
  )
    return null;
  const childPath = resolve(controllerRoot, configuredRoot);
  if (!staysInside(relative(controllerRoot, childPath))) return null;
  let childRealPath: string;
  try {
    childRealPath = realpathSync(childPath);
    // A listed file cannot stand in for a repository directory.
    if (!statSync(childRealPath).isDirectory()) return null;
  } catch {
    // A configured repository may have been removed or become unreadable before this Stop scan.
    return null;
  }
  const physicalRelative = relative(controllerRoot, childRealPath);
  // Linked paths must also remain physically inside the selected workspace.
  if (!staysInside(physicalRelative)) return null;
  if (
    !samePhysicalDirectory(
      gitTopLevel(childRealPath, maximumMilliseconds),
      childRealPath,
    )
  )
    return null;
  return { name: physicalRelative.split(sep).join("/"), root: childRealPath };
}

async function controllerSettings(
  options: ControllerOptions,
): Promise<ControllerSettings> {
  const startedAt = Date.now();
  const environment = options.environment;
  // Empty settings fall back like unset ones, as in the Bash controller, so these defaults use || rather than ??.
  const provider = environment.GOAT_FLOW_HOOK_PROVIDER || "claude";
  const configuredSeconds = Number(
    environment.GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS || "60",
  );
  const managed = options.parentMigrated
    ? {
        runtime: (await import(
          new URL("../hook-launch-runtime.mjs", import.meta.url).href
        )) as ManagedRuntime,
        supervisor: await import("../hook-supervisor.mjs"),
      }
    : null;
  return {
    identity: {
      provider,
      hookVersion: options.hookVersion || "unknown",
      adapterVersion: environment.GOAT_FLOW_HOOK_ADAPTER_VERSION || "1",
    },
    environment,
    // Each Node child derives its installed sibling modules from this entrypoint.
    scannerScript: fileURLToPath(
      new URL("../post-turn-safety.mjs", import.meta.url),
    ),
    startedAt,
    maximumMilliseconds:
      Number.isInteger(configuredSeconds) && configuredSeconds > 0
        ? configuredSeconds * 1000
        : 60_000,
    childPayload:
      options.sessionFingerprint.length > 0
        ? JSON.stringify({
            session_id: options.sessionFingerprint,
            hook_event_name: "Stop",
            stop_hook_active: options.stopHookActive,
          })
        : "",
    managed,
  };
}

async function runControllerChild(
  settings: ControllerSettings,
  scanUnit: ScanUnit,
  remainingMilliseconds: number,
): Promise<ChildExecution> {
  const childEnvironment = {
    ...settings.environment,
    GOAT_FLOW_HOOK_PROVIDER: settings.identity.provider,
    GOAT_FLOW_HOOK_EVENT: "turn-stop",
    GOAT_FLOW_HOOK_PROVIDER_MODE: "controller-child",
    GOAT_FLOW_HOOK_ADAPTER_VERSION: settings.identity.adapterVersion,
    GOAT_FLOW_HOOK_RESULT_PROTOCOL: resultSchema,
    GOAT_FLOW_POST_TURN_CONTROLLER_CHILD: "1",
    GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS: String(
      Math.max(1, Math.ceil(remainingMilliseconds / 1000)),
    ),
  };
  // Managed controller children use the same independent byte and tree-cleanup contracts as the outer launcher.
  if (settings.managed !== null) {
    const child = spawn(
      process.execPath,
      [settings.scannerScript, "--root", scanUnit.root],
      {
        cwd: scanUnit.root,
        env: childEnvironment,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    // A scanner may close stdin before reading the event; its completed status and result still decide the outcome.
    child.stdin.on("error", () => undefined);
    child.stdin.end(settings.childPayload);
    const execution =
      await settings.managed.supervisor.captureHookProcessUntilDeadline(
        child,
        { ...childEnvironment, GOAT_FLOW_HOOK_PROVIDER_MODE: "managed" },
        remainingMilliseconds,
        process.platform,
        true,
      );
    // Retained child diagnostics stay visible without allowing their excess to discard a completed finding.
    if (execution.stderr) process.stderr.write(execution.stderr);
    return execution;
  }
  // Direct callers have no aggregate byte report, so only status, streams and launch errors are kept.
  const { status, stdout, stderr, error } = spawnSync(
    process.execPath,
    [settings.scannerScript, "--root", scanUnit.root],
    {
      cwd: scanUnit.root,
      encoding: "utf8",
      input: settings.childPayload,
      env: childEnvironment,
      timeout: remainingMilliseconds,
      windowsHide: true,
      maxBuffer: 65_536,
    },
  );
  return { status, stdout, stderr, error };
}

// An unfinished, flooded or unstarted child has no complete result to aggregate, even if JSON appeared first.
function abortedChildResult(
  execution: ChildExecution,
  identity: ControllerIdentity,
): ChildResult {
  const reasonCode =
    execution.timedOut || execution.error?.code === "ETIMEDOUT"
      ? "execution-timeout"
      : "hook-unavailable";
  const hasOutputOverflow =
    execution.hasExceededOutputLimit || execution.error?.code === "ENOBUFS";
  let message = "Child safety scan could not start";
  if (reasonCode === "execution-timeout")
    message = "Child safety scan exceeded the controller deadline";
  else if (hasOutputOverflow)
    message = "Child safety scan exceeded its output limit";
  return syntheticResult(identity, reasonCode, message);
}

function parseChildResult(stdout: string | undefined): unknown {
  try {
    return JSON.parse((stdout ?? "").trim());
  } catch {
    // A child that emits empty or partial JSON cannot report a completed repository scan.
    return null;
  }
}

function childResultFrom(
  execution: ChildExecution,
  identity: ControllerIdentity,
): ChildResult {
  let result: ChildResult;
  if (
    execution.error ||
    execution.launchError ||
    execution.timedOut ||
    execution.hasExceededOutputLimit
  ) {
    result = abortedChildResult(execution, identity);
  } else {
    const parsed = parseChildResult(execution.stdout);
    // A failed or malformed child cannot contribute a clean repository result.
    result =
      execution.status === 0 &&
      !execution.hasInvalidUtf8Output &&
      isValidChildResult(parsed, identity)
        ? parsed
        : syntheticResult(
            identity,
            "hook-unavailable",
            "Child safety scan did not return a valid result",
          );
  }
  // Retained byte counts disclose truncation; aborted counts are lower bounds and never become findings.
  if (execution.output) result.execution.output = execution.output;
  return result;
}

async function scanControllerChild(
  settings: ControllerSettings,
  scanUnit: ScanUnit,
): Promise<ChildResult> {
  const remainingMilliseconds =
    settings.maximumMilliseconds - (Date.now() - settings.startedAt);
  // The shared deadline leaves this repository unscanned and must remain visible as incomplete work.
  if (remainingMilliseconds <= 0)
    return syntheticResult(
      settings.identity,
      "execution-timeout",
      "Controller safety-scan budget expired before this child ran",
    );
  return childResultFrom(
    await runControllerChild(settings, scanUnit, remainingMilliseconds),
    settings.identity,
  );
}

function aggregateDecision(childResults: NamedResult[]) {
  const outcomes = childResults.map((child) => child.result.outcome);
  const nonPassResults = childResults.filter(
    (child) => child.result.outcome !== "pass",
  );
  // A genuine child finding determines the controller block even when another root was unavailable.
  if (outcomes.includes("block"))
    return { outcome: "block", reasonCode: "policy-blocked" };
  // An unavailable child prevents a clean aggregate even when the other declared repositories passed.
  if (outcomes.includes("unavailable"))
    return { outcome: "unavailable", reasonCode: "hook-unavailable" };
  if (nonPassResults.length === 0)
    return { outcome: "pass", reasonCode: "completed-clean" };
  // Remaining incomplete or advisory children retain their visible non-clean outcome and any bounded-recovery reason.
  const outcome = outcomes.includes("incomplete") ? "incomplete" : "advisory";
  const isEveryNonPassBounded = nonPassResults.every(
    (child) =>
      child.result.outcome === "incomplete" &&
      child.result.reasonCode === "bounded-reentry-ended",
  );
  let reasonCode = "coverage-incomplete";
  if (isEveryNonPassBounded) reasonCode = "bounded-reentry-ended";
  else if (outcome === "advisory") reasonCode = "findings-reported";
  return { outcome, reasonCode };
}

// Shared runtime limits keep a future budget change from invalidating every controller aggregate.
function childOutputSummary(
  childResults: NamedResult[],
  runtime: ManagedRuntime | undefined,
) {
  const measurements = childResults
    .map((child) => child.result.execution.output)
    .filter((output): output is OutputMeasurement => output !== undefined);
  if (runtime === undefined || measurements.length === 0) return null;
  return {
    envelopeLimitBytes: runtime.HOOK_RESULT_ENVELOPE_LIMIT_BYTES,
    stderrRetentionLimitBytes: runtime.HOOK_STDERR_RETENTION_LIMIT_BYTES,
    stderrFloodLimitBytes: runtime.HOOK_STDERR_FLOOD_LIMIT_BYTES,
    providerLimitBytes: runtime.HOOK_RESULT_OUTPUT_LIMIT_BYTES,
    stdoutBytes: measurements.reduce(
      (sum, output) => sum + output.stdoutBytes,
      0,
    ),
    stderrBytes: measurements.reduce(
      (sum, output) => sum + output.stderrBytes,
      0,
    ),
    areByteCountsExact:
      measurements.length === childResults.length &&
      measurements.every((output) => output.areByteCountsExact),
    isStderrTruncated: measurements.some((output) => output.isStderrTruncated),
  };
}

// Keep outcome-deciding findings first so the user sees why the aggregate blocks; preserve declared order for all remaining details.
function aggregateFindings(childResults: NamedResult[], outcome: string) {
  const findingChildren =
    outcome === "block"
      ? childResults.filter((child) => child.result.outcome === "block")
      : childResults;
  const collected = findingChildren.flatMap((child) =>
    child.result.findings.map((finding) => ({
      isDecisive: child.result.outcome === outcome,
      finding: {
        code: finding.code,
        message: finding.message,
        target: prefixTarget(child.name, finding.target),
      },
    })),
  );
  const findings = [
    ...collected.filter((entry) => entry.isDecisive),
    ...collected.filter((entry) => !entry.isDecisive),
  ]
    .slice(0, 20)
    .map((entry) => entry.finding);
  const summary = {
    detectedFindings: findingChildren.reduce(
      (total, child) =>
        total +
        (child.result.summary?.detectedFindings ??
          child.result.findings.length),
      0,
    ),
    envelopeOmittedFindings:
      findingChildren.reduce(
        (total, child) =>
          total + (child.result.summary?.envelopeOmittedFindings ?? 0),
        0,
      ) +
      collected.length -
      findings.length,
    presentationOmittedFindings: 0,
  };
  return { findings, summary };
}

function aggregateResult(
  childResults: NamedResult[],
  settings: ControllerSettings,
) {
  const coverage = childResults.reduce(
    (total, child) => ({
      attemptedUnits:
        total.attemptedUnits + child.result.coverage.attemptedUnits,
      completedUnits:
        total.completedUnits + child.result.coverage.completedUnits,
      skippedUnits: total.skippedUnits + child.result.coverage.skippedUnits,
    }),
    { attemptedUnits: 0, completedUnits: 0, skippedUnits: 0 },
  );
  let coverageStatus = coverage.completedUnits === 0 ? "none" : "partial";
  if (
    coverage.completedUnits === coverage.attemptedUnits &&
    coverage.skippedUnits === 0
  )
    coverageStatus = "complete";
  const { outcome, reasonCode } = aggregateDecision(childResults);
  const nonPassResults = childResults.filter(
    (child) => child.result.outcome !== "pass",
  );
  const isEveryNonPassInfrastructure =
    nonPassResults.length > 0 &&
    nonPassResults.every(
      (child) =>
        ["incomplete", "unavailable"].includes(child.result.outcome) &&
        child.result.execution.failureClass === "infrastructure",
    );
  const { findings, summary } = aggregateFindings(childResults, outcome);
  const childOutput = childOutputSummary(
    childResults,
    settings.managed?.runtime,
  );
  return {
    schema: resultSchema,
    hookId: "post-turn-safety",
    event: "turn-stop",
    outcome,
    coverage: { status: coverageStatus, ...coverage },
    reasonCode,
    findings,
    ...(outcome === "block" ? { summary } : {}),
    execution: {
      hookVersion: settings.identity.hookVersion,
      provider: settings.identity.provider,
      providerMode: "managed-controller",
      adapterName: `${settings.identity.provider}-turn-stop`,
      adapterVersion: settings.identity.adapterVersion,
      durationMs: Date.now() - settings.startedAt,
      ...(isEveryNonPassInfrastructure
        ? { failureClass: "infrastructure" }
        : {}),
      ...(childOutput === null ? {} : { childOutput }),
    },
  };
}

// Direct terminal users receive each retained finding with its declared repository target.
function reportDirectResult(
  outcome: string,
  reasonCode: string,
  findings: ChildFinding[],
): number {
  // Complete clean legacy coverage ends without a terminal warning.
  if (outcome === "pass") return 0;
  for (const finding of findings)
    process.stderr.write(
      `post-turn-safety: ${finding.target}: ${finding.message}\n`,
    );
  // End an exhausted legacy cycle here because this host has no structured-result adapter.
  // The unchanged child failure remains incomplete; later Stop callbacks must not renew its retry.
  if (reasonCode === "bounded-reentry-ended") {
    process.stderr.write(
      "post-turn-safety: ending repeated Stop after unchanged infrastructure failure; no clean scan was recorded.\n",
    );
    return 0;
  }
  // A known hazard needs content repair; other non-clean outcomes keep their incomplete-scan explanation.
  process.stderr.write(
    outcome === "block"
      ? "post-turn-safety: fix or remove the flagged changed content before stopping.\n"
      : "post-turn-safety: controller scan incomplete.\n",
  );
  return 2;
}

/** Run the configured-root controller; status 3 means no wholly valid root list exists and nothing was scanned. */
export async function runControllerProgram(
  options: ControllerOptions,
): Promise<ControllerRun> {
  const settings = await controllerSettings(options);
  const yaml = createRequire(import.meta.url)("../vendor/js-yaml.cjs") as {
    load(text: string): unknown;
  };
  const configuredRoots = configuredScanRoots(options.controllerRoot, yaml);
  // Missing or empty roots leave controller coverage unavailable; the caller handles root recovery.
  if (configuredRoots === null) return { status: 3, stdout: "" };
  const scanUnits: ScanUnit[] = [];
  for (const configuredRoot of configuredRoots) {
    const scanUnit = resolveScanUnit(
      options.controllerRoot,
      configuredRoot,
      settings.maximumMilliseconds,
    );
    // One invalid root refuses the whole list rather than partially scanning the approved set.
    if (scanUnit === null) return { status: 3, stdout: "" };
    scanUnits.push(scanUnit);
  }
  const childResults: NamedResult[] = [];
  // Preserve declared repository order while giving every root a result or coverage failure.
  for (const scanUnit of scanUnits)
    childResults.push({
      name: scanUnit.name,
      result: await scanControllerChild(settings, scanUnit),
    });
  const aggregate = aggregateResult(childResults, settings);
  // Managed callers receive one structured aggregate for the provider adapter.
  if (settings.managed !== null)
    return {
      status: 0,
      stdout: `${JSON.stringify(settings.managed.runtime.compactHookResultEnvelope(aggregate))}\n`,
    };
  return {
    status: reportDirectResult(
      aggregate.outcome,
      aggregate.reasonCode,
      aggregate.findings,
    ),
    stdout: "",
  };
}

/** Compare physical paths so a linked working directory still counts as its repository's top level. */
export function isGitTopLevel(root: string): boolean {
  if (root === "") return false;
  try {
    return samePhysicalDirectory(
      realpathSync(process.cwd()),
      realpathSync(root),
    );
  } catch {
    return false;
  }
}

/** Scan a non-Git controller's configured roots; status 3 leaves bounded Git-root recovery authoritative. */
export async function runControllerChildScans(
  context: PostTurnContext,
): Promise<number> {
  let controllerRoot: string;
  try {
    controllerRoot = realpathSync(process.cwd());
  } catch {
    // An inaccessible controller directory leaves its child scope unresolved.
    return 3;
  }
  let run: ControllerRun;
  try {
    run = await runControllerProgram({
      controllerRoot,
      parentMigrated: context.managedResultMode,
      sessionFingerprint: context.sessionFingerprint,
      stopHookActive: context.stopHookActive,
      hookVersion: context.hookVersion,
      environment: context.environment,
    });
  } catch {
    // A crashed controller would otherwise exit non-blocking, silently skipping every child.
    process.stderr.write(
      "post-turn-safety: controller scan could not complete.\n",
    );
    run = { status: 2, stdout: "" };
  }
  if (run.status === 3) return 3;
  // Once child scope is established, stale single-root failure state cannot affect this topology.
  clearStopReentryState(context, controllerRoot);
  if (run.stdout !== "") process.stdout.write(run.stdout);
  return run.status;
}
