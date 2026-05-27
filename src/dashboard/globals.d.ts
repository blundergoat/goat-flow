/**
 * Type declarations for the GOAT Flow dashboard (browser environment).
 * These types are shared across all dashboard script files.
 */

type AuditStatus = "pass" | "fail" | "skipped";
type AuditDisplayStatus = "pass" | "fail" | "warn" | "info" | "skipped";
type AuditCheckType = "integrity" | "advisory" | "metric";
type AuditCheckImpact = "none" | "scope-fail" | "score-only";
type AuditCheckEvidenceKind = "semantic" | "structural";
type AuditCheckAssurance = "full" | "limited";
type EnforcementCapabilityStatus =
  | "hard"
  | "limited"
  | "soft"
  | "missing"
  | "unknown";
type EnforcementCapabilitySource =
  | "local-settings"
  | "local-hook"
  | "runtime-self-test"
  | "manifest"
  | "provider-docs"
  | "not-observed";
/** Dashboard-local runner union. Keep this aligned with `AgentId` in `src/cli/types.ts`.
 *  Do not import CLI types here; the dashboard ambient build must stay browser-only. */
type RunnerId = "claude" | "codex" | "antigravity" | "copilot";
type PromptInvocationStyle = "slash" | "dollar";
type SkillSource = "installed" | "agent-mirror" | "github-mirror";
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

/** Evidence provenance emitted for each registered audit check. */
interface AuditCheckProvenance {
  source_type:
    | "spec"
    | "vendor_docs"
    | "paper"
    | "incident"
    | "community"
    | "unknown";
  source_urls: string[];
  verified_on: string;
  normative_level: "MUST" | "SHOULD" | "BEST_PRACTICE";
  evidence_paths?: string[];
  framework_evidence_paths?: string[];
  target_evidence_paths?: string[];
  reason?: string;
}

/** Structured harness detail payloads are forwarded verbatim for dashboard pages. */
type AuditCheckDetails = Record<string, unknown>;

/** Individual check result inside an audit scope. */
interface AuditCheck {
  id: string;
  name: string;
  status: AuditStatus;
  displayStatus: AuditDisplayStatus;
  impact: AuditCheckImpact;
  provenance: AuditCheckProvenance;
  type?: AuditCheckType;
  acknowledged?: boolean;
  evidenceKind?: AuditCheckEvidenceKind;
  assurance?: AuditCheckAssurance;
  failure?: AuditFailure;
  details?: AuditCheckDetails;
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
  limits: string[];
  recommendations: string[];
  howToFix: string[];
  integrityPass: number;
  integrityFail: number;
  advisoryPass: number;
  advisoryFail: number;
  advisoryAcknowledged: number;
  metrics: number;
}

/** One advisory enforcement matrix row for an agent. */
interface EnforcementCapability {
  id: string;
  label: string;
  status: EnforcementCapabilityStatus;
  sources: EnforcementCapabilitySource[];
  summary: string;
  evidence: string[];
}

/** Per-agent advisory enforcement matrix. */
interface AgentEnforcementCapability {
  agent: RunnerId;
  name: string;
  advisory: true;
  capabilities: EnforcementCapability[];
  summary: Record<EnforcementCapabilityStatus, number>;
}

/** Per-agent audit summary shown on the Home and Audit views. */
interface AgentScore {
  id: RunnerId;
  name: string;
  agent: AuditScope;
  harness: AuditScope | null;
  concerns: Record<string, AuditConcern> | null;
  enforcement: AgentEnforcementCapability | null;
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
  learningLoop: {
    recordCount: number;
    footgunCount: number;
    lessonCount: number;
    staleCount: number;
    invalidLineRefCount: number;
    oversizedCount: number;
    oldestLastReviewed: string | null;
    topBucketsNeedingAction: { path: string; reason: string }[];
    status: "fresh" | "needs-review" | "unavailable";
  } | null;
  recentLessons: RecentLesson[];
  target: string;
}

/** Compact lesson row shown on the Home page. */
interface RecentLesson {
  id: string;
  title: string;
  created: string | null;
  path: string;
}

/** Supported agent metadata injected into the dashboard shell. */
interface SupportedAgent {
  id: RunnerId;
  name: string;
  terminalBinary: string;
  setupSurfaces: string[];
  promptInvocationStyle: PromptInvocationStyle;
  skillSource: SkillSource;
  supportsPostTurnHook: boolean;
}

