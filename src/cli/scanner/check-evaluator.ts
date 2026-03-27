import type { Detection, CheckResult, FactContext, Confidence } from '../types.js';

/**
 * Evaluate a Detection against extracted facts.
 * This is the core engine — 10 evaluator types handle all checks.
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
    case 'json_valid':
      return evalJsonValid(base, pts, detect, ctx);
    case 'json_contains':
      return evalJsonContains(base, pts, detect, ctx);
    case 'count_items':
      return evalCountItems(base, pts, partialPts, detect, ctx);
    case 'composite':
      return evalComposite(base, pts, partialPts, detect, confidence, ctx);
    case 'custom':
      return detect.fn(ctx);
  }
}

interface CheckBase {
  id: string;
  name: string;
  tier: 'foundation' | 'standard' | 'full';
  category: string;
  confidence: Confidence;
}

/** Resolve template placeholders in a path using agent facts. */
function resolvePath(path: string, ctx: FactContext): string {
  return path
    .replace('{instruction_file}', ctx.agentFacts.agent.instructionFile)
    .replace('{settings_file}', ctx.agentFacts.agent.settingsFile ?? '')
    .replace('{skills_dir}', ctx.agentFacts.agent.skillsDir)
    .replace('{hooks_dir}', ctx.agentFacts.agent.hooksDir ?? '')
    .replace('{deny_path}', getDenyPath(ctx));
}

/** Return the filesystem path for the agent's deny mechanism. */
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
function getSectionContent(path: string, section: string | undefined, ctx: FactContext): string | null {
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
    // Section not found — fall back to full content
    return ctx.agentFacts.instruction.content;
  }
  return null;
}

// === Evaluators ===

