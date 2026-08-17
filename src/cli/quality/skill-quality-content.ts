/**
 * Filesystem-facing layer of skill-quality scoring: discovers artifacts on disk, safely reads their content under byte caps, composes the scoring
 * surface (primary skill, shared guidance, and skill-local references), and provides the small text utilities (heading counts, frontmatter stripping,
 * token estimate) the metric scorers call.
 *
 * This is the only module here that touches the filesystem, so the safety rules live here: symlinks are refused, every reference include is confined
 * to its allowed root (no `..` escape), and uploads can disable disk scanning so a user-supplied name cannot leak on-disk content into the score.
 *
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
function referenceIdSegment(pathSegment: string): string {
  return (
    pathSegment
      .replace(/^\.+\/?/u, "")
      .replace(/[^a-z0-9_-]+/giu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase() || "reference-root"
  );
}

/**
 * Build a stable artifact id for one reference file, qualifying it only when the name repeats.
 * A unique name keeps the short `reference:<name>` id so ids stay readable; only a collision pulls the directory into the id, which keeps ids stable
 * as unrelated references are added.
 *
 * @param candidate - reference file being identified
 * @param nameCounts - how many candidates share each name, deciding whether qualification is needed
 * @param usedIds - ids already taken; consulted so a qualified id still cannot collide
 * @returns the artifact id; never empty
 */
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

/**
 * Derive the canonical name for a shared reference doc.
 * Plain `*.md` files use their basename; a `README.md` only counts as a shared reference inside the `skill-quality-testing` directory (named after
 * the directory), and is ignored elsewhere so generic READMEs are not treated as references.
 *
 * @param refDir - Directory holding the reference file.
 * @param filename - The reference file's basename.
 * @returns The reference name, or `null` when the file is not a shared reference.
 */
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

/**
 * Record one skill file, folding repeat sightings of the same skill into mirror paths.
 *
 * The same skill is installed under several agent directories, so the second and later sightings become mirrors of the first rather than separate
 * artifacts the user would see duplicated.
 * Side effect: mutates the `artifactsById` map in place.
 *
 * @param projectRoot - project root that paths are made relative to
 * @param artifactsById - accumulator keyed by artifact id
 * @param name - skill name, which forms the artifact id
 * @param skillFile - absolute path to this copy of the skill
 * @param source - which walk root this copy came from
 * @returns nothing; the result is the added or extended entry
 */
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

/**
 * Annotate a skill with the agent directories it is missing from.
 * Non-skill artifacts pass through untouched, because only skills are expected to be mirrored.
 *
 * @param projectRoot - project root that expected paths are made relative to
 * @param artifact - artifact to annotate; returned unchanged when it is not a skill
 * @param config - quality config supplying the skill walk roots that should each hold a copy
 * @returns a copy carrying `missingMirrors`; empty means the skill is installed everywhere expected
 */
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

/**
 * Walk every configured skills root and fold each skill's copies into one artifact.
 *
 * The same skill is installed under several agent directories, so later sightings become mirrors of the first rather than
 * separate rows the user would see duplicated in the Skills tab.
 *
 * Unsafe entries and directories without a SKILL.md are skipped, so a stray folder never appears as an artifact.
 *
 * @param projectRoot - project being inventoried
 * @param config - quality config supplying the skills walk roots
 * @returns the discovered skills keyed by artifact id; empty means no skills are installed anywhere
 */
function collectSkillArtifacts(
  projectRoot: string,
  config: QualityConfig,
): Map<string, ArtifactEntry> {
  const artifactsById = new Map<string, ArtifactEntry>();
  for (const { dir, source } of config.walkRoots.skills) {
    const skillsDir = join(projectRoot, dir);
    // A configured root the project never created is a normal absence, not a problem to report.
    if (!existsSync(skillsDir)) continue;
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      const entryPath = join(skillsDir, entry.name);
      if (!entry.isDirectory() || !isSafeEntry(entryPath)) continue;
      const skillFile = join(entryPath, "SKILL.md");
      // A directory with no SKILL.md is not a skill, however it is named.
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
  return artifactsById;
}

/**
 * Walk every configured references root and collect the shared reference files.
 *
 * @param projectRoot - project being inventoried
 * @param config - quality config supplying the references walk roots
 * @returns the candidates in walk order; empty means the project ships no shared references
 */
function collectReferenceCandidates(
  projectRoot: string,
  config: QualityConfig,
): ReferenceCandidate[] {
  const candidates: ReferenceCandidate[] = [];
  for (const { dir } of config.walkRoots.references) {
    const refDir = join(projectRoot, dir);
    // A configured root the project never created is a normal absence.
    if (!existsSync(refDir)) continue;
    for (const entry of readdirSync(refDir, { withFileTypes: true })) {
      const filePath = join(refDir, entry.name);
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const name = sharedReferenceName(refDir, entry.name);
      // An unnameable or unsafe file cannot be shown to the user as an artifact.
      if (name === null || !isSafeEntry(filePath)) continue;
      candidates.push({ name, path: relPosix(projectRoot, filePath) });
    }
  }
  return candidates;
}

/**
 * Turn reference candidates into artifacts, qualifying an id only where the same name appears more than once.
 *
 * Counting names first is what lets unique references keep a short readable id while collisions still resolve.
 *
 * @param candidates - reference files found during the walk
 * @param takenIds - ids already used by skills, so a reference can never collide with one
 * @returns the reference artifacts, in walk order
 */
function buildReferenceArtifacts(
  candidates: ReferenceCandidate[],
  takenIds: Set<string>,
): ArtifactEntry[] {
  const nameCounts = new Map<string, number>();
  for (const candidate of candidates) {
    nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1);
  }
  return candidates.map((candidate) => ({
    id: referenceArtifactId(candidate, nameCounts, takenIds),
    name: candidate.name,
    path: candidate.path,
    kind: "shared-reference" as const,
    source: "shared-reference" as const,
  }));
}

