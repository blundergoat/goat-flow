/**
 * Generic evaluator that executes declarative `Detection` objects against extracted facts.
 * Rubric definitions stay data-heavy because this module owns the shared evaluation mechanics.
 */
import type {
  Detection,
  CheckResult,
  FactContext,
  Confidence,
} from '../types.js';

/**
 * Evaluate a Detection against extracted facts.
 * This is the core engine - 10 evaluator types handle all checks.
 */
export function evaluateCheck(
  id: string,
  name: string,
  tier: 'foundation' | 'standard' | 'full',
  category: string,
  pts: number,
  partialPts: number | undefined,
  detect: Detection,
  confidence: Confidence,
  ctx: FactContext,
): CheckResult {
  /** Common fields shared by all check results */
  const base = { id, name, tier, category, confidence };

  if (detect.type === 'custom') return detect.fn(ctx);
  if (
    detect.type === 'json_valid' ||
    detect.type === 'json_contains' ||
    detect.type === 'count_items' ||
    detect.type === 'composite'
  ) {
    return evaluateSecondaryCheck(
      base,
      pts,
      partialPts,
      detect,
      confidence,
      ctx,
    );
  }
  return evaluatePrimaryCheck(base, pts, partialPts, detect, ctx);
}

/** Shared fields included in every check evaluation result */
interface CheckBase {
  id: string;
  name: string;
  tier: 'foundation' | 'standard' | 'full';
  category: string;
  confidence: Confidence;
}

/** Dispatch file, directory, grep, and line-count detections. */
function evaluatePrimaryCheck(
  base: CheckBase,
  pts: number,
  partialPts: number | undefined,
  detect: Extract<
    Detection,
    {
      type: 'file_exists' | 'dir_exists' | 'line_count' | 'grep' | 'grep_count';
    }
  >,
  ctx: FactContext,
): CheckResult {
  switch (detect.type) {
    case 'file_exists':
      return evalFileExists(base, pts, detect, ctx);
    case 'dir_exists':
      return evalDirExists(base, pts, detect, ctx);
    case 'line_count':
      return evalLineCount(base, pts, partialPts, detect, ctx);
    case 'grep':
      return evalGrep(base, pts, detect, ctx);
    case 'grep_count':
      return evalGrepCount(base, pts, partialPts, detect, ctx);
  }
}

/** Dispatch JSON, counting, and composite detections. */
function evaluateSecondaryCheck(
  base: CheckBase,
  pts: number,
  partialPts: number | undefined,
  detect: Extract<
    Detection,
    { type: 'json_valid' | 'json_contains' | 'count_items' | 'composite' }
  >,
  confidence: Confidence,
  ctx: FactContext,
): CheckResult {
  switch (detect.type) {
    case 'json_valid':
      return evalJsonValid(base, pts, detect, ctx);
    case 'json_contains':
      return evalJsonContains(base, pts, detect, ctx);
    case 'count_items':
      return evalCountItems(base, pts, partialPts, detect, ctx);
    case 'composite':
      return evalComposite(base, pts, partialPts, detect, confidence, ctx);
  }
}

/** Resolve template placeholders in a path using agent facts. */
function resolvePath(path: string, ctx: FactContext): string {
  return path
    .replace('{instruction_file}', ctx.agentFacts.agent.instructionFile)
    .replace('{settings_file}', ctx.agentFacts.agent.settingsFile ?? '')
    .replace('{skills_dir}', ctx.agentFacts.agent.skillsDir)
    .replace('{hooks_dir}', ctx.agentFacts.agent.hooksDir ?? '')
    .replace(
      '{footguns_committed_dir}',
      ctx.facts.shared.footguns.paths.committed,
    )
    .replace('{footguns_local_dir}', ctx.facts.shared.footguns.paths.local)
    .replace(
      '{lessons_committed_dir}',
      ctx.facts.shared.lessons.paths.committed,
    )
    .replace('{lessons_local_dir}', ctx.facts.shared.lessons.paths.local)
    .replace('{decisions_dir}', ctx.facts.shared.decisions.path)
    .replace('{evals_dir}', ctx.facts.shared.evals.path)
    .replace('{coding_standards_dir}', ctx.facts.shared.localInstructions.path)
    .replace('{deny_path}', getDenyPath(ctx));
}

/** Return the concrete path that backs the current agent's deny mechanism. */
function getDenyPath(ctx: FactContext): string {
  /** Deny mechanism configuration for the current agent */
  const deny = ctx.agentFacts.agent.denyMechanism;
  if (deny.type === 'settings-deny') return deny.path;
  if (deny.type === 'deny-script') return deny.path;
  return deny.settingsPath;
}

