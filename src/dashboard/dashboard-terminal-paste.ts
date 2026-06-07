/**
 * Dashboard terminal paste and launch-prompt lifecycle helpers.
 */
function dashboardMutateLocalSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
  mutate: (session: LocalSession) => void,
): void {
  const reactive = ctx.sessions.find((s) => s.id === sessionId);
  if (reactive) mutate(reactive);
  if (reactive !== fallback) mutate(fallback);
}

/** Clear the loading-overlay escalation timers for one terminal session. */
function dashboardClearTerminalLoadingTimers(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs) return;
  if (refs.loadingSlowTimer) {
    clearTimeout(refs.loadingSlowTimer);
    refs.loadingSlowTimer = undefined;
  }
  if (refs.loadingRetryTimer) {
    clearTimeout(refs.loadingRetryTimer);
    refs.loadingRetryTimer = undefined;
  }
}

/** Move one session through the terminal loading-overlay state machine. */
function dashboardSetTerminalLoadingPhase(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
  phase: TerminalLoadingPhase,
  error?: string,
): void {
  if (phase === "ready" || phase === "error") {
    dashboardClearTerminalLoadingTimers(ctx, sessionId);
  }
  dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
    target.loadingPhase = phase;
    if (phase === "error") {
      target.loadingError = error ?? "Could not start session.";
      target.loadingShowRetry = true;
    } else {
      target.loadingError = undefined;
      if (phase === "ready") {
        target.loadingShowSlowHint = false;
        target.loadingShowRetry = false;
      }
    }
  });
}

/** Arm the slow-start and retry affordances for the loading overlay. */
function dashboardArmTerminalLoadingTimers(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs) return;
  dashboardClearTerminalLoadingTimers(ctx, sessionId);
  refs.loadingSlowTimer = setTimeout(() => {
    refs.loadingSlowTimer = undefined;
    const current = ctx.sessions.find((s) => s.id === sessionId) ?? fallback;
    if (current.ended || current.loadingPhase === "ready") return;
    dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
      target.loadingShowSlowHint = true;
    });
  }, TERMINAL_LOADING_SLOW_HINT_MS);
  refs.loadingRetryTimer = setTimeout(() => {
    refs.loadingRetryTimer = undefined;
    const current = ctx.sessions.find((s) => s.id === sessionId) ?? fallback;
    if (current.ended || current.loadingPhase === "ready") return;
    dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
      target.loadingShowRetry = true;
    });
  }, TERMINAL_LOADING_RETRY_MS);
}

/** Mark the loading overlay ready as soon as the PTY sends its first output. */
function dashboardMarkTerminalLoadingReady(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
  previousTail: string,
  output: string,
): void {
  if (previousTail.length > 0 || output.length === 0) return;
  dashboardSetTerminalLoadingPhase(ctx, sessionId, fallback, "ready");
}

/** Cancel a pending "awaiting input" reveal for one terminal session. */
function dashboardClearAwaitingInputTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.awaitingInputTimer) return;
  clearTimeout(refs.awaitingInputTimer);
  refs.awaitingInputTimer = undefined;
}

/** Show the waiting badge only after waiting-looking output stays quiet. */
function dashboardScheduleAwaitingInputReveal(
  ctx: DashboardTerminalContext,
  sessionId: string,
  fallback: LocalSession,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs || refs.awaitingInputTimer) return;
  refs.awaitingInputTimer = setTimeout(() => {
    refs.awaitingInputTimer = undefined;
    const reactive = ctx.sessions.find((s) => s.id === sessionId);
    const current = reactive ?? fallback;
    if (current.ended) return;
    if (!dashboardOutputLooksAwaitingInput(current.outputTail ?? "")) return;
    dashboardMutateLocalSession(ctx, sessionId, fallback, (target) => {
      target.awaitingInput = true;
    });
  }, AWAITING_INPUT_VISIBLE_DELAY_MS);
}

