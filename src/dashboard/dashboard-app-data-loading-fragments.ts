/**
 * Load server-backed quality and skill-inventory state into Alpine fragments.
 *
 * Use when the user changes project, generates setup or quality prompts, or opens the Skills views - these loaders guard against stale responses
 * overwriting the screen after a context switch, and recover failures into visible empty states or toasts instead of a broken page.
 *
 * Hook loaders and Hooks-view actions live in dashboard-app-hook-setup-fragments.ts.
 */

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
 * @returns nothing; it swallows a failed request into an empty Home summary rather than blocking the page
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
 * @returns nothing; it swallows a per-artifact failure, leaving that one skill without a cached grade
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
 * Build setup scheduling and quality loading methods.
 *
 * Use when composing the dashboard app so setup prompts, quality generation, history, and Home summaries can share stale-response protection and
 * toast-based failure recovery.
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
 * Inventory and prefetch live together because both share the same project/runner generation guard: stale responses must not overwrite the Skills tab
 * after the user switches workspace or runner.
 * Prefetch swallows per-artifact failures as a best-effort fallback so one bad report does not hide the rest of the inventory.
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
