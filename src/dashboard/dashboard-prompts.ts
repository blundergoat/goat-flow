/**
 * Prompt-library helpers for the dashboard Alpine app.
 * These keep filtering, grouping, and prompt text transforms out of app.ts.
 */

type PresetCategory = { id: string; label: string };
type RenderedPresetEntry =
  | { kind: "header"; id: string; label: string }
  | { kind: "row"; preset: Preset };

const PRESET_CATEGORY_ACCENTS: Record<string, string> = {
  debug: "#60a5fa",
  review: "#2dd4bf",
  plan: "#fbbf24",
  critique: "#a78bfa",
  qa: "#f472b6",
  security: "#f87171",
  custom: "var(--accent)",
};

interface DashboardPromptsContext {
  presets: Preset[];
  customPrompts: CustomPrompt[];
  presetFilter: string;
  presetSearch: string;
  presetFavorites: string[];
  selectedPreset: Preset | null;
  activeRunner: RunnerId;
  allPresets: Preset[];
  flatPresetOrder: string[];
  presetsByCategory: Array<{ id: string; label: string; items: Preset[] }>;
  filteredPresets: Preset[];
  adaptPrompt(prompt: string, runner?: RunnerId): string;
  copyText(text: string): void;
  _saveDashboardState(): void;
}

/** Toggle a preset favorite state and persist the combined dashboard state. */
function dashboardToggleFavorite(
  ctx: DashboardPromptsContext,
  id: string,
): void {
  const idx = ctx.presetFavorites.indexOf(id);
  if (idx === -1) ctx.presetFavorites.push(id);
  else ctx.presetFavorites.splice(idx, 1);
  ctx._saveDashboardState();
}

/** Check whether a preset is marked as a favorite. */
function dashboardIsFavorite(
  ctx: DashboardPromptsContext,
  id: string,
): boolean {
  return ctx.presetFavorites.includes(id);
}

/** Move the preview selection up (-1) or down (1) in screen order, with wrap. */
function dashboardSelectPresetByOffset(
  ctx: DashboardPromptsContext,
  delta: number,
): void {
  const order = ctx.flatPresetOrder;
  if (order.length === 0) return;
  const currentId = ctx.selectedPreset?.id;
  const currentIdx = currentId ? order.indexOf(currentId) : -1;
  const nextIdx =
    currentIdx === -1
      ? delta > 0
        ? 0
        : order.length - 1
      : (currentIdx + delta + order.length) % order.length;
  const nextId = order[nextIdx];
  const next = dashboardAllPresets(ctx).find((p) => p.id === nextId);
  if (!next) return;
  ctx.selectedPreset = next;
  requestAnimationFrame(() => {
    const el = document.getElementById(`preset-row-${nextId}`);
    if (el) el.scrollIntoView({ block: "nearest" });
  });
}

/** Built-in presets plus local custom prompts, without mutating the shipped JSON. */
function dashboardAllPresets(ctx: DashboardPromptsContext): Preset[] {
  return [
    ...ctx.presets,
    ...ctx.customPrompts.map((custom) => dashboardCustomPromptToPreset(custom)),
  ];
}

/** Presets visible in normal browsing; quality prompts live only on the Quality page. */
function dashboardBrowsablePresets(ctx: DashboardPromptsContext): Preset[] {
  const list = dashboardAllPresets(ctx);
  return list.filter((p) => !p.qualityMode && !p.internalOnly);
}

/** Return the preset category filters. */
function dashboardPresetCats(ctx: DashboardPromptsContext): PresetCategory[] {
  const cats = new Map<string, string>();
  const labelOverrides: Record<string, string> = { custom: "Custom", qa: "QA" };
  for (const p of dashboardBrowsablePresets(ctx)) {
    if (!cats.has(p.cat)) {
      cats.set(
        p.cat,
        labelOverrides[p.cat] ?? p.cat.charAt(0).toUpperCase() + p.cat.slice(1),
      );
    }
  }
  return [
    { id: "all", label: "All" },
    { id: "favorites", label: "\u2605 Favorites" },
    ...Array.from(cats, ([id, label]) => ({ id, label })),
  ];
}

/** Return compact prerequisite/fit badges for one preset. */
function dashboardPresetBadges(preset: Preset): PresetBadge[] {
  const badges: PresetBadge[] = [];
  if (preset.internalOnly) {
    badges.push({
      label: "Internal",
      title: "Intended for goat-flow framework maintenance",
      tone: "danger",
    });
  }
  if (preset.qualityMode) {
    badges.push({
      label: "Quality",
      title: "Quality or skill-assessment workflow",
      tone: "neutral",
    });
  }
  if (preset.requiresPrOrIssue) {
    badges.push({
      label: "Needs PR",
      title: "Requires a PR, issue, branch, or pasted diff context",
      tone: "warn",
    });
  }
  if (preset.requiresLocalDiff) {
    badges.push({
      label: "Needs diff",
      title:
        "Requires local changes, a branch comparison, or pasted diff context",
      tone: "warn",
    });
  }
  if (preset.requiresGh) {
    badges.push({
      label: "Needs gh",
      title:
        "Uses GitHub CLI when available; prompt must provide fallback context otherwise",
      tone: "warn",
    });
  }
  if (preset.mayCheckoutBranch) {
    badges.push({
      label: "May checkout",
      title: "May ask to checkout a branch after clean-worktree confirmation",
      tone: "warn",
    });
  }
  if (preset.requiresCleanWorktree) {
    badges.push({
      label: "Clean worktree",
      title:
        "Requires a clean worktree or explicit user approval before checkout",
      tone: "warn",
    });
  }
  if (preset.mayWriteFiles) {
    badges.push({
      label: "May write",
      title: "May write files only with prompt or user approval",
      tone: "danger",
    });
  }
  if (preset.requiresUiApp) {
    badges.push({
      label: "UI workflow",
      title: "Best suited to app/UI testing",
      tone: "ui",
    });
  }
  if (preset.requiresDependencyFiles) {
    badges.push({
      label: "Dependency files",
      title: "Requires package manifests or lockfiles for dependency evidence",
      tone: "warn",
    });
  }
  if (preset.requiresGoatFlowInstall) {
    badges.push({
      label: "GOAT install",
      title:
        "Requires goat-flow to be installed in the selected target project",
      tone: "warn",
    });
  }
  if (preset.artifactRequired) {
    badges.push({
      label: "Artifact required",
      title: "Requires a plan, report, or other artifact to assess",
      tone: "warn",
    });
  }
  const surfaces = new Set(preset.bestTargetSurfaces ?? []);
  if (surfaces.has("library") || surfaces.has("api")) {
    badges.push({
      label: "Library/API friendly",
      title: "Suitable for libraries, APIs, or non-UI projects",
      tone: "good",
    });
  }
  if (preset.globalSafe && dashboardGlobalSafeAllowed(preset)) {
    badges.push({
      label: "Global safe",
      title:
        "Can run against external target projects without goat-flow installed",
      tone: "good",
    });
  }
  return badges;
}

