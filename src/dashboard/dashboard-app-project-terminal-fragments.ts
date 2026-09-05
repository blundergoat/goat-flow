/**
 * Connect project controls, terminal sessions, and the standalone skill evaluator to dashboard actions.
 *
 * Merge these fragments into Alpine so buttons share the current project, selected session, input files, and feedback state.
 * Shared helpers own most actions; this file also prepares evaluator requests, scrollback downloads, and relative-time labels.
 */

// Reset per-run evaluator state and cancel any stale copied-report label timer.
function dashboardResetSkillEvaluatorRun(ctx: DashboardAppContext): void {
  ctx.skillEvaluatorError = null;
  ctx.skillEvaluatorResult = null;
  ctx.skillEvaluatorReportCopied = false;
  // Starting another evaluation must cancel the previous report's temporary Copied label.
  if (ctx._skillEvaluatorReportCopiedTimer) {
    clearTimeout(ctx._skillEvaluatorReportCopiedTimer);
    ctx._skillEvaluatorReportCopiedTimer = null;
  }
}

// Return whether the evaluator has markdown from uploaded files or pasted content.
function dashboardHasSkillEvaluatorInput(ctx: DashboardAppContext): boolean {
  return (
    ctx.skillEvaluatorFiles.length > 0 ||
    ctx.skillEvaluatorContent.trim().length > 0
  );
}

// Build the evaluator request body, preferring uploaded files over pasted content.
function dashboardBuildSkillEvaluatorRequestBody(
  ctx: DashboardAppContext,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  // Attached files take priority when the user has also pasted markdown into the evaluator.
  if (ctx.skillEvaluatorFiles.length > 0) {
    body.files = ctx.skillEvaluatorFiles;
  } else {
    body.content = ctx.skillEvaluatorContent;
  }
  body.kind = "skill";
  const name = ctx.skillEvaluatorName.trim();
  // An empty name lets the evaluator infer its own artifact name from the submitted content.
  if (name.length > 0) body.suggestedName = name;
  return body;
}

/**
 * Evaluate the attached files or pasted markdown and show the resulting skill verdict.
 * Network, parsing, and API failures recover into the evaluator's error field so the user can retry from the same panel.
 */
async function dashboardRunSkillEvaluator(
  ctx: DashboardAppContext,
): Promise<void> {
  dashboardResetSkillEvaluatorRun(ctx);
  // Clicking Evaluate with no files or meaningful pasted text asks for input without sending an empty request.
  if (!dashboardHasSkillEvaluatorInput(ctx)) {
    ctx.skillEvaluatorError =
      "Drop .md files, upload, or paste markdown first.";
    return;
  }
  ctx.skillEvaluatorLoading = true;
  // Verdicts depend on the selected project's quality profile; navigation must not show a result or error from the previous project.
  // Clear loading even after navigation so Evaluate becomes available again.
  const requestProjectPath = ctx.projectPath;
  try {
    const url = `/api/quality/evaluate?path=${encodeURIComponent(requestProjectPath)}`;
    const res = await dashboardFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dashboardBuildSkillEvaluatorRequestBody(ctx)),
    });
    const payload = readRecord(await res.json(), "Evaluate result");
    // A completed evaluation for a project the user left cannot replace the current verdict.
    if (ctx.projectPath !== requestProjectPath) return;
    const error = readErrorMessage(payload);
    // An evaluator rejection stays in the input panel so the user can correct the submission.
    if (error) {
      ctx.skillEvaluatorError = error;
      return;
    }
    ctx.skillEvaluatorResult = payload;
  } catch (err) {
    // A disconnected server or malformed result reports a retryable error only while the same project remains selected.
    if (ctx.projectPath !== requestProjectPath) return;
    ctx.skillEvaluatorError = err instanceof Error ? err.message : String(err);
  } finally {
    ctx.skillEvaluatorLoading = false;
  }
}

// Collect a terminal buffer for export, trimming trailing blank lines; an empty buffer produces an empty download section.
function dashboardDumpTerminalBuffer(buf: XTermBuffer): string {
  const lines: string[] = [];
  // Preserve visible scrollback order so the downloaded transcript follows the session as the user read it.
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    // An unavailable buffer row contributes no transcript text.
    if (line) lines.push(line.translateToString(true));
  }
  // Remove empty tail rows created by the terminal panel height rather than session output.
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}

