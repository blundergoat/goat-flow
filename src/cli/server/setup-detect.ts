/**
 * Setup-detection helpers for dashboard routes.
 * These helpers keep project inspection and setup payload shaping out of the
 * main HTTP server so route code can stay focused on request handling.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentProfiles } from "../agents/registry.js";

const AGENT_PROFILES = getAgentProfiles();

/** Existing goat-flow surfaces shown as setup-view checkboxes. */
type ExistingArtifactPresence = Record<
  "skills" | "lessons" | "footguns" | "config",
  boolean
>;

/**
 * Per-surface presence flags driving the setup view's prefill checkboxes. Extends the skill/lessons/
 * footguns/config presence flags with the two Copilot instruction surfaces (repo-wide
 * `copilot-instructions.md` versus path-scoped `.github/instructions/`). Each flag is advisory: true
 * means the surface was detected, false means absent or unreadable, never an error.
 */
interface ExistingArtifacts extends ExistingArtifactPresence {
  instructionsRepoWide: boolean;
  instructionsPathScoped: boolean;
}

/** Command slots inferred for the generated setup prompt. */
interface SetupCommands {
  test: string;
  lint: string;
  build: string;
  format: string;
}

/** Lightweight stack summary used before the full quality/audit paths run. */
interface FastSetupStack {
  languages: string[];
  frameworks: string[];
  commands: SetupCommands;
}

type JsonObject = Record<string, unknown>;

const NODE_FRAMEWORK_PACKAGES: Array<[string, string[]]> = [
  ["React", ["react"]],
  ["Vue", ["vue"]],
  ["Angular", ["@angular/core"]],
  ["Svelte", ["svelte"]],
  ["Express", ["express"]],
  ["Next.js", ["next"]],
  ["NestJS", ["@nestjs/core"]],
];

const BOUNDED_SETUP_DIRS = [
  "src",
  "assets",
  "templates",
  "tests",
  "config",
  "scripts",
  "strands_agents",
];

/** Detect which supported agent surfaces already exist in the project. */
function detectScaffoldedAgents(projectPath: string): Record<string, boolean> {
  return Object.fromEntries(
    AGENT_PROFILES.map((agent) => {
      const markers = [
        agent.instructionFile,
        agent.settingsFile,
        agent.hookConfigFile,
        agent.hooksDir,
      ].filter((value): value is string => typeof value === "string");
      const present = markers.some((marker) =>
        existsSync(join(projectPath, marker)),
      );
      return [agent.id, present];
    }),
  );
}

/**
 * Detect existing goat-flow artifacts for setup prefill.
 *
 * Swallows unreadable skill roots because setup detection is advisory and
 * should not block the dashboard from rendering a recovery prompt.
 */
function detectExistingArtifacts(projectPath: string): ExistingArtifacts {
  const existing: ExistingArtifacts = {
    skills: false,
    instructionsRepoWide: false,
    instructionsPathScoped: false,
    lessons: false,
    footguns: false,
    config: false,
  };

  const skillRoots = [
    ...new Set(AGENT_PROFILES.map((agent) => agent.skillsDir)),
  ];
  for (const root of skillRoots) {
    const skillsDir = join(projectPath, root);
    if (existsSync(skillsDir)) {
      try {
        if (readdirSync(skillsDir).some((entry) => entry.startsWith("goat-"))) {
          existing.skills = true;
          break;
        }
      } catch {
        /* unreadable */
      }
    }
  }

  existing.instructionsRepoWide = existsSync(
    join(projectPath, ".github", "copilot-instructions.md"),
  );
  existing.instructionsPathScoped = existsSync(
    join(projectPath, ".github", "instructions"),
  );
  existing.lessons =
    existsSync(join(projectPath, ".goat-flow", "lessons")) ||
    existsSync(join(projectPath, "ai", "lessons"));
  existing.footguns =
    existsSync(join(projectPath, ".goat-flow", "footguns")) ||
    existsSync(join(projectPath, "docs", "footguns")) ||
    existsSync(join(projectPath, "docs", "footguns.md"));
  existing.config = existsSync(join(projectPath, ".goat-flow", "config.yaml"));

  return existing;
}

