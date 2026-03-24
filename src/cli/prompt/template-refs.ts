import type { AgentId } from '../types.js';
import { PROFILES } from '../detect/agents.js';
import { templateExists } from '../paths.js';

/** Maps a target output file to its goat-flow template source */
export interface TemplateRef {
  /** File path to create in the target project */
  output: string;
  /** Relative path to the goat-flow template that sources this file */
  template: string;
  /** Which setup phase this ref belongs to */
  phase: 'foundation' | 'standard' | 'full';
  /** Optional generation hint (e.g., "Adapt BAD/GOOD examples") */
  note?: string;
}

// ---------------------------------------------------------------------------
// Foundation refs — agent-branched hooks + shared instruction/settings
// ---------------------------------------------------------------------------

/** Return foundation-phase template refs for a specific agent */
function getFoundationRefs(agentId: AgentId): TemplateRef[] {
  const p = PROFILES[agentId];

  /** Shared refs that every agent gets at the foundation tier */
  const shared: TemplateRef[] = [
    {
      output: p.instructionFile,
      template: 'setup/shared/execution-loop.md',
      phase: 'foundation',
      note: 'Adapt BAD/GOOD examples',
    },
  ];

  /** Agent-specific hook/enforcement refs */
  const hooks: TemplateRef[] = getFoundationHooks(agentId);

  return [...shared, ...hooks];
}

/** Return the agent-specific hook and enforcement refs for the foundation phase */
function getFoundationHooks(agentId: AgentId): TemplateRef[] {
  switch (agentId) {
    case 'claude':
      return [
        {
          output: '.claude/settings.json',
          template: 'workflow/runtime/enforcement.md',
          phase: 'foundation',
          note: 'Use detected stack commands',
        },
        {
          output: '.claude/hooks/deny-dangerous.sh',
          template: 'workflow/runtime/enforcement.md',
          phase: 'foundation',
          note: 'Section: PreToolUse',
        },
        {
          output: '.claude/hooks/stop-lint.sh',
          template: 'workflow/runtime/enforcement.md',
          phase: 'foundation',
          note: 'Section: Stop hook',
        },
        {
          output: '.claude/hooks/format-file.sh',
          template: 'workflow/runtime/enforcement.md',
          phase: 'foundation',
          note: 'Section: PostToolUse',
        },
        {
          output: '.claude/hooks/ask-first-guard.sh',
          template: 'setup/setup-claude.md',
          phase: 'foundation',
          note: 'Section: Ask First (line 223+)',
        },
      ];

    case 'codex':
      return [
        {
          output: '.codex/config.toml',
          template: 'setup/setup-codex.md',
          phase: 'foundation',
          note: 'Section: hooks + execpolicy (line 111+)',
        },
        {
          output: '.codex/rules/deny-dangerous.star',
          template: 'setup/setup-codex.md',
          phase: 'foundation',
          note: 'Starlark execpolicy (line 120+)',
        },
        {
          output: 'scripts/stop-lint.sh',
          template: 'setup/setup-codex.md',
          phase: 'foundation',
          note: 'Section: verification scripts (line 131+)',
        },
      ];

    case 'gemini':
      return [
        {
          output: '.gemini/settings.json',
          template: 'setup/setup-gemini.md',
          phase: 'foundation',
          note: 'Use detected stack commands',
        },
        {
          output: '.gemini/hooks/deny-dangerous.sh',
          template: 'setup/setup-gemini.md',
          phase: 'foundation',
          note: 'Gemini BeforeTool hook',
        },
        {
          output: '.gemini/hooks/stop-lint.sh',
          template: 'setup/setup-gemini.md',
          phase: 'foundation',
          note: 'Gemini AfterAgent hook',
        },
        {
          output: '.gemini/hooks/format-file.sh',
          template: 'setup/setup-gemini.md',
          phase: 'foundation',
          note: 'Gemini AfterTool hook',
        },
      ];
  }
}

// ---------------------------------------------------------------------------
// Standard refs — shared across all agents
// ---------------------------------------------------------------------------

