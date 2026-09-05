/**
 * Keep Workspace loading feedback, waiting badges, and prompt submission aligned with the attached terminal.
 *
 * Use these helpers while launching a prompt, pasting more text, or retiring a pane's pending work.
 * Prompt guidance must describe the same authority the backend applies to that session.
 */

/**
 * Update both copies of a session so terminal callbacks and the visible Workspace row stay in step.
 *
 * @param ctx - dashboard state holding visible session rows
 * @param sessionId - row to update; a missing row still allows the attached session copy to be updated
 * @param fallback - attached session copy retained by the event handler
 * @param mutate - the same state update applied once to each distinct session copy
 */
function dashboardMutateLocalSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
  mutate: (session: LocalSession) => void,
): void {
  const reactive = ctx.sessions.find((s) => s.id === sessionId);
  // Update the visible row when it is still in Workspace.
  if (reactive) mutate(reactive);
  // Event handlers retain an attached copy; keep it current without applying the same update twice to one object.
  if (reactive !== fallback) mutate(fallback);
}

// Clear the loading-overlay escalation timers for one terminal session.
function dashboardClearTerminalLoadingTimers(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // A pane without refs has no loading hints or retry timers to cancel.
  if (!refs) return;
  // Cancel the pending slow-start hint when loading no longer needs escalation.
  if (refs.loadingSlowTimer) {
    clearTimeout(refs.loadingSlowTimer);
    refs.loadingSlowTimer = undefined;
  }
  // Cancel a pending Retry reveal so it cannot appear after loading has settled.
  if (refs.loadingRetryTimer) {
    clearTimeout(refs.loadingRetryTimer);
    refs.loadingRetryTimer = undefined;
  }
}

/**
 * Offer Retry only when the dashboard can reproduce the original launch prompt.
 *
 * @param refs - pane launch details; absent refs mean no reproducible prompt is recorded
 * @returns true for a recorded prompt, including an intentional empty prompt; false for a restored session without one
 */
function dashboardHasTerminalRetryPrompt(
  refs: TerminalRefs | undefined,
): boolean {
  return (
    typeof refs?.retryPrompt === "string" ||
    typeof refs?.launchPrompt === "string"
  );
}

// Move one session through the terminal loading-overlay state machine.
function dashboardSetTerminalLoadingPhase(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
  phase: TerminalLoadingPhase,
  error?: string,
): void {
  // Ready or failed loading no longer needs timed slow-start or retry escalation.
  if (phase === "ready" || phase === "error") {
    dashboardClearTerminalLoadingTimers(ctx, sessionId);
  }
  dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
    target.loadingPhase = phase;
    // Show the failure message and offer Retry only when this launch can be reproduced.
    if (phase === "error") {
      // An omitted error uses the standard startup message; a supplied message remains unchanged.
      target.loadingError = error ?? "Could not start session.";
      target.loadingShowRetry = dashboardHasTerminalRetryPrompt(
        ctx._terminalRefs[sessionId],
      );
    } else {
      target.loadingError = undefined;
      // The first usable output clears the loading overlay's extra hints and Retry control.
      if (phase === "ready") {
        target.loadingShowSlowHint = false;
        target.loadingShowRetry = false;
      }
    }
  });
}

// Arm the slow-start and retry affordances for the loading overlay.
function dashboardArmTerminalLoadingTimers(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // No pane refs means there is nowhere to retain or cancel loading timers.
  if (!refs) return;
  dashboardClearTerminalLoadingTimers(ctx, sessionId);
  refs.loadingSlowTimer = setTimeout(() => {
    refs.loadingSlowTimer = undefined;
    // The attached session copy keeps loading state available if its visible row is no longer present.
    const current = ctx.sessions.find((s) => s.id === sessionId) ?? fallback;
    // A finished or ready session no longer needs the slow-start hint.
    if (current.ended || current.loadingPhase === "ready") return;
    dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
      target.loadingShowSlowHint = true;
    });
  }, TERMINAL_LOADING_SLOW_HINT_MS);
  // A restored session without its original prompt must stay open; offering Retry would lose that launch.
  if (!dashboardHasTerminalRetryPrompt(refs)) return;
  refs.loadingRetryTimer = setTimeout(() => {
    refs.loadingRetryTimer = undefined;
    // Read the attached copy when this timer can no longer find a visible session row.
    const current = ctx.sessions.find((s) => s.id === sessionId) ?? fallback;
    // Once the session is ready or ended, do not reveal Retry for its old loading attempt.
    if (current.ended || current.loadingPhase === "ready") return;
    dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
      target.loadingShowRetry = true;
    });
  }, TERMINAL_LOADING_RETRY_MS);
}

