/**
 * Defines the terminal guidance users see before goat-flow runs a project command.
 * Use it for global navigation and for one top-level command's usage, flags, and examples.
 *
 * Static metadata avoids handlers, project configuration, and manifest values.
 * Help therefore remains available when a target project is missing, incomplete, or drifted.
 */

import type { Command } from "./cli-types.js";

/** Whether a command is prominent, discoverable in the compact index, or retained only for compatibility. */
type HelpVisibility = "primary" | "advanced" | "hidden-legacy";
type VisibleHelpCommand = Exclude<Command, "info">;
type HelpDetailRows = readonly (readonly [
  helpLabel: string,
  helpDescription: string,
])[];

/** Static navigation and contextual guidance for one active top-level command. */
interface VisibleHelpTopic<
  Name extends VisibleHelpCommand = VisibleHelpCommand,
> {
  command: Name;
  visibility: Exclude<HelpVisibility, "hidden-legacy">;
  summary: string;
  usage: readonly [string, ...string[]];
  /** Omitted when the command does not read or write managed install state. */
  managedState?: HelpDetailRows;
  /** Omitted when the command has no subcommand choices to show the user. */
  subcommands?: HelpDetailRows;
  /** Omitted when the command has no command-specific flags to show the user. */
  flags?: HelpDetailRows;
  examples: readonly [string, ...string[]];
}

/** Compatibility metadata that remains typed but never gains a public topic. */
interface HiddenHelpTopic {
  command: "info";
  visibility: "hidden-legacy";
  summary: string;
}

type HelpTopic<Name extends Command = Command> = Name extends VisibleHelpCommand
  ? VisibleHelpTopic<Name>
  : HiddenHelpTopic;

/** A catalog entry for every parser-recognized command, including hidden compatibility tokens. */
type HelpCatalog = {
  [Name in Command]: HelpTopic<Name>;
};

/**
 * Typed owner for help visibility and top-level command summaries.
 * Adding a parser command without deciding how help exposes it is a type error.
 */
