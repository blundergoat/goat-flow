/**
 * Spells the package command that audit, setup, stats, status, index, skill doctor, install, the quality prompt and the Hooks page print when
 * they advise a goat-flow run.
 *
 * A bare `goat-flow` runs whichever CLI is on PATH, and `@latest` runs a newer release once one ships; either can rewrite a project
 * with another release's files. Pinning the package to the running release keeps advice and the CLI that gave it on one version.
 */
import { AUDIT_VERSION } from "./constants.js";

/** The npx package spec for the running goat-flow release: `npx @blundergoat/goat-flow@<running release>`. */
export const PINNED_GOAT_FLOW_INVOCATION = `npx @blundergoat/goat-flow@${AUDIT_VERSION}`;

/**
 * Build a copyable goat-flow command pinned to the running release.
 *
 * @param args - subcommand and its arguments, such as `setup` or `install . --agent <id>`
 * @returns the command `npx @blundergoat/goat-flow@<running release> <args>`
 */
export function pinnedGoatFlowCommand(args: string): string {
  return `${PINNED_GOAT_FLOW_INVOCATION} ${args}`;
}
