/**
 * Runs one read-only diagnostics view after the shared CLI parser selects it.
 * Use this boundary when an operator wants local context evidence rendered as
 * text, Markdown, or JSON without loading diagnostics collectors for other commands.
 */
import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";

/**
 * Build and render the selected project's static context-pressure report.
 *
 * @param options - parsed target, agent, and format; a null agent includes all installed mirrors
 * @returns completion after one report reaches stdout or the requested output file
 * @throws CLIError when a direct caller omits the supported `context` diagnostics view
 */
export async function handleDiagnosticsCommand(
  options: ParsedCLI,
): Promise<void> {
  // Context is the only shipped diagnostics view; this guard protects direct handler callers too.
  if (options.diagnosticsSubcommand !== "context") {
    throw new CLIError(
      "Usage: goat-flow diagnostics context [project-path] [--agent <id>] [--format text|json|markdown]",
      2,
    );
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
