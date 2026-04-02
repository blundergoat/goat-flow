import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { dump, load } from 'js-yaml';

interface MigrationResult {
  fileCount: number;
  files: string[];
  warnings: string[];
}

interface LessonEntry {
  name: string;
  filename: string;
  created: string;
  type: 'entry' | 'pattern';
  related: string[];
  body: string;
}

interface ParsedLessonEntry {
  name: string;
  created: string;
  type: 'entry' | 'pattern';
  body: string;
  relatedNames: string[];
}

interface MergedLessonEntry {
  name: string;
  created: string;
  type: 'entry' | 'pattern';
  related: unknown[];
  body: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function trimBody(body: string): string {
  return body.replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  const frontmatter = match[1] ?? '';
  const parsed = load(frontmatter) as Record<string, unknown> | null;
  return { data: parsed ?? {}, body: match[2] ?? '' };
}

function renderFrontmatter(data: Record<string, unknown>): string {
  return `---\n${dump(data, { lineWidth: -1 }).trimEnd()}\n---\n\n`;
}

function entryFilename(created: string, name: string): string {
  const slug = slugify(name);
  return created ? `${created}-${slug}.md` : `unknown-${slug}.md`;
}

interface RawLessonBlock {
  heading: string;
  section: 'entries' | 'patterns';
  rawBody: string;
}

function collectLessonBlocks(body: string): RawLessonBlock[] {
  const blocks: RawLessonBlock[] = [];
  let section: 'entries' | 'patterns' = 'entries';
  let heading = '';
  let rawBody: string[] = [];

  const flush = (): void => {
    if (!heading) return;
    blocks.push({
      heading,
      section,
      rawBody: rawBody.join('\n'),
    });
  };

  for (const line of body.split('\n')) {
    if (/^##\s+Entries\s*$/i.test(line)) {
      flush();
      section = 'entries';
      heading = '';
      rawBody = [];
      continue;
    }

    if (/^##\s+Patterns\s*$/i.test(line)) {
      flush();
      section = 'patterns';
      heading = '';
      rawBody = [];
      continue;
    }

    const headingMatch = line.match(/^###\s+(.+)$/);
    if (headingMatch) {
      flush();
      heading = headingMatch[1]?.trim() ?? '';
      rawBody = [];
      continue;
    }

    if (heading) rawBody.push(line);
  }

  flush();
  return blocks;
}

function extractLessonMetadata(rawBody: string): Pick<ParsedLessonEntry, 'created' | 'body' | 'relatedNames'> {
  const createdMatch = rawBody.match(/^\*\*created_at:\*\*\s*(.+)\n?/im) ?? rawBody.match(/^created_at:\s*(.+)\n?/im);
  const relatedMatch = rawBody.match(/^_Entries:\s*(.+)_\n?/m);
  const relatedNames = relatedMatch?.[1]
    ? Array.from(relatedMatch[1].matchAll(/"([^"]+)"/g)).map(match => match[1] ?? '').filter(Boolean)
    : [];
  const body = rawBody
    .replace(/^\*\*created_at:\*\*.+\n?/im, '')
    .replace(/^created_at:\s*.+\n?/im, '')
    .replace(/^_Entries:\s*.+_\n?/m, '')
    .replace(/\n{3,}/g, '\n\n');

  return {
    created: createdMatch?.[1]?.trim() ?? '',
    body: trimBody(body),
    relatedNames,
  };
}

function parseLessonBlock(block: RawLessonBlock, warnings: string[]): ParsedLessonEntry | null {
  const heading = block.heading.trim();
  if (!heading) return null;

  const isPattern = block.section === 'patterns' || heading.startsWith('Pattern:');
  const name = isPattern ? heading.replace(/^Pattern:\s*/, '').trim() : heading;
  const metadata = extractLessonMetadata(block.rawBody);

  if (!metadata.created) warnings.push(`Lesson "${name}" has no created_at date`);
  if (!metadata.body.trim()) warnings.push(`Lesson "${name}" has empty body after metadata extraction`);

  return {
    name,
    created: metadata.created,
    type: isPattern ? 'pattern' : 'entry',
    body: metadata.body,
    relatedNames: metadata.relatedNames,
  };
}

function buildLessonNameMap(entries: ParsedLessonEntry[]): Map<string, string> {
  return new Map(
    entries
      .filter(entry => entry.type === 'entry')
      .map(entry => [entry.name, entryFilename(entry.created, entry.name)]),
  );
}

function resolveRelatedLessonFiles(
  entry: ParsedLessonEntry,
  byName: Map<string, string>,
  warnings: string[],
): string[] {
  const related: string[] = [];

  for (const name of entry.relatedNames) {
    const mapped = byName.get(name);
    if (!mapped) {
      warnings.push(`Pattern "${entry.name}" could not match related lesson "${name}"`);
      continue;
    }
    related.push(mapped);
  }

  return related;
}

function toLessonEntry(entry: ParsedLessonEntry, byName: Map<string, string>, warnings: string[]): LessonEntry {
  return {
    name: entry.name,
    filename: entry.type === 'pattern'
      ? `pattern-${slugify(entry.name)}.md`
      : entryFilename(entry.created, entry.name),
    created: entry.created,
    type: entry.type,
    related: resolveRelatedLessonFiles(entry, byName, warnings),
    body: entry.body,
  };
}

function parseLessons(content: string, warnings: string[]): { preamble: string; entries: LessonEntry[] } {
  const entriesIndex = content.search(/^## Entries\s*$/m);
  const preamble = entriesIndex >= 0 ? content.slice(0, entriesIndex) : content;
  if (entriesIndex < 0) return { preamble, entries: [] };

  const body = content.slice(entriesIndex);
  const parsed: ParsedLessonEntry[] = [];
  for (const block of collectLessonBlocks(body)) {
    const entry = parseLessonBlock(block, warnings);
    if (entry) parsed.push(entry);
  }

  const byName = buildLessonNameMap(parsed);
  const entries = parsed.map(entry => toLessonEntry(entry, byName, warnings));

  return { preamble, entries };
}

export function splitLessons(inputPath: string, outputDir: string): MigrationResult {
  const content = readFileSync(inputPath, 'utf8');
  const warnings: string[] = [];
  const { preamble, entries } = parseLessons(content, warnings);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'README.md'), preamble.trimEnd() + '\n');

  const files = ['README.md'];
  for (const entry of entries) {
    const frontmatter: Record<string, unknown> = {
      name: entry.name,
      created: entry.created,
    };
    if (entry.type === 'pattern') frontmatter.type = 'pattern';
    if (entry.related.length > 0) frontmatter.related = entry.related;
    writeFileSync(join(outputDir, entry.filename), renderFrontmatter(frontmatter) + entry.body);
    files.push(entry.filename);
  }

  return { fileCount: entries.length, files, warnings };
}

function listMarkdownFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(file => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b));
}

