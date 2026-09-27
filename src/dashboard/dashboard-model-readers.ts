/**
 * Decode shell and API data for the dashboard's prompt, project, terminal, and Quality views.
 *
 * Reject rows missing required fields so their callers can omit unusable choices and results.
 * Preserve supported legacy fields and absent optional values without inventing launch permissions or saved review data.
 */

// Read a launchable runner for dashboard controls; null means its required launch or setup metadata is incomplete.
function readSupportedAgent(rawAgent: unknown): SupportedAgent | null {
  // An invalid shell row cannot supply a runner choice for the launcher or Setup cards.
  if (!isRecord(rawAgent)) return null;
  const id = readRunnerId(rawAgent.id);
  const name = readString(rawAgent.name);
  const terminalBinary = readString(rawAgent.terminalBinary).trim();
  const setupSurfaces = readStringArray(rawAgent.setupSurfaces).filter(
    (surface) => surface.trim().length > 0,
  );
  const promptInvocationStyle = readPromptInvocationStyle(
    rawAgent.promptInvocationStyle,
  );
  const skillSource = readSkillSource(rawAgent.skillSource);
  const supportsPostTurnHook = rawAgent.supportsPostTurnHook;
  // Every runner choice needs known launch metadata and at least one supported setup surface.
  if (
    !id ||
    !name ||
    !terminalBinary ||
    setupSurfaces.length === 0 ||
    !promptInvocationStyle ||
    !skillSource ||
    typeof supportsPostTurnHook !== "boolean"
  ) {
    return null;
  }
  return {
    id,
    name,
    terminalBinary,
    setupSurfaces,
    promptInvocationStyle,
    skillSource,
    supportsPostTurnHook,
  };
}

// Load launchable runner choices from the shell; missing metadata or rejected rows leave no corresponding choice.
function readInjectedSupportedAgents(): SupportedAgent[] {
  return Array.isArray(window.__GOAT_FLOW_AGENTS__)
    ? window.__GOAT_FLOW_AGENTS__
        .map((agent) => readSupportedAgent(agent))
        .filter((agent): agent is SupportedAgent => agent !== null)
    : [];
}

// Preserve explicit preset safety flags; missing or non-boolean values remain unspecified for the caller's defaults.
function readOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] : undefined;
}

// Read a preset's cost label; an absent or unknown value leaves that optional label unspecified.
function readPresetCostTier(raw: unknown): Preset["costTier"] | undefined {
  return raw === "low" || raw === "medium" || raw === "high" ? raw : undefined;
}

/**
 * Decode a prompt card and its launch restrictions before the user selects it.
 * Keep every safety flag distinct; null means required card text or identity is missing, so the card is omitted.
 */
function readPreset(rawPreset: unknown): Preset | null {
  // A malformed preset cannot become a selectable prompt card.
  if (!isRecord(rawPreset)) return null;
  const id = readString(rawPreset.id);
  const name = readString(rawPreset.name);
  const desc = readString(rawPreset.desc);
  const prompt = readString(rawPreset.prompt);
  const cat = readString(rawPreset.cat);
  // Cards without identity, explanatory text, launch content, or category cannot be shown as usable prompts.
  if (!id || !name || !desc || !prompt || !cat) return null;
  return {
    id,
    name,
    desc,
    prompt,
    cat,
    route: readString(rawPreset.route) || undefined,
    source: readString(rawPreset.source) || undefined,
    globalSafe: readOptionalBoolean(rawPreset, "globalSafe"),
    internalOnly: readOptionalBoolean(rawPreset, "internalOnly"),
    qualityMode: readOptionalBoolean(rawPreset, "qualityMode"),
    requiresGh: readOptionalBoolean(rawPreset, "requiresGh"),
    requiresPrOrIssue: readOptionalBoolean(rawPreset, "requiresPrOrIssue"),
    requiresLocalDiff: readOptionalBoolean(rawPreset, "requiresLocalDiff"),
    requiresUiApp: readOptionalBoolean(rawPreset, "requiresUiApp"),
    requiresDependencyFiles: readOptionalBoolean(
      rawPreset,
      "requiresDependencyFiles",
    ),
    requiresGoatFlowInstall: readOptionalBoolean(
      rawPreset,
      "requiresGoatFlowInstall",
    ),
    mayCheckoutBranch: readOptionalBoolean(rawPreset, "mayCheckoutBranch"),
    requiresCleanWorktree: readOptionalBoolean(
      rawPreset,
      "requiresCleanWorktree",
    ),
    mayWriteFiles: readOptionalBoolean(rawPreset, "mayWriteFiles"),
    artifactRequired: readOptionalBoolean(rawPreset, "artifactRequired"),
    bestTargetSurfaces: readStringArray(rawPreset.bestTargetSurfaces),
    fallbackPrompt: readString(rawPreset.fallbackPrompt) || undefined,
    costTier: readPresetCostTier(rawPreset.costTier),
  };
}

