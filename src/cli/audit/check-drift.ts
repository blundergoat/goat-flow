/**
 * Canonical-template versus installed-artifact drift detection.
 * Use during setup audits so operators learn which skill, shared document,
 * hook, or agent mirror differs from the workflow package they intended to run.
 * Semantic Markdown comparison ignores harmless YAML order and trailing-space changes.
 */
import { load } from "js-yaml";
import { isDeepStrictEqual } from "node:util";
import type { ReadonlyFS } from "../types.js";
import { getSkillNames } from "../constants.js";
import { getTemplatePath } from "../paths.js";
import {
  getInstalledSkillRoots,
  getSkillFiles,
  loadManifest,
} from "../manifest/manifest.js";
import type { AgentId } from "../types.js";
import type { DriftFinding, DriftReport } from "./types.js";
import { checkArtifactIntegrity } from "./check-artifact-integrity.js";
import {
  readTemplateText,
  SHARED_ARTIFACT_MIRRORS,
} from "./artifact-templates.js";
import {
  compareHooks,
  compareManagedHookRegistrations,
  compareRegistryHookScripts,
  findDeprecatedHookFiles,
} from "./check-drift-hooks.js";
import { isRecord } from "./drift-values.js";

const USER_OWNED_SKILL_MARKER = "user-owned";

/** Remove nullish values from nested data before comparing manifests. */
function stripNullish(frontmatterValue: unknown): unknown {
  if (frontmatterValue === null || frontmatterValue === undefined) {
    return undefined;
  }
  if (Array.isArray(frontmatterValue)) {
    return frontmatterValue.map(stripNullish).filter((v) => v !== undefined);
  }
  if (typeof frontmatterValue === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      frontmatterValue as Record<string, unknown>,
    )) {
      const cleaned = stripNullish(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return frontmatterValue;
}

/**
 * Parse YAML frontmatter and body text from a markdown file.
 * The parser swallows malformed YAML into a sentinel object and never throws so
 * drift checks can report content mismatch without aborting the whole audit.
 * @param raw - Full markdown file contents, including optional YAML frontmatter.
 * @returns Parsed frontmatter plus body text after the closing marker.
 */
export function parseMarkdownFrontmatter(raw: string): {
  frontmatter: unknown;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const rawFrontmatter = match[1] ?? "";
  const body = match[2] ?? "";
  let parsedRaw: unknown;
  try {
    parsedRaw = load(rawFrontmatter) ?? {};
  } catch {
    return { frontmatter: { __parseError: rawFrontmatter }, body };
  }
  const cleaned = stripNullish(parsedRaw);
  return { frontmatter: cleaned ?? {}, body };
}

/** Normalize markdown body text before drift comparisons. */
function normalizeBody(body: string): string {
  return body.replace(/^\n+/, "").trimEnd() + "\n";
}

/**
 * Compare skill markdown using goat-flow's drift semantics.
 * Ignore harmless YAML order and trailing-space changes while preserving contract differences.
 * @param expected - Template markdown content from `workflow/skills`.
 * @param existing - Installed markdown content from an agent or skill-docs tree.
 * @returns True when normalized frontmatter and body content match.
 */
export function skillContentsEquivalent(
  expected: string,
  existing: string,
): boolean {
  const expectedMarkdown = parseMarkdownFrontmatter(expected);
  const existingMarkdown = parseMarkdownFrontmatter(existing);
  if (
    !isDeepStrictEqual(
      expectedMarkdown.frontmatter,
      existingMarkdown.frontmatter,
    )
  ) {
    return false;
  }
  return (
    normalizeBody(expectedMarkdown.body) ===
    normalizeBody(existingMarkdown.body)
  );
}

/**
 * Runtime sources for installed-project and canonical-package comparisons.
 * The separation prevents consumer audits from reading templates from the target.
 */
interface CheckDriftOptions {
  /** ReadonlyFS rooted at the project being audited (for installed-copy reads). */
  fs: ReadonlyFS;
  /** Audited project root retained for parity with other audit option contracts. */
  projectPath: string;
  /** Package/fixture root containing workflow sources; absent uses the shipped package. */
  templateRoot?: string;
  /** Selected agent whose installed mirrors should be compared; null or absent checks every installed agent. */
  agentFilter?: AgentId | null;
}

/** One readable peer instruction file plus its H2-keyed bodies. */
interface InstructionParityDocument {
  path: string;
  sections: Map<string, string>;
}

/** Read the configured list of deprecated skill names from the validated manifest. */
function getStaleSkillNames(): Set<string> {
  return new Set(loadManifest().facts.skills.stale_names);
}

/**
 * Return installed skill roots in the scope the user selected for audit.
 * Use an agent filter for one runtime; an empty result leaves missing-install reporting to agent checks.
 */
function selectedInstalledSkillRoots(
  fs: ReadonlyFS,
  agentFilter: AgentId | null | undefined,
): string[] {
  // A selected runtime should not make the user repair mirrors for agents they did not audit.
  const candidateSkillRoots = agentFilter
    ? [loadManifest().agents[agentFilter]?.skills_dir]
    : getInstalledSkillRoots();

  // Absent roots belong to setup checks; drift compares only copies the user actually installed.
  return candidateSkillRoots.filter(
    (skillRoot): skillRoot is string =>
      skillRoot !== undefined && fs.exists(skillRoot),
  );
}

/** Normalize the one canonical H2 whose visible heading carries a suffix. */
function normalizeInstructionHeading(heading: string): string {
  const trimmed = heading.trim().replace(/\s+#+$/u, "");
  return /^Execution Loop\b/iu.test(trimmed) ? "Execution Loop" : trimmed;
}

/** Split instruction Markdown into H2 bodies while retaining nested headings. */
function instructionSections(content: string): Map<string, string> {
  const lines = content.split("\n");
  const sections = new Map<string, string>();
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/u)?.[1];
    if (heading === undefined) {
      if (currentHeading !== null) currentLines.push(line);
      continue;
    }
    if (currentHeading !== null) {
      sections.set(currentHeading, currentLines.join("\n"));
    }
    currentHeading = normalizeInstructionHeading(heading);
    currentLines = [];
  }
  if (currentHeading !== null) {
    sections.set(currentHeading, currentLines.join("\n"));
  }
  return sections;
}

