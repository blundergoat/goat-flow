/**
 * Dashboard /api/plans endpoint: parses the selected target's plans tree - directories, active
 * marker, milestones, and malformed-file fallbacks - rather than the controlling workspace, returns
 * an empty state when there is no plans directory, updates the active plan while preserving
 * stale active markers without treating them as selected, and rejects invalid plan updates.
 */
import {
  assert,
  describe,
  expectRecord,
  fetchJson,
  it,
  join,
  mkdtemp,
  readFile,
  readdir,
  rm,
  tmpdir,
  writeProjectFile,
} from "./dashboard-server.helpers.js";

const CURRENT_PLAN_MILESTONE_COUNT = 2;
const SIDE_MENU_TOTAL_TASKS = 2;

/**
 * Select an expected milestone from the endpoint payload without depending on directory iteration
 * order.
 *
 * @param milestones - milestone summaries returned by `/api/plans`
 * @param filename - exact milestone filename that identifies the record under test
 * @returns the matching milestone summary
 * @throws AssertionError when the expected milestone is absent
 */
function milestoneByFilename(
  milestones: Record<string, unknown>[],
  filename: string,
): Record<string, unknown> {
  const match = milestones.find((milestone) => milestone.filename === filename);
  assert.ok(match, `Expected milestone ${filename}`);
  return match;
}

