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
  | "skill";

/**
 * The only second positional accepted after `skill`. A single-member union today, kept as a named
 * type so a future authoring verb (e.g. "edit") is added in one place the parser and handler share.
 */
export type SkillSubcommand = "new";

/**
 * The only second positional accepted after `events`; `tail` reads the local evidence-envelope log.
 * Named (rather than inlined) so the read-only event surface can grow without retyping the literal.
 */
export type EventsSubcommand = "tail";

/**
 * Second positional accepted after `hooks`: the read-only `list`/`sync` operations and the
 * `enable`/`disable` toggles. `enable`/`disable` additionally require a `<hook-id>`; the others do
 * not. Kept in sync with HOOK_SUBCOMMANDS, which is the runtime membership check for the same set.
 */
export type HookSubcommand = "list" | "enable" | "disable" | "sync";
export const HOOK_SUBCOMMANDS = new Set<string>([
  "list",
  "enable",
  "disable",
  "sync",
]);

/**
 * The mutually exclusive modes of the `quality` command. `prompt` (the default when no subcommand
 * positional is given) emits an assessment prompt; `history`/`diff` read prior runs; `validate`
 * schema-checks a written report; `candidacy` scores a skill/playbook idea. The parser maps the
 * first positional to one of these, and dispatch routes on the chosen member.
 */
export type QualitySubcommand =
  | "prompt"
  | "history"
  | "diff"
  | "validate"
  | "candidacy";

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

/** Fully resolved CLI options including the dispatched command. */
export interface ParsedCLI extends CLIOptions {
  command: Command;
  includeHarness: boolean;
  checkDrift: boolean;
  checkContent: boolean;
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
  skillInteractive: boolean;
  skillSkipConfirm: boolean;
  eventsSubcommand: EventsSubcommand | null;
  eventsLimit: number;
  hookSubcommand: HookSubcommand | null;
  hookId: string | null;
  includeAll: boolean;
}

/**
 * The slice of ParsedCLI that the `skill` command path populates, projected out so the parser can
 * build and spread just the skill-authoring fields without restating each one. Every member is
 * meaningful only when the command is `skill`; for any other command the parser fills these with
 * their null/false defaults, so a non-null value here signals a `skill new` invocation.
 */
export type SkillCLIFields = Pick<
  ParsedCLI,
  | "skillSubcommand"
  | "skillDescription"
  | "skillDraftPath"
  | "skillName"
  | "skillInteractive"
  | "skillSkipConfirm"
>;