/** Ordered list of the 10 goat-flow skill template sources */
const SKILL_TEMPLATES = [
  'workflow/skills/goat-audit.md',
  'workflow/skills/goat-debug.md',
  'workflow/skills/goat-investigate.md',
  'workflow/skills/goat-onboard.md',
  'workflow/skills/goat-plan.md',
  'workflow/skills/goat-reflect.md',
  'workflow/skills/goat-resume.md',
  'workflow/skills/goat-review.md',
  'workflow/skills/goat-security.md',
  'workflow/skills/goat-test.md',
] as const;

/** Return standard-phase template refs for a specific agent */
function getStandardRefs(agentId: AgentId): TemplateRef[] {
  const p = PROFILES[agentId];

  /** Skill file refs — one per skill template, output into the agent's skills dir */
  const skillRefs: TemplateRef[] = SKILL_TEMPLATES.map(tmpl => {
    /** Skill name extracted from the template filename (e.g., "goat-commit") */
    const skillName = tmpl.replace('workflow/skills/', '').replace('.md', '');
    return {
      output: `${p.skillsDir}/${skillName}/SKILL.md`,
      template: tmpl,
      phase: 'standard' as const,
      note: 'One template per skill',
    };
  });

  /** Shared documentation and workflow refs for the standard phase */
  const sharedRefs: TemplateRef[] = [
    {
      output: 'docs/footguns.md',
      template: 'setup/shared/docs-seed.md',
      phase: 'standard',
      note: 'Real incidents only',
    },
    {
      output: 'docs/lessons.md',
      template: 'setup/shared/docs-seed.md',
      phase: 'standard',
      note: 'Seed from git history',
    },
    {
      output: 'docs/architecture.md',
      template: 'workflow/runtime/architecture.md',
      phase: 'standard',
      note: 'Under 100 lines',
    },
    {
      output: 'tasks/handoff-template.md',
      template: 'workflow/evaluation/handoff.md',
      phase: 'standard',
      note: 'Copy template',
    },
  ];

  /** Role-specific coding-standards refs that the scanner checks for */
  const roleRefs: TemplateRef[] = [
    {
      output: 'ai/README.md',
      template: 'setup/shared/docs-seed.md',
      phase: 'standard',
      note: 'Routing map for ai/instructions/',
    },
    {
      output: 'ai/instructions/conventions.md',
      template: 'workflow/coding-standards/conventions.md',
      phase: 'standard',
      note: 'Project-wide conventions',
    },
    {
      output: 'ai/instructions/code-review.md',
      template: 'workflow/coding-standards/code-review.md',
      phase: 'standard',
      note: 'Review standards',
    },
    {
      output: 'ai/instructions/git-commit.md',
      template: 'workflow/coding-standards/git-commit.md',
      phase: 'standard',
      note: 'Commit conventions',
    },
  ];

  return [...skillRefs, ...sharedRefs, ...roleRefs];
}

// ---------------------------------------------------------------------------
// Full refs — shared across all agents
// ---------------------------------------------------------------------------

/** Return full-phase template refs for a specific agent */
function getFullRefs(_agentId: AgentId): TemplateRef[] {
  return [
    {
      output: 'agent-evals/*.md (3+)',
      template: 'workflow/evaluation/evals.md',
      phase: 'full',
      note: 'Real incidents preferred',
    },
    {
      output: '.github/workflows/context-validation.yml',
      template: 'workflow/evaluation/ci-validation.md',
      phase: 'full',
      note: 'CI validation',
    },
  ];
}

// ---------------------------------------------------------------------------
// Per-agent setup guide ref — one per phase
// ---------------------------------------------------------------------------

/** Map each agent to its dedicated setup guide template */
const SETUP_GUIDE_TEMPLATES: Record<AgentId, string> = {
  claude: 'setup/setup-claude.md',
  codex: 'setup/setup-codex.md',
  gemini: 'setup/setup-gemini.md',
};

/** Return the per-phase setup guide refs for a specific agent */
function getSetupGuideRefs(agentId: AgentId): TemplateRef[] {
  const template = SETUP_GUIDE_TEMPLATES[agentId];
  const name = PROFILES[agentId].name;
  return (['foundation', 'standard', 'full'] as const).map(phase => ({
    output: `(${name} agent-specific setup)`,
    template,
    phase,
    note: `${phase} phase section`,
  }));
}