// Load usable prompt cards from the shell; missing or invalid preset data leaves an empty list.
function readInjectedPresets(): Preset[] {
  return Array.isArray(window.__GOAT_FLOW_PRESETS__)
    ? window.__GOAT_FLOW_PRESETS__
        .map((preset) => readPreset(preset))
        .filter((preset): preset is Preset => preset !== null)
    : [];
}

// Decode an agent discovery row; null omits an unusable runner, while a null version leaves its version unknown.
function readAgentInfo(rawAgent: unknown): AgentInfo | null {
  // A malformed discovery row cannot establish whether the runner is installed.
  if (!isRecord(rawAgent)) return null;
  const agent = readSupportedAgent(rawAgent);
  // Installation cards need both usable runner metadata and an explicit installed flag.
  if (!agent || typeof rawAgent.installed !== "boolean") return null;

  return {
    ...agent,
    installed: rawAgent.installed,
    version: typeof rawAgent.version === "string" ? rawAgent.version : null,
  };
}

// Decode a selectable directory for the project browser; null omits a row with no usable name, path, or project marker.
function readBrowseDir(rawEntry: unknown): BrowseDir | null {
  // The directory picker cannot navigate an entry that has no record fields.
  if (!isRecord(rawEntry)) return null;
  const name = readString(rawEntry.name);
  const path = readString(rawEntry.path);
  // A directory choice needs a label, destination, and explicit project status before it can appear in the picker.
  if (!name || !path || typeof rawEntry.isProject !== "boolean") return null;

  return { name, path, isProject: rawEntry.isProject };
}

/**
 * Restore a saved project row, retaining identity fields that group aliases without exposing remote URLs.
 * Null means no usable project path exists; optional identity fields remain absent when older state did not save them.
 */
function readProjectEntry(rawProject: unknown): ProjectEntry | null {
  // Invalid saved state cannot restore a project row.
  if (!isRecord(rawProject)) return null;
  const path = readString(rawProject.path);
  // A saved row without a directory cannot offer a project the user can open.
  if (!path) return null;
  const identity = readString(rawProject.identity);
  const identitySource =
    rawProject.identitySource === "git-remote" ||
    rawProject.identitySource === "goat-marker" ||
    rawProject.identitySource === "path"
      ? rawProject.identitySource
      : null;

  const entry: ProjectEntry = {
    path,
    paths: readStringArray(rawProject.paths),
    state: readString(rawProject.state),
    action: readString(rawProject.action),
    details: readString(rawProject.details),
  };
  // Only a supplied stable identity can group this project with its known aliases.
  if (identity) entry.identity = identity;
  // Unknown identity sources must not claim how the saved project was recognized.
  if (identitySource) entry.identitySource = identitySource;
  const remoteUrlHash = readString(rawProject.remoteUrlHash);
  // A supplied remote hash preserves alias matching without copying the remote URL into browser state.
  if (remoteUrlHash) entry.remoteUrlHash = remoteUrlHash;
  const markerId = readString(rawProject.markerId);
  // A saved marker lets project identity survive a directory move when the server resolves it.
  if (markerId) entry.markerId = markerId;
  return entry;
}

// Decode access mode compatibly: absent legacy values stay workspace, unknown values restrict writes.
function readTerminalAccessMode(raw: unknown): TerminalAccessMode {
  return raw === undefined || raw === "workspace" ? "workspace" : "reporting";
}

// Read an optional numeric session metric; non-numeric legacy values stay absent.
function readOptionalSessionMetric(raw: unknown): number | undefined {
  return typeof raw === "number" ? raw : undefined;
}

/**
 * Restore a backend session for the workspace list, retry, and reconnect controls; null omits incomplete required session data.
 * Missing working or target directories use the project path so older sessions remain usable.
 */
function readServerSessionInfo(rawSession: unknown): ServerSessionInfo | null {
  // A malformed session cannot identify a backend runner that the user can reconnect to.
  if (!isRecord(rawSession)) return null;
  const id = readString(rawSession.id);
  const status = readSessionStatus(rawSession.status);
  const runner = readRunnerId(rawSession.runner);
  const createdAt = readString(rawSession.createdAt);
  const projectPath = readString(rawSession.projectPath);
  const cwd = readString(rawSession.cwd);
  const targetPath = readString(rawSession.targetPath);
  // Older sessions omit access mode and retain workspace access; unknown values fall back to restricted reporting for retries and reconnects.
  const accessMode = readTerminalAccessMode(rawSession.accessMode);
  // Legacy sessions omit capture metadata, which means the UI has no receipt channel to restore.
  const captureQualityDrafts = rawSession.captureQualityDrafts === true;
  // An empty owner remains null so retry never invents which visible project should receive a report.
  const qualityReportProjectPath =
    readString(rawSession.qualityReportProjectPath) || null;
  // Session controls require identity, runner, timestamps, and project ownership before offering reconnect or retry actions.
  if (
    !id ||
    !status ||
    !runner ||
    !createdAt ||
    !projectPath ||
    typeof rawSession.lastInputAt !== "number"
  ) {
    return null;
  }

  return {
    id,
    status,
    createdAt,
    projectPath,
    cwd: cwd || projectPath,
    targetPath: targetPath || projectPath,
    runner,
    accessMode,
    captureQualityDrafts,
    qualityReportProjectPath,
    lastInputAt: rawSession.lastInputAt,
    age: readOptionalSessionMetric(rawSession.age),
    idleDuration: readOptionalSessionMetric(rawSession.idleDuration),
    projectName: readString(rawSession.projectName) || undefined,
  };
}

