/**
 * Anti-pattern definitions for the scanner.
 * These deductions model harmful workflow smells that are easier to flag as penalties than as ordinary rubric checks.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AntiPatternDef,
  FactContext,
  AntiPatternResult,
} from '../types.js';
import { SKILL_VERSION, SKILL_NAMES } from '../constants.js';

/** Regex matching backtick-wrapped project paths in instruction file content. */
const INSTRUCTION_PATH_PATTERN =
  /`((?:src|config|templates?|app|apps|lib|docs|scripts|setup|workflow|ai|agent-evals|\.claude|\.agents|\.github)\/[^`]+)`/g;

/** Find stale instruction refs. */
function findStaleInstructionRefs(ctx: FactContext): string[] {
  const content = ctx.agentFacts.instruction.content;
  const resolvedRoot = ctx.facts.root;
  if (!content || !resolvedRoot || !existsSync(resolvedRoot)) return [];

  const staleRefs: string[] = [];
  for (const match of content.matchAll(INSTRUCTION_PATH_PATTERN)) {
    const path = match[1];
    if (path === undefined || /[*?{}]/.test(path)) continue;
    const cleanPath = path.replace(/:[0-9]+(?:[-,][0-9]+)*$/, '');
    if (!existsSync(join(resolvedRoot, cleanPath))) staleRefs.push(cleanPath);
  }

  return staleRefs;
}

/**
 * Anti-Pattern Deductions (max -15)
 * Add deductions only for misleading or actively harmful states.
 */
export const antiPatterns: AntiPatternDef[] = [
  // === AP1-AP3: Instruction File Anti-Patterns ===
  {
    id: 'AP1',
    name: 'Instruction file over 150 lines',
    deduction: -3,
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const lines = ctx.agentFacts.instruction.lineCount;
      const triggered = lines > 150;
      return {
        id: 'AP1',
        name: 'Instruction file over 150 lines',
        triggered,
        deduction: triggered ? -3 : 0,
        confidence: 'high',
        message: triggered
          ? `${lines} lines (hard limit: 150)`
          : `${lines} lines (OK)`,
        evidence: ctx.agentFacts.agent.instructionFile,
      };
    },
    recommendation: 'Compress instruction file below 150 lines',
    recommendationKey: 'ap-compress-instruction-file',
  },
  // AP2 removed - penalized project-specific skills (e.g., deploy/, preflight/) by assuming all skills need goat- prefix.
  // See ai-docs/footguns/ "Scanner AP2 penalizes project-specific skills" (2026-04-01, RESOLVED).
  {
    id: 'AP3',
    name: 'DoD in both instruction file and guidelines',
    deduction: -3,
    confidence: 'low',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      // Only count real DoD section duplication, not incidental mentions of the phrase.
      const DOD_SECTION = /^#+\s*definition of done/im;
      const instructionContent = ctx.agentFacts.instruction.content;
      const conventionsContent =
        ctx.facts.shared.localInstructions.conventionsContent;
      const inInstruction =
        instructionContent !== null && DOD_SECTION.test(instructionContent);
      const inConventions =
        conventionsContent !== null && DOD_SECTION.test(conventionsContent);
      const triggered = inInstruction && inConventions;
      return {
        id: 'AP3',
        name: 'DoD in both instruction file and guidelines',
        triggered,
        deduction: triggered ? -3 : 0,
        confidence: 'low',
        message: triggered
          ? 'DoD appears in both instruction file and conventions.md - risk of conflicting definitions'
          : 'No DoD duplication detected',
      };
    },
    recommendation: 'Remove DoD from guidelines file',
    recommendationKey: 'ap-fix-dod-overlap',
  },

  // === AP4-AP6: Settings and Hooks Anti-Patterns ===
  {
    id: 'AP4',
    name: 'Footguns without file:line evidence',
    deduction: -5,
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { exists, hasEvidence } = ctx.facts.shared.footguns;
      const triggered = exists && hasEvidence === false;
      return {
        id: 'AP4',
        name: 'Footguns without file:line evidence',
        triggered,
        deduction: triggered ? -5 : 0,
        confidence: 'high',
        message: triggered
          ? 'footguns.md has no file:line evidence'
          : exists
            ? 'Footguns have evidence'
            : 'No footguns.md',
      };
    },
    recommendation: 'Add file:line evidence to all footgun entries',
    recommendationKey: 'ap-add-footgun-evidence',
  },
  {
    id: 'AP5',
    name: 'settings.json invalid JSON',
    deduction: -5,
    confidence: 'high',
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    evaluate: (ctx: FactContext): AntiPatternResult => {
      if (ctx.agentFacts.settings.exists === false)
        return {
          id: 'AP5',
          name: 'settings.json invalid JSON',
          triggered: false,
          deduction: 0,
          confidence: 'high',
          message: 'No settings file',
        };
      const triggered = ctx.agentFacts.settings.valid === false;
      return {
        id: 'AP5',
        name: 'settings.json invalid JSON',
        triggered,
        deduction: triggered ? -5 : 0,
        confidence: 'high',
        message: triggered
          ? 'settings.json is invalid JSON'
          : 'settings.json is valid',
        evidence: ctx.agentFacts.agent.settingsFile ?? undefined,
      };
    },
    recommendation: 'Fix settings.json - invalid JSON',
    recommendationKey: 'ap-fix-settings-json',
  },
  {
    id: 'AP6',
    name: 'Post-turn hook swallows failures',
    deduction: -5,
    confidence: 'medium',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      if (ctx.agentFacts.hooks.postTurnExists === false)
        return {
          id: 'AP6',
          name: 'Post-turn hook swallows failures',
          triggered: false,
          deduction: 0,
          confidence: 'medium',
          message: 'No post-turn hook',
        };
      const triggered = ctx.agentFacts.hooks.postTurnSwallowsFailures;
      return {
        id: 'AP6',
        name: 'Post-turn hook swallows failures',
        triggered,
        deduction: triggered ? -5 : 0,
        confidence: 'medium',
        message: triggered
          ? 'Post-turn hook uses || true on validation commands, so lint/typecheck failures are hidden'
          : 'Post-turn hook does not swallow validation failures',
      };
    },
    recommendation:
      'Remove `|| true` after validation commands in stop-lint.sh so lint/typecheck failures are not hidden',
    recommendationKey: 'ap-fix-hook-exit',
  },

  // === AP7-AP9: Local Files and Gitignore Anti-Patterns ===
  {
    id: 'AP7',
    name: 'Local per-directory instruction file over 20 lines',
    deduction: -2,
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      // Only check per-directory local files (e.g., src/api/CLAUDE.md)
      // EXCLUDE ai-docs/coding-standards/ and .github/instructions/ - those are cold-path files meant to be 40-60 lines
      const oversize = ctx.facts.shared.localInstructions.localFileSizes
        .filter(
          (f) =>
            f.path.includes(ctx.facts.shared.localInstructions.path) ===
              false && f.path.includes('.github/instructions/') === false,
        )
        .filter((f) => f.lines > 20);
      const triggered = oversize.length > 0;
      const message = triggered
        ? `Oversize local files: ${oversize.map((f) => `${f.path} (${f.lines} lines)`).join(', ')}`
        : 'All local per-directory instruction files are 20 lines or fewer';
      return {
        id: 'AP7',
        name: 'Local per-directory instruction file over 20 lines',
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: 'high',
        message,
      };
    },
    recommendation: 'Compress local instruction files to under 20 lines',
    recommendationKey: 'ap-compress-local-files',
  },
  {
    id: 'AP8',
    name: 'Generic Ask First boundaries',
    deduction: -2,
    confidence: 'medium',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const section = findSection(ctx, 'ask first');
      if (section === null)
        return {
          id: 'AP8',
          name: 'Generic Ask First boundaries',
          triggered: false,
          deduction: 0,
          confidence: 'medium',
          message: 'No Ask First section',
        };
      // Known template text that indicates the boundaries were not customized
      const genericMarkers = [
        'auth, routing, deployment, API, DB',
        'Public API, dependencies, config',
        'Shared sourced files, CONFIGURATION',
      ];
      const triggered = genericMarkers.some((m) => section.includes(m));
      return {
        id: 'AP8',
        name: 'Generic Ask First boundaries',
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: 'medium',
        message: triggered
          ? 'Ask First matches template text'
          : 'Ask First appears project-specific',
      };
    },
    recommendation:
      'Replace generic Ask First boundaries with project-specific ones',
    recommendationKey: 'ap-fix-generic-ask-first',
  },
  {
    id: 'AP9',
    name: 'settings.local.json committed',
    deduction: -2,
    confidence: 'high',
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    evaluate: (ctx: FactContext): AntiPatternResult => {
      if (ctx.facts.shared.gitignore.exists === false) {
        return {
          id: 'AP9',
          name: 'settings.local.json committed',
          triggered: true,
          deduction: -2,
          confidence: 'high',
          message: 'No .gitignore - settings.local.json is not protected',
        };
      }
      const triggered = ctx.facts.shared.gitignore.hasRequiredEntries === false;
      return {
        id: 'AP9',
        name: 'settings.local.json committed',
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: 'high',
        message: triggered
          ? 'settings.local.json not in .gitignore'
          : 'settings.local.json is gitignored',
      };
    },
    recommendation: 'Add settings.local.json to .gitignore',
    recommendationKey: 'ap-gitignore-settings-local',
  },
  // AP10 removed - settings.local.json is a personal preference file, not a project quality signal.
  // === AP11-AP12: Quality Anti-Patterns ===
  {
    id: 'AP11',
    name: 'Empty learning loop scaffolding',
    deduction: 0, // v1.1.0: structure presence = pass, content is a maturity indicator not a setup gate
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { lessons, footguns } = ctx.facts.shared;
      const lessonsEmpty = lessons.exists && !lessons.hasEntries;
      const footgunsEmpty = footguns.exists && !footguns.hasEvidence;
      const triggered = lessonsEmpty || footgunsEmpty;
      const parts: string[] = [];
      if (lessonsEmpty) parts.push('lessons directory has no entries yet');
      if (footgunsEmpty) parts.push('footguns directory has no evidence yet');
      const message = triggered
        ? `Learning loop directories exist but have no content yet (normal for new projects): ${parts.join(', ')}`
        : 'Learning loop files have content';
      return {
        id: 'AP11',
        name: 'Empty learning loop scaffolding',
        triggered,
        deduction: 0, // No penalty — empty directories are correctly set up projects
        confidence: 'high',
        message,
      };
    },
    recommendation:
      'Content accumulates through real work, not setup. Add entries when real incidents occur.',
    recommendationKey: 'ap-fix-empty-scaffolding',
  },
  {
    id: 'AP12',
    name: 'Stale file references in footguns.md',
    deduction: -3,
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { staleRefs, totalRefs } = ctx.facts.shared.footguns;
      if (totalRefs === 0)
        return {
          id: 'AP12',
          name: 'Stale file references in footguns.md',
          triggered: false,
          deduction: 0,
          confidence: 'high',
          message: 'No file references to check',
        };
      const triggered = staleRefs.length > 0;
      return {
        id: 'AP12',
        name: 'Stale file references in footguns.md',
        triggered,
        deduction: triggered ? -3 : 0,
        confidence: 'high',
        message: triggered
          ? `${staleRefs.length} stale refs: ${staleRefs.slice(0, 3).join(', ')}`
          : 'All file references resolve',
        evidence: triggered ? staleRefs.join(', ') : undefined,
      };
    },
    recommendation:
      'Update or remove stale file:line references in footguns.md',
    recommendationKey: 'ap-fix-stale-references',
  },
  {
    id: 'AP22',
    name: 'Duplicate learning-loop surfaces',
    deduction: -3,
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const evidence = [
        ...ctx.facts.shared.footguns.duplicateSurfacePaths,
        ...ctx.facts.shared.lessons.duplicateSurfacePaths,
      ].sort((a, b) => a.localeCompare(b));
      const triggered = evidence.length > 0;
      return {
        id: 'AP22',
        name: 'Duplicate learning-loop surfaces',
        triggered,
        deduction: triggered ? -3 : 0,
        confidence: 'high',
        message: triggered
          ? `Competing learning-loop surfaces found alongside the configured bucket layout: ${evidence.join(', ')}`
          : 'No competing legacy learning-loop surfaces detected',
        evidence: triggered ? evidence.join(', ') : undefined,
      };
    },
    recommendation:
      'Remove or migrate legacy lessons/footguns surfaces so only the configured bucket paths remain',
    recommendationKey: 'ap-fix-duplicate-learning-loop-surfaces',
  },

  // === AP13-AP15: New anti-patterns (B3-B5) ===
  {
    id: 'AP13',
    name: 'Stale code references in instruction file',
    deduction: -3,
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const content = ctx.agentFacts.instruction.content;
      if (!content)
        return {
          id: 'AP13',
          name: 'Stale code references in instruction file',
          triggered: false,
          deduction: 0,
          confidence: 'high',
          message: 'No instruction file',
        };
      const stale = findStaleInstructionRefs(ctx);
      const triggered = stale.length > 0;
      return {
        id: 'AP13',
        name: 'Stale code references in instruction file',
        triggered,
        deduction: triggered ? -3 : 0,
        confidence: 'high',
        message: triggered
          ? `${stale.length} stale code refs in ${ctx.agentFacts.agent.instructionFile}: ${stale.slice(0, 3).join(', ')}`
          : 'All code references resolve',
        evidence: triggered ? stale.join(', ') : undefined,
      };
    },
    recommendation:
      'Fix stale code references in the instruction file - update paths after renames/deletes',
    recommendationKey: 'ap-fix-stale-instruction-refs',
  },
  {
    id: 'AP14',
    name: 'Duplicate skill directories',
    deduction: -2,
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      // Flag duplicate installs where a legacy skill coexists with its goat-* counterpart.
      const installedDirs = ctx.agentFacts.skills.installedDirs;
      const goatSkills = installedDirs.filter((s) => s.startsWith('goat-'));
      const nonGoat = installedDirs.filter(
        (s) => !s.startsWith('goat-') && s !== 'goat',
      );
      const duplicates = nonGoat.filter((s) =>
        goatSkills.includes(`goat-${s}`),
      );
      const triggered = duplicates.length > 0;
      return {
        id: 'AP14',
        name: 'Duplicate skill directories',
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: 'high',
        message: triggered
          ? `Duplicate skills: ${duplicates.map((s) => `${s}/ + goat-${s}/`).join(', ')}`
          : 'No duplicate skills',
      };
    },
    recommendation:
      'Remove non-goat-prefixed skill directories that duplicate goat-* skills',
    recommendationKey: 'ap-fix-duplicate-skills',
  },
  {
    id: 'AP15',
    name: 'Outdated skill versions',
    deduction: -10,
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { found, outdatedCount, versions } = ctx.agentFacts.skills;
      if (found.length === 0)
        return {
          id: 'AP15',
          name: 'Outdated skill versions',
          triggered: false,
          deduction: 0,
          confidence: 'high',
          message: 'No skills to check',
        };
      const triggered = outdatedCount > 0;
      const outdatedNames = found.filter(
        (s) => versions[s] === null || versions[s] !== SKILL_VERSION,
      );
      /** Scale deduction: -2 per outdated skill, capped at -10 */
      const scaledDeduction = Math.max(-10, -2 * outdatedCount);
      return {
        id: 'AP15',
        name: 'Outdated skill versions',
        triggered,
        deduction: triggered ? scaledDeduction : 0,
        confidence: 'high',
        message: triggered
          ? `${outdatedCount}/${found.length} skills are outdated (expected version ${SKILL_VERSION}): ${outdatedNames.slice(0, 5).join(', ')}`
          : `All ${found.length} skills at version ${SKILL_VERSION}`,
        evidence: triggered ? outdatedNames.join(', ') : undefined,
      };
    },
    recommendation: `Update skills to version ${SKILL_VERSION} - re-run setup or add goat-flow-skill-version: ${SKILL_VERSION} to each skill's frontmatter`,
    recommendationKey: 'ap-fix-outdated-skills',
  },
  {
    id: 'AP17',
    name: 'Dangling file references in skills',
    deduction: -3,
    confidence: 'medium',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { danglingRefs } = ctx.agentFacts.skills;
      const triggered = danglingRefs.length > 0;
      return {
        id: 'AP17',
        name: 'Dangling file references in skills',
        triggered,
        deduction: triggered ? -3 : 0,
        confidence: 'medium',
        message: triggered
          ? `${danglingRefs.length} dangling ref(s) in skills: ${danglingRefs.slice(0, 5).join(', ')}`
          : 'All skill file references resolve',
        evidence: triggered ? danglingRefs.join(', ') : undefined,
      };
    },
    recommendation:
      'Fix or remove dangling file paths in skill SKILL.md files. Every backtick-wrapped path reference should point to an existing file.',
    recommendationKey: 'ap-fix-dangling-skill-refs',
  },
  {
    id: 'AP18',
    name: 'Unanswered ADAPT comments in skills',
    deduction: -2,
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { adaptCommentCount } = ctx.agentFacts.skills.quality;
      const triggered = adaptCommentCount > 0;
      return {
        id: 'AP18',
        name: 'Unanswered ADAPT comments in skills',
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: 'high',
        message: triggered
          ? `${adaptCommentCount} remaining <!-- ADAPT: --> comment(s) in skill files. These are unanswered template questions that should be replaced with project-specific content.`
          : 'All ADAPT comments resolved',
      };
    },
    recommendation:
      "Replace remaining <!-- ADAPT: --> comments in skill files with project-specific content. These mark template questions that need your project's real examples.",
    recommendationKey: 'ap-fix-adapt-comments',
  },
  {
    id: 'AP19',
    name: 'Hardcoded absolute paths in hooks',
    deduction: -2,
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { absolutePathHooks } = ctx.agentFacts.hooks;
      const triggered = absolutePathHooks.length > 0;
      return {
        id: 'AP19',
        name: 'Hardcoded absolute paths in hooks',
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: 'high',
        message: triggered
          ? `${absolutePathHooks.length} hook(s) with hardcoded absolute paths: ${absolutePathHooks.join(', ')}. Use $(git rev-parse --show-toplevel) instead.`
          : 'All hooks use portable paths',
      };
    },
    recommendation:
      'Replace hardcoded absolute paths in hook scripts with $(git rev-parse --show-toplevel). Absolute paths break when the repo is cloned elsewhere.',
    recommendationKey: 'ap-fix-hook-paths',
  },
  // === AP20: Non-canonical goat-flow skill directories ===
  {
    id: 'AP20',
    name: 'Non-canonical goat-flow skill directories',
    deduction: -3,
    confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const canonicalSet = new Set<string>(SKILL_NAMES);
      const nonCanonical = ctx.agentFacts.skills.installedDirs.filter(
        (s) => (s.startsWith('goat-') || s === 'goat') && !canonicalSet.has(s),
      );
      // Also flag known legacy skill names that aren't goat-* prefixed
      const legacyNames = ['audit', 'review', 'preflight'];
      const legacyFound = ctx.agentFacts.skills.installedDirs.filter((s) =>
        legacyNames.includes(s),
      );
      const allStale = [...new Set([...nonCanonical, ...legacyFound])].sort();
      const triggered = allStale.length > 0;
      return {
        id: 'AP20',
        name: 'Non-canonical goat-flow skill directories',
        triggered,
        deduction: triggered ? -3 : 0,
        confidence: 'high',
        message: triggered
          ? `Found ${allStale.length} non-canonical skill dir(s): ${allStale.join(', ')}. These are likely from a previous goat-flow version and confuse agents.`
          : 'All skill directories are canonical',
        evidence: triggered
          ? `Run \`goat-flow upgrade\` or manually delete: ${allStale.join(', ')}`
          : undefined,
      };
    },
    recommendation:
      'Remove non-canonical skill directories left over from a previous goat-flow version. Run `goat-flow upgrade` or manually delete the stale directories.',
    recommendationKey: 'ap-remove-stale-skills',
  },
  // === AP21: Stale goat-flow-owned router entries ===
  {
    id: 'AP21',
    name: 'Stale goat-flow-owned router entries',
    deduction: -2,
    confidence: 'high',
    na: (ctx) => !ctx.agentFacts.router.hasMarkers,
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { staleMarkerPaths } = ctx.agentFacts.router;
      const triggered = staleMarkerPaths.length > 0;
      return {
        id: 'AP21',
        name: 'Stale goat-flow-owned router entries',
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: 'high',
        message: triggered
          ? `${staleMarkerPaths.length} stale paths inside router markers: ${staleMarkerPaths.slice(0, 3).join(', ')}`
          : 'All goat-flow-owned router paths resolve',
        evidence: triggered ? staleMarkerPaths.join(', ') : undefined,
      };
    },
    recommendation:
      'Update router table marker block - some goat-flow-owned paths point to non-existent resources. Run `goat-flow setup` to regenerate.',
    recommendationKey: 'ap-fix-stale-router-markers',
  },
  // === AP23: Overly broad deny patterns ===
  {
    id: 'AP23',
    name: 'Overly broad deny patterns',
    deduction: -2,
    confidence: 'medium',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const parsed = ctx.agentFacts.settings.parsed as Record<string, unknown> | null;
      const permissions = parsed?.permissions as Record<string, unknown> | undefined;
      const rawDeny = permissions?.deny;
      const denyList = Array.isArray(rawDeny) ? (rawDeny as string[]) : [];
      if (denyList.length === 0)
        return {
          id: 'AP23',
          name: 'Overly broad deny patterns',
          triggered: false,
          deduction: 0,
          confidence: 'medium',
          message: 'No deny patterns configured',
        };
      const tooBroad = findBroadDenyPatterns(denyList);
      const triggered = tooBroad.length > 0;
      return {
        id: 'AP23',
        name: 'Overly broad deny patterns',
        triggered,
        deduction: triggered ? -2 : 0,
        confidence: 'medium',
        message: triggered
          ? `${tooBroad.length} overly broad deny pattern(s): ${tooBroad.join(', ')}. These block legitimate commands. Use specific patterns like Bash(*git push*) instead of Bash(*git*).`
          : 'Deny patterns are specific enough',
        evidence: triggered ? tooBroad.join(', ') : undefined,
      };
    },
    recommendation:
      'Replace overly broad deny patterns with specific ones. E.g., use Bash(*git push*) and Bash(*git commit*) instead of Bash(*git*). Move to settings.local.json allow list if needed.',
    recommendationKey: 'ap-fix-broad-deny-patterns',
  },
];

/** Return deny patterns that block common substrings too aggressively. */
function findBroadDenyPatterns(denyList: string[]): string[] {
  const tooBroad: string[] = [];
  for (const p of denyList) {
    // Bash(*git*) blocks anything mentioning "git" - too broad
    if (/^Bash\(\*git\*\)$/i.test(p)) tooBroad.push(p);
    // Bash(*test*) blocks all test commands
    if (/^Bash\(\*test\*\)$/i.test(p)) tooBroad.push(p);
    // Bash(*run*) blocks npm run, cargo run, etc.
    if (/^Bash\(\*run\*\)$/i.test(p)) tooBroad.push(p);
  }
  return tooBroad;
}

/**
 * Search the instruction file sections for a heading containing the given name.
 * Returns the section body text, or null if no matching heading is found.
 */
function findSection(ctx: FactContext, name: string): string | null {
  // Iterate over all parsed section headings in the instruction file
  for (const [heading, content] of ctx.agentFacts.instruction.sections) {
    if (heading.includes(name.toLowerCase())) return content;
  }
  return null;
}
