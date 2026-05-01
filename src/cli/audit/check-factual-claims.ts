/**
 * Factual-claim extraction for cold-path docs (M05 § 2).
 *
 * Catches the documented failure class from `.goat-flow/lessons/verification.md`
 * ("Structural audit passing hides cold-path content drift"): README/doc prose
 * that claims wrong skill counts, wrong check counts, or points at files that
 * no longer exist. All counts compared against the code constants that are the
 * single source of truth.
 *
 * Scope per milestone Assumption: `README.md`, `CONTRIBUTING.md`, `docs/*.md`,
 * `.goat-flow/architecture.md`, `.goat-flow/code-map.md`. Lesson and footgun
 * files legitimately discuss historical counts in prose - excluded.
 */
import type { AuditContext, ContentFinding } from "./types.js";
import type { CheckEvidence } from "./provenance-types.js";
import { AUDIT_VERSION, SKILL_NAMES } from "../constants.js";
import { SETUP_CHECKS } from "./check-goat-flow.js";
import { AGENT_CHECKS } from "./check-agent-setup.js";
import { HARNESS_CHECKS } from "./harness/index.js";
import { CONTEXT_CHECKS } from "./harness/check-context.js";
import { CONSTRAINTS_CHECKS } from "./harness/check-constraints.js";
import { VERIFICATION_CHECKS } from "./harness/check-verification.js";
import { RECOVERY_CHECKS } from "./harness/check-recovery.js";
import { FEEDBACK_LOOP_CHECKS } from "./harness/check-feedback-loop.js";
import { loadManifest } from "../manifest/manifest.js";

export const FACTUAL_CLAIMS_EVIDENCE: CheckEvidence = {
  source_type: "incident",
  source_urls: [],
  verified_on: "2026-04-17",
  normative_level: "MUST",
  evidence_paths: [
    ".goat-flow/lessons/verification.md",
    ".goat-flow/lessons/agent-behavior.md",
    ".goat-flow/lessons/agent-routing.md",
    ".goat-flow/lessons/agent-frontend.md",
  ],
};

const PROSE_TARGETS = [
  "README.md",
  "CONTRIBUTING.md",
  ".goat-flow/architecture.md",
  ".goat-flow/code-map.md",
];

const DOC_GLOB = "docs/*.md";

/** Files where a loose `N views`/`N presets` pattern is safe because the file
 *  is dashboard-specific. Outside these files, the pattern would false-positive
 *  on generic prose, so we keep it scoped. */
const DASHBOARD_SCOPED_TARGETS = ["docs/dashboard.md"];

/** Looser view/preset patterns that only run against DASHBOARD_SCOPED_TARGETS. */
const DASHBOARD_SCOPED_CHECKS: CountClaimCheck[] = [
  {
    rule: "dashboard-views-count-drift",
    pattern: /\b(\d+)\s+views?\b/gi,
    /** Return the live views count. */
    actual: () => loadManifest().facts.dashboard_views.count,
    label: "views",
  },
  {
    rule: "preset-count-drift",
    pattern: /\b(\d+)\s+presets?\b/gi,
    /** Return the live presets count. */
    actual: () => loadManifest().facts.presets.count,
    label: "presets",
  },
];

interface CountClaimCheck {
  rule: string;
  /** Regex with ONE capturing group for the claimed number. */
  pattern: RegExp;
  actual: () => number;
  label: string;
  /** When true, the check is applied inside fenced code blocks too (for
   *  catching sample-output drift like `Context: PASS (3/3)`). Default false. */
  scanFenced?: boolean;
  /** When set, only run this check on files whose path starts with one of
   *  these prefixes. Prevents generic patterns (e.g. "N skills") from
   *  false-positiving on consumer documentation unrelated to goat-flow. */
  scopedTo?: string[];
}

/** Per-concern count check: pattern has TWO capture groups - the concern name
 *  (used to look up the authoritative count) and the claimed number. Lets one
 *  entry cover all five concerns with a single regex instead of five. */