/**
 * Inventory every skill and shared reference in a project, which is the list the Skills tab renders.
 *
 * A user reaches this by opening the Skills tab or running skill-quality scoring, asking what is actually installed here.
 *
 * @param projectRoot - project to inventory
 * @param config - quality config; defaults to the project's own loaded config
 * @returns skills first, then shared references; empty means the project has neither installed
 */
export function discoverArtifacts(
  projectRoot: string,
  config: QualityConfig = loadQualityConfig(projectRoot),
): ArtifactEntry[] {
  const skillsById = collectSkillArtifacts(projectRoot, config);
  const artifacts = Array.from(skillsById.values()).map((artifact) =>
    addMissingMirrorMetadata(projectRoot, artifact, config),
  );

  const references = buildReferenceArtifacts(
    collectReferenceCandidates(projectRoot, config),
    new Set(artifacts.map((artifact) => artifact.id)),
  );
  return [...artifacts, ...references];
}

/**
 * Find one discovered artifact by id.
 * This rediscovers every artifact per call, so callers looping over many ids should discover once and filter themselves rather than calling this
 * repeatedly.
 *
 * @param projectRoot - project root to discover artifacts in
 * @param artifactId - id to match exactly
 * @param config - quality config; defaults to the project's own loaded config
 * @returns the matching artifact, or null when no discovered artifact carries that id
 */
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

/**
 * Read at most the configured byte cap from one file, reporting whether content was cut off.
 *
 * Only the capped prefix is read rather than the whole file and then sliced, so an oversized artifact cannot force the whole file into memory.
 * Side effect: opens and closes a file descriptor.
 *
 * @param path - absolute file path to read
 * @param config - quality config supplying the maximum artifact byte cap
 * @returns the content and whether it was truncated, or null when the path is missing or unsafe
 */
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
  const fileDescriptor = openSync(path, "r");
  try {
    const bytesRead = readSync(fileDescriptor, buffer, 0, bytesToRead, 0);
    return {
      content: buffer.subarray(0, bytesRead).toString("utf-8"),
      truncated: stats.size > config.maxArtifactBytes,
    };
  } finally {
    closeSync(fileDescriptor);
  }
}

/**
 * Resolve a skill-local reference include, refusing anything that escapes the references root.
 *
 * Containment is checked twice, before and after realpath, because the first check catches traversal in the literal path and the second catches a
 * symlink pointing outside the root.
 *
 * Error behavior: throws nothing; an unresolvable path swallows the failure and reports null, so an include that cannot be proved safe is refused
 * rather than read.
 *
 * @param skillDir - directory holding the skill whose reference is being resolved
 * @param relativeRef - reference path as written in the skill; embedded NUL bytes are rejected
 * @returns the absolute path to read, or null when the reference would escape or is unsafe
 */
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

/**
 * Read one artifact's own content, capped, with a note when it was truncated.
 * An unreadable artifact yields empty content rather than an error, so scoring can still report a result for an artifact the user cannot currently
 * read.
 *
 * @param projectRoot - project root the artifact path is relative to
 * @param artifact - artifact whose file is read
 * @param config - quality config supplying the byte cap
 * @returns the content plus any truncation note; empty content means the file was missing or unsafe
 */
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

// eslint-disable-next-line complexity -- intentional because composition assembles preamble, conventions, and skill-local references in a fixed pipeline; each branch is a distinct artifact-class case, and it throws nothing because an unreadable include is dropped with a note
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

  // The artifact under review owns the bounded window. Shared guidance and references enrich any
  // remaining space but cannot displace the primary skill evidence that the score describes.
  chunks.push(rawContent);
  sources.push("SKILL.md");

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

/**
 * Count the Markdown reference files a skill would pull in alongside itself.
 * Non-skill artifacts count zero, and unsafe entries are excluded, so the count reflects what a consumer would actually load rather than everything
 * present on disk.
 *
 * @param projectRoot - project root the artifact path is relative to
 * @param artifact - artifact to count references for
 * @returns how many safe Markdown references exist; zero for non-skills or no references directory
 */
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
