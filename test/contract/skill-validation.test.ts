/**
 * Validates the integrity of installed skill files at .claude/skills/goat-*\/SKILL.md.
 * Checks: no deleted skill references, valid YAML frontmatter, version tags match RUBRIC_VERSION.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const SKILLS_DIR = join(ROOT, '.claude/skills');

const DELETED_SKILLS = [
  'goat-investigate',
  'goat-onboard',
  'goat-reflect',
  'goat-resume',
  'goat-audit',
];

const EXPECTED_SKILLS = [
  'goat',
  'goat-debug',
  'goat-plan',
  'goat-review',
  'goat-security',
  'goat-test',
];

/** Read a SKILL.md file and extract its YAML frontmatter. */
function extractFrontmatter(content: string): {
  raw: string;
  fields: Map<string, string>;
} {
  const fields = new Map<string, string>();
  if (!content.startsWith('---')) return { raw: '', fields };

  const endIndex = content.indexOf('---', 3);
  if (endIndex < 0) return { raw: '', fields };

  const raw = content.slice(3, endIndex).trim();
  for (const line of raw.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line
        .slice(colonIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      fields.set(key, value);
    }
  }
  return { raw, fields };
}

/** Get all installed goat-* skill directories. */
function getInstalledSkillDirs(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR).filter(
    (d) => d.startsWith('goat') && existsSync(join(SKILLS_DIR, d, 'SKILL.md')),
  );
}

// ---------------------------------------------------------------
// 1. All expected skills are installed
// ---------------------------------------------------------------
describe('Installed skill inventory', () => {
  const installed = getInstalledSkillDirs();

  for (const skill of EXPECTED_SKILLS) {
    it(`${skill} is installed`, () => {
      assert.ok(
        installed.includes(skill),
        `Expected skill ${skill} to be installed at .claude/skills/${skill}/SKILL.md`,
      );
    });
  }
});

// ---------------------------------------------------------------
// 2. No installed skill references deleted skill names
// ---------------------------------------------------------------
describe('No references to deleted skills in installed skills', () => {
  const installed = getInstalledSkillDirs();

  for (const dir of installed) {
    const skillPath = join(SKILLS_DIR, dir, 'SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');

    for (const deleted of DELETED_SKILLS) {
      it(`${dir}/SKILL.md does not reference ${deleted}`, () => {
        assert.ok(
          !content.includes(deleted),
          `${dir}/SKILL.md still references deleted skill "${deleted}"`,
        );
      });
    }
  }
});

// ---------------------------------------------------------------
// 3. All installed skills have valid YAML frontmatter
// ---------------------------------------------------------------
describe('Installed skills have valid YAML frontmatter', () => {
  const installed = getInstalledSkillDirs();

  for (const dir of installed) {
    const skillPath = join(SKILLS_DIR, dir, 'SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');

    it(`${dir}/SKILL.md starts with YAML frontmatter`, () => {
      assert.ok(
        content.startsWith('---'),
        `${dir}/SKILL.md should start with YAML frontmatter delimiter`,
      );
    });

    it(`${dir}/SKILL.md has closing frontmatter delimiter`, () => {
      const endIdx = content.indexOf('---', 3);
      assert.ok(
        endIdx > 3,
        `${dir}/SKILL.md should have closing frontmatter delimiter`,
      );
    });

    it(`${dir}/SKILL.md does not have duplicate frontmatter blocks`, () => {
      // Count YAML frontmatter blocks (--- pairs). Skill files may contain
      // --- inside code fences or markdown tables, so only flag if we see
      // more than one frontmatter opening (--- at the very start of the file
      // counts as one block; a second --- later that is ALSO preceded by a
      // blank line + followed by key: value lines would be a duplicate).
      // Simple heuristic: the file should start with --- and have exactly
      // one closing --- before the first heading.
      const firstHeading = content.indexOf('\n#');
      const preamble =
        firstHeading > 0 ? content.slice(0, firstHeading) : content;
      const preambleDelimiters = (preamble.match(/^---$/gm) ?? []).length;
      assert.ok(
        preambleDelimiters <= 2,
        `${dir}/SKILL.md has ${preambleDelimiters} frontmatter delimiters before first heading (expected 2)`,
      );
    });

    it(`${dir}/SKILL.md has required frontmatter fields`, () => {
      const fm = extractFrontmatter(content);
      assert.ok(fm.fields.has('name'), `${dir}/SKILL.md missing name field`);
      assert.ok(
        fm.fields.has('description'),
        `${dir}/SKILL.md missing description field`,
      );
    });
  }
});

// ---------------------------------------------------------------
// 4. All installed skills have version tags matching RUBRIC_VERSION
// ---------------------------------------------------------------
describe('Installed skill version tags', () => {
  const installed = getInstalledSkillDirs();
  // Read RUBRIC_VERSION from the built source
  let rubricVersion = '1.0.0'; // fallback
  const versionPath = join(ROOT, 'src/cli/rubric/version.ts');
  if (existsSync(versionPath)) {
    const versionContent = readFileSync(versionPath, 'utf-8');
    const match = versionContent.match(
      /RUBRIC_VERSION\s*=\s*['"]([^'"]+)['"]/,
    );
    if (match) rubricVersion = match[1];
  }

  for (const dir of installed) {
    const skillPath = join(SKILLS_DIR, dir, 'SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');
    const fm = extractFrontmatter(content);

    it(`${dir}/SKILL.md has goat-flow-skill-version`, () => {
      assert.ok(
        fm.fields.has('goat-flow-skill-version'),
        `${dir}/SKILL.md missing goat-flow-skill-version in frontmatter`,
      );
    });

    it(`${dir}/SKILL.md version matches RUBRIC_VERSION (${rubricVersion})`, () => {
      const version = fm.fields.get('goat-flow-skill-version');
      assert.equal(
        version,
        rubricVersion,
        `${dir}/SKILL.md has version ${version}, expected ${rubricVersion}`,
      );
    });
  }
});

// ---------------------------------------------------------------
// 5. No skill file has stale tail content (corrupted upgrades)
// ---------------------------------------------------------------
describe('No stale tail content in installed skills', () => {
  const installed = getInstalledSkillDirs();

  for (const dir of installed) {
    const skillPath = join(SKILLS_DIR, dir, 'SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');

    it(`${dir}/SKILL.md does not have duplicate heading blocks`, () => {
      // A corrupted skill file might have the same top-level heading repeated
      const headingPattern = new RegExp(`^# /${dir}$`, 'gm');
      const matches = content.match(headingPattern);
      const count = matches?.length ?? 0;
      assert.ok(
        count <= 1,
        `${dir}/SKILL.md has ${count} occurrences of the top heading (expected 0 or 1)`,
      );
    });
  }
});
