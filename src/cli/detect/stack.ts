import type { StackInfo, ReadonlyFS } from '../types.js';

/** Detect languages, build/test/lint/format commands from project manifests */
export function detectStack(fs: ReadonlyFS): StackInfo {
  /** Detected programming languages present in the project */
  const languages: string[] = [];
  /** Detected build command from project manifest scripts */
  let buildCommand: string | null = null;
  /** Detected test command from project manifest scripts */
  let testCommand: string | null = null;
  /** Detected lint command from project manifest scripts */
  let lintCommand: string | null = null;
  /** Detected format command from project manifest scripts */
  let formatCommand: string | null = null;

  // Node.js / package.json
  /** Parsed package.json contents, or null if not present */
  const pkg = fs.readJson('package.json') as Record<string, unknown> | null;
  if (pkg) {
    languages.push('javascript');
    /** Merged production and dev dependencies from package.json */
    const deps = { ...pkg.dependencies as Record<string, string> | undefined, ...pkg.devDependencies as Record<string, string> | undefined };
    if (deps && ('typescript' in deps || fs.exists('tsconfig.json'))) {
      languages.push('typescript');
    }
    /** Scripts block from package.json for command detection */
    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (scripts) {
      buildCommand = scripts.build ?? null;
      testCommand = scripts.test ?? null;
      lintCommand = scripts.lint ?? null;
      formatCommand = scripts.format ?? scripts['format:check'] ?? null;
    }
  }

  // PHP / composer.json
  /** Parsed composer.json contents, or null if not present */
  const composer = fs.readJson('composer.json') as Record<string, unknown> | null;
  if (composer) {
    languages.push('php');
    /** Scripts block from composer.json for command detection */
    const scripts = composer.scripts as Record<string, string> | undefined;
    if (scripts) {
      testCommand = testCommand ?? scripts.test ?? null;
      lintCommand = lintCommand ?? scripts.analyse ?? scripts.lint ?? null;
      formatCommand = formatCommand ?? scripts['cs:check'] ?? scripts['cs:fix'] ?? null;
    }
  }

  // Rust / Cargo.toml
  if (fs.exists('Cargo.toml')) {
    languages.push('rust');
    buildCommand = buildCommand ?? 'cargo build';
    testCommand = testCommand ?? 'cargo test';
    lintCommand = lintCommand ?? 'cargo clippy';
    formatCommand = formatCommand ?? 'cargo fmt --check';
  }

  // Go / go.mod (root or subdirectory)
  // Monorepo detection: checks */go.mod and */*/go.mod (2 levels deep). Deeper nesting not supported.
  if (fs.exists('go.mod') || fs.glob('*/go.mod').length > 0 || fs.glob('*/*/go.mod').length > 0) {
    languages.push('go');
    buildCommand = buildCommand ?? 'go build ./...';
    testCommand = testCommand ?? 'go test ./...';
    lintCommand = lintCommand ?? 'go vet ./...';
    formatCommand = formatCommand ?? 'gofmt -l .';
  }

  // Python / pyproject.toml (root or subdirectory)
  /** Whether any Python project indicator files exist at root or in subdirectories */
  const hasPython = fs.exists('pyproject.toml') || fs.exists('setup.py') || fs.exists('requirements.txt')
    || fs.glob('*/pyproject.toml').length > 0 || fs.glob('*/requirements.txt').length > 0;
  if (hasPython) {
    languages.push('python');
    testCommand = testCommand ?? 'pytest';
    lintCommand = lintCommand ?? 'ruff check';
  }

  // Monorepo: check subdirectory manifests for languages not detected at root
  if (languages.includes('javascript') === false) {
    /** Whether a package.json exists in any subdirectory (up to 2 levels deep) */
    const subPkg = fs.glob('*/package.json').length > 0 || fs.glob('*/*/package.json').length > 0;
    if (subPkg) {
      languages.push('javascript');
      // Check for TypeScript in subdirs
      if (languages.includes('typescript') === false && (fs.glob('*/tsconfig.json').length > 0 || fs.glob('*/*/tsconfig.json').length > 0)) {
        languages.push('typescript');
      }
    }
  }

  if (languages.includes('php') === false) {
    if (fs.glob('*/composer.json').length > 0) {
      languages.push('php');
    }
  }

  if (languages.includes('rust') === false) {
    if (fs.glob('*/Cargo.toml').length > 0) {
      languages.push('rust');
    }
  }

  // Shell scripts
  if (fs.glob('**/*.sh').length > 0) {
    if (languages.includes('bash') === false) languages.push('bash');
  }

  // Markdown-only (docs project)
  if (languages.length === 0 && fs.glob('**/*.md').length > 5) {
    languages.push('markdown');
  }

  return { languages, buildCommand, testCommand, lintCommand, formatCommand };
}
