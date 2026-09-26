/**
 * Store and validate the prompts users create through the dashboard's custom-prompt editor.
 *
 * - Prompts share this browser's dashboard storage across selected projects; they are separate from the built-in catalog.
 * - Clearing that browser storage removes the saved prompts.
 * - Drafts become saved records only after validation and a save action.
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

/**
 * Apply the same external-target rule to the editor's draft and saved prompt metadata.
 *
 * An omitted install requirement allows the Global safe option; an omitted Global safe flag does not select it.
 * Requiring goat-flow in the target overrides Global safe when prompts are loaded or saved.
 */
interface PromptGlobalSafetyInput {
  requiresGoatFlowInstall?: boolean | undefined;
  globalSafe?: boolean | undefined;
}

// Goat-flow-installed prompts are target-local because external targets may not carry the harness.
function dashboardGlobalSafeAllowed(prompt: PromptGlobalSafetyInput): boolean {
  return prompt.requiresGoatFlowInstall !== true;
}

// Persisted `globalSafe` is advisory; this enforces the harness-install override every time it is read.
function dashboardResolvedGlobalSafe(prompt: PromptGlobalSafetyInput): boolean {
  return prompt.globalSafe === true && dashboardGlobalSafeAllowed(prompt);
}

/**
 * Stable editor state shared by the custom-prompt form, its buttons, and the saved-prompt list.
 *
 * A null editing id means New or Copy; a null selected preset means no prompt is selected.
 * An unavailable preset catalog supplies no copy sources or surface suggestions.
 */
interface DashboardCustomPromptsContext {
  customPrompts: CustomPrompt[];
  customPromptDraft: CustomPromptDraft;
  customPromptSurfaceDraft?: string;
  customPromptSubmitAttempted?: boolean;
  editingCustomPromptId: string | null;
  showCustomPromptEditor: boolean;
  selectedPreset: Preset | null;
  allPresets?: Preset[];
  // Report validation messages and successful save/delete actions through dashboard toasts.
  showToast(msg: string, isError?: boolean): void;
}

// Create a new form draft with external-target-safe defaults and no inferred route state.
function dashboardDefaultCustomPromptDraft(): CustomPromptDraft {
  // New starts with empty text fields, Direct routing, and no additional launch requirements.
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

/**
 * Recover the route written in a legacy prompt before the editor's route picker takes over.
 *
 * @param prompt - saved prompt text; empty text supplies no route command
 * @returns the leading goat command, or Direct when no slash/dollar goat command is present; callers validate supported routes
 */
function dashboardInferPromptRoute(prompt: string): string {
  const match = prompt.trim().match(/^(?:\/|\$)(goat(?:-[a-z]+)?)\b/);
  return match?.[1] ?? "direct";
}

// Build a storage id suffix from a user label while avoiding empty `custom:` ids.
function dashboardSlugifyCustomPromptName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  // A name without ASCII letters or digits still needs a nonempty storage id suffix.
  return slug || "prompt";
}

// Supply route names and descriptions for the custom-prompt editor's route picker.
function dashboardCustomPromptRouteOptions(): CustomPromptRouteOption[] {
  return CUSTOM_PROMPT_ROUTE_OPTIONS;
}

// Expose the grouped flag metadata used by the custom-prompt form controls.
function dashboardCustomPromptFlagGroups(): CustomPromptFlagGroup[] {
  return CUSTOM_PROMPT_FLAG_GROUPS;
}

/**
 * Resolve which launch route the editor should show as selected for the open draft.
 *
 * @param draft - the custom prompt being edited
 * @returns the matching route, falling back to the default so the picker is never left blank
 */
function dashboardSelectedCustomPromptRoute(
  draft: CustomPromptDraft,
): CustomPromptRouteOption {
  return (
    CUSTOM_PROMPT_ROUTE_OPTIONS.find((route) => route.id === draft.route) ??
    DEFAULT_CUSTOM_PROMPT_ROUTE
  );
}

