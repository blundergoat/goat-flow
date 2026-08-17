/**
 * Parses a user's instruction file (`CLAUDE.md`, `AGENTS.md`, or the Copilot file) into the sections the audit checks.
 *
 * Sections are keyed by lowercased heading, so a user who retitles a heading's capitalisation does not fail an otherwise correct file.
 *
 * Everything downstream that asks "does this project document its constraints?" reads the map this module builds.
 */
import type { AgentProfile, AgentFacts, ReadonlyFS } from "../../types.js";

/** Parse markdown content into a map of lowercase heading names to their body text. */
function parseSections(content: string): Map<string, string> {
  /** Accumulated heading-to-content mapping */
  const sections = new Map<string, string>();
  /** Input split into individual lines */
  const lines = content.split("\n");
  let currentHeading = "";
  let currentContent: string[] = [];

  // Iterate over lines to group content under markdown headings
  for (const line of lines) {
    /** Regex match result for lines starting with 1-3 '#' characters */
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentHeading) {
        sections.set(currentHeading.toLowerCase(), currentContent.join("\n"));
      }
      const captured = headingMatch[1];
      if (captured === undefined) continue;
      currentHeading = captured;
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentHeading) {
    sections.set(currentHeading.toLowerCase(), currentContent.join("\n"));
  }

  return sections;
}

/**
 * Extract the body text of a named markdown section, or null if not found.
 *
 * @param content - markdown instruction file content to search
 * @param sectionName - case-insensitive heading fragment that identifies the target section
 * @returns section body text without the heading, or null when the section is absent
 */
export function extractSection(
  content: string,
  sectionName: string,
): string | null {
  /** Input split into individual lines */
  const lines = content.split("\n");
  let inSection = false;
  /** Lines collected while inside the target section */
  const sectionLines: string[] = [];

  // Iterate over lines to find and extract the named section content
  for (const line of lines) {
    /** Regex match result for markdown heading lines */
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      if (inSection) break;
      const headingText = heading[1];
      if (headingText === undefined) continue;
      if (headingText.toLowerCase().includes(sectionName.toLowerCase())) {
        inSection = true;
      }
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.length > 0 ? sectionLines.join("\n") : null;
}

// ─── Focused extraction functions ────────────────────────────────────

/**
 * Extract instruction file facts: existence, content, line count, and parsed sections.
 *
 * @param fs - project filesystem adapter used to read the instruction file
 * @param agent - agent profile that names the instruction file path
 * @returns instruction-file facts used by setup and harness checks
 */
export function extractInstructionFacts(
  fs: ReadonlyFS,
  agent: AgentProfile,
): AgentFacts["instruction"] {
  /** Raw content of the agent's instruction file (null if missing) */
  const content = fs.readFile(agent.instructionFile);
  /** Whether the instruction file exists on disk */
  const exists = content !== null;
  /** Number of lines in the instruction file */
  const lineCount = exists
    ? content.split("\n").length - (content.endsWith("\n") ? 1 : 0)
    : 0;
  /** Parsed heading-to-content sections from the instruction file */
  const sections = exists ? parseSections(content) : new Map<string, string>();

  return { exists, content, lineCount, sections };
}
