/**
 * Context concern: warns when a consumer instruction file's heading carries a goat-flow release number.
 *
 * Install identity lives in `.goat-flow/config.yaml`, so a release in the heading only drifts, and upgraders bump it by hand instead.
 * The check is score-only: a stamped heading lowers the Context score without failing the project's audit.
 */
import type { AuditContext, HarnessCheck } from "../types.js";
import { pass, fail } from "./helpers.js";
import { UNSAFE_SINGLE_LINE_CHARACTER } from "../../terminal-safe-text.js";

// Every character that could split or reorder the printed heading line, matched globally so all are removed.
const UNSAFE_HEADING_CHARACTERS = new RegExp(
  UNSAFE_SINGLE_LINE_CHARACTER.source,
  "gu",
);

const VERIFIED_ON = "2026-11-25";

// The goat-flow framework's own package; its instruction headers stay versioned for parity and release checks.
const FRAMEWORK_PACKAGE_NAME = "@blundergoat/goat-flow";

// A heading that names the release anywhere, such as "goat-flow 1.19.0".
const NAMED_RELEASE = /\bgoat-flow\s+v?\d+\.\d+\.\d+\b/iu;

// The framework header form older setups copied, such as "# AGENTS.md - v1.13.1 (2026-07-13)"; a product version reads differently.
const FRAMEWORK_HEADER_FORM =
  /^#\s+(?:CLAUDE\.md|AGENTS\.md|GEMINI\.md|Copilot Instructions)\s+-\s+v\d+\.\d+\.\d+\s+\(\d{4}-\d{2}-\d{2}\)\s*$/u;

/**
 * Read the first Markdown heading of an instruction file, safe to print as one terminal line.
 *
 * The heading comes from the audited project, so control and bidirectional characters are removed before it reaches a finding.
 *
 * @param content - instruction file text; null when the file is absent or unreadable
 * @returns the first `# ` heading line without unsafe characters, or null when the file has none
 */
function firstHeading(content: string | null): string | null {
  // An absent file has no heading to judge; the line-count check already reports it.
  if (content === null) return null;
  const heading = content.split("\n").find((line) => line.startsWith("# "));
  // A file without a level-one heading has no stamp to report.
  if (heading === undefined) return null;
  return heading.replace(UNSAFE_HEADING_CHARACTERS, "");
}

/**
 * Decide whether the audited project is the goat-flow framework checkout itself.
 *
 * Error behavior: swallows a `package.json` parse error and reports the project as a consumer, so the check still runs.
 *
 * @param ctx - audit context whose filesystem reads the target's `package.json`
 * @returns true when the target's package name is the goat-flow package; false for a missing or unreadable manifest
 */
function isFrameworkCheckout(ctx: AuditContext): boolean {
  const manifest = ctx.fs.readFile("package.json");
  // A target without a package manifest cannot be the framework checkout.
  if (manifest === null) return false;
  try {
    return (
      (JSON.parse(manifest) as { name?: unknown }).name ===
      FRAMEWORK_PACKAGE_NAME
    );
  } catch {
    // An unparseable manifest cannot name the framework, so the project is treated as a consumer.
    return false;
  }
}

const instructionReleaseStamp: HarnessCheck = {
  id: "instruction-release-stamp",
  name: "Instruction heading carries no goat-flow release",
  concern: "context",
  type: "advisory",
  failureImpact: "score-only",
  evidenceKind: "structural",
  provenance: {
    source_type: "spec",
    source_urls: [],
    verified_on: VERIFIED_ON,
    normative_level: "SHOULD",
    evidence_paths: ["docs/cli.md", "workflow/setup/02-instruction-file.md"],
  },
  /** Return true for the framework checkout, whose own headers are versioned on purpose. */
  skip: isFrameworkCheckout,
  /** Run the Instruction heading carries no goat-flow release check. */
  run: (ctx) => {
    // Each agent's instruction file is read separately, because ports bumped some files and not others.
    const releaseStamps = ctx.agents.map((agentFacts) => {
      const heading = firstHeading(agentFacts.instruction.content);
      return {
        agent: agentFacts.agent.id,
        file: agentFacts.agent.instructionFile,
        heading,
        // A heading that names a release, or copies the framework header form, is a stamp; a project's own version is not.
        stamped:
          heading !== null &&
          (NAMED_RELEASE.test(heading) || FRAMEWORK_HEADER_FORM.test(heading)),
      };
    });
    // Agents that share one instruction file, such as AGENTS.md, report it once.
    const stampedRows = releaseStamps.filter(
      (row, index) =>
        row.stamped &&
        releaseStamps.findIndex((other) => other.file === row.file) === index,
    );
    const stampedFiles = stampedRows.map((row) => row.file);
    // No stamped heading, so install identity has one source.
    if (stampedFiles.length === 0) {
      return pass(["No instruction heading carries a goat-flow release"], {
        releaseStamps,
      });
    }
    return fail(
      stampedRows.map(
        (row) =>
          `${row.file}: heading carries a goat-flow release ("${row.heading}")`,
      ),
      [
        `Remove the goat-flow release from the heading of ${stampedFiles.join(", ")}`,
      ],
      [
        `goat-flow reads the installed release from .goat-flow/config.yaml, so a release in an instruction heading only drifts. Through the project's instruction-file review, remove the goat-flow release from the heading of ${stampedFiles.join(", ")}; keep the project name and any product version.`,
      ],
      { releaseStamps },
    );
  },
};

export const RELEASE_STAMP_CHECKS: HarnessCheck[] = [instructionReleaseStamp];
