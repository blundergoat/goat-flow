/**
 * Builds the plan picker and milestone rows shown by the dashboard's Tasks view.
 *
 * Reads Markdown into titles, status, objectives, and progress; missing optional files use empty values so partial work remains visible.
 * The selection contract prefers the requested plan, then a usable active marker, then the first available plan.
 *
 * Writes only the active marker for an existing top-level plan; invalid selections throw, and directory-listing failures reach the route.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { maskNonRenderedMarkdown } from "../rendered-markdown.js";
import { resolveLocalStatePath } from "./local-paths.js";
import { writeFileAtomic } from "./safe-exec.js";

/**
 * Summarises one milestone without sending its Markdown to the Tasks view.
 *
 * Checkbox counts drive progress; an absent status uses `unknown` and an unreadable file keeps its filename as the title.
 * An empty modification timestamp means the file's filesystem metadata was unavailable.
 */
interface DashboardTaskMilestoneSummary {
  filename: string;
  path: string;
  title: string;
  status: string;
  objective: string;
  totalTasks: number;
  completedTasks: number;
  modifiedAt: string;
}

/**
 * Describes a plan in the Tasks picker, including whether it matches the active marker.
 *
 * The newest readable milestone dates the row; otherwise the folder timestamp is used, with the epoch as the final fallback.
 * A zero milestone count leaves the plan selectable while there are no readable milestone filenames.
 */
interface DashboardTaskPlanSummary extends Record<"active", boolean> {
  name: string;
  path: string;
  modifiedAt: string;
  milestoneCount: number;
}

/**
 * Carries the project's plan list and the milestones the Tasks view opens.
 *
 * The active marker is advisory and may name a missing plan; choosing a display fallback does not rewrite it.
 * Null selection means no plan can open; an empty milestone list can also belong to a selected plan with no milestone files.
 * The `exists` field separately reports whether the plans directory is available.
 */
export interface DashboardTaskState {
  planRoot: string;
  // Deprecated compatibility alias for callers still reading the old field name.
  taskRoot: string;
  exists: boolean;
  active: string | null;
  activeExists: boolean;
  selectedPlan: string | null;
  plans: DashboardTaskPlanSummary[];
  milestones: DashboardTaskMilestoneSummary[];
}

// Read Tasks filesystem metadata; swallows unavailable paths as null so callers can choose their empty-state fallback.
function statOrNull(path: string) {
  try {
    return statSync(path);
  } catch {
    // A plan or milestone may be removed while Tasks loads; its caller can retain a fallback row or show no available directory.
    return null;
  }
}

// Read optional plan text; a null fallback lets Tasks retain a row or ignore an unavailable active marker.
function readOptionalTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    // An active marker or milestone may be missing during local edits; Tasks can use its empty-text fallback.
    return null;
  }
}

// List milestones in stable numeric order; swallows unreadable plan directories as an empty milestone list.
function listTaskMilestoneFilenames(planPath: string): string[] {
  try {
    return readdirSync(planPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^M.*\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((leftFilename, rightFilename) =>
        leftFilename.localeCompare(rightFilename, undefined, { numeric: true }),
      );
  } catch {
    // A plan folder may disappear after it was listed; ignore this optional read failure and show no milestone rows.
    return [];
  }
}

/**
 * Pull one labelled value out of a milestone file, so the Tasks card shows a real title or status instead of raw Markdown.
 *
 * @param content - milestone text with non-rendered regions already masked out
 * @param pattern - expression whose first group holds the value
 * @param fallback - value shown when the field is absent or empty, which is normal for a half-written milestone
 * @returns the trimmed field value, or the fallback
 */
function readMarkdownField(
  content: string,
  pattern: RegExp,
  fallback: string,
): string {
  // A missing or blank field keeps the display fallback for a partly written milestone.
  return content.match(pattern)?.[1]?.trim() || fallback;
}

const LEVEL_TWO_ATX_HEADING = /^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u;
const LEVEL_TWO_ATX_BOUNDARY = /^ {0,3}##(?:[ \t]+|$)/u;

/**
 * Read one Markdown section for the milestone summary without consuming its peers.
 * Null means no heading; an empty string preserves an intentionally empty Tasks section instead of counting legacy whole-file checkboxes.
 */
function readLevelTwoSection(
  content: string,
  expectedHeading: string,
): string | null {
  const lines = content.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => {
    const heading = line.match(LEVEL_TWO_ATX_HEADING)?.[1]?.trim();
    return heading?.toLowerCase() === expectedHeading.toLowerCase();
  });
  // No matching heading lets legacy milestones use their older whole-file or title fallback.
  if (headingIndex < 0) return null;
  const nextHeadingOffset = lines
    .slice(headingIndex + 1)
    .findIndex((line) => LEVEL_TWO_ATX_BOUNDARY.test(line));
  // The last section continues to the file's end; a following peer heading belongs to another part of the milestone.
  const bodyEnd =
    nextHeadingOffset < 0 ? lines.length : headingIndex + 1 + nextHeadingOffset;
  return lines
    .slice(headingIndex + 1, bodyEnd)
    .join("\n")
    .trim();
}

