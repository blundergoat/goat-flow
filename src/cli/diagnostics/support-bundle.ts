/**
 * Builds the redacted local artifact emitted by `goat-flow diagnostics bundle`.
 * Use this when a maintainer needs one shareable view of setup, audit, quality,
 * runtime-event, stack, and environment state without raw project or prompt data.
 * Collection composes existing read-only facts; renderers never write the target.
 */
import { existsSync } from "node:fs";
import { basename } from "node:path";

import { runAudit } from "../audit/audit.js";
import type {
  AuditConcernKey,
  AuditReport,
  AuditScope,
} from "../audit/types.js";
import { loadConfig } from "../config/reader.js";
import type { LoadedConfig } from "../config/types.js";
import { redactEvidenceText, scrubDurableText } from "../evidence/redaction.js";
import {
  tailEvidenceEvents,
  type EvidenceEnvelope,
} from "../evidence/envelope.js";
import { createFS } from "../facts/fs.js";
import { extractProjectFacts } from "../facts/orchestrator.js";
import { loadManifest } from "../manifest/manifest.js";
import type { Manifest } from "../manifest/types.js";
import { getPackageVersion } from "../paths.js";
import {
  loadQualityHistory,
  type QualityHistoryEntry,
} from "../quality/history.js";
import type { AgentId, AgentFacts, ProjectFacts } from "../types.js";
import { THREAT_MODEL_DIAGNOSTIC_COMMAND } from "./threat-model.js";

const SUPPORT_BUNDLE_SCHEMA = "goat-flow.support-bundle.v1";
// Limit rationale: ten envelopes expose recent support timing without turning the bundle into an activity log.
const SUPPORT_EVENT_LIMIT = 10;
const SUPPORT_AUDIT_CONCERNS: readonly AuditConcernKey[] = [
  "context",
  "constraints",
  "verification",
  "recovery",
  "feedback_loop",
];
const OMITTED_SUPPORT_FIELDS = [
  "audit check evidence and failure bodies",
  "config raw values and commands",
  "event payloads and project paths",
  "instruction and settings bodies",
  "quality finding bodies and report paths",
] as const;

/** Hash-only file evidence shown when support needs to compare local state without reading content. */
interface SupportFileFingerprint {
  sha256: string;
  bytes: number;
}

/** Selected-project identity without its absolute path or user directory names. */
interface SupportTarget {
  name: string;
  pathSha256: string;
  exists: boolean;
}

/** Safe process and checkout capabilities that explain whether local diagnostics can run. */
interface SupportBundleEnvironment {
  nodeVersion: string;
  platform: string;
  architecture: string;
  isInteractiveTerminal: boolean;
  hasGitMetadata: boolean;
  hasPackageManifest: boolean;
}

/** One compact check-scope count, excluding evidence strings and remediation prose. */
interface SupportAuditScope {
  status: "pass" | "fail";
  passed: number;
  failed: number;
  skipped: number;
}

/** One five-concern result shown without underlying findings or recommendations. */
interface SupportAuditConcern {
  concern: AuditConcernKey;
  status: "pass" | "fail";
  score: number;
  evidenceLimitCount: number;
}

/** Latest quality-run metadata; finding bodies and local report paths stay omitted. */
interface SupportQualityRun {
  id: string;
  date: string;
  time: string;
  agent: AgentId;
  qualityMode: string;
  setupTotal: number;
  systemTotal: number;
  blockerCount: number;
  majorCount: number;
  minorCount: number;
}

/** Runtime-event metadata retained after payloads and project paths are dropped. */
interface SupportEventMetadata {
  eventKind: EvidenceEnvelope["event_kind"];
  actor: EvidenceEnvelope["actor"];
  producer: string;
  timestamp: string;
}

/**
 * Successful-bundle schema containing only allowlisted summaries and hashes.
 * Keep raw source bodies outside this contract; `sections: null` is reserved
 * for collection errors so support consumers can branch without guessing.
 */
