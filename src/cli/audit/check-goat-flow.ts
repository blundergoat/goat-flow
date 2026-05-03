/**
 * GOAT Flow Setup checks for `goat-flow audit`.
 * 14 setup-scope checks that validate project structure:
 *   10 named (lessons, footguns, architecture, code-map, glossary, patterns,
 *             decisions, session-logs, tasks, scratchpad)
 * + 1 conditional skill-reference discoverability check
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
  ".goat-flow/lessons/",
  ".goat-flow/lessons/README.md",
  ".goat-flow/footguns/",
  ".goat-flow/footguns/README.md",
  ".goat-flow/architecture.md",
  ".goat-flow/code-map.md",
  ".goat-flow/glossary.md",
  ".goat-flow/patterns/README.md",
  ".goat-flow/decisions/",
  ".goat-flow/decisions/README.md",
  ".goat-flow/logs/sessions/",
  ".goat-flow/tasks/",
  ".goat-flow/tasks/.gitignore",
  ".goat-flow/tasks/README.md",
  ".goat-flow/scratchpad/",
  ".goat-flow/scratchpad/.gitignore",
  ".goat-flow/scratchpad/README.md",
  ".goat-flow/skill-reference/",
  ".goat-flow/skill-reference/README.md",
  ".goat-flow/skill-reference/skill-preamble.md",
  ".goat-flow/skill-reference/skill-conventions.md",
  ".goat-flow/skill-reference/browser-use.md",
  ".goat-flow/skill-reference/page-capture.md",
  ".goat-flow/skill-reference/skill-quality-testing.md",
  ".goat-flow/skill-reference/skill-quality-testing/tdd-iteration.md",
  ".goat-flow/skill-reference/skill-quality-testing/adversarial-framing.md",
  ".goat-flow/skill-reference/skill-quality-testing/deployment.md",
  ".goat-flow/config.yaml",
]);

// Optional exclusions from the manifest catch-all setup gate.
const EXCLUDED_MANIFEST_PATHS = new Set<string>();

const SKILL_REFERENCE_DIR = ".goat-flow/skill-reference";
const READ_RULE_PATTERNS = [
  /Before declaring any tool(?: or capability)? unavailable/i,
  /\.goat-flow\/skill-reference\//,
  /Availability Check/i,
];
const ROUTER_POINTER_PATTERNS = [
  /\.goat-flow\/skill-reference\//,
  /tool playbooks?|skill reference/i,
];
const REQUIRED_SKILL_REFERENCE_FILES = [
  ".goat-flow/skill-reference/README.md",
  ".goat-flow/skill-reference/skill-preamble.md",
  ".goat-flow/skill-reference/skill-conventions.md",
  ".goat-flow/skill-reference/browser-use.md",
  ".goat-flow/skill-reference/page-capture.md",
  ".goat-flow/skill-reference/skill-quality-testing.md",
  ".goat-flow/skill-reference/skill-quality-testing/tdd-iteration.md",
  ".goat-flow/skill-reference/skill-quality-testing/adversarial-framing.md",
  ".goat-flow/skill-reference/skill-quality-testing/deployment.md",
];

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

function sectionStartOffset(content: string, headingEnd: number): number {
  if (content.slice(headingEnd, headingEnd + 2) === "\r\n")
    return headingEnd + 2;
  if (content[headingEnd] === "\n") return headingEnd + 1;
  return headingEnd;
}

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

function boldStepSection(content: string, step: string): string | null {
  const pattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:[-*]\s*)?\*\*${step}\*\*[\s:–-]*(?<body>[\s\S]*?)(?=\n\s*(?:[-*]\s*)?\*\*(?:READ|SCOPE|ACT|VERIFY)\*\*[\s:–-]*|\n##\s|\n###\s|$)`,
    "i",
  );
  return pattern.exec(content)?.groups?.body?.trim() ?? null;
}

function hasSkillReferenceReadRule(content: string): boolean {
  const executionLoop = markdownSection(content, /^Execution Loop\b/i);
  if (!executionLoop) return false;
  const readSection =
    markdownSection(executionLoop, /^READ\b/i) ??
    boldStepSection(executionLoop, "READ");
  if (!readSection) return false;
  return READ_RULE_PATTERNS.every((pattern) => pattern.test(readSection));
}

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
    if (!ctx.fs.exists(".goat-flow/lessons"))
      missing.push(".goat-flow/lessons/");
    if (!ctx.fs.exists(".goat-flow/lessons/README.md"))
      missing.push(".goat-flow/lessons/README.md");
    if (missing.length === 0) return null;
    return {
      check: "Lessons",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix:
        "Create lessons directory by running `goat-flow setup` or `mkdir -p .goat-flow/lessons`.",
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
    if (!ctx.fs.exists(".goat-flow/footguns"))
      missing.push(".goat-flow/footguns/");
    if (!ctx.fs.exists(".goat-flow/footguns/README.md"))
      missing.push(".goat-flow/footguns/README.md");
    if (missing.length === 0) return null;
    return {
      check: "Footguns",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix:
        "Create footguns directory by running `goat-flow setup` or `mkdir -p .goat-flow/footguns`.",
    };
  },
};

const architecture: BuildCheck = {
  id: "architecture",
  name: "Architecture",
  scope: "setup",
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
    if (ctx.fs.exists(".goat-flow/patterns/README.md")) return null;
    return {
      check: "Patterns",
      message: "Missing: .goat-flow/patterns/README.md",
      evidence: ".goat-flow/patterns/README.md",
      howToFix:
        "Create .goat-flow/patterns/ directory by running `goat-flow setup`.",
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
    if (!ctx.fs.exists(".goat-flow/decisions"))
      missing.push(".goat-flow/decisions/");
    if (!ctx.fs.exists(".goat-flow/decisions/README.md"))
      missing.push(".goat-flow/decisions/README.md");
    if (missing.length === 0) return null;
    return {
      check: "Decisions",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix:
        "Create decisions directory by running `goat-flow setup` or `mkdir -p .goat-flow/decisions`.",
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

const tasks: BuildCheck = {
  id: "tasks",
  name: "Tasks",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
    ".goat-flow/tasks/README.md",
  ]),
  /** Run the Tasks check. */
  run: (ctx) => {
    const missing: string[] = [];
    if (!ctx.fs.exists(".goat-flow/tasks")) missing.push(".goat-flow/tasks/");
    if (!ctx.fs.exists(".goat-flow/tasks/.gitignore"))
      missing.push(".goat-flow/tasks/.gitignore");
    if (!ctx.fs.exists(".goat-flow/tasks/README.md"))
      missing.push(".goat-flow/tasks/README.md");
    if (missing.length === 0) return null;
    return {
      check: "Tasks",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix:
        "Create tasks directory by running `goat-flow setup`. README.md signals the dir is local-session-state by design.",
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

const instructionFileSkillReferencePointer: BuildCheck = {
  id: "instruction-file-skill-reference-pointer",
  name: "Instruction file skill-reference pointer",
  scope: "setup",
  provenance: setupSpecProvenance([
    "workflow/manifest.json",
    "workflow/setup/reference/execution-loop.md",
    "workflow/setup/02-instruction-file.md",
    "workflow/skills/reference/README.md",
  ]),
  skip: (ctx) => !ctx.fs.exists(SKILL_REFERENCE_DIR),
  /** Run the Instruction file skill-reference pointer check. */
  run: (ctx) => {
    const missingReferenceFiles = REQUIRED_SKILL_REFERENCE_FILES.filter(
      (path) => !ctx.fs.exists(path),
    );
    if (missingReferenceFiles.length > 0) {
      return {
        check: "Instruction file skill-reference pointer",
        message: `Skill reference directory is incomplete. Missing: ${missingReferenceFiles.join(", ")}`,
        evidence: missingReferenceFiles[0],
        howToFix:
          "Refresh with `goat-flow install . --agent <agent>`. The index file is load-bearing and must be installed with the reference pack.",
      };
    }

    const missingRequirements = presentInstructionFiles(ctx).flatMap((path) => {
      const content = ctx.fs.readFile(path) ?? "";
      const missing = missingSkillReferenceInstructionRequirements(content);
      return missing.length > 0 ? [`${path} (${missing.join(", ")})`] : [];
    });
    if (missingRequirements.length === 0) return null;

    return {
      check: "Instruction file skill-reference pointer",
      message: `Instruction file(s) missing skill-reference READ rule or Router Table pointer: ${missingRequirements.join(", ")}`,
      evidence: missingRequirements[0]?.replace(/\s+\(.+\)$/, ""),
      howToFix:
        'Append to the existing READ step: "Before declaring any tool or capability unavailable, read the matching playbook in `.goat-flow/skill-reference/` (e.g. `browser-use.md`, `page-capture.md`) and run that doc\'s "Availability Check" section verbatim - project-local CLI tools at `~/.local/bin/` are valid; do not conflate "no harness/MCP tool" with "no tool"." Add a Router Table row for tool playbooks: | Tool playbooks (CLI/MCP availability checks: browser-use, page-capture, skill-* references) | `.goat-flow/skill-reference/` - read BEFORE declaring a tool unavailable |.',
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
  /** Run the Config version check. */
  run: (ctx) => {
    if (!ctx.config.exists) return null;
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
        howToFix: `Update the version field in .goat-flow/config.yaml to "${AUDIT_VERSION}".`,
      };
    }
    return null;
  },
};

/** 14 setup-scope build checks */
export const SETUP_CHECKS: BuildCheck[] = [
  lessons,
  footguns,
  architecture,
  codeMap,
  glossary,
  patterns,
  decisions,
  sessionLogs,
  tasks,
  scratchpad,
  instructionFileSkillReferencePointer,
  otherFiles,
  configExistsAndParses,
  configVersionCurrent,
];
