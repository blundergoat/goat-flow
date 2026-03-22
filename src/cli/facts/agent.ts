import type { AgentProfile, AgentFacts, ReadonlyFS } from '../types.js';

const EXPECTED_SKILLS = [
  'goat-preflight', 'goat-debug', 'goat-audit', 'goat-investigate',
  'goat-review', 'goat-plan', 'goat-test',
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
    const denyList = (permissions?.deny as string[]) ?? [];
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
    settingsParsed = fs.readJson(agent.settingsFile);
    settingsValid = settingsParsed !== null;
    if (settingsValid) {
      const perms = (settingsParsed as Record<string, unknown>)?.permissions as Record<string, unknown> | undefined;
      hasDenyPatterns = Array.isArray(perms?.deny) && (perms!.deny as string[]).length > 0;
    }
  }

  // Check for compaction notification hook in settings
  let compactionHookExists = false;
  if (settingsParsed && settingsValid) {
    const settings = settingsParsed as Record<string, unknown>;
    const hooks = settings.hooks as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(hooks)) {
      compactionHookExists = hooks.some(h =>
        (h.type === 'Notification' || h.event === 'Notification') &&
        (String(h.matcher ?? '').includes('compact') || String(h.command ?? '').includes('compact'))
      );
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
        if (/conversational|drill.*in|dig deeper|walk.*through|present.*findings.*then|let.*human.*drill|iterate|follow.up question/i.test(skillContent)) withConversational++;
      }
    } else {
      skillsMissing.push(skill);
    }
  }

  // Hooks — existence + content quality
  const denyHookPath = agent.hooksDir
    ? `${agent.hooksDir}/deny-dangerous.sh`
    : (agent.denyMechanism.type === 'deny-script' ? agent.denyMechanism.path : null);
  const denyExists = denyHookPath ? fs.exists(denyHookPath) : false;

  // Check deny hook has actual blocking logic (not just exit 0)
  let denyHasBlocks = false;
  if (denyExists && denyHookPath) {
    const denyContent = fs.readFile(denyHookPath);
    if (denyContent) {
      // Should have block/exit 2 patterns or case statements
      denyHasBlocks = /exit\s+2|block|BLOCK/i.test(denyContent) && denyContent.split('\n').length > 5;
    }
  }

  let postTurnExists = false;
  let postTurnExitsZero = false;
  let postTurnHasValidation = false;
  let postToolExists = false;

  if (agent.hooksDir) {
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
  } else if (agent.id === 'codex') {
    // Codex uses scripts/ instead of hooks
    postTurnExists = fs.exists('scripts/stop-lint.sh');
    if (postTurnExists) {
      const hookContent = fs.readFile('scripts/stop-lint.sh');
      if (hookContent) {
        const lines = hookContent.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        postTurnExitsZero = lines.length > 0 && lines[lines.length - 1].trim() === 'exit 0';
        postTurnHasValidation = /shellcheck|tsc|lint|fmt|check|test|wc -l/i.test(hookContent) && hookContent.split('\n').length > 10;
      }
    }
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
      quality: { withStep0, withHumanGate, withConstraints, withPhases, withConversational, total: skillsFound.length },
    },
    hooks: { denyExists, denyHasBlocks, postTurnExists, postTurnExitsZero, postTurnHasValidation, postToolExists, compactionHookExists },
    deny: denyResults,
    router: { exists: routerPaths.length > 0, paths: routerPaths, resolved, unresolved },
    askFirst: { exists: askFirstPaths.length > 0, paths: askFirstPaths, resolved: askFirstResolved, unresolved: askFirstUnresolved },
    localContext: { files: filteredLocal, warranted, missing },
  };
}
