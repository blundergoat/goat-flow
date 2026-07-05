/**
 * Load server-backed dashboard state into Alpine fragments.
 * Use when the user changes project, runner, hook filters, plans, setup prompts, or quality views.
 * These helpers keep stale responses from overwriting the screen after the user switches context.
 * Empty or failed responses recover into visible empty states, banners, or toasts instead of
 * breaking the dashboard app.
 */

/**
 * Confirm a hook toggle before disabling a guarded safety surface.
 * Use when the user clicks a hook switch that would remove protection.
 *
 * @param hook - hook row being toggled; missing confirm metadata means no dialog is required
 * @param shouldEnable - next desired state; `false` means the user may be removing protection
 * @returns whether the toggle may continue; `false` means the hook row stays unchanged
 */
function dashboardConfirmHookToggle(
  hook: HookState,
  shouldEnable: boolean,
): boolean {
  // Enabling is always safe to proceed, and hooks without confirm prompts do not interrupt the user.
  if (shouldEnable || !hook.requiresConfirmDialog) return true;
  return window.confirm(
    `Disabling ${hook.name} removes the guardrail. Continue?`,
  );
}

/**
 * Replace one hook row after the server accepts a toggle.
 * Use so the Hooks table reflects the saved guardrail state immediately.
 *
 * @param ctx - dashboard state to update; missing hook rows leave the table unchanged
 * @param hook - saved hook row returned by the server; empty agent state still renders as unavailable
 * @param shouldEnable - requested state used for toast copy; `false` tells the user it was disabled
 * @returns nothing; visible hook state and toast update in place
 */
function dashboardApplyHookToggleResult(
  ctx: DashboardAppContext,
  hook: HookState,
  shouldEnable: boolean,
): void {
  // Replace only the toggled row so other hook rows keep their current UI state.
  ctx.hooksState = ctx.hooksState.map((item: HookState) =>
    item.id === hook.id ? hook : item,
  );
  ctx.showToast(`${hook.name} ${shouldEnable ? "enabled" : "disabled"}`);
}

/**
 * Persist one hook toggle.
 * Use when the user enables, disables, or resyncs a guardrail row in the Hooks view.
 *
 * @param ctx - dashboard state; missing current project means stale responses are ignored
 * @param hook - hook row being saved; non-togglable hooks leave the row unchanged
 * @param shouldEnable - desired hook state; `false` may require user confirmation
 * @returns nothing; failures show in the Hooks banner/toast and keep rows visible
 */
