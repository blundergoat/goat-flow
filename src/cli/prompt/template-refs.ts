/**
 * Maps languages, signals, fragments, and agents to concrete template files.
 * Setup generation relies on this module as the canonical routing table for repo-owned templates.
 */
import type { AgentId, ProjectSignals } from "../types.js";
import { PROFILES } from "../detect/agents.js";
import { templateExists } from "../paths.js";

/** Maps a target output file to its goat-flow template source */
export interface TemplateRef {
  /** File path to create in the target project */
  output: string;
  /** Relative path to the goat-flow template that sources this file */
  template: string;
  /** Which setup phase this ref belongs to */
  phase: "foundation" | "standard" | "full";
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
      output: ".goat-flow/config.yaml",
      template: "workflow/setup/reference/execution-loop.md",
      phase: "foundation",
      note: "Create config file with default paths and detected agents",
    },
    {
      output: p.instructionFile,
      template: "workflow/setup/reference/execution-loop.md",
      phase: "foundation",
      note: "Adapt BAD/GOOD examples",
    },
  ];

  /** Agent-specific hook/enforcement refs */
  const hooks: TemplateRef[] = getFoundationHooks(agentId);

  return [...shared, ...hooks];
}

/** Return the agent-specific hook and enforcement refs for the foundation phase */
function getFoundationHooks(agentId: AgentId): TemplateRef[] {
  switch (agentId) {
    case "claude":
      return [
        {
          output: ".claude/settings.json",
          template: "workflow/hooks/README.md",
          phase: "foundation",
          note: "Use detected stack commands",
        },
        {
          output: ".claude/hooks/deny-dangerous.sh",
          template: "workflow/hooks/deny-dangerous.sh",
          phase: "foundation",
          note: "Section: PreToolUse",
        },
        {
          output: ".claude/hooks/stop-lint.sh",
          template: "workflow/hooks/stop-lint.sh",
          phase: "foundation",
          note: "Section: Stop hook",
        },
      ];

    case "codex":
      return [
        {
          output: ".codex/config.toml",
          template: "workflow/setup/agents/codex.md",
          phase: "foundation",
          note: "Section: hooks + execpolicy (line 111+)",
        },
        {
          output: ".codex/rules/deny-dangerous.star",
          template: "workflow/setup/agents/codex.md",
          phase: "foundation",
          note: "Starlark execpolicy (line 120+)",
        },
        {
          output: "scripts/stop-lint.sh",
          template: "workflow/setup/agents/codex.md",
          phase: "foundation",
          note: "Section: verification scripts (line 131+)",
        },
      ];

    case "gemini":
      return [
        {
          output: ".gemini/settings.json",
          template: "workflow/setup/agents/gemini.md",
          phase: "foundation",
          note: "Use detected stack commands",
        },
        {
          output: ".gemini/hooks/deny-dangerous.sh",
          template: "workflow/setup/agents/gemini.md",
          phase: "foundation",
          note: "Gemini BeforeTool hook",
        },
        {
          output: ".gemini/hooks/stop-lint.sh",
          template: "workflow/setup/agents/gemini.md",
          phase: "foundation",
          note: "Gemini AfterAgent hook",
        },
      ];
  }
}

// ---------------------------------------------------------------------------
// Standard refs - shared across all agents
// ---------------------------------------------------------------------------

/** Ordered list of the 6 goat-flow skill template sources (5 + dispatcher) */
const SKILL_TEMPLATES = [
  "workflow/skills/goat.md",
  "workflow/skills/goat-debug.md",
  "workflow/skills/goat-plan.md",
  "workflow/skills/goat-review.md",
  "workflow/skills/goat-security.md",
  "workflow/skills/goat-test.md",
] as const;

/** Return standard-phase template refs for a specific agent */
function getStandardRefs(agentId: AgentId): TemplateRef[] {
  const p = PROFILES[agentId];

  /** Skill file refs - one per skill template, output into the agent's skills dir */
  const skillRefs: TemplateRef[] = SKILL_TEMPLATES.map((tmpl) => {
    /** Skill name extracted from the template filename (e.g., "goat-commit") */
    const skillName = tmpl.replace("workflow/skills/", "").replace(".md", "");
    return {
      output: `${p.skillsDir}/${skillName}/SKILL.md`,
      template: tmpl,
      phase: "standard" as const,
      note: "One template per skill",
    };
  });

  /** Shared documentation and workflow refs for the standard phase */
  const sharedRefs: TemplateRef[] = [
    {
      output: ".goat-flow/footguns/",
      template: "workflow/setup/05-customise-to-project.md",
      phase: "standard",
      note: "Real incidents only",
    },
    {
      output: ".goat-flow/lessons/",
      template: "workflow/setup/05-customise-to-project.md",
      phase: "standard",
      note: "Seed from git history",
    },
    {
      output: ".goat-flow/architecture.md",
      template: "workflow/setup/04-architecture-code-map.md",
      phase: "standard",
      note: "Under 100 lines",
    },
  ];

  return [...skillRefs, ...sharedRefs];
}

