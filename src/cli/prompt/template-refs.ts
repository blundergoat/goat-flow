import type { AgentId, ProjectSignals } from '../types.js';
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
// Foundation refs - agent-branched hooks + shared instruction/settings
// ---------------------------------------------------------------------------

/** Return foundation-phase template refs for a specific agent */
function getFoundationRefs(agentId: AgentId): TemplateRef[] {
  const p = PROFILES[agentId];

  /** Shared refs that every agent gets at the foundation tier */
  const shared: TemplateRef[] = [
    {
      output: '.goat-flow/config.yaml',
      template: 'setup/shared/execution-loop.md',
      phase: 'foundation',
      note: 'Create config file with default paths and detected agents',
    },
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
// Standard refs - shared across all agents
// ---------------------------------------------------------------------------

/** Ordered list of the 6 goat-flow skill template sources (5 + dispatcher) */
const SKILL_TEMPLATES = [
  'workflow/skills/goat.md',
  'workflow/skills/goat-debug.md',
  'workflow/skills/goat-plan.md',
  'workflow/skills/goat-review.md',
  'workflow/skills/goat-security.md',
  'workflow/skills/goat-test.md',
] as const;

/** Return standard-phase template refs for a specific agent */
function getStandardRefs(agentId: AgentId): TemplateRef[] {
  const p = PROFILES[agentId];

  /** Skill file refs - one per skill template, output into the agent's skills dir */
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
      output: 'docs/footguns/',
      template: 'setup/shared/docs-seed.md',
      phase: 'standard',
      note: 'Real incidents only',
    },
    {
      output: 'ai/lessons/',
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
      note: 'Routing map for ai/coding-standards/',
    },
    {
      output: 'ai/coding-standards/conventions.md',
      template: 'workflow/coding-standards/conventions.md',
      phase: 'standard',
      note: 'Project-wide conventions',
    },
    {
      output: 'ai/coding-standards/code-review.md',
      template: 'workflow/coding-standards/code-review.md',
      phase: 'standard',
      note: 'Review standards',
    },
    {
      output: 'ai/coding-standards/git-commit.md',
      template: 'workflow/coding-standards/git-commit.md',
      phase: 'standard',
      note: 'Commit conventions',
    },
  ];

  return [...skillRefs, ...sharedRefs, ...roleRefs];
}

// ---------------------------------------------------------------------------
// Full refs - shared across all agents
// ---------------------------------------------------------------------------

