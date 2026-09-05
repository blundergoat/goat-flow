/**
 * Command and option type vocabulary shared between the CLI parser and the command handlers.
 *
 * Centralising subcommand unions, parsed options, and removed commands keeps the parser and dispatch on one source of truth.
 * Adding a command then changes the union once instead of scattering string literals across files.
 *
 * Pure type/const declarations only; no runtime behaviour lives here.
 */

import type { CLIOptions } from "./types.js";
import type { QualityMode } from "./quality/schema.js";

/** Supported CLI subcommand names. */
export type Command =
  | "setup"
  | "install"
  | "audit"
  | "quality"
  | "status"
  | "dashboard"
  | "info"
  | "manifest"
  | "events"
  | "hooks"
  | "claims"
  | "menu"
  | "stats"
  | "recall"
  | "learn"
  | "diagnostics"
  | "index"
  | "redact"
  | "review"
  | "plans"
  | "skill";

/** Local plan operations: portable reads plus explicit milestone timing transitions. */
export type PlansSubcommand = "export" | "check" | "time";

/** Explicit lifecycle actions under `plans time`. */
export type PlansTimeAction = "start" | "stop" | "status";

/** Categories stamped on timing spans and reconciled into structured Actuals. */
export type PlansTimeCategory = "product" | "proof" | "other";

/** Explicit learning-loop authoring action. */
export type LearnSubcommand = "new";

/** Learning-loop entry grammars supported by the safe scaffold command. */
export type LearnEntryType = "footgun" | "lesson" | "pattern";

/** Canonical evidence taxonomy required by footgun entries. */
export type LearnEvidenceKind =
  "ACTUAL_MEASURED" | "OBSERVED" | "EXTERNAL_REFERENCE";

/** Deterministic checks for review drafts, transient ledgers, and completed reports. */
export type ReviewSubcommand =
  "validate" | "validate-draft" | "validate-ledger";

/** Read-only diagnostics views an operator can run without changing the selected project. */
export type DiagnosticsSubcommand =
  "context" | "readiness" | "bundle" | "threat-model";

/**
 * Second positionals accepted after `skill`: authoring (`new`) and read-only diagnostics (`doctor`).
 * Keep this named so the parser and handler expose the same user-facing skill command set.
 */
export type SkillSubcommand = "new" | "doctor";

/**
 * The only second positional accepted after `events`; `tail` reads the local evidence-envelope log.
 * Named (rather than inlined) so the read-only event surface can grow without retyping the literal.
 */
export type EventsSubcommand = "tail";

/** Explicit read and confirmed-removal operations for one path-write ownership marker. */
export type ClaimsSubcommand = "inspect" | "recover";

/**
 * Second positional accepted after `hooks`: state operations, toggles, and explicit verification.
 * `enable`/`disable` additionally require a `<hook-id>`; `verify` requires one selected agent.
 * Keep this in sync with HOOK_SUBCOMMANDS, the parser's runtime membership check.
 */
export type HookSubcommand = "list" | "enable" | "disable" | "sync" | "verify";
export const HOOK_SUBCOMMANDS = new Set<string>([
  "list",
  "enable",
  "disable",
  "sync",
  "verify",
]);

/** Bounded offline scenario groups users may request through `hooks verify`. */
export type HookScenario = "deny-hook" | "post-turn-hook" | "gruff-hook";

/**
 * Every shipped scenario group, in the order one `--scenario all` run executes them.
 * Deny runs first because it guards the most destructive commands a user can reach.
 */
export const BATCH_HOOK_SCENARIOS: readonly HookScenario[] = [
  "deny-hook",
  "post-turn-hook",
  "gruff-hook",
];

/**
 * What a user asked `hooks verify` to prove: one explicit group, or every shipped group.
 * `all` never reaches the registrar, which keeps consuming the closed `HookScenario` union.
 */
export type HookScenarioSelection = HookScenario | "all";

/**
 * The mutually exclusive modes of the `quality` command.
 * `prompt` (the default when no subcommand positional is given) emits an assessment prompt; `history`/`diff` read prior runs; `save` redacts,
 * validates, and persists an in-memory report; `validate` schema-checks a written report; `candidacy` scores a skill/playbook idea.
 *
 * The parser maps the first positional to one of these, and dispatch routes on the chosen member.
 */
export type QualitySubcommand =
  "prompt" | "history" | "diff" | "save" | "validate" | "candidacy";

/**
 * One resolved input to `quality candidacy`, distinguishing the two ways a caller can supply it.
 *
 * `mode: "draft"` means `value` is a resolved filesystem path to an existing draft to score; `mode: "description"` means `value` is the free-form
 * text describing the proposed artifact.
 * The two are mutually exclusive at the CLI; the parser rejects supplying both.
 */
