/**
 * Resolves the file paths that goat-flow's own guidance documents point at.
 * A skill or playbook only helps if the resources it names actually ship, so this module reads
 * canonical Markdown, extracts every local path it teaches, maps installed paths back to their
 * workflow source, and reports the ones an agent would fail to open mid-task.
 *
 * Two rules keep the findings honest. Fenced examples are skipped, because a placeholder path
 * a user is meant to fill in is not a broken link. And a target that resolves outside the
 * package is reported even when a similarly named file happens to exist there, since shipped
 * guidance must never depend on a file the install cannot provide.
 */
import { existsSync } from "node:fs";
import { dirname, posix as pathPosix, relative, resolve, sep } from "node:path";
import { getSkillNames } from "../constants.js";
import type { DriftFinding } from "./types.js";
import {
  listTemplateMarkdown,
  readTemplateText,
  SHARED_ARTIFACT_MIRRORS,
  TEMPLATE_SHARED_ROOTS,
} from "./artifact-templates.js";

/** A resource target resolved from one canonical Markdown source. */
interface ResourceReference {
  /** Canonical source that teaches the resource path. */
  sourcePath: string;
  /** Canonical target path; null means the reference escaped the package root. */
  targetPath: string | null;
  /** Original reference text shown to the operator. */
  rawTarget: string;
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
export function checkResourceReferences(templateRoot: string): DriftFinding[] {
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

