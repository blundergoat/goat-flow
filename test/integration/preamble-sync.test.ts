/**
 * Parity contract for the shared references and playbooks goat-flow installs into `.goat-flow/skill-docs/`.
 *
 * Every pair in the audit's `SHARED_ARTIFACT_MIRRORS` registry must match byte for byte, so a new playbook is
 * covered the moment it is registered instead of needing a hand-written case here. The remaining cases check
 * the discovery row and preamble sections agents rely on, and prove the diff-based detection still fires.
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
import { basename, dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { SHARED_ARTIFACT_MIRRORS } from "../../src/cli/audit/artifact-templates.js";

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

/** Spawns quiet diff so sync contracts can assert parity without printing bodies. */
function diffQuiet(expectedPath: string, actualPath: string): number {
  const result = spawnSync("diff", ["-q", expectedPath, actualPath], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.status ?? -1;
}

/** Fail loudly when a managed mirror disappears instead of turning parity into a passing no-op. */
function assertMirrorExists(
  templatePath: string,
  installedPath: string,
  label: string,
): void {
  assert.equal(existsSync(templatePath), true, `${label}: template must exist`);
  assert.equal(
    existsSync(installedPath),
    true,
    `${label}: installed copy must exist`,
  );
}

/**
 * Name one registry pair the way maintainers know the file.
 * README mirrors keep their parent directory so the reference and playbook READMEs stay distinct cases.
 *
 * @param templatePath - repository-relative canonical source path from the registry
 * @returns the file name, or `<parent>/README.md` for a README mirror
 */
function mirrorLabel(templatePath: string): string {
  const name = basename(templatePath);
  return name === "README.md"
    ? `${basename(dirname(templatePath))}/README.md`
    : name;
}

// ---------------------------------------------------------------------------
// Template and installed copies currently match (sanity check)
// ---------------------------------------------------------------------------
describe("preamble/conventions sync: current state", () => {
  it("the mirror registry still enrolls the shared reference files", () => {
    // Registry-driven parity cannot notice a core entry disappearing from the registry itself.
    const installed = new Set(
      SHARED_ARTIFACT_MIRRORS.map((spec) => spec.installed),
    );
    for (const required of [
      ".goat-flow/skill-docs/README.md",
      ".goat-flow/skill-docs/skill-preamble.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ]) {
      assert.ok(
        installed.has(required),
        `${required} is no longer registered in SHARED_ARTIFACT_MIRRORS`,
      );
    }
  });

  for (const spec of SHARED_ARTIFACT_MIRRORS) {
    const label = mirrorLabel(spec.template);
    it(`template and installed ${label} match`, () => {
      const templatePath = resolve(PROJECT_ROOT, spec.template);
      const installedPath = resolve(PROJECT_ROOT, spec.installed);
      assertMirrorExists(templatePath, installedPath, label);
      assert.equal(
        diffQuiet(templatePath, installedPath),
        0,
        `${label}: template and installed should match`,
      );
    });
  }

  it("the skill-conventions discovery row names every load-bearing role it governs", () => {
    // Byte parity alone lets two identical rows be identically wrong. Before 2026-08-29 both READMEs described this
    // file as learning-entry formats only, hiding Adaptive Step 0, Orchestration Admission, recovery and authoring
    // from any agent deciding whether to load it. A discovery row is the agent's whole context before that decision.
    const governedRoles = [
      "Adaptive Step 0",
      "task tracking",
      "Orchestration Admission",
      "recovery",
      "Interrupt Freeze",
      "autonomy",
      "authoring",
    ];

    for (const readmePath of [
      TEMPLATE_REFERENCE_README,
      INSTALLED_REFERENCE_README,
    ]) {
      const row = readFileSync(readmePath, "utf8")
        .split("\n")
        .find((line) => line.includes("[`skill-conventions.md`]"));
      assert.ok(row, `${readmePath}: no skill-conventions discovery row`);
      for (const role of governedRoles) {
        assert.ok(
          row.toLowerCase().includes(role.toLowerCase()),
          `${readmePath}: the skill-conventions row does not name "${role}", so an agent cannot tell the file governs it`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Regression: diverged files are detected (non-zero diff status).
// Runs entirely in a tmpdir - never touches tracked repo files.
// ---------------------------------------------------------------------------
describe("preamble/conventions sync: regression detection", () => {
  it("detects when installed skill-preamble.md diverges from template", () => {
    assertMirrorExists(
      TEMPLATE_PREAMBLE,
      INSTALLED_PREAMBLE,
      "skill-preamble.md",
    );

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
// Proof Gate heading is present in both template and installed preamble (ADR-009)
// ---------------------------------------------------------------------------
describe("preamble/conventions sync: Proof Gate presence (ADR-009)", () => {
  it("template skill-preamble.md contains '## Proof Gate' heading", () => {
    assert.equal(
      existsSync(TEMPLATE_PREAMBLE),
      true,
      "skill-preamble.md template must exist",
    );
    const content = readFileSync(TEMPLATE_PREAMBLE, "utf-8");
    assert.match(
      content,
      /^## Proof Gate\b/m,
      "Template preamble must contain '## Proof Gate' heading",
    );
  });

  it("installed skill-preamble.md contains '## Proof Gate' heading", () => {
    assert.equal(
      existsSync(INSTALLED_PREAMBLE),
      true,
      "installed skill-preamble.md must exist",
    );
    const content = readFileSync(INSTALLED_PREAMBLE, "utf-8");
    assert.match(
      content,
      /^## Proof Gate\b/m,
      "Installed preamble must contain '## Proof Gate' heading",
    );
  });
});

describe("preamble/conventions sync: proof-evidence pointer", () => {
  // One named case per preamble copy, so a failure names the template or the installed file.
  for (const preamblePath of [TEMPLATE_PREAMBLE, INSTALLED_PREAMBLE]) {
    // Covers where an agent is sent for proof examples: the stale README pointer must be gone.
    it(`points directly to the verification claim evidence table in ${preamblePath}`, () => {
      const content = readFileSync(preamblePath, "utf-8");
      assert.match(
        content,
        /skill-quality-testing\/deployment\.md` under `Verification claim evidence`/,
        preamblePath,
      );
      assert.doesNotMatch(
        content,
        /Concrete claim\/proof examples live in `\.goat-flow\/skill-docs\/skill-quality-testing\/README\.md`/,
        preamblePath,
      );
    });
  }
});
