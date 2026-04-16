/**
 * Type declarations for the GOAT Flow dashboard (browser environment).
 * These types are shared across all dashboard script files.
 */

type AuditStatus = "pass" | "fail";
type RunnerId = "claude" | "codex" | "gemini";
type SessionStatus = "starting" | "active" | "terminated";

// ---------------------------------------------------------------------------
// Dashboard API response types
// ---------------------------------------------------------------------------

/** Failure entry returned by the audit API for a failed check. */
interface AuditFailure {
  check: string;
  message: string;
  evidence?: string;
  howToFix?: string;
}

/** Individual check result inside an audit scope. */
interface AuditCheck {
  id: string;
  name: string;
  status: AuditStatus;
  failure?: AuditFailure;
}

/** Audit scope as returned by the /api/audit endpoint. */
interface AuditScope {
  status: AuditStatus;
  checks: AuditCheck[];
  failures: AuditFailure[];
  summary: Record<string, string>;
}

/** Concern data from the harness completeness audit. */
interface AuditConcern {
  status: AuditStatus;
  score: number;
  findings: string[];
  recommendations: string[];
  howToFix: string[];
}

/** Per-agent audit summary shown on the Home and Audit views. */
interface AgentScore {
  id: RunnerId;
  name: string;
  agent: AuditScope;
  harness: AuditScope | null;
  concerns: Record<string, AuditConcern> | null;
}

/** Named audit scopes included in the dashboard report payload. */
interface DashboardClientScopes {
  setup: AuditScope;
  agent: AuditScope;
  harness?: AuditScope;
}

/** Dashboard audit report returned by `/api/audit`. */
interface DashboardClientReport {
  agentScores: AgentScore[];
  status: AuditStatus;
  scopes: DashboardClientScopes;
  overall: { status: AuditStatus };
  target: string;
}

/** Agent detection info from `/api/agents/installed`. */
interface AgentInfo {
  id: RunnerId;
  installed: boolean;
  version: string | null;
}

/** Browser directory entry from `/api/browse`. */
interface BrowseDir {
  name: string;
  path: string;
  isProject: boolean;
}

/** Project entry shown in the dashboard Projects view. */
interface ProjectEntry {
  path: string;
  state: string;
  action: string;
  details: string;
}

/** Critique prompt payload returned by `/api/critique`. */
interface CritiqueResult {
  command: "critique";
  agent: RunnerId;
  auditStatus: AuditStatus | "unavailable";
  auditSummary: string;
  prompt: string;
}

// ---------------------------------------------------------------------------
// Terminal types
// ---------------------------------------------------------------------------

/** Server-side terminal session info, enriched by `/api/terminal/sessions`. */
interface ServerSessionInfo {
  id: string;
  status: SessionStatus;
  createdAt: string;
  projectPath: string;
  runner: RunnerId;
  lastInputAt: number;
  age?: number;
  idleDuration?: number;
  projectName?: string;
}

/** Local terminal session tracked by the frontend Alpine state. */
interface LocalSession {
  id: string;
  runner: RunnerId;
  promptLabel: string;
  projectPath: string;
  startTime: number;
  lastInputTime: number;
  connected: boolean;
  ended: boolean;
  age: string;
  presetId: string | null;
}

/** Non-reactive xterm/WebSocket handles kept outside Alpine's proxy state. */
interface TerminalRefs {
  ws?: WebSocket;
  xterm?: XTermInstance;
  cleanup?: () => void;
  ageInterval?: ReturnType<typeof setInterval>;
}

/** Session metadata cached per project so the UI can reconnect after a switch. */
interface SavedSession {
  sessionId: string;
  startTime: number;
  prompt: string;
  agent: RunnerId;
}

/** Predefined audit command button shown in the workspace terminal panel. */
interface AuditAction {
  id: string;
  label: string;
  command: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Preset types
// ---------------------------------------------------------------------------

/** Preset prompt configuration for the workspace launcher. */
interface Preset {
  id: string;
  name: string;
  desc: string;
  prompt: string;
  cat: string;
}

// ---------------------------------------------------------------------------
// Wizard types
// ---------------------------------------------------------------------------

/** Detected command slots shown in the setup wizard. */
interface WizardCommands {
  test: string;
  lint: string;
  build: string;
  format: string;
}

/** Existing GOAT Flow artifacts detected in the selected project. */
interface ExistingArtifacts {
  skills: boolean;
  instructions: boolean;
  lessons: boolean;
  footguns: boolean;
  config: boolean;
}

/** Aggregated setup-wizard detection data returned by `/api/setup/detect`. */
interface WizardData {
  languages: string[];
  frameworks: string[];
  commands: WizardCommands;
  agents: Record<RunnerId, boolean>;
  existing: ExistingArtifacts;
  nonGoatFlow: string[];
}

// ---------------------------------------------------------------------------
// xterm.js minimal type declarations
// ---------------------------------------------------------------------------

/** Minimal xterm.js Terminal instance surface used by `app.ts`. */
interface XTermInstance {
  cols: number;
  rows: number;
  _addonFit?: FitAddonInstance;
  open(container: HTMLElement): void;
  write(data: string): void;
  dispose(): void;
  focus(): void;
  hasSelection(): boolean;
  getSelection(): string;
  loadAddon(addon: FitAddonInstance): void;
  onData(callback: (data: string) => void): void;
  onResize(callback: (size: { cols: number; rows: number }) => void): void;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
}

/** Minimal xterm.js fit addon surface used by the dashboard. */
interface FitAddonInstance {
  fit(): void;
}

// ---------------------------------------------------------------------------
// Alpine.js magic properties
// ---------------------------------------------------------------------------

/** Named Alpine refs exposed by `x-ref` on the current component tree. */
interface AlpineRefs {
  [key: string]: HTMLElement | undefined;
}

/** Alpine.js magic methods injected at runtime onto `x-data` objects. */
interface AlpineMagics<TData extends object = Record<string, unknown>> {
  $watch<K extends Extract<keyof TData, string>>(
    property: K,
    callback: (value: TData[K], oldValue: TData[K]) => void,
  ): void;
  $nextTick(callback?: () => void): Promise<void>;
  $refs: AlpineRefs;
}

// ---------------------------------------------------------------------------
// Window globals
// ---------------------------------------------------------------------------

/** Globals injected by the dashboard shell or xterm.js CDN scripts. */
interface Window {
  __GOAT_FLOW_REPORT__?: DashboardClientReport | null;
  __GOAT_FLOW_DEFAULT_PATH__?: string;
  __GOAT_FLOW_VERSION__?: string;
  Terminal?: new (options: Record<string, unknown>) => XTermInstance;
  FitAddon?: { FitAddon: new () => FitAddonInstance };
}
