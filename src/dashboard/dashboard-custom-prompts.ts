/**
 * Custom prompt-library helpers for the dashboard Alpine app.
 * Custom prompts stay browser-local and separate from the built-in JSON catalog.
 */

const CUSTOM_PROMPT_STORAGE_KEY = "goat-flow-custom-prompts";
const CUSTOM_PROMPT_ROUTES = new Set([
  "direct",
  "goat",
  "goat-critique",
  "goat-debug",
  "goat-plan",
  "goat-qa",
  "goat-review",
  "goat-security",
  "goat-clarity",
]);

const DEFAULT_CUSTOM_PROMPT_ROUTE: CustomPromptRouteOption = {
  id: "direct",
  label: "direct",
  desc: "Launch the prompt exactly as written without a goat skill wrapper.",
};

const CUSTOM_PROMPT_ROUTE_OPTIONS: CustomPromptRouteOption[] = [
  DEFAULT_CUSTOM_PROMPT_ROUTE,
  {
    id: "goat",
    label: "goat",
    desc: "Choose the right goat workflow from the outcome you describe.",
  },
  {
    id: "goat-debug",
    label: "goat-debug",
    desc: "Diagnose bugs, unexpected behavior, or unfamiliar code paths.",
  },
  {
    id: "goat-review",
    label: "goat-review",
    desc: "Review a diff, PR, or code area for quality and correctness issues.",
  },
  {
    id: "goat-qa",
    label: "goat-qa",
    desc: "Assess testing gaps, coverage risk, and verification strategy.",
  },
  {
    id: "goat-plan",
    label: "goat-plan",
    desc: "Break non-trivial work into scoped, testable implementation steps.",
  },
  {
    id: "goat-critique",
    label: "goat-critique",
    desc: "Run multi-lens critique on a plan, report, or decision artifact.",
  },
  {
    id: "goat-security",
    label: "goat-security",
    desc: "Assess security implications, supply-chain risk, and agent surfaces.",
  },
  {
    id: "goat-clarity",
    label: "goat-clarity",
    desc: "Improve comments, names, and private placement within one frozen target.",
  },
];

const CUSTOM_PROMPT_FLAG_GROUPS: CustomPromptFlagGroup[] = [
  {
    id: "prerequisites",
    label: "Prerequisites",
    flags: [
      {
        field: "requiresGh",
        label: "Requires gh",
        title:
          "Uses GitHub CLI when available; provide fallback context if gh is missing.",
      },
      {
        field: "requiresPrOrIssue",
        label: "Needs PR",
        title: "Needs a PR, issue, branch, or pasted diff context.",
      },
      {
        field: "requiresLocalDiff",
        label: "Needs diff",
        title:
          "Needs local changes, a branch comparison, or pasted diff context.",
      },
      {
        field: "requiresDependencyFiles",
        label: "Dependency files",
        title: "Needs package manifests or lockfiles for dependency evidence.",
      },
      {
        field: "requiresGoatFlowInstall",
        label: "GOAT install",
        title:
          "Requires goat-flow installed in the selected target; disables Global safe.",
      },
      {
        field: "artifactRequired",
        label: "Artifact required",
        title: "Needs a plan, report, or other artifact to assess.",
      },
    ],
  },
  {
    id: "permissions",
    label: "Permissions",
    flags: [
      {
        field: "mayCheckoutBranch",
        label: "May checkout",
        title:
          "May ask to checkout a branch after clean-worktree confirmation.",
      },
      {
        field: "mayWriteFiles",
        label: "May write",
        title:
          "May write files only when the prompt or user explicitly approves it.",
      },
    ],
  },
  {
    id: "compatibility",
    label: "Compatibility",
    flags: [
      {
        field: "requiresUiApp",
        label: "UI workflow",
        title: "Best suited to app/UI testing.",
      },
      {
        field: "globalSafe",
        label: "Global safe",
        title:
          "Default: can run against external target projects without goat-flow installed. Disabled when GOAT install is required.",
      },
    ],
  },
];

/** Prompt metadata subset used to apply the same global-safety gate to drafts and stored prompts. */
interface PromptGlobalSafetyInput {
  requiresGoatFlowInstall?: boolean | undefined;
  globalSafe?: boolean | undefined;
}

