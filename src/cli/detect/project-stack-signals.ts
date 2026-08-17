/**
 * Derives the secondary project signals that enrich setup prompts and audit policy: code-generation and deployment tooling, LLM integration,
 * static-analysis tools, compliance-sensitive docs, and per-language formatter gaps.
 *
 * These are advisory signals, not hard facts - compliance detection in particular is signal-only and audit policy decides whether a hit matters.
 * Detector tables come from project-stack-data.js; file matching goes through the read-only fs adapter so a missing or unreadable file is a
 * non-match, never a throw.
 */
import type { ProjectSignals, ReadonlyFS } from "../types.js";
import {
  PROJECT_STACK_CODE_GENERATION_SIGNALS,
  PROJECT_STACK_COMPLIANCE_DOCS,
  PROJECT_STACK_DEPLOYMENT_SIGNALS,
  PROJECT_STACK_FORMATTER_MAP,
  PROJECT_STACK_LLM_DEPENDENCY_FILES,
  PROJECT_STACK_LLM_ENV_FILES,
  type ToolPathGlobSignal,
} from "./project-stack-data.js";
import { hasAnyGlob, hasAnyPath } from "./project-stack-files.js";

/**
 * Count distinct source files under the conventional code roots, used as a coarse project-size signal.
 * Globs only src/lib/app/packages, so generated, vendor, and build output outside those trees is excluded by construction rather than filtered.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @returns the de-duplicated file count across the code roots; 0 when none match
 */
export function countSourceFiles(fs: ReadonlyFS): number {
  const patterns = [
    "src/**/*.*",
    "lib/**/*.*",
    "app/**/*.*",
    "packages/**/*.*",
  ];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const file of fs.glob(pattern)) {
      seen.add(file);
    }
  }
  return seen.size;
}

/** Collect named tool/platform signals that feed richer setup prompts. */
function collectNamedSignals(
  fs: ReadonlyFS,
  detectors: ReadonlyArray<ToolPathGlobSignal>,
): string[] {
  return detectors
    .filter(
      (detector) =>
        hasAnyPath(fs, detector.paths) || hasAnyGlob(fs, detector.globs),
    )
    .map((detector) => detector.tool);
}

/** Search a list of files for a regex pattern without crashing on missing files. */
function fileContainsPattern(
  fs: ReadonlyFS,
  paths: readonly string[],
  pattern: RegExp,
): boolean {
  return paths.some((path) => {
    const content = fs.readFile(path);
    return content !== null && pattern.test(content);
  });
}

/** Detect llm integration. */
function detectLLMIntegration(fs: ReadonlyFS): boolean {
  return (
    fileContainsPattern(
      fs,
      PROJECT_STACK_LLM_ENV_FILES,
      /MODEL_PROVIDER|OPENAI_API_KEY|ANTHROPIC_API_KEY|BEDROCK|OLLAMA/i,
    ) ||
    fileContainsPattern(
      fs,
      PROJECT_STACK_LLM_DEPENDENCY_FILES,
      /anthropic|openai|langchain|llamaindex|strands/i,
    )
  );
}

/** Detect static-analysis tooling from project files. */
// eslint-disable-next-line complexity -- intentional: detection covers many tool/config combos; extracting would fragment the detector.
function detectStaticAnalysis(
  fs: ReadonlyFS,
): Array<{ tool: string; level: string | null }> {
  const staticAnalysis: Array<{ tool: string; level: string | null }> = [];

  // PHP: PHPStan
  const phpstanConfig =
    fs.readFile("phpstan.neon") ?? fs.readFile("phpstan.neon.dist");
  if (phpstanConfig) {
    const levelMatch = phpstanConfig.match(/level:\s*(\d+|max)/);
    staticAnalysis.push({ tool: "phpstan", level: levelMatch?.[1] ?? null });
  }

  // Python: mypy
  const mypyConfig = fs.readFile("mypy.ini") ?? fs.readFile("setup.cfg");
  if (mypyConfig && /\[mypy\]/i.test(mypyConfig)) {
    const strictMatch = mypyConfig.match(/strict\s*=\s*(true|false)/i);
    staticAnalysis.push({
      tool: "mypy",
      level: strictMatch?.[1] === "true" ? "strict" : null,
    });
  }

  // Python: ruff
  if (
    fs.exists("ruff.toml") ||
    fs.exists(".ruff.toml") ||
    fs.readFile("pyproject.toml")?.includes("[tool.ruff")
  ) {
    staticAnalysis.push({ tool: "ruff", level: null });
  }

  // JS/TS: eslint (config files or package.json devDependencies)
  const hasEslintConfig =
    fs.exists("eslint.config.js") ||
    fs.exists("eslint.config.mjs") ||
    fs.exists("eslint.config.cjs") ||
    fs.exists("eslint.config.ts") ||
    fs.exists(".eslintrc.json") ||
    fs.exists(".eslintrc.js") ||
    fs.exists(".eslintrc.yml") ||
    fs.exists(".eslintrc");
  if (!hasEslintConfig) {
    const pkg = fs.readJson("package.json") as Record<string, unknown> | null;
    const devDeps = (pkg?.devDependencies ?? {}) as Record<string, unknown>;
    if (devDeps["eslint"]) {
      staticAnalysis.push({ tool: "eslint", level: null });
    }
  } else {
    staticAnalysis.push({ tool: "eslint", level: null });
  }

  // JS/TS: biome
  if (fs.exists("biome.json") || fs.exists("biome.jsonc")) {
    staticAnalysis.push({ tool: "biome", level: null });
  }

  // Go: golangci-lint
  if (
    fs.exists(".golangci.yml") ||
    fs.exists(".golangci.yaml") ||
    fs.exists(".golangci.toml")
  ) {
    staticAnalysis.push({ tool: "golangci-lint", level: null });
  }

  // Rust: clippy (detected via Cargo.toml presence - clippy ships with rustup)
  if (fs.exists("Cargo.toml")) {
    staticAnalysis.push({ tool: "clippy", level: null });
  }

  // Ruby: rubocop
  if (fs.exists(".rubocop.yml") || fs.exists(".rubocop.yaml")) {
    staticAnalysis.push({ tool: "rubocop", level: null });
  }

  // Python: pylint
  if (fs.exists(".pylintrc") || fs.exists("pylintrc")) {
    staticAnalysis.push({ tool: "pylint", level: null });
  }

  return staticAnalysis;
}