/** Cancel a delayed submit for a bracketed paste. */
function dashboardClearPasteSubmitTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.pasteSubmitTimer) return;
  clearTimeout(refs.pasteSubmitTimer);
  refs.pasteSubmitTimer = undefined;
}

/** Cancel all pending delayed submit state for a bracketed paste. */
function dashboardClearPasteSubmitState(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  dashboardClearPasteSubmitTimer(ctx, sessionId);
  const refs = ctx._terminalRefs[sessionId];
  if (refs) {
    refs.pasteSubmitQueue = undefined;
    refs.pasteSubmitOutputTail = undefined;
    refs.pasteSubmitAwaitingCommit = false;
    refs.pasteSubmitFallbackSubmitted = false;
  }
}

/** Submit the current terminal composer if the session is still attached. */
function dashboardSendTerminalSubmit(
  ctx: DashboardTerminalContext,
  sessionId: string,
): boolean {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.ws || refs.ws.readyState !== WebSocket.OPEN) return false;
  refs.ws.send(JSON.stringify({ type: "input", data: "\r" }));
  return true;
}

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
  if (!refs) return;
  dashboardClearPasteSubmitTimer(ctx, sessionId);
  if (retryCount === 0) refs.pasteSubmitOutputTail = "";
  refs.pasteSubmitTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    if (currentRefs) currentRefs.pasteSubmitTimer = undefined;
    const submitted = dashboardSubmitPendingPaste(ctx, sessionId, {
      keepAwaitingCommit,
      retryIfStillCommitted,
    });
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

function dashboardReleaseFallbackPasteSubmit(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.pasteSubmitAwaitingCommit) return;
  refs.pasteSubmitTimer = undefined;
  refs.pasteSubmitAwaitingCommit = false;
  refs.pasteSubmitFallbackSubmitted = false;
  dashboardSendNextQueuedPaste(ctx, sessionId);
}

function dashboardArmPasteSubmitRetryIfStillCommitted(
  ctx: DashboardTerminalContext,
  sessionId: string,
  retryCount = 0,
): boolean {
  const refs = ctx._terminalRefs[sessionId];
  const target = ctx.sessions.find((session) => session.id === sessionId);
  if (!refs || typeof target?.outputTail !== "string") {
    return false;
  }
  refs.pasteSubmitTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    if (currentRefs) currentRefs.pasteSubmitTimer = undefined;
    const currentTarget = ctx.sessions.find(
      (session) => session.id === sessionId,
    );
    const currentTail = currentTarget?.outputTail ?? "";
    // The stuck-paste heuristic is the loop condition; snapshot equality was
    // only a single-shot fallback and can fire on marker text that already moved.
    if (dashboardOutputStillAtCommittedPaste(currentTail)) {
      dashboardSendTerminalSubmit(ctx, sessionId);
      const nextRetryCount = retryCount + 1;
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

function dashboardSendNextQueuedPaste(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  const next = refs?.pasteSubmitQueue?.shift();
  if (!refs || !next) return;
  if (refs.pasteSubmitQueue?.length === 0) refs.pasteSubmitQueue = undefined;
  dashboardSendBracketedPaste(ctx, sessionId, next);
}

/** Submit a bracketed paste once the runner has had time to commit it. */
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
  if (!submitted) return false;
  if (keepAwaitingCommit && refs?.pasteSubmitAwaitingCommit) {
    refs.pasteSubmitFallbackSubmitted = true;
    refs.pasteSubmitTimer = setTimeout(() => {
      dashboardReleaseFallbackPasteSubmit(ctx, sessionId);
    }, TERMINAL_PASTE_FALLBACK_RELEASE_DELAY_MS);
    return true;
  }
  if (refs) {
    refs.pasteSubmitAwaitingCommit = false;
    refs.pasteSubmitFallbackSubmitted = retryIfStillCommitted;
  }
  if (
    retryIfStillCommitted &&
    dashboardArmPasteSubmitRetryIfStillCommitted(ctx, sessionId)
  ) {
    return true;
  }
  dashboardSendNextQueuedPaste(ctx, sessionId);
  return submitted;
}

function dashboardSendBracketedPaste(
  ctx: DashboardTerminalContext,
  sessionId: string,
  paste: DashboardQueuedPaste,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.ws || refs.ws.readyState !== WebSocket.OPEN) return;
  refs.ws.send(JSON.stringify({ type: "input", data: paste.data }));
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
  } else if (dashboardSendTerminalSubmit(ctx, sessionId)) {
    dashboardSendNextQueuedPaste(ctx, sessionId);
  } else {
    dashboardArmPasteSubmitTimer(ctx, sessionId, {
      delayMs: TERMINAL_PASTE_SUBMIT_RETRY_DELAY_MS,
      retryCount: 1,
    });
  }
}

