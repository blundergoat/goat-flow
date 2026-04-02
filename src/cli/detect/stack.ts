import type { StackInfo, ProjectSignals, ReadonlyFS } from '../types.js';

/** Partial detection result from a single language detector */
interface DetectorResult {
  languages?: string[];
  buildCommand?: string | null;
  testCommand?: string | null;
  lintCommand?: string | null;
  formatCommand?: string | null;
}

const NODE_FRAMEWORKS = [
  { language: 'react', packages: ['react', 'react-dom', 'next'] },
  { language: 'vue', packages: ['vue', 'nuxt'] },
  { language: 'angular', packages: ['@angular/core'] },
  { language: 'svelte', packages: ['svelte', '@sveltejs/kit'] },
  { language: 'express', packages: ['express'] },
  { language: 'cypress', packages: ['cypress'] },
] as const;

const EXTRA_LANGUAGE_SIGNALS = [
  { language: 'blade', paths: [], globs: ['**/*.blade.php'] },
  { language: 'twig', paths: [], globs: ['**/*.twig'] },
  { language: 'erb', paths: [], globs: ['**/*.erb', '**/*.html.erb'] },
  { language: 'jinja', paths: [], globs: ['**/*.jinja2', '**/*.html'] },
  { language: 'swift', paths: ['Package.swift'], globs: ['**/*.xcodeproj', '**/*.swift'] },
  { language: 'blazor', paths: [], globs: ['**/*.razor'] },
] as const;

const CODE_GEN_SIGNALS = [
  { tool: 'sqlc', paths: ['sqlc.yaml', 'sqlc.yml'], globs: [] },
  { tool: 'hygen', paths: ['_templates'], globs: ['**/.hygen.js'] },
  { tool: 'protobuf', paths: ['buf.yaml', 'buf.gen.yaml'], globs: [] },
  { tool: 'openapi', paths: [], globs: ['**/openapi-generator*', '**/openapi*.yaml'] },
] as const;