async function dashboardToggleHookState(
  ctx: DashboardAppContext,
  hook: HookState,
  shouldEnable: boolean,
): Promise<void> {
  // Non-togglable hooks or an active save mean the user cannot start another change yet.
  if (!hook.togglable || ctx.hookSavingId) return;
  // Cancelled confirmation leaves the guardrail row unchanged.
  if (!dashboardConfirmHookToggle(hook, shouldEnable)) return;
  ctx.hookSavingId = hook.id;
  ctx.hooksError = "";
  const requestProjectPath = ctx.projectPath;
  try {
    const res = await dashboardFetch(
      `/api/hooks/${encodeURIComponent(hook.id)}/toggle?path=${encodeURIComponent(requestProjectPath)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: shouldEnable }),
      },
    );
    const payload = readRecord(await res.json(), "Hook toggle response");
    const error = readErrorMessage(payload);
    // Server-side hook failures are shown as user-facing save errors.
    if (error) throw new Error(error);
    // The user switched projects while saving, so this response belongs to an old screen.
    if (ctx.projectPath !== requestProjectPath) return;
    dashboardApplyHookToggleResult(
      ctx,
      payload.hook as HookState,
      shouldEnable,
    );
  } catch (err) {
    // The user switched projects while the save failed, so do not toast over the new screen.
    if (ctx.projectPath !== requestProjectPath) return;
    ctx.hooksError = err instanceof Error ? err.message : String(err);
    ctx.showToast(ctx.hooksError || "Hook update failed", true);
  } finally {
    // Clear the saving spinner only for the hook row that started this request.
    if (ctx.hookSavingId === hook.id) ctx.hookSavingId = null;
  }
}

/**
 * Check whether a quality response still belongs to the visible project and runner.
 * Use before applying async quality data that may race with user navigation.
 *
 * @param ctx - dashboard state at response time; missing project/runner mismatch means stale data
 * @param projectPath - project path captured when the request started; empty never matches a real project
 * @param runner - runner captured when the request started; empty would not match a supported runner
 * @returns whether the response may update the screen
 */
function dashboardIsCurrentQualityRequest(
  ctx: DashboardAppContext,
  projectPath: string,
  runner: RunnerId,
): boolean {
  return ctx.projectPath === projectPath && ctx.activeRunner === runner;
}

/**
 * Load the Home page's latest quality-history summary.
 * Use so the Home dashboard can show the most recent agent-setup review for the selected runner.
 *
 * @param ctx - dashboard state to update; stale project/runner responses are ignored
 * @returns nothing; missing history leaves the Home quality summary empty
 */
async function dashboardGenerateHomeQualitySummary(
  ctx: DashboardAppContext,
): Promise<void> {
  ctx.homeQualityLoading = true;
  ctx.homeQualityLatest = null;
  const requestProjectPath = ctx.projectPath;
  const requestAgent = ctx.activeRunner;
  try {
    const res = await dashboardFetch(
      `/api/quality/history?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestAgent)}&mode=agent-setup&limit=1`,
    );
    const payload = readRecord(await res.json(), "Home quality response");
    // The user switched project or runner before the quality summary returned.
    if (
      !dashboardIsCurrentQualityRequest(ctx, requestProjectPath, requestAgent)
    )
      return;
    const error = readErrorMessage(payload);
    // Endpoint errors appear as toasts instead of replacing the Home summary.
    if (error) {
      ctx.showToast(error, true);
    } else {
      ctx.homeQualityLatest = readQualityHistoryLatest(payload.latest);
    }
  } catch (err) {
    // Late failures for another project/runner should not interrupt the current Home view.
    if (
      !dashboardIsCurrentQualityRequest(ctx, requestProjectPath, requestAgent)
    )
      return;
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Home quality loading failed", true);
  }
  // Only the request still matching the visible Home view may clear the loading state.
  if (dashboardIsCurrentQualityRequest(ctx, requestProjectPath, requestAgent)) {
    ctx.homeQualityLoading = false;
  }
}

/**
 * Read skill artifacts from the inventory payload.
 * Use after `/api/skill-quality/inventory` returns so the Skills tab only lists usable skill rows.
 *
 * @param payload - raw inventory response; missing `artifacts` means the Skills tab shows an empty list
 * @returns valid skill artifacts; empty array means no skill reports are available to select
 */
function dashboardReadSkillQualityArtifacts(
  payload: JsonRecord,
): SkillQualityArtifact[] {
  // Missing or non-array artifacts mean there are no selectable skills in this response.
  return Array.isArray(payload.artifacts)
    ? payload.artifacts.filter(
        // Keep only complete skill rows so the UI never renders broken chips.
        (artifact): artifact is SkillQualityArtifact =>
          isRecord(artifact) &&
          artifact.kind === "skill" &&
          typeof artifact.id === "string" &&
          typeof artifact.name === "string" &&
          typeof artifact.path === "string" &&
          typeof artifact.source === "string",
      )
    : [];
}

/**
 * Clear the selected skill report when refreshed inventory no longer contains it.
 * Use after a re-audit so the details pane does not show a report for a removed skill.
 *
 * @param ctx - dashboard state; missing selection means there is nothing to prune
 * @returns nothing; removed selections return the details pane to empty state
 */
function dashboardPruneMissingSkillQualitySelection(
  ctx: DashboardAppContext,
): void {
  // No skill is selected, so the details pane is already empty.
  if (!ctx.skillQualitySelectedId) return;
  const stillExists = ctx.skillQualityArtifacts.some(
    (artifact: SkillQualityArtifact) =>
      artifact.id === ctx.skillQualitySelectedId,
  );
  // The selected skill still exists, so the user can keep viewing its report.
  if (stillExists) return;
  ctx.skillQualitySelectedId = null;
  ctx.skillQualityReport = null;
}

/**
 * Check whether a skill-inventory response still belongs to the visible request.
 * Use before applying prefetch/inventory data after the user may have switched context.
 *
 * @param ctx - dashboard state at response time; mismatched project, runner, or generation is stale
 * @param projectPath - project captured when the request started; empty never matches a real selection
 * @param runner - runner captured when the request started; empty cannot match a supported runner tab
 * @param generation - prefetch generation captured at request start; zero/old values are stale
 * @returns whether the response may update the Skills tab
 */
function dashboardIsCurrentSkillInventoryRequest(
  ctx: DashboardAppContext,
  projectPath: string,
  runner: RunnerId,
  generation: number,
): boolean {
  return (
    ctx.projectPath === projectPath &&
    ctx.activeRunner === runner &&
    ctx.skillQualityPrefetchGeneration === generation
  );
}

/**
 * Load skill-quality inventory for the selected project and runner.
 * Use when the Skills tab opens or re-audits so selectable skill rows and cached reports reset together.
 *
 * @param ctx - dashboard state to update; stale project/runner/generation responses are ignored
 * @returns nothing; endpoint failures show a toast and preserve the current view where possible
 */
async function dashboardLoadSkillQualityInventory(
  ctx: DashboardAppContext,
): Promise<void> {
  const requestProjectPath = ctx.projectPath;
  const requestRunner = ctx.activeRunner;
  const requestGeneration = Number(ctx.skillQualityPrefetchGeneration) + 1;
  ctx.skillQualityPrefetchGeneration = requestGeneration;
  ctx.skillQualityPrefetching = false;
  try {
    const res = await dashboardFetch(
      `/api/skill-quality/inventory?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestRunner)}`,
    );
    const payload = readRecord(await res.json(), "Skill quality inventory");
    // The user switched context before inventory returned, so do not replace the visible Skills tab.
    if (
      !dashboardIsCurrentSkillInventoryRequest(
        ctx,
        requestProjectPath,
        requestRunner,
        requestGeneration,
      )
    ) {
      return;
    }
    const error = readErrorMessage(payload);
    // Inventory endpoint errors are shown but do not crash the Skills tab.
    if (error) {
      ctx.showToast(error, true);
      return;
    }
    ctx.skillQualityArtifacts = dashboardReadSkillQualityArtifacts(payload);
    dashboardPruneMissingSkillQualitySelection(ctx);
    ctx.skillQualityReports = {};
    ctx.skillQualityAuditedAt = null;
    ctx.skillQualityPrefetching = false;
    void ctx.prefetchSkillReports(
      requestProjectPath,
      requestRunner,
      requestGeneration,
    );
  } catch (err) {
    // Late failures from an older project/runner should not toast over the current view.
    if (
      !dashboardIsCurrentSkillInventoryRequest(
        ctx,
        requestProjectPath,
        requestRunner,
        requestGeneration,
      )
    ) {
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Skill quality inventory failed", true);
  }
}

/**
 * Fetch one skill-quality report during sidebar prefetch.
 * Use so the Skills list can show grades before the user opens each artifact.
 *
 * @param ctx - dashboard state to update; stale responses are ignored
 * @param art - skill artifact to prefetch; missing ids would leave no cache key
 * @param projectPath - project captured when the prefetch started; empty means stale/no-op
 * @param runner - runner captured when the prefetch started; empty means stale/no-op
 * @param generation - prefetch generation captured at request start; old values are ignored
 * @returns nothing; per-artifact failures leave that skill without a cached grade
 */
async function dashboardPrefetchOneSkillReport(
  ctx: DashboardAppContext,
  art: SkillQualityArtifact,
  projectPath: string,
  runner: string,
  generation: number,
): Promise<void> {
  try {
    const res = await dashboardFetch(
      `/api/skill-quality?path=${encodeURIComponent(projectPath)}&agent=${encodeURIComponent(runner)}&artifact=${encodeURIComponent(art.id)}`,
    );
    const payload = readRecord(await res.json(), "Skill quality report");
    // One failed report should not hide the rest of the Skills list.
    if (readErrorMessage(payload)) return;
    // The user switched project/runner or started a newer prefetch batch.
    if (
      ctx.projectPath !== projectPath ||
      ctx.activeRunner !== runner ||
      ctx.skillQualityPrefetchGeneration !== generation
    ) {
      return;
    }
    // Same-origin report payload feeds the grade cache for the matching skill row.
    ctx.skillQualityReports[art.id] = payload;
  } catch {
    // Best-effort sidebar grades: one failed artifact falls back to no cached grade.
    return;
  }
}

/**
 * Finalize a matching skill-report prefetch batch.
 * Use after parallel report loads so the Skills tab can stamp freshness and select a default report.
 *
 * @param ctx - dashboard state to update; stale project/runner/generation batches are ignored
 * @param projectPath - project captured when prefetch started; empty means stale/no-op
 * @param runner - runner captured when prefetch started; empty means stale/no-op
 * @param generation - prefetch generation captured at request start; old values are ignored
 * @returns nothing; empty inventories leave no report selected
 */
function dashboardCompleteSkillReportPrefetch(
  ctx: DashboardAppContext,
  projectPath: string,
  runner: string,
  generation: number,
): void {
  // Stale batches cannot update freshness or selection for the visible Skills tab.
  if (
    ctx.projectPath !== projectPath ||
    ctx.activeRunner !== runner ||
    ctx.skillQualityPrefetchGeneration !== generation
  ) {
    return;
  }
  ctx.skillQualityAuditedAt = Date.now();
  ctx.skillQualityPrefetching = false;
  // If the user has not chosen a skill yet, open the first available report.
  if (!ctx.skillQualitySelectedId && ctx.skillQualityArtifacts.length > 0) {
    const first = ctx.skillQualityArtifacts[0];
    // A defensive empty slot leaves the details pane unselected.
    if (first) void ctx.loadSkillQualityReport(first.id);
  }
}

/**
 * Prefetch reports for every skill artifact in the visible inventory.
 * Use so the Skills sidebar can show grades without requiring one click per skill.
 *
 * @param ctx - dashboard state to update; stale responses are ignored by the prefetch helpers
 * @param projectPath - project captured when prefetch started; empty means stale/no-op
 * @param runner - runner captured when prefetch started; empty means stale/no-op
 * @param generation - prefetch generation captured at request start; old values are ignored
 * @returns nothing; empty inventories leave the sidebar without prefetched grades
 */
async function dashboardPrefetchSkillReports(
  ctx: DashboardAppContext,
  projectPath: string,
  runner: string,
  generation: number,
): Promise<void> {
  const artifacts = [...ctx.skillQualityArtifacts];
  // No skills were discovered, so there is nothing for the sidebar to prefetch.
  if (artifacts.length === 0) return;
  ctx.skillQualityPrefetching = true;
  await Promise.all(
    // Each skill report loads independently so one bad artifact does not block the list.
    artifacts.map((art) =>
      dashboardPrefetchOneSkillReport(
        ctx,
        art,
        projectPath,
        runner,
        generation,
      ),
    ),
  );
  dashboardCompleteSkillReportPrefetch(ctx, projectPath, runner, generation);
}

/**
 * Build the agent-detection / plans / hooks fragment of the app's async data-loading methods.
 * One input to dashboardMergeAppFragments; the methods delegate to shared helpers that own the
 * fetch and its recover-on-failure handling, so this fragment only wires names to those helpers.
 *
 * @param supportedAgents - agents the server can launch, used to scope installed-agent detection
 * @returns the fragment object of agent/plans/hooks loader methods merged into the Alpine app
 */
function dashboardAgentPlanHookLoadersFragment(
  supportedAgents: SupportedAgent[],
): DashboardAppFragment {
  return {
    /**
     * Refresh installed-agent detection for launcher defaults.
     * Use when the dashboard opens so runner selectors only prefer agents available on this machine.
     *
     * @returns whether detection succeeded; `false` means the UI keeps fallback runner state
     */
    async fetchInstalledAgents(): Promise<boolean> {
      try {
        const res = await dashboardFetch("/api/agents/installed");
        // A failed endpoint leaves the dashboard on its current runner defaults.
        if (!res.ok) return false;
        const payload = readRecord(
          await res.json(),
          "Agent detection response",
        );
        const agents: AgentInfo[] = Array.isArray(payload.agents)
          ? payload.agents
              .map((agent: unknown) => readAgentInfo(agent))
              .filter((agent): agent is AgentInfo => agent !== null)
          : [];
        // Empty supported-agent state means the server response becomes the initial launcher list.
        if (this.supportedAgents.length === 0) this.supportedAgents = agents;
        this.allAgents = agents;
        this.installedAgents = agents.filter((agent) => agent.installed);
        this.agentsLoaded = true;
        // If the active runner is not installed, switch to the first installed choice the user can launch.
        if (
          this.installedAgents.length > 0 &&
          !this.installedAgents.find(
            (agent: AgentInfo) => agent.id === this.activeRunner,
          )
        ) {
          const [firstInstalled] = this.installedAgents;
          // Defensive empty array handling keeps the prior runner if detection races.
          if (firstInstalled) this.activeRunner = firstInstalled.id;
        }
        return true;
      } catch {
        // Detection failures are recoverable; the UI can still show configured runners.
        return false;
      }
    },

    /**
     * Open the project browser at the current workspace path.
     * Use when the user wants to pick a project folder from the dashboard.
     *
     * @returns nothing; browser state updates through the shared helper
     */
    async openBrowser() {
      await dashboardOpenBrowser(this);
    },

    /**
     * Load child directories for a browser path.
     * Use when the user drills into a folder in the project picker.
     *
     * @param path - folder path to browse; empty means the helper falls back to its current browser path
     * @returns nothing; errors are shown by the browser helper
     */
    async browseTo(path: string) {
      await dashboardBrowseTo(this, path);
    },

    /**
     * Set a browsed directory as the active project.
     * Use when the user chooses a folder from the project browser.
     *
     * @param dir - browsed directory row; missing paths would leave the selected project unchanged
     * @returns nothing; project selection updates through the shared helper
     */
    selectDir(dir: BrowseDir) {
      dashboardSelectDir(this, dir);
    },

    /**
     * Load plan state for the selected project.
     * Use when the Task Plan panel opens or the user switches plans.
     *
     * @param planName - optional plan to load; absent means use the currently selected plan
     * @returns nothing; errors show in the plan panel and stale responses are ignored
     */
    async loadTasks(planName?: string) {
      this.tasksLoading = true;
      this.tasksError = "";
      const requestProjectPath = this.projectPath;
      const requestedPlan = planName ?? this.selectedTaskPlan;
      const planParam = requestedPlan
        ? `&plan=${encodeURIComponent(requestedPlan)}`
        : "";
      try {
        const res = await dashboardFetch(
          `/api/plans?path=${encodeURIComponent(requestProjectPath)}${planParam}`,
        );
        const payload = readRecord(await res.json(), "Tasks response");
        const error = readErrorMessage(payload);
        // Endpoint errors should show in the plan panel rather than replacing task state silently.
        if (error) throw new Error(error);
        // The user switched projects before tasks returned, so leave the new project alone.
        if (this.projectPath !== requestProjectPath) return;
        const state = readTaskState(payload);
        this.tasksState = state;
        this.selectedTaskPlan = state.selectedPlan;
      } catch (err) {
        // Late errors for another project should not overwrite the current plan panel.
        if (this.projectPath !== requestProjectPath) return;
        this.tasksState = null;
        this.tasksError = err instanceof Error ? err.message : String(err);
      } finally {
        // Only the matching request may clear the plan-panel loading spinner.
        if (this.projectPath === requestProjectPath) this.tasksLoading = false;
      }
    },

    /**
     * Select a task plan and reload its milestones.
     * Use when the user chooses a different plan from the plan picker.
     *
     * @param planName - plan directory name; empty means the next load falls back to current/default plan
     * @returns nothing; loading runs asynchronously
     */
    selectTaskPlan(planName: string) {
      this.selectedTaskPlan = planName;
      void this.loadTasks(planName);
    },

    /**
     * Persist the active task plan for the selected project.
     * Use when the user pins a plan as the dashboard's current task context.
     *
     * @param planName - plan to activate; empty means no save is attempted
     * @returns nothing; endpoint errors stay visible in the plan panel
     */
    async setActiveTaskPlan(planName: string) {
      // Empty names or an active save should not start another plan activation.
      if (!planName || this.tasksActivePlanSaving) return;
      this.tasksActivePlanSaving = planName;
      this.tasksError = "";
      const requestProjectPath = this.projectPath;
      try {
        const res = await dashboardFetch(
          `/api/plans?path=${encodeURIComponent(requestProjectPath)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plan: planName }),
          },
        );
        const payload = readRecord(await res.json(), "Tasks response");
        const error = readErrorMessage(payload);
        // Save failures are shown in the plan panel and toast.
        if (error) throw new Error(error);
        // The user switched projects before the save returned, so do not overwrite the new panel.
        if (this.projectPath !== requestProjectPath) return;
        const state = readTaskState(payload);
        this.tasksState = state;
        this.selectedTaskPlan = state.selectedPlan;
        this.showToast(`Active plan set to ${planName}`);
      } catch (err) {
        // Late errors for another project should not interrupt the current plan panel.
        if (this.projectPath !== requestProjectPath) return;
        this.tasksError = err instanceof Error ? err.message : String(err);
        this.showToast(this.tasksError || "Active plan update failed", true);
      } finally {
        // Clear the saving state only for the matching project and plan button.
        if (
          this.projectPath === requestProjectPath &&
          this.tasksActivePlanSaving === planName
        ) {
          this.tasksActivePlanSaving = null;
        }
      }
    },

    /**
     * Format completed and total task counts for one milestone row.
     * Use in the task-plan table so users can scan progress at a glance.
     *
     * @param milestone - milestone summary; zero totals show `0/0` for an empty plan section
     * @returns compact completed/total label for the row
     */
    taskProgressLabel(milestone: TaskMilestoneSummary): string {
      return `${milestone.completedTasks}/${milestone.totalTasks}`;
    },

    /**
     * Convert milestone checkbox progress to a progress-bar percentage.
     * Use in the task-plan table beside the completed/total label.
     *
     * @param milestone - milestone summary; zero total tasks means the bar stays empty
     * @returns integer progress percent; zero means no visible task progress
     */
    taskProgressPct(milestone: TaskMilestoneSummary): number {
      // Empty milestones keep the progress bar at zero instead of dividing by zero.
      if (milestone.totalTasks <= 0) return 0;
      return Math.round(
        (milestone.completedTasks / milestone.totalTasks) * 100,
      );
    },

    /**
     * Format a milestone modified timestamp for the plan table.
     * Use so users can tell whether task files changed recently.
     *
     * @param value - timestamp string; empty or invalid values display as unknown
     * @returns localized timestamp label, or `unknown` when the date cannot be trusted
     */
    taskModifiedLabel(value: string): string {
      // Empty timestamps mean the plan reader could not prove when the file changed.
      if (!value) return "unknown";
      const date = new Date(value);
      // Invalid timestamps are hidden behind a neutral label instead of showing `Invalid Date`.
      if (Number.isNaN(date.getTime())) return "unknown";
      return date.toLocaleString();
    },

    /**
     * Load hook state for the selected project.
     * Use when the Hooks panel opens or the project changes.
     *
     * @returns nothing; errors show in the Hooks banner and stale responses are ignored
     */
    async loadHooks() {
      this.hooksLoading = true;
      this.hooksError = "";
      const requestProjectPath = this.projectPath;
      try {
        const res = await dashboardFetch(
          `/api/hooks?path=${encodeURIComponent(requestProjectPath)}`,
        );
        const payload = readRecord(await res.json(), "Hooks response");
        const error = readErrorMessage(payload);
        // Hook endpoint errors should keep the user in the Hooks panel with a visible banner.
        if (error) throw new Error(error);
        // The user switched projects before hooks returned, so leave the new rows alone.
        if (this.projectPath !== requestProjectPath) return;
        this.hooksState = Array.isArray(payload.hooks)
          ? (payload.hooks as HookState[])
          : [];
      } catch (err) {
        // Late hook errors for another project should not replace the visible rows.
        if (this.projectPath !== requestProjectPath) return;
        this.hooksState = [];
        this.hooksError = err instanceof Error ? err.message : String(err);
      } finally {
        // Only the matching request may clear the Hooks loading spinner.
        if (this.projectPath === requestProjectPath) this.hooksLoading = false;
      }
    },
  };
}

