/**
 * Deterministic integrity checks for workflow skills and shared skill documents.
 * Use during `audit --check-drift` so operators see missing resources, duplicate
 * identities, and stale installed files before an agent loads incomplete guidance.
 * The checker compares canonical workflow sources with the selected project mirrors.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, posix as pathPosix, relative, resolve, sep } from "node:path";
import { load } from "js-yaml";
import { COMMANDS, REMOVED_COMMANDS } from "../cli-types.js";
import { getSkillNames } from "../constants.js";
import { getSkillFiles } from "../manifest/manifest.js";
import type { ReadonlyFS } from "../types.js";
import type { DriftFinding } from "./types.js";

/** One canonical workflow file and the installed copy users load. */
export interface ArtifactMirrorSpec {
  /** Canonical path relative to the goat-flow package root. */
  template: string;
  /** Installed path relative to the audited project root. */
  installed: string;
}

/** Inputs needed to validate canonical identities and installed artifact sets. */
interface ArtifactIntegrityOptions {
  /** Audited project filesystem; missing files mean the user's installed guidance is incomplete. */
  fs: ReadonlyFS;
  /** Package or fixture root containing workflow sources; empty means no canonical source can be read. */
  templateRoot: string;
  /** Installed skill roots selected for this audit; empty means no agent mirror is in scope. */
  installedSkillRoots: readonly string[];
}

/** Parsed identity from one canonical SKILL.md frontmatter block. */
interface SkillIdentity {
  /** User-invocable skill name; null means the contract has no usable name. */
  name: string | null;
  /** Canonical SKILL.md path shown in audit evidence. */
  path: string;
}

/** A resource target resolved from one canonical Markdown source. */
interface ResourceReference {
  /** Canonical source that teaches the resource path. */
  sourcePath: string;
  /** Canonical target path; null means the reference escaped the package root. */
  targetPath: string | null;
  /** Original reference text shown to the operator. */
  rawTarget: string;
}

const TEMPLATE_SHARED_ROOTS = [
  "workflow/skills/reference",
  "workflow/skills/playbooks",
] as const;
const INSTALLED_SHARED_ROOT = ".goat-flow/skill-docs";

/** Pair sibling Markdown names across one canonical and installed directory. */
function sharedMarkdownMirrors(
  templateDirectory: string,
  installedDirectory: string,
  filenames: readonly string[],
): ArtifactMirrorSpec[] {
  // Each sibling filename keeps one explicit canonical source and installed destination.
  return filenames.map((filename) => ({
    template: pathPosix.join(templateDirectory, filename),
    installed: pathPosix.join(installedDirectory, filename),
  }));
}

/** Canonical source/install pairs for shared references and on-demand playbooks. */
export const SHARED_ARTIFACT_MIRRORS: readonly ArtifactMirrorSpec[] = [
  ...sharedMarkdownMirrors("workflow/skills/reference", INSTALLED_SHARED_ROOT, [
    "README.md",
    "skill-preamble.md",
    "skill-conventions.md",
  ]),
  ...sharedMarkdownMirrors(
    "workflow/skills/playbooks",
    `${INSTALLED_SHARED_ROOT}/playbooks`,
    [
      "README.md",
      "browser-use.md",
      "code-comments.md",
      "gruff-code-quality.md",
      "hook-policy-testing.md",
      "observability.md",
      "changelog.md",
      "page-capture.md",
      "release-notes.md",
      "skill-playbook-authoring-sync.md",
    ],
  ),
  {
    template: "workflow/skills/playbooks/skill-quality-testing.md",
    installed: `${INSTALLED_SHARED_ROOT}/skill-quality-testing/README.md`,
  },
  ...sharedMarkdownMirrors(
    "workflow/skills/playbooks/skill-quality-testing",
    `${INSTALLED_SHARED_ROOT}/skill-quality-testing`,
    ["tdd-iteration.md", "adversarial-framing.md", "deployment.md"],
  ),
];

