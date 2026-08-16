/**
 * The map between goat-flow's shipped guidance files and the copies installed in a project.
 * Every "your installed docs drifted from the package" finding traces back to this registry:
 * it names each canonical workflow source, the installed path a user actually opens, and the
 * reading helpers the drift checks use to compare the two.
 *
 * Reads here never throw. A missing or unreadable package file comes back as `null` so the
 * check that owns the comparison can turn it into one precise, repairable finding, rather
 * than aborting an audit halfway and leaving the user with no report at all.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { posix as pathPosix, relative, resolve, sep } from "node:path";

/** One canonical workflow file and the installed copy users load. */
export interface ArtifactMirrorSpec {
  /** Canonical path relative to the goat-flow package root. */
  template: string;
  /** Installed path relative to the audited project root. */
  installed: string;
}

/** Root under a project where shared skill documents are installed. */
export const INSTALLED_SHARED_ROOT = ".goat-flow/skill-docs";

/** Canonical directories holding shared meta references and on-demand playbooks. */
export const TEMPLATE_SHARED_ROOTS = [
  "workflow/skills/reference",
  "workflow/skills/playbooks",
] as const;

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
      "naming-and-placement.md",
      "observability.md",
      "changelog.md",
      "page-capture.md",
      "release-notes.md",
      "skill-playbook-authoring-sync.md",
      "test-selection.md",
      "writing-sentence-diagnostics.md",
      "writing-structure-diagnostics.md",
      "writing-style.md",
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
export function listTemplateMarkdown(
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