interface ConcernCountCheck {
  rule: string;
  /** Regex with TWO capturing groups: (1) concern label, (2) claimed number. */
  pattern: RegExp;
  /** Authoritative count for the captured concern label, or undefined when
   *  the label doesn't match a known concern (skips the finding). */
  actualFor: (concern: string) => number | undefined;
  label: string;
  /** When true, apply inside fenced code blocks (sample-output drift). */
  scanFenced?: boolean;
}

/** Live concern → check-count map, built from the harness check arrays that
 *  are the single source of truth. Keyed by a normalised concern label so doc
 *  phrasings like "Feedback Loop", "Feedback-Loop", and "feedback_loop" all
 *  resolve to the same count. */
const CONCERN_SIZES: Record<string, number> = {
  context: CONTEXT_CHECKS.length,
  constraints: CONSTRAINTS_CHECKS.length,
  verification: VERIFICATION_CHECKS.length,
  recovery: RECOVERY_CHECKS.length,
  feedback_loop: FEEDBACK_LOOP_CHECKS.length,
};

/** Normalise a doc-style concern label ("Feedback Loop", "Feedback-Loop",
 *  "feedback_loop") into the CONCERN_SIZES key form. */
function normaliseConcern(raw: string): string {
  return raw.toLowerCase().replace(/[\s-]+/g, "_");
}

/** Return the live check count for one concern label. */
function concernActualFor(raw: string): number | undefined {
  return CONCERN_SIZES[normaliseConcern(raw)];
}

/** Alternation fragment shared by concern patterns. Kept in sync with the five
 *  concern arrays imported above. */
const CONCERN_ALTERNATION =
  "Context|Constraints|Verification|Recovery|Feedback[\\s-]?Loop";

/** Per-concern drift patterns. All three patterns catch drift in current or
 *  M18-2-updated doc prose; the sample-output one scans fenced blocks because
 *  the `audit-and-quality.md` sample lives inside a code fence. */
const CONCERN_CHECKS: ConcernCountCheck[] = [
  {
    // Matches `**Context** (4)` bullet-list style (audit-and-quality.md:66)
    rule: "concern-count-drift-bullet",
    pattern: new RegExp(
      `\\*\\*(${CONCERN_ALTERNATION})\\*\\*\\s*\\((\\d+)\\)`,
      "g",
    ),
    actualFor: concernActualFor,
    label: "concern bullet count",
  },
  {
    // Matches `**Context checks (4):**` style (harness-audit.md once M18-2 lands)
    rule: "concern-count-drift-checks-label",
    pattern: new RegExp(
      `\\*\\*(${CONCERN_ALTERNATION})\\s+checks?\\s*\\((\\d+)\\)`,
      "gi",
    ),
    actualFor: concernActualFor,
    label: "concern checks count",
  },
  {
    // Matches `Context: PASS (3/3)` sample-output style inside fenced blocks
    rule: "concern-sample-output-drift",
    pattern: new RegExp(
      `\\b(${CONCERN_ALTERNATION}):\\s+(?:PASS|FAIL)\\s+\\(\\d+\\/(\\d+)\\)`,
      "g",
    ),
    actualFor: concernActualFor,
    label: "concern sample-output total",
    scanFenced: true,
  },
];

