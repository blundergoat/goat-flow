import type { AgentProfile, AgentFacts, ReadonlyFS } from '../types.js';
import { SKILL_NAMES } from '../constants.js';

/** Skill names that a fully configured GOAT Flow agent should have */
const EXPECTED_SKILLS = SKILL_NAMES;

/**
 * Parse markdown into sections: heading -> content
 */
function parseSections(content: string): Map<string, string> {
  /** Accumulated heading-to-content mapping */
  const sections = new Map<string, string>();
  /** Input split into individual lines */
  const lines = content.split('\n');
  let currentHeading = '';
  let currentContent: string[] = [];

  // Iterate over lines to group content under markdown headings
  for (const line of lines) {
    /** Regex match result for lines starting with 1-3 '#' characters */
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentHeading) {
        sections.set(currentHeading.toLowerCase(), currentContent.join('\n'));
      }
      const captured = headingMatch[1];
      if (captured === undefined) continue;
      currentHeading = captured;
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentHeading) {
    sections.set(currentHeading.toLowerCase(), currentContent.join('\n'));
  }

  return sections;
}

/** Determine whether git commit and git push are blocked by the agent's deny mechanism. */
function checkDenyPatterns(fs: ReadonlyFS, agent: AgentProfile): { gitCommitBlocked: boolean; gitPushBlocked: boolean } {
  /** Deny mechanism configuration for this agent */
  const deny = agent.denyMechanism;

  if (deny.type === 'settings-deny') {
    /** Parsed JSON from the settings deny file */
    const parsed = fs.readJson(deny.path) as Record<string, unknown> | null;
    if (parsed == null) return { gitCommitBlocked: false, gitPushBlocked: false };
    /** Permissions object from the parsed settings */
    const permissions = parsed.permissions as Record<string, unknown> | undefined;
    /** Raw deny array from permissions */
    const rawDeny = permissions?.deny;
    /** Deny patterns as a string array, defaulting to empty */
    const denyList = Array.isArray(rawDeny) ? (rawDeny as string[]) : [];
    return {
      gitCommitBlocked: denyList.some(p => p.includes('git commit')),
      gitPushBlocked: denyList.some(p => p.includes('git push')),
    };
  }

  if (deny.type === 'deny-script') {
    /** Content of the deny hook script */
    const content = fs.readFile(deny.path);
    if (content == null) return { gitCommitBlocked: false, gitPushBlocked: false };
    return {
      gitCommitBlocked: /git\s+commit/i.test(content),
      gitPushBlocked: /git\s+push/i.test(content),
    };
  }

  // type: 'both'
  /** Deny results from the settings-based mechanism */
  const settings = checkDenyPatterns(fs, { ...agent, denyMechanism: { type: 'settings-deny', path: deny.settingsPath } });
  /** Deny results from the script-based mechanism */
  const script = checkDenyPatterns(fs, { ...agent, denyMechanism: { type: 'deny-script', path: deny.scriptPath } });
  return {
    gitCommitBlocked: settings.gitCommitBlocked || script.gitCommitBlocked,
    gitPushBlocked: settings.gitPushBlocked || script.gitPushBlocked,
  };
}

/** Return true if a string looks like a file/directory path (contains / or .). */
function looksLikePath(s: string): boolean {
  return s.includes('/') || s.includes('.');
}

/** Return true if a string contains glob or template characters. */
function hasGlobChars(s: string): boolean {
  return s.includes('*') || s.includes('{');
}