// Build scrollback text, including the alternate screen when a TUI currently owns it.
function dashboardTerminalScrollbackText(xterm: XTermInstance): string {
  const normalText = dashboardDumpTerminalBuffer(xterm.buffer.normal);
  const altActive = xterm.buffer.active === xterm.buffer.alternate;
  const altText = altActive
    ? dashboardDumpTerminalBuffer(xterm.buffer.alternate)
    : "";
  const parts: string[] = [];
  // A session with no normal scrollback adds no empty transcript section.
  if (normalText) parts.push(normalText);
  // An active full-screen terminal app has a separate screen; include its current view under a labeled divider.
  if (altText) {
    parts.push("", "--- alternate screen (current TUI view) ---", "", altText);
  }
  return parts.join("\n");
}

// Download terminal scrollback text using the runner and short session id as the filename.
function dashboardDownloadTerminalScrollback(
  runner: RunnerId | "terminal",
  sessionId: string,
  text: string,
): void {
  const shortId = sessionId.slice(0, 8);
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = `${runner}-${shortId}.txt`;
  downloadLink.click();
  URL.revokeObjectURL(url);
}

// Export one live xterm tab's scrollback; no download occurs when the tab has no xterm handle.
function dashboardExportSessionScrollback(
  ctx: DashboardAppContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // A session without an attached browser terminal has no local scrollback available to download.
  if (!refs?.xterm) return;
  const session = ctx.sessions.find((s: LocalSession) => s.id === sessionId);
  // If local session metadata has gone away, the filename still identifies this as terminal output.
  const runner = session?.runner ?? "terminal";
  dashboardDownloadTerminalScrollback(
    runner,
    sessionId,
    dashboardTerminalScrollbackText(refs.xterm),
  );
}

/**
 * Expose file-drop, removal, and evaluation actions for standalone skill markdown.
 * The shared evaluator request helper reports failures inside the panel and restores its loading state.
 */
function dashboardSkillEvaluatorInputFragment(): DashboardAppFragment {
  return {
    // Pass dropped files to the shared markdown intake so accepted files appear in the evaluator's attachment list.
    skillEvaluatorDrop(event: DragEvent) {
      event.preventDefault();
      this.skillEvaluatorDragActive = false;
      const files = event.dataTransfer?.files;
      // A text or empty drag has no files to add to the evaluator.
      if (!files || files.length === 0) return;
      void this._ingestSkillEvaluatorFiles(files);
    },

    // Remove one already-attached file by name.
    removeSkillEvaluatorFile(name: string) {
      this.skillEvaluatorFiles = this.skillEvaluatorFiles.filter(
        (file: { name: string; content: string }) => file.name !== name,
      );
    },

    /**
     * Evaluate the submitted markdown and show its verdict or a request-for-input message.
     * Request failures are reported inside the panel, and loading always clears so the user can retry.
     */
    async runSkillEvaluator() {
      await dashboardRunSkillEvaluator(this);
    },
  };
}

// Expose saved-project registration, archive, sorting, persistence, and title actions to dashboard controls.
function dashboardProjectActionsFragment(): DashboardAppFragment {
  return {
    // -- Projects --
    // Add the entered directory to saved projects and load its adoption status; an empty draft adds nothing.
    async addProject() {
      await dashboardAddProject(this);
    },

    // Retain a project in archived dashboard state and hide it from the active list.
    async archiveProject(path: string) {
      await dashboardSetProjectArchived(this, path, true);
    },

    // Return a retained archived project to the active workspace list.
    async restoreProject(path: string) {
      await dashboardSetProjectArchived(this, path, false);
    },

    // Sort saved projects by the active key and direction.
    sortProjects(key: ProjectSortKey) {
      dashboardSortProjects(this, key);
    },

    // Sort projects by visible columns while keeping the derived "name" column first-class.
    get sortedProjectsList(): ProjectEntry[] {
      return dashboardSortedProjectsList(this);
    },

    // Refresh lightweight adoption status for every active project.
    async refreshProjectStatuses() {
      await dashboardRefreshProjectStatuses(this);
    },

    // Compatibility entry used by startup while the Projects UI uses truthful status terminology.
    async auditAllProjects() {
      await dashboardRefreshProjectStatuses(this);
    },

    // Load saved dashboard state from disk, with localStorage as a migration fallback.
    async _loadSavedDashboardState() {
      await dashboardLoadSavedDashboardState(this);
    },

    // Persist the current dashboard state to localStorage and the server store.
    _saveDashboardState() {
      dashboardSaveDashboardState(this);
    },

    // Begin editing the current project's title (inline header rename).
    startEditProjectTitle() {
      dashboardStartEditProjectTitle(this);
    },

    // Save the edited project title; an empty or whitespace-only draft clears the override and restores the directory name.
    saveProjectTitle() {
      dashboardSaveProjectTitle(this);
    },

    // Discard the inline-edited title.
    cancelEditProjectTitle() {
      dashboardCancelEditProjectTitle(this);
    },

    // Persist the current project list through the shared dashboard state store.
    _saveProjectsList() {
      this._saveDashboardState();
    },
  };
}

