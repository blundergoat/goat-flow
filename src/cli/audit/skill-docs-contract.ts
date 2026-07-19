/**
 * Validates the skill-doc discovery contract used by `goat-flow audit`.
 * Use it when an operator needs instruction routing and installed playbooks
 * checked without mixing Markdown parsing into the main setup-check registry.
 * It reads project files only and returns user-facing failures without writes.
 */
import { AUDIT_VERSION } from "../constants.js";
import type { AuditContext, AuditFailure } from "./types.js";

const READ_RULE_PATTERNS = [
  /Before declaring any tool(?: or capability)? unavailable/i,
  /\.goat-flow\/skill-docs\/playbooks\//,
  /Availability Check/i,
];

const ROUTER_POINTER_PATTERNS = [
  /\.goat-flow\/skill-docs\/playbooks\//,
  /tool playbooks?|skill docs?|skill playbooks?/i,
];

export const STANDALONE_PLAYBOOK_FILES = [
  ".goat-flow/skill-docs/playbooks/browser-use.md",
  ".goat-flow/skill-docs/playbooks/changelog.md",
  ".goat-flow/skill-docs/playbooks/code-comments.md",
  ".goat-flow/skill-docs/playbooks/gruff-code-quality.md",
  ".goat-flow/skill-docs/playbooks/hook-policy-testing.md",
  ".goat-flow/skill-docs/playbooks/observability.md",
  ".goat-flow/skill-docs/playbooks/page-capture.md",
  ".goat-flow/skill-docs/playbooks/release-notes.md",
  ".goat-flow/skill-docs/playbooks/skill-playbook-authoring-sync.md",
] as const;

/**
 * Stores one parsed Markdown heading so user-facing sections can be isolated.
 * String offsets preserve the instruction file's original LF or CRLF shape.
 */
interface MarkdownHeading {
  index: number;
  end: number;
  level: number;
  title: string;
}

/**
 * Return instruction paths that exist for the agents selected by the project manifest.
 * @param auditContext - selected-project audit state; an empty agent map means there are no instruction paths to show
 * @returns unique existing paths; empty means no supported instruction surface is present
 */
export function presentInstructionFiles(auditContext: AuditContext): string[] {
  // Each configured agent contributes the instruction file its users actually load.
  const configuredInstructionPaths = Object.values(
    auditContext.structure.agents,
  ).map((configuredAgent) => configuredAgent.instruction_file);
  // Missing paths are omitted so the audit lists only instruction surfaces users can open.
  return [...new Set(configuredInstructionPaths)].filter((instructionPath) =>
    auditContext.fs.exists(instructionPath),
  );
}

/**
 * Parse ATX headings so audit users see failures scoped to the intended section.
 * Mutates only the local RegExp cursor; project state is unchanged.
 */