/**
 * Normalize surface labels so typed chips match the tags offered by other presets.
 *
 * @param surface - text the user entered or a stored label; whitespace-only text contains no tag
 * @returns the lowercase tag with spaces replaced by hyphens, or an empty string for blank input
 */
function dashboardNormalizeSurfaceTag(surface: string): string {
  return surface.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Turn the editor's comma-separated surface field into unique chips in entry order.
 *
 * @param text - surface field contents; blank text means the user selected no surfaces
 * @returns normalized tags, or an empty list when no nonblank tags were entered
 */
function dashboardParseTargetSurfaces(text: string): string[] {
  const seen = new Set<string>();
  const surfaces: string[] = [];
  // Each comma-separated entry is a possible chip, in the order the user entered it.
  for (const raw of text.split(",")) {
    const surface = dashboardNormalizeSurfaceTag(raw);
    // Blank entries and repeated tags add no new chip to the form.
    if (!surface || seen.has(surface)) continue;
    seen.add(surface);
    surfaces.push(surface);
  }
  return surfaces;
}

/**
 * Write normalized surface chips back into the editor's comma-separated field.
 *
 * @param surfaces - selected tags; an empty list clears the field
 * @returns the editable text, or an empty string when every tag is blank or no tags are selected
 */
function dashboardJoinTargetSurfaces(surfaces: string[]): string {
  return surfaces.map(dashboardNormalizeSurfaceTag).filter(Boolean).join(", ");
}

// Read legacy localStorage booleans defensively; non-booleans become false.
function dashboardReadBoolean(storedValue: unknown): boolean {
  return typeof storedValue === "boolean" ? storedValue : false;
}

// Read the page's advertised runner ids; a missing list leaves the editor with no known runner-specific hint.
function dashboardKnownRunnerIds(): string[] {
  return Array.isArray(window.__GOAT_FLOW_RUNNER_IDS__)
    ? window.__GOAT_FLOW_RUNNER_IDS__.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
}

// Narrow a saved runner hint to the runtime runner ids advertised by the dashboard page.
function dashboardIsKnownRunnerId(runnerId: string): runnerId is RunnerId {
  return dashboardKnownRunnerIds().includes(runnerId);
}

/**
 * Recover a saved custom prompt for the list, filling optional fields from older browser storage.
 *
 * @param storedPrompt - parsed storage entry; null or malformed entries cannot populate the editor
 * @returns the saved prompt, or null when its id, name, body, or route is invalid
 */
function dashboardReadCustomPrompt(storedPrompt: unknown): CustomPrompt | null {
  // A malformed storage entry has no prompt fields to display.
  if (!isRecord(storedPrompt)) return null;
  const id = readString(storedPrompt.id);
  const name = readString(storedPrompt.name).trim();
  const prompt = readString(storedPrompt.prompt).trim();
  // A saved row needs its own custom id, a visible name, and runnable prompt text.
  if (!id.startsWith("custom:") || !name || !prompt) return null;
  // Older saved prompts may encode their route only in the prompt body.
  const route =
    readString(storedPrompt.route) || dashboardInferPromptRoute(prompt);
  // An unsupported route cannot become a launchable saved prompt.
  if (!CUSTOM_PROMPT_ROUTES.has(route)) return null;
  const runnerHintValue = readString(storedPrompt.runnerHint);
  // An unavailable or missing runner hint lets the user choose any runner.
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
    // Older prompts default to Global safe unless they require goat-flow in the selected target.
    globalSafe: dashboardResolvedGlobalSafe({
      requiresGoatFlowInstall,
      globalSafe:
        typeof storedPrompt.globalSafe === "boolean"
          ? storedPrompt.globalSafe
          : true,
    }),
    bestTargetSurfaces: readStringArray(storedPrompt.bestTargetSurfaces),
    notes: readString(storedPrompt.notes),
    // Missing saved timestamps use this load time so the prompt still has creation and update metadata.
    createdAt: readString(storedPrompt.createdAt) || now,
    updatedAt: readString(storedPrompt.updatedAt) || now,
  };
}

