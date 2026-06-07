/**
 * GOAT Flow Setup checks for `goat-flow audit`.
 * 15 setup-scope checks that validate project structure:
 *   10 named (lessons, footguns, architecture, code-map, glossary, patterns,
 *             decisions, session-logs, plans, scratchpad)
 * + 1 skill-docs completeness and discoverability check
 * + 1 goat-flow-gitignore content check (catches pre-1.6.1 stale exceptions)
 * + 1 catch-all (other-files)
 * + 2 config (config-parses, config-version)
 */
import type { BuildCheck } from "./types.js";
import type { CheckEvidence } from "./provenance-types.js";
import { AUDIT_VERSION } from "../constants.js";

const VERIFIED_ON = "2026-05-03";

/** Return the setup spec provenance. */
function setupSpecProvenance(paths: string[]): CheckEvidence {
  return {
    source_type: "spec",
    source_urls: [],
    verified_on: VERIFIED_ON,
    normative_level: "MUST",
    evidence_paths: paths,
  };
}

// Paths covered by named checks - excluded from the catch-all.
// config.yaml is also excluded (covered by config-parses).
const NAMED_PATHS = new Set([
  ".goat-flow/learning-loop/lessons/",
  ".goat-flow/learning-loop/lessons/README.md",
  ".goat-flow/learning-loop/footguns/",
  ".goat-flow/learning-loop/footguns/README.md",
  ".goat-flow/architecture.md",
  ".goat-flow/code-map.md",
  ".goat-flow/glossary.md",
  ".goat-flow/learning-loop/patterns/README.md",
  ".goat-flow/learning-loop/decisions/",
  ".goat-flow/learning-loop/decisions/README.md",
  ".goat-flow/logs/sessions/",
  ".goat-flow/plans/",
  ".goat-flow/plans/.gitignore",
  ".goat-flow/plans/README.md",
  ".goat-flow/scratchpad/",
  ".goat-flow/scratchpad/.gitignore",
  ".goat-flow/scratchpad/README.md",
  ".goat-flow/skill-docs/",
  ".goat-flow/skill-docs/README.md",
  ".goat-flow/skill-docs/skill-preamble.md",
  ".goat-flow/skill-docs/skill-conventions.md",
  ".goat-flow/skill-docs/playbooks/",
  ".goat-flow/skill-docs/playbooks/README.md",
  ".goat-flow/skill-docs/playbooks/browser-use.md",
  ".goat-flow/skill-docs/playbooks/changelog.md",
  ".goat-flow/skill-docs/playbooks/code-comments.md",
  ".goat-flow/skill-docs/playbooks/gruff-code-quality.md",
  ".goat-flow/skill-docs/playbooks/observability.md",
  ".goat-flow/skill-docs/playbooks/page-capture.md",
  ".goat-flow/skill-docs/playbooks/release-notes.md",
  ".goat-flow/skill-docs/skill-quality-testing/",
  ".goat-flow/skill-docs/skill-quality-testing/README.md",
  ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
  ".goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md",
  ".goat-flow/skill-docs/skill-quality-testing/deployment.md",
  ".goat-flow/hooks/",
  ".goat-flow/hooks/deny-dangerous.sh",
  ".goat-flow/hooks/gruff-code-quality.sh",
  ".goat-flow/hooks/deny-dangerous/",
  ".goat-flow/hooks/deny-dangerous/patterns-shell.sh",
  ".goat-flow/hooks/deny-dangerous/patterns-paths.sh",
  ".goat-flow/hooks/deny-dangerous/patterns-writes.sh",
  ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
  ".goat-flow/config.yaml",
]);

// Optional exclusions from the manifest catch-all setup gate.
const EXCLUDED_MANIFEST_PATHS = new Set<string>();

