/**
 * Regression test for the preflight preamble/conventions sync check.
 * Verifies the diff-based check correctly detects when template and installed
 * copies of skill-preamble.md or skill-conventions.md diverge.
 *
 * Regression detection runs in a tmpdir - never mutates tracked repo files.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const TEMPLATE_REFERENCE_README = resolve(
  PROJECT_ROOT,
  "workflow/skills/reference/README.md",
);
const INSTALLED_REFERENCE_README = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-docs/README.md",
);
const TEMPLATE_PREAMBLE = resolve(
  PROJECT_ROOT,
  "workflow/skills/reference/skill-preamble.md",
);
const INSTALLED_PREAMBLE = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-docs/skill-preamble.md",
);
const TEMPLATE_CONVENTIONS = resolve(
  PROJECT_ROOT,
  "workflow/skills/reference/skill-conventions.md",
);
const INSTALLED_CONVENTIONS = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-docs/skill-conventions.md",
);
const TEMPLATE_BROWSER_USE = resolve(
  PROJECT_ROOT,
  "workflow/skills/playbooks/browser-use.md",
);
const INSTALLED_BROWSER_USE = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-docs/playbooks/browser-use.md",
);
const TEMPLATE_CODE_COMMENTS = resolve(
  PROJECT_ROOT,
  "workflow/skills/playbooks/code-comments.md",
);
const INSTALLED_CODE_COMMENTS = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-docs/playbooks/code-comments.md",
);
const TEMPLATE_GRUFF_CODE_QUALITY = resolve(
  PROJECT_ROOT,
  "workflow/skills/playbooks/gruff-code-quality.md",
);
const INSTALLED_GRUFF_CODE_QUALITY = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-docs/playbooks/gruff-code-quality.md",
);
const TEMPLATE_OBSERVABILITY = resolve(
  PROJECT_ROOT,
  "workflow/skills/playbooks/observability.md",
);
const INSTALLED_OBSERVABILITY = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-docs/playbooks/observability.md",
);
const TEMPLATE_PAGE_CAPTURE = resolve(
  PROJECT_ROOT,
  "workflow/skills/playbooks/page-capture.md",
);
const INSTALLED_PAGE_CAPTURE = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-docs/playbooks/page-capture.md",
);
const TEMPLATE_RELEASE_NOTES = resolve(
  PROJECT_ROOT,
  "workflow/skills/playbooks/release-notes.md",
);
const INSTALLED_RELEASE_NOTES = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-docs/playbooks/release-notes.md",
);
const TEMPLATE_CHANGELOG = resolve(
  PROJECT_ROOT,
  "workflow/skills/playbooks/changelog.md",
);
const INSTALLED_CHANGELOG = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-docs/playbooks/changelog.md",
);
const TEMPLATE_QUALITY_TESTING = resolve(
  PROJECT_ROOT,
  "workflow/skills/playbooks/skill-quality-testing.md",
);
const INSTALLED_QUALITY_TESTING = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-docs/skill-quality-testing/README.md",
);
const TOPICAL_FILES = ["tdd-iteration", "adversarial-framing", "deployment"];
const TOPICAL_PAIRS = TOPICAL_FILES.map((name) => ({
  name,
  template: resolve(
    PROJECT_ROOT,
    `workflow/skills/playbooks/skill-quality-testing/${name}.md`,
  ),
  installed: resolve(
    PROJECT_ROOT,
    `.goat-flow/skill-docs/skill-quality-testing/${name}.md`,
  ),
}));

/** Spawns quiet diff so sync contracts can assert parity without printing bodies. */
function diffQuiet(expectedPath: string, actualPath: string): number {
  const result = spawnSync("diff", ["-q", expectedPath, actualPath], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.status ?? -1;
}

// ---------------------------------------------------------------------------
// Template and installed copies currently match (sanity check)
// ---------------------------------------------------------------------------
describe("preamble/conventions sync: current state", () => {
  it("template and installed skill-docs README.md match", () => {
    if (
      !existsSync(TEMPLATE_REFERENCE_README) ||
      !existsSync(INSTALLED_REFERENCE_README)
    ) {
      return;
    }
    assert.equal(
      diffQuiet(TEMPLATE_REFERENCE_README, INSTALLED_REFERENCE_README),
      0,
      "skill-docs README.md: template and installed should match",
    );
  });

  it("template and installed skill-preamble.md match", () => {
    if (!existsSync(TEMPLATE_PREAMBLE) || !existsSync(INSTALLED_PREAMBLE)) {
      return; // Skip if either file is missing
    }
    assert.equal(
      diffQuiet(TEMPLATE_PREAMBLE, INSTALLED_PREAMBLE),
      0,
      "skill-preamble.md: template and installed should match",
    );
  });

  it("template and installed skill-conventions.md match", () => {
    if (
      !existsSync(TEMPLATE_CONVENTIONS) ||
      !existsSync(INSTALLED_CONVENTIONS)
    ) {
      return; // Skip if either file is missing
    }
    assert.equal(
      diffQuiet(TEMPLATE_CONVENTIONS, INSTALLED_CONVENTIONS),
      0,
      "skill-conventions.md: template and installed should match",
    );
  });

  it("template and installed browser-use.md match", () => {
    if (
      !existsSync(TEMPLATE_BROWSER_USE) ||
      !existsSync(INSTALLED_BROWSER_USE)
    ) {
      return; // Skip if either file is missing
    }
    assert.equal(
      diffQuiet(TEMPLATE_BROWSER_USE, INSTALLED_BROWSER_USE),
      0,
      "browser-use.md: template and installed should match",
    );
  });

  it("template and installed code-comments.md match", () => {
    if (
      !existsSync(TEMPLATE_CODE_COMMENTS) ||
      !existsSync(INSTALLED_CODE_COMMENTS)
    ) {
      return;
    }
    assert.equal(
      diffQuiet(TEMPLATE_CODE_COMMENTS, INSTALLED_CODE_COMMENTS),
      0,
      "code-comments.md: template and installed should match",
    );
  });

  it("template and installed gruff-code-quality.md match", () => {
    if (
      !existsSync(TEMPLATE_GRUFF_CODE_QUALITY) ||
      !existsSync(INSTALLED_GRUFF_CODE_QUALITY)
    ) {
      return;
    }
    assert.equal(
      diffQuiet(TEMPLATE_GRUFF_CODE_QUALITY, INSTALLED_GRUFF_CODE_QUALITY),
      0,
      "gruff-code-quality.md: template and installed should match",
    );
  });

  it("template and installed observability.md match", () => {
    if (
      !existsSync(TEMPLATE_OBSERVABILITY) ||
      !existsSync(INSTALLED_OBSERVABILITY)
    ) {
      return;
    }
    assert.equal(
      diffQuiet(TEMPLATE_OBSERVABILITY, INSTALLED_OBSERVABILITY),
      0,
      "observability.md: template and installed should match",
    );
  });

  it("template and installed page-capture.md match", () => {
    if (
      !existsSync(TEMPLATE_PAGE_CAPTURE) ||
      !existsSync(INSTALLED_PAGE_CAPTURE)
    ) {
      return;
    }
    assert.equal(
      diffQuiet(TEMPLATE_PAGE_CAPTURE, INSTALLED_PAGE_CAPTURE),
      0,
      "page-capture.md: template and installed should match",
    );
  });

  it("template and installed release-notes.md match", () => {
    if (
      !existsSync(TEMPLATE_RELEASE_NOTES) ||
      !existsSync(INSTALLED_RELEASE_NOTES)
    ) {
      return;
    }
    assert.equal(
      diffQuiet(TEMPLATE_RELEASE_NOTES, INSTALLED_RELEASE_NOTES),
      0,
      "release-notes.md: template and installed should match",
    );
  });

  it("template and installed changelog.md match", () => {
    if (!existsSync(TEMPLATE_CHANGELOG) || !existsSync(INSTALLED_CHANGELOG)) {
      return;
    }
    assert.equal(
      diffQuiet(TEMPLATE_CHANGELOG, INSTALLED_CHANGELOG),
      0,
      "changelog.md: template and installed should match",
    );
  });

  it("template and installed skill-quality-testing.md match", () => {
    if (
      !existsSync(TEMPLATE_QUALITY_TESTING) ||
      !existsSync(INSTALLED_QUALITY_TESTING)
    ) {
      return; // Skip if either file is missing
    }
    assert.equal(
      diffQuiet(TEMPLATE_QUALITY_TESTING, INSTALLED_QUALITY_TESTING),
      0,
      "skill-quality-testing.md: template and installed should match",
    );
  });

  for (const pair of TOPICAL_PAIRS) {
    it(`template and installed skill-quality-testing/${pair.name}.md match`, () => {
      if (!existsSync(pair.template) || !existsSync(pair.installed)) {
        return; // Skip if either file is missing
      }
      assert.equal(
        diffQuiet(pair.template, pair.installed),
        0,
        `skill-quality-testing/${pair.name}.md: template and installed should match`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Regression: diverged files are detected (non-zero diff status).
// Runs entirely in a tmpdir - never touches tracked repo files.
// ---------------------------------------------------------------------------
describe("preamble/conventions sync: regression detection", () => {
  it("detects when installed skill-preamble.md diverges from template", () => {
    if (!existsSync(TEMPLATE_PREAMBLE) || !existsSync(INSTALLED_PREAMBLE)) {
      return;
    }

    const tempDir = mkdtempSync(join(tmpdir(), "goat-flow-preamble-sync-"));
    try {
      const templateCopy = join(tempDir, "template-preamble.md");
      const installedCopy = join(tempDir, "installed-preamble.md");
      copyFileSync(TEMPLATE_PREAMBLE, templateCopy);
      copyFileSync(INSTALLED_PREAMBLE, installedCopy);

      // Sanity: tmp copies match before divergence
      assert.equal(
        diffQuiet(templateCopy, installedCopy),
        0,
        "Tmp copies should match before induced divergence",
      );

      // Diverge the tmp installed copy
      const original = readFileSync(installedCopy);
      writeFileSync(installedCopy, original + "\n# DIVERGED\n");

      // diff should now report non-zero
      assert.notEqual(
        diffQuiet(templateCopy, installedCopy),
        0,
        "Diff should detect divergence",
      );

      assert.notDeepStrictEqual(
        readFileSync(templateCopy),
        readFileSync(installedCopy),
        "Files should differ after modification",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Proof Gate heading is present in both template and installed preamble (ADR-018)
// ---------------------------------------------------------------------------
describe("preamble/conventions sync: Proof Gate presence (ADR-018)", () => {
  it("template skill-preamble.md contains '## Proof Gate' heading", () => {
    if (!existsSync(TEMPLATE_PREAMBLE)) return;
    const content = readFileSync(TEMPLATE_PREAMBLE, "utf-8");
    assert.match(
      content,
      /^## Proof Gate\b/m,
      "Template preamble must contain '## Proof Gate' heading",
    );
  });

  it("installed skill-preamble.md contains '## Proof Gate' heading", () => {
    if (!existsSync(INSTALLED_PREAMBLE)) return;
    const content = readFileSync(INSTALLED_PREAMBLE, "utf-8");
    assert.match(
      content,
      /^## Proof Gate\b/m,
      "Installed preamble must contain '## Proof Gate' heading",
    );
  });
});