interface SupportBundleSections {
  manifest: {
    version: string;
    requiredFileCount: number;
    canonicalSkillCount: number;
    supportedAgents: string[];
    checks: Manifest["facts"]["checks"];
  };
  config: {
    exists: boolean;
    valid: boolean;
    version: string;
    warningCount: number;
    errorCount: number;
    userRole: LoadedConfig["config"]["userRole"];
    fingerprint: SupportFileFingerprint | null;
  };
  agentSetup: Array<{
    agent: AgentId;
    instruction: {
      file: string;
      exists: boolean;
      lines: number;
      sha256: string | null;
      bytes: number;
    };
    settings: { exists: boolean; valid: boolean; denyPatterns: boolean };
    skills: {
      installed: number;
      missing: number;
      outdated: number;
      hasDispatcher: boolean;
    };
    hooks: {
      denyInstalled: boolean;
      denyRegistered: boolean;
      postTurnRegistered: boolean;
    };
    deniedActions: { commit: boolean; push: boolean };
  }>;
  audit: {
    status: "pass" | "fail";
    scopes: {
      setup: SupportAuditScope;
      agent: SupportAuditScope;
      harness: SupportAuditScope | null;
    };
    concerns: SupportAuditConcern[];
  };
  quality: {
    latest: SupportQualityRun | null;
    validRunCount: number;
    skippedHistoryFileCount: number;
  };
  events: {
    count: number;
    newestTimestamp: string | null;
    entries: SupportEventMetadata[];
  };
  stack: {
    languages: string[];
    sourceFileCount: number;
    buildConfigured: boolean;
    testConfigured: boolean;
    lintConfigured: boolean;
    formatConfigured: boolean;
    staticAnalysisToolCount: number;
  };
  environment: SupportBundleEnvironment;
}

/** Stable success or failure contract emitted to terminal and JSON consumers. */
export interface SupportBundle {
  schema: typeof SUPPORT_BUNDLE_SCHEMA;
  generatedAt: string;
  target: SupportTarget;
  goatFlowVersion: string;
  sections: SupportBundleSections | null;
  redactions: {
    strategy: "allowlisted summaries, hash-only fingerprints, scrubbed display metadata";
    scrubbedDisplayValueCount: number;
    omittedFields: readonly string[];
  };
  relatedDiagnostics: {
    threatModel: typeof THREAT_MODEL_DIAGNOSTIC_COMMAND;
  };
  exitCode: 0 | 1 | 2;
  error?: {
    code: "target-not-found" | "collection-failed";
    message: string;
  };
}

/** Pure-builder inputs used by the command collector and focused security fixtures. */
export interface BuildSupportBundleInput {
  generatedAt: string;
  projectPath: string;
  goatFlowVersion: string;
  manifest: Manifest;
  configState: LoadedConfig;
  /** Raw config used only for a hash; null or omitted means no comparable config file exists. */
  configText?: string | null;
  facts: ProjectFacts;
  audit: AuditReport;
  qualityHistory: {
    entries: QualityHistoryEntry[];
    warnings: string[];
  };
  events: EvidenceEnvelope[];
  environment: SupportBundleEnvironment;
  /** Selected mirror; null or omitted means summarize every installed agent. */
  selectedAgent?: AgentId | null;
}

/** Inputs for a controlled error bundle when collection cannot produce sections. */
export interface BuildSupportBundleErrorInput {
  generatedAt: string;
  projectPath: string;
  goatFlowVersion: string;
  errorCode: "target-not-found" | "collection-failed";
  exitCode: 1 | 2;
  /** True for collection failure inside a target; omitted means the target is unavailable. */
  isTargetAvailable?: boolean;
}

/** Mutable count shared while user-controlled display strings are scrubbed. */
interface RedactionCounter {
  applied: number;
}

/** Scrub one display string and count when the support user receives a placeholder. */
function scrubSupportString(
  value: string,
  redactions: RedactionCounter,
): string {
  const scrubbedValue = scrubDurableText(value);
  // A changed string tells the recipient that readable metadata was intentionally reduced.
  if (scrubbedValue !== value) redactions.applied += 1;
  return scrubbedValue;
}