const READ_RULE_PATTERNS = [
  /Before declaring any tool(?: or capability)? unavailable/i,
  /\.goat-flow\/skill-docs\/playbooks\//,
  /Availability Check/i,
];
const ROUTER_POINTER_PATTERNS = [
  /\.goat-flow\/skill-docs\/playbooks\//,
  /tool playbooks?|skill docs?|skill playbooks?/i,
];
const REQUIRED_SKILL_DOC_FILES = [
  // Meta references
  ".goat-flow/skill-docs/README.md",
  ".goat-flow/skill-docs/skill-preamble.md",
  ".goat-flow/skill-docs/skill-conventions.md",
  // Standalone playbooks
  ".goat-flow/skill-docs/playbooks/README.md",
  ".goat-flow/skill-docs/playbooks/browser-use.md",
  ".goat-flow/skill-docs/playbooks/changelog.md",
  ".goat-flow/skill-docs/playbooks/code-comments.md",
  ".goat-flow/skill-docs/playbooks/gruff-code-quality.md",
  ".goat-flow/skill-docs/playbooks/observability.md",
  ".goat-flow/skill-docs/playbooks/page-capture.md",
  ".goat-flow/skill-docs/playbooks/release-notes.md",
  ".goat-flow/skill-docs/skill-quality-testing/README.md",
  ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
  ".goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md",
  ".goat-flow/skill-docs/skill-quality-testing/deployment.md",
];

// Un-ignore patterns the goat-flow-gitignore template installs into
// `.goat-flow/.gitignore`. The template ignores everything (`*`) by default,
// then re-includes these committed surfaces. Pre-1.6.1 installs are missing
// the old skill-doc entries, which silently hides the committed docs and hook
// policy files from git even though the files exist on disk.
const REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS = [
  "!learning-loop/",
  "!learning-loop/**",
  "!skill-docs/",
  "!skill-docs/**",
  "!hooks/",
  "!hooks/**",
  "!plans/",
  "!plans/**",
];

/**
 * Markdown heading slice used by instruction-file section checks.
 *
 * Offsets are JavaScript string indexes, not line numbers, because the audit
 * slices the original content and must preserve LF/CRLF handling.
 */
interface MarkdownHeading {
  index: number;
  end: number;
  level: number;
  title: string;
}

function presentInstructionFiles(
  ctx: Parameters<BuildCheck["run"]>[0],
): string[] {
  const paths = Object.values(ctx.structure.agents).map(
    (agent) => agent.instruction_file,
  );
  return [...new Set(paths)].filter((path) => ctx.fs.exists(path));
}

/**
 * Parse ATX headings from instruction markdown without a full Markdown parser.
 *
 * The audit only needs section boundaries for AGENTS/CLAUDE/Copilot files, so a
 * small deterministic parser avoids adding a runtime dependency to setup checks.
 * The scan mutates only the local RegExp cursor used for this string.
 */
function markdownHeadings(content: string): MarkdownHeading[] {
  const headingPattern = /^(#{1,6})\s+(.+?)\s*$/gm;
  const headings: MarkdownHeading[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(content)) !== null) {
    headings.push({
      index: match.index,
      end: match.index + match[0].length,
      level: match[1]?.length ?? 0,
      title: match[2] ?? "",
    });
  }
  return headings;
}

/**
 * Return the first content offset after a heading line.
 *
 * CRLF and LF both appear in installed instruction files; normalizing the start
 * offset here keeps section extraction from carrying the heading newline.
 */
function sectionStartOffset(content: string, headingEnd: number): number {
  if (content.slice(headingEnd, headingEnd + 2) === "\r\n")
    return headingEnd + 2;
  if (content[headingEnd] === "\n") return headingEnd + 1;
  return headingEnd;
}

/**
 * Extract one markdown section by heading title.
 *
 * The end boundary is the next heading at the same or higher level because READ
 * can be nested under Execution Loop without swallowing sibling steps.
 */
function markdownSection(content: string, heading: RegExp): string | null {
  const headings = markdownHeadings(content);
  const headingIndex = headings.findIndex((entry) => heading.test(entry.title));
  if (headingIndex < 0) return null;

  const startHeading = headings[headingIndex];
  if (!startHeading) return null;
  const nextHeading = headings
    .slice(headingIndex + 1)
    .find((entry) => entry.level <= startHeading.level);
  return content
    .slice(sectionStartOffset(content, startHeading.end), nextHeading?.index)
    .trim();
}

