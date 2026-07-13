/**
 * Runs one read-only diagnostics view after the shared CLI parser selects it.
 * Use this boundary when an operator wants local context pressure or a redacted
 * support artifact without loading collectors belonging to unrelated commands.
 */
import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";

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
      "Usage: goat-flow diagnostics <context|readiness|bundle> [project-path] [--agent <id>] [--format text|json|markdown]",
      2,
    );
  }

  // Readiness gives the user advisory static evidence before an agent starts project work.
  if (options.diagnosticsSubcommand === "readiness") {
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
    return;
  }

  // A support bundle has one concise terminal view and one stable machine-readable contract.
  if (options.diagnosticsSubcommand === "bundle") {
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
    return;
  }

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
