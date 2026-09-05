/**
 * Map shipped guidance to the copies users open in an installed project.
 *
 * Drift checks use these paths to identify a missing or outdated document and its canonical replacement.
 * Unavailable package files return null; unreadable directories contribute no entries, so callers can continue the audit.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { posix as pathPosix, relative, resolve, sep } from "node:path";

/**
 * Pair one shipped workflow file with the project copy inspected by drift checks.
 *
 * The template path identifies the source available in the goat-flow package.
 * The installed path identifies the file the project owner can repair.
 */
export interface ArtifactMirrorSpec {
  // Canonical path relative to the goat-flow package root.
  template: string;
  // Installed path relative to the audited project root.
  installed: string;
}

// Root under a project where shared skill documents are installed.
export const INSTALLED_SHARED_ROOT = ".goat-flow/skill-docs";

// Canonical directories holding shared meta references and on-demand playbooks.
export const TEMPLATE_SHARED_ROOTS = [
  "workflow/skills/reference",
  "workflow/skills/playbooks",
] as const;

// Build source/install pairs so each shared document can be checked against the version shipped to users.
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

// Canonical source/install pairs for shared references and on-demand playbooks.
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
      "writing-agent-facing-instructions.md",
      "writing-sentence-diagnostics.md",
      "writing-structure-diagnostics.md",
      "writing-human-facing-prose.md",
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
 * It swallows a missing or unreadable file into a null result, so the caller reports it as one precise finding instead of ending the run.
 *
 * @param templateRoot - package or fixture root; an empty value resolves relative to the current working directory
 * @param relativePath - source path within that root; an empty value selects the root itself
 * @returns - source text, or null when the package cannot provide a readable file
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
 * It swallows directory-read failures and returns only the Markdown paths it could list for the comparison.
 *
 * @param templateRoot - package or fixture root; an empty value resolves relative to the current working directory
 * @param relativeRoot - workflow directory to scan; empty means the package root itself
 * @returns - sorted Markdown paths; empty means no Markdown files were found in readable directories
 */
export function listTemplateMarkdown(
  templateRoot: string,
  relativeRoot: string,
): string[] {
  const markdownPaths: string[] = [];
  const absoluteRoot = resolve(templateRoot, relativeRoot);

  /**
   * Walk one readable source directory and collect the artifacts users can receive.
   * Reports no candidate paths from an unreadable directory; other readable directories still supply files for comparison.
   */
  function visitDirectory(absoluteDirectory: string): void {
    let entries;
    try {
      entries = readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
      // A partial package extraction may omit a directory; skip its entries and keep listing the readable folders.
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
