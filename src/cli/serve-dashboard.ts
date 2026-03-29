import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { createFS } from './facts/fs.js';
import { scanProject } from './scanner/scan.js';
import { renderJson } from './render/json.js';
import type { AgentId } from './types.js';

/** Load a file from a node_modules package using Node's module resolution */
function loadNodeModule(pkg: string, file: string): string {
  const require = createRequire(import.meta.url);
  const pkgDir = dirname(require.resolve(`${pkg}/package.json`));
  return readFileSync(join(pkgDir, file), 'utf-8');
}

/** Load a file from the package root by walking up */
function loadPackageFile(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    try { return readFileSync(join(dir, name), 'utf-8'); } catch { /* up */ }
    dir = dirname(dir);
  }
  throw new Error(`${name} not found`);
}

/**
 * Start a local dashboard server. Serves the HTML dashboard and
 * exposes /api/scan and /api/setup endpoints that run the CLI.
 */
export function serveDashboard(defaultPath: string): void {
  const template = loadPackageFile('dashboard/index.html');
  const absDefault = resolve(defaultPath);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // Dashboard HTML — inject default project path
    if (url.pathname === '/') {
      const injection = `<script>window.__GOAT_FLOW_DEFAULT_PATH__ = ${JSON.stringify(absDefault)};</script>`;
      const html = template.replace('</body>', `${injection}\n</body>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // Scan API
    if (url.pathname === '/api/scan') {
      const projectPath = resolve(url.searchParams.get('path') || absDefault);
      try {
        const fs = createFS(projectPath);
        const report = scanProject(fs, projectPath, { agentFilter: null });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(renderJson(report));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    // Setup API
    if (url.pathname === '/api/setup') {
      const projectPath = resolve(url.searchParams.get('path') || absDefault);
      const agent = (url.searchParams.get('agent') || 'claude') as AgentId;
      try {
        const fs = createFS(projectPath);
        const report = scanProject(fs, projectPath, { agentFilter: agent });
        // Dynamic import to keep startup fast
        import('./prompt/compose-setup.js').then(({ composeSetup }) => {
          const output = composeSetup(report, agent);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ output: output ?? 'No setup output generated.' }));
        }).catch((err: unknown) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    // Vendor assets served from node_modules
    if (url.pathname === '/vendor/tailwindcss-browser.js') {
      try {
        const content = loadNodeModule('@tailwindcss/browser', 'dist/index.global.js');
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=86400' });
        res.end(content);
      } catch { res.writeHead(404); res.end('tailwindcss-browser not found — run npm install'); }
      return;
    }
    if (url.pathname === '/vendor/alpinejs.js') {
      try {
        const content = loadNodeModule('alpinejs', 'dist/cdn.min.js');
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=86400' });
        res.end(content);
      } catch { res.writeHead(404); res.end('alpinejs not found — run npm install'); }
      return;
    }

    // Browse directories API
    if (url.pathname === '/api/browse') {
      const dirPath = resolve(url.searchParams.get('path') || absDefault);
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .map(e => e.name)
          .sort();
        // Check which subdirs look like projects (have package.json, go.mod, CLAUDE.md, etc.)
        const dirs = entries.map(name => {
          const full = join(dirPath, name);
          const hasProject = ['package.json', 'go.mod', 'Cargo.toml', 'composer.json', 'pyproject.toml', 'CLAUDE.md', 'AGENTS.md'].some(f => {
            try { statSync(join(full, f)); return true; } catch { return false; }
          });
          return { name, path: full, isProject: hasProject };
        });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ current: dirPath, parent: dirname(dirPath), dirs }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') return;
    const url = `http://127.0.0.1:${addr.port}`;
    console.log(`Dashboard: ${url}`);
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${openCmd} "${url}"`);
  });
}
