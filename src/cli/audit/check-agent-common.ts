/**
 * Shared building blocks for the agent-setup check families. Holds the provenance-record factories
 * every agent check uses to stamp its evidence (so source type and verification date stay consistent
 * across checks), a path-dedupe helper, and the instruction-file precondition guard. Splitting these
 * out keeps the per-check files focused on their own assertions rather than re-declaring boilerplate.
 */
import type { AuditContext, AuditFailure } from "./types.js";
import type { CheckEvidence } from "./provenance-types.js";
import { AUDIT_VERSION } from "../constants.js";
import { projectIsAheadOfCli } from "../version-compare.js";

/** Date the agent-check provenance was last hand-verified; stamped onto every record these factories emit. */
const VERIFIED_ON = "2026-04-18";

/**
 * Build a `spec`-typed provenance record for an agent check - evidence whose authority is a written
 * specification rather than a past incident. Source type, empty URL list, the shared verification
 * date, and `MUST` normative level are fixed; only the evidence paths vary per check.
 *
 * @param paths - repo-relative files that back the check (the spec docs or instruction files it reads)
 * @returns a spec-sourced evidence record carrying those paths and the module's shared `verified_on` date
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
 * Build an `incident`-typed provenance record for an agent check - evidence whose authority is a past
 * failure captured in a footgun or lesson rather than a spec. Identical shape to `specProvenance`
 * apart from the source type; the citation lives in `evidence_paths`, hence the empty URL list.
 *
 * @param paths - repo-relative files that back the check, typically the footgun/lesson recording the incident
 * @returns an incident-sourced evidence record carrying those paths and the module's shared `verified_on` date
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
 * Deduplicate provenance paths while preserving first-seen order for stable audit output. Order is
 * preserved deliberately so combined evidence lists stay deterministic across runs.
 *
 * @param paths - evidence paths to dedupe, possibly with repeats from merging several checks' lists
 * @returns the same paths with later duplicates removed, first occurrence kept in original order
 */
export function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

/**
 * Report whether a valid target config belongs to a newer goat-flow release than the running CLI.
 * Template-relative checks use this as a skip gate because an older bundle cannot authoritatively
 * assess or repair skills and guardrails installed by a newer release.
 *
 * @param ctx - audit context containing the parsed target config
 * @returns true when the target version is newer and the running CLI is the stale side
 */
export function targetUsesNewerGoatFlow(ctx: AuditContext): boolean {
  const version = ctx.config.config.version;
  if (
    !ctx.config.exists ||
    !ctx.config.valid ||
    ctx.config.parseError !== null ||
    !version
  ) {
    return false;
  }
  return projectIsAheadOfCli(version, AUDIT_VERSION);
}

export function checkSelectedInstructionAvailable(
  ctx: AuditContext,
  check: string,
): AuditFailure | null {
  if (!ctx.agentFilter) return null;
  const agentFacts = ctx.agents.find(
    (facts) => facts.agent.id === ctx.agentFilter,
  );
  if (agentFacts?.instruction.exists) return null;
  const expected =
    agentFacts?.agent.instructionFile ??
    (ctx.agentFilter === "claude" ? "CLAUDE.md" : "AGENTS.md");
  return {
    check,
    message: `Missing instruction file for ${ctx.agentFilter}: ${expected}`,
    evidence: expected,
    howToFix: `Install goat-flow for ${ctx.agentFilter} or remove --agent ${ctx.agentFilter} from this audit.`,
  };
}