/**
 * Read one canonical UTF-8 source without aborting the wider audit.
 * Use when a missing or unreadable resource should become a precise finding.
 *
 * @param templateRoot - package or fixture root; empty means no source root is available
 * @param relativePath - canonical repo-relative path; empty means no file was selected
 * @returns source text, or null when the operator's package cannot provide the file
 */
export function readTemplateText(
  templateRoot: string,
  relativePath: string,
): string | null {
  const absolutePath = resolve(templateRoot, relativePath);

  // The canonical file is absent, so its owning comparison reports the user-facing gap.
  if (!existsSync(absolutePath)) return null;
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    // For example, a package file can become unreadable during an upgrade; report it as unavailable.
    return null;
  }
}

/**
 * List canonical Markdown below one workflow directory with stable POSIX paths.
 * Use when comparing the complete source set with declared install mappings.
 *
 * @param templateRoot - package or fixture root; empty means no source tree can be listed
 * @param relativeRoot - workflow directory to scan; empty means the package root itself
 * @returns sorted Markdown paths; empty means the directory has no readable Markdown
 */
function listTemplateMarkdown(
  templateRoot: string,
  relativeRoot: string,
): string[] {
  const markdownPaths: string[] = [];
  const absoluteRoot = resolve(templateRoot, relativeRoot);

  /**
   * Walk one readable source directory and collect the artifacts users can receive.
   * Unreadable directories recover as empty so the owning drift check reports the package gap.
   */
  function visitDirectory(absoluteDirectory: string): void {
    let entries;
    try {
      entries = readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
      // For example, a partial package extraction can omit this directory; its owner reports the missing files.
      return;
    }

    // Each directory entry may be another reference pack or a concrete Markdown artifact.
    for (const entry of entries) {
      const absoluteEntry = resolve(absoluteDirectory, entry.name);

      // Nested packs stay part of the same user-facing shared-document set.
      if (entry.isDirectory()) {
        visitDirectory(absoluteEntry);
        continue;
      }

      // Non-Markdown support files are outside this documentation-integrity contract.
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      markdownPaths.push(
        relative(templateRoot, absoluteEntry).split(sep).join("/"),
      );
    }
  }

  visitDirectory(absoluteRoot);
  return markdownPaths.sort();
}

/**
 * Read a non-empty skill name from YAML frontmatter.
 * Use when proving the command users invoke matches the canonical skill directory.
 *
 * @param skillMarkdown - complete SKILL.md text; empty means no identity can be read
 * @returns trimmed skill name, or null when frontmatter is missing, malformed, or empty; never throws
 */
function readSkillFrontmatterName(skillMarkdown: string): string | null {
  const frontmatterMatch = skillMarkdown.match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u,
  );

  // Missing frontmatter leaves the skill without a stable command identity.
  if (frontmatterMatch?.[1] === undefined) return null;
  try {
    const frontmatter = load(frontmatterMatch[1]);

    // Only an object with a non-empty name gives users an invocable skill identity.
    if (
      frontmatter === null ||
      typeof frontmatter !== "object" ||
      Array.isArray(frontmatter)
    ) {
      return null;
    }
    const name = (frontmatter as Record<string, unknown>).name;

    // Blank or non-text names cannot match a skill command shown to the user.
    if (typeof name !== "string" || name.trim().length === 0) return null;
    return name.trim();
  } catch {
    // For example, an unfinished YAML edit can leave the skill visible on disk but impossible to identify.
    return null;
  }
}

/**
 * Report duplicate values with all canonical locations in one actionable message.
 * Use for command or skill registries where one identifier must select one user action.
 *
 * @param identifiers - registry values to compare; empty means there are no IDs to validate
 * @param registryPath - canonical registry shown to the operator; empty weakens evidence but remains valid text
 * @param identifierLabel - user-facing identifier kind; empty falls back to a generic message
 * @returns duplicate findings; empty means every supplied identifier is unique
 */
