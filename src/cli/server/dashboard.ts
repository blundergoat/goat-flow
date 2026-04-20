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
import { execFileSync } from "node:child_process";
import { createFS } from "../facts/fs.js";
import { classifyProjectState } from "../classify-state.js";
import { runAudit } from "../audit/audit.js";
import {
  getPackageVersion,
  getTemplatePath,
  resolveFirstExistingPackagePath,
} from "../paths.js";
import {
  getAgentProfileMap,
  getAgentProfiles,
  getKnownAgentIds,
} from "../agents/registry.js";
import { detectAgents as detectConfiguredAgents } from "../detect/agents.js";
import type { AgentId } from "../types.js";
import { detectStack as detectCanonicalStack } from "../detect/project-stack.js";
import type { AuditReport } from "../audit/types.js";
import type { QualityHistoryEntry } from "../quality/history.js";
import type { DashboardReport, Runner } from "./types.js";
import type { TerminalManager } from "./terminal.js";
import { MAX_SESSIONS } from "./terminal.js";
import type { WebSocketServer, WebSocket as WsWebSocket } from "ws";

const KNOWN_AGENT_IDS = getKnownAgentIds();
const KNOWN_AGENT_LIST = KNOWN_AGENT_IDS.join(", ");
const AGENT_PROFILES = getAgentProfiles();
const AGENT_PROFILE_MAP = getAgentProfileMap();
const SUPPORTED_AGENTS = AGENT_PROFILES.map(({ id, name }) => ({ id, name }));
/** Recognized agent identifiers for the dashboard API. */
const VALID_AGENTS = new Set<string>(KNOWN_AGENT_IDS);
/** Recognized runner identifiers for terminal session creation. */
const VALID_RUNNERS = new Set<string>(KNOWN_AGENT_IDS);
const DEFAULT_RUNNER: Runner = KNOWN_AGENT_IDS[0] ?? "claude";
/** Maximum request body size accepted by POST endpoints */
const MAX_BODY_BYTES = 64 * 1024; // 64 KB
/** Current goat-flow package version for dashboard UI */
const PACKAGE_VERSION = getPackageVersion();
/** Relative locations where the dashboard preset catalog may exist. */
const DASHBOARD_PRESET_CATALOG_PATHS = [
  "dist/dashboard/preset-prompts.json",
  "src/dashboard/preset-prompts.json",
] as const;

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

interface LatestQualitySummary {
  id: string;
  date: string;
  time: string;
  agent: AgentId;
  setupTotal: number;
  systemTotal: number;
  blockerCount: number;
  majorCount: number;
  minorCount: number;
  /** Distinct evidence methods used in the latest run's findings. */
  evidenceMethods: string[];
  /** Optional scope declaration from the report (framework-self vs consumer). */
  scope: string | null;
}

interface DashboardPreset {
  id: string;
  name: string;
  desc: string;
  prompt: string;
  cat: string;
}

