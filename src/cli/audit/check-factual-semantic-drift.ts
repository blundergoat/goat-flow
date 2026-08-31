/**
 * Semantic-drift scanners for high-trust cold-path docs (code-map, glossary, ADRs).
 * Where the factual-claims checks compare exact strings, these read live source - classifier state unions, server constants, the manifest - and flag
 * the curated docs that quietly fall out of sync with it.
 *
 * Runs only under `--check-content` because reading source on every audit would be too expensive.
 */
import { AUDIT_VERSION } from "../constants.js";
import { loadManifest } from "../manifest/manifest.js";
import type { AuditContext, ContentFinding } from "./types.js";

/**
 * Read user-visible project state names from the classifier source.
 * Use when code-map guidance must match the states audit and setup can report.
 *
 * @param auditContext - selected-project files; a missing classifier means this audit cannot compare states
 * @returns classifier union members in source order, or an empty list when the source or union is unavailable
 */
function readProjectStates(auditContext: AuditContext): string[] {
  const classifierSource = auditContext.fs.readFile(
    "src/cli/classify-state.ts",
  );
  // A consumer project may not ship goat-flow source, so missing classifier text suppresses this source-only comparison.
  if (classifierSource === null) return [];
  const projectStateUnion = classifierSource.match(
    /type ProjectStateName =([\s\S]*?);/,
  );
  // An unreadable union provides no reliable state choices to compare with the user's code map.
  if (projectStateUnion?.[1] === undefined) return [];
  // A malformed regex capture is ignored because it cannot name a state users would see.
  return Array.from(projectStateUnion[1].matchAll(/"([^"]+)"/g)).flatMap(
    (stateMatch) => (stateMatch[1] === undefined ? [] : [stateMatch[1]]),
  );
}

/**
 * Read the session cap users experience in the dashboard terminal.
 * Use when content audit checks a documented concurrent-session limit.
 *
 * @param auditContext - selected-project files; missing server source means the live cap is unavailable
 * @returns the configured session cap, or null when source or the constant cannot be read
 */
function readMaxSessions(auditContext: AuditContext): number | null {
  const terminalSource = auditContext.fs.readFile("src/cli/server/terminal.ts");
  // Installed consumer projects can omit framework source, so no source means no trustworthy session-cap comparison.
  if (terminalSource === null) return null;
  const sessionLimitMatch = terminalSource.match(/MAX_SESSIONS\s*=\s*(\d+)/);
  // A missing constant means no live number exists for a safe user-facing comparison.
  return sessionLimitMatch ? Number(sessionLimitMatch[1]) : null;
}

/**
 * Read the idle timeout users experience in a dashboard terminal session.
 * Use when content audit checks timeout guidance against the live default.
 *
 * @param auditContext - selected-project files; missing server source means the live timeout is unavailable
 * @returns timeout minutes, or null when source or the constant cannot be read
 */
function readDefaultIdleTimeout(auditContext: AuditContext): number | null {
  const terminalSource = auditContext.fs.readFile("src/cli/server/terminal.ts");
  // Without terminal source, the audit cannot tell a user that their documented timeout is stale.
  if (terminalSource === null) return null;
  const idleTimeoutMatch = terminalSource.match(
    /DEFAULT_IDLE_TIMEOUT_MINUTES\s*=\s*(\d+)/,
  );
  // A missing constant means no live duration exists for a safe user-facing comparison.
  return idleTimeoutMatch ? Number(idleTimeoutMatch[1]) : null;
}

/**
 * Build the short agent names users see in dashboard guidance.
 * Use when a prose runner inventory is compared with manifest-backed agents.
 *
 * @returns one display name per manifest agent; the list is never empty for a valid manifest
 */
function readDocumentAgentNames(): string[] {
  const documentationLabels: Record<string, string> = {
    claude: "Claude",
    codex: "Codex",
    antigravity: "Antigravity",
    copilot: "Copilot",
  };
  return Object.entries(loadManifest().agents).map(
    ([agentId, agent]) =>
      documentationLabels[agentId] ?? agent.name.replace(/\s+(Code|CLI)$/u, ""),
  );
}

/**
 * Report when the code map teaches project states that the classifier cannot return.
 * Use in content audit so contributors see the same state choices in docs and CLI behavior.
 *
 * @param codeMap - complete code-map text; empty text has no state claim
 * @param auditContext - selected-project source used as the state authority
 * @returns one warning for mismatched states, or an empty list when the claim matches or cannot be compared
 */
function driftCodeMapClassifyState(
  codeMap: string,
  auditContext: AuditContext,
): ContentFinding[] {
  const sourceStates = readProjectStates(auditContext);
  const stateSummaryLine = codeMap
    .split(/\r?\n/)
    .find((entry) => entry.includes("classify-state.ts"));
  // A missing summary line or parenthesized list becomes an empty claim that this optional check skips.
  const documentedStates =
    stateSummaryLine?.match(/\(([^)]+)\)/)?.[1]?.split("/") ?? [];
  // Missing source states or an absent code-map list gives the user no comparable claim.
  if (sourceStates.length === 0 || documentedStates.length === 0) return [];
  // Matching states already describe every choice the classifier can show.
  if (documentedStates.join("|") === sourceStates.join("|")) return [];
  return [
    {
      severity: "warning",
      rule: "code-map-state-drift",
      path: ".goat-flow/code-map.md",
      message: `Code map lists classify-state values as ${documentedStates.join("/")} but source exports ${sourceStates.join("/")}.`,
      suggestion:
        "Update the classify-state.ts summary in .goat-flow/code-map.md to match the live ProjectStateName union.",
    },
  ];
}

/**
 * Read the dashboard views explicitly listed in the code map.
 * Use when users need its navigation summary checked against shipped HTML views.
 * Invariant: returned names are extension-free and sorted for stable comparisons.
 *
 * @param codeMap - complete code-map text; empty text has no dashboard-view claim
 * @returns sorted view names without extensions, or null when no explicit inventory is present
 */
function readCodeMapDashboardViews(codeMap: string): string[] | null {
  const dashboardViewLine = codeMap
    .split(/\r?\n/)
    .find((entry) => entry.includes("views/") && entry.includes("HTML view"));
  const viewInventoryText = dashboardViewLine?.match(/\(([^)]+)\)/)?.[1];
  // Without a parenthesized view list, the code map makes no explicit navigation promise.
  if (viewInventoryText === undefined) return null;
  return viewInventoryText
    .split(",")
    .map((name) => name.trim().replace(/\.html$/u, ""))
    .filter(Boolean)
    .sort();
}

