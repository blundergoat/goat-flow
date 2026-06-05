/**
 * Factual-claim extraction for cold-path docs.
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
import { SKILL_NAMES } from "../constants.js";
import { SETUP_CHECKS } from "./check-goat-flow.js";
import { AGENT_CHECKS } from "./check-agent-setup.js";
import { HARNESS_CHECKS } from "./harness/index.js";
import { CONTEXT_CHECKS } from "./harness/check-context.js";
import { CONSTRAINTS_CHECKS } from "./harness/check-constraints.js";
import { VERIFICATION_CHECKS } from "./harness/check-verification.js";
import { RECOVERY_CHECKS } from "./harness/check-recovery.js";
import { FEEDBACK_LOOP_CHECKS } from "./harness/check-feedback-loop.js";
import { loadManifest } from "../manifest/manifest.js";
import { scanSemanticDrift } from "./check-factual-semantic-drift.js";

const PROSE_TARGETS = [
  "README.md",
  "CONTRIBUTING.md",
  ".goat-flow/architecture.md",
  ".goat-flow/code-map.md",
];

const DOC_GLOB = "docs/*.md";
const GLOSSARY_TARGET = ".goat-flow/glossary.md";

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

/**
 * Numeric prose claim scanner.
 *
 * `pattern` must expose the claimed number as capture group 1; the live
 * `actual` callback supplies the authoritative count at scan time.
 */
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

/** Per-concern count-check schema; regex must capture concern label then claimed number. */
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
 *  updated doc prose; the sample-output one scans fenced blocks because
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
    // Matches `**Context checks (4):**` style from harness-audit.md prose.
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

/** Removed command pattern that should be reported anywhere it appears in docs. */
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

/**
 * Scan one doc file for references to removed CLI commands.
 *
 * Runs across every line including fenced code blocks because fenced command
 * examples are the primary leak path this check exists to catch.
 *
 * @param path Repo-relative source path used in findings.
 * @param text Markdown content to scan.
 * @param removed Removed command patterns to flag.
 * @returns Content findings for removed command references.
 */
function scanRemovedCommands(
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

/**
 * Scan one doc file for numeric-count drift using the provided check set.
 *
 * By default, fenced code blocks are skipped because prose code samples should
 * not be drift-matched. Individual checks can opt in via `scanFenced: true` to
 * catch structural drift in sample-output blocks.
 *
 * @param path Repo-relative source path used in findings.
 * @param text Markdown content to scan.
 * @param checks Numeric claim checks to apply.
 * @returns Content findings for count claims that disagree with live code.
 */
function scanCountClaims(
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

/**
 * Scan one doc file for per-concern count drift.
 *
 * Each check's pattern must have two capture groups: (1) concern label,
 * (2) claimed number. The authoritative count is looked up via `actualFor`.
 * Fenced code blocks are skipped unless the check sets `scanFenced: true`.
 *
 * @param path Repo-relative source path used in findings.
 * @param text Markdown content to scan.
 * @param checks Concern-count checks to apply.
 * @returns Content findings for concern counts that disagree with live code.
 */
function scanConcernCountClaims(
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

/**
 * Extract backtick-wrapped repo-relative paths and flag ones that do not exist.
 *
 * @param path Repo-relative source path used in findings.
 * @param text Markdown content to scan.
 * @param ctx Audit context used for target filesystem existence checks.
 * @returns Informational findings for unresolved repo-local path references.
 */
function scanPathReferences(
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
      if (INTENTIONAL_LOCAL_STATE_PATHS.has(cleaned)) continue;
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

const INTENTIONAL_LOCAL_STATE_PATHS = new Set([".goat-flow/project-id"]);

/** Lifetime/retention/limit phrases that should name the enforcing constant.
 *  When a doc claims "retained for 90 days" without anchoring the value to a
 *  code path, future edits to the constant drift past the doc silently
 *  (awslabs/cli-agent-orchestrator PR #245 P1-B: docs/memory.md claimed
 *  scope-keyed retention while cleanup_service.py keyed on memory_type). */
const LIFETIME_PHRASE_RE =
  /\b(?:retained for|expires after|expires in|TTL(?:\s+of)?|ceiling of|max(?:imum)? of|limit of)\s+(\d+)\s+(days?|hours?|minutes?|seconds?|chars?|characters?|entries|items|sessions?|lines?)/gi;

/** Evidence anchors that satisfy the lifetime-claim check: a backtick repo
 *  path, a (search: ...) anchor, or a (file: ...) anchor on the same line. */
const EVIDENCE_ANCHOR_RE =
  /`(?:src|workflow|scripts|\.goat-flow|\.github|test|docs|\.claude|\.codex|\.agents)\/[^`]+`|\(search:\s*["'][^"']+["']\)|\(file:\s*[^)]+\)/u;

/**
 * Scan one doc file for lifetime/retention claims lacking an enforcing-code anchor.
 *
 * Any line that claims a lifetime, expiry, TTL, ceiling, or limit MUST also
 * reference the code path that enforces the value. Without an anchor, future
 * edits to the constant drift past the doc and the divergence ships silently.
 * Fenced code blocks are excluded because sample output legitimately discusses
 * values without anchoring them.
 *
 * @param path Repo-relative source path used in findings.
 * @param text Markdown content to scan.
 * @returns Informational findings for lifetime claims without evidence anchors.
 */
function scanLifetimeClaimEvidence(
  path: string,
  text: string,
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
    if (inCodeBlock) continue;
    const rx = new RegExp(LIFETIME_PHRASE_RE.source, LIFETIME_PHRASE_RE.flags);
    let match: RegExpExecArray | null;
    while ((match = rx.exec(line)) !== null) {
      if (EVIDENCE_ANCHOR_RE.test(line)) continue;
      findings.push({
        severity: "info",
        rule: "lifetime-claim-evidence-missing",
        path,
        line: i + 1,
        message: `Lifetime claim "${match[0]}" has no enforcing-code anchor on this line.`,
        suggestion:
          'Add a backtick repo path (e.g. `src/cli/server/terminal.ts`) or `(search: "CONSTANT_NAME")` on the same line so future edits cannot silently drift.',
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

/**
 * Run factual-claim checks across the configured documentation targets.
 *
 * Missing or unreadable target docs recover by skipping that file; unresolved
 * claims are emitted as content findings so audit can report all drift at once.
 *
 * @param ctx Audit context with target filesystem access.
 * @returns Factual-claim findings and number of scanned files.
 */
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
    findings.push(...scanLifetimeClaimEvidence(rel, text));
  }
  const glossary = ctx.fs.readFile(GLOSSARY_TARGET);
  if (glossary !== null) {
    findings.push(...scanRemovedCommands(GLOSSARY_TARGET, glossary));
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
