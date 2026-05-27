/**
 * Snapshot-claim lint (M06b).
 *
 * Validates numeric claims inside release-frozen documents against the
 * matching `workflow/manifest-snapshots/vX.Y.Z.json` snapshot. Two surfaces:
 *
 * 1. `CHANGELOG.md` - parsed section-by-section via `## vX.Y.Z` headers; each
 *    section validated against its own snapshot (sections without a snapshot
 *    are skipped).
 * 2. `.goat-flow/scratchpad/release.md` - single-version draft release notes;
 *    version extracted from the `# GOAT Flow vX.Y.Z Release Notes` H1;
 *    validated against that version's snapshot.
 *
 * This stays in TypeScript so snapshot-claim checks share the audit fact model
 * and avoid a separate shell parser for release-note text.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getTemplatePath } from "../paths.js";
import type { AuditContext, ContentFinding } from "./types.js";

/** Snapshot shape: the `snapshot_facts` block inside a vX.Y.Z.json. */
interface SnapshotFacts {
  skills_total: number;
  skills_functional_count: number;
  checks_setup: number;
  checks_agent: number;
  checks_build: number;
  checks_harness: number;
  checks_total: number;
  dashboard_views_count: number;
  presets_count: number;
}

/** A single CHANGELOG section delimited by a `## vX.Y.Z` header. */
interface ChangelogSection {
  version: string;
  startLine: number;
  body: string;
}

/** One pattern-plus-field mapping for a CHANGELOG claim. */
interface SnapshotClaim {
  rule: string;
  pattern: RegExp;
  field: keyof SnapshotFacts;
  label: string;
}

const SNAPSHOT_CLAIMS: SnapshotClaim[] = [
  {
    rule: "changelog-skills-canonical",
    pattern: /\b(\d+)\s+canonical\s+skills?\b/gi,
    field: "skills_total",
    label: "canonical skills",
  },
  {
    rule: "changelog-skill-templates",
    pattern: /\b(\d+)\s+skill\s+templates?\b/gi,
    field: "skills_total",
    label: "skill templates",
  },
  {
    rule: "changelog-setup-checks",
    pattern: /\b(\d+)\s+project[-\s]wide\s+setup\s+checks?\b/gi,
    field: "checks_setup",
    label: "project-wide setup checks",
  },
  {
    rule: "changelog-agent-checks",
    pattern: /\b(\d+)\s+per-agent\s+checks?\b/gi,
    field: "checks_agent",
    label: "per-agent checks",
  },
  {
    rule: "changelog-harness-checks",
    pattern:
      /\b(\d+)\s+(?:AI\s+|advisory\s+)?harness(?:\s+completeness|\s+installation)?\s+checks?\b/gi,
    field: "checks_harness",
    label: "harness checks",
  },
  {
    rule: "changelog-build-checks",
    pattern: /\b(\d+)\s+build\s+checks?\b/gi,
    field: "checks_build",
    label: "build checks",
  },
  {
    rule: "changelog-dashboard-views",
    pattern: /\b(\d+)\s+(?:dashboard\s+)?views?\b/gi,
    field: "dashboard_views_count",
    label: "dashboard views",
  },
  {
    rule: "changelog-presets",
    pattern: /\b(\d+)\s+(?:workspace\s+)?presets?\b/gi,
    field: "presets_count",
    label: "presets",
  },
];

/**
 * Parse CHANGELOG.md into sections keyed by `## vX.Y.Z` headers.
 * Mutates only an in-memory accumulator because preserving section order keeps finding lines stable.
 *
 * @param text Full CHANGELOG markdown content.
 * @returns Versioned sections with body text and header line numbers.
 */
export function parseChangelogSections(text: string): ChangelogSection[] {
  const lines = text.split(/\r?\n/);
  const headerRe = /^##\s+v(\d+\.\d+\.\d+)(?:\b|\s|$)/;
  const sections: ChangelogSection[] = [];
  let current: { version: string; startLine: number; body: string[] } | null =
    null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const headerMatch = headerRe.exec(line);
    const captured = headerMatch?.[1];
    if (captured) {
      if (current) {
        sections.push({
          version: current.version,
          startLine: current.startLine,
          body: current.body.join("\n"),
        });
      }
      current = { version: captured, startLine: i + 1, body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) {
    sections.push({
      version: current.version,
      startLine: current.startLine,
      body: current.body.join("\n"),
    });
  }
  return sections;
}

/**
 * Load the snapshot facts for one release version.
 * Swallows missing or malformed snapshot files and reports them as null so old release sections can be skipped.
 *
 * @param version Semver version without the leading `v`.
 * @returns Snapshot facts for that version, or null when the file cannot be used.
 */
export function loadSnapshotFacts(version: string): SnapshotFacts | null {
  const path = getTemplatePath(
    join("workflow", "manifest-snapshots", `v${version}.json`),
  );
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as {
      snapshot_facts?: SnapshotFacts;
    };
    return raw.snapshot_facts ?? null;
  } catch {
    return null;
  }
}

