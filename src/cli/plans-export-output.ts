/**
 * Turns parsed milestones into the files a user gets from `plans export`.
 *
 * This is the write half of the command: it redacts anything that should not leave the author's machine, renders each milestone as readable Markdown,
 * and refuses to write when a destination would clobber something or cannot be created.
 *
 * Redaction runs before rendering rather than after, so a value that should never be shared cannot reach a rendered string in the first place.
 * Destination checks all happen up front too: a partial export that wrote three files and then failed would leave the user with a directory they have
 * to reason about, so nothing is written until every path is proven safe.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, parse, resolve, sep } from "node:path";
import { PlansExportInputError } from "./plans-export-input-error.js";
import { scrubDurableText } from "./evidence/redaction.js";
import {
  renderActualLine,
  renderEffortLine,
  renderForecastBasisLine,
  renderForecastRangeLine,
  type PlanExportEffort,
} from "./plans-effort.js";
import type { PlanExportRecord } from "./plans-export.js";

/**
 * Scrub the optional explanations nested inside effort metadata before a preview or file export.
 * Numeric estimates stay unchanged, while absent Actuals or forecast bands remain absent for users.
 *
 * @param effort - parsed effort data whose explanations may contain pasted credentials
 * @returns export-safe effort data with every user-authored explanation scrubbed
 */
function redactExportEffort(effort: PlanExportEffort): PlanExportEffort {
  // An absent Actual is normal before work finishes, so the export keeps that field absent.
  const redactedActual = effort.actual
    ? {
        ...effort.actual,
        reason: scrubDurableText(effort.actual.reason),
      }
    : undefined;

  // A missing forecast band means the author supplied one point estimate, not incomplete data.
  const redactedForecastRange = effort.forecastRange
    ? {
        ...effort.forecastRange,
        // The optional rationale is user-authored, so pasted tokens receive the shared redaction.
        ...(effort.forecastRange.rationale !== undefined && {
          rationale: scrubDurableText(effort.forecastRange.rationale),
        }),
      }
    : undefined;

  // Forecast provenance may contain pasted issue text, so exports scrub it like rationale text.
  const redactedForecastBasis = effort.forecastBasis
    ? {
        ...effort.forecastBasis,
        source: scrubDurableText(effort.forecastBasis.source),
      }
    : undefined;

  return {
    ...effort,
    ...(redactedActual && { actual: redactedActual }),
    ...(redactedForecastBasis && { forecastBasis: redactedForecastBasis }),
    ...(redactedForecastRange && { forecastRange: redactedForecastRange }),
  };
}

/**
 * Scrub every user-authored string before it can reach stdout or a generated file.
 *
 * @param record - parsed milestone whose text fields may hold tokens or secrets
 * @returns the same record shape with readable text scrubbed; numeric effort fields
 *   pass through unchanged
 */
export function redactPlanExportRecord(
  record: PlanExportRecord,
): PlanExportRecord {
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
    timingReceiptMarkdown: scrubDurableText(record.timingReceiptMarkdown),
    ...(record.timingReceipt && {
      timingReceipt: {
        ...record.timingReceipt,
        segments: record.timingReceipt.segments.map((segment) => ({
          ...segment,
          id: scrubDurableText(segment.id),
        })),
      },
    }),
    tasks: record.tasks.map((task) => ({
      ...task,
      text: scrubDurableText(task.text),
    })),
    testingGateItems: record.testingGateItems.map((item) => ({
      ...item,
      text: scrubDurableText(item.text),
    })),
    midProofMarkdown: scrubDurableText(record.midProofMarkdown),
    midProofItems: record.midProofItems.map((item) => ({
      ...item,
      text: scrubDurableText(item.text),
    })),
    exitCriteriaItems: record.exitCriteriaItems.map((item) => ({
      ...item,
      text: scrubDurableText(item.text),
    })),
    verificationMarkdown: scrubDurableText(record.verificationMarkdown),
    exitCriteriaMarkdown: scrubDurableText(record.exitCriteriaMarkdown),
    stopMarkdown: scrubDurableText(record.stopMarkdown),
    // Effort numbers are safe to preserve, while nested author explanations need redaction.
    ...(record.effort && {
      effort: redactExportEffort(record.effort),
    }),
  };
}