// Mark the loading overlay ready as soon as the PTY sends its first output.
function dashboardMarkTerminalLoadingReady(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
  previousTail: string,
  output: string,
): void {
  // Only the first nonempty output settles initial loading; empty chunks and later output do not repeat the transition.
  if (previousTail.length > 0 || output.length === 0) return;
  dashboardSetTerminalLoadingPhase(ctx, sessionId, fallback, "ready");
}

// Cancel a pending "awaiting input" reveal for one terminal session.
function dashboardClearAwaitingInputTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // No pending reveal means the user has no delayed waiting badge to cancel.
  if (!refs?.awaitingInputTimer) return;
  clearTimeout(refs.awaitingInputTimer);
  refs.awaitingInputTimer = undefined;
}

// Show the waiting badge only after waiting-looking output stays quiet.
function dashboardScheduleAwaitingInputReveal(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // A missing pane cannot show a badge, and an existing reveal timer keeps its original deadline.
  if (!refs || refs.awaitingInputTimer) return;
  refs.awaitingInputTimer = setTimeout(() => {
    refs.awaitingInputTimer = undefined;
    const reactive = ctx.sessions.find((s) => s.id === sessionId);
    // The attached copy still carries output if the visible row has been removed.
    const current = reactive ?? fallback;
    // An ended session cannot be waiting for another answer from the user.
    if (current.ended) return;
    // Empty output or a tail without a waiting prompt supplies no reason to reveal the badge.
    if (!dashboardOutputLooksAwaitingInput(current.outputTail ?? "")) return;
    dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
      target.awaitingInput = true;
    });
  }, AWAITING_INPUT_VISIBLE_DELAY_MS);
}

// Cancel a delayed submit for a bracketed paste.
function dashboardClearPasteSubmitTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // This pane has no delayed Enter waiting to be cancelled.
  if (!refs?.pasteSubmitTimer) return;
  clearTimeout(refs.pasteSubmitTimer);
  refs.pasteSubmitTimer = undefined;
}

// Cancel all pending delayed submit state for a bracketed paste.
function dashboardClearPasteSubmitState(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  dashboardClearPasteSubmitTimer(ctx, sessionId);
  const refs = ctx._terminalRefs[sessionId];
  // Clear queued text and commit tracking only while this pane still owns those pending pastes.
  if (refs) {
    refs.pasteSubmitQueue = undefined;
    refs.pasteSubmitOutputTail = undefined;
    refs.pasteSubmitAwaitingCommit = false;
    refs.pasteSubmitFallbackSubmitted = false;
  }
}

/**
 * Send Enter to the runner after the user's pasted text is ready to submit.
 *
 * @param ctx - dashboard state holding the pane's socket
 * @param sessionId - receiving session; a missing pane cannot submit
 * @returns true when Enter was sent, or false when the socket is missing or closed
 */
function dashboardSendTerminalSubmit(
  ctx: DashboardTerminalContext,
  sessionId: string,
): boolean {
  const refs = ctx._terminalRefs[sessionId];
  // A closed or missing connection cannot deliver Enter to the runner.
  if (!refs?.ws || refs.ws.readyState !== WebSocket.OPEN) return false;
  refs.ws.send(JSON.stringify({ type: "input", data: "\r" }));
  return true;
}

/**
 * Wait a moment before pressing Enter on a pasted prompt, so the runner has finished accepting the text first.
 * Submitting immediately after a large paste is the case where a runner receives half a prompt and answers the wrong question.
 *
 * @param ctx - live Alpine terminal context holding this session's refs
 * @param sessionId - session the paste belongs to
 * @returns nothing; a session whose pane has already closed is left alone
 */
function dashboardArmPasteSubmitTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
  {
    delayMs = TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS,
    retryCount = 0,
    keepAwaitingCommit = false,
    retryIfStillCommitted = false,
  }: {
    delayMs?: number;
    retryCount?: number;
    keepAwaitingCommit?: boolean;
    retryIfStillCommitted?: boolean;
  } = {},
): void {
  const refs = ctx._terminalRefs[sessionId];
  // A closed pane no longer owns a paste that this timer can submit.
  if (!refs) return;
  dashboardClearPasteSubmitTimer(ctx, sessionId);
  // A new paste starts with empty commit history so older output cannot submit it early.
  if (retryCount === 0) refs.pasteSubmitOutputTail = "";
  refs.pasteSubmitTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    // Clear the fired timer only if the user still has this pane attached.
    if (currentRefs) currentRefs.pasteSubmitTimer = undefined;
    const submitted = dashboardSubmitPendingPaste(ctx, sessionId, {
      keepAwaitingCommit,
      retryIfStillCommitted,
    });
    // A temporary inability to send Enter gets a bounded retry instead of leaving the paste waiting indefinitely.
    if (!submitted && retryCount < TERMINAL_PASTE_SUBMIT_MAX_RETRIES) {
      dashboardArmPasteSubmitTimer(ctx, sessionId, {
        delayMs: TERMINAL_PASTE_SUBMIT_RETRY_DELAY_MS,
        retryCount: retryCount + 1,
        keepAwaitingCommit,
        retryIfStillCommitted,
      });
    }
  }, delayMs);
}

/**
 * Stop waiting on a paste that has now been accepted, and let the next queued paste go.
 *
 * @param ctx - live Alpine terminal context holding this session's refs
 * @param sessionId - session whose pending paste was accepted
 */
function dashboardReleaseFallbackPasteSubmit(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // Nothing is waiting on this session, so there is no queue to release.
  if (!refs?.pasteSubmitAwaitingCommit) return;
  refs.pasteSubmitTimer = undefined;
  refs.pasteSubmitAwaitingCommit = false;
  refs.pasteSubmitFallbackSubmitted = false;
  dashboardSendNextQueuedPaste(ctx, sessionId);
}

/**
 * Schedule one more submit attempt for a runner that shows the pasted text but has not acted on it yet.
 *
 * @param ctx - live Alpine terminal context holding this session's refs
 * @param sessionId - session whose paste is still sitting uncommitted
 * @param retryCount - how many attempts have already been made, which bounds the retrying
 * @returns true when a retry was scheduled; false means the session or its output is gone and the caller stops
 */
function dashboardArmPasteSubmitRetryIfStillCommitted(
  ctx: DashboardTerminalContext,
  sessionId: string,
  retryCount = 0,
): boolean {
  const refs = ctx._terminalRefs[sessionId];
  const target = ctx.sessions.find((session) => session.id === sessionId);
  // Without a pane or captured output there is nothing to compare against, so no retry can be judged.
  if (!refs || typeof target?.outputTail !== "string") {
    return false;
  }
  refs.pasteSubmitTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    // The pane may have closed while waiting; only an existing pane can clear its timer reference.
    if (currentRefs) currentRefs.pasteSubmitTimer = undefined;
    const currentTarget = ctx.sessions.find(
      (session) => session.id === sessionId,
    );
    // A removed session supplies no output showing a paste still in its composer.
    const currentTail = currentTarget?.outputTail ?? "";
    // Retry only while the latest output still shows the paste waiting in the composer.
    if (dashboardOutputStillAtCommittedPaste(currentTail)) {
      dashboardSendTerminalSubmit(ctx, sessionId);
      const nextRetryCount = retryCount + 1;
      // Bound repeated Enter attempts so a stuck composer cannot keep receiving submits forever.
      if (nextRetryCount < TERMINAL_PASTE_SUBMIT_MAX_RETRIES) {
        dashboardArmPasteSubmitRetryIfStillCommitted(
          ctx,
          sessionId,
          nextRetryCount,
        );
        return;
      }
    }
    dashboardSendNextQueuedPaste(ctx, sessionId);
  }, TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
  return true;
}

/**
 * Send the next paste the user queued while an earlier one was still settling.
 *
 * @param ctx - live Alpine terminal context holding this session's refs
 * @param sessionId - session whose queue is being drained
 */
function dashboardSendNextQueuedPaste(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  const next = refs?.pasteSubmitQueue?.shift();
  // No next queued paste means this helper sends nothing further to the runner.
  if (!refs || !next) return;
  // Removing the last queued paste leaves no queue for later input to wait behind.
  if (refs.pasteSubmitQueue?.length === 0) refs.pasteSubmitQueue = undefined;
  dashboardSendBracketedPaste(ctx, sessionId, next);
}

