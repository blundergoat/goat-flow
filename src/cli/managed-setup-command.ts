/**
 * Writes the managed setup dry-run report at the CLI command boundary.
 * Users invoke this path to inspect exact managed actions without starting Bash.
 * It keeps format validation, report output, and blocked exit status together.
 * The install handler remains focused on admission and execution after preview.
 */
import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import { validAgentFlags } from "./cli-agent-options.js";
import type { ParsedCLI } from "./cli-types.js";
import {
  type ManagedSetupPreview,
  renderManagedSetupPreviewText,
} from "./managed-setup-preview.js";
import type { AgentId } from "./types.js";

/**
 * Validate shared install and dry-run choices, then return the selected agent.
 * It throws a CLI error before target reads or writes when the user's choices are incompatible.
 *
 * @param options - parsed command choices; a missing agent means no managed destination was selected
 * @returns selected agent identifier; never null after this validation succeeds
 */
export function validateManagedSetupRequest(options: ParsedCLI): AgentId {
  // Every deterministic preview or install needs one agent-specific skill destination.
  if (!options.agent) {
    throw new CLIError(
      `install and setup preview require --agent. Use one of: ${validAgentFlags()}\n  (managed files are agent-specific; run each agent separately)`,
      2,
    );
  }
  // Install output streams from Bash; only the read-only preview can write a report file.
  if (options.output !== null && !options.shouldDryRun) {
    throw new CLIError("--output is not supported for install.", 2);
  }
  return options.agent;
}

/**
 * Emit one text or JSON preview and mark unresolved conflicts as a failed dry run.
 * Use after a user selects `install` or `setup` with `--dry-run`.
 *
 * @param options - parsed dry-run choices; absent output means the report is printed to stdout
 * @param preview - complete managed result; an empty files list still emits verdict and limits
 */
export function emitManagedSetupDryRun(
  options: ParsedCLI,
  preview: ManagedSetupPreview,
): void {
  // The v1 contract stays limited to human text and stable machine-readable JSON.
  if (options.format !== "text" && options.format !== "json") {
    throw new CLIError(
      "Managed setup preview supports --format text or --format json.",
      2,
    );
  }
  // JSON serves scripts while text gives terminal users the same actions in plain English.
  writeOutput(
    options,
    options.format === "json"
      ? JSON.stringify(preview, null, 2)
      : renderManagedSetupPreviewText(preview),
  );
  // Blocked previews use a non-zero exit so scripts cannot mistake a conflict for readiness.
  if (preview.verdict === "blocked") process.exitCode = 1;
}
