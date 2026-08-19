/**
 * Route `goat-flow quality` requests from the CLI or dashboard to focused handlers.
 *
 * Use when a user builds, compares, validates, or saves a quality report for one project.
 * Heavy features load on demand so simple commands stay quick and focused.
 * The shared save path validates, scrubs, revalidates, and exclusively writes local reports.
 *
 * Injected output, errors, and directory creation keep user-visible edge cases testable.
 */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
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
import { parseQualityReport } from "./schema.js";

type CLIErrorConstructor = new (message: string, exitCode: number) => Error;

/**
 * Injected collaborators the quality handlers depend on, kept as an interface so the command can be exercised in tests without touching the real CLI
 * error type or stdout.
 * Supplied by the CLI wiring layer; handlers never construct these themselves.
 */
export interface QualityCommandDeps {
  CLIError: CLIErrorConstructor;
  /** Renders one recommended artifact kind as the label the candidacy output shows the user. */
  formatCandidacyArtifact(
    recommendation: CandidacyResult["recommendedArtifact"],
  ): string;
  /** Returns the agent ids the CLI accepts for `--agent`; first entry is used as the usage hint. */
  validAgents(): AgentId[];
  /** Writes the rendered command output to the destination chosen by `options` (stdout or file). */
  writeOutput(options: ParsedCLI, rendered: string): void;
}

/**
 * Dependencies needed by the one CLI/dashboard report persistence path.
 * Production uses the real directory creator; tests can reproduce two users saving at once.
 */
interface QualityPersistenceDeps extends Pick<QualityCommandDeps, "CLIError"> {
  createReportDirectory?: (directoryPath: string) => void;
}

/**
 * Render saved quality-history rows for the selected project and agent.
 * Load warnings go to stderr so the rendered rows stay machine-readable on stdout.
 *
 * @param options - parsed CLI options selecting project, agent, mode, and output format
 * @param deps - injected CLI error type and output writer
 * @returns nothing; the rendered history is written through `deps.writeOutput`
 */
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

/**
 * Compare two saved quality reports and render the difference.
 * Error behavior: throws CLIError with exit code 2 when the requested pair cannot be resolved, so an ambiguous or empty selection never renders as an
 * empty diff the user could misread as "no change".
 *
 * @param options - parsed CLI options selecting the report pair, agent, and mode
 * @param deps - injected CLI error type and output writer
 * @returns nothing; the diff is written through `deps.writeOutput`
 */
async function handleQualityDiffSubcommand(
  options: ParsedCLI,
  deps: QualityCommandDeps,
): Promise<void> {
  const { loadQualityHistory, renderQualityDiffText } =
    await import("./history.js");
  const { buildQualityDiff } = await import("./history-diff.js");

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

/**
 * Assess a draft artifact and report which artifact kind it should become.
 * Error behavior: throws CLIError with exit code 2 when no draft or description was supplied.
 *
 * @param options - parsed CLI options carrying the draft path or description text
 * @param deps - injected CLI error type, artifact formatter, and output writer
 * @returns nothing; the recommendation is written through `deps.writeOutput`
 */
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
      const templateSuffix = step.template
        ? ` (template: ${step.template})`
        : "";
      lines.push(`  - ${step.action}${templateSuffix}`);
    }
  }
  deps.writeOutput(options, lines.join("\n"));
}

/**
 * Validate one saved report file against the quality report schema.
 * Error behavior: throws CLIError with exit code 2 for a missing path, an unreadable file, invalid JSON, or a schema violation, each naming the file
 * so the user can fix the right report.
 *
 * @param options - parsed CLI options carrying the report path to validate
 * @param deps - injected CLI error type and output writer
 * @returns nothing; a valid report writes `OK <path>` through `deps.writeOutput`
 */
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
  const parsed = parseQualityReport(raw, { requireCurrentFields: false });
  if (!parsed.ok) {
    throw new deps.CLIError(
      `quality validate: schema error in ${path}: ${parsed.error}`,
      2,
    );
  }
  deps.writeOutput(options, `OK ${path}`);
}

/**
 * Ask Git whether one exact prospective local report path is ignored.
 * Side effect: spawns `git check-ignore` in the repository root.
 *
 * @param projectRoot - Repository root the `git check-ignore` query runs in.
 * @param relativePath - Prospective report path, relative to `projectRoot`.
 * @returns True when Git reports the path as ignored, so writing it keeps local
 *   quality state out of version control.
 */
