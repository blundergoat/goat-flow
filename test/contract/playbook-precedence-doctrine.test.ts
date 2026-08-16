/**
 * Locks bounded project-authority precedence across discipline playbooks.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const PLAYBOOK_ROOTS = [
  ".goat-flow/skill-docs/playbooks",
  "workflow/skills/playbooks",
] as const;

const AUTHORITY_PLAYBOOKS = [
  "code-comments.md",
  "changelog.md",
  "release-notes.md",
  "observability.md",
  "gruff-code-quality.md",
  "naming-and-placement.md",
  "test-selection.md",
  "writing-sentence-diagnostics.md",
  "writing-structure-diagnostics.md",
  "writing-style.md",
] as const;

const WRITING_PLAYBOOKS = [
  "writing-style.md",
  "writing-sentence-diagnostics.md",
  "writing-structure-diagnostics.md",
] as const;

/** Reads one playbook copy without normalizing bytes. */
function readPlaybook(root: string, name: string): string {
  return readFileSync(`${root}/${name}`, "utf8");
}

/** Returns one top-level playbook section used by semantic assertions. */
function readPlaybookSection(
  content: string,
  sectionName: string,
  playbookPath: string,
): string {
  const heading = `## ${sectionName}`;
  const start = content.indexOf(heading);
  assert.notEqual(start, -1, `${playbookPath}: missing ${heading}`);

  const nextHeading = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, nextHeading === -1 ? undefined : nextHeading);
}

function assertBoundedProjectAuthority(
  content: string,
  playbookPath: string,
): void {
  const authority = readPlaybookSection(
    content,
    "Project Authority",
    playbookPath,
  );

  assert.match(
    authority,
    /project[\s\S]{0,100}(?:standard|canon|policy|convention|configuration|vocabulary|patterns?)/iu,
    `${playbookPath}: project discipline authority is not named`,
  );
  assert.match(
    authority,
    /(?:governs?|controls?|takes precedence|wins|owns?|yields?|defers?)/iu,
    `${playbookPath}: precedence direction is not stated`,
  );
  assert.match(
    authority,
    /(?:\b(?:absent|without|if no|when no|unless)\b[\s\S]{0,120}\b(?:defaults?|fallback)\b|\b(?:defaults?|fallback)\b[\s\S]{0,120}\b(?:absent|without|if no|when no|unless)\b)/iu,
    `${playbookPath}: generic fallback is not bounded to absent project guidance`,
  );
  assert.match(
    authority,
    /(?:current|active|explicit)[\s-]+instructions?/iu,
    `${playbookPath}: current instructions are not protected`,
  );
  assert.match(
    authority,
    /(?:authoritative project hierarchy|project(?:'s)? authoritative hierarchy|accepted architecture)/iu,
    `${playbookPath}: authoritative project hierarchy is not protected`,
  );
  assert.match(
    authority,
    /\bsafety\b/iu,
    `${playbookPath}: safety is not protected`,
  );
  assert.match(
    authority,
    /\barchitecture\b/iu,
    `${playbookPath}: architecture is not protected`,
  );
  assert.match(
    authority,
    /\bverified facts\b/iu,
    `${playbookPath}: verified facts are not protected`,
  );
  assert.match(
    authority,
    /\bevidence\b/iu,
    `${playbookPath}: evidence is not protected`,
  );
  assert.match(
    authority,
    /\bverification\b/iu,
    `${playbookPath}: verification is not protected`,
  );
  assert.match(
    authority,
    /(?:cannot|must not|never|does not)[\s\S]{0,160}(?:override|weaken|alter|change|supersede)/iu,
    `${playbookPath}: lower authority is not explicitly bounded`,
  );
}

describe("playbook project-precedence doctrine", () => {
  it("keeps routed writing playbooks mirrored without whole-file digest pins", () => {
    for (const playbookName of WRITING_PLAYBOOKS) {
      const copies = PLAYBOOK_ROOTS.map((root) =>
        readPlaybook(root, playbookName),
      );
      assert.equal(copies[0], copies[1], `${playbookName} mirrors drifted`);
    }
  });

  for (const playbookName of AUTHORITY_PLAYBOOKS) {
    for (const playbookRoot of PLAYBOOK_ROOTS) {
      const playbookPath = `${playbookRoot}/${playbookName}`;
      it(`${playbookPath} gives project conventions bounded authority`, () => {
        assertBoundedProjectAuthority(
          readPlaybook(playbookRoot, playbookName),
          playbookPath,
        );
      });
    }
  }
});

describe("Gruff availability and policy controls", () => {
  for (const playbookRoot of PLAYBOOK_ROOTS) {
    const playbookPath = `${playbookRoot}/gruff-code-quality.md`;

    it(`${playbookPath} discovers existing tools without resolver execution`, () => {
      const content = readPlaybook(playbookRoot, "gruff-code-quality.md");
      const availability = readPlaybookSection(
        content,
        "Availability Check",
        playbookPath,
      );

      assert.match(
        availability,
        /Availability discovery only inspects wrappers and existing executable paths/u,
        playbookPath,
      );
      assert.match(
        availability,
        /never invokes a package resolver, installer, init command, or dependency-fetching wrapper/u,
        playbookPath,
      );
      assert.doesNotMatch(
        availability,
        /\bnpx\b|\bbunx\b|\bpnpm dlx\b|\byarn dlx\b|\bgo tool\b|\buv run\b|\bpipx run\b/u,
        playbookPath,
      );
    });

    it(`${playbookPath} gates CONFIGURE and BASELINE with two exact controls`, () => {
      const content = readPlaybook(playbookRoot, "gruff-code-quality.md");

      assert.match(
        content,
        /Before CONFIGURE or BASELINE, run one exact true positive and one known-good negative control/u,
        playbookPath,
      );
      assert.match(
        content,
        /expected rule ID and target identity exposed by the installed port/u,
        playbookPath,
      );
      assert.match(
        content,
        /negative control emits no finding for that rule/u,
        playbookPath,
      );
    });
  }
});
