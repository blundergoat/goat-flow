import type { AgentProfile, AgentFacts, ReadonlyFS } from '../types.js';

/** Skill names that a fully configured GOAT Flow agent should have */
const EXPECTED_SKILLS = [
  'goat-security', 'goat-debug', 'goat-audit', 'goat-investigate',
  'goat-review', 'goat-plan', 'goat-test', 'goat-reflect',
  'goat-onboard', 'goat-resume',
];

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
      currentHeading = headingMatch[1]!;
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
    const path = match[1]!;
    if (path.includes('*') || path.includes('{')) continue;
    if (path.includes('/') === false && path.includes('.') === false) continue;
    paths.push(path);
  }

  /** Markdown link path matches (e.g. [text](path)) */
  const linkMatches = routerSection.matchAll(/\]\(([^)]+)\)/g);
  // Iterate over markdown link matches to collect additional file paths
  for (const match of linkMatches) {
    /** Extracted path string from inside the link parentheses */
    const path = match[1]!;
    if (path.includes('*') || path.includes('{')) continue;
    if (path.startsWith('http')) continue;
    if (path.includes('/') === false && path.includes('.') === false) continue;
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
    const path = match[1]!;
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
      if (heading[1]!.toLowerCase().includes(sectionName.toLowerCase())) {
        inSection = true;
      }
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.length > 0 ? sectionLines.join('\n') : null;
}