/** Detect non-goat-flow agent config files (.github/instructions, CLAUDE.md, etc.). */
function detectNonGoatFlowConfig(projectPath: string): string[] {
  const nonGoatFlow: string[] = [];
  const checks: [string[], string][] = [
    [[".github", "instructions"], ".github/instructions/"],
    [["CLAUDE.md"], "CLAUDE.md"],
    [["AGENTS.md"], "AGENTS.md"],
    [["CODEX.md"], "CODEX.md"],
    [[".cursorrules"], ".cursorrules"],
  ];
  for (const [segments, label] of checks) {
    if (existsSync(join(projectPath, ...segments))) nonGoatFlow.push(label);
  }
  return nonGoatFlow;
}

/** Add a display label once while preserving first-seen order. */
function addLabel(labels: string[], label: string): void {
  if (!labels.includes(label)) labels.push(label);
}

/**
 * Read and parse one root JSON file.
 * Error behavior: throws nothing; a missing, unreadable, or non-object file swallows the failure and
 * reports null, so an unparseable manifest degrades detection instead of failing the whole scan.
 *
 * @param projectPath - project root the file is resolved against
 * @param filename - root-relative filename to read
 * @returns the parsed object, or null when the file is absent, malformed, or not a JSON object
 */
function readRootJson(
  projectPath: string,
  filename: string,
): JsonObject | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(projectPath, filename), "utf-8"),
    );
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : null;
  } catch {
    return null;
  }
}

/** Read one root text file; missing or unreadable files fallback to an empty string. */
function readRootText(projectPath: string, filename: string): string {
  try {
    return readFileSync(join(projectPath, filename), "utf-8");
  } catch {
    return "";
  }
}

/** Check one root-level marker without recursing into large project trees. */
function rootExists(projectPath: string, filename: string): boolean {
  return existsSync(join(projectPath, filename));
}

/** Match one root directory entry; swallows unreadable roots as no match. */
function rootMatches(projectPath: string, pattern: RegExp): boolean {
  try {
    return readdirSync(projectPath).some((entry) => pattern.test(entry));
  } catch {
    return false;
  }
}

/** Probe only known setup-relevant directories; stat failures fallback to false. */
function hasBoundedSetupDir(projectPath: string, dirname: string): boolean {
  if (!BOUNDED_SETUP_DIRS.includes(dirname)) return false;
  try {
    return statSync(join(projectPath, dirname)).isDirectory();
  } catch {
    return false;
  }
}

/** Return string-valued object entries from package-manager metadata. */
function objectAt(candidate: unknown): Record<string, string> {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(candidate).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/**
 * Pick the best npm script for one command role, preferring exact names over fuzzy matches.
 * Exact hits return the script body so the user sees the real command, while fuzzy hits return
 * `npm run <key>` because a partial name match is not strong enough to quote verbatim.
 *
 * @param scripts - the package's script map
 * @param exactKeys - script names tried first; a hit returns the script body itself
 * @param fuzzyKeys - script names tried next; a hit returns an `npm run` invocation
 * @param containsKeys - substrings used for the final scan; defaults to `fuzzyKeys`
 * @returns the chosen command, or an empty string when only placeholder scripts exist
 */
function scriptCommand(
  scripts: Record<string, string>,
  exactKeys: readonly string[],
  fuzzyKeys: readonly string[] = [],
  containsKeys: readonly string[] = fuzzyKeys,
): string {
  for (const key of exactKeys) {
    const command = scripts[key];
    if (command && !isPlaceholderScript(command)) return command;
  }
  for (const key of fuzzyKeys) {
    const command = scripts[key];
    if (command && !isPlaceholderScript(command)) return `npm run ${key}`;
  }
  const fuzzy = Object.keys(scripts).find(
    (key) =>
      containsKeys.some((candidate) => key.includes(candidate)) &&
      scripts[key] !== undefined &&
      !isPlaceholderScript(scripts[key] ?? ""),
  );
  return fuzzy ? `npm run ${fuzzy}` : "";
}

/**
 * Pick the first matching Composer script, joining array-form scripts into one shell line.
 *
 * @param scripts - the `scripts` block from composer.json
 * @param keys - script names tried in order; the first match wins
 * @returns the command, or an empty string when no listed key holds a usable string or string array
 */
function composerScriptCommand(
  scripts: JsonObject,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const commandValue = scripts[key];
    if (typeof commandValue === "string") return commandValue;
    if (
      Array.isArray(commandValue) &&
      commandValue.every((entry) => typeof entry === "string")
    ) {
      return commandValue.join(" && ");
    }
  }
  return "";
}