/**
 * Send Enter for a settled paste, then release or keep watching its queue according to the runner's commit behavior.
 *
 * @returns true when Enter was sent, even if another commit check is pending; false means the socket could not submit
 */
function dashboardSubmitPendingPaste(
  ctx: DashboardTerminalContext,
  sessionId: string,
  {
    keepAwaitingCommit = false,
    retryIfStillCommitted = false,
  }: {
    keepAwaitingCommit?: boolean;
    retryIfStillCommitted?: boolean;
  } = {},
): boolean {
  dashboardClearPasteSubmitTimer(ctx, sessionId);
  const submitted = dashboardSendTerminalSubmit(ctx, sessionId);
  const refs = ctx._terminalRefs[sessionId];
  // Keep the caller informed when the runner connection could not accept Enter.
  if (!submitted) return false;
  // A fallback Enter may precede the runner's paste marker, so hold the next paste until that wait is released.
  if (keepAwaitingCommit && refs?.pasteSubmitAwaitingCommit) {
    refs.pasteSubmitFallbackSubmitted = true;
    refs.pasteSubmitTimer = setTimeout(() => {
      dashboardReleaseFallbackPasteSubmit(ctx, sessionId);
    }, TERMINAL_PASTE_FALLBACK_RELEASE_DELAY_MS);
    return true;
  }
  // Keep commit tracking on an attached pane in step with the Enter just sent.
  if (refs) {
    refs.pasteSubmitAwaitingCommit = false;
    refs.pasteSubmitFallbackSubmitted = retryIfStillCommitted;
  }
  // Runners that still display the committed paste get a bounded check before the next queued prompt is sent.
  if (
    retryIfStillCommitted &&
    dashboardArmPasteSubmitRetryIfStillCommitted(ctx, sessionId)
  ) {
    return true;
  }
  dashboardSendNextQueuedPaste(ctx, sessionId);
  return submitted;
}

/**
 * Send one paste to the runner and decide how its Enter key is delivered, since runners differ in how they accept pasted text.
 *
 * @param ctx - live Alpine terminal context holding this session's refs
 * @param sessionId - session receiving the paste
 * @param paste - the text plus whether its submit should be delayed
 */
function dashboardSendBracketedPaste(
  ctx: DashboardTerminalContext,
  sessionId: string,
  paste: DashboardQueuedPaste,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // A missing or closed socket cannot deliver this paste; no input is sent.
  if (!refs?.ws || refs.ws.readyState !== WebSocket.OPEN) return;
  refs.ws.send(JSON.stringify({ type: "input", data: paste.data }));
  // The runner needs a moment before Enter, so the submit is armed on a timer instead of sent now.
  if (paste.shouldDelaySubmit) {
    const target = ctx.sessions.find((session) => session.id === sessionId);
    const claudeNoMarkerFallback = target?.runner === "claude";
    refs.pasteSubmitAwaitingCommit = true;
    refs.pasteSubmitFallbackSubmitted = false;
    dashboardArmPasteSubmitTimer(ctx, sessionId, {
      delayMs: claudeNoMarkerFallback
        ? TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS
        : TERMINAL_PASTE_COMMIT_FALLBACK_DELAY_MS,
      keepAwaitingCommit: !claudeNoMarkerFallback,
      retryIfStillCommitted: claudeNoMarkerFallback,
    });
  } else if (
    // Immediate Enter releases the next paste only after this one was submitted.
    dashboardSendTerminalSubmit(ctx, sessionId)
  ) {
    dashboardSendNextQueuedPaste(ctx, sessionId);
  } else {
    dashboardArmPasteSubmitTimer(ctx, sessionId, {
      delayMs: TERMINAL_PASTE_SUBMIT_RETRY_DELAY_MS,
      retryCount: 1,
    });
  }
}

/**
 * Send a paste now, or hold it until the previous one has been accepted, so two fast pastes cannot interleave in the runner's input.
 *
 * @param ctx - live Alpine terminal context holding this session's refs
 * @param sessionId - session receiving the paste
 * @param paste - the text plus whether its submit should be delayed
 */
function dashboardSendOrQueueBracketedPaste(
  ctx: DashboardTerminalContext,
  sessionId: string,
  paste: DashboardQueuedPaste,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // Without pane refs, this paste has no attached destination.
  if (!refs) return;
  // An earlier paste is still settling, so this one waits its turn rather than arriving mid-prompt.
  if (refs.pasteSubmitTimer || refs.pasteSubmitAwaitingCommit) {
    refs.pasteSubmitQueue = [...(refs.pasteSubmitQueue ?? []), paste];
    return;
  }
  dashboardSendBracketedPaste(ctx, sessionId, paste);
}