function parseMarkdownHeadings(markdownContent: string): MarkdownHeading[] {
  const headingPattern = /^(#{1,6})\s+(.+?)\s*$/gm;
  const headings: MarkdownHeading[] = [];
  let headingMatch: RegExpExecArray | null;
  // Each heading contributes one boundary for READ or Router Table extraction.
  while ((headingMatch = headingPattern.exec(markdownContent)) !== null) {
    // Missing optional captures become neutral values instead of breaking the user's audit.
    headings.push({
      index: headingMatch.index,
      end: headingMatch.index + headingMatch[0].length,
      level: headingMatch[1]?.length ?? 0,
      title: headingMatch[2] ?? "",
    });
  }
  return headings;
}

/**
 * Return the content offset after either an LF or CRLF heading line.
 * Use when audit isolates one user-facing section without retaining its newline.
 */
function contentStartAfterHeading(
  markdownContent: string,
  headingEnd: number,
): number {
  // Windows instruction files place a two-character newline after the heading.
  if (markdownContent.slice(headingEnd, headingEnd + 2) === "\r\n") {
    return headingEnd + 2;
  }
  // POSIX instruction files place one newline after the heading.
  if (markdownContent[headingEnd] === "\n") return headingEnd + 1;
  return headingEnd;
}

/**
 * Extract one heading section without swallowing sibling user instructions.
 * Use when one audit rule needs only its matching user-facing contract section.
 */
function extractMarkdownSection(
  markdownContent: string,
  headingTitlePattern: RegExp,
): string | null {
  const headings = parseMarkdownHeadings(markdownContent);
  // The first matching heading identifies the contract section shown to the user.
  const matchingHeadingIndex = headings.findIndex((headingEntry) =>
    headingTitlePattern.test(headingEntry.title),
  );
  // A missing heading means the operator has not installed this contract section.
  if (matchingHeadingIndex < 0) return null;

  const matchingHeading = headings[matchingHeadingIndex];
  // An absent indexed value is treated as a missing section, not an exception.
  if (matchingHeading === undefined) return null;
  // The next same-or-higher-level heading bounds this section for the audit message.
  const nextSiblingHeading = headings
    .slice(matchingHeadingIndex + 1)
    .find((headingEntry) => headingEntry.level <= matchingHeading.level);
  // No sibling means the requested section continues to the end of the user's file.
  return markdownContent
    .slice(
      contentStartAfterHeading(markdownContent, matchingHeading.end),
      nextSiblingHeading?.index,
    )
    .trim();
}

/**
 * Extract AGENTS-style bold execution steps when headings are not used.
 * Mutates only a local RegExp cursor; project state is unchanged.
 */
function extractBoldExecutionStep(
  instructionContent: string,
  executionStepName: string,
): string | null {
  const boldStepPattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:[-*]\s*)?\*\*${executionStepName}\*\*[\s:–-]*(?<body>[\s\S]*?)(?=\n\s*(?:[-*]\s*)?\*\*(?:READ|SCOPE|ACT|VERIFY)\*\*[\s:–-]*|\n##\s|\n###\s|$)`,
    "i",
  );
  // No match means this instruction file does not express the requested execution step in bold.
  return boldStepPattern.exec(instructionContent)?.groups?.body?.trim() ?? null;
}

/**
 * Check that READ routes a user's tool request through the local playbook first.
 * Use when setup audit verifies cold-start capability discovery.
 */
function hasSkillReferenceReadRule(instructionContent: string): boolean {
  const executionLoop = extractMarkdownSection(
    instructionContent,
    /^Execution Loop\b/i,
  );
  // Without an execution loop, incidental playbook prose cannot satisfy READ.
  if (executionLoop === null) return false;
  // Heading-based READ is preferred; bold READ keeps compact instruction files usable.
  const readSection =
    extractMarkdownSection(executionLoop, /^READ\b/i) ??
    extractBoldExecutionStep(executionLoop, "READ");
  // A missing READ section leaves users without a deterministic discovery step.
  if (readSection === null) return false;
  // Every phrase is required so a user request reaches availability evidence before fallback.
  return READ_RULE_PATTERNS.every((pattern) => pattern.test(readSection));
}

/**
 * Check that the Router Table exposes playbooks for future user requests.
 * Use when setup audit verifies a cold-start agent can find installed capabilities.
 */
function hasSkillReferenceRouterPointer(instructionContent: string): boolean {
  const routerTable = extractMarkdownSection(
    instructionContent,
    /^Router Table\b/i,
  );
  // A missing router cannot direct a user request to the installed capability docs.
  if (routerTable === null) return false;
  // Every pointer is required so users can find both the directory and its purpose.
  return ROUTER_POINTER_PATTERNS.every((pattern) => pattern.test(routerTable));
}

/**
 * Return the instruction requirements an operator still needs to add.
 * @param instructionContent - complete instruction text; empty means both discovery requirements are missing
 * @returns missing requirement labels; empty means the instruction contract is complete
 */