function dashboardSendOrQueueBracketedPaste(
  ctx: DashboardTerminalContext,
  sessionId: string,
  paste: DashboardQueuedPaste,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs) return;
  if (refs.pasteSubmitTimer || refs.pasteSubmitAwaitingCommit) {
    refs.pasteSubmitQueue = [...(refs.pasteSubmitQueue ?? []), paste];
    return;
  }
  dashboardSendBracketedPaste(ctx, sessionId, paste);
}

/** React to runner output while a bracketed paste submit is pending. */
function dashboardHandlePasteSubmitOutput(
  ctx: DashboardTerminalContext,
  sessionId: string,
  output: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  const target = ctx.sessions.find((session) => session.id === sessionId);
  const runnerUsesPasteMarker =
    target?.runner === "claude" || target?.runner === "antigravity";
  const hasPendingPaste =
    refs?.pasteSubmitTimer !== undefined ||
    refs?.pasteSubmitAwaitingCommit === true;
  if (!refs || (!hasPendingPaste && !runnerUsesPasteMarker)) return;
  const outputTail = ((refs.pasteSubmitOutputTail ?? "") + output).slice(-2000);
  refs.pasteSubmitOutputTail = outputTail;
  const committedPaste = dashboardOutputLooksCommittedPaste(
    hasPendingPaste ? outputTail : output,
  );
  if (committedPaste) {
    const alreadySubmitted = refs.pasteSubmitFallbackSubmitted === true;
    refs.pasteSubmitAwaitingCommit = false;
    if (alreadySubmitted) return;
    refs.pasteSubmitFallbackSubmitted = false;
    // A "[Pasted text]" marker echoed back when nothing is awaiting submit
    // means the paste was already submitted (e.g. immediate-submit path for
    // single-line pastes) or originated outside the dashboard. Don't fire a
    // spurious extra Enter.
    if (!hasPendingPaste) return;
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

/** Build target context appended to launched preset prompts. */
function dashboardGlobalLaunchContext(
  ctx: DashboardTerminalContext,
  runner: RunnerId,
  preset: Preset | null,
): string {
  const controllingWorkspace = dashboardControllingWorkspace();
  const mayWrite = preset?.mayWriteFiles === true;
  const presetPrompt = preset?.prompt.trim() ?? "";
  // Launched prompts may suggest learning-loop follow-up, but automatic
  // durable lesson/footgun/pattern/decision writes require opted-in CLI capture.
  const writeLine = mayWrite
    ? "Write behavior: this preset may write only after the prompt or user explicitly approves it."
    : "Write behavior: default to read-only analysis; do not write files in the selected target unless the user explicitly asks.";
  const routeLine =
    preset?.route === "goat-plan" && /^\/goat-plan\b/.test(presetPrompt)
      ? "goat-plan global mode: honor Step 0 modes; analysis/path-only stay read-only, while File-Write modes may create target .goat-flow/plans when this preset allows writes or the prompt explicitly requests files."
      : preset?.route === "goat-critique" &&
          /^\/goat-critique\b/.test(presetPrompt)
        ? "goat-critique global mode: keep gitignored critique logs/artifacts in the controlling workspace; do not write goat-flow logs in the selected target unless the user explicitly makes that target the controlling workspace."
        : "";
  return [
    "GOAT Flow target context:",
    `- Controlling workspace for goat skills/reference files: ${controllingWorkspace}`,
    `- Selected target project for code evidence: ${ctx.projectPath}`,
    `- Runner: ${runner}`,
    "- Target projects do not need goat-flow installed; missing target .goat-flow, skills, hooks, or stale goat-flow files are normal unless this preset audits goat-flow installation.",
    `- Use target-scoped commands such as git -C ${dashboardShellQuote(ctx.projectPath)} status when inspecting the selected target.`,
    `- ${writeLine}`,
    ...(routeLine ? [`- ${routeLine}`] : []),
  ].join("\n");
}

/** Read loaded xterm.js constructors; throws if asset loading did not attach globals. */
function getXtermConstructors(): {
  Terminal: NonNullable<Window["Terminal"]>;
  FitAddon: new () => FitAddonInstance;
} {
  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon?.FitAddon;
  if (!Terminal || !FitAddon) {
    throw new Error("xterm.js globals unavailable after load");
  }
  return { Terminal, FitAddon };
}

/** Send text to a specific terminal session without changing the active tab. */
function dashboardSendToTerminalSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
  text: string,
  { adapt = true }: { adapt?: boolean } = {},
): boolean {
  const target = ctx.sessions.find((session) => session.id === sessionId);
  if (!target) {
    ctx.showToast("No active terminal session", true);
    return false;
  }
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.ws || refs.ws.readyState !== WebSocket.OPEN) {
    ctx.showToast("No active terminal session", true);
    return false;
  }
  const prepared = dashboardPreparePasteBody(
    adapt ? ctx.adaptPrompt(text, target.runner) : text,
  );
  // Bracketed paste prevents shells and REPLs from treating multi-line prompts as
  // a stream of independent keystrokes. Claude Code commits long pastes
  // asynchronously, so submit on its pasted-text echo or fall back after a short
  // bounded delay for CLIs that do not echo that state.
  const pasteData = "\x1b[200~" + prepared + "\x1b[201~";
  // Claude/Antigravity only compress MULTI-LINE pastes into the "[Pasted text]"
  // marker we detect to submit fast. Single-line pastes render inline with no
  // marker, so waiting hits the 15s fallback. Submit those immediately to
  // match the existing single-line/non-Claude semantics. Verify this
  // assumption against captured `agy` PTY output before changing it.
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
  if (ctx.activeSessionId === sessionId && refs.xterm) refs.xterm.focus();
  return true;
}