// React to runner output while a bracketed paste submit is pending.
function dashboardHandlePasteSubmitOutput(
  ctx: DashboardTerminalContext,
  sessionId: string,
  output: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  const target = ctx.sessions.find((session) => session.id === sessionId);
  // Claude and Antigravity may emit paste markers even when no dashboard submit is pending.
  const runnerUsesPasteMarker =
    target?.runner === "claude" || target?.runner === "antigravity";
  // A timer or commit wait means this pane still owns a paste awaiting Enter.
  const hasPendingPaste =
    refs?.pasteSubmitTimer !== undefined ||
    refs?.pasteSubmitAwaitingCommit === true;
  // Without a pane or relevant paste state, this output cannot advance dashboard paste submission.
  if (!refs || (!hasPendingPaste && !runnerUsesPasteMarker)) return;
  // The first chunk starts commit history; later chunks extend it so a split paste marker can still be recognized.
  const outputTail = ((refs.pasteSubmitOutputTail ?? "") + output).slice(-2000);
  refs.pasteSubmitOutputTail = outputTail;
  // Pending pastes use accumulated output; otherwise inspect only this chunk so an old marker cannot trigger work.
  const committedPaste = dashboardOutputLooksCommittedPaste(
    hasPendingPaste ? outputTail : output,
  );
  // A paste marker shows the runner accepted the text and lets submission move forward.
  if (committedPaste) {
    const alreadySubmitted = refs.pasteSubmitFallbackSubmitted === true;
    refs.pasteSubmitAwaitingCommit = false;
    // A fallback already sent Enter, so this marker must not submit the same prompt twice.
    if (alreadySubmitted) return;
    refs.pasteSubmitFallbackSubmitted = false;
    // A marker without a dashboard paste waiting for Enter must not trigger an extra submit.
    if (!hasPendingPaste) return;
    // These runners need a brief settling delay after the marker before Enter reaches the committed paste.
    if (target?.runner === "claude" || target?.runner === "antigravity") {
      dashboardArmPasteSubmitTimer(ctx, sessionId, {
        delayMs: TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS,
        retryIfStillCommitted: true,
      });
    } else {
      dashboardSubmitPendingPaste(ctx, sessionId);
    }
  }
}

/**
 * Resolve the terminal's write access from the chosen preset and the user's investigator role.
 *
 * @param preset - selected preset; null supplies no write permission and resolves to reporting mode
 * @param userRole - current role; investigator keeps reporting mode even for a preset that may write
 * @returns workspace mode only for a writing preset outside investigator mode; otherwise reporting mode
 */
function dashboardTerminalAccessMode(
  preset: Preset | null,
  userRole: string,
): TerminalAccessMode {
  return preset?.mayWriteFiles === true && userRole !== "investigator"
    ? "workspace"
    : "reporting";
}

/**
 * Build the target and write-authority context appended to a user's launch prompt.
 * Use the resolved backend access mode so dynamic and overridden launches receive matching guidance.
 *
 * @param dashboardContext - selected dashboard project; its path is present after launch validation
 * @param runner - terminal runner the user chose; always present for a launchable session
 * @param preset - selected preset; null means a custom prompt with no route-specific guidance
 * @param accessMode - backend-enforced mode shown to the user; never empty after access resolution
 * @returns launch guidance appended to the prompt; never empty for a valid terminal launch
 */
