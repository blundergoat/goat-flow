/**
 * Filesystem-facing layer of skill-quality scoring: discovers artifacts on disk, safely reads their
 * content under byte caps, composes the scoring surface (preamble, conventions, and skill-local
 * references), and provides the small text utilities (heading counts, frontmatter stripping, token
 * estimate) the metric scorers call.
 *
 * This is the only module here that touches the filesystem, so the safety rules live here: symlinks
 * are refused, every reference include is confined to its allowed root (no `..` escape), and uploads
 * can disable disk scanning so a user-supplied name cannot leak on-disk content into the score.
 * Reads are capped and truncate on UTF-8 character boundaries to keep composed sizes deterministic.
 */
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  loadQualityConfig,
  type ArtifactSource,
  type QualityConfig,
} from "./quality-config.js";
import type {
  ArtifactEntry,
  ComposeOptions,
  ComposeResult,
  ReadContentResult,
} from "./skill-quality-types.js";

/** Return true for normal entries; swallows symlink and disappearing-path errors as unsafe. */
function isSafeEntry(path: string): boolean {
  try {
    return !lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Candidate shared-reference file before duplicate names are expanded into stable ids.
 */
interface ReferenceCandidate {
  name: string;
  path: string;
}

/**
 * Sanitize a path segment for reference ids without leaking separators into artifact ids.
 */
function referenceIdSegment(value: string): string {
  return (
    value
      .replace(/^\.+\/?/u, "")
      .replace(/[^a-z0-9_-]+/giu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase() || "reference-root"
  );
}

function referenceArtifactId(
  candidate: ReferenceCandidate,
  nameCounts: ReadonlyMap<string, number>,
  usedIds: Set<string>,
): string {
  const duplicateName = (nameCounts.get(candidate.name) ?? 0) > 1;
  const baseId = duplicateName
    ? `reference:${referenceIdSegment(dirname(candidate.path))}:${candidate.name}`
    : `reference:${candidate.name}`;
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}:${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function sharedReferenceName(refDir: string, filename: string): string | null {
  if (filename !== "README.md") return filename.replace(/\.md$/, "");
  const directoryName = basename(refDir);
  return directoryName === "skill-quality-testing" ? directoryName : null;
}

/**
 * Build the synthetic path used when uploaded markdown is evaluated as a reference.
 *
 * @param name - user-supplied artifact name; used only to label the synthetic record, never to read disk.
 * @returns a project-relative playbook path under `.goat-flow/skill-docs/playbooks/`; no file is created.
 */
export function uploadedSharedReferencePath(name: string): string {
  return `.goat-flow/skill-docs/playbooks/${name}.md`;
}

/** Forward-slash a relative project path so artifact records render the same
 *  on Windows and POSIX. fs operations accept either separator; user-visible
 *  paths (dashboard, JSON output, log entries) must not. */
function relPosix(projectRoot: string, target: string): string {
  return relative(projectRoot, target).replace(/\\/g, "/");
}

function registerSkillArtifact(
  projectRoot: string,
  artifactsById: Map<string, ArtifactEntry>,
  name: string,
  skillFile: string,
  source: ArtifactSource,
): void {
  const id = `skill:${name}`;
  const path = relPosix(projectRoot, skillFile);
  const existing = artifactsById.get(id);
  if (existing) {
    existing.mirrorPaths = [...(existing.mirrorPaths ?? []), path];
    return;
  }
  artifactsById.set(id, {
    id,
    name,
    path,
    kind: "skill",
    source,
    mirrorPaths: [],
    missingMirrors: [],
  });
}

function addMissingMirrorMetadata(
  projectRoot: string,
  artifact: ArtifactEntry,
  config: QualityConfig,
): ArtifactEntry {
  if (artifact.kind !== "skill") return artifact;
  const expected = config.walkRoots.skills.map(({ dir }) =>
    relPosix(projectRoot, join(projectRoot, dir, artifact.name, "SKILL.md")),
  );
  const present = new Set([artifact.path, ...(artifact.mirrorPaths ?? [])]);
  return {
    ...artifact,
    mirrorPaths: artifact.mirrorPaths ?? [],
    missingMirrors: expected.filter((path) => !present.has(path)),
  };
}

// eslint-disable-next-line complexity -- intentional because inventory walks multiple artifact roots and dedupes mirrored skills into one canonical artifact
export function discoverArtifacts(
  projectRoot: string,
  config: QualityConfig = loadQualityConfig(projectRoot),
): ArtifactEntry[] {
  const artifactsById = new Map<string, ArtifactEntry>();

  for (const { dir, source } of config.walkRoots.skills) {
    const skillsDir = join(projectRoot, dir);
    if (!existsSync(skillsDir)) continue;
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      const entryPath = join(skillsDir, entry.name);
      if (!entry.isDirectory() || !isSafeEntry(entryPath)) continue;
      const skillFile = join(entryPath, "SKILL.md");
      if (!existsSync(skillFile) || !isSafeEntry(skillFile)) continue;
      registerSkillArtifact(
        projectRoot,
        artifactsById,
        entry.name,
        skillFile,
        source,
      );
    }
  }

  const artifacts = Array.from(artifactsById.values()).map((artifact) =>
    addMissingMirrorMetadata(projectRoot, artifact, config),
  );

  const referenceCandidates: ReferenceCandidate[] = [];
  for (const { dir } of config.walkRoots.references) {
    const refDir = join(projectRoot, dir);
    if (!existsSync(refDir)) continue;
    for (const entry of readdirSync(refDir, { withFileTypes: true })) {
      const filePath = join(refDir, entry.name);
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const name = sharedReferenceName(refDir, entry.name);
      if (name === null || !isSafeEntry(filePath)) continue;
      referenceCandidates.push({
        name,
        path: relPosix(projectRoot, filePath),
      });
    }
  }

  const referenceNameCounts = new Map<string, number>();
  for (const candidate of referenceCandidates) {
    referenceNameCounts.set(
      candidate.name,
      (referenceNameCounts.get(candidate.name) ?? 0) + 1,
    );
  }
  const usedReferenceIds = new Set(artifacts.map((artifact) => artifact.id));
  for (const candidate of referenceCandidates) {
    artifacts.push({
      id: referenceArtifactId(candidate, referenceNameCounts, usedReferenceIds),
      name: candidate.name,
      path: candidate.path,
      kind: "shared-reference",
      source: "shared-reference",
    });
  }

  return artifacts;
}

export function findArtifact(
  projectRoot: string,
  artifactId: string,
  config: QualityConfig = loadQualityConfig(projectRoot),
): ArtifactEntry | null {
  return (
    discoverArtifacts(projectRoot, config).find((a) => a.id === artifactId) ??
    null
  );
}

/**
 * Guard resolved paths before any reference include can escape its allowed root.
 */
function isPathWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  const [firstSegment] = rel.split(/[\\/]/);
  return firstSegment !== "..";
}

function readTextCapped(
  path: string,
  config: QualityConfig,
): { content: string; truncated: boolean } | null {
  if (!existsSync(path) || !isSafeEntry(path)) return null;
  const stats = statSync(path);
  if (!stats.isFile()) return null;
  const maxBytes = Math.max(0, Math.floor(config.maxArtifactBytes));
  const bytesToRead = Math.min(stats.size, maxBytes);
  const buffer = Buffer.alloc(bytesToRead);
  const fd = openSync(path, "r");
  try {
    const bytesRead = readSync(fd, buffer, 0, bytesToRead, 0);
    return {
      content: buffer.subarray(0, bytesRead).toString("utf-8"),
      truncated: stats.size > config.maxArtifactBytes,
    };
  } finally {
    closeSync(fd);
  }
}

function resolveSkillReferencePath(
  skillDir: string,
  relativeRef: string,
): string | null {
  if (relativeRef.includes("\0")) return null;
  const referenceRoot = resolve(skillDir, "references");
  const refPath = resolve(referenceRoot, relativeRef);
  if (!isPathWithin(referenceRoot, refPath)) return null;
  if (existsSync(referenceRoot) && !isSafeEntry(referenceRoot)) return null;
  if (!existsSync(refPath)) return refPath;
  try {
    const realReferenceRoot = realpathSync(referenceRoot);
    const realRefPath = realpathSync(refPath);
    if (!isPathWithin(realReferenceRoot, realRefPath)) return null;
  } catch {
    return null;
  }
  return refPath;
}

export function readArtifactContent(
  projectRoot: string,
  artifact: ArtifactEntry,
  config: QualityConfig,
): ReadContentResult {
  const fullPath = join(projectRoot, artifact.path);
  const text = readTextCapped(fullPath, config);
  if (text === null) return { content: "", notes: [] };
  return {
    content: text.content,
    notes: text.truncated
      ? [`artifact truncated at ${config.maxArtifactBytes} bytes`]
      : [],
  };
}

/**
 * Read an optional composed-context file, returning `null` when caps or safety checks reject it.
 */
function readOptionalText(path: string, config: QualityConfig): string | null {
  return readTextCapped(path, config)?.content ?? null;
}

/**
 * Measure byte caps in UTF-8 so dashboard upload limits match HTTP body limits.
 *
 * @param content - text to measure; counted as encoded UTF-8 bytes, not JS string length (UTF-16 units).
 * @returns the UTF-8 byte count - the unit every cap in this module is expressed in.
 */
export function utf8ByteLength(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}

/**
 * Truncate without splitting multibyte characters in composed scoring surfaces.
 *
 * @param content - text to truncate, iterated by Unicode code point so multibyte chars stay intact.
 * @param maxBytes - UTF-8 byte budget; negative or fractional values are floored to a non-negative cap.
 * @returns the longest whole-character prefix that fits within `maxBytes`; "" when the budget is 0.
 */
export function truncateUtf8Bytes(content: string, maxBytes: number): string {
  const cap = Math.max(0, Math.floor(maxBytes));
  let used = 0;
  let output = "";
  for (const char of content) {
    const next = utf8ByteLength(char);
    if (used + next > cap) break;
    output += char;
    used += next;
  }
  return output;
}

// eslint-disable-next-line complexity -- intentional because composition assembles preamble, conventions, and skill-local references in a fixed pipeline; each branch is a distinct artifact-class case
export function composeArtifactContent(
  projectRoot: string,
  artifact: ArtifactEntry,
  rawContent: string,
  config: QualityConfig,
  options: ComposeOptions = {},
): ComposeResult {
  if (artifact.kind === "shared-reference") {
    return {
      raw: rawContent,
      composed: rawContent,
      sources: [basename(artifact.path)],
      notes: [],
    };
  }

  const scanDisk = options.scanDisk !== false;
  const chunks: string[] = [];
  const sources: string[] = [];
  const notes: string[] = [];
  if (config.composition.skillPreamblePath) {
    const preamble = readOptionalText(
      join(projectRoot, config.composition.skillPreamblePath),
      config,
    );
    if (preamble !== null) {
      chunks.push(preamble);
      sources.push(basename(config.composition.skillPreamblePath));
    }
  }
  if (
    config.composition.skillConventionsPath &&
    /skill-conventions/i.test(rawContent)
  ) {
    const conventions = readOptionalText(
      join(projectRoot, config.composition.skillConventionsPath),
      config,
    );
    if (conventions !== null) {
      chunks.push(conventions);
      sources.push(basename(config.composition.skillConventionsPath));
    }
  }

  chunks.push(rawContent);
  sources.push("SKILL.md");

  if (scanDisk) {
    const skillDir = dirname(join(projectRoot, artifact.path));
    const seenReferences = new Set<string>();
    const refRegex = new RegExp(config.composition.skillReferencePattern, "g");
    for (const match of rawContent.matchAll(refRegex)) {
      const relativeRef = match[1];
      if (!relativeRef) continue;
      if (seenReferences.has(relativeRef)) continue;
      seenReferences.add(relativeRef);
      const refPath = resolveSkillReferencePath(skillDir, relativeRef);
      if (refPath === null) continue;
      const refContent = readOptionalText(refPath, config);
      if (refContent === null) continue;
      chunks.push(refContent);
      sources.push(`references/${relativeRef}`);
    }

    try {
      for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".md")) continue;
        if (entry.name === "SKILL.md" || entry.name === "README.md") continue;
        const filePath = join(skillDir, entry.name);
        if (!isSafeEntry(filePath)) continue;
        const content = readOptionalText(filePath, config);
        if (content === null) continue;
        chunks.push(content);
        sources.push(entry.name);
      }
    } catch {
      // Directory unreadable: ignore - composition continues with what we have.
    }
  }

  const composed = chunks.join("\n\n---\n\n");
  if (utf8ByteLength(composed) <= config.composition.maxComposedBytes) {
    return { raw: rawContent, composed, sources, notes };
  }
  notes.push(
    `composition truncated at ${Math.round(config.composition.maxComposedBytes / 1024)}KB`,
  );
  return {
    raw: rawContent,
    composed: truncateUtf8Bytes(composed, config.composition.maxComposedBytes),
    sources,
    notes,
  };
}

