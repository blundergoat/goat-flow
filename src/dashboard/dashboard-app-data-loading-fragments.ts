/**
 * Data-loading and detection fragments of the dashboard Alpine app. dashboardMergeAppFragments
 * stitches these into one app object. These fragments own the async methods that talk to the
 * dashboard server - installed-agent detection, plans/tasks, hooks, stack detection, setup-prompt
 * generation, and the quality surfaces. Each method is a thin `this`-bound shim over a shared
 * `dashboard*` helper that holds the real fetch/parse logic and its error handling, so the fragments
 * stay small and the network behaviour lives in one place per concern.
 */

/** Confirm disabling a guarded hook before removing that safety surface. */
function dashboardConfirmHookToggle(
  hook: HookState,
  shouldEnable: boolean,
): boolean {
  if (shouldEnable || !hook.requiresConfirmDialog) return true;
  return window.confirm(
    `Disabling ${hook.name} removes the guardrail. Continue?`,
  );
}

/** Replace one hook row after the server accepts a toggle request. */
function dashboardApplyHookToggleResult(
  ctx: DashboardAppContext,
  hook: HookState,
  shouldEnable: boolean,
): void {
  ctx.hooksState = ctx.hooksState.map((item: HookState) =>
    item.id === hook.id ? hook : item,
  );
  ctx.showToast(`${hook.name} ${shouldEnable ? "enabled" : "disabled"}`);
}

/**
 * Persist one hook toggle. Stale project responses are ignored, and request failures recover into
 * the Hooks banner/toast because guardrail rows must remain visible when a save fails.
 */
async function dashboardToggleHookState(
  ctx: DashboardAppContext,
  hook: HookState,
  shouldEnable: boolean,
): Promise<void> {
  if (!hook.togglable || ctx.hookSavingId) return;
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
    if (error) throw new Error(error);
    if (ctx.projectPath !== requestProjectPath) return;
    dashboardApplyHookToggleResult(
      ctx,
      payload.hook as HookState,
      shouldEnable,
    );
  } catch (err) {
    if (ctx.projectPath !== requestProjectPath) return;
    ctx.hooksError = err instanceof Error ? err.message : String(err);
    ctx.showToast(ctx.hooksError || "Hook update failed", true);
  } finally {
    if (ctx.hookSavingId === hook.id) ctx.hookSavingId = null;
  }
}

/** Return whether a quality request still belongs to the current project and runner. */
function dashboardIsCurrentQualityRequest(
  ctx: DashboardAppContext,
  projectPath: string,
  runner: RunnerId,
): boolean {
  return ctx.projectPath === projectPath && ctx.activeRunner === runner;
}

/** Load the latest home-page quality summary and recover failures into the shared toast channel. */
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
    if (
      !dashboardIsCurrentQualityRequest(ctx, requestProjectPath, requestAgent)
    )
      return;
    const error = readErrorMessage(payload);
    if (error) {
      ctx.showToast(error, true);
    } else {
      ctx.homeQualityLatest = readQualityHistoryLatest(payload.latest);
    }
  } catch (err) {
    if (
      !dashboardIsCurrentQualityRequest(ctx, requestProjectPath, requestAgent)
    )
      return;
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Home quality loading failed", true);
  }
  if (dashboardIsCurrentQualityRequest(ctx, requestProjectPath, requestAgent)) {
    ctx.homeQualityLoading = false;
  }
}