/** Hash text for same/different comparisons while omitting its readable body. */
function fingerprintText(value: string | null): SupportFileFingerprint | null {
  // Missing files have no bytes to compare, so the UI shows an explicit null fingerprint.
  if (value === null) return null;
  const redactedValue = redactEvidenceText("support file", value);
  return { sha256: redactedValue.sha256, bytes: redactedValue.length };
}

/** Build a target label and hash without exposing its absolute local path. */
function supportTarget(
  projectPath: string,
  isTargetAvailable: boolean,
  redactions: RedactionCounter,
): SupportTarget {
  const targetName = basename(projectPath);
  const pathFingerprint = redactEvidenceText(
    "support target path",
    projectPath,
  );
  let displayName = targetName;
  // An empty basename, such as a filesystem root, needs a readable generic label for support users.
  if (displayName.length === 0) displayName = "project";
  return {
    name: scrubSupportString(displayName, redactions),
    pathSha256: pathFingerprint.sha256,
    exists: isTargetAvailable,
  };
}

/** Count check outcomes without carrying audit evidence or failure messages. */
function summarizeAuditScope(scope: AuditScope): SupportAuditScope {
  const summary: SupportAuditScope = {
    status: scope.status,
    passed: 0,
    failed: 0,
    skipped: 0,
  };
  // Each deterministic check contributes only its status to the support recipient's overview.
  for (const check of scope.checks) {
    // Passing checks confirm installed behavior without copying their evidence text.
    if (check.status === "pass") summary.passed += 1;
    // Failing checks remain visible as a count while sensitive remediation detail stays local.
    if (check.status === "fail") summary.failed += 1;
    // Skipped checks explain incomplete proof without being presented as success or failure.
    if (check.status === "skipped") summary.skipped += 1;
  }
  return summary;
}

/** Summarize five-concern assurance without serializing findings or recommendations. */
function summarizeAuditConcerns(report: AuditReport): SupportAuditConcern[] {
  const concerns: SupportAuditConcern[] = [];
  // A report without harness concerns still gives setup and agent scope evidence.
  if (report.concerns === null) return concerns;
  // Each named concern becomes one compact score users can compare across support bundles.
  for (const concern of SUPPORT_AUDIT_CONCERNS) {
    const result = report.concerns[concern];
    concerns.push({
      concern,
      status: result.status,
      score: result.score,
      evidenceLimitCount: result.limits.length,
    });
  }
  return concerns;
}

/** Convert one agent's setup facts into hash-only, count-based support evidence. */
function summarizeAgentSetup(
  agentFacts: AgentFacts,
  redactions: RedactionCounter,
): SupportBundleSections["agentSetup"][number] {
  const instructionFingerprint = fingerprintText(
    agentFacts.instruction.content,
  );
  // A missing instruction body has no hash or byte count, which tells support the file was unavailable.
  const instructionSha256 = instructionFingerprint?.sha256 ?? null;
  const instructionBytes = instructionFingerprint?.bytes ?? 0;
  return {
    agent: agentFacts.agent.id,
    instruction: {
      file: scrubSupportString(agentFacts.agent.instructionFile, redactions),
      exists: agentFacts.instruction.exists,
      lines: agentFacts.instruction.lineCount,
      sha256: instructionSha256,
      bytes: instructionBytes,
    },
    settings: {
      exists: agentFacts.settings.exists,
      valid: agentFacts.settings.valid,
      denyPatterns: agentFacts.settings.hasDenyPatterns,
    },
    skills: {
      installed: agentFacts.skills.found.length,
      missing: agentFacts.skills.missing.length,
      outdated: agentFacts.skills.outdatedCount,
      hasDispatcher: agentFacts.skills.hasDispatcher,
    },
    hooks: {
      denyInstalled:
        agentFacts.hooks.denyExists || agentFacts.hooks.denyIsConfigBased,
      denyRegistered: agentFacts.hooks.denyIsRegistered,
      postTurnRegistered: agentFacts.hooks.postTurnRegistered,
    },
    deniedActions: {
      commit: agentFacts.deny.gitCommitBlocked,
      push: agentFacts.deny.gitPushBlocked,
    },
  };
}