const COUNT_CHECKS: CountClaimCheck[] = [
  {
    rule: "skill-count-drift",
    pattern: /\b(\d+)\s+skills?\b/gi,
    /** Return the live skills count. */
    actual: () => SKILL_NAMES.length,
    label: "skills",
    scopedTo: [".goat-flow/", "ai-docs/"],
  },
  {
    rule: "agent-check-count-drift",
    pattern: /\b(\d+)\s+checks?\s+per\s+(?:configured\s+)?agent\b/gi,
    /** Return the live checks per configured agent count. */
    actual: () => AGENT_CHECKS.length,
    label: "checks per configured agent",
  },
  {
    rule: "harness-check-count-drift",
    pattern: /\b(\d+)\s+checks\s+across\s+\d+\s+concerns\b/gi,
    /** Return the live harness checks across 5 concerns count. */
    actual: () => HARNESS_CHECKS.length,
    label: "harness checks across 5 concerns",
  },
  {
    rule: "ai-harness-count-drift",
    pattern: /\b(\d+)\s+AI\s+[Hh]arness\b/g,
    /** Return the live AI harness installation checks count. */
    actual: () => HARNESS_CHECKS.length,
    label: "AI harness installation checks",
  },
  {
    rule: "harness-structural-count-drift",
    pattern: /\b(\d+)\s+structural\s+installation\s+checks?\b/gi,
    /** Return the live structural installation checks count. */
    actual: () => HARNESS_CHECKS.length,
    label: "structural installation checks",
  },
  {
    rule: "harness-scope-flag-count-drift",
    pattern: /AI\s+Harness\s+Completeness\s+scope\s*\((\d+)\s+checks?\b/gi,
    /** Return the live AI Harness Completeness scope count. */
    actual: () => HARNESS_CHECKS.length,
    label: "AI Harness Completeness scope",
  },
  {
    rule: "harness-checks-by-type-drift",
    pattern: /\bThe\s+(\d+)\s+checks?\s+by\s+type\b/gi,
    /** Return the live checks by type count. */
    actual: () => HARNESS_CHECKS.length,
    label: "checks by type",
  },
  {
    rule: "setup-check-count-drift",
    pattern: /\b(\d+)\s+checks\s+on\s+goat-flow-owned\s+surfaces\b/gi,
    /** Return the live setup checks on goat-flow-owned surfaces count. */
    actual: () => SETUP_CHECKS.length,
    label: "setup checks on goat-flow-owned surfaces",
  },
  {
    rule: "dashboard-views-count-drift",
    pattern: /\b(\d+)\s+dashboard\s+views?\b/gi,
    /** Return the live dashboard views count. */
    actual: () => loadManifest().facts.dashboard_views.count,
    label: "dashboard views",
  },
  {
    rule: "preset-count-drift",
    pattern: /\b(\d+)\s+workspace\s+presets?\b/gi,
    /** Return the live workspace presets count. */
    actual: () => loadManifest().facts.presets.count,
    label: "workspace presets",
  },
];

/** Check whether a line starts or ends a fenced code block. */
function isFenceLine(line: string): boolean {
  return /^\s*```/.test(line);
}

interface RemovedCommand {
  rule: string;
  pattern: RegExp;
  message: string;
}

/** CLI commands that were deliberately removed. Docs must not teach them.
 *  Unlike count/path checks, this scanner runs on fenced lines too, because
 *  the most common failure is copy-pasted command examples inside fences. */
const REMOVED_COMMANDS: RemovedCommand[] = [
  {
    rule: "removed-command-quality-capture",
    // Match the fully-qualified form (`goat-flow quality capture`) and the
    // backticked shorthand (`` `quality capture` ``) that docs/glossaries use.
    pattern: /\bgoat-flow\s+quality\s+capture\b|`quality\s+capture`/g,
    message:
      "`goat-flow quality capture` was removed in v1.2.0; agents now write reports directly to `.goat-flow/logs/quality/`.",
  },
];

/** Scan one doc file for references to removed CLI commands. Runs across every
 *  line including fenced code blocks - fenced command examples are the primary
 *  leak path this check exists to catch. */
export function scanRemovedCommands(
  path: string,
  text: string,
  removed: RemovedCommand[] = REMOVED_COMMANDS,
): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const cmd of removed) {
      const rx = new RegExp(cmd.pattern.source, cmd.pattern.flags);
      if (rx.test(line)) {
        findings.push({
          severity: "warning",
          rule: cmd.rule,
          path,
          line: i + 1,
          message: cmd.message,
        });
      }
    }
  }
  return findings;
}

/** Scan one doc file for numeric-count drift using the provided check set.
 *  By default, fenced code blocks are skipped (prose code samples should not
 *  be drift-matched). Individual checks can opt in via `scanFenced: true` to
 *  catch structural drift in sample-output blocks. */
export function scanCountClaims(
  path: string,
  text: string,
  checks: CountClaimCheck[] = COUNT_CHECKS,
): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const applicable = checks.filter(
    (c) => !c.scopedTo || c.scopedTo.some((p) => path.startsWith(p)),
  );
  const lines = text.split(/\r?\n/);
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    for (const check of applicable) {
      if (inCodeBlock && !check.scanFenced) continue;
      const rx = new RegExp(check.pattern.source, check.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = rx.exec(line)) !== null) {
        const claimed = Number(match[1]);
        const actual = check.actual();
        if (claimed !== actual) {
          findings.push({
            severity: "warning",
            rule: check.rule,
            path,
            line: i + 1,
            message: `Doc claims ${claimed} ${check.label}, code says ${actual}.`,
            suggestion: `Update "${match[0]}" to match the actual count (${actual}).`,
          });
        }
      }
    }
  }
  return findings;
}

/** Apply one concern-count check to one line; returns any drift findings.
 *  Extracted from `scanConcernCountClaims` to keep the outer loop under the
 *  eslint complexity cap. */
function matchConcernCheckOnLine(
  line: string,
  lineNum: number,
  path: string,
  check: ConcernCountCheck,
): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const rx = new RegExp(check.pattern.source, check.pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = rx.exec(line)) !== null) {
    const concernRaw = match[1];
    const claimedStr = match[2];
    if (concernRaw === undefined || claimedStr === undefined) continue;
    const actual = check.actualFor(concernRaw);
    if (actual === undefined) continue;
    const claimed = Number(claimedStr);
    if (claimed === actual) continue;
    findings.push({
      severity: "warning",
      rule: check.rule,
      path,
      line: lineNum,
      message: `${check.label}: doc says ${concernRaw} has ${claimed}, code says ${actual}.`,
      suggestion: `Update "${match[0]}" to match the ${concernRaw} concern's actual count (${actual}).`,
    });
  }
  return findings;
}