/**
 * Extract AGENTS-style bold execution-loop steps.
 *
 * Some installed instruction files encode READ/SCOPE/ACT/VERIFY as bold list
 * labels instead of headings; this fallback preserves compatibility with that
 * shape while keeping the skill-docs rule scoped to the Execution Loop.
 * The helper reads the provided string only; it does not touch project files.
 */
function boldStepSection(content: string, step: string): string | null {
  const pattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:[-*]\s*)?\*\*${step}\*\*[\s:–-]*(?<body>[\s\S]*?)(?=\n\s*(?:[-*]\s*)?\*\*(?:READ|SCOPE|ACT|VERIFY)\*\*[\s:–-]*|\n##\s|\n###\s|$)`,
    "i",
  );
  return pattern.exec(content)?.groups?.body?.trim() ?? null;
}

/**
 * Check that READ tells agents to consult playbooks before declaring tools absent.
 *
 * The scan is scoped to the Execution Loop so incidental references elsewhere
 * do not satisfy the setup contract.
 */
function hasSkillReferenceReadRule(content: string): boolean {
  const executionLoop = markdownSection(content, /^Execution Loop\b/i);
  if (!executionLoop) return false;
  const readSection =
    markdownSection(executionLoop, /^READ\b/i) ??
    boldStepSection(executionLoop, "READ");
  if (!readSection) return false;
  return READ_RULE_PATTERNS.every((pattern) => pattern.test(readSection));
}

/**
 * Check that the Router Table exposes the skill-docs/playbook paths.
 *
 * Keeping this in Router Table makes the discovery path explicit for future
 * agents instead of relying on a one-off mention in surrounding prose.
 */
function hasSkillReferenceRouterPointer(content: string): boolean {
  const routerTable = markdownSection(content, /^Router Table\b/i);
  if (!routerTable) return false;
  return ROUTER_POINTER_PATTERNS.every((pattern) => pattern.test(routerTable));
}

function missingSkillReferenceInstructionRequirements(
  content: string,
): string[] {
  const missing: string[] = [];
  if (!hasSkillReferenceReadRule(content)) missing.push("READ rule");
  if (!hasSkillReferenceRouterPointer(content)) {
    missing.push("Router Table pointer");
  }
  return missing;
}

// === Named structure checks (10) ===

const lessons: BuildCheck = {
  id: "lessons",
  name: "Lessons",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
  ]),
  /** Run the Lessons check. */
  run: (ctx) => {
    const missing: string[] = [];
    if (!ctx.fs.exists(".goat-flow/learning-loop/lessons"))
      missing.push(".goat-flow/learning-loop/lessons/");
    if (!ctx.fs.exists(".goat-flow/learning-loop/lessons/README.md"))
      missing.push(".goat-flow/learning-loop/lessons/README.md");
    if (missing.length === 0) return null;
    return {
      check: "Lessons",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix:
        "Create lessons directory by running `goat-flow setup` or `mkdir -p .goat-flow/learning-loop/lessons`.",
    };
  },
};

const footguns: BuildCheck = {
  id: "footguns",
  name: "Footguns",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
  ]),
  /** Run the Footguns check. */
  run: (ctx) => {
    const missing: string[] = [];
    if (!ctx.fs.exists(".goat-flow/learning-loop/footguns"))
      missing.push(".goat-flow/learning-loop/footguns/");
    if (!ctx.fs.exists(".goat-flow/learning-loop/footguns/README.md"))
      missing.push(".goat-flow/learning-loop/footguns/README.md");
    if (missing.length === 0) return null;
    return {
      check: "Footguns",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix:
        "Create footguns directory by running `goat-flow setup` or `mkdir -p .goat-flow/learning-loop/footguns`.",
    };
  },
};

const architecture: BuildCheck = {
  id: "architecture",
  name: "Architecture",
  scope: "setup",
  evidenceKind: "structural",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    "workflow/setup/04-architecture-code-map.md",
  ]),
  /** Run the Architecture check. */
  run: (ctx) => {
    if (ctx.fs.exists(".goat-flow/architecture.md")) return null;
    return {
      check: "Architecture",
      message: "Missing: .goat-flow/architecture.md",
      evidence: ".goat-flow/architecture.md",
      howToFix:
        "Create .goat-flow/architecture.md by running `goat-flow setup`.",
    };
  },
};

