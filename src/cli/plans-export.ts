/**
 * Local milestone export adapter for portable plan review and issue drafting.
 * It parses goat-plan Markdown, preserves delivery and verification context,
 * scrubs readable text before rendering, previews to stdout by default, and
 * writes generated JSON or Markdown only when users choose `--output`.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";
import { scrubDurableText } from "./evidence/redaction.js";

/** One task checkbox preserved for JSON consumers and future body generators. */
interface PlanExportTask {
  isChecked: boolean;
  text: string;
}

/** Portable milestone fields shared by JSON and Markdown renderers. */
interface PlanExportRecord {
  sourceFile: string;
  title: string;
  status: string;
  dependencies: string;
  objective: string;
  scopeMarkdown: string;
  boundaryMarkdown: string;
  taskMarkdown: string;
  tasks: PlanExportTask[];
  verificationMarkdown: string;
  exitCriteriaMarkdown: string;
  warnings: string[];
}

/** One parsed level-two Markdown section and its unchanged body. */
interface MarkdownSection {
  heading: string;
  body: string;
}

/**
 * Invalid plan input that users can fix without a stack trace.
 * Use for missing plan directories, unreadable milestones, or absent titles.
 */
class PlansExportInputError extends Error {
  /** Create one usage-safe plan error that the CLI can show without a stack trace. */
  constructor(message: string) {
    super(message);
    this.name = "PlansExportInputError";
  }
}

/** Read a bold or plain single-line milestone field; missing content returns an empty value. */
function readMilestoneField(content: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const boldMatch = content.match(
    new RegExp(`^\\*\\*${escapedLabel}:\\*\\*\\s*(.+)$`, "imu"),
  );
  // goat-plan's compact example shape writes bare `Status: not-started` lines,
  // so a plain label is accepted whenever the bold form is absent.
  const fieldMatch =
    boldMatch ?? content.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "imu"));
  return fieldMatch?.[1]?.trim() ?? "";
}

