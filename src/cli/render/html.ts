import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScanReport } from '../types.js';

/**
 * Render a self-contained HTML dashboard with scan data and vendor scripts inlined.
 * The output file works offline — no CDN or server needed.
 */
export function renderHtml(report: ScanReport): string {
  let html = loadFile('dashboard/index.html');
  const jsonData = JSON.stringify(report);

  // Inline vendor scripts from node_modules so the file is fully self-contained
  const tailwind = loadNodeModule('@tailwindcss/browser', 'dist/index.global.js');
  const alpine = loadNodeModule('alpinejs', 'dist/cdn.min.js');
  html = html.replace('<script src="/vendor/tailwindcss-browser.js"></script>', `<script>${tailwind}</script>`);
  html = html.replace('<script defer src="/vendor/alpinejs.js"></script>', `<script defer>${alpine}</script>`);

  // Inject report data
  const injection = `<script>window.__GOAT_FLOW_REPORT__ = ${jsonData};</script>`;
  return html.replace('</body>', `${injection}\n</body>`);
}

/** Load a file from the package root by walking up from dist/cli/render/ */
function loadFile(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    try { return readFileSync(join(dir, name), 'utf-8'); } catch { /* up */ }
    dir = dirname(dir);
  }
  throw new Error(`${name} not found. Reinstall goat-flow.`);
}

/** Load a file from a node_modules package using Node's module resolution */
function loadNodeModule(pkg: string, file: string): string {
  const require = createRequire(import.meta.url);
  const pkgDir = dirname(require.resolve(`${pkg}/package.json`));
  return readFileSync(join(pkgDir, file), 'utf-8');
}