/** Send text to the active terminal session and focus it. */
function dashboardSendToTerminal(
  ctx: DashboardTerminalContext,
  text: string,
  { adapt = true }: { adapt?: boolean } = {},
): boolean {
  const active = ctx._activeSession;
  if (!active) {
    ctx.showToast("No active terminal session", true);
    return false;
  }
  return dashboardSendToTerminalSession(ctx, active.id, text, { adapt });
}

/** Cancel the absolute fallback for one pending dashboard launch prompt. */
function dashboardClearLaunchPromptFallbackTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.launchPromptFallbackTimer) return;
  clearTimeout(refs.launchPromptFallbackTimer);
  refs.launchPromptFallbackTimer = undefined;
}

/** Cancel quiet-window delivery for one pending dashboard launch prompt. */
function dashboardClearLaunchPromptQuietTimer(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.launchPromptQuietTimer) return;
  clearTimeout(refs.launchPromptQuietTimer);
  refs.launchPromptQuietTimer = undefined;
}

/** Clear any pending dashboard launch prompt state for one terminal session. */
function dashboardClearLaunchPrompt(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs) return;
  dashboardClearLaunchPromptFallbackTimer(ctx, sessionId);
  dashboardClearLaunchPromptQuietTimer(ctx, sessionId);
  refs.launchPrompt = undefined;
  refs.launchPromptOutputSeen = false;
}