/** Read selected-project dashboard view names without substituting framework facts. */
function readDashboardViewFiles(auditContext: AuditContext): string[] {
  const dashboardViewFiles = auditContext.fs.glob("src/dashboard/views/*.html");
  // A malformed path contributes an empty name, which filtering removes before users see the comparison.
  return dashboardViewFiles
    .map(
      (viewFile) =>
        viewFile
          .split("/")
          .at(-1)
          ?.replace(/\.html$/u, "") ?? "",
    )
    .filter(Boolean)
    .sort();
}

/**
 * Report when the code map lists dashboard views that users cannot open, or omits shipped views.
 * Use in content audit to keep contributor navigation guidance aligned with the UI.
 *
 * @param codeMap - complete code-map text; missing inventory is reported as none
 * @param auditContext - selected-project files used as the only view authority
 * @returns one warning for a mismatch, or an empty list when documented and shipped views match
 */
function driftCodeMapDashboardViews(
  codeMap: string,
  auditContext: AuditContext,
): ContentFinding[] {
  const documentedViewNames = readCodeMapDashboardViews(codeMap);
  const shippedViewNames = readDashboardViewFiles(auditContext);
  // No source and no explicit claim are both absence, while an explicit inventory must match target files exactly.
  if (
    (documentedViewNames === null && shippedViewNames.length === 0) ||
    (documentedViewNames !== null &&
      documentedViewNames.join("|") === shippedViewNames.join("|"))
  ) {
    return [];
  }

  return [
    {
      severity: "warning",
      rule: "code-map-dashboard-view-drift",
      path: ".goat-flow/code-map.md",
      message:
        `Code map lists dashboard views as ${documentedViewNames?.join(", ") ?? "none"}, ` +
        `but src/dashboard/views has ${shippedViewNames.join(", ")}.`,
      suggestion:
        "Update the src/dashboard/views/ summary in .goat-flow/code-map.md to match the live .html view files.",
    },
  ];
}

/**
 * Read the top-level playbooks agents can open for a user's task, excluding the index.
 * Use when committed orientation docs promise a complete playbook inventory.
 * Invariant: returned Markdown filenames are sorted and never include README.md.
 *
 * @param auditContext - selected-project filesystem; a missing playbook directory yields an empty list
 * @returns sorted Markdown filenames, or an empty list when no top-level playbooks are installed
 */
function readTopLevelSkillPlaybooks(auditContext: AuditContext): string[] {
  return auditContext.fs
    .listDir(".goat-flow/skill-docs/playbooks")
    .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
    .sort();
}

/** Orientation documents whose established grammar can make a complete playbook claim. */
type PlaybookInventoryDocumentPath =
  ".goat-flow/architecture.md" | ".goat-flow/code-map.md";

