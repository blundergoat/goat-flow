/**
 * Choose when a normal audit also checks installed files for drift.
 *
 * Projects with multiple agent instruction files need this comparison even when the user selects only one agent.
 * The manifest supplies the full set of instruction paths, so a filtered audit cannot hide another installed agent.
 */
import { loadManifest } from "../manifest/manifest.js";
import type { AuditContext } from "./types.js";

/**
 * Enable automatic drift checks when multiple agent instruction files exist in the target project.
 * Use manifest paths because --agent has already narrowed the context and would hide other installed agents.
 *
 * @param ctx - target filesystem used to find instruction files, including agents outside the selected filter
 * @returns - true when more than one instruction file exists; zero or one keeps drift opt-in
 */
export function shouldAutoRunDrift(ctx: AuditContext): boolean {
  const manifest = loadManifest();
  let instructionFilesPresent = 0;
  // Count installed instruction files across all agents, including those the user did not select for this report.
  for (const agent of Object.values(manifest.agents)) {
    // An existing instruction file is the signal that this agent's installed copies may need drift checks.
    if (ctx.fs.exists(agent.instruction_file)) instructionFilesPresent++;
  }
  return instructionFilesPresent > 1;
}