const COMMAND_HELP_CATALOG = {
  dashboard: {
    command: "dashboard",
    visibility: "primary",
    summary: "Open the browser dashboard.",
    usage: ["goat-flow dashboard [path] [--dev]"],
    flags: [["--dev", "Enable live reload."]],
    examples: ["goat-flow dashboard .", "goat-flow dashboard . --dev"],
  },
  audit: {
    command: "audit",
    visibility: "primary",
    summary:
      "Run deterministic setup checks; add --harness for harness checks.",
    usage: ["goat-flow audit [path] [flags]"],
    flags: [
      ["--agent <id>", "Limit checks to one supported agent."],
      ["--harness", "Add AI Harness Completeness checks."],
      ["--check-drift", "Check managed files and peer instructions for drift."],
      ["--check-content", "Run cold-path content checks."],
      ["--trusted-target", "Allow configured target-hook runtime proof."],
      ["--format <type>", "Choose json, text, markdown, or sarif output."],
      ["--output <file>", "Write the report instead of printing it."],
    ],
    examples: [
      "goat-flow audit .",
      "goat-flow audit . --agent codex --harness",
    ],
  },
  install: {
    command: "install",
    visibility: "primary",
    summary: "Copy or refresh goat-flow system files.",
    usage: ["goat-flow install [path] --agent <id> [flags]"],
    managedState: [
      [
        "Write set",
        "Apply may update managed.json and every supported agent's cutover marker.",
      ],
      [
        "Migration",
        "After managed.json exists, legacy hashes are non-authoritative; ambiguous legacy history blocks every agent.",
      ],
      [
        "Receipts",
        "Package, path-set, row-generation, target-byte, or cutover-marker drift makes a receipt stale.",
      ],
      [
        "Unrecorded",
        "After verified bytes but a failed state write, repair .goat-flow/install-state/ and rerun the printed command.",
      ],
      [
        "Direct script",
        "After cutover, workflow/install-goat-flow.sh refuses before mutation; use the public CLI.",
      ],
      [
        "Recovery",
        "Force cannot repair install evidence, and ordinary install does not automatically prune it.",
      ],
    ],
    flags: [
      ["--agent <id>", "Select the agent profile to install."],
      ["--dry-run", "Preview every planned write."],
      ["--force", "Authorize inspected managed-file conflicts."],
      ["--force-managed", "Authorize every inspected managed conflict."],
      [
        "--force-path <path>",
        "Authorize one named conflict; repeat as needed.",
      ],
      [
        "--force-user-owned",
        "With --force-path, replace the named user-owned file.",
      ],
      ["--update-config-version", "Update only the existing config version."],
      ["--clean-deprecated", "Remove deprecated skill directories."],
    ],
    examples: [
      "goat-flow install . --agent codex --dry-run",
      "goat-flow install . --agent claude",
    ],
  },
  setup: {
    command: "setup",
    visibility: "primary",
    summary: "Generate setup guidance or apply managed files.",
    usage: ["goat-flow setup [path] --agent <id> [flags]"],
    flags: [
      ["--agent <id>", "Select the agent profile."],
      ["--dry-run", "Preview managed setup writes."],
      ["--apply", "Apply managed files instead of printing guidance."],
      ["--force", "Authorize inspected managed-file conflicts."],
      ["--force-managed", "Authorize every inspected managed conflict."],
      [
        "--force-path <path>",
        "Authorize one named conflict; repeat as needed.",
      ],
      [
        "--force-user-owned",
        "With --force-path, replace the named user-owned file.",
      ],
      ["--trusted-target", "Allow target-hook proof in generated guidance."],
    ],
    examples: [
      "goat-flow setup . --agent codex",
      "goat-flow setup . --agent claude --apply",
    ],
  },
  status: {
    command: "status",
    visibility: "primary",
    summary: "Show whether a project is bare, partial, outdated, or current.",
    usage: ["goat-flow status [path] [--format <type>]"],
    flags: [["--format <type>", "Choose text, json, or markdown output."]],
    examples: ["goat-flow status ."],
  },
  quality: {
    command: "quality",
    visibility: "primary",
    summary: "Generate an agent-driven quality assessment prompt.",
    usage: [
      "goat-flow quality [path] --agent <id> [--mode <mode>] [flags]",
      "goat-flow quality <subcommand> [args] [flags]",
    ],
    subcommands: [
      ["prompt", "Generate an assessment prompt; this is the default."],
      ["history", "List saved quality reports."],
      ["diff", "Compare two saved same-agent reports."],
      ["save", "Persist one report supplied on stdin."],
      ["validate", "Check one saved report; legacy-only reports are labelled."],
      ["candidacy", "Classify a proposed skill or playbook artifact."],
    ],
    flags: [
      ["--agent <id>", "Select the assessment or report owner."],
      ["--mode <mode>", "Select agent-setup, process, harness, or skills."],
      ["--all", "Show all history instead of the newest 20 runs."],
      ["--draft <file>", "Supply a candidacy draft."],
      ["--trusted-target", "Allow target-hook proof for prompt generation."],
      ["--format <type>", "Choose text, json, or markdown output."],
    ],
    examples: [
      "goat-flow quality . --agent codex",
      "goat-flow quality history --agent codex",
      'goat-flow quality candidacy "review risky migrations"',
    ],
  },
  manifest: {
    command: "manifest",
    visibility: "advanced",
    summary: "Inspect or validate the resolved manifest.",
    usage: ["goat-flow manifest [--check] [--format <type>]"],
    flags: [
      ["--check", "Fail when static and observed manifest state drift."],
      ["--format <type>", "Choose markdown or json output."],
    ],
    examples: ["goat-flow manifest", "goat-flow manifest --check"],
  },
  events: {
    command: "events",
    visibility: "advanced",
    summary: "Read local evidence-envelope events.",
    usage: ["goat-flow events tail [path] [--limit <n>] [--format json]"],
    subcommands: [["tail", "Read the newest local evidence envelopes."]],
    flags: [
      ["--limit <n>", "Return up to 500 newest events; default 20."],
      ["--format json", "Return one JSON array instead of JSONL text."],
    ],
    examples: [
      "goat-flow events tail . --limit 20",
      "goat-flow events tail . --format json",
    ],
  },
  hooks: {
    command: "hooks",
    visibility: "advanced",
    summary: "Inspect, configure, or verify registered hooks.",
    usage: ["goat-flow hooks <subcommand> [hook-id] [path] [flags]"],
    subcommands: [
      ["list", "Show desired and per-agent effective hook state."],
      ["enable", "Enable one hook and synchronize agent configs."],
      ["disable", "Disable one hook and synchronize agent configs."],
      ["sync", "Reapply config.yaml hook state to agent configs."],
      ["verify", "Run bounded configured-command scenarios."],
    ],
    flags: [
      ["--agent <id>", "Select the agent for hooks verify."],
      [
        "--scenario <name>",
        "Choose deny-hook, post-turn-hook, gruff-hook, or all.",
      ],
      ["--trusted-target", "Allow the selected configured hook to run."],
      ["--format <type>", "Choose text or json output."],
    ],
    examples: [
      "goat-flow hooks list",
      "goat-flow hooks enable gruff-code-quality",
      "goat-flow hooks verify . --agent codex --scenario deny-hook --trusted-target",
      "goat-flow hooks verify . --agent codex --scenario all --trusted-target",
    ],
  },
  claims: {
    command: "claims",
    visibility: "advanced",
    summary: "Inspect or explicitly recover one abandoned write claim.",
    usage: [
      "goat-flow claims inspect [path] --target <project-relative-path> [--format text|json]",
      "goat-flow claims recover [path] --target <project-relative-path> --marker-sha256 <hash> --confirm-abandoned [--format text|json]",
    ],
    subcommands: [
      ["inspect", "Read one marker identity without changing it."],
      [
        "recover",
        "Remove only the unchanged marker you confirmed is abandoned.",
      ],
    ],
    flags: [
      [
        "--target <path>",
        "Select one normalized project-relative write target.",
      ],
      [
        "--marker-sha256 <hash>",
        "Require the exact digest returned by inspect.",
      ],
      ["--confirm-abandoned", "Confirm that no writer still owns the target."],
      ["--format <type>", "Choose text or json output."],
    ],
    examples: [
      "goat-flow claims inspect . --target docs/cli.md",
      "goat-flow claims recover . --target docs/cli.md --marker-sha256 <hash> --confirm-abandoned",
    ],
  },
  menu: {
    command: "menu",
    visibility: "advanced",
    summary: "Open the interactive command picker.",
    usage: ["goat-flow", "goat-flow menu"],
    examples: ["goat-flow", "goat-flow menu"],
  },
  stats: {
    command: "stats",
    visibility: "advanced",
    summary: "Report learning-loop health.",
    usage: ["goat-flow stats [path] [--check] [--format <type>]"],
    flags: [
      ["--check", "Fail on malformed, stale, or drifted learning entries."],
      ["--format <type>", "Choose text, json, or markdown output."],
    ],
    examples: ["goat-flow stats", "goat-flow stats --check"],
  },
  recall: {
    command: "recall",
    visibility: "advanced",
    summary: "Find learning entries that cite named paths.",
    usage: ["goat-flow recall <path> [path...] [--format <type>]"],
    flags: [["--format <type>", "Choose text or json output."]],
    examples: [
      "goat-flow recall src/cli/server/terminal.ts",
      "goat-flow recall src/cli src/dashboard --format json",
    ],
  },
  learn: {
    command: "learn",
    visibility: "advanced",
    summary: "Validate and scaffold one learning-loop entry.",
    usage: [
      "goat-flow learn new [path] --type <kind> --category <bucket> --title <title> [flags]",
    ],
    subcommands: [["new", "Preview or write one explicit learning entry."]],
    flags: [
      ["--type <kind>", "Choose footgun, lesson, or pattern."],
      ["--category <bucket>", "Select a lowercase kebab-case bucket."],
      ["--title <title>", "Set the one-line entry heading."],
      ["--evidence <path>", "Cite one project file; repeat as needed."],
      ["--search <literal>", "Pair one literal with each evidence path."],
      [
        "--evidence-kind <kind>",
        "For footguns, choose ACTUAL_MEASURED, OBSERVED, or EXTERNAL_REFERENCE.",
      ],
      ["--dry-run", "Validate and print the scaffold without writing."],
      ["--format <type>", "Choose text, json, or markdown output."],
    ],
    examples: [
      'goat-flow learn new --type lesson --category verification --title "Check focused proof" --dry-run',
      'goat-flow learn new . --type footgun --category hooks --title "Hook drift" --evidence workflow/hooks/README.md --search "Generated index" --evidence-kind OBSERVED',
    ],
  },
  diagnostics: {
    command: "diagnostics",
    visibility: "advanced",
    summary: "Inspect context, readiness, support, or threat posture.",
    usage: ["goat-flow diagnostics <subcommand> [path] [flags]"],
    subcommands: [
      ["context", "Measure static local context pressure."],
      ["readiness", "Summarize five-concern preparedness."],
      ["bundle", "Create a redacted local support artifact."],
      ["threat-model", "Show configured agent and tool posture."],
    ],
    flags: [
      ["--agent <id>", "Limit the report to one agent."],
      ["--format <type>", "Choose text, json, or supported markdown output."],
      ["--output <file>", "Write supported output instead of printing it."],
    ],
    examples: [
      "goat-flow diagnostics readiness . --agent codex",
      "goat-flow diagnostics bundle . --format json",
    ],
  },
  index: {
    command: "index",
    visibility: "advanced",
    summary: "Regenerate learning-loop indexes.",
    usage: ["goat-flow index [path]"],
    examples: ["goat-flow index", "goat-flow index ../other-project"],
  },
  redact: {
    command: "redact",
    visibility: "advanced",
    summary: "Scrub durable text read from stdin.",
    usage: ["goat-flow redact [path] [--output <file>]"],
    flags: [
      [
        "--output <file>",
        "Create a private project-local file containing only scrubbed text.",
      ],
    ],
    examples: [
      "goat-flow redact",
      "goat-flow redact --output .goat-flow/logs/sessions/YYYY-MM-DD-HHMM-handoff-rand5.md",
    ],
  },
  review: {
    command: "review",
    visibility: "advanced",
    summary:
      "Validate transient goat-review ledgers, complete drafts, and persisted reports. Structural failures exit 1; advisory warnings retain exit 0.",
    usage: [
      "goat-flow review validate-ledger [ledger-file] [--output <path>]",
      "goat-flow review validate-draft [draft-envelope-file] [--output <path>]",
      "goat-flow review validate [report-file] [--output <path>]",
    ],
    subcommands: [
      ["validate-ledger", "Check transient ledger grammar and record count."],
      [
        "validate-draft",
        "Check one pending report and transient ledger envelope before persistence.",
      ],
      ["validate", "Check the report and its exact persisted ledger."],
    ],
    flags: [["--output <path>", "Write the validation result to a file."]],
    examples: [
      "goat-flow review validate-ledger",
      "goat-flow review validate-draft",
      "goat-flow review validate review.md",
    ],
  },
  plans: {
    command: "plans",
    visibility: "advanced",
    summary: "Export, check, or time milestone plans.",
    usage: [
      "goat-flow plans export <plan-path> [flags]",
      "goat-flow plans check <plan-path> [--strict]",
      "goat-flow plans time <start|stop|status> <milestone-file> [flags]",
    ],
    subcommands: [
      ["export", "Create a redacted portable preview or artifact."],
      ["check", "Validate milestone structure and effort accounting."],
      ["time", "Start, stop, or inspect one timing receipt."],
    ],
    flags: [
      ["--strict", "Apply the current-plan authoring gate on check."],
      ["--format <type>", "Choose markdown or json export output."],
      ["--output <path>", "Write an export instead of previewing it."],
      ["--force", "Replace an existing export destination."],
      [
        "--category <kind>",
        "Classify a timing start as product, proof, or other.",
      ],
      ["--finalize", "Finalize a stopped timing receipt."],
      ["--discard-open", "Discard an interrupted open timing span."],
    ],
    examples: [
      "goat-flow plans check .goat-flow/plans/1.17.0 --strict",
      "goat-flow plans time status .goat-flow/plans/1.17.0/M40-contextual-cli-help-and-proof.md",
    ],
  },
  skill: {
    command: "skill",
    visibility: "advanced",
    summary: "Author or diagnose goat-flow skills.",
    usage: ["goat-flow skill <new|doctor> [args] [flags]"],
    subcommands: [
      ["new", "Classify and scaffold a skill or playbook."],
      ["doctor", "Inspect static installation and invocation evidence."],
    ],
    flags: [
      ["--name <slug>", "Name a new skill."],
      ["--red-log <file>", "Supply the required failing RED receipt."],
      ["--draft <file>", "Validate an existing draft without writing."],
      ["--interactive", "Prompt for missing authoring input."],
      ["--yes, -y", "Confirm a non-interactive authoring decision."],
      ["--agent <id>", "Select an install or diagnostic profile."],
      ["--skill <name>", "Limit doctor output to one skill."],
      ["--format <type>", "Choose text, json, or markdown output."],
    ],
    examples: [
      'goat-flow skill new "review risky migrations" --name migration-review --red-log <file>',
      "goat-flow skill doctor . --agent codex --skill goat",
    ],
  },
  info: {
    command: "info",
    visibility: "hidden-legacy",
    summary: "Compatibility token for the removed info command.",
  },
} satisfies HelpCatalog;

