/**
 * Keep the code map useful for finding public, safety, persistence, planning, and hook responsibilities.
 *
 * These contracts require the relevant module families while allowing ordinary internal helpers to stay unmapped.
 * Run them when changing navigation guidance or moving responsibility between modules.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../..",
);
const CODE_MAP = readFileSync(
  resolve(PROJECT_ROOT, ".goat-flow/code-map.md"),
  "utf8",
);

// Responsibility families an orienting agent must be able to locate from the map alone.
const REQUIRED_FAMILIES = [
  "cli-parser*.ts",
  "help.ts",
  "hook-*.ts",
  "hooks-command.ts",
  "hooks-configured-runtime-evidence.ts",
  "hooks-runtime-evidence.ts",
  "learn-scaffold.ts",
  "learning-loop-recall.ts",
  "managed-install-evidence.ts",
  "path-write-claim.ts",
  "plans-check*.ts",
  "plans-export*.ts",
  "rendered-markdown.ts",
  "skill-author*.ts",
] as const;

// Launch modules tracked in BOTH `workflow/hooks/` and `.goat-flow/hooks/`; the map carries a block for each.
const HOOK_LAUNCH_MODULES = [
  "run-with-bash.mjs",
  "hook-launch-runtime.mjs",
  "hook-provider-adapters.mjs",
] as const;

describe("code map responsibility families", () => {
  it("resolves every required public, safety, and plan-authoring family", () => {
    const missing = REQUIRED_FAMILIES.filter(
      (family) => !CODE_MAP.includes(family),
    );

    assert.deepEqual(
      missing,
      [],
      `.goat-flow/code-map.md does not name these responsibility families: ${missing.join(", ")}`,
    );
  });

  it("lists every hook launch module in both the template and installed blocks", () => {
    // Both trees track all three; a module named once is missing from one of the two blocks.
    for (const modulePath of HOOK_LAUNCH_MODULES) {
      const occurrences = CODE_MAP.split(modulePath).length - 1;
      assert.equal(
        occurrences,
        2,
        `${modulePath} appears ${occurrences} time(s) in the code map; it is tracked in workflow/hooks/ and .goat-flow/hooks/, so both blocks must list it`,
      );
    }
  });

  it("still declares itself non-exhaustive", () => {
    // The declaration is what makes an unmapped helper correct rather than a defect.
    assert.match(
      CODE_MAP,
      /responsibility map, not an exhaustive file inventory/u,
    );
  });

  it("allows an ordinary internal helper to stay unmapped", () => {
    // audit-provenance.ts is an existing internal helper intentionally absent from the responsibility map.
    // If it gains a mapped responsibility, choose another unmapped helper so this check keeps the map from becoming a file census.
    assert.ok(
      existsSync(resolve(PROJECT_ROOT, "src/cli/audit/audit-provenance.ts")),
      "the negative control module no longer exists; repoint it at another unmapped internal helper",
    );
    assert.ok(
      !CODE_MAP.includes("audit-provenance.ts"),
      "the negative control module is now mapped; pick another unmapped helper so this contract keeps proving the map is bounded",
    );
  });
});