/** Extract all file/directory paths referenced in the Router Table section. */
function extractRouterPaths(content: string): string[] {
  /** Accumulated list of discovered router paths */
  const paths: string[] = [];
  /** Content of the router section extracted from the instruction file */
  const routerSection = extractSection(content, 'router');
  if (routerSection == null) return paths;

  /** Backtick-wrapped path matches (e.g. `docs/footguns.md`) */
  const backtickMatches = routerSection.matchAll(/`([^`]+)`/g);
  // Iterate over backtick matches to collect file paths from the router table
  for (const match of backtickMatches) {
    /** Extracted path string from inside backticks */
    const path = match[1];
    if (path === undefined) continue;
    if (hasGlobChars(path)) continue;
    if (looksLikePath(path) === false) continue;
    paths.push(path);
  }

  /** Markdown link path matches (e.g. [text](path)) */
  const linkMatches = routerSection.matchAll(/\]\(([^)]+)\)/g);
  // Iterate over markdown link matches to collect additional file paths
  for (const match of linkMatches) {
    /** Extracted path string from inside the link parentheses */
    const path = match[1];
    if (path === undefined) continue;
    if (hasGlobChars(path)) continue;
    if (path.startsWith('http')) continue;
    if (looksLikePath(path) === false) continue;
    // Avoid duplicates from paths already captured via backticks
    if (paths.includes(path) === false) paths.push(path);
  }

  return paths;
}

/** Extract file paths listed in the Ask First boundaries section. */
function extractAskFirstPaths(content: string): string[] {
  /** Accumulated list of discovered ask-first boundary paths */
  const paths: string[] = [];

  // Find the Ask First section -- either as a heading or bold text
  let section: string | null = null;
  /** Match for a heading-style Ask First section */
  const headingMatch = content.match(/##\s+ask\s+first[\s\S]*?(?=\n##\s|$)/i);
  if (headingMatch) {
    section = headingMatch[0];
  } else {
    /** Match for a bold-style Ask First section */
    const boldMatch = content.match(/\*\*Ask First\*\*[\s\S]*?(?=\n\*\*Never\*\*|\n##\s|$)/i);
    if (boldMatch) section = boldMatch[0];
  }

  if (section == null) return paths;

  /** Backtick-wrapped path matches from within the Ask First section */
  const backtickMatches = section.matchAll(/`([^`]+)`/g);
  // Iterate over backtick matches to collect boundary file paths
  for (const match of backtickMatches) {
    /** Extracted path string from inside backticks */
    const path = match[1];
    if (path === undefined) continue;
    if (path.includes('*') || path.includes('{')) continue;
    if (path.startsWith('http')) continue;
    // Must look like a file/directory path
    if (path.includes('/') === false && path.includes('.') === false) continue;
    // Skip things that are clearly not paths (commands, patterns)
    if (path.includes('|') || path.startsWith('-') || path.startsWith('$')) continue;
    if (paths.includes(path) === false) paths.push(path);
  }

  return paths;
}

