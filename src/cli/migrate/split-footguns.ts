import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { dump, load } from 'js-yaml';

interface MigrationResult {
  fileCount: number;
  files: string[];
  warnings: string[];
}

interface FootgunEntry {
  name: string;
  filename: string;
  evidenceType: string;
  status: string;
  created: string;
  body: string;
}

interface ParsedFootgunMetadata {
  evidenceType: string;
  status: string;
  created: string;
  body: string;
}

interface MergedFootgunEntry {
  name: string;
  created: string;
  evidenceType: string;
  status: string;
  body: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function uniqueFilename(baseName: string, used: Set<string>): string {
  if (!used.has(baseName)) {
    used.add(baseName);
    return baseName;
  }

  const stem = baseName.replace(/\.md$/, '');
  let counter = 2;
  while (used.has(`${stem}-${counter}.md`)) counter++;
  const next = `${stem}-${counter}.md`;
  used.add(next);
  return next;
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

function parseFootgunMetadata(body: string): ParsedFootgunMetadata {
  const evidenceMatch = body.match(/^\*\*Evidence type:\*\*\s*(.+)\n?/m);
  const statusMatch = body.match(/^\*\*Status:\*\*\s*(.+)\n?/m);
  const createdMatch = body.match(/^\*\*Created:\*\*\s*(.+)\n?/m);
  const cleanedBody = body
    .replace(/^\*\*Evidence type:\*\*.+\n?/m, '')
    .replace(/^\*\*Status:\*\*.+\n?/m, '')
    .replace(/^\*\*Created:\*\*.+\n?/m, '')
    .replace(/\n{3,}/g, '\n\n');

  return {
    evidenceType: evidenceMatch?.[1]?.trim() ?? '',
    status: statusMatch?.[1]?.trim() ?? 'active',
    created: createdMatch?.[1]?.trim() ?? '',
    body: trimBody(cleanedBody),
  };
}

function normalizeFootgunStatus(status: string): string {
  return status.toLowerCase().startsWith('resolved') ? 'resolved' : 'active';
}

function parseRawFootgunEntry(rawEntry: string, used: Set<string>, warnings: string[]): FootgunEntry {
  const newline = rawEntry.indexOf('\n');
  const name = (newline >= 0 ? rawEntry.slice(0, newline) : rawEntry).trim();
  const rawBody = newline >= 0 ? rawEntry.slice(newline + 1) : '';
  const metadata = parseFootgunMetadata(rawBody);

  if (!metadata.created) warnings.push(`Footgun "${name}" has no Created date`);
  if (!metadata.body.trim()) warnings.push(`Footgun "${name}" has empty body after metadata extraction`);

  return {
    name,
    filename: uniqueFilename(`${slugify(name)}.md`, used),
    evidenceType: metadata.evidenceType,
    status: normalizeFootgunStatus(metadata.status),
    created: metadata.created,
    body: metadata.body,
  };
}

function parseFootgunEntries(content: string, warnings: string[]): { preamble: string; entries: FootgunEntry[] } {
  const firstIndex = content.search(/^## Footgun:\s+/m);
  const preamble = firstIndex >= 0 ? content.slice(0, firstIndex) : content;
  if (firstIndex < 0) return { preamble, entries: [] };

  const rawEntries = content.slice(firstIndex).split(/^## Footgun:\s+/m).filter(Boolean);
  const used = new Set<string>();
  const entries = rawEntries.map(rawEntry => parseRawFootgunEntry(rawEntry, used, warnings));

  return { preamble, entries };
}

export function splitFootguns(inputPath: string, outputDir: string): MigrationResult {
  const content = readFileSync(inputPath, 'utf8');
  const warnings: string[] = [];
  const { preamble, entries } = parseFootgunEntries(content, warnings);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'README.md'), preamble.trimEnd() + '\n');

  const files = ['README.md'];
  for (const entry of entries) {
    const frontmatter = renderFrontmatter({
      name: entry.name,
      status: entry.status,
      created: entry.created,
      evidence_type: entry.evidenceType,
    });
    writeFileSync(join(outputDir, entry.filename), frontmatter + entry.body);
    files.push(entry.filename);
  }

  return { fileCount: entries.length, files, warnings };
}

function listMarkdownFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(file => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b));
}

function readFootgunPreamble(inputDir: string, files: string[]): string {
  return files.includes('README.md')
    ? readFileSync(join(inputDir, 'README.md'), 'utf8').trimEnd()
    : '# Footguns';
}

function readMergedFootgunEntry(inputDir: string, file: string): MergedFootgunEntry {
  const { data, body } = parseFrontmatter(readFileSync(join(inputDir, file), 'utf8'));
  return {
    name: typeof data.name === 'string' ? data.name : basename(file, '.md'),
    created: typeof data.created === 'string' ? data.created : '',
    evidenceType: typeof data.evidence_type === 'string' ? data.evidence_type : '',
    status: typeof data.status === 'string' ? data.status : 'active',
    body: body.trimEnd(),
  };
}

function buildFootgunSection(entry: MergedFootgunEntry, file: string, warnings: string[]): string {
  if (!entry.created) warnings.push(`Footgun file "${file}" has no created date`);

  const lines: string[] = [`## Footgun: ${entry.name}`, ''];
  if (entry.evidenceType) {
    lines.push(`**Evidence type:** ${entry.evidenceType}`);
    lines.push('');
  }
  if (entry.status && entry.status !== 'active') {
    lines.push(`**Status:** ${entry.status.toUpperCase() === 'RESOLVED' ? 'RESOLVED' : entry.status}`);
    lines.push('');
  }
  lines.push(entry.body);
  if (entry.created) {
    lines.push('');
    lines.push(`**Created:** ${entry.created}`);
  }

  return lines.join('\n');
}

export function mergeFootguns(inputDir: string, outputPath: string): MigrationResult {
  const files = listMarkdownFiles(inputDir);
  const preamble = readFootgunPreamble(inputDir, files);
  const entryFiles = files.filter(file => file !== 'README.md');
  const sections: string[] = [preamble];
  const warnings: string[] = [];

  for (const file of entryFiles) {
    const entry = readMergedFootgunEntry(inputDir, file);
    sections.push(buildFootgunSection(entry, file, warnings));
  }

  const merged = sections.filter(Boolean).join('\n\n') + '\n';
  writeFileSync(outputPath, merged);
  return { fileCount: entryFiles.length, files, warnings };
}