export function missingSkillReferenceInstructionRequirements(
  instructionContent: string,
): string[] {
  const missingRequirements: string[] = [];
  // Users need the READ rule before incidental references can count as routing.
  if (!hasSkillReferenceReadRule(instructionContent)) {
    missingRequirements.push("READ rule");
  }
  // Users also need a stable Router Table path for cold-start discovery.
  if (!hasSkillReferenceRouterPointer(instructionContent)) {
    missingRequirements.push("Router Table pointer");
  }
  return missingRequirements;
}

/**
 * Validate one installed playbook's version and first user-facing section.
 * Use before discovery checks so users receive the nearest actionable repair.
 */
function standalonePlaybookShapeFailure(
  auditContext: AuditContext,
  playbookPath: (typeof STANDALONE_PLAYBOOK_FILES)[number],
): AuditFailure | null {
  // An unreadable file is treated as empty so the user receives the shape repair.
  const playbookContent = auditContext.fs.readFile(playbookPath) ?? "";
  // Missing frontmatter becomes undefined so the audit can explain the exact repair.
  const playbookFrontmatter = playbookContent.match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u,
  )?.[1];
  const expectedReferenceVersionLine = `goat-flow-reference-version: "${AUDIT_VERSION}"`;

  // Missing or stale version metadata makes the installed reference unverifiable.
  if (
    playbookFrontmatter === undefined ||
    !playbookFrontmatter.includes(expectedReferenceVersionLine)
  ) {
    return {
      check: "Instruction file skill-docs pointer",
      message: `${playbookPath} is missing current goat-flow-reference-version frontmatter`,
      evidence: playbookPath,
      howToFix: `Start the playbook with YAML frontmatter containing ${expectedReferenceVersionLine}.`,
    };
  }

  // Missing H2 content becomes undefined and triggers the user-facing ordering repair.
  const firstLevelTwoHeading = playbookContent.match(/^##\s+(.+?)\s*$/mu)?.[1];
  // A browser-evidence request, for example, needs Availability Check before workflow steps.
  if (firstLevelTwoHeading !== "Availability Check") {
    return {
      check: "Instruction file skill-docs pointer",
      message: `${playbookPath} must use Availability Check as its first H2 heading`,
      evidence: playbookPath,
      howToFix:
        "Move `## Availability Check` before every other H2 and state the runnable probe or documentary load condition.",
    };
  }
  return null;
}

/**
 * Validate registered playbook shape and README discovery for audit users.
 * @param auditContext - selected-project audit state; unreadable playbook text is treated as empty and invalid
 * @returns first user-facing repair, or null when every registered playbook is usable
 */
export function standalonePlaybookContractFailure(
  auditContext: AuditContext,
): AuditFailure | null {
  const playbookReadmePath = ".goat-flow/skill-docs/playbooks/README.md";
  // An unreadable index is empty so the user receives the missing-row repair.
  const playbookReadme = auditContext.fs.readFile(playbookReadmePath) ?? "";

  // Every registered playbook needs a valid body and a discoverable README row.
  for (const playbookPath of STANDALONE_PLAYBOOK_FILES) {
    const playbookShapeFailure = standalonePlaybookShapeFailure(
      auditContext,
      playbookPath,
    );
    // Shape failures are more actionable than the downstream discovery result.
    if (playbookShapeFailure !== null) return playbookShapeFailure;
    // A path without a filename falls back to its full value so the user still gets a repair.
    const playbookFilename = playbookPath.split("/").at(-1) ?? playbookPath;
    // The README row is how a future agent discovers this registered playbook.
    if (!playbookReadme.includes(`](./${playbookFilename})`)) {
      return {
        check: "Instruction file skill-docs pointer",
        message: `${playbookReadmePath} has no Available playbooks row for ${playbookFilename}`,
        evidence: playbookReadmePath,
        howToFix: `Add a table row linking to ./${playbookFilename} with its load condition and capability.`,
      };
    }
  }
  return null;
}