/**
 * Recover valid saved prompts for the dashboard list and omit entries the editor cannot use.
 *
 * @param storedPrompts - parsed browser storage; a missing or non-array value supplies no saved prompts
 * @returns valid prompts in storage order, or an empty list when no usable entries remain
 */
function dashboardReadCustomPrompts(storedPrompts: unknown): CustomPrompt[] {
  return Array.isArray(storedPrompts)
    ? storedPrompts
        .map((entry) => dashboardReadCustomPrompt(entry))
        .filter((entry): entry is CustomPrompt => entry !== null)
    : [];
}

// Load custom prompts from browser storage and recover to an empty list when JSON is malformed.
function dashboardLoadCustomPrompts(ctx: DashboardCustomPromptsContext): void {
  try {
    // First use has no storage entry, so the custom-prompt list starts empty.
    ctx.customPrompts = dashboardReadCustomPrompts(
      JSON.parse(localStorage.getItem(CUSTOM_PROMPT_STORAGE_KEY) || "[]"),
    );
  } catch {
    // Blocked browser storage or malformed saved JSON leaves an empty prompt list so the dashboard can finish loading.
    ctx.customPrompts = [];
  }
}

/**
 * Save the user's whole custom-prompt list to this browser's dashboard storage.
 * Storage access or quota errors propagate to the caller before it reports a successful save.
 *
 * @param ctx - editor state supplying the saved list; an empty list removes all stored prompt entries
 */
function dashboardPersistCustomPrompts(
  ctx: DashboardCustomPromptsContext,
): void {
  localStorage.setItem(
    CUSTOM_PROMPT_STORAGE_KEY,
    JSON.stringify(ctx.customPrompts),
  );
}

