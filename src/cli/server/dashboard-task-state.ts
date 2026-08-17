/**
 * Plan and milestone state model behind the dashboard's `/api/plans` route.
 *
 * Reads `.goat-flow/plans`, parsing each `M*.md` milestone into a compact summary (title, status, objective, checkbox progress) so the UI never
 * receives raw Markdown, and writes the `.active` marker to switch the selected plan.
 * Plan-name inputs are validated to a single top-level directory segment before any write so a request cannot escape the plans root.
 *
 * Filesystem reads swallow missing paths into empty state; the mutation helpers throw on malformed input or a non-existent plan.
 *
 * Consumed by dashboard-project-routes.ts.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { maskNonRenderedMarkdown } from "../rendered-markdown.js";
import { resolveLocalStatePath } from "./local-paths.js";

/**
 * Milestone row parsed from an `M*.md` task file without sending full Markdown to the UI.
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
 * Task-plan row for the dashboard plan picker; `modifiedAt` comes from the newest milestone.
 */
interface DashboardTaskPlanSummary extends Record<"active", boolean> {
  name: string;
  path: string;
  modifiedAt: string;
  milestoneCount: number;
}

/**
 * Task browser response where `.active` is advisory and may name a missing plan.
 */
export interface DashboardTaskState {
  planRoot: string;
  /** Deprecated compatibility alias for callers still reading the old field name. */
  taskRoot: string;
  exists: boolean;
  active: string | null;
  activeExists: boolean;
  selectedPlan: string | null;
  plans: DashboardTaskPlanSummary[];
  milestones: DashboardTaskMilestoneSummary[];
}

/**
 * Return filesystem stats; swallows missing-path and permission errors as `null`.
 */
function statOrNull(path: string) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Read optional dashboard state files, swallowing local churn as a `null` fallback.
 */
function readOptionalTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * List a stable numeric sort of `M*.md` milestones; swallows absent plan directories.
 */
