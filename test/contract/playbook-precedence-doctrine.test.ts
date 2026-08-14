/**
 * Locks bounded project-authority precedence across discipline playbooks.
 */
import { createHash } from "node:crypto";
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
] as const;

const WRITING_STYLE_SHA256 =
  "9439a2d3bb7d0ef19dec6c7672c39e5badff26e258367e6e15451d2d1d51ef44";

/** Reads one playbook copy without normalizing bytes. */
function readPlaybook(root: string, name: string): string {
  return readFileSync(`${root}/${name}`, "utf8");
}

/** Returns the bounded authority section used by the semantic assertions. */
function readProjectAuthority(content: string, playbookPath: string): string {
  const heading = "## Project Authority";
  const start = content.indexOf(heading);
  assert.notEqual(start, -1, `${playbookPath}: missing ${heading}`);

  const nextHeading = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, nextHeading === -1 ? undefined : nextHeading);
}

function assertBoundedProjectAuthority(
  content: string,
  playbookPath: string,
): void {
  const authority = readProjectAuthority(content, playbookPath);

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
  it("keeps the established writing-style authority control byte-identical", () => {
    const copies = PLAYBOOK_ROOTS.map((root) =>
      readPlaybook(root, "writing-style.md"),
    );

    assert.equal(copies[0], copies[1], "writing-style mirrors drifted");
    for (const [index, content] of copies.entries()) {
      const digest = createHash("sha256").update(content).digest("hex");
      assert.equal(digest, WRITING_STYLE_SHA256, PLAYBOOK_ROOTS[index]);
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
