/**
 * Connect agent discovery, project browsing, Plans, Hooks, and Setup controls to their shared dashboard state.
 *
 * Loaders report request failures in the relevant panel while guarded hook disabling asks for confirmation before saving.
 * Successful hook saves replace the matching row; failed saves leave current rows visible and report a banner and toast.
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
  // Only disabling a hook marked for confirmation opens the warning dialog; enabling or unguarded toggles continue directly.
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
 * @param ctx - dashboard state; results apply only while the project that started the save remains selected
 * @param hook - hook row being saved; non-togglable hooks leave the row unchanged
 * @param shouldEnable - desired hook state; `false` may require user confirmation
 * @returns nothing; it reports a failed toggle in the Hooks banner and toast while leaving every row visible
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
    // A refused hook change, disconnected server, or malformed response leaves the row unchanged and reports an error for its project.
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
 * Load agent choices and plan state, and expose project browsing actions to the dashboard.
 * Requests recover through configured runner defaults or panel errors so failed discovery does not prevent navigation.
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
        // An absent agent list gives the launcher no discovered rows; invalid individual records are omitted.
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
          // Use the first available installed row as the launcher default when the previous runner is not installed.
          if (firstInstalled) this.activeRunner = firstInstalled.id;
        }
        return true;
      } catch {
        // A server connection failure or malformed agent JSON leaves configured runners available and reports unsuccessful discovery to the caller.
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
     * @param path - folder path forwarded to the browse endpoint; the server decides whether an empty path is valid
     * @returns nothing; errors are shown by the browser helper
     */
    async browseTo(path: string) {
      await dashboardBrowseTo(this, path);
    },

    /**
     * Set a browsed directory as the active project.
     * Use when the user chooses a folder from the project browser.
     *
     * @param dir - decoded browser row; project rows select a workspace, while other directories continue browsing
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
     * @returns nothing; endpoint errors recover into the plan banner and stale responses are ignored
     */
    async loadTasks(planName?: string) {
      this.tasksLoading = true;
      this.tasksError = "";
      const requestProjectPath = this.projectPath;
      // Without an explicit choice, reopening Plans keeps the selected plan name for this request.
      const requestedPlan = planName ?? this.selectedTaskPlan;
      // A missing or empty plan name leaves the server to choose the plan returned for this project.
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
        // A rejected plan request, lost server connection, or malformed state clears this project's plan result and shows its error.
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
     * @param planName - selected plan directory; an empty name omits the plan query so the server chooses the returned plan
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
     * @returns nothing; endpoint errors recover into the plan banner and leave the prior selection intact
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
        // A refused activation or failed request keeps the prior plan result and reports the save error for the current project.
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
  };
}

/**
 * Format milestone progress for Plans and load the hook state used by the Hooks view.
 * Formatting uses existing rows; the hook loader reports failed requests through the Hooks banner.
 *
 * @returns dashboard fragment merged into the app alongside the plan loaders
 */
function dashboardTaskDisplayFragment(): DashboardAppFragment {
  return {
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
     * @param isoTimestamp - timestamp string; empty or invalid values display as unknown
     * @returns localized timestamp label, or `unknown` when the date cannot be trusted
     */
    taskModifiedLabel(isoTimestamp: string): string {
      // Empty timestamps mean the plan reader could not prove when the file changed.
      if (!isoTimestamp) return "unknown";
      const date = new Date(isoTimestamp);
      // Invalid timestamps are hidden behind a neutral label instead of showing `Invalid Date`.
      if (Number.isNaN(date.getTime())) return "unknown";
      return date.toLocaleString();
    },

    /**
     * Load hook state for the selected project.
     * Use when the Hooks panel opens or the project changes.
     *
     * @returns nothing; endpoint errors recover into the Hooks banner and stale responses are ignored
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
        // A response without hook rows leaves the Hooks list empty instead of retaining results from an earlier load.
        this.hooksState = Array.isArray(payload.hooks)
          ? (payload.hooks as HookState[])
          : [];
      } catch (err) {
        // A rejected hook request, unavailable server, or invalid response clears current hook rows and reports a panel error.
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
 * @param supportedAgents - declared runner metadata; row helpers read the live supported-agent list on the merged app
 * @returns hook row, coverage, and presentation helpers merged into the dashboard app
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
      // Missing per-runner evidence still produces an unavailable row, keeping unsupported coverage visible to the user.
      return this.supportedAgents.map((agent) => [
        agent.id,
        hook.agents[agent.id] ?? {
          supported: false,
          installed: false,
          isRegistered: false,
          isCurrentVersionInstalled: false,
          isTrusted: false,
          registrationIssue: null,
          installationIssue: null,
          effectiveState: {
            status: "provider-undocumented",
            severity: "warning",
          },
          effectiveStateLabel: "state unavailable",
          evidenceIdentity: null,
          repairCommand: null,
          repairSummary:
            "Refresh hook state before relying on this agent surface.",
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
     * Count agent surfaces whose complete effective-state chain is proven.
     * Use for Hooks overview counts so installed files never imply user coverage.
     *
     * @param hook - hook row to count; empty agent map returns zero effective surfaces
     * @returns effective surface count shown in the Hooks view
     */
    hookEffectiveSurfaceCount(hook: HookState): number {
      return this.hookAgents(hook).filter(
        ([, state]: [RunnerId, HookAgentState]) =>
          state.effectiveState.status === "effective",
      ).length;
    },

    /**
     * Detect an enabled hook with any warning or danger surface.
     * Use for the Ineffective filter so missing evidence stays visible.
     *
     * @param hook - hook row to inspect; disabled hooks are not requested coverage
     * @returns true when an enabled hook has at least one non-green agent surface
     */
    hookHasIneffectiveCoverage(hook: HookState): boolean {
      // Disabled hooks are neutral user choices rather than broken requested coverage.
      if (!hook.enabled) return false;
      return this.hookAgents(hook).some(
        ([, state]: [RunnerId, HookAgentState]) =>
          state.effectiveState.severity === "warning" ||
          state.effectiveState.severity === "danger",
      );
    },

    /**
     * List supported agent surfaces whose requested hook chain is not effective.
     * Use under each row to show the exact broken link and operator-controlled repair.
     *
     * @param hook - hook row to inspect; empty agent state returns no repair rows
     * @returns ineffective supported rows; unsupported reasons use their separate disclosure
     */
    ineffectiveHookAgents(hook: HookState): Array<[RunnerId, HookAgentState]> {
      return this.hookAgents(hook).filter(
        ([, state]: [RunnerId, HookAgentState]) =>
          state.supported && state.effectiveState.status !== "effective",
      );
    },
  };
}

