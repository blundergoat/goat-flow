import type { AgentProfile, AgentFacts, ReadonlyFS } from '../types.js';

const EXPECTED_SKILLS = [
  'goat-security', 'goat-debug', 'goat-audit', 'goat-investigate',
  'goat-review', 'goat-plan', 'goat-test', 'goat-reflect',
  'goat-onboard', 'goat-resume',
];

/**
 * Parse markdown into sections: heading -> content
 */
function parseSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split('\n');
  let currentHeading = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentHeading) {
        sections.set(currentHeading.toLowerCase(), currentContent.join('\n'));
      }
      currentHeading = headingMatch[1];
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

function checkDenyPatterns(fs: ReadonlyFS, agent: AgentProfile): { gitCommitBlocked: boolean; gitPushBlocked: boolean } {
  const deny = agent.denyMechanism;

  if (deny.type === 'settings-deny') {
    const parsed = fs.readJson(deny.path) as Record<string, unknown> | null;
    if (!parsed) return { gitCommitBlocked: false, gitPushBlocked: false };
    const permissions = parsed.permissions as Record<string, unknown> | undefined;
    const rawDeny = permissions?.deny;
    const denyList = Array.isArray(rawDeny) ? (rawDeny as string[]) : [];
    return {
      gitCommitBlocked: denyList.some(p => p.includes('git commit')),
      gitPushBlocked: denyList.some(p => p.includes('git push')),
    };
  }

  if (deny.type === 'deny-script') {
    const content = fs.readFile(deny.path);
    if (!content) return { gitCommitBlocked: false, gitPushBlocked: false };
    return {
      gitCommitBlocked: /git\s+commit/i.test(content),
      gitPushBlocked: /git\s+push/i.test(content),
    };
  }

  // type: 'both'
  const settings = checkDenyPatterns(fs, { ...agent, denyMechanism: { type: 'settings-deny', path: deny.settingsPath } });
  const script = checkDenyPatterns(fs, { ...agent, denyMechanism: { type: 'deny-script', path: deny.scriptPath } });
  return {
    gitCommitBlocked: settings.gitCommitBlocked || script.gitCommitBlocked,
    gitPushBlocked: settings.gitPushBlocked || script.gitPushBlocked,
  };
}

function extractRouterPaths(content: string): string[] {
  const paths: string[] = [];
  const routerSection = extractSection(content, 'router');
  if (!routerSection) return paths;

  // Match backtick-wrapped paths: `docs/footguns.md`
  const backtickMatches = routerSection.matchAll(/`([^`]+)`/g);
  for (const match of backtickMatches) {
    const path = match[1];
    if (path.includes('*') || path.includes('{')) continue;
    if (!path.includes('/') && !path.includes('.')) continue;
    paths.push(path);
  }

  // Match markdown link paths: [text](path)
  const linkMatches = routerSection.matchAll(/\]\(([^)]+)\)/g);
  for (const match of linkMatches) {
    const path = match[1];
    if (path.includes('*') || path.includes('{')) continue;
    if (path.startsWith('http')) continue;
    if (!path.includes('/') && !path.includes('.')) continue;
    // Avoid duplicates from paths already captured via backticks
    if (!paths.includes(path)) paths.push(path);
  }

  return paths;
}

function extractAskFirstPaths(content: string): string[] {
  const paths: string[] = [];

  // Find the Ask First section — either as a heading or bold text
  let section: string | null = null;
  const headingMatch = content.match(/##\s+ask\s+first[\s\S]*?(?=\n##\s|$)/i);
  if (headingMatch) {
    section = headingMatch[0];
  } else {
    const boldMatch = content.match(/\*\*Ask First\*\*[\s\S]*?(?=\n\*\*Never\*\*|\n##\s|$)/i);
    if (boldMatch) section = boldMatch[0];
  }

  if (!section) return paths;

  // Extract backtick-wrapped paths from the Ask First section
  const backtickMatches = section.matchAll(/`([^`]+)`/g);
  for (const match of backtickMatches) {
    const path = match[1];
    if (path.includes('*') || path.includes('{')) continue;
    if (path.startsWith('http')) continue;
    // Must look like a file/directory path
    if (!path.includes('/') && !path.includes('.')) continue;
    // Skip things that are clearly not paths (commands, patterns)
    if (path.includes('|') || path.startsWith('-') || path.startsWith('$')) continue;
    if (!paths.includes(path)) paths.push(path);
  }

  return paths;
}

