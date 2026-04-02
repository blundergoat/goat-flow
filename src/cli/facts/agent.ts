import type { AgentProfile, AgentFacts, ReadonlyFS } from '../types.js';
import { SKILL_NAMES, SKILL_VERSION } from '../constants.js';

/** Skill names that a fully configured GOAT Flow agent should have */
const EXPECTED_SKILLS = SKILL_NAMES;

/** Jaccard word-set similarity between two text blocks (0-1) */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  let intersection = 0;
  for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 1 : intersection / union;
}

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

function pushUniquePath(paths: string[], path: string): void {
  if (paths.includes(path) === false) {
    paths.push(path);
  }
}

function collectMatchedPaths(
  content: string,
  pattern: RegExp,
  isValid: (path: string) => boolean,
  paths: string[],
): void {
  for (const match of content.matchAll(pattern)) {
    const path = match[1];
    if (path === undefined) continue;
    if (!isValid(path)) continue;
    pushUniquePath(paths, path);
  }
}

function isRouterBacktickPath(path: string): boolean {
  return !hasGlobChars(path) && looksLikePath(path);
}

function isRouterLinkPath(path: string): boolean {
  return !hasGlobChars(path) && !path.startsWith('http') && looksLikePath(path);
}

function isAskFirstPath(path: string): boolean {
  if (hasGlobChars(path)) return false;
  if (path.startsWith('http')) return false;
  if (!looksLikePath(path)) return false;
  if (path.includes('|') || path.startsWith('-') || path.startsWith('$')) return false;
  return true;
}