describe("dashboard /api/plans", () => {
  it("parses plan directories, active marker, milestones, and malformed fallbacks", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-plans-"));
    try {
      await writeProjectFile(root, ".goat-flow/plans/.active", "current\n");
      await writeProjectFile(
        root,
        ".goat-flow/plans/current/Milestone-side-menu-navigation.md",
        [
          "# Side Menu Navigation",
          "",
          "**Status:** in-progress",
          "**Objective:** Build a desktop side menu.",
          "",
          "- [x] Done",
          "- [ ] Pending",
          "",
        ].join("\n"),
      );
      await writeProjectFile(
        root,
        ".goat-flow/plans/current/Milestone-malformed.md",
        "no heading or metadata\n- [ ] fallback task\n",
      );

      const { res, body } = await fetchJson(
        `/api/plans?path=${encodeURIComponent(root)}`,
      );
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Plans response");
      assert.equal(payload.planRoot, join(root, ".goat-flow", "plans"));
      assert.equal(payload.taskRoot, payload.planRoot);
      assert.equal(payload.exists, true);
      assert.equal(payload.active, "current");
      assert.equal(payload.activeExists, true);
      assert.equal(payload.selectedPlan, "current");
      assert.ok(Array.isArray(payload.plans));
      assert.ok(Array.isArray(payload.milestones));
      const plans = payload.plans as Record<string, unknown>[];
      assert.equal(plans[0]?.name, "current");
      assert.equal(plans[0]?.milestoneCount, CURRENT_PLAN_MILESTONE_COUNT);
      assert.equal(plans[0]?.active, true);

      const milestones = payload.milestones as Record<string, unknown>[];
      const sideMenuMilestone = milestoneByFilename(
        milestones,
        "Milestone-side-menu-navigation.md",
      );
      assert.equal(sideMenuMilestone.title, "Side Menu Navigation");
      assert.equal(sideMenuMilestone.status, "in-progress");
      assert.equal(sideMenuMilestone.objective, "Build a desktop side menu.");
      assert.equal(sideMenuMilestone.totalTasks, SIDE_MENU_TOTAL_TASKS);
      assert.equal(sideMenuMilestone.completedTasks, 1);

      const malformedMilestone = milestoneByFilename(
        milestones,
        "Milestone-malformed.md",
      );
      assert.equal(malformedMilestone.title, "Milestone-malformed.md");
      assert.equal(malformedMilestone.status, "unknown");
      assert.equal(malformedMilestone.objective, "");
      assert.equal(malformedMilestone.totalTasks, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads section objectives and limits canonical progress to Tasks", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-canonical-plans-"));
    try {
      await writeProjectFile(root, ".goat-flow/plans/.active", "current\n");
      await writeProjectFile(
        root,
        ".goat-flow/plans/current/M01-session-refresh.md",
        [
          "# M01: Users stay signed in after refresh",
          "",
          "**Status:** human-verification-pending",
          "",
          "   ## Objective ##",
          "A refreshed session survives reload.",
          "",
          "## Assumptions",
          "- [x] Session storage is atomic.",
          "",
          "   ## Tasks ##",
          "- [x] Persist the replacement token.",
          "- [ ] Reject the previous token.",
          "",
          "   ## Proof ##",
          "- [x] Refreshed session survives reload.",
          "- [ ] [human] Confirm the provider session.",
          "",
          "## Exit",
          "- [ ] Claims are green.",
          "",
        ].join("\n"),
      );
      await writeProjectFile(
        root,
        ".goat-flow/plans/current/M02-dashboard-summary.md",
        [
          "# M02: Dashboard summaries remain readable",
          "",
          "**Status:** not-started",
          "",
          "```markdown",
          "## Tasks",
          "- [x] Fenced example only.",
          "```",
          "<!--",
          "## Tasks",
          "- [x] Commented example only.",
          "-->",
          "",
          "## Tasks",
          "- [ ] Align the summary.",
          "",
        ].join("\n"),
      );

      const { res, body } = await fetchJson(
        `/api/plans?path=${encodeURIComponent(root)}`,
      );
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Plans response");
      const milestones = payload.milestones as Record<string, unknown>[];
      const sectionObjective = milestoneByFilename(
        milestones,
        "M01-session-refresh.md",
      );
      assert.equal(
        sectionObjective.objective,
        "A refreshed session survives reload.",
      );
      assert.equal(sectionObjective.status, "human-verification-pending");
      assert.equal(sectionObjective.totalTasks, 2);
      assert.equal(sectionObjective.completedTasks, 1);

      const titleFallback = milestoneByFilename(
        milestones,
        "M02-dashboard-summary.md",
      );
      assert.equal(
        titleFallback.objective,
        "Dashboard summaries remain readable",
      );
      assert.equal(titleFallback.totalTasks, 1);
      assert.equal(titleFallback.completedTasks, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves stale active markers without treating them as selected plans", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-stale-active-"));
    try {
      await writeProjectFile(root, ".goat-flow/plans/.active", "missing\n");
      await writeProjectFile(
        root,
        ".goat-flow/plans/current/Milestone-demo.md",
        "# Demo\n\n**Status:** planned\n- [ ] Pending\n",
      );

      const { res, body } = await fetchJson(
        `/api/plans?path=${encodeURIComponent(root)}`,
      );
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Plans response");
      assert.equal(payload.active, "missing");
      assert.equal(payload.activeExists, false);
      assert.equal(payload.selectedPlan, "current");
      const plans = payload.plans as Record<string, unknown>[];
      assert.equal(plans[0]?.active, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid active plan updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-active-invalid-"));
    try {
      await writeProjectFile(
        root,
        ".goat-flow/plans/one/Milestone-one.md",
        "# One\n\n**Status:** planned\n- [ ] Pending\n",
      );

      const traversal = await fetchJson(
        `/api/plans?path=${encodeURIComponent(root)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: "../one" }),
        },
      );
      assert.equal(traversal.res.status, 400);
      assert.match(
        String(expectRecord(traversal.body, "Traversal response").error),
        /top-level plan directory/,
      );

      const missing = await fetchJson(
        `/api/plans?path=${encodeURIComponent(root)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: "missing" }),
        },
      );
      assert.equal(missing.res.status, 404);
      assert.match(
        String(expectRecord(missing.body, "Missing plan response").error),
        /not found/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns an empty state when the selected project has no plans directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-no-plans-"));
    try {
      const { res, body } = await fetchJson(
        `/api/plans?path=${encodeURIComponent(root)}`,
      );
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Plans response");
      assert.equal(payload.exists, false);
      assert.equal(payload.active, null);
      assert.equal(payload.activeExists, false);
      assert.equal(payload.selectedPlan, null);
      assert.deepEqual(payload.plans, []);
      assert.deepEqual(payload.milestones, []);
      await assert.rejects(
        readFile(join(root, ".goat-flow", "plans", ".active")),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("updates the active plan for the selected project", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-active-plan-"));
    try {
      await writeProjectFile(root, ".goat-flow/plans/.active", "one\n");
      await writeProjectFile(
        root,
        ".goat-flow/plans/one/Milestone-one.md",
        "# One\n\n**Status:** planned\n- [ ] Pending\n",
      );
      await writeProjectFile(
        root,
        ".goat-flow/plans/two/Milestone-two.md",
        "# Two\n\n**Status:** planned\n- [ ] Pending\n",
      );

      const { res, body } = await fetchJson(
        `/api/plans?path=${encodeURIComponent(root)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: "two" }),
        },
      );
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Plans response");
      assert.equal(payload.active, "two");
      assert.equal(payload.activeExists, true);
      assert.equal(payload.selectedPlan, "two");
      const plans = payload.plans as Record<string, unknown>[];
      assert.equal(plans.find((plan) => plan.name === "two")?.active, true);
      assert.equal(
        await readFile(join(root, ".goat-flow", "plans", ".active"), "utf-8"),
        "two\n",
      );
      assert.deepEqual(
        (await readdir(join(root, ".goat-flow", "plans"))).filter(
          (name) => name.startsWith("..active.") && name.endsWith(".tmp"),
        ),
        [],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the selected target plans tree instead of the controlling workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-target-plans-"));
    try {
      await writeProjectFile(root, ".goat-flow/plans/.active", "target\n");
      await writeProjectFile(
        root,
        ".goat-flow/plans/target/Milestone-target.md",
        "# Target Plans\n\n**Status:** planned\n**Objective:** Target only.\n",
      );

      const { res, body } = await fetchJson(
        `/api/plans?path=${encodeURIComponent(root)}`,
      );
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Plans response");
      assert.equal(payload.planRoot, join(root, ".goat-flow", "plans"));
      assert.equal(payload.selectedPlan, "target");
      const milestones = payload.milestones as Record<string, unknown>[];
      assert.equal(milestones.length, 1);
      assert.equal(milestones[0]?.filename, "Milestone-target.md");
      assert.equal(
        milestones[0]?.path,
        join(root, ".goat-flow", "plans", "target", "Milestone-target.md"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the deprecated /api/tasks alias routed to plans", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-task-alias-"));
    try {
      await writeProjectFile(root, ".goat-flow/plans/.active", "current\n");
      await writeProjectFile(
        root,
        ".goat-flow/plans/current/Milestone-demo.md",
        "# Demo\n\n**Status:** planned\n- [ ] Pending\n",
      );

      const { res, body } = await fetchJson(
        `/api/tasks?path=${encodeURIComponent(root)}`,
      );
      assert.equal(res.status, 200);
      const payload = expectRecord(body, "Tasks alias response");
      assert.equal(payload.planRoot, join(root, ".goat-flow", "plans"));
      assert.equal(payload.taskRoot, payload.planRoot);
      assert.equal(payload.selectedPlan, "current");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