export interface CandidacyInputArg {
  mode: "draft" | "description";
  value: string;
}

/**
 * Raw values returned by Node's `parseArgs`; keys intentionally mirror CLI flag names.
 * Repeatable options such as `--force-path` arrive as string lists.
 */
export type ParsedArgValues = Partial<
  Record<string, string | boolean | string[]>
>;

export const COMMANDS: Command[] = [
  "setup",
  "install",
  "audit",
  "quality",
  "status",
  "dashboard",
  "info",
  "manifest",
  "events",
  "hooks",
  "claims",
  "menu",
  "stats",
  "recall",
  "learn",
  "diagnostics",
  "index",
  "redact",
  "review",
  "plans",
  "skill",
];

export const REMOVED_COMMANDS: Record<string, string> = {
  critique:
    '"critique" was removed in v1.1.0. Use "quality" for agent-driven assessment.',
  fix: '"fix" was removed in v1.1.0. Use "audit" or "quality" to identify issues, then apply fixes directly.',
  eval: '"eval" was removed in v1.1.0. Use "quality candidacy" for skill/playbook fit checks or "audit" for setup validation.',
  scan: '"scan" was removed in v1.1.0. Use "audit" for setup validation.',
  check:
    '"check" was removed in v1.1.0. Use "audit --check-drift" for deterministic drift/content checks.',
};

export const VALID_FORMATS = ["json", "text", "markdown", "sarif"] as const;

/**
 * Fully resolved CLI options including the dispatched command.
 * Use after parsing user arguments so handlers can act on the command the user requested.
 */
export interface ParsedCLI extends CLIOptions {
  command: Command;
  includeHarness: boolean;
  checkDrift: boolean;
  checkContent: boolean;
  isTargetTrusted: boolean;
  isTargetUntrusted: boolean;
  includeAuditDetails: boolean;
  shouldCheck: boolean;
  shouldApply: boolean;
  shouldDryRun: boolean;
  shouldForce: boolean;
  shouldForceManaged: boolean;
  shouldForceUserOwned: boolean;
  forcePaths: readonly string[];
  updateConfigVersion: boolean;
  cleanDeprecated: boolean;
  qualitySubcommand: QualitySubcommand;
  qualityDiffPair: string | null;
  qualityValidatePath: string | null;
  qualityMode: QualityMode | null;
  candidacyInput: CandidacyInputArg | null;
  skillSubcommand: SkillSubcommand | null;
  skillDescription: string | null;
  skillDraftPath: string | null;
  skillRedLogPath: string | null;
  skillName: string | null;
  skillFilter: string | null;
  skillInteractive: boolean;
  skillSkipConfirm: boolean;
  eventsSubcommand: EventsSubcommand | null;
  eventsLimit: number;
  hookSubcommand: HookSubcommand | null;
  hookId: string | null;
  hookScenario: HookScenarioSelection | null;
  claimsSubcommand: ClaimsSubcommand | null;
  claimsTargetPath: string | null;
  claimsMarkerSha256: string | null;
  shouldConfirmAbandoned: boolean;
  reviewSubcommand: ReviewSubcommand | null;
  reviewValidatePath: string | null;
  plansSubcommand: PlansSubcommand | null;
  plansStrict: boolean;
  plansMaxActive: number | null;
  plansTimeAction: PlansTimeAction | null;
  plansTimeCategory: PlansTimeCategory | null;
  plansTimeFinalize: boolean;
  plansTimeDiscardOpen: boolean;
  learnSubcommand: LearnSubcommand | null;
  learnEntryType: LearnEntryType | null;
  learnCategory: string | null;
  learnTitle: string | null;
  learnEvidencePaths: readonly string[];
  learnSearchLiterals: readonly string[];
  learnEvidenceKind: LearnEvidenceKind | null;
  /** Project-relative file or directory operands used by read-only learning-loop recall. */
  recallPaths: readonly string[];
  diagnosticsSubcommand: DiagnosticsSubcommand | null;
  includeAll: boolean;
}

/**
 * The slice of ParsedCLI that the `skill` command path populates, projected out so the parser can build and spread just the skill-authoring fields
 * without restating each one.
 *
 * Every member is meaningful only when the command is `skill`; for any other command the parser fills these with their null/false defaults, so the
 * subcommand identifies authoring versus read-only diagnosis.
 */
export type SkillCLIFields = Pick<
  ParsedCLI,
  | "skillSubcommand"
  | "skillDescription"
  | "skillDraftPath"
  | "skillRedLogPath"
  | "skillName"
  | "skillFilter"
  | "skillInteractive"
  | "skillSkipConfirm"
>;
