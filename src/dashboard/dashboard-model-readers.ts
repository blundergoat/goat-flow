/**
 * Dashboard model readers for injected shell data and API payloads that feed
 * presets, projects, sessions, quality views, and task state.
 */
function readSupportedAgent(rawAgent: unknown): SupportedAgent | null {
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

/** Read the supported agent list injected into the dashboard shell. */
function readInjectedSupportedAgents(): SupportedAgent[] {
  return Array.isArray(window.__GOAT_FLOW_AGENTS__)
    ? window.__GOAT_FLOW_AGENTS__
        .map((agent) => readSupportedAgent(agent))
        .filter((agent): agent is SupportedAgent => agent !== null)
    : [];
}

/** Read an optional boolean flag from a decoded record without accepting truthy strings. */
function readOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] : undefined;
}

/** Read the optional preset cost tier, rejecting unknown strings from shell injection. */
function readPresetCostTier(value: unknown): Preset["costTier"] | undefined {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : undefined;
}

/**
 * Read one preset definition from dashboard shell injection.
 *
 * This stays field-by-field because preset safety flags gate UI affordances and
 * fallback copy independently; dropping one flag changes launch behavior.
 */
function readPreset(rawPreset: unknown): Preset | null {
  if (!isRecord(rawPreset)) return null;
  const id = readString(rawPreset.id);
  const name = readString(rawPreset.name);
  const desc = readString(rawPreset.desc);
  const prompt = readString(rawPreset.prompt);
  const cat = readString(rawPreset.cat);
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

/** Read the preset list injected into the dashboard shell. */
function readInjectedPresets(): Preset[] {
  return Array.isArray(window.__GOAT_FLOW_PRESETS__)
    ? window.__GOAT_FLOW_PRESETS__
        .map((preset) => readPreset(preset))
        .filter((preset): preset is Preset => preset !== null)
    : [];
}

/** Read one installed-agent record from raw payload data. */
function readAgentInfo(rawAgent: unknown): AgentInfo | null {
  if (!isRecord(rawAgent)) return null;
  const agent = readSupportedAgent(rawAgent);
  if (!agent || typeof rawAgent.installed !== "boolean") return null;

  return {
    ...agent,
    installed: rawAgent.installed,
    version: typeof rawAgent.version === "string" ? rawAgent.version : null,
  };
}

/** Read one directory entry from the project browser payload. */
function readBrowseDir(rawEntry: unknown): BrowseDir | null {
  if (!isRecord(rawEntry)) return null;
  const name = readString(rawEntry.name);
  const path = readString(rawEntry.path);
  if (!name || !path || typeof rawEntry.isProject !== "boolean") return null;

  return { name, path, isProject: rawEntry.isProject };
}

/**
 * Read one saved project entry from persisted state.
 *
 * This stays explicit because identity fields preserve alias grouping while
 * keeping private remote URLs out of browser-local state.
 */
function readProjectEntry(rawProject: unknown): ProjectEntry | null {
  if (!isRecord(rawProject)) return null;
  const path = readString(rawProject.path);
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
  if (identity) entry.identity = identity;
  if (identitySource) entry.identitySource = identitySource;
  const remoteUrlHash = readString(rawProject.remoteUrlHash);
  if (remoteUrlHash) entry.remoteUrlHash = remoteUrlHash;
  const markerId = readString(rawProject.markerId);
  if (markerId) entry.markerId = markerId;
  return entry;
}

/**
 * Read one backend terminal-session record.
 *
 * This stays explicit because old session payloads may omit cwd/targetPath, and
 * the dashboard must default them to projectPath without marking the session bad.
 */
function readServerSessionInfo(rawSession: unknown): ServerSessionInfo | null {
  if (!isRecord(rawSession)) return null;
  const id = readString(rawSession.id);
  const status = readSessionStatus(rawSession.status);
  const runner = readRunnerId(rawSession.runner);
  const createdAt = readString(rawSession.createdAt);
  const projectPath = readString(rawSession.projectPath);
  const cwd = readString(rawSession.cwd);
  const targetPath = readString(rawSession.targetPath);
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
    lastInputAt: rawSession.lastInputAt,
    age: typeof rawSession.age === "number" ? rawSession.age : undefined,
    idleDuration:
      typeof rawSession.idleDuration === "number"
        ? rawSession.idleDuration
        : undefined,
    projectName: readString(rawSession.projectName) || undefined,
  };
}

/** Read a quality-command response; throws when route identity or status fields drift. */
function readQualityResult(rawResult: unknown): QualityResult {
  const payload = readRecord(rawResult, "Quality response");
  const agent = readRunnerId(payload.agent);
  const auditStatus = readAuditStatus(payload.auditStatus);
  const auditCacheStatus = readString(payload.auditCacheStatus);
  const command = readString(payload.command);
  if (
    !agent ||
    (!auditStatus && payload.auditStatus !== "unavailable") ||
    !["hit", "miss", "bypass"].includes(auditCacheStatus) ||
    command !== "quality"
  ) {
    throw new Error("Quality response returned an invalid payload");
  }

  return {
    command: "quality",
    agent,
    auditStatus: auditStatus ?? "unavailable",
    auditCacheStatus: auditCacheStatus as QualityResult["auditCacheStatus"],
    auditSummary: readString(payload.auditSummary),
    prompt: readString(payload.prompt),
  };
}

/**
 * Read one quality-history table row.
 *
 * This stays explicit because the dashboard compares setup/system totals and
 * nullable setup deltas separately when rendering trend chips.
 */
function readQualityHistoryRow(rawRow: unknown): QualityHistoryRow | null {
  if (!isRecord(rawRow)) return null;
  const id = readString(rawRow.id);
  const date = readString(rawRow.date);
  const agent = readRunnerId(rawRow.agent);
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
 * Read the latest quality-history summary.
 *
 * This stays explicit because the latest card omits setupDelta but still needs
 * the same totals and severity counters as row history.
 */
function readQualityHistoryLatest(
  rawLatest: unknown,
): QualityHistoryLatest | null {
  if (!isRecord(rawLatest)) return null;
  const id = readString(rawLatest.id);
  const date = readString(rawLatest.date);
  const time = readString(rawLatest.time);
  const agent = readRunnerId(rawLatest.agent);
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

/** Read a persisted string array from localStorage; swallows corrupt JSON. */
function readStoredStringArray(key: string): string[] {
  try {
    return readStringArray(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return [];
  }
}

/** Read a persisted string map from localStorage; swallows corrupt JSON. */
function readStoredStringMap(key: string): Record<string, string> {
  try {
    return readStringMap(JSON.parse(localStorage.getItem(key) || "{}"));
  } catch {
    return {};
  }
}
