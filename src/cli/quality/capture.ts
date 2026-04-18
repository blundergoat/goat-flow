/**
 * Extract and persist quality reports from agent responses.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { attachFindingIds } from "./ids.js";
import { getQualityLogsDir, loadQualityHistory } from "./history.js";
import {
  QUALITY_REPORT_KIND,
  parseQualityReport,
  type QualityReport,
  type SavedQualityReport,
} from "./schema.js";

const QUALITY_JSON_BLOCK = /```json\s*\n([\s\S]*?)\n```/gi;

interface ExtractedQualityReport {
  report: QualityReport;
  prose: string;
}

interface CaptureQualityResult {
  id: string;
  jsonPath: string;
  markdownPath: string;
  report: SavedQualityReport;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function validateDeltaTags(
  report: QualityReport,
  hasPriorReport: boolean,
): string | null {
  for (const [index, finding] of report.findings.entries()) {
    if (hasPriorReport && finding.delta_tag === null) {
      return `findings[${index}].delta_tag must be set to "new" or "persisted" when prior history exists`;
    }
    if (!hasPriorReport && finding.delta_tag !== null) {
      return `findings[${index}].delta_tag must be null or omitted when no prior history exists`;
    }
  }
  return null;
}

function validateProjectPath(
  report: QualityReport,
  projectPath: string,
): string | null {
  const expectedProjectPath = resolve(projectPath);
  const reportedProjectPath = resolve(report.project_path);
  if (reportedProjectPath === expectedProjectPath) return null;
  return `report.project_path (${report.project_path}) does not match the capture target (${expectedProjectPath})`;
}

function chooseCaptureId(
  projectPath: string,
  runDate: string,
  agent: string,
): string {
  const dir = getQualityLogsDir(projectPath);
  if (!existsSync(dir)) return `${runDate}-${agent}`;

  const prefix = `${runDate}-${agent}`;
  const suffixes = new Set<number>();
  for (const filename of readdirSync(dir)) {
    if (!filename.endsWith(".json")) continue;
    if (!filename.startsWith(prefix)) continue;
    const match = new RegExp(`^${prefix}(?:-(\\d{2}))?\\.json$`).exec(filename);
    if (!match) continue;
    suffixes.add(match[1] ? Number(match[1]) : 1);
  }

  if (!suffixes.has(1)) return prefix;
  let next = 2;
  while (suffixes.has(next)) next += 1;
  return `${prefix}-${String(next).padStart(2, "0")}`;
}

// eslint-disable-next-line complexity -- extraction must handle multiple fenced JSON blocks and preserve the selected prose span
export function extractQualityReport(
  responseText: string,
):
  | { ok: true; extracted: ExtractedQualityReport }
  | { ok: false; error: string } {
  const normalized = normalizeText(responseText);
  const matches = [...normalized.matchAll(QUALITY_JSON_BLOCK)];
  if (matches.length === 0) {
    return {
      ok: false,
      error: `No ${QUALITY_REPORT_KIND} block in input.`,
    };
  }

  let selected: {
    match: RegExpMatchArray;
    report: QualityReport;
  } | null = null;
  let matchingBlockError: string | null = null;
  let soleFenceParseError: string | null = null;

  for (const match of matches) {
    const rawJson = match[1]!;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJson);
    } catch (error) {
      if (matches.length === 1) {
        soleFenceParseError =
          error instanceof Error ? error.message : String(error);
      }
      continue;
    }

    if (
      typeof parsedJson !== "object" ||
      parsedJson === null ||
      (parsedJson as { report_kind?: unknown }).report_kind !==
        QUALITY_REPORT_KIND
    ) {
      continue;
    }

    const parsedReport = parseQualityReport(parsedJson);
    if (!parsedReport.ok) {
      matchingBlockError = parsedReport.error;
      continue;
    }

    selected = {
      match,
      report: parsedReport.report,
    };
  }

  if (matchingBlockError) {
    return {
      ok: false,
      error: `Malformed ${QUALITY_REPORT_KIND} block: ${matchingBlockError}`,
    };
  }
  if (!selected && soleFenceParseError) {
    return {
      ok: false,
      error: `Malformed ${QUALITY_REPORT_KIND} block: ${soleFenceParseError}`,
    };
  }
  if (!selected) {
    return {
      ok: false,
      error: `No ${QUALITY_REPORT_KIND} block in input.`,
    };
  }

  const matchIndex = selected.match.index ?? 0;
  const prose = `${normalized.slice(0, matchIndex)}${normalized.slice(
    matchIndex + selected.match[0].length,
  )}`.trim();

  return {
    ok: true,
    extracted: {
      report: selected.report,
      prose,
    },
  };
}

export function captureQualityResponse(input: {
  projectPath: string;
  responseText: string;
}): { ok: true; result: CaptureQualityResult } | { ok: false; error: string } {
  const extracted = extractQualityReport(input.responseText);
  if (!extracted.ok) return extracted;
  const projectPathError = validateProjectPath(
    extracted.extracted.report,
    input.projectPath,
  );
  if (projectPathError) return { ok: false, error: projectPathError };

  const { entries } = loadQualityHistory(input.projectPath);
  const hasPriorReport = entries.some(
    (entry) => entry.agent === extracted.extracted.report.agent,
  );
  const deltaTagError = validateDeltaTags(
    extracted.extracted.report,
    hasPriorReport,
  );
  if (deltaTagError) return { ok: false, error: deltaTagError };

  const reportWithIds = attachFindingIds(extracted.extracted.report);
  if (!reportWithIds.ok) return reportWithIds;

  const captureId = chooseCaptureId(
    input.projectPath,
    reportWithIds.report.run_date,
    reportWithIds.report.agent,
  );
  const dir = getQualityLogsDir(input.projectPath);
  mkdirSync(dir, { recursive: true });

  const jsonPath = join(dir, `${captureId}.json`);
  const markdownPath = join(dir, `${captureId}.md`);
  writeFileSync(
    jsonPath,
    `${JSON.stringify(reportWithIds.report, null, 2)}\n`,
    "utf-8",
  );
  writeFileSync(
    markdownPath,
    extracted.extracted.prose.length > 0
      ? `${extracted.extracted.prose}\n`
      : "",
    "utf-8",
  );

  return {
    ok: true,
    result: {
      id: captureId,
      jsonPath,
      markdownPath,
      report: reportWithIds.report,
    },
  };
}

export function readCaptureInput(input: {
  fromFile: string | null;
  fromStdin: boolean;
}): { ok: true; text: string } | { ok: false; error: string } {
  if ((input.fromFile ? 1 : 0) + (input.fromStdin ? 1 : 0) !== 1) {
    return {
      ok: false,
      error:
        "quality capture requires exactly one of --from-file or --from-stdin",
    };
  }
  try {
    if (input.fromFile) {
      return { ok: true, text: readFileSync(resolve(input.fromFile), "utf-8") };
    }
    return { ok: true, text: readFileSync(0, "utf-8") };
  } catch (error) {
    return {
      ok: false,
      error: `Unable to read capture input: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