function dashboardGlobalLaunchContext(
  dashboardContext: DashboardTerminalContext,
  runner: RunnerId,
  preset: Preset | null,
  accessMode: TerminalAccessMode,
): string {
  const controllingWorkspace = dashboardControllingWorkspace();
  // Custom prompts have no preset text, so route-specific guidance stays empty.
  const presetPrompt = preset?.prompt.trim() ?? "";
  // A denied reporting probe becomes a visible evidence gap instead of a retry or guessed result.
  const reportingProbeFallback =
    "If a requested runtime probe (bash/npm/node) is denied or unavailable, record the literal denial or unavailability, continue with available read-only evidence, state what was not verified, and do not retry, bypass the profile, or infer a result.";
  // Workspace users see the approval rule; reporting users see their runner's actual enforcement.
  const writeAccessGuidance =
    accessMode === "workspace"
      ? "Write behavior: this preset may write only after the prompt or user explicitly approves it."
      : runner === "codex"
        ? `Write behavior: this terminal is reporting-only. Local report/build artifacts may be written, but the Codex permission profile blocks tracked project writes; start a write-enabled preset or manual session for implementation. ${reportingProbeFallback}`
        : runner === "claude"
          ? `Write behavior: this terminal is reporting-only. Local report artifacts may be written, but the Claude permission overlay blocks tracked project writes; start a write-enabled preset or manual session for implementation. ${reportingProbeFallback}`
          : `Write behavior: this terminal is reporting-only. Do not write tracked project files; this runner relies on prompt and hook guardrails rather than a native filesystem profile. ${reportingProbeFallback}`;
  // Goat Plan and Critique presets show the extra ownership rule users need for that route.
  const routeGuidance =
    preset?.route === "goat-plan" && /^\/goat-plan\b/.test(presetPrompt)
      ? "goat-plan global mode: honor Step 0 modes; analysis/path-only stay read-only, while File-Write modes may create target .goat-flow/plans when this preset allows writes or the prompt explicitly requests files."
      : preset?.route === "goat-critique" &&
          /^\/goat-critique\b/.test(presetPrompt)
        ? "goat-critique global mode: keep gitignored critique logs/artifacts in the controlling workspace; do not write goat-flow logs in the selected target unless the user explicitly makes that target the controlling workspace."
        : "";
  // Custom and unrelated presets need no extra route line in the launch prompt.
  const routeGuidanceLines = routeGuidance ? [`- ${routeGuidance}`] : [];
  return [
    "GOAT Flow target context:",
    `- Controlling workspace for goat skills/reference files: ${controllingWorkspace}`,
    `- Selected target project for code evidence: ${dashboardContext.projectPath}`,
    `- Runner: ${runner}`,
    "- Target projects do not need goat-flow installed; missing target .goat-flow, skills, hooks, or stale goat-flow files are normal unless this preset audits goat-flow installation.",
    `- Use target-scoped commands such as git -C ${dashboardShellQuote(dashboardContext.projectPath)} status when inspecting the selected target.`,
    `- ${writeAccessGuidance}`,
    ...routeGuidanceLines,
  ].join("\n");
}

// Read loaded xterm.js constructors; throws if asset loading did not attach globals.
function getXtermConstructors(): {
  Terminal: NonNullable<Window["Terminal"]>;
  FitAddon: new () => FitAddonInstance;
} {
  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon?.FitAddon;
  // Launch cannot mount the pane until both terminal assets have attached their browser globals.
  if (!Terminal || !FitAddon) {
    throw new Error("xterm.js globals unavailable after load");
  }
  return { Terminal, FitAddon };
}

/**
 * Send or queue prompt text for a specific session while preserving the user's active tab.
 *
 * @param ctx - dashboard state supplying the session, socket, and prompt adapter
 * @param sessionId - receiving session; an unknown id reports that no terminal is active
 * @param text - prompt text; empty text still follows adaptation and submission rather than being rejected here
 * @returns true when the paste was sent or queued; false reports a missing session or closed socket as a toast
 */
function dashboardSendToTerminalSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
  text: string,
  { adapt = true }: { adapt?: boolean } = {},
): boolean {
  const target = ctx.sessions.find((session) => session.id === sessionId);
  // A prompt sent after its session row was removed has no terminal destination.
  if (!target) {
    ctx.showToast("No active terminal session", true);
    return false;
  }
  const refs = ctx._terminalRefs[sessionId];
  // A disconnected pane cannot accept another prompt; show the user why it was not sent.
  if (!refs?.ws || refs.ws.readyState !== WebSocket.OPEN) {
    ctx.showToast("No active terminal session", true);
    return false;
  }
  // Dashboard sends normally adapt the prompt to its runner; already-adapted launch text can bypass that step.
  const prepared = dashboardPreparePasteBody(
    adapt ? ctx.adaptPrompt(text, target.runner) : text,
  );
  // Bracketed paste keeps a multiline prompt together; its runner-specific submit waits for a paste marker or a bounded fallback.
  const pasteData = "\x1b[200~" + prepared + "\x1b[201~";
  // Claude/Antigravity multiline pastes wait for commit; single-line pastes submit immediately because they render without a marker.
  // Verify this assumption against captured `agy` PTY output before changing it.
  const isMultiLinePaste = prepared.includes("\n");
  const delayedSubmit =
    (target.runner === "claude" || target.runner === "antigravity") &&
    isMultiLinePaste;
  dashboardSendOrQueueBracketedPaste(ctx, sessionId, {
    data: pasteData,
    shouldDelaySubmit: delayedSubmit,
  });
  dashboardClearAwaitingInputTimer(ctx, sessionId);
  target.lastInputTime = Date.now();
  target.awaitingInput = false;
  // Focus the receiving pane only when it is already the user's active tab.
  if (ctx.activeSessionId === sessionId && refs.xterm) refs.xterm.focus();
  return true;
}