/** Extract all facts about a single agent from the filesystem. */
export function extractAgentFacts(fs: ReadonlyFS, agent: AgentProfile): AgentFacts {
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

  /** Whether the agent's settings file exists on disk */
  const settingsExists = agent.settingsFile ? fs.exists(agent.settingsFile) : false;
  let settingsValid = false;
  let settingsParsed: unknown = null;
  let hasDenyPatterns = false;
  if (agent.settingsFile) {
    if (agent.settingsFile.endsWith('.toml')) {
      // TOML (Codex config.toml) -- read as text, not JSON
      /** Raw TOML content read as plain text */
      const tomlContent = fs.readFile(agent.settingsFile);
      settingsValid = tomlContent !== null && tomlContent.length > 0;
      // settingsParsed stays null — TOML is inspected via text regex, not parsed object
    } else {
      settingsParsed = fs.readJson(agent.settingsFile);
      settingsValid = settingsParsed !== null;
    }
    if (settingsValid && settingsParsed) {
      /** Permissions object from the parsed settings */
      const perms = (settingsParsed as Record<string, unknown>)?.permissions as Record<string, unknown> | undefined;
      /** Raw deny array from permissions */
      const denyArr = perms?.deny;
      hasDenyPatterns = Array.isArray(denyArr) && (denyArr as string[]).length > 0;
    }
  }

  // Check read-deny covers common sensitive paths
  let readDenyCoversSecrets = false;
  if (hasDenyPatterns && settingsParsed) {
    /** Permissions object from the parsed settings */
    const perms = (settingsParsed as Record<string, unknown>)?.permissions as Record<string, unknown> | undefined;
    /** Raw deny array from permissions */
    const denyArr = perms?.deny;
    if (Array.isArray(denyArr)) {
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
      readDenyCoversSecrets = hasEnv && hasSsh && hasAws && hasKeys;
    }
  }

  // Check for compaction notification hook in settings
  // Claude Code format: hooks.Notification[].matcher = "compact"
  // Gemini format: hooks.Notification[].matcher = "compact"
  let compactionHookExists = false;
  if (settingsParsed && settingsValid) {
    /** Top-level settings object cast for property access */
    const settings = settingsParsed as Record<string, unknown>;
    /** Hooks configuration from settings */
    const hooks = settings.hooks as Record<string, unknown> | undefined;
    if (hooks && typeof hooks === 'object') {
      if (Array.isArray(hooks)) {
        // Array format: hooks: [{type: "Notification", matcher: "compact"}]
        compactionHookExists = (hooks as Array<Record<string, unknown>>).some(h =>
          h.type === 'Notification' && (typeof h.matcher === 'string' ? h.matcher : '').includes('compact')
        );
      } else {
        // Nested format: hooks.Notification[{matcher: "compact"}]
        /** Notification hooks array from the nested hooks object */
        const notifHooks = (hooks).Notification as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(notifHooks)) {
          compactionHookExists = notifHooks.some(h =>
            (typeof h.matcher === 'string' ? h.matcher : '').includes('compact')
          );
        }
      }
    }
  }

  // For Codex: session_start hook serves similar purpose to compaction
  if (agent.id === 'codex' && compactionHookExists === false) {
    /** Raw content of the Codex config.toml file */
    const configContent = fs.readFile('.codex/config.toml');
    if (configContent && /\[hooks\.session_start\]/.test(configContent)) {
      // SessionStart injects context like compaction hook
      compactionHookExists = true;
    }
  }

  /** Names of skills that were found on disk */
  const skillsFound: string[] = [];
  /** Names of expected skills that are missing */
  const skillsMissing: string[] = [];
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
      skillsFound.push(skill);
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
      skillsMissing.push(skill);
    }
  }

  /** Filesystem path to the deny hook script, if any */
  const denyHookPath = agent.hooksDir
    ? `${agent.hooksDir}/deny-dangerous.sh`
    : (agent.denyMechanism.type === 'deny-script' ? agent.denyMechanism.path : null);
  let denyExists = denyHookPath ? fs.exists(denyHookPath) : false;

  // Check deny hook content quality
  let denyHasBlocks = false;
  let denyUsesJq = false;
  let denyHandlesChaining = false;
  let denyBlocksRmRf = false;
  let denyBlocksForcePush = false;
  let denyBlocksChmod = false;

  // First: check hook script content (if exists)
  if (denyExists && denyHookPath) {
    /** Raw content of the deny hook script */
    const denyContent = fs.readFile(denyHookPath);
    if (denyContent) {
      denyHasBlocks = /exit\s+2|block|BLOCK/i.test(denyContent) && denyContent.split('\n').length > 5;
      denyUsesJq = /\bjq\b/.test(denyContent) && !/grep\s+-[a-zA-Z]*P/.test(denyContent);
      denyHandlesChaining = /&&|\|\||;/.test(denyContent) && /split|segment|chain/i.test(denyContent);
      denyBlocksRmRf = /rm\s*.*-.*r.*f|rm\s*-rf/i.test(denyContent);
      denyBlocksForcePush = /force.*push|--force/i.test(denyContent);
      denyBlocksChmod = /chmod.*777/.test(denyContent);
    }
  }

  // Second: also check settings.json Bash deny patterns (prevents N/A cascade
  // for projects that use settings-based deny instead of a hook script)
  if (hasDenyPatterns && settingsParsed) {
    /** Permissions object from the parsed settings */
    const perms = (settingsParsed as Record<string, unknown>)?.permissions as Record<string, unknown> | undefined;
    /** Raw deny array from permissions */
    const rawDeny = perms?.deny;
    if (Array.isArray(rawDeny)) {
      /** All deny patterns concatenated for pattern matching */
      const denyStr = (rawDeny as string[]).join(' ');
      // Settings deny counts as a deny mechanism existing
      if (denyExists === false && denyStr.includes('Bash(')) {
        denyExists = true;
        // settings.json deny is mechanical blocking
        denyHasBlocks = true;
        // no JSON parsing needed -- it's config, not a script
        denyUsesJq = true;
        // settings.json matches substrings, handles chaining implicitly
        denyHandlesChaining = true;
      }
      // Check for specific dangerous patterns in Bash deny rules
      if (/Bash\(.*rm -rf|Bash\(.*rm -fr/i.test(denyStr)) denyBlocksRmRf = true;
      if (/Bash\(.*--force|Bash\(.*force.*push/i.test(denyStr)) denyBlocksForcePush = true;
      if (/Bash\(.*chmod 777/i.test(denyStr)) denyBlocksChmod = true;
    }
  }

  // For Codex: also check execpolicy rules
  if (agent.id === 'codex') {
    /** Path to the Codex execpolicy Starlark rule file */
    const execpolicyPath = '.codex/rules/deny-dangerous.star';
    if (fs.exists(execpolicyPath)) {
      /** Raw content of the Starlark rule file */
      const ruleContent = fs.readFile(execpolicyPath);
      if (ruleContent) {
        denyExists = true;
        denyHasBlocks = /forbidden|prompt/i.test(ruleContent) && ruleContent.split('\n').length > 5;
        denyBlocksRmRf = /rm.*-.*rf|rm.*-.*fr/i.test(ruleContent);
        denyBlocksForcePush = /force.*push|--force/i.test(ruleContent);
        denyBlocksChmod = /chmod.*777/.test(ruleContent);
        // Execpolicy uses Starlark, not jq -- mark as safe parsing (Starlark is a proper parser)
        denyUsesJq = true;
        // Starlark processes the full command string, handling chaining implicitly
        denyHandlesChaining = true;
      }
    }
  }

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
        // Check what script it runs
        /** Regex match extracting the script path from the stop hook configuration */
        const stopScript = configContent.match(/\[hooks\.stop\]\s*\n\s*command\s*=\s*\[.*?"([^"]+\.sh)"/);
        if (stopScript) {
          /** Raw content of the stop hook script */
          const hookContent = fs.readFile(stopScript[1]!);
          if (hookContent) {
            /** Non-empty, non-comment lines from the hook script */
            const lines = hookContent.trim().split('\n').filter(l => l.trim() && l.trim().startsWith('#') === false);
            /** Last meaningful line of the hook script */
            const lastLine = lines[lines.length - 1];
            postTurnExitsZero = lastLine !== undefined && lastLine.trim() === 'exit 0';
            postTurnHasValidation = /shellcheck|tsc|lint|fmt|check|test|wc -l/i.test(hookContent) && hookContent.split('\n').length > 10;
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
        /** Non-empty, non-comment lines from the hook script */
        const lines = hookContent.trim().split('\n').filter(l => l.trim() && l.trim().startsWith('#') === false);
        /** Last meaningful line of the hook script */
        const lastLine = lines[lines.length - 1];
        postTurnExitsZero = lastLine !== undefined && lastLine.trim() === 'exit 0';
        // Check for actual validation logic (not just exit 0)
        postTurnHasValidation = /shellcheck|tsc|lint|fmt|check|test|wc -l/i.test(hookContent) && hookContent.split('\n').length > 10;
      }
    }
    postToolExists = fs.exists(`${agent.hooksDir}/format-file.sh`);
  }

  /** Results from checking deny patterns for git commit and push blocking */
  const denyResults = checkDenyPatterns(fs, agent);

  /** File paths referenced in the router table */
  const routerPaths = exists ? extractRouterPaths(content) : [];
  let resolved = 0;
  /** Router paths that do not exist on disk */
  const unresolved: string[] = [];
  // Iterate over router paths to verify each one exists on disk
  for (const p of routerPaths) {
    if (fs.exists(p)) {
      resolved++;
    } else {
      unresolved.push(p);
    }
  }

  /** File paths listed in the Ask First boundaries section */
  const askFirstPaths = exists ? extractAskFirstPaths(content) : [];
  let askFirstResolved = 0;
  /** Ask-first paths that do not exist on disk */
  const askFirstUnresolved: string[] = [];
  // Iterate over ask-first paths to verify each one exists on disk
  for (const p of askFirstPaths) {
    if (fs.exists(p)) {
      askFirstResolved++;
    } else {
      askFirstUnresolved.push(p);
    }
  }

  /** All files matching the agent's local instruction pattern */
  const localFiles = agent.localPattern.includes('*')
    ? fs.glob(agent.localPattern)
    : [];
  // Filter out root instruction file
  /** Local context files excluding the root instruction file */
  const filteredLocal = localFiles.filter(f => f !== agent.instructionFile);

  // Determine warranted local files (dirs with 2+ footgun mentions)
  /** Directories warranting local context files based on footgun mentions */
  const warranted: string[] = [];
  /** Warranted directories that lack a local context file */
  const missing: string[] = [];
  // This will be populated from shared facts in the extract orchestrator

  return {
    agent,
    instruction: { exists, content, lineCount, sections },
    settings: { exists: settingsExists, valid: settingsValid, parsed: settingsParsed, hasDenyPatterns },
    skills: {
      found: skillsFound, missing: skillsMissing, allPresent: skillsMissing.length === 0,
      quality: { withStep0, withHumanGate, withConstraints, withPhases, withConversational, withChaining, withChoices, withOutputFormat, total: skillsFound.length },
    },
    hooks: { denyExists, denyHasBlocks, denyUsesJq, denyHandlesChaining, denyBlocksRmRf, denyBlocksForcePush, denyBlocksChmod, postTurnExists, postTurnExitsZero, postTurnHasValidation, postToolExists, compactionHookExists, readDenyCoversSecrets },
    deny: denyResults,
    router: { exists: routerPaths.length > 0, paths: routerPaths, resolved, unresolved },
    askFirst: { exists: askFirstPaths.length > 0, paths: askFirstPaths, resolved: askFirstResolved, unresolved: askFirstUnresolved },
    localContext: { files: filteredLocal, warranted, missing },
  };
}