/** Extract the content under a named heading section from markdown text. */
function extractSection(content: string, sectionName: string): string | null {
  /** Input split into individual lines */
  const lines = content.split('\n');
  let inSection = false;
  /** Lines collected while inside the target section */
  const sectionLines: string[] = [];

  // Iterate over lines to find and extract the named section content
  for (const line of lines) {
    /** Regex match result for markdown heading lines */
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      if (inSection) break;
      const headingText = heading[1];
      if (headingText === undefined) continue;
      if (headingText.toLowerCase().includes(sectionName.toLowerCase())) {
        inSection = true;
      }
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.length > 0 ? sectionLines.join('\n') : null;
}

// ─── Focused extraction functions ────────────────────────────────────

/** Extract instruction file facts: existence, content, line count, and sections. */
function extractInstructionFacts(fs: ReadonlyFS, agent: AgentProfile): AgentFacts['instruction'] {
  /** Raw content of the agent's instruction file (null if missing) */
  const content = fs.readFile(agent.instructionFile);
  /** Whether the instruction file exists on disk */
  const exists = content !== null;
  /** Number of lines in the instruction file */
  const lineCount = exists
    ? content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
    : 0;
  /** Parsed heading-to-content sections from the instruction file */
  const sections = exists ? parseSections(content) : new Map<string, string>();

  return { exists, content, lineCount, sections };
}

/** Extract settings file facts: existence, validity, parsed content, deny patterns. */
function extractSettingsFacts(fs: ReadonlyFS, agent: AgentProfile): AgentFacts['settings'] & { readDenyCoversSecrets: boolean } {
  /** Whether the agent's settings file exists on disk */
  const exists = agent.settingsFile ? fs.exists(agent.settingsFile) : false;
  let valid = false;
  let parsed: unknown = null;
  let hasDenyPatterns = false;
  if (agent.settingsFile) {
    if (agent.settingsFile.endsWith('.toml')) {
      // TOML (Codex config.toml) -- read as text, not JSON
      /** Raw TOML content read as plain text */
      const tomlContent = fs.readFile(agent.settingsFile);
      valid = tomlContent !== null && tomlContent.length > 0;
      // settingsParsed stays null -- TOML is inspected via text regex, not parsed object
    } else {
      parsed = fs.readJson(agent.settingsFile);
      valid = parsed !== null;
    }
    if (valid && parsed) {
      /** Permissions object from the parsed settings */
      const perms = (parsed as Record<string, unknown>).permissions as Record<string, unknown> | undefined;
      /** Raw deny array from permissions */
      const denyArr = perms?.deny;
      hasDenyPatterns = Array.isArray(denyArr) && (denyArr as string[]).length > 0;
    }
  }

  // Check read-deny covers common sensitive paths
  const readDenyCoversSecrets = checkReadDenyCoversSecrets(parsed, hasDenyPatterns);

  return { exists, valid, parsed, hasDenyPatterns, readDenyCoversSecrets };
}

/** Check whether read-deny patterns cover common sensitive file paths. */
function checkReadDenyCoversSecrets(parsed: unknown, hasDenyPatterns: boolean): boolean {
  if (!hasDenyPatterns || !parsed) return false;
  /** Permissions object from the parsed settings */
  const perms = (parsed as Record<string, unknown>).permissions as Record<string, unknown> | undefined;
  /** Raw deny array from permissions */
  const denyArr = perms?.deny;
  if (!Array.isArray(denyArr)) return false;
  /** All deny patterns concatenated into a single string for regex matching */
  const denyStr = (denyArr as string[]).join(' ');
  /** Whether .env paths are covered by deny rules */
  const hasEnv = /Read\(.*\.env/.test(denyStr);
  /** Whether .ssh paths are covered by deny rules */
  const hasSsh = /Read\(.*\.ssh/.test(denyStr);
  /** Whether .aws paths are covered by deny rules */
  const hasAws = /Read\(.*\.aws/.test(denyStr);
  /** Whether key/credential paths are covered by deny rules */
  const hasKeys = /Read\(.*\.(pem|key|pfx)\b/.test(denyStr) || /Read\(.*credentials/.test(denyStr);
  return hasEnv && hasSsh && hasAws && hasKeys;
}

/** Extract skill facts: found/missing skills and quality metrics. */
function extractSkillFacts(fs: ReadonlyFS, agent: AgentProfile): AgentFacts['skills'] {
  /** Names of skills that were found on disk */
  const found: string[] = [];
  /** Names of expected skills that are missing */
  const missing: string[] = [];
  let withStep0 = 0;
  let withHumanGate = 0;
  let withConstraints = 0;
  let withPhases = 0;
  let withConversational = 0;
  let withChaining = 0;
  let withChoices = 0;
  let withOutputFormat = 0;
  // Iterate over expected skills to check existence and content quality
  for (const skill of EXPECTED_SKILLS) {
    /** Full path to this skill's SKILL.md file */
    const skillPath = `${agent.skillsDir}/${skill}/SKILL.md`;
    if (fs.exists(skillPath)) {
      found.push(skill);
      /** Raw content of the skill file for quality analysis */
      const skillContent = fs.readFile(skillPath);
      if (skillContent) {
        if (/step\s*0|gather\s*context|ask.*before|ask\s+the\s+user/i.test(skillContent)) withStep0++;
        if (/human\s*gate|wait.*approv|wait.*confirm|do\s+not\s+proceed|does this.*look right|does this.*match/i.test(skillContent)) withHumanGate++;
        if (/MUST\s+NOT|MUST\s+/m.test(skillContent)) withConstraints++;
        if (/##\s*(Phase|Step)\s+[0-9]/i.test(skillContent)) withPhases++;
        if (/conversational|drill.*in|dig deeper|walk.*through|present.*findings.*then|let.*human.*drill|iterate|follow[-.]up question/i.test(skillContent)) withConversational++;
        if (/chains?\s*with|related\s*skills?|next.*skill|→.*goat-/i.test(skillContent)) withChaining++;
        if (/\(a\)|\(b\)|\(c\)|want me to.*\n.*\n/i.test(skillContent)) withChoices++;
        if (/##\s*(Output|Output Format)/i.test(skillContent)) withOutputFormat++;
      }
    } else {
      missing.push(skill);
    }
  }

  return {
    found, missing, allPresent: missing.length === 0,
    quality: { withStep0, withHumanGate, withConstraints, withPhases, withConversational, withChaining, withChoices, withOutputFormat, total: found.length },
  };
}

/** Check compaction notification hook in parsed settings JSON. */
function checkCompactionHook(settingsParsed: unknown, settingsValid: boolean): boolean {
  if (!settingsParsed || !settingsValid) return false;

  /** Top-level settings object cast for property access */
  const settings = settingsParsed as Record<string, unknown>;
  /** Hooks configuration from settings */
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks || typeof hooks !== 'object') return false;

  if (Array.isArray(hooks)) {
    // Array format: hooks: [{type: "Notification", matcher: "compact"}]
    return (hooks as Array<Record<string, unknown>>).some(h =>
      h.type === 'Notification' && (typeof h.matcher === 'string' ? h.matcher : '').includes('compact')
    );
  }
  // Nested format: hooks.Notification[{matcher: "compact"}]
  /** Notification hooks array from the nested hooks object */
  const notifHooks = (hooks).Notification as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(notifHooks)) {
    return notifHooks.some(h =>
      (typeof h.matcher === 'string' ? h.matcher : '').includes('compact')
    );
  }
  return false;
}

/** Analyze a hook script for post-turn validation characteristics. */
function analyzePostTurnScript(hookContent: string): { exitsZero: boolean; hasValidation: boolean } {
  /** Non-empty, non-comment lines from the hook script */
  const lines = hookContent.trim().split('\n').filter(l => l.trim() && l.trim().startsWith('#') === false);
  /** Last meaningful line of the hook script */
  const lastLine = lines[lines.length - 1];
  return {
    exitsZero: lastLine !== undefined && lastLine.trim() === 'exit 0',
    hasValidation: /shellcheck|tsc|lint|fmt|check|test|wc -l/i.test(hookContent) && hookContent.split('\n').length > 10,
  };
}

/** Check deny hook script content for quality indicators. */
function analyzeDenyScript(denyContent: string): {
  hasBlocks: boolean; usesJq: boolean; handlesChaining: boolean;
  blocksRmRf: boolean; blocksForcePush: boolean; blocksChmod: boolean;
} {
  return {
    hasBlocks: /exit\s+2|block|BLOCK/i.test(denyContent) && denyContent.split('\n').length > 5,
    usesJq: /\bjq\b/.test(denyContent) && !/grep\s+-[a-zA-Z]*P/.test(denyContent),
    handlesChaining: /&&|\|\||;/.test(denyContent) && /split|segment|chain/i.test(denyContent),
    blocksRmRf: /rm\s*.*-.*r.*f|rm\s*-rf/i.test(denyContent),
    blocksForcePush: /force.*push|--force/i.test(denyContent),
    blocksChmod: /chmod.*777/.test(denyContent),
  };
}

/** Apply settings-based Bash deny pattern overrides to hook facts. */
function applySettingsDenyOverrides(
  denyStr: string,
  hook: { denyExists: boolean; denyHasBlocks: boolean; denyUsesJq: boolean; denyHandlesChaining: boolean;
    denyBlocksRmRf: boolean; denyBlocksForcePush: boolean; denyBlocksChmod: boolean },
): void {
  // Settings deny counts as a deny mechanism existing
  if (hook.denyExists === false && denyStr.includes('Bash(')) {
    hook.denyExists = true;
    // settings.json deny is mechanical blocking
    hook.denyHasBlocks = true;
    // no JSON parsing needed -- it's config, not a script
    hook.denyUsesJq = true;
    // settings.json matches substrings, handles chaining implicitly
    hook.denyHandlesChaining = true;
  }
  // Check for specific dangerous patterns in Bash deny rules
  if (/Bash\(.*rm -rf|Bash\(.*rm -fr/i.test(denyStr)) hook.denyBlocksRmRf = true;
  if (/Bash\(.*--force|Bash\(.*force.*push/i.test(denyStr)) hook.denyBlocksForcePush = true;
  if (/Bash\(.*chmod 777/i.test(denyStr)) hook.denyBlocksChmod = true;
}

/** Enrich deny hook facts from settings.json Bash deny patterns. */
function enrichDenyFromSettings(
  settingsParsed: unknown, hasDenyPatterns: boolean,
  hook: { denyExists: boolean; denyHasBlocks: boolean; denyUsesJq: boolean; denyHandlesChaining: boolean;
    denyBlocksRmRf: boolean; denyBlocksForcePush: boolean; denyBlocksChmod: boolean },
): void {
  if (!hasDenyPatterns || !settingsParsed) return;
  /** Permissions object from the parsed settings */
  const perms = (settingsParsed as Record<string, unknown>).permissions as Record<string, unknown> | undefined;
  /** Raw deny array from permissions */
  const rawDeny = perms?.deny;
  if (!Array.isArray(rawDeny)) return;
  /** All deny patterns concatenated for pattern matching */
  const denyStr = (rawDeny as string[]).join(' ');
  applySettingsDenyOverrides(denyStr, hook);
}

/** Apply Codex execpolicy Starlark rules to deny hook facts. */
function enrichDenyFromExecpolicy(
  fs: ReadonlyFS,
  hook: { denyExists: boolean; denyHasBlocks: boolean; denyUsesJq: boolean; denyHandlesChaining: boolean;
    denyBlocksRmRf: boolean; denyBlocksForcePush: boolean; denyBlocksChmod: boolean },
): void {
  /** Path to the Codex execpolicy Starlark rule file */
  const execpolicyPath = '.codex/rules/deny-dangerous.star';
  if (!fs.exists(execpolicyPath)) return;
  /** Raw content of the Starlark rule file */
  const ruleContent = fs.readFile(execpolicyPath);
  if (!ruleContent) return;
  hook.denyExists = true;
  hook.denyHasBlocks = /forbidden|prompt/i.test(ruleContent) && ruleContent.split('\n').length > 5;
  hook.denyBlocksRmRf = /rm.*-.*rf|rm.*-.*fr/i.test(ruleContent);
  hook.denyBlocksForcePush = /force.*push|--force/i.test(ruleContent);
  hook.denyBlocksChmod = /chmod.*777/.test(ruleContent);
  // Execpolicy uses Starlark, not jq -- mark as safe parsing
  hook.denyUsesJq = true;
  // Starlark processes the full command string, handling chaining implicitly
  hook.denyHandlesChaining = true;
}

/** Extract all hook-related facts: deny hooks, post-turn, post-tool, compaction. */
function extractHookFacts(
  fs: ReadonlyFS, agent: AgentProfile, settingsParsed: unknown, hasDenyPatterns: boolean, settingsValid: boolean,
): Omit<AgentFacts['hooks'], 'readDenyCoversSecrets'> {
  // Check for compaction notification hook in settings
  let compactionHookExists = checkCompactionHook(settingsParsed, settingsValid);

  // For Codex: session_start hook serves similar purpose to compaction
  if (agent.id === 'codex' && compactionHookExists === false) {
    /** Raw content of the Codex config.toml file */
    const configContent = fs.readFile('.codex/config.toml');
    if (configContent && /\[hooks\.session_start\]/.test(configContent)) {
      compactionHookExists = true;
    }
  }

  /** Filesystem path to the deny hook script, if any */
  const denyHookPath = agent.hooksDir
    ? `${agent.hooksDir}/deny-dangerous.sh`
    : (agent.denyMechanism.type === 'deny-script' ? agent.denyMechanism.path : null);

  const hook = {
    denyExists: denyHookPath ? fs.exists(denyHookPath) : false,
    denyHasBlocks: false, denyUsesJq: false, denyHandlesChaining: false,
    denyBlocksRmRf: false, denyBlocksForcePush: false, denyBlocksChmod: false,
  };

  // First: check hook script content (if exists)
  if (hook.denyExists && denyHookPath) {
    /** Raw content of the deny hook script */
    const denyContent = fs.readFile(denyHookPath);
    if (denyContent) {
      const analysis = analyzeDenyScript(denyContent);
      hook.denyHasBlocks = analysis.hasBlocks;
      hook.denyUsesJq = analysis.usesJq;
      hook.denyHandlesChaining = analysis.handlesChaining;
      hook.denyBlocksRmRf = analysis.blocksRmRf;
      hook.denyBlocksForcePush = analysis.blocksForcePush;
      hook.denyBlocksChmod = analysis.blocksChmod;
    }
  }

  // Second: also check settings.json Bash deny patterns
  enrichDenyFromSettings(settingsParsed, hasDenyPatterns, hook);

  // For Codex: also check execpolicy rules
  if (agent.id === 'codex') {
    enrichDenyFromExecpolicy(fs, hook);
  }

  const postTurn = extractPostTurnFacts(fs, agent);

  return {
    ...hook,
    postTurnExists: postTurn.postTurnExists,
    postTurnExitsZero: postTurn.postTurnExitsZero,
    postTurnHasValidation: postTurn.postTurnHasValidation,
    postToolExists: postTurn.postToolExists,
    compactionHookExists,
  };
}

/** Extract post-turn and post-tool hook facts. */
function extractPostTurnFacts(fs: ReadonlyFS, agent: AgentProfile): {
  postTurnExists: boolean; postTurnExitsZero: boolean;
  postTurnHasValidation: boolean; postToolExists: boolean;
} {
  let postTurnExists = false;
  let postTurnExitsZero = false;
  let postTurnHasValidation = false;
  let postToolExists = false;

  // For Codex: detect config.toml and registered hooks
  if (agent.id === 'codex') {
    /** Path to the Codex configuration file */
    const configPath = '.codex/config.toml';
    /** Raw content of the Codex config.toml */
    const configContent = fs.readFile(configPath);
    if (configContent) {
      // Check for Stop hook registration
      if (/\[hooks\.stop\]/.test(configContent)) {
        postTurnExists = true;
        /** Regex match extracting the script path from the stop hook configuration */
        const stopScript = configContent.match(/\[hooks\.stop\]\s*\n\s*command\s*=\s*\[.*?"([^"]+\.sh)"/);
        const stopScriptPath = stopScript?.[1];
        if (stopScriptPath !== undefined) {
          /** Raw content of the stop hook script */
          const hookContent = fs.readFile(stopScriptPath);
          if (hookContent) {
            const analysis = analyzePostTurnScript(hookContent);
            postTurnExitsZero = analysis.exitsZero;
            postTurnHasValidation = analysis.hasValidation;
          }
        }
      }
      // Check for AfterToolUse hook registration
      if (/\[hooks\.after_tool_use\]/.test(configContent)) {
        postToolExists = true;
      }
    }
  } else if (agent.hooksDir) {
    /** Path to the post-turn lint hook script */
    const stopLintPath = `${agent.hooksDir}/stop-lint.sh`;
    postTurnExists = fs.exists(stopLintPath);
    if (postTurnExists) {
      /** Raw content of the stop-lint hook script */
      const hookContent = fs.readFile(stopLintPath);
      if (hookContent) {
        const analysis = analyzePostTurnScript(hookContent);
        postTurnExitsZero = analysis.exitsZero;
        postTurnHasValidation = analysis.hasValidation;
      }
    }
    postToolExists = fs.exists(`${agent.hooksDir}/format-file.sh`);
  }

  return { postTurnExists, postTurnExitsZero, postTurnHasValidation, postToolExists };
}

/** Extract router table facts: paths found and their resolution status. */
function extractRouterFacts(fs: ReadonlyFS, content: string | null): AgentFacts['router'] {
  /** File paths referenced in the router table */
  const paths = content !== null ? extractRouterPaths(content) : [];
  let resolved = 0;
  /** Router paths that do not exist on disk */
  const unresolved: string[] = [];
  // Iterate over router paths to verify each one exists on disk
  for (const p of paths) {
    if (fs.exists(p)) {
      resolved++;
    } else {
      unresolved.push(p);
    }
  }
  return { exists: paths.length > 0, paths, resolved, unresolved };
}

/** Extract ask-first boundary facts: paths listed and their resolution status. */
function extractAskFirstFacts(fs: ReadonlyFS, content: string | null): AgentFacts['askFirst'] {
  /** File paths listed in the Ask First boundaries section */
  const paths = content !== null ? extractAskFirstPaths(content) : [];
  let resolved = 0;
  /** Ask-first paths that do not exist on disk */
  const unresolved: string[] = [];
  // Iterate over ask-first paths to verify each one exists on disk
  for (const p of paths) {
    if (fs.exists(p)) {
      resolved++;
    } else {
      unresolved.push(p);
    }
  }
  return { exists: paths.length > 0, paths, resolved, unresolved };
}

/** Extract settings.local.json facts: existence and line count. */
function extractSettingsLocalFacts(fs: ReadonlyFS, agent: AgentProfile): AgentFacts['settingsLocal'] {
  if (!agent.settingsFile) return { exists: false, lineCount: 0 };
  /** Derived path to the local settings override file */
  const localPath = agent.settingsFile.replace(/\.json$/, '.local.json');
  const exists = fs.exists(localPath);
  const lineCount = exists ? fs.lineCount(localPath) : 0;
  return { exists, lineCount };
}

/** Check whether any hook script references Ask First boundary paths for enforcement. */
function extractAskFirstEnforcement(fs: ReadonlyFS, agent: AgentProfile, askFirstPaths: string[]): AgentFacts['askFirstEnforcement'] {
  if (!agent.hooksDir || askFirstPaths.length === 0) return { hasPathHook: false };
  /** All shell scripts in the hooks directory */
  const hookFiles = fs.listDir(agent.hooksDir).filter(f => f.endsWith('.sh'));
  for (const hookFile of hookFiles) {
    /** Raw content of this hook script */
    const content = fs.readFile(`${agent.hooksDir}/${hookFile}`);
    if (!content) continue;
    // Check if the hook references at least one Ask First boundary path
    const refsAnyPath = askFirstPaths.some(p => content.includes(p));
    if (refsAnyPath && /exit\s+2/.test(content)) return { hasPathHook: true };
  }
  return { hasPathHook: false };
}

// ─── Composer ────────────────────────────────────────────────────────

/** Extract all facts about a single agent from the filesystem. */
export function extractAgentFacts(fs: ReadonlyFS, agent: AgentProfile): AgentFacts {
  const instruction = extractInstructionFacts(fs, agent);
  const settings = extractSettingsFacts(fs, agent);
  const skills = extractSkillFacts(fs, agent);
  const hookFacts = extractHookFacts(fs, agent, settings.parsed, settings.hasDenyPatterns, settings.valid);
  const deny = checkDenyPatterns(fs, agent);
  const router = extractRouterFacts(fs, instruction.content);
  const askFirst = extractAskFirstFacts(fs, instruction.content);

  /** All files matching the agent's local instruction pattern */
  const localFiles = agent.localPattern.includes('*')
    ? fs.glob(agent.localPattern)
    : [];
  /** Local context files excluding the root instruction file */
  const filteredLocal = localFiles.filter(f => f !== agent.instructionFile);

  // Determine warranted local files (dirs with 2+ footgun mentions)
  /** Directories warranting local context files based on footgun mentions */
  const warranted: string[] = [];
  /** Warranted directories that lack a local context file */
  const missing: string[] = [];
  // This will be populated from shared facts in the extract orchestrator

  const settingsLocal = extractSettingsLocalFacts(fs, agent);
  const askFirstEnforcement = extractAskFirstEnforcement(fs, agent, askFirst.paths);

  return {
    agent,
    instruction,
    settings: { exists: settings.exists, valid: settings.valid, parsed: settings.parsed, hasDenyPatterns: settings.hasDenyPatterns },
    settingsLocal,
    askFirstEnforcement,
    skills,
    hooks: { ...hookFacts, readDenyCoversSecrets: settings.readDenyCoversSecrets },
    deny,
    router,
    askFirst,
    localContext: { files: filteredLocal, warranted, missing },
  };
}