/**
 * Build hook actions plus setup-prompt actions for the dashboard.
 * Use when composing the app so hook tables, filters, and setup buttons share one state object.
 *
 * @param supportedAgents - agents the server can launch; empty means hook rows show unavailable surfaces
 * @returns dashboard fragment; empty methods are never returned because Hooks and Setup views need all handlers
 */
function dashboardHookSetupActionsFragment(
  supportedAgents: SupportedAgent[],
): DashboardAppFragment {
  return {
    /**
     * Return hook state rows for every supported agent.
     * Use in the hook table so missing agent payloads still show as unavailable rows.
     *
     * @param hook - hook row from the server; empty agent map shows every supported agent as unavailable
     * @returns per-agent hook rows; empty array means there are no supported agents to display
     */
    hookAgents(hook: HookState): Array<[RunnerId, HookAgentState]> {
      return this.supportedAgents.map((agent) => [
        agent.id,
        hook.agents[agent.id] ?? {
          supported: false,
          installed: false,
          scriptPath: null,
          configPath: null,
          reason: "Agent state unavailable.",
        },
      ]);
    },

    /**
     * Group a hook into the dashboard section that owns its risk surface.
     * Use so users can scan safety hooks separately from quality hooks.
     *
     * @param hook - hook row to classify; unknown ids fall back to the safety section
     * @returns hook section used for grouping and counts
     */
    hookSectionFor(hook: HookState): HookSection {
      // Gruff owns quality feedback, so it appears with quality tooling instead of safety guards.
      if (hook.id === "gruff-code-quality") return "quality";
      return "safety";
    },

    /**
     * Choose the visual tone for a hook section.
     * Use to color hook cards by the kind of user risk they represent.
     *
     * @param hook - hook row to style; unknown sections fall back to the strongest safety tone
     * @returns hook tone class name used by the dashboard
     */
    hookTone(hook: HookState): HookTone {
      const section = this.hookSectionFor(hook);
      // Workflow hooks are informational process aids.
      if (section === "workflow") return "workflow";
      // Git hooks can block risky repository operations, so use warning tone.
      if (section === "git") return "warning";
      // Quality hooks produce review feedback, so they use a neutral tone.
      if (section === "quality") return "neutral";
      return "danger";
    },

    /**
     * Detect whether any agent surface differs from the desired hook state.
     * Use to show drift badges and the resync action.
     *
     * @param hook - hook row to inspect; empty agent map means no drift is visible
     * @returns whether at least one agent surface needs resync
     */
    hookHasDrift(hook: HookState): boolean {
      return Object.values(hook.agents).some((state) => Boolean(state.drift));
    },

    /**
     * Count agent surfaces where a hook is installed.
     * Use for Hooks overview counts and row summaries.
     *
     * @param hook - hook row to count; empty agent map returns zero installed surfaces
     * @returns installed surface count shown in the Hooks view
     */
    hookInstalledSurfaceCount(hook: HookState): number {
      return this.hookAgents(hook).filter(
        ([, state]: [RunnerId, HookAgentState]) => state.installed,
      ).length;
    },

    /**
     * List unsupported agent surfaces that explain why a hook is unavailable.
     * Use so the hook row can disclose unsupported runners instead of looking broken.
     *
     * @param hook - hook row to inspect; empty agent map returns unavailable rows from supported agents
     * @returns unsupported rows with reasons; empty array means no disclosure is needed
     */
    unsupportedHookAgents(hook: HookState): Array<[RunnerId, HookAgentState]> {
      return this.hookAgents(hook).filter(
        ([, state]: [RunnerId, HookAgentState]) =>
          !state.supported && Boolean(state.reason),
      );
    },

    /**
     * Count hooks whose desired dashboard state is enabled.
     * Use for the enabled filter chip and Hooks overview summary.
     *
     * @returns enabled hook count; zero means every hook is desired off
     */
    hooksEnabledCount(): number {
      return this.hooksState.filter((hook: HookState) => hook.enabled).length;
    },

    /**
     * Count hooks with at least one agent surface in drift.
     * Use for the drift filter chip and overview warning.
     *
     * @returns drifted hook count; zero means desired and installed states match
     */
    hooksDriftCount(): number {
      return this.hooksState.filter((hook: HookState) =>
        this.hookHasDrift(hook),
      ).length;
    },

    /**
     * Count installed hook surfaces across all hooks and agents.
     * Use for the Hooks overview so users see total installed coverage.
     *
     * @returns installed surface count; zero means no hook is installed on any visible agent
     */
    hooksInstalledSurfaceCount(): number {
      return this.hooksState.reduce(
        (total: number, hook: HookState) =>
          total + Number(this.hookInstalledSurfaceCount(hook)),
        0,
      );
    },

    /**
     * Test one hook against a selected filter chip.
     * Use before search so the Hooks list reflects enabled/disabled/drift tabs.
     *
     * @param hook - hook row to test; missing states fall back to the all filter behavior
     * @param filter - selected filter chip; unknown values show the hook
     * @returns whether the hook should stay visible for that filter
     */
    hookMatchesFilter(hook: HookState, filter: HookFilter): boolean {
      // Enabled filter shows only hooks the user wants active.
      if (filter === "enabled") return hook.enabled;
      // Disabled filter shows hooks the user has turned off.
      if (filter === "disabled") return !hook.enabled;
      // Drift filter shows hooks whose installed state needs repair.
      if (filter === "drift") return this.hookHasDrift(hook);
      return true;
    },

    /**
     * Count hooks that would appear under one filter chip.
     * Use for filter badges in the Hooks view.
     *
     * @param filter - hook filter to count; unknown values count all hooks
     * @returns matching hook count; zero means that filter has no rows
     */
    hookFilterCount(filter: HookFilter): number {
      return this.hooksState.filter((hook: HookState) =>
        this.hookMatchesFilter(hook, filter),
      ).length;
    },

    /**
     * Return hooks matching the selected filter and search query.
     * Use to drive the visible Hooks table rows.
     *
     * @returns filtered hook rows; empty array means the table shows its no-results state
     */
    filteredHooks(): HookState[] {
      const query = this.hooksSearch.trim().toLowerCase();
      return this.hooksState.filter((hook: HookState) => {
        // Filter-chip mismatches are hidden before search text is applied.
        if (!this.hookMatchesFilter(hook, this.hooksFilter)) return false;
        // Empty search text means every hook matching the chip remains visible.
        if (!query) return true;
        return [hook.name, hook.id, hook.description].some((value: string) =>
          value.toLowerCase().includes(query),
        );
      });
    },

    /**
     * Return filtered hooks that belong to one dashboard section.
     * Use to render sectioned hook groups after filtering and search.
     *
     * @param section - section to render; empty/unknown sections return no matching rows
     * @returns visible hooks for that section
     */
    hooksForSection(section: HookSection): HookState[] {
      return this.filteredHooks().filter(
        (hook: HookState) => this.hookSectionFor(hook) === section,
      );
    },

    /**
     * Count filtered hooks in one dashboard section.
     * Use for section headers in the Hooks view.
     *
     * @param section - section to count; empty/unknown sections return zero
     * @returns visible hook count for that section
     */
    hookSectionCount(section: HookSection): number {
      return this.hooksForSection(section).length;
    },

    /**
     * Format one agent hook state for the hook table.
     * Use so users see installed, missing, drifted, or unsupported states in plain language.
     *
     * @param state - hook state for one agent; unsupported states ignore drift/install details
     * @returns status label; `not installed` means the hook is supported but absent
     */
    hookAgentStatusLabel(state: HookAgentState): string {
      // Unsupported agents need a neutral label because the user cannot install this hook there.
      if (!state.supported) return "unsupported";
      // Desired-on drift means protection is expected but missing.
      if (state.drift === "desired-on-actual-off") return "drift: missing";
      // Desired-off drift means a hook remains installed after the user disabled it.
      if (state.drift === "desired-off-actual-on") return "drift: installed";
      return state.installed ? "installed" : "not installed";
    },

    /**
     * Choose the CSS status class for one agent hook state.
     * Use so hook rows visually separate supported, installed, missing, and drift states.
     *
     * @param state - hook state for one agent; unsupported states render muted
     * @returns CSS class for the hook status pill
     */
    hookAgentStatusClass(state: HookAgentState): string {
      // Unsupported agents are muted because the user cannot act on them here.
      if (!state.supported) return "gf-hook-status-muted";
      // Drift needs warning styling so the resync action is visible.
      if (state.drift) return "gf-hook-status-warn";
      return state.installed ? "gf-hook-status-ok" : "gf-hook-status-muted";
    },

    /**
     * Persist one hook toggle from the Hooks table.
     * Use when the user flips a guardrail switch.
     *
     * @param hook - hook row being toggled; non-togglable hooks are ignored by the shared helper
     * @param shouldEnable - desired enabled state; `false` may prompt for confirmation
     * @returns nothing; failures remain visible in the Hooks panel
     */
    async toggleHook(hook: HookState, shouldEnable: boolean) {
      await dashboardToggleHookState(this, hook, shouldEnable);
    },

    /**
     * Reapply a hook's desired state to repair installed drift.
     * Use when the user clicks resync on a drifted hook row.
     *
     * @param hook - drifted hook row; empty agent state still resyncs desired state through the server
     * @returns nothing; the shared toggle path updates rows and errors
     */
    async resyncHook(hook: HookState) {
      await this.toggleHook(hook, hook.enabled);
    },

    /**
     * Detect the selected project's stack.
     * Use so setup prompts can include project-specific toolchain context.
     *
     * @returns nothing; detection state updates through the shared helper
     */
    async detectStack() {
      await dashboardDetectStack(this);
    },

    /**
     * Generate setup output for the active setup-view agent.
     * Use when the user asks the dashboard to prepare agent setup instructions.
     *
     * @param shouldForce - when true, regenerate even if cached setup output exists
     * @returns nothing; setup prompt state updates through the shared helper
     */
    async generateSetupPrompt(shouldForce = false) {
      await dashboardGenerateSetupPrompt(this, { force: shouldForce });
    },

    /**
     * Generate setup output for a specific target agent.
     * Use when an agent card asks for setup instructions for that runner.
     *
     * @param targetAgent - runner id the user is setting up; empty would fail in the shared helper
     * @param shouldForce - when true, regenerate even if cached setup output exists
     * @returns setup-generation result from the shared helper
     */
    async generateSetupPromptForAgent(
      targetAgent: RunnerId,
      shouldForce = false,
    ) {
      return dashboardGenerateSetupPromptForAgent(this, targetAgent, {
        force: shouldForce,
      });
    },
  };
}

