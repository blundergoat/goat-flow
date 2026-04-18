/**
 * HTTP server for the local goat-flow dashboard.
 * It serves the frontend shell, exposes audit, quality, setup, and terminal endpoints.
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  watch,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createFS } from "../facts/fs.js";
import { classifyProjectState } from "../classify-state.js";
import { runAudit } from "../audit/audit.js";
import { getPackageVersion } from "../paths.js";
import type { AgentId } from "../types.js";
import type { AuditReport } from "../audit/types.js";
import type { DashboardReport, Runner } from "./types.js";
import type { TerminalManager } from "./terminal.js";
import type { WebSocketServer, WebSocket as WsWebSocket } from "ws";

/** Recognized agent identifiers for the /api/setup endpoint */
const VALID_AGENTS = new Set<string>(["claude", "codex", "gemini"]);
/** Recognized runner identifiers for terminal session creation. */
const VALID_RUNNERS = new Set<string>(["claude", "codex", "gemini"]);
/** Maximum request body size accepted by POST endpoints */
const MAX_BODY_BYTES = 64 * 1024; // 64 KB
/** Current goat-flow package version for dashboard UI */
const PACKAGE_VERSION = getPackageVersion();
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
  return readFileSync(resolvePackageFile(name), "utf-8");
}

/** Replace `<!-- include: path -->` markers with fragment file contents (one level, no nesting). */
function assembleHtml(shellPath: string): string {
  let html = readFileSync(shellPath, "utf-8");
  const includePattern = /<!-- include: (.+?) -->/g;
  html = html.replace(includePattern, (_, path: string) => {
    const fragmentPath = join(dirname(shellPath), path);
    try {
      return readFileSync(fragmentPath, "utf-8");
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
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", reject);
  });
}

/** Send a JSON response. */
function jsonResponse(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Configuration options for launching the dashboard server */
interface DashboardOptions {
  projectPath: string;
  dev?: boolean;
}

/** Handle returned by serveDashboard for closing the server and reading the port */
interface DashboardServer {
  close: () => Promise<void>;
  port: number;
}

/** Start the local dashboard server and expose its API endpoints. */
export function serveDashboard(
  options: DashboardOptions,
): Promise<DashboardServer> {
  return new Promise((resolveStart) => {
    const shellPath = resolvePackageFile("dist/dashboard/index.html");
    const devMode = options.dev === true;
    // In dev mode, re-read on every request. In prod, cache once.
    let cachedTemplate: string | null = devMode
      ? null
      : assembleHtml(shellPath);
    /** Read the current dashboard HTML shell, using the cache when possible. */
    function getTemplate(): string {
      if (devMode) return assembleHtml(shellPath);
      if (!cachedTemplate) cachedTemplate = assembleHtml(shellPath);
      return cachedTemplate;
    }
    const absDefault = resolve(options.projectPath);

    /** Resolve a user-supplied path to an absolute path. */
    function safeResolvePath(raw: string | null): string {
      return resolve(raw || absDefault);
    }

    /** Fail fast when an endpoint expects a real project directory. */
    function requireProjectDirectory(projectPath: string): void {
      const stats = statSync(projectPath);
      if (!stats.isDirectory()) {
        throw new Error(`${projectPath} is not a directory`);
      }
    }

    // Live reload state (dev mode only)
    const liveReloadClients = new Set<WsWebSocket>();

    // Lazy-init terminal manager + WSS on first terminal request
    let managerPromise: Promise<TerminalManager> | null = null;
    let wssPromise: Promise<WebSocketServer> | null = null;

    /** Lazy-load the terminal manager the first time a terminal route is used. */
    async function getManager(): Promise<TerminalManager> {
      if (!managerPromise) {
        managerPromise = import("./terminal.js").then(
          ({ TerminalManager: TM }) => new TM(),
        );
      }
      return managerPromise;
    }

    /** Lazy-load the WebSocket server that bridges browser terminals to PTY sessions. */
    async function getWSS(): Promise<WebSocketServer> {
      if (!wssPromise) {
        wssPromise = import("ws").then(
          ({ WebSocketServer: WSS }) => new WSS({ noServer: true }),
        );
      }
      return wssPromise;
    }

    /** Serve the dashboard shell and inject the default workspace path. */
    function handleHtmlRequest(url: URL, res: ServerResponse): boolean {
      if (url.pathname !== "/") return false;

      const injection = `<script>window.__GOAT_FLOW_DEFAULT_PATH__ = ${JSON.stringify(absDefault)}; window.__GOAT_FLOW_VERSION__ = ${JSON.stringify(PACKAGE_VERSION)};</script>`;
      const liveReloadScript = devMode
        ? `<script>(function(){var ws=new WebSocket('ws://'+location.host+'/ws/livereload');ws.onmessage=function(){location.reload()};ws.onclose=function(){setTimeout(function(){location.reload()},1000)}})()</script>`
        : "";
      const html = getTemplate().replace(
        "</body>",
        `${injection}\n${liveReloadScript}\n</body>`,
      );
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return true;
    }

    /** Serve bundled dashboard assets from the compiled `dist/dashboard/` output. */
    function handleAssetRequest(url: URL, res: ServerResponse): boolean {
      if (!url.pathname.startsWith("/assets/")) return false;

      const filename = url.pathname.slice("/assets/".length);
      if (!/^[a-z0-9_-]+\.(js|css)$/i.test(filename)) return false;

      const contentType = filename.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "application/javascript; charset=utf-8";
      try {
        const content = loadPackageFile(`dist/dashboard/${filename}`);
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    /** Build a DashboardReport from per-agent audit results.
     * The Home page uses per-agent harness completeness, the Audit detail
     * page uses scope-based check results. This adapter produces
     * a single typed response covering both views. */
    const AGENT_NAMES: Record<string, string> = {
      claude: "Claude Code",
      codex: "Codex",
      gemini: "Gemini CLI",
    };

    /** Build the dashboard API payload from aggregate and per-agent audit results. */
    function buildDashboardReport(
      auditRpt: AuditReport,
      perAgentAudits: { id: string; audit: AuditReport }[],
    ): DashboardReport {
      return {
        agentScores: perAgentAudits.map((pa) => ({
          id: pa.id,
          name: AGENT_NAMES[pa.id] || pa.id,
          agent: pa.audit.scopes.agent,
          harness: pa.audit.scopes.harness,
          concerns: pa.audit.concerns,
        })),
        status: auditRpt.status,
        scopes: {
          setup: auditRpt.scopes.setup,
          agent: auditRpt.scopes.agent,
          ...(auditRpt.scopes.harness
            ? { harness: auditRpt.scopes.harness }
            : {}),
        },
        overall: auditRpt.overall,
        target: auditRpt.target,
      };
    }

    /** Run both evaluation systems and return a typed DashboardReport. */
    function handleAuditRequest(url: URL, res: ServerResponse): boolean {
      if (url.pathname !== "/api/audit") return false;

      const projectPath = safeResolvePath(url.searchParams.get("path"));
      const harness = url.searchParams.get("quality") === "true";
      const agentParam = url.searchParams.get("agent");
      const agentFilter =
        agentParam && VALID_AGENTS.has(agentParam)
          ? (agentParam as AgentId)
          : null;

      try {
        requireProjectDirectory(projectPath);
        const fs = createFS(projectPath);
        const auditRpt = runAudit(fs, projectPath, { agentFilter, harness });

        // Run per-agent audits for harness completeness (all detected agents)
        const agentInstructionFiles: [string, string][] = [
          ["claude", "CLAUDE.md"],
          ["codex", "AGENTS.md"],
          ["gemini", "GEMINI.md"],
        ];
        const configAgents = agentInstructionFiles
          .filter(([, file]) => fs.exists(file))
          .map(([id]) => id);
        const perAgentAudits: { id: string; audit: AuditReport }[] = [];
        for (const agentId of configAgents) {
          try {
            const agentAudit = runAudit(fs, projectPath, {
              agentFilter: agentId as AgentId,
              harness,
            });
            perAgentAudits.push({ id: agentId, audit: agentAudit });
          } catch {
            // Skip agents that fail to audit
          }
        }

        jsonResponse(res, 200, buildDashboardReport(auditRpt, perAgentAudits));
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
      if (url.pathname !== "/api/setup") return false;

      const projectPath = safeResolvePath(url.searchParams.get("path"));
      const agentParam = url.searchParams.get("agent");
      if (!agentParam) {
        jsonResponse(res, 400, {
          error:
            "Missing required parameter: agent. Valid: claude, codex, gemini",
        });
        return true;
      }
      if (!VALID_AGENTS.has(agentParam)) {
        jsonResponse(res, 400, {
          error: `Invalid agent: ${agentParam}. Valid: claude, codex, gemini`,
        });
        return true;
      }

      const agent = agentParam as AgentId;
      try {
        requireProjectDirectory(projectPath);
        const fs = createFS(projectPath);
        const { loadConfig } = await import("../config/reader.js");
        const { extractProjectFacts } =
          await import("../facts/orchestrator.js");
        const configState = loadConfig(projectPath, fs);
        const facts = extractProjectFacts(fs, {
          agentFilter: agent,
          projectPath,
          configState,
        });
        const auditReport = runAudit(fs, projectPath, {
          agentFilter: agent,
          harness: false,
        });
        const { composeSetup } = await import("../prompt/compose-setup.js");
        const output = composeSetup(auditReport, facts, agent);
        jsonResponse(res, 200, {
          output: output ?? "No setup output generated.",
        });
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Generate a quality-assessment prompt for a selected agent and return it to the dashboard. */
    async function handleQualityRequest(
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> {
      if (url.pathname !== "/api/quality") return false;

      const agentParam = url.searchParams.get("agent");
      if (!agentParam || !VALID_AGENTS.has(agentParam)) {
        jsonResponse(res, 400, {
          error: `quality requires --agent. Valid: claude, codex, gemini`,
        });
        return true;
      }

      const projectPath = safeResolvePath(url.searchParams.get("path"));
      const agent = agentParam as AgentId;

      try {
        requireProjectDirectory(projectPath);
        const { composeQuality } = await import("../prompt/compose-quality.js");

        let auditReport: AuditReport | null = null;
        try {
          const fs = createFS(projectPath);
          auditReport = runAudit(fs, projectPath, {
            agentFilter: agent,
            harness: true,
          });
        } catch {
          // Audit failure is fine - quality prompt generates with degraded context
        }

        const result = composeQuality({ agent, projectPath, auditReport });
        jsonResponse(res, 200, result);
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
        ".php": "PHP",
        ".py": "Python",
        ".ts": "TypeScript",
        ".js": "JavaScript",
        ".go": "Go",
        ".rs": "Rust",
        ".rb": "Ruby",
        ".java": "Java",
        ".cs": "C#",
        ".swift": "Swift",
        ".kt": "Kotlin",
      };
      const langSet = new Set<string>();
      const ignoredDirs = new Set([
        "node_modules",
        "vendor",
        "__pycache__",
        "dist",
        "build",
      ]);

      /** Scan a project tree for source-file extensions when inferring languages. */
      const scanExtensions = (dir: string, depth: number): void => {
        if (depth > 3) return;
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || ignoredDirs.has(entry.name))
              continue;
            if (entry.isDirectory()) {
              scanExtensions(join(dir, entry.name), depth + 1);
            } else {
              const ext = entry.name.slice(entry.name.lastIndexOf("."));
              if (extMap[ext]) langSet.add(extMap[ext]);
            }
          }
        } catch {
          /* unreadable dir */
        }
      };
      scanExtensions(projectPath, 0);

      const manifestLangs: [string, string][] = [
        ["package.json", "JavaScript"],
        ["composer.json", "PHP"],
        ["go.mod", "Go"],
        ["pyproject.toml", "Python"],
        ["Cargo.toml", "Rust"],
        ["Gemfile", "Ruby"],
      ];
      for (const [file, lang] of manifestLangs) {
        if (existsSync(join(projectPath, file))) langSet.add(lang);
      }
      if (existsSync(join(projectPath, "tsconfig.json")))
        langSet.add("TypeScript");

      return [...langSet];
    }

    /** Detect frameworks by matching patterns against dependency file contents. */
    function detectFrameworks(projectPath: string): string[] {
      const frameworkPatterns: [string, RegExp][] = [
        ["Symfony", /symfony\//i],
        ["Laravel", /laravel\/framework/i],
        ["Django", /django/i],
        ["FastAPI", /fastapi/i],
        ["Flask", /flask/i],
        ["Express", /"express"/i],
        ["React", /"react"/i],
        ["Vue", /"vue"/i],
        ["Angular", /@angular\/core/i],
        ["Next.js", /"next"/i],
        ["Nuxt", /"nuxt"/i],
        ["Svelte", /"svelte"/i],
        ["Rails", /rails/i],
        ["Spring", /spring-boot/i],
        ["Actix", /actix-web/i],
        ["Gin", /gin-gonic/i],
        ["Echo", /labstack\/echo/i],
      ];

      const depFiles = [
        "package.json",
        "composer.json",
        "Gemfile",
        "pyproject.toml",
        "Cargo.toml",
        "go.mod",
      ];
      let allDepsContent = "";
      for (const df of depFiles) {
        const fp = join(projectPath, df);
        if (existsSync(fp)) {
          try {
            allDepsContent += readFileSync(fp, "utf-8") + "\n";
          } catch {
            /* skip */
          }
        }
      }

      const frameworks: string[] = [];
      for (const [name, pattern] of frameworkPatterns) {
        if (pattern.test(allDepsContent)) frameworks.push(name);
      }
      return frameworks;
    }

    /** Type for the detected command slots. */
    type CommandSlots = {
      test: string;
      lint: string;
      build: string;
      format: string;
    };

    /** Fill empty command slots from package.json scripts. */
    function detectCommandsFromNpm(
      projectPath: string,
      commands: CommandSlots,
    ): void {
      const pkgPath = join(projectPath, "package.json");
      if (!existsSync(pkgPath)) return;
      try {
        const scripts =
          JSON.parse(readFileSync(pkgPath, "utf-8")).scripts || {};
        if (scripts.test) commands.test = "npm test";
        if (scripts.lint) commands.lint = "npm run lint";
        if (scripts.build) commands.build = "npm run build";
        if (scripts.format) commands.format = "npm run format";
      } catch {
        /* invalid JSON */
      }
    }

    /** Fill empty command slots from composer.json scripts. */
    function detectCommandsFromComposer(
      projectPath: string,
      commands: CommandSlots,
    ): void {
      const composerPath = join(projectPath, "composer.json");
      if (!existsSync(composerPath)) return;
      try {
        const scripts =
          JSON.parse(readFileSync(composerPath, "utf-8")).scripts || {};
        if (scripts.test && !commands.test) commands.test = "composer test";
        if (scripts.lint && !commands.lint) commands.lint = "composer lint";
      } catch {
        /* invalid JSON */
      }
    }

    /** Fill empty command slots from Makefile targets. */
    function detectCommandsFromMakefile(
      projectPath: string,
      commands: CommandSlots,
    ): void {
      const makefilePath = join(projectPath, "Makefile");
      if (!existsSync(makefilePath)) return;
      try {
        const makefile = readFileSync(makefilePath, "utf-8");
        const makeTargets: [keyof CommandSlots, RegExp][] = [
          ["test", /^test\s*:/m],
          ["lint", /^lint\s*:/m],
          ["build", /^build\s*:/m],
          ["format", /^(?:fmt|format)\s*:/m],
        ];
        for (const [slot, pattern] of makeTargets) {
          if (!commands[slot] && pattern.test(makefile))
            commands[slot] = `make ${slot}`;
        }
      } catch {
        /* unreadable */
      }
    }

    /** Fill empty command slots from pyproject.toml tool references. */
    function detectCommandsFromPyproject(
      projectPath: string,
      commands: CommandSlots,
    ): void {
      const pyprojectPath = join(projectPath, "pyproject.toml");
      if (!existsSync(pyprojectPath)) return;
      try {
        const pyproject = readFileSync(pyprojectPath, "utf-8");
        if (/pytest|unittest/.test(pyproject) && !commands.test)
          commands.test = "pytest";
        if (/ruff|flake8|pylint/.test(pyproject) && !commands.lint)
          commands.lint = "ruff check .";
        if (/black|ruff format/.test(pyproject) && !commands.format)
          commands.format = "ruff format .";
      } catch {
        /* unreadable */
      }
    }

    /** Detect test/lint/build/format commands from package.json, composer.json, Makefile, pyproject.toml. */
    function detectCommands(projectPath: string): CommandSlots {
      const commands: CommandSlots = {
        test: "",
        lint: "",
        build: "",
        format: "",
      };
      detectCommandsFromNpm(projectPath, commands);
      detectCommandsFromComposer(projectPath, commands);
      detectCommandsFromMakefile(projectPath, commands);
      detectCommandsFromPyproject(projectPath, commands);
      return commands;
    }

    /** Detect which AI coding agents have config directories in the project. */
    function detectAgents(projectPath: string): Record<string, boolean> {
      return {
        claude: existsSync(join(projectPath, ".claude")),
        codex: existsSync(join(projectPath, ".codex")),
        gemini: existsSync(join(projectPath, ".gemini")),
      };
    }

    /** Detect existing goat-flow artifacts (skills, instructions, lessons, footguns, config). */
    function detectExistingArtifacts(
      projectPath: string,
    ): Record<string, boolean> {
      const existing: Record<string, boolean> = {
        skills: false,
        instructions: false,
        lessons: false,
        footguns: false,
        config: false,
      };

      const skillRoots = [".claude/skills", ".agents/skills"];
      for (const root of skillRoots) {
        const skillsDir = join(projectPath, root);
        if (existsSync(skillsDir)) {
          try {
            if (readdirSync(skillsDir).some((e) => e.startsWith("goat-"))) {
              existing.skills = true;
              break;
            }
          } catch {
            /* unreadable */
          }
        }
      }

      existing.instructions = existsSync(
        join(projectPath, ".github", "instructions"),
      );
      existing.lessons =
        existsSync(join(projectPath, ".goat-flow", "lessons")) ||
        existsSync(join(projectPath, "ai", "lessons"));
      existing.footguns =
        existsSync(join(projectPath, ".goat-flow", "footguns")) ||
        existsSync(join(projectPath, "docs", "footguns")) ||
        existsSync(join(projectPath, "docs", "footguns.md"));
      existing.config = existsSync(
        join(projectPath, ".goat-flow", "config.yaml"),
      );

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

    /** Detect project stack, commands, agents, and existing config for the setup wizard. */
    function handleSetupDetectRequest(url: URL, res: ServerResponse): boolean {
      if (url.pathname !== "/api/setup/detect") return false;

      const projectPath = safeResolvePath(url.searchParams.get("path"));

      try {
        requireProjectDirectory(projectPath);
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
        "package.json",
        "go.mod",
        "Cargo.toml",
        "composer.json",
        "pyproject.toml",
        "CLAUDE.md",
        "AGENTS.md",
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
      if (url.pathname !== "/api/browse") return false;

      const dirPath = resolve(url.searchParams.get("path") || absDefault); // browse intentionally allows navigation outside project root
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
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
      if (url.pathname !== "/api/agents/installed") return false;

      const agents = ["claude", "codex", "gemini"].map((name) => {
        try {
          const whichCmd = process.platform === "win32" ? "where" : "which";
          execFileSync(whichCmd, [name], { timeout: 3000, stdio: "pipe" });
          let version: string | null = null;
          try {
            version =
              execFileSync(name, ["--version"], {
                timeout: 5000,
                stdio: "pipe",
              })
                .toString()
                .trim()
                .split("\n")[0] ?? null;
          } catch {
            /* version detection optional */
          }
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
      return message.includes("Maximum") ||
        message.includes("not found") ||
        message.includes("not available") ||
        message.includes("not a directory") ||
        message.includes("does not exist") ||
        message.includes("too large")
        ? 400
        : 500;
    }

    /** Start a terminal session for the requested runner and workspace. */
    async function handleTerminalCreateRequest(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> {
      if (url.pathname !== "/api/terminal/create" || req.method !== "POST")
        return false;

      try {
        const manager = await getManager();
        const body = JSON.parse(await readBody(req)) as {
          prompt?: string;
          projectPath?: string;
          runner?: string;
        };
        const runner = (
          body.runner && VALID_RUNNERS.has(body.runner) ? body.runner : "claude"
        ) as Runner;
        const result = await manager.create(
          body.prompt ?? "",
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
      if (url.pathname !== "/api/terminal/list" || req.method !== "GET")
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
      if (!url.pathname.startsWith("/api/terminal/") || req.method !== "DELETE")
        return false;

      const id = url.pathname.slice("/api/terminal/".length);
      try {
        const manager = await getManager();
        const killed = manager.kill(id);
        if (killed) {
          jsonResponse(res, 200, { ok: true });
        } else {
          jsonResponse(res, 404, { error: "Session not found" });
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
      if (url.pathname !== "/api/health" || req.method !== "GET") return false;

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

    /** Return enriched terminal session info with age and idle duration. */
    async function handleTerminalSessionsRequest(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> {
      if (url.pathname !== "/api/terminal/sessions" || req.method !== "GET")
        return false;

      try {
        const manager = await getManager();
        const sessions = manager.list();
        const now = Date.now();
        const enriched = sessions.map((s) => ({
          ...s,
          age: Math.floor((now - new Date(s.createdAt).getTime()) / 1000),
          idleDuration: Math.floor((now - s.lastInputAt) / 1000),
        }));
        jsonResponse(res, 200, {
          sessions: enriched,
          maxSessions: 7,
          activeCount: sessions.length,
        });
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Server-side project list persistence file path. */
    const projectsListFile = join(
      absDefault,
      ".goat-flow",
      "dashboard-projects.json",
    );

    /** Save/load the project list to/from disk so it survives server restarts. */
    async function handleProjectsListRequest(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> {
      if (url.pathname !== "/api/projects/list") return false;

      if (req.method === "GET") {
        try {
          const data = await import("node:fs/promises").then((fs) =>
            fs.readFile(projectsListFile, "utf-8"),
          );
          jsonResponse(res, 200, JSON.parse(data));
        } catch {
          jsonResponse(res, 200, { paths: [] });
        }
        return true;
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        try {
          const parsed = JSON.parse(body);
          const paths: string[] = Array.isArray(parsed.paths)
            ? parsed.paths
            : [];
          const { mkdir, writeFile } = await import("node:fs/promises");
          await mkdir(join(absDefault, ".goat-flow"), { recursive: true });
          await writeFile(projectsListFile, JSON.stringify({ paths }, null, 2));
          jsonResponse(res, 200, { ok: true });
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) });
        }
        return true;
      }

      jsonResponse(res, 405, { error: "Method not allowed" });
      return true;
    }

    /** Classify project adoption state for one or more paths. */
    function handleProjectsStatusRequest(
      url: URL,
      res: ServerResponse,
    ): boolean {
      if (url.pathname !== "/api/projects/status") return false;

      const pathsParam = url.searchParams.get("paths");
      if (!pathsParam) {
        jsonResponse(res, 400, { error: "Missing paths parameter" });
        return true;
      }

      const paths = pathsParam
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      const results = paths.map((p) => {
        try {
          const resolved = resolve(p);
          const fs = createFS(resolved);
          return { path: resolved, ...classifyProjectState(fs) };
        } catch (err) {
          return {
            path: p,
            state: "error" as const,
            action: "none" as const,
            details: String(err),
          };
        }
      });

      jsonResponse(res, 200, { projects: results });
      return true;
    }

    /** DNS rebinding protection: reject API requests with unexpected Host header. */
    function rejectBadHost(
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): boolean {
      if (!url.pathname.startsWith("/api/")) return false;
      const host = req.headers.host;
      const addr = server.address();
      if (addr && typeof addr !== "string") {
        const allowed = [`127.0.0.1:${addr.port}`, `localhost:${addr.port}`];
        if (!host || !allowed.includes(host)) {
          console.warn(
            `[dashboard] Blocked ${req.method} ${url.pathname} - Host: ${host || "(none)"}`,
          );
          res.writeHead(403);
          res.end("Forbidden");
          return true;
        }
      }
      return false;
    }

    /** Dispatch one HTTP request across the dashboard routes in priority order. */
    async function handleRequest(
      req: IncomingMessage,
      res: ServerResponse,
    ): Promise<void> {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "127.0.0.1"}`,
      );

      if (rejectBadHost(req, url, res)) return;

      // Log API requests in dev mode
      if (devMode && url.pathname.startsWith("/api/")) {
        console.log(`[dashboard] ${req.method} ${url.pathname}${url.search}`);
      }

      const routeHandlers = [
        () => Promise.resolve(handleHtmlRequest(url, res)),
        () => Promise.resolve(handleAssetRequest(url, res)),
        () => Promise.resolve(handleAuditRequest(url, res)),
        () => Promise.resolve(handleSetupDetectRequest(url, res)),
        () => handleSetupRequest(url, res),
        () => handleQualityRequest(url, res),

        () => Promise.resolve(handleBrowseRequest(url, res)),
        () => Promise.resolve(handleAgentDetectRequest(url, res)),
        () => handleProjectsListRequest(req, url, res),
        () => Promise.resolve(handleProjectsStatusRequest(url, res)),
        () => handleTerminalCreateRequest(req, url, res),
        () => handleTerminalListRequest(req, url, res),
        () => handleTerminalSessionsRequest(req, url, res),
        () => handleTerminalDeleteRequest(req, url, res),
        () => handleHealthRequest(req, url, res),
      ];

      for (const route of routeHandlers) {
        if (await route()) return;
      }

      res.writeHead(404);
      res.end("Not found");
    }

    const server = createServer((req, res) => {
      handleRequest(req, res).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Internal error";
        const stack = err instanceof Error ? err.stack : "";
        console.error(`[dashboard] ${req.method} ${req.url} → 500: ${msg}`);
        if (stack) console.error(stack);
        if (!res.headersSent) {
          jsonResponse(res, 500, { error: msg });
        }
      });
    });

    // Dev mode: watch dashboard files and notify connected browsers
    let closeDevWatcher: (() => void) | null = null;
    if (devMode) {
      const dashDir = dirname(shellPath);
      /** Notify live-reload clients that dashboard assets changed. */
      const notifyReload = (): void => {
        for (const client of liveReloadClients) {
          try {
            client.send("reload");
          } catch {
            /* ignore */
          }
        }
      };
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const watcher = watch(dashDir, { recursive: true }, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(notifyReload, 100);
      });
      /** Close the dev-mode dashboard file watcher and release its process hook. */
      const closeWatcher = (): void => {
        watcher.close();
      };
      process.on("exit", closeWatcher);
      closeDevWatcher = () => {
        process.off("exit", closeWatcher);
        closeWatcher();
      };
      console.log("Dev mode: watching dist/dashboard/ for changes");
    }

    // WebSocket upgrade for terminal and live-reload sessions
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);

      // Live reload WebSocket (dev mode)
      if (url.pathname === "/ws/livereload" && devMode) {
        void (async () => {
          try {
            const wss = await getWSS();
            wss.handleUpgrade(req, socket, head, (ws) => {
              liveReloadClients.add(ws as unknown as WsWebSocket);
              (ws as unknown as WsWebSocket).on("close", () => {
                liveReloadClients.delete(ws as unknown as WsWebSocket);
              });
            });
          } catch {
            socket.destroy();
          }
        })();
        return;
      }

      if (!url.pathname.startsWith("/ws/terminal/")) {
        socket.destroy();
        return;
      }

      // Origin check - reject non-localhost origins (DNS rebinding protection)
      const origin = req.headers.origin;
      const addr = server.address();
      if (origin && addr && typeof addr !== "string") {
        const expected = `http://127.0.0.1:${addr.port}`;
        if (origin !== expected && origin !== `http://localhost:${addr.port}`) {
          socket.destroy();
          return;
        }
      }

      const sessionId = url.pathname.slice("/ws/terminal/".length);

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
    let closePromise: Promise<void> | null = null;
    /** Close the dashboard server, watchers, and terminal sessions cleanly. */
    async function closeServer(): Promise<void> {
      if (closePromise) return closePromise;

      closePromise = (async () => {
        process.off("SIGTERM", doShutdown);
        process.off("SIGINT", doShutdown);
        closeDevWatcher?.();

        if (managerPromise) {
          const manager = await managerPromise;
          manager.shutdown();
        }
        if (wssPromise) {
          const wss = await wssPromise;
          await new Promise<void>((resolve) => {
            wss.close(() => {
              resolve();
            });
          });
        }
        await new Promise<void>((resolveClose, rejectClose) => {
          server.close((err) => {
            if (err) rejectClose(err);
            else resolveClose();
          });
          server.closeIdleConnections?.();
          server.closeAllConnections?.();
        });
      })();

      return closePromise;
    }

    /** Shut down the dashboard server's live terminal state before exiting the process. */
    const doShutdown = (): void => {
      void closeServer().finally(() => {
        process.exit(0);
      });
    };
    process.on("SIGTERM", doShutdown);
    process.on("SIGINT", doShutdown);

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return;
      const url = `http://127.0.0.1:${addr.port}`;
      console.log(`Dashboard: ${url}`);
      // Warn once at startup when the embedded terminal backend is unavailable.
      void getManager()
        .then((m) => m.health())
        .then((h) => {
          if (!h.nodePtyAvailable) {
            console.log(
              "Note: Terminal feature unavailable (node-pty not installed)",
            );
            console.log(
              "  Fix: npm install node-pty (or: pnpm approve-builds)",
            );
            console.log(
              "  See: https://github.com/blundergoat/goat-flow#troubleshooting",
            );
          }
        })
        .catch(() => {
          console.log(
            "Note: Terminal feature unavailable (node-pty not installed)",
          );
          console.log("  Fix: npm install node-pty (or: pnpm approve-builds)");
          console.log(
            "  See: https://github.com/blundergoat/goat-flow#troubleshooting",
          );
        });
      resolveStart({
        port: addr.port,
        close: closeServer,
      });
    });
  }); // end Promise
}