// ---------------------------------------------------------------------------
// Full refs - shared across all agents
// ---------------------------------------------------------------------------

/** Return full-phase template refs for a specific agent */
function getFullRefs(_agentId: AgentId): TemplateRef[] {
  return [];
}

// ---------------------------------------------------------------------------
// Per-agent setup guide ref - one per phase
// ---------------------------------------------------------------------------

/** Map each agent to its dedicated setup guide template */
const SETUP_GUIDE_TEMPLATES: Record<AgentId, string> = {
  claude: "workflow/setup/agents/claude.md",
  codex: "workflow/setup/agents/codex.md",
  gemini: "workflow/setup/agents/gemini.md",
};

/** Return the per-phase setup guide refs for a specific agent */
function getSetupGuideRefs(agentId: AgentId): TemplateRef[] {
  const template = SETUP_GUIDE_TEMPLATES[agentId];
  const name = PROFILES[agentId].name;
  return (["foundation", "standard", "full"] as const).map((phase) => ({
    output: `(${name} agent-specific setup)`,
    template,
    phase,
    note: `${phase} phase section`,
  }));
}

// ---------------------------------------------------------------------------
// Optional local-instruction generation is deferred to later optimisation work.
// Base setup no longer emits coding-guideline templates in M13.
// ---------------------------------------------------------------------------

export function mapLanguagesToTemplates(_languages: string[]): TemplateRef[] {
  return [];
}