/** Parse the quality history limit. */
function parseQualityHistoryLimit(param: string | null): number | null {
  if (param === null) return 20;
  const parsed = Number.parseInt(param, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : null;
}

/** Build the latest quality summary. */
function buildLatestQualitySummary(
  entry: QualityHistoryEntry | null,
): LatestQualitySummary | null {
  if (!entry) return null;
  const findings = entry.report.findings;
  return {
    id: entry.id,
    date: entry.date,
    time: entry.time,
    agent: entry.agent,
    setupTotal: entry.report.scores.setup.total,
    systemTotal: entry.report.scores.system.total,
    blockerCount: findings.filter((f) => f.severity === "BLOCKER").length,
    majorCount: findings.filter((f) => f.severity === "MAJOR").length,
    minorCount: findings.filter((f) => f.severity === "MINOR").length,
    evidenceMethods: Array.from(
      new Set(findings.map((f) => f.evidence_method)),
    ),
    scope: entry.report.scope ?? null,
  };
}

/** Read the dashboard preset definitions shipped with the frontend bundle. */
function loadDashboardPresets(): DashboardPreset[] {
  const presetPath = resolveFirstExistingPackagePath(
    DASHBOARD_PRESET_CATALOG_PATHS,
  );
  const relativePath =
    DASHBOARD_PRESET_CATALOG_PATHS.find(
      (candidate) => getTemplatePath(candidate) === presetPath,
    ) ?? DASHBOARD_PRESET_CATALOG_PATHS[0];
  const raw = JSON.parse(readFileSync(presetPath, "utf-8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`${relativePath} must contain an array`);
  }
  return raw.map((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.desc !== "string" ||
      typeof entry.prompt !== "string" ||
      typeof entry.cat !== "string"
    ) {
      throw new Error(`${relativePath} has an invalid preset at index ${index}`);
    }
    return entry;
  });
}

/** Start the local dashboard server and expose its API endpoints. */
export function serveDashboard(
  options: DashboardOptions,
): Promise<DashboardServer> {
  return new Promise((resolveStart) => {
    const shellPath = getTemplatePath("dist/dashboard/index.html");
    const dashboardPresets = loadDashboardPresets();
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

      const injection = `<script>window.__GOAT_FLOW_DEFAULT_PATH__ = ${JSON.stringify(absDefault)}; window.__GOAT_FLOW_VERSION__ = ${JSON.stringify(PACKAGE_VERSION)}; window.__GOAT_FLOW_AGENTS__ = ${JSON.stringify(SUPPORTED_AGENTS)}; window.__GOAT_FLOW_RUNNER_IDS__ = ${JSON.stringify(KNOWN_AGENT_IDS)}; window.__GOAT_FLOW_PRESETS__ = ${JSON.stringify(dashboardPresets)};</script>`;
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
      if (!/^[a-z0-9_-]+\.(js|css|json)$/i.test(filename)) return false;

      const contentType = filename.endsWith(".css")
        ? "text/css; charset=utf-8"
        : filename.endsWith(".json")
          ? "application/json; charset=utf-8"
          : "application/javascript; charset=utf-8";
      try {
        const content =
          filename === "preset-prompts.json"
            ? readFileSync(
                resolveFirstExistingPackagePath(
                  DASHBOARD_PRESET_CATALOG_PATHS,
                ),
                "utf-8",
              )
            : readFileSync(getTemplatePath(`dist/dashboard/${filename}`), "utf-8");
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    /** Build the dashboard API payload from aggregate and per-agent audit results. */
    function buildDashboardReport(
      auditRpt: AuditReport,
      perAgentAudits: { id: string; audit: AuditReport }[],
    ): DashboardReport {
      return {
        agentScores: perAgentAudits.map((pa) => {
          const agentId = pa.id as AgentId;
          return {
            id: pa.id,
            name: AGENT_PROFILE_MAP[agentId].name,
            agent: pa.audit.scopes.agent,
            harness: pa.audit.scopes.harness,
            concerns: pa.audit.concerns,
          };
        }),
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
        const configAgents = detectConfiguredAgents(fs).map(
          (agent) => agent.id,
        );
        const perAgentAudits: { id: string; audit: AuditReport }[] = [];
        for (const agentId of configAgents) {
          try {
            const agentAudit = runAudit(fs, projectPath, {
              agentFilter: agentId,
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
          error: `Missing required parameter: agent. Valid: ${KNOWN_AGENT_LIST}`,
        });
        return true;
      }
      if (!VALID_AGENTS.has(agentParam)) {
        jsonResponse(res, 400, {
          error: `Invalid agent: ${agentParam}. Valid: ${KNOWN_AGENT_LIST}`,
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
          error: `quality requires --agent. Valid: ${KNOWN_AGENT_LIST}`,
        });
        return true;
      }

      const projectPath = safeResolvePath(url.searchParams.get("path"));
      const agent = agentParam as AgentId;

      try {
        requireProjectDirectory(projectPath);
        const { composeQuality } = await import("../prompt/compose-quality.js");
        const { getLatestQualityHistoryEntry, loadQualityHistory } =
          await import("../quality/history.js");

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

        const history = loadQualityHistory(projectPath);
        const priorReport = getLatestQualityHistoryEntry(
          history.entries,
          agent,
        );
        const result = composeQuality({
          agent,
          projectPath,
          auditReport,
          priorReport,
        });
        jsonResponse(res, 200, result);
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    /** Return persisted quality-history rows and latest trend summary for dashboard UI rendering. */
    async function handleQualityHistoryRequest(
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> {
      if (url.pathname !== "/api/quality/history") return false;

      const projectPath = safeResolvePath(url.searchParams.get("path"));
      const agentParam = url.searchParams.get("agent");
      const agent =
        agentParam && VALID_AGENTS.has(agentParam)
          ? (agentParam as AgentId)
          : null;

      if (agentParam && !agent) {
        jsonResponse(res, 400, {
          error: `quality history agent must be one of: ${KNOWN_AGENT_LIST}`,
        });
        return true;
      }

      const limit = parseQualityHistoryLimit(url.searchParams.get("limit"));

      try {
        requireProjectDirectory(projectPath);
        const {
          buildQualityHistoryRows,
          getLatestQualityHistoryEntry,
          loadQualityHistory,
        } = await import("../quality/history.js");
        const history = loadQualityHistory(projectPath);
        const rows = buildQualityHistoryRows(history.entries, {
          agent,
          limit,
        });
        const latestEntry = agent
          ? getLatestQualityHistoryEntry(history.entries, agent)
          : (history.entries[0] ?? null);

        jsonResponse(res, 200, {
          rows,
          latest: buildLatestQualitySummary(latestEntry),
          warnings: history.warnings,
        });
      } catch (err) {
        jsonResponse(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
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

    /** Display labels for canonical stack language ids shown in the setup UI. */
    const SETUP_LANGUAGE_LABELS: Record<string, string> = {
      javascript: "JavaScript",
      typescript: "TypeScript",
      php: "PHP",
      python: "Python",
      go: "Go",
      rust: "Rust",
      ruby: "Ruby",
      java: "Java",
      csharp: "C#",
      bash: "Bash",
      swift: "Swift",
      kotlin: "Kotlin",
      markdown: "Markdown",
      blade: "Blade",
      jinja: "Jinja",
    };

    /** Convert canonical stack command fields into setup-view command slots. */
    function buildSetupCommands(stack: {
      testCommand: string | null;
      lintCommand: string | null;
      buildCommand: string | null;
      formatCommand: string | null;
    }): CommandSlots {
      return {
        test: stack.testCommand ?? "",
        lint: stack.lintCommand ?? "",
        build: stack.buildCommand ?? "",
        format: stack.formatCommand ?? "",
      };
    }

    /** Convert canonical stack language ids into the setup-view display labels. */
    function buildSetupLanguages(stackLanguages: readonly string[]): string[] {
      const labels: string[] = [];
      for (const language of stackLanguages) {
        const display = SETUP_LANGUAGE_LABELS[language];
        if (display && !labels.includes(display)) labels.push(display);
      }
      return labels;
    }

    /** Build the setup-view stack summary from canonical detection plus setup-only framework probing. */
    function detectSetupStack(projectPath: string): {
      languages: string[];
      frameworks: string[];
      commands: CommandSlots;
    } {
      const stack = detectCanonicalStack(createFS(projectPath));
      return {
        languages: buildSetupLanguages(stack.languages),
        frameworks: detectFrameworks(projectPath),
        commands: buildSetupCommands(stack),
      };
    }

    /** Detect which supported agent surfaces already exist in the project. */
    function detectScaffoldedAgents(
      projectPath: string,
    ): Record<string, boolean> {
      return Object.fromEntries(
        AGENT_PROFILES.map((agent) => {
          const markers = [
            agent.instructionFile,
            agent.settingsFile,
            agent.hookConfigFile,
            agent.hooksDir,
          ].filter((value): value is string => typeof value === "string");
          const present = markers.some((marker) =>
            existsSync(join(projectPath, marker)),
          );
          return [agent.id, present];
        }),
      );
    }

    /** Detect existing goat-flow artifacts (skills, instructions, lessons, footguns, config). */
    function detectExistingArtifacts(
      projectPath: string,
    ): Record<string, boolean> {
      const existing: Record<string, boolean> = {
        skills: false,
        instructionsRepoWide: false,
        instructionsPathScoped: false,
        lessons: false,
        footguns: false,
        config: false,
      };

      const skillRoots = [
        ...new Set(AGENT_PROFILES.map((agent) => agent.skillsDir)),
      ];
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

      existing.instructionsRepoWide = existsSync(
        join(projectPath, ".github", "copilot-instructions.md"),
      );
      existing.instructionsPathScoped = existsSync(
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

    /** Detect project stack, commands, agents, and existing config for the setup view. */
    function handleSetupDetectRequest(url: URL, res: ServerResponse): boolean {
      if (url.pathname !== "/api/setup/detect") return false;

      const projectPath = safeResolvePath(url.searchParams.get("path"));

      try {
        requireProjectDirectory(projectPath);
        const stack = detectSetupStack(projectPath);
        jsonResponse(res, 200, {
          languages: stack.languages,
          frameworks: stack.frameworks,
          commands: stack.commands,
          agents: detectScaffoldedAgents(projectPath),
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
        ...AGENT_PROFILES.map((agent) => agent.instructionFile),
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

      const agents = SUPPORTED_AGENTS.map(({ id, name }) => {
        try {
          const whichCmd = process.platform === "win32" ? "where" : "which";
          execFileSync(whichCmd, [id], { timeout: 3000, stdio: "pipe" });
          let version: string | null = null;
          try {
            version =
              execFileSync(id, ["--version"], {
                timeout: 5000,
                stdio: "pipe",
              })
                .toString()
                .trim()
                .split("\n")[0] ?? null;
          } catch {
            /* version detection optional */
          }
          return { id, name, installed: true, version };
        } catch {
          return { id, name, installed: false, version: null };
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
        const { decodeTerminalCreateBody } = await import("./decoders.js");
        const decoded = decodeTerminalCreateBody(await readBody(req), {
          validRunners: VALID_RUNNERS,
          defaultRunner: DEFAULT_RUNNER,
        });
        if (!decoded.ok) {
          jsonResponse(res, 400, { error: decoded.error, path: decoded.path });
          return true;
        }
        const { prompt, projectPath, runner } = decoded.value;
        const result = await manager.create(
          prompt,
          projectPath || absDefault,
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
          maxSessions: MAX_SESSIONS,
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
          const { decodeProjectsListBody } = await import("./decoders.js");
          const decoded = decodeProjectsListBody(body);
          if (!decoded.ok) {
            jsonResponse(res, 400, {
              error: decoded.error,
              path: decoded.path,
            });
            return true;
          }
          const { mkdir, writeFile } = await import("node:fs/promises");
          await mkdir(join(absDefault, ".goat-flow"), { recursive: true });
          await writeFile(
            projectsListFile,
            JSON.stringify({ paths: decoded.value.paths }, null, 2),
          );
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
        () => handleQualityHistoryRequest(url, res),

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
      /** Release the dev watcher and its exit hook. */
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
          server.closeIdleConnections();
          server.closeAllConnections();
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
