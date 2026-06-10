/**
 * Browser-side Alpine.js data model for the GOAT Flow dashboard.
 * This stays as a classic script because the dashboard shell loads it with a
 * plain `<script>` tag rather than an ES module import.
 */

type ProjectSortKey = "name" | "state" | "action" | "details";
type HookFilter = "all" | "enabled" | "disabled" | "drift";
type HookSection = "safety" | "git" | "quality";
type HookTone = "danger" | "warning" | "neutral";

/** Decoded terminal upload response used to paste notes and report rejected files. */
interface TerminalUploadResult {
  note: string;
  accepted: unknown[];
  rejected: unknown[];
}

/** Encode dropped terminal image files into the JSON payload expected by the upload route. */
async function encodeTerminalUploadFiles(files: File[]) {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      data: await dashboardFileToBase64(file),
    })),
  );
}

/** Decode the terminal upload response fields used for paste notes and toasts. */
function readTerminalUploadResult(payload: JsonRecord): TerminalUploadResult {
  return {
    note: typeof payload.note === "string" ? payload.note : "",
    accepted: Array.isArray(payload.accepted) ? payload.accepted : [],
    rejected: Array.isArray(payload.rejected) ? payload.rejected : [],
  };
}

/** Decode one rejected upload entry into the user-facing file name and reason. */
function readRejectedTerminalUpload(entry: unknown): {
  name: string;
  reason: string;
} {
  const record = isRecord(entry) ? entry : {};
  return {
    name:
      typeof record["originalName"] === "string"
        ? record["originalName"]
        : "file",
    reason:
      typeof record["reason"] === "string"
        ? record["reason"]
        : "unknown reason",
  };
}

/** Paste terminal upload notes and surface accepted/rejected file feedback. */
function showTerminalUploadResult(
  ctx: DashboardTerminalContext,
  sessionId: string,
  result: TerminalUploadResult,
): void {
  if (result.note.length > 0) {
    dashboardSendToTerminalSession(ctx, sessionId, result.note, {
      adapt: false,
    });
  }
  if (result.rejected.length > 0) {
    for (const entry of result.rejected) {
      const rejected = readRejectedTerminalUpload(entry);
      ctx.showToast(`Rejected ${rejected.name}: ${rejected.reason}`, true);
    }
    return;
  }
  if (result.accepted.length > 0) {
    ctx.showToast(
      `Attached ${result.accepted.length} image${result.accepted.length === 1 ? "" : "s"}`,
      false,
    );
  }
}

/**
 * Alpine.js data factory for the dashboard shell.
 * Fragments merge into one classic-script object because Alpine binds methods by
 * property name from server-rendered HTML. The descriptor-preserving merge keeps
 * getters/setters intact while letting large view clusters live in smaller files.
 */
function app() {
  const supportedAgents = readInjectedSupportedAgents();
  const defaultRunner = supportedAgents[0]?.id ?? "claude";
  const defaultSetupAgents = buildDefaultSetupAgents(
    supportedAgents,
    defaultRunner,
  );
  return dashboardMergeAppFragments(
    dashboardCoreStateFragment(supportedAgents, defaultRunner),
    dashboardActiveTerminalSessionFragment(),
    dashboardTerminalStatusAccessorsFragment(),
    dashboardWorkspaceCollectionsStateFragment(),
    dashboardQualitySetupStateFragment(
      supportedAgents,
      defaultRunner,
      defaultSetupAgents,
    ),
    dashboardPromptBrowserStateFragment(),
    dashboardCustomPromptValidationFragment(),
    dashboardCustomPromptEditorActionsFragment(),
    dashboardQualityPromptActionsFragment(),
    dashboardTerminalImageUploadFragment(),
    dashboardAuditAndNavigationActionsFragment(),
    dashboardAgentPlanHookLoadersFragment(supportedAgents),
    dashboardHookSetupActionsFragment(supportedAgents),
    dashboardSetupQualityLoadersFragment(),
    dashboardSkillQualityInventoryLoadersFragment(),
    dashboardSkillQualityReportFragment(),
    dashboardSkillEvaluatorResultFragment(),
    dashboardSkillEvaluatorClipboardFragment(),
    dashboardSkillEvaluatorInputFragment(),
    dashboardProjectActionsFragment(),
    dashboardUtilityActionsFragment(),
    dashboardTerminalLaunchActionsFragment(),
    dashboardTerminalSessionActionsFragment(),
    dashboardTimeFormattingFragment(),
  );
}
