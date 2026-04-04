/**
 * HTTP server for the local goat-flow dashboard.
 * It serves the frontend shell, exposes scan and terminal endpoints, and manages first-run browser opening.
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  watch,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createFS } from '../facts/fs.js';
import { scanProject } from '../scanner/scan.js';
import { renderJson } from '../render/json.js';
import type { AgentId } from '../types.js';
import type { Runner } from './types.js';
import type { TerminalManager } from './terminal.js';
import type { WebSocketServer, WebSocket as WsWebSocket } from 'ws';

/** Recognized agent identifiers for the /api/setup endpoint */
const VALID_AGENTS = new Set<string>(['claude', 'codex', 'gemini']);
/** Recognized runner identifiers for terminal session creation */
const VALID_RUNNERS = new Set<string>(['claude', 'codex', 'gemini']);
/** Maximum request body size accepted by POST endpoints */
const MAX_BODY_BYTES = 64 * 1024; // 64 KB

/** Resolve the absolute path to a file in the package root by walking up */
function resolvePackageFile(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, name);
    try {
      statSync(candidate);
      return candidate;
    } catch {
      /* up */
    }
    dir = dirname(dir);
  }
  throw new Error(`${name} not found`);
}

/** Load a file from the package root by walking up */
function loadPackageFile(name: string): string {
  return readFileSync(resolvePackageFile(name), 'utf-8');
}

/** Replace `<!-- include: path -->` markers with fragment file contents (one level, no nesting). */
function assembleHtml(shellPath: string): string {
  let html = readFileSync(shellPath, 'utf-8');
  const includePattern = /<!-- include: (.+?) -->/g;
  html = html.replace(includePattern, (_, path: string) => {
    const fragmentPath = join(dirname(shellPath), path);
    try {
      return readFileSync(fragmentPath, 'utf-8');
    } catch {
      return `<!-- ERROR: Could not include ${path} -->`;
    }
  });
  return html;
}