const codeMap: BuildCheck = {
  id: "code-map",
  name: "Code map",
  scope: "setup",
  evidenceKind: "structural",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    "workflow/setup/04-architecture-code-map.md",
  ]),
  /** Run the Code map check. */
  run: (ctx) => {
    if (ctx.fs.exists(".goat-flow/code-map.md")) return null;
    return {
      check: "Code map",
      message: "Missing: .goat-flow/code-map.md",
      evidence: ".goat-flow/code-map.md",
      howToFix: "Create .goat-flow/code-map.md by running `goat-flow setup`.",
    };
  },
};

const glossary: BuildCheck = {
  id: "glossary",
  name: "Glossary",
  scope: "setup",
  evidenceKind: "structural",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
  ]),
  /** Run the Glossary check. */
  run: (ctx) => {
    if (ctx.fs.exists(".goat-flow/glossary.md")) return null;
    return {
      check: "Glossary",
      message: "Missing: .goat-flow/glossary.md",
      evidence: ".goat-flow/glossary.md",
      howToFix: "Create .goat-flow/glossary.md by running `goat-flow setup`.",
    };
  },
};

const patterns: BuildCheck = {
  id: "patterns",
  name: "Patterns",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
  ]),
  /** Run the Patterns check. */
  run: (ctx) => {
    if (ctx.fs.exists(".goat-flow/learning-loop/patterns/README.md"))
      return null;
    return {
      check: "Patterns",
      message: "Missing: .goat-flow/learning-loop/patterns/README.md",
      evidence: ".goat-flow/learning-loop/patterns/README.md",
      howToFix:
        "Create .goat-flow/learning-loop/patterns/ directory by running `goat-flow setup`.",
    };
  },
};

const decisions: BuildCheck = {
  id: "decisions",
  name: "Decisions",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
  ]),
  /** Run the Decisions check. */
  run: (ctx) => {
    const missing: string[] = [];
    if (!ctx.fs.exists(".goat-flow/learning-loop/decisions"))
      missing.push(".goat-flow/learning-loop/decisions/");
    if (!ctx.fs.exists(".goat-flow/learning-loop/decisions/README.md"))
      missing.push(".goat-flow/learning-loop/decisions/README.md");
    if (missing.length === 0) return null;
    return {
      check: "Decisions",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix:
        "Create decisions directory by running `goat-flow setup` or `mkdir -p .goat-flow/learning-loop/decisions`.",
    };
  },
};

const sessionLogs: BuildCheck = {
  id: "session-logs",
  name: "Session logs",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
  ]),
  /** Run the Session logs check. */
  run: (ctx) => {
    if (ctx.fs.exists(".goat-flow/logs/sessions")) return null;
    return {
      check: "Session logs",
      message: "Missing: .goat-flow/logs/sessions/",
      evidence: ".goat-flow/logs/sessions/",
      howToFix:
        "Create session logs directory by running `goat-flow setup` or `mkdir -p .goat-flow/logs/sessions`.",
    };
  },
};

const plans: BuildCheck = {
  id: "plans",
  name: "Plans",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
    ".goat-flow/plans/README.md",
  ]),
  /** Run the Plans check. */
  run: (ctx) => {
    const missing: string[] = [];
    if (!ctx.fs.exists(".goat-flow/plans")) missing.push(".goat-flow/plans/");
    if (!ctx.fs.exists(".goat-flow/plans/.gitignore"))
      missing.push(".goat-flow/plans/.gitignore");
    if (!ctx.fs.exists(".goat-flow/plans/README.md"))
      missing.push(".goat-flow/plans/README.md");
    if (missing.length === 0) return null;
    return {
      check: "Plans",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix:
        "Create plans directory by running `goat-flow setup`. README.md signals the dir is local-session-state by design.",
    };
  },
};