function readLessonsPreamble(inputDir: string, files: string[]): string {
  return files.includes('README.md')
    ? readFileSync(join(inputDir, 'README.md'), 'utf8').trimEnd()
    : '# Lessons';
}

function buildLessonNameIndex(inputDir: string, entryFiles: string[]): Map<string, string> {
  const entryNameByFile = new Map<string, string>();

  for (const file of entryFiles) {
    const { data } = parseFrontmatter(readFileSync(join(inputDir, file), 'utf8'));
    if (typeof data.name === 'string') entryNameByFile.set(file, data.name);
  }

  return entryNameByFile;
}

function readMergedLessonEntry(inputDir: string, file: string): MergedLessonEntry {
  const { data, body } = parseFrontmatter(readFileSync(join(inputDir, file), 'utf8'));
  return {
    name: typeof data.name === 'string' ? data.name : basename(file, '.md'),
    created: typeof data.created === 'string' ? data.created : '',
    type: data.type === 'pattern' ? 'pattern' : 'entry',
    related: Array.isArray(data.related) ? data.related : [],
    body: body.trimEnd(),
  };
}

function mapRelatedLessonNames(related: unknown[], entryNameByFile: Map<string, string>): string[] {
  return related
    .map(item => typeof item === 'string' ? entryNameByFile.get(item) ?? item : '')
    .filter(Boolean)
    .map(item => `"${item}"`);
}

function buildMergedLessonSection(
  entry: MergedLessonEntry,
  file: string,
  entryNameByFile: Map<string, string>,
  warnings: string[],
): { section: string; type: MergedLessonEntry['type'] } {
  const lines: string[] = [`### ${entry.type === 'pattern' ? `Pattern: ${entry.name}` : entry.name}`];
  const relatedNames = entry.type === 'pattern' ? mapRelatedLessonNames(entry.related, entryNameByFile) : [];

  if (relatedNames.length > 0) {
    lines.push(`_Entries: ${relatedNames.join(', ')}_`);
    lines.push('');
  }
  lines.push(entry.body);
  if (entry.created) {
    lines.push('');
    lines.push(`**created_at:** ${entry.created}`);
  } else {
    warnings.push(`Lesson file "${file}" has no created date`);
  }

  return { section: lines.join('\n'), type: entry.type };
}

export function mergeLessons(inputDir: string, outputPath: string): MigrationResult {
  const files = listMarkdownFiles(inputDir);
  const preamble = readLessonsPreamble(inputDir, files);
  const entryFiles = files.filter(file => file !== 'README.md');
  const entrySections: string[] = [];
  const patternSections: string[] = [];
  const warnings: string[] = [];
  const entryNameByFile = buildLessonNameIndex(inputDir, entryFiles);

  for (const file of entryFiles) {
    const entry = readMergedLessonEntry(inputDir, file);
    const section = buildMergedLessonSection(entry, file, entryNameByFile, warnings);
    if (section.type === 'pattern') patternSections.push(section.section);
    else entrySections.push(section.section);
  }

  const parts = [preamble, '## Entries', ...entrySections];
  if (patternSections.length > 0) {
    parts.push('## Patterns', ...patternSections);
  }
  writeFileSync(outputPath, parts.filter(Boolean).join('\n\n') + '\n');
  return { fileCount: entryFiles.length, files, warnings };
}