/** Return the route label shown on prompt cards. */
function dashboardPresetRouteLabel(preset: Preset): string {
  const route = preset.route || dashboardInferPromptRoute(preset.prompt);
  return route === "direct" ? "direct" : `/${route}`;
}

/** Return the left-edge accent color for prompt cards. */
function dashboardPresetCategoryAccent(preset: Preset): string {
  return PRESET_CATEGORY_ACCENTS[preset.cat] ?? "var(--border-subtle)";
}

/**
 * Favorites stay pinned to the top unless the user explicitly switches into
 * the favorites-only filter, which keeps mixed browsing fast on large lists.
 */
function dashboardFilteredPresets(ctx: DashboardPromptsContext): Preset[] {
  let list: Preset[];
  const browsable = dashboardBrowsablePresets(ctx);
  if (ctx.presetFilter === "favorites") {
    list = browsable.filter((p) => ctx.presetFavorites.includes(p.id));
  } else {
    list =
      ctx.presetFilter === "all"
        ? browsable
        : browsable.filter((p) => p.cat === ctx.presetFilter);
  }
  if (ctx.presetSearch.trim()) {
    const q = ctx.presetSearch.toLowerCase();
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.desc.toLowerCase().includes(q) ||
        p.prompt.toLowerCase().includes(q),
    );
  } else if (ctx.presetFilter !== "favorites") {
    const favSet = new Set(ctx.presetFavorites);
    list = [
      ...list.filter((p) => favSet.has(p.id)),
      ...list.filter((p) => !favSet.has(p.id)),
    ];
  }
  return list;
}

/** Presets grouped by category for the Prompts page grouped rendering. */
function dashboardPresetsByCategory(
  ctx: DashboardPromptsContext,
): Array<{ id: string; label: string; items: Preset[] }> {
  const cats = dashboardPresetCats(ctx).filter(
    (c) => c.id !== "all" && c.id !== "favorites",
  );
  const browsable = dashboardBrowsablePresets(ctx);
  return cats.map((cat) => ({
    id: cat.id,
    label: cat.label,
    items: browsable.filter((p) => p.cat === cat.id),
  }));
}

/** Build the unified list rows for the Prompts page. */
function dashboardRenderedPresetEntries(
  ctx: DashboardPromptsContext,
): RenderedPresetEntry[] {
  const entries: RenderedPresetEntry[] = [];
  if (ctx.presetFilter === "all" && !ctx.presetSearch.trim()) {
    for (const group of ctx.presetsByCategory) {
      if (group.items.length === 0) continue;
      entries.push({
        kind: "header",
        id: group.id,
        label: `${group.label} (${group.items.length})`,
      });
      for (const p of group.items) entries.push({ kind: "row", preset: p });
    }
    return entries;
  }
  for (const p of ctx.filteredPresets) entries.push({ kind: "row", preset: p });
  return entries;
}

/** Return preset IDs in screen order for keyboard navigation. */
function dashboardFlatPresetOrder(ctx: DashboardPromptsContext): string[] {
  if (ctx.presetFilter === "all" && !ctx.presetSearch.trim()) {
    const ids: string[] = [];
    for (const group of ctx.presetsByCategory) {
      for (const p of group.items) ids.push(p.id);
    }
    return ids;
  }
  return ctx.filteredPresets.map((p) => p.id);
}

/** Return escaped, optionally search-highlighted HTML for the prompt preview. */
function dashboardHighlightedPromptHtml(ctx: DashboardPromptsContext): string {
  const prompt = ctx.adaptPrompt(ctx.selectedPreset?.prompt ?? "");
  const escaped = prompt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const query = ctx.presetSearch.trim();
  if (!query) return escaped;
  const qEscaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(qEscaped, "gi");
  return escaped.replace(re, "<mark>$&</mark>");
}

/** Adapt a preset prompt to the syntax expected by the selected runner. */
function dashboardAdaptPrompt(
  ctx: DashboardPromptsContext,
  prompt: string,
  runner?: RunnerId,
): string {
  const r = runner ?? ctx.activeRunner;
  if (r === "codex") return prompt.replace(/^\/goat\b/, "$goat");
  return prompt;
}

/** Copy a preset prompt after applying runner-specific syntax tweaks. */
function dashboardCopyPreset(
  ctx: DashboardPromptsContext,
  prompt: string,
): void {
  ctx.copyText(ctx.adaptPrompt(prompt));
}