/** Normalize one documented playbook name to the installed filename shape. */
function normalizeDocumentedPlaybookName(name: string): string | null {
  const trimmedName = name.trim().replace(/`/gu, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.md)?$/u.test(trimmedName)) {
    return null;
  }
  return trimmedName.endsWith(".md") ? trimmedName : `${trimmedName}.md`;
}

/**
 * Read the code map's comma-separated `playbooks/ = ...` inventory, when present.
 * Invariant: returns normalized Markdown filenames only for a list-shaped declaration.
 */
function readCodeMapPlaybookInventory(codeMap: string): string[] | null {
  const inventoryLine = codeMap
    .split(/\r?\n/u)
    .find((line) => /[├└]──\s+playbooks\/\s*=\s*\S/u.test(line));
  const inventoryText = inventoryLine?.split("=").slice(1).join("=").trim();
  if (inventoryText === undefined || inventoryText.length === 0) return null;
  const playbookNames = inventoryText
    .split(",")
    .map(normalizeDocumentedPlaybookName)
    .filter((name): name is string => name !== null);
  return playbookNames.length === 0 ? null : [...new Set(playbookNames)].sort();
}

/**
 * Read the architecture row that explicitly enumerates every standalone playbook.
 * Invariant: an index pointer without the colon-led filename list returns null.
 */
function readArchitecturePlaybookInventory(
  architecture: string,
): string[] | null {
  const inventoryLine = architecture
    .split(/\r?\n/u)
    .find(
      (line) =>
        line.includes("standalone playbooks indexed by") &&
        line.includes("playbooks/README.md`:"),
    );
  const inventoryText = inventoryLine?.split(":").slice(1).join(":");
  if (inventoryText === undefined) return null;
  const playbookNames = Array.from(
    inventoryText.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)*\.md)`/gu),
    (match) => match[1],
  ).filter((name): name is string => name !== undefined);
  return playbookNames.length === 0 ? null : [...new Set(playbookNames)].sort();
}

/** Select the document-specific grammar instead of treating every mention as exhaustive. */
function readExplicitPlaybookInventory(
  path: PlaybookInventoryDocumentPath,
  text: string,
): string[] | null {
  return path === ".goat-flow/code-map.md"
    ? readCodeMapPlaybookInventory(text)
    : readArchitecturePlaybookInventory(text);
}

/**
 * Report top-level playbooks that differ from a committed user-facing inventory.
 * Use when architecture or code-map prose claims to enumerate every available playbook.
 *
 * @param path - orientation document path shown in the warning
 * @param text - complete document text; empty text omits every installed playbook
 * @param auditContext - selected-project files used to read installed playbooks
 * @returns one warning listing missing or stale names, or an empty list when the inventory is exact
 */
function driftSkillPlaybookInventory(
  path: PlaybookInventoryDocumentPath,
  text: string,
  auditContext: AuditContext,
): ContentFinding[] {
  const documentedPlaybookNames = readExplicitPlaybookInventory(path, text);
  // A pointer or incidental filename is useful orientation prose, not a promise to enumerate every playbook.
  if (documentedPlaybookNames === null) return [];
  const installedPlaybookNames = readTopLevelSkillPlaybooks(auditContext);
  // No installed playbooks means the document cannot hide a user-facing workflow.
  if (installedPlaybookNames.length === 0) return [];

  const missingPlaybookNames = installedPlaybookNames.filter(
    (playbookName) => !documentedPlaybookNames.includes(playbookName),
  );
  const stalePlaybookNames = documentedPlaybookNames.filter(
    (playbookName) => !installedPlaybookNames.includes(playbookName),
  );
  // An explicit inventory is current only when both sets contain the same names.
  if (missingPlaybookNames.length === 0 && stalePlaybookNames.length === 0) {
    return [];
  }

  const inventoryDriftDescriptions = [
    ...(missingPlaybookNames.length === 0
      ? []
      : [
          `omits top-level skill playbook(s): ${missingPlaybookNames.join(", ")}`,
        ]),
    ...(stalePlaybookNames.length === 0
      ? []
      : [
          `lists removed top-level skill playbook(s): ${stalePlaybookNames.join(", ")}`,
        ]),
  ];

  return [
    {
      severity: "warning",
      rule: "skill-playbook-inventory-drift",
      path,
      message: `${path} ${inventoryDriftDescriptions.join("; ")}. Live playbooks are ${installedPlaybookNames.join(", ")}.`,
      // Missing-only drift keeps its established recovery text; stale names require the caller to reconcile both set directions.
      suggestion:
        stalePlaybookNames.length === 0
          ? "Update the committed skill-docs playbook inventory to include every top-level " +
            ".goat-flow/skill-docs/playbooks/*.md playbook except README.md."
          : "Make the committed skill-docs playbook inventory exactly match the top-level " +
            ".goat-flow/skill-docs/playbooks/*.md playbooks except README.md.",
    },
  ];
}

/** Curated orientation documents that make explicit user-facing skill inventory claims. */
type SkillInventoryDocumentPath =
  | ".goat-flow/architecture.md"
  | ".goat-flow/code-map.md"
  | ".goat-flow/glossary.md";

/** A document either names each invokable skill or advertises only the total users can expect. */
type ExplicitSkillInventory =
  | {
      kind: "names";
      skillNames: string[];
      skillTotal?: number;
      specializedSkillTotal?: number;
    }
  | { kind: "specialized-total"; skillTotal: number }
  | { kind: "total"; skillTotal: number };

type NamedSkillInventory = Extract<ExplicitSkillInventory, { kind: "names" }>;

type GlossarySkillCountClaim =
  | { skillTotal: number; specializedSkillTotal?: number }
  | { skillTotal?: undefined; specializedSkillTotal: number };

/**
 * Read skill file rows from the code map's explicit workflow/skills subtree.
 * Returns null when the document makes no tree-shaped skill inventory claim.
 *
 * @param codeMap - complete code-map text; empty text has no explicit skill tree
 * @returns named skill inventory, or null when users are not shown an exhaustive skill tree
 */
function readCodeMapSkillInventory(
  codeMap: string,
): ExplicitSkillInventory | null {
  const codeMapLines = codeMap.split(/\r?\n/u);
  const skillTreeLineIndex = codeMapLines.findIndex((line) =>
    /[├└]──\s+skills\/\s+=.*\bskill templates\b/u.test(line),
  );

  // A code map without a skill-template tree makes no inventory promise to the user.
  if (skillTreeLineIndex === -1) return null;
  const skillTreeLine = codeMapLines[skillTreeLineIndex] ?? "";
  const skillTreeBranchColumn = skillTreeLine.search(/[├└]──/u);
  const skillSubtreeLines: string[] = [];
  for (const line of codeMapLines.slice(skillTreeLineIndex + 1)) {
    const branchColumn = line.search(/[├└]──/u);
    // The next row at the declaration's depth (or above it) belongs to a sibling subtree.
    if (branchColumn >= 0 && branchColumn <= skillTreeBranchColumn) break;
    skillSubtreeLines.push(line);
  }
  // For example, an `agent-notes/` row is ignored because users cannot invoke it without a `SKILL.md` row.
  const skillNames = skillSubtreeLines.flatMap((line) => {
    const skillRow = line.match(
      /^[\s│]*[├└]──\s+([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/SKILL\.md\b/u,
    );
    // Rows without a captured SKILL.md name describe folders or prose, not invokable user choices.
    return skillRow?.[1] === undefined ? [] : [skillRow[1]];
  });
  return { kind: "names", skillNames: [...new Set(skillNames)] };
}

/** Read one numeric inventory phrase without assigning meaning to its label. */
function readAdvertisedSkillCount(
  skillDefinition: string,
  pattern: RegExp,
): number | undefined {
  const advertisedCount = skillDefinition.match(pattern)?.[1];
  return advertisedCount === undefined ? undefined : Number(advertisedCount);
}

/** Resolve the accepted glossary count phrases into one explicit claim. */
function readGlossarySkillCountClaim(
  skillDefinition: string,
): GlossarySkillCountClaim | null {
  const skillTotal = readAdvertisedSkillCount(
    skillDefinition,
    /\b(\d+)\s+total\b/u,
  );
  const specializedSkillTotal =
    readAdvertisedSkillCount(skillDefinition, /\b(\d+)\s+specialized\b/u) ??
    readAdvertisedSkillCount(skillDefinition, /\b(\d+)\s+functional\b/u);
  if (skillTotal !== undefined) {
    return specializedSkillTotal === undefined
      ? { skillTotal }
      : { skillTotal, specializedSkillTotal };
  }
  return specializedSkillTotal === undefined ? null : { specializedSkillTotal };
}

/** Attach optional count claims to the names the glossary explicitly lists. */
function namedGlossarySkillInventory(
  skillNames: string[],
  countClaim: GlossarySkillCountClaim,
): NamedSkillInventory {
  const inventory: NamedSkillInventory = {
    kind: "names",
    skillNames: [...new Set(skillNames)],
  };
  if (countClaim.skillTotal !== undefined) {
    inventory.skillTotal = countClaim.skillTotal;
  }
  if (countClaim.specializedSkillTotal !== undefined) {
    inventory.specializedSkillTotal = countClaim.specializedSkillTotal;
  }
  return inventory;
}

/** Preserve whether a count-only glossary claim covers every skill or only specialized skills. */
function countOnlyGlossarySkillInventory(
  countClaim: GlossarySkillCountClaim,
): ExplicitSkillInventory {
  if (countClaim.skillTotal !== undefined) {
    return { kind: "total", skillTotal: countClaim.skillTotal };
  }
  return {
    kind: "specialized-total",
    skillTotal: countClaim.specializedSkillTotal,
  };
}

/**
 * Read invokable names from the glossary's explicit Skill row.
 * Returns null when the row defines the term without claiming a numbered inventory.
 *
 * @param glossary - complete glossary text; empty text has no Skill row
 * @returns named skill inventory, or null when the Skill definition is absent or non-exhaustive
 */
function readGlossarySkillInventory(
  glossary: string,
): ExplicitSkillInventory | null {
  const skillRow = glossary
    .split(/\r?\n/u)
    .find((line) => /^\|\s*Skill\s*\|/u.test(line));

  // A missing Skill row means this document makes no inventory claim for the audit to enforce.
  if (skillRow === undefined) return null;
  const skillDefinition = skillRow.split("|")[2]?.trim();
  if (skillDefinition === undefined) return null;
  const countClaim = readGlossarySkillCountClaim(skillDefinition);
  // A plain definition without a stated count is useful prose, not an exhaustive user-facing list.
  if (countClaim === null) return null;
  const skillNames = Array.from(
    skillDefinition.matchAll(/\bgoat(?:-[a-z0-9]+)*\b/gu),
    (match) => match[0],
  ).filter((skillName) => skillName !== "goat-flow");
  // A count-only definition is complete without inventing names the document does not claim to list.
  return skillNames.length === 0
    ? countOnlyGlossarySkillInventory(countClaim)
    : namedGlossarySkillInventory(skillNames, countClaim);
}

/**
 * Read the architecture table's advertised skill-template total.
 * Returns null when the document does not make a numeric inventory claim.
 *
 * @param architecture - complete architecture text; empty text has no template-count claim
 * @returns count-only inventory, or null when users are not shown a numeric total
 */
function readArchitectureSkillInventory(
  architecture: string,
): ExplicitSkillInventory | null {
  const skillTemplateRow = architecture
    .split(/\r?\n/u)
    .find((line) => /^\|\s*Skill templates\s*\|/u.test(line));

  // Without the owned table row, architecture makes no explicit skill-template claim.
  if (skillTemplateRow === undefined) return null;
  const advertisedTotal = skillTemplateRow.match(
    /\b(\d+)\s+goat-flow skill templates\b/u,
  )?.[1];

  // A row without a number describes placement only, so it cannot drift from the manifest total.
  if (advertisedTotal === undefined) return null;
  return { kind: "total", skillTotal: Number(advertisedTotal) };
}

/**
 * Select the parser owned by each document instead of guessing one prose grammar for every user-facing inventory.
 * Use when code-map, glossary, and architecture express the same user choice in different formats.
 *
 * @param path - curated orientation document whose format selects the parser
 * @param documentText - complete document text; empty text produces no explicit claim
 * @returns the document's named or count-only claim, or null when no exhaustive claim is present
 */
function readExplicitSkillInventory(
  path: SkillInventoryDocumentPath,
  documentText: string,
): ExplicitSkillInventory | null {
  // Each path has a deliberately narrow grammar matching what users actually read in that document.
  switch (path) {
    case ".goat-flow/code-map.md":
      return readCodeMapSkillInventory(documentText);
    case ".goat-flow/glossary.md":
      return readGlossarySkillInventory(documentText);
    case ".goat-flow/architecture.md":
      return readArchitectureSkillInventory(documentText);
  }
}

/** Compare one specialized-only count with manifest names other than the `goat` dispatcher. */
function findSpecializedSkillTotalDrift(
  path: SkillInventoryDocumentPath,
  advertisedSkillTotal: number,
  expectedSkillNames: ReadonlyArray<string>,
  suggestion: string,
): ContentFinding[] {
  const expectedSpecializedSkillNames = expectedSkillNames.filter(
    (skillName) => skillName !== "goat",
  );
  if (advertisedSkillTotal === expectedSpecializedSkillNames.length) return [];
  return [
    {
      severity: "warning",
      rule: "skill-inventory-drift",
      path,
      message:
        `${path} advertises ${advertisedSkillTotal} specialized skill(s), but the manifest ` +
        `declares ${expectedSpecializedSkillNames.length} non-dispatcher skill(s): ${expectedSpecializedSkillNames.join(", ")}.`,
      suggestion,
    },
  ];
}

/** Compare one all-skill count with the complete manifest inventory. */
function findTotalSkillInventoryDrift(
  path: SkillInventoryDocumentPath,
  advertisedSkillTotal: number,
  expectedSkillNames: ReadonlyArray<string>,
  suggestion: string,
): ContentFinding[] {
  if (advertisedSkillTotal === expectedSkillNames.length) return [];
  return [
    {
      severity: "warning",
      rule: "skill-inventory-drift",
      path,
      message:
        `${path} advertises ${advertisedSkillTotal} skill template(s), but workflow/manifest.json ` +
        `declares ${expectedSkillNames.length}: ${expectedSkillNames.join(", ")}.`,
      suggestion,
    },
  ];
}

/** Compare a named document inventory and each count it explicitly advertises. */
function findNamedSkillInventoryDrift(
  path: SkillInventoryDocumentPath,
  explicitInventory: NamedSkillInventory,
  expectedSkillNames: ReadonlyArray<string>,
  suggestion: string,
): ContentFinding[] {
  const expectedSpecializedSkillNames = expectedSkillNames.filter(
    (skillName) => skillName !== "goat",
  );
  const claimedSkillNames = new Set(explicitInventory.skillNames);
  const expectedSkillNameSet = new Set(expectedSkillNames);
  const missingSkillNames = expectedSkillNames.filter(
    (skillName) => !claimedSkillNames.has(skillName),
  );
  const unexpectedSkillNames = explicitInventory.skillNames.filter(
    (skillName) => !expectedSkillNameSet.has(skillName),
  );
  const mismatchDescriptions: string[] = [];

  // A glossary can name every skill while still advertising the wrong total, so validate both claims independently.
  if (
    explicitInventory.skillTotal !== undefined &&
    explicitInventory.skillTotal !== expectedSkillNames.length
  ) {
    mismatchDescriptions.push(
      `advertises ${explicitInventory.skillTotal} skill(s), but the manifest declares ${expectedSkillNames.length}.`,
    );
  }
  if (
    explicitInventory.specializedSkillTotal !== undefined &&
    explicitInventory.specializedSkillTotal !==
      expectedSpecializedSkillNames.length
  ) {
    mismatchDescriptions.push(
      `advertises ${explicitInventory.specializedSkillTotal} specialized skill(s), but the manifest declares ${expectedSpecializedSkillNames.length} non-dispatcher skill(s).`,
    );
  }
  // Missing names identify invokable workflows a user would otherwise never discover in this document.
  if (missingSkillNames.length > 0) {
    mismatchDescriptions.push(
      `omits manifest-canonical skill(s): ${missingSkillNames.join(", ")}.`,
    );
  }
  // Unexpected names identify retired or invented workflows that the user cannot invoke from the manifest.
  if (unexpectedSkillNames.length > 0) {
    mismatchDescriptions.push(
      `lists non-canonical skill(s): ${unexpectedSkillNames.join(", ")}.`,
    );
  }
  // Matching names and any advertised total give users the same inventory as the manifest.
  if (mismatchDescriptions.length === 0) return [];
  return [
    {
      severity: "warning",
      rule: "skill-inventory-drift",
      path,
      message: `${path} ${mismatchDescriptions.join(" ")}`,
      suggestion,
    },
  ];
}

/**
 * Compare one document's explicit skill claim with the manifest-backed skills users can invoke.
 * Empty canonical input or a document without an inventory claim produces no warning.
 *
 * @param path - curated document whose explicit inventory is shown to the user
 * @param documentText - complete document text; empty text makes no inventory claim
 * @param canonicalSkillNames - manifest-backed invokable names; empty input suppresses findings because no authority is available
 * @returns one actionable warning for a mismatched explicit claim, or an empty list when the claim is current or absent
 */
export function findSkillInventoryDrift(
  path: SkillInventoryDocumentPath,
  documentText: string,
  canonicalSkillNames: ReadonlyArray<string>,
): ContentFinding[] {
  const expectedSkillNames = [
    ...new Set(canonicalSkillNames.filter((skillName) => skillName.length > 0)),
  ];

  // Without canonical names, the audit cannot safely tell a user that their document is stale.
  if (expectedSkillNames.length === 0) return [];
  const explicitInventory = readExplicitSkillInventory(path, documentText);

  // Documents that do not promise a complete inventory stay concise and are not forced into boilerplate.
  if (explicitInventory === null) return [];
  const suggestion =
    "Update the document's explicit skill inventory to match workflow/manifest.json skills.canonical.";
  switch (explicitInventory.kind) {
    case "specialized-total":
      return findSpecializedSkillTotalDrift(
        path,
        explicitInventory.skillTotal,
        expectedSkillNames,
        suggestion,
      );
    case "total":
      return findTotalSkillInventoryDrift(
        path,
        explicitInventory.skillTotal,
        expectedSkillNames,
        suggestion,
      );
    case "names":
      return findNamedSkillInventoryDrift(
        path,
        explicitInventory,
        expectedSkillNames,
        suggestion,
      );
  }
}

/**
 * Catch session-cap numbers in the dashboard docs that no longer match the live limit a user would actually hit.
 * It reports each disagreeing claim separately, so two contradictory sentences in one document both surface instead of one masking the other.
 *
 * @param dashboard - complete dashboard guide; empty text contains no session claim
 * @param auditContext - selected-project source; a missing terminal constant suppresses this comparison
 * @returns one warning per distinct stale claim, or an empty list when claims match or the live limit is unavailable
 */
function driftDashboardSessions(
  dashboard: string,
  auditContext: AuditContext,
): ContentFinding[] {
  const sessionLimit = readMaxSessions(auditContext);
  // Without a live session cap, the audit cannot tell a dashboard user that a number is stale.
  if (sessionLimit === null) return [];

  const sessionClaimPatterns: { regex: RegExp; label: string }[] = [
    { regex: /up to (\d+)/g, label: "rail is up to" },
    { regex: /Maximum (\d+) concurrent sessions?/g, label: "Maximum" },
  ];

  const sessionFindings: ContentFinding[] = [];
  const seenSessionClaims = new Set<string>();
  // Each supported phrase reflects wording users currently see in the dashboard guide.
  for (const { regex, label } of sessionClaimPatterns) {
    // One guide can repeat or contradict a session limit, so inspect every matching sentence.
    for (const claimMatch of dashboard.matchAll(regex)) {
      const claimedSessionLimit = Number(claimMatch[1]);
      // A matching number already describes the limit users will encounter.
      if (claimedSessionLimit === sessionLimit) continue;
      const claimKey = `${label}:${claimedSessionLimit}`;
      // Repeated wording should produce one repair instruction instead of UI noise.
      if (seenSessionClaims.has(claimKey)) continue;
      seenSessionClaims.add(claimKey);
      sessionFindings.push({
        severity: "warning",
        rule: "dashboard-sessions-drift",
        path: "docs/dashboard.md",
        message: `Dashboard docs say ${label} ${claimedSessionLimit}, but terminal.ts uses ${sessionLimit}.`,
        suggestion: `Update docs/dashboard.md to the live session cap (${sessionLimit}).`,
      });
    }
  }
  return sessionFindings;
}

/**
 * Compare dashboard guide headings with the views users can open from the manifest.
 * Use when content audit checks that UI navigation guidance is complete and current.
 * Invariant: headings are normalized and sorted before comparison, so document order does not create drift.
 *
 * @param dashboard - complete dashboard guide; empty text has no Views section
 * @returns one warning for missing or unexpected headings, or an empty list when no section exists or all headings match
 */
function driftDashboardViewNames(dashboard: string): ContentFinding[] {
  const dashboardLines = dashboard.split(/\r?\n/);
  const viewsHeadingIndex = dashboardLines.findIndex((line) =>
    /^## Views\s*$/u.test(line),
  );
  // Without a Views section, the guide makes no explicit navigation inventory claim.
  if (viewsHeadingIndex === -1) return [];

  const documentedViewNames: string[] = [];
  // Read only third-level headings inside Views so later guide sections cannot become false UI entries.
  for (const line of dashboardLines.slice(viewsHeadingIndex + 1)) {
    // The next second-level heading ends the user-facing Views inventory.
    if (/^##\s+/u.test(line)) break;
    const viewHeading = line.match(/^###\s+(.+?)\s*$/u);
    // Ordinary prose and blank lines do not represent dashboard views users can open.
    if (viewHeading?.[1] === undefined) continue;
    documentedViewNames.push(
      viewHeading[1]
        .replace(/`/g, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-"),
    );
  }

  const shippedViewNames = loadManifest().facts.dashboard_views.names;
  const sortedDocumentedViewNames = [...documentedViewNames].sort();
  // Matching headings already guide users to every manifest-backed view.
  if (sortedDocumentedViewNames.join("|") === shippedViewNames.join("|"))
    return [];

  return [
    {
      severity: "warning",
      rule: "dashboard-view-name-drift",
      path: "docs/dashboard.md",
      message:
        `Dashboard docs list view headings as ${sortedDocumentedViewNames.join(", ")}, ` +
        `but manifest-backed views are ${shippedViewNames.join(", ")}.`,
      suggestion:
        "Update docs/dashboard.md view headings to match workflow/manifest.json dashboard_views.",
    },
  ];
}