/** Goat-flow-installed prompts are target-local because external targets may not carry the harness. */
function dashboardGlobalSafeAllowed(prompt: PromptGlobalSafetyInput): boolean {
  return prompt.requiresGoatFlowInstall !== true;
}

/** Persisted `globalSafe` is advisory; this enforces the harness-install override every time it is read. */
function dashboardResolvedGlobalSafe(prompt: PromptGlobalSafetyInput): boolean {
  return prompt.globalSafe === true && dashboardGlobalSafeAllowed(prompt);
}

/** Stable Alpine state schema mutated by custom-prompt helpers and mirrored by VM-based unit tests. */
interface DashboardCustomPromptsContext {
  customPrompts: CustomPrompt[];
  customPromptDraft: CustomPromptDraft;
  customPromptSurfaceDraft?: string;
  customPromptSubmitAttempted?: boolean;
  editingCustomPromptId: string | null;
  showCustomPromptEditor: boolean;
  selectedPreset: Preset | null;
  allPresets?: Preset[];
  /** Report validation and persistence outcomes through the dashboard toast channel. */
  showToast(msg: string, isError?: boolean): void;
}

/** Create a new form draft with external-target-safe defaults and no inferred route state. */
function dashboardDefaultCustomPromptDraft(): CustomPromptDraft {
  return {
    name: "",
    desc: "",
    prompt: "",
    route: "direct",
    runnerHint: "any",
    requiresGh: false,
    requiresPrOrIssue: false,
    requiresLocalDiff: false,
    requiresUiApp: false,
    requiresDependencyFiles: false,
    requiresGoatFlowInstall: false,
    mayCheckoutBranch: false,
    requiresCleanWorktree: false,
    mayWriteFiles: false,
    artifactRequired: false,
    globalSafe: true,
    bestTargetSurfacesText: "repo",
    notes: "",
  };
}

/** Infer a goat route from legacy slash/dollar prompt text before the editor route pill takes over. */
function dashboardInferPromptRoute(prompt: string): string {
  const match = prompt.trim().match(/^(?:\/|\$)(goat(?:-[a-z]+)?)\b/);
  return match?.[1] ?? "direct";
}

/** Build a storage id suffix from a user label while avoiding empty `custom:` ids. */
function dashboardSlugifyCustomPromptName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "prompt";
}

/** Expose the shared route option list so the form and tests cannot drift apart. */
function dashboardCustomPromptRouteOptions(): CustomPromptRouteOption[] {
  return CUSTOM_PROMPT_ROUTE_OPTIONS;
}

/** Expose the grouped flag metadata used by the custom-prompt form controls. */
function dashboardCustomPromptFlagGroups(): CustomPromptFlagGroup[] {
  return CUSTOM_PROMPT_FLAG_GROUPS;
}

function dashboardSelectedCustomPromptRoute(
  draft: CustomPromptDraft,
): CustomPromptRouteOption {
  return (
    CUSTOM_PROMPT_ROUTE_OPTIONS.find((route) => route.id === draft.route) ??
    DEFAULT_CUSTOM_PROMPT_ROUTE
  );
}