/**
 * Build setup scheduling and quality loading methods.
 * Use when composing the dashboard app so setup prompts, quality generation, history, and Home
 * summaries can share stale-response protection and toast-based failure recovery.
 * Empty quality history leaves the view blank rather than failing the page.
 */
function dashboardSetupQualityLoadersFragment(): DashboardAppFragment {
  return {
    /**
     * Schedule setup output generation after setup detection gets a paint.
     * Use when project context changes and the UI needs to avoid blocking first render.
     *
     * @returns nothing; scheduled work updates setup prompt state later
     */
    scheduleSetupPrompt() {
      dashboardScheduleSetupPrompt(this);
    },

    /**
     * Generate a quality report for the selected project and runner.
     * Use when the user runs a quality assessment from the dashboard.
     *
     * @param qualityOptions - generation options; empty options use the dashboard defaults
     * @returns nothing; quality state and errors update through the shared helper
     */
    async generateQuality(
      qualityOptions: DashboardQualityGenerateOptions = {},
    ) {
      await dashboardGenerateQuality(this, qualityOptions);
    },

    /**
     * Load persisted quality-history rows for the selected project and agent.
     * Use when the Quality view needs previous runs for comparison.
     *
     * @returns nothing; empty history shows the view's empty state
     */
    async generateQualityHistory() {
      await dashboardGenerateQualityHistory(this);
    },

    /**
     * Schedule quality-history loading after first prompt paint.
     * Use so initial UI rendering stays responsive while history loads.
     *
     * @returns nothing; scheduled work updates quality history later
     */
    scheduleQualityHistory() {
      dashboardScheduleQualityHistory(this);
    },

    /**
     * Load the latest Home quality-history summary.
     * Use when the Home dashboard wants the newest agent-setup quality signal.
     *
     * @returns nothing; errors appear as toasts and stale responses are ignored
     */
    async generateHomeQualitySummary() {
      await dashboardGenerateHomeQualitySummary(this);
    },

    /**
     * Copy the current quality prompt to the clipboard.
     * Use when the user wants to run or inspect the prompt outside the dashboard.
     *
     * @returns nothing; clipboard errors are handled by the shared helper
     */
    copyQuality() {
      dashboardCopyQuality(this);
    },
  };
}