/** Ignore scaffold placeholder scripts that would fail before exercising the project. */
function isPlaceholderScript(command: string): boolean {
  const trimmed = command.trim();
  return (
    trimmed === "" ||
    /^echo\s+"Error:/.test(trimmed) ||
    /^echo\s+"no\s+(test|build)/i.test(trimmed) ||
    /^exit\s+1$/.test(trimmed) ||
    /^echo\s+.*&&\s*exit\s+1$/.test(trimmed)
  );
}

/**
 * Fill only the command slots the target has not already claimed.
 * First writer wins, so the detector order decides which language supplies each command in a
 * polyglot project rather than the last one silently overwriting the rest.
 * Side effect: mutates `target` in place.
 *
 * @param target - accumulated commands; only empty slots are filled
 * @param next - candidate commands from one language detector
 * @returns nothing; the result is the filled slots on `target`
 */
function mergeCommands(
  target: SetupCommands,
  next: Partial<SetupCommands>,
): void {
  target.test ||= next.test ?? "";
  target.lint ||= next.lint ?? "";
  target.build ||= next.build ?? "";
  target.format ||= next.format ?? "";
}

/**
 * Detect Node languages, frameworks, and commands from package.json.
 * Side effect: appends to the `languages` and `frameworks` lists in place.
 *
 * @param projectPath - project root
 * @param languages - accumulator appended to when Node or TypeScript is detected
 * @param frameworks - accumulator appended to for each recognised framework dependency
 * @returns detected commands; empty when the project has no readable package.json
 */
function collectNodeSetup(
  projectPath: string,
  languages: string[],
  frameworks: string[],
): Partial<SetupCommands> {
  const pkg = readRootJson(projectPath, "package.json");
  if (!pkg) return {};

  const runtimeDeps = objectAt(pkg["dependencies"]);
  const devDeps = objectAt(pkg["devDependencies"]);
  const peerDeps = objectAt(pkg["peerDependencies"]);
  const deps = { ...runtimeDeps, ...devDeps, ...peerDeps };
  const scripts = objectAt(pkg["scripts"]);
  const hasTypeScript =
    "typescript" in deps || rootExists(projectPath, "tsconfig.json");

  addLabel(languages, "JavaScript");
  if (hasTypeScript) addLabel(languages, "TypeScript");
  for (const [framework, packages] of NODE_FRAMEWORK_PACKAGES) {
    if (packages.some((pkgName) => pkgName in deps))
      addLabel(frameworks, framework);
  }

  return {
    build: scriptCommand(scripts, ["build"], ["build"]),
    test: scriptCommand(
      scripts,
      ["test"],
      [
        "e2e",
        "cypress",
        "spec",
        "test:unit",
        "test:e2e",
        "test:integration",
        "test",
      ],
      ["test"],
    ),
    lint: scriptCommand(scripts, ["lint"], ["lint"]),
    format: scriptCommand(scripts, ["format", "format:check"], ["format"]),
  };
}