// Send text to the active terminal session and focus it.
function dashboardSendToTerminal(
  ctx: DashboardTerminalContext,
  text: string,
  { adapt = true }: { adapt?: boolean } = {},
): boolean {
  const active = ctx._activeSession;
  // Sending a prompt without an active terminal shows a toast instead of choosing a session for the user.
  if (!active) {
    ctx.showToast("No active terminal session", true);
    return false;
  }
  return dashboardSendToTerminalSession(ctx, active.id, text, { adapt });
}

// Cancel the absolute fallback for one pending dashboard launch prompt.
function dashboardClearLaunchPromptFallbackTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // There is no forced-delivery deadline to cancel for a pane without this pending timer.
  if (!refs?.launchPromptFallbackTimer) return;
  clearTimeout(refs.launchPromptFallbackTimer);
  refs.launchPromptFallbackTimer = undefined;
}

// Cancel quiet-window delivery for one pending dashboard launch prompt.
function dashboardClearLaunchPromptQuietTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // No quiet-window timer means output settling is not currently waiting to deliver the prompt.
  if (!refs?.launchPromptQuietTimer) return;
  clearTimeout(refs.launchPromptQuietTimer);
  refs.launchPromptQuietTimer = undefined;
}

// Clear any pending dashboard launch prompt state for one terminal session.
function dashboardClearLaunchPrompt(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // A removed pane owns no pending launch prompt or delivery timers.
  if (!refs) return;
  dashboardClearLaunchPromptFallbackTimer(ctx, sessionId);
  dashboardClearLaunchPromptQuietTimer(ctx, sessionId);
  refs.launchPrompt = undefined;
  refs.launchPromptOutputSeen = false;
}

/**
 * Deliver the saved launch prompt when the runner is ready, or when an allowed fallback requests delivery.
 *
 * @returns true when the prompt was sent or queued; false means no prompt, a failed/closed session, or readiness is still pending
 */
function dashboardMaybeSendLaunchPrompt(
  ctx: DashboardTerminalContext,
  sessionId: string,
  { force = false }: { force?: boolean } = {},
): boolean {
  const refs = ctx._terminalRefs[sessionId];
  const prompt = refs?.launchPrompt;
  // An absent or empty prompt has no launch text waiting to be delivered.
  if (!prompt) return false;
  const target = ctx.sessions.find((session) => session.id === sessionId);
  // A removed or ended session cannot receive its pending launch prompt.
  if (!target || target.ended) {
    dashboardClearLaunchPrompt(ctx, sessionId);
    return false;
  }
  // Keep the pending prompt until the attached socket can deliver it.
  if (!refs.ws || refs.ws.readyState !== WebSocket.OPEN) return false;
  // A runner that has not produced captured text has no readiness or startup-failure evidence yet.
  const outputTail = target.outputTail ?? "";
  // A visible runner startup failure replaces loading feedback and cancels this launch's unsent prompt.
  if (dashboardOutputLooksRunnerStartupFailure(outputTail, target.runner)) {
    dashboardSetTerminalLoadingPhase(
      ctx,
      sessionId,
      target,
      "error",
      dashboardRunnerStartupFailureMessage(outputTail),
    );
    dashboardClearLaunchPrompt(ctx, sessionId);
    return false;
  }
  const ready = dashboardOutputLooksReadyForLaunchPrompt(
    outputTail,
    target.runner,
  );
  // Normal delivery waits for readiness; Antigravity keeps that requirement even when a fallback requests a forced send.
  if (!ready && (!force || target.runner === "antigravity")) {
    return false;
  }
  refs.launchPrompt = undefined;
  dashboardClearLaunchPromptFallbackTimer(ctx, sessionId);
  dashboardClearLaunchPromptQuietTimer(ctx, sessionId);
  refs.launchPromptOutputSeen = false;
  return dashboardSendToTerminalSession(ctx, sessionId, prompt, {
    adapt: false,
  });
}