const scratchpad: BuildCheck = {
  id: "scratchpad",
  name: "Scratchpad",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
    ".goat-flow/scratchpad/README.md",
  ]),
  /** Run the Scratchpad check. */
  run: (ctx) => {
    const missing: string[] = [];
    if (!ctx.fs.exists(".goat-flow/scratchpad"))
      missing.push(".goat-flow/scratchpad/");
    if (!ctx.fs.exists(".goat-flow/scratchpad/.gitignore"))
      missing.push(".goat-flow/scratchpad/.gitignore");
    if (!ctx.fs.exists(".goat-flow/scratchpad/README.md"))
      missing.push(".goat-flow/scratchpad/README.md");
    if (missing.length === 0) return null;
    return {
      check: "Scratchpad",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix:
        "Create scratchpad directory by running `goat-flow setup`. README.md signals the dir is local WIP by design.",
    };
  },
};

const goatFlowGitignoreContent: BuildCheck = {
  id: "goat-flow-gitignore",
  name: "goat-flow gitignore exceptions",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/setup/reference/goat-flow-gitignore",
    "workflow/install-goat-flow.sh",
  ]),
  /** Run the goat-flow gitignore exceptions check. */
  run: (ctx) => {
    if (!ctx.fs.exists(".goat-flow/.gitignore")) {
      return {
        check: "goat-flow gitignore exceptions",
        message: "Missing: .goat-flow/.gitignore",
        evidence: ".goat-flow/.gitignore",
        howToFix:
          "Run `goat-flow install . --agent <id>` to copy the current gitignore template. The installer always overwrites .goat-flow/.gitignore.",
      };
    }
    const content = ctx.fs.readFile(".goat-flow/.gitignore") ?? "";
    const missing = REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS.filter(
      (pattern) => !content.includes(pattern),
    );
    if (missing.length === 0) return null;
    return {
      check: "goat-flow gitignore exceptions",
      message: `.goat-flow/.gitignore is missing required un-ignore entries: ${missing.join(", ")}. Stale gitignores silently hide committed skill docs, hook policy, or plan anchors from git.`,
      evidence: ".goat-flow/.gitignore",
      howToFix:
        "Run `goat-flow install . --agent <id>` to refresh .goat-flow/.gitignore from the current template. After it overwrites, `git add .goat-flow/skill-docs/playbooks/ .goat-flow/skill-docs/` to track files that were previously hidden.",
    };
  },
};

const instructionFileSkillReferencePointer: BuildCheck = {
  id: "instruction-file-skill-docs-pointer",
  name: "Instruction file skill-docs pointer",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    "workflow/setup/reference/execution-loop.md",
    "workflow/setup/02-instruction-file.md",
    "workflow/skills/reference/README.md",
    "workflow/skills/playbooks/README.md",
  ]),
  /** Run the Instruction file skill-docs pointer check. */
  run: (ctx) => {
    const missingReferenceFiles = REQUIRED_SKILL_DOC_FILES.filter(
      (path) => !ctx.fs.exists(path),
    );
    if (missingReferenceFiles.length > 0) {
      return {
        check: "Instruction file skill-docs pointer",
        message: `Shared reference/playbook pack is incomplete. Missing: ${missingReferenceFiles.join(", ")}`,
        evidence: missingReferenceFiles[0],
        howToFix:
          "Refresh with `goat-flow install . --agent <agent>`. The index files are load-bearing and must be installed with the shared skill-docs/playbook pack.",
      };
    }

    const missingRequirements = presentInstructionFiles(ctx).flatMap((path) => {
      const content = ctx.fs.readFile(path) ?? "";
      const missing = missingSkillReferenceInstructionRequirements(content);
      return missing.length > 0 ? [`${path} (${missing.join(", ")})`] : [];
    });
    if (missingRequirements.length === 0) return null;

    return {
      check: "Instruction file skill-docs pointer",
      message: `Instruction file(s) missing skill-docs READ rule or Router Table pointer: ${missingRequirements.join(", ")}`,
      evidence: missingRequirements[0]?.replace(/\s+\(.+\)$/, ""),
      howToFix:
        'Append to the existing READ step: "Before declaring any tool or capability unavailable, read the matching playbook in `.goat-flow/skill-docs/playbooks/` (e.g. `browser-use.md`, `page-capture.md`) and run that doc\'s "Availability Check" section verbatim - project-local CLI tools at `~/.local/bin/` are valid; do not conflate "no harness/MCP tool" with "no tool"." Add a Router Table row for tool playbooks: | Skill playbooks (tools) | `.goat-flow/skill-docs/playbooks/` (README.md index; read BEFORE declaring a tool unavailable) |.',
    };
  },
};