/** Convert a raw skill-inventory payload into valid skill artifact rows. */
function dashboardReadSkillQualityArtifacts(
  payload: JsonRecord,
): SkillQualityArtifact[] {
  return Array.isArray(payload.artifacts)
    ? payload.artifacts.filter(
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

/** Clear a selected skill-quality report when the refreshed inventory no longer contains it. */
function dashboardPruneMissingSkillQualitySelection(
  ctx: DashboardAppContext,
): void {
  if (!ctx.skillQualitySelectedId) return;
  const stillExists = ctx.skillQualityArtifacts.some(
    (artifact: SkillQualityArtifact) =>
      artifact.id === ctx.skillQualitySelectedId,
  );
  if (stillExists) return;
  ctx.skillQualitySelectedId = null;
  ctx.skillQualityReport = null;
}

/** Return whether a skill-quality inventory response still belongs to the visible request. */
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
 * Load skill-quality inventory. Endpoint failures recover through toasts, and stale project/runner
 * responses are ignored so a late fetch cannot overwrite the currently visible Skills tab state.
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
    // Failures are staleness-guarded like successes: a late error from a
    // superseded project/runner request must not toast over the current view.
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
 * Fetch one skill-quality report during sidebar prefetch. Per-artifact fetch/decode failures are
 * swallowed as a best-effort fallback so one bad skill report does not block the rest of the list.
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
    if (readErrorMessage(payload)) return;
    if (
      ctx.projectPath !== projectPath ||
      ctx.activeRunner !== runner ||
      ctx.skillQualityPrefetchGeneration !== generation
    ) {
      return;
    }
    // /api/skill-quality returns this app's own SkillQualityReport shape; JsonRecord does not
    // structurally overlap it, so TS requires the assertion go through unknown. Source is same-origin.
    ctx.skillQualityReports[art.id] = payload;
  } catch {
    // Best-effort sidebar grades: one failed artifact falls back to no cached grade.
    return;
  }
}

/** Finalise a matching prefetch batch and auto-select the first skill when none is selected. */
function dashboardCompleteSkillReportPrefetch(
  ctx: DashboardAppContext,
  projectPath: string,
  runner: string,
  generation: number,
): void {
  if (
    ctx.projectPath !== projectPath ||
    ctx.activeRunner !== runner ||
    ctx.skillQualityPrefetchGeneration !== generation
  ) {
    return;
  }
  ctx.skillQualityAuditedAt = Date.now();
  ctx.skillQualityPrefetching = false;
  if (!ctx.skillQualitySelectedId && ctx.skillQualityArtifacts.length > 0) {
    const first = ctx.skillQualityArtifacts[0];
    if (first) void ctx.loadSkillQualityReport(first.id);
  }
}

/**
 * Prefetch reports for every skill artifact. Empty inventories return early, and per-artifact
 * failures are swallowed by dashboardPrefetchOneSkillReport so sidebar grades stay best effort.
 */
async function dashboardPrefetchSkillReports(
  ctx: DashboardAppContext,
  projectPath: string,
  runner: string,
  generation: number,
): Promise<void> {
  const artifacts = [...ctx.skillQualityArtifacts];
  if (artifacts.length === 0) return;
  ctx.skillQualityPrefetching = true;
  await Promise.all(
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
    /** Refresh installed-agent detection for launcher defaults; uses a recover fallback on fetch/decode failure. */
    async fetchInstalledAgents(): Promise<boolean> {
      try {
        const res = await dashboardFetch("/api/agents/installed");
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
        if (this.supportedAgents.length === 0) this.supportedAgents = agents;
        this.allAgents = agents;
        this.installedAgents = agents.filter((agent) => agent.installed);
        this.agentsLoaded = true;
        if (
          this.installedAgents.length > 0 &&
          !this.installedAgents.find(
            (agent: AgentInfo) => agent.id === this.activeRunner,
          )
        ) {
          const [firstInstalled] = this.installedAgents;
          if (firstInstalled) this.activeRunner = firstInstalled.id;
        }
        return true;
      } catch {
        return false;
      }
    },

    /** Open the project browser at the current workspace path. */
    async openBrowser() {
      await dashboardOpenBrowser(this);
    },

    /** Load child directories for the requested browser path. */
    async browseTo(path: string) {
      await dashboardBrowseTo(this, path);
    },

    /** Set a browsed directory as the active project. */
    selectDir(dir: BrowseDir) {
      dashboardSelectDir(this, dir);
    },

    // -- Plans --
    /** Load plan state; reports endpoint errors and preserves newer project state because requests race. */
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
        if (error) throw new Error(error);
        if (this.projectPath !== requestProjectPath) return;
        const state = readTaskState(payload);
        this.tasksState = state;
        this.selectedTaskPlan = state.selectedPlan;
      } catch (err) {
        if (this.projectPath !== requestProjectPath) return;
        this.tasksState = null;
        this.tasksError = err instanceof Error ? err.message : String(err);
      } finally {
        if (this.projectPath === requestProjectPath) this.tasksLoading = false;
      }
    },

    /** Select a plan and reload milestones for that plan. */
    selectTaskPlan(planName: string) {
      this.selectedTaskPlan = planName;
      void this.loadTasks(planName);
    },

    /** Persist the active plan; reports endpoint errors and preserves newer project state because saves race. */
    async setActiveTaskPlan(planName: string) {
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
        if (error) throw new Error(error);
        if (this.projectPath !== requestProjectPath) return;
        const state = readTaskState(payload);
        this.tasksState = state;
        this.selectedTaskPlan = state.selectedPlan;
        this.showToast(`Active plan set to ${planName}`);
      } catch (err) {
        if (this.projectPath !== requestProjectPath) return;
        this.tasksError = err instanceof Error ? err.message : String(err);
        this.showToast(this.tasksError || "Active plan update failed", true);
      } finally {
        if (
          this.projectPath === requestProjectPath &&
          this.tasksActivePlanSaving === planName
        ) {
          this.tasksActivePlanSaving = null;
        }
      }
    },

    /** Format completed and total task counts for one milestone row. */
    taskProgressLabel(milestone: TaskMilestoneSummary): string {
      return `${milestone.completedTasks}/${milestone.totalTasks}`;
    },

    /** Convert milestone checkbox progress to a percent for progress bars. */
    taskProgressPct(milestone: TaskMilestoneSummary): number {
      if (milestone.totalTasks <= 0) return 0;
      return Math.round(
        (milestone.completedTasks / milestone.totalTasks) * 100,
      );
    },

    /** Format milestone modified time, falling back when the timestamp is invalid. */
    taskModifiedLabel(value: string): string {
      if (!value) return "unknown";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "unknown";
      return date.toLocaleString();
    },

    // -- Hooks --
    /** Load hook state for the selected project; reports errors in the Hooks banner because rows may be stale. */
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
        if (error) throw new Error(error);
        if (this.projectPath !== requestProjectPath) return;
        this.hooksState = Array.isArray(payload.hooks)
          ? (payload.hooks as HookState[])
          : [];
      } catch (err) {
        if (this.projectPath !== requestProjectPath) return;
        this.hooksState = [];
        this.hooksError = err instanceof Error ? err.message : String(err);
      } finally {
        if (this.projectPath === requestProjectPath) this.hooksLoading = false;
      }
    },
  };
}