/** Retrieve file content from facts if the path matches the instruction file. */
function getFileContent(path: string, ctx: FactContext): string | null {
  /** Resolved path with all template placeholders expanded */
  const resolved = resolvePath(path, ctx);
  if (resolved === ctx.agentFacts.agent.instructionFile) {
    return ctx.agentFacts.instruction.content;
  }
  // Content not available in facts for non-instruction files
  return null;
}

/** Retrieve content for a specific section within a file, or the whole file if no section given. */
function getSectionContent(
  path: string,
  section: string | undefined,
  ctx: FactContext,
): string | null {
  if (section == null) return getFileContent(path, ctx);

  /** Resolved path with all template placeholders expanded */
  const resolved = resolvePath(path, ctx);
  if (resolved === ctx.agentFacts.agent.instructionFile) {
    // Iterate over parsed heading-content pairs to find the matching section
    for (const [heading, content] of ctx.agentFacts.instruction.sections) {
      if (heading.includes(section.toLowerCase())) {
        return content;
      }
    }
    // Section not found - fall back to full content
    return ctx.agentFacts.instruction.content;
  }
  return null;
}

// === Evaluators ===

/** Evaluate a `file_exists` detection against agent and shared facts. */
function evalFileExists(
  base: CheckBase,
  pts: number,
  detect: Extract<Detection, { type: 'file_exists' }>,
  ctx: FactContext,
): CheckResult {
  /** Resolved target file path */
  const path = resolvePath(detect.path, ctx);
  /** Whether the file was found in agent or shared facts */
  let exists = false;

  if (path === ctx.agentFacts.agent.instructionFile) {
    exists = ctx.agentFacts.instruction.exists;
  } else if (path === ctx.agentFacts.agent.settingsFile) {
    exists = ctx.agentFacts.settings.exists;
  } else {
    // Shared docs, workflow, and config paths are precomputed in shared facts.
    exists = checkSharedPath(path, ctx);
  }

  return {
    ...base,
    status: exists ? 'pass' : 'fail',
    points: exists ? pts : 0,
    maxPoints: pts,
    message: exists ? `${path} exists` : `${path} not found`,
    evidence: path,
  };
}

/** Evaluate a `dir_exists` detection against agent and shared facts. */
function evalDirExists(
  base: CheckBase,
  pts: number,
  detect: Extract<Detection, { type: 'dir_exists' }>,
  ctx: FactContext,
): CheckResult {
  /** Resolved target directory path */
  const path = resolvePath(detect.path, ctx);
  /** Whether the directory was found in agent or shared facts */
  let exists = false;

  if (path === ctx.agentFacts.agent.skillsDir) {
    exists = ctx.agentFacts.skills.found.length > 0;
  } else if (path === ctx.agentFacts.agent.hooksDir) {
    exists =
      ctx.agentFacts.hooks.denyExists || ctx.agentFacts.hooks.postTurnExists;
  } else {
    exists = checkSharedPath(path, ctx);
  }

  return {
    ...base,
    status: exists ? 'pass' : 'fail',
    points: exists ? pts : 0,
    maxPoints: pts,
    message: exists ? `${path}/ exists` : `${path}/ not found`,
    evidence: path,
  };
}

/** Return existence and line-count info for files tracked in facts. */
function getLineCountInfo(
  path: string,
  ctx: FactContext,
): { exists: boolean; lineCount: number } {
  if (path === ctx.agentFacts.agent.instructionFile) {
    return {
      exists: ctx.agentFacts.instruction.exists,
      lineCount: ctx.agentFacts.instruction.lineCount,
    };
  }
  if (path === 'ai-docs/architecture.md') {
    return {
      exists: ctx.facts.shared.architecture.exists,
      lineCount: ctx.facts.shared.architecture.lineCount,
    };
  }
  return { exists: true, lineCount: 0 };
}