// Remove the local milestone identifier when a title supplies the objective.
function objectiveFromTitle(title: string): string {
  return title.replace(/^(?:M\d+|Milestone\s+\d+)\s*:\s*/iu, "").trim();
}

// Prefer explicit objective metadata, then section content, then the outcome title.
function readTaskObjective(content: string, title: string): string {
  const objectiveField = readMarkdownField(
    content,
    /^\*\*Objective:\*\*\s*(.+)$/mu,
    "",
  );
  // Explicit objective metadata supplies the milestone's displayed outcome.
  if (objectiveField) return objectiveField;
  // Absent or empty objective prose leaves the outcome title available as the milestone's objective.
  return readLevelTwoSection(content, "Objective") || objectiveFromTitle(title);
}

// Count Markdown task checkboxes using the same shape goat-plan writes into milestones.
function readTaskProgress(content: string): {
  totalTasks: number;
  completedTasks: number;
} {
  // Only an absent Tasks heading uses whole-file checkboxes; an intentionally empty Tasks section means zero tasks.
  const taskSource = readLevelTwoSection(content, "Tasks") ?? content;
  const taskMatches = Array.from(taskSource.matchAll(/^\s*-\s+\[( |x|X)\]/gmu));
  return {
    totalTasks: taskMatches.length,
    completedTasks: taskMatches.filter(
      (match) => match[1]?.toLowerCase() === "x",
    ).length,
  };
}

/**
 * Turn one milestone file into the compact row the Tasks view renders, including its checkbox progress.
 *
 * @param planPath - directory holding the plan's milestone files
 * @param filename - milestone file to summarise
 * @returns the summary; an unreadable file still yields a row titled by its filename rather than disappearing from the list
 */