/** Return Composer scripts only when the metadata is an object map. */
function composerScripts(composer: JsonObject): JsonObject {
  const scripts = composer["scripts"];
  return typeof scripts === "object" &&
    scripts !== null &&
    !Array.isArray(scripts)
    ? (scripts as JsonObject)
    : {};
}

/**
 * Label PHP frameworks from Composer dependencies and their marker files.
 * Both a dependency and a marker file are accepted because a vendored or partially installed
 * project may show only one of the two.
 * Side effect: appends to the `languages` and `frameworks` lists in place.
 *
 * @param projectPath - project root, checked for framework marker files
 * @param deps - merged require and require-dev map
 * @param languages - accumulator appended to with PHP and any templating language
 * @param frameworks - accumulator appended to for each recognised framework
 * @returns nothing; the result is the appended labels
 */
function collectPHPFrameworks(
  projectPath: string,
  deps: Record<string, string>,
  languages: string[],
  frameworks: string[],
): void {
  addLabel(languages, "PHP");
  if (
    "symfony/framework-bundle" in deps ||
    rootExists(projectPath, "symfony.lock")
  ) {
    addLabel(frameworks, "Symfony");
  }
  if ("laravel/framework" in deps || rootExists(projectPath, "artisan")) {
    addLabel(frameworks, "Laravel");
  }
  if ("twig/twig" in deps || "symfony/twig-bundle" in deps) {
    addLabel(languages, "Twig");
  }
}

/**
 * Choose PHP commands from Composer scripts, falling back to conventional vendor binaries.
 * A configured script always wins, because a project that defines one usually wraps setup the raw
 * binary would skip.
 *
 * @param projectPath - project root, checked for phpunit and phpstan configuration
 * @param scripts - the `scripts` block from composer.json
 * @returns detected commands; individual slots stay empty when neither source supplies one
 */
function collectPHPCommands(
  projectPath: string,
  scripts: JsonObject,
): Partial<SetupCommands> {
  const hasPhpUnit =
    rootExists(projectPath, "phpunit.xml") ||
    rootExists(projectPath, "phpunit.xml.dist");
  const hasPhpStan = rootExists(projectPath, "phpstan.neon");
  return {
    test:
      composerScriptCommand(scripts, ["test"]) ||
      (hasPhpUnit ? "vendor/bin/phpunit" : ""),
    lint:
      composerScriptCommand(scripts, ["analyse", "lint"]) ||
      (hasPhpStan ? "vendor/bin/phpstan analyse" : ""),
    format: composerScriptCommand(scripts, ["cs:check", "cs:fix"]),
  };
}

/**
 * Detect PHP languages, frameworks, and commands from composer.json.
 * Side effect: appends to the `languages` and `frameworks` lists in place.
 *
 * @param projectPath - project root
 * @param languages - accumulator appended to when PHP is detected
 * @param frameworks - accumulator appended to for each recognised framework
 * @returns detected commands; empty when the project has no readable composer.json
 */
function collectPHPSetup(
  projectPath: string,
  languages: string[],
  frameworks: string[],
): Partial<SetupCommands> {
  const composer = readRootJson(projectPath, "composer.json");
  if (!composer) return {};

  const require = objectAt(composer["require"]);
  const requireDev = objectAt(composer["require-dev"]);
  const deps = { ...require, ...requireDev };
  const scripts = composerScripts(composer);

  collectPHPFrameworks(projectPath, deps, languages, frameworks);
  return collectPHPCommands(projectPath, scripts);
}

/**
 * Detect Python from any of its packaging markers and fill its conventional commands.
 * Side effect: appends to `languages` and fills empty slots on `commands`, both in place.
 *
 * @param projectPath - project root, checked for packaging markers
 * @param languages - accumulator appended to when Python is detected
 * @param commands - accumulated commands; only empty slots are filled
 * @returns nothing; a project with no Python marker is left untouched
 */