/** Read each distinct present peer instruction path declared by the manifest. */
function readInstructionParityDocuments(
  fs: ReadonlyFS,
): InstructionParityDocument[] {
  const paths = [
    ...new Set(
      Object.values(loadManifest().agents).map(
        (agent) => agent.instruction_file,
      ),
    ),
  ];

  return paths.flatMap((path) => {
    const content = fs.readFile(path);
    return content === null
      ? []
      : [{ path, sections: instructionSections(content) }];
  });
}

/**
 * Report manifest-declared phrases that some present peer instructions carry and others omit.
 * A selected-agent audit still reads siblings because parity is evidence about their relationship.
 *
 * @param fs - target-project filesystem used for sibling instruction reads
 * @param findings - consolidated drift findings extended with parity differences
 * @returns number of phrase/file comparisons represented in the drift receipt
 * @throws when the canonical manifest cannot be loaded; filesystem adapter failures propagate
 */
function compareInstructionParity(
  fs: ReadonlyFS,
  findings: DriftFinding[],
): number {
  const documents = readInstructionParityDocuments(fs);
  if (documents.length < 2) return 0;

  const rules = loadManifest().instruction_file.parity_phrases;
  for (const rule of rules) {
    for (const phrase of rule.phrases) {
      const presentPaths = documents
        .filter((document) =>
          document.sections.get(rule.section)?.includes(phrase),
        )
        .map((document) => document.path);
      if (
        presentPaths.length === 0 ||
        presentPaths.length === documents.length
      ) {
        continue;
      }
      for (const document of documents) {
        if (presentPaths.includes(document.path)) continue;
        findings.push({
          kind: "content",
          path: document.path,
          message: `instruction parity: ${rule.label} differs in ${rule.section}; missing ${JSON.stringify(phrase)} while present in ${presentPaths.join(", ")}`,
        });
      }
    }
  }

  return (
    documents.length * rules.reduce((sum, rule) => sum + rule.phrases.length, 0)
  );
}

/**
 * Compare installed skill copies with the templates users receive on setup or upgrade.
 * Use an agent filter to keep a selected-runtime audit from reporting another runtime's drift.
 */