/** Read the request body as a string, capped at MAX_BODY_BYTES. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', reject);
  });
}

/** Send a JSON response. */
function jsonResponse(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Configuration options for launching the dashboard server */
interface DashboardOptions {
  projectPath: string;
  openBrowser: boolean;
  dev?: boolean;
}

/** Handle returned by serveDashboard for closing the server and reading the port */
export interface DashboardServer {
  close: () => Promise<void>;
  port: number;
}

/** Return the workspace-local flag that suppresses first-run browser auto-open. */
function getDashboardOpenFlagPath(projectPath: string): string {
  return join(projectPath, '.goat-flow', '.goat-flow-dashboard-opened');
}

/** Record that the dashboard has already auto-opened for this workspace. */
function markDashboardOpened(projectPath: string): void {
  const flagPath = getDashboardOpenFlagPath(projectPath);
  try {
    mkdirSync(dirname(flagPath), { recursive: true });
    writeFileSync(flagPath, '');
  } catch {
    /* ignore */
  }
}

/** Auto-open the dashboard only until this workspace has been marked as seen. */
function shouldOpenDashboardInBrowser(projectPath: string): boolean {
  return !existsSync(getDashboardOpenFlagPath(projectPath));
}

/** Open the dashboard URL in the platform-default browser. */
function openBrowserWindow(url: string): void {
  const [command, args] = (() => {
    if (process.platform === 'darwin') {
      return ['open', [url] as string[]] as const;
    }
    if (process.platform === 'win32') {
      return ['cmd', ['/c', 'start', '', url] as string[]] as const;
    }
    return ['xdg-open', [url] as string[]] as const;
  })();

  try {
    const proc = spawn(command, args, { detached: true, stdio: 'ignore' });
    proc.unref();
  } catch {
    /* ignore */
  }
}

/**
 * Start a local dashboard server. Serves the HTML dashboard and
 * exposes /api/scan, /api/setup, /api/terminal/*, and /api/health endpoints.
 * Returns a handle for testing; callers that don't need it can ignore the return value.
 */
export function serveDashboard(
  options: DashboardOptions,
): Promise<DashboardServer> {
  return new Promise((resolveStart) => {
    const shellPath = resolvePackageFile('src/dashboard/index.html');
    const devMode = options.dev === true;
    // In dev mode, re-read on every request. In prod, cache once.
    let cachedTemplate: string | null = devMode ? null : assembleHtml(shellPath);
    function getTemplate(): string {
      if (devMode) return assembleHtml(shellPath);
      if (!cachedTemplate) cachedTemplate = assembleHtml(shellPath);
      return cachedTemplate;
    }
    const absDefault = resolve(options.projectPath);
    const openBrowser = options.openBrowser === true;

    // Live reload state (dev mode only)
    const liveReloadClients = new Set<WsWebSocket>();

    // Lazy-init terminal manager + WSS on first terminal request
    let managerPromise: Promise<TerminalManager> | null = null;
    let wssPromise: Promise<WebSocketServer> | null = null;

    /** Lazy-load the terminal manager the first time a terminal route is used. */
    async function getManager(): Promise<TerminalManager> {
      if (!managerPromise) {
        managerPromise = import('./terminal.js').then(
          ({ TerminalManager: TM }) => new TM(),
        );
      }
      return managerPromise;
    }

    /** Lazy-load the WebSocket server that bridges browser terminals to PTY sessions. */
    async function getWSS(): Promise<WebSocketServer> {
      if (!wssPromise) {
        wssPromise = import('ws').then(
          ({ WebSocketServer: WSS }) => new WSS({ noServer: true }),
        );
      }
      return wssPromise;
    }

    /** Serve the dashboard shell and inject the default workspace path. */
    function handleHtmlRequest(url: URL, res: ServerResponse): boolean {
      if (url.pathname !== '/') return false;

      const injection = `<script>window.__GOAT_FLOW_DEFAULT_PATH__ = ${JSON.stringify(absDefault)};</script>`;
      const liveReloadScript = devMode
        ? `<script>(function(){var ws=new WebSocket('ws://'+location.host+'/ws/livereload');ws.onmessage=function(){location.reload()};ws.onclose=function(){setTimeout(function(){location.reload()},1000)}})()</script>`
        : '';
      const html = getTemplate().replace('</body>', `${injection}\n${liveReloadScript}\n</body>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return true;
    }

    /** Serve bundled dashboard JavaScript assets from the package source tree. */
    function handleAssetRequest(url: URL, res: ServerResponse): boolean {
      if (!url.pathname.startsWith('/assets/')) return false;

      const filename = url.pathname.slice('/assets/'.length);
      if (!/^[a-z0-9_-]+\.js$/i.test(filename)) return false;

      try {
        const content = loadPackageFile(`src/dashboard/${filename}`);
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
        });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
      return true;
    }

    /** Run a full scan for the requested path and return the JSON report. */
    function handleScanRequest(url: URL, res: ServerResponse): boolean {
      if (url.pathname !== '/api/scan') return false;

      const projectPath = resolve(url.searchParams.get('path') || absDefault);
      try {
        const fs = createFS(projectPath);
        const report = scanProject(fs, projectPath, { agentFilter: null });
        jsonResponse(res, 200, JSON.parse(renderJson(report)));
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Compose setup output for one agent and return it to the dashboard. */
    async function handleSetupRequest(
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> {
      if (url.pathname !== '/api/setup') return false;

      const projectPath = resolve(url.searchParams.get('path') || absDefault);
      const agentParam = url.searchParams.get('agent') || 'claude';
      if (!VALID_AGENTS.has(agentParam)) {
        jsonResponse(res, 400, {
          error: `Invalid agent: ${agentParam}. Valid: claude, codex, gemini`,
        });
        return true;
      }

      const agent = agentParam as AgentId;
      try {
        const fs = createFS(projectPath);
        const report = scanProject(fs, projectPath, { agentFilter: agent });
        const { composeSetup } = await import('../prompt/compose-setup.js');
        const output = composeSetup(report, agent);
        jsonResponse(res, 200, {
          output: output ?? 'No setup output generated.',
        });
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Detect languages by scanning file extensions, manifest files, and tsconfig. */
    function detectLanguages(projectPath: string): string[] {
      const extMap: Record<string, string> = {
        '.php': 'PHP',
        '.py': 'Python',
        '.ts': 'TypeScript',
        '.js': 'JavaScript',
        '.go': 'Go',
        '.rs': 'Rust',
        '.rb': 'Ruby',
        '.java': 'Java',
        '.cs': 'C#',
        '.swift': 'Swift',
        '.kt': 'Kotlin',
      };
      const langSet = new Set<string>();
      const ignoredDirs = new Set(['node_modules', 'vendor', '__pycache__', 'dist', 'build']);

      const scanExtensions = (dir: string, depth: number): void => {
        if (depth > 3) return;
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || ignoredDirs.has(entry.name)) continue;
            if (entry.isDirectory()) {
              scanExtensions(join(dir, entry.name), depth + 1);
            } else {
              const ext = entry.name.slice(entry.name.lastIndexOf('.'));
              if (extMap[ext]) langSet.add(extMap[ext]);
            }
          }
        } catch { /* unreadable dir */ }
      };
      scanExtensions(projectPath, 0);

      const manifestLangs: [string, string][] = [
        ['package.json', 'JavaScript'],
        ['composer.json', 'PHP'],
        ['go.mod', 'Go'],
        ['pyproject.toml', 'Python'],
        ['Cargo.toml', 'Rust'],
        ['Gemfile', 'Ruby'],
      ];
      for (const [file, lang] of manifestLangs) {
        if (existsSync(join(projectPath, file))) langSet.add(lang);
      }
      if (existsSync(join(projectPath, 'tsconfig.json'))) langSet.add('TypeScript');

      return [...langSet];
    }

    /** Detect frameworks by matching patterns against dependency file contents. */
    function detectFrameworks(projectPath: string): string[] {
      const frameworkPatterns: [string, RegExp][] = [
        ['Symfony', /symfony\//i],
        ['Laravel', /laravel\/framework/i],
        ['Django', /django/i],
        ['FastAPI', /fastapi/i],
        ['Flask', /flask/i],
        ['Express', /"express"/i],
        ['React', /"react"/i],
        ['Vue', /"vue"/i],
        ['Angular', /@angular\/core/i],
        ['Next.js', /"next"/i],
        ['Nuxt', /"nuxt"/i],
        ['Svelte', /"svelte"/i],
        ['Rails', /rails/i],
        ['Spring', /spring-boot/i],
        ['Actix', /actix-web/i],
        ['Gin', /gin-gonic/i],
        ['Echo', /labstack\/echo/i],
      ];

      const depFiles = ['package.json', 'composer.json', 'Gemfile', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
      let allDepsContent = '';
      for (const df of depFiles) {
        const fp = join(projectPath, df);
        if (existsSync(fp)) {
          try { allDepsContent += readFileSync(fp, 'utf-8') + '\n'; } catch { /* skip */ }
        }
      }

      const frameworks: string[] = [];
      for (const [name, pattern] of frameworkPatterns) {
        if (pattern.test(allDepsContent)) frameworks.push(name);
      }
      return frameworks;
    }

    /** Type for the detected command slots. */
    type CommandSlots = { test: string; lint: string; build: string; format: string };

    /** Fill empty command slots from package.json scripts. */
    function detectCommandsFromNpm(projectPath: string, commands: CommandSlots): void {
      const pkgPath = join(projectPath, 'package.json');
      if (!existsSync(pkgPath)) return;
      try {
        const scripts = JSON.parse(readFileSync(pkgPath, 'utf-8')).scripts || {};
        if (scripts.test) commands.test = 'npm test';
        if (scripts.lint) commands.lint = 'npm run lint';
        if (scripts.build) commands.build = 'npm run build';
        if (scripts.format) commands.format = 'npm run format';
      } catch { /* invalid JSON */ }
    }

    /** Fill empty command slots from composer.json scripts. */
    function detectCommandsFromComposer(projectPath: string, commands: CommandSlots): void {
      const composerPath = join(projectPath, 'composer.json');
      if (!existsSync(composerPath)) return;
      try {
        const scripts = JSON.parse(readFileSync(composerPath, 'utf-8')).scripts || {};
        if (scripts.test && !commands.test) commands.test = 'composer test';
        if (scripts.lint && !commands.lint) commands.lint = 'composer lint';
      } catch { /* invalid JSON */ }
    }

    /** Fill empty command slots from Makefile targets. */
    function detectCommandsFromMakefile(projectPath: string, commands: CommandSlots): void {
      const makefilePath = join(projectPath, 'Makefile');
      if (!existsSync(makefilePath)) return;
      try {
        const makefile = readFileSync(makefilePath, 'utf-8');
        const makeTargets: [keyof CommandSlots, RegExp][] = [
          ['test', /^test\s*:/m],
          ['lint', /^lint\s*:/m],
          ['build', /^build\s*:/m],
          ['format', /^(?:fmt|format)\s*:/m],
        ];
        for (const [slot, pattern] of makeTargets) {
          if (!commands[slot] && pattern.test(makefile)) commands[slot] = `make ${slot}`;
        }
      } catch { /* unreadable */ }
    }

    /** Fill empty command slots from pyproject.toml tool references. */
    function detectCommandsFromPyproject(projectPath: string, commands: CommandSlots): void {
      const pyprojectPath = join(projectPath, 'pyproject.toml');
      if (!existsSync(pyprojectPath)) return;
      try {
        const pyproject = readFileSync(pyprojectPath, 'utf-8');
        if (/pytest|unittest/.test(pyproject) && !commands.test) commands.test = 'pytest';
        if (/ruff|flake8|pylint/.test(pyproject) && !commands.lint) commands.lint = 'ruff check .';
        if (/black|ruff format/.test(pyproject) && !commands.format) commands.format = 'ruff format .';
      } catch { /* unreadable */ }
    }

    /** Detect test/lint/build/format commands from package.json, composer.json, Makefile, pyproject.toml. */
    function detectCommands(projectPath: string): CommandSlots {
      const commands: CommandSlots = { test: '', lint: '', build: '', format: '' };
      detectCommandsFromNpm(projectPath, commands);
      detectCommandsFromComposer(projectPath, commands);
      detectCommandsFromMakefile(projectPath, commands);
      detectCommandsFromPyproject(projectPath, commands);
      return commands;
    }

    /** Detect which AI coding agents have config directories in the project. */
    function detectAgents(projectPath: string): Record<string, boolean> {
      return {
        claude: existsSync(join(projectPath, '.claude')),
        codex: existsSync(join(projectPath, '.codex')),
        gemini: existsSync(join(projectPath, '.gemini')),
        copilot: existsSync(join(projectPath, '.github', 'copilot-instructions.md')),
      };
    }

    /** Detect existing goat-flow artifacts (skills, instructions, evals, lessons, footguns, config). */
    function detectExistingArtifacts(projectPath: string): Record<string, boolean> {
      const existing: Record<string, boolean> = {
        skills: false,
        instructions: false,
        evals: false,
        lessons: false,
        footguns: false,
        config: false,
      };

      const skillsDir = join(projectPath, '.claude', 'skills');
      if (existsSync(skillsDir)) {
        try {
          existing.skills = readdirSync(skillsDir).some((e) => e.startsWith('goat-'));
        } catch { /* unreadable */ }
      }

      existing.instructions = existsSync(join(projectPath, 'ai-docs')) || existsSync(join(projectPath, 'ai'));
      existing.evals = existsSync(join(projectPath, 'ai', 'evals')) || existsSync(join(projectPath, 'ai-docs', 'evals'));
      existing.lessons = existsSync(join(projectPath, 'ai', 'lessons')) || existsSync(join(projectPath, 'ai-docs', 'lessons'));
      existing.footguns = existsSync(join(projectPath, 'docs', 'footguns')) || existsSync(join(projectPath, 'ai-docs', 'footguns'));
      existing.config = existsSync(join(projectPath, '.goat-flow', 'config.yaml'));

      return existing;
    }

    /** Detect non-goat-flow agent config files (.github/instructions, CLAUDE.md, etc.). */
    function detectNonGoatFlowConfig(projectPath: string): string[] {
      const nonGoatFlow: string[] = [];
      const checks: [string[], string][] = [
        [['.github', 'instructions'], '.github/instructions/'],
        [['.github', 'copilot-instructions.md'], '.github/copilot-instructions.md'],
        [['CLAUDE.md'], 'CLAUDE.md'],
        [['AGENTS.md'], 'AGENTS.md'],
        [['CODEX.md'], 'CODEX.md'],
        [['.cursorrules'], '.cursorrules'],
      ];
      for (const [segments, label] of checks) {
        if (existsSync(join(projectPath, ...segments))) nonGoatFlow.push(label);
      }
      return nonGoatFlow;
    }

    /** Detect project stack, commands, agents, and existing config for the setup wizard. */
    function handleSetupDetectRequest(
      url: URL,
      res: ServerResponse,
    ): boolean {
      if (url.pathname !== '/api/setup/detect') return false;

      const projectPath = resolve(url.searchParams.get('path') || absDefault);

      try {
        jsonResponse(res, 200, {
          languages: detectLanguages(projectPath),
          frameworks: detectFrameworks(projectPath),
          commands: detectCommands(projectPath),
          agents: detectAgents(projectPath),
          existing: detectExistingArtifacts(projectPath),
          nonGoatFlow: detectNonGoatFlowConfig(projectPath),
        });
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Heuristically treat a directory as a project when it has common repo markers. */
    function isProjectDirectory(dirPath: string): boolean {
      return [
        'package.json',
        'go.mod',
        'Cargo.toml',
        'composer.json',
        'pyproject.toml',
        'CLAUDE.md',
        'AGENTS.md',
      ].some((file) => {
        try {
          statSync(join(dirPath, file));
          return true;
        } catch {
          return false;
        }
      });
    }

    /** List child directories so the dashboard path picker can browse nearby repos. */
    function handleBrowseRequest(url: URL, res: ServerResponse): boolean {
      if (url.pathname !== '/api/browse') return false;

      const dirPath = resolve(url.searchParams.get('path') || absDefault);
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => entry.name)
          .sort();
        const dirs = entries.map((name) => {
          const full = join(dirPath, name);
          return { name, path: full, isProject: isProjectDirectory(full) };
        });
        jsonResponse(res, 200, {
          current: dirPath,
          parent: dirname(dirPath),
          dirs,
        });
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Detect which coding agent CLIs are installed on the machine. */
    function handleAgentDetectRequest(url: URL, res: ServerResponse): boolean {
      if (url.pathname !== '/api/agents/installed') return false;

      const agents = ['claude', 'codex', 'gemini'].map(name => {
        try {
          execFileSync('which', [name], { timeout: 3000, stdio: 'pipe' });
          let version: string | null = null;
          try {
            version = execFileSync(name, ['--version'], { timeout: 5000, stdio: 'pipe' }).toString().trim().split('\n')[0] ?? null;
          } catch { /* version detection optional */ }
          return { id: name, installed: true, version };
        } catch {
          return { id: name, installed: false, version: null };
        }
      });

      jsonResponse(res, 200, { agents });
      return true;
    }

    /** Map terminal-launch failures to the client-facing HTTP status codes we expose. */
    function terminalCreateStatus(message: string): number {
      return message.includes('Maximum') ||
        message.includes('not found') ||
        message.includes('not available') ||
        message.includes('too large')
        ? 400
        : 500;
    }

    /** Start a terminal session for the requested runner and workspace. */
    async function handleTerminalCreateRequest(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> {
      if (url.pathname !== '/api/terminal/create' || req.method !== 'POST')
        return false;

      try {
        const manager = await getManager();
        const body = JSON.parse(await readBody(req)) as {
          prompt?: string;
          projectPath?: string;
          runner?: string;
        };
        const runner = (
          body.runner && VALID_RUNNERS.has(body.runner) ? body.runner : 'claude'
        ) as Runner;
        const result = await manager.create(
          body.prompt ?? '',
          body.projectPath ?? absDefault,
          runner,
        );
        jsonResponse(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        jsonResponse(res, terminalCreateStatus(message), { error: message });
      }
      return true;
    }

    /** Return the set of currently live terminal sessions. */
    async function handleTerminalListRequest(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> {
      if (url.pathname !== '/api/terminal/list' || req.method !== 'GET')
        return false;

      try {
        const manager = await getManager();
        jsonResponse(res, 200, manager.list());
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Kill one terminal session and report whether it existed. */
    async function handleTerminalDeleteRequest(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> {
      if (!url.pathname.startsWith('/api/terminal/') || req.method !== 'DELETE')
        return false;

      const id = url.pathname.slice('/api/terminal/'.length);
      try {
        const manager = await getManager();
        const killed = manager.kill(id);
        if (killed) {
          jsonResponse(res, 200, { ok: true });
        } else {
          jsonResponse(res, 404, { error: 'Session not found' });
        }
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Return terminal-backend health details for dashboard diagnostics. */
    async function handleHealthRequest(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> {
      if (url.pathname !== '/api/health' || req.method !== 'GET') return false;

      try {
        const manager = await getManager();
        jsonResponse(res, 200, await manager.health());
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Read config.yaml and config.local.yaml for the settings view. */
    function handleConfigReadRequest(url: URL, res: ServerResponse): boolean {
      if (url.pathname !== '/api/config') return false;

      const projectPath = resolve(url.searchParams.get('path') || absDefault);
      const configPath = join(projectPath, '.goat-flow', 'config.yaml');
      const localConfigPath = join(
        projectPath,
        '.goat-flow',
        'config.local.yaml',
      );

      try {
        if (!existsSync(configPath)) {
          jsonResponse(res, 200, {
            config: null,
            localConfig: null,
            note: 'No .goat-flow/config.yaml found',
          });
          return true;
        }

        const config = readFileSync(configPath, 'utf-8');
        const localConfig = existsSync(localConfigPath)
          ? readFileSync(localConfigPath, 'utf-8')
          : null;

        jsonResponse(res, 200, { config, localConfig });
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Check if a YAML line looks syntactically valid (key: value, list item, or continuation). */
    function isValidYamlLine(line: string): boolean {
      return /^\s*[\w.-]+\s*:/.test(line) || /^\s*-\s/.test(line) || /^\s+\S/.test(line);
    }

    /** Validate YAML content for binary characters, unclosed brackets, and basic syntax. Returns error message or null. */
    function validateYamlContent(content: string): string | null {
      if (/[\x00-\x08\x0e-\x1f]/.test(content)) return 'Content contains binary characters';
      const stripped = content.replace(/#.*/g, '').replace(/(['"])(?:(?!\1).)*\1/g, '');
      const opens = (stripped.match(/[[\{]/g) || []).length;
      const closes = (stripped.match(/[\]\}]/g) || []).length;
      if (opens !== closes) return `Invalid YAML: unclosed bracket or brace (${opens} opened, ${closes} closed)`;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] as string;
        if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
        if (!isValidYamlLine(line)) return `Invalid YAML syntax at line ${i + 1}: "${line.trim()}"`;
      }
      return null;
    }

    /** Write config.local.yaml with basic validation. */
    async function handleConfigWriteRequest(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> {
      if (url.pathname !== '/api/config/local' || req.method !== 'PUT')
        return false;

      try {
        const body = JSON.parse(await readBody(req)) as { content?: string };
        const content = body.content;
        if (typeof content !== 'string') {
          jsonResponse(res, 400, { error: 'Missing content field' });
          return true;
        }

        const yamlError = validateYamlContent(content);
        if (yamlError) {
          jsonResponse(res, 400, { error: yamlError });
          return true;
        }

        const projectPath = resolve(url.searchParams.get('path') || absDefault);
        const dirPath = join(projectPath, '.goat-flow');
        const localConfigPath = join(dirPath, 'config.local.yaml');

        mkdirSync(dirPath, { recursive: true });
        writeFileSync(localConfigPath, content, 'utf-8');
        jsonResponse(res, 200, { success: true });
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Delete config.local.yaml to reset local overrides. */
    function handleConfigDeleteRequest(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): boolean {
      if (url.pathname !== '/api/config/local' || req.method !== 'DELETE')
        return false;

      try {
        const projectPath = resolve(url.searchParams.get('path') || absDefault);
        const localConfigPath = join(
          projectPath,
          '.goat-flow',
          'config.local.yaml',
        );

        if (existsSync(localConfigPath)) {
          unlinkSync(localConfigPath);
        }
        jsonResponse(res, 200, { success: true });
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Dispatch one HTTP request across the dashboard routes in priority order. */
    async function handleRequest(
      req: IncomingMessage,
      res: ServerResponse,
    ): Promise<void> {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const routeHandlers = [
        () => Promise.resolve(handleHtmlRequest(url, res)),
        () => Promise.resolve(handleAssetRequest(url, res)),
        () => Promise.resolve(handleScanRequest(url, res)),
        () => Promise.resolve(handleSetupDetectRequest(url, res)),
        () => handleSetupRequest(url, res),
        () => Promise.resolve(handleBrowseRequest(url, res)),
        () => Promise.resolve(handleAgentDetectRequest(url, res)),
        () => Promise.resolve(handleConfigReadRequest(url, res)),
        () => handleConfigWriteRequest(req, url, res),
        () => Promise.resolve(handleConfigDeleteRequest(req, url, res)),
        () => handleTerminalCreateRequest(req, url, res),
        () => handleTerminalListRequest(req, url, res),
        () => handleTerminalDeleteRequest(req, url, res),
        () => handleHealthRequest(req, url, res),
      ];

      for (const route of routeHandlers) {
        if (await route()) return;
      }

      res.writeHead(404);
      res.end('Not found');
    }

    const server = createServer((req, res) => {
      handleRequest(req, res).catch((err: unknown) => {
        if (!res.headersSent) {
          jsonResponse(res, 500, {
            error: err instanceof Error ? err.message : 'Internal error',
          });
        }
      });
    });

    // Dev mode: watch dashboard files and notify connected browsers
    if (devMode) {
      const dashDir = dirname(shellPath);
      const notifyReload = (): void => {
        for (const client of liveReloadClients) {
          try { client.send('reload'); } catch { /* ignore */ }
        }
      };
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const watcher = watch(dashDir, { recursive: true }, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(notifyReload, 100);
      });
      process.on('exit', () => { watcher.close(); });
      console.log('Dev mode: watching src/dashboard/ for changes');
    }

    // WebSocket upgrade for terminal and live-reload sessions
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`);

      // Live reload WebSocket (dev mode)
      if (url.pathname === '/ws/livereload' && devMode) {
        void (async () => {
          try {
            const wss = await getWSS();
            wss.handleUpgrade(req, socket, head, (ws) => {
              liveReloadClients.add(ws as unknown as WsWebSocket);
              (ws as unknown as WsWebSocket).on('close', () => {
                liveReloadClients.delete(ws as unknown as WsWebSocket);
              });
            });
          } catch { socket.destroy(); }
        })();
        return;
      }

      if (!url.pathname.startsWith('/ws/terminal/')) {
        socket.destroy();
        return;
      }

      // Origin check — reject non-localhost origins (DNS rebinding protection)
      const origin = req.headers.origin;
      const addr = server.address();
      if (origin && addr && typeof addr !== 'string') {
        const expected = `http://127.0.0.1:${addr.port}`;
        if (origin !== expected && origin !== `http://localhost:${addr.port}`) {
          socket.destroy();
          return;
        }
      }

      const sessionId = url.pathname.slice('/ws/terminal/'.length);

      void (async () => {
        try {
          const wss = await getWSS();
          const manager = await getManager();
          wss.handleUpgrade(req, socket, head, (ws) => {
            manager.attachWebSocket(sessionId, ws as unknown as WsWebSocket);
          });
        } catch {
          socket.destroy();
        }
      })();
    });

    // Gracefully stop any live terminal sessions before the process exits.
    /** Shut down the dashboard server's live terminal state before exiting the process. */
    const doShutdown = (): void => {
      void (async () => {
        if (managerPromise) {
          const manager = await managerPromise;
          manager.shutdown();
        }
        process.exit(0);
      })();
    };
    process.on('SIGTERM', doShutdown);
    process.on('SIGINT', doShutdown);

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return;
      const url = `http://127.0.0.1:${addr.port}`;
      console.log(`Dashboard: ${url}`);
      if (openBrowser && shouldOpenDashboardInBrowser(absDefault)) {
        openBrowserWindow(url);
        markDashboardOpened(absDefault);
      }
      // Warn once at startup when the embedded terminal backend is unavailable.
      void getManager()
        .then((m) => m.health())
        .then((h) => {
          if (!h.nodePtyAvailable) {
            console.log(
              'Note: Terminal feature unavailable (node-pty not installed)',
            );
            console.log(
              '  Fix: npm install node-pty (or: pnpm approve-builds)',
            );
            console.log(
              '  See: https://github.com/blundergoat/goat-flow#troubleshooting',
            );
          }
        })
        .catch(() => {
          console.log(
            'Note: Terminal feature unavailable (node-pty not installed)',
          );
          console.log('  Fix: npm install node-pty (or: pnpm approve-builds)');
          console.log(
            '  See: https://github.com/blundergoat/goat-flow#troubleshooting',
          );
        });
      resolveStart({
        port: addr.port,
        close: async () => {
          if (managerPromise) {
            const manager = await managerPromise;
            manager.shutdown();
          }
          server.close();
        },
      });
    });
  }); // end Promise
}