/**
 * Share clipboard feedback, toasts, and terminal availability checks across dashboard views.
 * Clipboard access failures recover through the legacy copy fallback.
 */
function dashboardUtilityActionsFragment(): DashboardAppFragment {
  return {
    // -- Clipboard + Toast --
    /**
     * Copy text through the Clipboard API, with a hidden-textarea fallback when that API is unavailable or rejects access.
     * False means the fallback reported no copy; exceptions from the fallback remain the caller's responsibility.
     */
    async copyTextToClipboard(text: string): Promise<boolean> {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        // A browser without clipboard access, or one rejecting permission, gets a second copy attempt through the textarea fallback.
        void err;
      }
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentional fallback for insecure contexts without Clipboard API
      const didCopy = document.execCommand("copy");
      document.body.removeChild(textarea);
      return didCopy;
    },

    // Copy text and flash the "Copied!" button label, reverting to "Copy" after 2s. Fire-and-forget: the copy result is ignored.
    copyText(text: string) {
      void this.copyTextToClipboard(text);
      this.copyLabel = "Copied!";
      setTimeout(() => {
        this.copyLabel = "Copy";
      }, 2000);
    },

    // Show a temporary toast message.
    showToast(msg: string, isError?: boolean) {
      this.toast = msg;
      // Callers that omit an error flag request the normal informational toast appearance.
      this.toastError = isError ?? false;
      setTimeout(() => {
        this.toast = "";
      }, 4000);
    },

    // -- Terminal --
    // Discover whether terminal controls can be enabled for this dashboard server.
    async checkTerminalAvailable() {
      await dashboardCheckTerminalAvailable(this);
    },
  };
}

/**
 * Carry optional workspace and report ownership choices when the dashboard launches a terminal.
 *
 * Prompt labels and preset IDs keep the resulting session recognizable in the workspace.
 * Unset paths and labels are forwarded to the shared launch helper, which owns their defaults.
 */
interface DashboardTerminalLaunchOptions {
  promptLabel?: string | null;
  presetId?: string | null;
  cwdPath?: string | null;
  targetPath?: string | null;
  accessMode?: TerminalAccessMode;
  captureQualityDrafts?: boolean;
  qualityReportProjectPath?: string | null;
}

/**
 * Expose terminal launch, retry, reconnect, and title actions to workspace controls.
 * Shared terminal helpers own session transport and launch behavior so these Alpine entry points use the same lifecycle rules.
 */
function dashboardTerminalLaunchActionsFragment(): DashboardAppFragment {
  return {
    // Refresh terminal session state from the server.
    async updateSessionCount() {
      await dashboardUpdateSessionCount(this);
    },

    // Clear non-active (terminated/starting) sessions, preserving running ones.
    async endAllSessions() {
      await dashboardEndAllSessions(this);
    },

    // Retry a terminal session that failed or stalled before first output.
    async retryTerminalSession(sessionId: string) {
      await dashboardRetryTerminalSession(this, sessionId);
    },

    // Load the xterm.js globals on demand before any terminal view is rendered.
    async loadXterm() {
      await dashboardLoadXterm(this);
    },

    // Launch a preset prompt in the selected runner.
    async launchPreset(
      prompt: string,
      runner?: RunnerId,
      label?: string,
      options?: DashboardTerminalLaunchOptions,
    ) {
      await dashboardLaunchPreset(this, prompt, runner, label, options);
    },

    // Drop a session id from every project's saved list, pruning empty entries.
    _forgetSavedSession(sessionId: string) {
      dashboardForgetSavedSession(this, sessionId);
    },

    // Save a meaningful session title for reconnects; absent or blank titles leave existing saved titles unchanged.
    rememberSessionTitle(sessionId: string, title: string | null | undefined) {
      dashboardRememberSessionTitle(this, sessionId, title);
    },

    // Add an ended local session to the Workspace recent-history list.
    rememberRecentSession(session: LocalSession) {
      dashboardRememberRecentSession(this, session);
    },

    // Choose the session's saved or generated display title; null produces the neutral Runner session label.
    sessionTitleFor(session: ServerSessionInfo | LocalSession | null): string {
      return dashboardSessionTitle(this, session);
    },

    // Detach browser terminals while saving reconnect state; an omitted or empty path saves the currently selected project's sessions.
    detachTerminal(forProjectPath?: string) {
      dashboardDetachTerminal(this, forProjectPath);
    },

    // Reconnect the workspace to every saved backend session for this project.
    async reconnectTerminal(): Promise<boolean> {
      return dashboardReconnectTerminal(this);
    },

    // Create a new backend terminal session and open it in the workspace.
    async launchInTerminal(
      prompt: string,
      runner: RunnerId = "claude",
      {
        promptLabel = null,
        presetId = null,
        cwdPath = null,
        targetPath = null,
        accessMode = "workspace",
        captureQualityDrafts = false,
        qualityReportProjectPath = null,
      }: DashboardTerminalLaunchOptions = {},
    ) {
      await dashboardLaunchInTerminal(this, prompt, runner, {
        promptLabel,
        presetId,
        cwdPath,
        targetPath,
        accessMode,
        captureQualityDrafts,
        qualityReportProjectPath,
      });
    },
  };
}