/** Canonicalize target-surface labels so user-entered chips and stored presets compare reliably. */
function dashboardNormalizeSurfaceTag(surface: string): string {
  return surface.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Parse comma-separated target surfaces while preserving first-seen display order. */
function dashboardParseTargetSurfaces(text: string): string[] {
  const seen = new Set<string>();
  const surfaces: string[] = [];
  for (const raw of text.split(",")) {
    const surface = dashboardNormalizeSurfaceTag(raw);
    if (!surface || seen.has(surface)) continue;
    seen.add(surface);
    surfaces.push(surface);
  }
  return surfaces;
}

/** Serialize canonical surface tags back into the editable comma-separated field. */
function dashboardJoinTargetSurfaces(surfaces: string[]): string {
  return surfaces.map(dashboardNormalizeSurfaceTag).filter(Boolean).join(", ");
}

/** Read legacy localStorage booleans defensively; non-booleans become false. */
function dashboardReadBoolean(storedValue: unknown): boolean {
  return typeof storedValue === "boolean" ? storedValue : false;
}

/** Read manifest-provided runner ids from the page so custom prompts do not hard-code agents. */
function dashboardKnownRunnerIds(): string[] {
  return Array.isArray(window.__GOAT_FLOW_RUNNER_IDS__)
    ? window.__GOAT_FLOW_RUNNER_IDS__.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
}

/** Narrow a saved runner hint to the runtime runner ids advertised by the dashboard page. */
function dashboardIsKnownRunnerId(runnerId: string): runnerId is RunnerId {
  return dashboardKnownRunnerIds().includes(runnerId);
}

/**
 * Normalize one persisted prompt into the current schema because localStorage may be stale or edited.
 */
function dashboardReadCustomPrompt(storedPrompt: unknown): CustomPrompt | null {
  if (!isRecord(storedPrompt)) return null;
  const id = readString(storedPrompt.id);
  const name = readString(storedPrompt.name).trim();
  const prompt = readString(storedPrompt.prompt).trim();
  if (!id.startsWith("custom:") || !name || !prompt) return null;
  const route =
    readString(storedPrompt.route) || dashboardInferPromptRoute(prompt);
  if (!CUSTOM_PROMPT_ROUTES.has(route)) return null;
  const runnerHintValue = readString(storedPrompt.runnerHint);
  const runnerHint =
    runnerHintValue === "any" || dashboardIsKnownRunnerId(runnerHintValue)
      ? runnerHintValue
      : "any";
  const requiresGoatFlowInstall = dashboardReadBoolean(
    storedPrompt.requiresGoatFlowInstall,
  );
  const now = new Date().toISOString();
  return {
    id,
    name,
    desc: readString(storedPrompt.desc),
    prompt,
    route,
    runnerHint,
    requiresGh: dashboardReadBoolean(storedPrompt.requiresGh),
    requiresPrOrIssue: dashboardReadBoolean(storedPrompt.requiresPrOrIssue),
    requiresLocalDiff: dashboardReadBoolean(storedPrompt.requiresLocalDiff),
    requiresUiApp: dashboardReadBoolean(storedPrompt.requiresUiApp),
    requiresDependencyFiles: dashboardReadBoolean(
      storedPrompt.requiresDependencyFiles,
    ),
    requiresGoatFlowInstall,
    mayCheckoutBranch: dashboardReadBoolean(storedPrompt.mayCheckoutBranch),
    requiresCleanWorktree: dashboardReadBoolean(
      storedPrompt.requiresCleanWorktree,
    ),
    mayWriteFiles: dashboardReadBoolean(storedPrompt.mayWriteFiles),
    artifactRequired: dashboardReadBoolean(storedPrompt.artifactRequired),
    globalSafe: dashboardResolvedGlobalSafe({
      requiresGoatFlowInstall,
      globalSafe:
        typeof storedPrompt.globalSafe === "boolean"
          ? storedPrompt.globalSafe
          : true,
    }),
    bestTargetSurfaces: readStringArray(storedPrompt.bestTargetSurfaces),
    notes: readString(storedPrompt.notes),
    createdAt: readString(storedPrompt.createdAt) || now,
    updatedAt: readString(storedPrompt.updatedAt) || now,
  };
}

/** Normalize the stored prompt list, dropping entries that no longer satisfy the schema. */
function dashboardReadCustomPrompts(storedPrompts: unknown): CustomPrompt[] {
  return Array.isArray(storedPrompts)
    ? storedPrompts
        .map((entry) => dashboardReadCustomPrompt(entry))
        .filter((entry): entry is CustomPrompt => entry !== null)
    : [];
}

/** Load custom prompts from browser storage and recover to an empty list when JSON is malformed. */
function dashboardLoadCustomPrompts(ctx: DashboardCustomPromptsContext): void {
  try {
    ctx.customPrompts = dashboardReadCustomPrompts(
      JSON.parse(localStorage.getItem(CUSTOM_PROMPT_STORAGE_KEY) || "[]"),
    );
  } catch {
    ctx.customPrompts = [];
  }
}

function dashboardPersistCustomPrompts(
  ctx: DashboardCustomPromptsContext,
): void {
  localStorage.setItem(
    CUSTOM_PROMPT_STORAGE_KEY,
    JSON.stringify(ctx.customPrompts),
  );
}

/** Convert a user-authored custom prompt into the preset shape consumed by existing launch UI. */
function dashboardCustomPromptToPreset(custom: CustomPrompt): Preset {
  return {
    id: custom.id,
    name: custom.name,
    desc: custom.desc || custom.notes || "Custom prompt",
    prompt: custom.prompt,
    cat: "custom",
    route: custom.route,
    source: "custom",
    globalSafe: custom.globalSafe,
    internalOnly: false,
    qualityMode: false,
    requiresGh: custom.requiresGh,
    requiresPrOrIssue: custom.requiresPrOrIssue,
    requiresLocalDiff: custom.requiresLocalDiff,
    requiresUiApp: custom.requiresUiApp,
    requiresDependencyFiles: custom.requiresDependencyFiles,
    requiresGoatFlowInstall: custom.requiresGoatFlowInstall,
    mayCheckoutBranch: custom.mayCheckoutBranch,
    requiresCleanWorktree: custom.requiresCleanWorktree,
    mayWriteFiles: custom.mayWriteFiles,
    artifactRequired: custom.artifactRequired,
    bestTargetSurfaces: custom.bestTargetSurfaces,
    fallbackPrompt: custom.notes,
    costTier: "medium",
  };
}

function dashboardCustomPromptDraftFromPreset(
  preset: Preset,
): CustomPromptDraft {
  const route = preset.route || dashboardInferPromptRoute(preset.prompt);
  const requiresGoatFlowInstall = preset.requiresGoatFlowInstall === true;
  return {
    name: preset.name,
    desc: preset.desc,
    prompt: preset.prompt,
    route: CUSTOM_PROMPT_ROUTES.has(route) ? route : "direct",
    runnerHint: "any",
    requiresGh: preset.requiresGh === true,
    requiresPrOrIssue: preset.requiresPrOrIssue === true,
    requiresLocalDiff: preset.requiresLocalDiff === true,
    requiresUiApp: preset.requiresUiApp === true,
    requiresDependencyFiles: preset.requiresDependencyFiles === true,
    requiresGoatFlowInstall,
    mayCheckoutBranch: preset.mayCheckoutBranch === true,
    requiresCleanWorktree: preset.requiresCleanWorktree === true,
    mayWriteFiles: preset.mayWriteFiles === true,
    artifactRequired: preset.artifactRequired === true,
    globalSafe: dashboardResolvedGlobalSafe({
      requiresGoatFlowInstall,
      globalSafe: preset.globalSafe === true,
    }),
    bestTargetSurfacesText: dashboardJoinTargetSurfaces(
      preset.bestTargetSurfaces ?? [],
    ),
    notes: preset.fallbackPrompt ?? "",
  };
}

function dashboardCustomPromptDraftFromCustom(
  custom: CustomPrompt,
): CustomPromptDraft {
  return {
    name: custom.name,
    desc: custom.desc,
    prompt: custom.prompt,
    route: custom.route,
    runnerHint: custom.runnerHint,
    requiresGh: custom.requiresGh,
    requiresPrOrIssue: custom.requiresPrOrIssue,
    requiresLocalDiff: custom.requiresLocalDiff,
    requiresUiApp: custom.requiresUiApp,
    requiresDependencyFiles: custom.requiresDependencyFiles,
    requiresGoatFlowInstall: custom.requiresGoatFlowInstall,
    mayCheckoutBranch: custom.mayCheckoutBranch,
    requiresCleanWorktree: custom.requiresCleanWorktree,
    mayWriteFiles: custom.mayWriteFiles,
    artifactRequired: custom.artifactRequired,
    globalSafe: custom.globalSafe,
    bestTargetSurfacesText: custom.bestTargetSurfaces.join(", "),
    notes: custom.notes,
  };
}

function dashboardValidateCustomPromptDraftDetails(
  ctx: DashboardCustomPromptsContext,
): CustomPromptValidationError[] {
  const draft = ctx.customPromptDraft;
  const errors: CustomPromptValidationError[] = [];
  const name = draft.name.trim();
  const prompt = draft.prompt.trim();
  const editing = ctx.editingCustomPromptId;
  if (!name) {
    errors.push({
      field: "name",
      message: "Name is required.",
      anchor: "custom-prompt-name",
    });
  } else {
    const duplicateName = ctx.customPrompts.some(
      (custom) =>
        custom.id !== editing &&
        custom.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicateName) {
      errors.push({
        field: "name",
        message: "Name already exists.",
        anchor: "custom-prompt-name",
      });
    }
  }
  if (!prompt) {
    errors.push({
      field: "prompt",
      message: "Prompt is required.",
      anchor: "custom-prompt-body",
    });
  }
  const route = draft.route.length > 0 ? draft.route : "direct";
  if (!CUSTOM_PROMPT_ROUTES.has(route)) {
    errors.push({
      field: "route",
      message: "Route must be direct or a known goat skill.",
      anchor: "custom-prompt-route",
    });
  }
  if (
    draft.runnerHint !== "any" &&
    !dashboardIsKnownRunnerId(draft.runnerHint)
  ) {
    errors.push({
      field: "runnerHint",
      message: "Runner hint is invalid.",
      anchor: "custom-prompt-name",
    });
  }
  const duplicateIds = new Set<string>();
  for (const custom of ctx.customPrompts) {
    if (duplicateIds.has(custom.id)) {
      errors.push({
        field: "id",
        message: `Duplicate custom prompt id: ${custom.id}`,
        anchor: "custom-prompt-name",
      });
      break;
    }
    duplicateIds.add(custom.id);
  }
  if (editing && !ctx.customPrompts.some((custom) => custom.id === editing)) {
    errors.push({
      field: "id",
      message: "The custom prompt being edited no longer exists.",
      anchor: "custom-prompt-name",
    });
  }
  return errors;
}

function dashboardValidateCustomPromptDraft(
  ctx: DashboardCustomPromptsContext,
): string[] {
  return dashboardValidateCustomPromptDraftDetails(ctx).map(
    (error) => error.message,
  );
}

function dashboardCustomPromptFieldError(
  ctx: DashboardCustomPromptsContext,
  field: string,
): string {
  return (
    dashboardValidateCustomPromptDraftDetails(ctx).find(
      (error) => error.field === field,
    )?.message ?? ""
  );
}

function dashboardCustomPromptPromptWarning(
  ctx: DashboardCustomPromptsContext,
): string {
  const prompt = ctx.customPromptDraft.prompt.trim();
  if (prompt.length > 0 && prompt.length < 20) {
    return "Prompt is short; make sure it is not a placeholder.";
  }
  return "";
}

function dashboardBuildCustomPrompt(
  ctx: DashboardCustomPromptsContext,
  existing?: CustomPrompt,
): CustomPrompt {
  const draft = ctx.customPromptDraft;
  const now = new Date().toISOString();
  const prompt = draft.prompt.trim();
  const requiresGoatFlowInstall = draft.requiresGoatFlowInstall;
  const route = CUSTOM_PROMPT_ROUTES.has(draft.route) ? draft.route : "direct";
  let id =
    existing?.id ?? `custom:${dashboardSlugifyCustomPromptName(draft.name)}`;
  if (!existing && ctx.customPrompts.some((custom) => custom.id === id)) {
    id += `-${Date.now().toString(36)}`;
  }
  return {
    id,
    name: draft.name.trim(),
    desc: draft.desc.trim(),
    prompt,
    route,
    runnerHint: draft.runnerHint,
    requiresGh: draft.requiresGh,
    requiresPrOrIssue: draft.requiresPrOrIssue,
    requiresLocalDiff: draft.requiresLocalDiff,
    requiresUiApp: draft.requiresUiApp,
    requiresDependencyFiles: draft.requiresDependencyFiles,
    requiresGoatFlowInstall,
    mayCheckoutBranch: draft.mayCheckoutBranch,
    requiresCleanWorktree: draft.requiresCleanWorktree,
    mayWriteFiles: draft.mayWriteFiles,
    artifactRequired: draft.artifactRequired,
    globalSafe: dashboardResolvedGlobalSafe({
      requiresGoatFlowInstall,
      globalSafe: draft.globalSafe,
    }),
    bestTargetSurfaces: dashboardParseTargetSurfaces(
      draft.bestTargetSurfacesText,
    ),
    notes: draft.notes.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
