import type { ProjectShape, ReadonlyFS } from '../types.js';

export function detectShape(fs: ReadonlyFS): ProjectShape {
  // Check package.json first (most common)
  const pkg = fs.readJson('package.json') as Record<string, unknown> | null;
  if (pkg) {
    // Library signals
    if (pkg.main || pkg.exports || pkg.types) return 'library';
    // App signals
    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (scripts?.start || scripts?.dev || scripts?.serve) return 'app';
    // Default to app for Node projects
    return 'app';
  }

  // Check composer.json
  const composer = fs.readJson('composer.json') as Record<string, unknown> | null;
  if (composer) {
    const type = composer.type as string | undefined;
    if (type && (type.includes('library') || type === 'project')) {
      return type.includes('library') ? 'library' : 'app';
    }
    return 'app';
  }

  // Check Cargo.toml
  const cargo = fs.readFile('Cargo.toml');
  if (cargo) {
    if (/\[lib\]/m.test(cargo)) return 'library';
    if (/\[\[bin\]\]/m.test(cargo)) return 'app';
    return 'app';
  }

  // Check go.mod
  if (fs.exists('go.mod')) return 'app';

  // Check pyproject.toml
  const pyproject = fs.readFile('pyproject.toml');
  if (pyproject) {
    if (/\[project\.scripts\]/m.test(pyproject)) return 'app';
    if (/\[tool\.setuptools\]/m.test(pyproject)) return 'library';
    return 'app';
  }

  // Collection signals: shell scripts, no build system
  if (fs.exists('lib') || fs.exists('scripts')) {
    const hasShellScripts = fs.glob('**/*.sh').length > 3;
    const hasMakefile = fs.exists('Makefile');
    if (hasShellScripts && !hasMakefile) return 'collection';
    if (hasMakefile && !pkg && !composer) return 'collection';
  }

  // Fallback
  return 'app';
}