/**
 * Count exact Markdown heading levels so rubric section counts are deterministic.
 *
 * @param content - Markdown text; only lines beginning with the exact `#` run plus a space match.
 * @param level - heading depth to count (1 for `# `, 2 for `## `); deeper or shallower headings are ignored.
 * @returns the number of headings at exactly that level; 0 when none match (not an error).
 */
export function countHeadings(content: string, level: number): number {
  const prefix = "#".repeat(level) + " ";
  return content.split("\n").filter((l) => l.startsWith(prefix)).length;
}

/**
 * Centralise section checks so rubric regexes stay scoped to Markdown content.
 *
 * @param content - artifact text to test the section pattern against.
 * @param pattern - caller-owned regex; its flags (case, multiline) are respected as-is.
 * @returns true when the pattern matches anywhere in the content.
 */
export function hasSection(content: string, pattern: RegExp): boolean {
  return pattern.test(content);
}

/**
 * Remove frontmatter before tool-keyword scoring so version metadata cannot earn credit.
 *
 * @param content - artifact text that may open with a `---` fenced YAML frontmatter block.
 * @returns the content with a leading frontmatter block stripped; unchanged when there is none.
 */
export function stripYamlFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/u, "");
}

/**
 * Estimate token load conservatively for budget scoring without invoking a tokenizer.
 *
 * @param content - text whose token cost is being approximated for the token-budget metric.
 * @returns a rounded-up estimate using the ~4-chars-per-token heuristic; an over-estimate, not exact.
 */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

export function countSubReferences(
  projectRoot: string,
  artifact: ArtifactEntry,
): number {
  if (artifact.kind !== "skill") return 0;
  const referencesDir = join(projectRoot, dirname(artifact.path), "references");
  if (!existsSync(referencesDir) || !statSync(referencesDir).isDirectory()) {
    return 0;
  }
  return readdirSync(referencesDir)
    .filter((file) => file.endsWith(".md"))
    .filter((file) => isSafeEntry(join(referencesDir, file))).length;
}
