/**
 * Command and option type vocabulary shared between the CLI parser and the command handlers.
 * Centralising the subcommand unions, the parsed-option shape, and the removed-command map here
 * keeps the parser (which produces these values) and dispatch (which consumes them) agreeing on
 * one source of truth, so adding a command means touching the union once rather than hunting
 * string literals across files. Pure type/const declarations only; no runtime behaviour lives here.
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
  | "menu"
  | "stats"
  | "diagnostics"
  | "index"
  | "redact"
  | "plans"
  | "skill";

/** Local plan operations; export previews or writes portable milestone bodies. */
export type PlansSubcommand = "export";

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

/** Bounded runtime scenario groups users may request through `hooks verify`. */
export type HookScenario = "deny-hook";

/**
 * The mutually exclusive modes of the `quality` command. `prompt` (the default when no subcommand
 * positional is given) emits an assessment prompt; `history`/`diff` read prior runs; `validate`
 * schema-checks a written report; `candidacy` scores a skill/playbook idea. The parser maps the
 * first positional to one of these, and dispatch routes on the chosen member.
 */
export type QualitySubcommand =
  "prompt" | "history" | "diff" | "validate" | "candidacy";

/**
 * One resolved input to `quality candidacy`, distinguishing the two ways a caller can supply it.
 * `mode: "draft"` means `value` is a resolved filesystem path to an existing draft to score;
 * `mode: "description"` means `value` is the free-form text describing the proposed artifact.
 * The two are mutually exclusive at the CLI; the parser rejects supplying both.
 */
export interface CandidacyInputArg {
  mode: "draft" | "description";
  value: string;
}

/** Raw values returned by Node's `parseArgs`; keys intentionally mirror CLI flag names. */
export type ParsedArgValues = Partial<Record<string, string | boolean>>;

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
  "menu",
  "stats",
  "diagnostics",
  "index",
  "redact",
  "plans",
  "skill",
];

export const REMOVED_COMMANDS: Record<string, string> = {
  review:
    '"review" was removed in v1.1.0. Use "audit --harness" for deterministic harness scoring or "quality" for agent-driven assessment.',
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
  isTargetUntrusted: boolean;
  auditDetails: boolean;
  shouldCheck: boolean;
  shouldApply: boolean;
  shouldForce: boolean;
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
  skillName: string | null;
  skillFilter: string | null;
  skillInteractive: boolean;
  skillSkipConfirm: boolean;
  eventsSubcommand: EventsSubcommand | null;
  eventsLimit: number;
  hookSubcommand: HookSubcommand | null;
  hookId: string | null;
  hookScenario: HookScenario | null;
  plansSubcommand: PlansSubcommand | null;
  diagnosticsSubcommand: DiagnosticsSubcommand | null;
  includeAll: boolean;
}

/**
 * The slice of ParsedCLI that the `skill` command path populates, projected out so the parser can
 * build and spread just the skill-authoring fields without restating each one. Every member is
 * meaningful only when the command is `skill`; for any other command the parser fills these with
 * their null/false defaults, so the subcommand identifies authoring versus read-only diagnosis.
 */
export type SkillCLIFields = Pick<
  ParsedCLI,
  | "skillSubcommand"
  | "skillDescription"
  | "skillDraftPath"
  | "skillName"
  | "skillFilter"
  | "skillInteractive"
  | "skillSkipConfirm"
>;