// Convert a user-authored custom prompt into the preset shape consumed by existing launch UI.
function dashboardCustomPromptToPreset(custom: CustomPrompt): Preset {
  return {
    id: custom.id,
    name: custom.name,
    // A prompt without a description uses its notes, then a label, so its launch card is not blank.
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

/**
 * Copy a selected preset into the editor so the user can adapt its prompt and launch requirements.
 *
 * @param preset - preset the user chose to copy
 * @returns the editable draft; the source id is deliberately left out so saving creates a new prompt
 */
function dashboardCustomPromptDraftFromPreset(
  preset: Preset,
): CustomPromptDraft {
  // A preset without route metadata may still carry a slash/dollar command in its prompt text.
  const route = preset.route || dashboardInferPromptRoute(preset.prompt);
  const requiresGoatFlowInstall = preset.requiresGoatFlowInstall === true;
  return {
    name: preset.name,
    desc: preset.desc,
    prompt: preset.prompt,
    // A copied preset with an unsupported inferred route opens with Direct selected.
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
    // Missing surface tags and notes leave those optional editor fields empty.
    bestTargetSurfacesText: dashboardJoinTargetSurfaces(
      preset.bestTargetSurfaces ?? [],
    ),
    notes: preset.fallbackPrompt ?? "",
  };
}

/**
 * Load one of the user's saved prompts back into the editor form for another pass.
 *
 * @param custom - saved prompt the user chose to edit
 * @returns the editable draft matching what they saved
 */
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

/**
 * Check the open draft and say what is wrong with it, keeping each problem tied to the field the user must fix.
 *
 * @param ctx - live Alpine custom-prompt context supplying the draft and the existing saved prompts
 * @returns one entry per problem, each naming its field and anchor; empty means the draft is ready to save
 */
function dashboardValidateCustomPromptDraftDetails(
  ctx: DashboardCustomPromptsContext,
): CustomPromptValidationError[] {
  const draft = ctx.customPromptDraft;
  const errors: CustomPromptValidationError[] = [];
  const name = draft.name.trim();
  const prompt = draft.prompt.trim();
  const editing = ctx.editingCustomPromptId;
  // A prompt with no name cannot be found again in the list, so the name field is required before anything else is checked.
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
    // A name already used by another saved prompt would make the list ambiguous.
    if (duplicateName) {
      errors.push({
        field: "name",
        message: "Name already exists.",
        anchor: "custom-prompt-name",
      });
    }
  }
  // Save needs a prompt body to send when the user launches this custom prompt.
  if (!prompt) {
    errors.push({
      field: "prompt",
      message: "Prompt is required.",
      anchor: "custom-prompt-body",
    });
  }
  // An empty route keeps Direct as the editor's default launch behavior.
  const route = draft.route.length > 0 ? draft.route : "direct";
  // Ask the user to choose Direct or an available goat skill before saving.
  if (!CUSTOM_PROMPT_ROUTES.has(route)) {
    errors.push({
      field: "route",
      message: "Route must be direct or a known goat skill.",
      anchor: "custom-prompt-route",
    });
  }
  // A runner-specific hint must name one of the runners advertised by this dashboard.
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
  // Check saved ids before Save can replace a row whose identity is ambiguous.
  for (const custom of ctx.customPrompts) {
    // Two saved rows with the same id make editing unsafe, so report the first conflict.
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
  // An open Edit draft cannot replace a saved prompt that is no longer in the list.
  if (editing && !ctx.customPrompts.some((custom) => custom.id === editing)) {
    errors.push({
      field: "id",
      message: "The custom prompt being edited no longer exists.",
      anchor: "custom-prompt-name",
    });
  }
  return errors;
}

/**
 * Reduce the draft's problems to plain messages, for the toast shown when the user clicks Save on an invalid form.
 *
 * @param ctx - live Alpine custom-prompt context supplying the draft
 * @returns the messages in field order; empty means the draft is ready to save
 */
function dashboardValidateCustomPromptDraft(
  ctx: DashboardCustomPromptsContext,
): string[] {
  return dashboardValidateCustomPromptDraftDetails(ctx).map(
    (error) => error.message,
  );
}

/**
 * Give one form field the message shown under it, so an error appears beside the input that caused it.
 *
 * @param ctx - live Alpine custom-prompt context supplying the draft
 * @param field - field being rendered
 * @returns the message for that field, or an empty string so the template renders nothing
 */
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

/**
 * Offer a nonblocking reminder to review a short prompt body before saving.
 *
 * @param ctx - live Alpine custom-prompt context supplying the draft
 * @returns the warning text, or an empty string when the body is blank or has at least 20 trimmed characters
 */
function dashboardCustomPromptPromptWarning(
  ctx: DashboardCustomPromptsContext,
): string {
  const prompt = ctx.customPromptDraft.prompt.trim();
  // Very short text gets an optional placeholder reminder; the required-field check handles a blank body.
  if (prompt.length > 0 && prompt.length < 20) {
    return "Prompt is short; make sure it is not a placeholder.";
  }
  return "";
}

/**
 * Turn the validated draft into the record that gets saved, reusing the existing id when the user is editing rather than creating.
 *
 * @param ctx - live Alpine custom-prompt context supplying the draft
 * @param existing - prompt being replaced; omitting it mints a new id so a copy never overwrites its source
 * @returns the prompt to store
 */
function dashboardBuildCustomPrompt(
  ctx: DashboardCustomPromptsContext,
  existing?: CustomPrompt,
): CustomPrompt {
  const draft = ctx.customPromptDraft;
  const now = new Date().toISOString();
  const prompt = draft.prompt.trim();
  const requiresGoatFlowInstall = draft.requiresGoatFlowInstall;
  // Preserve the chosen route when supported; an unavailable route falls back to Direct for the saved record.
  const route = CUSTOM_PROMPT_ROUTES.has(draft.route) ? draft.route : "direct";
  // Editing keeps the saved id; a new draft derives one from the name the user entered.
  let id =
    existing?.id ?? `custom:${dashboardSlugifyCustomPromptName(draft.name)}`;
  // Different names can produce the same id suffix, so a new prompt adds a timestamp when that suffix is already saved.
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
    // Edits keep the original creation time; new prompts start their history at this save.
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
