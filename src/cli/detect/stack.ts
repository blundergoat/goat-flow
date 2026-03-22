import type { StackInfo, ReadonlyFS } from '../types.js';

export function detectStack(fs: ReadonlyFS): StackInfo {
  const languages: string[] = [];
  let buildCommand: string | null = null;
  let testCommand: string | null = null;
  let lintCommand: string | null = null;
  let formatCommand: string | null = null;

  // Node.js / package.json
  const pkg = fs.readJson('package.json') as Record<string, unknown> | null;
  if (pkg) {
    languages.push('javascript');
    const deps = { ...pkg.dependencies as Record<string, string> | undefined, ...pkg.devDependencies as Record<string, string> | undefined };
    if (deps && ('typescript' in deps || fs.exists('tsconfig.json'))) {
      languages.push('typescript');
    }
    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (scripts) {
      buildCommand = scripts.build ?? null;
      testCommand = scripts.test ?? null;
      lintCommand = scripts.lint ?? null;
      formatCommand = scripts.format ?? scripts['format:check'] ?? null;
    }
  }

  // PHP / composer.json
  const composer = fs.readJson('composer.json') as Record<string, unknown> | null;
  if (composer) {
    languages.push('php');
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
  if (fs.exists('go.mod') || fs.glob('*/go.mod').length > 0 || fs.glob('*/*/go.mod').length > 0) {
    languages.push('go');
    buildCommand = buildCommand ?? 'go build ./...';
    testCommand = testCommand ?? 'go test ./...';
    lintCommand = lintCommand ?? 'go vet ./...';
    formatCommand = formatCommand ?? 'gofmt -l .';
  }

  // Python / pyproject.toml (root or subdirectory)
  const hasPython = fs.exists('pyproject.toml') || fs.exists('setup.py') || fs.exists('requirements.txt')
    || fs.glob('*/pyproject.toml').length > 0 || fs.glob('*/requirements.txt').length > 0;
  if (hasPython) {
    languages.push('python');
    testCommand = testCommand ?? 'pytest';
    lintCommand = lintCommand ?? 'ruff check';
  }

  // Monorepo: check subdirectory manifests for languages not detected at root
  if (!languages.includes('javascript')) {
    const subPkg = fs.glob('*/package.json').length > 0 || fs.glob('*/*/package.json').length > 0;
    if (subPkg) {
      languages.push('javascript');
      // Check for TypeScript in subdirs
      if (!languages.includes('typescript') && (fs.glob('*/tsconfig.json').length > 0 || fs.glob('*/*/tsconfig.json').length > 0)) {
        languages.push('typescript');
      }
    }
  }

  if (!languages.includes('php')) {
    if (fs.glob('*/composer.json').length > 0) {
      languages.push('php');
    }
  }

  if (!languages.includes('rust')) {
    if (fs.glob('*/Cargo.toml').length > 0) {
      languages.push('rust');
    }
  }

  // Shell scripts
  if (fs.glob('**/*.sh').length > 0) {
    if (!languages.includes('bash')) languages.push('bash');
  }

  // Markdown-only (docs project)
  if (languages.length === 0 && fs.glob('**/*.md').length > 5) {
    languages.push('markdown');
  }

  return { languages, buildCommand, testCommand, lintCommand, formatCommand };
}