/** Scan one doc file for per-concern count drift. Each check's pattern must
 *  have two capture groups: (1) concern label, (2) claimed number. The
 *  authoritative count is looked up via `actualFor`. Fenced code blocks are
 *  skipped unless the check sets `scanFenced: true`. */
export function scanConcernCountClaims(
  path: string,
  text: string,
  checks: ConcernCountCheck[] = CONCERN_CHECKS,
): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const lines = text.split(/\r?\n/);
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    for (const check of checks) {
      if (inCodeBlock && !check.scanFenced) continue;
      findings.push(...matchConcernCheckOnLine(line, i + 1, path, check));
    }
  }
  return findings;
}

/** Extract backtick-wrapped repo-relative paths and flag ones that don't exist. */
export function scanPathReferences(
  path: string,
  text: string,
  ctx: AuditContext,
): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const lines = text.split(/\r?\n/);
  let inCodeBlock = false;
  // Backtick-wrapped paths that look repo-local.
  const rx = /`([^`\s]+)`/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    let match: RegExpExecArray | null;
    rx.lastIndex = 0;
    while ((match = rx.exec(line)) !== null) {
      const candidate = match[1] ?? "";
      if (!looksLikeRepoPath(candidate)) continue;
      const cleaned = candidate.replace(/[)\].,;:]+$/, ""); // trim trailing punctuation
      if (ctx.fs.exists(cleaned)) continue;
      findings.push({
        severity: "info",
        rule: "path-ref-unresolved",
        path,
        line: i + 1,
        message: `Referenced path \`${cleaned}\` does not exist in the project.`,
      });
    }
  }
  return findings;
}

const REPO_PATH_PREFIXES = [
  "src/",
  "workflow/",
  ".goat-flow/",
  "scripts/",
  "docs/",
  "test/",
  ".claude/",
  ".codex/",
  ".gemini/",
  ".agents/",
  ".github/",
];

/** Check whether a token looks like a repo-local file path. */
function looksLikeRepoPath(candidate: string): boolean {
  if (candidate.length < 3) return false;
  if (candidate.startsWith("http")) return false;
  // Glob patterns are not literal paths - skip them.
  if (candidate.includes("*") || candidate.includes("?")) return false;
  // Template placeholders are not literal on-disk paths.
  if (candidate.includes("{") || candidate.includes("}")) return false;
  if (candidate.includes("<") || candidate.includes(">")) return false;
  return REPO_PATH_PREFIXES.some((p) => candidate.startsWith(p));
}