/** Return full-phase template refs for a specific agent */
function getFullRefs(_agentId: AgentId): TemplateRef[] {
  return [
    {
      output: 'ai/evals/*.md (3+)',
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
// Per-agent setup guide ref - one per phase
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
  // Generic php.md does not exist — PHP routes via framework-specific templates (laravel, symfony)
  python: 'workflow/coding-standards/backend/python.md',
  go: 'workflow/coding-standards/backend/go.md',
  rust: 'workflow/coding-standards/backend/rust.md',
  bash: 'workflow/coding-standards/backend/bash.md',
  // Framework-specific overrides (preferred over generic language template)
  laravel: 'workflow/coding-standards/backend/php-laravel.md',
  symfony: 'workflow/coding-standards/backend/php-symfony.md',
  django: 'workflow/coding-standards/backend/python-django.md',
  fastapi: 'workflow/coding-standards/backend/python-fastapi.md',
  express: 'workflow/coding-standards/backend/typescript-node.md',
};

/** Languages that indicate a web project (gets web-common.md security template) */
const WEB_LANGUAGES = new Set(['typescript', 'javascript', 'php', 'python', 'go', 'rust']);

/** Map from detected frontend framework/template engine to its coding-standards template */
const FRONTEND_TEMPLATE_MAP: Record<string, string> = {
  react: 'workflow/coding-standards/frontend/react.md',
  vue: 'workflow/coding-standards/frontend/vue.md',
  angular: 'workflow/coding-standards/frontend/angular.md',
};

/** Map from detected framework/language to security framework-specific template */
const SECURITY_FRAMEWORK_MAP: Record<string, string> = {
  django: 'workflow/coding-standards/security/framework-specific/django.md',
  laravel: 'workflow/coding-standards/security/framework-specific/laravel.md',
  symfony: 'workflow/coding-standards/security/framework-specific/symfony.md',
  express: 'workflow/coding-standards/security/framework-specific/express-node.md',
  go: 'workflow/coding-standards/security/framework-specific/go.md',
};

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
        output: `ai/coding-standards/${template.split('/').pop()!.replace('.md', '')}.md`,
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
      output: 'ai/coding-standards/web-common.md',
      template: webCommon,
      phase: 'standard',
      note: 'Web security baseline',
    });
  }

  // Add frontend.md based on detected frontend framework (scanner check 2.6.7a)
  // Priority: framework-specific template > typescript.md fallback for TS/JS projects
  let frontendMatched = false;
  for (const lang of languages) {
    const fTemplate = FRONTEND_TEMPLATE_MAP[lang];
    if (fTemplate && !frontendMatched && templateExists(fTemplate)) {
      refs.push({
        output: 'ai/coding-standards/frontend.md',
        template: fTemplate,
        phase: 'standard',
        note: `Detected: ${lang}`,
      });
      frontendMatched = true;
      break;
    }
  }
  // Fallback: TS/JS without a detected framework → typescript.md
  if (!frontendMatched) {
    const hasFrontendLang = languages.some(l => l === 'typescript' || l === 'javascript');
    const fallbackTemplate = 'workflow/coding-standards/frontend/typescript.md';
    if (hasFrontendLang && templateExists(fallbackTemplate)) {
      refs.push({
        output: 'ai/coding-standards/frontend.md',
        template: fallbackTemplate,
        phase: 'standard',
        note: 'Detected: typescript/javascript (no framework detected)',
      });
    }
  }

  // Add backend.md for backend-language projects (scanner check 2.6.7b)
  // Framework-specific takes priority over generic language
  const frameworkBackendLangs = ['laravel', 'symfony', 'django', 'fastapi', 'express'];
  const backendLangs = ['go', 'python', 'rust', 'php'];
  const detectedFramework = languages.find(l => frameworkBackendLangs.includes(l));
  const detectedBackend = detectedFramework ?? languages.find(l => backendLangs.includes(l));
  if (detectedBackend) {
    const backendTemplate = LANGUAGE_TEMPLATE_MAP[detectedBackend];
    if (backendTemplate && templateExists(backendTemplate)) {
      refs.push({
        output: 'ai/coding-standards/backend.md',
        template: backendTemplate,
        phase: 'standard',
        note: `Detected: ${detectedBackend}`,
      });
    }
  }

  // Add security framework-specific templates for detected frameworks/languages
  for (const lang of languages) {
    const secTemplate = SECURITY_FRAMEWORK_MAP[lang];
    if (secTemplate && !seen.has(secTemplate) && templateExists(secTemplate)) {
      seen.add(secTemplate);
      refs.push({
        output: `ai/coding-standards/security-${lang}.md`,
        template: secTemplate,
        phase: 'standard',
        note: `Security: ${lang}`,
      });
    }
  }

  return refs;
}

/**
 * Map detected project signals to security/compliance template refs.
 * Auto-includes phi-compliance.md when compliance signals detected,
 * and llm-security.md when LLM integration detected.
 */
