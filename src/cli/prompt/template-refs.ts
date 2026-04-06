/**
 * Maps languages, signals, fragments, and agents to concrete template files.
 * Setup generation relies on this module as the canonical routing table for repo-owned templates.
 */
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
      template: 'workflow/setup/shared/execution-loop.md',
      phase: 'foundation',
      note: 'Create config file with default paths and detected agents',
    },
    {
      output: p.instructionFile,
      template: 'workflow/setup/shared/execution-loop.md',
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
          template: 'workflow/setup/setup-codex.md',
          phase: 'foundation',
          note: 'Section: hooks + execpolicy (line 111+)',
        },
        {
          output: '.codex/rules/deny-dangerous.star',
          template: 'workflow/setup/setup-codex.md',
          phase: 'foundation',
          note: 'Starlark execpolicy (line 120+)',
        },
        {
          output: 'scripts/stop-lint.sh',
          template: 'workflow/setup/setup-codex.md',
          phase: 'foundation',
          note: 'Section: verification scripts (line 131+)',
        },
      ];

    case 'gemini':
      return [
        {
          output: '.gemini/settings.json',
          template: 'workflow/setup/setup-gemini.md',
          phase: 'foundation',
          note: 'Use detected stack commands',
        },
        {
          output: '.gemini/hooks/deny-dangerous.sh',
          template: 'workflow/setup/setup-gemini.md',
          phase: 'foundation',
          note: 'Gemini BeforeTool hook',
        },
        {
          output: '.gemini/hooks/stop-lint.sh',
          template: 'workflow/setup/setup-gemini.md',
          phase: 'foundation',
          note: 'Gemini AfterAgent hook',
        },
        {
          output: '.gemini/hooks/format-file.sh',
          template: 'workflow/setup/setup-gemini.md',
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
  const skillRefs: TemplateRef[] = SKILL_TEMPLATES.map((tmpl) => {
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
      output: 'ai-docs/footguns/',
      template: 'workflow/setup/shared/docs-seed.md',
      phase: 'standard',
      note: 'Real incidents only',
    },
    {
      output: 'ai-docs/lessons/',
      template: 'workflow/setup/shared/docs-seed.md',
      phase: 'standard',
      note: 'Seed from git history',
    },
    {
      output: 'ai-docs/architecture.md',
      template: 'workflow/runtime/architecture.md',
      phase: 'standard',
      note: 'Under 100 lines',
    },
  ];

  /** Role-specific coding-standards refs that the scanner checks for */
  const roleRefs: TemplateRef[] = [
    {
      output: 'ai-docs/README.md',
      template: 'workflow/setup/shared/docs-seed.md',
      phase: 'standard',
      note: 'Routing map for ai-docs/coding-standards/',
    },
    {
      output: 'ai-docs/coding-standards/conventions.md',
      template: 'workflow/coding-standards/conventions.md',
      phase: 'standard',
      note: 'Project-wide conventions',
    },
    {
      output: 'ai-docs/coding-standards/code-review.md',
      template: 'workflow/coding-standards/code-review.md',
      phase: 'standard',
      note: 'Review standards',
    },
    {
      output: 'ai-docs/coding-standards/git-commit.md',
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
      output: 'ai-docs/evals/*.md (3+)',
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
  claude: 'workflow/setup/setup-claude.md',
  codex: 'workflow/setup/setup-codex.md',
  gemini: 'workflow/setup/setup-gemini.md',
};

/** Return the per-phase setup guide refs for a specific agent */
function getSetupGuideRefs(agentId: AgentId): TemplateRef[] {
  const template = SETUP_GUIDE_TEMPLATES[agentId];
  const name = PROFILES[agentId].name;
  return (['foundation', 'standard', 'full'] as const).map((phase) => ({
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
  // Generic php.md does not exist - PHP routes via framework-specific templates (laravel, symfony)
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
const WEB_LANGUAGES = new Set([
  'typescript',
  'javascript',
  'php',
  'python',
  'go',
  'rust',
]);

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
  express:
    'workflow/coding-standards/security/framework-specific/express-node.md',
  go: 'workflow/coding-standards/security/framework-specific/go.md',
};

/** Specification for a signal-driven template reference. */
interface SignalTemplateRefSpec {
  output: string;
  template: string;
  note: string;
}

/** Signal-driven templates included for every project regardless of stack. */
const ALWAYS_SIGNAL_TEMPLATES: SignalTemplateRefSpec[] = [
  {
    output: 'ai-docs/coding-standards/security.md',
    template: 'workflow/coding-standards/security.md',
    note: 'Security overview - adapt topics to detected stack',
  },
  {
    output: 'ai-docs/coding-standards/testing.md',
    template: 'workflow/coding-standards/testing.md',
    note: 'Testing conventions',
  },
  {
    output: 'ai-docs/coding-standards/secrets-management.md',
    template: 'workflow/coding-standards/security/secrets-management.md',
    note: 'Secrets handling baseline',
  },
  {
    output: 'ai-docs/coding-standards/supply-chain.md',
    template: 'workflow/coding-standards/security/supply-chain.md',
    note: 'Dependency security',
  },
] as const;

/** Signal-driven templates added only for web-language projects. */
const WEB_SIGNAL_TEMPLATES: SignalTemplateRefSpec[] = [
  {
    output: 'ai-docs/coding-standards/api-auth.md',
    template: 'workflow/coding-standards/security/api-auth.md',
    note: 'Auth patterns for web projects',
  },
  {
    output: 'ai-docs/coding-standards/file-upload.md',
    template: 'workflow/coding-standards/security/file-upload.md',
    note: 'Upload security for web projects',
  },
  {
    output: 'ai-docs/coding-standards/sql-injection.md',
    template: 'workflow/coding-standards/security/sql-injection.md',
    note: 'SQL injection prevention',
  },
] as const;

/** Backend languages that route through framework-specific templates. */
const FRAMEWORK_BACKEND_LANGS = [
  'laravel',
  'symfony',
  'django',
  'fastapi',
  'express',
] as const;
/** Generic backend languages without framework-specific detection. */
const GENERIC_BACKEND_LANGS = ['go', 'python', 'rust', 'php'] as const;
/** Fallback frontend template when no specific framework is detected. */
const FRONTEND_FALLBACK_TEMPLATE =
  'workflow/coding-standards/frontend/typescript.md';

/** Build a standard-phase template reference entry. */
function buildStandardTemplateRef(
  output: string,
  template: string,
  note: string,
): TemplateRef {
  return { output, template, phase: 'standard', note };
}

/** Add a template ref only when the source template exists on disk. */
function pushIfTemplateExists(
  refs: TemplateRef[],
  output: string,
  template: string,
  note: string,
): void {
  if (!templateExists(template)) return;
  refs.push(buildStandardTemplateRef(output, template, note));
}

/** Add a template ref only once, skipping duplicates and missing templates. */
function pushIfUnseenTemplate(
  refs: TemplateRef[],
  seen: Set<string>,
  output: string,
  template: string,
  note: string,
): void {
  if (seen.has(template) || !templateExists(template)) return;
  seen.add(template);
  refs.push(buildStandardTemplateRef(output, template, note));
}

/** Return mapped template. */
function getMappedTemplate(
  map: Record<string, string>,
  key: string,
): string | null {
  const template = map[key];
  return Object.hasOwn(map, key) && template !== undefined ? template : null;
}

/** Return template basename. */
function getTemplateBasename(template: string): string {
  const parts = template.split('/');
  const filename = parts[parts.length - 1] ?? template;
  return filename.replace('.md', '');
}

/** Find detected language. */
function findDetectedLanguage(
  languages: string[],
  candidates: readonly string[],
): string | null {
  return languages.find((language) => candidates.includes(language)) ?? null;
}

/** Add language-specific coding-standards templates for detected languages. */
function addLanguageTemplateRefs(
  refs: TemplateRef[],
  languages: string[],
  seen: Set<string>,
): void {
  for (const language of languages) {
    const template = getMappedTemplate(LANGUAGE_TEMPLATE_MAP, language);
    if (!template) continue;
    pushIfUnseenTemplate(
      refs,
      seen,
      `ai-docs/coding-standards/${getTemplateBasename(template)}.md`,
      template,
      `Detected: ${language}`,
    );
  }
}

/** Add the shared web-security template when the project has web languages. */
function addWebCommonTemplate(refs: TemplateRef[], languages: string[]): void {
  if (!languages.some((language) => WEB_LANGUAGES.has(language))) return;
  pushIfTemplateExists(
    refs,
    'ai-docs/coding-standards/web-common.md',
    'workflow/coding-standards/security/web-common.md',
    'Web security baseline',
  );
}

/** Add the primary frontend template for the first detected frontend stack. */
function addFrontendTemplateRef(
  refs: TemplateRef[],
  languages: string[],
): void {
  for (const language of languages) {
    const template = getMappedTemplate(FRONTEND_TEMPLATE_MAP, language);
    if (!template || !templateExists(template)) continue;
    refs.push(
      buildStandardTemplateRef(
        'ai-docs/coding-standards/frontend.md',
        template,
        `Detected: ${language}`,
      ),
    );
    return;
  }

  if (
    languages.some(
      (language) => language === 'typescript' || language === 'javascript',
    )
  ) {
    pushIfTemplateExists(
      refs,
      'ai-docs/coding-standards/frontend.md',
      FRONTEND_FALLBACK_TEMPLATE,
      'Detected: typescript/javascript (no framework detected)',
    );
  }
}

/** Add the primary backend template for the detected server-side stack. */
function addBackendTemplateRef(refs: TemplateRef[], languages: string[]): void {
  const detectedBackend =
    findDetectedLanguage(languages, FRAMEWORK_BACKEND_LANGS) ??
    findDetectedLanguage(languages, GENERIC_BACKEND_LANGS);
  if (!detectedBackend) return;

  const template = getMappedTemplate(LANGUAGE_TEMPLATE_MAP, detectedBackend);
  if (!template) return;
  pushIfTemplateExists(
    refs,
    'ai-docs/coding-standards/backend.md',
    template,
    `Detected: ${detectedBackend}`,
  );
}

/** Add framework-specific security templates for detected backend stacks. */
function addSecurityFrameworkRefs(
  refs: TemplateRef[],
  languages: string[],
  seen: Set<string>,
): void {
  for (const language of languages) {
    const template = getMappedTemplate(SECURITY_FRAMEWORK_MAP, language);
    if (!template) continue;
    pushIfUnseenTemplate(
      refs,
      seen,
      `ai-docs/coding-standards/security-${language}.md`,
      template,
      `Security: ${language}`,
    );
  }
}

/**
 * Map detected languages to coding-standards template refs.
 * Only includes templates that exist on disk.
 */
export function mapLanguagesToTemplates(languages: string[]): TemplateRef[] {
  const refs: TemplateRef[] = [];
  const seen = new Set<string>();
  addLanguageTemplateRefs(refs, languages, seen);
  addWebCommonTemplate(refs, languages);
  addFrontendTemplateRef(refs, languages);
  addBackendTemplateRef(refs, languages);
  addSecurityFrameworkRefs(refs, languages, seen);

  return refs;
}

/** Add a group of signal-driven templates when their source files exist. */
function addSignalTemplateGroup(
  refs: TemplateRef[],
  specs: readonly SignalTemplateRefSpec[],
): void {
  for (const spec of specs) {
    pushIfTemplateExists(refs, spec.output, spec.template, spec.note);
  }
}

/** Add infrastructure and Terraform templates for detected deploy signals. */
function addDeploySignalTemplates(
  refs: TemplateRef[],
  signals: ProjectSignals,
): void {
  if (signals.deployPlatforms.length === 0) return;
  pushIfTemplateExists(
    refs,
    'ai-docs/coding-standards/infrastructure-security.md',
    'workflow/coding-standards/security/infrastructure.md',
    `Deploy platforms: ${signals.deployPlatforms.join(', ')}`,
  );

  if (signals.deployPlatforms.includes('terraform')) {
    pushIfTemplateExists(
      refs,
      'ai-docs/coding-standards/devops-terraform.md',
      'workflow/coding-standards/devops/terraform.md',
      'Terraform detected',
    );
  }
}

/** Add the PHI/compliance template when compliance signals are detected. */
function addComplianceSignalTemplate(
  refs: TemplateRef[],
  signals: ProjectSignals,
): void {
  if (!signals.complianceSignals) return;
  pushIfTemplateExists(
    refs,
    'ai-docs/coding-standards/phi-compliance.md',
    'workflow/coding-standards/security/phi-compliance.md',
    'PHI/compliance signals detected',
  );
}

/** Add the LLM-security template when LLM integration signals are detected. */
function addLlmSignalTemplate(
  refs: TemplateRef[],
  signals: ProjectSignals,
): void {
  if (!signals.llmIntegration) return;
  pushIfTemplateExists(
    refs,
    'ai-docs/coding-standards/llm-security.md',
    'workflow/coding-standards/security/llm-security.md',
    'LLM integration detected',
  );
}

/**
 * Map detected project signals to security/compliance template refs.
 * Auto-includes phi-compliance.md when compliance signals detected,
 * and llm-security.md when LLM integration detected.
 */
export function mapSignalsToTemplates(
  signals: ProjectSignals,
  languages: string[] = [],
): TemplateRef[] {
  const refs: TemplateRef[] = [];
  addSignalTemplateGroup(refs, ALWAYS_SIGNAL_TEMPLATES);
  if (languages.some((language) => WEB_LANGUAGES.has(language))) {
    addSignalTemplateGroup(refs, WEB_SIGNAL_TEMPLATES);
  }
  addDeploySignalTemplates(refs, signals);
  addComplianceSignalTemplate(refs, signals);
  addLlmSignalTemplate(refs, signals);

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
const FRAGMENT_TEMPLATE_MAP: Record<
  string,
  string | Partial<Record<AgentId, string>>
> = {
  // File-level creates - skills
  'create-skill-goat': 'workflow/skills/goat.md',
  'create-skill-security': 'workflow/skills/goat-security.md',
  'create-skill-debug': 'workflow/skills/goat-debug.md',
  'create-skill-review': 'workflow/skills/goat-review.md',
  'create-skill-plan': 'workflow/skills/goat-plan.md',
  'create-skill-test': 'workflow/skills/goat-test.md',

  // File-level creates - instruction file and docs
  'create-instruction-file': 'workflow/setup/shared/execution-loop.md',
  'create-lessons': 'workflow/setup/shared/docs-seed.md',
  'create-footguns': 'workflow/setup/shared/docs-seed.md',
  'create-architecture': 'workflow/runtime/architecture.md',
  'create-evals-dir': 'workflow/evaluation/evals.md',
  'add-evals': 'workflow/evaluation/evals.md',
  'create-ci-workflow': 'workflow/evaluation/ci-validation.md',

  // File-level creates - hooks/enforcement
  'create-deny-script': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'create-stop-lint': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'create-format-hook': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },

  // File-level creates - coding standards
  'create-conventions-instructions': 'workflow/coding-standards/conventions.md',
  'create-code-review-instructions': 'workflow/coding-standards/code-review.md',
  'create-git-commit-instructions': 'workflow/coding-standards/git-commit.md',

  // Section-level creates - execution loop steps (all point to same parent)
  'add-read-step': 'workflow/setup/shared/execution-loop.md',
  'add-classify-step': 'workflow/setup/shared/execution-loop.md',
  'add-scope-step': 'workflow/setup/shared/execution-loop.md',
  'add-act-step': 'workflow/setup/shared/execution-loop.md',
  'add-verify-step': 'workflow/setup/shared/execution-loop.md',
  'add-log-step': 'workflow/setup/shared/execution-loop.md',

  // Section-level creates - autonomy tiers
  'add-autonomy-tiers': 'workflow/setup/shared/execution-loop.md',
  'add-never-guards': 'workflow/setup/shared/execution-loop.md',
  'add-micro-checklist': 'workflow/setup/shared/execution-loop.md',

  // Section-level creates - definition of done
  'add-dod': 'workflow/setup/shared/execution-loop.md',
  'add-dod-gates': 'workflow/setup/shared/execution-loop.md',
  'add-grep-gate': 'workflow/setup/shared/execution-loop.md',
  'add-log-gate': 'workflow/setup/shared/execution-loop.md',

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
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'fix-deny-json-parsing': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'fix-deny-chaining': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'fix-deny-rm-rf': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'fix-deny-force-push': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'fix-deny-chmod': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'fix-deny-pipe-to-shell': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'fix-read-deny-secrets': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'add-stop-lint-validation': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'add-compaction-hook': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },

  // Fix-kind - learning loop
  'seed-lessons': 'workflow/setup/shared/docs-seed.md',
  'seed-lessons-minimum': 'workflow/setup/shared/docs-seed.md',
  'add-footgun-evidence': 'workflow/setup/shared/docs-seed.md',

  // File-level creates - security, testing, devops, domain
  'create-security-instructions': 'workflow/coding-standards/security.md',
  'create-testing-instructions': 'workflow/coding-standards/testing.md',
  'create-copilot-bridge': 'workflow/coding-standards/copilot-bridge.md',
  'create-domain-instructions':
    'workflow/coding-standards/domain-instructions.md',
  'create-security-auth': 'workflow/coding-standards/security/api-auth.md',
  'create-security-upload': 'workflow/coding-standards/security/file-upload.md',
  'create-security-infra':
    'workflow/coding-standards/security/infrastructure.md',
  'create-security-secrets':
    'workflow/coding-standards/security/secrets-management.md',
  'create-security-sql': 'workflow/coding-standards/security/sql-injection.md',
  'create-security-supply-chain':
    'workflow/coding-standards/security/supply-chain.md',
  'create-security-django':
    'workflow/coding-standards/security/framework-specific/django.md',
  'create-security-laravel':
    'workflow/coding-standards/security/framework-specific/laravel.md',
  'create-security-symfony':
    'workflow/coding-standards/security/framework-specific/symfony.md',
  'create-security-express':
    'workflow/coding-standards/security/framework-specific/express-node.md',
  'create-security-go':
    'workflow/coding-standards/security/framework-specific/go.md',
  'create-devops-terraform': 'workflow/coding-standards/devops/terraform.md',

  // Fix-kind - local instructions
  'improve-conventions-instructions':
    'workflow/coding-standards/conventions.md',
  'create-instructions-dir': 'workflow/setup/shared/docs-seed.md',
  'create-instructions-router': 'workflow/setup/shared/docs-seed.md',
  'create-frontend-instructions':
    'workflow/coding-standards/frontend/typescript.md',
  'create-github-git-commit': 'workflow/coding-standards/git-commit.md',

  // Fix-kind - foundation (instruction file sections)
  'add-version-header': 'workflow/setup/shared/execution-loop.md',
  'add-essential-commands': 'workflow/setup/shared/execution-loop.md',
  'add-concrete-examples': 'workflow/setup/shared/execution-loop.md',
  'add-classify-budgets': 'workflow/setup/shared/execution-loop.md',
  'add-router': 'workflow/setup/shared/execution-loop.md',
  'route-skills': 'workflow/setup/shared/execution-loop.md',
  'add-deny-mechanism': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'block-git-commit': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  'block-git-push': {
    claude: 'workflow/runtime/enforcement.md',
    codex: 'workflow/setup/setup-codex.md',
    gemini: 'workflow/setup/setup-gemini.md',
  },
  // add-rfc2119 intentionally excluded - inline instruction is self-contained
  'fix-execution-loop-sync': 'workflow/setup/shared/execution-loop.md',

  // Fix-kind - evals and CI
  'add-replay-prompts': 'workflow/evaluation/evals.md',
  'add-origin-labels': 'workflow/evaluation/evals.md',
  'add-eval-skill-coverage': 'workflow/evaluation/evals.md',
  'ci-check-lines': 'workflow/evaluation/ci-validation.md',
  'ci-check-router': 'workflow/evaluation/ci-validation.md',
  'ci-check-skills': 'workflow/evaluation/ci-validation.md',
  'ci-trigger-prs': 'workflow/evaluation/ci-validation.md',

  // Fix-kind - anti-patterns (ones with clear template sources)
  'ap-add-footgun-evidence': 'workflow/setup/shared/docs-seed.md',
  'ap-fix-empty-scaffolding': 'workflow/setup/shared/docs-seed.md',
  'ap-fix-duplicate-learning-loop-surfaces': 'workflow/setup/shared/docs-seed.md',
  'ap-fix-dangling-skill-refs': 'workflow/skills/goat-debug.md',
  'ap-fix-adapt-comments': 'workflow/skills/goat-debug.md',
  'ap-fix-hook-paths': 'workflow/runtime/enforcement.md',
};

/**
 * Look up the template for a fragment key, resolving per-agent entries.
 * Returns the relative template path, or null if not in the map.
 */
export function getFragmentTemplate(
  key: string,
  agentId: AgentId,
): string | null {
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
export function getLanguageTemplate(
  key: string,
  languages: string[],
): string | null {
  // Only override coding-standards fragment keys
  if (key === 'create-backend-instructions') {
    // Framework-specific takes priority over generic language
    const frameworkLangs = [
      'laravel',
      'symfony',
      'django',
      'fastapi',
      'express',
    ];
    const detectedFramework = languages.find((l) => frameworkLangs.includes(l));
    if (detectedFramework)
      return LANGUAGE_TEMPLATE_MAP[detectedFramework] ?? null;
    const backendLangs = ['go', 'python', 'rust', 'php'];
    const detected = languages.find((l) => backendLangs.includes(l));
    if (detected) return LANGUAGE_TEMPLATE_MAP[detected] ?? null;
  }
  if (key === 'create-frontend-instructions') {
    if (languages.some((l) => l === 'typescript' || l === 'javascript')) {
      return 'workflow/coding-standards/frontend/typescript.md';
    }
  }
  if (
    key === 'create-conventions-instructions' ||
    key === 'improve-conventions-instructions'
  ) {
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
