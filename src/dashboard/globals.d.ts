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
/** Dashboard-local runner union. Keep this aligned with `src/cli/types.ts`.
 *  Importing CLI types here causes the dashboard build to emit `src/cli/types.js`
 *  back into the source tree, which then poisons lint/format/drift gates. */
type RunnerId = "claude" | "codex" | "gemini" | "copilot";
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
  integrityPass: number;
  integrityFail: number;
  advisoryPass: number;
  advisoryFail: number;
  advisoryAcknowledged: number;
  metrics: number;
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
interface ProjectEntry {
  path: string;
  state: string;
  action: string;
  details: string;
}

/** Quality-assessment prompt payload returned by `/api/quality`. */
interface QualityResult {
  command: "quality";
  agent: RunnerId;
  auditStatus: AuditStatus | "unavailable";
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
  pasteSubmitQueue?: Array<{ data: string; delayed: boolean }>;
  pasteSubmitOutputTail?: string;
  launchPrompt?: string;
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

interface CustomPromptRouteOption {
  id: string;
  label: string;
  desc: string;
}

interface CustomPromptFlagOption {
  field: keyof CustomPromptDraft;
  label: string;
  title: string;
}

interface CustomPromptFlagGroup {
  id: "prerequisites" | "permissions" | "compatibility";
  label: string;
  flags: CustomPromptFlagOption[];
}

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

interface SkillQualityArtifact {
  id: string;
  name: string;
  path: string;
  kind: SkillQualityArtifactKind;
  source: string;
  mirrorPaths?: string[];
  missingMirrors?: string[];
}

interface SkillQualityMetric {
  metric: string;
  label: string;
  score: number;
  maxScore: number;
  severity: SkillQualityMetricSeverity;
  detail: string;
}

interface ClassificationAlternative {
  subtype: string;
  score: number;
}

interface ClassificationResult {
  detectedSubtype: string;
  /** 0-1: how strongly the detected subtype dominates alternatives. */
  confidence: number;
  alternatives: ClassificationAlternative[];
  reasoning: string[];
}

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

interface SkillEvaluateTip {
  metric: string;
  severity: SkillQualityMetricSeverity;
  message: string;
}

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
  translateToString(trimRight?: boolean): string;
}

interface XTermBuffer {
  length: number;
  getLine(y: number): XTermBufferLine | undefined;
}

interface XTermInstance {
  cols: number;
  rows: number;
  _addonFit?: FitAddonInstance;
  buffer: { active: XTermBuffer };
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
  __GOAT_FLOW_DASHBOARD_TOKEN__?: string;
  __GOAT_FLOW_AGENTS__?: SupportedAgent[];
  __GOAT_FLOW_RUNNER_IDS__?: string[];
  __GOAT_FLOW_PRESETS__?: Preset[];
  Terminal?: new (options: Record<string, unknown>) => XTermInstance;
  FitAddon?: { FitAddon: new () => FitAddonInstance };
}