/** Check whether a specific file exists in the project. */
function evalFileExists(base: CheckBase, pts: number, detect: Extract<Detection, { type: 'file_exists' }>, ctx: FactContext): CheckResult {
  /** Resolved target file path */
  const path = resolvePath(detect.path, ctx);
  /** Whether the file was found in agent or shared facts */
  let exists = false;

  if (path === ctx.agentFacts.agent.instructionFile) {
    exists = ctx.agentFacts.instruction.exists;
  } else if (path === ctx.agentFacts.agent.settingsFile) {
    exists = ctx.agentFacts.settings.exists;
  } else {
    // Check shared facts
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

/** Check whether a specific directory exists in the project. */
function evalDirExists(base: CheckBase, pts: number, detect: Extract<Detection, { type: 'dir_exists' }>, ctx: FactContext): CheckResult {
  /** Resolved target directory path */
  const path = resolvePath(detect.path, ctx);
  /** Whether the directory was found in agent or shared facts */
  let exists = false;

  if (path === ctx.agentFacts.agent.skillsDir) {
    exists = ctx.agentFacts.skills.found.length > 0;
  } else if (path === ctx.agentFacts.agent.hooksDir) {
    exists = ctx.agentFacts.hooks.denyExists || ctx.agentFacts.hooks.postTurnExists;
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

/** Evaluate a file's line count against pass/fail thresholds. */
function evalLineCount(base: CheckBase, pts: number, partialPts: number | undefined, detect: Extract<Detection, { type: 'line_count' }>, ctx: FactContext): CheckResult {
  /** Resolved target file path */
  const path = resolvePath(detect.path, ctx);
  /** Number of lines in the target file */
  let lineCount = 0;

  if (path === ctx.agentFacts.agent.instructionFile) {
    lineCount = ctx.agentFacts.instruction.lineCount;
    if (ctx.agentFacts.instruction.exists === false) {
      return { ...base, status: 'fail', points: 0, maxPoints: pts, message: `${path} not found` };
    }
  } else if (path === 'docs/architecture.md') {
    lineCount = ctx.facts.shared.architecture.lineCount;
    if (ctx.facts.shared.architecture.exists === false) {
      return { ...base, status: 'fail', points: 0, maxPoints: pts, message: `${path} not found` };
    }
  }

  /** Line count at or below which the check passes */
  const passThreshold = detect.pass ?? 0;
  /** Line count at or above which the check fails */
  const failThreshold = detect.fail ?? Infinity;

  if (lineCount < passThreshold) {
    return { ...base, status: 'pass', points: pts, maxPoints: pts, message: `${lineCount} lines (under ${passThreshold} target)`, evidence: `${path}: ${lineCount} lines` };
  }
  if (detect.partial && partialPts && lineCount < failThreshold) {
    return { ...base, status: 'partial', points: partialPts, maxPoints: pts, message: `${lineCount} lines (under ${failThreshold} limit but over ${passThreshold} target)`, evidence: `${path}: ${lineCount} lines` };
  }
  return { ...base, status: 'fail', points: 0, maxPoints: pts, message: `${lineCount} lines (over ${failThreshold} limit)`, evidence: `${path}: ${lineCount} lines` };
}

/** Check whether a regex pattern matches within file or section content. */
function evalGrep(base: CheckBase, pts: number, detect: Extract<Detection, { type: 'grep' }>, ctx: FactContext): CheckResult {
  /** Content from the target file or section */
  const content = getSectionContent(detect.path, detect.section, ctx);
  if (content == null) {
    return { ...base, status: 'fail', points: 0, maxPoints: pts, message: 'Content not available' };
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
      ? `Pattern found: /${detect.pattern}/`
      : `Pattern not found: /${detect.pattern}/`,
    evidence: detect.section ? `${resolvePath(detect.path, ctx)} [${detect.section}]` : resolvePath(detect.path, ctx),
  };
}

/** Count regex matches and compare against a minimum threshold. */
function evalGrepCount(base: CheckBase, pts: number, partialPts: number | undefined, detect: Extract<Detection, { type: 'grep_count' }>, ctx: FactContext): CheckResult {
  /** Content from the target file or section */
  const content = getSectionContent(detect.path, detect.section, ctx);
  if (content == null) {
    return { ...base, status: 'fail', points: 0, maxPoints: pts, message: 'Content not available' };
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
    return { ...base, status: 'pass', points: pts, maxPoints: pts, message: `Found ${count} matches (need ${min}+)` };
  }
  if (partialPts && count > 0) {
    return { ...base, status: 'partial', points: partialPts, maxPoints: pts, message: `Found ${count} matches (need ${min}+)` };
  }
  return { ...base, status: 'fail', points: 0, maxPoints: pts, message: `Found ${count} matches (need ${min}+)` };
}

/** Validate that a JSON file exists and parses successfully. */
function evalJsonValid(base: CheckBase, pts: number, detect: Extract<Detection, { type: 'json_valid' }>, ctx: FactContext): CheckResult {
  /** Resolved target file path */
  const path = resolvePath(detect.path, ctx);

  if (path === ctx.agentFacts.agent.settingsFile) {
    if (ctx.agentFacts.settings.exists === false) {
      return { ...base, status: 'na', points: 0, maxPoints: 0, message: 'No settings file for this agent' };
    }
    return {
      ...base,
      status: ctx.agentFacts.settings.valid ? 'pass' : 'fail',
      points: ctx.agentFacts.settings.valid ? pts : 0,
      maxPoints: pts,
      message: ctx.agentFacts.settings.valid ? `${path} is valid JSON` : `${path} is invalid JSON`,
      evidence: path,
    };
  }

  return { ...base, status: 'fail', points: 0, maxPoints: pts, message: `JSON check not implemented for ${path}` };
}

/** Check whether a JSON file contains a specific field, optionally matching a pattern. */
function evalJsonContains(base: CheckBase, pts: number, detect: Extract<Detection, { type: 'json_contains' }>, ctx: FactContext): CheckResult {
  /** Resolved target file path */
  const path = resolvePath(detect.path, ctx);

  if (path === ctx.agentFacts.agent.settingsFile && ctx.agentFacts.settings.parsed) {
    /** Parsed JSON object from the settings file */
    const obj = ctx.agentFacts.settings.parsed as Record<string, unknown>;
    /** Dot-separated field segments to traverse */
    const fields = detect.field.split('.');
    /** Current value being traversed through nested fields */
    let current: unknown = obj;
    // Iterate over field segments to drill into the nested JSON structure
    for (const field of fields) {
      if (current && typeof current === 'object' && field in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[field];
      } else {
        current = undefined;
        break;
      }
    }

    if (current === undefined) {
      return { ...base, status: 'fail', points: 0, maxPoints: pts, message: `${detect.field} not found in ${path}` };
    }

    if (detect.pattern) {
      /** Case-insensitive regex from the detection pattern */
      const regex = new RegExp(detect.pattern, 'i');
      /** Stringified value for regex matching — arrays are joined, objects are serialized */
      const value = Array.isArray(current) ? current.join(' ') : (typeof current === 'string' ? current : JSON.stringify(current));
      /** Whether the pattern was found in the stringified value */
      const match = regex.test(value);
      return {
        ...base,
        status: match ? 'pass' : 'fail',
        points: match ? pts : 0,
        maxPoints: pts,
        message: match ? `${detect.field} contains /${detect.pattern}/` : `${detect.field} does not contain /${detect.pattern}/`,
        evidence: path,
      };
    }

    return { ...base, status: 'pass', points: pts, maxPoints: pts, message: `${detect.field} exists in ${path}` };
  }

  return { ...base, status: 'fail', points: 0, maxPoints: pts, message: `Cannot check ${path}` };
}

/** Count distinct items matching a pattern and compare against a pass threshold. */
function evalCountItems(base: CheckBase, pts: number, partialPts: number | undefined, detect: Extract<Detection, { type: 'count_items' }>, ctx: FactContext): CheckResult {
  /** Content from the target file or section */
  const content = getSectionContent(detect.path, detect.section, ctx);
  if (content == null) {
    return { ...base, status: 'fail', points: 0, maxPoints: pts, message: 'Content not available' };
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
    return { ...base, status: 'pass', points: pts, maxPoints: pts, message: `Found ${count} items (need ${pass}+)` };
  }
  if (detect.partial && partialPts && count >= detect.partial) {
    return { ...base, status: 'partial', points: partialPts, maxPoints: pts, message: `Found ${count} items (need ${pass}+, partial at ${detect.partial}+)` };
  }
  return { ...base, status: 'fail', points: 0, maxPoints: pts, message: `Found ${count} items (need ${pass}+)` };
}

/** Run multiple sub-checks and aggregate results using 'all' or 'any' mode. */
function evalComposite(base: CheckBase, pts: number, partialPts: number | undefined, detect: Extract<Detection, { type: 'composite' }>, confidence: Confidence, ctx: FactContext): CheckResult {
  if (detect.checks.length === 0) {
    return { ...base, status: 'fail', points: 0, maxPoints: pts, message: 'Composite check has no sub-checks' };
  }

  /** Results from evaluating each sub-check independently */
  const results = detect.checks.map(sub =>
    evaluateCheck(base.id, base.name, base.tier, base.category, 1, undefined, sub, confidence, ctx)
  );

  /** Number of sub-checks that passed */
  const passed = results.filter(r => r.status === 'pass').length;
  /** Total number of sub-checks */
  const total = results.length;

  if (detect.mode === 'all') {
    if (passed === total) {
      return { ...base, status: 'pass', points: pts, maxPoints: pts, message: `All ${total} sub-checks pass` };
    }
    if (partialPts && passed > 0) {
      return { ...base, status: 'partial', points: partialPts, maxPoints: pts, message: `${passed}/${total} sub-checks pass` };
    }
    return { ...base, status: 'fail', points: 0, maxPoints: pts, message: `${passed}/${total} sub-checks pass` };
  }

  // mode: 'any'
  if (passed > 0) {
    return { ...base, status: 'pass', points: pts, maxPoints: pts, message: `${passed}/${total} sub-checks pass` };
  }
  return { ...base, status: 'fail', points: 0, maxPoints: pts, message: `0/${total} sub-checks pass` };
}

// === Helpers ===

/** Look up whether a path exists in shared project facts. */
function checkSharedPath(path: string, ctx: FactContext): boolean {
  /** Shared facts covering docs, evals, CI, and other project-wide resources */
  const shared = ctx.facts.shared;
  /** Map of known paths to their existence status from shared facts */
  const pathMap: Record<string, boolean> = {
    'docs/footguns.md': shared.footguns.exists,
    'docs/lessons.md': shared.lessons.exists,
    'docs/architecture.md': shared.architecture.exists,
    'docs/guidelines-ownership-split.md': shared.guidelinesOwnership.exists,
    'docs/domain-reference.md': shared.domainReference.exists,
    'tasks/handoff-template.md': shared.handoffTemplate.exists,
    'agent-evals': shared.evals.dirExists,
    'agent-evals/README.md': shared.evals.hasReadme,
    '.copilotignore': shared.ignoreFiles.copilotignore,
    '.cursorignore': shared.ignoreFiles.cursorignore,
    '.geminiignore': shared.ignoreFiles.geminiignore,
    '.github/workflows/context-validation.yml': shared.ci.workflowExists,
    '.gitignore': shared.gitignore.exists,
    'scripts/preflight-checks.sh': shared.preflightScript.exists,
    // CHANGELOG.md removed — project-level concern.
    'ai/instructions': shared.localInstructions.dirExists && shared.localInstructions.location === 'ai',
    'ai/README.md': shared.localInstructions.hasRouter && shared.localInstructions.location === 'ai',
    '.github/instructions': shared.localInstructions.dirExists && shared.localInstructions.location === 'github',
    '.github/git-commit-instructions.md': shared.gitCommitInstructions.exists,
  };

  if (path in pathMap) {
    const value = pathMap[path];
    if (value === undefined) return false;
    return value;
  }

  // Check skill paths
  if (path.startsWith(ctx.agentFacts.agent.skillsDir)) {
    /** Skill directory name extracted from the path (e.g. "goat-security") */
    const skillName = path.split('/').slice(-2, -1)[0];
    if (skillName === undefined) return false;
    return ctx.agentFacts.skills.found.includes(skillName);
  }

  // Default: not found in facts
  return false;
}