/**
 * Expose terminal connection, session selection, closure, and transcript downloads to workspace controls.
 * Export uses the browser terminal's buffers; session actions delegate to the shared terminal lifecycle helpers.
 */
function dashboardTerminalSessionActionsFragment(): DashboardAppFragment {
  return {
    // Bind a browser xterm instance to a backend PTY session.
    connectTerminal(sessionId: string, wsUrl: string) {
      dashboardConnectTerminal(this, sessionId, wsUrl);
    },

    // End a local terminal session and release its browser bindings.
    endSession(sessionId: string) {
      dashboardEndSession(this, sessionId);
    },

    /**
     * Download the tab's scrollback, trimming blank tail rows and appending the current full-screen terminal view when active.
     * A session without an attached browser terminal has no local transcript to download.
     */
    exportSession(sessionId: string) {
      dashboardExportSessionScrollback(this, sessionId);
    },

    // Exit the active terminal session from the workspace view.
    exitTerminal() {
      dashboardExitTerminal(this);
    },

    // Switch the workspace to an existing local terminal session.
    switchToSession(sessionId: string) {
      dashboardSwitchToSession(this, sessionId);
    },

    // Attach the workspace to an existing backend terminal session.
    async openServerSession(serverSession: ServerSessionInfo) {
      await dashboardOpenServerSession(this, serverSession);
    },

    // Terminate a backend terminal session by ID.
    async endServerSession(sessionId: string) {
      await dashboardEndServerSession(this, sessionId);
    },

    // -- Computed Properties --
    auditDetailAgent: null as string | null,
  };
}

/**
 * Format relative ages for activity and audit labels without changing dashboard state.
 * Activity and audit labels use different missing-date and hour-to-day rules, described on their methods.
 */
function dashboardTimeFormattingFragment(): DashboardAppFragment {
  return {
    // -- Helpers --
    /**
     * Format a past date as a coarse "just now / Xm / Xh / Xd ago" label for activity timestamps.
     * A null date returns "" (render nothing); negative/future deltas are not specially handled.
     */
    formatTimeAgo(date: string | Date | null): string {
      // Missing activity timestamps leave their labels blank.
      if (!date) return "";
      const seconds = Math.floor(
        (Date.now() - new Date(date).getTime()) / 1000,
      );
      // Sub-minute results use a readable freshness label instead of a seconds counter.
      if (seconds < 60) return "just now";
      const minutes = Math.floor(seconds / 60);
      // Within the first hour, minute labels retain useful activity detail.
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      // Activity within the first day is easier to distinguish in hours.
      if (hours < 24) return `${hours}h ago`;
      return `${Math.floor(hours / 24)}d ago`;
    },

    /**
     * Format audit freshness, treating a missing date or a future timestamp as just now.
     * Keep ages below 72 hours in hours so recent multi-day audits retain useful detail.
     */
    formatAuditAge(date: string | Date | null): string {
      // An audit without a stored timestamp uses the current-result freshness label.
      if (!date) return "just now";
      const seconds = Math.max(
        0,
        Math.floor((Date.now() - new Date(date).getTime()) / 1000),
      );
      // Sub-minute results use a readable freshness label instead of a seconds counter.
      if (seconds < 60) return "just now";
      const minutes = Math.floor(seconds / 60);
      // Within the first hour, minute labels retain useful activity detail.
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      // Audit ages retain hourly detail for three days before switching to coarser day labels.
      if (hours < 72) return `${hours}h ago`;
      return `${Math.floor(hours / 24)}d ago`;
    },
  };
}