/** Check whether a line starts or ends a fenced code block. */
function isFenceLine(line: string): boolean {
  return /^\s*```/.test(line);
}

/**
 * Scan one CHANGELOG section body against its matching snapshot.
 *
 * @param section Parsed CHANGELOG section or whole-file release notes wrapper.
 * @param snapshot Frozen facts for the section version.
 * @param path Display path used in content findings.
 * @returns Content findings for numeric claims that disagree with the snapshot.
 */
export function scanSectionAgainstSnapshot(
  section: ChangelogSection,
  snapshot: SnapshotFacts,
  path: string,
): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const lines = section.body.split(/\r?\n/);
  const label =
    section.startLine === 0
      ? `${path} (v${section.version})`
      : `CHANGELOG v${section.version} section`;
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    for (const claim of SNAPSHOT_CLAIMS) {
      const rx = new RegExp(claim.pattern.source, claim.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = rx.exec(line)) !== null) {
        const claimed = Number(match[1]);
        const actual = snapshot[claim.field];
        if (claimed !== actual) {
          findings.push({
            severity: "warning",
            rule: claim.rule,
            path,
            // startLine is the `## vX.Y.Z` header line (1-indexed) for CHANGELOG
            // sections, or 0 for whole-file release.md scans. `i` is the offset
            // into the body. +1 to skip the header itself / reach 1-indexed.
            line: section.startLine + i + 1,
            message: `${label} claims ${claimed} ${claim.label}; v${section.version} snapshot records ${actual}.`,
            suggestion: `Update "${match[0]}" to match the snapshot value (${actual}), or capture a new snapshot if the facts legitimately changed for this release.`,
          });
        }
      }
    }
  }
  return findings;
}

/**
 * Extract the version from a `# GOAT Flow vX.Y.Z Release Notes` H1.
 * Reads only markdown text and returns null when no release-note header is present.
 *
 * @param text Release notes markdown.
 * @returns Semver version without the leading `v`, or null when absent.
 */
export function extractReleaseVersion(text: string): string | null {
  const versionMatch = /^#\s+(?:GOAT\s+Flow\s+)?v(\d+\.\d+\.\d+)\b/im.exec(
    text,
  );
  return versionMatch ? (versionMatch[1] ?? null) : null;
}

/** Scan a whole-document release notes file against its snapshot. */
function scanWholeFileAgainstSnapshot(
  text: string,
  snapshot: SnapshotFacts,
  path: string,
  version: string,
): ContentFinding[] {
  // Reuse section scan by wrapping the whole file as one section starting at line 1.
  return scanSectionAgainstSnapshot(
    { version, startLine: 0, body: text },
    snapshot,
    path,
  );
}

/**
 * Scan release-note surfaces against available manifest snapshots.
 * Reports mismatched numeric claims as content findings and skips missing inputs because historical
 * release text can exist before a matching snapshot catalog entry.
 *
 * @param ctx Audit context whose filesystem is rooted at the target project.
 * @returns Findings plus the number of release-note files that were actually scanned.
 */
export function runSnapshotClaimChecks(ctx: AuditContext): {
  findings: ContentFinding[];
  filesScanned: number;
} {
  const findings: ContentFinding[] = [];
  let filesScanned = 0;

  // 1. CHANGELOG.md - section-by-section.
  const changelogRel = "CHANGELOG.md";
  if (ctx.fs.exists(changelogRel)) {
    const text = ctx.fs.readFile(changelogRel);
    if (text !== null) {
      filesScanned++;
      for (const section of parseChangelogSections(text)) {
        const snapshot = loadSnapshotFacts(section.version);
        if (!snapshot) continue;
        findings.push(
          ...scanSectionAgainstSnapshot(section, snapshot, changelogRel),
        );
      }
    }
  }

  // 2. .goat-flow/scratchpad/release.md - whole-file, version from H1.
  const releaseRel = ".goat-flow/scratchpad/release.md";
  if (ctx.fs.exists(releaseRel)) {
    const text = ctx.fs.readFile(releaseRel);
    if (text !== null) {
      filesScanned++;
      const version = extractReleaseVersion(text);
      if (version) {
        const snapshot = loadSnapshotFacts(version);
        if (snapshot) {
          findings.push(
            ...scanWholeFileAgainstSnapshot(
              text,
              snapshot,
              releaseRel,
              version,
            ),
          );
        }
      }
    }
  }

  return { findings, filesScanned };
}