function parseTaskMilestone(
  planPath: string,
  filename: string,
): DashboardTaskMilestoneSummary {
  const path = join(planPath, filename);
  // A missing milestone still keeps its row; empty text supplies unknown status and zero progress.
  const content = maskNonRenderedMarkdown(readOptionalTextFile(path) ?? "");
  // Unavailable filesystem metadata leaves this milestone's displayed update time empty.
  const modifiedAt = statOrNull(path)?.mtime.toISOString() ?? "";
  const progress = readTaskProgress(content);
  const outcomeTitle = readMarkdownField(content, /^#\s+(.+)$/mu, "");
  // A milestone without a readable heading stays identifiable by its filename.
  const title = outcomeTitle || filename;
  return {
    filename,
    path,
    title,
    status: readMarkdownField(content, /^\*\*Status:\*\*\s*(.+)$/mu, "unknown"),
    objective: readTaskObjective(content, outcomeTitle),
    totalTasks: progress.totalTasks,
    completedTasks: progress.completedTasks,
    modifiedAt,
  };
}

/**
 * Summarise one plan directory for the plan picker, dated by its newest milestone so recent work sorts to the top.
 *
 * @param taskRoot - project plans directory
 * @param name - plan directory name
 * @param active - plan named by the `.active` marker; null means no plan is marked and none is shown as current
 * @returns the picker row for this plan
 */
function buildTaskPlanSummary(
  taskRoot: string,
  name: string,
  active: string | null,
): DashboardTaskPlanSummary {
  const planPath = join(taskRoot, name);
  const milestoneFilenames = listTaskMilestoneFilenames(planPath);
  const newestMilestoneTime = milestoneFilenames.reduce<number | null>(
    (latestMilestoneMs, filename) => {
      const modifiedAtMs = statOrNull(
        join(planPath, filename),
      )?.mtime.getTime();
      // A milestone removed during the scan cannot date the plan; keep the latest readable timestamp.
      if (modifiedAtMs === undefined) return latestMilestoneMs;
      // The first readable milestone starts the timestamp; later ones keep the newest work at the top of the picker.
      return latestMilestoneMs === null
        ? modifiedAtMs
        : Math.max(latestMilestoneMs, modifiedAtMs);
    },
    null,
  );
  // With no readable milestones, use the folder's date; missing folder metadata uses the epoch for deterministic ordering.
  const planModifiedAtMs = statOrNull(planPath)?.mtime.getTime() ?? 0;
  const modifiedAt = new Date(
    newestMilestoneTime ?? planModifiedAtMs,
  ).toISOString();
  return {
    name,
    path: planPath,
    modifiedAt,
    milestoneCount: milestoneFilenames.length,
    active: active === name,
  };
}

// List top-level task plan directories while ignoring local dotfile markers.
function listTaskPlanNames(taskRoot: string): string[] {
  return readdirSync(taskRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

/**
 * Describe an unavailable plans directory so Tasks can render its empty state.
 *
 * @param planRoot - expected location of the project's plan directories
 * @param active - leftover active marker, or null when no readable non-empty marker exists
 * @returns empty plans and milestones with `exists: false`; any marker is retained without claiming its plan exists
 */
function emptyDashboardTaskState(
  planRoot: string,
  active: string | null,
): DashboardTaskState {
  return {
    planRoot,
    taskRoot: planRoot,
    exists: false,
    active,
    activeExists: false,
    selectedPlan: null,
    plans: [],
    milestones: [],
  };
}

/**
 * Choose which plan the Tasks view opens on: what the user clicked, then the one they left active, then the first available.
 *
 * @param requestedPlan - plan the user clicked; null or unknown falls through to the next choice
 * @param active - plan named by the `.active` marker
 * @param hasActivePlan - whether that marker still points at a real directory
 * @param plans - plans found in the project
 * @returns the plan to open, or null when the project has none
 */
function selectDashboardTaskPlan(
  requestedPlan: string | null,
  active: string | null,
  hasActivePlan: boolean,
  plans: DashboardTaskPlanSummary[],
): string | null {
  const requestedExists = plans.some((plan) => plan.name === requestedPlan);
  // An explicit click wins, as long as that plan is still on disk.
  if (requestedPlan && requestedExists) return requestedPlan;
  // Otherwise the user resumes wherever they left off.
  if (hasActivePlan) return active;
  // Without a usable click or active marker, open the first available plan; an empty picker has no selection.
  return plans[0]?.name ?? null;
}

/**
 * Build Tasks using the requested plan, then a usable active marker, then the first available plan.
 * This selection contract lets an explicit picker choice win while missing local plan state remains an ordinary empty state.
 *
 * @param projectPath - selected project whose plans are listed
 * @param requestedPlan - clicked plan; null, empty, or unknown names fall back to the active marker, then the first available plan
 * @returns plans and selected milestones; no readable plans directory yields `exists: false`, while an empty directory can have `exists: true`
 */
export function buildDashboardTaskState(
  projectPath: string,
  requestedPlan: string | null,
): DashboardTaskState {
  const planRoot = resolveLocalStatePath(projectPath, "plans");
  const planRootStats = statOrNull(planRoot);
  // A missing or blank marker means no plan is marked active; another plan can still open.
  const active =
    readOptionalTextFile(join(planRoot, ".active"))?.trim() || null;
  // An absent, unreadable, or non-directory plans path leaves Tasks with its empty state.
  if (!planRootStats?.isDirectory()) {
    return emptyDashboardTaskState(planRoot, active);
  }

  const planNames = listTaskPlanNames(planRoot);
  const plans = planNames
    .map((name) => buildTaskPlanSummary(planRoot, name, active))
    .sort((leftPlan, rightPlan) => {
      const modifiedTimeDifference =
        new Date(rightPlan.modifiedAt).getTime() -
        new Date(leftPlan.modifiedAt).getTime();
      return modifiedTimeDifference !== 0
        ? modifiedTimeDifference
        : leftPlan.name.localeCompare(rightPlan.name);
    });
  const activeExists = Boolean(
    active && plans.some((plan) => plan.name === active),
  );
  const selectedPlan = selectDashboardTaskPlan(
    requestedPlan,
    active,
    activeExists,
    plans,
  );
  // No available plan leaves both the selected path and milestone list empty.
  const selectedPlanPath = selectedPlan ? join(planRoot, selectedPlan) : null;
  const milestones = selectedPlanPath
    ? listTaskMilestoneFilenames(selectedPlanPath).map((filename) =>
        parseTaskMilestone(selectedPlanPath, filename),
      )
    : [];

  return {
    planRoot,
    taskRoot: planRoot,
    exists: true,
    active,
    activeExists,
    selectedPlan,
    plans,
    milestones,
  };
}

/**
 * Parse mutation request JSON before route handlers inspect path-like fields.
 *
 * Throws when the body is malformed JSON or is not a top-level object.
 */
function parseJsonObjectBody(body: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // An empty or malformed selection request cannot be decoded; report the error before changing the active plan.
    throw new Error("Request body must be valid JSON");
  }
  // Null, arrays, and primitive JSON cannot carry the plan field required to switch Tasks.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Reject plan names that could escape the `.goat-flow/plans` top level.
 *
 * Throws when the plan name is hidden, relative, or path-like.
 */
function assertTopLevelPlanName(planName: string): void {
  // A selection must name one visible plan under this project; hidden names and path segments could target another location.
  if (
    planName === "." ||
    planName === ".." ||
    planName.includes("/") ||
    planName.includes("\\") ||
    planName.startsWith(".")
  ) {
    throw new Error("body.plan must name a top-level plan directory");
  }
}

/**
 * Read the plan selected by a dashboard mutation request.
 * Throws for a missing, blank, or path-like name so the request cannot select an unintended directory.
 *
 * @param body - raw request body; must be JSON with a non-empty string `plan` field
 * @returns the trimmed, validated plan name guaranteed to be a single top-level directory segment
 */
export function readActiveTaskPlanBody(body: string): string {
  const parsed = parseJsonObjectBody(body);
  const plan = parsed["plan"];
  // A missing, blank, or non-text selection cannot identify the plan the user wants to activate.
  if (typeof plan !== "string" || plan.trim().length === 0) {
    throw new Error("body.plan must be a non-empty string");
  }
  const normalized = plan.trim();
  assertTopLevelPlanName(normalized);
  return normalized;
}

/**
 * Writes the active marker for an existing plan after the user switches plans in the dashboard.
 * Throws when the plans directory or requested plan is unavailable; this operation does not create plan structure.
 *
 * @param projectPath - absolute project root whose `.goat-flow/plans` directory holds the plans
 * @param planName - validated top-level plan directory name to mark active; must already exist on disk
 */
export function writeActiveTaskPlan(
  projectPath: string,
  planName: string,
): void {
  const planRoot = resolveLocalStatePath(projectPath, "plans");
  const planRootStats = statOrNull(planRoot);
  // Nothing to switch between, and creating the directory here would invent structure the user never asked for.
  if (!planRootStats?.isDirectory()) {
    throw new Error(".goat-flow/plans does not exist for the selected project");
  }
  const planNames = listTaskPlanNames(planRoot);
  // The requested plan may have been removed since the picker loaded; reject the switch while preserving the existing marker.
  if (!planNames.includes(planName)) {
    throw new Error(`plan not found: ${planName}`);
  }
  writeFileAtomic(
    resolveLocalStatePath(projectPath, "plans/.active"),
    `${planName}\n`,
    projectPath,
  );
}