/** Select and summarize the newest comparable quality run. */
function summarizeQuality(
  history: BuildSupportBundleInput["qualityHistory"],
  selectedAgent: AgentId | null,
): SupportBundleSections["quality"] {
  // Agent-scoped bundles exclude history from other runners; unscoped bundles use the newest valid run.
  const latest = history.entries.find(
    (entry) => selectedAgent === null || entry.agent === selectedAgent,
  );
  // No valid saved run is a useful empty state, not a support-bundle error.
  if (!latest) {
    return {
      latest: null,
      validRunCount: history.entries.length,
      skippedHistoryFileCount: history.warnings.length,
    };
  }
  const findingCounts = { BLOCKER: 0, MAJOR: 0, MINOR: 0 };
  // Severity counts retain triage signal while all finding prose remains local.
  for (const finding of latest.report.findings) {
    findingCounts[finding.severity] += 1;
  }
  // Older quality reports omit the mode, which means they used the original agent-setup contract.
  const qualityMode = latest.report.quality_mode ?? "agent-setup";
  return {
    latest: {
      id: latest.id,
      date: latest.date,
      time: latest.time,
      agent: latest.agent,
      qualityMode,
      setupTotal: latest.report.scores.setup.total,
      systemTotal: latest.report.scores.system.total,
      blockerCount: findingCounts.BLOCKER,
      majorCount: findingCounts.MAJOR,
      minorCount: findingCounts.MINOR,
    },
    validRunCount: history.entries.length,
    skippedHistoryFileCount: history.warnings.length,
  };
}

/** Keep bounded event identity and timing while dropping every payload and project path. */
function summarizeEvents(
  events: EvidenceEnvelope[],
  redactions: RedactionCounter,
): SupportBundleSections["events"] {
  // Only allowlisted event fields reach the bundle users may paste into support channels.
  const entries = events.map((event) => ({
    eventKind: event.event_kind,
    actor: event.actor,
    producer: scrubSupportString(event.producer, redactions),
    timestamp: event.timestamp,
  }));
  // An empty event tail has no newest timestamp, which tells support no local activity was recorded.
  const newestTimestamp = entries.at(-1)?.timestamp ?? null;
  return {
    count: entries.length,
    newestTimestamp,
    entries,
  };
}

/** Summarize detected stack capability without exposing configured command strings. */
function summarizeStack(
  facts: ProjectFacts,
  redactions: RedactionCounter,
): SupportBundleSections["stack"] {
  // Language names are readable support context, scrubbed in case a custom detector returns user text.
  const languages = facts.stack.languages.map((language) =>
    scrubSupportString(language, redactions),
  );
  // Missing command detection becomes false so users can see which verification capability is absent.
  return {
    languages,
    sourceFileCount: facts.stack.sourceFileCount,
    buildConfigured: facts.stack.buildCommand !== null,
    testConfigured: facts.stack.testCommand !== null,
    lintConfigured: facts.stack.lintCommand !== null,
    formatConfigured: facts.stack.formatCommand !== null,
    staticAnalysisToolCount: facts.stack.signals.staticAnalysis.length,
  };
}

