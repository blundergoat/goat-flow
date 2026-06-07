/**
 * Data-loading and detection fragments of the dashboard Alpine app. dashboardMergeAppFragments
 * stitches these into one app object. These fragments own the async methods that talk to the
 * dashboard server - installed-agent detection, plans/tasks, hooks, stack detection, setup-prompt
 * generation, and the quality surfaces. Each method is a thin `this`-bound shim over a shared
 * `dashboard*` helper that holds the real fetch/parse logic and its error handling, so the fragments
 * stay small and the network behaviour lives in one place per concern.
 */

/**
 * Build the agent-detection / plans / hooks fragment of the app's async data-loading methods.
 * One input to dashboardMergeAppFragments; the methods delegate to shared helpers that own the
 * fetch and its recover-on-failure handling, so this fragment only wires names to those helpers.
 *
 * @param supportedAgents - agents the server can launch, used to scope installed-agent detection
 * @returns the fragment object of agent/plans/hooks loader methods merged into the Alpine app
 */
function dashboardAppFragment07(
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

function dashboardAppFragment08(
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
      if (!hook.togglable || this.hookSavingId) return;
      if (!shouldEnable && hook.requiresConfirmDialog) {
        const confirmed = window.confirm(
          `Disabling ${hook.name} removes the guardrail. Continue?`,
        );
        if (!confirmed) return;
      }
      this.hookSavingId = hook.id;
      this.hooksError = "";
      const requestProjectPath = this.projectPath;
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
        if (this.projectPath !== requestProjectPath) return;
        const nextHook = payload.hook as HookState;
        this.hooksState = this.hooksState.map((item: HookState) =>
          item.id === nextHook.id ? nextHook : item,
        );
        this.showToast(
          `${nextHook.name} ${shouldEnable ? "enabled" : "disabled"}`,
        );
      } catch (err) {
        if (this.projectPath !== requestProjectPath) return;
        this.hooksError = err instanceof Error ? err.message : String(err);
        this.showToast(this.hooksError || "Hook update failed", true);
      } finally {
        if (this.hookSavingId === hook.id) this.hookSavingId = null;
      }
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
function dashboardAppFragment09(): DashboardAppFragment {
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
      this.homeQualityLoading = true;
      this.homeQualityLatest = null;
      const requestProjectPath = this.projectPath;
      const requestAgent = this.activeRunner;
      const isCurrentRequest = (): boolean =>
        this.projectPath === requestProjectPath &&
        this.activeRunner === requestAgent;
      try {
        const res = await dashboardFetch(
          `/api/quality/history?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestAgent)}&mode=agent-setup&limit=1`,
        );
        const payload = readRecord(await res.json(), "Home quality response");
        if (!isCurrentRequest()) return;
        const error = readErrorMessage(payload);
        if (error) {
          this.showToast(error, true);
        } else {
          this.homeQualityLatest = readQualityHistoryLatest(payload.latest);
        }
      } catch (err) {
        if (!isCurrentRequest()) return;
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Home quality loading failed", true);
      }
      if (isCurrentRequest()) this.homeQualityLoading = false;
    },

    /** Copy the current quality prompt to the clipboard. */
    copyQuality() {
      dashboardCopyQuality(this);
    },

    /** Load the committed review/security fixture for the M03 render spike. */
    async loadReviewFixture() {
      if (this.reviewsArtifact || this.reviewsLoading) return;
      this.reviewsLoading = true;
      this.reviewsError = "";
      try {
        const res = await dashboardFetch(
          "/assets/review-security-fixture.json",
        );
        if (!res.ok) throw new Error(`Review fixture returned ${res.status}`);
        this.reviewsArtifact = readSecurityReviewArtifact(await res.json());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.reviewsError = msg || "Review fixture loading failed";
        this.showToast(this.reviewsError, true);
      } finally {
        this.reviewsLoading = false;
      }
    },

    reviewSeverityColor(severity: SecurityReviewSeverity): string {
      if (severity === "Critical") return "var(--status-danger)";
      if (severity === "High") return "var(--red-400)";
      if (severity === "Medium") return "var(--status-waiting)";
      return "var(--text-muted)";
    },

    reviewRollupEntries(): Array<{
      severity: SecurityReviewSeverity;
      count: number;
    }> {
      const rollup = this.reviewsArtifact?.posture.rollupBySeverity;
      return (["Critical", "High", "Medium", "Low"] as const).map(
        (severity) => ({ severity, count: rollup?.[severity] ?? 0 }),
      );
    },

    // -- Skill quality --
    /** Load skill-quality inventory; reports endpoint errors and resets stale caches because reports key by artifact. */
    async loadSkillQualityInventory() {
      const requestProjectPath = this.projectPath;
      const requestRunner = this.activeRunner;
      const requestGeneration = Number(this.skillQualityPrefetchGeneration) + 1;
      this.skillQualityPrefetchGeneration = requestGeneration;
      this.skillQualityPrefetching = false;
      try {
        const res = await dashboardFetch(
          `/api/skill-quality/inventory?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestRunner)}`,
        );
        const payload = readRecord(await res.json(), "Skill quality inventory");
        const error = readErrorMessage(payload);
        if (error) {
          this.showToast(error, true);
          return;
        }
        if (
          this.projectPath !== requestProjectPath ||
          this.activeRunner !== requestRunner ||
          this.skillQualityPrefetchGeneration !== requestGeneration
        ) {
          return;
        }
        this.skillQualityArtifacts = Array.isArray(payload.artifacts)
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
        if (
          this.skillQualitySelectedId &&
          !this.skillQualityArtifacts.some(
            (artifact: SkillQualityArtifact) =>
              artifact.id === this.skillQualitySelectedId,
          )
        ) {
          this.skillQualitySelectedId = null;
          this.skillQualityReport = null;
        }
        this.skillQualityReports = {};
        this.skillQualityAuditedAt = null;
        this.skillQualityPrefetching = false;
        void this.prefetchSkillReports(
          requestProjectPath,
          requestRunner,
          requestGeneration,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.showToast(msg || "Skill quality inventory failed", true);
      }
    },

    /** Fetch reports for every artifact in parallel so the sidebar can show
     *  a per-skill grade without requiring the user to click each one first.
     *  Aborts silently if the project/runner changes mid-flight. */
    async prefetchSkillReports(
      projectPath: string,
      runner: string,
      generation: number,
    ) {
      const artifacts = [...this.skillQualityArtifacts];
      if (artifacts.length === 0) return;
      this.skillQualityPrefetching = true;
      const fetches = artifacts.map(async (art) => {
        try {
          const res = await dashboardFetch(
            `/api/skill-quality?path=${encodeURIComponent(projectPath)}&agent=${encodeURIComponent(runner)}&artifact=${encodeURIComponent(art.id)}`,
          );
          const payload = readRecord(await res.json(), "Skill quality report");
          if (readErrorMessage(payload)) return;
          if (
            this.projectPath !== projectPath ||
            this.activeRunner !== runner ||
            this.skillQualityPrefetchGeneration !== generation
          ) {
            return;
          }
          // /api/skill-quality returns this app's own SkillQualityReport shape;
          // JsonRecord doesn't structurally overlap it, so TS requires the
          // assertion go through `unknown` (TS2352). Source is same-origin.
          this.skillQualityReports[art.id] = payload;
        } catch {
          /* per-artifact fetch is best effort; one failure must not affect the rest */
        }
      });
      await Promise.all(fetches);
      if (
        this.projectPath === projectPath &&
        this.activeRunner === runner &&
        this.skillQualityPrefetchGeneration === generation
      ) {
        this.skillQualityAuditedAt = Date.now();
        this.skillQualityPrefetching = false;
        if (
          !this.skillQualitySelectedId &&
          this.skillQualityArtifacts.length > 0
        ) {
          const first = this.skillQualityArtifacts[0];
          if (first) void this.loadSkillQualityReport(first.id);
        }
      }
    },
  };
}
