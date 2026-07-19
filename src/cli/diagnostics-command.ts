/**
 * Runs one read-only diagnostics view after the shared CLI parser selects it.
 * Use this boundary for context pressure, readiness, redacted support, or static
 * threat posture without loading collectors belonging to unrelated commands.
 */
import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";

/**
 * Build the advisory readiness view and write its selected text or JSON output.
 * Unsupported formats exit before static target collection starts.
 *
 * @param options - parsed target, agent, and output destination for the readiness user
 * @returns completion after output is written; no value means the advisory report reached its destination
 * @throws CLIError when the user requests a format readiness does not support
 */
async function handleReadinessDiagnostics(options: ParsedCLI): Promise<void> {
  // Readiness promises concise terminal output and one stable dashboard-ready JSON contract.
  if (options.format !== "text" && options.format !== "json") {
    throw new CLIError(
      "diagnostics readiness supports --format text or --format json.",
      2,
    );
  }
  const {
    collectReadinessReport,
    renderReadinessReportJson,
    renderReadinessReportText,
  } = await import("./diagnostics/readiness-report.js");
  const readinessReport = collectReadinessReport(
    options.projectPath,
    options.agent,
  );
  const renderedReadiness =
    options.format === "json"
      ? renderReadinessReportJson(readinessReport)
      : renderReadinessReportText(readinessReport);
  writeOutput(options, renderedReadiness);
}

/**
 * Build the redacted support bundle and write its selected text or JSON output.
 * A failed bundle leaves its exit status available to terminal automation.
 *
 * @param options - parsed target, agent, and output destination for the support user
 * @returns completion after output is written; no value means the bundle reached its destination
 * @throws CLIError when the user requests a format the support bundle does not support
 */
async function handleSupportBundleDiagnostics(
  options: ParsedCLI,
): Promise<void> {
  // Markdown and SARIF could imply schemas the support artifact does not promise.
  if (options.format !== "text" && options.format !== "json") {
    throw new CLIError(
      "diagnostics bundle supports --format text or --format json.",
      2,
    );
  }
  const {
    collectSupportBundle,
    renderSupportBundleJson,
    renderSupportBundleText,
  } = await import("./diagnostics/support-bundle.js");
  const supportBundle = collectSupportBundle(
    options.projectPath,
    options.agent,
  );
  const renderedBundle =
    options.format === "json"
      ? renderSupportBundleJson(supportBundle)
      : renderSupportBundleText(supportBundle);
  writeOutput(options, renderedBundle);
  // A failed audit or collection remains visible to scripts after they parse the artifact.
  if (supportBundle.exitCode !== 0) process.exitCode = supportBundle.exitCode;
}

/**
 * Build the static agent/tool threat artifact and write its selected text or JSON output.
 * Use this view when a reviewer needs local posture without executing target hooks.
 *
 * @param options - parsed target, agent, and output destination for the threat-model user
 * @returns completion after output is written; no value means the artifact reached its destination
 * @throws CLIError when the user requests a format the threat model does not support
 */
async function handleThreatModelDiagnostics(options: ParsedCLI): Promise<void> {
  // Threat posture has one concise human view and one stable machine-readable contract.
  if (options.format !== "text" && options.format !== "json") {
    throw new CLIError(
      "diagnostics threat-model supports --format text or --format json.",
      2,
    );
  }
  const {
    collectThreatModelReport,
    renderThreatModelJson,
    renderThreatModelText,
  } = await import("./diagnostics/threat-model.js");
  const threatModel = collectThreatModelReport(
    options.projectPath,
    options.agent,
  );
  const renderedThreatModel =
    options.format === "json"
      ? renderThreatModelJson(threatModel)
      : renderThreatModelText(threatModel);
  writeOutput(options, renderedThreatModel);
}

/**
 * Build the static context-pressure view and write text, JSON, or Markdown output.
 * Use this view when a user needs orientation evidence before choosing work.
 *
 * @param options - parsed target, agent, and output destination for the context user
 * @returns completion after output is written; no value means the context report reached its destination
 */
async function handleContextDiagnostics(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { loadConfig } = await import("./config/reader.js");
  const { extractProjectFacts } = await import("./facts/orchestrator.js");
  const {
    buildContextReport,
    renderContextReportJson,
    renderContextReportMarkdown,
    renderContextReportText,
  } = await import("./diagnostics/context-report.js");

  const projectFiles = createFS(options.projectPath);
  const configState = loadConfig(options.projectPath, projectFiles);
  const facts = extractProjectFacts(projectFiles, {
    agentFilter: options.agent,
    projectPath: options.projectPath,
    configState,
    includeStack: false,
  });
  const report = buildContextReport({ projectFiles, facts });
  let rendered: string;

  // JSON gives dashboards and CI the complete stable schema without prose around it.
  if (options.format === "json") {
    rendered = renderContextReportJson(report);
  } else if (options.format === "markdown") {
    // Markdown keeps the same evidence ready for issues, plans, or release notes.
    rendered = renderContextReportMarkdown(report);
  } else {
    // Terminal users receive the compact highest-pressure view.
    rendered = renderContextReportText(report);
  }
  writeOutput(options, rendered);
}

/**
 * Build and render the selected project's requested read-only diagnostics view.
 *
 * @param options - parsed target, agent, and format; a null agent includes all installed mirrors
 * @returns completion after one report reaches stdout or the requested output file; no value means output completed
 * @throws CLIError when a direct caller omits a supported view or requests a format that view cannot render
 */
export async function handleDiagnosticsCommand(
  options: ParsedCLI,
): Promise<void> {
  // Direct callers must choose a shipped view before any selected-project collector runs.
  if (options.diagnosticsSubcommand === null) {
    throw new CLIError(
      "Usage: goat-flow diagnostics <context|readiness|bundle|threat-model> [project-path] [--agent <id>] [--format text|json|markdown]",
      2,
    );
  }

  // Readiness gives the user advisory static evidence before an agent starts project work.
  if (options.diagnosticsSubcommand === "readiness") {
    await handleReadinessDiagnostics(options);
    return;
  }

  // A support bundle has one concise terminal view and one stable machine-readable contract.
  if (options.diagnosticsSubcommand === "bundle") {
    await handleSupportBundleDiagnostics(options);
    return;
  }

  // Threat-model output keeps static agent/tool posture separate from general readiness.
  if (options.diagnosticsSubcommand === "threat-model") {
    await handleThreatModelDiagnostics(options);
    return;
  }
  await handleContextDiagnostics(options);
}
