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

/** One detected static-analysis tool, with its configured strictness when the tool records one. */
interface StaticAnalysisEntry {
  tool: string;
  level: string | null;
}

const ESLINT_CONFIG_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc.json",
  ".eslintrc.js",
  ".eslintrc.yml",
  ".eslintrc",
] as const;

const RUFF_CONFIG_FILES = ["ruff.toml", ".ruff.toml"] as const;

/**
 * Tools whose presence is decided purely by finding one of their config files, with no strictness level to read.
 *
 * Clippy is keyed on `Cargo.toml` because it ships with rustup, so any Cargo project already has it available.
 */
const CONFIG_FILE_ANALYSERS: ReadonlyArray<{
  tool: string;
  configFiles: readonly string[];
}> = [
  { tool: "biome", configFiles: ["biome.json", "biome.jsonc"] },
  {
    tool: "golangci-lint",
    configFiles: [".golangci.yml", ".golangci.yaml", ".golangci.toml"],
  },
  { tool: "clippy", configFiles: ["Cargo.toml"] },
  { tool: "rubocop", configFiles: [".rubocop.yml", ".rubocop.yaml"] },
  { tool: "pylint", configFiles: [".pylintrc", "pylintrc"] },
];

/**
 * Detect PHPStan and the strictness level the project configured.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @returns the entry, or null when neither PHPStan config file is present; a present config with no level reports a null level
 */
function detectPhpstan(fs: ReadonlyFS): StaticAnalysisEntry | null {
  const config =
    fs.readFile("phpstan.neon") ?? fs.readFile("phpstan.neon.dist");
  if (!config) return null;
  return {
    tool: "phpstan",
    level: config.match(/level:\s*(\d+|max)/)?.[1] ?? null,
  };
}

/**
 * Detect mypy, which needs a `[mypy]` section rather than just a file, because `setup.cfg` exists in many non-mypy projects.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @returns the entry, or null when no config carries a `[mypy]` section; a non-strict config reports a null level
 */
function detectMypy(fs: ReadonlyFS): StaticAnalysisEntry | null {
  const config = fs.readFile("mypy.ini") ?? fs.readFile("setup.cfg");
  if (!config || !/\[mypy\]/i.test(config)) return null;
  const strictMatch = config.match(/strict\s*=\s*(true|false)/i);
  return { tool: "mypy", level: strictMatch?.[1] === "true" ? "strict" : null };
}

/**
 * Detect ruff from its own config files or from a `[tool.ruff` section inside `pyproject.toml`.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @returns the entry, or null when ruff is configured nowhere
 */
function detectRuff(fs: ReadonlyFS): StaticAnalysisEntry | null {
  const isConfigured =
    hasAnyPath(fs, RUFF_CONFIG_FILES) ||
    (fs.readFile("pyproject.toml")?.includes("[tool.ruff") ?? false);
  return isConfigured ? { tool: "ruff", level: null } : null;
}

/**
 * Detect eslint from any of its config shapes, falling back to a devDependency entry.
 *
 * The dependency fallback matters because a project can rely on a shared config package and keep no config file of its own.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @returns the entry, or null when neither a config file nor the devDependency is present
 */
function detectEslint(fs: ReadonlyFS): StaticAnalysisEntry | null {
  if (hasAnyPath(fs, ESLINT_CONFIG_FILES))
    return { tool: "eslint", level: null };
  const packageJson = fs.readJson("package.json") as Record<
    string,
    unknown
  > | null;
  const devDependencies = (packageJson?.devDependencies ?? {}) as Record<
    string,
    unknown
  >;
  return devDependencies["eslint"] ? { tool: "eslint", level: null } : null;
}

/**
 * Report every static-analysis tool the project has configured, in a stable order.
 *
 * This feeds the setup prompt, so the user is told which linters they already have rather than being advised to add one they run daily.
 *
 * @param fs - read-only filesystem adapter for the target project
 * @returns the detected tools; empty means the project configures none, which the prompt treats as a gap worth mentioning
 */
function detectStaticAnalysis(fs: ReadonlyFS): StaticAnalysisEntry[] {
  const levelledDetections = [
    detectPhpstan(fs),
    detectMypy(fs),
    detectRuff(fs),
    detectEslint(fs),
  ].filter((entry): entry is StaticAnalysisEntry => entry !== null);

  const configFileDetections = CONFIG_FILE_ANALYSERS.filter((analyser) =>
    hasAnyPath(fs, analyser.configFiles),
  ).map((analyser) => ({ tool: analyser.tool, level: null }));

  return [...levelledDetections, ...configFileDetections];
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
 * Use when building setup signals, so the prompt names the specific languages missing a formatter rather than a
 * generic nudge. Matching is a substring test, so a formatter invoked through a wrapper script reads as a gap.
 *
 * @param languages - detected languages, most significant first; the first entry drives the bash rule, which only
 *   applies when bash is primary or one of at most two languages, because a repo carrying a few shell scripts
 *   should not be told to adopt a shell formatter
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
