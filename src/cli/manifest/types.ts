/**
 * Manifest schema for goat-flow's single source of truth (M06a).
 *
 * `workflow/manifest.json` is the on-disk form. `loadManifest()` returns a
 * resolved `Manifest` where every `facts` field has been computed against
 * canonical code sources (SETUP_CHECKS, AGENT_CHECKS, HARNESS_CHECKS,
 * SKILL_NAMES, preset catalog JSON) or validated against observed on-disk
 * state (dashboard views).
 *
 * Derived values are never written into the JSON - they are computed at load
 * time so `facts` cannot drift from code. Static values are written into the
 * JSON and validated against observed reality on load; a mismatch raises a
 * `ManifestValidationError`.
 */

/** Manifest hook event names for one runtime. */
interface ManifestHookEvents {
  pre_tool: string;
  post_turn: string | null;
}

/** Prompt invocation syntax an agent expects for goat-flow skills. */
type ManifestPromptInvocationStyle = "slash" | "dollar";

/** Skill mirror/source classification used by quality inventory. */
type ManifestSkillSource = "installed" | "agent-mirror" | "github-mirror";

/** Stable capability metadata consumed outside setup/audit internals. */
interface ManifestAgentCapabilities {
  terminal_binary: string;
  setup_surfaces: string[];
  prompt_invocation_style: ManifestPromptInvocationStyle;
  skill_source: ManifestSkillSource;
}

/** Manifest deny-mechanism metadata for one runtime. */
export type ManifestDenyMechanism =
  | { type: "settings-deny"; path: string }
  | { type: "deny-script"; path: string }
  | { type: "both"; settings_path: string; script_path: string };

/** The manifest-backed framework-support record for one agent runtime.
 *
 *  `deny_mechanism` and `hook_events` are optional to model agents whose
 *  upstream runtime has no documented project-local hook wiring for a given
 *  capability; enforcement/audit code must guard for the null case. */
export interface AgentProfile {
  name: string;
  instruction_file: string;
  skills_dir: string;
  capabilities: ManifestAgentCapabilities;
  hooks_dir?: string;
  settings?: string;
  hook_config_file?: string;
  deny_hook?: string;
  deny_mechanism?: ManifestDenyMechanism;
  local_pattern: string;
  hook_events?: ManifestHookEvents;
  hooks?: string[];
}

/** The existing `skills:` block. M06 does not alter it. */
interface SkillsStructure {
  canonical: string[];
  stale_names: string[];
  references?: Record<string, string[]>;
}

/** Instruction-file contract declared by the manifest. `required_sections` is
 *  the canonical list of hot-path headings each agent instruction file must
 *  carry; harness checks build their regex patterns from these labels so the
 *  harness cannot drift from the manifest. */
interface ManifestInstructionFile {
  line_target: number;
  line_limit: number;
  required_sections: string[];
  version_header_pattern: string;
}

/** On-disk shape of `workflow/manifest.json` after M06a extends it.
 *
 * `facts` is optional so the loader can detect pre-M06 manifests (missing key)
 * and produce a clean validation error instead of a cryptic type coercion. */
export interface ManifestJson {
  description: string;
  version: string;
  required_files: string[];
  required_dirs: string[];
  directory_purposes: Record<string, string>;
  optional_files: Record<string, string>;
  never_create: string[];
  skills: SkillsStructure;
  agents: Record<string, AgentProfile>;
  instruction_file: ManifestInstructionFile;
  /** Added by M06a. Only holds values that cannot be derived from code. */
  facts?: ManifestJsonFacts;
}

/** The `facts:` block as it appears on disk. Only static values. */
interface ManifestJsonFacts {
  dashboard_views: string[];
}

/** Resolved skill facts derived from `src/cli/constants.ts` `SKILL_NAMES`. */
export interface SkillFacts {
  total: number;
  names: readonly string[];
  dispatcher: string;
  functional_count: number;
  stale_names: readonly string[];
}

/** Resolved check counts derived from the audit check arrays. */
export interface CheckFacts {
  setup: number;
  agent: number;
  harness: number;
  total: number;
}

/** Resolved dashboard-view facts. Static list validated against disk. */
interface DashboardViewFacts {
  count: number;
  names: readonly string[];
}

/** Resolved preset facts derived from the preset catalog JSON length. */
interface PresetFacts {
  count: number;
}

/** Fully-populated facts returned by `loadManifest()`. */
export interface ResolvedFacts {
  version: string;
  skills: SkillFacts;
  checks: CheckFacts;
  dashboard_views: DashboardViewFacts;
  presets: PresetFacts;
}

/** Resolved manifest - on-disk JSON plus computed `facts`. */
export interface Manifest {
  version: string;
  /** Files the project must contain; validated against disk by audit checks. */
  required_files: string[];
  /** Directories the project must contain; validated against disk by audit checks. */
  required_dirs: string[];
  skills: SkillsStructure;
  agents: Record<string, AgentProfile>;
  instruction_file: ManifestInstructionFile;
  facts: ResolvedFacts;
}

/** Inputs to `validateManifest` and `composeManifest`. Derived from running
 *  code state; `loadManifest` builds these from disk and test helpers
 *  construct them directly. */
export interface ObservedFacts {
  views: string[];
  presetsCount: number;
  skills: readonly string[];
  setupChecks: number;
  agentChecks: number;
  harnessChecks: number;
  version: string;
}

/** Raised when the on-disk manifest's static facts disagree with observed reality. */
export class ManifestValidationError extends Error {
  constructor(
    message: string,
    public readonly findings: string[],
  ) {
    super(message);
    this.name = "ManifestValidationError";
  }
}

/** One consistency finding produced by `checkManifest()`. */
interface ManifestCheckFinding {
  rule: string;
  message: string;
}

/** Report returned by `checkManifest()`. */
export interface ManifestCheckReport {
  status: "pass" | "fail";
  findings: ManifestCheckFinding[];
}
