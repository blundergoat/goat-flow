/**
 * Defines the 16 setup-scope checks shown by `goat-flow audit`.
 * Use them to tell a project owner whether required learning-loop, workspace,
 * skill, config, and hook surfaces are structurally usable and version-current.
 * These checks inspect the selected project but never execute its application.
 */
import type { BuildCheck } from "./types.js";
import type { CheckEvidence } from "./provenance-types.js";
import { AUDIT_VERSION } from "../constants.js";
import {
  missingSkillReferenceInstructionRequirements,
  presentInstructionFiles,
  standalonePlaybookContractFailure,
  STANDALONE_PLAYBOOK_FILES,
} from "./skill-docs-contract.js";

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
  ...STANDALONE_PLAYBOOK_FILES,
  ".goat-flow/skill-docs/skill-quality-testing/",
  ".goat-flow/skill-docs/skill-quality-testing/README.md",
  ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
  ".goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md",
  ".goat-flow/skill-docs/skill-quality-testing/deployment.md",
  ".goat-flow/hooks/",
  ".goat-flow/hooks/deny-dangerous.sh",
  ".goat-flow/hooks/gruff-code-quality.sh",
  ".goat-flow/hooks/post-turn-safety.sh",
  ".goat-flow/hooks/deny-dangerous/",
  ".goat-flow/hooks/deny-dangerous/patterns-shell.sh",
  ".goat-flow/hooks/deny-dangerous/patterns-paths.sh",
  ".goat-flow/hooks/deny-dangerous/patterns-writes.sh",
  ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
  ".goat-flow/config.yaml",
]);

// Optional exclusions from the manifest catch-all setup gate.
const EXCLUDED_MANIFEST_PATHS = new Set<string>();

const REQUIRED_SKILL_DOC_FILES = [
  // Meta references
  ".goat-flow/skill-docs/README.md",
  ".goat-flow/skill-docs/skill-preamble.md",
  ".goat-flow/skill-docs/skill-conventions.md",
  // Standalone playbooks
  ".goat-flow/skill-docs/playbooks/README.md",
  ...STANDALONE_PLAYBOOK_FILES,
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
  "!logs/",
  "!logs/sessions/",
  "!logs/sessions/.gitkeep",
  "!logs/sessions/README.md",
  "!logs/quality/",
  "!logs/quality/README.md",
  "!logs/events/",
  "!logs/events/README.md",
  "!logs/critiques/",
  "!logs/critiques/README.md",
  "!logs/review/",
  "!logs/review/README.md",
  "!logs/security/",
  "!logs/security/README.md",
];

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
    // A user needs a real readable directory; a same-named file cannot preserve session continuity.
    if (
      ctx.fs.exists(".goat-flow/logs/sessions") &&
      ctx.fs.isReadableDirectory(".goat-flow/logs/sessions")
    ) {
      return null;
    }
    return {
      check: "Session logs",
      message: "Missing or unusable: .goat-flow/logs/sessions/",
      evidence: ".goat-flow/logs/sessions/",
      howToFix:
        "Ensure .goat-flow/logs/sessions/ is a readable directory, then run `goat-flow setup` if it is missing.",
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

    // A file named `plans` cannot hold the local milestones a user expects to resume.
    if (
      !ctx.fs.exists(".goat-flow/plans") ||
      !ctx.fs.isReadableDirectory(".goat-flow/plans")
    ) {
      missing.push(".goat-flow/plans/");
    }
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
    const configuredPatterns = new Set(
      content.split(/\r?\n/u).map((line) => line.trim()),
    );
    const missing = REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS.filter(
      (pattern) => !configuredPatterns.has(pattern),
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

    const playbookContractFailure = standalonePlaybookContractFailure(ctx);
    // Contract failures explain why installed guidance is unsafe to load.
    if (playbookContractFailure !== null) return playbookContractFailure;

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

const hookVersionCurrent: BuildCheck = {
  id: "hook-version",
  name: "Hook version",
  scope: "setup",
  provenance: setupSpecProvenance([
    ".goat-flow/hooks/deny-dangerous.sh",
    ".goat-flow/hooks/gruff-code-quality.sh",
    ".goat-flow/hooks/post-turn-safety.sh",
    "src/cli/constants.ts",
  ]),
  /** Run the Hook version check. */
  run: (ctx) => {
    // Central hook dispatchers carry a `# goat-flow-hook-version: X.Y.Z` stamp.
    // Missing required dispatchers are a partial install; optional gruff may be
    // absent until enabled.
    const hookFiles = [
      { file: "deny-dangerous.sh", required: true },
      { file: "gruff-code-quality.sh", required: false },
      { file: "post-turn-safety.sh", required: true },
    ];
    for (const { file: hookFile, required } of hookFiles) {
      const relPath = `.goat-flow/hooks/${hookFile}`;
      const content = ctx.fs.readFile(relPath);
      if (content === null) {
        if (!required) continue;
        return {
          check: "Hook version",
          message: `${relPath} is missing from the installed hook dispatcher set`,
          evidence: relPath,
          howToFix: `Re-run \`npx @blundergoat/goat-flow@${AUDIT_VERSION} hooks sync\` to install the required hook files.`,
        };
      }
      const stamped = content.match(
        /goat-flow-hook-version:\s*([0-9]+\.[0-9]+\.[0-9]+)/,
      );
      if (!stamped) {
        return {
          check: "Hook version",
          message: `${relPath} has no goat-flow-hook-version stamp (installed before ${AUDIT_VERSION})`,
          evidence: relPath,
          howToFix: `Re-run \`npx @blundergoat/goat-flow@${AUDIT_VERSION} hooks sync\` to update the hook files.`,
        };
      }
      const stampedVersion = stamped[1];
      if (stampedVersion !== AUDIT_VERSION) {
        return {
          check: "Hook version",
          message: `${relPath} is goat-flow-hook-version ${stampedVersion} but the current release is ${AUDIT_VERSION}`,
          evidence: relPath,
          howToFix: `Re-run \`npx @blundergoat/goat-flow@${AUDIT_VERSION} hooks sync\` to update the hook files.`,
        };
      }
    }
    return null;
  },
};

/** 16 setup-scope build checks */
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
  hookVersionCurrent,
];