/** Split level-two sections while preserving nested headings and user-authored Markdown. */
function readMilestoneSections(content: string): MarkdownSection[] {
  const headingMatches = Array.from(content.matchAll(/^##\s+(.+)$/gmu));

  // Each heading owns text until the next peer heading, matching goat-plan's milestone layout.
  return headingMatches.map((headingMatch, index) => {
    const bodyStart = headingMatch.index + headingMatch[0].length;
    const bodyEnd = headingMatches.at(index + 1)?.index ?? content.length;
    return {
      heading: headingMatch[1]?.trim().toLowerCase() ?? "",
      body: content.slice(bodyStart, bodyEnd).trim(),
    };
  });
}

/** Find a section by user-facing heading aliases; absent sections return empty text. */
function readMilestoneSection(
  sections: MarkdownSection[],
  headingAliases: readonly string[],
): string {
  const matchingSection = sections.find((section) =>
    headingAliases.some(
      (alias) =>
        section.heading === alias || section.heading.startsWith(`${alias} `),
    ),
  );
  return matchingSection?.body ?? "";
}

/** Convert Markdown task lines into stable checked/text records for JSON consumers. */
function readMilestoneTasks(taskMarkdown: string): PlanExportTask[] {
  return Array.from(
    taskMarkdown.matchAll(/^\s*-\s+\[([ xX])\]\s+(.+)$/gmu),
  ).map((taskMatch) => ({
    isChecked: taskMatch[1]?.toLowerCase() === "x",
    text: taskMatch[2]?.trim() ?? "",
  }));
}

/** Add one warning when a portable field is absent from a partial milestone. */
function addMissingFieldWarning(
  warnings: string[],
  fieldValue: string | readonly unknown[],
  label: string,
): void {
  // Empty text or collections tell export readers which source context was unavailable.
  if (fieldValue.length === 0) warnings.push(`missing ${label}`);
}

/**
 * Parse one goat-plan milestone into the portable export contract.
 * Use for previews and writes; only the top-level title is mandatory.
 *
 * @param content - milestone Markdown; empty or title-less text is malformed
 * @param sourceFile - source filename shown to export readers and reused for Markdown output
 * @returns portable fields plus warnings for every missing optional section
 * @throws PlansExportInputError when no top-level milestone title exists
 */
export function parseMilestoneMarkdown(
  content: string,
  sourceFile: string,
): PlanExportRecord {
  const title = content.match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? "";

  // Without a title, users cannot identify or create the resulting issue safely.
  if (title.length === 0) {
    throw new PlansExportInputError(
      `${sourceFile}: milestone must include a top-level title such as "# M01: Name".`,
    );
  }

  const sections = readMilestoneSections(content);
  const status = readMilestoneField(content, "Status");
  const dependencies = readMilestoneField(content, "Depends on");
  // Handoff-grade milestones carry the objective as a `## Objective` section
  // rather than a metadata line; both shapes are real goat-plan output.
  const objective =
    readMilestoneField(content, "Objective") ||
    readMilestoneSection(sections, ["objective"]);
  const scopeMarkdown = readMilestoneSection(sections, [
    "scope",
    "scope discipline",
  ]);
  const boundaryMarkdown = readMilestoneSection(sections, [
    "boundary gate",
    "boundary notes",
  ]);
  const taskMarkdown = readMilestoneSection(sections, ["tasks"]);
  const tasks = readMilestoneTasks(taskMarkdown);
  const verificationMarkdown = readMilestoneSection(sections, [
    "verification gate",
    "testing gate",
  ]);
  const exitCriteriaMarkdown = readMilestoneSection(sections, [
    "exit criteria",
  ]);
  const warnings: string[] = [];
  addMissingFieldWarning(warnings, status, "status");
  addMissingFieldWarning(warnings, dependencies, "dependencies");
  addMissingFieldWarning(warnings, objective, "objective");
  addMissingFieldWarning(warnings, scopeMarkdown, "scope");
  addMissingFieldWarning(warnings, boundaryMarkdown, "boundary notes");
  addMissingFieldWarning(warnings, tasks, "tasks");
  addMissingFieldWarning(warnings, verificationMarkdown, "verification gate");
  addMissingFieldWarning(warnings, exitCriteriaMarkdown, "exit criteria");

  return {
    sourceFile,
    title,
    status: status || "unknown",
    dependencies,
    objective,
    scopeMarkdown,
    boundaryMarkdown,
    taskMarkdown,
    tasks,
    verificationMarkdown,
    exitCriteriaMarkdown,
    warnings,
  };
}

/**
 * List milestone filenames in a stable numeric-order contract.
 * Throws when a selected plan directory disappears or becomes unreadable.
 */
function listMilestoneFiles(planPath: string): string[] {
  try {
    return readdirSync(planPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^M\d.*\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true }),
      );
  } catch (error) {
    // Example: a user selected a completed plan folder that was moved between listing and export.
    throw new PlansExportInputError(
      `Cannot read plan directory ${planPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Load every milestone record from one selected plan directory.
 * Throws when the plan is empty or any milestone is unreadable or malformed.
 */
function loadPlanExportRecords(planPath: string): PlanExportRecord[] {
  const milestoneFiles = listMilestoneFiles(planPath);

  // An empty plan cannot produce a meaningful backlog or issue bundle.
  if (milestoneFiles.length === 0) {
    throw new PlansExportInputError(
      `No M*.md milestone files found in ${planPath}.`,
    );
  }

  // Every source file becomes one independently portable export record.
  return milestoneFiles.map((sourceFile) => {
    try {
      return parseMilestoneMarkdown(
        readFileSync(join(planPath, sourceFile), "utf-8"),
        sourceFile,
      );
    } catch (error) {
      // Example: an editor changed file permissions after the user selected the plan.
      if (error instanceof PlansExportInputError) throw error;
      throw new PlansExportInputError(
        `Cannot read ${sourceFile}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

/** Scrub every user-authored string before it can reach stdout or a generated file. */
function redactPlanExportRecord(record: PlanExportRecord): PlanExportRecord {
  return {
    ...record,
    sourceFile: scrubDurableText(record.sourceFile),
    title: scrubDurableText(record.title),
    status: scrubDurableText(record.status),
    dependencies: scrubDurableText(record.dependencies),
    objective: scrubDurableText(record.objective),
    scopeMarkdown: scrubDurableText(record.scopeMarkdown),
    boundaryMarkdown: scrubDurableText(record.boundaryMarkdown),
    taskMarkdown: scrubDurableText(record.taskMarkdown),
    tasks: record.tasks.map((task) => ({
      ...task,
      text: scrubDurableText(task.text),
    })),
    verificationMarkdown: scrubDurableText(record.verificationMarkdown),
    exitCriteriaMarkdown: scrubDurableText(record.exitCriteriaMarkdown),
  };
}

/** Convert a redacted source label into a portable generated Markdown filename. */
function markdownExportFilename(sourceFile: string): string {
  return sourceFile.replace(/[^A-Za-z0-9._-]+/gu, "-");
}

/** Render one milestone as an issue-ready Markdown body without posting it remotely. */
function renderPlanExportMarkdown(record: PlanExportRecord): string {
  const missingText = "_Not provided in the source milestone._";
  const lines = [
    `# ${record.title}`,
    "",
    `**Status:** ${record.status}`,
    `**Depends on:** ${record.dependencies || "none declared"}`,
    `**Objective:** ${record.objective || missingText}`,
    "",
    "## Scope",
    "",
    record.scopeMarkdown || missingText,
    "",
    "## Boundary Notes",
    "",
    record.boundaryMarkdown || missingText,
    "",
    "## Tasks",
    "",
    record.taskMarkdown || missingText,
    "",
    "## Verification Gate",
    "",
    record.verificationMarkdown || missingText,
    "",
    "## Exit Criteria",
    "",
    record.exitCriteriaMarkdown || missingText,
  ];

  // Partial milestones surface warnings so issue readers do not mistake missing gates for approval.
  if (record.warnings.length > 0) {
    lines.push(
      "",
      "## Export Warnings",
      "",
      ...record.warnings.map((warning) => `- ${warning}`),
    );
  }
  return lines.join("\n");
}

/** Refuse implicit regeneration when any generated destination already exists. */
function assertOutputPathsAvailable(
  outputPaths: string[],
  shouldForce: boolean,
): void {
  // Explicit force is the only signal that existing generated exports may be replaced.
  if (shouldForce) return;
  const existingOutputPath = outputPaths.find((path) => existsSync(path));

  // Preserving the first collision prevents partial writes and protects user edits.
  if (existingOutputPath) {
    throw new PlansExportInputError(
      `Export output already exists: ${existingOutputPath}. Pass --force to regenerate it.`,
    );
  }
}

/**
 * Require every export destination to be a regular file or absent before writing.
 * Runs even under force: replacement authorizes new content, never writing
 * through a symlink or into a directory that shadows a generated filename.
 */
function assertWritableDestinations(outputPaths: string[]): void {
  for (const outputPath of outputPaths) {
    let destinationStats;
    try {
      destinationStats = lstatSync(outputPath);
    } catch (error) {
      // Absent is the normal case: the export write creates the file.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new PlansExportInputError(
        `Cannot inspect export output ${outputPath} before writing.`,
      );
    }
    if (!destinationStats.isFile()) {
      throw new PlansExportInputError(
        `Export output must be a regular file or absent: ${outputPath}. Move the conflicting path before exporting.`,
      );
    }
  }
}

/** Reject filename sanitization or redaction collisions before any export is written. */
function assertUniqueOutputPaths(outputPaths: string[]): void {
  const uniqueOutputPaths = new Set(outputPaths);
  if (uniqueOutputPaths.size === outputPaths.length) return;
  throw new PlansExportInputError(
    "Multiple milestones resolve to the same export filename after redaction and sanitization. Rename the source milestone files before exporting.",
  );
}

/** Write one Markdown file per milestone after every destination passes collision checks. */
function writeMarkdownExports(
  records: PlanExportRecord[],
  outputDirectory: string,
  shouldForce: boolean,
): string[] {
  // A file at the requested directory path cannot safely hold several milestone bodies.
  if (existsSync(outputDirectory) && !statSync(outputDirectory).isDirectory()) {
    throw new PlansExportInputError(
      `Markdown --output must be a directory: ${outputDirectory}.`,
    );
  }
  const outputPaths = records.map((record) =>
    join(outputDirectory, markdownExportFilename(record.sourceFile)),
  );
  assertUniqueOutputPaths(outputPaths);
  assertOutputPathsAvailable(outputPaths, shouldForce);
  assertWritableDestinations(outputPaths);
  mkdirSync(outputDirectory, { recursive: true });

  // Each milestone stays independent so future issue adapters can consume one body at a time.
  for (const [index, record] of records.entries()) {
    const outputPath = outputPaths[index];

    // A mapped destination always exists because outputPaths was built from the same records.
    if (!outputPath) continue;
    writeFileSync(outputPath, `${renderPlanExportMarkdown(record)}\n`, "utf-8");
  }
  return outputPaths;
}

/** Write one JSON array after preserving an existing file unless force is explicit. */
function writeJsonExport(
  records: PlanExportRecord[],
  outputPath: string,
  shouldForce: boolean,
): string[] {
  if (existsSync(outputPath) && statSync(outputPath).isDirectory()) {
    throw new PlansExportInputError(
      `JSON --output must be a file: ${outputPath}.`,
    );
  }
  assertOutputPathsAvailable([outputPath], shouldForce);
  assertWritableDestinations([outputPath]);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`, "utf-8");
  return [outputPath];
}

/**
 * Preview or persist one local plan export without invoking any remote adapter.
 * Use from `plans export`; unsupported formats and input errors become usage failures.
 *
 * @param options - parsed plan path, format, optional output, and explicit force choice
 * @returns nothing; preview goes to stdout and written paths are confirmed on stderr
 * @throws CLIError for unsupported formats, invalid plans, or protected output collisions
 */
export function handlePlansExportCommand(options: ParsedCLI): void {
  // SARIF has no plan-body contract and text aliases the human-readable Markdown preview.
  if (options.format === "sarif") {
    throw new CLIError("plans export supports --format markdown or json.", 2);
  }

  let records: PlanExportRecord[];
  try {
    records = loadPlanExportRecords(options.projectPath).map(
      redactPlanExportRecord,
    );
  } catch (error) {
    // Example: a user selected a stale plan path or a milestone without a title.
    if (error instanceof PlansExportInputError) {
      throw new CLIError(error.message, 2);
    }
    throw error;
  }

  const isJson = options.format === "json";
  const renderedPreview = isJson
    ? JSON.stringify(records, null, 2)
    : records.map(renderPlanExportMarkdown).join("\n\n---\n\n");

  // No output path is the safe preview mode and performs no export writes.
  if (!options.output) {
    writeOutput({ ...options, output: null }, renderedPreview);
    return;
  }

  let writtenPaths: string[];
  try {
    writtenPaths = isJson
      ? writeJsonExport(records, options.output, options.shouldForce)
      : writeMarkdownExports(records, options.output, options.shouldForce);
  } catch (error) {
    // Example: a prior export exists and the user did not authorize regeneration.
    if (error instanceof PlansExportInputError) {
      throw new CLIError(error.message, 2);
    }
    throw error;
  }

  // Written-path confirmations stay on stderr so scripted stdout remains artifact-free.
  for (const writtenPath of writtenPaths)
    console.error(`Written to ${writtenPath}`);
}