function listTaskMilestoneFilenames(planPath: string): string[] {
  try {
    return readdirSync(planPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^M.*\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function readMarkdownField(
  content: string,
  pattern: RegExp,
  fallback: string,
): string {
  return content.match(pattern)?.[1]?.trim() || fallback;
}

const LEVEL_TWO_ATX_HEADING = /^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u;
const LEVEL_TWO_ATX_BOUNDARY = /^ {0,3}##(?:[ \t]+|$)/u;

/**
 * Read one level-two Markdown section without consuming its peer sections.
 *
 * Returns `null` when the heading is absent so an intentionally empty canonical
 * section remains distinct from a legacy milestone with no section structure.
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
  if (headingIndex < 0) return null;
  const nextHeadingOffset = lines
    .slice(headingIndex + 1)
    .findIndex((line) => LEVEL_TWO_ATX_BOUNDARY.test(line));
  const bodyEnd =
    nextHeadingOffset < 0 ? lines.length : headingIndex + 1 + nextHeadingOffset;
  return lines
    .slice(headingIndex + 1, bodyEnd)
    .join("\n")
    .trim();
}

/** Remove the local milestone identifier when a title supplies the objective. */
function objectiveFromTitle(title: string): string {
  return title.replace(/^(?:M\d+|Milestone\s+\d+)\s*:\s*/iu, "").trim();
}

/** Prefer explicit objective metadata, then section content, then the outcome title. */
function readTaskObjective(content: string, title: string): string {
  const objectiveField = readMarkdownField(
    content,
    /^\*\*Objective:\*\*\s*(.+)$/mu,
    "",
  );
  if (objectiveField) return objectiveField;
  return readLevelTwoSection(content, "Objective") || objectiveFromTitle(title);
}

/**
 * Count Markdown task checkboxes using the same shape goat-plan writes into milestones.
 */
function readTaskProgress(content: string): {
  totalTasks: number;
  completedTasks: number;
} {
  const taskSource = readLevelTwoSection(content, "Tasks") ?? content;
  const taskMatches = Array.from(taskSource.matchAll(/^\s*-\s+\[( |x|X)\]/gmu));
  return {
    totalTasks: taskMatches.length,
    completedTasks: taskMatches.filter(
      (match) => match[1]?.toLowerCase() === "x",
    ).length,
  };
}

function parseTaskMilestone(
  planPath: string,
  filename: string,
): DashboardTaskMilestoneSummary {
  const path = join(planPath, filename);
  const content = maskNonRenderedMarkdown(readOptionalTextFile(path) ?? "");
  const modifiedAt = statOrNull(path)?.mtime.toISOString() ?? "";
  const progress = readTaskProgress(content);
  const outcomeTitle = readMarkdownField(content, /^#\s+(.+)$/mu, "");
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

function buildTaskPlanSummary(
  taskRoot: string,
  name: string,
  active: string | null,
): DashboardTaskPlanSummary {
  const planPath = join(taskRoot, name);
  const milestoneFilenames = listTaskMilestoneFilenames(planPath);
  const newestMilestoneTime = milestoneFilenames.reduce<number | null>(
    (newest, filename) => {
      const mtime = statOrNull(join(planPath, filename))?.mtime.getTime();
      if (mtime === undefined) return newest;
      return newest === null ? mtime : Math.max(newest, mtime);
    },
    null,
  );
  const planMtime = statOrNull(planPath)?.mtime.getTime() ?? 0;
  const modifiedAt = new Date(newestMilestoneTime ?? planMtime).toISOString();
  return {
    name,
    path: planPath,
    modifiedAt,
    milestoneCount: milestoneFilenames.length,
    active: active === name,
  };
}

/**
 * List top-level task plan directories while ignoring local dotfile markers.
 */
function listTaskPlanNames(taskRoot: string): string[] {
  return readdirSync(taskRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

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

function selectDashboardTaskPlan(
  requestedPlan: string | null,
  active: string | null,
  activeExists: boolean,
  plans: DashboardTaskPlanSummary[],
): string | null {
  const requestedExists = plans.some((plan) => plan.name === requestedPlan);
  if (requestedPlan && requestedExists) return requestedPlan;
  if (activeExists) return active;
  return plans[0]?.name ?? null;
}

/**
 * Build the Tasks view state: which plans exist for this project, and which one is currently active.
 *
 * A user opens Tasks expecting to resume the plan they were last working on, so the `.active` marker is read first and preferred.
 *
 * A project with no plans directory comes back as empty state rather than an error, because not having started a plan is a normal condition.
 *
 * @param projectPath - selected project whose plans are listed
 * @param requestedPlan - plan the user clicked; null falls back to the active marker, then to the first plan
 * @returns the state to render; an empty plan list means the Tasks view shows its onboarding empty state
 */
export function buildDashboardTaskState(
  projectPath: string,
  requestedPlan: string | null,
): DashboardTaskState {
  const planRoot = resolveLocalStatePath(projectPath, "plans");
  const planRootStats = statOrNull(planRoot);
  const active =
    readOptionalTextFile(join(planRoot, ".active"))?.trim() || null;
  if (!planRootStats?.isDirectory()) {
    return emptyDashboardTaskState(planRoot, active);
  }

  const planNames = listTaskPlanNames(planRoot);
  const plans = planNames
    .map((name) => buildTaskPlanSummary(planRoot, name, active))
    .sort((a, b) => {
      const byMtime =
        new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      return byMtime !== 0 ? byMtime : a.name.localeCompare(b.name);
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
    throw new Error("Request body must be valid JSON");
  }
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
 * Extract and validate the active task-plan name from the dashboard request body.
 * Throws when `body.plan` is missing, blank, or not a safe top-level plan name, so a malformed POST cannot select or escape into an unintended
 * directory.
 *
 * @param body - raw request body; must be JSON with a non-empty string `plan` field
 * @returns the trimmed, validated plan name guaranteed to be a single top-level directory segment
 */
export function readActiveTaskPlanBody(body: string): string {
  const parsed = parseJsonObjectBody(body);
  const plan = parsed["plan"];
  if (typeof plan !== "string" || plan.trim().length === 0) {
    throw new Error("body.plan must be a non-empty string");
  }
  const normalized = plan.trim();
  assertTopLevelPlanName(normalized);
  return normalized;
}

/**
 * Persist the selected plan by writing the `.active` marker, but only for a plan that already exists, so the dashboard can switch the active plan
 * without ever creating task structure.
 * Throws when the plans directory is absent or the requested plan does not exist.
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
  if (!planRootStats?.isDirectory()) {
    throw new Error(".goat-flow/plans does not exist for the selected project");
  }
  const planNames = listTaskPlanNames(planRoot);
  if (!planNames.includes(planName)) {
    throw new Error(`plan not found: ${planName}`);
  }
  writeFileSync(
    resolveLocalStatePath(projectPath, "plans/.active"),
    `${planName}\n`,
  );
}
