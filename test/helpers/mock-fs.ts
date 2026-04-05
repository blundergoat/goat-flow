/**
 * In-memory `ReadonlyFS` implementation for unit-style scanner tests.
 * It synthesizes files, directories, and common GOAT Flow docs so extraction code can run without real I/O.
 */
import type { ReadonlyFS } from '../../src/cli/types.js';

/** Strip leading heading. */
function stripLeadingHeading(content: string): string {
  return content.replace(/^# [^\n]+\n+/m, '').trim();
}

const LEGACY_FOOTGUNS_FILE = ['docs', 'footguns.md'].join('/');
const LEGACY_LESSONS_FILE = ['docs', 'lessons.md'].join('/');
const LEGACY_FOOTGUNS_DIR = ['ai-docs', 'footguns/'].join('/');
const LEGACY_LESSONS_DIR = ['ai-docs', 'lessons/'].join('/');

/** Convert a label into a slug-safe file name fragment. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

/** Generate a unique markdown filename within a synthetic fixture directory. */
function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  const stem = base.replace(/\.md$/, '');
  let suffix = 2;
  while (used.has(`${stem}-${suffix}.md`)) suffix += 1;
  const name = `${stem}-${suffix}.md`;
  used.add(name);
  return name;
}

/** Split a legacy footguns document into a preamble and per-entry sections. */
function splitLegacyFootgunDir(content: string): {
  preamble: string;
  entries: string[];
} {
  const firstIndex = content.search(/^##\s*Footgun:/m);
  const preamble =
    firstIndex >= 0 ? content.slice(0, firstIndex).trim() : '# Footguns';

  if (firstIndex < 0) {
    return {
      preamble: preamble || '# Footguns',
      entries: [content],
    };
  }

  const raw = content
    .slice(firstIndex)
    .split(/^##\s*Footgun:\s*/m)
    .filter(Boolean);
  return {
    preamble: preamble || '# Footguns',
    entries: raw,
  };
}

/** Split a legacy lessons document into a preamble and per-entry sections. */
function splitLegacyLessonDir(content: string): {
  preamble: string;
  entries: { heading: string; body: string; isPattern: boolean }[];
} {
  const entriesIndex = content.search(/^##\s*Entries\b/im);
  const preamble =
    entriesIndex >= 0 ? content.slice(0, entriesIndex).trim() : '# Lessons';
  const source = entriesIndex >= 0 ? content.slice(entriesIndex) : content;
  const headings = [...source.matchAll(/^###\s+(.+)$/gm)];
  if (headings.length === 0) {
    return {
      preamble: preamble || '# Lessons',
      entries: [
        { heading: 'Legacy lesson fixture', body: source, isPattern: false },
      ],
    };
  }

  const blocks: { heading: string; body: string; isPattern: boolean }[] = [];
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const next = headings[i + 1];
    if (!current[1]) continue;
    const heading = current[1].trim();
    const start = current.index + current[0].length;
    const end = next?.index ?? source.length;
    const body = source.slice(start, end).trim();
    blocks.push({
      heading,
      body,
      isPattern: /^Pattern:\s*/i.test(heading),
    });
  }

  if (blocks.length === 0) {
    return {
      preamble: preamble || '# Lessons',
      entries: [
        { heading: 'Legacy lesson fixture', body: source, isPattern: false },
      ],
    };
  }

  return {
    preamble: preamble || '# Lessons',
    entries: blocks,
  };
}

/** Expand legacy monolithic learning-loop files into synthetic directory contents when needed. */
function maybeSplitLegacyLearningLoopFolders(
  files: Record<string, string>,
): Record<string, string> {
  const split = { ...files };
  /** Detect whether the synthetic fixture already contains nested paths for a directory. */
  const hasNestedPath = (dir: string): boolean => {
    return Object.keys(split).some(
      (key) => key.startsWith(dir) && key.length > dir.length,
    );
  };

  if (split[LEGACY_FOOTGUNS_DIR] && !hasNestedPath(LEGACY_FOOTGUNS_DIR)) {
    const raw = split[LEGACY_FOOTGUNS_DIR];
    const looksLikeLegacyFootgunDir =
      raw.includes('## Footgun:') ||
      raw.includes('**Evidence') ||
      raw.includes('`') ||
      /lines?\s+[0-9]+/i.test(raw);

    if (raw && looksLikeLegacyFootgunDir) {
      const used = new Set<string>();
      const { preamble, entries } = splitLegacyFootgunDir(raw);
      split[`${LEGACY_FOOTGUNS_DIR}README.md`] = preamble || '# Footguns';

      for (const rawEntry of entries) {
        const firstLineEnd = rawEntry.indexOf('\n');
        const nameRaw =
          firstLineEnd >= 0
            ? rawEntry.slice(0, firstLineEnd).trim()
            : 'Legacy footgun fixture';
        const name = nameRaw || 'Legacy footgun fixture';
        let body =
          firstLineEnd >= 0 ? rawEntry.slice(firstLineEnd + 1) : rawEntry;
        const statusMatch = body.match(/^\*\*Status:\*\*\s*(.+)\n?/im);
        const createdMatch = body.match(/^\*\*Created:\*\*\s*(.+)\n?/im);
        const evidenceMatch = body.match(/^\*\*Evidence type:\*\*\s*(.+)\n?/im);
        const status = statusMatch?.[1]
          ?.trim()
          .toLowerCase()
          .startsWith('resolved')
          ? 'resolved'
          : 'active';
        const created = createdMatch?.[1]?.trim() ?? '';
        const evidenceType = evidenceMatch?.[1]?.trim();

        body = body
          .replace(/^\*\*Status:\*\*.*/im, '')
          .replace(/^\*\*Created:\*\*.+/im, '')
          .replace(/^\*\*Evidence type:\*\*.+/im, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        const frontmatter = [
          '---',
          `name: ${name}`,
          `status: ${status}`,
          ...(created ? [`created: ${created}`] : []),
          ...(evidenceType ? [`evidence_type: ${evidenceType}`] : []),
          '---',
          '',
        ].join('\n');
        const file = uniqueName(`${slugify(name)}.md`, used);
        split[`${LEGACY_FOOTGUNS_DIR}${file}`] =
          `${frontmatter}${body ? `${body}\n` : ''}`.trimEnd() + '\n';
      }
      delete split[LEGACY_FOOTGUNS_DIR];
    }
  }

  if (split[LEGACY_LESSONS_DIR] && !hasNestedPath(LEGACY_LESSONS_DIR)) {
    const raw = split[LEGACY_LESSONS_DIR];
    if (raw) {
      const used = new Set<string>();
      const parsed = splitLegacyLessonDir(raw);
      const preamble = parsed.preamble || '# Lessons';
      split[`${LEGACY_LESSONS_DIR}README.md`] = preamble;

      for (const entry of parsed.entries) {
        const heading =
          entry.heading.replace(/^Pattern:\s*/i, '').trim() ||
          'Legacy lesson fixture';
        let body = entry.body;
        const createdMatch =
          body.match(/^\*\*created_at:\*\*\s*(.+)\n?/im) ??
          body.match(/^created_at:\s*(.+)\n?/im);
        const created = createdMatch?.[1]?.trim() ?? '';
        const file = entry.isPattern
          ? `pattern-${slugify(heading)}.md`
          : `${created ? `${created}-` : 'unknown-'}${slugify(heading)}.md`;
        const frontmatter = [
          '---',
          `name: ${heading}`,
          ...(created ? [`created: ${created}`] : []),
          ...(entry.isPattern ? ['type: pattern'] : []),
          '---',
          '',
        ].join('\n');

        body = body
          .replace(/^\*\*created_at:\*\*.+/im, '')
          .replace(/^created_at:\s*.+/im, '')
          .replace(/^_Entries:\s*.+_/im, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        const filename = uniqueName(file, used);
        split[`${LEGACY_LESSONS_DIR}${filename}`] =
          `${frontmatter}${body ? `${body}\n` : ''}`.trimEnd() + '\n';
      }
      delete split[LEGACY_LESSONS_DIR];
    }
  }

  return split;
}

/** Infer which agents are present from synthetic instruction and config files. */
function detectAgents(files: Record<string, string>): string[] {
  const agents: string[] = [];
  if (
    'CLAUDE.md' in files ||
    Object.keys(files).some((k) => k.startsWith('.claude/'))
  )
    agents.push('claude');
  if (
    'AGENTS.md' in files ||
    Object.keys(files).some((k) => k.startsWith('.agents/'))
  )
    agents.push('codex');
  if (
    'GEMINI.md' in files ||
    Object.keys(files).some((k) => k.startsWith('.gemini/'))
  )
    agents.push('gemini');
  return agents;
}

/** Expand legacy learning-loop fixtures into the current directory-based layout. */
function normalizeLearningLoop(
  files: Record<string, string>,
): Record<string, string> {
  const normalized = maybeSplitLegacyLearningLoopFolders({ ...files });

  if (
    normalized[LEGACY_FOOTGUNS_FILE] &&
    !Object.keys(normalized).some((k) => k.startsWith('ai-docs/footguns/'))
  ) {
    normalized['ai-docs/footguns/README.md'] =
      '# Footguns\n\nLegacy test fixture imported into directory layout.\n';
    normalized['ai-docs/footguns/legacy-entry.md'] =
      `---\nname: Legacy footgun fixture\nstatus: active\ncreated: 2026-01-01\nevidence_type: ACTUAL_MEASURED\n---\n\n${stripLeadingHeading(normalized[LEGACY_FOOTGUNS_FILE])}\n`;
  }

  if (
    normalized[LEGACY_LESSONS_FILE] &&
    !Object.keys(normalized).some((k) => k.startsWith('ai-docs/lessons/'))
  ) {
    normalized['ai-docs/lessons/README.md'] =
      '# Lessons\n\nLegacy test fixture imported into directory layout.\n';
    normalized['ai-docs/lessons/legacy-entry.md'] =
      `---\nname: Legacy lesson fixture\ncreated: 2026-01-01\n---\n\n${stripLeadingHeading(normalized[LEGACY_LESSONS_FILE])}\n`;
  }

  const hasLearningLoop =
    Object.keys(normalized).some((k) => k.startsWith('ai-docs/footguns/')) ||
    Object.keys(normalized).some((k) => k.startsWith('ai-docs/lessons/'));

  if (hasLearningLoop && !('.goat-flow/config.yaml' in normalized)) {
    const agents = detectAgents(normalized);
    normalized['.goat-flow/config.yaml'] = [
      'version: "1.0.0"',
      'footguns:',
      '  committed: ai-docs/footguns/',
      '  local: .goat-flow/footguns/',
      'lessons:',
      '  committed: ai-docs/lessons/',
      '  local: .goat-flow/lessons/',
      'decisions:',
      '  path: ai-docs/decisions/',
      'tasks:',
      '  path: .goat-flow/tasks/',
      ...(agents.length > 0
        ? ['agents:', ...agents.map((agent) => `  - ${agent}`)]
        : []),
      'skills:',
      '  install: all',
      '',
    ].join('\n');
  }

  return normalized;
}

/**
 * In-memory filesystem for unit testing. No disk access.
 */
export function createMockFS(files: Record<string, string>): ReadonlyFS {
  const fileMap = new Map(Object.entries(normalizeLearningLoop(files)));

  /** Check whether any synthetic files live underneath the requested directory prefix. */
  function hasDirEntries(dir: string): boolean {
    const prefix = dir.endsWith('/') ? dir : dir + '/';
    for (const key of fileMap.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  return {
    /** Report whether a file or synthetic directory exists in the fixture tree. */
    exists(path: string): boolean {
      return fileMap.has(path) || hasDirEntries(path);
    },

    /** Read a UTF-8 file from the synthetic fixture tree. */
    readFile(path: string): string | null {
      return fileMap.get(path) ?? null;
    },

    /** Count newline-delimited lines in a synthetic fixture file. */
    lineCount(path: string): number {
      const content = fileMap.get(path);
      if (!content) return 0;
      return content.split('\n').length;
    },

    /** Parse a synthetic JSON file, returning null on missing or invalid input. */
    readJson(path: string): unknown | null {
      const content = fileMap.get(path);
      if (!content) return null;
      try {
        return JSON.parse(content);
      } catch {
        return null;
      }
    },

    /** List direct child entries under a synthetic directory path. */
    listDir(path: string): string[] {
      const prefix = path.endsWith('/') ? path : path + '/';
      const entries = new Set<string>();
      for (const key of fileMap.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const firstPart = rest.split('/')[0];
          if (firstPart) entries.add(firstPart);
        }
      }
      return [...entries];
    },

    /** Treat shebang-prefixed fixture files as executable for hook tests. */
    isExecutable(path: string): boolean {
      const content = fileMap.get(path);
      if (!content) return false;
      return content.startsWith('#!');
    },

    /** Expand a simplified glob pattern over the synthetic fixture file map. */
    glob(pattern: string): string[] {
      const regex = new RegExp(
        '^' +
          pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '{{GLOBSTAR}}')
            .replace(/\*/g, '[^/]*')
            .replace(/\{\{GLOBSTAR\}\}/g, '.*') +
          '$',
      );
      return [...fileMap.keys()].filter((key) => regex.test(key));
    },
  };
}