export function findDuplicateArtifactIds(
  identifiers: readonly string[],
  registryPath: string,
  identifierLabel: string,
): DriftFinding[] {
  const occurrences = new Map<string, number>();

  // Count every declared action so a repeated ID cannot silently shadow another entry.
  for (const identifier of identifiers) {
    occurrences.set(identifier, (occurrences.get(identifier) ?? 0) + 1);
  }

  const findings: DriftFinding[] = [];

  // Only repeated values are ambiguous to the user; unique actions need no finding.
  for (const [identifier, count] of occurrences) {
    // A single declaration still gives the user one unambiguous action.
    if (count < 2) continue;
    findings.push({
      kind: "content",
      path: registryPath,
      message: `duplicate ${identifierLabel} "${identifier}" appears ${count} times in ${registryPath}`,
    });
  }
  return findings;
}

/**
 * Read each canonical identity and report its directory/frontmatter mismatch.
 * Use before collision checks so every invalid skill names its own repair path.
 *
 * @param templateRoot - package or fixture root; empty means no canonical skills can be read
 * @param findings - shared finding list; empty means no mismatch has been reported yet
 * @returns readable skill identities; empty means no canonical SKILL.md could be read
 * @throws when the canonical manifest cannot supply its skill registry
 */
function readCanonicalSkillIdentities(
  templateRoot: string,
  findings: DriftFinding[],
): SkillIdentity[] {
  const identities: SkillIdentity[] = [];

  // Every canonical directory represents one user-invocable goat-flow command.
  for (const skillName of getSkillNames()) {
    const skillPath = `workflow/skills/${skillName}/SKILL.md`;
    const skillMarkdown = readTemplateText(templateRoot, skillPath);

    // Ordinary drift comparison already reports a missing canonical SKILL.md with the same path.
    if (skillMarkdown === null) continue;
    const frontmatterName = readSkillFrontmatterName(skillMarkdown);
    identities.push({ name: frontmatterName, path: skillPath });

    // A missing name leaves agents unable to prove which command this contract belongs to.
    if (frontmatterName === null) {
      findings.push({
        kind: "content",
        path: skillPath,
        message: `${skillPath} has no non-empty frontmatter name; expected canonical skill "${skillName}"`,
      });
      continue;
    }

    // A renamed frontmatter command would make the directory and user invocation disagree.
    if (frontmatterName !== skillName) {
      findings.push({
        kind: "content",
        path: skillPath,
        message: `${skillPath} frontmatter name "${frontmatterName}" does not match canonical directory "${skillName}"`,
      });
    }
  }

  return identities;
}

/**
 * Report frontmatter names claimed by more than one canonical skill source.
 * Use after per-skill alignment so one user command never selects competing guidance.
 *
 * @param identities - readable skill identities; empty means there are no names to compare
 * @returns collision findings with every canonical source; empty means all usable names are unique
 */
function duplicateSkillIdentityFindings(
  identities: readonly SkillIdentity[],
): DriftFinding[] {
  const pathsByName = new Map<string, string[]>();

  // Group usable names so collisions report every source the maintainer must reconcile.
  for (const identity of identities) {
    // A missing name already has its own actionable frontmatter finding.
    if (identity.name === null) continue;
    const paths = pathsByName.get(identity.name) ?? [];
    paths.push(identity.path);
    pathsByName.set(identity.name, paths);
  }

  const findings: DriftFinding[] = [];

  // Duplicate frontmatter names make one command select multiple competing contracts.
  for (const [skillName, skillPaths] of pathsByName) {
    // One source for a name is the expected user-facing command contract.
    if (skillPaths.length < 2) continue;
    findings.push({
      kind: "content",
      path: skillPaths[0] ?? "workflow/skills",
      message: `duplicate skill frontmatter name "${skillName}" appears in ${skillPaths.join(", ")}`,
    });
  }
  return findings;
}