/**
 * Catch idle-timeout numbers in the dashboard docs that no longer match the terminal default.
 * It reports each stale claim as a finding; an unreadable default yields no findings rather than a false accusation.
 *
 * @param dashboard - complete dashboard guide; empty text contains no timeout claim
 * @param auditContext - selected-project source; a missing terminal default suppresses this comparison
 * @returns one warning per distinct stale phrase, or an empty list when claims match or the default is unavailable
 */
function driftDashboardIdleTimeout(
  dashboard: string,
  auditContext: AuditContext,
): ContentFinding[] {
  const defaultTimeoutMinutes = readDefaultIdleTimeout(auditContext);
  // Without a live timeout, the audit cannot tell a dashboard user that their guidance is stale.
  if (defaultTimeoutMinutes === null) return [];

  const timeoutClaimPatterns: {
    regex: RegExp;
    minutesPerUnit: number;
  }[] = [
    { regex: /(\d+)[-\s]?minute idle timeout/gi, minutesPerUnit: 1 },
    { regex: /(\d+)[-\s]?hour idle timeout/gi, minutesPerUnit: 60 },
  ];
  const timeoutFindings: ContentFinding[] = [];
  const seenTimeoutPhrases = new Set<string>();

  // Both minute and hour wording appear in user guidance, so normalize each supported form.
  for (const { regex, minutesPerUnit } of timeoutClaimPatterns) {
    // Inspect every timeout phrase because one guide can contain contradictory values.
    for (const timeoutMatch of dashboard.matchAll(regex)) {
      const claimedTimeoutText = timeoutMatch[1];
      // A malformed capture cannot be converted into a trustworthy UI timeout warning.
      if (claimedTimeoutText === undefined) continue;
      const claimedTimeoutMinutes = Number(claimedTimeoutText) * minutesPerUnit;
      // A matching duration already tells users when their terminal will close.
      if (claimedTimeoutMinutes === defaultTimeoutMinutes) continue;
      const timeoutPhrase = timeoutMatch[0];
      // Repeated phrases should produce one repair instruction instead of duplicate UI noise.
      if (seenTimeoutPhrases.has(timeoutPhrase)) continue;
      seenTimeoutPhrases.add(timeoutPhrase);
      timeoutFindings.push({
        severity: "warning",
        rule: "dashboard-idle-timeout-drift",
        path: "docs/dashboard.md",
        message:
          `Dashboard docs say "${timeoutPhrase}" (${claimedTimeoutMinutes} minutes), ` +
          `but terminal.ts defaults to ${defaultTimeoutMinutes} minutes.`,
        suggestion: `Update docs/dashboard.md to the live idle timeout (${defaultTimeoutMinutes} minutes).`,
      });
    }
  }

  return timeoutFindings;
}