function collectPythonSetup(
  projectPath: string,
  languages: string[],
  commands: SetupCommands,
): void {
  if (
    rootExists(projectPath, "pyproject.toml") ||
    rootExists(projectPath, "setup.py") ||
    rootExists(projectPath, "setup.cfg") ||
    rootExists(projectPath, "requirements.txt") ||
    hasBoundedSetupDir(projectPath, "strands_agents")
  ) {
    addLabel(languages, "Python");
    commands.test ||= "pytest";
    commands.lint ||= "ruff check";
  }
}

/**
 * Detect Go from go.mod and fill its conventional toolchain commands.
 * Side effect: appends to `languages` and fills empty slots on `commands`, both in place.
 *
 * @param projectPath - project root, checked for go.mod
 * @param languages - accumulator appended to when Go is detected
 * @param commands - accumulated commands; only empty slots are filled
 * @returns nothing; a project without go.mod is left untouched
 */
function collectGoSetup(
  projectPath: string,
  languages: string[],
  commands: SetupCommands,
): void {
  if (rootExists(projectPath, "go.mod")) {
    addLabel(languages, "Go");
    commands.build ||= "go build ./...";
    commands.test ||= "go test ./...";
    commands.lint ||= "go vet ./...";
    commands.format ||= "gofmt -l .";
  }
}

/**
 * Detect Rust from Cargo.toml and fill its conventional toolchain commands.
 * Side effect: appends to `languages` and fills empty slots on `commands`, both in place.
 *
 * @param projectPath - project root, checked for Cargo.toml
 * @param languages - accumulator appended to when Rust is detected
 * @param commands - accumulated commands; only empty slots are filled
 * @returns nothing; a project without Cargo.toml is left untouched
 */
function collectRustSetup(
  projectPath: string,
  languages: string[],
  commands: SetupCommands,
): void {
  if (rootExists(projectPath, "Cargo.toml")) {
    addLabel(languages, "Rust");
    commands.build ||= "cargo build";
    commands.test ||= "cargo test";
    commands.lint ||= "cargo clippy";
    commands.format ||= "cargo fmt --check";
  }
}

/**
 * Detect Ruby from a Gemfile and fill its conventional commands.
 * Side effect: appends to `languages` and fills empty slots on `commands`, both in place.
 *
 * @param projectPath - project root, checked for a Gemfile
 * @param languages - accumulator appended to when Ruby is detected
 * @param commands - accumulated commands; only empty slots are filled
 * @returns nothing; a project without a Gemfile is left untouched
 */
function collectRubySetup(
  projectPath: string,
  languages: string[],
  commands: SetupCommands,
): void {
  if (rootExists(projectPath, "Gemfile")) {
    addLabel(languages, "Ruby");
    commands.test ||= "bundle exec rspec";
    commands.lint ||= "bundle exec rubocop";
  }
}

/**
 * Detect Java from Maven or Gradle and fill the matching build tool's commands.
 * Maven wins when both are present, because a pom.xml is the more specific signal.
 * Side effect: appends to `languages` and fills empty slots on `commands`, both in place.
 *
 * @param projectPath - project root, checked for pom.xml or a build.gradle variant
 * @param languages - accumulator appended to when Java is detected
 * @param commands - accumulated commands; only empty slots are filled
 * @returns nothing; a project with neither build file is left untouched
 */
function collectJavaSetup(
  projectPath: string,
  languages: string[],
  commands: SetupCommands,
): void {
  if (
    rootExists(projectPath, "pom.xml") ||
    rootMatches(projectPath, /^build\.gradle/)
  ) {
    addLabel(languages, "Java");
    if (rootExists(projectPath, "pom.xml")) {
      commands.build ||= "mvn package";
      commands.test ||= "mvn test";
    } else {
      commands.build ||= "gradle build";
      commands.test ||= "gradle test";
    }
  }
}