export function mapSignalsToTemplates(signals: ProjectSignals, languages: string[] = []): TemplateRef[] {
  const refs: TemplateRef[] = [];
  const hasWeb = languages.some(l => WEB_LANGUAGES.has(l));

  // --- Always-included templates ---

  const securityOverview = 'workflow/coding-standards/security.md';
  if (templateExists(securityOverview)) {
    refs.push({
      output: 'ai/coding-standards/security.md',
      template: securityOverview,
      phase: 'standard',
      note: 'Security overview - adapt topics to detected stack',
    });
  }

  const testing = 'workflow/coding-standards/testing.md';
  if (templateExists(testing)) {
    refs.push({
      output: 'ai/coding-standards/testing.md',
      template: testing,
      phase: 'standard',
      note: 'Testing conventions',
    });
  }

  const secretsMgmt = 'workflow/coding-standards/security/secrets-management.md';
  if (templateExists(secretsMgmt)) {
    refs.push({
      output: 'ai/coding-standards/secrets-management.md',
      template: secretsMgmt,
      phase: 'standard',
      note: 'Secrets handling baseline',
    });
  }

  const supplyChain = 'workflow/coding-standards/security/supply-chain.md';
  if (templateExists(supplyChain)) {
    refs.push({
      output: 'ai/coding-standards/supply-chain.md',
      template: supplyChain,
      phase: 'standard',
      note: 'Dependency security',
    });
  }

  // --- Web-project templates ---

  if (hasWeb) {
    const apiAuth = 'workflow/coding-standards/security/api-auth.md';
    if (templateExists(apiAuth)) {
      refs.push({
        output: 'ai/coding-standards/api-auth.md',
        template: apiAuth,
        phase: 'standard',
        note: 'Auth patterns for web projects',
      });
    }

    const fileUpload = 'workflow/coding-standards/security/file-upload.md';
    if (templateExists(fileUpload)) {
      refs.push({
        output: 'ai/coding-standards/file-upload.md',
        template: fileUpload,
        phase: 'standard',
        note: 'Upload security for web projects',
      });
    }

    const sqlInjection = 'workflow/coding-standards/security/sql-injection.md';
    if (templateExists(sqlInjection)) {
      refs.push({
        output: 'ai/coding-standards/sql-injection.md',
        template: sqlInjection,
        phase: 'standard',
        note: 'SQL injection prevention',
      });
    }
  }

  // --- Signal-driven templates ---

  if (signals.deployPlatforms.length > 0) {
    const infra = 'workflow/coding-standards/security/infrastructure.md';
    if (templateExists(infra)) {
      refs.push({
        output: 'ai/coding-standards/infrastructure-security.md',
        template: infra,
        phase: 'standard',
        note: `Deploy platforms: ${signals.deployPlatforms.join(', ')}`,
      });
    }

    if (signals.deployPlatforms.includes('terraform')) {
      const tf = 'workflow/coding-standards/devops/terraform.md';
      if (templateExists(tf)) {
        refs.push({
          output: 'ai/coding-standards/devops-terraform.md',
          template: tf,
          phase: 'standard',
          note: 'Terraform detected',
        });
      }
    }

    // Packer template removed (niche, unmaintained)
  }

  if (signals.complianceSignals) {
    const template = 'workflow/coding-standards/security/phi-compliance.md';
    if (templateExists(template)) {
      refs.push({
        output: 'ai/coding-standards/phi-compliance.md',
        template,
        phase: 'standard',
        note: 'PHI/compliance signals detected',
      });
    }
  }

  if (signals.llmIntegration) {
    const template = 'workflow/coding-standards/security/llm-security.md';
    if (templateExists(template)) {
      refs.push({
        output: 'ai/coding-standards/llm-security.md',
        template,
        phase: 'standard',
        note: 'LLM integration detected',
      });
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Fragment → template mapping (for targeted-fix mode)
// ---------------------------------------------------------------------------

/**
 * Maps create-kind fragment keys to their goat-flow template source.
 * Used by targeted-fix mode to render template references instead of inline skeletons.
 * String value = universal template. Object value = per-agent templates.
 * Keys NOT in this map render inline (fix-kind fragments, inline-only creates).
 */
const FRAGMENT_TEMPLATE_MAP: Record<string, string | Partial<Record<AgentId, string>>> = {
  // File-level creates - skills
  'create-skill-goat': 'workflow/skills/goat.md',
  'create-skill-security': 'workflow/skills/goat-security.md',
  'create-skill-debug': 'workflow/skills/goat-debug.md',
  'create-skill-review': 'workflow/skills/goat-review.md',
  'create-skill-plan': 'workflow/skills/goat-plan.md',
  'create-skill-test': 'workflow/skills/goat-test.md',

  // File-level creates - instruction file and docs
  'create-instruction-file': 'setup/shared/execution-loop.md',
  'create-lessons': 'setup/shared/docs-seed.md',
  'create-footguns': 'setup/shared/docs-seed.md',
  'create-architecture': 'workflow/runtime/architecture.md',
  'create-handoff-template': 'workflow/evaluation/handoff.md',
  'create-evals-dir': 'workflow/evaluation/evals.md',
  'add-evals': 'workflow/evaluation/evals.md',
  'create-ci-workflow': 'workflow/evaluation/ci-validation.md',

  // File-level creates - hooks/enforcement
  'create-deny-script': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'create-stop-lint': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'create-format-hook': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },

  // File-level creates - coding standards
  'create-conventions-instructions': 'workflow/coding-standards/conventions.md',
  'create-code-review-instructions': 'workflow/coding-standards/code-review.md',
  'create-git-commit-instructions': 'workflow/coding-standards/git-commit.md',

  // Section-level creates - execution loop steps (all point to same parent)
  'add-read-step': 'setup/shared/execution-loop.md',
  'add-classify-step': 'setup/shared/execution-loop.md',
  'add-scope-step': 'setup/shared/execution-loop.md',
  'add-act-step': 'setup/shared/execution-loop.md',
  'add-verify-step': 'setup/shared/execution-loop.md',
  'add-log-step': 'setup/shared/execution-loop.md',

  // Section-level creates - autonomy tiers
  'add-autonomy-tiers': 'setup/shared/execution-loop.md',
  'add-never-guards': 'setup/shared/execution-loop.md',
  'add-micro-checklist': 'setup/shared/execution-loop.md',

  // Section-level creates - definition of done
  'add-dod': 'setup/shared/execution-loop.md',
  'add-dod-gates': 'setup/shared/execution-loop.md',
  'add-grep-gate': 'setup/shared/execution-loop.md',
  'add-log-gate': 'setup/shared/execution-loop.md',

  // Fix-kind - skill quality (all templates demonstrate these sections)
  'create-all-skills': 'workflow/skills/goat-debug.md',
  'add-skill-step0': 'workflow/skills/goat-debug.md',
  'add-skill-human-gates': 'workflow/skills/goat-debug.md',
  'add-skill-constraints': 'workflow/skills/goat-debug.md',
  'add-skill-conversational': 'workflow/skills/goat-debug.md',
  'add-skill-chaining': 'workflow/skills/goat-debug.md',
  'add-skill-choices': 'workflow/skills/goat-debug.md',
  'add-skill-phases': 'workflow/skills/goat-debug.md',
  'add-skill-output-format': 'workflow/skills/goat-debug.md',

  // Fix-kind - hook hardening (agent-specific)
  'add-deny-blocks': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'fix-deny-json-parsing': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'fix-deny-chaining': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'fix-deny-rm-rf': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'fix-deny-force-push': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'fix-deny-chmod': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'fix-deny-cloud-destructive': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'fix-read-deny-secrets': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'add-stop-lint-validation': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'add-compaction-hook': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },

  // Fix-kind - learning loop
  'seed-lessons': 'setup/shared/docs-seed.md',
  'seed-lessons-minimum': 'setup/shared/docs-seed.md',
  'add-footgun-evidence': 'setup/shared/docs-seed.md',

  // File-level creates - security, testing, devops, domain
  'create-security-instructions': 'workflow/coding-standards/security.md',
  'create-testing-instructions': 'workflow/coding-standards/testing.md',
  'create-copilot-bridge': 'workflow/coding-standards/copilot-bridge.md',
  'create-domain-instructions': 'workflow/coding-standards/domain-instructions.md',
  'create-security-auth': 'workflow/coding-standards/security/api-auth.md',
  'create-security-upload': 'workflow/coding-standards/security/file-upload.md',
  'create-security-infra': 'workflow/coding-standards/security/infrastructure.md',
  'create-security-secrets': 'workflow/coding-standards/security/secrets-management.md',
  'create-security-sql': 'workflow/coding-standards/security/sql-injection.md',
  'create-security-supply-chain': 'workflow/coding-standards/security/supply-chain.md',
  'create-security-django': 'workflow/coding-standards/security/framework-specific/django.md',
  'create-security-laravel': 'workflow/coding-standards/security/framework-specific/laravel.md',
  'create-security-symfony': 'workflow/coding-standards/security/framework-specific/symfony.md',
  'create-security-express': 'workflow/coding-standards/security/framework-specific/express-node.md',
  'create-security-go': 'workflow/coding-standards/security/framework-specific/go.md',
  'create-devops-terraform': 'workflow/coding-standards/devops/terraform.md',

  // Fix-kind - local instructions
  'improve-conventions-instructions': 'workflow/coding-standards/conventions.md',
  'create-instructions-dir': 'setup/shared/docs-seed.md',
  'create-instructions-router': 'setup/shared/docs-seed.md',
  'create-frontend-instructions': 'workflow/coding-standards/frontend/typescript.md',
  'create-github-git-commit': 'workflow/coding-standards/git-commit.md',

  // Fix-kind - foundation (instruction file sections)
  'add-version-header': 'setup/shared/execution-loop.md',
  'add-essential-commands': 'setup/shared/execution-loop.md',
  'add-concrete-examples': 'setup/shared/execution-loop.md',
  'add-classify-budgets': 'setup/shared/execution-loop.md',
  'add-router': 'setup/shared/execution-loop.md',
  'route-skills': 'setup/shared/execution-loop.md',
  'add-deny-mechanism': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'block-git-commit': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  'block-git-push': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'setup/setup-codex.md',
    gemini: 'setup/setup-gemini.md',
  },
  // add-rfc2119 intentionally excluded - inline instruction is self-contained
  'fix-execution-loop-sync': 'setup/shared/execution-loop.md',

  // Fix-kind - evals and CI
  'add-replay-prompts': 'workflow/evaluation/evals.md',
  'add-origin-labels': 'workflow/evaluation/evals.md',
  'add-eval-skill-coverage': 'workflow/evaluation/evals.md',
  'ci-check-lines': 'workflow/evaluation/ci-validation.md',
  'ci-check-router': 'workflow/evaluation/ci-validation.md',
  'ci-check-skills': 'workflow/evaluation/ci-validation.md',
  'ci-trigger-prs': 'workflow/evaluation/ci-validation.md',

  // Fix-kind - anti-patterns (ones with clear template sources)
  'ap-add-footgun-evidence': 'setup/shared/docs-seed.md',
  'ap-fix-empty-scaffolding': 'setup/shared/docs-seed.md',
  'ap-fix-dangling-skill-refs': 'workflow/skills/goat-debug.md',
  'ap-fix-adapt-comments': 'workflow/skills/goat-debug.md',
  'ap-fix-hook-paths': 'workflow/runtime/enforcement.md',
};