function compareSkills(
  fs: ReadonlyFS,
  templateRoot: string,
  findings: DriftFinding[],
  agentFilter: AgentId | null | undefined,
): number {
  let checked = 0;
  const skillRoots = selectedInstalledSkillRoots(fs, agentFilter);

  // Compare each canonical skill's template against every installed copy so
  // drift shows up no matter which agent's folder went stale.
  for (const name of getSkillNames()) {
    // Every manifest-listed reference belongs to the same skill users invoke.
    for (const relativeFile of getSkillFiles(name)) {
      const templateRel = `workflow/skills/${name}/${relativeFile}`;
      const template = readTemplateText(templateRoot, templateRel);

      // A missing source template means every future consumer install would be incomplete.
      if (template === null) {
        findings.push({
          kind: "missing",
          path: templateRel,
          message: `${name}: manifest declares ${templateRel} but the workflow template is missing`,
        });
        continue;
      }

      // Each selected mirror must carry the same user-facing skill contract.
      for (const agentDir of skillRoots) {
        const installedRel = `${agentDir}/${name}/${relativeFile}`;
        checked++;

        // Missing installed content tells the user exactly which selected mirror needs repair.
        if (!fs.exists(installedRel)) {
          findings.push({
            kind: "missing",
            path: installedRel,
            message: `${name}: template at ${templateRel} has no installed copy at ${installedRel}`,
          });
          continue;
        }
        const installed = fs.readFile(installedRel);

        // An unreadable copy is handled by filesystem/setup evidence instead of inventing a content diff.
        if (installed === null) continue;

        // Different skill text means the selected agent would follow a stale workflow.
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
  for (const spec of SHARED_ARTIFACT_MIRRORS) {
    const template = readTemplateText(templateRoot, spec.template);
    if (template === null) {
      findings.push({
        kind: "missing",
        path: spec.template,
        message: `shared template missing: ${spec.template}`,
      });
      continue;
    }
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

/**
 * Find non-canonical skills in the mirrors selected for audit.
 * Use the SKILL.md marker to ignore editor files while keeping cleanup guidance actionable.
 */
function findOrphans(
  fs: ReadonlyFS,
  findings: DriftFinding[],
  agentFilter: AgentId | null | undefined,
): void {
  const canonical = new Set<string>(getSkillNames());
  const stale = getStaleSkillNames();

  // Only the runtime mirrors in this audit can produce user-visible orphan findings.
  for (const agentDir of selectedInstalledSkillRoots(fs, agentFilter)) {
    // Each directory entry may be a skill, documentation file, or editor artifact.
    for (const entry of fs.listDir(agentDir)) {
      // Canonical skills are expected and need no cleanup guidance.
      if (canonical.has(entry)) continue;
      const fullPath = `${agentDir}/${entry}`;

      // Only flag real skill directories. listDir returns files too
      // (.DS_Store, README.md, etc.); a skill is identified by SKILL.md.
      if (!fs.exists(`${fullPath}/SKILL.md`)) continue;

      // Known retired skills get the migration-specific message users can act on.
      if (stale.has(entry)) {
        findings.push({
          kind: "deprecated",
          path: fullPath,
          message: `deprecated skill still installed: ${entry} at ${fullPath}`,
        });
        continue;
      }

      const skillMarkdown = fs.readFile(`${fullPath}/SKILL.md`);
      const skillFrontmatter =
        skillMarkdown === null
          ? null
          : parseMarkdownFrontmatter(skillMarkdown).frontmatter;
      if (
        isRecord(skillFrontmatter) &&
        skillFrontmatter["goat-flow-ownership"] === USER_OWNED_SKILL_MARKER
      ) {
        continue;
      }

      // Unknown skill directories are kept separate from named deprecations.
      findings.push({
        kind: "orphan",
        path: fullPath,
        message: `orphan directory in ${agentDir}: ${entry} (not a canonical goat-flow skill)`,
      });
    }
  }
}

/**
 * Run all drift comparisons and return a consolidated report.
 *
 * @param options - Project filesystem plus optional goat-flow template root.
 * @returns Drift status, findings, and count of compared template/install pairs.
 * @throws when the canonical manifest or hook registry cannot be loaded
 */
export function checkDrift(options: CheckDriftOptions): DriftReport {
  const { fs, agentFilter } = options;

  // Consumer runs use the package templates when the caller does not supply a test fixture root.
  const templateRoot = options.templateRoot ?? getTemplatePath("");
  const findings: DriftFinding[] = [];
  let checked = 0;
  const checkedHookArtifacts = new Set<string>();
  checked += compareSkills(fs, templateRoot, findings, agentFilter);
  checked += compareSharedFiles(fs, templateRoot, findings);
  checked += compareHooks(
    fs,
    templateRoot,
    findings,
    checkedHookArtifacts,
    agentFilter,
  );
  checked += compareManagedHookRegistrations(fs, findings, agentFilter);
  checked += compareRegistryHookScripts(
    fs,
    templateRoot,
    findings,
    checkedHookArtifacts,
    agentFilter,
  );
  checked += findDeprecatedHookFiles(fs, findings);
  checked += compareInstructionParity(fs, findings);
  findOrphans(fs, findings, agentFilter);

  // Identity, resource, and complete-set checks catch packaging failures that byte parity cannot see.
  findings.push(
    ...checkArtifactIntegrity({
      fs,
      templateRoot,
      installedSkillRoots: selectedInstalledSkillRoots(fs, agentFilter),
    }),
  );

  // Any mismatch means setup or upgrade would give the user a different workflow than this checkout.
  return {
    status: findings.length === 0 ? "pass" : "fail",
    findings,
    checked,
  };
}
