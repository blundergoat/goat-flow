/**
 * Template-vs-installed drift detection for goat-flow skills (M04).
 *
 * Compares the canonical templates shipped in goat-flow against the
 * installed copies inside a consumer project (or the goat-flow repo
 * itself when run on its own root):
 *
 *   - Per-skill SKILL.md for every name in SKILL_NAMES:
 *       workflow/skills/<name>/SKILL.md  vs
 *       .claude/skills/<name>/SKILL.md
 *       .agents/skills/<name>/SKILL.md
 *   - Shared docs (template → installed in .goat-flow/skill-reference/):
 *       workflow/skills/reference/skill-preamble.md         vs .goat-flow/skill-reference/skill-preamble.md
 *       workflow/skills/reference/skill-conventions.md      vs .goat-flow/skill-reference/skill-conventions.md
 *       workflow/skills/reference/skill-quality-testing.md  vs .goat-flow/skill-reference/skill-quality-testing.md
 *   - Orphan directories under .claude/skills or .agents/skills whose
 *     name is not in SKILL_NAMES. Names that appear in manifest.stale_names
 *     are reported as deprecated instead of a plain orphan.
 *
 * Comparison is semantic: YAML frontmatter is parsed and compared
 * structurally (after stripping null/undefined leaves to avoid false
 * negatives on bare keys like `description:`), body content is
 * compared after trimEnd() + single trailing newline normalization.
 * This avoids false positives on key reorder or trailing whitespace.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { load } from "js-yaml";
import { isDeepStrictEqual } from "node:util";
import type { ReadonlyFS } from "../types.js";
import { SKILL_NAMES } from "../constants.js";
import { getTemplatePath, getProjectStructure } from "../paths.js";
import { getInstalledSkillRoots, getSkillFiles } from "../manifest/manifest.js";
import type { DriftFinding, DriftReport } from "./types.js";

/** Remove nullish values from nested data before comparing manifests. */
function stripNullish(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map(stripNullish).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = stripNullish(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

/** Parse YAML frontmatter and body text from a markdown file. */
export function parseMarkdownFrontmatter(raw: string): {
  frontmatter: unknown;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const parsedRaw = load(match[1] ?? "") ?? {};
  const cleaned = stripNullish(parsedRaw);
  return { frontmatter: cleaned ?? {}, body: match[2] ?? "" };
}

/** Normalize markdown body text before drift comparisons. */
function normalizeBody(body: string): string {
  return body.replace(/^\n+/, "").trimEnd() + "\n";
}

/** True if two skill-markdown strings are semantically equivalent. */
export function skillContentsEquivalent(
  expected: string,
  existing: string,
): boolean {
  const a = parseMarkdownFrontmatter(expected);
  const b = parseMarkdownFrontmatter(existing);
  if (!isDeepStrictEqual(a.frontmatter, b.frontmatter)) return false;
  return normalizeBody(a.body) === normalizeBody(b.body);
}

interface CheckDriftOptions {
  /** ReadonlyFS rooted at the project being audited (for installed-copy reads). */
  fs: ReadonlyFS;
  /** Absolute path to the project being audited. Present for parity with other audit options; not currently used for IO. */
  projectPath: string;
  /**
   * Absolute path whose layout mirrors goat-flow's own root (must contain
   * workflow/skills/...). Defaults to the goat-flow package root resolved
   * at runtime so consumer projects work out of the box.
   */
  templateRoot?: string;
}

interface SharedFileSpec {
  /** Relative to templateRoot. */
  template: string;
  /** Relative to projectPath. */
  installed: string;
}

const SHARED_FILES: SharedFileSpec[] = [
  {
    template: "workflow/skills/reference/skill-preamble.md",
    installed: ".goat-flow/skill-reference/skill-preamble.md",
  },
  {
    template: "workflow/skills/reference/skill-conventions.md",
    installed: ".goat-flow/skill-reference/skill-conventions.md",
  },
  {
    template: "workflow/skills/reference/skill-quality-testing.md",
    installed: ".goat-flow/skill-reference/skill-quality-testing.md",
  },
];

/** Read a workflow template file relative to the package root. */
function readTemplate(templateRoot: string, relative: string): string | null {
  const abs = resolvePath(templateRoot, relative);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
}

/** Read the configured list of deprecated skill names. */
function getStaleSkillNames(): Set<string> {
  const raw = getProjectStructure();
  const skills = raw.skills as { stale_names?: unknown } | undefined;
  const names = skills?.stale_names;
  return new Set(Array.isArray(names) ? (names as string[]) : []);
}

/** Compare installed skills against their workflow templates for drift. */
function compareSkills(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
): number {
  let checked = 0;
  const skillRoots = getInstalledSkillRoots();
  for (const name of SKILL_NAMES) {
    for (const relativeFile of getSkillFiles(name)) {
      const templateRel = `workflow/skills/${name}/${relativeFile}`;
      const template = readTemplate(templateRoot, templateRel);
      if (template === null) {
        findings.push({
          kind: "missing",
          path: templateRel,
          message: `${name}: manifest declares ${templateRel} but the workflow template is missing`,
        });
        continue;
      }

      for (const agentDir of skillRoots) {
        const installedRel = `${agentDir}/${name}/${relativeFile}`;
        checked++;
        if (!fs.exists(installedRel)) {
          findings.push({
            kind: "missing",
            path: installedRel,
            message: `${name}: template at ${templateRel} has no installed copy at ${installedRel}`,
          });
          continue;
        }
        const installed = fs.readFile(installedRel);
        if (installed === null) continue;
        if (!skillContentsEquivalent(template, installed)) {
          findings.push({
            kind: "content",
            path: installedRel,
            message: `${name}: template (${templateRel}) and installed copy (${installedRel}) differ`,
          });
        }
      }
    }
  }
  return checked;
}

/** Compare shared setup files against their workflow templates for drift. */
function compareSharedFiles(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
): number {
  let checked = 0;
  for (const spec of SHARED_FILES) {
    const template = readTemplate(templateRoot, spec.template);
    if (template === null) continue;
    checked++;
    if (!fs.exists(spec.installed)) {
      findings.push({
        kind: "missing",
        path: spec.installed,
        message: `${spec.template} has no installed copy at ${spec.installed}`,
      });
      continue;
    }
    const installed = fs.readFile(spec.installed);
    if (installed === null) continue;
    if (!skillContentsEquivalent(template, installed)) {
      findings.push({
        kind: "content",
        path: spec.installed,
        message: `${spec.template} and ${spec.installed} differ`,
      });
    }
  }
  return checked;
}

/** Find installed skill directories that are no longer canonical. */
function findOrphans(fs: ReadonlyFS, findings: DriftFinding[]): void {
  const canonical = new Set<string>(SKILL_NAMES);
  const stale = getStaleSkillNames();
  for (const agentDir of getInstalledSkillRoots()) {
    if (!fs.exists(agentDir)) continue;
    for (const entry of fs.listDir(agentDir)) {
      if (canonical.has(entry)) continue;
      const fullPath = `${agentDir}/${entry}`;
      if (stale.has(entry)) {
        findings.push({
          kind: "deprecated",
          path: fullPath,
          message: `deprecated skill still installed: ${entry} at ${fullPath}`,
        });
      } else {
        findings.push({
          kind: "orphan",
          path: fullPath,
          message: `orphan directory in ${agentDir}: ${entry} (not a canonical goat-flow skill)`,
        });
      }
    }
  }
}

/** Run all drift comparisons and return a consolidated report. */
export function checkDrift(options: CheckDriftOptions): DriftReport {
  const { fs } = options;
  const templateRoot = options.templateRoot ?? getTemplatePath("");
  const findings: DriftFinding[] = [];
  let checked = 0;
  checked += compareSkills(fs, templateRoot, findings);
  checked += compareSharedFiles(fs, templateRoot, findings);
  findOrphans(fs, findings);
  return {
    status: findings.length === 0 ? "pass" : "fail",
    findings,
    checked,
  };
}