/** Build the result payload for a line-count check. */
function formatLineCountResult(
  base: CheckBase,
  pts: number,
  partialPts: number | undefined,
  detect: Extract<Detection, { type: 'line_count' }>,
  path: string,
  lineCount: number,
): CheckResult {
  const passThreshold = detect.pass ?? 0;
  const failThreshold = detect.fail ?? Infinity;
  const evidence = `${path}: ${lineCount} lines`;

  if (lineCount <= passThreshold) {
    return {
      ...base,
      status: 'pass',
      points: pts,
      maxPoints: pts,
      message: `${lineCount} lines (at or under ${passThreshold} target)`,
      evidence,
    };
  }
  if (detect.partial && partialPts && lineCount <= failThreshold) {
    return {
      ...base,
      status: 'partial',
      points: partialPts,
      maxPoints: pts,
      message: `${lineCount} lines found. Expected at or under ${passThreshold}; currently still under the ${failThreshold}-line hard limit. Trim ${lineCount - passThreshold} lines to get back under target.`,
      evidence,
    };
  }
  return {
    ...base,
    status: 'fail',
    points: 0,
    maxPoints: pts,
    message: `${lineCount} lines (over ${failThreshold} limit)`,
    evidence,
  };
}

/** Evaluate a file's line count against pass/fail thresholds. */
function evalLineCount(
  base: CheckBase,
  pts: number,
  partialPts: number | undefined,
  detect: Extract<Detection, { type: 'line_count' }>,
  ctx: FactContext,
): CheckResult {
  const path = resolvePath(detect.path, ctx);
  const lineCountInfo = getLineCountInfo(path, ctx);
  if (lineCountInfo.exists === false) {
    return {
      ...base,
      status: 'fail',
      points: 0,
      maxPoints: pts,
      message: `${path} not found`,
    };
  }
  return formatLineCountResult(
    base,
    pts,
    partialPts,
    detect,
    path,
    lineCountInfo.lineCount,
  );
}

/** Evaluate whether a regex matches a file or extracted section body. */
function evalGrep(
  base: CheckBase,
  pts: number,
  detect: Extract<Detection, { type: 'grep' }>,
  ctx: FactContext,
): CheckResult {
  /** Content from the target file or section */
  const content = getSectionContent(detect.path, detect.section, ctx);
  if (content == null) {
    return {
      ...base,
      status: 'fail',
      points: 0,
      maxPoints: pts,
      message: 'Content not available',
    };
  }

  /** Case-insensitive multiline regex from the detection pattern */
  const regex = new RegExp(detect.pattern, 'im');
  /** Whether the pattern was found in the content */
  const match = regex.test(content);

  return {
    ...base,
    status: match ? 'pass' : 'fail',
    points: match ? pts : 0,
    maxPoints: pts,
    message: match
      ? `${base.name} present in ${resolvePath(detect.path, ctx)}`
      : `${base.name} not found. Expected pattern: /${detect.pattern}/ in ${resolvePath(detect.path, ctx)}`,
    evidence: detect.section
      ? `${resolvePath(detect.path, ctx)} [${detect.section}]`
      : resolvePath(detect.path, ctx),
  };
}

/** Count regex matches and compare against a minimum threshold. */
function evalGrepCount(
  base: CheckBase,
  pts: number,
  partialPts: number | undefined,
  detect: Extract<Detection, { type: 'grep_count' }>,
  ctx: FactContext,
): CheckResult {
  /** Content from the target file or section */
  const content = getSectionContent(detect.path, detect.section, ctx);
  if (content == null) {
    return {
      ...base,
      status: 'fail',
      points: 0,
      maxPoints: pts,
      message: 'Content not available',
    };
  }

  /** Global case-insensitive regex from the detection pattern */
  const regex = new RegExp(detect.pattern, 'gim');
  /** All regex matches found in the content */
  const matches = content.match(regex);
  /** Total number of matches found */
  const count = matches?.length ?? 0;
  /** Minimum number of matches required to pass */
  const min = detect.min;

  if (count >= min) {
    return {
      ...base,
      status: 'pass',
      points: pts,
      maxPoints: pts,
      message: `Found ${count} matches (need ${min}+)`,
    };
  }
  if (partialPts && count > 0) {
    return {
      ...base,
      status: 'partial',
      points: partialPts,
      maxPoints: pts,
      message: `Found ${count} matches (need ${min}+)`,
    };
  }
  return {
    ...base,
    status: 'fail',
    points: 0,
    maxPoints: pts,
    message: `Found ${count} matches (need ${min}+)`,
  };
}

/** Validate that a JSON file exists and parses successfully. */
function evalJsonValid(
  base: CheckBase,
  pts: number,
  detect: Extract<Detection, { type: 'json_valid' }>,
  ctx: FactContext,
): CheckResult {
  /** Resolved target file path */
  const path = resolvePath(detect.path, ctx);

  if (path === ctx.agentFacts.agent.settingsFile) {
    if (ctx.agentFacts.settings.exists === false) {
      return {
        ...base,
        status: 'na',
        points: 0,
        maxPoints: 0,
        message: 'No settings file for this agent',
      };
    }
    return {
      ...base,
      status: ctx.agentFacts.settings.valid ? 'pass' : 'fail',
      points: ctx.agentFacts.settings.valid ? pts : 0,
      maxPoints: pts,
      message: ctx.agentFacts.settings.valid
        ? `${path} is valid JSON`
        : `${path} is invalid JSON`,
      evidence: path,
    };
  }

  return {
    ...base,
    status: 'fail',
    points: 0,
    maxPoints: pts,
    message: `JSON check not implemented for ${path}`,
  };
}