function dashboardHookSetupActionsFragment(
  supportedAgents: SupportedAgent[],
): DashboardAppFragment {
  return {
    /** Return hook state rows for every supported agent, filling absent payloads explicitly. */
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

    /** Group a hook into the section that owns its primary risk surface. */
    hookSectionFor(hook: HookState): HookSection {
      if (hook.id === "gruff-code-quality") return "quality";
      return "safety";
    },

    /** Return the visual tone for a hook based on its dashboard section. */
    hookTone(hook: HookState): HookTone {
      const section = this.hookSectionFor(hook);
      if (section === "git") return "warning";
      if (section === "quality") return "neutral";
      return "danger";
    },

    /** Return true when any agent's installed hook state differs from desired state. */
    hookHasDrift(hook: HookState): boolean {
      return Object.values(hook.agents).some((state) => Boolean(state.drift));
    },

    /** Count agent surfaces where the hook is currently installed. */
    hookInstalledSurfaceCount(hook: HookState): number {
      return this.hookAgents(hook).filter(
        ([, state]: [RunnerId, HookAgentState]) => state.installed,
      ).length;
    },

    /** Count hooks whose desired dashboard state is enabled. */
    hooksEnabledCount(): number {
      return this.hooksState.filter((hook: HookState) => hook.enabled).length;
    },

    /** Count hooks with at least one agent surface in drift. */
    hooksDriftCount(): number {
      return this.hooksState.filter((hook: HookState) =>
        this.hookHasDrift(hook),
      ).length;
    },

    /** Count installed hook surfaces across all hook and agent combinations. */
    hooksInstalledSurfaceCount(): number {
      return this.hooksState.reduce(
        (total: number, hook: HookState) =>
          total + Number(this.hookInstalledSurfaceCount(hook)),
        0,
      );
    },

    /** Apply the current hook filter predicate to one hook. */
    hookMatchesFilter(hook: HookState, filter: HookFilter): boolean {
      if (filter === "enabled") return hook.enabled;
      if (filter === "disabled") return !hook.enabled;
      if (filter === "drift") return this.hookHasDrift(hook);
      return true;
    },

    /** Count hooks that would appear under one filter chip. */
    hookFilterCount(filter: HookFilter): number {
      return this.hooksState.filter((hook: HookState) =>
        this.hookMatchesFilter(hook, filter),
      ).length;
    },

    /** Return hooks matching the selected filter and search query. */
    filteredHooks(): HookState[] {
      const query = this.hooksSearch.trim().toLowerCase();
      return this.hooksState.filter((hook: HookState) => {
        if (!this.hookMatchesFilter(hook, this.hooksFilter)) return false;
        if (!query) return true;
        return [hook.name, hook.id, hook.description].some((value: string) =>
          value.toLowerCase().includes(query),
        );
      });
    },

    /** Return filtered hooks that belong to one dashboard section. */
    hooksForSection(section: HookSection): HookState[] {
      return this.filteredHooks().filter(
        (hook: HookState) => this.hookSectionFor(hook) === section,
      );
    },

    /** Count filtered hooks in one dashboard section. */
    hookSectionCount(section: HookSection): number {
      return this.hooksForSection(section).length;
    },

    /** Format one agent hook state for the hook table. */
    hookAgentStatusLabel(state: HookAgentState): string {
      if (!state.supported) return "not for this hook";
      if (state.drift === "desired-on-actual-off") return "drift: missing";
      if (state.drift === "desired-off-actual-on") return "drift: installed";
      return state.installed ? "installed" : "not installed";
    },

    /** Return the CSS status class for one agent hook state. */
    hookAgentStatusClass(state: HookAgentState): string {
      if (!state.supported) return "gf-hook-status-muted";
      if (state.drift) return "gf-hook-status-warn";
      return state.installed ? "gf-hook-status-ok" : "gf-hook-status-muted";
    },

    /** Persist one hook toggle; reports failed requests while preserving rows because guardrail state is sensitive. */
    async toggleHook(hook: HookState, shouldEnable: boolean) {
      await dashboardToggleHookState(this, hook, shouldEnable);
    },

    /** Reapply the current desired hook state to repair installed drift. */
    async resyncHook(hook: HookState) {
      await this.toggleHook(hook, hook.enabled);
    },

    // -- Setup --
    async detectStack() {
      await dashboardDetectStack(this);
    },

    /** Generate setup output for the agent selected in the setup view. */
    async generateSetupPrompt(shouldForce = false) {
      await dashboardGenerateSetupPrompt(this, { force: shouldForce });
    },

    /** Generate setup output for a specific setup target agent. */
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
 * Build the setup-scheduling and quality fragment: debounced setup-prompt scheduling plus the
 * quality-report generate/history/home-summary loaders. Most methods delegate to shared `dashboard*`
 * helpers, but the inline loaders here catch a fetch/parse failure: each recovers by showing a
 * dashboard toast (it reports the message in-view) instead of propagating, so a transient quality
 * fetch never breaks the view. They
 * also guard against stale responses with a current-request check because the user can switch
 * project/agent mid-flight and a late reply must not overwrite newer state. Merged by
 * dashboardMergeAppFragments.
 */
function dashboardSetupQualityLoadersFragment(): DashboardAppFragment {
  return {
    /** Generate setup output after setup detection gets a paint. */
    scheduleSetupPrompt() {
      dashboardScheduleSetupPrompt(this);
    },

    // -- Quality --
    async generateQuality(
      qualityOptions: DashboardQualityGenerateOptions = {},
    ) {
      await dashboardGenerateQuality(this, qualityOptions);
    },

    /** Load persisted quality-history rows for the selected project and agent. */
    async generateQualityHistory() {
      await dashboardGenerateQualityHistory(this);
    },

    /** Load quality history after first prompt paint. */
    scheduleQualityHistory() {
      dashboardScheduleQualityHistory(this);
    },

    /** Load the latest quality-history summary; reports errors as toasts and ignores stale responses. */
    async generateHomeQualitySummary() {
      await dashboardGenerateHomeQualitySummary(this);
    },

    /** Copy the current quality prompt to the clipboard. */
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
 */
function dashboardSkillQualityInventoryLoadersFragment(): DashboardAppFragment {
  return {
    // -- Skill quality --
    /** Load skill-quality inventory; reports endpoint errors and resets stale caches because reports key by artifact. */
    async loadSkillQualityInventory() {
      await dashboardLoadSkillQualityInventory(this);
    },

    /** Fetch reports for every artifact in parallel so the sidebar can show
     *  a per-skill grade without requiring the user to click each one first.
     *  Aborts silently if the project/runner changes mid-flight. */
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