/** Extract all file/directory paths referenced in the Router Table section. */
function extractRouterPaths(content: string): string[] {
  /** Accumulated list of discovered router paths */
  const paths: string[] = [];
  /** Content of the router section extracted from the instruction file */
  const routerSection = extractSection(content, 'router');
  if (routerSection == null) return paths;

  collectMatchedPaths(routerSection, /`([^`]+)`/g, isRouterBacktickPath, paths);
  collectMatchedPaths(routerSection, /\]\(([^)]+)\)/g, isRouterLinkPath, paths);

  return paths;
}

function extractAskFirstSection(content: string): string | null {
  const headingMatch = content.match(/##\s+ask\s+first[\s\S]*?(?=\n##\s|$)/i);
  if (headingMatch) {
    return headingMatch[0];
  }

  const boldMatch = content.match(/\*\*Ask First\*\*[\s\S]*?(?=\n\*\*Never\*\*|\n##\s|$)/i);
  return boldMatch?.[0] ?? null;
}

/** Extract file paths listed in the Ask First boundaries section. */
function extractAskFirstPaths(content: string): string[] {
  /** Accumulated list of discovered ask-first boundary paths */
  const paths: string[] = [];

  const section = extractAskFirstSection(content);
  if (section == null) return paths;

  collectMatchedPaths(section, /`([^`]+)`/g, isAskFirstPath, paths);

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

/** Extract the goat-flow-skill-version from YAML frontmatter in a skill file */
function extractSkillVersion(content: string): string | null {
  // Match YAML frontmatter between --- delimiters
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter?.[1]) return null;
  const versionMatch = frontmatter[1].match(/goat-flow-skill-version:\s*["']?([^"'\n]+)/);
  return versionMatch?.[1]?.trim() ?? null;
}

interface SkillQualityCounts {
  withStep0: number;
  withHumanGate: number;
  withConstraints: number;
  withPhases: number;
  withConversational: number;
  withChaining: number;
  withChoices: number;
  withOutputFormat: number;
  withSharedConventions: number;
}

interface SkillInventory {
  found: string[];
  missing: string[];
  versions: Record<string, string | null>;
  outdatedCount: number;
  quality: SkillQualityCounts;
  adaptCommentCount: number;
}

const SKILL_QUALITY_PATTERNS: Array<{ key: keyof SkillQualityCounts; pattern: RegExp }> = [
  { key: 'withStep0', pattern: /step\s*0|gather\s*context|ask.*before|ask\s+the\s+user/i },
  { key: 'withHumanGate', pattern: /human\s*gate|blocking\s*gate|wait.*approv|wait.*confirm|do\s+not\s+proceed|does this.*look right|does this.*match/i },
  { key: 'withConstraints', pattern: /MUST\s+NOT|MUST\s+/m },
  { key: 'withPhases', pattern: /##\s*(Phase|Step)\s+[0-9]/i },
  { key: 'withConversational', pattern: /blocking\s*gate|human\s*gate/i },
  { key: 'withChaining', pattern: /chains?\s*with|related\s*skills?|next.*skill|→.*goat-/i },
  { key: 'withChoices', pattern: /\(a\)|\(b\)|\(c\)|want me to.*\n.*\n/i },
  { key: 'withOutputFormat', pattern: /##\s*(Output|Output Format)/i },
  { key: 'withSharedConventions', pattern: /^##\s+shared conventions/im },
] as const;

function createSkillQualityCounts(): SkillQualityCounts {
  return {
    withStep0: 0,
    withHumanGate: 0,
    withConstraints: 0,
    withPhases: 0,
    withConversational: 0,
    withChaining: 0,
    withChoices: 0,
    withOutputFormat: 0,
    withSharedConventions: 0,
  };
}

function updateSkillQualityCounts(content: string, quality: SkillQualityCounts): void {
  for (const check of SKILL_QUALITY_PATTERNS) {
    if (check.key === 'withConversational') {
      if (
        /blocking\s*gate|human\s*gate/i.test(content)
        && /\(a\)|want me to|offer:|proceed\?/i.test(content)
      ) {
        quality[check.key]++;
      }
      continue;
    }
    if (check.pattern.test(content)) {
      quality[check.key]++;
    }
  }
}

function countAdaptComments(content: string): number {
  return content.match(/<!--\s*ADAPT:/g)?.length ?? 0;
}

function collectInstalledSkillDirs(fs: ReadonlyFS, agent: AgentProfile): string[] {
  return fs.listDir(agent.skillsDir)
    .filter(entry => fs.exists(`${agent.skillsDir}/${entry}/SKILL.md`))
    .sort();
}

function analyzeSkillContent(
  skill: string,
  content: string,
  versions: Record<string, string | null>,
  quality: SkillQualityCounts,
): { outdated: boolean; adaptCommentCount: number } {
  const version = extractSkillVersion(content);
  versions[skill] = version;
  updateSkillQualityCounts(content, quality);

  return {
    outdated: version === null || version !== SKILL_VERSION,
    adaptCommentCount: countAdaptComments(content),
  };
}

function scanExpectedSkills(fs: ReadonlyFS, agent: AgentProfile): SkillInventory {
  const found: string[] = [];
  const missing: string[] = [];
  const versions: Record<string, string | null> = {};
  const quality = createSkillQualityCounts();
  let outdatedCount = 0;
  let adaptCommentCount = 0;

  for (const skill of EXPECTED_SKILLS) {
    const skillPath = `${agent.skillsDir}/${skill}/SKILL.md`;
    if (!fs.exists(skillPath)) {
      missing.push(skill);
      continue;
    }

    found.push(skill);
    const skillContent = fs.readFile(skillPath);
    if (!skillContent) continue;

    const analysis = analyzeSkillContent(skill, skillContent, versions, quality);
    if (analysis.outdated) outdatedCount++;
    adaptCommentCount += analysis.adaptCommentCount;
  }

  return { found, missing, versions, outdatedCount, quality, adaptCommentCount };
}

function countUnadaptedSkills(
  fs: ReadonlyFS,
  agent: AgentProfile,
  found: string[],
): number {
  let unadaptedCount = 0;

  for (const skill of found) {
    const skillPath = `${agent.skillsDir}/${skill}/SKILL.md`;
    const installed = fs.readFile(skillPath);
    const templateName = skill.replace(/^goat-/, '');
    const template = fs.readFile(`workflow/skills/goat-${templateName}.md`);
    if (!installed || !template) continue;

    const installedStep0 = extractSection(installed, 'Step 0');
    const templateStep0 = extractSection(template, 'Step 0');
    if (installedStep0 && templateStep0 && jaccardSimilarity(installedStep0, templateStep0) > 0.9) {
      unadaptedCount++;
    }
  }

  return unadaptedCount;
}

function shouldIgnoreDanglingSkillRef(ref: string): boolean {
  if (/^https?:/.test(ref)) return true;
  if (/\{|YYYY|file:line|path\/to|monitoring\//i.test(ref)) return true;
  if (/^(?:\.goat-flow\/)?tasks\/(handoff|todo|commit|release|scratchpad|improvement)/.test(ref)) return true;
  if (/^(src\/api|config\/|docs\/glossary)/.test(ref)) return true;
  return false;
}

function extractDanglingSkillRefs(
  fs: ReadonlyFS,
  agent: AgentProfile,
  found: string[],
): string[] {
  const danglingRefs: string[] = [];
  const pathRefPattern = /`((?:[a-zA-Z0-9._-]+\/)+[a-zA-Z0-9._-]+(?::[0-9]+)?)`/g;

  for (const skill of found) {
    const content = fs.readFile(`${agent.skillsDir}/${skill}/SKILL.md`);
    if (!content) continue;
    for (const match of content.matchAll(pathRefPattern)) {
      const rawRef = match[1];
      if (rawRef === undefined) continue;
      const ref = rawRef.replace(/:[0-9]+$/, '');
      if (shouldIgnoreDanglingSkillRef(ref)) continue;
      if (!fs.exists(ref)) {
        pushUniquePath(danglingRefs, ref);
      }
    }
  }

  return danglingRefs;
}

/** Extract skill facts: found/missing skills, versions, and quality metrics. */
function extractSkillFacts(fs: ReadonlyFS, agent: AgentProfile): AgentFacts['skills'] {
  const installedDirs = collectInstalledSkillDirs(fs, agent);
  const inventory = scanExpectedSkills(fs, agent);
  const unadaptedCount = countUnadaptedSkills(fs, agent, inventory.found);
  const hasDispatcher = fs.exists(`${agent.skillsDir}/goat/SKILL.md`);
  const danglingRefs = extractDanglingSkillRefs(fs, agent, inventory.found);

  return {
    installedDirs,
    found: inventory.found,
    missing: inventory.missing,
    allPresent: inventory.missing.length === 0,
    versions: inventory.versions,
    outdatedCount: inventory.outdatedCount,
    hasDispatcher,
    danglingRefs,
    quality: {
      ...inventory.quality,
      unadaptedCount,
      adaptCommentCount: inventory.adaptCommentCount,
      total: inventory.found.length,
    },
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
  blocksCloudDestructive: boolean;
} {
  return {
    hasBlocks: /exit\s+2|block|BLOCK/i.test(denyContent) && denyContent.split('\n').length > 5,
    usesJq: /\bjq\b/.test(denyContent) && !/grep\s+-[a-zA-Z]*P/.test(denyContent),
    handlesChaining: /&&|\|\||;/.test(denyContent) && /split|segment|chain/i.test(denyContent),
    blocksRmRf: /rm\s*.*-.*r.*f|rm\s*-rf/i.test(denyContent),
    blocksForcePush: /force.*push|--force/i.test(denyContent),
    blocksChmod: /chmod.*777/.test(denyContent),
    blocksCloudDestructive: /docker\s+push|terraform\s+(destroy|apply.*-auto-approve)|aws\s+(s3\s+rm|ec2\s+terminate)/i.test(denyContent),
  };
}

/** Apply settings-based Bash deny pattern overrides to hook facts. */
function applySettingsDenyOverrides(
  denyStr: string,
  hook: { denyExists: boolean; denyHasBlocks: boolean; denyIsConfigBased: boolean; denyUsesJq: boolean; denyHandlesChaining: boolean;
    denyBlocksRmRf: boolean; denyBlocksForcePush: boolean; denyBlocksChmod: boolean; denyBlocksCloudDestructive: boolean },
): void {
  // Settings deny counts as a deny mechanism existing
  if (hook.denyExists === false && denyStr.includes('Bash(')) {
    hook.denyExists = true;
    // settings.json deny is mechanical blocking
    hook.denyHasBlocks = true;
    // Config-based deny — jq/chaining checks are not applicable
    hook.denyIsConfigBased = true;
  }
  // Check for specific dangerous patterns in Bash deny rules
  if (/Bash\(.*rm -rf|Bash\(.*rm -fr/i.test(denyStr)) hook.denyBlocksRmRf = true;
  if (/Bash\(.*--force|Bash\(.*force.*push/i.test(denyStr)) hook.denyBlocksForcePush = true;
  if (/Bash\(.*chmod 777/i.test(denyStr)) hook.denyBlocksChmod = true;
  if (/Bash\(.*(docker push|terraform destroy|terraform apply|aws s3 rm|aws ec2 terminate)/i.test(denyStr)) hook.denyBlocksCloudDestructive = true;
}

/** Enrich deny hook facts from settings.json Bash deny patterns. */
function enrichDenyFromSettings(
  settingsParsed: unknown, hasDenyPatterns: boolean,
  hook: { denyExists: boolean; denyHasBlocks: boolean; denyIsConfigBased: boolean; denyUsesJq: boolean; denyHandlesChaining: boolean;
    denyBlocksRmRf: boolean; denyBlocksForcePush: boolean; denyBlocksChmod: boolean; denyBlocksCloudDestructive: boolean },
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
  hook: { denyExists: boolean; denyHasBlocks: boolean; denyIsConfigBased: boolean; denyUsesJq: boolean; denyHandlesChaining: boolean;
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
  // Execpolicy is config-based — jq/chaining checks are not applicable
  hook.denyIsConfigBased = true;
}

type HookDenyFacts = Pick<
  AgentFacts['hooks'],
  | 'denyExists'
  | 'denyHasBlocks'
  | 'denyIsConfigBased'
  | 'denyUsesJq'
  | 'denyHandlesChaining'
  | 'denyBlocksRmRf'
  | 'denyBlocksForcePush'
  | 'denyBlocksChmod'
  | 'denyBlocksCloudDestructive'
>;

type PostTurnFacts = Pick<
  AgentFacts['hooks'],
  | 'postTurnExists'
  | 'postTurnExitsZero'
  | 'postTurnHasValidation'
  | 'postToolExists'
>;

function detectCompactionHookExists(
  fs: ReadonlyFS,
  agent: AgentProfile,
  settingsParsed: unknown,
  settingsValid: boolean,
): boolean {
  const compactionHookExists = checkCompactionHook(settingsParsed, settingsValid);
  if (compactionHookExists || agent.id !== 'codex') {
    return compactionHookExists;
  }

  const configContent = fs.readFile('.codex/config.toml');
  return Boolean(configContent && /\[hooks\.session_start\]/.test(configContent));
}

function resolveDenyHookPath(fs: ReadonlyFS, agent: AgentProfile): string | null {
  if (agent.hooksDir && fs.exists(`${agent.hooksDir}/deny-dangerous.sh`)) {
    return `${agent.hooksDir}/deny-dangerous.sh`;
  }
  if (agent.denyMechanism.type === 'deny-script') {
    return agent.denyMechanism.path;
  }
  if (agent.denyMechanism.type === 'both') {
    return agent.denyMechanism.scriptPath;
  }
  return null;
}

function createEmptyDenyFacts(denyExists: boolean): HookDenyFacts {
  return {
    denyExists,
    denyHasBlocks: false,
    denyIsConfigBased: false,
    denyUsesJq: false,
    denyHandlesChaining: false,
    denyBlocksRmRf: false,
    denyBlocksForcePush: false,
    denyBlocksChmod: false,
    denyBlocksCloudDestructive: false,
  };
}

function analyzeDenyHookPath(fs: ReadonlyFS, denyHookPath: string | null): HookDenyFacts {
  const denyExists = denyHookPath !== null && fs.exists(denyHookPath);
  const hook = createEmptyDenyFacts(denyExists);
  if (!denyExists || !denyHookPath) {
    return hook;
  }

  const denyContent = fs.readFile(denyHookPath);
  if (!denyContent) {
    return hook;
  }

  const analysis = analyzeDenyScript(denyContent);
  return {
    ...hook,
    denyHasBlocks: analysis.hasBlocks,
    denyUsesJq: analysis.usesJq,
    denyHandlesChaining: analysis.handlesChaining,
    denyBlocksRmRf: analysis.blocksRmRf,
    denyBlocksForcePush: analysis.blocksForcePush,
    denyBlocksChmod: analysis.blocksChmod,
    denyBlocksCloudDestructive: analysis.blocksCloudDestructive,
  };
}

function lineHasAbsolutePath(line: string): boolean {
  return !line.trimStart().startsWith('#')
    && !/\$\(git rev-parse/.test(line)
    && /\/(home|Users|tmp|var|opt)\/\w+\//.test(line);
}

function findAbsolutePathHooks(fs: ReadonlyFS, hooksDir: string | null): string[] {
  if (!hooksDir || !fs.exists(hooksDir)) return [];
  const absolutePathHooks: string[] = [];

  for (const hookFile of fs.listDir(hooksDir)) {
    if (!hookFile.endsWith('.sh')) continue;
    const hookContent = fs.readFile(`${hooksDir}/${hookFile}`);
    if (!hookContent) continue;
    if (hookContent.split('\n').some(lineHasAbsolutePath)) {
      absolutePathHooks.push(hookFile);
    }
  }

  return absolutePathHooks;
}

/** Extract all hook-related facts: deny hooks, post-turn, post-tool, compaction. */
function extractHookFacts(
  fs: ReadonlyFS, agent: AgentProfile, settingsParsed: unknown, hasDenyPatterns: boolean, settingsValid: boolean,
): Omit<AgentFacts['hooks'], 'readDenyCoversSecrets'> {
  const compactionHookExists = detectCompactionHookExists(fs, agent, settingsParsed, settingsValid);
  const hook = analyzeDenyHookPath(fs, resolveDenyHookPath(fs, agent));
  const absolutePathHooks = findAbsolutePathHooks(fs, agent.hooksDir);

  // Second: also check settings.json Bash deny patterns
  enrichDenyFromSettings(settingsParsed, hasDenyPatterns, hook);

  // For Codex: also check execpolicy rules
  if (agent.id === 'codex') {
    enrichDenyFromExecpolicy(fs, hook);
  }

  const postTurn = extractPostTurnFacts(fs, agent);

  return {
    ...hook,
    ...postTurn,
    compactionHookExists,
    absolutePathHooks,
  };
}

function analyzeHookScriptAtPath(
  fs: ReadonlyFS,
  scriptPath: string,
): Pick<PostTurnFacts, 'postTurnExitsZero' | 'postTurnHasValidation'> {
  const hookContent = fs.readFile(scriptPath);
  if (!hookContent) {
    return { postTurnExitsZero: false, postTurnHasValidation: false };
  }

  const analysis = analyzePostTurnScript(hookContent);
  return {
    postTurnExitsZero: analysis.exitsZero,
    postTurnHasValidation: analysis.hasValidation,
  };
}

function extractCodexStopScriptPath(configContent: string): string | null {
  const stopScript = configContent.match(/\[hooks\.stop\]\s*\n\s*command\s*=\s*\[.*?"([^"]+\.sh)"/);
  return stopScript?.[1] ?? null;
}

function extractCodexPostTurnFacts(fs: ReadonlyFS): PostTurnFacts {
  const configContent = fs.readFile('.codex/config.toml');
  if (!configContent) {
    return {
      postTurnExists: false,
      postTurnExitsZero: false,
      postTurnHasValidation: false,
      postToolExists: false,
    };
  }

  const postTurnExists = /\[hooks\.stop\]/.test(configContent);
  const postToolExists = /\[hooks\.after_tool_use\]/.test(configContent);
  if (!postTurnExists) {
    return {
      postTurnExists,
      postTurnExitsZero: false,
      postTurnHasValidation: false,
      postToolExists,
    };
  }

  const stopScriptPath = extractCodexStopScriptPath(configContent);
  return {
    postTurnExists,
    postToolExists,
    ...(
      stopScriptPath
        ? analyzeHookScriptAtPath(fs, stopScriptPath)
        : { postTurnExitsZero: false, postTurnHasValidation: false }
    ),
  };
}

function extractDirectoryPostTurnFacts(fs: ReadonlyFS, hooksDir: string): PostTurnFacts {
  const stopLintPath = `${hooksDir}/stop-lint.sh`;
  const postTurnExists = fs.exists(stopLintPath);
  const postToolExists = fs.exists(`${hooksDir}/format-file.sh`);

  return {
    postTurnExists,
    postToolExists,
    ...(
      postTurnExists
        ? analyzeHookScriptAtPath(fs, stopLintPath)
        : { postTurnExitsZero: false, postTurnHasValidation: false }
    ),
  };
}

/** Extract post-turn and post-tool hook facts. */
function extractPostTurnFacts(fs: ReadonlyFS, agent: AgentProfile): {
  postTurnExists: boolean; postTurnExitsZero: boolean;
  postTurnHasValidation: boolean; postToolExists: boolean;
} {
  if (agent.id === 'codex') {
    return extractCodexPostTurnFacts(fs);
  }

  if (agent.hooksDir) {
    return extractDirectoryPostTurnFacts(fs, agent.hooksDir);
  }

  return {
    postTurnExists: false,
    postTurnExitsZero: false,
    postTurnHasValidation: false,
    postToolExists: false,
  };
}

function resolveReferencedPaths(fs: ReadonlyFS, paths: string[]): {
  resolved: number;
  unresolved: string[];
} {
  let resolved = 0;
  const unresolved: string[] = [];

  for (const path of paths) {
    if (fs.exists(path)) {
      resolved++;
    } else {
      unresolved.push(path);
    }
  }

  return { resolved, unresolved };
}

function extractMarkerPaths(content: string | null): {
  hasMarkers: boolean;
  markerPaths: string[];
} {
  const markerStart = '<!-- goat-flow:router:start -->';
  const markerEnd = '<!-- goat-flow:router:end -->';
  const hasMarkers = content !== null && content.includes(markerStart) && content.includes(markerEnd);
  if (!hasMarkers) {
    return { hasMarkers: false, markerPaths: [] };
  }

  const startIdx = content.indexOf(markerStart) + markerStart.length;
  const endIdx = content.indexOf(markerEnd);
  const markerContent = content.slice(startIdx, endIdx);
  const markerPaths: string[] = [];

  for (const match of markerContent.matchAll(/`([^`]+\/[^`]*)`/g)) {
    const raw = match[1];
    if (raw === undefined || raw.includes('*')) continue;
    const ref = raw.replace(/\/$/, '');
    if (!ref) continue;
    pushUniquePath(markerPaths, ref);
  }

  return { hasMarkers, markerPaths };
}

/** Extract router table facts: paths found and their resolution status. */
function extractRouterFacts(fs: ReadonlyFS, content: string | null): AgentFacts['router'] {
  const paths = content !== null ? extractRouterPaths(content) : [];
  const resolution = resolveReferencedPaths(fs, paths);
  const markerInfo = extractMarkerPaths(content);
  const staleMarkerPaths = markerInfo.markerPaths.filter(path => !fs.exists(path));

  return {
    exists: paths.length > 0,
    paths,
    resolved: resolution.resolved,
    unresolved: resolution.unresolved,
    hasMarkers: markerInfo.hasMarkers,
    markerPaths: markerInfo.markerPaths,
    staleMarkerPaths,
  };
}

/** Extract ask-first boundary facts: paths listed and their resolution status. */
function extractAskFirstFacts(fs: ReadonlyFS, content: string | null): AgentFacts['askFirst'] {
  const paths = content !== null ? extractAskFirstPaths(content) : [];
  const resolution = resolveReferencedPaths(fs, paths);
  return {
    exists: paths.length > 0,
    paths,
    resolved: resolution.resolved,
    unresolved: resolution.unresolved,
  };
}

// settingsLocal extraction removed - personal preference file, not a project quality signal.

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

  return {
    agent,
    instruction,
    settings: { exists: settings.exists, valid: settings.valid, parsed: settings.parsed, hasDenyPatterns: settings.hasDenyPatterns },
    skills,
    hooks: { ...hookFacts, readDenyCoversSecrets: settings.readDenyCoversSecrets },
    deny,
    router,
    askFirst,
    localContext: { files: filteredLocal, warranted, missing },
  };
}