/** Compliance-sensitive docs are signal-only; audit policy decides whether they matter. */
function detectComplianceSignals(fs: ReadonlyFS): boolean {
  return fileContainsPattern(
    fs,
    PROJECT_STACK_COMPLIANCE_DOCS,
    /\bPHI\b|HIPAA|GDPR|patient.*data|health.*record/i,
  );
}

/** Combine formatter-related commands into one searchable string. */
function getFormatterSources(formatCommand: string | null): string {
  return (formatCommand ?? "").toLowerCase();
}

/** Decide whether formatter-gap checks should apply to the given language. */
function shouldCheckFormatter(lang: string, languages: string[]): boolean {
  if (lang !== "bash") return true;
  return (
    languages[0] === "bash" ||
    (languages.includes("bash") && languages.length <= 2)
  );
}

/**
 * List the detected languages that the project's format command does not appear to cover.
 *
 * Use when building setup signals so the prompt can name the specific languages missing a formatter instead of a generic nudge.
 * Matching is a substring test against the format command text, so a formatter invoked through an unrelated wrapper script reads as a gap.
 *
 * Bash is only checked when it is the primary language or one of at most two languages overall,
 * because a repo carrying a few shell scripts should not be told to adopt a shell formatter.
 *
 * @param languages - detected languages, most significant first; the first entry drives the bash rule
 * @param formatCommand - the project's format script; `null` is treated as no formatter configured,
 *   so every language with a known formatter counts as a gap
 * @returns gap languages in `languages` order; empty means every language with a known formatter is
 *   covered, and languages absent from the formatter map are never reported either way
 */
function detectFormatterGaps(
  languages: string[],
  formatCommand: string | null,
): string[] {
  const formatterSources = getFormatterSources(formatCommand);
  const formatterGaps: string[] = [];

  for (const lang of languages) {
    if (!shouldCheckFormatter(lang, languages)) continue;
    const known = PROJECT_STACK_FORMATTER_MAP[lang];
    if (!known) continue;
    if (!known.some((formatter) => formatterSources.includes(formatter))) {
      formatterGaps.push(lang);
    }
  }

  return formatterGaps;
}

/**
 * Aggregate every secondary signal into one ProjectSignals record for the setup and audit pipelines.
 * The single entry point so callers run detection once and read a complete picture rather than invoking each detector piecemeal.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @param languages - detected languages in precedence order; gates per-language formatter checks
 * @param formatCommand - the project's configured format command, or null when none is detected
 * @returns the populated signal record; list fields are empty (not null) when nothing is detected
 */
export function detectProjectSignals(
  fs: ReadonlyFS,
  languages: string[],
  formatCommand: string | null,
): ProjectSignals {
  return {
    codeGenTools: collectNamedSignals(
      fs,
      PROJECT_STACK_CODE_GENERATION_SIGNALS,
    ),
    deployPlatforms: collectNamedSignals(fs, PROJECT_STACK_DEPLOYMENT_SIGNALS),
    llmIntegration: detectLLMIntegration(fs),
    staticAnalysis: detectStaticAnalysis(fs),
    complianceSignals: detectComplianceSignals(fs),
    formatterGaps: detectFormatterGaps(languages, formatCommand),
  };
}