/** Agent detection info from `/api/agents/installed`. */
interface AgentInfo extends SupportedAgent {
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
type ProjectIdentitySource = "git-remote" | "goat-marker" | "path";

/** Saved project identity plus install-state summary shown in the Projects view. */
interface ProjectEntry {
  path: string;
  paths?: string[];
  identity?: string;
  identitySource?: ProjectIdentitySource;
  remoteUrlHash?: string;
  markerId?: string;
  state: string;
  action: string;
  details: string;
}

/** Milestone summary from the selected project's `.goat-flow/tasks/`. */
interface TaskMilestoneSummary {
  filename: string;
  path: string;
  title: string;
  status: string;
  objective: string;
  totalTasks: number;
  completedTasks: number;
  modifiedAt: string;
}

/** Top-level task directory summary from `.goat-flow/tasks/`. */
interface TaskPlanSummary {
  name: string;
  path: string;
  modifiedAt: string;
  milestoneCount: number;
  active: boolean;
}

/** Response from `/api/tasks` after reading or changing active task-plan state. */
interface TaskState {
  taskRoot: string;
  exists: boolean;
  active: string | null;
  activeExists: boolean;
  selectedPlan: string | null;
  plans: TaskPlanSummary[];
  milestones: TaskMilestoneSummary[];
}

type HookDrift = "desired-on-actual-off" | "desired-off-actual-on";

interface HookAgentState {
  supported: boolean;
  installed: boolean;
  scriptPath: string | null;
  configPath: string | null;
  drift?: HookDrift;
  reason?: string;
}

interface HookState {
  id: string;
  name: string;
  description: string;
  togglable: boolean;
  enabled: boolean;
  defaultEnabled: boolean;
  requiresConfirmDialog: boolean;
  agents: Partial<Record<RunnerId, HookAgentState>>;
}

/** Quality-assessment prompt payload returned by `/api/quality`. */
interface QualityResult {
  command: "quality";
  agent: RunnerId;
  auditStatus: AuditStatus | "unavailable";
  auditCacheStatus: "hit" | "miss" | "bypass";
  auditSummary: string;
  prompt: string;
}

/** One row in the quality-history trend table from `/api/quality/history`. */
interface QualityHistoryRow {
  id: string;
  date: string;
  agent: RunnerId;
  setupTotal: number;
  systemTotal: number;
  setupDelta: number | null;
  blockerCount: number;
  majorCount: number;
  minorCount: number;
}

/** Latest quality-history summary payload from `/api/quality/history`. */
interface QualityHistoryLatest {
  id: string;
  date: string;
  time: string;
  agent: RunnerId;
  setupTotal: number;
  systemTotal: number;
  blockerCount: number;
  majorCount: number;
  minorCount: number;
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
  cwd: string;
  targetPath: string;
  runner: RunnerId;
  lastInputAt: number;
  age?: number;
  idleDuration?: number;
  projectName?: string;
}

/** Local terminal session tracked by the frontend Alpine state. */
type TerminalLoadingPhase = "connecting" | "loading" | "ready" | "error";

/** Alpine-reactive terminal session state; xterm/WebSocket handles live in TerminalRefs. */
interface LocalSession {
  id: string;
  runner: RunnerId;
  promptLabel: string;
  projectPath: string;
  cwd: string;
  targetPath: string;
  startTime: number;
  lastInputTime: number;
  connected: boolean;
  ended: boolean;
  awaitingInput?: boolean;
  outputTail?: string;
  /** Loading overlay state: create/mount -> connecting, ws open -> loading, first output -> ready, pre-output failure -> error. */
  loadingPhase: TerminalLoadingPhase;
  loadingError?: string;
  loadingShowSlowHint?: boolean;
  loadingShowRetry?: boolean;
  age: string;
  presetId: string | null;
}

/** Non-reactive xterm/WebSocket handles kept outside Alpine's proxy state. */
interface TerminalRefs {
  ws?: WebSocket;
  xterm?: XTermInstance;
  cleanup?: () => void;
  ageInterval?: ReturnType<typeof setInterval>;
  awaitingInputTimer?: ReturnType<typeof setTimeout>;
  pasteSubmitTimer?: ReturnType<typeof setTimeout>;
  pasteSubmitQueue?: Array<{ data: string; shouldDelaySubmit: boolean }>;
  pasteSubmitOutputTail?: string;
  pasteSubmitAwaitingCommit?: boolean;
  pasteSubmitFallbackSubmitted?: boolean;
  launchPrompt?: string;
  retryPrompt?: string;
  retryPromptLabel?: string | null;
  retryPresetId?: string | null;
  retryCwdPath?: string | null;
  retryTargetPath?: string | null;
  loadingSlowTimer?: ReturnType<typeof setTimeout>;
  loadingRetryTimer?: ReturnType<typeof setTimeout>;
  launchPromptFallbackTimer?: ReturnType<typeof setTimeout>;
  launchPromptQuietTimer?: ReturnType<typeof setTimeout>;
  launchPromptOutputSeen?: boolean;
}

/** Session metadata cached per project so the UI can reconnect after a switch. */
interface SavedSession {
  sessionId: string;
  startTime: number;
  prompt: string;
  agent: RunnerId;
  cwd: string;
  targetPath: string;
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
  route?: string;
  source?: string;
  globalSafe?: boolean;
  internalOnly?: boolean;
  qualityMode?: boolean;
  requiresGh?: boolean;
  requiresPrOrIssue?: boolean;
  requiresLocalDiff?: boolean;
  requiresUiApp?: boolean;
  requiresDependencyFiles?: boolean;
  requiresGoatFlowInstall?: boolean;
  mayCheckoutBranch?: boolean;
  requiresCleanWorktree?: boolean;
  mayWriteFiles?: boolean;
  artifactRequired?: boolean;
  bestTargetSurfaces?: string[];
  fallbackPrompt?: string;
  costTier?: "low" | "medium" | "high";
}

/** Compact compatibility badge shown for preset prerequisites and fit. */
interface PresetBadge {
  label: string;
  title: string;
  tone: "neutral" | "good" | "warn" | "danger" | "ui";
}

/** Browser-local custom prompt persisted outside the built-in preset catalog. */
interface CustomPrompt {
  id: string;
  name: string;
  desc: string;
  prompt: string;
  route: string;
  runnerHint: RunnerId | "any";
  requiresGh: boolean;
  requiresPrOrIssue: boolean;
  requiresLocalDiff: boolean;
  requiresUiApp: boolean;
  requiresDependencyFiles: boolean;
  requiresGoatFlowInstall: boolean;
  mayCheckoutBranch: boolean;
  requiresCleanWorktree: boolean;
  mayWriteFiles: boolean;
  artifactRequired: boolean;
  globalSafe: boolean;
  bestTargetSurfaces: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Editable form state for one browser-local custom prompt. */
interface CustomPromptDraft {
  name: string;
  desc: string;
  prompt: string;
  route: string;
  runnerHint: RunnerId | "any";
  requiresGh: boolean;
  requiresPrOrIssue: boolean;
  requiresLocalDiff: boolean;
  requiresUiApp: boolean;
  requiresDependencyFiles: boolean;
  requiresGoatFlowInstall: boolean;
  mayCheckoutBranch: boolean;
  requiresCleanWorktree: boolean;
  mayWriteFiles: boolean;
  artifactRequired: boolean;
  globalSafe: boolean;
  bestTargetSurfacesText: string;
  notes: string;
}

/** Route option shown in the custom-prompt editor dropdown. */
interface CustomPromptRouteOption {
  id: string;
  label: string;
  desc: string;
}

/** One boolean custom-prompt setting and its editor copy. */
interface CustomPromptFlagOption {
  field: keyof CustomPromptDraft;
  label: string;
  title: string;
}

/** Grouping for custom-prompt flags so related prerequisites render together. */
interface CustomPromptFlagGroup {
  id: "prerequisites" | "permissions" | "compatibility";
  label: string;
  flags: CustomPromptFlagOption[];
}

/** Validation message tied to a specific custom-prompt form field and anchor. */
interface CustomPromptValidationError {
  field: string;
  message: string;
  anchor: string;
}

// ---------------------------------------------------------------------------
// Skill quality types
// ---------------------------------------------------------------------------

type SkillQualityArtifactKind = "skill" | "shared-reference";
type SkillQualityRecommendation =
  | "keep-skill"
  | "consider-revision"
  | "consider-reclassifying"
  | "reference-playbook"
  | "retire"
  | "needs-human-review";
type SkillQualityMetricSeverity = "ok" | "warn" | "fail" | "n/a";

/** Dashboard mirror of a scored skill-quality artifact; paths stay project-relative. */
interface SkillQualityArtifact {
  id: string;
  name: string;
  path: string;
  kind: SkillQualityArtifactKind;
  source: string;
  mirrorPaths?: string[];
  missingMirrors?: string[];
}

/** One skill-quality metric row after subtype caps and severity mapping. */
interface SkillQualityMetric {
  metric: string;
  label: string;
  score: number;
  maxScore: number;
  severity: SkillQualityMetricSeverity;
  detail: string;
}

/** Lower-ranked subtype match shown when quality classification is ambiguous. */
interface ClassificationAlternative {
  subtype: string;
  score: number;
}

/** Applied skill-quality profile plus evidence for why that subtype won. */
interface ClassificationResult {
  detectedSubtype: string;
  /** 0-1: how strongly the detected subtype dominates alternatives. */
  confidence: number;
  alternatives: ClassificationAlternative[];
  reasoning: string[];
}

/** Full skill-quality report consumed by the Skills view and evaluate modal. */
interface SkillQualityReport {
  artifact: SkillQualityArtifact;
  totalScore: number;
  maxTotalScore: number;
  profileMax: number;
  subtype: string;
  detectedShape?: string;
  shapeConfidence?: number;
  shapeMismatch?: boolean;
  classification: ClassificationResult;
  recommendation: SkillQualityRecommendation;
  metrics: SkillQualityMetric[];
  composedFrom: string[];
  fitNotes: string[];
  prompt?: string;
}

/** One dashboard remediation tip generated from a skill-quality metric detail. */
interface SkillEvaluateTip {
  metric: string;
  severity: SkillQualityMetricSeverity;
  message: string;
}

/** Uploaded-skill evaluation result with metric-tied remediation tips. */
interface SkillEvaluateResult extends SkillQualityReport {
  tips: SkillEvaluateTip[];
}

/** One selectable quality-page prompt mode. */
interface QualityModeOption {
  id: string;
  label: string;
  desc: string;
  source: "api" | "preset" | "registry";
  presetId?: string;
  targetScope: string;
  prompt?: string;
}

// ---------------------------------------------------------------------------
// Setup types
// ---------------------------------------------------------------------------

/** Detected command slots shown in the setup view. */
interface SetupCommands {
  test: string;
  lint: string;
  build: string;
  format: string;
}

/** Existing GOAT Flow artifacts detected in the selected project. */
interface ExistingArtifacts {
  skills: boolean;
  instructionsRepoWide: boolean;
  instructionsPathScoped: boolean;
  lessons: boolean;
  footguns: boolean;
  config: boolean;
}

/** Aggregated setup-view detection data returned by `/api/setup/detect`. */
interface SetupData {
  languages: string[];
  frameworks: string[];
  commands: SetupCommands;
  agents: Partial<Record<RunnerId, boolean>>;
  existing: ExistingArtifacts;
  nonGoatFlow: string[];
}

// ---------------------------------------------------------------------------
// xterm.js minimal type declarations
// ---------------------------------------------------------------------------

/** Minimal xterm.js Terminal instance surface used by `app.ts`. */
interface XTermBufferLine {
  /** Return visible buffer text; optional trim matches xterm's public API. */
  translateToString(trimRight?: boolean): string;
}

/** Scrollback buffer facade used when collecting terminal output tails. */
interface XTermBuffer {
  length: number;
  /** Read one zero-based buffer row; missing rows occur after terminal resize/trim. */
  getLine(rowIndex: number): XTermBufferLine | undefined;
}

/** Minimal xterm.js terminal API; invariant: keep only methods used by dashboard scripts. */
interface XTermInstance {
  cols: number;
  rows: number;
  _addonFit?: FitAddonInstance;
  buffer: { active: XTermBuffer; normal: XTermBuffer; alternate: XTermBuffer };
  /** Attach the terminal to an already-rendered container element. */
  open(container: HTMLElement): void;
  /** Writes server output into xterm without mutating Alpine session state. */
  write(outputChunk: string): void;
  /** Release DOM/listener resources when a dashboard session closes. */
  dispose(): void;
  /** Move browser focus into the terminal input surface. */
  focus(): void;
  /** Report whether xterm has an active text selection for copy shortcuts. */
  hasSelection(): boolean;
  /** Return the selected terminal text for clipboard helpers. */
  getSelection(): string;
  /** Load the fit addon created from the separately injected xterm addon bundle. */
  loadAddon(addon: FitAddonInstance): void;
  onData(callback: (data: string) => void): void;
  onResize(callback: (size: { cols: number; rows: number }) => void): void;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
}

/** Minimal xterm.js fit addon surface used by the dashboard. */
interface FitAddonInstance {
  /** Recompute terminal rows/cols from the current container geometry. */
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

/** Globals injected by the dashboard shell or bundled xterm.js scripts. */
interface Window {
  __GOAT_FLOW_REPORT__?: DashboardClientReport | null;
  __GOAT_FLOW_DEFAULT_PATH__?: string;
  __GOAT_FLOW_VERSION__?: string;
  __GOAT_FLOW_DASHBOARD_TOKEN__?: string;
  __GOAT_FLOW_AGENTS__?: SupportedAgent[];
  __GOAT_FLOW_RUNNER_IDS__?: string[];
  __GOAT_FLOW_PRESETS__?: Preset[];
  Terminal?: new (options: Record<string, unknown>) => XTermInstance;
  FitAddon?: { FitAddon: new () => FitAddonInstance };
  jsyaml?: { load(text: string): unknown };
  renderMarkdown?: (
    text: string,
    opts?: { frontmatter?: "strip" | "passthrough"; breaks?: boolean },
  ) => { html: string; frontmatter: Record<string, unknown> | null };
}
