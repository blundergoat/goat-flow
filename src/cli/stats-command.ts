/**
 * Runs the read-only learning-loop stats command after CLI parsing.
 * Use this module when an operator wants memory health, check-mode evidence,
 * or machine-readable freshness without loading stats code for other commands.
 */
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";

/**
 * Show selected-project memory health in the requested format or check mode.
 *
 * @param options - parsed choices; absent optional flags select normal text output
 * @returns completion after output is written; no reusable payload is returned
 */
export async function handleStatsCommand(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { loadConfig } = await import("./config/reader.js");
  const {
    extractFootgunFacts,
    extractLearningLoopEntries,
    extractLessonsFacts,
  } = await import("./facts/shared/learning-loop.js");
  const { buildStatsReport, checkStats, buildDecisionsSection } =
    await import("./stats/stats.js");
  const {
    renderStatsText,
    renderStatsJson,
    renderStatsMarkdown,
    renderStatsCheckText,
  } = await import("./stats/render.js");

  const { collectIndexFreshness } = await import("./stats/index-freshness.js");
  const { resolveIndexBucketPaths } =
    await import("./learning-loop-index/parse-bucket.js");

  const projectFiles = createFS(options.projectPath);
  const configState = loadConfig(options.projectPath, projectFiles);
  const report = buildStatsReport({
    footguns: extractFootgunFacts(projectFiles, configState),
    lessons: extractLessonsFacts(projectFiles, configState),
    // Users receive complete entry metadata in JSON while checks derive bounded bucket warnings.
    learningLoopEntries: extractLearningLoopEntries(projectFiles, configState),
    decisions: buildDecisionsSection(
      projectFiles,
      configState.config.decisions.path,
    ),
    indexes: collectIndexFreshness(
      projectFiles,
      resolveIndexBucketPaths(configState.config),
    ),
  });

  // Check mode gives operators a pass/fail verdict instead of the exploratory stats report.
  if (options.shouldCheck) {
    const verdict = checkStats(report);
    // JSON keeps automation stable; terminal users receive concise human-readable guidance.
    if (options.format === "json") {
      writeOutput(options, JSON.stringify(verdict, null, 2));
    } else {
      // Text mode makes each finding and warning readable without a JSON parser.
      writeOutput(options, renderStatsCheckText(verdict).trimEnd());
    }
    // Blocking findings set a failing exit status so CI and shell users can stop safely.
    if (verdict.status === "fail") process.exitCode = 1;
    return;
  }

  let rendered: string;
  // Machine consumers receive the full stable report shape, including entry metadata.
  if (options.format === "json") {
    rendered = renderStatsJson(report);
  } else if (options.format === "markdown") {
    // Markdown lets users paste the report into durable project documentation.
    rendered = renderStatsMarkdown(report);
  } else {
    // Normal terminal use receives the compact text view.
    rendered = renderStatsText(report);
  }
  writeOutput(options, rendered.trimEnd());
}