/** Convert a redacted source label into a portable generated Markdown filename. */
function markdownExportFilename(sourceFile: string): string {
  return sourceFile.replace(/[^A-Za-z0-9._-]+/gu, "-");
}

/** Render the optional effort metadata shared by legacy and current milestones. */
function renderEffortMetadata(record: PlanExportRecord): string[] {
  const lines: string[] = [];
  if (record.effort) {
    lines.push(renderEffortLine(record.effort));
  }
  // A supplied basis appears before its derived range so readers see inputs before output.
  if (record.effort?.forecastBasis) {
    lines.push(renderForecastBasisLine(record.effort.forecastBasis));
  }
  if (record.effort?.forecastRange) {
    lines.push(renderForecastRangeLine(record.effort.forecastRange));
  }
  if (record.effort?.actual) {
    lines.push(renderActualLine(record.effort.actual));
  }
  if (record.planAdminEstimate?.estimateMinutes !== undefined) {
    lines.push(
      `**Plan/admin overhead:** ${record.planAdminEstimate.estimateMinutes} min other`,
    );
  }
  return lines;
}

/** Substitute the export placeholder only when a source field is empty. */
function providedOrMissing(value: string, missingText: string): string {
  return value.length > 0 ? value : missingText;
}

/**
 * Render one milestone as an issue-ready Markdown body without posting it remotely.
 *
 * @param record - one already-redacted milestone; sections the author left out render as an
 *   explicit placeholder rather than vanishing, so a reader can see the gap
 * @returns the complete Markdown body for that milestone
 */
export function renderPlanExportMarkdown(record: PlanExportRecord): string {
  const missingText = "_Not provided in the source milestone._";
  const lines = [
    `# ${record.title}`,
    "",
    `**Status:** ${record.status}`,
    `**Depends on:** ${providedOrMissing(record.dependencies, "none declared")}`,
    ...renderEffortMetadata(record),
    `**Objective:** ${providedOrMissing(record.objective, missingText)}`,
    "",
    ...(record.timingReceiptMarkdown
      ? ["## Timing Receipt", "", record.timingReceiptMarkdown, ""]
      : []),
    "## Scope",
    "",
    providedOrMissing(record.scopeMarkdown, missingText),
    "",
    "## Boundary Notes",
    "",
    providedOrMissing(record.boundaryMarkdown, missingText),
    "",
    "## Tasks",
    "",
    providedOrMissing(record.taskMarkdown, missingText),
    "",
    "## Proof",
    "",
    providedOrMissing(record.verificationMarkdown, missingText),
    "",
    "## Mid-implementation proof",
    "",
    providedOrMissing(record.midProofMarkdown, missingText),
    "",
    "## Exit Criteria",
    "",
    providedOrMissing(record.exitCriteriaMarkdown, missingText),
    "",
    "## Stop / rescope",
    "",
    providedOrMissing(record.stopMarkdown, missingText),
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
 * Require every export destination to be a single-link regular file or absent before writing.
 *
 * Runs even under force: replacement authorizes new content, never writing through a symlink, hardlink, or directory that shadows a generated
 * filename.
 * Throws a usage-safe error naming the first unsafe destination so nothing is written.
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
    if (!destinationStats.isFile() || destinationStats.nlink !== 1) {
      throw new PlansExportInputError(
        `Export output must be a single-link regular file or absent: ${outputPath}. Move the conflicting path before exporting.`,
      );
    }
  }
}

/** Require every existing export-directory component to be a real directory. */
function assertRealDirectoryPathOrAbsent(
  directoryPath: string,
  outputLabel: string,
): void {
  const absoluteDirectoryPath = resolve(directoryPath);
  const rootPath = parse(absoluteDirectoryPath).root;
  const pathComponents = absoluteDirectoryPath
    .slice(rootPath.length)
    .split(sep)
    .filter(Boolean);
  let inspectedPath = rootPath;

  for (const component of pathComponents) {
    inspectedPath = join(inspectedPath, component);
    let componentStats;
    try {
      componentStats = lstatSync(inspectedPath);
    } catch (error) {
      // Once a component is absent, all descendants are absent and mkdirSync may create them.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new PlansExportInputError(
        `Cannot inspect ${outputLabel} path component ${inspectedPath} before writing.`,
      );
    }
    if (!componentStats.isDirectory()) {
      throw new PlansExportInputError(
        `${outputLabel} must be a real directory or absent at every existing path component: ${inspectedPath}. Move the conflicting path before exporting.`,
      );
    }
  }
}

