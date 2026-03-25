import type { StackInfo, ReadonlyFS } from '../types.js';

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

  // Markdown-only fallback: only when no languages were detected
  if (languages.length === 0) {
    const mdResult = detectMarkdownOnly(fs);
    if (mdResult.languages) {
      languages.push(...mdResult.languages);
    }
  }

  return { languages, buildCommand, testCommand, lintCommand, formatCommand };
}