/**
 * Validate directory/frontmatter alignment and cross-skill name uniqueness.
 * Use so one slash command always resolves to exactly one canonical workflow contract.
 *
 * @param templateRoot - package or fixture root; empty means no canonical skills can be read
 * @returns identity findings; empty means all canonical skills are named uniquely and correctly
 * @throws when the canonical manifest cannot supply its skill registry
 */
function checkSkillIdentities(templateRoot: string): DriftFinding[] {
  const alignmentFindings: DriftFinding[] = [];
  const identities = readCanonicalSkillIdentities(
    templateRoot,
    alignmentFindings,
  );
  return [...alignmentFindings, ...duplicateSkillIdentityFindings(identities)];
}

/** Remove fragments and titles before resolving a local Markdown destination. */
function normalizeMarkdownTarget(rawTarget: string): string {
  return rawTarget.trim().split(/[?#]/u, 1)[0] ?? "";
}

/**
 * Map an installed or relative resource path back to its workflow source.
 * Use when the audit needs the exact canonical file behind user-facing guidance.
 */
function canonicalResourceTarget(
  sourcePath: string,
  normalizedTarget: string,
): string {
  const mappedSharedFile = SHARED_ARTIFACT_MIRRORS.find(
    (sharedFile) => sharedFile.installed === normalizedTarget,
  );

  // Exact mappings own renamed installs such as skill-quality-testing/README.md.
  if (mappedSharedFile !== undefined) return mappedSharedFile.template;
  // Installed playbook paths map back to their canonical workflow source.
  if (normalizedTarget.startsWith(".goat-flow/skill-docs/playbooks/")) {
    return normalizedTarget.replace(
      ".goat-flow/skill-docs/playbooks/",
      "workflow/skills/playbooks/",
    );
  }
  // Installed authoring-method paths map into the nested workflow playbook pack.
  if (
    normalizedTarget.startsWith(".goat-flow/skill-docs/skill-quality-testing/")
  ) {
    return normalizedTarget.replace(
      ".goat-flow/skill-docs/skill-quality-testing/",
      "workflow/skills/playbooks/skill-quality-testing/",
    );
  }
  // A private references path belongs to the skill directory that teaches it.
  if (normalizedTarget.startsWith("references/")) {
    const skillRootMatch = sourcePath.match(/^(workflow\/skills\/[^/]+)\//u);
    return pathPosix.join(
      skillRootMatch?.[1] ?? dirname(sourcePath),
      normalizedTarget,
    );
  }
  // Ordinary Markdown links are relative to the file that presents them to the user.
  return pathPosix.normalize(
    pathPosix.join(dirname(sourcePath), normalizedTarget),
  );
}

/**
 * Resolve one canonical resource reference into the workflow source tree.
 * Use for links and backticked pack paths that an agent may follow while working.
 *
 * @param templateRoot - package or fixture root used to prevent path escape; empty means no safe root exists
 * @param sourcePath - canonical Markdown source; empty means relative links have no stable base
 * @param rawTarget - path taught by the source; empty means there is no resource to resolve
 * @returns source and canonical target; target is null when the path escapes the package root
 */
function resolveResourceReference(
  templateRoot: string,
  sourcePath: string,
  rawTarget: string,
): ResourceReference {
  const normalizedTarget = normalizeMarkdownTarget(rawTarget);
  const canonicalTarget = canonicalResourceTarget(sourcePath, normalizedTarget);

  const absoluteTemplateRoot = resolve(templateRoot);
  const absoluteTarget = resolve(templateRoot, canonicalTarget);
  const targetWithinTemplate = relative(absoluteTemplateRoot, absoluteTarget);

  // Escaping the package would make a shipped skill depend on an undeclared external file.
  if (
    targetWithinTemplate === ".." ||
    targetWithinTemplate.startsWith(`..${sep}`)
  ) {
    return { sourcePath, targetPath: null, rawTarget };
  }
  return {
    sourcePath,
    targetPath: targetWithinTemplate.split(sep).join("/"),
    rawTarget,
  };
}

/**
 * Extract deterministic local targets from one non-example Markdown line.
 * Use so the file-level scanner handles fence state separately from link grammar.
 *
 * @param line - one canonical Markdown line; empty means no resource can be taught
 * @returns local link and reference-pack paths; empty excludes remote, in-page, and templated targets
 */
function resourceTargetsFromLine(line: string): string[] {
  const resourceTargets: string[] = [];

  // Markdown links expose explicit local resources in indexes and related-reference sections.
  for (const linkMatch of line.matchAll(
    /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu,
  )) {
    const rawTarget = linkMatch[1] ?? "";

    // Remote, in-page, and templated destinations are not package-file dependencies.
    if (
      rawTarget.length === 0 ||
      /^(?:https?:|mailto:|#)/iu.test(rawTarget) ||
      /[<>{}*]/u.test(rawTarget)
    ) {
      continue;
    }
    resourceTargets.push(rawTarget);
  }

  // Skill contracts often name their reference pack in code spans instead of Markdown links.
  for (const codeMatch of line.matchAll(
    /`((?:references\/|\.goat-flow\/skill-docs\/(?:playbooks|skill-quality-testing)\/)[A-Za-z0-9._/-]+\.md)`/gu,
  )) {
    const rawTarget = codeMatch[1];

    // An unmatched capture carries no resource path for the audit to resolve.
    if (rawTarget === undefined) continue;
    resourceTargets.push(rawTarget);
  }
  return resourceTargets;
}

/**
 * Extract local Markdown/resource destinations while ignoring examples and external URLs.
 * Use on canonical skill and playbook text before proving every taught path exists.
 *
 * @param templateRoot - package or fixture root; empty means references cannot be safely resolved
 * @param sourcePath - canonical Markdown source; empty means relative links have no base
 * @param sourceText - file contents to inspect; empty means the source teaches no resources
 * @returns unique canonical references; empty means no deterministic local path was taught
 */
function extractResourceReferences(
  templateRoot: string,
  sourcePath: string,
  sourceText: string,
): ResourceReference[] {
  const references = new Map<string, ResourceReference>();
  let isInsideFence = false;

  // Each non-example line can teach one or more resources that agents later try to open.
  for (const line of sourceText.split(/\r?\n/u)) {
    // Fenced examples may contain placeholders such as <slug>; they are not live dependencies.
    if (/^\s*```/u.test(line)) {
      isInsideFence = !isInsideFence;
      continue;
    }

    // Example bodies are intentionally non-resolving until the user supplies their values.
    if (isInsideFence) continue;

    // Resolve every taught target once so repeated references do not create noisy duplicate findings.
    for (const rawTarget of resourceTargetsFromLine(line)) {
      const reference = resolveResourceReference(
        templateRoot,
        sourcePath,
        rawTarget,
      );
      references.set(
        `${reference.sourcePath}\0${reference.targetPath ?? reference.rawTarget}`,
        reference,
      );
    }
  }
  return [...references.values()];
}

/**
 * Report canonical resource paths that an installed skill or playbook cannot provide.
 * Because skills cite both private packs and shared installed paths, gather all sources first
 * so one audit returns every repair path; unreadable sources defer to set-parity findings.
 *
 * @param templateRoot - package or fixture root; empty means no canonical sources can be checked
 * @returns resource findings; empty means every deterministic local reference resolves
 * @throws when the canonical manifest cannot supply its skill registry
 */
function checkResourceReferences(templateRoot: string): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const sourcePaths: string[] = [];

  // Every canonical skill file can teach another resource in its own pack.
  for (const skillName of getSkillNames()) {
    sourcePaths.push(
      ...listTemplateMarkdown(templateRoot, `workflow/skills/${skillName}`),
    );
  }

  // Shared meta references and playbooks can link to sibling capabilities.
  for (const sharedRoot of TEMPLATE_SHARED_ROOTS) {
    sourcePaths.push(...listTemplateMarkdown(templateRoot, sharedRoot));
  }

  // Each canonical source contributes zero or more local dependencies.
  for (const sourcePath of [...new Set(sourcePaths)]) {
    const sourceText = readTemplateText(templateRoot, sourcePath);

    // A file removed between listing and reading is reported by source/mirror ownership instead.
    if (sourceText === null) continue;

    // Each taught local path must stay inside the package and exist in canonical source.
    for (const reference of extractResourceReferences(
      templateRoot,
      sourcePath,
      sourceText,
    )) {
      // Escaped paths are invalid even if a similarly named file exists outside the package.
      if (reference.targetPath === null) {
        findings.push({
          kind: "content",
          path: sourcePath,
          message: `${sourcePath} references "${reference.rawTarget}", which escapes the canonical workflow package`,
        });
        continue;
      }

      // A missing target would send the agent to guidance the installed package cannot supply.
      if (!existsSync(resolve(templateRoot, reference.targetPath))) {
        findings.push({
          kind: "missing",
          path: reference.targetPath,
          message: `${sourcePath} references missing canonical resource ${reference.targetPath}`,
        });
      }
    }
  }
  return findings;
}

/**
 * Compare declared skill packs with canonical and installed Markdown file sets.
 * Use after renames/removals so neither unshipped source nor stale user guidance survives.
 *
 * @param fs - audited project filesystem; empty mirrors produce no stale-file findings
 * @param templateRoot - package or fixture root; empty means no canonical set can be listed
 * @param installedSkillRoots - selected agent mirrors; empty means no installed skills are in scope
 * @returns set-integrity findings; empty means declared, source, and installed skill files agree
 */
function checkSkillFileSets(
  fs: ReadonlyFS,
  templateRoot: string,
  installedSkillRoots: readonly string[],
): DriftFinding[] {
  const findings: DriftFinding[] = [];

  // Each canonical skill has one manifest-declared source/install file set.
  for (const skillName of getSkillNames()) {
    const declaredRelativeFiles = new Set(getSkillFiles(skillName));
    const canonicalSkillRoot = `workflow/skills/${skillName}`;

    // Source files omitted from the manifest never reach users during setup or upgrade.
    for (const canonicalPath of listTemplateMarkdown(
      templateRoot,
      canonicalSkillRoot,
    )) {
      const relativeSkillPath = pathPosix.relative(
        canonicalSkillRoot,
        canonicalPath,
      );

      // Declared files already participate in normal content-parity comparison.
      if (declaredRelativeFiles.has(relativeSkillPath)) continue;
      findings.push({
        kind: "orphan",
        path: canonicalPath,
        message: `${canonicalPath} is not declared in workflow/manifest.json skills.references.${skillName}; it has no installed mirror mapping`,
      });
    }

    // Every selected agent mirror should contain only the current manifest-declared pack.
    for (const installedSkillRoot of installedSkillRoots) {
      const installedSkillPath = `${installedSkillRoot}/${skillName}`;

      // Each installed Markdown file must map back to one current canonical source.
      for (const installedPath of fs.glob(`${installedSkillPath}/**/*.md`)) {
        const relativeSkillPath = pathPosix.relative(
          installedSkillPath,
          installedPath,
        );

        // Current files are checked for content elsewhere; only leftovers are stale here.
        if (declaredRelativeFiles.has(relativeSkillPath)) continue;
        findings.push({
          kind: "orphan",
          path: installedPath,
          message: `stale installed skill artifact ${installedPath}; canonical source would be ${canonicalSkillRoot}/${relativeSkillPath}, but workflow/manifest.json does not declare it`,
        });
      }
    }
  }
  return findings;
}

/**
 * Compare all shared source/install Markdown with the explicit mirror map.
 * Use so adding or removing a playbook cannot leave source-only or stale installed guidance.
 *
 * @param fs - audited project filesystem; an empty installed tree yields no stale extras
 * @param templateRoot - package or fixture root; empty means no canonical shared files can be listed
 * @param sharedFiles - canonical mirror map; empty means every discovered shared file is unmapped
 * @returns shared-set findings; empty means source, mapping, and installed sets agree
 */
function checkSharedFileSets(
  fs: ReadonlyFS,
  templateRoot: string,
  sharedFiles: readonly ArtifactMirrorSpec[],
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const declaredTemplates = new Set(
    sharedFiles.map((sharedFile) => sharedFile.template),
  );
  const declaredInstalled = new Set(
    sharedFiles.map((sharedFile) => sharedFile.installed),
  );

  // Every shared canonical document needs an explicit installed destination.
  for (const sharedRoot of TEMPLATE_SHARED_ROOTS) {
    // Each canonical file below this root needs one explicit user-facing destination.
    for (const canonicalPath of listTemplateMarkdown(
      templateRoot,
      sharedRoot,
    )) {
      // Declared files already participate in normal source/install content comparison.
      if (declaredTemplates.has(canonicalPath)) continue;
      findings.push({
        kind: "orphan",
        path: canonicalPath,
        message: `${canonicalPath} has no installed mirror mapping in check-artifact-integrity.ts SHARED_ARTIFACT_MIRRORS`,
      });
    }
  }

  // Installed shared Markdown not in the map is stale guidance from an older package shape.
  for (const installedPath of fs.glob(`${INSTALLED_SHARED_ROOT}/**/*.md`)) {
    // Current mapped files are checked for content elsewhere; only leftovers are stale here.
    if (declaredInstalled.has(installedPath)) continue;
    findings.push({
      kind: "orphan",
      path: installedPath,
      message: `stale installed shared artifact ${installedPath}; no canonical workflow source is mapped in check-artifact-integrity.ts SHARED_ARTIFACT_MIRRORS`,
    });
  }
  return findings;
}

/**
 * Validate CLI registry uniqueness and active/retired separation.
 * Use so one top-level command always dispatches to one current user action.
 *
 * @returns command findings; empty means active IDs are unique and none are also retired; never throws
 */
function checkCommandIdentifiers(): DriftFinding[] {
  const registryPath = "src/cli/cli-types.ts";
  const findings = findDuplicateArtifactIds(
    COMMANDS,
    registryPath,
    "active command ID",
  );

  // An ID cannot be both runnable and retired without giving users contradictory routing.
  for (const command of COMMANDS) {
    // Commands absent from the retired registry remain ordinary active actions.
    if (!Object.hasOwn(REMOVED_COMMANDS, command)) continue;
    findings.push({
      kind: "content",
      path: registryPath,
      message: `command "${command}" appears in both COMMANDS and REMOVED_COMMANDS in ${registryPath}`,
    });
  }
  return findings;
}

/**
 * Run the complete artifact-integrity layer used by `audit --check-drift`.
 * Use after ordinary content comparison to add identity, reference, and stale-set evidence.
 *
 * @param options - canonical and installed artifact sources; empty collections narrow the audit scope
 * @returns actionable findings; empty means every checked integrity contract is satisfied
 */
export function checkArtifactIntegrity(
  options: ArtifactIntegrityOptions,
): DriftFinding[] {
  return [
    ...checkSkillIdentities(options.templateRoot),
    ...checkResourceReferences(options.templateRoot),
    ...checkSkillFileSets(
      options.fs,
      options.templateRoot,
      options.installedSkillRoots,
    ),
    ...checkSharedFileSets(
      options.fs,
      options.templateRoot,
      SHARED_ARTIFACT_MIRRORS,
    ),
    ...checkCommandIdentifiers(),
  ];
}