export function isQualityPersistencePathIgnored(
  projectRoot: string,
  relativePath: string,
): boolean {
  try {
    execFileSync(
      "git",
      ["-C", projectRoot, "check-ignore", "--quiet", "--", relativePath],
      { stdio: "ignore", timeout: 5000 },
    );
    return true;
  } catch {
    // Non-repositories, unavailable Git, and ordinary unignored paths all fail closed.
    return false;
  }
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

/**
 * Inspect one prospective report directory without following a redirecting final component.
 *
 * A null result means the user's first save still needs to create this directory.
 *
 * @param path - absolute prospective directory to inspect
 * @param displayPath - project-relative label used in the error, so no absolute path is echoed
 * @param deps - injected CLI error type
 * @returns the stat result, or null when the directory does not exist yet. It throws CLIError with exit code 2 for any failure other than a
 *   missing path, so an unreadable or redirected component blocks the save instead of being treated as absent.
 */
function qualitySaveDirectoryStats(
  path: string,
  displayPath: string,
  deps: Pick<QualityCommandDeps, "CLIError">,
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

/**
 * Create one missing report directory and accept EEXIST only when another save made a real folder.
 *
 * Use during first save so concurrent users can continue without accepting files or symlinks.
 * Error behavior: throws CLIError with exit code 2 unless the collision resolved to a real directory, because a racing writer that left a file or
 * symlink must not be accepted.
 *
 * @param component - absolute path plus the project-relative label used in errors
 * @param deps - injected CLI error type and optional directory creator used by tests
 * @returns nothing; returning means the directory now exists
 */
function createMissingQualitySaveDirectory(
  component: { path: string; display: string },
  deps: QualityPersistenceDeps,
): void {
  // Production creates the folder directly; tests can pause at the same user-visible race point.
  const createReportDirectory = deps.createReportDirectory ?? mkdirSync;
  try {
    createReportDirectory(component.path);
  } catch (error) {
    // Example: another dashboard session created this same first-save folder milliseconds earlier.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const currentStats = qualitySaveDirectoryStats(
    component.path,
    component.display,
    deps,
  );
  // A concurrent creator is safe only when the user still has a real local directory.
  if (currentStats === null || !currentStats.isDirectory()) {
    throw new deps.CLIError(
      `quality save: ${component.display} must be a real project-local directory.`,
      2,
    );
  }
}

/**
 * Revalidate every report-directory component after concurrent creation finishes.
 * Error behavior: throws CLIError with exit code 2 when any component is missing or is no longer a real directory, so a component swapped mid-save
 * cannot receive the user's report.
 *
 * @param components - directory chain to recheck, outermost first
 * @param deps - injected CLI error type
 * @returns nothing; returning means every component is a real directory
 */
function assertCurrentQualitySaveDirectories(
  components: Array<{ path: string; display: string }>,
  deps: QualityPersistenceDeps,
): void {
  for (const component of components) {
    const currentStats = qualitySaveDirectoryStats(
      component.path,
      component.display,
      deps,
    );
    if (currentStats !== null && currentStats.isDirectory()) continue;
    throw new deps.CLIError(
      `quality save: ${component.display} must be a real project-local directory.`,
      2,
    );
  }
}

/**
 * Validate the ignored report destination, then create and recheck its directory chain.
 *
 * Use immediately before a user's accepted report is written.
 * Error behavior: throws CLIError with exit code 2 when the destination is not Git-ignored or any component cannot be created as a real directory, so
 * quality state never lands in version control.
 *
 * @param projectRoot - realpath-resolved repository root that owns the report
 * @param relativeReportPath - prospective report path relative to `projectRoot`
 * @param deps - injected CLI error type and optional directory creator used by tests
 * @returns the absolute directory the report may be written into
 */
function ensureQualitySaveDirectory(
  projectRoot: string,
  relativeReportPath: string,
  deps: QualityPersistenceDeps,
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
  const inspectedComponents = components.map((component) => ({
    ...component,
    stats: qualitySaveDirectoryStats(component.path, component.display, deps),
  }));
  // Existing folders must stay local; for example, a symlink must never redirect a user's report.
  for (const component of inspectedComponents) {
    // Missing components are created after Git proves the destination stays local.
    if (component.stats !== null && !component.stats.isDirectory()) {
      throw new deps.CLIError(
        `quality save: ${component.display} must be a real project-local directory.`,
        2,
      );
    }
  }
  // Unignored output could appear in a commit, so fail before creating any report folders.
  if (!isQualityPersistencePathIgnored(projectRoot, relativeReportPath)) {
    throw new deps.CLIError(
      `quality save: ${relativeReportPath} must be gitignored before writing.`,
      2,
    );
  }
  // Create only components absent in the initial snapshot, rechecking each concurrent result.
  for (const component of inspectedComponents) {
    // A null observation means this user's first save still needs the directory.
    if (component.stats === null) {
      createMissingQualitySaveDirectory(component, deps);
    }
  }
  // A creator can replace an ancestor that was present in the initial snapshot
  // while a missing descendant is being made. Recheck the whole chain before
  // the exclusive report write is allowed to use it.
  assertCurrentQualitySaveDirectories(components, deps);
  return (
    components.at(-1)?.path ??
    join(projectRoot, ".goat-flow", "logs", "quality")
  );
}

/**
 * Write one validated report with exclusive-create semantics and return its path.
 *
 * Exclusive create plus a random suffix means two concurrent saves never overwrite one another; the bounded retry exists so a collision reports as an
 * error rather than looping forever.
 * Side effect: writes the report file into the project's gitignored quality log directory.
 *
 * Error behavior: throws CLIError with exit code 2 when no unique filename could be allocated.
 *
 * @param projectRoot - realpath-resolved repository root that owns the report
 * @param agent - agent id embedded in the generated filename
 * @param serializedReport - validated report JSON written verbatim
 * @param deps - injected CLI error type and optional directory creator used by tests
 * @returns the absolute path of the written report
 */
function writeQualityReport(
  projectRoot: string,
  agent: AgentId,
  serializedReport: string,
  deps: QualityPersistenceDeps,
): string {
  const timestamp = qualitySaveTimestamp();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = randomBytes(4).toString("hex").slice(0, 5);
    const reportName = `${timestamp}-${agent}-${suffix}.json`;
    const relativeReportPath = `.goat-flow/logs/quality/${reportName}`;
    const qualityDirectory = ensureQualitySaveDirectory(
      projectRoot,
      relativeReportPath,
      deps,
    );
    const reportPath = join(qualityDirectory, reportName);
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

/**
 * Resolve the selected project to a real directory, or reject with the save contract's message.
 * Error behavior: throws CLIError with exit code 2 for a missing path, a non-directory, or an unresolvable symlink, so a report can only ever be
 * attributed to a real project root.
 *
 * @param projectPath - project path as the user supplied it
 * @param deps - injected CLI error type
 * @returns the realpath-resolved project root; never empty
 */
function resolveSelectedProjectRoot(
  projectPath: string,
  deps: Pick<QualityCommandDeps, "CLIError">,
): string {
  try {
    if (!statSync(projectPath).isDirectory()) throw new Error();
    return realpathSync(projectPath);
  } catch {
    throw new deps.CLIError(
      "quality save: selected project must be an existing directory.",
      2,
    );
  }
}

/**
 * Reject a report that belongs to another project or another goat-flow version.
 *
 * Ownership is checked against the realpath of both sides so a symlinked or relative `project_path` cannot smuggle a report into a different
 * project's history; version equality keeps saved reports comparable across `quality history` and `quality diff`.
 *
 * @param report - the report's own project path and version fields
 * @param projectRoot - realpath of the selected project the caller named
 * @param deps - CLIError constructor used for every rejection
 */
function assertReportOwnership(
  report: {
    projectPath: string;
    goatFlowVersion: string;
    /** Optional on older parsed reports; a missing value fails the match below. */
    rubricVersion: string | undefined;
  },
  projectRoot: string,
  deps: Pick<QualityCommandDeps, "CLIError">,
): void {
  let reportRoot: string;
  try {
    reportRoot = realpathSync(resolve(report.projectPath));
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
  if (report.goatFlowVersion !== version || report.rubricVersion !== version) {
    throw new deps.CLIError(
      `quality save: report version must match goat-flow v${version}.`,
      2,
    );
  }
}

/**
 * Public persistence contract shared by the CLI subcommand and dashboard capture.
 * Raw text remains in memory until this boundary validates, redacts, and writes the owned report.
 */
export interface PersistQualityReportOptions {
  /** Selected project directory the report must belong to; realpath-resolved here. */
  projectPath: string;
  /** Raw report text exactly as received from the caller's channel. */
  rawText: string;
  /** Channel name used in error messages: "stdin" for the CLI subcommand, "draft" for capture. */
  sourceLabel?: string;
}

/** Recursively scrub every accepted report string while preserving its shape. */
function scrubQualityReportStrings(reportNode: unknown): unknown {
  if (typeof reportNode === "string") return scrubDurableText(reportNode);
  if (Array.isArray(reportNode))
    return reportNode.map(scrubQualityReportStrings);
  if (reportNode === null || typeof reportNode !== "object") return reportNode;
  return Object.fromEntries(
    Object.entries(reportNode).map(([key, child]) => [
      key,
      scrubQualityReportStrings(child),
    ]),
  );
}

/**
 * Validate, scrub, revalidate, and persist one report through the shared CLI/dashboard path.
 * Only accepted text reaches disk, so every user sees the same bounded save contract.
 *
 * @param input - Project, raw report, and source label; empty text means the user supplied no report.
 * @param deps - Error type plus optional directory creator; omission uses the production filesystem.
 * @returns Absolute persisted report path; this method throws instead of returning an empty path.
 */
export function persistQualityReportText(
  input: PersistQualityReportOptions,
  deps: QualityPersistenceDeps,
): string {
  const sourceLabel = input.sourceLabel ?? "stdin";
  const projectRoot = resolveSelectedProjectRoot(input.projectPath, deps);

  if (input.rawText.trim().length === 0) {
    throw new deps.CLIError(
      `quality save: expected one JSON report on ${sourceLabel}.`,
      2,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(input.rawText);
  } catch {
    throw new deps.CLIError(`quality save: invalid JSON on ${sourceLabel}.`, 2);
  }
  const accepted = parseQualityReport(raw, { requireCurrentFields: true });
  if (!accepted.ok) {
    throw new deps.CLIError(`quality save: schema error: ${accepted.error}`, 2);
  }
  // Traverse only the accepted report shape. Rejected JSON may contain
  // attacker-controlled nesting deep enough to overflow a recursive scrubber.
  const scrubbed = scrubQualityReportStrings(accepted.report);
  const parsed = parseQualityReport(scrubbed, { requireCurrentFields: true });
  if (!parsed.ok) {
    throw new deps.CLIError(
      "quality save: redaction produced an invalid report.",
      2,
    );
  }

  assertReportOwnership(
    {
      projectPath: parsed.report.project_path,
      goatFlowVersion: parsed.report.goat_flow_version,
      rubricVersion: parsed.report.rubric_version,
    },
    projectRoot,
    deps,
  );

  const serializedReport = `${JSON.stringify(parsed.report, null, 2)}\n`;
  return writeQualityReport(
    projectRoot,
    parsed.report.agent,
    serializedReport,
    deps,
  );
}

/** Redact, strictly validate, and persist one current report supplied through stdin. */
function handleQualitySaveSubcommand(
  options: ParsedCLI,
  deps: QualityCommandDeps,
): void {
  // Pre-check the project directory before touching stdin so interactive
  // misuse with a bad path still fails fast instead of blocking on a TTY read.
  resolveSelectedProjectRoot(options.projectPath, deps);

  const input = readFileSync(0, "utf8");
  const reportPath = persistQualityReportText(
    { projectPath: options.projectPath, rawText: input },
    deps,
  );
  deps.writeOutput(options, `OK ${reportPath}`);
}

/**
 * Compose one quality prompt from a fresh audit whose target-execution level follows the CLI trust choice.
 * @throws CLIError when the request omits the required agent selection.
 */
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
      denyMechanismEvidenceLevel: options.isTargetTrusted ? "full" : "static",
    });
  } catch {
    // Audit infrastructure failure degrades prompt evidence, so tell the user without inventing a code finding.
    console.error(
      "quality: audit unavailable; continuing with degraded context.",
    );
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

/**
 * Dispatch quality subcommands through focused branch handlers.
 *
 * @param options - parsed CLI options; `qualitySubcommand` selects the handler
 * @param deps - injected CLI error type, artifact formatter, agent list, and output writer
 * @returns nothing; the selected handler owns all output
 */
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
    handleQualitySaveSubcommand(options, deps);
    return;
  }
  await handleQualityPromptSubcommand(options, deps);
}