// Arm the conservative fallback used only if the runner produces no output.
function dashboardArmLaunchPromptNoOutputFallback(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // Arm only one deadline for an unsent prompt on an open socket before any runner output has arrived.
  if (
    !refs?.launchPrompt ||
    refs.launchPromptOutputSeen === true ||
    refs.launchPromptFallbackTimer ||
    !refs.ws ||
    refs.ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  refs.launchPromptFallbackTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    // The pane may have closed during the wait; clear its deadline only while its refs remain.
    if (currentRefs) currentRefs.launchPromptFallbackTimer = undefined;
    dashboardMaybeSendLaunchPrompt(ctx, sessionId, { force: true });
  }, TERMINAL_LAUNCH_PROMPT_NO_OUTPUT_FALLBACK_DELAY_MS);
}

/**
 * Bound the wait after runner output arrives so prompts can reach runners without a recognized readiness marker.
 *
 * This timer requests forced delivery; Antigravity still needs the readiness check in dashboardMaybeSendLaunchPrompt.
 * The separate quiet-window timer also requests delivery once output settles.
 */
function dashboardArmLaunchPromptAfterOutputFallback(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // No unsent prompt needs a deadline, and an existing deadline should keep its original start time.
  if (!refs?.launchPrompt || refs.launchPromptFallbackTimer) return;
  refs.launchPromptFallbackTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    // A pane still present can release the fired deadline before trying prompt delivery.
    if (currentRefs) currentRefs.launchPromptFallbackTimer = undefined;
    dashboardMaybeSendLaunchPrompt(ctx, sessionId, { force: true });
  }, TERMINAL_LAUNCH_PROMPT_AFTER_OUTPUT_FALLBACK_DELAY_MS);
}

// Schedule prompt delivery after runner output has settled.
function dashboardScheduleLaunchPromptQuietSend(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // Quiet output matters only while a prompt is waiting on a connected pane.
  if (!refs?.launchPrompt || !refs.ws || refs.ws.readyState !== WebSocket.OPEN)
    return;
  dashboardClearLaunchPromptQuietTimer(ctx, sessionId);
  refs.launchPromptQuietTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    // A closed pane has no quiet-window state to clear when this timer fires.
    if (currentRefs) currentRefs.launchPromptQuietTimer = undefined;
    dashboardMaybeSendLaunchPrompt(ctx, sessionId, { force: true });
  }, TERMINAL_LAUNCH_PROMPT_QUIET_DELAY_MS);
}

// React to a new output chunk while a dashboard launch prompt is pending.
function dashboardHandleLaunchPromptOutput(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  // Once launch text has been sent or cleared, later output needs no delivery tracking.
  if (!refs?.launchPrompt) return;
  const firstOutput = refs.launchPromptOutputSeen !== true;
  refs.launchPromptOutputSeen = true;
  // A readiness marker can send the prompt now and ends this output chunk's scheduling work.
  if (dashboardMaybeSendLaunchPrompt(ctx, sessionId)) return;
  // The first output replaces the silent-runner deadline with the deadline for a live output stream.
  if (firstOutput) {
    dashboardClearLaunchPromptFallbackTimer(ctx, sessionId);
    dashboardArmLaunchPromptAfterOutputFallback(ctx, sessionId);
  }
  dashboardScheduleLaunchPromptQuietSend(ctx, sessionId);
}

// Send a dashboard launch prompt after the browser terminal is attached.
function dashboardScheduleLaunchPrompt(
  ctx: DashboardTerminalContext,
  sessionId: string,
  prompt: string,
): void {
  // A blank launch intentionally starts without prompt text and needs no delivery timers.
  if (!prompt.trim()) return;
  dashboardClearLaunchPrompt(ctx, sessionId);
  // A newly created session may receive its launch prompt before its terminal pane attaches.
  const refs = ctx._terminalRefs[sessionId] ?? {};
  refs.launchPrompt = prompt;
  refs.launchPromptOutputSeen = false;
  ctx._terminalRefs[sessionId] = refs;
  dashboardArmLaunchPromptNoOutputFallback(ctx, sessionId);
  dashboardMaybeSendLaunchPrompt(ctx, sessionId);
}