/** Build all allowlisted sections from existing collectors without raw body fields. */
function buildSupportSections(
  input: BuildSupportBundleInput,
  redactions: RedactionCounter,
): SupportBundleSections {
  // A missing config body produces a null fingerprint instead of hashing an invented empty file.
  const configFingerprint = fingerprintText(input.configText ?? null);
  // Agent facts stay separate so support can identify a single incomplete runner mirror.
  const agentSetup = input.facts.agents.map((agentFacts) =>
    summarizeAgentSetup(agentFacts, redactions),
  );
  // A non-harness audit has no concern scope, so the schema preserves that as null.
  const harnessScope =
    input.audit.scopes.harness === null
      ? null
      : summarizeAuditScope(input.audit.scopes.harness);
  // An omitted selected agent means quality history should use the newest run from any runner.
  const selectedAgent = input.selectedAgent ?? null;
  return {
    manifest: {
      version: scrubSupportString(input.manifest.version, redactions),
      requiredFileCount: input.manifest.required_files.length,
      canonicalSkillCount: input.manifest.skills.canonical.length,
      supportedAgents: Object.keys(input.manifest.agents).sort(),
      checks: { ...input.manifest.facts.checks },
    },
    config: {
      exists: input.configState.exists,
      valid: input.configState.valid,
      version: scrubSupportString(input.configState.config.version, redactions),
      warningCount: input.configState.warnings.length,
      errorCount: input.configState.errors.length,
      userRole: input.configState.config.userRole,
      fingerprint: configFingerprint,
    },
    agentSetup,
    audit: {
      status: input.audit.status,
      scopes: {
        setup: summarizeAuditScope(input.audit.scopes.setup),
        agent: summarizeAuditScope(input.audit.scopes.agent),
        harness: harnessScope,
      },
      concerns: summarizeAuditConcerns(input.audit),
    },
    quality: summarizeQuality(input.qualityHistory, selectedAgent),
    events: summarizeEvents(input.events, redactions),
    stack: summarizeStack(input.facts, redactions),
    environment: input.environment,
  };
}

/**
 * Build a successful or audit-failing bundle from already collected local evidence.
 * @param input - complete collector evidence; optional null fields mean that local source was unavailable
 * @returns an allowlisted bundle with sections and an exit code matching the audit verdict
 */
export function buildSupportBundle(
  input: BuildSupportBundleInput,
): SupportBundle {
  const redactions: RedactionCounter = { applied: 0 };
  const sections = buildSupportSections(input, redactions);
  return {
    schema: SUPPORT_BUNDLE_SCHEMA,
    generatedAt: input.generatedAt,
    target: supportTarget(input.projectPath, true, redactions),
    goatFlowVersion: scrubSupportString(input.goatFlowVersion, redactions),
    sections,
    redactions: {
      strategy:
        "allowlisted summaries, hash-only fingerprints, scrubbed display metadata",
      scrubbedDisplayValueCount: redactions.applied,
      omittedFields: OMITTED_SUPPORT_FIELDS,
    },
    relatedDiagnostics: { threatModel: THREAT_MODEL_DIAGNOSTIC_COMMAND },
    exitCode: input.audit.status === "pass" ? 0 : 1,
  };
}

/**
 * Build the same JSON envelope when a target or collector cannot produce sections.
 * @param input - controlled error facts; omitted availability means the selected target was not found
 * @returns a parseable bundle with null sections and the supplied nonzero exit code
 */
export function buildSupportBundleError(
  input: BuildSupportBundleErrorInput,
): SupportBundle {
  const redactions: RedactionCounter = { applied: 0 };
  const errorMessage =
    input.errorCode === "target-not-found"
      ? "The selected project directory does not exist."
      : "Local diagnostic collection could not finish.";
  // Omitted availability describes a missing target; collection failures pass true explicitly.
  const isTargetAvailable = input.isTargetAvailable ?? false;
  return {
    schema: SUPPORT_BUNDLE_SCHEMA,
    generatedAt: input.generatedAt,
    target: supportTarget(input.projectPath, isTargetAvailable, redactions),
    goatFlowVersion: scrubSupportString(input.goatFlowVersion, redactions),
    sections: null,
    redactions: {
      strategy:
        "allowlisted summaries, hash-only fingerprints, scrubbed display metadata",
      scrubbedDisplayValueCount: redactions.applied,
      omittedFields: OMITTED_SUPPORT_FIELDS,
    },
    relatedDiagnostics: { threatModel: THREAT_MODEL_DIAGNOSTIC_COMMAND },
    exitCode: input.exitCode,
    error: { code: input.errorCode, message: errorMessage },
  };
}

/**
 * Collect one support bundle from existing read-only fact, audit, history, and event APIs.
 * @param projectPath - selected local project; an absent directory returns a target-not-found bundle
 * @param selectedAgent - one agent mirror, or null to summarize all installed mirrors
 * @returns a support bundle; null sections mean collection could not provide safe evidence
 */