/**
 * Build skill-quality inventory loaders.
 *
 * Inventory and prefetch live together because both share the same project/runner generation guard:
 * stale responses must not overwrite the Skills tab after the user switches workspace or runner.
 * Prefetch swallows per-artifact failures as a best-effort fallback so one bad report does not hide
 * the rest of the inventory.
 *
 * @returns dashboard fragment; empty methods are never returned because the Skills tab needs both loaders
 */
function dashboardSkillQualityInventoryLoadersFragment(): DashboardAppFragment {
  return {
    /**
     * Load skill-quality inventory for the selected project and runner.
     * Use when the Skills tab opens or the user re-audits skill quality.
     *
     * @returns nothing; stale caches reset when a matching inventory response returns
     */
    async loadSkillQualityInventory() {
      await dashboardLoadSkillQualityInventory(this);
    },

    /**
     * Prefetch reports for every skill artifact in parallel.
     * Use so the Skills sidebar can show grades before the user clicks each skill.
     *
     * @param projectPath - project captured when prefetch started; empty means stale/no-op
     * @param runner - runner captured when prefetch started; empty means stale/no-op
     * @param generation - prefetch generation captured at request start; old values are ignored
     * @returns nothing; stale prefetches stop without updating the Skills tab
     */
    async prefetchSkillReports(
      projectPath: string,
      runner: string,
      generation: number,
    ) {
      await dashboardPrefetchSkillReports(
        this,
        projectPath,
        runner,
        generation,
      );
    },
  };
}