/** Return the parsed settings object for a supported settings file path. */
function getSettingsObject(
  path: string,
  ctx: FactContext,
): Record<string, unknown> | null {
  if (
    path !== ctx.agentFacts.agent.settingsFile ||
    !ctx.agentFacts.settings.parsed
  )
    return null;
  return ctx.agentFacts.settings.parsed as Record<string, unknown>;
}

/** Resolve a dotted JSON field path inside a settings object. */
function resolveJsonFieldValue(
  obj: Record<string, unknown>,
  fieldPath: string,
): unknown {
  let current: unknown = obj;

  for (const field of fieldPath.split('.')) {
    if (
      current &&
      typeof current === 'object' &&
      field in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[field];
      continue;
    }
    return undefined;
  }

  return current;
}

/** Convert a JSON field value into the comparable string form used by checks. */
function stringifyJsonValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(' ');
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Evaluate whether a JSON file exposes a field, optionally matching a value pattern. */
function evalJsonContains(
  base: CheckBase,
  pts: number,
  detect: Extract<Detection, { type: 'json_contains' }>,
  ctx: FactContext,
): CheckResult {
  const path = resolvePath(detect.path, ctx);
  const obj = getSettingsObject(path, ctx);
  if (obj === null)
    return {
      ...base,
      status: 'fail',
      points: 0,
      maxPoints: pts,
      message: `Cannot check ${path}`,
    };

  const current = resolveJsonFieldValue(obj, detect.field);
  if (current === undefined) {
    return {
      ...base,
      status: 'fail',
      points: 0,
      maxPoints: pts,
      message: `${detect.field} not found in ${path}`,
    };
  }
  if (!detect.pattern) {
    return {
      ...base,
      status: 'pass',
      points: pts,
      maxPoints: pts,
      message: `${detect.field} exists in ${path}`,
    };
  }

  const regex = new RegExp(detect.pattern, 'i');
  const match = regex.test(stringifyJsonValue(current));
  return {
    ...base,
    status: match ? 'pass' : 'fail',
    points: match ? pts : 0,
    maxPoints: pts,
    message: match
      ? `${detect.field} contains /${detect.pattern}/`
      : `${detect.field} does not contain /${detect.pattern}/`,
    evidence: path,
  };
}

/** Count distinct items matching a pattern and compare against a pass threshold. */
function evalCountItems(
  base: CheckBase,
  pts: number,
  partialPts: number | undefined,
  detect: Extract<Detection, { type: 'count_items' }>,
  ctx: FactContext,
): CheckResult {
  /** Content from the target file or section */
  const content = getSectionContent(detect.path, detect.section, ctx);
  if (content == null) {
    return {
      ...base,
      status: 'fail',
      points: 0,
      maxPoints: pts,
      message: 'Content not available',
    };
  }

  /** Global case-insensitive regex from the detection pattern */
  const regex = new RegExp(detect.pattern, 'gim');
  /** All items matching the pattern */
  const matches = content.match(regex);
  /** Total number of matching items found */
  const count = matches?.length ?? 0;
  /** Minimum item count required to pass */
  const pass = detect.pass;

  if (count >= pass) {
    return {
      ...base,
      status: 'pass',
      points: pts,
      maxPoints: pts,
      message: `Found ${count} items (need ${pass}+)`,
    };
  }
  if (detect.partial && partialPts && count >= detect.partial) {
    return {
      ...base,
      status: 'partial',
      points: partialPts,
      maxPoints: pts,
      message: `Found ${count} items (need ${pass}+, partial at ${detect.partial}+)`,
    };
  }
  return {
    ...base,
    status: 'fail',
    points: 0,
    maxPoints: pts,
    message: `Found ${count} items (need ${pass}+)`,
  };
}