// === Catch-all for remaining manifest entries ===

const otherFiles: BuildCheck = {
  id: "other-files",
  name: "Other required files",
  scope: "setup",
  provenance: setupSpecProvenance(["workflow/manifest.json"]),
  /** Run the Other required files check. */
  run: (ctx) => {
    const allRequired = [
      ...ctx.structure.required_files,
      ...ctx.structure.required_dirs,
    ];
    const uncovered = allRequired.filter(
      (p) => !NAMED_PATHS.has(p) && !EXCLUDED_MANIFEST_PATHS.has(p),
    );
    const missing = uncovered.filter((p) => {
      const trimmed = p.endsWith("/") ? p.slice(0, -1) : p;
      return !ctx.fs.exists(trimmed);
    });
    if (missing.length === 0) return null;
    return {
      check: "Other required files",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix: `Create ${missing.join(", ")} by running \`goat-flow setup\` or creating them manually.`,
    };
  },
};

const configExistsAndParses: BuildCheck = {
  id: "config-parses",
  name: "Config file",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    ".goat-flow/config.yaml",
  ]),
  /** Run the Config file check. */
  run: (ctx) => {
    if (!ctx.config.exists) {
      return {
        check: "Config file",
        message: ".goat-flow/config.yaml does not exist",
        howToFix: "Create .goat-flow/config.yaml by running `goat-flow setup`.",
      };
    }
    if (ctx.config.parseError) {
      return {
        check: "Config file",
        message: `Parse error: ${ctx.config.parseError}`,
        evidence: ".goat-flow/config.yaml",
        howToFix: "Fix the YAML syntax error in .goat-flow/config.yaml.",
      };
    }
    if (!ctx.config.valid) {
      const [firstError] = ctx.config.errors;
      const detail = firstError
        ? `${firstError.path}: ${firstError.message}`
        : "validation failed";
      return {
        check: "Config file",
        message: `Validation error: ${detail}`,
        evidence: ".goat-flow/config.yaml",
        howToFix:
          "Fix the validation error in .goat-flow/config.yaml so it matches the manifest-backed config contract.",
      };
    }
    return null;
  },
};

const configVersionCurrent: BuildCheck = {
  id: "config-version",
  name: "Config version",
  scope: "setup",
  provenance: setupSpecProvenance([
    ".goat-flow/config.yaml",
    "src/cli/constants.ts",
  ]),
  skip: (ctx) => !ctx.config.exists || ctx.config.parseError !== null,
  /** Run the Config version check. */
  run: (ctx) => {
    const version = ctx.config.config.version;
    if (!version) {
      return {
        check: "Config version",
        message: "version field missing from config.yaml",
        howToFix: `Add \`version: "${AUDIT_VERSION}"\` to .goat-flow/config.yaml.`,
      };
    }
    if (version !== AUDIT_VERSION) {
      return {
        check: "Config version",
        message: `Config version ${version} does not match current ${AUDIT_VERSION}`,
        howToFix: `Run \`goat-flow install . --agent <id> --update-config-version\` or update the version field in .goat-flow/config.yaml to "${AUDIT_VERSION}".`,
      };
    }
    return null;
  },
};

/** 15 setup-scope build checks */
export const SETUP_CHECKS: BuildCheck[] = [
  lessons,
  footguns,
  architecture,
  codeMap,
  glossary,
  patterns,
  decisions,
  sessionLogs,
  plans,
  scratchpad,
  goatFlowGitignoreContent,
  instructionFileSkillReferencePointer,
  otherFiles,
  configExistsAndParses,
  configVersionCurrent,
];