/**
 * Compare the dashboard guide's runner list with agents users can launch from the manifest.
 * Use when content audit checks runner availability shown in the UI.
 *
 * @param dashboard - complete dashboard guide; empty text has no runner claim
 * @returns one warning for a mismatched list, or an empty list when no list exists or all runners match
 */
function driftDashboardRunners(dashboard: string): ContentFinding[] {
  const runnerLine = dashboard.match(/- Supports (.+?) runners/);
  // A guide without a supported-runners sentence makes no explicit launch-availability claim.
  if (runnerLine?.[1] === undefined) return [];
  const supportedAgentNames = readDocumentAgentNames();
  const documentedAgentNames = runnerLine[1]
    .split(/,\s*|\s+and\s+/u)
    .map((name) => name.trim().replace(/^and\s+/u, ""))
    .filter(Boolean);
  // Matching names already tell users every agent they can launch.
  if (documentedAgentNames.join("|") === supportedAgentNames.join("|"))
    return [];
  return [
    {
      severity: "warning",
      rule: "dashboard-runner-drift",
      path: "docs/dashboard.md",
      message:
        `Dashboard docs list runners as ${documentedAgentNames.join(", ")}, ` +
        `but manifest-backed runners are ${supportedAgentNames.join(", ")}.`,
      suggestion:
        "Update docs/dashboard.md to match the current manifest-backed runner list.",
    },
  ];
}