/**
 * Build the Hooks view's roll-up counters and the agent lists behind each hook row's disclosure.
 *
 * Summaries count the effective-state evidence already loaded for each agent before the user opens individual hook rows.
 *
 * @returns dashboard fragment merged into the app alongside the hook actions
 */
function dashboardHookSummaryFragment(): DashboardAppFragment {
  return {
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
     * @returns enabled count among loaded hooks; zero also covers an empty hook list
     */
    hooksEnabledCount(): number {
      return this.hooksState.filter((hook: HookState) => hook.enabled).length;
    },

    /**
     * Count hooks with at least one agent surface in drift.
     * Use for the drift filter chip and overview warning.
     *
     * @returns loaded hooks with reported drift; zero does not prove unavailable agent state is current
     */
    hooksDriftCount(): number {
      return this.hooksState.filter((hook: HookState) =>
        this.hookHasDrift(hook),
      ).length;
    },

    /**
     * Count effective hook surfaces across all hooks and agents.
     * Use for the Hooks overview so users see proven coverage rather than file presence.
     *
     * @returns effective surface count; zero means no visible agent has the full evidence chain
     */
    hooksEffectiveSurfaceCount(): number {
      return this.hooksState.reduce(
        (total: number, hook: HookState) =>
          total + Number(this.hookEffectiveSurfaceCount(hook)),
        0,
      );
    },

    /**
     * Count enabled hooks with at least one non-green agent surface.
     * Use for the Hooks summary and Ineffective filter badge.
     *
     * @returns enabled hooks with warning or danger surfaces; zero also covers no loaded or enabled hooks
     */
    hooksIneffectiveCount(): number {
      return this.hooksState.filter((hook: HookState) =>
        this.hookHasIneffectiveCoverage(hook),
      ).length;
    },
  };
}

/**
 * Build the Hooks view's filtering, grouping, and per-row actions.
 *
 * A user reaches these by clicking a filter chip, expanding a section, or toggling or resyncing one hook.
 *
 * @returns dashboard fragment merged into the app alongside the hook summary counters
 */
function dashboardHookFilterActionsFragment(): DashboardAppFragment {
  return {
    /**
     * Test one hook against a selected filter chip.
     * Use before search so the Hooks list reflects enabled/disabled/drift tabs.
     *
     * @param hook - loaded hook row; enabled state, effective coverage, and drift determine its filter membership
     * @param filter - selected filter chip; unknown values show the hook
     * @returns whether the hook should stay visible for that filter
     */
    hookMatchesFilter(hook: HookState, filter: HookFilter): boolean {
      // Enabled filter shows only hooks the user wants active.
      if (filter === "enabled") return hook.enabled;
      // Disabled filter shows hooks the user has turned off.
      if (filter === "disabled") return !hook.enabled;
      // Ineffective filter shows requested hooks with a broken evidence or runtime link.
      if (filter === "ineffective") {
        return this.hookHasIneffectiveCoverage(hook);
      }
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
     * @param section - typed section selected by the Hooks view; sections without matching hooks render no rows
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
     * @param section - typed section whose visible rows supply the count; an empty section returns zero
     * @returns visible hook count for that section
     */
    hookSectionCount(section: HookSection): number {
      return this.hooksForSection(section).length;
    },

    /**
     * Format one agent hook state for the hook table.
     * Use so users see the registry-owned effective link instead of raw file presence.
     *
     * @param state - hook state for one agent; empty labels fall back to the machine status
     * @returns exact state label shared with CLI audit and hook-list JSON
     */
    hookAgentStatusLabel(state: HookAgentState): string {
      return state.effectiveStateLabel || state.effectiveState.status;
    },

    /**
     * Choose the CSS status class for one effective hook state.
     * Use so only complete evidence renders green while warnings and danger stay visible.
     *
     * @param state - hook state for one agent; disabled states render muted
     * @returns CSS class for the hook status pill
     */
    hookAgentStatusClass(state: HookAgentState): string {
      // Complete provider, install, trust, delivery, and scenario evidence is green.
      if (state.effectiveState.severity === "success") {
        return "gf-hook-status-ok";
      }
      // Disabled coverage is a neutral user choice.
      if (state.effectiveState.severity === "neutral") {
        return "gf-hook-status-muted";
      }
      return "gf-hook-status-warn";
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
     * @param targetAgent - supported runner selected for setup; its ID selects the generated prompt and cache entry
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
