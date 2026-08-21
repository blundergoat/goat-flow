/**
 * Static help metadata and renderers for the goat-flow command line.
 *
 * This module deliberately imports no command handlers, project configuration, or
 * manifest-derived values. Help must remain available when a target project is
 * missing, incomplete, or drifted.
 */

import type { Command } from "./cli-types.js";

/** Whether a command is prominent, discoverable in the compact index, or retained only for compatibility. */
type HelpVisibility = "primary" | "advanced" | "hidden-legacy";

/** Static navigation metadata for one top-level CLI command. */
interface HelpTopic<Name extends Command = Command> {
  command: Name;
  visibility: HelpVisibility;
  summary: string;
}

/** A catalog entry for every parser-recognized command, including hidden compatibility tokens. */
type HelpCatalog = {
  [Name in Command]: HelpTopic<Name>;
};

/**
 * Typed owner for help visibility and top-level command summaries.
 * Adding a parser command without deciding how help exposes it is a type error.
 */
const HELP_TOPICS = {
  dashboard: {
    command: "dashboard",
    visibility: "primary",
    summary: "Open the browser dashboard.",
  },
  audit: {
    command: "audit",
    visibility: "primary",
    summary:
      "Run deterministic setup checks; add --harness for harness checks.",
  },
  install: {
    command: "install",
    visibility: "primary",
    summary: "Copy or refresh goat-flow system files.",
  },
  setup: {
    command: "setup",
    visibility: "primary",
    summary: "Generate setup guidance or apply managed files.",
  },
  status: {
    command: "status",
    visibility: "primary",
    summary: "Show whether a project is bare, partial, outdated, or current.",
  },
  quality: {
    command: "quality",
    visibility: "primary",
    summary: "Generate an agent-driven quality assessment prompt.",
  },
  manifest: {
    command: "manifest",
    visibility: "advanced",
    summary: "Inspect or validate the resolved manifest.",
  },
  events: {
    command: "events",
    visibility: "advanced",
    summary: "Read local evidence-envelope events.",
  },
  hooks: {
    command: "hooks",
    visibility: "advanced",
    summary: "Inspect, configure, or verify registered hooks.",
  },
  menu: {
    command: "menu",
    visibility: "advanced",
    summary: "Open the interactive command picker.",
  },
  stats: {
    command: "stats",
    visibility: "advanced",
    summary: "Report learning-loop health.",
  },
  diagnostics: {
    command: "diagnostics",
    visibility: "advanced",
    summary: "Inspect context, readiness, support, or threat posture.",
  },
  index: {
    command: "index",
    visibility: "advanced",
    summary: "Regenerate learning-loop indexes.",
  },
  redact: {
    command: "redact",
    visibility: "advanced",
    summary: "Scrub durable text read from stdin.",
  },
  review: {
    command: "review",
    visibility: "advanced",
    summary: "Validate a saved goat-review report.",
  },
  plans: {
    command: "plans",
    visibility: "advanced",
    summary: "Export, check, or time milestone plans.",
  },
  skill: {
    command: "skill",
    visibility: "advanced",
    summary: "Author or diagnose goat-flow skills.",
  },
  info: {
    command: "info",
    visibility: "hidden-legacy",
    summary: "Compatibility token for the removed info command.",
  },
} satisfies HelpCatalog;

const ROOT_EXAMPLES = [
  "goat-flow dashboard .",
  "goat-flow audit . --harness",
  "goat-flow install . --agent codex --dry-run",
  "goat-flow quality . --agent codex",
] as const;

const REVIEW_HELP = [
  "goat-flow review validate",
  "",
  "Usage:",
  "  goat-flow review validate [report-file] [--output <path>]",
  "",
  "Validate a goat-review Markdown report from a file or stdin.",
  "Structural failures exit 1; advisory warnings exit 0.",
  "",
  "Full reference: docs/cli.md",
].join("\n");

/**
 * Render concise root guidance without reading project or manifest state.
 *
 * @returns terminal-ready root help without a trailing newline
 */
function renderRootHelp(): string {
  const topics = Object.values(HELP_TOPICS);
  const primaryLines = topics
    .filter((topic) => topic.visibility === "primary")
    .map((topic) => `  ${topic.command.padEnd(12, " ")} ${topic.summary}`);
  const advancedNames = topics
    .filter((topic) => topic.visibility === "advanced")
    .map((topic) => topic.command)
    .join(", ");

  return [
    "goat-flow - AI coding-agent harness",
    "",
    "Usage:",
    "  goat-flow <command> [project-path] [flags]",
    "  goat-flow                                  Open the interactive menu",
    "",
    "Common workflows:",
    ...primaryLines,
    "",
    "Advanced commands:",
    `  ${advancedNames}`,
    "",
    "Global flags:",
    "  --help, -h       Show help",
    "  --version, -v    Show version",
    "",
    "Examples:",
    ...ROOT_EXAMPLES.map((example) => `  ${example}`),
    "",
    "Run 'goat-flow <command> --help' for command-specific options and examples.",
    "Full reference: docs/cli.md",
  ].join("\n");
}

/**
 * Render the selected command's dedicated help when one exists, otherwise show root navigation.
 *
 * @param command - parsed top-level command associated with the help request
 * @returns terminal-ready help without a trailing newline
 */
export function renderHelp(command: Command): string {
  return command === "review" ? REVIEW_HELP : renderRootHelp();
}
