/**
 * Project stack detector for languages, frameworks, and workflow signals.
 * The setup pipeline and audit checks rely on this file to infer commands and template routing from repository contents.
 */
import { readFileSync } from "node:fs";
import type { StackInfo, ProjectSignals, ReadonlyFS } from "../types.js";
import { getTemplatePath } from "../paths.js";

/** Partial detection result from a single language detector */
interface DetectorResult {
  languages?: string[];
  buildCommand?: string | null;
  testCommand?: string | null;
  lintCommand?: string | null;
  formatCommand?: string | null;
}

/** Setup-view command slots derived from the canonical stack detector. */
interface SetupCommandSlots {
  test: string;
  lint: string;
  build: string;
  format: string;
}

/** Setup-view stack summary consumed by the dashboard setup route. */
interface SetupStackSummary {
  languages: string[];
  frameworks: string[];
  commands: SetupCommandSlots;
}

interface NodeFrameworkSignal {
  language: string;
  packages: string[];
}

interface NamedPathGlobSignal {
  paths: string[];
  globs: string[];
}

interface LanguagePathGlobSignal extends NamedPathGlobSignal {
  language: string;
}

interface ToolPathGlobSignal extends NamedPathGlobSignal {
  tool: string;
}

interface SetupFrameworkMarkerSignal {
  name: string;
  files: string[];
  markers: string[];
}

interface NodeTestFrameworkSignal {
  name: string;
  packages: string[];
}

interface ProjectStackData {
  nodeFrameworks: NodeFrameworkSignal[];
  nodeTestFrameworks: NodeTestFrameworkSignal[];
  extraLanguageSignals: LanguagePathGlobSignal[];
  codeGenSignals: ToolPathGlobSignal[];
  deploySignals: ToolPathGlobSignal[];
  setupFrameworkMarkers: SetupFrameworkMarkerSignal[];
  rootPythonFiles: string[];
  subdirPythonGlobs: string[];
  javaManifestPaths: string[];
  llmEnvFiles: string[];
  llmDepFiles: string[];
  complianceDocs: string[];
  formatterMap: Record<string, string[]>;
}

/** Relative path to the shipped project-stack data tables. */
const PROJECT_STACK_DATA_PATH = "workflow/project-stack-data.json";

/** Check whether a parsed JSON value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a string array from the project-stack data JSON. */
function readStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} array`);
  }
  return [...value];
}

/** Read language/path/glob signal rows from the project-stack data JSON. */
function readLanguageSignals(
  value: unknown,
  label: string,
): LanguagePathGlobSignal[] {
  if (!Array.isArray(value)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} list`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.language !== "string") {
      throw new Error(
        `${PROJECT_STACK_DATA_PATH} has an invalid ${label}[${index}] entry`,
      );
    }
    return {
      language: entry.language,
      paths: readStringArray(entry.paths, `${label}[${index}].paths`),
      globs: readStringArray(entry.globs, `${label}[${index}].globs`),
    };
  });
}

/** Read tool/path/glob signal rows from the project-stack data JSON. */
function readToolSignals(value: unknown, label: string): ToolPathGlobSignal[] {
  if (!Array.isArray(value)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} list`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.tool !== "string") {
      throw new Error(
        `${PROJECT_STACK_DATA_PATH} has an invalid ${label}[${index}] entry`,
      );
    }
    return {
      tool: entry.tool,
      paths: readStringArray(entry.paths, `${label}[${index}].paths`),
      globs: readStringArray(entry.globs, `${label}[${index}].globs`),
    };
  });
}

/** Read setup-framework marker rows from the project-stack data JSON. */
function readSetupFrameworkMarkers(
  value: unknown,
  label: string,
): SetupFrameworkMarkerSignal[] {
  if (!Array.isArray(value)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} list`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      throw new Error(
        `${PROJECT_STACK_DATA_PATH} has an invalid ${label}[${index}] entry`,
      );
    }
    return {
      name: entry.name,
      files: readStringArray(entry.files, `${label}[${index}].files`),
      markers: readStringArray(entry.markers, `${label}[${index}].markers`),
    };
  });
}

