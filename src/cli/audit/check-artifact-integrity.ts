/**
 * Deterministic integrity checks for workflow skills and shared skill documents.
 *
 * Use during `audit --check-drift` to report missing resources, duplicate identities, and stale installed files before an agent loads them.
 * The checker compares canonical workflow sources with the selected project mirrors.
 */
import { posix as pathPosix } from "node:path";
import { load } from "js-yaml";
import { COMMANDS, REMOVED_COMMANDS } from "../cli-types.js";
import { getSkillNames } from "../constants.js";
import { getSkillFiles } from "../manifest/manifest.js";
import type { ReadonlyFS } from "../types.js";
import type { DriftFinding } from "./types.js";
import {
  INSTALLED_SHARED_ROOT,
  listTemplateMarkdown,
  readTemplateText,
  SHARED_ARTIFACT_MIRRORS,
  TEMPLATE_SHARED_ROOTS,
  type ArtifactMirrorSpec,
} from "./artifact-templates.js";
import { checkResourceReferences } from "./resource-references.js";

/**
 * Select the sources and installed skill mirrors included in artifact integrity checks.
 *
 * The target filesystem supplies installed guidance; templateRoot locates package or fixture sources.
 * The selected skill roots limit agent-mirror checks, while shared artifacts use their fixed mirror map.
 */
interface ArtifactIntegrityOptions {
  // Audited project filesystem; missing files mean the user's installed guidance is incomplete.
  fs: ReadonlyFS;
  // Package or fixture root containing workflow sources; empty resolves paths from the current working directory.
  templateRoot: string;
  // Installed skill roots selected for this audit; empty means no agent mirror is in scope.
  installedSkillRoots: readonly string[];
}

/**
 * Record the name and source path read from one canonical SKILL.md.
 *
 * Audit compares this identity with the directory name and other skills before reporting ambiguous user commands.
 * A null name keeps the source available as evidence while its invalid frontmatter is reported.
 */
interface SkillIdentity {
  // User-invocable skill name; null means the contract has no usable name.
  name: string | null;
  // Canonical SKILL.md path shown in audit evidence.
  path: string;
}

const USER_OWNED_PLAYBOOK_MARKER = "user-owned";

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
 * Recognize a playbook created with goat-flow skill new so it is exempt from stale package-artifact findings.
 * Unreadable files or malformed ownership metadata recover as false and remain subject to normal drift checks.
 *
 * @param fs - audited project filesystem; unreadable files cannot establish user ownership
 * @param installedPath - project-relative installed Markdown path; empty or non-playbook paths never qualify
 * @returns true only for an installed playbook whose YAML frontmatter declares user-owned ownership
 */
function isUserOwnedConsumerPlaybook(
  fs: ReadonlyFS,
  installedPath: string,
): boolean {
  // Only installed playbooks can claim this user-owned exemption from package drift.
  if (
    !installedPath.startsWith(`${INSTALLED_SHARED_ROOT}/playbooks/`) ||
    !installedPath.endsWith(".md")
  ) {
    return false;
  }

  const markdown = fs.readFile(installedPath);
  // An unreadable playbook cannot supply the ownership marker needed to exempt it.
  if (markdown === null) return false;
  const frontmatterMatch = markdown.match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u,
  );
  // Without frontmatter, audit has no ownership declaration to preserve as a user extension.
  if (frontmatterMatch?.[1] === undefined) return false;

  try {
    const frontmatter = load(frontmatterMatch[1]);
    // Ownership must be declared in a YAML object before audit exempts the user's playbook.
    if (
      frontmatter === null ||
      typeof frontmatter !== "object" ||
      Array.isArray(frontmatter)
    ) {
      return false;
    }
    return (
      (frontmatter as Record<string, unknown>)["goat-flow-ownership"] ===
      USER_OWNED_PLAYBOOK_MARKER
    );
  } catch {
    // An unfinished YAML edit can break the ownership declaration; audit then applies normal stale-artifact handling.
    return false;
  }
}

/**
 * Reports duplicate values with all canonical locations in one actionable message.
 * Use for command or skill registries where one identifier must select exactly one user action.
 *
 * @param identifiers - registry values to compare; empty means there are no IDs to validate
 * @param registryPath - registry path included in the finding; empty leaves its repair location unspecified
 * @param identifierLabel - identifier kind inserted in the finding; empty leaves that part of the message blank
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
    // Start the first declaration at zero, then count it toward any duplicate command finding.
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
 * @param templateRoot - package or fixture root; empty resolves canonical paths from the current working directory
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
 * Reports frontmatter names claimed by more than one canonical skill source.
 * Use after per-skill alignment so that one user command never selects competing guidance.
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
    // The first skill claiming this name starts its evidence list; later sources join any collision finding.
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
      // Show the first colliding source as the repair path, retaining the canonical skills root as a display fallback.
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
 * @param templateRoot - package or fixture root; empty resolves canonical paths from the current working directory
 * @returns issues in readable canonical identities; empty reports none, while missing files are handled by ordinary drift checks
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

/**
 * Report canonical or installed skill Markdown omitted from the manifest's declared file set.
 * Compare both sides because undeclared source is not shipped and leftover installed guidance can outlive a rename.
 *
 * @param fs - audited project filesystem; empty mirrors produce no stale-file findings
 * @param templateRoot - package or fixture root; empty resolves source paths from the current working directory
 * @param installedSkillRoots - selected agent mirrors; empty omits installed-skill checks
 * @returns undeclared-file findings; empty means no extras were discovered, not that every declared file exists
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
 * Report shared source and installed Markdown absent from the explicit mirror map.
 * Preserve marked user-owned playbooks so local extensions do not appear as stale package guidance.
 *
 * @param fs - audited project filesystem; an empty installed tree yields no stale extras
 * @param templateRoot - package or fixture root; empty resolves source paths from the current working directory
 * @param sharedFiles - canonical mirror map; empty leaves every discovered package artifact unmapped
 * @returns unmapped-file findings; empty does not prove every mapped source and installed file exists
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
    // Consumer-authored playbooks are valid local extensions, not package leftovers.
    if (isUserOwnedConsumerPlaybook(fs, installedPath)) continue;
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
 * @returns actionable findings; empty reports no detected issue, with missing or unreadable inputs limiting some checks
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
