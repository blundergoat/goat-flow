/**
 * Works out what a project is built from, its languages, frameworks, and the test, lint, build, and format commands it already has.
 *
 * This runs the moment a user selects a project, and it is what pre-fills the Setup form instead of asking them to type it all in.
 *
 * Detection reads what is actually in the repository rather than trusting configuration, so:
 * - a dependency present only in devDependencies does not make its language look like something the project ships
 * - placeholder scripts such as the npm-init test stub are ignored rather than offered as a real command
 */
import type { StackInfo, ReadonlyFS } from "../types.js";
import {
  PROJECT_STACK_EXTRA_LANGUAGE_SIGNALS,
  PROJECT_STACK_JAVA_MANIFEST_PATHS,
  PROJECT_STACK_NODE_FRAMEWORKS,
  PROJECT_STACK_ROOT_PYTHON_FILES,
  PROJECT_STACK_SETUP_FRAMEWORK_MARKERS,
  PROJECT_STACK_SUBDIRECTORY_PYTHON_GLOBS,
} from "./project-stack-data.js";
import {
  hasAnyGlob,
  hasAnyPath,
  readFirstExistingFile,
} from "./project-stack-files.js";
import {
  countSourceFiles,
  detectProjectSignals,
} from "./project-stack-signals.js";

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
  for (const detector of PROJECT_STACK_NODE_FRAMEWORKS) {
    if (hasAnyDependency(deps, detector.packages)) {
      addLanguageIfMissing(languages, detector.language);
    }
  }

  return languages;
}

/**
 * Turn the repository-root `package.json` into the languages and commands setup reports.
 *
 * Use for the root manifest only; monorepo subdirectory manifests are detected separately.
 *
 * Runtime and dev dependencies are passed on separately as well as merged, because a package present only in
 * `devDependencies` should not make its language look like something the project ships.
 *
 * @param fs - readonly project filesystem, used for language markers the manifest only implies
 *   (`tsconfig.json`, Node source files)
 * @param pkg - parsed root `package.json`; missing `dependencies`, `devDependencies`, or `scripts`
 *   keys each degrade to empty rather than throwing
 * @returns detected languages plus any build/test/lint/format commands; placeholder scripts such as
 *   the npm-init default test stub are filtered out and come back as null
 */
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

/** Root Python manifests can name framework dependencies that plain file globs cannot. */
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
  const hasRootPython = hasAnyPath(fs, PROJECT_STACK_ROOT_PYTHON_FILES);
  const hasSubdirPython =
    !hasRootPython && hasAnyGlob(fs, PROJECT_STACK_SUBDIRECTORY_PYTHON_GLOBS);
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

/** Java framework identity comes from manifest content because file names only reveal the build tool. */
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

  const manifest =
    readFirstExistingFile(fs, PROJECT_STACK_JAVA_MANIFEST_PATHS) ?? "";
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

/** Treat shell as a language when scripts exist anywhere, even without a package manifest. */
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

/** Apply data-table language signals after primary manifest detectors have run. */
function detectExtraLanguages(fs: ReadonlyFS): string[] {
  const languages: string[] = [];

  for (const signal of PROJECT_STACK_EXTRA_LANGUAGE_SIGNALS) {
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

/**
 * Detect languages and workflow commands from manifests and source files.
 *
 * Detector order intentionally preserves command priority: the first detector that supplies a build/test/lint/format command wins, while language
 * labels are merged across all detectors.
 *
 * @param fs Read-only project filesystem abstraction.
 * @returns Canonical stack info, source count, and richer project signals.
 */
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
  for (const detector of PROJECT_STACK_SETUP_FRAMEWORK_MARKERS) {
    if (hasFrameworkMarker(fs, detector.files, detector.markers)) {
      addSetupLabelIfMissing(frameworks, detector.name);
    }
  }
  return frameworks;
}

/**
 * Build the setup-view stack summary from the canonical detector output.
 *
 * @param fs Read-only project filesystem abstraction.
 * @returns Dashboard-friendly labels and command slots derived from `detectStack`.
 */
export function detectSetupStack(fs: ReadonlyFS): SetupStackSummary {
  const stack = detectStack(fs);
  return {
    languages: buildSetupLanguages(stack.languages),
    frameworks: buildSetupFrameworks(fs, stack.languages),
    commands: buildSetupCommands(stack),
  };
}