/**
 * Report a release tag in dashboard guidance that no longer matches the CLI version users run.
 * Use when current reference prose embeds a version instead of remaining release-neutral.
 *
 * @param dashboard - complete dashboard guide; empty text has no version claim
 * @returns one warning for a stale release tag, or an empty list when absent or current
 */
function driftDashboardVersionReference(dashboard: string): ContentFinding[] {
  const runnerLine = dashboard.match(/- Supports .+? runners[^\n]*/u)?.[0];
  const documentedVersion = runnerLine?.match(/\bin v(\d+\.\d+\.\d+)\b/u)?.[1];
  // No embedded version or the current version gives users no stale release guidance.
  if (documentedVersion === undefined || documentedVersion === AUDIT_VERSION) {
    return [];
  }
  return [
    {
      severity: "warning",
      rule: "dashboard-version-reference-drift",
      path: "docs/dashboard.md",
      message: `Dashboard docs reference v${documentedVersion}, but the current package version is v${AUDIT_VERSION}.`,
      suggestion:
        "Remove version-specific wording from docs/dashboard.md or update it during the release bump.",
    },
  ];
}

/** Stale phrases to flag in docs/skills.md. */
const SKILLS_DOC_STALE_PHRASES: Array<{
  needle: string;
  rule: string;
  message: string;
}> = [
  {
    needle: "MUST read all files before commenting",
    rule: "skills-review-contract-drift",
    message:
      "docs/skills.md still claims goat-review must read all files before commenting; " +
      "the live skill uses diff-first review with explicit files-not-opened reporting.",
  },
  {
    needle: "10-category checklist",
    rule: "skills-security-contract-drift",
    message:
      "docs/skills.md still sells goat-security as a fixed 10-category checklist; the live skill uses repo-appropriate threat categories instead.",
  },
  {
    needle: "MUST rank findings by exploitability",
    rule: "skills-security-gate-drift",
    message:
      "docs/skills.md still claims exploitability ranking is a universal hard gate; the live skill only requires it in deeper threat-model work.",
  },
  {
    needle: "Announce: Routing to /goat-X",
    rule: "skills-dispatcher-control-flow-drift",
    message:
      "docs/skills.md still presents every dispatcher request as one inferred routing path; " +
      "the live skill bypasses classification for explicit skills and gathering/routing for simple facts.",
  },
  {
    needle: "Footgun matches\nRecent git",
    rule: "skills-dispatcher-retrieval-drift",
    message:
      "docs/skills.md still claims the dispatcher pre-reads footguns and recent git; " +
      "the live dispatcher delegates routed-skill retrieval and retrieves only for direct execution.",
  },
  {
    needle: "log lessons and footguns after completion",
    rule: "skills-learning-loop-write-drift",
    message:
      "docs/skills.md still requires unconditional learning-loop writes after completion; " +
      "the shared contract writes only after verification failures, course corrections, or explicit requests.",
  },
  {
    needle: 'I1 -->|"BLOCKING GATE"| I2',
    rule: "skills-debug-investigate-gate-drift",
    message:
      "docs/skills.md still blocks every goat-debug investigation at I1; " +
      "the live skill treats an explicit goal and scope as a checkpoint and continues.",
  },
  {
    needle: "Severity-Ordered Scan",
    rule: "skills-review-pass-drift",
    message:
      "docs/skills.md still teaches a single severity-ordered goat-review scan; " +
      "the live skill requires diff-only Blind Suspicion, then full-file Grounded Verification.",
  },
  {
    needle: "**Threat model mode:**",
    rule: "skills-security-mode-drift",
    message:
      "docs/skills.md still teaches obsolete goat-security modes; " +
      "the live skill selects Quick Scan or Full Assessment and treats compliance as an output posture.",
  },
  {
    needle: 'P2 -->|"BLOCKING GATE"| P3',
    rule: "skills-qa-phase-gate-drift",
    message:
      "docs/skills.md still makes goat-qa Phase 2 unconditionally blocking; " +
      "the live Standard path auto-releases explicit test-plan intent while Audit stays blocking.",
  },
];

