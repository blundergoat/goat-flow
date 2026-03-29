import type { StackInfo, ProjectSignals, ReadonlyFS } from '../types.js';

/** Partial detection result from a single language detector */
interface DetectorResult {
  languages?: string[];
  buildCommand?: string | null;
  testCommand?: string | null;
  lintCommand?: string | null;
  formatCommand?: string | null;
}

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
  return {
    buildCommand: filterPlaceholder(scripts.build),
    testCommand: filterPlaceholder(scripts.test),
    lintCommand: filterPlaceholder(scripts.lint),
    formatCommand: filterPlaceholder(scripts.format ?? scripts['format:check']),
  };
}

/** Check if TypeScript is present in subdirectories (monorepo) */
function hasSubdirTypeScript(fs: ReadonlyFS): boolean {
  return fs.glob('*/tsconfig.json').length > 0 || fs.glob('*/*/tsconfig.json').length > 0;
}

/** Detect Node.js / TypeScript from package.json (root or subdirectory) */
function detectNodeStack(fs: ReadonlyFS): DetectorResult {
  const pkg = fs.readJson('package.json') as Record<string, unknown> | null;
  if (pkg) {
    const languages: string[] = ['javascript'];
    const deps = { ...pkg.dependencies as Record<string, string> | undefined, ...pkg.devDependencies as Record<string, string> | undefined };
    if ('typescript' in deps || fs.exists('tsconfig.json')) {
      languages.push('typescript');
    }
    // Detect frontend frameworks from deps
    if ('react' in deps || 'react-dom' in deps || 'next' in deps) languages.push('react');
    if ('vue' in deps || 'nuxt' in deps) languages.push('vue');
    if ('@angular/core' in deps) languages.push('angular');
    if ('svelte' in deps || '@sveltejs/kit' in deps) languages.push('svelte');
    const scripts = pkg.scripts as Record<string, string> | undefined;
    const commands = scripts ? extractNodeCommands(scripts) : {};
    return { languages, ...commands };
  }

  // Monorepo: check subdirectory manifests if not detected at root
  const subPkg = fs.glob('*/package.json').length > 0 || fs.glob('*/*/package.json').length > 0;
  if (subPkg) {
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

/** Detect Python from pyproject.toml, setup.py, or requirements.txt (root or subdirectory) */
function detectPythonStack(fs: ReadonlyFS): DetectorResult {
  const hasPython = fs.exists('pyproject.toml') || fs.exists('setup.py') || fs.exists('requirements.txt')
    || fs.glob('*/pyproject.toml').length > 0 || fs.glob('*/requirements.txt').length > 0;
  if (hasPython) {
    return {
      languages: ['python'],
      testCommand: 'pytest',
      lintCommand: 'ruff check',
    };
  }
  return {};
}

/** Detect PHP from composer.json (root or subdirectory) */
function detectPHPStack(fs: ReadonlyFS): DetectorResult {
  let testCommand: string | null = null;
  let lintCommand: string | null = null;
  let formatCommand: string | null = null;

  const composer = fs.readJson('composer.json') as Record<string, unknown> | null;
  if (composer) {
    const scripts = composer.scripts as Record<string, string> | undefined;
    if (scripts) {
      testCommand = scripts.test ?? null;
      lintCommand = scripts.analyse ?? scripts.lint ?? null;
      formatCommand = scripts['cs:check'] ?? scripts['cs:fix'] ?? null;
    }
    return { languages: ['php'], testCommand, lintCommand, formatCommand };
  }

  // Monorepo: check subdirectory manifests if not detected at root
  if (fs.glob('*/composer.json').length > 0) {
    return { languages: ['php'] };
  }
  return {};
}

/** Detect Ruby from Gemfile */
function detectRubyStack(_fs: ReadonlyFS): DetectorResult {
  return {};
}

/** Detect Java from pom.xml or build.gradle */
function detectJavaStack(_fs: ReadonlyFS): DetectorResult {
  return {};
}

/** Detect .NET from *.csproj or *.sln */
function detectDotnetStack(_fs: ReadonlyFS): DetectorResult {
  return {};
}

/** Detect shell scripts */
function detectShellScripts(fs: ReadonlyFS): DetectorResult {
  if (fs.glob('**/*.sh').length > 0) {
    return { languages: ['bash'] };
  }
  return {};
}

/** Detect markdown-only (docs) project — only when no other languages found */
function detectMarkdownOnly(fs: ReadonlyFS): DetectorResult {
  if (fs.glob('**/*.md').length > 5) {
    return { languages: ['markdown'] };
  }
  return {};
}

/** Detect languages, build/test/lint/format commands from project manifests */
export function detectStack(fs: ReadonlyFS): StackInfo {
  // Order matters: first detector to provide a command wins (matches original priority)
  const detectors: DetectorResult[] = [
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

  const languages: string[] = [];
  let buildCommand: string | null = null;
  let testCommand: string | null = null;
  let lintCommand: string | null = null;
  let formatCommand: string | null = null;

  for (const result of detectors) {
    if (result.languages) {
      for (const lang of result.languages) {
        if (languages.includes(lang) === false) {
          languages.push(lang);
        }
      }
    }
    buildCommand = buildCommand ?? result.buildCommand ?? null;
    testCommand = testCommand ?? result.testCommand ?? null;
    lintCommand = lintCommand ?? result.lintCommand ?? null;
    formatCommand = formatCommand ?? result.formatCommand ?? null;
  }

  // Detect server-rendered template engines (frontend signals for non-JS stacks)
  if (fs.glob('**/*.blade.php').length > 0) languages.push('blade');
  if (fs.glob('**/*.twig').length > 0) languages.push('twig');
  if (fs.glob('**/*.erb').length > 0 || fs.glob('**/*.html.erb').length > 0) languages.push('erb');
  if (fs.glob('**/*.jinja2').length > 0 || fs.glob('**/*.html').some(f => /templates\//.test(f))) languages.push('jinja');
  // Swift/iOS detection
  if (fs.exists('Package.swift') || fs.glob('**/*.xcodeproj').length > 0 || fs.glob('**/*.swift').length > 0) languages.push('swift');
  // Blazor detection
  if (fs.glob('**/*.razor').length > 0) languages.push('blazor');

  // Markdown-only fallback: only when no languages were detected
  if (languages.length === 0) {
    const mdResult = detectMarkdownOnly(fs);
    if (mdResult.languages) {
      languages.push(...mdResult.languages);
    }
  }

  const signals = detectProjectSignals(fs, languages, formatCommand);
  return { languages, buildCommand, testCommand, lintCommand, formatCommand, signals };
}

/** Detect extended project signals for richer setup prompts (M03.3) */
function detectProjectSignals(fs: ReadonlyFS, languages: string[], formatCommand: string | null): ProjectSignals {
  const codeGenTools: string[] = [];
  const deployPlatforms: string[] = [];
  const staticAnalysis: Array<{ tool: string; level: string | null }> = [];

  // Code generation tools
  if (fs.exists('sqlc.yaml') || fs.exists('sqlc.yml')) codeGenTools.push('sqlc');
  if (fs.exists('_templates') || fs.glob('**/.hygen.js').length > 0) codeGenTools.push('hygen');
  if (fs.exists('buf.yaml') || fs.exists('buf.gen.yaml')) codeGenTools.push('protobuf');
  if (fs.glob('**/openapi-generator*').length > 0 || fs.glob('**/openapi*.yaml').length > 0) codeGenTools.push('openapi');

  // Deployment platforms
  if (fs.exists('amplify.yml') || fs.exists('amplify')) deployPlatforms.push('amplify');
  if (fs.exists('Dockerfile') || fs.exists('docker-compose.yml') || fs.exists('docker-compose.yaml')) deployPlatforms.push('docker');
  if (fs.exists('fly.toml')) deployPlatforms.push('fly');
  if (fs.exists('vercel.json')) deployPlatforms.push('vercel');
  if (fs.exists('terraform') || fs.glob('**/main.tf').length > 0) deployPlatforms.push('terraform');
  if (fs.glob('**/*.tf').length > 0 && !deployPlatforms.includes('terraform')) deployPlatforms.push('terraform');

  // LLM integration
  let llmIntegration = false;
  const envFiles = ['.env.example', '.env.sample', '.env'];
  for (const envFile of envFiles) {
    const content = fs.readFile(envFile);
    if (content && /MODEL_PROVIDER|OPENAI_API_KEY|ANTHROPIC_API_KEY|BEDROCK|OLLAMA/i.test(content)) {
      llmIntegration = true;
      break;
    }
  }
  if (!llmIntegration) {
    const reqFiles = ['requirements.txt', 'pyproject.toml', 'package.json'];
    for (const reqFile of reqFiles) {
      const content = fs.readFile(reqFile);
      if (content && /anthropic|openai|langchain|llamaindex|strands/i.test(content)) {
        llmIntegration = true;
        break;
      }
    }
  }

  // Static analysis level detection
  const phpstanConfig = fs.readFile('phpstan.neon') ?? fs.readFile('phpstan.neon.dist');
  if (phpstanConfig) {
    const levelMatch = phpstanConfig.match(/level:\s*(\d+|max)/);
    staticAnalysis.push({ tool: 'phpstan', level: levelMatch?.[1] ?? null });
  }
  const mypyConfig = fs.readFile('mypy.ini') ?? fs.readFile('setup.cfg');
  if (mypyConfig && /\[mypy\]/i.test(mypyConfig)) {
    const strictMatch = mypyConfig.match(/strict\s*=\s*(true|false)/i);
    staticAnalysis.push({ tool: 'mypy', level: strictMatch?.[1] === 'true' ? 'strict' : null });
  }

  // PHI/compliance signals
  let complianceSignals = false;
  const docsToCheck = ['README.md', 'docs/architecture.md', '.github/instructions/security.instructions.md'];
  for (const doc of docsToCheck) {
    const content = fs.readFile(doc);
    if (content && /\bPHI\b|HIPAA|GDPR|patient.*data|health.*record/i.test(content)) {
      complianceSignals = true;
      break;
    }
  }

  // Formatter coverage gaps
  const formatterGaps: string[] = [];
  const formatterMap: Record<string, string[]> = {
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
  const formatStr = (formatCommand ?? '').toLowerCase();
  for (const lang of languages) {
    const known = formatterMap[lang];
    if (!known) continue;
    const hasFormatter = known.some(f => formatStr.includes(f));
    if (!hasFormatter) formatterGaps.push(lang);
  }

  return { codeGenTools, deployPlatforms, llmIntegration, staticAnalysis, complianceSignals, formatterGaps };
}
