/**
 * Supply consistent evidence and prerequisite checks for agent setup findings.
 *
 * Evidence helpers keep source types, verification dates, and link order aligned across the report.
 * Shared guards stop deeper checks when the selected instruction file is absent or the target uses a newer release than this CLI.
 */
import type { AuditContext, AuditFailure } from "./types.js";
import type { CheckEvidence } from "./provenance-types.js";
import { AUDIT_VERSION } from "../constants.js";
import { projectIsAheadOfCli } from "../version-compare.js";

// Date the agent-check provenance was last hand-verified; stamped onto every record these factories emit.
const VERIFIED_ON = "2026-04-18";

/**
 * Label the written specification behind an agent finding using the shared evidence contract.
 * Source type, verification date, and MUST level stay fixed; callers supply the source paths shown with their check.
 *
 * @param paths - specification or instruction files backing the check; empty supplies no file links
 * @returns - spec-sourced evidence with those paths and the shared verification date
 */
export function specProvenance(paths: string[]): CheckEvidence {
  return {
    source_type: "spec",
    source_urls: [],
    verified_on: VERIFIED_ON,
    normative_level: "MUST",
    evidence_paths: paths,
  };
}

/**
 * Label the recorded incident behind an agent finding using the same evidence contract as specification-based checks.
 * Local footgun or lesson paths identify the incident; the record carries no external URLs.
 *
 * @param paths - footgun or lesson files supporting the check; empty supplies no incident file links
 * @returns - incident-sourced evidence with those paths and the shared verification date
 */
export function incidentProvenance(paths: string[]): CheckEvidence {
  return {
    source_type: "incident",
    source_urls: [],
    verified_on: VERIFIED_ON,
    normative_level: "MUST",
    evidence_paths: paths,
  };
}

/**
 * Keep each evidence path once while preserving first-seen order for stable audit links.
 *
 * @param paths - paths combined from check evidence; an empty list has no links to deduplicate
 * @returns - paths in their original order with later duplicates removed; empty stays empty
 */
export function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

/**
 * Skip template-dependent checks when valid project configuration names a newer release than this CLI can assess.
 * An older bundle cannot provide authoritative replacement files for that target.
 *
 * @param ctx - parsed target configuration; missing or invalid configuration cannot establish that the target is newer
 * @returns - true for a verified newer target version; false leaves configuration errors to their owning checks
 */
export function targetUsesNewerGoatFlow(ctx: AuditContext): boolean {
  const targetVersion = ctx.config.config.version;
  // Missing, invalid, or unversioned configuration cannot justify skipping checks as a newer installation.
  if (
    !ctx.config.exists ||
    !ctx.config.valid ||
    ctx.config.parseError !== null ||
    !targetVersion
  ) {
    return false;
  }
  return projectIsAheadOfCli(targetVersion, AUDIT_VERSION);
}

/**
 * Stop a selected-agent check at its missing instruction file so the user gets the setup repair before deeper findings.
 *
 * For example, an audit selecting Codex without AGENTS.md must first point the user back to installation.
 * Aggregate audits leave instruction coverage to their broader setup check.
 *
 * @param ctx - selected target facts; a null agentFilter means this selected-agent prerequisite does not apply
 * @param check - displayed check name to attach to the missing-instruction finding
 * @returns - missing-instruction failure, or null when the selected instruction exists or no agent was selected
 */
export function checkSelectedInstructionAvailable(
  ctx: AuditContext,
  check: string,
): AuditFailure | null {
  // An aggregate audit has no single selected instruction file to guard here.
  if (!ctx.agentFilter) return null;
  const agentFacts = ctx.agents.find(
    (facts) => facts.agent.id === ctx.agentFilter,
  );
  // The selected agent's starter file exists, so its caller can continue with the detailed check.
  if (agentFacts?.instruction.exists) return null;
  // If extraction found no agent profile, use the instruction filename this prerequisite reports for the selected agent.
  const expectedInstructionPath =
    agentFacts?.agent.instructionFile ??
    (ctx.agentFilter === "claude" ? "CLAUDE.md" : "AGENTS.md");
  return {
    check,
    message: `Missing instruction file for ${ctx.agentFilter}: ${expectedInstructionPath}`,
    evidence: expectedInstructionPath,
    howToFix: `Install goat-flow for ${ctx.agentFilter} or remove --agent ${ctx.agentFilter} from this audit.`,
  };
}