const GLOBAL_HELP_EXAMPLES = [
  "goat-flow dashboard .",
  "goat-flow audit . --harness",
  "goat-flow install . --agent codex --dry-run",
  "goat-flow quality . --agent codex",
] as const;

/**
 * Render compact navigation when a user runs global `--help`.
 * Use it to choose a workflow without reading project or manifest state.
 *
 * @returns terminal-ready root help without a trailing newline
 */
function renderGlobalHelp(): string {
  const helpTopics = Object.values(COMMAND_HELP_CATALOG);
  const primaryCommandLines = helpTopics
    .filter((helpTopic) => helpTopic.visibility === "primary")
    .map(
      (helpTopic) =>
        `  ${helpTopic.command.padEnd(12, " ")} ${helpTopic.summary}`,
    );
  const advancedCommandNames = helpTopics
    .filter((helpTopic) => helpTopic.visibility === "advanced")
    .map((helpTopic) => helpTopic.command)
    .join(", ");

  return [
    "goat-flow - AI coding-agent harness",
    "",
    "Usage:",
    "  goat-flow <command> [project-path] [flags]",
    "  goat-flow                                  Open the interactive menu",
    "",
    "Common workflows:",
    ...primaryCommandLines,
    "",
    "Advanced commands:",
    `  ${advancedCommandNames}`,
    "",
    "Global flags:",
    "  --help, -h       Show help",
    "  --version, -v    Show version",
    "",
    "Examples:",
    ...GLOBAL_HELP_EXAMPLES.map((exampleCommand) => `  ${exampleCommand}`),
    "",
    "Run 'goat-flow <command> --help' for command-specific options and examples.",
    "Full reference: docs/cli.md",
  ].join("\n");
}