/**
 * Reject filename sanitization or redaction collisions before any export is written.
 * Throws when two milestones resolve to one destination, so no partial bundle lands.
 */
function assertUniqueOutputPaths(outputPaths: string[]): void {
  const uniqueOutputPaths = new Set(outputPaths);
  if (uniqueOutputPaths.size === outputPaths.length) return;
  throw new PlansExportInputError(
    "Multiple milestones resolve to the same export filename after redaction and sanitization. Rename the source milestone files before exporting.",
  );
}

/** Reject any existing destination that resolves to one of the source milestones. */
function assertOutputPathsDoNotAliasSources(
  outputPaths: string[],
  sourceFiles: readonly string[],
  sourceDirectory: string,
): void {
  const sourcePaths = new Set(
    sourceFiles.map((sourceFile) =>
      realpathSync(resolve(sourceDirectory, sourceFile)),
    ),
  );
  const aliasedPath = outputPaths.find((outputPath) => {
    try {
      return sourcePaths.has(realpathSync(outputPath));
    } catch (error) {
      // An absent destination cannot alias an existing source; every other lookup failure is unsafe.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new PlansExportInputError(
        `Cannot inspect export output ${outputPath} for source aliasing.`,
      );
    }
  });
  if (!aliasedPath) return;
  throw new PlansExportInputError(
    `Export --output would overwrite source milestone ${aliasedPath}. Choose a separate export destination.`,
  );
}

/**
 * Write one Markdown file per milestone after every destination passes collision checks.
 *
 * @param records - milestones to write, already redacted
 * @param outputDirectory - directory the user passed to `--output`
 * @param shouldForce - whether the user opted into overwriting files that already exist
 * @param sourceDirectory - selected plan directory whose milestones must remain read-only
 * @param sourceFiles - original unredacted milestone names used only for overwrite protection
 * @returns the paths written, so the caller can report them back to the user
 */
export function writeMarkdownExports(
  records: PlanExportRecord[],
  outputDirectory: string,
  shouldForce: boolean,
  sourceDirectory: string,
  sourceFiles: readonly string[],
): string[] {
  // No existing ancestor may redirect output outside the requested logical tree.
  assertRealDirectoryPathOrAbsent(outputDirectory, "Markdown --output");
  const outputPaths = records.map((record) =>
    join(outputDirectory, markdownExportFilename(record.sourceFile)),
  );
  assertUniqueOutputPaths(outputPaths);
  assertOutputPathsDoNotAliasSources(outputPaths, sourceFiles, sourceDirectory);
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

/**
 * Write one JSON array after preserving an existing file unless force is explicit.
 *
 * @param records - milestones to serialise, already redacted
 * @param outputPath - file the user passed to `--output`
 * @param shouldForce - whether the user opted into overwriting an existing file
 * @param sourceDirectory - selected plan directory whose milestones must remain read-only
 * @param sourceFiles - original unredacted milestone names used only for overwrite protection
 * @returns the path written, so the caller can report it back to the user
 */
export function writeJsonExport(
  records: PlanExportRecord[],
  outputPath: string,
  shouldForce: boolean,
  sourceDirectory: string,
  sourceFiles: readonly string[],
): string[] {
  if (existsSync(outputPath) && statSync(outputPath).isDirectory()) {
    throw new PlansExportInputError(
      `JSON --output must be a file: ${outputPath}.`,
    );
  }
  assertRealDirectoryPathOrAbsent(dirname(outputPath), "JSON --output parent");
  assertOutputPathsDoNotAliasSources(
    [outputPath],
    sourceFiles,
    sourceDirectory,
  );
  assertOutputPathsAvailable([outputPath], shouldForce);
  assertWritableDestinations([outputPath]);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`, "utf-8");
  return [outputPath];
}