/** Collect the files that factual-claim checks should scan. */
function collectTargets(ctx: AuditContext): string[] {
  const targets: string[] = [];
  for (const rel of PROSE_TARGETS) {
    if (ctx.fs.exists(rel)) targets.push(rel);
  }
  for (const rel of ctx.fs.glob(DOC_GLOB)) {
    targets.push(rel);
  }
  return targets;
}

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
    gemini: "Gemini",
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

/** Drift: docs/dashboard.md view headings don't match manifest dashboard views. */
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

/** Drift: glossary.md contains agent-specific or stale canonical pointers. */
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

/** Drift: setup/01-system-overview.md oversells session-logs as durable memory. */
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
function driftAdr020(adr020: string): ContentFinding[] {
  const hasCopilot = Object.prototype.hasOwnProperty.call(
    loadManifest().agents,
    "copilot",
  );
  const isAccepted = /\*\*Status:\*\*\s*Accepted/u.test(adr020);

  if (isAccepted && !hasCopilot) {
    return [
      {
        severity: "warning",
        rule: "adr020-copilot-drift",
        path: ".goat-flow/decisions/ADR-020-add-copilot-cli.md",
        message:
          "ADR-020 still says Copilot support is accepted while the manifest-backed runtime supports only claude/codex/gemini.",
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
        path: ".goat-flow/decisions/ADR-020-add-copilot-cli.md",
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
function driftAdr013(adr013: string): ContentFinding[] {
  if (
    !/v0\.9\/v1\.0/u.test(adr013) &&
    !/agent-setup-checks\.ts/u.test(adr013) &&
    !/17 build checks \(7 project setup \+ 10 per-agent/u.test(adr013)
  ) {
    return [];
  }
  return [
    {
      severity: "warning",
      rule: "adr013-stale-implementation-detail",
      path: ".goat-flow/decisions/ADR-013-remove-scanner-system.md",
      message:
        "ADR-013 still contains stale classifier states, file paths, or audit-count details from the pre-simplification implementation.",
      suggestion:
        "Refresh ADR-013 to describe the scanner removal decision without stale implementation-era counts and file names.",
    },
  ];
}

/** Targeted semantic drift checks for high-trust cold-path docs. */
function scanSemanticDrift(ctx: AuditContext): {
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
  if (codeMap !== null)
    findings.push(...driftCodeMapClassifyState(codeMap, ctx));

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
    findings.push(...scanRemovedCommands(".goat-flow/glossary.md", glossary));
  }

  const setupOverview = readAndTrack("workflow/setup/01-system-overview.md");
  if (setupOverview !== null)
    findings.push(...driftSetupOverview(setupOverview));

  const adr020 = readAndTrack(
    ".goat-flow/decisions/ADR-020-add-copilot-cli.md",
  );
  if (adr020 !== null) findings.push(...driftAdr020(adr020));

  const adr013 = readAndTrack(
    ".goat-flow/decisions/ADR-013-remove-scanner-system.md",
  );
  if (adr013 !== null) findings.push(...driftAdr013(adr013));

  return { findings, filesScanned: scanned.size };
}

/** Run factual-claim checks across the configured documentation targets. */
export function runFactualClaimChecks(ctx: AuditContext): {
  findings: ContentFinding[];
  filesScanned: number;
} {
  const findings: ContentFinding[] = [];
  let filesScanned = 0;
  for (const rel of collectTargets(ctx)) {
    const text = ctx.fs.readFile(rel);
    if (text === null) continue;
    filesScanned++;
    findings.push(...scanCountClaims(rel, text));
    findings.push(...scanConcernCountClaims(rel, text));
    findings.push(...scanPathReferences(rel, text, ctx));
    findings.push(...scanRemovedCommands(rel, text));
  }
  // Dashboard-specific loose patterns (safe only on dashboard docs).
  for (const rel of DASHBOARD_SCOPED_TARGETS) {
    if (!ctx.fs.exists(rel)) continue;
    const text = ctx.fs.readFile(rel);
    if (text === null) continue;
    findings.push(...scanCountClaims(rel, text, DASHBOARD_SCOPED_CHECKS));
  }
  const semantic = scanSemanticDrift(ctx);
  return {
    findings: [...findings, ...semantic.findings],
    filesScanned: filesScanned + semantic.filesScanned,
  };
}
