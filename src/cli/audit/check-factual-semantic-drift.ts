/**
 * Semantic-drift scanners for high-trust cold-path docs (code-map, glossary, ADRs). Where the
 * factual-claims checks compare exact strings, these read live source - classifier state unions,
 * server constants, the manifest - and flag the curated docs that quietly fall out of sync with it.
 * Runs only under `--check-content` because reading source on every audit would be too expensive.
 */
import { AUDIT_VERSION } from "../constants.js";
import { loadManifest } from "../manifest/manifest.js";
import type { AuditContext, ContentFinding } from "./types.js";

/** Extract the current classify-state union members from source. */
function readProjectStates(ctx: AuditContext): string[] {
  const source = ctx.fs.readFile("src/cli/classify-state.ts");
  if (source === null) return [];
  const block = source.match(/type ProjectStateName =([\s\S]*?);/);
  if (!block || block[1] === undefined) return [];
  return Array.from(block[1].matchAll(/"([^"]+)"/g)).flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

/** Extract the MAX_SESSIONS constant from the terminal server source. */
function readMaxSessions(ctx: AuditContext): number | null {
  const source = ctx.fs.readFile("src/cli/server/terminal.ts");
  if (source === null) return null;
  const match = source.match(/MAX_SESSIONS\s*=\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

/** Extract the default terminal idle timeout from the terminal server source. */
function readDefaultIdleTimeout(ctx: AuditContext): number | null {
  const source = ctx.fs.readFile("src/cli/server/terminal.ts");
  if (source === null) return null;
  const match = source.match(/DEFAULT_IDLE_TIMEOUT_MINUTES\s*=\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

/** Normalise display names for docs that list runner names. */
function docAgentNames(): string[] {
  const docLabels: Record<string, string> = {
    claude: "Claude",
    codex: "Codex",
    antigravity: "Antigravity",
    copilot: "Copilot",
  };
  return Object.entries(loadManifest().agents).map(
    ([id, agent]) => docLabels[id] ?? agent.name.replace(/\s+(Code|CLI)$/u, ""),
  );
}

/** Drift: code-map.md claims classify-state values don't match source. */
function driftCodeMapClassifyState(
  codeMap: string,
  ctx: AuditContext,
): ContentFinding[] {
  const states = readProjectStates(ctx);
  const line = codeMap
    .split(/\r?\n/)
    .find((entry) => entry.includes("classify-state.ts"));
  const docStates = line?.match(/\(([^)]+)\)/)?.[1]?.split("/") ?? [];
  if (states.length === 0 || docStates.length === 0) return [];
  if (docStates.join("|") === states.join("|")) return [];
  return [
    {
      severity: "warning",
      rule: "code-map-state-drift",
      path: ".goat-flow/code-map.md",
      message: `Code map lists classify-state values as ${docStates.join("/")} but source exports ${states.join("/")}.`,
      suggestion:
        "Update the classify-state.ts summary in .goat-flow/code-map.md to match the live ProjectStateName union.",
    },
  ];
}

/** Extract comma-separated dashboard view names from the code-map views line with deterministic sorting. */
function readCodeMapDashboardViews(codeMap: string): string[] | null {
  const line = codeMap
    .split(/\r?\n/)
    .find((entry) => entry.includes("views/") && entry.includes("HTML view"));
  const raw = line?.match(/\(([^)]+)\)/)?.[1];
  if (raw === undefined) return null;
  return raw
    .split(",")
    .map((name) => name.trim().replace(/\.html$/u, ""))
    .filter(Boolean)
    .sort();
}

/** Read live dashboard view files with a stable manifest fallback for filesystem stubs. */
function readDashboardViewFiles(ctx: AuditContext): string[] {
  const files = ctx.fs.glob("src/dashboard/views/*.html");
  if (files.length === 0)
    return [...loadManifest().facts.dashboard_views.names];
  return files
    .map(
      (file) =>
        file
          .split("/")
          .at(-1)
          ?.replace(/\.html$/u, "") ?? "",
    )
    .filter(Boolean)
    .sort();
}

/** Drift: code-map.md dashboard view enumeration doesn't match live view files. */
function driftCodeMapDashboardViews(
  codeMap: string,
  ctx: AuditContext,
): ContentFinding[] {
  const claimed = readCodeMapDashboardViews(codeMap);
  const actual = readDashboardViewFiles(ctx);
  if (claimed !== null && claimed.join("|") === actual.join("|")) return [];

  return [
    {
      severity: "warning",
      rule: "code-map-dashboard-view-drift",
      path: ".goat-flow/code-map.md",
      message: `Code map lists dashboard views as ${claimed?.join(", ") ?? "none"}, but src/dashboard/views has ${actual.join(", ")}.`,
      suggestion:
        "Update the src/dashboard/views/ summary in .goat-flow/code-map.md to match the live .html view files.",
    },
  ];
}

/** Top-level committed playbooks, excluding README.md because it is the index; output is stable sorted. */
function readTopLevelSkillPlaybooks(ctx: AuditContext): string[] {
  return ctx.fs
    .listDir(".goat-flow/skill-docs/playbooks")
    .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
    .sort();
}

/** Drift: committed skill-playbook inventories omit live top-level playbooks. */
function driftSkillPlaybookInventory(
  path: ".goat-flow/architecture.md" | ".goat-flow/code-map.md",
  text: string,
  ctx: AuditContext,
): ContentFinding[] {
  const actual = readTopLevelSkillPlaybooks(ctx);
  if (actual.length === 0) return [];

  const missing = actual.filter((name) => !text.includes(name));
  if (missing.length === 0) return [];

  return [
    {
      severity: "warning",
      rule: "skill-playbook-inventory-drift",
      path,
      message: `${path} omits top-level skill playbook(s): ${missing.join(", ")}. Live playbooks are ${actual.join(", ")}.`,
      suggestion:
        "Update the committed skill-docs playbook inventory to include every top-level .goat-flow/skill-docs/playbooks/*.md playbook except README.md.",
    },
  ];
}

/** Drift: docs/dashboard.md session-cap claims don't match MAX_SESSIONS.
 *  Matches both the rail phrasing (`up to N`) and the hard-cap phrasing
 *  (`Maximum N concurrent sessions`). Every claim that disagrees with the live
 *  constant is reported separately so same-doc contradictions surface too. */
function driftDashboardSessions(
  dashboard: string,
  ctx: AuditContext,
): ContentFinding[] {
  const maxSessions = readMaxSessions(ctx);
  if (maxSessions === null) return [];

  const patterns: { regex: RegExp; label: string }[] = [
    { regex: /up to (\d+)/g, label: "rail is up to" },
    { regex: /Maximum (\d+) concurrent sessions?/g, label: "Maximum" },
  ];

  const findings: ContentFinding[] = [];
  const seen = new Set<string>();
  for (const { regex, label } of patterns) {
    for (const match of dashboard.matchAll(regex)) {
      const claimed = Number(match[1]);
      if (claimed === maxSessions) continue;
      const key = `${label}:${claimed}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        severity: "warning",
        rule: "dashboard-sessions-drift",
        path: "docs/dashboard.md",
        message: `Dashboard docs say ${label} ${claimed}, but terminal.ts uses ${maxSessions}.`,
        suggestion: `Update docs/dashboard.md to the live session cap (${maxSessions}).`,
      });
    }
  }
  return findings;
}

/** Drift contract: docs/dashboard.md view headings must match manifest dashboard views. */
function driftDashboardViewNames(dashboard: string): ContentFinding[] {
  const lines = dashboard.split(/\r?\n/);
  const start = lines.findIndex((line) => /^## Views\s*$/u.test(line));
  if (start === -1) return [];

  const claimed: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/u.test(line)) break;
    const heading = line.match(/^###\s+(.+?)\s*$/u);
    if (heading?.[1] === undefined) continue;
    claimed.push(
      heading[1].replace(/`/g, "").trim().toLowerCase().replace(/\s+/g, "-"),
    );
  }

  const actual = loadManifest().facts.dashboard_views.names;
  const claimedSorted = [...claimed].sort();
  if (claimedSorted.join("|") === actual.join("|")) return [];

  return [
    {
      severity: "warning",
      rule: "dashboard-view-name-drift",
      path: "docs/dashboard.md",
      message: `Dashboard docs list view headings as ${claimedSorted.join(", ")}, but manifest-backed views are ${actual.join(", ")}.`,
      suggestion:
        "Update docs/dashboard.md view headings to match workflow/manifest.json dashboard_views.",
    },
  ];
}

/** Drift: docs/dashboard.md idle-timeout claims don't match terminal defaults. */
function driftDashboardIdleTimeout(
  dashboard: string,
  ctx: AuditContext,
): ContentFinding[] {
  const defaultTimeout = readDefaultIdleTimeout(ctx);
  if (defaultTimeout === null) return [];

  const patterns: { regex: RegExp; factor: number }[] = [
    { regex: /(\d+)[-\s]?minute idle timeout/gi, factor: 1 },
    { regex: /(\d+)[-\s]?hour idle timeout/gi, factor: 60 },
  ];
  const findings: ContentFinding[] = [];
  const seen = new Set<string>();

  for (const { regex, factor } of patterns) {
    for (const match of dashboard.matchAll(regex)) {
      const claimedRaw = match[1];
      if (claimedRaw === undefined) continue;
      const claimedMinutes = Number(claimedRaw) * factor;
      if (claimedMinutes === defaultTimeout) continue;
      const phrase = match[0];
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      findings.push({
        severity: "warning",
        rule: "dashboard-idle-timeout-drift",
        path: "docs/dashboard.md",
        message: `Dashboard docs say "${phrase}" (${claimedMinutes} minutes), but terminal.ts defaults to ${defaultTimeout} minutes.`,
        suggestion: `Update docs/dashboard.md to the live idle timeout (${defaultTimeout} minutes).`,
      });
    }
  }

  return findings;
}

/** Drift: docs/dashboard.md runner list doesn't match manifest. */
function driftDashboardRunners(dashboard: string): ContentFinding[] {
  const runnerLine = dashboard.match(/- Supports (.+?) runners/);
  if (runnerLine?.[1] === undefined) return [];
  const actual = docAgentNames();
  const claimed = runnerLine[1]
    .split(/,\s*|\s+and\s+/u)
    .map((name) => name.trim().replace(/^and\s+/u, ""))
    .filter(Boolean);
  if (claimed.join("|") === actual.join("|")) return [];
  return [
    {
      severity: "warning",
      rule: "dashboard-runner-drift",
      path: "docs/dashboard.md",
      message: `Dashboard docs list runners as ${claimed.join(", ")}, but manifest-backed runners are ${actual.join(", ")}.`,
      suggestion:
        "Update docs/dashboard.md to match the current manifest-backed runner list.",
    },
  ];
}

/** Drift: docs/dashboard.md carries a stale release tag in current reference prose. */
function driftDashboardVersionReference(dashboard: string): ContentFinding[] {
  const runnerLine = dashboard.match(/- Supports .+? runners[^\n]*/u)?.[0];
  const version = runnerLine?.match(/\bin v(\d+\.\d+\.\d+)\b/u)?.[1];
  if (version === undefined || version === AUDIT_VERSION) return [];
  return [
    {
      severity: "warning",
      rule: "dashboard-version-reference-drift",
      path: "docs/dashboard.md",
      message: `Dashboard docs reference v${version}, but the current package version is v${AUDIT_VERSION}.`,
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
      "docs/skills.md still claims goat-review must read all files before commenting; the live skill uses diff-first review with explicit files-not-opened reporting.",
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
];

/** Drift: docs/skills.md contains stale contract phrases. */
function driftSkillsDoc(skillsDoc: string): ContentFinding[] {
  return SKILLS_DOC_STALE_PHRASES.filter((p) =>
    skillsDoc.includes(p.needle),
  ).map((phrase) => ({
    severity: "warning",
    rule: phrase.rule,
    path: "docs/skills.md",
    message: phrase.message,
  }));
}

/**
 * Drift: glossary.md contains agent-specific or stale canonical pointers.
 *
 * Returns an empty finding list when no stale phrase is present; stale prose
 * reports as content findings rather than treated as a parser error.
 * The caller supplies already-read text, so this helper performs no IO and has
 * no recover path beyond returning every matched stale phrase as a finding.
 */
function driftGlossary(glossary: string): ContentFinding[] {
  const findings: ContentFinding[] = [];
  if (glossary.includes("Claude Search Optimization")) {
    findings.push({
      severity: "warning",
      rule: "glossary-cso-drift",
      path: ".goat-flow/glossary.md",
      message:
        "Glossary still expands CSO as Claude Search Optimization instead of using agent-neutral wording.",
    });
  }
  if (
    /\|\s*Ceremony\s*\|.*CLAUDE\.md/u.test(glossary) ||
    /\|\s*Router Table\s*\|.*CLAUDE\.md/u.test(glossary)
  ) {
    findings.push({
      severity: "warning",
      rule: "glossary-canonical-file-drift",
      path: ".goat-flow/glossary.md",
      message:
        "Glossary still points core concepts through CLAUDE.md instead of an agent-neutral canon.",
    });
  }
  return findings;
}

/**
 * Drift: setup/01-system-overview.md oversells session logs as durable memory.
 *
 * Returns an empty finding list when neither retired phrase is present; matches
 * report warnings because setup prose is the source of future install behavior.
 * The caller supplies already-read text, so this helper performs no IO and has
 * no recover path beyond returning every matched stale phrase as a finding.
 */
function driftSetupOverview(setupOverview: string): ContentFinding[] {
  const findings: ContentFinding[] = [];
  if (setupOverview.includes("persistent memory across sessions")) {
    findings.push({
      severity: "warning",
      rule: "setup-memory-tier-drift",
      path: "workflow/setup/01-system-overview.md",
      message:
        "Setup overview still sells goat-flow as persistent memory across sessions even though session logs/tasks are local gitignored continuity only.",
    });
  }
  if (
    setupOverview.includes(
      "preserve any useful content in `.goat-flow/logs/sessions/`",
    )
  ) {
    findings.push({
      severity: "warning",
      rule: "setup-session-log-tier-drift",
      path: "workflow/setup/01-system-overview.md",
      message:
        "Setup overview still routes durable legacy content into session logs instead of lessons / footguns / decisions.",
    });
  }
  return findings;
}

/** Drift: ADR-020 still says Copilot accepted while manifest excludes it. */
function driftCopilotDecision(decisionText: string): ContentFinding[] {
  const hasCopilot = Object.prototype.hasOwnProperty.call(
    loadManifest().agents,
    "copilot",
  );
  const isAccepted = /\*\*Status:\*\*\s*Accepted/u.test(decisionText);

  if (isAccepted && !hasCopilot) {
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

  if (!isAccepted && hasCopilot) {
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

/** Drift: ADR-013 still carries pre-simplification implementation detail. */
function driftScannerRemovalDecision(decisionText: string): ContentFinding[] {
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
 * Targeted semantic drift checks for high-trust cold-path docs.
 *
 * Missing optional docs recover by being skipped, while readable docs are added
 * to the scanned count so audit output reflects the actual coverage.
 *
 * @param ctx - audit context; its readonly FS reads both the curated docs and the live source files
 *   (classify-state, terminal server, manifest) the docs are checked against
 * @returns the accumulated drift findings and the count of docs actually read, so callers can report
 *   coverage; an empty findings list means no drift was detected among the docs present on disk
 */
export function scanSemanticDrift(ctx: AuditContext): {
  findings: ContentFinding[];
  filesScanned: number;
} {
  const findings: ContentFinding[] = [];
  const scanned = new Set<string>();

  /** Read one doc and track that it was scanned. */
  const readAndTrack = (path: string): string | null => {
    const text = ctx.fs.readFile(path);
    if (text !== null) scanned.add(path);
    return text;
  };

  const codeMap = readAndTrack(".goat-flow/code-map.md");
  if (codeMap !== null) {
    findings.push(...driftCodeMapClassifyState(codeMap, ctx));
    findings.push(...driftCodeMapDashboardViews(codeMap, ctx));
    findings.push(
      ...driftSkillPlaybookInventory(".goat-flow/code-map.md", codeMap, ctx),
    );
  }

  const architecture = readAndTrack(".goat-flow/architecture.md");
  if (architecture !== null) {
    findings.push(
      ...driftSkillPlaybookInventory(
        ".goat-flow/architecture.md",
        architecture,
        ctx,
      ),
    );
  }

  const dashboard = readAndTrack("docs/dashboard.md");
  if (dashboard !== null) {
    findings.push(...driftDashboardSessions(dashboard, ctx));
    findings.push(...driftDashboardViewNames(dashboard));
    findings.push(...driftDashboardIdleTimeout(dashboard, ctx));
    findings.push(...driftDashboardRunners(dashboard));
    findings.push(...driftDashboardVersionReference(dashboard));
  }

  const skillsDoc = readAndTrack("docs/skills.md");
  if (skillsDoc !== null) findings.push(...driftSkillsDoc(skillsDoc));

  const glossary = readAndTrack(".goat-flow/glossary.md");
  if (glossary !== null) {
    findings.push(...driftGlossary(glossary));
  }

  const setupOverview = readAndTrack("workflow/setup/01-system-overview.md");
  if (setupOverview !== null)
    findings.push(...driftSetupOverview(setupOverview));

  const copilotDecision = readAndTrack(
    ".goat-flow/learning-loop/decisions/ADR-020-add-copilot-cli.md",
  );
  if (copilotDecision !== null)
    findings.push(...driftCopilotDecision(copilotDecision));

  const scannerRemovalDecision = readAndTrack(
    ".goat-flow/learning-loop/decisions/ADR-013-remove-scanner-system.md",
  );
  if (scannerRemovalDecision !== null)
    findings.push(...driftScannerRemovalDecision(scannerRemovalDecision));

  return { findings, filesScanned: scanned.size };
}
