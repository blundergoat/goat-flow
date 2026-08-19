/**
 * Splits a footgun bucket into its individual `## Footgun:` sections and audits each one's structure: that a Status field exists and is canonical,
 * that active entries sit above the `## Resolved Entries` marker (and resolved entries below it), that active entries carry file:line or `(search:
 * ...)` evidence, and that they do not cite retired-file evidence.
 *
 * This is the schema enforcer behind the footguns README contract: section order, the active/resolved boundary, and the evidence requirement are the
 * invariants a reviewer relies on.
 * It only reports diagnostic strings; it never mutates the bucket or throws on malformed input.
 */
import {
  EVIDENCE_PATTERN,
  parseMarkdownFrontmatter,
  stripStrikethrough,
} from "./learning-loop-common.js";

/** Parsed `## Footgun:` section with status metadata for entry extraction. */
export interface FootgunSection {
  title: string;
  start: number;
  content: string;
  status: string | null;
}

/**
 * Slice a footgun bucket body at each `## Footgun:` heading into discrete sections, capturing each section's source offset (so callers can compare it
 * against the resolved marker) and its lowercased Status value.
 *
 * @param body - bucket markdown with frontmatter already stripped; section bounds run heading-to-next-heading
 * @returns one section per heading in document order; status is null when the section has no Status field
 */
export function splitFootgunSections(body: string): FootgunSection[] {
  const headings = Array.from(
    body.matchAll(/^##\s+Footgun:\s+(.+)$/gm),
    (match) => ({
      title: (match[1] ?? "").trim(),
      start: match.index,
    }),
  );
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.start ?? body.length;
    const content = body.slice(heading.start, end);
    const statusMatch = content.match(/\*\*Status:\*\*\s*([^|\n]+)/i);
    return {
      title: heading.title,
      start: heading.start,
      content,
      status:
        statusMatch?.[1] !== undefined
          ? statusMatch[1].trim().toLowerCase()
          : null,
    };
  });
}

/** Detect whether a footgun section has file:line or (search: ...) evidence. */
function hasSectionEvidence(content: string): boolean {
  return EVIDENCE_PATTERN.test(content) || /\(search:/i.test(content);
}

/** Check one active footgun section for placement, evidence, and retired-file patterns. */
function diagnoseActiveSection(
  section: FootgunSection,
  path: string,
  resolvedIndex: number,
): string[] {
  const out: string[] = [];
  if (resolvedIndex !== -1 && section.start > resolvedIndex) {
    out.push(
      `${path} has active footgun "${section.title}" below ## Resolved Entries`,
    );
  }
  if (!hasSectionEvidence(section.content)) {
    out.push(
      `${path} active footgun "${section.title}" missing file:line or (search: ...) evidence`,
    );
  }
  const cleaned = stripStrikethrough(section.content);
  if (/\(file retired/i.test(cleaned) || /\bretired in v\d/i.test(cleaned)) {
    out.push(
      `${path} active footgun "${section.title}" uses retired-file evidence`,
    );
  }
  return out;
}

/** Check that resolved footguns live below the bucket's resolved marker. */
function diagnoseResolvedSection(
  section: FootgunSection,
  path: string,
  resolvedIndex: number,
): string[] {
  if (resolvedIndex === -1) {
    return [
      `${path} has resolved footgun "${section.title}" but no ## Resolved Entries marker`,
    ];
  }
  if (section.start < resolvedIndex) {
    return [
      `${path} has resolved footgun "${section.title}" above ## Resolved Entries`,
    ];
  }
  return [];
}

/** Check one footgun section's schema + (if active) its placement and evidence. */
function diagnoseFootgunSection(
  section: FootgunSection,
  path: string,
  resolvedIndex: number,
): string[] {
  if (section.status === null) {
    return [`${path} footgun "${section.title}" missing Status field`];
  }
  // Schema: status must be exactly "active" or "resolved" (machine-simple per footguns/README.md:14)
  if (section.status !== "active" && section.status !== "resolved") {
    return [
      `${path} footgun "${section.title}" has non-canonical status "${section.status}" (expected "active" or "resolved")`,
    ];
  }
  if (section.status === "active") {
    return diagnoseActiveSection(section, path, resolvedIndex);
  }
  return diagnoseResolvedSection(section, path, resolvedIndex);
}

/**
 * Audit one footgun bucket and return every structure, schema, and evidence violation as a human-readable diagnostic.
 * The path is woven into each message so a caller aggregating many buckets can attribute findings without extra state.
 *
 * @param path - bucket path used to prefix each diagnostic for attribution
 * @param content - raw bucket file content; frontmatter is parsed off internally
 * @returns one diagnostic per violation; an empty array means the bucket is well-formed
 */
export function collectFootgunStructureDiagnostics(
  path: string,
  content: string,
): string[] {
  const { body } = parseMarkdownFrontmatter(content);
  const resolvedIndex = body.indexOf("## Resolved Entries");
  const sections = splitFootgunSections(body);
  return sections.flatMap((section) =>
    diagnoseFootgunSection(section, path, resolvedIndex),
  );
}