/**
 * Look up the template for a fragment key, resolving per-agent entries.
 * Returns the relative template path, or null if not in the map.
 */
export function getFragmentTemplate(key: string, agentId: AgentId): string | null {
  const entry = FRAGMENT_TEMPLATE_MAP[key];
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return entry[agentId] ?? null;
}

/**
 * Get a language-specific template override for a fragment key.
 * Returns the relative template path if the project's detected languages
 * provide a more specific template than the generic one in FRAGMENT_TEMPLATE_MAP.
 */
export function getLanguageTemplate(key: string, languages: string[]): string | null {
  // Only override coding-standards fragment keys
  if (key === 'create-backend-instructions') {
    // Framework-specific takes priority over generic language
    const frameworkLangs = ['laravel', 'symfony', 'django', 'fastapi', 'express'];
    const detectedFramework = languages.find(l => frameworkLangs.includes(l));
    if (detectedFramework) return LANGUAGE_TEMPLATE_MAP[detectedFramework] ?? null;
    const backendLangs = ['go', 'python', 'rust', 'php'];
    const detected = languages.find(l => backendLangs.includes(l));
    if (detected) return LANGUAGE_TEMPLATE_MAP[detected] ?? null;
  }
  if (key === 'create-frontend-instructions') {
    if (languages.some(l => l === 'typescript' || l === 'javascript')) {
      return 'workflow/coding-standards/frontend/typescript.md';
    }
  }
  if (key === 'create-conventions-instructions' || key === 'improve-conventions-instructions') {
    // Conventions stays generic - it covers cross-language patterns
    return null;
  }
  return null;
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