export function mapSignalsToTemplates(
  _signals: ProjectSignals,
  _languages: string[] = [],
): TemplateRef[] {
  return [];
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
  "create-skill-goat": "workflow/skills/goat.md",
  "create-skill-security": "workflow/skills/goat-security.md",
  "create-skill-debug": "workflow/skills/goat-debug.md",
  "create-skill-review": "workflow/skills/goat-review.md",
  "create-skill-plan": "workflow/skills/goat-plan.md",
  "create-skill-test": "workflow/skills/goat-test.md",

  // File-level creates - instruction file and docs
  "create-instruction-file": "workflow/setup/reference/execution-loop.md",
  "create-lessons": "workflow/setup/05-customise-to-project.md",
  "create-footguns": "workflow/setup/05-customise-to-project.md",
  "create-architecture": "workflow/setup/04-architecture-code-map.md",
  // File-level creates - hooks/enforcement
  "create-deny-script": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "create-stop-lint": {
    claude: "workflow/hooks/stop-lint.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  // File-level creates - optional local instructions
  "create-conventions-instructions":
    "workflow/setup/reference/reference-coding-guidelines.md",
  // create-code-review-instructions removed - check 2.6.4 removed
  // create-git-commit-instructions removed - check 2.6.5 removed

  // Section-level creates - execution loop steps (all point to same parent)
  "add-read-step": "workflow/setup/reference/execution-loop.md",
  "add-classify-step": "workflow/setup/reference/execution-loop.md",
  "add-scope-step": "workflow/setup/reference/execution-loop.md",
  "add-act-step": "workflow/setup/reference/execution-loop.md",
  "add-verify-step": "workflow/setup/reference/execution-loop.md",
  "add-log-step": "workflow/setup/reference/execution-loop.md",

  // Section-level creates - autonomy tiers
  "add-autonomy-tiers": "workflow/setup/reference/execution-loop.md",
  "add-never-guards": "workflow/setup/reference/execution-loop.md",
  "add-micro-checklist": "workflow/setup/reference/execution-loop.md",

  // Section-level creates - definition of done
  "add-dod": "workflow/setup/reference/execution-loop.md",
  "add-dod-gates": "workflow/setup/reference/execution-loop.md",
  "add-grep-gate": "workflow/setup/reference/execution-loop.md",
  "add-log-gate": "workflow/setup/reference/execution-loop.md",

  // Fix-kind - skill quality (all templates demonstrate these sections)
  "create-all-skills": "workflow/skills/goat-debug.md",
  "add-skill-step0": "workflow/skills/goat-debug.md",
  "add-skill-human-gates": "workflow/skills/goat-debug.md",
  "add-skill-constraints": "workflow/skills/goat-debug.md",
  // add-skill-conversational removed - check 2.1.16 removed
  "add-skill-chaining": "workflow/skills/goat-debug.md",
  "add-skill-choices": "workflow/skills/goat-debug.md",
  "add-skill-phases": "workflow/skills/goat-debug.md",
  "add-skill-output-format": "workflow/skills/goat-debug.md",

  // Fix-kind - hook hardening (agent-specific)
  "add-deny-blocks": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "fix-deny-json-parsing": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "fix-deny-chaining": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "fix-deny-rm-rf": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "fix-deny-force-push": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "fix-deny-chmod": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "fix-deny-pipe-to-shell": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "fix-read-deny-secrets": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "add-stop-lint-validation": {
    claude: "workflow/hooks/stop-lint.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "add-compaction-hook": {
    claude: "workflow/hooks/README.md",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },

  // Fix-kind - learning loop
  "seed-lessons": "workflow/setup/05-customise-to-project.md",
  "seed-lessons-minimum": "workflow/setup/05-customise-to-project.md",
  "add-footgun-evidence": "workflow/setup/05-customise-to-project.md",

  // File-level creates - security, testing, devops, domain
  "create-security-instructions": "workflow/reference/security/README.md",
  "create-testing-instructions":
    "workflow/setup/reference/reference-coding-guidelines.md",
  "create-copilot-bridge": "workflow/setup/reference/reference-coding-guidelines.md",
  "create-domain-instructions": "workflow/setup/reference/reference-coding-guidelines.md",
  "create-security-auth": "workflow/reference/security/api-auth.md",
  "create-security-upload": "workflow/reference/security/file-upload.md",
  "create-security-infra": "workflow/reference/security/infrastructure.md",
  "create-security-secrets":
    "workflow/reference/security/secrets-management.md",
  "create-security-sql": "workflow/reference/security/sql-injection.md",
  "create-security-supply-chain": "workflow/reference/security/supply-chain.md",
  "create-security-django":
    "workflow/reference/security/framework-specific/django.md",
  "create-security-laravel":
    "workflow/reference/security/framework-specific/laravel.md",
  "create-security-symfony":
    "workflow/reference/security/framework-specific/symfony.md",
  "create-security-express":
    "workflow/reference/security/framework-specific/express-node.md",
  "create-security-go": "workflow/reference/security/framework-specific/go.md",
  "create-devops-terraform": "workflow/reference/security/infrastructure.md",

  // Fix-kind - local instructions
  "improve-conventions-instructions":
    "workflow/setup/reference/reference-coding-guidelines.md",
  "create-instructions-dir": "workflow/setup/05-customise-to-project.md",
  "create-instructions-router": "workflow/setup/05-customise-to-project.md",
  "create-frontend-instructions":
    "workflow/setup/reference/reference-coding-guidelines.md",
  // create-github-git-commit removed - check 2.6.6 removed

  // Fix-kind - foundation (instruction file sections)
  "add-version-header": "workflow/setup/reference/execution-loop.md",
  "add-essential-commands": "workflow/setup/reference/execution-loop.md",
  "add-concrete-examples": "workflow/setup/reference/execution-loop.md",
  "add-classify-budgets": "workflow/setup/reference/execution-loop.md",
  "add-router": "workflow/setup/reference/execution-loop.md",
  "route-skills": "workflow/setup/reference/execution-loop.md",
  "add-deny-mechanism": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "block-git-commit": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  "block-git-push": {
    claude: "workflow/hooks/deny-dangerous.sh",
    codex: "workflow/setup/agents/codex.md",
    gemini: "workflow/setup/agents/gemini.md",
  },
  // add-rfc2119 intentionally excluded - inline instruction is self-contained
  "fix-execution-loop-sync": "workflow/setup/reference/execution-loop.md",

  // Fix-kind - anti-patterns (ones with clear template sources)
  // ap-add-footgun-evidence removed - AP4 removed
  // ap-fix-empty-scaffolding removed - AP11 removed
  // ap-fix-duplicate-learning-loop-surfaces removed - AP22 removed
  // ap-fix-dangling-skill-refs removed - AP17 removed
  // ap-fix-adapt-comments removed - AP18 removed
  "ap-fix-hook-paths": "workflow/hooks/README.md",
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
  if (typeof entry === "string") return entry;
  return entry[agentId] ?? null;
}

/**
 * Get a language-specific template override for a fragment key.
 * Returns the relative template path if the project's detected languages
 * provide a more specific template than the generic one in FRAGMENT_TEMPLATE_MAP.
 */
export function getLanguageTemplate(
  key: string,
  _languages: string[],
): string | null {
  if (key === "create-backend-instructions") {
    return "workflow/setup/reference/reference-coding-guidelines.md";
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