/**
 * Report retired workflow promises that would send users through obsolete skill behavior.
 * Use when content audit checks current `docs/skills.md` against shipped skill contracts.
 *
 * @param skillsDoc - complete skills guide; empty text contains no stale phrase
 * @returns one warning per retired phrase, or an empty list when current guidance is clean
 */
function driftSkillsDoc(skillsDoc: string): ContentFinding[] {
  return SKILLS_DOC_STALE_PHRASES.filter((stalePhrase) =>
    skillsDoc.includes(stalePhrase.needle),
  ).map((stalePhrase) => ({
    severity: "warning",
    rule: stalePhrase.rule,
    path: "docs/skills.md",
    message: stalePhrase.message,
  }));
}

/**
 * Report glossary terms that point users to retired agent-specific concepts or files.
 * Use when content audit checks current definitions without treating ordinary prose as a parser error.
 *
 * @param glossary - complete glossary text; empty text contains no stale phrase
 * @returns one warning per matched stale phrase, or an empty list when definitions are current
 */
function driftGlossary(glossary: string): ContentFinding[] {
  const glossaryFindings: ContentFinding[] = [];
  // The old expansion tells users that a shared optimization practice belongs only to Claude.
  if (glossary.includes("Claude Search Optimization")) {
    glossaryFindings.push({
      severity: "warning",
      rule: "glossary-cso-drift",
      path: ".goat-flow/glossary.md",
      message:
        "Glossary still expands CSO as Claude Search Optimization instead of using agent-neutral wording.",
    });
  }
  // Agent-specific canonical pointers send Codex or Copilot users to the wrong instruction surface.
  if (
    /\|\s*Ceremony\s*\|.*CLAUDE\.md/u.test(glossary) ||
    /\|\s*Router Table\s*\|.*CLAUDE\.md/u.test(glossary)
  ) {
    glossaryFindings.push({
      severity: "warning",
      rule: "glossary-canonical-file-drift",
      path: ".goat-flow/glossary.md",
      message:
        "Glossary still points core concepts through CLAUDE.md instead of an agent-neutral canon.",
    });
  }
  return glossaryFindings;
}

/**
 * Report setup prose that promises durable memory where users receive local session state.
 * Use when content audit checks the guidance copied into future installations.
 *
 * @param setupOverview - complete setup overview; empty text contains no stale memory claim
 * @returns one warning per retired phrase, or an empty list when persistence guidance is current
 */
function driftSetupOverview(setupOverview: string): ContentFinding[] {
  const setupFindings: ContentFinding[] = [];
  // Calling session logs persistent memory can make users rely on files that are intentionally gitignored.
  if (setupOverview.includes("persistent memory across sessions")) {
    setupFindings.push({
      severity: "warning",
      rule: "setup-memory-tier-drift",
      path: "workflow/setup/01-system-overview.md",
      message:
        "Setup overview still sells goat-flow as persistent memory across sessions even though " +
        "session logs/tasks are local gitignored continuity only.",
    });
  }
  // Routing durable conclusions into session logs can make a user's learning disappear with local cleanup.
  if (
    setupOverview.includes(
      "preserve any useful content in `.goat-flow/logs/sessions/`",
    )
  ) {
    setupFindings.push({
      severity: "warning",
      rule: "setup-session-log-tier-drift",
      path: "workflow/setup/01-system-overview.md",
      message:
        "Setup overview still routes durable legacy content into session logs instead of lessons / footguns / decisions.",
    });
  }
  return setupFindings;
}

/**
 * Report disagreement between the Copilot decision and agents users can configure from the manifest.
 * Use when content audit checks whether accepted architecture matches shipped runtime support.
 *
 * @param decisionText - complete ADR text; empty text is treated as not accepted
 * @returns one warning for decision/runtime disagreement, or an empty list when both sides match
 */
function driftCopilotDecision(decisionText: string): ContentFinding[] {
  const manifestSupportsCopilot = Object.prototype.hasOwnProperty.call(
    loadManifest().agents,
    "copilot",
  );
  const decisionIsAccepted = /\*\*Status:\*\*\s*Accepted/u.test(decisionText);

  // An accepted decision without runtime support promises users a runner they cannot configure.
  if (decisionIsAccepted && !manifestSupportsCopilot) {
    return [
      {
        severity: "warning",
        rule: "adr020-copilot-drift",
        path: ".goat-flow/learning-loop/decisions/ADR-020-add-copilot-cli.md",
        message:
          "ADR-020 still says Copilot support is accepted while the manifest-backed runtime supports only claude/codex/antigravity.",
        suggestion:
          "Either defer/revert ADR-020 or implement manifest/type/runtime Copilot parity in the same change.",
      },
    ];
  }

  // Shipped runtime support with an unaccepted decision hides the architecture users actually receive.
  if (!decisionIsAccepted && manifestSupportsCopilot) {
    return [
      {
        severity: "warning",
        rule: "adr020-copilot-drift",
        path: ".goat-flow/learning-loop/decisions/ADR-020-add-copilot-cli.md",
        message:
          "ADR-020 no longer reflects the live manifest-backed runtime: Copilot is shipped in code but the ADR is not accepted.",
        suggestion:
          "Update ADR-020 to Accepted and align its decision text with the manifest-backed Copilot support.",
      },
    ];
  }

  return [];
}