function extractSection(content: string, sectionName: string): string | null {
  const lines = content.split('\n');
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      if (inSection) break;
      if (heading[1].toLowerCase().includes(sectionName.toLowerCase())) {
        inSection = true;
      }
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.length > 0 ? sectionLines.join('\n') : null;
}

export function extractAgentFacts(fs: ReadonlyFS, agent: AgentProfile): AgentFacts {
  // Instruction file
  const content = fs.readFile(agent.instructionFile);
  const exists = content !== null;
  const lineCount = exists
    ? content!.split('\n').length - (content!.endsWith('\n') ? 1 : 0)
    : 0;
  const sections = exists ? parseSections(content!) : new Map<string, string>();

  // Settings
  const settingsExists = agent.settingsFile ? fs.exists(agent.settingsFile) : false;
  let settingsValid = false;
  let settingsParsed: unknown | null = null;
  let hasDenyPatterns = false;
  if (agent.settingsFile) {
    if (agent.settingsFile.endsWith('.toml')) {
      // TOML (Codex config.toml) — read as text, not JSON
      const tomlContent = fs.readFile(agent.settingsFile);
      settingsValid = tomlContent !== null && tomlContent.length > 0;
      // settingsParsed stays null — TOML is inspected via text regex, not parsed object
    } else {
      settingsParsed = fs.readJson(agent.settingsFile);
      settingsValid = settingsParsed !== null;
    }
    if (settingsValid && settingsParsed) {
      const perms = (settingsParsed as Record<string, unknown>)?.permissions as Record<string, unknown> | undefined;
      const denyArr = perms?.deny;
      hasDenyPatterns = Array.isArray(denyArr) && (denyArr as string[]).length > 0;
    }
  }

  // Check read-deny covers common sensitive paths
  let readDenyCoversSecrets = false;
  if (hasDenyPatterns && settingsParsed) {
    const perms = (settingsParsed as Record<string, unknown>)?.permissions as Record<string, unknown> | undefined;
    const denyArr = perms?.deny;
    if (Array.isArray(denyArr)) {
      const denyStr = (denyArr as string[]).join(' ');
      // Must cover at least: .env, .ssh, .aws, and one of .key/.pem/credentials
      const hasEnv = /Read\(.*\.env/.test(denyStr);
      const hasSsh = /Read\(.*\.ssh/.test(denyStr);
      const hasAws = /Read\(.*\.aws/.test(denyStr);
      const hasKeys = /Read\(.*\.(pem|key|pfx)\b/.test(denyStr) || /Read\(.*credentials/.test(denyStr);
      readDenyCoversSecrets = hasEnv && hasSsh && hasAws && hasKeys;
    }
  }

  // Check for compaction notification hook in settings
  // Claude Code format: hooks.Notification[].matcher = "compact"
  // Gemini format: hooks.Notification[].matcher = "compact"
  let compactionHookExists = false;
  if (settingsParsed && settingsValid) {
    const settings = settingsParsed as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown> | undefined;
    if (hooks && typeof hooks === 'object') {
      if (Array.isArray(hooks)) {
        // Array format: hooks: [{type: "Notification", matcher: "compact"}]
        compactionHookExists = (hooks as Array<Record<string, unknown>>).some(h =>
          h.type === 'Notification' && String(h.matcher ?? '').includes('compact')
        );
      } else {
        // Nested format: hooks.Notification[{matcher: "compact"}]
        const notifHooks = (hooks as Record<string, unknown>).Notification as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(notifHooks)) {
          compactionHookExists = notifHooks.some(h =>
            String(h.matcher ?? '').includes('compact')
          );
        }
      }
    }
  }

  // For Codex: session_start hook serves similar purpose to compaction
  if (agent.id === 'codex' && !compactionHookExists) {
    const configContent = fs.readFile('.codex/config.toml');
    if (configContent && /\[hooks\.session_start\]/.test(configContent)) {
      compactionHookExists = true; // SessionStart injects context like compaction hook
    }
  }

  // Skills — existence + content quality
  const skillsFound: string[] = [];
  const skillsMissing: string[] = [];
  let withStep0 = 0;
  let withHumanGate = 0;
  let withConstraints = 0;
  let withPhases = 0;
  let withConversational = 0;
  let withChaining = 0;
  let withChoices = 0;
  let withOutputFormat = 0;
  for (const skill of EXPECTED_SKILLS) {
    const skillPath = `${agent.skillsDir}/${skill}/SKILL.md`;
    if (fs.exists(skillPath)) {
      skillsFound.push(skill);
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

  // Hooks — existence + content quality
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
    const perms = (settingsParsed as Record<string, unknown>)?.permissions as Record<string, unknown> | undefined;
    const rawDeny = perms?.deny;
    if (Array.isArray(rawDeny)) {
      const denyStr = (rawDeny as string[]).join(' ');
      // Settings deny counts as a deny mechanism existing
      if (!denyExists && denyStr.includes('Bash(')) {
        denyExists = true;
        denyHasBlocks = true; // settings.json deny is mechanical blocking
        denyUsesJq = true; // no JSON parsing needed — it's config, not a script
        denyHandlesChaining = true; // settings.json matches substrings, handles chaining implicitly
      }
      // Check for specific dangerous patterns in Bash deny rules
      if (/Bash\(.*rm -rf|Bash\(.*rm -fr/i.test(denyStr)) denyBlocksRmRf = true;
      if (/Bash\(.*--force|Bash\(.*force.*push/i.test(denyStr)) denyBlocksForcePush = true;
      if (/Bash\(.*chmod 777/i.test(denyStr)) denyBlocksChmod = true;
    }
  }

  // For Codex: also check execpolicy rules
  if (agent.id === 'codex') {
    const execpolicyPath = '.codex/rules/deny-dangerous.star';
    if (fs.exists(execpolicyPath)) {
      const ruleContent = fs.readFile(execpolicyPath);
      if (ruleContent) {
        denyExists = true;
        denyHasBlocks = /forbidden|prompt/i.test(ruleContent) && ruleContent.split('\n').length > 5;
        denyBlocksRmRf = /rm.*-.*rf|rm.*-.*fr/i.test(ruleContent);
        denyBlocksForcePush = /force.*push|--force/i.test(ruleContent);
        denyBlocksChmod = /chmod.*777/.test(ruleContent);
        // Execpolicy uses Starlark, not jq — mark as safe parsing
        denyUsesJq = true; // Starlark is a proper parser, not regex
        // Check if it handles chaining (Starlark processes the full command string)
        denyHandlesChaining = true; // Starlark's string ops handle the full command
      }
    }
  }

  let postTurnExists = false;
  let postTurnExitsZero = false;
  let postTurnHasValidation = false;
  let postToolExists = false;

  // For Codex: detect config.toml and registered hooks
  if (agent.id === 'codex') {
    const configPath = '.codex/config.toml';
    const configContent = fs.readFile(configPath);
    if (configContent) {
      // Check for Stop hook registration
      if (/\[hooks\.stop\]/.test(configContent)) {
        postTurnExists = true;
        // Check what script it runs
        const stopScript = configContent.match(/\[hooks\.stop\]\s*\n\s*command\s*=\s*\[.*?"([^"]+\.sh)"/);
        if (stopScript) {
          const hookContent = fs.readFile(stopScript[1]);
          if (hookContent) {
            const lines = hookContent.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
            postTurnExitsZero = lines.length > 0 && lines[lines.length - 1].trim() === 'exit 0';
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
    const stopLintPath = `${agent.hooksDir}/stop-lint.sh`;
    postTurnExists = fs.exists(stopLintPath);
    if (postTurnExists) {
      const hookContent = fs.readFile(stopLintPath);
      if (hookContent) {
        const lines = hookContent.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        postTurnExitsZero = lines.length > 0 && lines[lines.length - 1].trim() === 'exit 0';
        // Check for actual validation logic (not just exit 0)
        postTurnHasValidation = /shellcheck|tsc|lint|fmt|check|test|wc -l/i.test(hookContent) && hookContent.split('\n').length > 10;
      }
    }
    postToolExists = fs.exists(`${agent.hooksDir}/format-file.sh`);
  }

  // Deny patterns
  const denyResults = checkDenyPatterns(fs, agent);

  // Router
  const routerPaths = exists ? extractRouterPaths(content!) : [];
  let resolved = 0;
  const unresolved: string[] = [];
  for (const p of routerPaths) {
    if (fs.exists(p)) {
      resolved++;
    } else {
      unresolved.push(p);
    }
  }

  // Ask First path verification
  const askFirstPaths = exists ? extractAskFirstPaths(content!) : [];
  let askFirstResolved = 0;
  const askFirstUnresolved: string[] = [];
  for (const p of askFirstPaths) {
    if (fs.exists(p)) {
      askFirstResolved++;
    } else {
      askFirstUnresolved.push(p);
    }
  }

  // Local context
  const localFiles = agent.localPattern.includes('*')
    ? fs.glob(agent.localPattern)
    : [];
  // Filter out root instruction file
  const filteredLocal = localFiles.filter(f => f !== agent.instructionFile);

  // Determine warranted local files (dirs with 2+ footgun mentions)
  const warranted: string[] = [];
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
