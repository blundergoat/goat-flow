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

  const matches = routerSection.matchAll(/`([^`]+)`/g);
  for (const match of matches) {
    const path = match[1];
    // Skip patterns with wildcards or braces
    if (path.includes('*') || path.includes('{')) continue;
    // Skip inline code that isn't a path
    if (!path.includes('/') && !path.includes('.')) continue;
    paths.push(path);
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

  // Skills
  const skillsFound: string[] = [];
  const skillsMissing: string[] = [];
  for (const skill of EXPECTED_SKILLS) {
    if (fs.exists(`${agent.skillsDir}/${skill}/SKILL.md`)) {
      skillsFound.push(skill);
    } else {
      skillsMissing.push(skill);
    }
  }

  // Hooks
  const denyHookPath = agent.hooksDir
    ? `${agent.hooksDir}/deny-dangerous.sh`
    : (agent.denyMechanism.type === 'deny-script' ? agent.denyMechanism.path : null);
  const denyExists = denyHookPath ? fs.exists(denyHookPath) : false;

  let postTurnExists = false;
  let postTurnExitsZero = false;
  let postToolExists = false;

  if (agent.hooksDir) {
    const stopLintPath = `${agent.hooksDir}/stop-lint.sh`;
    postTurnExists = fs.exists(stopLintPath);
    if (postTurnExists) {
      const hookContent = fs.readFile(stopLintPath);
      if (hookContent) {
        const lines = hookContent.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        postTurnExitsZero = lines.length > 0 && lines[lines.length - 1].trim() === 'exit 0';
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
    skills: { found: skillsFound, missing: skillsMissing, allPresent: skillsMissing.length === 0 },
    hooks: { denyExists, postTurnExists, postTurnExitsZero, postToolExists },
    deny: denyResults,
    router: { exists: routerPaths.length > 0, paths: routerPaths, resolved, unresolved },
    localContext: { files: filteredLocal, warranted, missing },
  };
}
