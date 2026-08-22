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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { maskNonRenderedMarkdown } from "../rendered-markdown.js";
import { resolveLocalStatePath } from "./local-paths.js";
import { writeFileAtomic } from "./safe-exec.js";

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

/**
 * Describe a project that has no plans yet, which the Tasks view renders as its onboarding empty state.
 *
 * @param planRoot - where plans would live if the user started one
 * @param active - plan named by any leftover `.active` marker, kept so a stale marker is still visible
 * @returns the empty state; `exists: false` is what tells the view to offer onboarding rather than an error
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
  return plans[0]?.name ?? null;
}

/**
 * Build the Tasks view state: which plans exist for this project, and which one is currently active.
 *
 * A user opens Tasks expecting to resume the plan they were last working on, so the `.active` marker is read first
 * and preferred, and the preference order is a contract the view depends on.
 *
 * @param projectPath - selected project whose plans are listed
 * @param requestedPlan - plan the user clicked; null falls back to the active marker, then to the first plan found
 * @returns the state to render; an empty plan list means the Tasks view shows its onboarding empty state, because a
 *   project with no plans directory is a normal condition rather than an error
 */
export function buildDashboardTaskState(
  projectPath: string,
  requestedPlan: string | null,
): DashboardTaskState {
  const planRoot = resolveLocalStatePath(projectPath, "plans");
  const planRootStats = statOrNull(planRoot);
  const active =
    readOptionalTextFile(join(planRoot, ".active"))?.trim() || null;
  // No plans directory at all, so the user has never started a plan here and sees the onboarding state.
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
 * Writes the `.active` marker so the dashboard can switch plans, but only for a plan that already exists, which keeps this route from ever
 * creating task structure on a user's behalf.
 * It throws when the plans directory is absent or the requested plan does not exist.
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
  // A marker pointing at a missing plan would leave the Tasks view stuck on nothing, so the write is refused.
  if (!planNames.includes(planName)) {
    throw new Error(`plan not found: ${planName}`);
  }
  writeFileAtomic(
    resolveLocalStatePath(projectPath, "plans/.active"),
    `${planName}\n`,
    projectPath,
  );
}
