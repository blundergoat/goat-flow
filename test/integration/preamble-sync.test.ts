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
const TEMPLATE_PREAMBLE = resolve(
  PROJECT_ROOT,
  "workflow/skills/reference/skill-preamble.md",
);
const INSTALLED_PREAMBLE = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-reference/skill-preamble.md",
);
const TEMPLATE_CONVENTIONS = resolve(
  PROJECT_ROOT,
  "workflow/skills/reference/skill-conventions.md",
);
const INSTALLED_CONVENTIONS = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-reference/skill-conventions.md",
);
const TEMPLATE_BROWSER_USE = resolve(
  PROJECT_ROOT,
  "workflow/skills/reference/browser-use.md",
);
const INSTALLED_BROWSER_USE = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-reference/browser-use.md",
);
const TEMPLATE_PAGE_CAPTURE = resolve(
  PROJECT_ROOT,
  "workflow/skills/reference/page-capture.md",
);
const INSTALLED_PAGE_CAPTURE = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-reference/page-capture.md",
);
const TEMPLATE_QUALITY_TESTING = resolve(
  PROJECT_ROOT,
  "workflow/skills/reference/skill-quality-testing.md",
);
const INSTALLED_QUALITY_TESTING = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-reference/skill-quality-testing.md",
);
const TOPICAL_FILES = ["tdd-iteration", "adversarial-framing", "deployment"];
const TOPICAL_PAIRS = TOPICAL_FILES.map((name) => ({
  name,
  template: resolve(
    PROJECT_ROOT,
    `workflow/skills/reference/skill-quality-testing/${name}.md`,
  ),
  installed: resolve(
    PROJECT_ROOT,
    `.goat-flow/skill-reference/skill-quality-testing/${name}.md`,
  ),
}));

function diffQuiet(a: string, b: string): number {
  const r = spawnSync("diff", ["-q", a, b], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return r.status ?? -1;
}

// ---------------------------------------------------------------------------
// Template and installed copies currently match (sanity check)
// ---------------------------------------------------------------------------
describe("preamble/conventions sync: current state", () => {
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

    const tmp = mkdtempSync(join(tmpdir(), "goat-flow-preamble-sync-"));
    try {
      const tmpTemplate = join(tmp, "template-preamble.md");
      const tmpInstalled = join(tmp, "installed-preamble.md");
      copyFileSync(TEMPLATE_PREAMBLE, tmpTemplate);
      copyFileSync(INSTALLED_PREAMBLE, tmpInstalled);

      // Sanity: tmp copies match before divergence
      assert.equal(
        diffQuiet(tmpTemplate, tmpInstalled),
        0,
        "Tmp copies should match before induced divergence",
      );

      // Diverge the tmp installed copy
      const original = readFileSync(tmpInstalled);
      writeFileSync(tmpInstalled, original + "\n# DIVERGED\n");

      // diff should now report non-zero
      assert.notEqual(
        diffQuiet(tmpTemplate, tmpInstalled),
        0,
        "Diff should detect divergence",
      );

      assert.notDeepStrictEqual(
        readFileSync(tmpTemplate),
        readFileSync(tmpInstalled),
        "Files should differ after modification",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
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