/** Send a pending dashboard launch prompt once the terminal is ready. */
function dashboardMaybeSendLaunchPrompt(
  ctx: DashboardTerminalContext,
  sessionId: string,
  { force = false }: { force?: boolean } = {},
): boolean {
  const refs = ctx._terminalRefs[sessionId];
  const prompt = refs?.launchPrompt;
  if (!prompt) return false;
  const target = ctx.sessions.find((session) => session.id === sessionId);
  if (!target || target.ended) {
    dashboardClearLaunchPrompt(ctx, sessionId);
    return false;
  }
  if (!refs.ws || refs.ws.readyState !== WebSocket.OPEN) return false;
  const outputTail = target.outputTail ?? "";
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

/** Arm the conservative fallback used only if the runner produces no output. */
function dashboardArmLaunchPromptNoOutputFallback(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
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
    if (currentRefs) currentRefs.launchPromptFallbackTimer = undefined;
    dashboardMaybeSendLaunchPrompt(ctx, sessionId, { force: true });
  }, TERMINAL_LAUNCH_PROMPT_NO_OUTPUT_FALLBACK_DELAY_MS);
}

/**
 * Arm a short cap once runner output proves the PTY stream is live. The cap
 * is unconditional by design: it exists for runners that emit output but never
 * surface a known readiness marker (custom prompts, alternate CLIs). Gating
 * the force-send on a readiness check would stall those sessions forever; the
 * sibling quiet-window path covers the more common "output settles then send"
 * case.
 */
function dashboardArmLaunchPromptAfterOutputFallback(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.launchPrompt || refs.launchPromptFallbackTimer) return;
  refs.launchPromptFallbackTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    if (currentRefs) currentRefs.launchPromptFallbackTimer = undefined;
    dashboardMaybeSendLaunchPrompt(ctx, sessionId, { force: true });
  }, TERMINAL_LAUNCH_PROMPT_AFTER_OUTPUT_FALLBACK_DELAY_MS);
}

/** Schedule prompt delivery after runner output has settled. */
function dashboardScheduleLaunchPromptQuietSend(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.launchPrompt || !refs.ws || refs.ws.readyState !== WebSocket.OPEN)
    return;
  dashboardClearLaunchPromptQuietTimer(ctx, sessionId);
  refs.launchPromptQuietTimer = setTimeout(() => {
    const currentRefs = ctx._terminalRefs[sessionId];
    if (currentRefs) currentRefs.launchPromptQuietTimer = undefined;
    dashboardMaybeSendLaunchPrompt(ctx, sessionId, { force: true });
  }, TERMINAL_LAUNCH_PROMPT_QUIET_DELAY_MS);
}

/** React to a new output chunk while a dashboard launch prompt is pending. */
function dashboardHandleLaunchPromptOutput(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const refs = ctx._terminalRefs[sessionId];
  if (!refs?.launchPrompt) return;
  const firstOutput = refs.launchPromptOutputSeen !== true;
  refs.launchPromptOutputSeen = true;
  if (dashboardMaybeSendLaunchPrompt(ctx, sessionId)) return;
  if (firstOutput) {
    dashboardClearLaunchPromptFallbackTimer(ctx, sessionId);
    dashboardArmLaunchPromptAfterOutputFallback(ctx, sessionId);
  }
  dashboardScheduleLaunchPromptQuietSend(ctx, sessionId);
}

/** Send a dashboard launch prompt after the browser terminal is attached. */
function dashboardScheduleLaunchPrompt(
  ctx: DashboardTerminalContext,
  sessionId: string,
  prompt: string,
): void {
  if (!prompt.trim()) return;
  dashboardClearLaunchPrompt(ctx, sessionId);
  const refs = ctx._terminalRefs[sessionId] ?? {};
  refs.launchPrompt = prompt;
  refs.launchPromptOutputSeen = false;
  ctx._terminalRefs[sessionId] = refs;
  dashboardArmLaunchPromptNoOutputFallback(ctx, sessionId);
  dashboardMaybeSendLaunchPrompt(ctx, sessionId);
}

/** Send a preset prompt to an active session in the current project. */