// Read a quality-command response; throws when route identity or status fields drift.
function readQualityResult(rawResult: unknown): QualityResult {
  const payload = readRecord(rawResult, "Quality response");
  const agent = readRunnerId(payload.agent);
  const auditStatus = readAuditStatus(payload.auditStatus);
  const auditCacheStatus = readString(payload.auditCacheStatus);
  const command = readString(payload.command);
  // An incompatible quality response must fail at decoding before its prompt can be launched for the wrong runner or command.
  if (
    !agent ||
    (!auditStatus && payload.auditStatus !== "unavailable") ||
    !["hit", "miss", "bypass"].includes(auditCacheStatus) ||
    command !== "quality"
  ) {
    throw new Error("Quality response returned an invalid payload");
  }

  const prompt = readString(payload.prompt);
  const launchPrompt = readString(payload.launchPrompt);
  return {
    command: "quality",
    agent,
    auditStatus: auditStatus ?? "unavailable",
    auditCacheStatus: auditCacheStatus as QualityResult["auditCacheStatus"],
    auditSummary: readString(payload.auditSummary),
    prompt,
    // Older servers omit launchPrompt; the existing prompt remains the launch fallback for those responses.
    launchPrompt: launchPrompt || prompt,
  };
}

/**
 * Decode one saved review for the Quality history table; null omits rows with missing identity or score fields.
 * A null setup delta means no comparison is available for its trend chip, while totals remain independently usable.
 */
function readQualityHistoryRow(rawRow: unknown): QualityHistoryRow | null {
  // Malformed history entries cannot become rows in the saved-review comparison.
  if (!isRecord(rawRow)) return null;
  const id = readString(rawRow.id);
  const date = readString(rawRow.date);
  const agent = readRunnerId(rawRow.agent);
  // History needs identifiable reviews, numeric totals and severities, and an explicit number-or-null comparison delta.
  if (
    !id ||
    !date ||
    !agent ||
    typeof rawRow.setupTotal !== "number" ||
    typeof rawRow.systemTotal !== "number" ||
    (rawRow.setupDelta !== null && typeof rawRow.setupDelta !== "number") ||
    typeof rawRow.blockerCount !== "number" ||
    typeof rawRow.majorCount !== "number" ||
    typeof rawRow.minorCount !== "number"
  ) {
    return null;
  }
  return {
    id,
    date,
    agent,
    setupTotal: rawRow.setupTotal,
    systemTotal: rawRow.systemTotal,
    setupDelta: rawRow.setupDelta,
    blockerCount: rawRow.blockerCount,
    majorCount: rawRow.majorCount,
    minorCount: rawRow.minorCount,
  };
}

/**
 * Decode the latest saved review for the Home and Quality summary cards.
 * Null leaves the summary absent when its identity, time, totals, or severity counts cannot be read.
 */
function readQualityHistoryLatest(
  rawLatest: unknown,
): QualityHistoryLatest | null {
  // No summary record means there is no latest saved review to display.
  if (!isRecord(rawLatest)) return null;
  const id = readString(rawLatest.id);
  const date = readString(rawLatest.date);
  const time = readString(rawLatest.time);
  const agent = readRunnerId(rawLatest.agent);
  // A latest-review card must not combine a partial timestamp or identity with unverified score totals.
  if (
    !id ||
    !date ||
    !time ||
    !agent ||
    typeof rawLatest.setupTotal !== "number" ||
    typeof rawLatest.systemTotal !== "number" ||
    typeof rawLatest.blockerCount !== "number" ||
    typeof rawLatest.majorCount !== "number" ||
    typeof rawLatest.minorCount !== "number"
  ) {
    return null;
  }
  return {
    id,
    date,
    time,
    agent,
    setupTotal: rawLatest.setupTotal,
    systemTotal: rawLatest.systemTotal,
    blockerCount: rawLatest.blockerCount,
    majorCount: rawLatest.majorCount,
    minorCount: rawLatest.minorCount,
  };
}

// Restore a saved browser list; it swallows unreadable storage or corrupt JSON as an empty-list fallback.
function readStoredStringArray(key: string): string[] {
  try {
    // A first visit has no saved list, so callers receive an empty collection to populate.
    return readStringArray(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    // Browser storage restrictions or a damaged saved value leave the list empty so the dashboard can still open.
    return [];
  }
}

// Restore saved browser labels; it swallows unreadable storage or corrupt JSON as an empty-map fallback.
function readStoredStringMap(key: string): Record<string, string> {
  try {
    // With no saved labels, the dashboard can use its normal session or project names.
    return readStringMap(JSON.parse(localStorage.getItem(key) || "{}"));
  } catch {
    // Blocked local storage or damaged label JSON leaves defaults available instead of preventing dashboard startup.
    return {};
  }
}