/**
 * Render an optional command-help section with aligned labels.
 * Use it for flags or subcommands so users only see sections with available choices.
 *
 * @param sectionTitle - heading shown above the available choices
 * @param helpRows - visible label and description pairs; absent or empty means omit the section
 * @returns formatted section lines; empty means the user has no choices in this section
 */
function renderHelpSection(
  sectionTitle: string,
  helpRows: HelpDetailRows | undefined,
): string[] {
  // An absent or empty section has no choices for the user, so its heading is omitted as well.
  if (!helpRows || helpRows.length === 0) return [];
  const widestLabelLength = Math.max(
    ...helpRows.map(([helpLabel]) => helpLabel.length),
  );
  return [
    "",
    `${sectionTitle}:`,
    ...helpRows.map(
      ([helpLabel, helpDescription]) =>
        `  ${helpLabel.padEnd(widestLabelLength, " ")}  ${helpDescription}`,
    ),
  ];
}

/**
 * Render scoped guidance after a user names an active top-level command.
 * Use before dispatch so missing project state cannot block the requested help.
 *
 * @param helpTopic - static usage, choices, flags, and examples for the selected command
 * @returns terminal-ready contextual help without a trailing newline
 */
function renderContextualHelp(helpTopic: VisibleHelpTopic): string {
  return [
    `goat-flow ${helpTopic.command}`,
    "",
    "Usage:",
    ...helpTopic.usage.map((usageLine) => `  ${usageLine}`),
    "",
    helpTopic.summary,
    ...renderHelpSection("Managed state", helpTopic.managedState),
    ...renderHelpSection("Subcommands", helpTopic.subcommands),
    ...renderHelpSection("Flags", helpTopic.flags),
    "",
    "Examples:",
    ...helpTopic.examples.map((exampleCommand) => `  ${exampleCommand}`),
    "",
    "Full reference: docs/cli.md",
  ].join("\n");
}

/**
 * Render global navigation or dedicated guidance for the user's selected command.
 * Use before dispatch so every help request remains independent of project state.
 *
 * @param requestedCommand - explicit top-level command; null means the user ran global `--help`
 * @returns terminal-ready help without a trailing newline
 */
export function renderHelp(requestedCommand: Command | null): string {
  // Global help starts with navigation because the user has not selected a workflow yet.
  if (requestedCommand === null) return renderGlobalHelp();

  const helpTopic = COMMAND_HELP_CATALOG[requestedCommand];
  // The retired `info` token remains parseable for compatibility but must stay hidden from users.
  if (helpTopic.visibility === "hidden-legacy") return renderGlobalHelp();

  return renderContextualHelp(helpTopic);
}