export function collectSupportBundle(
  projectPath: string,
  selectedAgent: AgentId | null,
): SupportBundle {
  const generatedAt = new Date().toISOString();
  const goatFlowVersion = getPackageVersion();
  // A missing target cannot provide setup facts, but automation still receives structured JSON.
  if (!existsSync(projectPath)) {
    return buildSupportBundleError({
      generatedAt,
      projectPath,
      goatFlowVersion,
      errorCode: "target-not-found",
      exitCode: 2,
    });
  }
  try {
    const projectFiles = createFS(projectPath);
    const configState = loadConfig(projectPath, projectFiles);
    const facts = extractProjectFacts(projectFiles, {
      agentFilter: selectedAgent,
      projectPath,
      configState,
    });
    const audit = runAudit(projectFiles, projectPath, {
      agentFilter: selectedAgent,
      harness: true,
      checkDrift: false,
      shouldRunAutoDrift: false,
      checkContent: false,
      denyMechanismEvidenceLevel: "static",
    });
    return buildSupportBundle({
      generatedAt,
      projectPath,
      goatFlowVersion,
      manifest: loadManifest(),
      configState,
      configText: projectFiles.readFile(".goat-flow/config.yaml"),
      facts,
      audit,
      qualityHistory: loadQualityHistory(projectPath),
      events: tailEvidenceEvents(projectPath, SUPPORT_EVENT_LIMIT),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        isInteractiveTerminal: process.stdout.isTTY === true,
        hasGitMetadata: projectFiles.exists(".git"),
        hasPackageManifest: projectFiles.exists("package.json"),
      },
      selectedAgent,
    });
  } catch {
    // For example, a malformed framework manifest still returns a parseable artifact instead of a stack trace.
    return buildSupportBundleError({
      generatedAt,
      projectPath,
      goatFlowVersion,
      errorCode: "collection-failed",
      exitCode: 1,
      isTargetAvailable: true,
    });
  }
}

/**
 * Render one complete JSON document for CI, issue attachments, or `--output`.
 * @param bundle - collected artifact; null sections remain a structured error envelope
 * @returns indented JSON with no surrounding prose, never an empty string
 */
export function renderSupportBundleJson(bundle: SupportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * Render a concise terminal summary and point users to the complete JSON artifact.
 * @param bundle - collected artifact; null sections render the controlled error and exit code
 * @returns non-empty plain text suitable for a terminal, without sensitive payload bodies
 */
export function renderSupportBundleText(bundle: SupportBundle): string {
  const lines = [
    "GOAT Flow support bundle",
    `Target: ${bundle.target.name}`,
    `Generated: ${bundle.generatedAt}`,
  ];
  // Collection errors give terminal users one controlled next step while JSON retains the full contract.
  if (bundle.sections === null) {
    lines.push(`Status: ${bundle.error?.message ?? "Unavailable"}`);
    lines.push(`Exit code: ${bundle.exitCode}`);
    lines.push("JSON detail: rerun with --format json.");
    lines.push(`Threat posture: ${bundle.relatedDiagnostics.threatModel}`);
    return lines.join("\n");
  }
  const latestQuality = bundle.sections.quality.latest;
  lines.push(`Audit: ${bundle.sections.audit.status}`);
  lines.push(
    `Agents: ${bundle.sections.agentSetup.length}; events: ${bundle.sections.events.count}`,
  );
  // No saved run is shown as an empty state instead of an invented quality score.
  if (latestQuality === null) {
    lines.push("Latest quality: none saved");
  } else {
    lines.push(
      `Latest quality: setup ${latestQuality.setupTotal}, system ${latestQuality.systemTotal}`,
    );
  }
  lines.push("Sensitive raw data is omitted.");
  lines.push("JSON detail: rerun with --format json or add --output <file>.");
  lines.push(`Threat posture: ${bundle.relatedDiagnostics.threatModel}`);
  return lines.join("\n");
}
