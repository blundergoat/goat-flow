#!/usr/bin/env node

/**
 * Command-line entry point for goat-flow.
 * Handles argv parsing, command dispatch, exit codes, and on-disk output for audit, quality, setup, dashboard, events, and info workflows.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QUALITY_MODES } from "./quality/schema.js";
import { getPackageVersion } from "./paths.js";
import { validAgentList } from "./cli-agent-options.js";
import { CLIError } from "./cli-error.js";
import { dispatchCommand } from "./cli-handlers.js";
import { parseCLIArgs } from "./cli-parser.js";

export { dispatchCommand } from "./cli-handlers.js";
export { parseCLIArgs } from "./cli-parser.js";
export type { ParsedCLI } from "./cli-types.js";

/** Current package version used in --version output. */
const PACKAGE_VERSION = getPackageVersion();

/** Print usage instructions and available commands to stdout */
function printHelp(): void {
  console.log(`
goat-flow - GOAT Flow CLI Auditor

Usage:
  goat-flow [command] [project-path] [flags]

Commands:
  menu              Interactive command picker (default when run with no args)
  audit             Deterministic pass/fail: GOAT Flow Setup + Agent Setup (add --harness for AI Harness Completeness)
  quality           Agent-driven quality prompt plus history/diff surfaces
  setup             Generate setup prompt (adapts to project state)
  install           Deterministically copy/update goat-flow system files
  status            Show project state (bare/partial/v0.9/outdated/current)
  dashboard         Launch browser dashboard with audit, setup, and terminal
  manifest          Print the resolved single-source-of-truth manifest (--check validates consistency)
  stats             Learning-loop health report (live entry counts, stale refs, freshness). Use --check for CI.
  index             Regenerate the generated learning-loop INDEX.md files (footguns, lessons, patterns, decisions)
  events tail       Read local gitignored evidence-envelope events
  skill new         Author a new skill or playbook from a description, draft, or interactive prompt.
  hooks list        List registered hook state for this project
  hooks enable      Enable one registered hook and sync agent configs
  hooks disable     Disable one registered hook and sync agent configs
  hooks sync        Re-apply config.yaml hook truth to agent configs
Arguments:
  project-path    Target project directory (default: .)

Flags:
  --format <type>   Output format: json, text, markdown, sarif (omit for auto-detect: text in terminal, json otherwise)
  --agent <id>      Filter to one agent: ${validAgentList()}
  --mode <mode>     Quality prompt/history/diff mode: ${QUALITY_MODES.join(", ")}
  --all             Quality history: lift the default 20-run limit
  --limit <n>       Events tail: number of newest envelopes to read (default: 20, max: 500)
  --harness         Audit: add AI Harness Completeness scope (pass/fail checks across 5 concerns)
  --check-drift     Audit: detect skill template-vs-installed drift and orphan directories
  --check-content   Audit: cold-path content lint (vague terms, generic instructions, factual drift)
  --untrusted-target Audit: skip executing the target's deny-hook code (static checks only; use for a checkout you don't trust)
  --no-audit-details Audit JSON: omit structured harness detail payloads
  --check           Manifest: validate static-vs-observed consistency (exits non-zero on drift)
  --json            Hooks: emit machine-readable JSON (alias for --format json)
  --apply           Setup: copy/update deterministic system files instead of generating a prompt
  --force           Install/setup --apply: overwrite settings, config, and remove deprecated skills
  --update-config-version  Install: update only the version field in existing config.yaml
  --clean-deprecated       Install: remove deprecated skill directories
  --verbose         Show per-check details
  --output <file>   Write output to file instead of stdout
  --dev             Dashboard: live reload on file changes
  --help, -h        Show this help
  --version, -v     Show version

Examples:
  goat-flow                            Open the interactive menu
  goat-flow .                          Audit current directory
  goat-flow audit . --harness          Audit with AI harness completeness checks
  goat-flow audit . --agent claude     Audit scoped to Claude
  goat-flow audit . --format json      JSON output for CI
  goat-flow audit . --format sarif     SARIF output for CI/code scanning upload
  goat-flow install . --agent claude   Copy/update goat-flow system files
  goat-flow setup . --agent claude --apply
  goat-flow setup --agent claude       Setup prompt for Claude
  goat-flow quality . --agent claude   Quality assessment prompt for Claude
  goat-flow quality . --agent claude --mode skills
  goat-flow quality history --agent claude
  goat-flow quality history --agent codex --mode skills
  goat-flow quality diff --agent claude --mode agent-setup
  goat-flow quality validate <path>    Schema-check a freshly written report (exit 2 on any error)
  goat-flow manifest                   Print the resolved manifest
  goat-flow manifest --check           Verify the manifest is consistent with code
  goat-flow hooks list --json          Print hook state as JSON
  goat-flow hooks enable gruff-code-quality
  goat-flow hooks sync                 Re-apply hook toggles from config.yaml
  goat-flow stats                      Learning-loop health report
  goat-flow stats --check              Fail if any bucket is missing last_reviewed or has stale refs
  goat-flow index                      Regenerate learning-loop INDEX.md files after editing entries
  goat-flow events tail . --limit 20   Print local evidence-envelope events as JSONL
  goat-flow skill new "<description>"  Scaffold a skill from a natural-language description
  goat-flow skill ./repo new "<description>"
  goat-flow skill new --draft <path>   Validate an existing draft against the candidacy check
  goat-flow skill new --interactive    Prompt for description and name, then scaffold
  goat-flow --format markdown          PR-comment friendly output
  goat-flow --output report.json       Write results to file
`);
}

/** Print the current package version to stdout */
function printVersion(): void {
  console.log(`goat-flow v${PACKAGE_VERSION}`);
}

/**
 * Entry point that dispatches to the appropriate command handler.
 * Installs an EPIPE guard that exits 0 when stdout is closed early (e.g. piped to `head`); any
 * other stdout error is rethrown. Parse and dispatch errors are not handled here - they throw and
 * are caught by the top-level runner below, which maps CLIError to its exit code.
 */
async function main(): Promise<void> {
  // Gracefully handle EPIPE (e.g., output piped to `head`)
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });

  const rawArgs = process.argv.slice(2);

  // Empty argv opens the menu; path-only argv still uses the audit shorthand.
  const options = parseCLIArgs(rawArgs);

  if (options.showHelp) {
    printHelp();
    return;
  }
  if (options.showVersion) {
    printVersion();
    return;
  }

  await dispatchCommand(options);
}

/**
 * True when this module is the CLI entry point, including when launched through a symlink like
 * `node_modules/.bin/goat-flow`. Resolves both the invoked path and this module's URL through
 * realpath so the symlink and its target compare equal. A resolution error (missing or
 * unreadable path) is swallowed and treated as a fallback `false`, so importing this module as a
 * library never accidentally triggers the CLI runner.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return (
      realpathSync(resolve(entry)) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    if (err instanceof CLIError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    console.error(
      `Fatal error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