/** Detect shell support from root scripts or a bounded `scripts/` directory. */
function collectShellSetup(projectPath: string, languages: string[]): void {
  if (
    rootMatches(projectPath, /^.+\.sh$/) ||
    hasBoundedSetupDir(projectPath, "scripts")
  ) {
    addLabel(languages, "Bash");
  }
}

/**
 * Run every remaining single-marker language detector against the project root.
 * Node and PHP run before this because they carry framework detection and richer command sources;
 * everything here only needs one marker file, so the order among them does not change the result.
 * Side effect: appends to `languages` and `frameworks` and fills empty `commands` slots, in place.
 *
 * @param projectPath - project root
 * @param languages - accumulator appended to by each detector that matches
 * @param frameworks - accumulator appended to for Docker
 * @param commands - accumulated commands; only empty slots are filled
 * @returns nothing; a project matching no marker is left untouched
 */
function collectOtherRootSetup(
  projectPath: string,
  languages: string[],
  frameworks: string[],
  commands: SetupCommands,
): void {
  collectPythonSetup(projectPath, languages, commands);
  collectGoSetup(projectPath, languages, commands);
  collectRustSetup(projectPath, languages, commands);
  collectRubySetup(projectPath, languages, commands);
  collectJavaSetup(projectPath, languages, commands);
  collectShellSetup(projectPath, languages);
  if (rootExists(projectPath, "Dockerfile")) {
    addLabel(frameworks, "Docker");
  }
}

/** Fast first-render stack summary for `/api/setup/detect`.
 *  This intentionally avoids the full stack detector and broad recursive glob probes. */
function detectFastSetupStack(projectPath: string): FastSetupStack {
  const languages: string[] = [];
  const frameworks: string[] = [];
  const commands: SetupCommands = { test: "", lint: "", build: "", format: "" };

  mergeCommands(commands, collectNodeSetup(projectPath, languages, frameworks));
  mergeCommands(commands, collectPHPSetup(projectPath, languages, frameworks));
  collectOtherRootSetup(projectPath, languages, frameworks, commands);

  const webpackConfig = readRootText(projectPath, "webpack.config.js");
  if (webpackConfig.includes("Encore")) addLabel(frameworks, "Webpack Encore");
  if (
    hasBoundedSetupDir(projectPath, "templates") &&
    languages.includes("PHP")
  ) {
    addLabel(languages, "Twig");
  }

  return { languages, frameworks, commands };
}

/**
 * Build the full `/api/setup/detect` payload for one project path.
 *
 * @param projectPath - Target project root selected in the dashboard.
 * @returns Setup-view payload with fast stack hints, agents, and existing surfaces.
 */
export function buildSetupDetectPayload(projectPath: string): {
  languages: string[];
  frameworks: string[];
  commands: SetupCommands;
  agents: Record<string, boolean>;
  existing: ExistingArtifacts;
  nonGoatFlow: string[];
} {
  const stack = detectFastSetupStack(projectPath);
  return {
    languages: stack.languages,
    frameworks: stack.frameworks,
    commands: stack.commands,
    agents: detectScaffoldedAgents(projectPath),
    existing: detectExistingArtifacts(projectPath),
    nonGoatFlow: detectNonGoatFlowConfig(projectPath),
  };
}

/**
 * Heuristically treat a directory as a project when it has common repo markers.
 *
 * Swallows marker stat failures as non-matches because browse results
 * should survive unreadable children.
 *
 * @param dirPath - Candidate directory path from the browser route.
 * @returns True when any supported project or agent marker exists.
 */
export function isProjectDirectory(dirPath: string): boolean {
  return [
    "package.json",
    "go.mod",
    "Cargo.toml",
    "composer.json",
    "pyproject.toml",
    ...AGENT_PROFILES.map((agent) => agent.instructionFile),
  ].some((file) => {
    try {
      statSync(join(dirPath, file));
      return true;
    } catch {
      return false;
    }
  });
}
