/**
 * Dispatch layer for the `goat-flow quality` command and its subcommands (history, diff,
 * candidacy, save, validate, and the default prompt builder). Each subcommand is a focused async
 * handler; the public entry point only routes by `options.qualitySubcommand`.
 *
 * Heavy modules (history, candidacy, audit, prompt composition) are dynamically imported inside
 * each handler so the CLI startup path stays lean and only loads what a given invocation needs.
 * All filesystem and process behaviour is injected through QualityCommandDeps so the handlers
 * stay testable. The save handler is the one bounded write path: it chooses the report filename
 * beneath the selected project after redaction and strict validation.
 */
import { randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type { AgentId } from "../types.js";
import type { CandidacyResult } from "./candidacy.js";
import type { ParsedCLI } from "../cli-types.js";
import { scrubDurableText } from "../evidence/redaction.js";
import { getPackageVersion } from "../paths.js";

type CLIErrorConstructor = new (message: string, exitCode: number) => Error;

/**
 * Injected collaborators the quality handlers depend on, kept as an interface so the command can
 * be exercised in tests without touching the real CLI error type or stdout. Supplied by the CLI
 * wiring layer; handlers never construct these themselves.
 */
export interface QualityCommandDeps {
  CLIError: CLIErrorConstructor;
  formatCandidacyArtifact(
    recommendation: CandidacyResult["recommendedArtifact"],
  ): string;
  /** Returns the agent ids the CLI accepts for `--agent`; first entry is used as the usage hint. */
  validAgents(): AgentId[];
  /** Writes the rendered command output to the destination chosen by `options` (stdout or file). */
  writeOutput(options: ParsedCLI, rendered: string): void;
}

async function handleQualityHistorySubcommand(
  options: ParsedCLI,
  deps: QualityCommandDeps,
): Promise<void> {
  const {
    buildQualityHistoryRows,
    loadQualityHistory,
    renderQualityHistoryText,
    selectQualityHistoryEntries,
  } = await import("./history.js");

  const history = loadQualityHistory(options.projectPath);
  for (const warning of history.warnings) {
    console.error(warning);
  }

  const selectedEntries = selectQualityHistoryEntries(history.entries, {
    agent: options.agent,
    limit: options.includeAll ? null : 20,
    qualityMode: options.qualityMode,
  });
  const rows = buildQualityHistoryRows(history.entries, {
    agent: options.agent,
    limit: options.includeAll ? null : 20,
    qualityMode: options.qualityMode,
  });
  if (options.format === "json") {
    deps.writeOutput(
      options,
      JSON.stringify(
        {
          reports: selectedEntries.map((entry) => ({
            id: entry.id,
            path: entry.path,
            report: entry.report,
          })),
          deltas: rows.map((row) => ({
            id: row.id,
            setup_delta: row.setupDelta,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  deps.writeOutput(
    options,
    renderQualityHistoryText(rows, {
      agent: options.agent,
      qualityMode: options.qualityMode,
      includeAll: options.includeAll,
    }),
  );
}

async function handleQualityDiffSubcommand(
  options: ParsedCLI,
  deps: QualityCommandDeps,
): Promise<void> {
  const { buildQualityDiff, loadQualityHistory, renderQualityDiffText } =
    await import("./history.js");

  const history = loadQualityHistory(options.projectPath);
  for (const warning of history.warnings) {
    console.error(warning);
  }

  const diff = buildQualityDiff(history.entries, {
    agent: options.agent,
    pair: options.qualityDiffPair,
    qualityMode: options.qualityMode,
  });
  if (!diff.ok) throw new deps.CLIError(diff.error, 2);

  if (options.format === "json") {
    deps.writeOutput(options, JSON.stringify(diff.diff, null, 2));
    return;
  }

  deps.writeOutput(options, renderQualityDiffText(diff.diff));
}

async function handleQualityCandidacySubcommand(
  options: ParsedCLI,
  deps: QualityCommandDeps,
): Promise<void> {
  if (!options.candidacyInput) {
    throw new deps.CLIError(
      "quality candidacy: pass --draft <path> or a description string.",
      2,
    );
  }
  const { runCandidacyCheck } = await import("./candidacy.js");
  const { readFileSync, existsSync } = await import("node:fs");
  let result;
  if (options.candidacyInput.mode === "draft") {
    const path = options.candidacyInput.value;
    if (!existsSync(path)) {
      throw new deps.CLIError(`quality candidacy: file not found: ${path}`, 2);
    }
    result = runCandidacyCheck({
      kind: "draft",
      content: readFileSync(path, "utf-8"),
      suggestedName: basename(path).replace(/\.md$/, ""),
    });
  } else {
    result = runCandidacyCheck({
      kind: "description",
      text: options.candidacyInput.value,
    });
  }
  if (options.format === "json") {
    deps.writeOutput(options, JSON.stringify(result, null, 2));
    return;
  }
  const lines: string[] = [];
  lines.push(
    `Recommended artifact: ${deps.formatCandidacyArtifact(result.recommendedArtifact)}`,
  );
  lines.push(`Confidence: ${Math.round(result.confidence * 100)}%`);
  if (result.reasoning.length > 0) {
    lines.push("");
    lines.push("Reasoning:");
    for (const reason of result.reasoning) lines.push(`  - ${reason}`);
  }
  if (result.nextSteps.length > 0) {
    lines.push("");
    lines.push("Next steps:");
    for (const step of result.nextSteps) {
      lines.push(
        `  - ${step.action}${step.template ? ` (template: ${step.template})` : ""}`,
      );
    }
  }
  deps.writeOutput(options, lines.join("\n"));
}

async function handleQualityValidateSubcommand(
  options: ParsedCLI,
  deps: QualityCommandDeps,
): Promise<void> {
  if (!options.qualityValidatePath) {
    throw new deps.CLIError(
      "quality validate requires a path to the report file.",
      2,
    );
  }
  const { readFileSync, existsSync } = await import("node:fs");
  const { parseQualityReport } = await import("./schema.js");
  const path = options.qualityValidatePath;
  if (!existsSync(path)) {
    throw new deps.CLIError(`quality validate: file not found: ${path}`, 2);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new deps.CLIError(
      `quality validate: invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
  const parsed = parseQualityReport(raw);
  if (!parsed.ok) {
    throw new deps.CLIError(
      `quality validate: schema error in ${path}: ${parsed.error}`,
      2,
    );
  }
  deps.writeOutput(options, `OK ${path}`);
}

/** Format the local timestamp used by collision-resistant quality report filenames. */
function qualitySaveTimestamp(date: Date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}${minute}`;
}

/** Inspect one prospective report directory without following a redirecting final component. */
function qualitySaveDirectoryStats(
  path: string,
  displayPath: string,
  deps: QualityCommandDeps,
) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new deps.CLIError(
      `quality save: cannot inspect ${displayPath} before writing.`,
      2,
    );
  }
}

/** Create the fixed report directory one real project-local component at a time. */
function ensureQualitySaveDirectory(
  projectRoot: string,
  deps: QualityCommandDeps,
): string {
  const components = [
    { path: join(projectRoot, ".goat-flow"), display: ".goat-flow" },
    {
      path: join(projectRoot, ".goat-flow", "logs"),
      display: ".goat-flow/logs",
    },
    {
      path: join(projectRoot, ".goat-flow", "logs", "quality"),
      display: ".goat-flow/logs/quality",
    },
  ];
  for (const component of components) {
    const stats = qualitySaveDirectoryStats(
      component.path,
      component.display,
      deps,
    );
    if (stats !== null && !stats.isDirectory()) {
      throw new deps.CLIError(
        `quality save: ${component.display} must be a real project-local directory.`,
        2,
      );
    }
    if (stats === null) mkdirSync(component.path);
  }
  return (
    components.at(-1)?.path ??
    join(projectRoot, ".goat-flow", "logs", "quality")
  );
}

/** Write one validated report with exclusive-create semantics and return its path. */
function writeQualityReport(
  qualityDirectory: string,
  agent: AgentId,
  serializedReport: string,
  deps: QualityCommandDeps,
): string {
  const timestamp = qualitySaveTimestamp();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = randomBytes(4).toString("hex").slice(0, 5);
    const reportPath = join(
      qualityDirectory,
      `${timestamp}-${agent}-${suffix}.json`,
    );
    try {
      writeFileSync(reportPath, serializedReport, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw new deps.CLIError(
        "quality save: could not persist the validated report.",
        2,
      );
    }
    const stats = lstatSync(reportPath);
    if (!stats.isFile() || stats.nlink !== 1) {
      throw new deps.CLIError(
        "quality save: persisted report is not a single-link regular file.",
        2,
      );
    }
    return reportPath;
  }
  throw new deps.CLIError(
    "quality save: could not allocate a unique report filename.",
    2,
  );
}

/** Redact, strictly validate, and persist one current report supplied through stdin. */
async function handleQualitySaveSubcommand(
  options: ParsedCLI,
  deps: QualityCommandDeps,
): Promise<void> {
  let projectRoot: string;
  try {
    if (!statSync(options.projectPath).isDirectory()) throw new Error();
    projectRoot = realpathSync(options.projectPath);
  } catch {
    throw new deps.CLIError(
      "quality save: selected project must be an existing directory.",
      2,
    );
  }

  const input = readFileSync(0, "utf8");
  if (input.trim().length === 0) {
    throw new deps.CLIError(
      "quality save: expected one JSON report on stdin.",
      2,
    );
  }
  const scrubbed = scrubDurableText(input);
  let raw: unknown;
  try {
    raw = JSON.parse(scrubbed);
  } catch (error) {
    throw new deps.CLIError(
      `quality save: invalid JSON on stdin: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
  const { parseQualityReport } = await import("./schema.js");
  const parsed = parseQualityReport(raw, { requireCurrentFields: true });
  if (!parsed.ok) {
    throw new deps.CLIError(`quality save: schema error: ${parsed.error}`, 2);
  }

  let reportRoot: string;
  try {
    reportRoot = realpathSync(resolve(parsed.report.project_path));
  } catch {
    throw new deps.CLIError(
      "quality save: report.project_path must name the selected project.",
      2,
    );
  }
  if (reportRoot !== projectRoot) {
    throw new deps.CLIError(
      "quality save: report.project_path does not match the selected project.",
      2,
    );
  }

  const version = getPackageVersion();
  if (
    parsed.report.goat_flow_version !== version ||
    parsed.report.rubric_version !== version
  ) {
    throw new deps.CLIError(
      `quality save: report version must match goat-flow v${version}.`,
      2,
    );
  }

  const qualityDirectory = ensureQualitySaveDirectory(projectRoot, deps);
  const serializedReport = `${JSON.stringify(parsed.report, null, 2)}\n`;
  const reportPath = writeQualityReport(
    qualityDirectory,
    parsed.report.agent,
    serializedReport,
    deps,
  );
  deps.writeOutput(options, `OK ${reportPath}`);
}

async function handleQualityPromptSubcommand(
  options: ParsedCLI,
  deps: QualityCommandDeps,
): Promise<void> {
  if (!options.agent) {
    throw new deps.CLIError(
      `quality requires --agent. Usage: goat-flow quality . --agent ${deps.validAgents()[0] ?? "claude"}`,
      2,
    );
  }

  const { createFS } = await import("../facts/fs.js");
  const { runAudit } = await import("../audit/audit.js");
  const { composeQuality } = await import("../prompt/compose-quality.js");
  const { findLatestQualityReport } = await import("./history.js");
  const { loadConfig } = await import("../config/reader.js");
  const { extractSharedFacts } = await import("../facts/shared/index.js");

  const fs = createFS(options.projectPath);
  let auditReport = null;
  try {
    auditReport = runAudit(fs, options.projectPath, {
      agentFilter: options.agent,
      harness: true,
    });
  } catch {
    // Quality prompts still render with degraded audit context.
  }

  const qualityMode = options.qualityMode ?? "agent-setup";
  const { entry: priorReport, warnings: historyWarnings } =
    findLatestQualityReport(options.projectPath, options.agent, qualityMode);
  for (const warning of historyWarnings) {
    console.error(warning);
  }
  const sharedFacts = extractSharedFacts(
    fs,
    loadConfig(options.projectPath, fs),
  );

  const result = composeQuality({
    agent: options.agent,
    projectPath: options.projectPath,
    auditReport,
    priorReport,
    qualityMode,
    sharedFacts,
  });

  if (options.format === "json") {
    deps.writeOutput(options, JSON.stringify(result, null, 2));
  } else {
    deps.writeOutput(options, result.prompt);
  }
}

/** Dispatch quality subcommands through focused branch handlers. */
export async function handleQualityCommand(
  options: ParsedCLI,
  deps: QualityCommandDeps,
): Promise<void> {
  if (options.qualitySubcommand === "history") {
    await handleQualityHistorySubcommand(options, deps);
    return;
  }
  if (options.qualitySubcommand === "diff") {
    await handleQualityDiffSubcommand(options, deps);
    return;
  }
  if (options.qualitySubcommand === "candidacy") {
    await handleQualityCandidacySubcommand(options, deps);
    return;
  }
  if (options.qualitySubcommand === "validate") {
    await handleQualityValidateSubcommand(options, deps);
    return;
  }
  if (options.qualitySubcommand === "save") {
    await handleQualitySaveSubcommand(options, deps);
    return;
  }
  await handleQualityPromptSubcommand(options, deps);
}