const DEPLOY_SIGNALS = [
  { tool: 'amplify', paths: ['amplify.yml', 'amplify'], globs: [] },
  { tool: 'docker', paths: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'], globs: [] },
  { tool: 'fly', paths: ['fly.toml'], globs: [] },
  { tool: 'vercel', paths: ['vercel.json'], globs: [] },
  { tool: 'terraform', paths: ['terraform'], globs: ['**/main.tf', '**/*.tf'] },
  { tool: 'packer', paths: ['packer.json'], globs: ['**/*.pkr.hcl'] },
] as const;

const ROOT_PYTHON_FILES = ['pyproject.toml', 'setup.py', 'requirements.txt'] as const;
const SUBDIR_PYTHON_GLOBS = ['*/pyproject.toml', '*/requirements.txt'] as const;
const JAVA_MANIFEST_PATHS = ['pom.xml', 'build.gradle', 'build.gradle.kts'] as const;
const LLM_ENV_FILES = ['.env.example', '.env.sample', '.env'] as const;
const LLM_DEP_FILES = ['requirements.txt', 'pyproject.toml', 'package.json'] as const;
const COMPLIANCE_DOCS = ['README.md', 'docs/architecture.md', '.github/instructions/security.instructions.md'] as const;
const FORMATTER_MAP: Record<string, string[]> = {
  typescript: ['prettier', 'biome', 'dprint'],
  javascript: ['prettier', 'biome', 'dprint'],
  php: ['php-cs-fixer', 'phpcbf', 'pint'],
  python: ['black', 'ruff', 'yapf', 'autopep8'],
  rust: ['rustfmt'],
  go: ['gofmt', 'goimports'],
  bash: ['shfmt'],
  ruby: ['rubocop'],
  java: ['google-java-format', 'spotless'],
};

/** Check if an npm script command is a placeholder (npm init default) */
function isPlaceholderScript(cmd: string): boolean {
  return /^echo\s+"Error:/.test(cmd)
    || /^echo\s+"no\s+(test|build)/.test(cmd)
    || /^exit\s+1$/.test(cmd.trim())
    || /^echo\s+.*&&\s*exit\s+1$/.test(cmd.trim());
}

/** Extract commands from a package.json scripts block */
function extractNodeCommands(scripts: Record<string, string>): Pick<DetectorResult, 'buildCommand' | 'testCommand' | 'lintCommand' | 'formatCommand'> {
  const filterPlaceholder = (cmd: string | undefined): string | null => {
    if (!cmd || isPlaceholderScript(cmd)) return null;
    return cmd;
  };
  // Test command: try exact match first, then scan for test-like script names
  let testCommand = filterPlaceholder(scripts.test);
  if (!testCommand) {
    const testPatterns = ['e2e', 'cypress', 'spec', 'test:unit', 'test:e2e', 'test:integration'];
    for (const pattern of testPatterns) {
      if (scripts[pattern] && !isPlaceholderScript(scripts[pattern])) {
        testCommand = `npm run ${pattern}`;
        break;
      }
    }
    // Fallback: first script name containing "test"
    if (!testCommand) {
      const testKey = Object.keys(scripts).find(k => k.includes('test') && scripts[k] !== undefined && !isPlaceholderScript(scripts[k]));
      if (testKey) testCommand = `npm run ${testKey}`;
    }
  }

  return {
    buildCommand: filterPlaceholder(scripts.build),
    testCommand,
    lintCommand: filterPlaceholder(scripts.lint),
    formatCommand: filterPlaceholder(scripts.format ?? scripts['format:check']),
  };
}

/** Check if TypeScript is present in subdirectories (monorepo) */
function hasSubdirTypeScript(fs: ReadonlyFS): boolean {
  return fs.glob('*/tsconfig.json').length > 0 || fs.glob('*/*/tsconfig.json').length > 0;
}

function addLanguageIfMissing(languages: string[], language: string): void {
  if (languages.includes(language) === false) {
    languages.push(language);
  }
}

function hasAnyDependency(
  deps: Record<string, string>,
  packages: readonly string[],
): boolean {
  return packages.some(pkg => pkg in deps);
}

function hasNodeSourceFiles(fs: ReadonlyFS): boolean {
  return fs.glob('src/**/*.ts').length > 0
    || fs.glob('src/**/*.js').length > 0
    || fs.glob('lib/**/*.js').length > 0;
}

function collectNodeLanguages(
  fs: ReadonlyFS,
  runtimeDeps: Record<string, string> | undefined,
  deps: Record<string, string>,
): string[] {
  const languages: string[] = [];
  const hasRuntimeDeps = runtimeDeps !== undefined && Object.keys(runtimeDeps).length > 0;
  const hasTypeScript = 'typescript' in deps || fs.exists('tsconfig.json');

  if (hasRuntimeDeps || hasNodeSourceFiles(fs) || hasTypeScript) {
    addLanguageIfMissing(languages, 'javascript');
  }
  if (hasTypeScript) {
    addLanguageIfMissing(languages, 'typescript');
  }
  for (const detector of NODE_FRAMEWORKS) {
    if (hasAnyDependency(deps, detector.packages)) {
      addLanguageIfMissing(languages, detector.language);
    }
  }

  return languages;
}

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

function hasSubdirNodePackage(fs: ReadonlyFS): boolean {
  return fs.glob('*/package.json').length > 0 || fs.glob('*/*/package.json').length > 0;
}

/** Detect Node.js / TypeScript from package.json (root or subdirectory) */
function detectNodeStack(fs: ReadonlyFS): DetectorResult {
  const pkg = fs.readJson('package.json') as Record<string, unknown> | null;
  if (pkg) {
    return detectRootNodeStack(fs, pkg);
  }

  // Monorepo: check subdirectory manifests if not detected at root
  if (hasSubdirNodePackage(fs)) {
    const languages: string[] = ['javascript'];
    if (hasSubdirTypeScript(fs)) {
      languages.push('typescript');
    }
    return { languages };
  }

  return {};
}

/** Detect Go from go.mod (root or subdirectory, up to 2 levels deep) */
function detectGoStack(fs: ReadonlyFS): DetectorResult {
  if (fs.exists('go.mod') || fs.glob('*/go.mod').length > 0 || fs.glob('*/*/go.mod').length > 0) {
    return {
      languages: ['go'],
      buildCommand: 'go build ./...',
      testCommand: 'go test ./...',
      lintCommand: 'go vet ./...',
      formatCommand: 'gofmt -l .',
    };
  }
  return {};
}

/** Detect Rust from Cargo.toml (root or subdirectory) */
function detectRustStack(fs: ReadonlyFS): DetectorResult {
  if (fs.exists('Cargo.toml') || fs.glob('*/Cargo.toml').length > 0) {
    return {
      languages: ['rust'],
      buildCommand: 'cargo build',
      testCommand: 'cargo test',
      lintCommand: 'cargo clippy',
      formatCommand: 'cargo fmt --check',
    };
  }
  return {};
}

function hasAnyPath(fs: ReadonlyFS, paths: readonly string[]): boolean {
  return paths.some(path => fs.exists(path));
}

function hasAnyGlob(fs: ReadonlyFS, globs: readonly string[]): boolean {
  return globs.some(pattern => fs.glob(pattern).length > 0);
}

function readFirstExistingFile(fs: ReadonlyFS, paths: readonly string[]): string | null {
  for (const path of paths) {
    const content = fs.readFile(path);
    if (content !== null) return content;
  }
  return null;
}

function detectPythonLanguages(fs: ReadonlyFS): string[] {
  const languages: string[] = ['python'];
  const pyContent = fs.readFile('requirements.txt') ?? fs.readFile('pyproject.toml') ?? '';
  if (/\bdjango\b/i.test(pyContent)) languages.push('django');
  if (/\bfastapi\b/i.test(pyContent)) languages.push('fastapi');
  return languages;
}

/** Detect Python from pyproject.toml, setup.py, or requirements.txt (root or subdirectory) */
function detectPythonStack(fs: ReadonlyFS): DetectorResult {
  const hasRootPython = hasAnyPath(fs, ROOT_PYTHON_FILES);
  const hasSubdirPython = !hasRootPython && hasAnyGlob(fs, SUBDIR_PYTHON_GLOBS);
  if (!hasRootPython && !hasSubdirPython) {
    return {};
  }

  const languages = detectPythonLanguages(fs);
  return hasRootPython
    ? { languages, testCommand: 'pytest', lintCommand: 'ruff check' }
    : { languages };
}

function detectPHPLanguages(fs: ReadonlyFS, composer: Record<string, unknown>): string[] {
  const languages: string[] = ['php'];
  const require = composer.require as Record<string, string> | undefined;

  if (require && 'laravel/framework' in require) addLanguageIfMissing(languages, 'laravel');
  if (require && 'symfony/framework-bundle' in require) addLanguageIfMissing(languages, 'symfony');
  if (fs.exists('artisan')) addLanguageIfMissing(languages, 'laravel');
  if (fs.exists('symfony.lock')) addLanguageIfMissing(languages, 'symfony');

  return languages;
}

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

function extractPHPCommandsFromScripts(
  scripts: Record<string, string>,
): Pick<DetectorResult, 'testCommand' | 'lintCommand' | 'formatCommand'> {
  return {
    testCommand: scripts.test ?? null,
    lintCommand: firstDefinedScript(scripts, ['analyse', 'lint']),
    formatCommand: firstDefinedScript(scripts, ['cs:check', 'cs:fix']),
  };
}

function extractPHPCommands(composer: Record<string, unknown>): Pick<DetectorResult, 'testCommand' | 'lintCommand' | 'formatCommand'> {
  const scripts = composer.scripts as Record<string, string> | undefined;
  return scripts ? extractPHPCommandsFromScripts(scripts) : {
    testCommand: null,
    lintCommand: null,
    formatCommand: null,
  };
}

/** Detect PHP from composer.json (root or subdirectory) */
function detectPHPStack(fs: ReadonlyFS): DetectorResult {
  const composer = fs.readJson('composer.json') as Record<string, unknown> | null;
  if (composer) {
    return {
      languages: detectPHPLanguages(fs, composer),
      ...extractPHPCommands(composer),
    };
  }

  // Monorepo: check subdirectory manifests if not detected at root
  if (fs.glob('*/composer.json').length > 0) {
    return { languages: ['php'] };
  }
  return {};
}

/** Detect Ruby from Gemfile */
function detectRubyStack(fs: ReadonlyFS): DetectorResult {
  if (fs.exists('Gemfile') || fs.glob('*/Gemfile').length > 0) {
    const languages: string[] = ['ruby'];
    const gemfile = fs.readFile('Gemfile') ?? '';
    if (/gem\s+['"]rails['"]/.test(gemfile) || fs.exists('bin/rails')) {
      languages.push('rails');
    }
    return {
      languages,
      testCommand: 'bundle exec rspec',
      lintCommand: 'bundle exec rubocop',
    };
  }
  return {};
}

function detectJavaLanguages(manifest: string): string[] {
  const languages: string[] = ['java'];
  if (/spring-boot/i.test(manifest)) {
    languages.push('spring');
  }
  return languages;
}

function getJavaCommands(hasMaven: boolean): Pick<DetectorResult, 'buildCommand' | 'testCommand'> {
  return hasMaven
    ? { buildCommand: 'mvn package', testCommand: 'mvn test' }
    : { buildCommand: 'gradle build', testCommand: 'gradle test' };
}

/** Detect Java from pom.xml or build.gradle */
function detectJavaStack(fs: ReadonlyFS): DetectorResult {
  const hasMaven = fs.exists('pom.xml') || fs.glob('*/pom.xml').length > 0;
  const hasGradle = fs.glob('build.gradle*').length > 0 || fs.glob('*/build.gradle*').length > 0;
  if (!hasMaven && !hasGradle) {
    return {};
  }

  const manifest = readFirstExistingFile(fs, JAVA_MANIFEST_PATHS) ?? '';
  return {
    languages: detectJavaLanguages(manifest),
    ...getJavaCommands(hasMaven),
  };
}

/** Detect .NET from *.csproj or *.sln */
function detectDotnetStack(fs: ReadonlyFS): DetectorResult {
  if (fs.glob('**/*.csproj').length > 0 || fs.glob('*.sln').length > 0) {
    return {
      languages: ['csharp'],
      buildCommand: 'dotnet build',
      testCommand: 'dotnet test',
    };
  }
  return {};
}

/** Detect shell scripts */
function detectShellScripts(fs: ReadonlyFS): DetectorResult {
  if (fs.glob('**/*.sh').length > 0) {
    return { languages: ['bash'] };
  }
  return {};
}

/** Detect markdown-only (docs) project - only when no other languages found */
function detectMarkdownOnly(fs: ReadonlyFS): DetectorResult {
  if (fs.glob('**/*.md').length > 5) {
    return { languages: ['markdown'] };
  }
  return {};
}

function mergeLanguages(target: string[], languages?: string[]): void {
  for (const language of languages ?? []) {
    addLanguageIfMissing(target, language);
  }
}

function firstDetectedCommand(current: string | null, next?: string | null): string | null {
  return current ?? next ?? null;
}

function mergeCommands(
  result: DetectorResult,
  commands: Pick<StackInfo, 'buildCommand' | 'testCommand' | 'lintCommand' | 'formatCommand'>,
): void {
  commands.buildCommand = firstDetectedCommand(commands.buildCommand, result.buildCommand);
  commands.testCommand = firstDetectedCommand(commands.testCommand, result.testCommand);
  commands.lintCommand = firstDetectedCommand(commands.lintCommand, result.lintCommand);
  commands.formatCommand = firstDetectedCommand(commands.formatCommand, result.formatCommand);
}

function mergeDetectorResults(detectors: DetectorResult[]): Omit<StackInfo, 'signals'> {
  const languages: string[] = [];
  const commands: Pick<StackInfo, 'buildCommand' | 'testCommand' | 'lintCommand' | 'formatCommand'> = {
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

function hasJinjaSignal(fs: ReadonlyFS): boolean {
  return fs.glob('**/*.jinja2').length > 0
    || fs.glob('**/*.html').some(file => /templates\//.test(file));
}

function detectExtraLanguages(fs: ReadonlyFS): string[] {
  const languages: string[] = [];

  for (const signal of EXTRA_LANGUAGE_SIGNALS) {
    if (signal.language === 'jinja') {
      if (hasJinjaSignal(fs)) languages.push(signal.language);
      continue;
    }
    if (!hasAnyPath(fs, signal.paths) && !hasAnyGlob(fs, signal.globs)) continue;
    languages.push(signal.language);
  }

  return languages;
}

function applyMarkdownFallback(fs: ReadonlyFS, languages: string[]): void {
  if (languages.length > 0) return;
  const mdResult = detectMarkdownOnly(fs);
  for (const language of mdResult.languages ?? []) {
    addLanguageIfMissing(languages, language);
  }
}

/** Detect languages, build/test/lint/format commands from project manifests */
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

  const signals = detectProjectSignals(fs, stack.languages, stack.formatCommand);
  return { ...stack, signals };
}

/** Detect extended project signals for richer setup prompts (M03.3) */
function collectNamedSignals(
  fs: ReadonlyFS,
  detectors: ReadonlyArray<{ tool: string; paths: readonly string[]; globs: readonly string[] }>,
): string[] {
  return detectors
    .filter(detector => hasAnyPath(fs, detector.paths) || hasAnyGlob(fs, detector.globs))
    .map(detector => detector.tool);
}

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

function detectLLMIntegration(fs: ReadonlyFS): boolean {
  return fileContainsPattern(
    fs,
    LLM_ENV_FILES,
    /MODEL_PROVIDER|OPENAI_API_KEY|ANTHROPIC_API_KEY|BEDROCK|OLLAMA/i,
  ) || fileContainsPattern(
    fs,
    LLM_DEP_FILES,
    /anthropic|openai|langchain|llamaindex|strands/i,
  );
}

function detectStaticAnalysis(fs: ReadonlyFS): Array<{ tool: string; level: string | null }> {
  const staticAnalysis: Array<{ tool: string; level: string | null }> = [];
  const phpstanConfig = fs.readFile('phpstan.neon') ?? fs.readFile('phpstan.neon.dist');
  const mypyConfig = fs.readFile('mypy.ini') ?? fs.readFile('setup.cfg');

  if (phpstanConfig) {
    const levelMatch = phpstanConfig.match(/level:\s*(\d+|max)/);
    staticAnalysis.push({ tool: 'phpstan', level: levelMatch?.[1] ?? null });
  }
  if (mypyConfig && /\[mypy\]/i.test(mypyConfig)) {
    const strictMatch = mypyConfig.match(/strict\s*=\s*(true|false)/i);
    staticAnalysis.push({ tool: 'mypy', level: strictMatch?.[1] === 'true' ? 'strict' : null });
  }

  return staticAnalysis;
}

function detectComplianceSignals(fs: ReadonlyFS): boolean {
  return fileContainsPattern(
    fs,
    COMPLIANCE_DOCS,
    /\bPHI\b|HIPAA|GDPR|patient.*data|health.*record/i,
  );
}

function getFormatterSources(fs: ReadonlyFS, formatCommand: string | null): string {
  const formatHookContent = fs.readFile('.claude/hooks/format-file.sh') ?? fs.readFile('.gemini/hooks/format-file.sh') ?? '';
  return [(formatCommand ?? ''), formatHookContent].join(' ').toLowerCase();
}

function shouldCheckFormatter(lang: string, languages: string[]): boolean {
  if (lang !== 'bash') return true;
  return languages[0] === 'bash' || (languages.includes('bash') && languages.length <= 2);
}

function detectFormatterGaps(
  fs: ReadonlyFS,
  languages: string[],
  formatCommand: string | null,
): string[] {
  const formatterSources = getFormatterSources(fs, formatCommand);
  const formatterGaps: string[] = [];

  for (const lang of languages) {
    if (!shouldCheckFormatter(lang, languages)) continue;
    const known = FORMATTER_MAP[lang];
    if (!known) continue;
    if (!known.some(formatter => formatterSources.includes(formatter))) {
      formatterGaps.push(lang);
    }
  }

  return formatterGaps;
}

function detectProjectSignals(fs: ReadonlyFS, languages: string[], formatCommand: string | null): ProjectSignals {
  return {
    codeGenTools: collectNamedSignals(fs, CODE_GEN_SIGNALS),
    deployPlatforms: collectNamedSignals(fs, DEPLOY_SIGNALS),
    llmIntegration: detectLLMIntegration(fs),
    staticAnalysis: detectStaticAnalysis(fs),
    complianceSignals: detectComplianceSignals(fs),
    formatterGaps: detectFormatterGaps(fs, languages, formatCommand),
  };
}