// ---------------------------------------------------------------------------
// Language → coding-standards mapping
// ---------------------------------------------------------------------------

/** Map from detected language to its coding-standards template (language-only, no framework detection) */
const LANGUAGE_TEMPLATE_MAP: Record<string, string> = {
  typescript: 'workflow/coding-standards/backend/typescript-node.md',
  javascript: 'workflow/coding-standards/backend/typescript-node.md',
  php: 'workflow/coding-standards/backend/php.md',
  python: 'workflow/coding-standards/backend/python-django.md',
  go: 'workflow/coding-standards/backend/go.md',
  rust: 'workflow/coding-standards/backend/rust.md',
  bash: 'workflow/coding-standards/backend/bash.md',
};

/** Languages that indicate a web project (gets web-common.md security template) */
const WEB_LANGUAGES = new Set(['typescript', 'javascript', 'php', 'python', 'go', 'rust']);

/**
 * Map detected languages to coding-standards template refs.
 * Only includes templates that exist on disk.
 */
export function mapLanguagesToTemplates(languages: string[]): TemplateRef[] {
  const refs: TemplateRef[] = [];
  /** Track which templates we've added to avoid duplicates (e.g., typescript + javascript both map to the same file) */
  const seen = new Set<string>();
  let hasWeb = false;

  for (const lang of languages) {
    const template = LANGUAGE_TEMPLATE_MAP[lang];
    if (template && !seen.has(template) && templateExists(template)) {
      seen.add(template);
      refs.push({
        output: `ai/instructions/${template.split('/').pop()!.replace('.md', '')}.md`,
        template,
        phase: 'standard',
        note: `Detected: ${lang}`,
      });
    }
    if (WEB_LANGUAGES.has(lang)) hasWeb = true;
  }

  // Add web-common security template for any web project
  const webCommon = 'workflow/coding-standards/security/web-common.md';
  if (hasWeb && templateExists(webCommon)) {
    refs.push({
      output: 'ai/instructions/web-common.md',
      template: webCommon,
      phase: 'standard',
      note: 'Web security baseline',
    });
  }

  // Add frontend.md for TS/JS projects (scanner check 2.6.7a)
  const hasFrontendLang = languages.some(l => l === 'typescript' || l === 'javascript');
  const frontendTemplate = 'workflow/coding-standards/frontend/typescript.md';
  if (hasFrontendLang && templateExists(frontendTemplate)) {
    refs.push({
      output: 'ai/instructions/frontend.md',
      template: frontendTemplate,
      phase: 'standard',
      note: 'Detected: typescript/javascript',
    });
  }

  // Add backend.md for backend-language projects (scanner check 2.6.7b)
  const backendLangs = ['go', 'python', 'rust', 'java', 'php', 'ruby', 'csharp'];
  const detectedBackend = languages.find(l => backendLangs.includes(l));
  if (detectedBackend) {
    const backendTemplate = LANGUAGE_TEMPLATE_MAP[detectedBackend];
    if (backendTemplate && templateExists(backendTemplate)) {
      refs.push({
        output: 'ai/instructions/backend.md',
        template: backendTemplate,
        phase: 'standard',
        note: `Detected: ${detectedBackend}`,
      });
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the complete template ref table for one agent.
 * Combines foundation (agent-branched hooks), standard, and full refs.
 */
export function getAgentTemplates(agentId: AgentId): TemplateRef[] {
  return [
    ...getFoundationRefs(agentId),
    ...getStandardRefs(agentId),
    ...getFullRefs(agentId),
    ...getSetupGuideRefs(agentId),
  ];
}

/**
 * Validate that all template source files exist on disk.
 * Returns an array of template paths that could not be found.
 */
export function validateTemplateRefs(agentId: AgentId): string[] {
  /** Unique set of template paths to check (avoids duplicate validation) */
  const seen = new Set<string>();
  /** Template paths that do not resolve to an existing file */
  const missing: string[] = [];

  for (const ref of getAgentTemplates(agentId)) {
    if (seen.has(ref.template)) continue;
    seen.add(ref.template);
    if (!templateExists(ref.template)) {
      missing.push(ref.template);
    }
  }

  return missing;
}