/** Run multiple sub-checks and aggregate results using 'all' or 'any' mode. */
function evalComposite(
  base: CheckBase,
  pts: number,
  partialPts: number | undefined,
  detect: Extract<Detection, { type: 'composite' }>,
  confidence: Confidence,
  ctx: FactContext,
): CheckResult {
  if (detect.checks.length === 0) {
    return {
      ...base,
      status: 'fail',
      points: 0,
      maxPoints: pts,
      message: 'Composite check has no sub-checks',
    };
  }

  /** Results from evaluating each sub-check independently */
  const results = detect.checks.map((sub) =>
    evaluateCheck(
      base.id,
      base.name,
      base.tier,
      base.category,
      1,
      undefined,
      sub,
      confidence,
      ctx,
    ),
  );

  /** Number of sub-checks that passed */
  const passed = results.filter((r) => r.status === 'pass').length;
  /** Total number of sub-checks */
  const total = results.length;

  if (detect.mode === 'all') {
    if (passed === total) {
      return {
        ...base,
        status: 'pass',
        points: pts,
        maxPoints: pts,
        message: `All ${total} sub-checks pass`,
      };
    }
    if (partialPts && passed > 0) {
      return {
        ...base,
        status: 'partial',
        points: partialPts,
        maxPoints: pts,
        message: `${passed}/${total} sub-checks pass`,
      };
    }
    return {
      ...base,
      status: 'fail',
      points: 0,
      maxPoints: pts,
      message: `${passed}/${total} sub-checks pass`,
    };
  }

  // mode: 'any'
  if (passed > 0) {
    return {
      ...base,
      status: 'pass',
      points: pts,
      maxPoints: pts,
      message: `${passed}/${total} sub-checks pass`,
    };
  }
  return {
    ...base,
    status: 'fail',
    points: 0,
    maxPoints: pts,
    message: `0/${total} sub-checks pass`,
  };
}

// === Helpers ===

/** Look up whether a path exists in shared project facts. */
function checkSharedPath(path: string, ctx: FactContext): boolean {
  /** Shared facts covering docs, evals, CI, and other project-wide resources */
  const shared = ctx.facts.shared;
  const normalizedDecisionsPath = shared.decisions.path.replace(/\/$/, '');
  /** Map of known paths to their existence status from shared facts */
  const pathMap: Record<string, boolean> = {
    [shared.footguns.paths.committed]: shared.footguns.committedExists,
    [shared.footguns.paths.local]: shared.footguns.localExists,
    [shared.lessons.paths.committed]: shared.lessons.committedExists,
    [shared.lessons.paths.local]: shared.lessons.localExists,
    'ai-docs/architecture.md': shared.architecture.exists,
    '.goat-flow/skill-conventions.md': shared.skillConventions.exists,
    [shared.evals.path]: shared.evals.dirExists,
    [shared.evals.path.replace(/\/$/, '')]: shared.evals.dirExists,
    [shared.evals.path.replace(/\/$/, '') + '/README.md']:
      shared.evals.hasReadme,
    '.copilotignore': shared.ignoreFiles.copilotignore,
    '.cursorignore': shared.ignoreFiles.cursorignore,
    '.geminiignore': shared.ignoreFiles.geminiignore,
    '.github/workflows/context-validation.yml': shared.ci.workflowExists,
    '.gitignore': shared.gitignore.exists,
    '.goat-flow/config.yaml': shared.config.exists,
    'scripts/preflight-checks.sh': shared.preflightScript.exists,
    [shared.decisions.path]: shared.decisions.dirExists,
    [normalizedDecisionsPath]: shared.decisions.dirExists,
    // CHANGELOG.md removed - project-level concern.
    [shared.localInstructions.path]:
      shared.localInstructions.dirExists &&
      shared.localInstructions.location === 'ai',
    [shared.localInstructions.path.replace(/\/$/, '')]:
      shared.localInstructions.dirExists &&
      shared.localInstructions.location === 'ai',
    'ai-docs/README.md':
      shared.localInstructions.hasValidRouter &&
      shared.localInstructions.location === 'ai',
    '.github/instructions':
      shared.localInstructions.dirExists &&
      shared.localInstructions.location === 'github',
    '.github/git-commit-instructions.md': shared.gitCommitInstructions.exists,
  };

  if (path in pathMap) {
    const value = pathMap[path];
    if (value === undefined) return false;
    return value;
  }

  // Skill paths are inferred from the installed skill inventory rather than disk reads.
  if (path.startsWith(ctx.agentFacts.agent.skillsDir)) {
    /** Skill directory name extracted from the path (e.g. "goat-security") */
    const skillName = path.split('/').slice(-2, -1)[0];
    if (skillName === undefined) return false;
    return ctx.agentFacts.skills.found.includes(skillName);
  }

  // Default: not found in facts
  return false;
}