/**
 * Report pre-simplification scanner details that no longer describe the audit users run.
 * Use when historical decision rationale still contains current-sounding paths, states, or counts.
 *
 * @param decisionText - complete ADR text; empty text contains no stale implementation detail
 * @returns one warning when any retired detail remains, or an empty list when the decision is durable
 */
function driftScannerRemovalDecision(decisionText: string): ContentFinding[] {
  // None of the retired details means the ADR now explains the decision without misleading current users.
  if (
    !/v0\.9\/v1\.0/u.test(decisionText) &&
    !/agent-setup-checks\.ts/u.test(decisionText) &&
    !/17 build checks \(7 project setup \+ 10 per-agent/u.test(decisionText)
  ) {
    return [];
  }
  return [
    {
      severity: "warning",
      rule: "adr013-stale-implementation-detail",
      path: ".goat-flow/learning-loop/decisions/ADR-013-remove-scanner-system.md",
      message:
        "ADR-013 still contains stale classifier states, file paths, or audit-count details from the pre-simplification implementation.",
      suggestion:
        "Refresh ADR-013 to describe the scanner removal decision without stale implementation-era counts and file names.",
    },
  ];
}

/**
 * Run targeted semantic checks over high-trust docs users rely on for orientation.
 * Missing optional docs are skipped, while every readable document contributes to the coverage count.
 *
 * @param auditContext - selected-project files and live source facts; missing optional docs are normal for consumer projects
 * @returns warnings plus the number of readable docs; an empty finding list means no checked document drifted
 * @throws when manifest validation fails or the filesystem adapter cannot read safely; audit stops instead of showing partial content results
 */
export function scanSemanticDrift(auditContext: AuditContext): {
  findings: ContentFinding[];
  filesScanned: number;
} {
  const findings: ContentFinding[] = [];
  const scannedDocumentPaths = new Set<string>();
  const canonicalSkillNames = loadManifest().skills.canonical;

  /**
   * Read one optional document and count it in the coverage users see.
   * Returns null when the selected project does not carry that document.
   *
   * @param path - project-relative document path; empty input reads no meaningful document
   * @returns complete document text, including empty text for a present blank file, or null when absent
   */
  const readAndTrackDocument = (path: string): string | null => {
    const documentText = auditContext.fs.readFile(path);
    // A readable document contributes once even when several semantic rules inspect it.
    if (documentText !== null) scannedDocumentPaths.add(path);
    return documentText;
  };

  const codeMap = readAndTrackDocument(".goat-flow/code-map.md");
  // When present, the code map must reflect the project states, dashboard views, playbooks, and skills users can discover.
  if (codeMap !== null) {
    findings.push(...driftCodeMapClassifyState(codeMap, auditContext));
    findings.push(...driftCodeMapDashboardViews(codeMap, auditContext));
    findings.push(
      ...driftSkillPlaybookInventory(
        ".goat-flow/code-map.md",
        codeMap,
        auditContext,
      ),
    );
    findings.push(
      ...findSkillInventoryDrift(
        ".goat-flow/code-map.md",
        codeMap,
        canonicalSkillNames,
      ),
    );
  }

  const architecture = readAndTrackDocument(".goat-flow/architecture.md");
  // When present, architecture must advertise the playbooks and total skill templates users receive.
  if (architecture !== null) {
    findings.push(
      ...driftSkillPlaybookInventory(
        ".goat-flow/architecture.md",
        architecture,
        auditContext,
      ),
    );
    findings.push(
      ...findSkillInventoryDrift(
        ".goat-flow/architecture.md",
        architecture,
        canonicalSkillNames,
      ),
    );
  }

  const dashboard = readAndTrackDocument("docs/dashboard.md");
  // When present, dashboard guidance must match session limits, views, runners, timeout behavior, and release version.
  if (dashboard !== null) {
    findings.push(...driftDashboardSessions(dashboard, auditContext));
    findings.push(...driftDashboardViewNames(dashboard));
    findings.push(...driftDashboardIdleTimeout(dashboard, auditContext));
    findings.push(...driftDashboardRunners(dashboard));
    findings.push(...driftDashboardVersionReference(dashboard));
  }

  const skillsDoc = readAndTrackDocument("docs/skills.md");
  // A present skills guide must not teach users retired workflow gates or modes.
  if (skillsDoc !== null) {
    findings.push(...driftSkillsDoc(skillsDoc));
  }

  const glossary = readAndTrackDocument(".goat-flow/glossary.md");
  // A present glossary must keep canonical pointers and explicit skill choices current for new users.
  if (glossary !== null) {
    findings.push(...driftGlossary(glossary));
    findings.push(
      ...findSkillInventoryDrift(
        ".goat-flow/glossary.md",
        glossary,
        canonicalSkillNames,
      ),
    );
  }

  const setupOverview = readAndTrackDocument(
    "workflow/setup/01-system-overview.md",
  );
  // A present setup overview must describe session logs as local continuity rather than durable memory.
  if (setupOverview !== null) {
    findings.push(...driftSetupOverview(setupOverview));
  }

  const copilotDecision = readAndTrackDocument(
    ".goat-flow/learning-loop/decisions/ADR-020-add-copilot-cli.md",
  );
  // A present Copilot decision must agree with the runner support users receive from the manifest.
  if (copilotDecision !== null) {
    findings.push(...driftCopilotDecision(copilotDecision));
  }

  const scannerRemovalDecision = readAndTrackDocument(
    ".goat-flow/learning-loop/decisions/ADR-013-remove-scanner-system.md",
  );
  // A present scanner-removal decision must not present retired implementation details as current user behavior.
  if (scannerRemovalDecision !== null) {
    findings.push(...driftScannerRemovalDecision(scannerRemovalDecision));
  }

  return { findings, filesScanned: scannedDocumentPaths.size };
}