/** Read Node framework rows from the project-stack data JSON. */
function readNodeFrameworkSignals(
  value: unknown,
  label: string,
): NodeFrameworkSignal[] {
  if (!Array.isArray(value)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} list`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.language !== "string") {
      throw new Error(
        `${PROJECT_STACK_DATA_PATH} has an invalid ${label}[${index}] entry`,
      );
    }
    return {
      language: entry.language,
      packages: readStringArray(entry.packages, `${label}[${index}].packages`),
    };
  });
}

/** Read Node test framework rows from the project-stack data JSON. */
function readNodeTestFrameworkSignals(
  value: unknown,
  label: string,
): NodeTestFrameworkSignal[] {
  if (!Array.isArray(value)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid ${label} list`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      throw new Error(
        `${PROJECT_STACK_DATA_PATH} has an invalid ${label}[${index}] entry`,
      );
    }
    return {
      name: entry.name,
      packages: readStringArray(entry.packages, `${label}[${index}].packages`),
    };
  });
}

/** Read the formatter map from the project-stack data JSON. */
function readFormatterMap(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} has an invalid formatterMap`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([language, formatters]) => [
      language,
      readStringArray(formatters, `formatterMap.${language}`),
    ]),
  );
}

/** Load the shipped project-stack detection tables. */
function loadProjectStackData(): ProjectStackData {
  const path = getTemplatePath(PROJECT_STACK_DATA_PATH);
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (!isRecord(raw)) {
    throw new Error(`${PROJECT_STACK_DATA_PATH} must contain a JSON object`);
  }
  return {
    nodeFrameworks: readNodeFrameworkSignals(
      raw.nodeFrameworks,
      "nodeFrameworks",
    ),
    nodeTestFrameworks: readNodeTestFrameworkSignals(
      raw.nodeTestFrameworks,
      "nodeTestFrameworks",
    ),
    extraLanguageSignals: readLanguageSignals(
      raw.extraLanguageSignals,
      "extraLanguageSignals",
    ),
    codeGenSignals: readToolSignals(raw.codeGenSignals, "codeGenSignals"),
    deploySignals: readToolSignals(raw.deploySignals, "deploySignals"),
    setupFrameworkMarkers: readSetupFrameworkMarkers(
      raw.setupFrameworkMarkers,
      "setupFrameworkMarkers",
    ),
    rootPythonFiles: readStringArray(raw.rootPythonFiles, "rootPythonFiles"),
    subdirPythonGlobs: readStringArray(
      raw.subdirPythonGlobs,
      "subdirPythonGlobs",
    ),
    javaManifestPaths: readStringArray(
      raw.javaManifestPaths,
      "javaManifestPaths",
    ),
    llmEnvFiles: readStringArray(raw.llmEnvFiles, "llmEnvFiles"),
    llmDepFiles: readStringArray(raw.llmDepFiles, "llmDepFiles"),
    complianceDocs: readStringArray(raw.complianceDocs, "complianceDocs"),
    formatterMap: readFormatterMap(raw.formatterMap),
  };
}

const PROJECT_STACK_DATA = loadProjectStackData();

/** Node.js framework indicators matched against package dependencies. */
const NODE_FRAMEWORKS = PROJECT_STACK_DATA.nodeFrameworks;
/** Additional language/template indicators beyond primary manifest detection. */
const EXTRA_LANGUAGE_SIGNALS = PROJECT_STACK_DATA.extraLanguageSignals;
/** Code generation tool indicators detected from config files. */
const CODE_GEN_SIGNALS = PROJECT_STACK_DATA.codeGenSignals;
/** Deployment platform indicators detected from config files. */
const DEPLOY_SIGNALS = PROJECT_STACK_DATA.deploySignals;
/** Extra framework markers used only for setup-view framework display names. */
const SETUP_FRAMEWORK_MARKERS = PROJECT_STACK_DATA.setupFrameworkMarkers;
/** Root-level files that indicate a Python project. */
const ROOT_PYTHON_FILES = PROJECT_STACK_DATA.rootPythonFiles;
/** Glob patterns for detecting Python projects in subdirectories. */
const SUBDIR_PYTHON_GLOBS = PROJECT_STACK_DATA.subdirPythonGlobs;
/** Build manifest paths read to detect Java framework dependencies. */
const JAVA_MANIFEST_PATHS = PROJECT_STACK_DATA.javaManifestPaths;
/** Environment files checked for LLM provider API key variables. */
const LLM_ENV_FILES = PROJECT_STACK_DATA.llmEnvFiles;
/** Dependency files checked for LLM SDK references. */
const LLM_DEP_FILES = PROJECT_STACK_DATA.llmDepFiles;
/** Files checked for compliance-related keywords (HIPAA, GDPR, etc.). */
const COMPLIANCE_DOCS = PROJECT_STACK_DATA.complianceDocs;
/** Maps languages to their known formatter tool names for gap detection. */
const FORMATTER_MAP = PROJECT_STACK_DATA.formatterMap;

/** Display labels for canonical stack language ids shown in the setup UI. */
const SETUP_LANGUAGE_LABELS: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  php: "PHP",
  python: "Python",
  go: "Go",
  rust: "Rust",
  ruby: "Ruby",
  java: "Java",
  csharp: "C#",
  bash: "Bash",
  swift: "Swift",
  kotlin: "Kotlin",
  markdown: "Markdown",
  blade: "Blade",
  jinja: "Jinja",
  twig: "Twig",
  erb: "ERB",
};

/** Framework labels that map directly from canonical stack language ids. */
const STACK_LANGUAGE_FRAMEWORK_LABELS: Record<string, string> = {
  react: "React",
  vue: "Vue",
  angular: "Angular",
  svelte: "Svelte",
  express: "Express",
  django: "Django",
  fastapi: "FastAPI",
  laravel: "Laravel",
  symfony: "Symfony",
  rails: "Rails",
  spring: "Spring",
  blazor: "Blazor",
};

/** Check if an npm script command is a placeholder (npm init default) */
function isPlaceholderScript(cmd: string): boolean {
  return (
    /^echo\s+"Error:/.test(cmd) ||
    /^echo\s+"no\s+(test|build)/.test(cmd) ||
    /^exit\s+1$/.test(cmd.trim()) ||
    /^echo\s+.*&&\s*exit\s+1$/.test(cmd.trim())
  );
}

/** Extract commands from a package.json scripts block */
function extractNodeCommands(
  scripts: Record<string, string>,
): Pick<
  DetectorResult,
  "buildCommand" | "testCommand" | "lintCommand" | "formatCommand"
> {
  /** Drop empty or intentionally placeholder script commands from detection output. */
  /** Keep only real script commands that should survive stack detection. */
  const filterPlaceholder = (cmd: string | undefined): string | null => {
    if (!cmd || isPlaceholderScript(cmd)) return null;
    return cmd;
  };
  // Test command: try exact match first, then scan for test-like script names
  let testCommand = filterPlaceholder(scripts.test);
  if (!testCommand) {
    const testPatterns = [
      "e2e",
      "cypress",
      "spec",
      "test:unit",
      "test:e2e",
      "test:integration",
    ];
    for (const pattern of testPatterns) {
      if (scripts[pattern] && !isPlaceholderScript(scripts[pattern])) {
        testCommand = `npm run ${pattern}`;
        break;
      }
    }
    // Fallback: first script name containing "test"
    if (!testCommand) {
      const testKey = Object.keys(scripts).find(
        (k) =>
          k.includes("test") &&
          scripts[k] !== undefined &&
          !isPlaceholderScript(scripts[k]),
      );
      if (testKey) testCommand = `npm run ${testKey}`;
    }
  }

  return {
    buildCommand: filterPlaceholder(scripts.build),
    testCommand,
    lintCommand: filterPlaceholder(scripts.lint),
    formatCommand: filterPlaceholder(scripts.format ?? scripts["format:check"]),
  };
}

/** Check if TypeScript is present in subdirectories (monorepo) */
function hasSubdirTypeScript(fs: ReadonlyFS): boolean {
  return fs.existsGlob("*/tsconfig.json") || fs.existsGlob("*/*/tsconfig.json");
}

/** Add a language label once without disturbing existing detection order. */
function addLanguageIfMissing(languages: string[], language: string): void {
  if (languages.includes(language) === false) {
    languages.push(language);
  }
}

/** Add a setup display label once without disturbing existing order. */
function addSetupLabelIfMissing(labels: string[], label: string): void {
  if (labels.includes(label) === false) {
    labels.push(label);
  }
}

/** Detect whether any package in a candidate set is present in a dependency map. */
function hasAnyDependency(
  deps: Record<string, string>,
  packages: readonly string[],
): boolean {
  return packages.some((pkg) => pkg in deps);
}

/** Detect common JavaScript or TypeScript source roots without package metadata. */
function hasNodeSourceFiles(fs: ReadonlyFS): boolean {
  return (
    fs.existsGlob("src/**/*.ts") ||
    fs.existsGlob("src/**/*.js") ||
    fs.existsGlob("lib/**/*.js")
  );
}

/** Infer JavaScript, TypeScript, and framework labels from Node manifests and files. */
function collectNodeLanguages(
  fs: ReadonlyFS,
  runtimeDeps: Record<string, string> | undefined,
  deps: Record<string, string>,
): string[] {
  const languages: string[] = [];
  const hasRuntimeDeps =
    runtimeDeps !== undefined && Object.keys(runtimeDeps).length > 0;
  const hasTypeScript = "typescript" in deps || fs.exists("tsconfig.json");

  if (hasRuntimeDeps || hasNodeSourceFiles(fs) || hasTypeScript) {
    addLanguageIfMissing(languages, "javascript");
  }
  if (hasTypeScript) {
    addLanguageIfMissing(languages, "typescript");
  }
  for (const detector of NODE_FRAMEWORKS) {
    if (hasAnyDependency(deps, detector.packages)) {
      addLanguageIfMissing(languages, detector.language);
    }
  }

  return languages;
}

/** Detect root node stack. */
function detectRootNodeStack(
  fs: ReadonlyFS,
  pkg: Record<string, unknown>,
): DetectorResult {
  const runtimeDeps = pkg.dependencies as Record<string, string> | undefined;
  const devDeps = pkg.devDependencies as Record<string, string> | undefined;
  const deps = { ...runtimeDeps, ...devDeps };
  const scripts = pkg.scripts as Record<string, string> | undefined;
  const commands = scripts ? extractNodeCommands(scripts) : {};

  return {
    languages: collectNodeLanguages(fs, runtimeDeps, deps),
    ...commands,
  };
}

/** Detect subdirectory package manifests for monorepo-style Node projects. */
function hasSubdirNodePackage(fs: ReadonlyFS): boolean {
  return fs.existsGlob("*/package.json") || fs.existsGlob("*/*/package.json");
}

/** Detect Node.js / TypeScript from package.json (root or subdirectory) */
function detectNodeStack(fs: ReadonlyFS): DetectorResult {
  const pkg = fs.readJson("package.json") as Record<string, unknown> | null;
  if (pkg) {
    return detectRootNodeStack(fs, pkg);
  }

  // Monorepo: check subdirectory manifests if not detected at root
  if (hasSubdirNodePackage(fs)) {
    const languages: string[] = ["javascript"];
    if (hasSubdirTypeScript(fs)) {
      languages.push("typescript");
    }
    return { languages };
  }

  return {};
}

/** Detect Go from go.mod (root or subdirectory, up to 2 levels deep) */
function detectGoStack(fs: ReadonlyFS): DetectorResult {
  if (
    fs.exists("go.mod") ||
    fs.existsGlob("*/go.mod") ||
    fs.existsGlob("*/*/go.mod")
  ) {
    return {
      languages: ["go"],
      buildCommand: "go build ./...",
      testCommand: "go test ./...",
      lintCommand: "go vet ./...",
      formatCommand: "gofmt -l .",
    };
  }
  return {};
}

/** Detect Rust from Cargo.toml (root or subdirectory) */
function detectRustStack(fs: ReadonlyFS): DetectorResult {
  if (fs.exists("Cargo.toml") || fs.existsGlob("*/Cargo.toml")) {
    return {
      languages: ["rust"],
      buildCommand: "cargo build",
      testCommand: "cargo test",
      lintCommand: "cargo clippy",
      formatCommand: "cargo fmt --check",
    };
  }
  return {};
}

/** Detect whether any exact path in a candidate list exists. */
function hasAnyPath(fs: ReadonlyFS, paths: readonly string[]): boolean {
  return paths.some((path) => fs.exists(path));
}

/** Detect whether any glob in a candidate list matches at least one file. */
function hasAnyGlob(fs: ReadonlyFS, globs: readonly string[]): boolean {
  return globs.some((pattern) => fs.existsGlob(pattern));
}

/** Read the first file in a candidate list that actually exists. */
function readFirstExistingFile(
  fs: ReadonlyFS,
  paths: readonly string[],
): string | null {
  for (const path of paths) {
    const content = fs.readFile(path);
    if (content !== null) return content;
  }
  return null;
}

/** Detect python languages. */
function detectPythonLanguages(fs: ReadonlyFS): string[] {
  const languages: string[] = ["python"];
  const pyContent =
    fs.readFile("requirements.txt") ?? fs.readFile("pyproject.toml") ?? "";
  if (/\bdjango\b/i.test(pyContent)) languages.push("django");
  if (/\bfastapi\b/i.test(pyContent)) languages.push("fastapi");
  return languages;
}

/** Detect Python projects from root or subdirectory manifests. */
function detectPythonStack(fs: ReadonlyFS): DetectorResult {
  const hasRootPython = hasAnyPath(fs, ROOT_PYTHON_FILES);
  const hasSubdirPython = !hasRootPython && hasAnyGlob(fs, SUBDIR_PYTHON_GLOBS);
  if (!hasRootPython && !hasSubdirPython) {
    return {};
  }

  const languages = detectPythonLanguages(fs);
  return hasRootPython
    ? { languages, testCommand: "pytest", lintCommand: "ruff check" }
    : { languages };
}

/** Detect php languages. */
function detectPHPLanguages(
  fs: ReadonlyFS,
  composer: Record<string, unknown>,
): string[] {
  const languages: string[] = ["php"];
  const require = composer.require as Record<string, string> | undefined;

  if (require && "laravel/framework" in require)
    addLanguageIfMissing(languages, "laravel");
  if (require && "symfony/framework-bundle" in require)
    addLanguageIfMissing(languages, "symfony");
  if (fs.exists("artisan")) addLanguageIfMissing(languages, "laravel");
  if (fs.exists("symfony.lock")) addLanguageIfMissing(languages, "symfony");

  return languages;
}

/** Return the first script value that exists in a composer scripts block. */
function firstDefinedScript(
  scripts: Record<string, string>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    if (scripts[key] !== undefined) {
      return scripts[key] ?? null;
    }
  }
  return null;
}

/** Extract php commands from scripts. */
function extractPHPCommandsFromScripts(
  scripts: Record<string, string>,
): Pick<DetectorResult, "testCommand" | "lintCommand" | "formatCommand"> {
  return {
    testCommand: scripts.test ?? null,
    lintCommand: firstDefinedScript(scripts, ["analyse", "lint"]),
    formatCommand: firstDefinedScript(scripts, ["cs:check", "cs:fix"]),
  };
}

/** Extract php commands. */
function extractPHPCommands(
  composer: Record<string, unknown>,
): Pick<DetectorResult, "testCommand" | "lintCommand" | "formatCommand"> {
  const scripts = composer.scripts as Record<string, string> | undefined;
  return scripts
    ? extractPHPCommandsFromScripts(scripts)
    : {
        testCommand: null,
        lintCommand: null,
        formatCommand: null,
      };
}

/** Detect PHP projects from root or subdirectory composer manifests. */
function detectPHPStack(fs: ReadonlyFS): DetectorResult {
  const composer = fs.readJson("composer.json") as Record<
    string,
    unknown
  > | null;
  if (composer) {
    return {
      languages: detectPHPLanguages(fs, composer),
      ...extractPHPCommands(composer),
    };
  }

  // Monorepo: check subdirectory manifests if not detected at root
  if (fs.existsGlob("*/composer.json")) {
    return { languages: ["php"] };
  }
  return {};
}

/** Detect Ruby from Gemfile */
function detectRubyStack(fs: ReadonlyFS): DetectorResult {
  if (fs.exists("Gemfile") || fs.existsGlob("*/Gemfile")) {
    const languages: string[] = ["ruby"];
    const gemfile = fs.readFile("Gemfile") ?? "";
    if (/gem\s+['"]rails['"]/.test(gemfile) || fs.exists("bin/rails")) {
      languages.push("rails");
    }
    return {
      languages,
      testCommand: "bundle exec rspec",
      lintCommand: "bundle exec rubocop",
    };
  }
  return {};
}

/** Detect java languages. */
function detectJavaLanguages(manifest: string): string[] {
  const languages: string[] = ["java"];
  if (/spring-boot/i.test(manifest)) {
    languages.push("spring");
  }
  return languages;
}

/** Return java commands. */
function getJavaCommands(
  hasMaven: boolean,
): Pick<DetectorResult, "buildCommand" | "testCommand"> {
  return hasMaven
    ? { buildCommand: "mvn package", testCommand: "mvn test" }
    : { buildCommand: "gradle build", testCommand: "gradle test" };
}

/** Detect Java from pom.xml or build.gradle */
function detectJavaStack(fs: ReadonlyFS): DetectorResult {
  const hasMaven = fs.exists("pom.xml") || fs.existsGlob("*/pom.xml");
  const hasGradle =
    fs.existsGlob("build.gradle*") || fs.existsGlob("*/build.gradle*");
  if (!hasMaven && !hasGradle) {
    return {};
  }

  const manifest = readFirstExistingFile(fs, JAVA_MANIFEST_PATHS) ?? "";
  return {
    languages: detectJavaLanguages(manifest),
    ...getJavaCommands(hasMaven),
  };
}

/** Detect .NET from *.csproj or *.sln */
function detectDotnetStack(fs: ReadonlyFS): DetectorResult {
  if (fs.existsGlob("**/*.csproj") || fs.existsGlob("*.sln")) {
    return {
      languages: ["csharp"],
      buildCommand: "dotnet build",
      testCommand: "dotnet test",
    };
  }
  return {};
}

/** Detect shell scripts */
function detectShellScripts(fs: ReadonlyFS): DetectorResult {
  if (fs.existsGlob("**/*.sh")) {
    return { languages: ["bash"] };
  }
  return {};
}

/** Detect markdown-only (docs) project - only when no other languages found */
function detectMarkdownOnly(fs: ReadonlyFS): DetectorResult {
  if (fs.glob("**/*.md").length > 5) {
    return { languages: ["markdown"] };
  }
  return {};
}

/** Merge detected language labels while preserving first-seen order. */
function mergeLanguages(target: string[], languages?: string[]): void {
  for (const language of languages ?? []) {
    addLanguageIfMissing(target, language);
  }
}

/** Keep the first non-null command discovered across detector passes. */
function firstDetectedCommand(
  current: string | null,
  next?: string | null,
): string | null {
  return current ?? next ?? null;
}

/** Merge newly detected commands into the accumulated stack result. */
function mergeCommands(
  result: DetectorResult,
  commands: Pick<
    StackInfo,
    "buildCommand" | "testCommand" | "lintCommand" | "formatCommand"
  >,
): void {
  commands.buildCommand = firstDetectedCommand(
    commands.buildCommand,
    result.buildCommand,
  );
  commands.testCommand = firstDetectedCommand(
    commands.testCommand,
    result.testCommand,
  );
  commands.lintCommand = firstDetectedCommand(
    commands.lintCommand,
    result.lintCommand,
  );
  commands.formatCommand = firstDetectedCommand(
    commands.formatCommand,
    result.formatCommand,
  );
}

/** Combine detector outputs into the final stack info shape. */
function mergeDetectorResults(
  detectors: DetectorResult[],
): Omit<StackInfo, "signals" | "sourceFileCount"> {
  const languages: string[] = [];
  const commands: Pick<
    StackInfo,
    "buildCommand" | "testCommand" | "lintCommand" | "formatCommand"
  > = {
    buildCommand: null,
    testCommand: null,
    lintCommand: null,
    formatCommand: null,
  };

  for (const result of detectors) {
    mergeLanguages(languages, result.languages);
    mergeCommands(result, commands);
  }

  return { languages, ...commands };
}

/** Detect template-only Jinja usage that would not show up as a normal manifest. */
function hasJinjaSignal(fs: ReadonlyFS): boolean {
  if (fs.existsGlob("**/*.jinja2")) return true;
  return fs
    .glob("**/*.html")
    .filter((file) => /templates\//.test(file))
    .some((file) => {
      const content = fs.readFile(file);
      return content !== null && /\{[%{]/.test(content);
    });
}

/** Detect extra languages. */
function detectExtraLanguages(fs: ReadonlyFS): string[] {
  const languages: string[] = [];

  for (const signal of EXTRA_LANGUAGE_SIGNALS) {
    if (signal.language === "jinja") {
      if (hasJinjaSignal(fs)) languages.push(signal.language);
      continue;
    }
    if (!hasAnyPath(fs, signal.paths) && !hasAnyGlob(fs, signal.globs))
      continue;
    languages.push(signal.language);
  }

  return languages;
}

/** Fall back to markdown-only classification when no code stack was detected. */
function applyMarkdownFallback(fs: ReadonlyFS, languages: string[]): void {
  if (languages.length > 0) return;
  const mdResult = detectMarkdownOnly(fs);
  for (const language of mdResult.languages ?? []) {
    addLanguageIfMissing(languages, language);
  }
}

/** Detect languages and workflow commands from project manifests and source files. */
export function detectStack(fs: ReadonlyFS): StackInfo {
  // Order matters: first detector to provide a command wins (matches original priority)
  const detectorResults: DetectorResult[] = [
    detectNodeStack(fs),
    detectPHPStack(fs),
    detectRustStack(fs),
    detectGoStack(fs),
    detectPythonStack(fs),
    detectRubyStack(fs),
    detectJavaStack(fs),
    detectDotnetStack(fs),
    detectShellScripts(fs),
  ];
  const stack = mergeDetectorResults(detectorResults);

  for (const language of detectExtraLanguages(fs)) {
    addLanguageIfMissing(stack.languages, language);
  }
  applyMarkdownFallback(fs, stack.languages);

  const signals = detectProjectSignals(
    fs,
    stack.languages,
    stack.formatCommand,
  );
  const sourceFileCount = countSourceFiles(fs);
  return { ...stack, sourceFileCount, signals };
}

/** Convert canonical stack command fields into setup-view command slots. */
function buildSetupCommands(stack: {
  testCommand: string | null;
  lintCommand: string | null;
  buildCommand: string | null;
  formatCommand: string | null;
}): SetupCommandSlots {
  return {
    test: stack.testCommand ?? "",
    lint: stack.lintCommand ?? "",
    build: stack.buildCommand ?? "",
    format: stack.formatCommand ?? "",
  };
}

/** Convert canonical stack language ids into setup-view display labels. */
function buildSetupLanguages(stackLanguages: readonly string[]): string[] {
  const labels: string[] = [];
  for (const language of stackLanguages) {
    const display = SETUP_LANGUAGE_LABELS[language];
    if (display) addSetupLabelIfMissing(labels, display);
  }
  return labels;
}

/** Check whether any file in a candidate list contains one of the given markers. */
function hasFrameworkMarker(
  fs: ReadonlyFS,
  files: readonly string[],
  markers: readonly string[],
): boolean {
  return files.some((file) => {
    const content = fs.readFile(file);
    const haystack =
      content ??
      (() => {
        const json = fs.readJson(file);
        return json === null ? null : JSON.stringify(json);
      })();
    if (haystack === null) return false;
    const normalized = haystack.toLowerCase();
    return markers.some((marker) => normalized.includes(marker.toLowerCase()));
  });
}

/** Build setup-view framework labels from canonical stack languages plus a few
 *  extra framework markers not represented as distinct stack language ids. */
function buildSetupFrameworks(
  fs: ReadonlyFS,
  stackLanguages: readonly string[],
): string[] {
  const frameworks: string[] = [];
  for (const language of stackLanguages) {
    const display = STACK_LANGUAGE_FRAMEWORK_LABELS[language];
    if (display) addSetupLabelIfMissing(frameworks, display);
  }
  for (const detector of SETUP_FRAMEWORK_MARKERS) {
    if (hasFrameworkMarker(fs, detector.files, detector.markers)) {
      addSetupLabelIfMissing(frameworks, detector.name);
    }
  }
  return frameworks;
}

/** Build the setup-view stack summary from the canonical detector output. */
export function detectSetupStack(fs: ReadonlyFS): SetupStackSummary {
  const stack = detectStack(fs);
  return {
    languages: buildSetupLanguages(stack.languages),
    frameworks: buildSetupFrameworks(fs, stack.languages),
    commands: buildSetupCommands(stack),
  };
}

/** Count approximate source files (excludes generated/vendor/build dirs). */
function countSourceFiles(fs: ReadonlyFS): number {
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
  detectors: ReadonlyArray<{
    tool: string;
    paths: readonly string[];
    globs: readonly string[];
  }>,
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
      LLM_ENV_FILES,
      /MODEL_PROVIDER|OPENAI_API_KEY|ANTHROPIC_API_KEY|BEDROCK|OLLAMA/i,
    ) ||
    fileContainsPattern(
      fs,
      LLM_DEP_FILES,
      /anthropic|openai|langchain|llamaindex|strands/i,
    )
  );
}

/** Detect static-analysis tooling from project files. */
// eslint-disable-next-line complexity -- detection covers many tool/config combos; extracting would fragment the detector
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

/** Detect compliance signals. */
function detectComplianceSignals(fs: ReadonlyFS): boolean {
  return fileContainsPattern(
    fs,
    COMPLIANCE_DOCS,
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

/** Detect formatter gaps. */
function detectFormatterGaps(
  languages: string[],
  formatCommand: string | null,
): string[] {
  const formatterSources = getFormatterSources(formatCommand);
  const formatterGaps: string[] = [];

  for (const lang of languages) {
    if (!shouldCheckFormatter(lang, languages)) continue;
    const known = FORMATTER_MAP[lang];
    if (!known) continue;
    if (!known.some((formatter) => formatterSources.includes(formatter))) {
      formatterGaps.push(lang);
    }
  }

  return formatterGaps;
}

/** Detect codegen, deploy, LLM, compliance, and formatter-gap project signals. */
function detectProjectSignals(
  fs: ReadonlyFS,
  languages: string[],
  formatCommand: string | null,
): ProjectSignals {
  return {
    codeGenTools: collectNamedSignals(fs, CODE_GEN_SIGNALS),
    deployPlatforms: collectNamedSignals(fs, DEPLOY_SIGNALS),
    llmIntegration: detectLLMIntegration(fs),
    staticAnalysis: detectStaticAnalysis(fs),
    complianceSignals: detectComplianceSignals(fs),
    formatterGaps: detectFormatterGaps(languages, formatCommand),
  };
}
